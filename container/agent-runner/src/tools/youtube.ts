import { registry } from '../tool-registry.js';
import { log } from '../ipc-helpers.js';

// YouTube toolchain (2026-09-18, re-wired 2026-09-19). Playing a video used to
// be hand-driven browser work; it became one merged `youtube` tool. It drove
// the dedicated debug Chrome over CDP (Playwright pages) until that browser
// was retired: interactive browsing now has exactly ONE provider — the
// default app (Settings → Default apps → browser, e.g. the browser-driving
// MCP bridge on the user's real Chrome). This file keeps the battle-tested
// flow (search-result ad filtering, the advancing-time playback check, the
// never-send-a-toggle rule) and swaps the transport: a minimal Page-like
// adapter over the provider's MCP tools. Capabilities are discovered from the
// live connection at call time — navigate + script-eval are required, a tab
// list and a key-press tool upgrade fidelity when present; anything missing
// surfaces as an honest error, never a silent wrong action.

const WATCH_RE = /youtube\.com\/watch|youtu\.be\//i;

/** A bare video id or any youtube URL → a canonical watch URL. '' if neither. */
function toWatchUrl(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    if (/^[\w-]{11}$/.test(s)) return `https://www.youtube.com/watch?v=${s}`;
    if (!/^https?:\/\//i.test(s)) return '';
    try {
        const u = new URL(s);
        if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
            const id = u.pathname.slice(1);
            return id ? `https://www.youtube.com/watch?v=${id}` : '';
        }
        if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return '';
        const id = u.searchParams.get('v');
        // A playlist/shorts/live URL is fine as-is — it still lands on a player.
        return id ? `https://www.youtube.com/watch?v=${id}` : s;
    } catch { return ''; }
}

interface Result { title: string; channel: string; duration: string; url: string }

/** Same video id in two URLs — so "play X" while X is already playing is a
 *  no-op instead of a reload that restarts the song. */
function sameVideo(a: string, b: string): boolean {
    const id = (u: string) => { try { return new URL(u).searchParams.get('v') || ''; } catch { return ''; } };
    const x = id(a);
    return !!x && x === id(b);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Recently played video URLs — "change the song" must not re-deal the same
// one because it ranks first. The history LIVES IN MARM: each play logs a
// "youtube-play:" memory entry, and the picker recalls them to know what to
// exclude. No separate store to grow stale (2026-09-19).

async function marmTool(re: RegExp): Promise<{ call: (args: any) => Promise<any> } | null> {
    try {
        const bridge = (globalThis as any).__mcpBridge;
        const tools = bridge?.listTools?.('marm') || [];
        const t = tools.find((x: any) => re.test(x.name || ''));
        if (!t) return null;
        return { call: (args: any) => bridge.call('marm', t.name, args) };
    } catch {
        return null;
    }
}

async function logPlay(url: string, title: string): Promise<void> {
    const marm = await marmTool(/marm_log_entry$/);
    if (!marm) return;
    await marm.call({ entry: `youtube-play: ${title} (${url})` }).catch(() => { /* advisory */ });
}

async function recentPlayed(query: string): Promise<{ ids: Set<string>; titles: Set<string> }> {
    const ids = new Set<string>();
    const titles = new Set<string>();
    try {
        const marm = await marmTool(/marm_smart_recall$/);
        if (!marm) return { ids, titles };
        const res = await marm.call({
            query: `youtube-play ${query}`,
            limit: 20,
            // Play history is written via marm_log_entry — it lives in the RAW
            // LOG store, which recall skips unless include_logs is set. Keyword
            // mode over semantic: a play logged 30 seconds ago must be found
            // NOW, before the semantic index catches up.
            include_logs: true,
            exact_mode: 'keyword',
        });
        const text = resultText(res);
        for (const m of text.matchAll(/youtube-play:\s*([^()\n]+)\s*\((https?:\/\/[^\s)]+)\)/g)) {
            titles.add(m[1].trim().toLowerCase());
            ids.add(/v=([\w-]{11})/.exec(m[2])?.[1] || m[2]);
        }
    } catch { /* recall is advisory — worst case a repeat slips through */ }
    return { ids, titles };
}

const recentPicks = new Set<string>();

// ─── The default-app browser bridge ─────────────────────────────────────────

