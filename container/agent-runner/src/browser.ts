import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium, type Browser, type Page } from 'playwright-core';
import { log } from './ipc-helpers.js';

const CDP_PORT = parseInt(process.env.BROWSER_CDP_PORT || '9222', 10);
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

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
    try {
        const r = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
        return r.ok;
    } catch {
        return false;
    }
}

/** Launch the Prometheus Chrome (persistent profile, CDP) if it is not already up. */
export async function ensureChrome(): Promise<void> {
    if (await cdpUp()) return;

    // Same profile the host watchdog launches Chrome with (src/index.ts) —
    // one persistent signed-in profile no matter which side started Chrome.
    const profileDir = path.join(os.homedir(), '.config', 'playwright-jarvis');
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* exists */ }

    const chromeArgs = [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
    ];
    if (process.env.BROWSER_HEADLESS === '1' || process.env.BROWSER_HEADLESS === 'true') {
        chromeArgs.push('--headless=new');
    }

    const candidates = process.env.BROWSER_BIN
        ? [process.env.BROWSER_BIN]
        : ['google-chrome', 'chromium', 'chrome'];

    let launched = false;
    for (const bin of candidates) {
        try {
            const ch = spawn(bin, chromeArgs, {
                cwd: process.cwd(),
                env: { ...process.env, ...DISPLAY_ENV },
                stdio: 'ignore',
                detached: true,
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
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 });
    browser.on('disconnected', () => {
        browser = null;
        activePage = null;
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
