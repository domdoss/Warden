import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface McpServerConfig {
  name: string;
  // stdio only: the subprocess to spawn.
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse/http only: the remote endpoint. 'http' is the newer MCP Streamable
  // HTTP transport (one endpoint, no bridge subprocess needed) — used for a
  // server that already speaks MCP natively over HTTP, e.g. a browser
  // extension's local endpoint. 'sse' is the older two-endpoint transport.
  url?: string;
  transport: 'stdio' | 'sse' | 'http';
  enabled: boolean;
  /** Optional component: never connected at boot — the agent-runner dials it
   * on demand only when a tool on this server is actually invoked. */
  lazy?: boolean;
  /** Optional human-readable description shown to the agent in the skill index.
   * When omitted, a generic "MCP server <name> (<command> <args>)" line is used. */
  description?: string;
}

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'data', 'mcp-servers.json');

const PLASMA_SERVER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-plasma-server.js',
);

// Browser automation is native (agent-runner browser_* tools over CDP) — no
// playwright MCP server in the seed.
const DEFAULT_SEED: McpServerConfig[] = [
  {
    // MARM is a default component (since 2026-09-22): the orchestrator's
    // long-term semantic memory. Install.sh provisions the server + service;
    // on a box without it the boot-connect failure is caught per server and
    // only this entry is skipped — Warden runs identically.
    name: 'marm',
    // PATH-relative on purpose. install.sh upserts the absolute binary path
    // into data/mcp-servers.json after installing (systemd --user PATH can
    // miss ~/.local/bin); the seed works wherever marm-memory is on PATH.
    command: 'marm-memory',
    args: ['stdio'],
    transport: 'stdio',
    enabled: true,
    // The short-lived per-turn stdio child must NOT build the concept graph —
    // that is the long-lived HTTP service's job (marm-memory.service on
    // 127.0.0.1:8001). Both share concept_build_lock in marm_memory.db and
    // fight over it otherwise (concept_worker deferred reason=graph_busy).
    env: { CONCEPT_AUTO_INDEX: 'false' },
    description:
      'MARM long-term memory: hybrid BM25+semantic recall (marm_smart_recall) + concept graph. The HTTP server for memory writeback runs separately (marm-memory.service) on 127.0.0.1:8001.',
  },
  {
    name: 'plasma',
    command: 'node',
    args: [PLASMA_SERVER_PATH],
    transport: 'stdio',
    enabled: false,
    description:
      'KDE Plasma D-Bus verbs (notify, open URL, clipboard, current activity, KWin windows). Enable only on a Plasma deployment target.',
  },
];

// In-memory cache keyed by absolute config path so repeated reads do not
// re-read the file (and so tests using a temp path do not collide with any
// real data/mcp-servers.json that might exist).
const cache = new Map<string, McpServerConfig[]>();

function resolveConfigPath(p: string): string {
  return path.resolve(p);
}

function readFromDisk(p: string): McpServerConfig[] {
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as McpServerConfig[];
  } catch {
    return [];
  }
}

/**
 * Load the MCP server list from `data/mcp-servers.json` (or the given path).
 * Returns [] when the file does not exist — read does not create.
 * Results are cached in-memory after the first load for the given path.
 */
export function loadMcpServers(configPath: string = DEFAULT_CONFIG_PATH): McpServerConfig[] {
  const resolved = resolveConfigPath(configPath);
  if (cache.has(resolved)) return cache.get(resolved)!;
  const list = readFromDisk(resolved);
  cache.set(resolved, list);
  return list;
}

/**
 * Atomically write the list to disk (temp file + rename) and refresh the cache.
 * Creates the file on save even if the list is empty.
 */
export function saveMcpServers(
  list: McpServerConfig[],
  configPath: string = DEFAULT_CONFIG_PATH,
): void {
  const resolved = resolveConfigPath(configPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(resolved)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, resolved);
  cache.set(resolved, list);
}

/**
 * Append a new MCP server entry. Throws if an entry with the same name exists.
 */
export function addMcpServer(
  entry: McpServerConfig,
  configPath: string = DEFAULT_CONFIG_PATH,
): void {
  const list = loadMcpServers(configPath);
  if (list.some((s) => s.name === entry.name)) {
    throw new Error(`MCP server "${entry.name}" already exists`);
  }
  const next = [...list, entry];
  saveMcpServers(next, configPath);
}

/**
 * Remove an MCP server entry by name. No-op if the name is not found.
 */
export function removeMcpServer(
  name: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): void {
  const list = loadMcpServers(configPath);
  const next = list.filter((s) => s.name !== name);
  if (next.length === list.length) return;
  saveMcpServers(next, configPath);
}

/**
 * Toggle the enabled flag on an existing entry. Throws if the name is not found.
 */
export function setMcpServerEnabled(
  name: string,
  enabled: boolean,
  configPath: string = DEFAULT_CONFIG_PATH,
): void {
  const list = loadMcpServers(configPath);
  let found = false;
  const next = list.map((s) => {
    if (s.name === name) {
      found = true;
      return { ...s, enabled };
    }
    return s;
  });
  if (!found) throw new Error(`MCP server "${name}" not found`);
  saveMcpServers(next, configPath);
}

/**
 * Write the default seed (Playwright enabled) to the config file only if it
 * does not already exist. Does not overwrite existing config.
 */
export function seedDefaultMcpServers(
  configPath: string = DEFAULT_CONFIG_PATH,
): void {
  const resolved = resolveConfigPath(configPath);
  if (fs.existsSync(resolved)) return;
  saveMcpServers(DEFAULT_SEED, configPath);
}