import { registry } from '../tool-registry.js';
import { getPage, listPages, setActivePage } from '../browser.js';
import { log } from '../ipc-helpers.js';
import type { Page } from 'playwright-core';

// YouTube toolchain (2026-09-18). Playing a video used to be hand-driven
// browser work — WebSearch for the watch URL, browser_navigate, then
// browser_evaluate("document.querySelector('video').play()") — three model
// rounds, each a chance to pick a search-results page instead of a watch URL
// or to report "playing" off a snapshot of a paused player. The orchestrator
// lost its web/browser tools on 2026-09-18, so this flow now lives with atlas;
// a flow that common deserves real tools rather than a prose recipe the model
// re-derives every time. One merged `youtube` tool, one call per intent:
// search → results, play → actually playing (verified against the <video>
// element, not a snapshot), plus the transport actions on the live tab.
//
// media_control/audio_volume (MPRIS, toolset `media`) still own pause/skip/
// volume for ANY player and stay shared with the orchestrator — this tool is
// the YouTube-specific half: finding the video and getting it started.

const WATCH_RE = /youtube\.com\/watch|youtu\.be\//i;

/** The tab already on a YouTube watch page, or null. */
async function findWatchPage(): Promise<Page | null> {
    try {
        const pages = await listPages();
        for (let i = pages.length - 1; i >= 0; i--) {
            if (WATCH_RE.test(pages[i].url())) return pages[i];
        }
    } catch { /* browser not up */ }
    return null;
}

/** The live player tab — the one already watching, else the agent's page. */
async function playerPage(): Promise<{ page: Page; onWatch: boolean }> {
    const watch = await findWatchPage();
    if (watch) return { page: watch, onWatch: true };
    return { page: await getPage(), onWatch: false };
}

/** The tab to put a video in. THE EXISTING YOUTUBE TAB WINS. getPage() alone
 *  opens a fresh tab per background job, so "play a new song" while one was
 *  already playing left two tabs playing at once and cost a second atlas job
 *  just to close the first (2026-09-18 12:03). One YouTube tab, reused: the
 *  new song replaces the old one the way it would for a person. */
async function watchTarget(): Promise<Page> {
    const watch = await findWatchPage();
    const page = watch ?? (await getPage());
    setActivePage(page); // claim it so the rest of this job stays in this tab
    return page;
}

/** Pause every OTHER YouTube tab, so starting a song can never leave two
 *  playing over each other. Pause, not close — a tab the user opened is
 *  theirs, and silence is all we need. */
async function pauseOtherPlayers(keep: Page): Promise<number> {
    let paused = 0;
    try {
        for (const p of await listPages()) {
            if (p === keep || !WATCH_RE.test(p.url())) continue;
            const wasPlaying = await p.evaluate(() => {
                const v = (document.querySelector('#movie_player video') || document.querySelector('video')) as HTMLVideoElement | null;
                if (!v || v.paused) return false;
                v.pause();
                return true;
            }).catch(() => false);
            if (wasPlaying) paused++;
        }
    } catch { /* browser not up */ }
    return paused;
}

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

/** Search results straight off the rendered results page (signed-in Chrome,
 *  so no consent wall). DOM, not ytInitialData: the rendered renderers are
 *  what the user would see, and they survive the shape changes that break
 *  ytInitialData paths. */
async function searchYouTube(query: string, limit: number): Promise<Result[]> {
    // Search in the tab that will show the result — no scratch tab. A scratch
    // tab opened a visible results page and then closed it, which read as
    // "opens a tab and closes it" (2026-09-18). Searching in place briefly
    // interrupts whatever is playing, but a new song or an explicit search is
    // replacing it anyway, and the tab never multiplies.
    const page = await watchTarget();
    return await runSearch(page, query, limit);
}

