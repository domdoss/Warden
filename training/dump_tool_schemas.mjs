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

// Default: the LIVE compiled registry (dist/agent-runner — build first with
// `npm run build:agent-runner`). AR_DIST=<dir> overrides it so schemas can be
// dumped from a scratch compile (e.g. tsc --outDir /tmp/.../dist/agent-runner)
// without rebuilding the dist the running Warden serves from. The dir must end
// in dist/agent-runner — tool_schema_loader.mjs stubs index.js by that path.
const ROOT = process.env.AR_DIST || '/opt/Warden/dist/agent-runner';
const url = (rel) => pathToFileURL(path.resolve(ROOT, rel)).href;

const { registry } = await import(url('tool-registry.js'));

// Register the tool modules. Iris (the merged toolcall agent) and the
// MERGED orch/atlas seat share this dumper: iris is 4 action tools; merged
// is atlas-core + file tools + project + chat history — the merged seat's
// own hands, dumped as the live registry shapes. Delegate tools and the
// provisional escalate_to_cloud def are built below (they are not registry
// tools: delegates are emitted by delegateToolDef() in the runner source).
const mods = [
  'iris-tools.js',     // email, task, calendar, alarm (action-parameterized)
  'browser.js',        // browser_* (atlas's hands on the real Chrome)
  'web-tools.js',      // WebSearch, WebFetch
  'terminal.js',       // Bash
  'desktop.js',       // desktop_screenshot/click/type, webcam, read_image
  'host-tools.js',     // open_app
  'documents.js',      // generate_pdf, convert_file
  'media.js',          // audio_volume, mic_volume, media_control
  'youtube.js',        // youtube (merged YouTube toolchain, 2026-09-18)
  'project-tools.js',  // project (work tasks / projects / deliverables)
  'chat-tools.js',     // get_chat_history
  'file-read.js', 'file-grep.js', 'file-glob.js', 'file-write.js', 'file-edit.js',
];
for (const m of mods) await import(url('tools/' + m));

// (Sentry-core was dumped here until 2026-09-08, when sentry switched to the
// dashboard-set orchestrator model — the toolcall fine-tune no longer covers
// sentry, so only iris is dumped now.)

const { resolveToolset } = await import(url('toolsets.js'));

