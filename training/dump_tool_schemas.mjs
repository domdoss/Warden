// Dump the exact Ollama tool definitions (name/description/parameters) the
// MERGED orch/atlas seat's model actually receives, straight from the live
// compiled agent-runner registry + the runner SOURCE. This guarantees the SFT
// `tools` array matches inference.
//
//   node dump_tool_schemas.mjs  →  writes tool_schemas.json
//
// 2026-09-19 rewrite. The old dump hand-listed tool modules and hand-copied
// every runtime-built def, and both halves drifted: the schema carried 57
// tools while the live pool is 46, six of them (project/Write/Edit/Glob/Grep/
// escalate_to_cloud) being tools the seat can NEVER call — project isn't even
// registered (tools/index.ts never imports it). The rewrite takes everything
// from the live sources so it cannot drift again:
//
//   - registry tools: tools/index.js (the EXACT module list the runner
//     imports) + the seat filter replicated from fullToolDefs in index.ts
//     (SUBAGENT_OWNED / ORCHESTRATOR_SHARED / ATLAS_OWNED, all extracted from
//     the runner source), minus BLOCKED_ORCHESTRATOR_TOOLS (browser_snapshot/
//     browser_screenshot — orchToolBlocked withholds them from this seat in
//     mergeSkillTools, so the model never sees them).
//   - delegate defs + the five runtime consts + the 13 always-on core-skill
//     tools: extracted from src via extract_runner_source.mjs, byte-faithful.
//   - the marm pair: hand-kept verbatim from the live server's tools/list
//     (mcp__marm__ — the seat's one reachable MCP server).
//
// What lands in `merged` is therefore the model-visible universe:
//   pool 46 (as the runner logs "Tools: N available")
//   − 2 withheld (snapshot/screenshot)
//   + 13 always-on core-skill tools (mergeSkillTools layers them EVERY turn)
//   + 2 marm tools
//   = 59
// The runner logs 46 for fullToolDefs; the per-turn Ollama request carries a
// dynamic subset of that pool PLUS the 13 + marm. Rows must carry the union
// because the dataset trains calls into all three groups.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  extractDelegates, extractDelegateToolDefFn, extractObjectConst, extractSetArray,
  extractSubagentFields, extractAlwaysOnTools,
} from './extract_runner_source.mjs';

register('./tool_schema_loader.mjs', import.meta.url);

// Default: the LIVE compiled registry (dist/agent-runner — build first with
// `npm run build:agent-runner`). AR_DIST=<dir> overrides it so schemas can be
// dumped from a scratch compile (e.g. tsc --outDir /tmp/.../dist/agent-runner)
// without rebuilding the dist the running Warden serves from. The dir must end
// in dist/agent-runner — tool_schema_loader.mjs stubs index.js by that path.
const ROOT = process.env.AR_DIST || '/opt/Warden/dist/agent-runner';
const url = (rel) => pathToFileURL(path.resolve(ROOT, rel)).href;

const { registry } = await import(url('tool-registry.js'));
// The EXACT production registration — no hand module list. If the runner adds
// a tools/*.ts module to its index, it lands here automatically.
await import(url('tools/index.js'));
const { resolveMultipleToolsets } = await import(url('toolsets.js'));

// ---- seat filter, replicated from fullToolDefs (index.ts) ----------------
const subagents = ['atlas', 'vulkan', 'iris', 'artemis', 'sentry'].map((n) => extractSubagentFields(n));
const SUBAGENT_OWNED = new Set(subagents.flatMap((s) => resolveMultipleToolsets(s.toolsets)));
const ATLAS_OWNED = new Set(resolveMultipleToolsets(subagents.find((s) => s.delegate === 'atlas').toolsets));
const ORCHESTRATOR_SHARED_TOOLS = new Set(extractSetArray('ORCHESTRATOR_SHARED_TOOLS'));

// fullToolDefs (index.ts) since 8ddc077: the seat-visible pool is every
// registered tool that is not specialist-owned, plus what the seat shares or
// owns outright. The old BLOCKED_ORCHESTRATOR_TOOLS second filter is gone —
// one seat, one mode, nothing blocked on top.
const visibleNames = registry.getAllToolNames().filter(
  (n) => !SUBAGENT_OWNED.has(n) || ORCHESTRATOR_SHARED_TOOLS.has(n) || ATLAS_OWNED.has(n),
);
const registryDefs = registry.getDefinitions(visibleNames).map(({ tier, ...d }) => d);

// ---- runtime-built defs, extracted from the runner source ----------------
const delegateToolDef = extractDelegateToolDefFn();
const delegateDefs = extractDelegates().map(delegateToolDef); // vulkan, iris, artemis, sentry — fullToolDefs skips atlas
const constDefNames = [
  'COUNCIL_TOOL_DEF', 'COUNCIL_STATUS_TOOL_DEF', 'ATLAS_BACKGROUND_TOOL_DEF',
  'READ_JOB_RESULT_TOOL_DEF', 'REPORT_TASK_FAILURE_TOOL_DEF',
];
const constDefs = constDefNames.map((n) => extractObjectConst(n));
const coreDefs = extractAlwaysOnTools(); // the 13 always-on "core" skill tools

