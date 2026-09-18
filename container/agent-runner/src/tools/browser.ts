import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { registry } from '../tool-registry.js';
import { log } from '../ipc-helpers.js';
import { getPage, listPages, setActivePage, snapshot, changedSnapshot, refLocator } from '../browser.js';
import { resolveUserPath } from '../ipc-helpers.js';

const ACTION_TIMEOUT = 10000;
// Client-side UI (menus, dialogs, live-filtered results) renders after the
// click handler returns; give it a beat so changedSnapshot sees it.
const ACTION_SETTLE_MS = 500;

// Same-URL re-navigation guard: when CDP hiccups, agents retry the identical
// navigate in a loop and every retry can open another tab in the user's
// browser. If the same URL was requested moments ago, reuse the page.
let lastNavUrl = '';
let lastNavAt = 0;

// Shadow-DOM helper prepended to every browser_evaluate. document.querySelector
// can't see inside web components (shadow roots) — Reddit's submit button lives
// in <shreddit-post-composer>'s shadow root, so plain querySelector returns
// null and the agent circles (atlas-jldr burned 40+ probes on this, 2026-09-17).
// __warden pierces shadow roots recursively so the agent can find/click those
// elements directly.
const SHADOW_HELPER = `(() => {
  // Re-define whenever the resident helper is stale (e.g. a page that still
  // carries the pre-setValue __warden from an earlier build) — otherwise new
  // methods never land on a page the agent has already touched.
  if (!window.__warden || !window.__warden.setValue) {
    const walk = (root, sel, out) => {
      try { root.querySelectorAll(sel).forEach(e => out.push(e)); } catch {}
      try { root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) walk(e.shadowRoot, sel, out); }); } catch {}
    };
    const qa = (sel) => { const out = []; walk(document, sel, out); return out; };
    window.__warden = {
      queryAll: (sel) => qa(sel),
      query: (sel) => qa(sel)[0] || null,
      byText: (txt) => qa('*').filter(e => !e.children.length && (e.textContent || '').toLowerCase().includes(String(txt).toLowerCase())),
      click: (sel) => { const el = qa(sel)[0]; if (!el) return 'no match for ' + sel; el.click(); return 'clicked ' + sel; },
      // React-controlled fill. Setting el.value = x directly does NOT stick
      // (React patches the instance setter and dedupes the change) — use the
      // prototype's NATIVE value setter + a bubbling input event instead, the
      // same technique browser-use ships. Handles input/textarea/contenteditable.
      setValue: (el, value) => {
        const text = String(value);
        if (!el) return 'no element';
        try {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, text);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.isContentEditable || (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''))) {
            el.focus();
            el.textContent = text;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          } else {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return 'set <' + el.tagName.toLowerCase() + '> to "' + text.slice(0, 40) + '"';
        } catch (e) { return 'setValue error: ' + e.message; }
      },
      // Click the CONTROL whose visible text matches (a web-component radio,
      // button, or option that the accessibility snapshot gave no ref for).
      clickByText: (txt) => {
        const t = String(txt).trim().toLowerCase();
        const all = qa('*');
        let best = null, bestScore = Infinity;
        for (const e of all) {
          const tc = (e.textContent || '').trim().toLowerCase();
          if (!tc || !tc.includes(t)) continue;
          const role = e.getAttribute && e.getAttribute('role');
          const clickable = /^(button|a|input|label|select|summary)$/i.test(e.tagName);
          // prefer the control (has role / clickable tag) and the shallowest subtree
          const score = (role || clickable ? 0 : 10000) + e.querySelectorAll('*').length;
          if (score < bestScore) { bestScore = score; best = e; }
        }
        if (!best) return 'no match for text "' + txt + '"';
        let el = best;
        while (el && el.parentElement) {
          const role = el.getAttribute && el.getAttribute('role');
          if (role || /^(button|a|input|label|select|summary)$/i.test(el.tagName)) break;
          el = el.parentElement;
        }
        el.click();
        return 'clicked <' + el.tagName.toLowerCase() + '> text "' + txt + '"';
      },
    };
  }
})();`;


