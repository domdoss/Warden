// Shared helpers for the training-loop scripts (audit-failures.mjs,
// modify-parts.mjs). Plain Node, no deps — same convention as the rest of
// training/. Every helper echoes through log() so the dashboard tail
// (training/loop/logs/<step>.log) stays readable.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TRAINING_DIR = path.join(HERE, '..');
export const WARDEN_ROOT = path.join(TRAINING_DIR, '..');
export const CATALOGS_DIR = path.join(HERE, 'catalogs');
export const ANALYST_MODEL = 'granite4.2:30b';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

export function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export function exitMsg(msg) {
  log(msg);
  process.exit(1);
}

/** journald (pino's stdout transport) is colorized — src/logger.ts colorize:true. */
export function ansiStrip(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Read the warden.service log window. Journald is the primary source (real
 * dates, full history — warden.log is head-trimmed at 5 MB and holds ~1 day).
 * Falls back to warden.log with a warning if journald is empty/unreachable.
 */
export function readJournal(days) {
  const r = spawnSync(
    'journalctl',
    ['--user', '-u', 'warden.service', '--since', `${days} days ago`, '-o', 'cat', '--no-pager'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const out = r.status === 0 && r.stdout ? r.stdout : '';
  if (out.trim()) {
    return { lines: out.split('\n'), source: 'journald' };
  }
  log(`journalctl returned nothing (${r.status === 0 ? 'empty' : `exit ${r.status}`}) — falling back to warden.log (holds ~1 day only)`);
  const file = readFileSync(path.join(WARDEN_ROOT, 'logs', 'warden.log'), 'utf8');
  return { lines: file.split('\n'), source: 'warden.log' };
}

/** Ollama chat, no streaming, temperature 0 (analysis, not creativity). */
export async function ollamaChat(model, messages) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(600_000),
      body: JSON.stringify({ model, messages, stream: false, keep_alive: 600, options: { temperature: 0 } }),
    });
  } catch {
    throw new Error('Ollama not reachable at localhost:11434 — aborting');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.message?.content;
  if (typeof content !== 'string') throw new Error(`Ollama returned no message content for ${model}`);
  return content;
}

/** Unload a model (keep_alive 0 — same as `ollama stop`). */
async function unloadModel(name) {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: name, keep_alive: 0 }),
    });
  } catch {
    // the re-probe below decides whether it took
  }
}

/** Clear VRAM so the 17 GB analyst model can load. Returns the unloaded names. */
export async function clearVram() {
  let names;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    names = (data.models || []).map((m) => m.name);
  } catch {
    throw new Error('Ollama not reachable at localhost:11434 — aborting');
  }
  for (const n of names) {
    await unloadModel(n);
    log(`unloaded ${n}`);
  }
  // Re-probe so a failed unload is visible in the tail.
  const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  const still = res ? (await res.json()).models.map((m) => m.name) : ['ps-unreachable'];
  return { unloaded: names, stillLoaded: still };
}

export async function unloadAnalyst() {
  await unloadModel(ANALYST_MODEL);
}

/**
 * Parse a model reply that should be JSON. Strips markdown fences, scans to
 * the matching outer brace/bracket, returns null on failure. Callers retry
 * once with a nudge before degrading.
 */
export function parseJsonLoose(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let s = text.replace(/```(?:json)?/g, '').trim();
  const start = s.search(/[[{]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}