interface BridgeToolDef { name: string; description: string; params: any }
interface Bridge {
    server: string;
    tools: BridgeToolDef[];
    call: (server: string, tool: string, args: any) => Promise<any>;
}

async function browserBridge(): Promise<Bridge | null> {
    const apps = ((globalThis as any).__wardenDefaultApps?.() || {}) as Record<string, string>;
    const v = String(apps.browser || '').trim();
    if (!v.startsWith('mcp:')) return null;
    const server = v.slice(4).trim();
    const bridge = (globalThis as any).__mcpBridge;
    if (!bridge) return null;
    const tools: BridgeToolDef[] = bridge.listTools(server) || [];
    if (tools.length === 0) return null;
    return { server, tools, call: bridge.call };
}

function pickTool(tools: BridgeToolDef[], re: RegExp, avoid: RegExp = /screenshot|content|console/i): BridgeToolDef | null {
    const scored = tools.filter((t) => re.test(t.name) || re.test(t.description || ''));
    return scored.find((t) => !avoid.test(t.name)) || scored[0] || null;
}

/** Find the parameter of `tool` whose name matches `re`. */
function paramOf(tool: BridgeToolDef, re: RegExp): string | null {
    const props = tool.params?.properties || {};
    for (const k of Object.keys(props)) if (re.test(k)) return k;
    return null;
}

/** Unwrap an MCP tool result to text. */
function resultText(res: any): string {
    if (res == null) return '';
    if (typeof res === 'string') return res;
    const c = res.content;
    if (Array.isArray(c)) {
        const t = c.find((x: any) => x?.type === 'text') || c[0];
        return String(t?.text ?? '');
    }
    if (typeof res.result === 'string') return res.result;
    return JSON.stringify(res);
}

/** Best-effort parse of a tool result that wraps a JSON payload. */
function resultJson(res: any): any {
    const t = resultText(res);
    try {
        const parsed = JSON.parse(t);
        // chrome_* tools wrap: {success, tabId, engine, result: <value>, metrics}
        // — the payload is the `result` member regardless of how many metadata
        // keys ride along.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'result' in parsed) {
            const inner = parsed.result;
            if (typeof inner === 'string') { try { return JSON.parse(inner); } catch { return inner; } }
            return inner;
        }
        return parsed;
    } catch { return t; }
}

/** Page-like adapter over the provider's MCP tools — just what the YouTube
 *  flow needs: goto, url, evaluate, waitForSelector, waitForTimeout,
 *  bringToFront, keyboard.press. `tabId` targets a specific tab when the
 *  tools accept one; without it they act on the active tab. */
class McpPage {
    tabId?: number;
    private bridge: Bridge;
    private nav: BridgeToolDef;
    private js: BridgeToolDef;
    /** 'body' = the tool runs the source as a function body (`return` works —
     *  chrome_javascript). 'expr' = wrap the source in an IIFE expression. */
    private jsBody: boolean;

    constructor(bridge: Bridge, nav: BridgeToolDef, js: BridgeToolDef, jsBody: boolean) {
        this.bridge = bridge; this.nav = nav; this.js = js; this.jsBody = jsBody;
    }

    /** First navigate may create its own tab (chrome_navigate without tabId
     *  does) — the navigate result names the tab it used, so we pin to it
     *  straight from the reply and never spawn a second one. */
    private adoptFromNavigate(res: any): void {
        if (this.tabId !== undefined) return;
        const id = (resultJson(res) as any)?.tabId;
        if (typeof id === 'number') this.tabId = id;
    }

    private async evalTool(args: Record<string, any>): Promise<any> {
        // Scope the eval to this page's tab — without a tabId the tool runs on
        // the ACTIVE tab, which is whatever the user is looking at.
        if (this.tabId !== undefined) {
            const tabParam = paramOf(this.js, /tab_?id/i);
            if (tabParam) args[tabParam] = this.tabId;
        }
        return await this.bridge.call(this.bridge.server, this.js.name, args);
    }

    private async navTool(args: Record<string, any>): Promise<any> {
        return await this.bridge.call(this.bridge.server, this.nav.name, args);
    }

