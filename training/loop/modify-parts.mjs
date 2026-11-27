// Step 2 of the training loop: take the newest audit catalog + the user's own
// bug reports and write corrective SFT part rows.
//
//   node modify-parts.mjs
//
// Flow: newest catalog + pending flags (flags/artemis-flags.jsonl — written by
// Artemis's flag_training_error tool and by the app's "Report a bug") →
// cluster the failures by class → ONE global reasoning pass (the analyst reads
// every failure together, sees patterns, and decides the best correction
// strategy per class) → write 1-3 rows per cluster grounded in that plan →
// rows land in orchatlas-parts/s<N>-loop-<date>.jsonl →
// merge_orchatlas_parts.mjs runs as the validation gate (on failure the part
// file is renamed .rejected so the dataset keeps its last-good merged jsonl).
// The analyst model is selectable in the app (default granite4.2:30b); user
// reports carry a last-hour log snapshot the plan pass reads as ground truth.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ANALYST_MODEL, CATALOGS_DIR, clearVram, exitMsg, HERE, log, ollamaChat, parseJsonLoose, TRAINING_DIR, unloadAnalyst } from './lib.mjs';

const PARTS_DIR = path.join(TRAINING_DIR, 'orchatlas-parts');
const SCHEMAS = JSON.parse(readFileSync(path.join(TRAINING_DIR, 'tool_schemas.json'), 'utf8'));
const seatTools = SCHEMAS.merged.map((t) => t.function.name);
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
    (f) => f.classification && f.classification.failure_class && !['not_a_failure', 'unclassified', 'infra_error'].includes(f.classification.failure_class),
  ));
  log(`catalog ${catalogFile}: ${catalog.failures?.length || 0} failures, ${failures.length} trainable (skipping not_a_failure/unclassified/infra_error)`);
} else {
  log('no audit catalog yet — using Artemis flags only');
}
const pendingFlags = readFlags().filter((f) => f.status === 'pending');
for (const f of pendingFlags) {
  const enriched = {
    ...f,
    _isUser: Array.isArray(f.detected_by) && f.detected_by.includes('user'),
  };
  if (f.context_log && existsSync(f.context_log)) {
    try {
      enriched._contextLog = readFileSync(f.context_log, 'utf8').split('\n').slice(-120).join('\n');
    } catch { /* unreadable snapshot — skip */ }
  }
  failures.push(enriched);
}
const userReported = pendingFlags.filter((f) => Array.isArray(f.detected_by) && f.detected_by.includes('user')).length;
log(`Artemis flags: ${pendingFlags.length} pending (${userReported} user-reported)`);
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
if (!seatExemplar) exitMsg('No seat exemplar row found in orchatlas-parts');
log('loaded exemplar rows from existing parts');

// --- 3. clear VRAM for the analyst ---
await clearVram();

// --- 4. cluster, then ONE global reasoning pass, then write rows ---
// Cluster related failures so the analyst sees the whole batch as patterns,
// not isolated one-offs. A single plan pass reads every failure at once
// (catalog + user reports with their last-hour log snapshots) and decides the
// best correction strategy per class BEFORE any row is written.
function clusterFailures(failures) {
  const byClass = new Map();
  for (const f of failures) {
    const cls = (f.classification && f.classification.failure_class) || 'other';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(f);
  }
  const clusters = [];
  for (const [failure_class, members] of byClass.entries()) {
    clusters.push({
      failure_class,
      members,
      ids: members.map((m) => m.id),
    });
  }
  return clusters;
}

const clusters = clusterFailures(failures);
log(`clustered ${failures.length} failures into ${clusters.length} classes`);

