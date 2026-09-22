import http from 'http';
import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from './logger.js';
import { STORE_DIR } from './config.js';

// The ChromeMcpServer extension bridge ("browser-driving") serves streamable-
// HTTP MCP on 127.0.0.1:12306 but is a SINGLE-TRANSPORT server: the first
// client welds the slot shut until the bridge process restarts. Every runner
// session that connected at boot (or died mid-turn) bricked the slot for
// everyone after it — tools never loaded, and the default-app browser
// capability vanished. So the host owns the ONE upstream connection for its
// lifetime and re-serves it STATELESSLY at POST /mcp/browser: any number of
// clients (runner sessions, dash, anything) connect there; each request is
// answered over the shared upstream. The bridge never sees a second session.

const UPSTREAM_URL = process.env.BROWSER_MCP_UPSTREAM || 'http://127.0.0.1:12306/mcp';
const SESSION_FILE = path.join(STORE_DIR, 'browser-mcp.session');
const CALL_TIMEOUT_MS = 120_000;
// How long a forwarded request may wait for a healthy upstream before it is
// answered with a JSON-RPC error. Optional component: fail fast, don't hold.
const BRIDGE_WAIT_MS = 5_000;
const MAX_BODY = 1024 * 1024;

let client: Client | null = null;
let connecting: Promise<Client> | null = null;
let backoffMs = 1_000;
let lastSessionId = '';

