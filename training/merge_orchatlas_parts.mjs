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
import path from 'node:path';
import { extractFewModeSystemPrompt } from './extract_runner_source.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PARTS_DIR = path.join(HERE, 'orchatlas-parts');
const SCHEMAS = JSON.parse(readFileSync(path.join(HERE, 'tool_schemas.json'), 'utf8'));
const TOOLS = SCHEMAS.merged;
if (!TOOLS || !Array.isArray(TOOLS) || TOOLS.length === 0) {
  throw new Error('tool_schemas.json has no merged toolset — run node dump_tool_schemas.mjs first.');
}
const toolNames = new Set(TOOLS.map((t) => t.function.name));

// The exact system prompt every row will carry: the live few-mode seat prompt,
// extracted from the runner SOURCE right now. An edited ORCH_SYSTEM flows into
// the dataset on the next merge; a moved/renamed const throws here instead of
// silently training on a stale prompt.
const SYSTEM = extractFewModeSystemPrompt();

const ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).';

const files = readdirSync(PARTS_DIR).filter((f) => f.endsWith('.jsonl')).sort();
const out = [];
const errors = [];
for (const f of files) {
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
    msgs[0].content = SYSTEM;
    // Normalize benign shape drift from the hand-writing subagents before
    // validating: arguments written as a JSON string → parsed object, and tool
    // result messages missing their name → the k-th pending tool call's name
    // (assistant tool_calls are always followed by their tool messages in order).
    const pending = [];
    for (const m of msgs) {
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
    for (const m of msgs) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const n = tc.function?.name;
          if (!n || !toolNames.has(n)) errors.push(`${where}: unknown tool "${n}"`);
          if (typeof tc.function?.arguments !== 'object' || tc.function.arguments === null) {
            errors.push(`${where}: arguments not an object (${n})`);
          }
        }
      }
      if (m.role === 'tool' && !toolNames.has(m.name)) errors.push(`${where}: tool result for unknown tool "${m.name}"`);
    }
    out.push({ messages: msgs, tools: TOOLS });
  });
}

if (errors.length) {
  console.error(`${errors.length} validation errors:`);
  for (const e of errors.slice(0, 40)) console.error(`  ${e}`);
  process.exit(1);
}

// Reject exact-duplicate rows (identical messages) across parts.
const seen = new Set();
const unique = [];
for (const r of out) {
  const k = JSON.stringify(r.messages);
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(r);
}
const dupes = out.length - unique.length;

writeFileSync(path.join(HERE, 'orchatlas-sft.jsonl'), unique.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`Merged ${files.length} part files → ${unique.length} rows (${TOOLS.length} tools/row, ${dupes} exact duplicates dropped)`);
console.log(`System prompt: ${SYSTEM.length} chars, extracted live from the runner source`);