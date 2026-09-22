// Step 1 of the training loop: audit recent warden.service logs for seat
// failures and catalog them.
//
//   node audit-failures.mjs --days 1|3|7
//
// Flow: read the journald window → slice out failure contexts → clear VRAM →
// classify each slice with granite4.2:30b (JSON in / JSON out) → write
// catalogs/<ts>-<N>d.json. The dashboard's Audit Logs button spawns this.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ansiStrip, ANALYST_MODEL, CATALOGS_DIR, clearVram, exitMsg, log, ollamaChat, parseJsonLoose, readJournal, unloadAnalyst } from './lib.mjs';

// ✅ marks completion, not success — tool errors returned as content still
// print ✅. toolCalls=0 is the dead-end marker. "refused" is the guard family.
const FAILURE_RES = [
  [/✅ .*: Error/, '✅ Error result'],
  [/Error \(exit \d+\)/, 'nonzero exit'],
  [/❌/, 'thrown tool error'],
  [/toolCalls=0/, 'dead-end (no tool calls)'],
  [/I cannot/, 'I cannot… reply'],
  [/I need clarification:/, 'clarification reply'],
  [/refused/, 'guard refusal'],
  [/status":"error"/, 'error turn result'],
  [/browser bridge unavailable/, 'browser bridge down'],
  [/Invalid MCP request or session/, 'MCP session error'],
  [/400 Bad Request/, 'HTTP 400'],
  [/Ollama error/, 'Ollama error'],
  [/Tool cap hit with no final answer/, 'tool cap force-answer'],
  [/Access denied/, 'access denied'],
  [/skipping success writeOutput/, 'skipped success write'],
];
// No turn cap: every failure-shaped turn is cataloged — dropping slices drops
// training data. The 30b classify pass sorts real failures from noise.
const SLICE_LINES = 60;
const SLICE_CHARS = 3000;

const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 3;
if (![1, 3, 7].includes(days)) exitMsg(`--days must be 1, 3, or 7 (got ${days})`);

// --- 1. read the log window ---
const { lines, source } = readJournal(days);
const L = lines.map(ansiStrip);
log(`parsed ${L.length} log lines (source: ${source}, ${days}d window)`);

// --- 2. extract failure slices with turn context ---
// Each hit walks backwards to the enclosing turn marker (New messages /
// Processing messages for owner chat) and forward to the turn's result, so
// the analyst sees the ask's journey, not just the error line. Slices are
// deduped by their back-walk start line.
const turnStarts = [];
for (let i = 0; i < L.length; i++) {
  if (/New messages/.test(L[i]) || /Processing messages for owner chat/.test(L[i])) turnStarts.push(i);
}
const byTurn = new Map(); // turnStart line → slice
for (let i = 0; i < L.length; i++) {
  const detected = FAILURE_RES.filter(([re]) => re.test(L[i])).map(([, label]) => label);
  if (!detected.length) continue;
  // Skip agent-runner chatter that just echoes an error class name in a
  // success context (rare, but "toolCalls=0" appears in normal iteration lines
  // for other iterations' descriptions).
  let start = i;
  for (let t = turnStarts.length - 1; t >= 0; t--) {
    if (turnStarts[t] <= i) { start = turnStarts[t]; break; }
  }
  let end = Math.min(i + SLICE_LINES, L.length);
  for (let j = i; j < end; j++) {
    if (/---WARDEN_OUTPUT_END---/.test(L[j])) { end = j + 1; break; }
  }
  const slice = L.slice(start, Math.min(end, start + SLICE_LINES)).join('\n').slice(0, SLICE_CHARS);
  if (byTurn.has(start)) {
    byTurn.get(start).detected.push(...detected);
  } else {
    byTurn.set(start, { turnLine: start, hitLine: i, detected, slice });
  }
}
const slices = [...byTurn.values()];
log(`${slices.length} failure slices found`);

// --- 3. clear VRAM so the analyst model can load ---
const { unloaded, stillLoaded } = await clearVram();
log(`VRAM cleared (${unloaded.length} models unloaded, still loaded: ${stillLoaded.join(', ') || 'none'})`);

// --- 4. classify each slice with granite4.2:30b ---
const CLASSIFY_SYSTEM = `You are a log analyst for Warden, an autonomous home-agent. You get a failure excerpt from the agent's run log (timestamps, tool calls, tool results). Classify the failure.

Reply with ONLY valid JSON — no markdown fences, no prose — exactly this shape:
{"failure_class":"<one of: tool_error_unrecovered | dead_end_no_tools | refusal | hallucinated_answer | infra_error | not_a_failure | other>","what_went_wrong":"<1-3 sentences>","correct_behavior":"<what the ideal assistant turn would have done>","sft_correction_hint":"<one sentence describing the corrective training example>","candidate_role":"seat or orch — orch only if the failure was in delegation/orchestration","tools_relevant":["<tool names involved>"]}

Classes:
- tool_error_unrecovered: a tool returned an error and the turn never recovered into a correct result
- dead_end_no_tools: the turn answered without acting when acting was required (no tool calls made)
- refusal: the turn claimed an inability or asked for clarification instead of acting
- hallucinated_answer: the turn stated something the log contradicts (invented ids, wrong facts)
- infra_error: the failure is an infrastructure outage (bridge down, Ollama error, MCP session) — the seat behaved sanely
- not_a_failure: the turn behaved correctly (a conversational reply needing no tools, a legitimate boundary, a guard rightly refusing an unasked action) — use this honestly; grep markers like toolCalls=0 also fire on perfectly normal turns
- other: anything else`;

const failures = [];
let unclassified = 0;
for (let s = 0; s < slices.length; s++) {
  if (s % 10 === 0) log(`classifying ${s + 1}/${slices.length}…`);
  const sl = slices[s];
  const user = `Log excerpt (turn context; failure line near the middle):\n\n${sl.slice}`;
  let classification = null;
  let modelRaw = null;
  let attempt = 0;
  while (attempt < 2 && !classification) {
    attempt++;
    const content = await ollamaChat(ANALYST_MODEL, [
      { role: 'system', content: CLASSIFY_SYSTEM },
      { role: 'user', content: attempt === 1 ? user : user + '\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object.' },
    ]);
    classification = parseJsonLoose(content);
    if (!classification) modelRaw = content;
  }
  if (!classification) {
    classification = {
      failure_class: 'unclassified', what_went_wrong: 'analyst reply was not parseable JSON twice',
      correct_behavior: '', sft_correction_hint: '', candidate_role: 'seat', tools_relevant: [],
    };
    unclassified++;
  }
  log(`analyzing failure ${s + 1}/${slices.length} with ${ANALYST_MODEL} — class: ${classification.failure_class}`);
  failures.push({
    id: `f${String(s + 1).padStart(3, '0')}`,
    detected_by: [...new Set(sl.detected)],
    log_excerpt: sl.slice,
    classification,
    model_raw: modelRaw,
  });
}

// --- 5. write the catalog ---
mkdirSync(CATALOGS_DIR, { recursive: true });
const ts = new Date();
const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
const file = path.join(CATALOGS_DIR, `${stamp}-${days}d.json`);
writeFileSync(file, JSON.stringify({
  version: 1,
  generated_at: ts.toISOString(),
  days,
  source,
  log_lines_scanned: L.length,
  failure_slices_found: slices.length,
  classifiers: { model: ANALYST_MODEL, unclassified },
  failures,
}, null, 2));
log(`wrote catalog ${file} (${failures.length - unclassified} classified, ${unclassified} unclassified)`);

await unloadAnalyst();
log('audit done');