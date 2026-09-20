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

/** Run an upstream call; on a dead connection drop it and retry once fresh. */
async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const first = await getClient();
  try {
    return await fn(first);
  } catch (err) {
    dropClient();
    logger.warn({ err: String(err) }, '[browser-gate] upstream call failed — reconnecting');
    const second = await getClient();
    return fn(second);
  }
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
        jsonReply(res, id, { tools: r.tools });
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
