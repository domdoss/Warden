/**
 * Skill grouping layer (Task 23).
 *
 * A Skill is a named bundle of tools with an optional instructions string.
 * The agent-runner's turn loop loads skills at turn start, injects a skill
 * index into the system prompt, and only exposes a skill's tools to the LLM
 * after it calls `activate_skill(name)`. This keeps the LLM's tool list small
 * and focused — it does not see every MCP server's tools at once.
 *
 * Three sources:
 *   - builtin: the "core" skill (always-on meta tools + basic file ops)
 *   - mcp:     one skill per enabled external MCP server
 *   - user:    one skill per data/skills/<name>/SKILL.md (YAML frontmatter)
 *
 * The meta tools (activate_skill, deactivate_skill, list_skills,
 * install_mcp_server, uninstall_mcp_server, create_skill) and basic file ops
 * (read_file, write_file, list_file) live in the "core" builtin skill, which
 * the turn loop auto-activates so they are always visible to the LLM.
 */
import fs from 'fs';
import path from 'path';
import {
  ExternalMcpClient,
  loadExternalMcpClients,
  type McpTool,
} from './mcp-client.js';

/** Ollama/OpenAI tool definition shape. */
export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface Skill {
  name: string;
  description: string;
  source: 'builtin' | 'mcp' | 'user';
  tools: Tool[];
  instructions?: string;
}

export interface LoadSkillsOptions {
  /** Directory containing user-defined skill folders (default: env SKILLS_DIR or data/skills). */
  skillsDir?: string;
  /** Path to mcp-servers.json (default: env MCP_SERVERS_CONFIG or data/mcp-servers.json). */
  mcpConfigPath?: string;
  /**
   * Pre-connected MCP clients to use instead of spawning new ones. Useful in
   * tests (mock clients) and when the caller wants to manage the client
   * lifecycle itself. When omitted, loadExternalMcpClients() is called.
   */
  mcpClients?: ExternalMcpClient[];
}

/** Resolve skills dir lazily so tests can set SKILLS_DIR after import. */
function defaultSkillsDir(): string {
  return process.env.SKILLS_DIR ?? path.join(process.cwd(), 'data', 'skills');
}
function defaultMcpConfig(): string {
  return process.env.MCP_SERVERS_CONFIG ?? path.join(process.cwd(), 'data', 'mcp-servers.json');
}

/** Strip the `tier` field the registry adds — Ollama only wants { type, function }. */
function stripTier<T extends any[]>(tools: T): Tool[] {
  return tools.map((t: any) => ({ type: t.type, function: t.function })) as Tool[];
}

/**
 * The always-on meta tools + basic file ops exposed to the LLM at every turn.
 * These live in the "core" builtin skill and are auto-activated.
 *
 * Descriptions are one-line nested JSON, not prose: the seats reading this are
 * granite-family, and granite reads structure (same shape as the browser-gate
 * TOOL_JSON table and the orchestrator prompt). Core is auto-activated on EVERY
 * turn, so this block is the most re-read tool text in the system — prose here
 * cost more per turn than it taught. Tool descriptions stay ≤200 chars on ONE
 * line (stripTier clamps longer ones to their first line, slicing mid-JSON);
 * param descriptions are not clamped and carry the detail.
 */
