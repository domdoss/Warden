/**
 * Stdio MCP Server for Prometheus
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { resolveInsideWorkspace, WorkspaceBoundaryError } from './workspace-boundary.js';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.PROMETHEUS_CHAT_JID!;
const groupFolder = process.env.PROMETHEUS_GROUP_FOLDER!;
const isMain = process.env.PROMETHEUS_IS_MAIN === '1';

/**
 * Stdout callback protocol: emit a CALLBACK_START/{json}/CALLBACK_END block on stdout
 * so the parent process (agent-spawn.ts) can dispatch the tool side-effect and write
 * a response back on the child's stdin. Replaces the old IPC-file write pattern for
 * tools that need parent-side handling (send_message, schedule_task, read_emails,
 * send_email).
 */
function writeCallback(tool: string, args: unknown): void {
  process.stdout.write('CALLBACK_START\n');
  process.stdout.write(JSON.stringify({ tool, args }) + '\n');
  process.stdout.write('CALLBACK_END\n');
}

// Async callback infrastructure (mirrors index.ts writeCallbackAsync)
const pendingCallbacks = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
let callbackStdinBuffered = '';
let callbackStdinSetup = false;

function setupCallbackStdinReader(): void {
  if (callbackStdinSetup) return;
  callbackStdinSetup = true;
  process.stdin.setEncoding('utf8');
  let inside = false;
  let lines: string[] = [];
  process.stdin.on('data', (chunk: string) => {
    callbackStdinBuffered += chunk;
    const parts = callbackStdinBuffered.split('\n');
    callbackStdinBuffered = parts.pop() ?? '';
    for (const line of parts) {
      if (line === 'CALLBACK_RESPONSE_START') { inside = true; lines = []; continue; }
      if (line === 'CALLBACK_RESPONSE_END') {
        inside = false;
        const raw = lines.join('\n');
        lines = [];
        let parsed: any;
        try { parsed = JSON.parse(raw); } catch { continue; }
        const id = parsed?.id;
        if (id && pendingCallbacks.has(id)) {
          const pending = pendingCallbacks.get(id)!;
          pendingCallbacks.delete(id);
          clearTimeout(pending.timer);
          pending.resolve(parsed);
        }
        continue;
      }
      if (inside) lines.push(line);
    }
  });
}

