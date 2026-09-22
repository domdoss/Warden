/**
 * External MCP client — speaks the Model Context Protocol over stdio with
 * subprocess MCP servers (e.g. `npx -y @playwright/mcp`).
 *
 * Each ExternalMcpClient spawns one configured server, performs the MCP
 * initialize handshake, and exposes listTools / callTool. The agent-runner's
 * turn loop calls loadExternalMcpClients() at turn start to collect tools from
 * every enabled server, then dispatches tool calls to the owning client.
 *
 * This module is self-contained: it does not import from the host-side
 * `src/mcp-registry.ts` (the agent-runner runs in a container with its own
 * node_modules and cannot reach the host source tree). The McpServerConfig
 * shape is duplicated here and kept structurally identical.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Configuration for a single external MCP server. Mirrors src/mcp-registry.ts. */
export type McpServerConfig =
  | {
      name: string;
      command: string;
      args: string[];
      env?: Record<string, string>;
      transport: 'stdio';
      enabled: boolean;
      description?: string;
      lazy?: boolean;
    }
  | {
      name: string;
      url: string;
      transport: 'sse';
      enabled: boolean;
      description?: string;
      lazy?: boolean;
    }
  | {
      name: string;
      url: string;
      // The newer MCP transport (single POST/GET endpoint, session id header,
      // SSE-or-JSON response) — distinct from the older two-endpoint 'sse'
      // above. A server that speaks this directly (e.g. a browser extension's
      // local MCP endpoint) needs no stdio bridge process at all.
      transport: 'http';
      enabled: boolean;
      description?: string;
      lazy?: boolean;
    };

/** A tool exposed by an external MCP server. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
  /** Owning server name — set by ExternalMcpClient so dispatch can route. */
  server: string;
}

const DEFAULT_CONFIG_PATH =
  process.env.MCP_SERVERS_CONFIG ?? path.join(process.cwd(), 'data', 'mcp-servers.json');

/**
 * Read the MCP server list from disk. Returns [] when the file does not exist
 * (read does not create). Kept in sync with src/mcp-registry.ts#loadMcpServers
 * but without caching — the agent-runner reads this once per turn.
 */
export function loadMcpServers(configPath: string = DEFAULT_CONFIG_PATH): McpServerConfig[] {
  if (!fs.existsSync(configPath)) return [];
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as McpServerConfig[];
  } catch {
    return [];
  }
}