export function buildAlwaysOnTools(): Tool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'activate_skill',
        description: '{"what":"load a skill tools into this turn","source":"a name from the skill index in your system prompt","use_when":"before calling any tool not in your current tool list"}',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '{"what":"which skill to load","source":"the skill index in your system prompt — copy the name verbatim"}' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deactivate_skill',
        description: '{"what":"drop an activated skill tools from this turn","source":"a skill name you activated earlier"}',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '{"what":"which skill to drop","source":"a skill you activated earlier this turn"}' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_skills',
        description: '{"what":"re-list the skill index","use_when":"after install_mcp_server or create_skill, which add a skill that appears next turn"}',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_running_agents',
        description: '{"what":"list running background jobs","returns":"job id, elapsed, tool call count, last action","use_when":"check a job before stopping or steering it"}',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'stop_agent',
        description: '{"what":"stop a running background job","returns":"the job partial result","use_when":"it is stuck, looping, or off-task; re-delegate after with corrected instructions"}',
        parameters: {
          type: 'object',
          properties: {
            job_id: { type: 'string', description: '{"what":"which job to stop","source":"list_running_agents, or the id returned when you delegated","format":"copy the id verbatim"}' },
          },
          required: ['job_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'nudge_agent',
        description: '{"what":"steer a running job without killing it","how":"your instruction lands on its next iteration","use_when":"redirecting beats stopping; to kill it use stop_agent"}',
        parameters: {
          type: 'object',
          properties: {
            job_id: { type: 'string', description: '{"what":"which job to steer","source":"list_running_agents, a supervisor flag, or the id returned when you delegated","format":"copy the id verbatim"}' },
            message: { type: 'string', description: '{"what":"the correction the job reads next iteration","content":"name what it should commit to, drawn from what it is actually doing and what the task needs","length":"one or two sentences"}' },
          },
          required: ['job_id', 'message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'agent_logs',
        description: '{"what":"read a job step-by-step tool-call log with result previews","running":"live progress","finished":"what it actually did, in order","omit_job_id":"lists recent jobs"}',
        parameters: {
          type: 'object',
          properties: {
            job_id: { type: 'string', description: '{"what":"which job to read","source":"list_running_agents, or the id returned when you delegated","omit":"returns a one-line list of recent jobs"}' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'install_mcp_server',
        description: '{"what":"register a new MCP server","writes":"data/mcp-servers.json","available":"as a skill next turn"}',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '{"what":"the server name, which becomes its skill name","format":"lowercase, dashes between words"}' },
            command: { type: 'string', description: '{"what":"the executable that launches the server","source":"the server own install docs"}' },
            args: { type: 'array', items: { type: 'string' }, description: '{"what":"the launch arguments","format":"one array entry per argument, in order","source":"the server own install docs"}' },
            env: { type: 'object', description: '{"what":"env vars for the subprocess","format":"flat name to value map","default":"omit when the server needs none"}' },
          },
          required: ['name', 'command', 'args'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'uninstall_mcp_server',
        description: '{"what":"remove an MCP server from data/mcp-servers.json","takes_effect":"next turn"}',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '{"what":"which server to remove","source":"the skill index, or list_skills"}' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_skill',
        description: '{"what":"package a completed multi-step workflow as a repeatable skill","writes":"data/skills/<name>/SKILL.md","prefer":"the structured fields over freeform instructions","available":"next turn"}',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '{"what":"the skill name","format":"alphanumeric and dashes, 1-64 chars","source":"derive it from the workflow this skill repeats, in the words the user used for it"}' },
            description: { type: 'string', description: '{"what":"what the skill does","length":"one line"}' },
            when_to_use: { type: 'string', description: '{"what":"the trigger for activating this skill","content":"the user intent and conditions that map to this workflow","length":"one or two sentences"}' },
            parameters: {
              type: 'array',
              description: '{"what":"inputs the workflow needs from the user each time it repeats","entry":"{name, description, example}","source":"the values that varied in the run you just completed"}',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: '{"what":"the parameter name","format":"lowercase, words joined by dashes or underscores"}' },
                  description: { type: 'string', description: '{"what":"what this parameter means"}' },
                  example: { type: 'string', description: '{"what":"a value of the shape the user would supply","source":"the actual value used in the run you just completed"}' },
                },
                required: ['name', 'description'],
              },
            },
            steps: {
              type: 'array',
              description: '{"what":"the ordered steps that carry a fresh request start to finish","source":"the run you just completed, in the order you did it"}',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string', description: '{"what":"what this step does","length":"one line, plain language"}' },
                  tool: { type: 'string', description: '{"what":"the tool or sub-agent this step calls","source":"the tool you actually called at this step","omit":"steps that call nothing"}' },
                  key_args: { type: 'string', description: '{"what":"the arguments this step call needs","format":"the argument text, with each varying value written as {{parameter_name}} naming its entry in parameters","source":"the call you actually made, with its varying values replaced by their parameter names"}' },
                },
                required: ['description'],
              },
            },
            example_prompt: { type: 'string', description: '{"what":"a request that should trigger this skill","voice":"written as the user would say it","source":"the request that started the run you just completed"}' },
            tools: { type: 'array', items: { type: 'string' }, description: '{"what":"tool names this skill exposes","status":"informational","default":"empty for instruction-only skills"}' },
            instructions: { type: 'string', description: '{"what":"freeform SKILL.md body","use_when":"a note does not fit any structured field above","default":"omit when the structured fields carry the workflow"}' },
          },
          required: ['name', 'description'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '{"what":"read a workspace file","path":"workspace-relative or absolute"}',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '{"what":"the file to read","format":"workspace-relative or absolute path"}' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: '{"what":"write text to a workspace file","overwrites":"the whole file"}',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '{"what":"the file to write","format":"workspace-relative or absolute path","creates":"parent directories as needed"}' },
            content: { type: 'string', description: '{"what":"the full new file contents","note":"this replaces the whole file"}' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_file',
        description: '{"what":"list entries in a workspace directory","default":"workspace root"}',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '{"what":"the directory to list","format":"workspace-relative or absolute path","default":"workspace root"}' } },
        },
      },
    },
  ];
}