async function writeCallbackAsync(tool: string, args: unknown, timeoutMs = 30000): Promise<any> {
  setupCallbackStdinReader();
  const id = `cb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        reject(new Error(`callback timeout after ${timeoutMs}ms for tool ${tool}`));
      }
    }, timeoutMs);
    pendingCallbacks.set(id, { resolve, reject, timer });
    process.stdout.write('CALLBACK_START\n');
    process.stdout.write(JSON.stringify({ tool, args, id }) + '\n');
    process.stdout.write('CALLBACK_END\n');
  });
}

/** Resolve a workspace-relative path, returning a boundary error message on failure. */
function safeResolve(inputPath: string): { ok: true; path: string } | { ok: false; error: string } {
  try {
    return { ok: true, path: resolveInsideWorkspace(inputPath) };
  } catch (e) {
    if (e instanceof WorkspaceBoundaryError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Map tool names to user-friendly labels */
function toolLabel(name: string): string {
  const map: Record<string, string> = {
    Read: 'Reading file',
    Write: 'Writing file',
    Edit: 'Editing code',
    Glob: 'Searching files',
    Grep: 'Searching code',
    Bash: 'Running command',
    WebSearch: 'Searching web',
    WebFetch: 'Fetching page',
    Agent: 'Running agent',
    send_message: 'Sending message',
    attach_file: 'Attaching file',
    schedule_task: 'Scheduling task',
    list_tasks: 'Listing tasks',
    pause_task: 'Pausing task',
    resume_task: 'Resuming task',
    cancel_task: 'Canceling task',
    update_task: 'Updating task',
    create_work_task: 'Creating task',
    list_work_tasks: 'Listing tasks',
    update_work_task: 'Updating task',
    delete_work_task: 'Deleting task',
    read_emails: 'Reading emails',
    send_email: 'Sending email',
    api_request: 'Calling API',
};
  return map[name] || name.replace(/_/g, ' ');
}

/** Write activity status to IPC for frontend feedback */
function writeStatus(label: string, toolName?: string) {
  try {
    fs.writeFileSync(
      path.join(IPC_DIR, 'status.json'),
      JSON.stringify({ phase: 'tool', label, tool: toolName, ts: Date.now() })
    );
  } catch {}
}

const server = new McpServer({
  name: 'dockbox',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times." +
  "\n\nTo attach files, use the files parameter with paths relative to your workspace (e.g. 'myfile.zip', 'attachments/report.pdf'). Files will appear as download links in the chat." +
  (isMain ? ' As the main group, you can send to any registered group by specifying target_jid.' : ''),
  {
    text: z.string().describe('The message text to send'),
    files: z.array(z.string()).optional().describe('File paths relative to /workspace/group to attach (e.g. ["report.zip", "attachments/image.png"]). Each file appears as a clickable download link.'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
    target_jid: z.string().optional().describe('(Main group only) JID of the chat to send the message to. Defaults to the current group.'),
  },
  async (args) => {
    const targetJid = isMain && args.target_jid ? args.target_jid : chatJid;

    // If sending plain text to own chat, skip IPC — the agent's streaming output
    // already delivers the reply.  Only cross-chat sends (or file attachments) need IPC.
    if (targetJid === chatJid && (!args.files || args.files.length === 0)) {
      return { content: [{ type: 'text' as const, text: 'No need to use send_message for the current chat — your normal response is already delivered to the user. Use send_message only to reach other chats via target_jid, or to attach files.' }] };
    }

    // Build message text with file attachment tags
    let fullText = args.text;
    if (args.files && args.files.length > 0) {
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
      const resolvedFiles: string[] = [];
      for (const f of args.files) {
        // Resolve every attachment path through the workspace boundary. /tmp paths
        // are copied into the workspace first so the boundary check succeeds.
        let candidate = f;
        if (f.startsWith('/tmp/') || f.startsWith('/tmp\\')) {
          const basename = path.basename(f);
          const wsRoot = process.env.WORKSPACE_ROOT
            ? path.resolve(process.env.WORKSPACE_ROOT)
            : '/workspace/group';
          const dest = path.join(wsRoot, basename);
          try {
            fs.copyFileSync(f, dest);
            candidate = basename;
          } catch {
            continue; // skip files that can't be copied
          }
        }
        const resolved = safeResolve(candidate);
        if (resolved.ok === false) continue;
        if (!fs.existsSync(resolved.path)) continue;
        const wsRoot = process.env.WORKSPACE_ROOT
          ? path.resolve(process.env.WORKSPACE_ROOT)
          : '/workspace/group';
        resolvedFiles.push(path.relative(wsRoot, resolved.path) || candidate);
      }
      const tags = resolvedFiles.map(f => {
        const ext = f.toLowerCase().split('.').pop() || '';
        const isImage = imageExts.includes('.' + ext);
        return isImage ? `[Image: ${f}]` : `[File: ${f}]`;
      });
      if (tags.length > 0) fullText = fullText + '\n' + tags.join('\n');
    }

    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid: targetJid,
      text: fullText,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeCallback('send_message', data);

    return { content: [{ type: 'text' as const, text: `Message queued.` }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
    }

    const targetJid = args.target_group_jid || chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeCallback('schedule_task', data);

    return {
      content: [{ type: 'text' as const, text: `Task ${taskId} queued: ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional().describe('New schedule type'),
    schedule_value: z.string().optional().describe('New schedule value (see schedule_task for format)'),
  },
  async (args) => {
    // Schedule validation is performed host-side in ipc.ts where the task is actually updated.
    // Basic format validation for schedule_task (create) is kept above for immediate user feedback.

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.schedule_type !== undefined) data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined) data.schedule_value = args.schedule_value;

    writeCallback('ipc', data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} update requested.` }] };
  },
);

// --- Work Tasks (user-assignable tasks) ---

server.tool(
  'create_work_task',
  `Create a work task and optionally assign it to a user. Tasks appear in the user's dashboard.
**IMPORTANT: All work tasks MUST be linked to a project.** Use create_project first if needed.