// Iris: the single toolcall agent. Merged: the orch/atlas seat being merged
// into one (2026-09-18) — atlas-core toolsets plus the orchestrator's own
// hands (file tools, project, chat history), and hand-built defs for the two
// things the registry does not carry: the delegate tools (vulkan, iris —
// byte-matching delegateToolDef() in the runner source) and the provisional
// escalate_to_cloud def (the merged seat's cloud-escalation tool; not yet in
// the registry — when it lands, replace the hand-built def with the dumped
// registry shape so training keeps matching inference).
const sets = { iris: 'iris-core' };
const MERGED_EXTRA = ['project', 'get_chat_history', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
const DELEGATE_DEFS = {
  vulkan: {
    type: 'function',
    function: {
      name: 'vulkan',
      description: `Delegate to Vulkan for code and build/test work. Vulkan ALWAYS runs in the background. You get a job id back immediately and the full result arrives in your inbox when it finishes — keep working or end your turn in the meantime. Set urgent:true when the result should interrupt whatever you are doing at the time. NEVER use mode:"blocking".`,
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'What the USER wants done: the goal plus only the facts the agent cannot guess (file paths, URLs, names, dates, IDs, the exact outcome). Intent only — never steps, never where to look, never how to code, never tool names or order.' },
          urgent: { type: 'boolean', description: 'Inject the result into your context immediately when it finishes, even mid-task (default false).' },
        },
        required: ['task'],
      },
    },
  },
  iris: {
    type: 'function',
    function: {
      name: 'iris',
      description: `Delegate to Iris for email, calendar, reminders, and alarms. You do NOT have these tools directly — send a structured brief and you will receive one short result line.`,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: `A structured brief and nothing else — no preamble, no explanation, and no time (the runner prepends the current local time). One line: "TASK: <one imperative sentence naming the outcome>". Every id, address, filename and value the sentence needs goes INLINE in that sentence. Example:\nTASK: Download the file invoice-2291.pdf attached to email 18f2c9ab41.`,
          },
        },
        required: ['task'],
      },
    },
  },
};
const ESCALATE_DEF = {
  type: 'function',
  function: {
    name: 'escalate_to_cloud',
    description: `Hand a task to the cloud reasoning model when the work exceeds what you can do well locally: long-form writing (documents, posts, letters), synthesis or analysis over many pages, multi-step planning that must be exact, or a judgment call you are not confident in. Carries the FULL ask verbatim — the cloud model sees nothing of this conversation except what you pass. Do not escalate what you can finish with your own tools in a few calls; do not escalate browser/desktop/media work (that is yours, and the cloud model has no hands here).`,
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The complete ask, verbatim from the conversation, plus every fact (paths, names, values, deadlines) needed to act on it cold. Add one line of context only when the ask references something not in the text.' },
      },
      required: ['task'],
    },
  },
};
// Job supervision + memory recall — runtime-built defs (not registry tools), so
// they are hand-built here to byte-match their sources: the four agent tools
// verbatim from skills.ts, the two inbox tools verbatim from index.ts
// (READ_JOB_RESULT_TOOL_DEF / REPORT_TASK_FAILURE_TOOL_DEF), and the marm
// recall def from the marm-mcp-server signature (query + optional filters).
// The 2026-09-18 pain point is baked into recall: the wire name is the PREFIXED
// mcp__marm__marm_smart_recall — five straight "Unknown tool marm_smart_recall"
// calls happened when the prompt used the unprefixed spelling.
const SUPERVISION_DEFS = [
  {
    type: 'function',
    function: {
      name: 'list_running_agents',
      description: 'List currently-running Atlas background jobs with their elapsed time, tool call count, last action, and job id. Use this when you want to check on what a background Atlas is doing before deciding whether to stop it.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_agent',
      description: 'Stop a running Atlas background job by job id (obtained from list_running_agents or the job id returned when you delegated). The agent is given a chance to return its partial result. Use this when an Atlas is stuck, looping, or doing the wrong thing — then re-delegate with corrected instructions if needed.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The atlas-XXXX job id to stop.' },
        },
        required: ['job_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nudge_agent',
      description: 'Steer a running background job without killing it: inject a short instruction into its next turn naming what it should commit to, based on what it is actually doing wrong. Use this when the supervisor flags a job as off-track (grinding, off-task, or repeating failing calls) and redirecting it is better than stopping it. For a job that should be killed, use stop_agent instead. The job keeps running and sees your message on its next iteration.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The atlas-XXXX / vulkan-XXXX job id to steer (from list_running_agents or a supervisor flag).' },
          message: { type: 'string', description: 'A short, specific instruction naming what the job should commit to on its next turn, based on what it is doing wrong and what the task actually needs.' },
        },
        required: ['job_id', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agent_logs',
      description: "Read a background agent's step-by-step activity log — every tool call it made, with a preview of each call's result. Works on a running job (live progress) or a finished one (what it actually did, in order). Use this when you need to know what an agent actually did — whether it succeeded, what it changed, where it looked — instead of asking it to re-run or re-check. Pass the job id (e.g. atlas-abcd); omit it to get a one-line list of recent jobs.",
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The job id (e.g. atlas-abcd). Omit to list recent jobs.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_job_result',
      description: 'Read the full stored output of a finished background job from your inbox (e.g. when the user asks for the raw result, or a preview was truncated). Call with no job_id to list all stored results.',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Job id like "atlas-4f2a". Omit to list available results.' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_task_failure',
      description: 'Record that a finished background job PROVEN failed — its result shows the deliverable is wrong or missing (not merely that success is hard to see). Call this before re-delegating; the runner allows the task exactly one automatic retry, consumed on the next dispatch, then refuses further retries.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The failed task, as it was delegated.' },
          reason: { type: 'string', description: 'What proved it failed — the evidence from the result.' },
        },
        required: ['task', 'reason'],
      },
    },
  },
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
];
const out = {};
for (const [agent, ts] of Object.entries(sets)) {
  const names = resolveToolset(ts);
  // getDefinitions returns {type:'function', tier, function:{name,description,parameters}}.
  // Drop `tier` (irrelevant to the template) and keep the Ollama tool shape.
  out[agent] = registry.getDefinitions(names).map(({ tier, ...d }) => d);
  console.error(`${agent}: ${out[agent].length} tools (${names.join(', ')})`);
}
{
  // browser_screenshot + browser_snapshot are already OUT of atlas-core in the
  // live toolsets.ts (2026-09-18): the local seat is visionless and page state
  // is read with browser_evaluate instead. desktop_screenshot lives in
  // desktop-vision/capture (vulkan's), not atlas-core. desktop_click STAYS —
  // it is the last-resort hand for a site/app the standard tools can't drive.
  const names = [...resolveToolset('atlas-core'), ...MERGED_EXTRA];
  out.merged = [
    ...registry.getDefinitions(names).map(({ tier, ...d }) => d),
    DELEGATE_DEFS.vulkan,
    DELEGATE_DEFS.iris,
    ESCALATE_DEF,
    ...SUPERVISION_DEFS,
  ];
  console.error(`merged: ${out.merged.length} tools (${out.merged.map(t => t.function.name).join(', ')})`);
}

writeFileSync(
  path.resolve(path.dirname(new URL(import.meta.url).pathname), 'tool_schemas.json'),
  JSON.stringify(out, null, 2),
);
console.error('wrote tool_schemas.json');