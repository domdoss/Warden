// Merge the subagent-written orchatlas part files into orchatlas-sft.jsonl.
//
//   node merge_orchatlas_parts.mjs   →  writes orchatlas-sft.jsonl
//
// The two things that used to drift now both come from the LIVE runner at
// merge time, never from a static copy (2026-09-19; before this, _sys.txt had
// already drifted 4571 → live-prompt chars and the 57-tool schema carried six
// tools the seat can never call):
//   - the system prompt: extracted from container/agent-runner/src/index.ts
//     via extract_runner_source.mjs (ORCH_SYSTEM + the few-mode ESCALATION
//     block with the crew roster generated from SUBAGENTS). The merge STAMPS
//     it over every row's messages[0], so part files don't need to carry it —
//     there is no _sys.txt to go stale.
//   - the tools array: tool_schemas.json's `merged`, itself dumped from the
//     live registry + runner source (dump_tool_schemas.mjs).
//
// Everything else is the same mechanical contract as before: parts in
// filename order, per-row validation (time anchor, known tool names, call↔result
// pairing), identical tools array injected into every row, exact-duplicate
// rejection.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { extractFewModeSystemPrompt } from './extract_runner_source.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PARTS_DIR = path.join(HERE, 'orchatlas-parts');

// Re-dump the tool schemas from the live registry + runner source BEFORE
// reading them. The Sep 21 static copy had already drifted from the live
// descriptions (0a9efd6's clamped generate_pdf/query_image text never reached
// the corpus) — a stale stamp trains descriptions the runner no longer serves.
// Same principle as the live system-prompt stamp below.
execSync('node dump_tool_schemas.mjs', { cwd: HERE, stdio: 'inherit' });
const SCHEMAS = JSON.parse(readFileSync(path.join(HERE, 'tool_schemas.json'), 'utf8'));

// One role trains in this dataset — the Atlas seat:
//   seat (every part file): the atlas seat's few-mode prompt + the merged
//     75-tool model-visible universe. Multi-specialist work is the seat's
//     own: it calls vulkan/iris/artemis/sentry directly and verifies each
//     result with read_job_result (never atlas — the seat IS atlas).
const ROLES = {
  seat: { system: extractFewModeSystemPrompt(), tools: SCHEMAS.merged },
};
for (const [name, r] of Object.entries(ROLES)) {
  if (!Array.isArray(r.tools) || r.tools.length === 0) {
    throw new Error(`tool_schemas.json is missing the ${name} toolset — run node dump_tool_schemas.mjs first.`);
  }
  r.toolNames = new Set(r.tools.map((t) => t.function.name));
}

const ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).';

