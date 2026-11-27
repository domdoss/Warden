#!/usr/bin/env node
// seat-tests/harvest.mjs — GPU-free ask-mining from the live chat log (the DB,
// which is the authoritative record of real user messages — the journald
// stream is infra noise, not a chat log). Run it WHILE a retrain holds the GPU.
//
//   node harvest.mjs [--days 30] [--min-len 12] [--probe]
//
// Reads user rows (is_bot_message=0) from store/messages.db, drops noise,
// dedupes against cases.jsonl + pending.jsonl, and appends novel asks to
// pending.jsonl for the next training batch. With --probe it also runs each new
// ask through the BASE model (granite4.2:8b) and records the first tool it
// picks, so "the base gets this wrong" candidates can be pre-seeded. The probe
// is opt-in because it needs the base model loaded (CPU during a retrain).
//
// Emits nothing but a one-line summary; pending.jsonl is the durable output.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, loadToolSchemas, systemPrompt, chatRaw } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(HERE, '..', '..', 'store', 'messages.db');
const PENDING = path.join(HERE, 'pending.jsonl');
const BASE_MODEL = process.env.PROBE_MODEL || 'granite4.2:8b';

const DAYS = Number(arg('--days', '30'));
const MIN_LEN = Number(arg('--min-len', '12'));
const PROBE = process.argv.includes('--probe');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const NOISE = new Set([
  'hello', 'hi', 'hey', 'ok', 'okay', 'yes', 'no', 'thanks', 'thank you', 'thx',
  'test', 'testing', 'yo', 'bye', 'good', 'cool', 'great', 'nice', 'lol', 'hmm',
  'stop', 'clear', 'clear context', 'clear the context',
]);

function isNoise(s) {
  const n = norm(s);
  if (n.length < MIN_LEN) return true;
  if (NOISE.has(n)) return true;
  if (!/[a-z]/.test(n)) return true;
  return false;
}

// Real user asks from the DB, oldest first. sqlite3 -json so a `|` in content
// can't be mis-read as a column separator.
function dbAsks(days) {
  if (!existsSync(DB)) throw new Error(`no messages.db at ${DB}`);
  const r = spawnSync(
    'sqlite3', ['-json', DB,
      `SELECT content AS c, timestamp AS t FROM messages WHERE is_bot_message=0 AND timestamp > datetime('now','-${days} days') ORDER BY timestamp ASC;`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`sqlite3 failed (exit ${r.status}): ${r.stderr}`);
  const rows = JSON.parse(r.stdout || '[]');
  return rows.map((x) => x.c);
}

function loadPending() {
  if (!existsSync(PENDING)) return [];
  const out = [];
  for (const line of readFileSync(PENDING, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o.ask) out.push(o); } catch { /* skip bad line */ }
  }
  return out;
}

function writePending(rows) {
  // append (not overwrite) — pending is a rolling backlog across harvest runs
  writeFileSync(PENDING, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { flag: 'a' });
}

async function probe(ask, system, merged) {
  try {
    const msg = await chatRaw({
      model: BASE_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `${ask}` },
      ],
      tools: merged,
      timeoutMs: 120_000,
    });
    const calls = (msg?.tool_calls || []).map((tc) => tc.function?.name).filter(Boolean);
    return calls[0] || 'no-tool';
  } catch (e) {
    return `probe-error:${e.message.slice(0, 60)}`;
  }
}

const main = async () => {
  // Known asks: the corpus + the pending backlog (so re-runs don't re-mine).
  const known = new Set();
  for (const c of loadCases()) known.add(norm(c.ask));
  for (const p of loadPending()) known.add(norm(p.ask));

  const asks = dbAsks(DAYS);
  const novel = [];
  const seen = new Set();
  for (const a of asks) {
    const n = norm(a);
    if (isNoise(a) || known.has(n) || seen.has(n)) continue;
    seen.add(n);
    novel.push(a);
  }

  if (novel.length === 0) {
    console.log(`harvest: 0 novel asks in ${DAYS}d of messages (${asks.length} user rows scanned)`);
    return;
  }

  const now = new Date().toISOString();
  const rows = novel.map((ask, i) => ({ ask, source: 'messages.db', ts: now, n: i + 1 }));
  writePending(rows);
  console.log(`harvest: ${novel.length} novel asks → pending.jsonl (${asks.length} user rows scanned, ${DAYS}d)`);

  if (PROBE) {
    const { merged } = loadToolSchemas();
    const system = systemPrompt();
    for (const [i, ask] of novel.entries()) {
      const pick = await probe(ask, system, merged);
      console.log(`  [${i + 1}/${novel.length}] base→${pick}  ${ask.slice(0, 80)}`);
    }
  }
};

main().catch((e) => { console.error(`harvest failed: ${e.message}`); process.exit(1); });
