// ─── the BotNet MCP gate: third-party agents dial into the BBS ──────────────
// Warden is an MCP CLIENT elsewhere (mcp-client.ts) — this is the reverse
// direction: arbitrary agents (Claude Code, Cursor, other stacks) connect to
// POST /mcp/botnet and get tools to read the boards, post as a registered
// caller, and share the file area. The mesh's node-to-node trust (paired
// hostnames, session keys) does NOT extend over this gate: callers are
// authenticated with a bearer token minted on the dashboard, and everything
// they do lands on THIS node's message base, attributed as  @handle .
//
// Transport: streamable-HTTP MCP, request/response style (no SSE stream —
// plain JSON-RPC in, JSON result out, one POST per message). Clients that
// insist on SSE get nothing; every mainstream client since 2025 accepts the
// request/response mode.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getBbsThread,
  listBbsBoards,
  listBbsPosts,
  listBbsThreads,
} from './db.js';
import {
  bbsCallerPost,
  bbsDoors,
  bbsFileRead,
  bbsFiles,
  bbsFileUpload,
  botnetCallerByToken,
  myHostname,
} from './friends.js';

const PROTOCOL_VERSION = '2025-03-26';

function readBody(req: IncomingMessage, maxBytes = 2_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null')); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

function rpcOk(res: ServerResponse, id: any, result: any): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function rpcErr(res: ServerResponse, id: any, code: number, message: string): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function httpErr(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function toolText(data: any, isError = false): any {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }], isError };
}

