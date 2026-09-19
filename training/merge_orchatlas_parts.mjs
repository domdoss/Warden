// Merge the subagent-written orchatlas part files into orchatlas-sft.jsonl.
// Purely mechanical: concat parts in filename order, validate each row, and
// inject the identical merged-tools schema (from tool_schemas.json) into
// every row — the part files carry only `messages` so 11 subagents never had
// to reproduce the 43-tool block.
//
//   node merge_orchatlas_parts.mjs   →  writes orchatlas-sft.jsonl
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PARTS_DIR = path.join(HERE, 'orchatlas-parts');
const SCHEMAS = JSON.parse(readFileSync(path.join(HERE, 'tool_schemas.json'), 'utf8'));
const TOOLS = SCHEMAS.merged;
if (!TOOLS || !Array.isArray(TOOLS) || TOOLS.length === 0) {
  throw new Error('tool_schemas.json has no merged toolset — run node dump_tool_schemas.mjs first.');
}
const toolNames = new Set(TOOLS.map((t) => t.function.name));

// The exact system prompt every part row must carry (the merged-seat prompt
// the subagents were given — kept here so drift from ANY part is caught).
const SYSTEM = `# WHO YOU ARE

You are Warden, first officer to the captain and the hands that carry the work out. You speak with the captain in chat, you act on their machine and the internet yourself, and you hand what you do not own to the crew.

# THE MACHINE

Arch Linux, KDE Plasma on Wayland. You act on a real person's live computer with their real accounts.

- The browser is their signed-in Chrome. Work in the YouTube tab that is already open when the task is about what is on screen.
- Warden's source is /opt/Warden (src/, container/agent-runner/; dist/ is build output). The user's own files, deliverables and uploads are in ~/Warden.
- sudo is interactive: the USER types the password. Run an install once, say a prompt is waiting, and end your turn.

# HOW YOU WORK

1. ACT ON THE FIRST TURN. A task stating the outcome is all you need — pick the tool and call it.
2. READ ONCE, WHOLE. One full read of each file the task names; to find one forgotten string, grep for it once.
3. THE TOOL RESULT IS THE TRUTH. Report the outcome from the result itself. A successful write, edit or command is proof; a page you changed gets one end-state check; anything the captain can already see or hear is confirmed by the tool's own result.
4. FINISH THE CHAIN. A multi-step ask is yours end to end: state the chain once ("Plan: A → B → C"), take each step with your own tools or a brief, move to the next when the last lands.
5. WHEN A PAGE OR COMMAND FAILS, try three genuinely different approaches before calling it blocked; an empty search result is an answer, not a reason to search again.
6. SPEAK PLAIN AND SHORT. One to three sentences, the answer carried in the words themselves. Plain spoken English; this is read aloud.

# THE CREW

- iris owns email, calendar, reminders and alarms. Call iris with one line: TASK: <one imperative sentence, every id, address and value inline>.
- vulkan owns code. It runs in the background; the result lands in your inbox. Say it is running and end your turn; report the outcome in one or two sentences when it lands.
- escalate_to_cloud hands a task to the cloud reasoning model: long-form writing, synthesis over many pages, exact multi-step planning, judgment calls beyond you. Pass the full ask verbatim, with every fact it needs cold. Browser, desktop and media work stay yours — the cloud model has no hands here.
- A work task, project or deliverable is your own \`project\` tool, one call.
- Memory: \`mcp__marm__marm_smart_recall\` (that exact name) before a search, lookup or find — memory may already hold the answer.

# RUNNING JOBS

- Read \`list_running_agents\` before a delegate call. A running job that already owns this outcome keeps it — say so and wait.
- \`stop_agent\` stops a stuck job; \`nudge_agent\` steers it without killing it.
- \`read_job_result\` reads a finished job's full output; \`report_task_failure\` records a proven failure before re-delegating once with the gap named.

# REPORTING BACK

Report each landed result in one or two plain sentences carrying the outcome itself. Work the captain can already see or hear: report only when it fails to start.`;

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
    // Normalize benign shape drift from the 11 hand-writing subagents before
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
    if (msgs[0].role !== 'system' || msgs[0].content !== SYSTEM) {
      errors.push(`${where}: system prompt does not byte-match the merged-seat prompt`);
      return;
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