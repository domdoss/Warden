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
  'chat-tools.js',     // get_chat_history, attach_file
  'file-read.js', 'file-grep.js', 'file-glob.js', 'file-write.js', 'file-edit.js',
  'api-tools.js',      // list_api_keys, api_request (the internal warden loopback)
  'context-tools.js',  // clear_context
  'fabric-tools.js',   // fabric_pattern
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
// 2026-09-18b: the seat's INTERNAL hands were missing from the dumped schema
// even though the live seat carries them every turn (fullToolDefs in the runner
// keeps every registry tool no sub-agent owns) — api_request/list_api_keys (the
// keyless `warden` loopback), attach_file, clear_context, fabric_pattern.
const MERGED_EXTRA = [
  'project', 'get_chat_history', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'api_request', 'list_api_keys', 'attach_file', 'clear_context', 'fabric_pattern',
];
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
  // artemis + sentry: same async delegateToolDef() branch as vulkan (prose task
  // + urgent), description = `Delegate to <label> for <summary>.` with each
  // seat's SUBAGENTS `summary` verbatim from the runner source. Artemis is the
  // seat the user reaches for by asking what went wrong — a stalled job, a
  // report that never came back, a second opinion before something final.
  artemis: {
    type: 'function',
    function: {
      name: 'artemis',
      description: `Delegate to Artemis for a second-opinion audit of the current conversation — reads what the user asked and what the assistant actually said/did, then flags mistakes, wrong assumptions, and oversights. It can read and search files, query Warden's SQLite databases, and inspect the service logs to verify claims, but never changes anything. Runs in the background: calling it returns a job id immediately and the audit arrives in your inbox when it finishes. Call when the user wants a review or sanity-check, asks why a job stalled or failed, why a task never finished, or why a report never came back — or before finalizing something important. Artemis ALWAYS runs in the background. You get a job id back immediately and the full result arrives in your inbox when it finishes — keep working or end your turn in the meantime. Set urgent:true when the result should interrupt whatever you are doing at the time. NEVER use mode:"blocking".`,
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
  sentry: {
    type: 'function',
    function: {
      name: 'sentry',
      description: `Delegate to Sentry for security scan of the PC — checks network connections, listening ports, and running services (peek), plus autostart entries, user crontab, enabled user units, shell rc files, and a process audit (deep), then reports anything suspicious. Runs with user-level permissions only. Call for 'scan the pc', 'run a security scan', 'what's listening', 'is my machine safe'.. Sentry ALWAYS runs in the background. You get a job id back immediately and the full result arrives in your inbox when it finishes — keep working or end your turn in the meantime. Set urgent:true when the result should interrupt whatever you are doing at the time. NEVER use mode:"blocking".`,
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
// The seat's INTERNAL machinery — runtime-built defs, verbatim from their
// sources, added 2026-09-18b because the dataset had no coverage of the things
// the seat reaches for when Warden itself is the subject:
//   council / council_status  — index.ts COUNCIL_TOOL_DEF / COUNCIL_STATUS_TOOL_DEF
//   atlas_background          — index.ts ATLAS_BACKGROUND_TOOL_DEF (a background
//                               copy of itself, for work too long for a chat turn)
//   the six skill meta-tools  — skills.ts buildAlwaysOnTools(); the "core"
//                               builtin skill is auto-activated, so these are on
//                               EVERY live turn (install_mcp_server is how a new
//                               MCP server gets added, and the tools it brings
//                               appear as a skill on the NEXT turn)
//   mcp__marm__marm_log_entry — the MARM write half, taken from the live server's
//                               tools/list (name prefixed mcp__marm__, description
//                               and inputSchema exactly as the wire carries them),
//                               so the trained shape is the served shape.
// read_file / write_file / list_file (also in the core skill) are deliberately
// LEFT OUT: they are weaker duplicates of Read/Write, and a def the model can
// see is a def it will pick — file work in this dataset is Read/Write/Edit.
const INTERNAL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'council',
      description: 'Convene The Council — three Artemis instances (Skeptic, Pragmatist, Synthesist) deliberate in parallel on the same question from three different angles. Each round, all three answers are shared and each seat re-evaluates independently. The loop repeats until all three agree on a single answer (or max_rounds is hit). Use for high-stakes questions where you want a council consensus rather than a single answer. Slower than a single delegate call — expect 1-3 minutes.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The question for The Council to deliberate on. Self-contained — no chat history available to the seats.' },
          max_rounds: { type: 'number', description: 'Maximum deliberation rounds. Default 4, capped at 15. Each round spawns 3 parallel Artemis calls; seats argue, disagree, present new points, and work toward one answer all three can endorse.' },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'council_status',
      description: "Peek at what The Council is doing right now. Returns the deliberation status (round in progress, elapsed time) and each seat's answer from the completed rounds, or the outcome if it already finished. Use when the user asks how the council is doing, what it is thinking, or whether it is done. Read-only — does not interrupt the deliberation.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'atlas_background',
      description: 'Run work in the BACKGROUND as a copy of yourself, on your own model and tools, when it is too long for a chat turn (minutes of browsing, a multi-step build). The result arrives in your inbox and you keep talking meanwhile. For anything you can finish in this turn, just do it yourself with your tools instead.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'What the USER wants done: the goal plus only the facts the agent cannot guess (file paths, URLs, names, dates, IDs, the exact outcome). Intent only — never steps, where to look, how to code, or tool names.' },
          urgent: { type: 'boolean', description: 'Inject the result into your context immediately when it finishes, even mid-task (default false).' },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'activate_skill',
      description: "Load a skill's tools into your context for this turn. Call this before using any tool that is not in your current tool list. The skill index in your system prompt lists the available names.",
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name from the skill index' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deactivate_skill',
      description: "Drop a previously-activated skill's tools from your context.",
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name to deactivate' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'Re-list the skill index (useful after install_mcp_server or create_skill, which add skills that appear on the next turn).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_mcp_server',
      description: 'Register a new MCP server (written to data/mcp-servers.json). Available as a skill on the next turn.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          env: { type: 'object', description: 'Optional env vars for the subprocess' },
        },
        required: ['name', 'command', 'args'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'uninstall_mcp_server',
      description: 'Remove an MCP server from data/mcp-servers.json. Takes effect next turn.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_skill',
      description: 'Create a new user-defined skill by writing data/skills/<name>/SKILL.md. Use this to package a multi-step workflow the user just completed with you so it can be repeated for similar future tasks. Available on the next turn. Prefer the structured fields (when_to_use, parameters, example_prompt, steps) over a freeform instructions string — they produce a SKILL.md the next session can actually follow.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Alphanumeric + dashes only, 1-64 chars. Pick a name that describes the workflow, e.g. "deploy-nightly" or "triage-inbox".' },
          description: { type: 'string', description: 'One-line description of what the skill does.' },
          when_to_use: { type: 'string', description: 'When this skill should be activated. One or two sentences describing the trigger conditions / user intent that maps to this workflow.' },
          parameters: {
            type: 'array',
            description: 'Inputs the workflow expects from the user at repeat time. Each entry: { name, description, example }.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Parameter name (lowercase, words separated by dashes or underscores).' },
                description: { type: 'string', description: 'What this parameter means.' },
                example: { type: 'string', description: 'A concrete example value the user might supply.' },
              },
              required: ['name', 'description'],
            },
          },
          steps: {
            type: 'array',
            description: 'Ordered list of concrete steps that make up the workflow. Each step is what you would do, in order, to take a fresh user request from start to finish.',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: 'What this step does in plain language.' },
                tool: { type: 'string', description: 'Tool or sub-agent you would call (e.g. "Bash", "atlas", "read_file"). Leave empty if no tool call.' },
                key_args: { type: 'string', description: 'Key arguments the tool call needs, with placeholders for parameters in {{param}} form (e.g. "git checkout {{branch_name}}").' },
              },
              required: ['description'],
            },
          },
          example_prompt: { type: 'string', description: 'A concrete user prompt that would trigger this skill, written as if the user said it. Helps future-you recognize the workflow.' },
          tools: { type: 'array', items: { type: 'string' }, description: 'Tool names this skill exposes (currently informational — leave empty for instruction-only skills).' },
          instructions: { type: 'string', description: 'Optional freeform body of the SKILL.md. If you fill the structured fields above, this is rarely needed — use it only for notes that do not fit anywhere else.' },
        },
        required: ['name', 'description'],
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
    DELEGATE_DEFS.artemis,
    DELEGATE_DEFS.sentry,
    ESCALATE_DEF,
    ...SUPERVISION_DEFS,
    ...INTERNAL_DEFS,
  ];
  console.error(`merged: ${out.merged.length} tools (${out.merged.map(t => t.function.name).join(', ')})`);
}

writeFileSync(
  path.resolve(path.dirname(new URL(import.meta.url).pathname), 'tool_schemas.json'),
  JSON.stringify(out, null, 2),
);
console.error('wrote tool_schemas.json');