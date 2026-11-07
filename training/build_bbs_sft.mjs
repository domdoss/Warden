// Build orchatlas-bbs-sft.jsonl from the BBS part (s34-bbs.jsonl).
//
//   node build_bbs_sft.mjs
//
// Same stamping contract as merge_orchatlas_parts.mjs, for this standalone
// slice: the system prompt is extracted from the live runner source, the tool
// schemas come from tool_schemas.json, and each row carries only the schemas it
// actually exercises (prose rows carry none). Exact-duplicate rows are dropped,
// and a row that mentions the retired demo host is rejected loudly.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { extractFewModeSystemPrompt } from './extract_runner_source.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SOURCE = path.join(HERE, 'orchatlas-parts', 's34-bbs.jsonl');
const OUT = path.join(HERE, 'orchatlas-bbs-sft.jsonl');
const BANNED = 'warden-alpha.example';

execSync('node dump_tool_schemas.mjs', { cwd: HERE, stdio: 'inherit' });
const SCHEMAS = JSON.parse(readFileSync(path.join(HERE, 'tool_schemas.json'), 'utf8'));
const byName = new Map(SCHEMAS.merged.map((t) => [t.function.name, t]));
const system = extractFewModeSystemPrompt();

const rows = readFileSync(SOURCE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const seen = new Set();
const out = [];
for (const [i, row] of rows.entries()) {
  const where = `s34-bbs.jsonl:${i + 1}`;
  if (JSON.stringify(row.messages).includes(BANNED)) throw new Error(`${where}: mentions ${BANNED}`);
  const names = new Set();
  for (const m of row.messages) {
    for (const tc of (m.tool_calls || [])) names.add(tc.function.name);
    if (m.role === 'tool' && m.name) names.add(m.name);
  }
  for (const n of names) {
    if (!byName.has(n)) throw new Error(`${where}: unknown tool ${n}`);
  }
  const messages = row.messages.map((m, j) => (j === 0 ? { ...m, content: system } : m));
  const stamped = { messages, tools: [...names].map((n) => byName.get(n)) };
  const key = JSON.stringify(stamped);
  if (seen.has(key)) {
    console.log(`dropped duplicate row ${where}`);
    continue;
  }
  seen.add(key);
  out.push(stamped);
}
writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`wrote ${out.length} BBS rows to ${path.basename(OUT)}`);