    /** Run a JS snippet in the page and parse the reply. Snippets are written
     *  body-style (`return x;`). The arg is passed as a JSON-encoded string
     *  constant; snippets parse it themselves (`JSON.parse(__arg)`), which
     *  dodges the injection/escaping problem entirely. */
    async evaluate<T = any>(body: string, arg?: unknown): Promise<T | null> {
        const codeParam = paramOf(this.js, /code|script|func|expression|js|source/i) || 'code';
        const argPre = arg !== undefined ? `const __arg = ${JSON.stringify(JSON.stringify(arg))};\n` : '';
        const src = this.jsBody ? `${argPre}${body}` : `(function () {\n${argPre}${body}\n})()`;
        const res = await this.evalTool({ [codeParam]: src }).catch((e) => { throw new Error(`browser script tool failed: ${e?.message || e}`); });
        const out = resultJson(res);
        if (out == null || out === '' || out === 'null' || out === 'undefined') {
            log(`[youtube] eval(${this.js.name}) returned empty — raw: ${resultText(res).slice(0, 300)}`);
        }
        return out;
    }

    async goto(url: string): Promise<void> {
        const urlParam = paramOf(this.nav, /url|link/i) || 'url';
        const args: Record<string, any> = { [urlParam]: url };
        const tabParam = paramOf(this.nav, /tab_?id/i);
        if (tabParam && this.tabId !== undefined) args[tabParam] = this.tabId;
        const res = await this.navTool(args);
        this.adoptFromNavigate(res);
        await this.waitForSelector('body', 15000).catch(() => {});
    }

    async url(): Promise<string> {
        try {
            const u = await this.evaluate(`return window.location.href;`);
            return typeof u === 'string' ? u : '';
        } catch { return ''; }
    }

    async waitForSelector(selector: string, timeoutMs = 10000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const hit = await this.evaluate(`return !!document.querySelector(${JSON.stringify(selector)});`);
            if (hit) return;
            await sleep(400);
        }
        throw new Error(`waitForSelector timed out: ${selector}`);
    }

    /** Wait until the tab's URL matches — the signal that a navigate actually
     *  took effect. A selector alone lies mid-navigation: the OLD document
     *  still answers polls (a watch page's related videos match any
     *  watch-anchor wait), so extraction runs on a dying page and finds
     *  nothing (2026-09-19 "No YouTube results" on a loaded results page). */
    async waitForUrl(re: RegExp, timeoutMs = 15000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (re.test(await this.url())) return;
            await sleep(300);
        }
        throw new Error(`waitForUrl timed out: ${re}`);
    }

    async waitForTimeout(ms: number): Promise<void> { await sleep(ms); }

    async bringToFront(): Promise<void> {
        const act = pickTool(this.bridge.tools, /switch.*tab|activate.*tab|focus.*tab/i);
        if (!act) return;
        const tabParam = paramOf(act, /tab_?id/i);
        if (!tabParam || this.tabId === undefined) return;
        await this.bridge.call(this.bridge.server, act.name, { [tabParam]: this.tabId }).catch(() => {});
    }

    async pressKey(key: string): Promise<boolean> {
        const keyTool = pickTool(this.bridge.tools, /keyboard|press.*key/i);
        if (!keyTool) return false;
        const keyParam = paramOf(keyTool, /keys|key\b|text/i) || 'keys';
        const args: Record<string, any> = { [keyParam]: key };
        const tabParam = paramOf(keyTool, /tab_?id/i);
        if (tabParam && this.tabId !== undefined) args[tabParam] = this.tabId;
        await this.bridge.call(this.bridge.server, keyTool.name, args);
        return true;
    }
}