Priority levels: low, medium, high, urgent
Due dates: ISO format like "2026-03-15"`,
  {
    title: z.string().describe('Task title'),
    project_id: z.string().describe('Project ID to associate this task with (REQUIRED)'),
    description: z.string().optional().describe('Task description/details'),
    notes: z.string().optional().describe('Additional notes, context, or comments for the task'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium').describe('Task priority'),
    assigned_to: z.string().optional().describe('User ID to assign the task to (check available_users.json)'),
    due_date: z.string().optional().describe('Due date in ISO format (e.g., "2026-03-15")'),
  },
  async (args) => {
    // Validate project_id is provided
    if (!args.project_id || args.project_id.trim() === '') {
      return {
        content: [{ type: 'text' as const, text: 'Error: project_id is required. All work tasks must be linked to a project. Create a project first if needed.' }],
        isError: true,
      };
    }

    const data = {
      type: 'create_work_task',
      title: args.title,
      description: args.description || '',
      notes: args.notes || '',
      priority: args.priority,
      assignedTo: args.assigned_to || undefined,
      createdBy: groupFolder,
      dueDate: args.due_date || undefined,
      projectId: args.project_id,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    const assignMsg = args.assigned_to ? ` (assigned to ${args.assigned_to})` : '';
    return {
      content: [{ type: 'text' as const, text: `Work task created: "${args.title}" linked to project ${args.project_id}${assignMsg}` }],
    };
  },
);

server.tool(
  'list_work_tasks',
  'List work tasks. Optionally filter by assigned user. Results are written to the results directory for reading.',
  {
    assigned_to: z.string().optional().describe('Filter by assigned user ID'),
  },
  async (args) => {
    const data = {
      type: 'list_work_tasks',
      assignedTo: args.assigned_to || undefined,
      timestamp: new Date().toISOString(),
    };

    const result = await writeCallbackAsync('ipc', data);

    // Also try to read the users file for context
    const usersFile = path.join(IPC_DIR, 'available_users.json');
    let usersContext = '';
    try {
      if (fs.existsSync(usersFile)) {
        const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
        usersContext = `\nAvailable users: ${users.map((u: { id: string; name: string }) => `${u.name} (${u.id})`).join(', ')}`;
      }
    } catch { /* ignore */ }

    if (result && !result.error) {
      const tasks = result.tasks || [];
      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: `No work tasks found.${usersContext}` }] };
      }
      const formatted = tasks.map((t: any) =>
        `- [${t.id}] ${t.title} (${t.status}, ${t.priority})${t.assigned_to ? ' assigned to ' + t.assigned_to : ''}`
      ).join('\n');
      return { content: [{ type: 'text' as const, text: `Work tasks:\n${formatted}${usersContext}` }] };
    }

    return {
      content: [{ type: 'text' as const, text: `Work tasks list requested. Check the results directory for results.${usersContext}` }],
    };
  },
);

server.tool(
  'update_work_task',
  'Update an existing work task. Only provided fields are changed.',
  {
    task_id: z.string().describe('The work task ID to update'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    notes: z.string().optional().describe('Updated notes/comments'),
    status: z.enum(['todo', 'in_progress', 'done']).optional().describe('New status'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('New priority'),
    assigned_to: z.string().optional().describe('User ID to assign to'),
    due_date: z.string().optional().describe('New due date'),
    project_id: z.string().optional().describe('Project ID to associate this task with'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'update_work_task',
      taskId: args.task_id,
      timestamp: new Date().toISOString(),
    };
    if (args.title !== undefined) data.title = args.title;
    if (args.description !== undefined) data.description = args.description;
    if (args.notes !== undefined) data.notes = args.notes;
    if (args.status !== undefined) data.status = args.status;
    if (args.priority !== undefined) data.priority = args.priority;
    if (args.assigned_to !== undefined) data.assignedTo = args.assigned_to;
    if (args.due_date !== undefined) data.dueDate = args.due_date;
    if (args.project_id !== undefined) data.projectId = args.project_id;

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Work task ${args.task_id} update requested.` }],
    };
  },
);

server.tool(
  'delete_work_task',
  'Delete a work task.',
  {
    task_id: z.string().describe('The work task ID to delete'),
  },
  async (args) => {
    const data = {
      type: 'delete_work_task',
      taskId: args.task_id,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Work task ${args.task_id} deletion requested.` }],
    };
  },
);

// --- Projects ---

server.tool(
  'list_projects',
  'List projects for this group. Results are written to the results directory for reading.',
  {},
  async () => {
    writeCallback('ipc', {
      type: 'list_projects',
      timestamp: new Date().toISOString(),
    });
    return {
      content: [{ type: 'text' as const, text: 'Projects list requested. Check the results directory for results.' }],
    };
  },
);

server.tool(
  'create_project',
  'Create a new project in this group.',
  {
    name: z.string().describe('Project name'),
    description: z.string().optional().describe('Project description'),
    due_date: z.string().optional().describe('Due date in ISO format'),
    project_code: z.string().optional().describe('Short project code'),
  },
  async (args) => {
    writeCallback('ipc', {
      type: 'create_project',
      name: args.name,
      description: args.description || '',
      dueDate: args.due_date || undefined,
      projectCode: args.project_code || undefined,
      timestamp: new Date().toISOString(),
    });
    return {
      content: [{ type: 'text' as const, text: `Project "${args.name}" creation requested.` }],
    };
  },
);

server.tool(
  'get_project',
  'Get full project details including deliverables, blockers, priorities, tasks, financials, and timesheet summary. Results written to results directory.',
  {
    project_id: z.string().describe('Project ID'),
  },
  async (args) => {
    writeCallback('ipc', {
      type: 'get_project',
      projectId: args.project_id,
      timestamp: new Date().toISOString(),
    });
    return {
      content: [{ type: 'text' as const, text: `Project detail requested. Check results directory.` }],
    };
  },
);

server.tool(
  'update_project',
  'Update project details. Only provided fields are changed.',
  {
    project_id: z.string().describe('Project ID'),
    name: z.string().optional().describe('New project name'),
    description: z.string().optional().describe('New description'),
    status: z.enum(['On Track', 'At Risk', 'Blocked']).optional().describe('Project status'),
    due_date: z.string().optional().describe('Due date in ISO format'),
    project_code: z.string().optional().describe('Short project code'),
  },
  async (args) => {
    const data: Record<string, any> = { type: 'update_project', projectId: args.project_id, timestamp: new Date().toISOString() };
    if (args.name !== undefined) data.name = args.name;
    if (args.description !== undefined) data.description = args.description;
    if (args.status !== undefined) data.status = args.status;
    if (args.due_date !== undefined) data.dueDate = args.due_date;
    if (args.project_code !== undefined) data.projectCode = args.project_code;
    writeCallback('ipc', data);
    return { content: [{ type: 'text' as const, text: `Project ${args.project_id} update requested.` }] };
  },
);

server.tool(
  'archive_project',
  'Archive a project (removes from active list, can be restored later).',
  { project_id: z.string().describe('Project ID') },
  async (args) => {
    writeCallback('ipc', { type: 'archive_project', projectId: args.project_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Project ${args.project_id} archive requested.` }] };
  },
);