// ---- marm pair (the seat's one reachable MCP server) ----------------------
// Verbatim from the live server's tools/list (name prefixed mcp__marm__).
// The 2026-09-18 pain point is baked into recall: the wire name is the PREFIXED
// mcp__marm__marm_smart_recall — five straight "Unknown tool marm_smart_recall"
// calls happened when the prompt used the unprefixed spelling.
const MARM_DEFS = [
  {
    type: 'function',
    function: {
      name: 'mcp__marm__marm_smart_recall',
      description: 'Recall memories by semantic similarity or keyword match: ranked results with similarity scores for a query over everything the memory distiller has ever logged. Call it (exactly this name) before delegating a search, a lookup or a find — memory may already hold the answer.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to recall, in natural language.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
          search_all: { type: 'boolean', description: 'Search every session, not just the current one.' },
          include_logs: { type: 'boolean', description: 'Also search raw log entries.' },
          exact_mode: { type: 'string', description: '"auto", "keyword", or "semantic".' },
          project: { type: 'string', description: 'Restrict to one project.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp__marm__marm_log_entry',
      description: '\n    📝 Write a log entry to the active session.\n\n    Entries are stored with a date, topic, and summary. If `entry` begins with\n    "Session: [name]" or "Topic: [name]", the active session switches to that name\n    and all subsequent entries route there automatically. Entries are also stored\n    as semantic memories so marm_smart_recall can find them.\n\n    Entry format: YYYY-MM-DD-topic-summary (date prefix is optional; auto-tagged if omitted)\n\n    Parameters:\n    - entry: the text to log; plain text or prefixed with "Session:" / "Topic:" to switch sessions\n    - session_name: override the target session explicitly (optional; active session used if omitted)\n\n    Returns: status, message confirming the entry or session switch, entry_id, memory_id\n    ',
      parameters: {
        type: 'object',
        properties: {
          entry: { type: 'string', title: 'Entry' },
          session_name: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Session Name' },
        },
        required: ['entry'],
        title: 'marm_log_entryArguments',
      },
    },
  },
];

// ---- assemble --------------------------------------------------------------
const merged = [...registryDefs, ...delegateDefs, ...constDefs, ...coreDefs, ...MARM_DEFS];
const names = merged.map((t) => t.function.name);
if (new Set(names).size !== names.length) {
  throw new Error(`duplicate tool names in merged schema: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
}

// ---- orch (the background chain-manager subagent) --------------------------
// SUBAGENT_TOOL_DEFS.get('orch') replicated from index.ts: its toolsets
// (artemis-core + web) + every 'both'-tier registry tool + the four delegate
// stubs — vulkan/artemis/sentry BLOCKING (inline result) and iris (its
// dispatch blocks unconditionally, so the ordinary background-styled stub is
// what production serves). Skill/MCP merges and selectAtlasTools ranking are
// dynamic per turn; this is the stable base universe orch rows train on.
import { extractOrchDelegateToolDefFn, extractOrchManagerSystem } from './extract_runner_source.mjs';
const orchDelegateToolDef = extractOrchDelegateToolDefFn();
const orchEntry = extractSubagentFields('orch');
const orchBoth = registry.getDefinitions(registry.getByTier('both').map((t) => t.name)).map(({ tier, ...d }) => d);
const orchRegistry = registry.getDefinitions(resolveMultipleToolsets(orchEntry.toolsets)).map(({ tier, ...d }) => d);
const orchPool = [];
for (const d of [
  ...orchRegistry,
  ...orchBoth,
  ...['vulkan', 'artemis', 'sentry'].map((n) => orchDelegateToolDef(extractSubagentFields(n))),
  ...['iris'].map((n) => delegateToolDef(extractSubagentFields(n))),
]) {
  if (!orchPool.some((t) => t.function.name === d.function.name)) orchPool.push(d);
}
const ORCH_MANAGER_PROMPT = extractOrchManagerSystem();
console.error(`orch pool: ${orchPool.length} tools (${orchPool.map((t) => t.function.name).join(', ')})`);

// ---- iris (the separate 3b toolcall agent) — unchanged --------------------
const { resolveToolset } = await import(url('toolsets.js'));
const irisNames = resolveToolset('iris-core');
const iris = registry.getDefinitions(irisNames).map(({ tier, ...d }) => d);
console.error(`iris: ${iris.length} tools (${irisNames.join(', ')})`);

// Default-app browser surface: the seat's real browser hands at runtime are
// the browser-driving MCP server's chrome_* tools (Settings → Default apps →
// browser). They are runtime-connected, so the static registry never lists
// them — but the seat trains and infers with them visible, so their LIVE
// schemas (dumped from the gate's tools/list into chrome_schemas.json) ride
// in the merged universe. Refresh chrome_schemas.json when the extension
// updates its toolset.
import { existsSync, readFileSync } from 'node:fs';
const CHROME_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'chrome_schemas.json');
const CHROME = existsSync(CHROME_PATH) ? JSON.parse(readFileSync(CHROME_PATH, 'utf8')) : [];

merged.push(...CHROME);
console.error(`registry pool: ${visibleNames.length} seat registry tools + ${delegateDefs.length} delegates + ${constDefs.length} consts = ${visibleNames.length + delegateDefs.length + constDefs.length} — what the runner logs as "Tools: N available"`);
console.error(`merged (model-visible universe): ${merged.length} = ${visibleNames.length} registry + ${delegateDefs.length} delegates + ${constDefs.length} consts + ${coreDefs.length} core-skill + ${MARM_DEFS.length} marm + ${CHROME.length} default-app browser`);
console.error(`tools: ${names.join(', ')}`);

const out = { iris, merged, orchPool, orchSystem: ORCH_MANAGER_PROMPT };
writeFileSync(
  path.resolve(path.dirname(new URL(import.meta.url).pathname), 'tool_schemas.json'),
  JSON.stringify(out, null, 2),
);
console.error('wrote tool_schemas.json');