async function runSearch(page: Page, query: string, limit: number): Promise<Result[]> {
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });
    // Wait on a watch LINK, not on one renderer tag. YouTube ships results in
    // several components (`ytd-video-renderer`, the newer `yt-lockup-view-model`,
    // compact/shorts variants) and which one you get varies by rollout: waiting
    // for `ytd-video-renderer a#video-title` timed out after 15s on a page full
    // of results and killed the whole play (2026-09-18). Every variant contains
    // a /watch?v= anchor, so that is the thing that means "results are up".
    await page.waitForSelector('a[href*="/watch?v="]', { timeout: 20000 });
    return await page.evaluate((max: number) => {
        const out: Result[] = [];
        const seen = new Set<string>();
        const idOf = (href: string) => {
            const m = /[?&]v=([\w-]{11})/.exec(href);
            return m ? m[1] : '';
        };
        const isAdRow = (el: Element): boolean => {
            for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
                const tag = (n.tagName || '').toLowerCase();
                if (/ad-slot|promoted|in-feed-ad|ad-layout|companion-ad|display-ad/.test(tag)) return true;
                const id = (n.id || '').toLowerCase();
                if (id === 'player-ads' || id === 'masthead-ad') return true;
            }
            const badges = Array.from(el.querySelectorAll('ytd-badge-supported-renderer, [class*="badge" i], [aria-label]'));
            for (const b of badges) {
                const t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).trim().toLowerCase();
                if (/^(ad|ads|sponsored|promoted)\b/.test(t) || /\bsponsored\b/.test(t)) return true;
            }
            return false;
        };
        const push = (a: HTMLAnchorElement, scope: Element) => {
            if (out.length >= max) return;
            const href = a.href || '';
            const id = idOf(href);
            if (!id || seen.has(id)) return;
            // Never return a promoted result as "the video". Checking only the
            // row's own subtree was not enough: YouTube wraps promoted results
            // in an ANCESTOR ad container, so a sponsored row looked ordinary
            // from the inside and got played — 2026-09-18 "put on a lofi mix"
            // started a 15-second Brain.fm advert. Walk up for an ad container,
            // and read the row's badges by text rather than one fixed class
            // (the badge component has been renamed repeatedly).
            if (isAdRow(scope)) return;
            const channel = (scope.querySelector('ytd-channel-name #text, .yt-content-metadata-view-model__metadata-text') as HTMLElement | null)?.innerText || '';
            const duration = (scope.querySelector('ytd-thumbnail-overlay-time-status-renderer #text, .badge-shape__text, .ytThumbnailOverlayBadgeViewModelHost') as HTMLElement | null)?.innerText || '';
            const title = (a.getAttribute('title') || (scope.querySelector('#video-title, .yt-lockup-metadata-view-model__title') as HTMLElement | null)?.innerText || a.innerText || '').trim();
            if (!title) return;
            seen.add(id);
            out.push({ title, channel: channel.trim(), duration: duration.trim(), url: 'https://www.youtube.com/watch?v=' + id });
        };
        // Known result containers first — they carry channel + duration.
        const rows = Array.from(document.querySelectorAll(
            'ytd-video-renderer, yt-lockup-view-model, ytd-compact-video-renderer'));
        for (const el of rows) {
            const a = el.querySelector('a#video-title, a[href*="/watch?v="]') as HTMLAnchorElement | null;
            if (a) push(a, el);
            if (out.length >= max) break;
        }
        // Fallback: an unknown renderer shipped. Take the watch links in page
        // order — a title with no metadata still beats failing the whole play.
        if (out.length === 0) {
            for (const a of Array.from(document.querySelectorAll('a[href*="/watch?v="]')) as HTMLAnchorElement[]) {
                push(a, a.closest('div, li, section') || a);
                if (out.length >= max) break;
            }
        }
        return out;
    }, limit) as Result[];
}

/** Read the player's real state — the ground truth for "is it playing".
 *  Reads the PLAYER's video (`#movie_player video`), not the first <video> on
 *  the page: a results rail or a hover preview also matches a bare `video`
 *  selector, and their paused state has nothing to do with what is playing.
 *  `advancing` is the honest signal — currentTime moving between two samples —
 *  because `paused` reads false during buffering and during an ad. */
async function playerState(page: Page): Promise<{ paused: boolean; title: string; url: string; at: string; ad: boolean } | null> {
    try {
        const read = () => page.evaluate(() => {
            const v = (document.querySelector('#movie_player video') || document.querySelector('video')) as HTMLVideoElement | null;
            if (!v) return null;
            const fmt = (s: number) => {
                if (!Number.isFinite(s)) return '?';
                const m = Math.floor(s / 60), r = Math.floor(s % 60);
                return `${m}:${String(r).padStart(2, '0')}`;
            };
            const h1 = document.querySelector('#title h1, h1.ytd-watch-metadata') as HTMLElement | null;
            const player = document.querySelector('#movie_player');
            return {
                paused: v.paused || v.ended,
                t: v.currentTime,
                ad: !!player && player.className.includes('ad-showing'),
                title: (h1?.innerText || document.title.replace(/\s*-\s*YouTube$/, '')).trim(),
                at: `${fmt(v.currentTime)} / ${fmt(v.duration)}`,
            };
        });
        const a = await read();
        if (!a) return null;
        if (a.paused) return { paused: true, title: a.title, at: a.at, ad: a.ad, url: page.url() };
        // Not flagged paused — confirm it is actually moving before believing it.
        await page.waitForTimeout(400);
        const b = await read();
        const advancing = !!b && !b.paused && b.t > a.t;
        return { paused: !advancing, title: (b || a).title, at: (b || a).at, ad: (b || a).ad, url: page.url() };
    } catch { return null; }
}