server.tool(
  'complete_project',
  'Mark a project as completed (sets progress to 100%, archives it).',
  { project_id: z.string().describe('Project ID') },
  async (args) => {
    writeCallback('ipc', { type: 'complete_project', projectId: args.project_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Project ${args.project_id} completion requested.` }] };
  },
);

server.tool(
  'delete_project',
  'Permanently delete a project and all its data.',
  { project_id: z.string().describe('Project ID') },
  async (args) => {
    writeCallback('ipc', { type: 'delete_project', projectId: args.project_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Project ${args.project_id} deletion requested.` }] };
  },
);

server.tool(
  'add_deliverable',
  'Add a deliverable (milestone/task) to a project. Progress auto-recalculates.',
  {
    project_id: z.string().describe('Project ID'),
    name: z.string().describe('Deliverable name'),
    due_date: z.string().optional().describe('Due date in ISO format'),
  },
  async (args) => {
    writeCallback('ipc', { type: 'add_deliverable', projectId: args.project_id, name: args.name, dueDate: args.due_date || undefined, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Deliverable "${args.name}" added to project.` }] };
  },
);

server.tool(
  'toggle_deliverable',
  'Toggle a deliverable between done/not done. Progress auto-recalculates.',
  { deliverable_id: z.string().describe('Deliverable ID') },
  async (args) => {
    writeCallback('ipc', { type: 'toggle_deliverable', deliverableId: args.deliverable_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Deliverable ${args.deliverable_id} toggled.` }] };
  },
);

server.tool(
  'delete_deliverable',
  'Delete a deliverable from a project.',
  { deliverable_id: z.string().describe('Deliverable ID') },
  async (args) => {
    writeCallback('ipc', { type: 'delete_deliverable', deliverableId: args.deliverable_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Deliverable ${args.deliverable_id} deletion requested.` }] };
  },
);

server.tool(
  'add_blocker',
  'Add a blocker/risk to a project.',
  {
    project_id: z.string().describe('Project ID'),
    description: z.string().describe('Blocker description'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium').describe('Severity level'),
  },
  async (args) => {
    writeCallback('ipc', { type: 'add_blocker', projectId: args.project_id, description: args.description, severity: args.severity, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Blocker added to project.` }] };
  },
);

server.tool(
  'delete_blocker',
  'Remove a blocker from a project.',
  { blocker_id: z.string().describe('Blocker ID') },
  async (args) => {
    writeCallback('ipc', { type: 'delete_blocker', blockerId: args.blocker_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Blocker ${args.blocker_id} removed.` }] };
  },
);

server.tool(
  'add_priority',
  'Add a priority item to a project.',
  {
    project_id: z.string().describe('Project ID'),
    item: z.string().describe('Priority item description'),
    impact: z.enum(['low', 'medium', 'high']).default('medium').describe('Impact level'),
  },
  async (args) => {
    writeCallback('ipc', { type: 'add_priority', projectId: args.project_id, item: args.item, impact: args.impact, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Priority "${args.item}" added to project.` }] };
  },
);

server.tool(
  'delete_priority',
  'Remove a priority item from a project.',
  { priority_id: z.string().describe('Priority ID') },
  async (args) => {
    writeCallback('ipc', { type: 'delete_priority', priorityId: args.priority_id, timestamp: new Date().toISOString() });
    return { content: [{ type: 'text' as const, text: `Priority ${args.priority_id} removed.` }] };
  },
);

server.tool(
  'update_financials',
  'Update project financial data (budget, spent, revenue, notes).',
  {
    project_id: z.string().describe('Project ID'),
    budget: z.number().optional().describe('Total budget'),
    spent: z.number().optional().describe('Amount spent'),
    revenue: z.number().optional().describe('Revenue generated'),
    notes: z.string().optional().describe('Financial notes'),
  },
  async (args) => {
    const data: Record<string, any> = { type: 'update_financials', projectId: args.project_id, timestamp: new Date().toISOString() };
    if (args.budget !== undefined) data.budget = args.budget;
    if (args.spent !== undefined) data.spent = args.spent;
    if (args.revenue !== undefined) data.revenue = args.revenue;
    if (args.notes !== undefined) data.notes = args.notes;
    writeCallback('ipc', data);
    return { content: [{ type: 'text' as const, text: `Financials updated for project ${args.project_id}.` }] };
  },
);

