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
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

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
    }
  | {
      name: string;
      url: string;
      transport: 'sse';
      enabled: boolean;
      description?: string;
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
  private transport: StdioClientTransport | SSEClientTransport | null = null;
  private connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /** Connect to the server (spawn subprocess for stdio, HTTP connect for sse). */
  async connect(): Promise<void> {
    if (this.connected) return;

    const client = new Client({ name: 'dockbox-agent-runner', version: '1.0.0' }, { capabilities: {} });
    this.client = client;

    if (this.config.transport === 'sse') {
      const transport = new SSEClientTransport(new URL(this.config.url));
      this.transport = transport;
      await client.connect(transport);
    } else {
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env ?? process.env,
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

/**
 * Load every enabled MCP server from the config file, spawn a client for each,
 * and connect. Returns ready-to-use clients. Failures are isolated: a single
 * server failing to connect does not abort the rest — it is logged and skipped.
 */
export async function loadExternalMcpClients(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ExternalMcpClient[]> {
  const configs = loadMcpServers(configPath).filter((c) => c.enabled && (c.transport === 'stdio' || c.transport === 'sse'));
  // Connect to every server in parallel. Serial connect was the dominant
  // cold-start delay (npx/uvx spawn + handshake per server, plus broken
  // servers eating their full timeout one after another). Parallel cuts the
  // wait from sum-of-servers to max-of-servers.
  const results = await Promise.allSettled(
    configs.map(async (cfg) => {
      const client = new ExternalMcpClient(cfg);
      try {
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 10000)),
        ]);
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