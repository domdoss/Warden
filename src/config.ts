import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets (API keys, tokens) are NOT read here.
const envConfig = readEnvFile(['ASSISTANT_NAME', 'ASSISTANT_HAS_OWN_NUMBER', 'OLLAMA_URL', 'OLLAMA_CHAT_MODEL', 'LOCAL_ASSISTANT_NAME', 'DEFAULT_MODEL_MODE', 'IDLE_TIMEOUT', 'CONTAINER_TIMEOUT', 'ADMIN_DOMAIN', 'OAUTH_REDIRECT_BASE', 'WORKSPACE_ROOT', 'RADICALE_URL', 'RADICALE_USER', 'RADICALE_PASS', 'RADICALE_CAL_COLLECTION', 'RADICALE_CARD_COLLECTION', 'RADICALE_STORAGE_DIR']);

// Propagate env-file values into process.env so child processes (agent-runner,
// MCP servers, etc.) inherit them via spawn. Without this, a parent launched
// without an explicit env export would spawn children that fall back to the
// hard-coded Docker-host defaults (e.g. OLLAMA_URL=http://172.17.0.1:11434).
for (const [k, v] of Object.entries(envConfig)) {
  if (v !== undefined && process.env[k] === undefined) process.env[k] = v;
}

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Warden';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'dockbox',
  'mount-allowlist.json',
);
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'dockbox',
  'sender-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
// Backup directory — one level above the project root so agent containers can never access it
export const BACKUP_DIR = path.resolve(PROJECT_ROOT, '..', 'backups');

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'dockbox-agent:latest';
export const AGENT_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '7200000',
  10,
); // 2h default (env var kept as CONTAINER_TIMEOUT for backwards compat)
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '104857600',
  10,
); // 100MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '3600000', 10); // 1h default — how long to keep container alive after last result
export const BACKGROUND_PROMOTE_MS = parseInt(process.env.BACKGROUND_PROMOTE_MS || '90000', 10); // 90s — promote container to background if no final response yet

// Workspace root — the single directory the agent operates in. Resolved from
// WORKSPACE_ROOT env var, defaulting to ~/dockbox.
export const WORKSPACE_ROOT: string = (() => {
  const fromEnv = process.env.WORKSPACE_ROOT || envConfig.WORKSPACE_ROOT;
  if (fromEnv) return path.resolve(fromEnv.replace(/^~(?=\/|$)/, HOME_DIR));
  return path.join(HOME_DIR, 'dockbox');
})();

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Cloud models exposed in the dashboard dropdown. The first entry is the
// default used when no model is explicitly selected.
export const CLOUD_MODELS = [
  { id: 'glm-5.2:cloud', label: 'GLM 5.2 (cloud)', provider: 'glm' },
  { id: 'kimi-k2.6:cloud', label: 'Kimi K2.6 (cloud)', provider: 'kimi' },
  { id: 'kimi-k2.5:cloud', label: 'Kimi K2.5 (cloud)', provider: 'kimi' },
];
export const DEFAULT_CLOUD_MODEL = 'glm-5.2:cloud';

// Ollama configuration
export const OLLAMA_URL =
  process.env.OLLAMA_URL || envConfig.OLLAMA_URL || 'http://127.0.0.1:11434';
export const OLLAMA_CHAT_MODEL =
  process.env.OLLAMA_CHAT_MODEL || envConfig.OLLAMA_CHAT_MODEL || DEFAULT_CLOUD_MODEL;
export const LOCAL_ASSISTANT_NAME =
  process.env.LOCAL_ASSISTANT_NAME || envConfig.LOCAL_ASSISTANT_NAME || 'Kimi';
// Model routing mode: "" (Claude only), "local", "hybrid"
export const DEFAULT_MODEL_MODE =
  process.env.DEFAULT_MODEL_MODE || envConfig.DEFAULT_MODEL_MODE || '';

// Admin domain — the domain that serves the dashboard/API (all other domains serve group sites)
export const ADMIN_DOMAIN =
  process.env.ADMIN_DOMAIN || envConfig.ADMIN_DOMAIN || '';

// OAuth redirect base URL (e.g. https://optimus.dockbox.dev). Undefined means OAuth is not configured.
export const OAUTH_REDIRECT_BASE =
  process.env.OAUTH_REDIRECT_BASE || envConfig.OAUTH_REDIRECT_BASE || undefined;

// Custom API executor URL allowlist — comma-separated list of allowed hostname patterns
// (exact match or * wildcard, e.g. "api.example.com,*.openai.com"). Empty = allow all (not recommended).
function parseAllowlist(envVal?: string): string[] {
  if (!envVal) return [];
  return envVal.split(',').map(s => s.trim()).filter(Boolean);
}
export const CUSTOM_API_ALLOWLIST = parseAllowlist(
  process.env.CUSTOM_API_ALLOWLIST || envConfig.CUSTOM_API_ALLOWLIST
);

/** Returns true if targetUrl is allowed by CUSTOM_API_ALLOWLIST. Empty allowlist blocks everything. */
export function isCustomApiAllowed(targetUrl: string): boolean {
  if (CUSTOM_API_ALLOWLIST.length === 0) return false;
  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Block IP addresses and localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.startsWith('0.') || hostname.startsWith('10.') || hostname.startsWith('172.') || hostname.startsWith('192.168.')) return false;
  for (const pattern of CUSTOM_API_ALLOWLIST) {
    const p = pattern.toLowerCase();
    if (p.startsWith('*.')) {
      const suffix = p.slice(2);
      if (hostname === suffix || hostname.endsWith('.' + suffix)) return true;
    } else if (hostname === p) {
      return true;
    }
  }
  return false;
}