// --- Calendar Events ---

server.tool(
  'create_calendar_event',
  `Create a calendar event. Optionally assign it to a user.
Check available_users.json for valid user IDs and names.

Times: ISO format like "2026-03-20T14:00:00"
All-day events: set all_day to true and only provide start_time date.`,
  {
    title: z.string().describe('Event title'),
    description: z.string().optional().describe('Event description'),
    start_time: z.string().describe('Start time in ISO format (e.g., "2026-03-20T14:00:00")'),
    end_time: z.string().optional().describe('End time in ISO format'),
    all_day: z.boolean().default(false).describe('Whether this is an all-day event'),
    location: z.string().optional().describe('Event location'),
    color: z.string().optional().describe('Event color (hex code)'),
    assigned_to: z.string().optional().describe('User ID to assign the event to'),
  },
  async (args) => {
    const data = {
      type: 'create_calendar_event',
      title: args.title,
      description: args.description || '',
      startTime: args.start_time,
      endTime: args.end_time || undefined,
      allDay: args.all_day || false,
      location: args.location || '',
      color: args.color || '',
      assignedTo: args.assigned_to || undefined,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Calendar event "${args.title}" creation requested.` }],
    };
  },
);

server.tool(
  'update_calendar_event',
  'Update an existing calendar event. Only provided fields are changed.',
  {
    event_id: z.string().describe('The calendar event ID to update'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    start_time: z.string().optional().describe('New start time (ISO format)'),
    end_time: z.string().optional().describe('New end time (ISO format)'),
    all_day: z.boolean().optional().describe('Whether this is an all-day event'),
    location: z.string().optional().describe('New location'),
    color: z.string().optional().describe('New color'),
    assigned_to: z.string().optional().describe('User ID to assign to'),
  },
  async (args) => {
    const data: Record<string, unknown> = {
      type: 'update_calendar_event',
      eventId: args.event_id,
      timestamp: new Date().toISOString(),
    };
    if (args.title !== undefined) data.title = args.title;
    if (args.description !== undefined) data.description = args.description;
    if (args.start_time !== undefined) data.startTime = args.start_time;
    if (args.end_time !== undefined) data.endTime = args.end_time;
    if (args.all_day !== undefined) data.allDay = args.all_day;
    if (args.location !== undefined) data.location = args.location;
    if (args.color !== undefined) data.color = args.color;
    if (args.assigned_to !== undefined) data.assignedTo = args.assigned_to;

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Calendar event ${args.event_id} update requested.` }],
    };
  },
);

server.tool(
  'delete_calendar_event',
  'Delete a calendar event.',
  {
    event_id: z.string().describe('The calendar event ID to delete'),
  },
  async (args) => {
    writeCallback('ipc', {
      type: 'delete_calendar_event',
      eventId: args.event_id,
      timestamp: new Date().toISOString(),
    });

    return {
      content: [{ type: 'text' as const, text: `Calendar event ${args.event_id} deleted.` }],
    };
  },
);

server.tool(
  'list_calendar_events',
  'List calendar events. Optionally filter by date range or user.',
  {
    start: z.string().optional().describe('Start date filter (ISO format)'),
    end: z.string().optional().describe('End date filter (ISO format)'),
    assigned_to: z.string().optional().describe('Filter by assigned user ID'),
  },
  async (args) => {
    writeCallback('ipc', {
      type: 'list_calendar_events',
      start: args.start || undefined,
      end: args.end || undefined,
      assignedTo: args.assigned_to || undefined,
      timestamp: new Date().toISOString(),
    });

    return {
      content: [{ type: 'text' as const, text: 'Calendar events list requested. Check results directory.' }],
    };
  },
);

// --- Alarms ---

