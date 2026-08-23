import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium, type Browser, type Page } from 'playwright-core';
import { log } from './ipc-helpers.js';

const CDP_PORT = parseInt(process.env.BROWSER_CDP_PORT || '9222', 10);

// Chrome's --remote-debugging-port may bind IPv4 (127.0.0.1) OR IPv6 (::1)
// ONLY — observed on this Wayland box: Chrome binds ::1 and REFUSES
// 127.0.0.1, so a connectOverCDP("http://127.0.0.1:9222") hits ECONNREFUSED
// and every browser_navigate silently fails (agent bails to raw curl). Probe
// both stacks and cache whichever answers, so we dial the right one.
const CDP_HOSTS = ['127.0.0.1', '[::1]'];
let cdpHost: string | null = null;

/** A working `http://<host>:<port>` base URL, or null if neither stack answers. */
async function cdpBase(timeoutMs = 1000): Promise<string | null> {
    if (cdpHost) {
        try {
            const r = await fetch(`http://${cdpHost}:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
            if (r.ok) return `http://${cdpHost}:${CDP_PORT}`;
        } catch { cdpHost = null; }
    }
    for (const h of CDP_HOSTS) {
        try {
            const r = await fetch(`http://${h}:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
            if (r.ok) { cdpHost = h; return `http://${h}:${CDP_PORT}`; }
        } catch { /* try the other stack */ }
    }
    return null;
}

// Chrome must attach to the user's live session even when the runner is
// started from systemd/scheduler contexts where these are unset.
const DISPLAY_ENV = {
    DISPLAY: process.env.DISPLAY || ':1',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000',
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus',
};

let browser: Browser | null = null;
let activePage: Page | null = null;

async function cdpUp(timeoutMs = 1000): Promise<boolean> {
    return (await cdpBase(timeoutMs)) !== null;
}

/** True if a Chrome process with the Warden profile is already running (CDP up or not). */
function wardenChromeProcessRunning(): boolean {
    try {
        const out = execSync(`pgrep -f "user-data-dir=.*playwright-jarvis" 2>/dev/null`, { encoding: 'utf8' }).trim();
        return out.length > 0;
    } catch {
        return false; // pgrep exits 1 when nothing matches
    }
}

/** Launch the Warden Chrome (persistent profile, CDP) if it is not already up. */
export async function ensureChrome(): Promise<void> {
    if (await cdpUp()) return;

    // If the Warden Chrome process is alive but CDP isn't answering yet (slow
    // start under GPU/IO load), WAIT for it — spawning again would hand off to
    // the running instance and open a fresh blank window every time (this is
    // how one "play a video" ask turned into a pile of tabs).
    if (wardenChromeProcessRunning()) {
        for (let i = 0; i < 75; i++) { // 15s
            await new Promise((r) => setTimeout(r, 200));
            if (await cdpUp(500)) return;
        }
        throw new Error(`Warden Chrome process is running but CDP never came up on :${CDP_PORT} (not respawning — refusing to pile up windows)`);
    }

    // Same profile the host watchdog launches Chrome with (src/index.ts) —
    // one persistent signed-in profile no matter which side started Chrome.
    const profileDir = path.join(os.homedir(), '.config', 'playwright-jarvis');
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* exists */ }

    const chromeArgs = [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        // Suppress the recurring "Verify it's you" Google-account sync re-auth
        // prompt. Disabling sync doesn't sign you out of sites (cookies persist);
        // it just stops Chrome from re-verifying the Google account for sync.
        '--disable-sync',
        '--disable-features=Translate,SyncSignin,SyncConsentDialog',
    ];
    if (process.env.BROWSER_HEADLESS === '1' || process.env.BROWSER_HEADLESS === 'true') {
        chromeArgs.push('--headless=new');
    }

    const candidates = process.env.BROWSER_BIN
        ? [process.env.BROWSER_BIN]
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chrome'];

    // spawn() does NOT throw for a missing binary — the failure arrives later as
    // an async 'error' event, which (with no listener) is an unhandled error
    // that crashes the whole runner process. Probe PATH first so we only spawn
    // binaries that exist, and attach an error handler so a surprise failure is
    // swallowed instead of killing the agent.
    const binExists = (bin: string): boolean => {
        const tryPath = (p: string): boolean => {
            try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
        };
        if (bin.includes('/')) return tryPath(bin);
        for (const dir of (process.env.PATH || '').split(path.delimiter)) {
            if (dir && tryPath(path.join(dir, bin))) return true;
        }
        return false;
    };

    let launched = false;
    for (const bin of candidates) {
        if (!binExists(bin)) continue;
        try {
            const ch = spawn(bin, chromeArgs, {
                cwd: process.cwd(),
                env: { ...process.env, ...DISPLAY_ENV },
                stdio: 'ignore',
                detached: true,
            });
            ch.on('error', (err) => {
                log(`browser: ${bin} failed to spawn after PATH check (${err.message}) — CDP wait will time out`);
            });
            ch.unref();
            launched = true;
            log(`browser: launched ${bin} with CDP on :${CDP_PORT}`);
            break;
        } catch { /* try next */ }
    }
    if (!launched) throw new Error('no Chrome/Chromium binary found to launch (set BROWSER_BIN to override)');

    for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await cdpUp(500)) return;
    }
    throw new Error(`Chrome launched but CDP never came up on :${CDP_PORT}`);
}