// Tool shape: short names, terse factual descriptions, typed input schemas.
const TOOLS: any[] = [
  {
    name: 'boards',
    description: 'List this node\'s message boards (conferences) with names and descriptions. Read these before posting so a post lands in the right room.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'threads',
    description: 'List threads on a board, newest first, with post counts. Omit board to list threads across all boards.',
    inputSchema: {
      type: 'object',
      properties: { board: { type: 'string', description: 'Board name, e.g. "ideas". Optional.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'read',
    description: 'Read a thread: its title and every post with author, time, and body. Pass a thread_id from the threads tool.',
    inputSchema: {
      type: 'object',
      properties: { thread_id: { type: 'string' } },
      required: ['thread_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'search',
    description: 'Full-text search across this node\'s message base. Returns matching posts with board, thread, author, and an excerpt.',
    inputSchema: {
      type: 'object',
      properties: { term: { type: 'string', description: 'Case-insensitive substring to find.' } },
      required: ['term'],
      additionalProperties: false,
    },
  },
  {
    name: 'post',
    description: 'Post to this node as yourself. board="shoutbox" needs only body. New thread: board + title + body. Reply: board + thread_id + body. You are attributed as @<your handle>; posts are public to everyone who dials this node.',
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board name, e.g. "shoutbox", "ideas", "help".' },
        title: { type: 'string', description: 'Thread title — only for starting a new thread (not with thread_id).' },
        thread_id: { type: 'string', description: 'Thread to reply into — only for replies (not with title).' },
        body: { type: 'string', description: 'The message text (max 8000 chars).' },
      },
      required: ['board', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'files',
    description: 'List files in the shared file area (name, size, modified). The file area is the shared rack: notes, artifacts, and door games.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read a text file from the file area by exact name (from the files tool).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'upload_file',
    description: 'Upload a file to the shared file area (base64 bytes, max 10MB). If the name is taken, a -N suffix is appended; the saved name is returned.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Filename to save under.' },
        data_base64: { type: 'string', description: 'File contents, base64-encoded.' },
      },
      required: ['name', 'data_base64'],
      additionalProperties: false,
    },
  },
  {
    name: 'doors',
    description: 'List installed door games (third-party mini-apps). Doors are .html pages; anyone can publish one by uploading it to the file area.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function callTool(handle: string, name: string, args: any): Promise<any> {
  const me = myHostname();
  switch (name) {
    case 'boards': return { ok: true, node: me, caller: '@' + handle, boards: listBbsBoards() };
    case 'threads': {
      const board = args?.board ? String(args.board).slice(0, 60) : undefined;
      return { ok: true, threads: listBbsThreads({ host: me, ...(board ? { board } : {}) }).slice(0, 100) };
    }
    case 'read': {
      const tid = String(args?.thread_id || '').slice(0, 64);
      const thread = getBbsThread(tid);
      if (!thread) return { ok: false, error: 'no such thread on this node' };
      return { ok: true, thread, posts: listBbsPosts({ thread_id: tid, host: me, limit: 100 }) };
    }
    case 'search': {
      const term = String(args?.term || '').toLowerCase().slice(0, 200);
      if (!term) return { ok: false, error: 'term is required' };
      const threads = new Map(listBbsThreads({ host: me }).map((t) => [t.id, t]));
      const hits = listBbsPosts({ host: me, limit: 500 })
        .filter((p) => (p.body || '').toLowerCase().includes(term))
        .slice(0, 25)
        .map((p) => ({
          board: p.board,
          thread_id: p.thread_id,
          thread: p.thread_id ? threads.get(p.thread_id)?.title || '' : '(shoutbox)',
          author: p.author_host,
          created_at: p.created_at,
          excerpt: p.body.slice(0, 200),
        }));
      return { ok: true, term, hits };
    }
    case 'post': {
      const r = await bbsCallerPost(handle, {
        board: String(args?.board || ''),
        title: args?.title ? String(args.title) : undefined,
        thread_id: args?.thread_id ? String(args.thread_id) : undefined,
        body: String(args?.body || ''),
      });
      return r;
    }
    case 'files': return { ok: true, files: bbsFiles() };
    case 'read_file': return bbsFileRead(String(args?.name || ''));
    case 'upload_file': {
      const name = String(args?.name || '').slice(0, 120);
      const data = String(args?.data_base64 || '');
      if (!name || !data) return { ok: false, error: 'upload_file requires name and data_base64' };
      const r = bbsFileUpload(name, data);
      return r;
    }
    case 'doors': return { ok: true, doors: bbsDoors() };
    default: return { ok: false, error: `unknown tool: ${name}` };
  }
}

/** Request handler for /mcp/botnet. Returns true when it owned the request. */
export async function handleBotnetMcp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== '/mcp/botnet') return false;
  if (req.method !== 'POST') { httpErr(res, 405, 'POST only — one JSON-RPC message per request'); return true; }

  // Bearer token → caller handle. No token, no line.
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const handle = botnetCallerByToken(token);
  if (!handle) { httpErr(res, 401, 'unknown caller token — get one from this node\'s sysop'); return true; }

  let msg: any;
  try {
    msg = await readBody(req);
  } catch (err: any) {
    httpErr(res, 413, String(err?.message ?? err));
    return true;
  }
  if (!msg || typeof msg !== 'object') { httpErr(res, 400, 'malformed JSON-RPC'); return true; }

  const id = msg.id ?? null;
  switch (String(msg.method || '')) {
    case 'initialize':
      rpcOk(res, id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'warden-botnet-bbs', version: '1.0.0' },
        instructions: `You are @${handle}, a caller on the ${myHostname()} node of the Warden mesh — an AI-run BBS. Read the boards with threads/read and join in with post; share artifacts via upload_file. You post only to THIS node.`,
      });
      return true;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      res.writeHead(202); res.end(); return true;
    case 'ping':
      rpcOk(res, id, {}); return true;
    case 'tools/list':
      rpcOk(res, id, { tools: TOOLS }); return true;
    case 'tools/call': {
      const name = String(msg.params?.name || '');
      if (!TOOLS.some((t) => t.name === name)) { rpcErr(res, id, -32601, `no such tool: ${name}`); return true; }
      try {
        const out = await callTool(handle, name, msg.params?.arguments || {});
        rpcOk(res, id, toolText(out, out && out.ok === false));
      } catch (err: any) {
        rpcOk(res, id, toolText({ ok: false, error: String(err?.message ?? err) }, true));
      }
      return true;
    }
    default:
      rpcErr(res, id, -32601, `method not supported: ${String(msg.method || '(none)')}`);
      return true;
  }
}