server.tool(
  'create_alarm',
  `Create an alarm for a user. Returns the created alarm object.`,
  {
    label: z.string().describe('Alarm label'),
    alarm_time: z.string().describe('Time for the alarm (e.g., "09:00", "14:30")'),
    alarm_date: z.string().optional().describe('Specific date for a one-time alarm (ISO format, e.g., "2026-03-20")'),
    repeat_type: z.string().default('once').describe('Repeat type: "once", "daily", "weekly", "weekdays", "weekends", "custom"'),
    repeat_days: z.string().optional().describe('Comma-separated days for custom repeat (e.g., "mon,wed,fri")'),
    sound: z.string().default('default').describe('Alarm sound name'),
    user_id: z.string().optional().describe('User ID to create alarm for (auto-resolved if omitted)'),
  },
  async (args) => {
    const data = {
      type: 'create_alarm',
      label: args.label,
      alarm_time: args.alarm_time,
      alarm_date: args.alarm_date || undefined,
      repeat_type: args.repeat_type || 'once',
      repeat_days: args.repeat_days || undefined,
      sound: args.sound || 'default',
      user_id: args.user_id || undefined,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Alarm "${args.label}" creation requested for ${args.alarm_time}.` }],
    };
  },
);

server.tool(
  'list_alarms',
  'List alarms for a user. Results are returned directly.',
  {
    user_id: z.string().optional().describe('User ID to list alarms for (auto-resolved if omitted)'),
  },
  async (args) => {
    const data = {
      type: 'list_alarms',
      user_id: args.user_id || undefined,
      timestamp: new Date().toISOString(),
    };

    const result = await writeCallbackAsync('ipc', data);

    if (result && !result.error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }

    return {
      content: [{ type: 'text' as const, text: 'Alarms list requested. Check the results directory for results.' }],
    };
  },
);

server.tool(
  'update_alarm',
  'Update an existing alarm. Only provided fields are changed.',
  {
    alarm_id: z.string().describe('The alarm ID to update'),
    label: z.string().optional().describe('New label'),
    alarm_time: z.string().optional().describe('New alarm time'),
    alarm_date: z.string().optional().describe('New alarm date'),
    repeat_type: z.string().optional().describe('New repeat type'),
    repeat_days: z.string().optional().describe('New repeat days'),
    enabled: z.boolean().optional().describe('Enable or disable the alarm'),
    sound: z.string().optional().describe('New sound'),
  },
  async (args) => {
    const data: Record<string, unknown> = {
      type: 'update_alarm',
      alarm_id: args.alarm_id,
      timestamp: new Date().toISOString(),
    };
    if (args.label !== undefined) data.label = args.label;
    if (args.alarm_time !== undefined) data.alarm_time = args.alarm_time;
    if (args.alarm_date !== undefined) data.alarm_date = args.alarm_date;
    if (args.repeat_type !== undefined) data.repeat_type = args.repeat_type;
    if (args.repeat_days !== undefined) data.repeat_days = args.repeat_days;
    if (args.enabled !== undefined) data.enabled = args.enabled;
    if (args.sound !== undefined) data.sound = args.sound;

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Alarm ${args.alarm_id} update requested.` }],
    };
  },
);

server.tool(
  'delete_alarm',
  'Delete an alarm.',
  {
    alarm_id: z.string().describe('The alarm ID to delete'),
  },
  async (args) => {
    const data = {
      type: 'delete_alarm',
      alarm_id: args.alarm_id,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Alarm ${args.alarm_id} deletion requested.` }],
    };
  },
);

server.tool(
  'read_emails',
  `Read recent emails from a connected email account. Authentication is handled automatically.
If no accountId is provided, the first available account is used. Results are written to the results directory.`,
  {
    account_id: z.string().optional().describe('Email account ID (omit to use default account)'),
    folder: z.string().default('INBOX').describe('Mail folder to read from (default: INBOX)'),
    limit: z.number().default(500).describe('Number of emails to fetch (default: 500, max: 500)'),
    search: z.string().optional().describe('Search query for subject, sender, or body content'),
    preview_only: z.boolean().default(true).describe('Return lightweight preview (subject, from, snippet) instead of full body'),
  },
  async (args) => {
    const data = {
      type: 'read_emails',
      accountId: args.account_id || undefined,
      folder_name: args.folder || 'INBOX',
      limit: Math.min(args.limit || 500, 500),
      search: args.search || undefined,
      preview_only: args.preview_only ?? true,
      timestamp: new Date().toISOString(),
    };

    writeCallback('read_emails', data);

    return {
      content: [{ type: 'text' as const, text: `Email read queued. The parent will return results via callback response.` }],
    };
  },
);

server.tool(
  'get_email',
  `Get full content of a specific email by ID. Use this after read_emails to view the complete message body.
Results are written to the results directory.`,
  {
    email_id: z.string().describe('Email ID from read_emails result'),
    account_id: z.string().optional().describe('Email account ID (omit to use default account)'),
  },
  async (args) => {
    const data = {
      type: 'get_email',
      emailId: args.email_id,
      accountId: args.account_id || undefined,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Email fetch requested. Check the results directory for results.` }],
    };
  },
);

server.tool(
  'send_email',
  `Send an email from a connected email account. Authentication is handled automatically.
If no accountId is provided, the first available account is used. Just call this tool — the system handles all validation.`,
  {
    account_id: z.string().optional().describe('Email account ID (omit to use default account)'),
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body (plain text)'),
  },
  async (args) => {
    if (!args.to || !args.subject || !args.body) {
      return {
        content: [{ type: 'text' as const, text: 'Missing required fields: to, subject, body' }],
        isError: true,
      };
    }

    const data = {
      type: 'send_email',
      accountId: args.account_id || undefined,
      to: args.to,
      subject: args.subject,
      body: args.body,
      chatJid,
      timestamp: new Date().toISOString(),
    };

    writeCallback('send_email', data);

    return {
      content: [{ type: 'text' as const, text: `Email send queued to ${args.to}. The parent will confirm via callback response.` }],
    };
  },
);