/** Convert a McpTool (server-prefixed) into an Ollama Tool definition. */
function mcpToolToTool(tool: McpTool): Tool {
  // A description-less tool is invisible to relevance ranking (dynamic-selection
  // scores name + description), so it silently loses every ranking it should
  // win. The name template is all we can synthesize — say so, loudly.
  if (!tool.description) {
    process.stderr.write(
      `[skills] mcp "${tool.server}" ships no description for tool "${tool.name}" — it will rank on its name alone\n`,
    );
  }
  return {
    type: 'function',
    function: {
      name: `mcp__${tool.server}__${tool.name}`,
      description: tool.description ?? `{"what":${JSON.stringify(`${tool.name}, from the ${tool.server} MCP server`)},"note":"the server shipped no description"}`,
      parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, any>,
    },
  };
}

/** Parse a SKILL.md file's YAML frontmatter + body. Returns null on missing/bad file.
 *  A malformed file makes the skill vanish from the index with no other signal,
 *  so every rejection below says why — a typo'd frontmatter key is otherwise
 *  indistinguishable from a skill that was never written. */
function parseSkillMarkdown(filePath: string): Skill | null {
  if (!fs.existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    process.stderr.write(`[skills] unreadable ${filePath}: ${(err as Error).message}\n`);
    return null;
  }
  // YAML frontmatter delimited by --- on its own line.
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) {
    process.stderr.write(`[skills] skipped ${filePath}: no --- frontmatter block\n`);
    return null;
  }
  const front = m[1];
  const body = (m[2] || '').trim();
  const fields: Record<string, string> = {};
  for (const line of front.split('\n')) {
    const mm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (mm) fields[mm[1]] = mm[2].trim();
  }
  const name = fields.name;
  if (!name) {
    process.stderr.write(`[skills] skipped ${filePath}: frontmatter has no name: field\n`);
    return null;
  }
  const description = fields.description || '';
  // tools field is informational only — we don't synthesize tool schemas from it.
  // The user-defined skill currently acts as instructions-only; future work may
  // let a SKILL.md declare built-in tool names to expose on activation.
  return {
    name,
    description,
    source: 'user',
    tools: [],
    instructions: body || undefined,
  };
}

/**
 * Load all skills: builtin core + user-defined + MCP-derived.
 * Failures in MCP connection are isolated (logged + skipped) — same contract
 * as loadExternalMcpClients().
 */
