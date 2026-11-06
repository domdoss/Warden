#!/usr/bin/env node
// Normalize report_task_failure tool RESULT strings to the live handler's
// verbatim shape (index.ts line ~6718): the reason is echoed back, truncated
// to 300 chars. Older rows wrote "corrected brief" with no reason echo — the
// model then learned phrasing the live seat never produces.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('.', import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => /^s\d.*\.jsonl$/.test(f));

let changed = 0;
for (const f of files) {
  const rows = readFileSync(join(DIR, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  let fileChanged = false;
  for (const r of rows) {
    const msgs = r.messages;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const calls = (m.tool_calls || []).filter((tc) => tc.function?.name === 'report_task_failure');
      if (!calls.length) continue;
      for (const tc of calls) {
        const args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        const reason = (args?.reason || '').slice(0, 300);
        // the result is the next tool message for this call id
        const next = msgs[i + 1];
        if (!next || next.role !== 'tool' || next.name !== 'report_task_failure' || next.tool_call_id !== tc.id) continue;
        const want = reason
          ? `Noted — this task's failure is on record. You may delegate it once more, and only with a corrected approach that addresses the reason: ${reason}`
          : `Noted — this task's failure is on record. You may delegate it once more, and only with a corrected approach.`;
        if (next.content !== want) {
          next.content = want;
          changed++;
          fileChanged = true;
        }
      }
    }
  }
  if (fileChanged) writeFileSync(join(DIR, f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

console.log(`normalized ${changed} report_task_failure results across ${files.length} parts`);