server.tool(
  'refresh_email_cache',
  `Refresh the local email cache by fetching emails from the server and storing them locally. This allows fast access without re-fetching.
Specify how many emails to fetch (50, 100, 150, 200, or more). Results are written to the results directory.`,
  {
    account_id: z.string().optional().describe('Email account ID (omit to use default account)'),
    limit: z.number().default(200).describe('Number of emails to fetch and cache (50, 100, 150, 200, or more)'),
  },
  async (args) => {
    const data = {
      type: 'refresh_email_cache',
      accountId: args.account_id || undefined,
      limit: Math.min(args.limit || 200, 500),
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return {
      content: [{ type: 'text' as const, text: `Email cache refresh requested. Check the results directory for results.` }],
    };
  },
);

server.tool(
  'get_cached_emails',
  `Get emails from the local cache (fast, no network request). Use refresh_email_cache first to populate the cache.
Results are written to the results directory.`,
  {},
  async () => {
    const data = {
      type: 'get_cached_emails',
      timestamp: new Date().toISOString(),
    };

    const result = await writeCallbackAsync('ipc', data);

    if (result && !result.error) {
      const emails = result.emails || [];
      if (emails.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No cached emails found. Use refresh_email_cache first.' }] };
      }
      const formatted = emails.map((e: any) =>
        `- [${e.id}] ${e.subject || '(no subject)'} from ${e.from || 'unknown'} (${e.date || 'unknown date'})`
      ).join('\n');
      return { content: [{ type: 'text' as const, text: `Cached emails (${emails.length}):\n${formatted}` }] };
    }

    return {
      content: [{ type: 'text' as const, text: `Cached emails requested. Check the results directory for results.` }],
    };
  },
);

server.tool(
  'set_model',
  'Switch the AI model for this chat. Options: "opus", "sonnet", "local" (Ollama). The change takes effect on the next message.',
  {
    model: z.enum(['opus', 'sonnet', 'local']).describe('Model to switch to'),
  },
  async (args) => {
    writeCallback('ipc', {
      type: 'set_model',
      chatJid,
      model: args.model,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text' as const, text: `Model switched to ${args.model}. The change takes effect on the next message.` }] };
  },
);

server.tool(
  'get_chat_history',
  'Read recent chat history for context. Returns messages from this chat including both user and bot messages. The last 50 messages are also available in chat_history.json at session start.',
  {
    limit: z.number().optional().default(50).describe('Number of messages to retrieve (max 200)'),
    before: z.string().optional().describe('ISO timestamp — get messages before this time for pagination'),
  },
  async (args) => {
    const historyPath = path.join(IPC_DIR, 'chat_history.json');
    // For initial request, read from the snapshot
    if (!args.before) {
      try {
        const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        const msgs = (data.messages || []).slice(-(args.limit || 50));
        const formatted = msgs.map((m: any) => {
          const role = m.is_bot_message ? 'assistant' : m.sender_name || 'user';
          return `[${m.timestamp}] ${role}: ${m.content}`;
        }).join('\n\n');
        return { content: [{ type: 'text' as const, text: formatted || 'No chat history available.' }] };
      } catch {
        return { content: [{ type: 'text' as const, text: 'No chat history available.' }] };
      }
    }
    // For paginated requests, write an IPC request
    writeCallback('ipc', {
      type: 'get_chat_history',
      chatJid,
      limit: Math.min(args.limit || 50, 200),
      before: args.before,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text' as const, text: 'Chat history requested. Check the results directory for results.' }] };
  },
);

server.tool(
  'attach_file',
  `Send a file to the chat as a downloadable attachment. The file must exist in your workspace. Use relative paths (e.g. "report.pdf", "attachments/data.csv").
For images, use type "image" and they'll be displayed inline. For other files, use type "file" and they'll appear as download links.`,
  {
    path: z.string().describe('Relative path to the file in your workspace'),
    type: z.enum(['file', 'image']).default('file').describe('"file" for download link, "image" for inline display'),
    message: z.string().optional().describe('Optional message to send along with the file'),
  },
  async (args) => {
    let filePath = args.path;

    // If absolute /tmp path, copy to workspace first
    if (filePath.startsWith('/tmp/') || filePath.startsWith('/tmp\\')) {
      const basename = path.basename(filePath);
      const wsRoot = process.env.WORKSPACE_ROOT
        ? path.resolve(process.env.WORKSPACE_ROOT)
        : '/workspace/group';
      const dest = path.join(wsRoot, basename);
      try {
        fs.copyFileSync(filePath, dest);
        filePath = basename;
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error: could not copy file from ${filePath} to workspace` }] };
      }
    }

    // Resolve through the workspace boundary
    const resolved = safeResolve(filePath);
    if (resolved.ok === false) {
      return { content: [{ type: 'text' as const, text: `Error: ${resolved.error}` }] };
    }
    if (!fs.existsSync(resolved.path)) {
      return { content: [{ type: 'text' as const, text: `Error: file not found at ${filePath}. Make sure it exists in the workspace.` }] };
    }

    const wsRoot = process.env.WORKSPACE_ROOT
      ? path.resolve(process.env.WORKSPACE_ROOT)
      : '/workspace/group';
    const relPath = path.relative(wsRoot, resolved.path) || filePath;
    const tag = args.type === 'image' ? `[Image: ${relPath}]` : `[File: ${relPath}]`;
    const text = args.message ? `${args.message}\n\n${tag}` : tag;
    writeCallback('send_message', {
      type: 'message',
      chatJid,
      text,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text' as const, text: `File attached: ${relPath}` }] };
  },
);

server.tool(
  'ping_user',
  'Send a notification ping to a user. The user will see a browser notification with your message. Check available_users.json for user IDs.',
  {
    user_id: z.string().describe('User ID to ping'),
    message: z.string().describe('Notification message'),
  },
  async (args) => {
    writeCallback('ipc', {
      type: 'ping_user',
      userId: args.user_id,
      message: args.message,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text' as const, text: `Ping sent to ${args.user_id}.` }] };
  },
);

// --- Time Tracking ---

server.tool(
  'log_time',
  `Log time worked on a project. Requires a project ID (check current_tasks.json or available_groups.json for project context).
Use ISO date format like "2026-03-15". Hours can be decimal (e.g., 1.5 for 90 minutes).`,
  {
    project_id: z.string().describe('Project ID to log time against'),
    hours: z.number().describe('Number of hours worked (decimal, e.g., 1.5)'),
    date: z.string().optional().describe('Date of work in ISO format (defaults to today)'),
    description: z.string().optional().describe('What was worked on'),
  },
  async (args) => {
    const data = {
      type: 'log_time',
      projectId: args.project_id,
      hours: args.hours,
      date: args.date || new Date().toISOString().split('T')[0],
      description: args.description || '',
      userId: groupFolder,
      timestamp: new Date().toISOString(),
    };
    writeCallback('ipc', data);
    return {
      content: [{ type: 'text' as const, text: `Logged ${args.hours}h on project ${args.project_id}: ${args.description || '(no description)'}` }],
    };
  },
);

server.tool(
  'start_timer',
  `Start a time tracking timer for a project. The timer runs until stopped with stop_timer.
Only one timer should run at a time per user.`,
  {
    project_id: z.string().describe('Project ID to track time for'),
    description: z.string().optional().describe('What you are working on'),
  },
  async (args) => {
    const data = {
      type: 'start_timer',
      projectId: args.project_id,
      description: args.description || '',
      userId: groupFolder,
      timestamp: new Date().toISOString(),
    };
    writeCallback('ipc', data);
    return {
      content: [{ type: 'text' as const, text: `Timer started for project ${args.project_id}. Use stop_timer to stop and log the time.` }],
    };
  },
);

server.tool(
  'stop_timer',
  `Stop a running time tracking timer. The elapsed time is automatically calculated and logged as a timesheet entry.
If timer_id is not provided, stops the most recent timer for this group.`,
  {
    timer_id: z.string().optional().describe('Timer ID to stop (optional — stops most recent if omitted)'),
  },
  async (args) => {
    const data = {
      type: 'stop_timer',
      timerId: args.timer_id || undefined,
      userId: groupFolder,
      timestamp: new Date().toISOString(),
    };
    writeCallback('ipc', data);
    return {
      content: [{ type: 'text' as const, text: `Timer stopped. Time has been logged to the project timesheet.` }],
    };
  },
);

server.tool(
  'api_request',
  `Make an authenticated HTTP request to a third-party API. Your API keys are securely stored — you never see the real key. The host injects authentication automatically based on the key_type.

Before using this tool, the user must have added an API key for the service in their dashboard. Common key types: quickbooks, stripe, github, hubspot, notion, twilio, sendgrid, linear, etc.

Examples:
- key_type: "github", method: "GET", path: "/user" — get GitHub profile
- key_type: "stripe", method: "GET", path: "/charges?limit=5" — list recent charges
- key_type: "quickbooks", method: "GET", path: "/company/COMPANY_ID/query?query=select * from Invoice" — query invoices`,
  {
    key_type: z.string().describe('The API service key type (e.g. "github", "stripe", "quickbooks", "notion")'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').describe('HTTP method'),
    path: z.string().describe('API path to append to the base URL (e.g. "/user", "/v1/charges")'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional HTTP headers (auth is injected automatically)'),
    body: z.string().optional().describe('Request body for POST/PUT/PATCH (JSON string)'),
    description: z.string().optional().describe('What this API call does (for audit logging)'),
  },
  async (args) => {
    writeStatus('Calling API', 'api_request');

    const data: Record<string, any> = {
      type: 'api_request',
      key_type: args.key_type,
      method: args.method,
      path: args.path,
      headers: args.headers || undefined,
      body: args.body ? (() => { try { return JSON.parse(args.body!); } catch { return args.body; } })() : undefined,
      description: args.description || '',
      userId: process.env.PROMETHEUS_USER_ID || '',
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeCallback('ipc', data);

    return { content: [{ type: 'text' as const, text: `API request queued: ${args.method} ${args.path}` }] };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
