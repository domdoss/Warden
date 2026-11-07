#!/usr/bin/env node
// seat-tests/pool.mjs — triage run.mjs failures into code fixes vs training rows.
//
//   node pool.mjs
//
// Reads results/failures.jsonl (appended by run.mjs across runs), classifies each
// failure by layer, and writes:
//   results/triage.md          — surfaced summary (code fixes → me; train rows → gate)
//   results/pooled-train.jsonl — accumulated train-fixable failures, deduped by id
//
// Classification rule (matches the two confirmed decisions):
//   Layer A failure  → "code"   (dynamic-selection / tool description / prompt boundary)
//   Layer B failure  → "train"  (model behavior: wrong tool/args, or reply confabulation)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { HERE } from './lib.mjs';

const outDir = path.join(HERE, 'results');
const failuresPath = path.join(outDir, 'failures.jsonl');
const triagePath = path.join(outDir, 'triage.md');
const pooledPath = path.join(outDir, 'pooled-train.jsonl');

// Known code-fix signatures → file/line + suggested change. Surfaced verbatim so
// a recurring failure points at its real cause instead of re-diagnosing each run.
// Matched on the failure id or the Layer-A note substring.
const KNOWN_FIXES = [
  {
    match: /mcp__marm__marm_smart_recall not in top-/,
    fix: 'MARM recall never ranks for "remember/find/where did I put" asks — its live description ("Recall memories by semantic similarity…") has no trigger words like "remember"/"where did I put"/"do you know"/"what did we decide". Same failure mode as `project` (fixed 2026-11-06 by always-in). Two options:\n' +
      '  (A) always-in — add `mcp__marm__marm_smart_recall` to the seat\'s always-in set in container/agent-runner/src/index.ts mergeSkillTools (ALWAYS_IN_CORE ~line 4342, or a new recall-specific set). Marm recall is passive (needs `query`, won\'t fire on a greeting), so near-empty-menu safety holds.\n' +
      '  (B) fix the signal — in dynamic-selection.ts rankTools, when keywords intersect a recall-trigger set (remember, find, recall, lookup, look up, where did I put, do you know, what did we decide, did we discuss, did I save), force-rank mcp__marm__marm_smart_recall into top-K. (B) keeps the greeting menu strictly minimal; (A) matches the `project` precedent.',
  },
];

function knownFix(entry) {
  for (const k of KNOWN_FIXES) {
    if (k.match.test(entry.why) || (entry.id && k.match.test(entry.id))) return k.fix;
  }
  return '';
}

if (!existsSync(failuresPath)) {
  console.log('no failures.jsonl yet — run `node run.mjs` first');
  process.exit(0);
}

const raw = readFileSync(failuresPath, 'utf8').split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

// latest failure per id (dedupe by id; ask is implied by id's case)
const byId = new Map();
for (const f of raw) byId.set(f.id, f);

const code = [];
const train = [];
for (const f of byId.values()) {
  const aFail = f.layerA && !f.layerA.pass;
  const bFail = f.layerB && (!f.layerB.callPass || !f.layerB.replyPass);
  const entry = {
    id: f.id, category: f.category, ask: f.ask, ts: f.ts, model: f.model,
    why: aFail ? `rank: ${f.layerA.note}` : (bFail
      ? [f.layerB.callPass ? '' : `call: ${f.layerB.callNote} (got ${(f.layerB.calls || []).join(' → ') || 'none'})`,
         f.layerB.replyPass ? '' : `reply: ${(f.layerB.finalText || '').replace(/\n/g, ' ').slice(0, 120)}`]
          .filter(Boolean).join(' | ')
      : ''),
  };
  if (aFail) code.push(entry);
  else if (bFail) train.push(entry);
}

// ---- triage.md (surfaced report) ------------------------------------------
const lines = [];
lines.push(`# seat-tests triage — ${new Date().toISOString()}`);
lines.push('');
lines.push(`- **${code.length} code fix(es)**, **${train.length} training row(s)** pending`);
lines.push('');
if (code.length) {
  lines.push('## Fix in warden (surfaced — not auto-applied)');
  for (const c of code) {
    lines.push(`- **${c.id}** — ${c.why}`);
    const fx = knownFix(c);
    if (fx) lines.push(`  - **suggested fix:** ${fx.replace(/\n/g, '\n    ')}`);
  }
  lines.push('');
}
if (train.length) {
  lines.push('## Pool for retrain (gated — review then approve)');
  for (const t of train) lines.push(`- **${t.id}** — ${t.why}`);
  lines.push('');
}
if (!code.length && !train.length) lines.push('## Nothing to triage — all clear.');
writeFileSync(triagePath, lines.join('\n'));

// ---- pooled-train.jsonl (accumulated train-fixable, deduped) ----------------
const seen = new Set();
if (existsSync(pooledPath)) {
  for (const l of readFileSync(pooledPath, 'utf8').split('\n').filter(Boolean)) {
    try { seen.add(JSON.parse(l).id); } catch { /* skip */ }
  }
}
const toAppend = train.filter((t) => !seen.has(t.id));
if (toAppend.length) {
  writeFileSync(pooledPath, toAppend.map((t) => JSON.stringify(t)).join('\n') + '\n', { flag: 'a' });
}

console.log(`triage → ${code.length} code, ${train.length} train (${toAppend.length} newly pooled)`);
console.log(`surfaced report → ${triagePath}`);
console.log(`pooled rows     → ${pooledPath}`);
if (code.length) console.log('\nCODE FIXES (surface, do not auto-apply):');
for (const c of code) {
  console.log(`  - ${c.id}: ${c.why}`);
  const fx = knownFix(c);
  if (fx) console.log(`      fix → ${fx.replace(/\n/g, '\n      ')}`);
}
if (train.length) console.log('\nTRAIN ROWS (gated batch):');
for (const t of train) console.log(`  - ${t.id}: ${t.why}`);