/** Let it autoplay; only intervene when it demonstrably did not start.
 *
 *  YouTube autoplays in the user's real signed-in Chrome — the overwhelmingly
 *  common case is that the video is already running by the time we look, and
 *  the right action is NOTHING. The old version pressed 'k' whenever it could
 *  not read a playing state, and 'k' is YouTube's play/pause TOGGLE: an
 *  unreadable read, a buffering moment or an ad was enough to make it pause
 *  the video it had just started. So: wait for it to start on its own, act
 *  only on a confirmed pause, and never send a toggle — `video.play()` is
 *  idempotent, a keypress is not. */
async function ensurePlaying(page: Page): Promise<boolean> {
    // Give autoplay a chance before touching anything.
    for (let i = 0; i < 6; i++) {
        const st = await playerState(page);
        if (st && !st.paused) return true;   // playing (or an ad is running) — leave it alone
        if (st && st.paused) break;          // confirmed stopped — fall through and start it
        await page.waitForTimeout(500);      // unreadable yet (still loading) — look again
    }
    // Confirmed paused: start it directly. play() on an already-playing video
    // is a no-op, so this can never stop anything.
    for (let attempt = 0; attempt < 3; attempt++) {
        await page.evaluate(() => {
            const v = (document.querySelector('#movie_player video') || document.querySelector('video')) as HTMLVideoElement | null;
            if (v && v.paused) void v.play();
        }).catch(() => {});
        await page.waitForTimeout(800);
        const st = await playerState(page);
        if (st && !st.paused) return true;
    }
    const st = await playerState(page);
    return !!st && !st.paused;
}

async function playYouTube(target: string): Promise<string> {
    // Claim the one YouTube tab up front and hold it for the whole job — the
    // query search below runs in THIS tab, so no scratch tab opens and closes,
    // and no second tab ever appears.
    const page = await watchTarget();
    const wasUrl = page.url();

    let url = toWatchUrl(target);
    let picked: Result | null = null;
    let alreadyHere = false;
    if (url) {
        // Exact video known — a repeat request is a no-op when it is already
        // playing, instead of a reload that restarts the song.
        alreadyHere = sameVideo(wasUrl, url);
        if (alreadyHere) {
            const cur = await playerState(page);
            if (cur && !cur.paused) {
                await page.bringToFront().catch(() => {});
                return `Already playing: ${cur.title} (${cur.at})\n${cur.url}`;
            }
            // Already on the right video but paused — resume below, no reload.
        }
    } else {
        const results = await runSearch(page, target, 5);
        if (results.length === 0) return `No YouTube results for "${target}".`;
        // "Change the song" arrives as a QUERY, not a video id, and the same
        // query returns the same top result — the one already playing. Taking
        // results[0] blindly re-navigated to the current video, which reloads
        // it and reads as "it just refreshes, the song never changes"
        // (2026-09-18: "Best of lofi 2018" re-picked at 89:11). If the top hit
        // is what is playing right now, take the next distinct result.
        picked = results.find(r => !sameVideo(wasUrl, r.url)) || results[0];
        url = picked.url;
    }
    if (!alreadyHere) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await page.waitForSelector('video', { timeout: 20000 }).catch(() => {});
    await page.bringToFront().catch(() => {});
    const silenced = await pauseOtherPlayers(page);
    const playing = await ensurePlaying(page);
    const st = await playerState(page);
    const name = st?.title || picked?.title || url;
    if (!st) return `Opened ${url} but found no video element on the page — it may be a playlist or channel page, not a watch page.`;
    const note = silenced > 0 ? ` (paused ${silenced} other YouTube tab${silenced === 1 ? '' : 's'})` : '';
    return playing
        ? `Playing: ${name}${picked?.channel ? ` — ${picked.channel}` : ''} (${st.at})${note}\n${st.url}`
        : `Opened ${name} but the player is still paused (autoplay blocked). The tab is in front — media_control('play') or a click on the player will start it.\n${st.url}`;
}