function readPersistedSession(): string {
  try {
    return fs.readFileSync(SESSION_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function persistSession(id: string): void {
  lastSessionId = id;
  try {
    fs.writeFileSync(SESSION_FILE, id);
  } catch {
    /* best effort */
  }
}

/** Best-effort DELETE of a session we previously held, to free the single slot. */
async function reclaimStaleSession(): Promise<void> {
  const stale = lastSessionId || readPersistedSession();
  if (!stale) return;
  try {
    const res = await fetch(UPSTREAM_URL, {
      method: 'DELETE',
      headers: { 'mcp-session-id': stale },
      signal: AbortSignal.timeout(5_000),
    });
    logger.info({ status: res.status }, '[browser-gate] reclaim DELETE sent for held slot');
  } catch {
    /* bridge down or gone; the retry loop handles it */
  }
}

async function connectOnce(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(UPSTREAM_URL));
  const c = new Client({ name: 'warden-browser-gate', version: '1.0.0' });
  await c.connect(transport);
  persistSession(transport.sessionId || '');
  return c;
}

/** Long-lived keeper: connect, retrying with backoff until the bridge is back. */
async function getClient(): Promise<Client> {
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      for (;;) {
        try {
          await reclaimStaleSession();
          const c = await connectOnce();
          client = c;
          backoffMs = 1_000;
          logger.info({ upstream: UPSTREAM_URL }, '[browser-gate] pinned the browser-driving slot');
          return c;
        } catch (err) {
          logger.warn({ err: String(err), retry_in_ms: backoffMs }, '[browser-gate] upstream connect failed');
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      }
    })().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

function dropClient(): void {
  if (client) {
    try {
      client.close();
    } catch {
      /* already dead */
    }
  }
  client = null;
}

/** Run an upstream call; on a dead connection drop it and retry once fresh.
 *  The WAIT for a healthy upstream is bounded: the bridge is an optional
 *  component, and a down bridge must fail the request fast (JSON-RPC error)
 *  — never hold it open for the keeper's retry loop. The keeper keeps
 *  retrying in the background and pins the slot when the bridge returns. */
async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const first = await Promise.race([getClient(), unavailableAfter()]);
  try {
    return await fn(first);
  } catch (err) {
    dropClient();
    logger.warn({ err: String(err) }, '[browser-gate] upstream call failed — reconnecting');
    const second = await Promise.race([getClient(), unavailableAfter()]);
    return fn(second);
  }
}

/** Rejects after BRIDGE_WAIT_MS — bounds only the wait for a connected
 *  upstream, never the forwarded call itself (that keeps CALL_TIMEOUT_MS). */
function unavailableAfter(): Promise<never> {
  return new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`browser bridge unavailable: no upstream on ${UPSTREAM_URL} (extension/native host not running)`)),
      BRIDGE_WAIT_MS,
    ));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`upstream timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function jsonReply(res: http.ServerResponse, id: unknown, result: unknown): void;
function jsonReply(res: http.ServerResponse, id: unknown, result: undefined, errCode: number, message: string): void;
function jsonReply(res: http.ServerResponse, id: unknown, result: unknown, errCode?: number, message?: string): void {
  const body =
    errCode !== undefined
      ? { jsonrpc: '2.0', id, error: { code: errCode, message } }
      : { jsonrpc: '2.0', id, result };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Dense nested-JSON descriptions for the browser-driving tools — the seat
 *  that drives the browser is granite4.1:8b (Atlas, the orchestrator's hands),
 *  and granite reads structure, not prose: every tool and param description
 *  it consumes is a one-line JSON object, the same shape as the orchestrator
 *  prompt (agent-runner index.ts, "granite's preferred shape"). The upstream
 *  extension ships prose paragraphs — and prose is what made a seat pass
 *  newWindow:true for a plain "open Wikipedia" ask (2026-09-21) — so the gate
 *  rewrites every description before any consumer sees it. Facts only:
 *  what / vals / default / source / use_when. Nothing is stripped or forced;
 *  tools/call forwarding is untouched and every param still works.
 *
 *  Tool descriptions must stay ONE line ≤200 chars — the agent-runner clamps
 *  longer descriptions to their first non-empty line (stripTier), which would
 *  slice mid-JSON. Param descriptions ride at full length. */
const TOOL_JSON: Record<string, Record<string, unknown>> = {
  get_windows_and_tabs: { what: 'list every open window and tab', returns: 'windows:[{windowId,tabs:[{tabId,url,title}]}]', use_when: 'FIRST call of any browser task: match the task page by url, copy its tabId' },
  performance_start_trace: { what: 'start a performance trace on the active tab', reload: false, autoStop: false, durationMs: 'auto-stop ms, default 5000' },
  performance_stop_trace: { what: 'stop the active trace', saveToDownloads: true, filenamePrefix: 'optional' },
  performance_analyze_insight: { what: 'lightweight summary of the last recorded trace', insightName: 'informational only', timeoutMs: 60000 },
  chrome_read_page: { what: 'accessibility tree of visible page elements', use_when: 'find refs before click/type; pass the task tabId', fallback: 'fields missing → shadow DOM: chrome_javascript reaches them' },
  chrome_computer: { what: 'mouse+keyboard+screenshot on the page', click: 'find ref via chrome_read_page first', actions: 'click|scroll|type|key|fill|fill_form|hover|wait|screenshot|zoom|resize_page' },
  chrome_navigate: { what: 'navigate a tab to a URL; refresh; history back/forward', returns: 'tabId of the target tab — pass it in every later call', rule: 'existing tab default; a new one only when the user asks' },
  chrome_screenshot: { what: 'screenshot the page or one element', prefer: 'chrome_computer action=screenshot', to_see_page: 'storeBase64=true, savePng=false' },
  chrome_close_tabs: { what: 'close tabs', by: 'tabIds array, or url match', default: 'active tab' },
  chrome_switch_tab: { what: 'make one tab the active one', tabId: 'required' },
  chrome_get_web_content: { what: 'read a page as text or html', url: 'omit = active tab', textContent: true, htmlContent: false, selector: 'limit to one element' },
  chrome_network_request: { what: 'send an HTTP request with the browser cookies and session', method: 'GET default', body: 'for POST/PUT', timeout: 30000 },
  chrome_network_capture: { what: 'record the network traffic of a tab', action: 'start|stop', needResponseBody: false, url: 'omit = active tab' },
  chrome_handle_download: { what: 'wait for a download and return its details', filenameContains: 'filter', timeoutMs: 60000 },
  chrome_history: { what: 'search browsing history', text: 'query; empty = all in range', times: 'ISO dates or "2 weeks ago"', maxResults: 100, excludeCurrentTabs: false },
  chrome_bookmark_search: { what: 'search bookmarks by title and URL', query: 'empty = all', maxResults: 50 },
  chrome_bookmark_add: { what: 'add a bookmark', url: 'omit = active tab', parentId: 'folder path or id', createFolder: false },
  chrome_bookmark_delete: { what: 'delete a bookmark', by: 'bookmarkId, or url' },
  chrome_javascript: { what: 'run JS in a tab, return the value', use_when: 'form fields missing from read_page: reach into el.shadowRoot, set value, dispatch input event', code: 'async function body — return x; await ok' },
  chrome_click_element: { what: 'click an element', target: 'ref (from chrome_read_page) | selector | coordinates', tabId: 'pass the task tabId', miss: 'ref not found → re-read the page' },
  chrome_fill_or_select: { what: 'fill input/textarea/select/checkbox/radio', target: 'ref | selector', workflow: 'read_page refs → fill each field → click submit → verify', hidden: 'missing from the read → chrome_javascript' },
  chrome_request_element_selection: { what: 'ask the USER to click the element(s) — human fallback after ~3 failed targeting attempts', returns: 'refs usable by click/fill', timeoutMs: 180000 },
  chrome_keyboard: { what: 'keyboard input on a page: keys, combos, text', keys: '"Enter" | "Ctrl+C" | plain text', selector: 'optional target element', tabId: 'pass the task tabId on every call' },
  chrome_console: { what: 'read a tab console output', mode: 'snapshot (waits ~2s) | buffer (instant)', onlyErrors: false, pattern: 'regex filter' },
  chrome_upload_file: { what: 'put a local file into a file input', selector: 'input[type=file]', filePath: 'local path', tabId: 'omit = active tab' },
  chrome_handle_dialog: { what: 'answer a JS alert/confirm/prompt', action: 'accept|dismiss', promptText: 'for prompts' },
  chrome_gif_recorder: { what: 'record tab activity as an animated GIF', action: 'start|auto_start|stop|status|export', fps: 5, durationMs: 5000 },
};

/** Per-tool param descriptions, same nested-JSON shape. `tab` is the shared
 *  tabId description (2026-09-21): the browser is the user's REAL Chrome, and
 *  the "active tab" is whatever the human happens to be viewing — the seat
 *  treated "omit = active tab" as a license to fire tools untargeted, which
 *  scripted the user's own tab (the dashboard, ollama settings, anything)
 *  instead of the task page. So the rule now pins the task tab on every
 *  call, resolved once from chrome_navigate's reply or a url match in
 *  get_windows_and_tabs. */
const TAB_PARAM = { type: 'number', source: 'chrome_navigate reply (tabId) or get_windows_and_tabs (match the task page by url)', rule: 'resolve the task tab once, then pass it on EVERY call for that page — the human is usually viewing a different tab', ids: 'copy the value verbatim — real ids are large numbers; 0 or 1 are never valid ids', omit: 'the tab the human is currently viewing, usually the wrong page' };
const WIN_PARAM = { type: 'number', source: 'get_windows_and_tabs', use_when: 'picks the active tab of this window when tabId is omitted' };
const PARAM_JSON: Record<string, Record<string, unknown>> = {
  performance_start_trace: {
    reload: { type: 'boolean', default: false, effect: 'reload the page (ignore cache) once tracing started' },
    autoStop: { type: 'boolean', default: false },
    durationMs: { type: 'number', default: 5000, use_when: 'autoStop=true' },
  },
  performance_stop_trace: {
    saveToDownloads: { type: 'boolean', default: true },
    filenamePrefix: { type: 'string', use_for: 'downloaded trace JSON filename' },
  },
  performance_analyze_insight: {
    insightName: { type: 'string', note: 'informational only, e.g. "DocumentLatency"' },
    timeoutMs: { type: 'number', default: 60000, note: 'raise for large traces' },
  },
  chrome_navigate: {
    url: { type: 'string', special: '"back"|"forward" = history in the target tab' },
    newWindow: { type: 'boolean', default: false, use_when: 'user explicitly asks for a NEW window', otherwise: 'omit; to change an existing tab pass tabId' },
    tabId: { type: 'number', source: 'get_windows_and_tabs', use_when: 'navigating a tab the user already has open', rule: 'copy the value verbatim from its reply — real ids are large numbers; 0 or 1 are never valid ids', omit: 'the tab the human is currently viewing' },
    windowId: WIN_PARAM,
    background: { type: 'boolean', default: false, effect: 'does not activate the tab or focus the window' },
    width: { type: 'number', effect: 'creates a NEW window', use_when: 'user asks for a new window of a specific size (pass with height)', default: 'omit' },
    height: { type: 'number', effect: 'creates a NEW window', use_when: 'user asks for a new window of a specific size (pass with width)', default: 'omit' },
    refresh: { type: 'boolean', default: false, effect: 'reload the tab instead of navigating; url ignored' },
  },
  chrome_read_page: {
    filter: { type: 'string', vals: '"interactive" (buttons/links/inputs) | all', default: 'all visible elements' },
    depth: { type: 'number', default: 'full', effect: 'lower = smaller output' },
    refId: { type: 'string', source: 'a recent chrome_read_page reply in the same tab', effect: 'limits the tree to that subtree' },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
  },
  chrome_computer: {
    action: { type: 'string', vals: 'left_click | right_click | double_click | triple_click | left_click_drag | scroll | scroll_to | type | key | fill | fill_form | hover | wait | resize_page | zoom | screenshot' },
    ref: { type: 'string', source: 'chrome_read_page', use_when: 'click/scroll/type — preferred over coordinates' },
    coordinates: { type: 'array', format: '[x,y] in screenshot space (or viewport)', required_for: 'click/scroll without ref' },
    startCoordinates: { type: 'array', use_for: 'drag start point' },
    startRef: { type: 'string', source: 'chrome_read_page', use_for: 'drag start, alternative to startCoordinates' },
    scrollDirection: { type: 'string', vals: 'up | down | left | right' },
    scrollAmount: { type: 'number', default: 3, range: '1-10' },
    text: { type: 'string', use_for: 'action=type → the text; action=key → keys e.g. "Enter", "Control+a"' },
    repeat: { type: 'number', default: 1, range: '1-100', use_for: 'action=key repeats' },
    modifiers: { type: 'array', vals: 'Shift | Ctrl | Alt | Meta', use_for: 'click actions' },
    region: { type: 'string', format: '(x0,y0)-(x1,y1)', use_for: 'action=zoom' },
    selector: { type: 'string', use_for: 'action=fill — alternative to ref' },
    value: { type: 'string | boolean | number', use_for: 'action=fill' },
    elements: { type: 'array', format: '[{ref,value}]', use_for: 'action=fill_form' },
    width: { type: 'number', use_for: 'action=resize_page' },
    height: { type: 'number', use_for: 'action=resize_page' },
    appear: { type: 'boolean', default: true, use_for: 'action=wait with text: true = wait to appear' },
    timeout: { type: 'number', default: 10000, max: 120000, use_for: 'action=wait with text' },
    duration: { type: 'number', max: 30, use_for: 'action=wait, seconds' },
    tabId: TAB_PARAM,
    background: { type: 'boolean', default: false, effect: 'skips focusing the tab/window' },
  },
  chrome_screenshot: {
    storeBase64: { type: 'boolean', default: false, use_when: 'you want to SEE the page → true' },
    savePng: { type: 'boolean', default: true, use_when: 'seeing the page → false' },
    selector: { type: 'string', effect: 'screenshots only that element' },
    fullPage: { type: 'boolean', default: true },
    background: { type: 'boolean', default: false, note: 'element/full-page capture may still focus the tab' },
    width: { type: 'number', default: 800 },
    height: { type: 'number', default: 600 },
    name: { type: 'string', use_for: 'saved PNG filename' },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
  },
  chrome_close_tabs: {
    tabIds: { type: 'array', source: 'get_windows_and_tabs', rule: 'copy the values verbatim from its reply — real ids are large numbers; 0 or 1 are never valid ids', omit: 'the tab the human is currently viewing' },
    url: { type: 'string', effect: 'closes tabs matching this url instead', rule: 'the FULL url exactly as get_windows_and_tabs shows it — a bare domain matches nothing' },
  },
  chrome_switch_tab: {
    tabId: { type: 'number', source: 'get_windows_and_tabs', required: true, rule: 'copy the value verbatim from its reply — real ids are large numbers; 0 or 1 are never valid ids' },
    windowId: WIN_PARAM,
  },
  chrome_get_web_content: {
    url: { type: 'string', default: 'omit = active tab' },
    textContent: { type: 'boolean', default: true, effect: 'visible text with metadata; ignored when htmlContent=true' },
    htmlContent: { type: 'boolean', default: false, effect: 'visible HTML instead of text' },
    selector: { type: 'string', effect: 'content of only that element' },
    tabId: TAB_PARAM,
    background: { type: 'boolean', default: false, effect: 'does not focus the tab' },
  },
  chrome_network_request: {
    url: { type: 'string', required: true },
    method: { type: 'string', default: 'GET', vals: 'GET | POST | PUT | DELETE | …' },
    headers: { type: 'object', use_for: 'request headers' },
    body: { type: 'string', use_for: 'POST/PUT payload' },
    timeout: { type: 'number', default: 30000, unit: 'ms' },
    formData: { type: 'object', format: '{fields:{name:value},files:[{name,filename|path}]}', effect: 'overrides body; multipart with file attachments' },
  },
  chrome_network_capture: {
    action: { type: 'string', vals: 'start | stop', required: true },
    needResponseBody: { type: 'boolean', default: false, warning: 'true uses the Debugger API — may conflict with open DevTools' },
    url: { type: 'string', default: 'omit = active tab', use_for: 'action=start' },
    maxCaptureTime: { type: 'number', default: 180000, unit: 'ms' },
    inactivityTimeout: { type: 'number', default: 60000, unit: 'ms', note: '0 = disabled' },
    includeStatic: { type: 'boolean', default: false, effect: 'also images/scripts/styles' },
  },
  chrome_handle_download: {
    filenameContains: { type: 'string', effect: 'filter by substring in filename or url' },
    timeoutMs: { type: 'number', default: 60000, max: 300000 },
    waitForComplete: { type: 'boolean', default: true },
  },
  chrome_history: {
    text: { type: 'string', default: 'empty = all entries in the time range' },
    startTime: { type: 'string', format: 'ISO date, or "2 weeks ago"' },
    endTime: { type: 'string', format: 'ISO date, or "now"' },
    maxResults: { type: 'number', default: 100 },
    excludeCurrentTabs: { type: 'boolean', default: false, effect: 'hides urls already open' },
  },
  chrome_bookmark_search: {
    query: { type: 'string', default: 'empty = all bookmarks' },
    maxResults: { type: 'number', default: 50 },
    folderPath: { type: 'string', format: 'path ("Work/Projects") or folder id' },
  },
  chrome_bookmark_add: {
    url: { type: 'string', default: 'omit = active tab url' },
    title: { type: 'string', default: 'omit = page title' },
    parentId: { type: 'string', format: 'path ("Work/Projects") or folder id', default: 'Bookmarks Bar' },
    createFolder: { type: 'boolean', default: false, effect: 'creates the parent folder when missing' },
  },
  chrome_bookmark_delete: {
    bookmarkId: { type: 'string', note: 'bookmarkId or url is required' },
    url: { type: 'string', use_when: 'no bookmarkId' },
    title: { type: 'string', use_for: 'matching help when deleting by url' },
  },
  chrome_javascript: {
    code: { type: 'string', format: 'async function body — return x; top-level await works', required: true },
    tabId: TAB_PARAM,
    timeoutMs: { type: 'number', default: 15000 },
    maxOutputBytes: { type: 'number', default: 51200, note: 'longer output is truncated' },
  },
  chrome_click_element: {
    selector: { type: 'string', format: 'CSS or XPath', note: 'ref takes precedence' },
    selectorType: { type: 'string', default: 'css', vals: 'css | xpath' },
    ref: { type: 'string', source: 'chrome_read_page', precedence: 'over selector and coordinates' },
    coordinates: { type: 'array', format: '[x,y] viewport', use_when: 'no ref, no selector' },
    double: { type: 'boolean', default: false },
    button: { type: 'string', default: 'left', vals: 'left | right | middle' },
    modifiers: { type: 'array', vals: 'Shift | Ctrl | Alt | Meta' },
    waitForNavigation: { type: 'boolean', default: false },
    timeout: { type: 'number', default: 5000, use_for: 'waitForNavigation' },
    frameId: { type: 'number', use_for: 'elements inside an iframe' },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
  },
  chrome_fill_or_select: {
    selector: { type: 'string', format: 'CSS or XPath', note: 'ref takes precedence' },
    selectorType: { type: 'string', default: 'css', vals: 'css | xpath' },
    ref: { type: 'string', source: 'chrome_read_page' },
    value: { type: 'string | boolean | option', required: true },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
    frameId: { type: 'number', use_for: 'elements inside an iframe' },
  },
  chrome_request_element_selection: {
    requests: { type: 'array', format: 'one request = one element the user picks', required: true },
    timeoutMs: { type: 'number', default: 180000, max: 600000 },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
  },
  chrome_keyboard: {
    keys: { type: 'string', format: '"Enter" | "Ctrl+C" | "Hello World"', required: true },
    selector: { type: 'string', format: 'CSS or XPath', use_when: 'target one element; omit = focused element' },
    selectorType: { type: 'string', default: 'css', vals: 'css | xpath' },
    delay: { type: 'number', default: 50, unit: 'ms between keystrokes' },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
    frameId: { type: 'number', use_for: 'elements inside an iframe' },
  },
  chrome_console: {
    mode: { type: 'string', default: 'snapshot', vals: 'snapshot (waits ~2s) | buffer (instant, persistent per tab)' },
    url: { type: 'string', default: 'omit = active tab' },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
    background: { type: 'boolean', default: false },
    includeExceptions: { type: 'boolean', default: true },
    onlyErrors: { type: 'boolean', default: false },
    pattern: { type: 'string', format: 'regex, /pattern/flags' },
    limit: { type: 'number', note: 'max messages returned' },
    maxMessages: { type: 'number', default: 100, use_for: 'snapshot mode' },
    clear: { type: 'boolean', default: false, use_for: 'buffer mode: clear BEFORE reading' },
    clearAfterRead: { type: 'boolean', default: false, use_for: 'buffer mode: clear AFTER reading' },
    buffer: { type: 'boolean', default: false, effect: 'alias for mode="buffer"' },
  },
  chrome_upload_file: {
    selector: { type: 'string', format: 'CSS for the input[type=file] element', required: true },
    filePath: { type: 'string', format: 'local file path' },
    fileUrl: { type: 'string', use_when: 'download from this url first' },
    base64Data: { type: 'string', use_when: 'file content is inline base64' },
    fileName: { type: 'string', default: 'uploaded-file', use_for: 'base64/url uploads' },
    multiple: { type: 'boolean', default: false },
    tabId: TAB_PARAM,
    windowId: WIN_PARAM,
  },
  chrome_handle_dialog: {
    action: { type: 'string', vals: 'accept | dismiss', required: true },
    promptText: { type: 'string', use_for: 'answering a prompt dialog' },
  },
  chrome_gif_recorder: {
    action: { type: 'string', vals: 'start (fixed fps) | auto_start (frame per action) | stop | status | export', required: true },
    tabId: TAB_PARAM,
    fps: { type: 'number', default: 5, range: '1-30', use_for: 'fixed-fps mode' },
    durationMs: { type: 'number', default: 5000, max: 60000, use_for: 'fixed-fps mode' },
    maxFrames: { type: 'number', default: 50 },
    width: { type: 'number', default: 800, max: 1920 },
    height: { type: 'number', default: 600, max: 1080 },
    maxColors: { type: 'number', default: 256, note: 'lower = smaller file' },
    filename: { type: 'string', default: 'timestamped name' },
    captureDelayMs: { type: 'number', default: 150, use_for: 'auto mode: ms to wait after an action' },
    frameDelayCs: { type: 'number', default: 20, note: 'display ms per frame = value × 10' },
    annotation: { type: 'string', use_for: 'auto mode capture: label on the frame' },
    download: { type: 'boolean', default: true, use_for: 'export: true = save file, false = drag&drop upload' },
    enhancedRendering: { type: 'boolean', use_for: 'auto mode: overlays (click markers, drag paths)' },
    coordinates: { type: 'array', format: '[x,y]', use_for: 'export with download=false: drag&drop target' },
    ref: { type: 'string', source: 'chrome_read_page', use_for: 'export drag&drop target, alternative to coordinates/selector' },
    selector: { type: 'string', format: 'CSS', use_for: 'export drag&drop target element' },
  },
};

function patchBrowserSchema(tool: any): any {
  const toolJson = TOOL_JSON[tool?.name];
  if (toolJson) tool.description = JSON.stringify(toolJson);
  const params = PARAM_JSON[tool?.name];
  if (params) {
    const props = tool?.inputSchema?.properties;
    if (props) {
      for (const [key, json] of Object.entries(params)) {
        if (props[key]) props[key] = { ...props[key], description: JSON.stringify(json) };
      }
    }
  }
  return tool;
}

/** Stateless MCP endpoint: initialize is answered locally (no per-client
 *  sessions upstream); tools/list + tools/call forward over the shared slot. */
export async function handleBrowserMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'stateless endpoint — POST JSON-RPC' }));
    return;
  }
  if (req.method === 'DELETE') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8');
      if (data.length > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid JSON' }));
    return;
  }
  // Notifications get no response body — 202 and drop (nothing to forward).
  if (!msg || typeof msg !== 'object' || msg.id === undefined) {
    res.writeHead(202);
    res.end();
    return;
  }
  const id = msg.id;
  try {
    switch (msg.method) {
      case 'initialize': {
        const pv = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-03-26';
        jsonReply(res, id, {
          protocolVersion: pv,
          capabilities: { tools: {} },
          serverInfo: { name: 'warden-browser-driving', version: '1.0.0' },
        });
        return;
      }
      case 'ping':
        jsonReply(res, id, {});
        return;
      case 'tools/list': {
        const r = await withClient((c) => withTimeout(c.listTools(), CALL_TIMEOUT_MS));
        jsonReply(res, id, { tools: (r.tools || []).map(patchBrowserSchema) });
        return;
      }
      case 'tools/call': {
        const r = await withClient((c) => withTimeout(c.callTool(msg.params || {}), CALL_TIMEOUT_MS));
        jsonReply(res, id, r);
        return;
      }
      default:
        jsonReply(res, id, undefined, -32601, `method not supported by the browser gate: ${msg.method}`);
    }
  } catch (err) {
    jsonReply(res, id, undefined, -32000, String((err as Error)?.message || err));
  }
}

/** Kick the keeper at boot so the slot is pinned before anyone asks. */
export function startBrowserGate(): void {
  getClient().catch(() => {
    /* the loop keeps retrying; logged inside */
  });
}