/** The connected provider's pages, reduced to the adapter + a tab list. */
async function openBrowser(): Promise<{ page: McpPage; tabs: Array<{ id?: number; url: string }> | null }> {
    const bridge = await browserBridge();
    if (!bridge) {
        throw new Error('No default browser provider is connected. Set Settings → Default apps → browser to an MCP server (e.g. browser-driving) and make sure it is running.');
    }
    // chrome_javascript is the preferred eval tool: its `code` runs inside an
    // async function body, so our body-style snippets work verbatim. inject/
    // evaluate-shaped tools are the fallback (wrapped as an IIFE expression).
    const nav = pickTool(bridge.tools, /navigat|goto/i) ?? pickTool(bridge.tools, /open.*tab|new.*tab/i);
    const jsExact = bridge.tools.find((t) => /javascript$/i.test(t.name));
    const js = jsExact ?? pickTool(bridge.tools, /inject.*script|evaluate|execute.*script/i);
    if (!nav) throw new Error(`The default browser provider "${bridge.server}" exposes no navigate tool — it cannot open pages.`);
    if (!js) throw new Error(`The default browser provider "${bridge.server}" exposes no script/evaluate tool — page control is not possible with it.`);
    const jsBody = !!jsExact || /function body|return\s*\.\.\./i.test(js.description || '');
    // Existing YouTube tab first — the tab discipline below depends on it.
    const tabsTool = bridge.tools.find((t) => /windows_and_tabs/i.test(t.name)) ?? pickTool(bridge.tools, /list.*tabs?|tabs?$/i);
    const page = new McpPage(bridge, nav, js, jsBody);
    let tabs: Array<{ id?: number; url: string }> | null = null;
    if (tabsTool) {
        try {
            const res = await bridge.call(bridge.server, tabsTool.name, {});
            const parsed = resultJson(res);
            let arr: any[] | null = null;
            if (Array.isArray(parsed)) arr = parsed;
            else if (Array.isArray(parsed?.tabs)) arr = parsed.tabs;
            else if (Array.isArray(parsed?.windows)) {
                // {windows: [{tabs: [...]}]} — flatten in window order
                arr = parsed.windows.flatMap((w: any) => Array.isArray(w?.tabs) ? w.tabs : []);
            }
            if (arr) tabs = arr.map((t: any) => ({ id: t?.id ?? t?.tabId ?? t?.tab_id, url: String(t?.url || '') }));
        } catch { tabs = null; }
    }
    // A tab already on a watch page first; else the user's open youtube tab
    // (results/home) — that tab IS "the one I had open" and gets played into
    // rather than spawning a duplicate.
    const watch = tabs?.find((t) => WATCH_RE.test(t.url))
        ?? tabs?.find((t) => /youtube\.com|youtu\.be/i.test(t.url));
    if (watch && watch.id !== undefined) page.tabId = watch.id;
    return { page, tabs };
}

// ─── The flow (transport-independent from here down) ────────────────────────

/** The tab already on a YouTube watch page, or null. */
async function findWatchPage(page: McpPage, tabs: Array<{ id?: number; url: string }> | null): Promise<McpPage | null> {
    const watch = tabs?.find((t) => WATCH_RE.test(t.url));
    if (watch && watch.id !== undefined) {
        const p = Object.create(Object.getPrototypeOf(page));
        Object.assign(p, page, { tabId: watch.id });
        return p;
    }
    return WATCH_RE.test(await page.url()) ? page : null;
}

/** The live player tab — the one already watching, else the active page. */
async function playerPage(page: McpPage, tabs: Array<{ id?: number; url: string }> | null): Promise<{ page: McpPage; onWatch: boolean }> {
    const watch = await findWatchPage(page, tabs);
    if (watch) return { page: watch, onWatch: true };
    return { page, onWatch: false };
}

async function runSearch(page: McpPage, query: string, limit: number): Promise<Result[]> {
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    // The URL flip means the navigate took effect and the old document is
    // gone; only then do anchors mean "results are up".
    await page.waitForUrl(/results\?search_query=/);
    await page.waitForSelector('a[href*="/watch?v="]', 20000);
    // Extract IN the page — the read tools can't carry this (chrome_read_page
    // is a viewport accessibility tree with no absolute URLs; get_web_content
    // truncates to link-less text). Only script-eval sees the anchors.
    const results = await page.evaluate<Result[]>(`const limit = JSON.parse(__arg);
const seen = new Set(); const out = [];
for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
  const id = /[?&]v=([\\w-]{11})/.exec(a.href)?.[1];
  if (!id || seen.has(id)) continue; seen.add(id);
  const row = a.closest('ytd-video-renderer, yt-lockup-view-model, ytd-compact-video-renderer, ytd-rich-item-renderer');
  const title = (row?.querySelector('#video-title, h3, yt-formatted-string')?.textContent || a.textContent || '').trim().slice(0, 140);
  const channel = (row?.querySelector('#channel-name a, ytd-channel-name a')?.textContent || '').trim();
  const duration = (row?.querySelector('.badge-shape-wiz__text, ytd-thumbnail-overlay-time-status-renderer span')?.textContent || '').trim();
  out.push({ title: title || ('Video ' + id), channel, duration, url: 'https://www.youtube.com/watch?v=' + id });
  if (out.length >= limit) break;
}
return out;`, limit);
    if (results == null) {
        const title = await page.evaluate<string>(`return document.title;`).catch(() => '');
        throw new Error(`the results page loaded but could not be read${title ? ` (title: "${String(title).slice(0, 80)}")` : ''}`);
    }
    return results.slice(0, limit);
}