async function youtube(args: any): Promise<string> {
    const action = String(args?.action || '').trim();
    const target = String(args?.query || args?.url || '').trim();

    if (action === 'search') {
        if (!target) return "Error: 'query' is required for action 'search'.";
        const limit = Math.max(1, Math.min(10, Number(args?.limit) || 5));
        const results = await searchYouTube(target, limit);
        if (results.length === 0) return `No YouTube results for "${target}".`;
        return results
            .map((r, i) => `${i + 1}. ${r.title}${r.channel ? ` — ${r.channel}` : ''}${r.duration ? ` [${r.duration}]` : ''}\n   ${r.url}`)
            .join('\n');
    }

    if (action === 'play') {
        if (!target) return "Error: 'query' (what to play) or 'url' is required for action 'play'.";
        return await playYouTube(target);
    }

    // Everything below acts on the live player tab.
    const { page, onWatch } = await playerPage();
    if (!onWatch) return "No YouTube video is open — use action 'play' with what you want to watch.";

    if (action === 'now_playing') {
        const st = await playerState(page);
        if (!st) return 'A YouTube tab is open but has no video element.';
        return `${st.paused ? 'Paused' : 'Playing'}: ${st.title} (${st.at})\n${st.url}`;
    }

    if (action === 'pause' || action === 'resume') {
        if (action === 'resume') {
            const ok = await ensurePlaying(page);
            const st = await playerState(page);
            return ok ? `Resumed: ${st?.title || ''} (${st?.at || ''})` : 'The player would not resume (autoplay blocked).';
        }
        await page.evaluate(() => ((document.querySelector('#movie_player video') || document.querySelector('video')) as HTMLVideoElement | null)?.pause()).catch(() => {});
        const st = await playerState(page);
        return `Paused: ${st?.title || ''} (${st?.at || ''})`;
    }

    if (action === 'next') {
        await page.evaluate(() => (document.querySelector('#movie_player') as HTMLElement | null)?.focus()).catch(() => {});
        await page.keyboard.press('Shift+N').catch(() => {});
        await page.waitForTimeout(2500);
        const st = await playerState(page);
        return st
            ? `${st.paused ? 'Queued' : 'Playing'}: ${st.title} (${st.at})\n${st.url}`
            : 'Pressed next but could not read the player.';
    }

    if (action === 'seek') {
        const secs = Number(args?.seconds);
        if (!Number.isFinite(secs) || secs < 0) return "Error: 'seconds' (a non-negative number) is required for action 'seek'.";
        await page.evaluate((s: number) => {
            const v = (document.querySelector('#movie_player video') || document.querySelector('video')) as HTMLVideoElement | null;
            if (v) v.currentTime = s;
        }, secs).catch(() => {});
        const st = await playerState(page);
        return `Seeked to ${st?.at || `${secs}s`} — ${st?.title || ''}`;
    }

    if (action === 'fullscreen') {
        await page.bringToFront().catch(() => {});
        await page.evaluate(() => (document.querySelector('#movie_player') as HTMLElement | null)?.focus()).catch(() => {});
        await page.keyboard.press('f').catch(() => {});
        const st = await playerState(page);
        return `Fullscreen toggled — ${st?.title || 'player'}.`;
    }

    return `Error: unknown action "${action}". Use search, play, pause, resume, next, seek, fullscreen, or now_playing.`;
}

registry.register({
    name: 'youtube',
    description: "Play and control YouTube in the user's real Chrome — music, a song, a track, a mix, a video: play it, pause it, skip to the next one, change what is playing. action 'play' takes what they asked for as `query` (or a URL/video id as `url`), finds the video, plays it IN THE YOUTUBE TAB THAT IS ALREADY OPEN (replacing whatever was playing, and pausing any other YouTube tab) or opens one if there is none, and confirms playback from the <video> element itself — one call for \"play X on youtube\", no search-then-navigate-then-evaluate dance, and no tab cleanup afterwards: switching songs never leaves a second tab playing. Other actions: 'search' (query → ranked results with channel + duration, when they want to choose), 'now_playing', 'pause', 'resume', 'next' (next video), 'seek' (seconds), 'fullscreen'. The result text IS the confirmation — never screenshot to check. For a non-YouTube player (Spotify, mpv, VLC) or the system volume, use media_control / audio_volume instead.",
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