export class ExternalMcpClient {
  readonly config: McpServerConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null;
  private connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /** Connect to the server (spawn subprocess for stdio, HTTP connect for sse/http). */
  async connect(): Promise<void> {
    if (this.connected) return;

    const client = new Client({ name: 'dockbox-agent-runner', version: '1.0.0' }, { capabilities: {} });
    this.client = client;

    if (this.config.transport === 'sse') {
      const transport = new SSEClientTransport(new URL(this.config.url));
      this.transport = transport;
      await client.connect(transport);
    } else if (this.config.transport === 'http') {
      const serverUrl: string = this.config.url;
      const connectHttp = async () => {
        const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
        this.transport = transport;
        await client.connect(transport);
      };
      try {
        await connectHttp();
      } catch (err: any) {
        // Single-session Streamable HTTP servers (e.g. mcp-chrome-bridge):
        // one transport slot for the whole server process. The previous
        // client's close-DELETE is fire-and-forget in the SDK, so an immediate
        // reconnect can race it ("Already connected to a transport"). Send our
        // own sessionless DELETE as a nudge, then retry with backoff — the
        // slot frees once the in-flight DELETE lands.
        if (!/Already connected to a transport/i.test(String(err?.message ?? err))) throw err;
        let connected = false;
        for (let attempt = 0; attempt < 6 && !connected; attempt++) {
          process.stderr.write(`[mcp:${this.config.name}] transport slot busy — reaping and retrying (${attempt + 1}/6)\n`);
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            await fetch(serverUrl, { method: 'DELETE', signal: ctrl.signal });
            clearTimeout(t);
          } catch { /* best-effort */ }
          await new Promise((r) => setTimeout(r, 1000));
          this.client = new Client({ name: 'dockbox-agent-runner', version: '1.0.0' }, { capabilities: {} });
          try {
            await connectHttp();
            connected = true;
          } catch (retryErr: any) {
            if (!/Already connected to a transport/i.test(String(retryErr?.message ?? retryErr))) throw retryErr;
          }
        }
        if (!connected) {
          // Slot is bound to a dead client's session that no DELETE can free.
          // Kill the stale server; its supervisor respawns it, then connect.
          if (await reapStaleServer(serverUrl)) {
            this.client = new Client({ name: 'dockbox-agent-runner', version: '1.0.0' }, { capabilities: {} });
            await connectHttp();
            connected = true;
          }
        }
        if (!connected) throw new Error('Already connected to a transport (slot stayed busy after retries)');
      }
    } else {
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        // Merge so an entry's `env` block augments rather than wipes the
        // ambient environment, and guarantee $HOME/.local/bin is on PATH so
        // user-installed uv/uvx is found when systemd strips it (systemd's
        // default PATH lacks per-user bins).
        env: (() => {
          const merged: Record<string, string | undefined> = { ...process.env, ...this.config.env };
          const homeLocal = `${process.env.HOME || ''}/.local/bin`;
          const paths = (merged.PATH || '').split(':').filter(Boolean);
          if (homeLocal !== '/.local/bin' && !paths.includes(homeLocal)) paths.unshift(homeLocal);
          merged.PATH = paths.join(':');
          return merged as Record<string, string>;
        })(),
        stderr: 'pipe',
      });
      this.transport = transport;
      try {
        const stderr = transport.stderr;
        if (stderr) {
          stderr.on('data', (chunk: Buffer) => {
            process.stderr.write(`[mcp:${this.config.name}] ${chunk.toString()}`);
          });
        }
      } catch { /* stderr optional */ }
      await client.connect(transport);
    }

    this.connected = true;
  }

  /** List tools exposed by the server. Returns [] if the server supports none. */
  async listTools(): Promise<McpTool[]> {
    if (!this.client || !this.connected) {
      throw new Error(`ExternalMcpClient[${this.config.name}] not connected`);
    }
    const res = await this.client.listTools();
    const tools = res.tools ?? [];
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema ?? {}) as Record<string, any>,
      server: this.config.name,
    }));
  }

  /** Invoke a tool by name with the given arguments. */
  async callTool(name: string, args: any): Promise<any> {
    if (!this.client || !this.connected) {
      throw new Error(`ExternalMcpClient[${this.config.name}] not connected`);
    }
    return this.client.callTool({ name, arguments: args ?? {} });
  }

  /** Tear down: close the client and kill the subprocess. */
  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        /* best-effort */
      }
      this.client = null;
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        /* best-effort */
      }
      this.transport = null;
    }
  }
}

// HTTP-transport clients persist across turns: single-session servers (the
// bridge) bind one transport slot per server process, so a per-turn
// disconnect/reconnect race leaves the slot bound to a dead session.
// Reused while alive; disconnected only on process exit.
/** Ceiling on bringing ONE server up at boot — the connect handshake AND its
 *  first usable tools/list, together. Bounding only connect() is what wedged
 *  the runner on 2026-09-21: connect resolved, tools/list hung, and no other
 *  timeout was left to hit. Anything past this is a server that isn't ready;
 *  boot moves on without it. */
const BOOT_READY_MS = 20_000;
/** Poll gap while an http server's tool list settles (see the call site). */
const HTTP_TOOLS_SETTLE_MS = 2_000;
/** Lazy on-demand dial ceiling for an optional server (browser-driving). */
const LAZY_DIAL_MS = 10_000;

/** Reject if `p` has not settled within `ms`. Every MCP round trip that boot
 *  waits on goes through here — an unbounded one takes the whole runner with
 *  it (2026-09-21). */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), Math.max(0, ms));
    }),
  ]);
}

const persistentClients = new Map<string, ExternalMcpClient>();

let lastReapAt = 0;

/** A single-session server's slot can outlive its client (dirty exit). Kill
 *  whoever holds the configured port — the supervisor (browser extension
 *  reconnect) respawns a clean server — and wait for that respawn. At most
 *  once a minute. */
