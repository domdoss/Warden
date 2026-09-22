// Shared helpers for the training-loop scripts (audit-failures.mjs,
// modify-parts.mjs). Plain Node, no deps — same convention as the rest of
// training/. Every helper echoes through log() so the dashboard tail
// (training/loop/logs/<step>.log) stays readable.
import { spawnSync } from 'node:child_process';
import http from 'node:http';
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
  // Local time — warden.log and the dashboard run local; UTC stamps made
  // 21:48 look like "04:48" and read as a different incident.
  console.log(`[${new Date().toLocaleTimeString('en-CA', { hour12: false })}] ${msg}`);
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

/** Ollama chat, no streaming, temperature 0 (analysis, not creativity).
 * node:http with `agent: false` — one fresh connection per request, closed
 * after the response. No pooled keep-alive socket for ollama to close under us
 * (the 2026-09-21 crash: undici reused a connection ollama had just closed —
 * ECONNRESET with the server fine and nothing in its log). No pool, no race. */
export function ollamaChat(model, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream: false, keep_alive: 600, options: { temperature: 0 } });
    const req = http.request(
      `${OLLAMA_URL}/api/chat`,
      { method: 'POST', agent: false, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`Ollama error ${res.statusCode}: ${data.slice(0, 300)}`));
          try {
            const content = JSON.parse(data)?.message?.content;
            if (typeof content !== 'string') return reject(new Error(`Ollama returned no message content for ${model}`));
            resolve(content);
          } catch (err) {
            reject(new Error(`Ollama reply was not JSON: ${String(data).slice(0, 200)} (${err?.message ?? err})`));
          }
        });
      },
    );
    req.setTimeout(600_000, () => req.destroy(new Error('Ollama chat timed out after 600s')));
    req.on('error', reject);
    req.end(body);
  });
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