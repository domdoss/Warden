#!/usr/bin/env node
// seat-tests/run.mjs — run the seat test corpus and write a report + failures.
//
//   node run.mjs                       # both layers against orchatlas-ft
//   MODEL=granite4.2:8b LAYER=A node run.mjs   # selection only, base model
//   LAYER=B node run.mjs               # model tests only
//   CASES=media node run.mjs           # only cases whose id/category matches
//   NO_REFRESH=1 node run.mjs          # skip re-dumping tool schemas
//
// Outputs: results/<ts>.json, failures.jsonl (appended), report.md.
// Exits non-zero on any failure so loop.sh can gate on it.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  HERE, loadCases, loadToolSchemas, systemPrompt, selection, rankPass, recallOk, runModelCase,
} from './lib.mjs';

const MODEL = process.env.MODEL || 'orchatlas-ft';
const LAYER = process.env.LAYER || 'both'; // both | A | B
const filter = process.env.CASES || '';

let cases = loadCases();
if (filter) {
  const f = filter.toLowerCase();
  cases = cases.filter((c) => c.id.toLowerCase().includes(f) || (c.category || '').toLowerCase().includes(f));
}

const { merged } = loadToolSchemas();
const system = systemPrompt();

const doA = LAYER === 'both' || LAYER === 'A';
const doB = LAYER === 'both' || LAYER === 'B';

console.log(`seat-tests → model=${MODEL} layer=${LAYER} cases=${cases.length}\n`);

const results = [];
const failures = [];

for (const c of cases) {
  const r = { id: c.id, category: c.category || '', ask: c.ask, layerA: null, layerB: null, pass: true };

  if (doA && c.rank) {
    const { ranked } = selection(c.ask, merged);
    const a = rankPass(ranked, c.rank);
    r.layerA = { pass: a.pass, note: a.note, ranked };
    if (!a.pass) r.pass = false;
  }

  if (doA && c.recall) {
    const rec = recallOk(c.ask);
    const rNote = rec ? '' : 'shouldAutoRecall false (recall ask not recognized)';
    r.layerA = r.layerA
      ? { ...r.layerA, pass: r.layerA.pass && rec, note: [r.layerA.note, rNote].filter(Boolean).join('; '), recallPass: rec }
      : { pass: rec, note: rNote, recallPass: rec };
    if (!rec) r.pass = false;
  }

  if (doB) {
    try {
      const b = await runModelCase(c, { model: MODEL, system, merged });
      r.layerB = b;
      if (!b.callPass || !b.replyPass) r.pass = false;
    } catch (e) {
      r.layerB = { callPass: false, callNote: '', replyPass: false, replyNote: `ERROR: ${e.message}`, calls: [], finalText: '' };
      r.pass = false;
    }
  }

  results.push(r);

  const parts = [];
  if (r.layerA) parts.push(`A:${r.layerA.pass ? 'ok' : 'BAD'}`);
  if (r.layerB) parts.push(`call:${r.layerB.callPass ? 'ok' : 'BAD'} reply:${r.layerB.replyPass ? 'ok' : 'BAD'}`);
  console.log(`${r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${c.id}  [${parts.join(' ')}]`);
  if (!r.pass) {
    failures.push(r);
    if (r.layerA && !r.layerA.pass) console.log(`        rank: ${r.layerA.note} | ranked=[${r.layerA.ranked.join(', ')}]`);
    if (r.layerB && (!r.layerB.callPass || !r.layerB.replyPass)) {
      console.log(`        calls: ${r.layerB.calls.join(' → ') || '(none)'}`);
      if (r.layerB.callNote) console.log(`        callNote: ${r.layerB.callNote}`);
      if (r.layerB.replyNote) console.log(`        reply: ${r.layerB.replyNote} | "${(r.layerB.finalText || '').replace(/\n/g, ' ').slice(0, 140)}"`);
    }
  }
}

// ---- write outputs -------------------------------------------------------------
const outDir = path.join(HERE, 'results');
mkdirSync(outDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const resultsPath = path.join(outDir, `${ts}.json`);
const failuresPath = path.join(outDir, 'failures.jsonl');
const reportPath = path.join(outDir, 'report.md');

writeFileSync(resultsPath, JSON.stringify(results, null, 2));

const flines = failures.map((f) => JSON.stringify({
  ts, model: MODEL, id: f.id, category: f.category, ask: f.ask,
  layerA: f.layerA, layerB: f.layerB,
})).join('\n') + (failures.length ? '\n' : '');
// Snapshot of THIS run's failures (overwrite, not append): a case that passes
// now must disappear from triage. Cross-run accumulation lives in
// results/pooled-train.jsonl (pool.mjs appends + dedupes).
writeFileSync(failuresPath, flines);

const nPass = results.filter((r) => r.pass).length;
const nFail = results.length - nPass;

writeFileSync(reportPath, [
  `# seat-tests report — ${MODEL} (${LAYER})`,
  '',
  `- ${new Date().toISOString()}`,
  `- **${nPass}/${results.length} passed**${nFail ? `, ${nFail} failed` : ''}`,
  '',
  failures.length
    ? '## Failures\n' + failures.map((f) => {
        const bits = [];
        if (f.layerA && !f.layerA.pass) bits.push(`rank: ${f.layerA.note}`);
        if (f.layerB && !f.layerB.callPass) bits.push(`call: ${f.layerB.callNote} (got ${f.layerB.calls.join(' → ') || 'none'})`);
        if (f.layerB && !f.layerB.replyPass) bits.push(`reply: ${f.layerB.replyNote} — "${(f.layerB.finalText || '').replace(/\n/g, ' ').slice(0, 120)}"`);
        return `- **${f.id}** — ${bits.join(' | ')}`;
      }).join('\n')
    : '## No failures',
  '',
].join('\n'));

console.log(`\n${nPass}/${results.length} passed. ${nFail} failed.`);
console.log(`results → ${resultsPath}`);
console.log(`failures → ${failuresPath} (appended)`);
console.log(`report  → ${reportPath}`);

if (nFail) process.exit(1);