const PLAN_SYSTEM = `You are the correction strategist for Warden, an autonomous home-agent, fine-tuned with supervised examples. You are handed a batch of real failures from the agent's log and from the user's own bug reports. Read them ALL, find the patterns, and decide the best way to change the training data before any example is written.

Reply with ONLY valid JSON — no markdown fences, no prose — exactly this shape:
{"patterns":["<one sentence per pattern you see across the batch>"],"clusters":[{"failure_class":"<class>","ids":["<id>",...],"root_cause":"<1-2 sentences>","strategy":"<tool_sequence | refusal | multi_turn>","row_count":<1-3>,"teach":"<the exact behaviour each row must demonstrate>","avoid":"<what the assistant must NOT do>"}]}

Rules:
- One cluster entry per failure_class present in the batch.
- A failure flagged by the user (detected_by contains "user") is GROUND TRUTH: teach exactly the user's correct_behavior, and prefer their reading over the log's.
- strategy: tool_sequence for a wrong tool/arguments, refusal for a guard/policy fix, multi_turn for a dead-end that needs a longer demonstration.
- row_count: 1 if one clean example suffices; up to 3 if the fix needs variants (different tools, or a negative-then-positive pair).
- Be concrete: name the tools and their order, and describe the final answer the assistant must give.`;

function planUserPrompt(clusters) {
  const blocks = clusters.map((cl) => {
    const parts = cl.members.map((f) => {
      const c = f.classification || {};
      let s = `id: ${f.id}\nclass: ${cl.failure_class}\nwhat_went_wrong: ${c.what_went_wrong || ''}\ncorrect_behavior: ${c.correct_behavior || ''}\nsft_hint: ${c.sft_correction_hint || ''}\nlog_excerpt:\n${(f.log_excerpt || '').slice(0, 1500)}`;
      if (f._isUser) s = `USER REPORT (ground truth)\n${s}`;
      if (f._contextLog) s += `\nlast_hour_log_snapshot:\n${f._contextLog.slice(-4000)}`;
      return s;
    });
    return `== failure_class: ${cl.failure_class} (${cl.members.length} failure(s)) ==\n` + parts.join('\n---\n');
  });
  return blocks.join('\n\n');
}

let plan = null;
{
  let attempt = 0;
  while (attempt < 2 && !plan) {
    attempt++;
    const content = await ollamaChat(ANALYST_MODEL, [
      { role: 'system', content: PLAN_SYSTEM },
      { role: 'user', content: attempt === 1 ? planUserPrompt(clusters) : planUserPrompt(clusters) + '\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object.' },
    ], { options: { temperature: 0.3 } });
    plan = parseJsonLoose(content);
  }
}
if (!plan || !Array.isArray(plan.clusters)) {
  stampFlags(false);
  exitMsg('analyst produced no parseable plan — aborting modify (nothing written)');
}
log(`global plan: ${plan.clusters.length} cluster(s); patterns: ${(plan.patterns || []).join(' | ') || '(none)'}`);

// --- 5. write rows per cluster, grounded in the global plan ---
const planByClass = new Map(plan.clusters.map((c) => [c.failure_class, c]));
const WRITE_SYSTEM = (toolNames, exemplar, planEntry) => `You write supervised fine-tuning rows for Warden, an autonomous home-agent. You are given a real failure from the agent's log plus an agreed correction plan, and you write the corrective training example: the turn as it SHOULD have gone.

Reply with ONLY valid JSON — no markdown fences, no prose — a JSON array of 1-3 row objects. Rules, all mandatory:
1. Each row is {"messages":[...]} — messages[0] is exactly {"role":"system","content":"MERGE-STAMPS-THE-LIVE-PROMPT"} (the merge stamps the real prompt over it).
2. The user message MUST begin with exactly this anchor line, then the user's request on the next line: ${ANCHOR}
3. Tool calls may ONLY use tool names from this pool: ${toolNames.join(', ')}. NEVER "atlas".
4. No "tools" field on the row. Optional "repeat":1 is allowed.
5. Tool result messages are {"role":"tool","name":"<tool>","content":"<plausible verbatim result string>"} — realistic and grounded in what the failure's log excerpt shows the tools actually return.
6. The assistant turn demonstrates the plan's "teach" — the right tools called in the right order, the failure avoided — and ends with a short final answer to the user.
7. Write exactly ${planEntry.row_count} row(s), shaped like this real example from the dataset:
${exemplar}`;

