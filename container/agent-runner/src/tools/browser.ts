import fs from 'fs';
import { registry } from '../tool-registry.js';
import { log } from '../ipc-helpers.js';
import { getPage, listPages, setActivePage, snapshot, refLocator } from '../browser.js';

const ACTION_TIMEOUT = 10000;

registry.register({
    name: 'browser_navigate',
    description: 'Open a URL in the Prometheus Chrome (real Chrome, persistent profile — the user is already signed in to their accounts). Launches Chrome automatically if it is not running. Returns the page title, URL, and an accessibility snapshot with element refs like [ref=e12] that you pass to browser_click / browser_type.',
    schema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Full URL to open (e.g. https://youtube.com).' },
        },
        required: ['url'],
    },
    handler: async (args) => {
        try {
            const url = String(args.url || '').trim();
            if (!url) return 'Error: url is required.';
            if (!/^https?:\/\//i.test(url)) return 'Error: url must start with http:// or https://';
            const page = await getPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return await snapshot(page);
        } catch (err: any) {
            return `Error navigating: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_snapshot',
    description: 'Read the current page as an accessibility snapshot (text outline of every visible element with refs like [ref=e12]). This is the primary way to SEE a page — much cheaper and more precise than a screenshot. Use the refs with browser_click / browser_type / browser_select_option.',
    schema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        try {
            const page = await getPage();
            return await snapshot(page);
        } catch (err: any) {
            return `Error taking snapshot: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_click',
    description: 'Click an element on the page by its snapshot ref.',
    schema: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'Element ref from the snapshot, e.g. "e12".' },
            element: { type: 'string', description: 'Human-readable description of the element (for the log).' },
            double: { type: 'boolean', description: 'Double-click (default false).' },
        },
        required: ['ref'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            const loc = refLocator(page, String(args.ref));
            if (args.double) await loc.dblclick({ timeout: ACTION_TIMEOUT });
            else await loc.click({ timeout: ACTION_TIMEOUT });
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            return `Clicked ${args.element || args.ref}. Now on: ${await page.title().catch(() => '(untitled)')} — ${page.url()}. Call browser_snapshot to read the updated page.`;
        } catch (err: any) {
            return `Error clicking ${args.ref}: ${err.message}. Take a fresh browser_snapshot — refs go stale when the page changes.`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_type',
    description: 'Type text into an input/textarea identified by its snapshot ref. Replaces the current value.',
    schema: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'Element ref from the snapshot, e.g. "e12".' },
            text: { type: 'string', description: 'Text to enter.' },
            submit: { type: 'boolean', description: 'Press Enter after typing (default false).' },
        },
        required: ['ref', 'text'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            const loc = refLocator(page, String(args.ref));
            await loc.fill(String(args.text), { timeout: ACTION_TIMEOUT });
            if (args.submit) {
                await loc.press('Enter', { timeout: ACTION_TIMEOUT });
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            }
            return `Typed into ${args.ref}${args.submit ? ' and pressed Enter' : ''}. Call browser_snapshot to read the updated page.`;
        } catch (err: any) {
            return `Error typing into ${args.ref}: ${err.message}. Take a fresh browser_snapshot — refs go stale when the page changes.`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_press_key',
    description: 'Press a keyboard key in the browser page, e.g. "Enter", "Escape", "ArrowDown", "Control+a", "k" (YouTube play/pause).',
    schema: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Key or combo in Playwright syntax, e.g. "Enter", "Control+a".' },
        },
        required: ['key'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            await page.keyboard.press(String(args.key));
            return `Pressed ${args.key}.`;
        } catch (err: any) {
            return `Error pressing ${args.key}: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_select_option',
    description: 'Select an option in a <select> dropdown identified by its snapshot ref.',
    schema: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'Element ref from the snapshot, e.g. "e12".' },
            value: { type: 'string', description: 'Option value or visible label to select.' },
        },
        required: ['ref', 'value'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            const loc = refLocator(page, String(args.ref));
            try {
                await loc.selectOption(String(args.value), { timeout: ACTION_TIMEOUT });
            } catch {
                await loc.selectOption({ label: String(args.value) }, { timeout: ACTION_TIMEOUT });
            }
            return `Selected "${args.value}" in ${args.ref}.`;
        } catch (err: any) {
            return `Error selecting in ${args.ref}: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_hover',
    description: 'Hover the mouse over an element by its snapshot ref (opens menus, reveals tooltips).',
    schema: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'Element ref from the snapshot, e.g. "e12".' },
        },
        required: ['ref'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            await refLocator(page, String(args.ref)).hover({ timeout: ACTION_TIMEOUT });
            return `Hovering over ${args.ref}. Call browser_snapshot to see what appeared.`;
        } catch (err: any) {
            return `Error hovering ${args.ref}: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_screenshot',
    description: 'Screenshot the current browser page. The image is loaded into your vision context immediately — use it to verify visual end states (video playing, form submitted). For READING page content, prefer browser_snapshot.',
    schema: {
        type: 'object',
        properties: {
            full_page: { type: 'boolean', description: 'Capture the full scrollable page instead of the viewport (default false).' },
        },
        required: [],
    },
    handler: async (args) => {
        const outPath = `/tmp/prometheus-browser-${Date.now()}.png`;
        try {
            const page = await getPage();
            const buf = await page.screenshot({ type: 'png', fullPage: !!args.full_page, timeout: ACTION_TIMEOUT });
            try { fs.writeFileSync(outPath, buf); } catch { /* vision path below is what matters */ }
            if (!(globalThis as any)._pendingImages) (globalThis as any)._pendingImages = [];
            (globalThis as any)._pendingImages.push(buf.toString('base64'));
            log(`browser_screenshot: queued ${outPath} for vision`);
            return `Screenshot of ${page.url()} taken. The image is now in your vision context — describe what you see to verify the page state.`;
        } catch (err: any) {
            return `Error taking screenshot: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_evaluate',
    description: 'Run JavaScript in the page and return the JSON-serialized result. Use for reading data the snapshot misses, dispatching events, or controlling media (e.g. document.querySelector("video").pause()).',
    schema: {
        type: 'object',
        properties: {
            js: { type: 'string', description: 'JavaScript expression or IIFE to evaluate in the page.' },
        },
        required: ['js'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            const result = await page.evaluate(String(args.js));
            const text = result === undefined ? 'undefined' : JSON.stringify(result);
            return text.length > 10000 ? text.slice(0, 10000) + '\n[... result truncated at 10000 chars]' : text;
        } catch (err: any) {
            return `Error evaluating JS: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_wait_for',
    description: 'Wait for text to appear on the page, or for a fixed number of seconds. Use after actions that trigger slow loads.',
    schema: {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'Wait until this text is visible on the page.' },
            seconds: { type: 'number', description: 'Or wait this many seconds (max 30).' },
        },
        required: [],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            if (args.text) {
                await page.getByText(String(args.text)).first().waitFor({ state: 'visible', timeout: 30000 });
                return `"${args.text}" is now visible.`;
            }
            if (args.seconds) {
                const s = Math.min(Number(args.seconds), 30);
                await page.waitForTimeout(s * 1000);
                return `Waited ${s}s.`;
            }
            return 'Error: provide text or seconds.';
        } catch (err: any) {
            return `Error waiting: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_tabs',
    description: 'Manage browser tabs: list them, switch the active tab, open a new one, or close one.',
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['list', 'select', 'new', 'close'], description: 'What to do.' },
            index: { type: 'number', description: 'Tab index from list (required for select/close).' },
        },
        required: ['action'],
    },
    handler: async (args) => {
        try {
            const pages = await listPages();
            const current = await getPage();
            if (args.action === 'list') {
                if (pages.length === 0) return 'No open tabs.';
                const lines = await Promise.all(pages.map(async (p, i) =>
                    `${i}: ${p === current ? '[active] ' : ''}${await p.title().catch(() => '(untitled)')} — ${p.url()}`));
                return lines.join('\n');
            }
            if (args.action === 'new') {
                const context = current.context();
                const p = await context.newPage();
                setActivePage(p);
                return `Opened new tab (index ${pages.length}). Use browser_navigate to load a URL.`;
            }
            const idx = Number(args.index);
            if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) {
                return `Error: index must be 0..${pages.length - 1} (use browser_tabs list).`;
            }
            if (args.action === 'select') {
                setActivePage(pages[idx]);
                await pages[idx].bringToFront().catch(() => {});
                return `Switched to tab ${idx}: ${await pages[idx].title().catch(() => '(untitled)')} — ${pages[idx].url()}`;
            }
            if (args.action === 'close') {
                await pages[idx].close();
                return `Closed tab ${idx}.`;
            }
            return 'Error: action must be list, select, new, or close.';
        } catch (err: any) {
            return `Error managing tabs: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_back',
    description: 'Go back to the previous page in the active tab.',
    schema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        try {
            const page = await getPage();
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
            return `Went back to: ${await page.title().catch(() => '(untitled)')} — ${page.url()}`;
        } catch (err: any) {
            return `Error going back: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_current_url',
    description: 'Read the URL and title of the page the user is currently viewing in the browser. Use this when the user asks "what page am I on" or refers to "this page" without naming a URL.',
    schema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        try {
            const page = await getPage();
            return `${await page.title().catch(() => '(untitled)')}\n${page.url()}`;
        } catch (err: any) {
            return `Error reading browser URL: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});