/** Read the player's real state — the ground truth for "is it playing".
 *  Reads the PLAYER's video (`#movie_player video`), not the first <video>.
 *  `advancing` is the honest signal — currentTime moving between two samples —
 *  because `paused` reads false during buffering and during an ad. */
async function playerState(page: McpPage): Promise<{ paused: boolean; title: string; url: string; at: string; ad: boolean } | null> {
    try {
        const read = () => page.evaluate(`const v = document.querySelector('#movie_player video') || document.querySelector('video');
if (!v) return null;
const fmt = (s) => { if (!Number.isFinite(s)) return '?'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); };
const h1 = document.querySelector('#title h1, h1.ytd-watch-metadata');
const player = document.querySelector('#movie_player');
return { paused: !!(v.paused || v.ended), t: v.currentTime, ad: !!player && String(player.className).includes('ad-showing'),
  title: ((h1 && h1.innerText) || document.title.replace(/\\s*-\\s*YouTube$/, '')).trim(),
  at: fmt(v.currentTime) + ' / ' + fmt(v.duration) };`);
        const a = await read() as any;
        if (!a) return null;
        const url = await page.url();
        if (a.paused) return { paused: true, title: a.title, at: a.at, ad: a.ad, url };
        // Not flagged paused — confirm it is actually moving before believing it.
        await page.waitForTimeout(400);
        const b = await read() as any;
        const advancing = !!b && !b.paused && b.t > a.t;
        return { paused: !advancing, title: (b || a).title, at: (b || a).at, ad: (b || a).ad, url };
    } catch { return null; }
}

/** Let it autoplay; only intervene when it demonstrably did not start.
 *  Never send a toggle — `video.play()` is idempotent, a keypress is not. */
async function ensurePlaying(page: McpPage): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
        const st = await playerState(page);
        if (st && !st.paused) return true;   // playing (or an ad is running) — leave it alone
        if (st && st.paused) break;          // confirmed stopped — fall through and start it
        await page.waitForTimeout(500);      // unreadable yet (still loading) — look again
    }
    // element.play() needs a user activation on some pages — a real key event
    // through the provider counts as one, so the keyboard is the escalation,
    // not media_control (that is MPRIS for desktop players, never this tab).
    for (let attempt = 0; attempt < 4; attempt++) {
        await page.evaluate(`const v = document.querySelector('#movie_player video') || document.querySelector('video');
if (v && v.paused) { try { v.play(); } catch (e) {} }`).catch(() => {});
        await page.waitForTimeout(800);
        let st = await playerState(page);
        if (st && !st.paused) return true;
        await page.pressKey('k');
        await page.waitForTimeout(900);
        st = await playerState(page);
        if (st && !st.paused) return true;
    }
    const st = await playerState(page);
    return !!st && !st.paused;
}