const validRows = [];
for (const cl of clusters) {
  const planEntry = planByClass.get(cl.failure_class) || {
    root_cause: '', strategy: 'tool_sequence', row_count: 2, teach: '', avoid: '',
  };
  const toolNames = seatTools;
  const memberSummary = cl.members.map((f) => {
    const c = f.classification || {};
    return `id: ${f.id}${f._isUser ? '\nUSER REPORT (ground truth)' : ''}\nwhat_went_wrong: ${c.what_went_wrong || ''}\ncorrect_behavior: ${c.correct_behavior || ''}\nlog_excerpt:\n${(f.log_excerpt || '').slice(0, 1500)}`;
  }).join('\n---\n');

  const user = `Correction plan for this class:\n${JSON.stringify(planEntry, null, 2)}\n\nFailures to correct:\n${memberSummary}\n\nWrite the corrective row(s) now.`;

  let rows = null;
  let attempt = 0;
  while (attempt < 3 && !rows) {
    attempt++;
    const content = await ollamaChat(ANALYST_MODEL, [
      { role: 'system', content: WRITE_SYSTEM(seatTools, seatExemplar, planEntry) },
      { role: 'user', content: attempt === 1 ? user : user + '\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON array of rows.' },
    ]);
    rows = parseJsonLoose(content);
  }
  if (!Array.isArray(rows)) rows = [];
  if (!rows.length) { log(`cluster ${cl.failure_class}: analyst produced no parseable rows — skipping`); continue; }

  const pool = new Set(toolNames);
  let kept = 0;
  for (const row of rows) {
    const msgs = row?.messages;
    if (!Array.isArray(msgs) || msgs.length < 3 || msgs[0]?.role !== 'system') { log(`cluster ${cl.failure_class}: row rejected (messages shape)`); continue; }
    if (row.tools !== undefined) { delete row.tools; }
    if (typeof msgs[0].content !== 'string' || !msgs[0].content.trim()) msgs[0].content = 'MERGE-STAMPS-THE-LIVE-PROMPT';
    const userMsgs = msgs.filter((m) => m.role === 'user');
    if (!userMsgs.every((m) => String(m.content).startsWith(ANCHOR))) { log(`cluster ${cl.failure_class}: row rejected (missing time anchor)`); continue; }
    let toolOk = true;
    for (const m of msgs) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const n = tc?.function?.name;
          if (!n || n === 'atlas' || !pool.has(n)) { toolOk = false; log(`cluster ${cl.failure_class}: row rejected (unknown tool "${n}")`); break; }
          if (typeof tc.function.arguments === 'string') {
            try { tc.function.arguments = JSON.parse(tc.function.arguments); } catch { toolOk = false; }
          }
          if (typeof tc.function.arguments !== 'object' || tc.function.arguments === null) toolOk = false;
        }
      }
      if (m.role === 'tool' && !pool.has(m.name)) { toolOk = false; log(`cluster ${cl.failure_class}: row rejected (tool result for unknown tool "${m.name}")`); }
      if (!toolOk) break;
    }
    if (!toolOk) continue;
    validRows.push(row);
    kept++;
  }
  // Attribute kept rows to every failure in the cluster (drives flag outcomes).
  for (const f of cl.members) if (f.id) keptById.set(f.id, kept);
  log(`cluster ${cl.failure_class}: ${kept}/${rows.length} rows kept`);
}

if (!validRows.length) {
  stampFlags(false);
  exitMsg('No valid rows written — see rejections above');
}

// --- 6. write the part files (next free s-number, scanned numerically) ---
// Every corrective row is a seat row — one fine-tune, one role.
let maxS = 0;
for (const f of readdirSync(PARTS_DIR)) {
  const m = f.match(/^s(\d+)-/);
  if (m) maxS = Math.max(maxS, parseInt(m[1], 10));
}
const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const seatOut = validRows;
const written = [];
if (seatOut.length) {
  const seatName = `s${maxS + 1}-loop-${date}.jsonl`;
  writeFileSync(path.join(PARTS_DIR, seatName), seatOut.map((r) => JSON.stringify(r)).join('\n') + '\n');
  written.push(seatName);
  log(`wrote ${seatOut.length} seat rows to ${seatName}`);
}

// --- 7. merge as the validation gate ---
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