/** Connected Playwright Browser over the shared CDP endpoint. Chrome itself outlives the agent turn. */
export async function getBrowser(): Promise<Browser> {
    if (browser?.isConnected()) return browser;
    await ensureChrome();
    const base = await cdpBase(2000);
    if (!base) throw new Error(`CDP endpoint not reachable on :${CDP_PORT} (tried ${CDP_HOSTS.join(', ')} — Chrome not running or remote-debugging-port closed)`);
    browser = await chromium.connectOverCDP(base, { timeout: 10000 });
    browser.on('disconnected', () => {
        browser = null;
        activePage = null;
        cdpHost = null; // re-probe on next connect (Chrome may have rebound the other stack)
    });
    return browser;
}

function isUsable(p: Page | null): p is Page {
    return !!p && !p.isClosed();
}

/** The page the agent is currently working in. Falls back to the most recent open tab. */
export async function getPage(): Promise<Page> {
    const b = await getBrowser();
    if (isUsable(activePage)) return activePage;
    const context = b.contexts()[0] ?? (await b.newContext());
    const pages = context.pages().filter((p) => !p.isClosed());
    activePage = pages.length > 0 ? pages[pages.length - 1] : await context.newPage();
    return activePage;
}

export function setActivePage(p: Page): void {
    activePage = p;
}

export async function listPages(): Promise<Page[]> {
    const b = await getBrowser();
    return b.contexts().flatMap((c) => c.pages()).filter((p) => !p.isClosed());
}

const SNAPSHOT_MAX_CHARS = 25000;

/** Aria snapshot with [ref=eN] element refs, capped so a huge page can't flood the context. */
export async function snapshot(page: Page): Promise<string> {
    let title = '';
    try { title = await page.title(); } catch { /* navigating */ }
    const snap = await page.ariaSnapshot({ mode: 'ai', timeout: 10000 });
    const header = `Page: ${title || '(untitled)'}\nURL: ${page.url()}\n`;
    if (snap.length > SNAPSHOT_MAX_CHARS) {
        return `${header}${snap.slice(0, SNAPSHOT_MAX_CHARS)}\n[... snapshot truncated at ${SNAPSHOT_MAX_CHARS} chars — interact with the elements above or navigate/scroll to see more]`;
    }
    return header + snap;
}

/** Locator for a ref from a snapshot, e.g. "e12". */
export function refLocator(page: Page, ref: string) {
    return page.locator(`aria-ref=${ref}`);
}
