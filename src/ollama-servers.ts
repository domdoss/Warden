// ── Role URLs & named Ollama servers ────────────────────────────────────────
// The consolidated settings store for Ollama endpoints. Named servers (up to 3)
// live as JSON in router_state 'ollama:servers', with 'ollama:default_server'
// naming the default. Per-headline-agent overrides live in
// 'orchestrator:ollama_server' / 'atlas:ollama_server' / 'hephaestus:ollama_server'
// / 'sentry:ollama_server'. Kept in a standalone module (importing only db +
// config) so any host-side caller can use it without pulling in status-server
// (which would create import cycles).

import { getRouterState, setRouterState } from './db.js';
import { OLLAMA_URL } from './config.js';

export interface OllamaServer { id: string; label: string; url: string; }

/** Named Ollama servers (up to 3) stored as JSON in router_state 'ollama:servers'. */
export function readOllamaServers(): OllamaServer[] {
  const raw = getRouterState('ollama:servers');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((s: any) => ({
      id: String(s.id || ''),
      label: String(s.label || s.id || ''),
      url: String(s.url || ''),
    })).filter(s => s.id && s.url);
  } catch { return []; }
}

export function writeOllamaServers(servers: OllamaServer[]): void {
  const clean = servers.slice(0, 3).map((s) => ({ id: s.id, label: s.label, url: s.url }));
  setRouterState('ollama:servers', JSON.stringify(clean));
}

/** Resolve a per-agent Ollama server id to a URL. Falls back to the default
 *  server, then the first configured server, then the legacy global OLLAMA_URL.
 *  Use this from HOST-side callers (context compression, memory writeback,
 *  scrubber, credential proxy) that run on the host where OLLAMA_URL is valid. */
export function resolveOllamaServerUrl(serverId?: string): string {
  const servers = readOllamaServers();
  const def = getRouterState('ollama:default_server') || '';
  const id = (serverId && serverId.trim()) || def || '';
  if (id) {
    const found = servers.find((s) => s.id === id);
    if (found) return found.url;
  }
  if (servers.length > 0) return servers[0].url;
  return OLLAMA_URL;
}

/** Resolve a headline agent's Ollama server URL for the agent-runner payload.
 *  Returns the assigned (or default) NAMED server's URL. Returns '' when no
 *  named servers are configured so the container falls back to its own
 *  process.env.OLLAMA_URL — the host's OLLAMA_URL (often 127.0.0.1) is NOT
 *  container-reachable, so we must not inject it. */
export function resolveAgentOllamaUrl(routerKey: string): string {
  const servers = readOllamaServers();
  if (servers.length === 0) return '';
  const id = (getRouterState(routerKey) || '').trim()
    || (getRouterState('ollama:default_server') || '').trim();
  if (!id) return servers[0].url;
  const found = servers.find((s) => s.id === id);
  return found ? found.url : servers[0].url;
}