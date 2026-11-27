#!/usr/bin/env node
// seat-tests/smoke.mjs — Layer C: live smoke against the RUNNING seat on :3200.
//
//   node smoke.mjs [--cases filter] [--timeout 180000]
//
// Posts each case's ask to POST /api/messages, waits for the seat to answer,
// then checks (a) the REAL reply against reply.require/forbid and (b) the REAL
// tool dispatch against warden.log's "Executing tool:" lines. The messages
// table stores text only, so the tool-call assertion reads the live log.
//
// Only run on a candidate build with the seat idle — this fires real side
// effects. Exits non-zero on any failure.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, replyOk } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WARDEN = path.join(HERE, '..', '..');
const BASE = (process.env.BASE || 'http://localhost:3200').replace(/\/$/, '');
const JID = process.env.JID || 'owner@local';
const SENDER = process.env.SENDER || 'the user';
const TIMEOUT_MS = Number(process.env.TIMEOUT || '180000');
const WARDEN_LOG = path.join(WARDEN, 'logs', 'warden.log');

const filter = (process.env.CASES || '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jget(url) {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function postMessage(text) {
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, jid: JID, sender_name: SENDER }),
  });
  if (!res.ok) throw new Error(`POST /api/messages → HTTP ${res.status}`);
  return res.json();
}

async function groupState() {
  const d = await jget('/api/status');
  const g = (d.groups || []).find((x) => x.jid === JID) || (d.groups || [])[0] || {};
  return { idle: g.idle === true, pending: g.pendingMessages === true, tasks: g.pendingTasks || 0 };
}

async function latestBotAfter(sinceTs) {
  const d = await jget(`/api/messages?jid=${JID}&limit=300`);
  const bot = (d.messages || []).filter((m) => m.is_bot_message && m.timestamp > sinceTs);
  return bot.length ? bot[bot.length - 1].content : null;
}

function logFrom(offset) {
  const txt = readFileSync(WARDEN_LOG, 'utf8');
  return offset < txt.length ? txt.slice(offset) : '';
}

function expectedTool(c) {
  if (c.expect?.noTool) return null;
  const s = Array.isArray(c.expect) ? c.expect[0] : c.expect;
  return s.anyOf || [s.name];
}

async function runCase(c) {
  // Baseline: newest bot timestamp + log byte offset BEFORE we post.
  const before = await jget(`/api/messages?jid=${JID}&limit=300`);
  const sinceTs = Math.max(0, ...(before.messages || []).map((m) => m.timestamp));
  let logOff = 0;
  try { logOff = readFileSync(WARDEN_LOG, 'utf8').length; } catch { /* log unreadable */ }

  await postMessage(c.ask);

  // Wait for a new bot reply, then for the seat to drain (idle + stable).
  const deadline = Date.now() + TIMEOUT_MS;
  let finalText = null, stableMs = 0, lastSeen = '';
  while (Date.now() < deadline) {
    const txt = await latestBotAfter(sinceTs);
    if (txt !== null) {
      if (txt === lastSeen) stableMs += 1500; else { lastSeen = txt; stableMs = 0; }
      const g = await groupState();
      if (g.idle && !g.pending && g.tasks === 0 && stableMs >= 6000) { finalText = txt; break; }
    }
    await sleep(1500);
  }

  if (finalText === null) {
    return { ask: c.ask, pass: false, note: `no reply within ${TIMEOUT_MS / 1000}s`, finalText: '' };
  }

  const replyPass = replyOk(finalText, c.reply);

  // Tool-call check from the log delta (best-effort — the DB has no tool rows).
  let toolPass = true, toolNote = '', executed = [];
  const want = expectedTool(c);
  try {
    const delta = logFrom(logOff);
    executed = [...delta.matchAll(/Executing tool:\s*([^\s(]+)\(/g)].map((m) => m[1]);
    if (want === null) {
      toolPass = executed.length === 0;
      if (!toolPass) toolNote = `expected no tool, executed [${executed.join(', ')}]`;
    } else {
      toolPass = want.some((w) => executed.includes(w));
      if (!toolPass) toolNote = `expected ${want.join('|')}, executed [${executed.join(', ')}]`;
    }
  } catch {
    toolNote = 'log unreadable — reply-only check';
  }

  const pass = replyPass && toolPass;
  return { ask: c.ask, pass, replyPass, toolPass, toolNote, executed, finalText };
}

const main = async () => {
  let cases = loadCases();
  if (filter) cases = cases.filter((c) => c.id.toLowerCase().includes(filter) || (c.category || '').toLowerCase().includes(filter));

  const g = await groupState();
  if (!g.idle) console.log('⚠ seat is busy — smoke results may be racy; waiting for idle first is safer.');

  console.log(`seat-smoke → base=${BASE} cases=${cases.length}\n`);

  const results = [];
  for (const c of cases) {
    const r = await runCase(c);
    results.push(r);
    const bits = [`reply:${r.replyPass ? 'ok' : 'BAD'}`, `tool:${r.toolPass ? 'ok' : 'BAD'}`];
    console.log(`${r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${c.id}  [${bits.join(' ')}]`);
    if (!r.pass) {
      if (r.toolNote) console.log(`        tool: ${r.toolNote}`);
      console.log(`        reply: "${(r.finalText || '').replace(/\n/g, ' ').slice(0, 160)}"`);
    }
  }

  const nFail = results.filter((r) => !r.pass).length;
  const outDir = path.join(HERE, 'results');
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(path.join(outDir, `smoke-${ts}.json`), JSON.stringify(results, null, 2));

  console.log(`\n${results.length - nFail}/${results.length} passed. ${nFail} failed.`);
  if (nFail) process.exit(1);
};

main().catch((e) => { console.error(`smoke failed: ${e.message}`); process.exit(1); });
