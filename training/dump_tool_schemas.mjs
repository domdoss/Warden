// Dump the exact Ollama tool definitions (name/description/parameters) for the
// single toolcall agent's toolset, straight from the compiled agent-runner
// registry. This guarantees the SFT `tools` array matches inference.
//
//   node dump_tool_schemas.mjs  →  writes tool_schemas.json
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

register('./tool_schema_loader.mjs', import.meta.url);

const ROOT = '/opt/Warden/dist/agent-runner';
const url = (rel) => pathToFileURL(path.resolve(ROOT, rel)).href;

const { registry } = await import(url('tool-registry.js'));

// Register the tool modules that define iris's tools. Each imports
// writeCallbackAsync from ../index.js (stubbed by the loader).
// 2026-09-09 collapse: iris is 4 merged action tools (email/task/calendar/
// alarm) — project management, work tasks, and admin were dropped entirely.
const mods = [
  'iris-tools.js',     // email, task, calendar, alarm (action-parameterized)
];
for (const m of mods) await import(url('tools/' + m));

// (Sentry-core was dumped here until 2026-09-08, when sentry switched to the
// dashboard-set orchestrator model — the toolcall fine-tune no longer covers
// sentry, so only iris is dumped now.)

const { resolveToolset } = await import(url('toolsets.js'));

// Single toolcall agent since 2026-09-05 (byte merged into iris): iris-core
// carries email + tasks + calendar + the work-management toolsets byte had.
const sets = { iris: 'iris-core' };
const out = {};
for (const [agent, ts] of Object.entries(sets)) {
  const names = resolveToolset(ts);
  // getDefinitions returns {type:'function', tier, function:{name,description,parameters}}.
  // Drop `tier` (irrelevant to the template) and keep the Ollama tool shape.
  out[agent] = registry.getDefinitions(names).map(({ tier, ...d }) => d);
  console.error(`${agent}: ${out[agent].length} tools (${names.join(', ')})`);
}

writeFileSync(
  path.resolve(path.dirname(new URL(import.meta.url).pathname), 'tool_schemas.json'),
  JSON.stringify(out, null, 2),
);
console.error('wrote tool_schemas.json');