// Shadow-DOM-piercing `document`, scoped to a single browser_evaluate. It
// shadows the global `document` (a `let` binding, so the page's own scripts —
// which read the real window.document — are untouched) and makes
// querySelector/querySelectorAll fall back to a recursive shadow-root walk when
// the light-DOM query returns nothing. This is the browser-use "pierce" step:
// without it, document.querySelector("button[type=submit]") returns null for a
// control that lives in <shreddit-post-composer>'s shadow root.
const SHADOW_DOC = `let document = (() => {
  const _doc = window.document;
  const _qs = _doc.querySelector.bind(_doc);
  const _qsa = _doc.querySelectorAll.bind(_doc);
  const pierceAll = (sel) => {
    const out = [];
    const walk = (root) => {
      try { root.querySelectorAll(sel).forEach((e) => out.push(e)); } catch {}
      try { root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot); }); } catch {}
    };
    walk(_doc);
    return out;
  };
  return new Proxy(_doc, {
    get(t, k) {
      if (k === 'querySelector') return (sel) => _qs(sel) || pierceAll(sel)[0] || null;
      if (k === 'querySelectorAll') return (sel) => { const l = _qsa(sel); return l.length ? l : pierceAll(sel); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
})();`;


/** True when two URLs point at the same page (same origin + pathname, trailing
 * slash and query/hash ignored) — used to detect "this page is already open in
 * a tab" so the agent reuses the visible tab instead of navigating a duplicate
 * background tab the user can't see. */
function samePageUrl(a: string, b: string): boolean {
    try {
        const A = new URL(a), B = new URL(b);
        if (A.origin !== B.origin) return false;
        const pa = A.pathname.replace(/\/+$/, '') || '/';
        const pb = B.pathname.replace(/\/+$/, '') || '/';
        return pa === pb;
    } catch {
        return a === b;
    }
}