export async function loadSkills(options: LoadSkillsOptions = {}): Promise<Skill[]> {
  const skillsDir = options.skillsDir ?? defaultSkillsDir();
  const mcpConfigPath = options.mcpConfigPath ?? defaultMcpConfig();

  const skills: Skill[] = [];

  // 1. Built-in "core" skill — always-on meta tools + basic file ops.
  skills.push({
    name: 'core',
    description: 'Always-on meta tools (activate/deactivate/list skills, install MCP, create skill) and basic file ops (read/write/list).',
    source: 'builtin',
    tools: buildAlwaysOnTools(),
  });

  // 2. User-defined skills from data/skills/<name>/SKILL.md.
  try {
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        // Dashboard enable/disable toggle: `disabled: true` in frontmatter
        // hides the skill from the agent without deleting it.
        try {
          const raw = fs.readFileSync(skillPath, 'utf8');
          if (/^disabled:\s*true\s*$/m.test(raw.split(/^---\s*$/m)[1] ?? '')) continue;
        } catch { /* unreadable — let parseSkillMarkdown handle it */ }
        const parsed = parseSkillMarkdown(skillPath);
        if (parsed) skills.push(parsed);
      }
    }
  } catch (err) {
    process.stderr.write(
      `[skills] failed to read user skills dir ${skillsDir}: ${(err as Error).message}\n`,
    );
  }

  // 3. MCP-derived skills — one per connected client.
  let clients: ExternalMcpClient[] = [];
  if (options.mcpClients) {
    clients = options.mcpClients;
  } else {
    try {
      clients = await loadExternalMcpClients(mcpConfigPath);
    } catch (err) {
      process.stderr.write(
        `[skills] mcp client load failed: ${(err as Error).message}\n`,
      );
      clients = [];
    }
  }
  for (const client of clients) {
    try {
      const mcpTools = await client.listTools();
      skills.push({
        name: client.config.name,
        description: client.config.description ??
          (client.config.transport === 'sse' || client.config.transport === 'http'
            ? `MCP server ${client.config.name} (${client.config.url})`
            : `MCP server ${client.config.name} (${client.config.command} ${client.config.args.join(' ')})`),
        source: 'mcp',
        tools: mcpTools.map(mcpToolToTool),
      });
    } catch (err) {
      process.stderr.write(
        `[skills] mcp "${client.config.name}" listTools failed: ${(err as Error).message}\n`,
      );
    }
  }

  // An MCP server owns its name: a user SKILL.md with the same name is stale
  // and would shadow the server's live tools.
  const mcpNames = new Set(skills.filter((s) => s.source === 'mcp').map((s) => s.name));
  const deduped = skills.filter((s) => s.source !== 'user' || !mcpNames.has(s.name));
  skills.length = 0;
  skills.push(...deduped);

  return skills;
}

/**
 * Render the skill index for the system prompt. One line of nested JSON, the
 * same envelope shape as the orchestrator prompt's other sections (see
 * dynamic-selection buildRelevantPatternsSection) — this rides in the system
 * prompt on every turn, and the seats reading it are granite-family.
 * Skill descriptions stay verbatim as JSON values: most come from MCP servers
 * and user SKILL.md frontmatter, so they are data, not directives.
 */
export function renderSkillIndex(skills: Skill[]): string {
  const items = skills.map(
    (s) => `${JSON.stringify(s.name)}:${JSON.stringify(s.description || 'skill')}`,
  );
  return `{"skills":{"load":"activate_skill(name) loads that skill tools into this turn","items":{${items.join(',')}}}}`;
}

/**
 * Build the LLM's tool list for the current turn: tools from every skill in
 * the active set. The "core" builtin skill is always included (callers should
 * pre-add it to `active`). Duplicate tool names are deduped (first wins).
 */
export function mergeActiveSkillTools(skills: Skill[], active: Set<string>): Tool[] {
  const out: Tool[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    if (!active.has(skill.name)) continue;
    for (const t of skill.tools) {
      const n = t.function.name;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(t);
    }
  }
  return out;
}

/** Validation regex for skill names — alphanumeric + dashes, 1-64 chars. */
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export type CreateSkillResult = { ok: true; path: string } | { ok: false; error: string };

export interface WorkflowStep {
  description: string;
  tool?: string;
  key_args?: string;
}

export interface WorkflowParameter {
  name: string;
  description: string;
  example?: string;
}

export interface WorkflowSkillInput {
  name: string;
  description: string;
  whenToUse?: string;
  parameters?: WorkflowParameter[];
  steps?: WorkflowStep[];
  examplePrompt?: string;
  tools?: string[];
  instructions?: string;
}