async function playYouTube(page: McpPage, tabs: Array<{ id?: number; url: string }> | null, target: string): Promise<string> {
    // Tab policy: ONE youtube tab. An existing tab is played into (a watch
    // page first); with none open, the first navigate creates the one tab and
    // the flow pins to it from the navigate reply.
    const watch = await findWatchPage(page, tabs);
    const player = watch || page;
    const wasUrl = await player.url();

    let url = toWatchUrl(target);
    let picked: Result | null = null;
    let alreadyHere = false;
    if (url) {
        // Exact video known — a repeat request is a no-op when it is already
        // playing, instead of a reload that restarts the song.
        alreadyHere = sameVideo(wasUrl, url);
        if (alreadyHere) {
            const cur = await playerState(player);
            if (cur && !cur.paused) {
                await player.bringToFront();
                return `Already playing: ${cur.title} (${cur.at})\n${cur.url}`;
            }
            // Already on the right video but paused — resume below, no reload.
        }
    } else {
        // ONE tab, always: the search happens in the same tab that plays the
        // pick. Changing the song pauses the old audio for the couple of
        // seconds the results page takes to load — the price of never
        // spawning a second YouTube tab (2026-09-19).
        const results = await runSearch(page, target, 5);
        if (results.length === 0) return `No YouTube results for "${target}".`;
        // The pick is a DECISION, not position 0: exclude what is playing and
        // what this seat recently played, then prefer titles that actually
        // carry the query's words (2026-09-19: it kept re-playing the same
        // first result).
        const qWords = new Set(target.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
        const recent = await recentPlayed(target);
        const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const candidates = results
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => {
                if (sameVideo(wasUrl, r.url)) return false;
                if (recentPicks.has(r.url)) return false;
                const id = /v=([\w-]{11})/.exec(r.url)?.[1];
                if (id && recent.ids.has(id)) return false;
                if (recent.titles.has(normTitle(r.title))) return false;
                return true;
            });
        const pool = candidates.length > 0 ? candidates : results.map((r, i) => ({ r, i }));
        log(`[youtube] pick pool: ${pool.length}/${results.length} after ${results.length - candidates.length} exclusions (marm+session)`);
        const parseDur = (d: string): number => {
            const p = String(d).trim().split(':').map(x => parseInt(x, 10));
            if (!p.length || p.some(isNaN)) return 0;
            return p.reduce((acc, v) => acc * 60 + v, 0);
        };
        const wantLong = /mix|live|hour|stream|compilation|set/i.test(target);
        const durScore = (r: Result): number => {
            const s = parseDur(r.duration);
            if (!s) return 0;
            if (s < 45) return -3;                    // teaser/short — never a song
            if (wantLong) return s >= 1200 ? 2 : 0;   // long ask → long video
            return s >= 90 && s <= 900 ? 2 : 0;       // song-ish window
        };
        pool.sort((a, b) => {
            const sa = [...qWords].filter(w => a.r.title.toLowerCase().includes(w)).length + durScore(a.r) - a.i * 0.1;
            const sb = [...qWords].filter(w => b.r.title.toLowerCase().includes(w)).length + durScore(b.r) - b.i * 0.1;
            return sb - sa;
        });
        picked = pool[0].r;
        recentPicks.delete(picked.url);
        recentPicks.add(picked.url);
        if (recentPicks.size > 8) {
            const first = recentPicks.values().next().value;
            if (first) recentPicks.delete(first);
        }
        url = picked.url;
        void logPlay(picked.url, picked.title);
    }
    if (!alreadyHere) {
        await player.goto(url);
    }
    await player.bringToFront();
    // YouTube autoplays. The job ends when the video is clicked — no
    // player-state polling: reading buffering/ad states as "autoplay blocked"
    // was always wrong and sent the model flailing after media_control
    // (2026-09-19).
    return `Playing: ${picked?.title || url}\n${url}`;
}