const files = readdirSync(PARTS_DIR).filter((f) => f.endsWith('.jsonl')).sort();
const out = [];
const errors = [];
for (const f of files) {
  const role = ROLES.seat;
  const lines = readFileSync(path.join(PARTS_DIR, f), 'utf8').split('\n').filter((l) => l.trim());
  lines.forEach((line, i) => {
    const where = `${f}:${i + 1}`;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      errors.push(`${where}: not valid JSON`);
      return;
    }
    if (row.tools !== undefined) errors.push(`${where}: carries its own tools field`);
    // Optional per-row upweight: `"repeat": 2` emits the row that many times —
    // the intentional way to fatten a thin section (an exact copy written by
    // hand into two files is still rejected as a duplicate below; only an
    // explicit repeat multiplies).
    let repeat = 1;
    if (row.repeat !== undefined) {
      repeat = Math.floor(Number(row.repeat));
      if (!(repeat >= 1 && repeat <= 4)) errors.push(`${where}: repeat must be 1-4`);
      repeat = Math.min(4, Math.max(1, repeat || 1));
    }
    const msgs = row.messages;
    if (!Array.isArray(msgs) || msgs.length < 3) {
      errors.push(`${where}: messages missing/short`);
      return;
    }
    if (msgs[0].role !== 'system') {
      errors.push(`${where}: messages[0] is not a system message`);
      return;
    }
    // Stamp the live prompt over whatever the part carries (the part files were
    // written against older prompts; the merge is where the one true copy
    // lives — this is the step that makes prompt drift impossible).
    msgs[0].content = role.system;
    // Normalize benign shape drift from the hand-writing subagents before
    // validating: arguments written as a JSON string → parsed object, and tool
    // result messages missing their name → the k-th pending tool call's name
    // (assistant tool_calls are always followed by their tool messages in order).
    const pending = [];
    for (const m of msgs) {
      // Gate: every tool call must be answered before the conversation moves
      // on. An answer or a new user message arriving with calls still pending
      // is the answer-without-grounding shape (s7-1, 2026-10-08 audit: 14
      // rows claimed actions whose results never existed).
      if (pending.length && (m.role === 'user' || (m.role === 'assistant' && !Array.isArray(m.tool_calls)))) {
        errors.push(`${where}: ${pending.length} unanswered tool call(s) before the next ${m.role} message (${pending.join(', ')})`);
        pending.length = 0;
      }
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (typeof tc.function?.arguments === 'string') {
            try {
              tc.function.arguments = JSON.parse(tc.function.arguments);
            } catch {
              errors.push(`${where}: arguments string does not parse (${tc.function.name})`);
            }
          }
          pending.push(tc.function?.name);
        }
      }
      if (m.role === 'tool') {
        if (!m.name || m.name === 'undefined') {
          m.name = pending.shift();
          if (!m.name) errors.push(`${where}: tool result with no name and no pending call`);
        } else {
          // Consume the matching pending call so association stays aligned.
          const idx = pending.indexOf(m.name);
          if (idx !== -1) pending.splice(idx, 1);
        }
      }
    }
    const userMsgs = msgs.filter((m) => m.role === 'user');
    if (!userMsgs.every((m) => String(m.content).startsWith(ANCHOR))) {
      errors.push(`${where}: user message missing the time anchor`);
    }
    // Gate: a turn must END with a real answer. An empty final assistant
    // message trains the model to emit end-of-turn right after the role
    // header — silent turns (216 merged rows, 9.2% of the corpus, 2026-10-08
    // audit). Trailing unanswered calls are caught by the drain gate above.
    const lastMsg = msgs[msgs.length - 1];
    if (!(lastMsg.role === 'assistant' && typeof lastMsg.content === 'string' && lastMsg.content.trim())) {
      errors.push(`${where}: final message is not a non-empty assistant answer`);
    }
    for (const m of msgs) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const n = tc.function?.name;
          if (!n || !role.toolNames.has(n)) errors.push(`${where}: unknown tool "${n}"`);
          if (n === 'atlas') errors.push(`${where}: delegates to atlas (the seat IS atlas — it cannot call itself)`);
          if (typeof tc.function?.arguments !== 'object' || tc.function.arguments === null) {
            errors.push(`${where}: arguments not an object (${n})`);
          }
        }
      }
      if (m.role === 'tool' && !role.toolNames.has(m.name)) errors.push(`${where}: tool result for unknown tool "${m.name}"`);
    }
    out.push({ row: { messages: msgs, tools: role.tools }, repeat });
  });
}

if (errors.length) {
  console.error(`${errors.length} validation errors:`);
  for (const e of errors.slice(0, 40)) console.error(`  ${e}`);
  process.exit(1);
}

// Reject exact-duplicate rows (identical messages) across parts — but a row's
// own `repeat` stands: the FIRST occurrence carries the upweight, and a later
// exact copy elsewhere is still just a duplicate.
const seen = new Set();
const unique = [];
for (const r of out) {
  const k = JSON.stringify(r.row.messages);
  if (seen.has(k)) continue;
  seen.add(k);
  for (let i = 0; i < r.repeat; i++) unique.push(r.row);
}
const distinct = seen.size;
const droppedDupes = out.length - distinct;
const repeatCopies = unique.length - distinct;

writeFileSync(path.join(HERE, 'orchatlas-sft.jsonl'), unique.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`Merged ${files.length} part files → ${unique.length} rows (${distinct} unique, ${repeatCopies} repeat-upweighted, ${droppedDupes} exact duplicates dropped)`);
console.log(`seat: ${ROLES.seat.system.length}-char prompt, ${ROLES.seat.tools.length} tools — extracted live from the runner source`);