/**
 * Validate a skill name and write data/skills/<name>/SKILL.md with the given
 * frontmatter (name, description, tools) and body. Returns the written path on
 * success or an error message on failure. Pure disk write — does NOT affect
 * the current turn's skill list (the caller reloads skills next turn).
 */
export function createSkillOnDisk(
  name: string,
  description: string,
  toolsLine: string,
  envLine: string,
  body: string,
): CreateSkillResult {
  if (!name || !SKILL_NAME_RE.test(name)) {
    return { ok: false, error: `Invalid skill name "${name}": must be alphanumeric + dashes, 1-64 chars, no path separators.` };
  }
  const skillsDir = process.env.SKILLS_DIR ?? defaultSkillsDir();
  // Resolve and ensure the resolved path stays inside skillsDir (no traversal).
  const skillDir = path.resolve(skillsDir, name);
  const rel = path.relative(skillsDir, skillDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: `Resolved skill path escapes skills directory: ${skillDir}` };
  }
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    const front = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      toolsLine ? `tools: ${toolsLine}` : 'tools: []',
      envLine ? `env: ${envLine}` : null,
      '---',
      '',
      body || '',
      '',
    ].filter((l) => l !== null).join('\n');
    const filePath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(filePath, front, 'utf8');
    return { ok: true, path: filePath };
  } catch (err: any) {
    return { ok: false, error: `Failed to write SKILL.md: ${err.message}` };
  }
}

/**
 * Write a structured, repeatable SKILL.md from a workflow the agent and user
 * just completed together. Produces a body with: When To Use, Parameters,
 * Steps (numbered, with tool + key_args per step), Example Prompt, and any
 * freeform instructions the caller passes. Frontmatter stays compatible with
 * parseSkillMarkdown (name, description, tools).
 */
export function createWorkflowSkillOnDisk(input: WorkflowSkillInput): CreateSkillResult {
  const { name, description, whenToUse, parameters, steps, examplePrompt, tools, instructions } = input;
  if (!name || !SKILL_NAME_RE.test(name)) {
    return { ok: false, error: `Invalid skill name "${name}": must be alphanumeric + dashes, 1-64 chars, no path separators.` };
  }
  const skillsDir = process.env.SKILLS_DIR ?? defaultSkillsDir();
  const skillDir = path.resolve(skillsDir, name);
  const rel = path.relative(skillsDir, skillDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: `Resolved skill path escapes skills directory: ${skillDir}` };
  }
  try {
    fs.mkdirSync(skillDir, { recursive: true });
    const toolsLine = tools && tools.length > 0 ? `[${tools.join(', ')}]` : '[]';
    const front = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `tools: ${toolsLine}`,
      '---',
      '',
    ].join('\n');

    const body: string[] = [];
    if (whenToUse && whenToUse.trim()) {
      body.push('## When to use', '', whenToUse.trim(), '');
    }
    if (parameters && parameters.length > 0) {
      body.push('## Parameters', '');
      for (const p of parameters) {
        const ex = p.example ? ` (example: \`${p.example}\`)` : '';
        body.push(`- **${p.name}** — ${p.description}${ex}`);
      }
      body.push('');
    }
    if (steps && steps.length > 0) {
      body.push('## Steps', '');
      steps.forEach((s, i) => {
        const toolPart = s.tool ? ` [tool: \`${s.tool}\`${s.key_args ? ` — \`${s.key_args}\`` : ''}]` : '';
        body.push(`${i + 1}. ${s.description}${toolPart}`);
      });
      body.push('');
    }
    if (examplePrompt && examplePrompt.trim()) {
      body.push('## Example prompt', '', '> ' + examplePrompt.trim().replace(/\n/g, '\n> '), '');
    }
    if (instructions && instructions.trim()) {
      body.push('## Notes', '', instructions.trim(), '');
    }
    const full = front + body.join('\n') + '\n';
    const filePath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(filePath, full, 'utf8');
    return { ok: true, path: filePath };
  } catch (err: any) {
    return { ok: false, error: `Failed to write SKILL.md: ${err.message}` };
  }
}

export { stripTier };