async function youtube(args: any): Promise<string> {
    const action = String(args?.action || '').trim();
    const target = String(args?.query || args?.url || '').trim();
    const { page, tabs } = await openBrowser();

    if (action === 'search') {
        if (!target) return "Error: 'query' is required for action 'search'.";
        const limit = Math.max(1, Math.min(10, Number(args?.limit) || 5));
        // Search in the ONE tab — no side tabs, ever.
        const results = await runSearch(page, target, limit);
        if (results.length === 0) return `No YouTube results for "${target}".`;
        return results
            .map((r, i) => `${i + 1}. ${r.title}${r.channel ? ` — ${r.channel}` : ''}${r.duration ? ` [${r.duration}]` : ''}\n   ${r.url}`)
            .join('\n');
    }

    if (action === 'play') {
        if (!target) return "Error: 'query' (what to play) or 'url' is required for action 'play'.";
        return await playYouTube(page, tabs, target);
    }

    // Everything below acts on the live player tab.
    const { page: player, onWatch } = await playerPage(page, tabs);
    if (!onWatch) return "No YouTube video is open — use action 'play' with what you want to watch.";

    if (action === 'now_playing') {
        const st = await playerState(player);
        if (!st) return 'A YouTube tab is open but has no video element.';
        return `${st.paused ? 'Paused' : 'Playing'}: ${st.title} (${st.at})\n${st.url}`;
    }

    if (action === 'pause' || action === 'resume') {
        if (action === 'resume') {
            const ok = await ensurePlaying(player);
            const st = await playerState(player);
            return ok ? `Resumed: ${st?.title || ''} (${st?.at || ''})` : 'The player would not resume (autoplay blocked).';
        }
        await player.evaluate(`const v = document.querySelector('#movie_player video') || document.querySelector('video');
if (v) { try { v.pause(); } catch (e) {} }`).catch(() => {});
        const st = await playerState(player);
        return `Paused: ${st?.title || ''} (${st?.at || ''})`;
    }

    if (action === 'next') {
        // "Next" = Shift+N (next playlist entry) — or, when that lands nowhere
        // (a single long mix has no playlist next), the first suggested video
        // in the sidebar. NEVER a search.
        const before = await playerState(player);
        const changed = (st: { title: string; url: string } | null) =>
            !!st && (!!before && (st.title !== before.title || st.url !== before.url));
        const had = await player.pressKey('Shift+N');
        if (had) {
            await player.waitForTimeout(2500);
            const st = await playerState(player);
            if (changed(st)) return `Playing: ${st!.title} (${st!.at})\n${st!.url}`;
        }
        // Shift+N landed nowhere: click the first suggested item (a mix/radio
        // first, then a plain suggested video).
        await player.evaluate(`const s = document.querySelector('ytd-compact-radio-renderer a#video-title, ytd-compact-video-renderer a#video-title'); if (s) s.click(); return !!s;`).catch(() => {});
        await player.waitForTimeout(2500);
        const st2 = await playerState(player);
        if (changed(st2)) return `Playing: ${st2!.title} (${st2!.at})\n${st2!.url}`;
        return `Could not advance — no playlist next and no suggested video found. ${st2 ? `Still: ${st2.title} (${st2.at})` : ''}`;
    }

    if (action === 'seek') {
        const secs = Number(args?.seconds);
        if (!Number.isFinite(secs) || secs < 0) return "Error: 'seconds' (a non-negative number) is required for action 'seek'.";
        await player.evaluate(`const v = document.querySelector('#movie_player video') || document.querySelector('video');
if (v) v.currentTime = JSON.parse(__arg);`, secs).catch(() => {});
        const st = await playerState(player);
        return `Seeked to ${st?.at || `${secs}s`} — ${st?.title || ''}`;
    }

    if (action === 'fullscreen') {
        await player.bringToFront();
        await player.evaluate(`const p = document.querySelector('#movie_player'); if (p) p.focus();`).catch(() => {});
        const had = await player.pressKey('f');
        if (!had) return 'The default browser provider exposes no key-press tool — fullscreen is not available through it.';
        const st = await playerState(player);
        return `Fullscreen toggled — ${st?.title || 'player'}.`;
    }

    return `Error: unknown action "${action}". Use search, play, pause, resume, next, seek, fullscreen, or now_playing.`;
}

registry.register({
    name: 'youtube',
    description: `YouTube. query = what a human types in the search box: artist/genre/song title only; "different"/"not X" is automatic — recently played is skipped for you. A play ask = ONE call. pause/resume/next/seek/now_playing. Other players → media_control.`,
    schema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['play', 'search', 'now_playing', 'pause', 'resume', 'next', 'seek', 'fullscreen'],
                description: 'What to do.',
            },
            query: { type: 'string', description: "What to play or search for, in the user's own words (e.g. 'chillstep mix'). Used by play and search." },
            url: { type: 'string', description: "A YouTube URL or 11-character video id, when you already have the exact video. Used by play." },
            limit: { type: 'number', description: "How many results to return for action 'search' (1-10, default 5)." },
            seconds: { type: 'number', description: "Position in seconds for action 'seek'." },
        },
        required: ['action'],
    },
    handler: async (args) => {
        try { return await youtube(args); } catch (e: any) { log(`youtube error: ${e.message}`); return `Error: ${e.message}`; }
    },
    toolset: 'youtube',
    tier: 'public',
});