registry.register({
    name: 'browser_navigate',
    description: 'Open a URL in the Warden Chrome (real Chrome, persistent profile — the user is already signed in to their accounts). Launches Chrome automatically if it is not running. Returns the page title, URL, and an accessibility snapshot with element refs like [ref=e12] that you pass to browser_click / browser_type. Accepts http(s):// URLs, file:// URLs, or a bare local path (e.g. /home/dominic/Warden/baben-sushi.html, ~/site/index.html, ./page.html) — a bare path is resolved to a file:// URL and opened IN the Warden Chrome itself (its persistent profile, no fresh "Welcome to Chrome" session), and the page is snapshotted so you can verify it. This is the right way to show the user a local HTML/PDF/image. Do NOT spawn a separate chrome/google-chrome-stable via Bash to open a local file — that creates a throwaway profile and a "sign in / welcome" screen. Only use open_app (xdg-open) for a local file you specifically want in its OS-default app rather than the browser.',
    schema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Full URL (https://youtube.com) or a local path (/abs/file.html, ~/rel.html, ./rel.html) — local paths open as file:// in the Warden Chrome.' },
        },
        required: ['url'],
    },
    handler: async (args) => {
        try {
            let url = String(args.url || '').trim();
            if (!url) return 'Error: url is required.';
            // Resolve a bare local path → file:// URL so local files open in the
            // Warden Chrome (persistent profile) instead of a fresh chrome
            // session launched via Bash/google-chrome-stable.
            if (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url)) {
                // already a URL — use as-is
            } else {
                let p = url;
                if (p === '~') p = process.env.HOME || '~';
                else if (p.startsWith('~/')) p = (process.env.HOME || '') + p.slice(1);
                const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
                url = pathToFileURL(abs).href;
            }
            // If the target page is ALREADY open in a tab (the user navigated
            // there, or an earlier step did), switch to that tab and bring it to
            // the front — the agent fills the tab the user is looking at, never
            // a duplicate background tab they can't see.
            const alreadyOpen = (await listPages()).find((p) => samePageUrl(p.url(), url));
            if (alreadyOpen) {
                setActivePage(alreadyOpen);
                await alreadyOpen.bringToFront().catch(() => {});
                return await snapshot(alreadyOpen);
            }
            const page = await getPage();
            if (url === lastNavUrl && Date.now() - lastNavAt < 15_000 && page.url() === url) {
                return await snapshot(page); // already there — don't reload/window again
            }
            lastNavUrl = url;
            lastNavAt = Date.now();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.bringToFront().catch(() => {});
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
    description: 'Click an element on the page by its snapshot ref. Returns the updated page snapshot when the click changes the page, or a "did not visibly change" note when it has no visible effect — that note means the click did nothing: switch approach (browser_evaluate, URL parameters, a different element) instead of repeating it.',
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
            await page.waitForTimeout(ACTION_SETTLE_MS);
            const fresh = await changedSnapshot(page);
            if (fresh !== null) return fresh;
            return `Clicked ${args.element || args.ref} — the page did not visibly change (same content as before the click). If you expected a menu, dialog, or navigation, it did not happen: change approach (browser_evaluate to toggle or extract, URL parameters, or a different element) instead of repeating this click. State-only changes (playback, volume) do not show in the snapshot — verify those with browser_evaluate.`;
        } catch (err: any) {
            return `Error clicking ${args.ref}: ${err.message}. Take a fresh browser_snapshot — refs go stale when the page changes.`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_type',
    description: 'Type text into a text field — an input, textarea, or rich-text editor (a contenteditable composer). Replaces the current value and works on shadow-DOM editors. Target the field with EITHER a snapshot ref, OR a stable selector/label. PREFER selector or label for any field you have already identified: snapshot refs go stale the moment the page re-renders, but a CSS selector like \'[aria-label="Post body text field"]\' or an accessible name like "Post body text field" keeps working, so you never have to re-snapshot and re-find the field.',
    schema: {
        type: 'object',
        properties: {
            ref: { type: 'string', description: 'Element ref from the snapshot, e.g. "e12". Volatile — use only immediately after a snapshot.' },
            selector: { type: 'string', description: 'CSS selector that uniquely matches the field, e.g. \'[aria-label="Post body text field"]\' or \'input[name="title"]\'. STABLE — preferred for a field you have already identified.' },
            label: { type: 'string', description: 'The field\'s accessible name / aria-label, e.g. "Post body text field" or "Title". Resolved to the matching field. STABLE.' },
            text: { type: 'string', description: 'Text to enter.' },
            submit: { type: 'boolean', description: 'Press Enter after typing (default false).' },
        },
        required: ['text'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            const loc = args.ref ? refLocator(page, String(args.ref))
                : args.selector ? page.locator(String(args.selector))
                : args.label ? page.getByLabel(String(args.label), { exact: false })
                : null;
            if (!loc) return 'No target given — pass ref, selector, or label.';
            const target = args.selector || args.label || args.ref;
            const urlBefore = page.url();
            // fill() handles <input>, <textarea>, AND [contenteditable] rich-text
            // editors: it focuses, clears, types, and fires the input event a
            // React-controlled composer (e.g. Reddit's title/body) needs to enable
            // submit. The old click+Ctrl+A+insertText path did NOT persist on
            // contenteditable and timed out — fill() persists.
            await loc.fill(String(args.text), { timeout: ACTION_TIMEOUT });
            // Read back the field's actual value and report it. The aria
            // snapshot does NOT show a filled textbox's value, so a follow-up
            // browser_snapshot makes the agent believe the fill failed ("I
            // typed but the body is empty") and it churns into browser_evaluate
            // DOM injection — which React/Lexical editors silently ignore. The
            // read-back is the verification the snapshot can't give.
            let val = '';
            try { val = await loc.inputValue(); } catch { try { val = (await loc.textContent()) || ''; } catch { /* read-back unavailable */ } }
            const confirm = val
                ? `Verified: the field now holds ${val.length} chars — "${val.slice(0, 80)}${val.length > 80 ? '…' : ''}".`
                : 'Warning: read-back was EMPTY — the field may not have committed the text (React/Lexical can ignore raw DOM writes). Do NOT retry the same way; take a browser_snapshot and act on a fresh ref/selector.';
            if (args.submit) {
                await loc.press('Enter', { timeout: ACTION_TIMEOUT });
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
                if (page.url() === urlBefore) {
                    return `Typed into ${target} and pressed Enter, but the page did NOT navigate (still on ${urlBefore}). Do not retry Enter — take a browser_snapshot, find the form's submit/search button, and browser_click it instead. ${confirm}`;
                }
                await page.waitForTimeout(ACTION_SETTLE_MS);
                return (await changedSnapshot(page)) ?? `Typed into ${target} and pressed Enter. ${confirm}`;
            }
            return `Typed into ${target}. ${confirm}`;
        } catch (err: any) {
            return `Error typing into ${args.selector || args.label || args.ref}: ${err.message}. Take a fresh browser_snapshot — refs go stale when the page changes.`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_press_key',
    description: 'Press a keyboard key in the browser page, e.g. "Enter", "Escape", "ArrowDown", "Control+a", "k" (YouTube play/pause). Pass ref to press the key ON a specific element (focuses it first) — without a ref the key goes to whatever happens to be focused, which may be nothing. Returns the updated snapshot when the page changes, or a "did not visibly change" note when it does not.',
    schema: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Key or combo in Playwright syntax, e.g. "Enter", "Control+a".' },
            ref: { type: 'string', description: 'Optional element ref from the snapshot to focus and press on, e.g. "e12".' },
        },
        required: ['key'],
    },
    handler: async (args) => {
        try {
            const page = await getPage();
            const key = String(args.key);
            if (args.ref) {
                const loc = refLocator(page, String(args.ref));
                await loc.press(key, { timeout: ACTION_TIMEOUT });
            } else {
                await page.keyboard.press(key);
            }
            await page.waitForTimeout(ACTION_SETTLE_MS);
            const fresh = await changedSnapshot(page);
            if (fresh !== null) return fresh;
            return `Pressed ${key}${args.ref ? ` on ${args.ref}` : ''} — the page did not visibly change. If you expected a menu or dialog to react, it did not: change approach instead of repeating this key. State-only changes (playback, volume) do not show in the snapshot — verify those with browser_evaluate.`;
        } catch (err: any) {
            return `Error pressing ${args.key}: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_select_option',
    description: 'Select an option in a <select> dropdown identified by its snapshot ref. Returns the updated snapshot when the page changes, or a "did not visibly change" note when the selection alone doesn\'t trigger anything (e.g. a filter that needs an Apply button).',
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
            await page.waitForTimeout(ACTION_SETTLE_MS);
            const fresh = await changedSnapshot(page);
            if (fresh !== null) return fresh;
            return `Selected "${args.value}" in ${args.ref} — the page did not visibly change (the selection alone triggered nothing; if the site needs an Apply/Update button, click it next).`;
        } catch (err: any) {
            return `Error selecting in ${args.ref}: ${err.message}`;
        }
    },
    toolset: 'browser',
    tier: 'public',
});

registry.register({
    name: 'browser_hover',
    description: 'Hover the mouse over an element by its snapshot ref (opens menus, reveals tooltips). Returns the updated snapshot showing whatever appeared.',
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
            await page.waitForTimeout(ACTION_SETTLE_MS);
            const fresh = await changedSnapshot(page);
            if (fresh !== null) return fresh;
            return `Hovered over ${args.ref} — nothing visibly appeared. If you expected a menu, it did not open: change approach instead of hovering again.`;
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
        const outPath = `/tmp/warden-browser-${Date.now()}.png`;
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
    description: 'Run JavaScript in the page and return the JSON-serialized result. Use for reading data the snapshot misses, dispatching events, or controlling media (e.g. document.querySelector("video").pause()). NOTE: document.querySelector now pierces shadow DOM automatically (web-component controls like Reddit\'s submit button are found even inside <shreddit-post-composer>\'s shadow root). To FILL a React-controlled field so it actually sticks, do NOT assign el.value = "..." directly — call window.__warden.setValue(el, "text"), which uses the native setter + input event (works on input, textarea, and contenteditable). Other helpers: window.__warden.query("button[type=submit]"), window.__warden.queryAll("button"), window.__warden.byText("Post"), window.__warden.click("button[type=submit]"), window.__warden.clickByText("Best Practices") (clicks a web-component radio/button/option by its visible text).',
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
            const result = await page.evaluate(`${SHADOW_HELPER}\n${SHADOW_DOC}\n${String(args.js)}`);
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

// ─── browser_download ─────────────────────────────────────────────────────
// Chrome's own download machinery, driven over CDP — the page's cookies and
// sign-in apply, no DOM extraction. Playwright contexts from connectOverCDP
// are created with acceptDownloads: false, so page.waitForEvent('download')
// never fires; the raw Browser.setDownloadBehavior + downloadWillBegin/
// downloadProgress events are the only working channel. Without this tool a
// "download the PDF this page offers" task had no owner: browser_click on a
// download link starts a download Chrome never reports back, so agents fished
// bytes out of the DOM with browser_evaluate (2026-09-15, atlas-m05y: 15
// iterations scraping Gmail's obfuscated selectors and nothing on disk).
registry.register({
    name: 'browser_download',
    description: "Save a file the browser offers — a PDF link, an export button, an email attachment card — to disk, and return the saved path. Give EITHER url (a direct file/download URL: Chrome navigates there and the download starts) OR ref (the snapshot ref of the download link/button on the CURRENT page). save_path is where to put the file: workspace-relative like 'data/work/report.pdf' or absolute; default is data/browser-downloads/<original filename>. This is the ONLY way to fetch a file a page offers — never fish file bytes out of the DOM with browser_evaluate.",
    schema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Direct download URL to navigate to (the page does not have to be open already).' },
            ref: { type: 'string', description: 'Snapshot ref of the download link/button on the current page, e.g. "e12".' },
            element: { type: 'string', description: 'Human-readable description of the element (for the log).' },
            save_path: { type: 'string', description: "Where to save: workspace-relative ('data/work/report.pdf') or absolute. A directory keeps the original filename; a full path renames the file." },
            timeout_seconds: { type: 'number', description: 'Max seconds to wait for the download to finish (default 90, max 300).' },
        },
        required: [],
    },
    handler: async (args) => {
        const url = String(args.url || '').trim();
        const ref = String(args.ref || '').trim();
        if (!url && !ref) return 'Error: give url (direct download URL) or ref (download element on the current page).';
        if (url && ref) return 'Error: give url OR ref, not both.';
        let page: any;
        let cdp: any;
        try {
            page = await getPage();
            // Stage the download next to the final destination; Chrome writes
            // there, then we move/rename into save_path. Same staging dir for
            // the default location keeps the move a no-op.
            let destDir: string, destName: string | null = null;
            if (args.save_path) {
                const resolved = resolveUserPath(String(args.save_path));
                if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                    destDir = resolved;
                } else {
                    destDir = path.dirname(resolved);
                    destName = path.basename(resolved);
                }
            } else {
                destDir = resolveUserPath('data/browser-downloads');
            }
            fs.mkdirSync(destDir, { recursive: true });

            cdp = await page.context().newCDPSession(page);
            await cdp.send('Browser.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: destDir,
                eventsEnabled: true,
            });

            let downloadGuid: string | null = null;
            let downloadName: string | null = null;
            let onDone: ((r: { ok: boolean; name?: string; error?: string }) => void) | null = null;
            const done = new Promise<{ ok: boolean; name?: string; error?: string }>((resolve) => { onDone = resolve; });
            cdp.on('Browser.downloadWillBegin', (ev: any) => {
                downloadGuid = ev.guid;
                downloadName = ev.suggestedFilename || `download-${Date.now()}`;
            });
            cdp.on('Browser.downloadProgress', (ev: any) => {
                if (downloadGuid && ev.guid !== downloadGuid) return; // another download we didn't ask for
                if (ev.state === 'completed' && onDone) onDone({ ok: true, name: downloadName || undefined });
                if (ev.state === 'canceled' && onDone) onDone({ ok: false, error: 'Chrome canceled the download (the host may have refused it or the session expired).' });
            });

            // Trigger. page.goto on a download URL aborts navigation on
            // purpose (net::ERR_ABORTED) while the download proceeds — that
            // error is expected, not a failure.
            if (ref) {
                await refLocator(page, ref).click({ timeout: ACTION_TIMEOUT });
            } else {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (err: any) {
                    // "Download is starting" is Playwright's success case over
                    // CDP (no Playwright download object, but Chrome proceeds);
                    // ERR_ABORTED is the raw equivalent. Both mean keep waiting
                    // for the CDP download events.
                    if (!/Download is starting|ERR_ABORTED|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(String(err?.message || ''))) throw err;
                }
            }

            const seconds = Math.min(Number(args.timeout_seconds) || 90, 300);
            const outcome = await Promise.race([
                done,
                new Promise<{ ok: false; error: string }>((resolve) =>
                    setTimeout(() => resolve({ ok: false, error: `No download finished within ${seconds}s — the link may not be a download, or the page needs another click first. Take a browser_snapshot and try the ref of the real download element.` }), seconds * 1000).unref?.()),
            ]);
            if (!outcome.ok) return `Error downloading: ${outcome.error}`;

            const savedName = outcome.name || downloadName || '';
            if (!savedName) return 'Error: download finished but Chrome reported no filename — check the destination directory.';
            let finalPath = path.join(destDir, savedName);
            if (!fs.existsSync(finalPath)) return `Error: Chrome reported the download complete, but ${finalPath} is not on disk.`;
            if (destName) {
                finalPath = path.join(destDir, destName);
                fs.renameSync(path.join(destDir, savedName), finalPath);
            }
            const size = fs.statSync(finalPath).size;
            return `Downloaded to ${finalPath} (${size} bytes). The file is on disk — use this path for any further work on it.`;
        } catch (err: any) {
            return `Error downloading: ${err.message}`;
        } finally {
            // Restore Chrome's normal download behavior (user downloads go
            // back to their usual folder with the UI) and drop the session.
            try { await cdp?.send('Browser.setDownloadBehavior', { behavior: 'default' }); } catch { /* browser may be gone */ }
            try { await cdp?.detach(); } catch { /* already detached */ }
        }
    },
    toolset: 'browser',
    tier: 'public',
});
