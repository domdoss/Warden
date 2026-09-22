// Step 2 of the training loop: take the newest audit catalog and write
// corrective SFT part rows with granite4.2:30b.
//
//   node modify-parts.mjs
//
// Flow: newest catalog + Artemis's pending flags (flags/artemis-flags.jsonl,
// written by the flag_training_error tool) → for each classified failure, the analyst writes 1-2
// part rows (validated locally against the merge contract) → rows land in
// orchatlas-parts/s<N>-loop-<date>.jsonl → merge_orchatlas_parts.mjs runs as
// the validation gate (on failure the part file is renamed .rejected so the
// dataset keeps its last-good merged jsonl).
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ANALYST_MODEL, CATALOGS_DIR, clearVram, exitMsg, HERE, log, ollamaChat, parseJsonLoose, TRAINING_DIR, unloadAnalyst } from './lib.mjs';

const PARTS_DIR = path.join(TRAINING_DIR, 'orchatlas-parts');
const SCHEMAS = JSON.parse(readFileSync(path.join(TRAINING_DIR, 'tool_schemas.json'), 'utf8'));
const seatTools = SCHEMAS.merged.map((t) => t.function.name);
const orchTools = SCHEMAS.orchPool.map((t) => t.function.name);
const FLAGS_FILE = path.join(HERE, 'flags', 'artemis-flags.jsonl');

function readFlags() {
  if (!existsSync(FLAGS_FILE)) return [];
  return readFileSync(FLAGS_FILE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/** Stamp every flag this run processed as consumed, with its outcome:
 * merged (rows landed), rejected (merge gate refused the batch), no_rows
 * (the analyst produced no valid row for it). Re-reads the file right before
 * writing so a flag Artemis added mid-run stays pending. */
function stampFlags(mergeOk) {
  if (!pendingFlags.length) return;
  const processed = new Set(pendingFlags.map((f) => f.id));
  const now = new Date().toISOString();
  const all = readFlags().map((f) => {
    if (!processed.has(f.id) || f.status !== 'pending') return f;
    const kept = keptById.get(f.id) || 0;
    return { ...f, status: 'consumed', consumed_at: now, outcome: kept ? (mergeOk ? 'merged' : 'rejected') : 'no_rows' };
  });
  const tmp = `${FLAGS_FILE}.tmp`;
  writeFileSync(tmp, all.map((f) => JSON.stringify(f)).join('\n') + '\n');
  renameSync(tmp, FLAGS_FILE);
  log(`stamped ${processed.size} Artemis flag(s) consumed`);
}
const ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).';

// --- 1. newest catalog + Artemis's pending flags ---
const catalogs = existsSync(CATALOGS_DIR) ? readdirSync(CATALOGS_DIR).filter((f) => f.endsWith('.json')).sort() : [];
const failures = [];
if (catalogs.length) {
  const catalogFile = catalogs[catalogs.length - 1];
  const catalog = JSON.parse(readFileSync(path.join(CATALOGS_DIR, catalogFile), 'utf8'));
  failures.push(...(catalog.failures || []).filter(
    (f) => f.classification && f.classification.failure_class && !['not_a_failure', 'unclassified'].includes(f.classification.failure_class),
  ));
  log(`catalog ${catalogFile}: ${catalog.failures?.length || 0} failures, ${failures.length} trainable (skipping not_a_failure/unclassified)`);
} else {
  log('no audit catalog yet — using Artemis flags only');
}
const pendingFlags = readFlags().filter((f) => f.status === 'pending');
failures.push(...pendingFlags);
log(`Artemis flags: ${pendingFlags.length} pending`);
if (!failures.length) exitMsg('No trainable failures in the newest catalog or Artemis flags — nothing to write');
// Rows kept per failure id — decides each flag's outcome when it is stamped.
const keptById = new Map();

// --- 2. exemplars: real rows from existing parts fix the row shape ---
function exemplarFor(prefix) {
  const files = readdirSync(PARTS_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl')).sort();
  for (const f of files) {
    const lines = readFileSync(path.join(PARTS_DIR, f), 'utf8').split('\n').filter((l) => l.trim());
    if (lines.length) return lines[0];
  }
  return null;
}
const seatExemplar = exemplarFor('s');
const orchExemplar = exemplarFor('orch-');
if (!seatExemplar) exitMsg('No seat exemplar row found in orchatlas-parts');
log('loaded exemplar rows from existing parts');

// --- 3. clear VRAM for the analyst ---
await clearVram();

// --- 4. analyst writes rows per failure ---
const WRITE_SYSTEM = (role, toolNames, exemplar) => `You write supervised fine-tuning rows for Warden, an autonomous home-agent. You are given a real failure from the agent's log plus its classification, and you write the corrective training example: the turn as it SHOULD have gone.

Reply with ONLY valid JSON — no markdown fences, no prose — a JSON array of 1-2 row objects. Rules, all mandatory:
1. Each row is {"messages":[...]} — messages[0] is exactly {"role":"system","content":"MERGE-STAMPS-THE-LIVE-PROMPT"} (the merge stamps the real prompt over it).
2. The user message MUST begin with exactly this anchor line, then the user's request on the next line: ${ANCHOR}
3. Tool calls may ONLY use tool names from this pool: ${toolNames.join(', ')}. NEVER "atlas".
4. No "tools" field on the row. Optional "repeat":1 is allowed.
5. Tool result messages are {"role":"tool","name":"<tool>","content":"<plausible verbatim result string>"} — realistic and grounded in what the failure's log excerpt shows the tools actually return.
6. The assistant turn demonstrates correct_behavior: the right tools called in the right order, the failure avoided, and it ends with a short final answer to the user.
7. Shape each row exactly like this real example from the dataset:
${exemplar}`;

const validRows = [];
for (let i = 0; i < failures.length; i++) {
  const f = failures[i];
  const c = f.classification;
  const role = c.candidate_role === 'orch' && orchExemplar ? 'orch' : 'seat';
  const toolNames = role === 'orch' ? orchTools : seatTools;
  const exemplar = role === 'orch' ? orchExemplar : seatExemplar;
  const user = `Failure classification:
${JSON.stringify(c, null, 2)}

Log excerpt of the actual failed turn:
${f.log_excerpt}

Write the corrective row(s) now.`;
  let rows = null;
  let attempt = 0;
  while (attempt < 2 && !rows) {
    attempt++;
    const content = await ollamaChat(ANALYST_MODEL, [
      { role: 'system', content: WRITE_SYSTEM(role, toolNames, exemplar) },
      { role: 'user', content: attempt === 1 ? user : user + '\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON array of rows.' },
    ]);
    rows = parseJsonLoose(content);
  }
  if (!Array.isArray(rows)) rows = [];
  if (!rows.length) { log(`failure ${f.id}: analyst produced no parseable rows — skipping`); continue; }

  const pool = new Set(toolNames);
  let kept = 0;
  for (const row of rows) {
    const msgs = row?.messages;
    if (!Array.isArray(msgs) || msgs.length < 3 || msgs[0]?.role !== 'system') { log(`failure ${f.id}: row rejected (messages shape)`); continue; }
    if (row.tools !== undefined) { delete row.tools; }
    if (typeof msgs[0].content !== 'string' || !msgs[0].content.trim()) msgs[0].content = 'MERGE-STAMPS-THE-LIVE-PROMPT';
    const userMsgs = msgs.filter((m) => m.role === 'user');
    if (!userMsgs.every((m) => String(m.content).startsWith(ANCHOR))) { log(`failure ${f.id}: row rejected (missing time anchor)`); continue; }
    let toolOk = true;
    for (const m of msgs) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const n = tc?.function?.name;
          if (!n || n === 'atlas' || !pool.has(n)) { toolOk = false; log(`failure ${f.id}: row rejected (unknown tool "${n}")`); break; }
          if (typeof tc.function.arguments === 'string') {
            try { tc.function.arguments = JSON.parse(tc.function.arguments); } catch { toolOk = false; }
          }
          if (typeof tc.function.arguments !== 'object' || tc.function.arguments === null) toolOk = false;
        }
      }
      if (m.role === 'tool' && !pool.has(m.name)) { toolOk = false; log(`failure ${f.id}: row rejected (tool result for unknown tool "${m.name}")`); }
      if (!toolOk) break;
    }
    if (!toolOk) continue;
    validRows.push(row);
    kept++;
  }
  keptById.set(f.id, kept);
  log(`failure ${f.id} (${c.failure_class}, ${role}): ${kept}/${rows.length} rows kept`);
}

