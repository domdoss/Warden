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
 */
export function buildAlwaysOnTools(): Tool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'activate_skill',
        description:
          'Load a skill\'s tools into your context for this turn. Call this before using any tool that is not in your current tool list. The skill index in your system prompt lists the available names.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Skill name from the skill index' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deactivate_skill',
        description: 'Drop a previously-activated skill\'s tools from your context.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Skill name to deactivate' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_skills',
        description:
          'Re-list the skill index (useful after install_mcp_server or create_skill, which add skills that appear on the next turn).',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_running_agents',
        description:
          'List currently-running Atlas background jobs with their elapsed time, tool call count, last action, and job id. Use this when you want to check on what a background Atlas is doing before deciding whether to stop it.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'stop_agent',
        description:
          'Stop a running Atlas background job by job id (obtained from list_running_agents or the job id returned when you delegated). The agent is given a chance to return its partial result. Use this when an Atlas is stuck, looping, or doing the wrong thing — then re-delegate with corrected instructions if needed.',
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
        name: 'install_mcp_server',
        description:
          'Register a new MCP server (written to data/mcp-servers.json). Available as a skill on the next turn.',
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
        description:
          'Create a new user-defined skill by writing data/skills/<name>/SKILL.md. Use this to package a multi-step workflow the user just completed with you so it can be repeated for similar future tasks. Available on the next turn. Prefer the structured fields (when_to_use, parameters, example_prompt, steps) over a freeform instructions string — they produce a SKILL.md the next session can actually follow.',
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
        name: 'read_file',
        description: 'Read a file from the workspace.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write text to a workspace file.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_file',
        description: 'List entries in a workspace directory.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Defaults to workspace root' } },
        },
      },
    },
  ];
}

/** Convert a McpTool (server-prefixed) into an Ollama Tool definition. */
function mcpToolToTool(tool: McpTool): Tool {
  return {
    type: 'function',
    function: {
      name: `mcp__${tool.server}__${tool.name}`,
      description: tool.description ?? `MCP tool ${tool.name} from ${tool.server}`,
      parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, any>,
    },
  };
}

/** Parse a SKILL.md file's YAML frontmatter + body. Returns null on missing/bad file. */
function parseSkillMarkdown(filePath: string): Skill | null {
  if (!fs.existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  // YAML frontmatter delimited by --- on its own line.
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return null;
  const front = m[1];
  const body = (m[2] || '').trim();
  const fields: Record<string, string> = {};
  for (const line of front.split('\n')) {
    const mm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (mm) fields[mm[1]] = mm[2].trim();
  }
  const name = fields.name;
  if (!name) return null;
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
          (client.config.transport === 'sse'
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

  return skills;
}

/**
 * Render the skill index for the system prompt: a header line instructing the
 * LLM to call activate_skill(name), followed by a bulleted "name: description"
 * line per skill.
 */
export function renderSkillIndex(skills: Skill[]): string {
  const lines: string[] = [
    'You have access to these skills. Call activate_skill(name) to load a skill\'s tools into your context for this turn.',
    '',
  ];
  for (const s of skills) {
    lines.push(`- ${s.name}: ${s.description}`);
  }
  return lines.join('\n');
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