async function reapStaleServer(url: string): Promise<boolean> {
  if (Date.now() - lastReapAt < 60_000) return false;
  try {
    const port = new URL(url).port;
    if (!port) return false;
    const holder = (): number | null => {
      try {
        const m = /pid=(\d+)/.exec(execSync(`ss -tlnp 2>/dev/null | grep ":${port} "`).toString());
        return m ? Number(m[1]) : null;
      } catch { return null; }
    };
    const pid = holder();
    if (!pid) return false;
    process.stderr.write(`[mcp] reaping stale server pid ${pid} (slot bound to a dead client)\n`);
    process.kill(pid, 'SIGTERM');
    lastReapAt = Date.now();
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const now = holder();
      if (now && now !== pid) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch { /* port absent or ss unavailable */ }
  return false;
}

/**
 * Load every enabled MCP server from the config file, spawn a client for each,
 * and connect. Returns ready-to-use clients. Failures are isolated: a single
 * server failing to connect does not abort the rest — it is logged and skipped.
 */
export async function loadExternalMcpClients(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ExternalMcpClient[]> {
  // `lazy` servers (optional components — e.g. the browser-driving bridge) are
  // NEVER touched at boot: no connect, no tools/list, nothing to hang a turn
  // on when they're down. They are dialed on demand at dispatch time via
  // getOrCreateMcpClient().
  const configs = loadMcpServers(configPath).filter((c) => c.enabled && !c.lazy && (c.transport === 'stdio' || c.transport === 'sse' || c.transport === 'http'));
  // Connect to every server in parallel. Serial connect was the dominant
  // cold-start delay (npx/uvx spawn + handshake per server, plus broken
  // servers eating their full timeout one after another). Parallel cuts the
  // wait from sum-of-servers to max-of-servers.
  const results = await Promise.allSettled(
    configs.map(async (cfg) => {
      if (cfg.transport === 'http') {
        const cached = persistentClients.get(cfg.name);
        if (cached) {
          try {
            await cached.listTools();
            return cached;
          } catch {
            persistentClients.delete(cfg.name);
            try { await cached.disconnect(); } catch { /* ignore */ }
          }
        }
      }
      const client = new ExternalMcpClient(cfg);
      try {
        // ONE deadline spanning connect AND the first tools/list. Bounding
        // only connect() is what wedged the runner on 2026-09-21: connect
        // resolved, tools/list hung, and nothing was left to time out. Both
        // each individual call and the settle loop answer to this deadline.
        const readyBy = Date.now() + BOOT_READY_MS;
        await withTimeout(client.connect(), BOOT_READY_MS, `connect to "${cfg.name}"`);
        if (cfg.transport === 'http') {
          // The bridge binds its port before its extension link is up, so the
          // tool list lands a beat after connect. Whatever has not arrived by
          // the deadline is not coming — keep the connected client either way
          // and let a later on-demand dial pick up the tools.
          while (Date.now() < readyBy) {
            const tools = await withTimeout(
              client.listTools(), readyBy - Date.now(), `tools/list from "${cfg.name}"`,
            ).catch(() => []);
            if (tools.length > 0) break;
            await new Promise((r) => setTimeout(r, Math.min(HTTP_TOOLS_SETTLE_MS, Math.max(0, readyBy - Date.now()))));
          }
          persistentClients.set(cfg.name, client);
        }
        return client;
      } catch (err) {
        process.stderr.write(
          `[mcp] failed to connect to "${cfg.name}": ${(err as Error).message}\n`,
        );
        try {
          await client.disconnect();
        } catch {
          /* ignore */
        }
        return null;
      }
    }),
  );
  return results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((c): c is ExternalMcpClient => c !== null);
}

/** On-demand client for a `lazy` server (optional component — e.g. the
 *  browser-driving bridge). Called from tool dispatch when a tool on that
 *  server is actually invoked: connect now (bounded), cache for reuse, and
 *  let the caller fail gracefully if the server isn't there. Boot never
 *  touches these servers; only a real tool call does. */
export async function getOrCreateMcpClient(
  server: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ExternalMcpClient> {
  const cached = persistentClients.get(server);
  if (cached) return cached;
  const cfg = loadMcpServers(configPath).find((c) => c.enabled && c.name === server);
  if (!cfg) throw new Error(`MCP server "${server}" is not configured or enabled`);
  const client = new ExternalMcpClient(cfg);
  await withTimeout(client.connect(), LAZY_DIAL_MS, `dial "${server}"`);
  persistentClients.set(server, client);
  return client;
}