if (!validRows.length) {
  stampFlags(false);
  exitMsg('No valid rows written — see rejections above');
}

// --- 5. write the part files (next free s-number, scanned numerically) ---
// Role is determined per row from the tools it actually calls: orch rows must
// live in an orch-* file or merge validates them against the wrong pool.
// Seat rows that happen to use only shared tools (e.g. iris) stay seat.
function rowRole(r) {
  const names = [];
  for (const m of r.messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) names.push(...m.tool_calls.map((tc) => tc?.function?.name));
    if (m.role === 'tool') names.push(m.name);
  }
  const orchSet = new Set(orchTools);
  const allOrch = names.length > 0 && names.every((n) => orchSet.has(n));
  return allOrch && orchExemplar ? 'orch' : 'seat';
}
let maxS = 0;
for (const f of readdirSync(PARTS_DIR)) {
  const m = f.match(/^s(\d+)-/);
  if (m) maxS = Math.max(maxS, parseInt(m[1], 10));
}
const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const seatOut = validRows.filter((r) => rowRole(r) === 'seat');
const orchOut = validRows.filter((r) => rowRole(r) === 'orch');
const written = [];
if (seatOut.length) {
  const seatName = `s${maxS + 1}-loop-${date}.jsonl`;
  writeFileSync(path.join(PARTS_DIR, seatName), seatOut.map((r) => JSON.stringify(r)).join('\n') + '\n');
  written.push(seatName);
  log(`wrote ${seatOut.length} seat rows to ${seatName}`);
}
if (orchOut.length) {
  const orchName = `orch-loop-${date}.jsonl`;
  writeFileSync(path.join(PARTS_DIR, orchName), orchOut.map((r) => JSON.stringify(r)).join('\n') + '\n');
  written.push(orchName);
  log(`wrote ${orchOut.length} orch rows to ${orchName}`);
}

// --- 6. merge as the validation gate ---
const { spawnSync } = await import('node:child_process');
const merge = spawnSync('node', ['merge_orchatlas_parts.mjs'], { cwd: TRAINING_DIR, encoding: 'utf8' });
if (merge.status !== 0) {
  for (const w of written) renameSync(path.join(PARTS_DIR, w), path.join(PARTS_DIR, `${w}.rejected`));
  log(`merge REJECTED the rows — part file(s) renamed .rejected (dataset keeps its last-good jsonl)`);
  const errOut = (merge.stderr || merge.stdout || '').trim().split('\n').slice(0, 20).join('\n');
  log(`merge errors:\n${errOut}`);
  stampFlags(false);
  exitMsg('modify step failed validation — no rows landed in the dataset');
}
stampFlags(true);
log(`merge OK — ${(merge.stdout || '').trim().split('\n').filter((l) => l.startsWith('Merged')).join(' ')}`);

await unloadAnalyst();
log('modify done');