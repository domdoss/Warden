import fs from 'fs';
import path from 'path';
import { registry } from '../tool-registry.js';
import { writeIpcFile, waitForResult, TASKS_DIR, IPC_DIR } from '../ipc-helpers.js';

registry.register({
    name: 'schedule_task',
    description: 'Create a recurring or one-time automated task. All times are LOCAL; compute schedule_value from the current local time given in your context.',
    schema: {
        type: 'object',
        properties: {
            prompt: { type: 'string' },
            schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'], description: 'cron=recurring at set times, interval=every N milliseconds, once=single run at a specific time' },
            schedule_value: { type: 'string', description: 'cron: a cron expression like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min) | interval: milliseconds like "300000" (5 min) | once: an ABSOLUTE local timestamp like "2026-05-27T09:25:00" (no "Z" or timezone suffix). NEVER pass natural language such as "in 5 minutes" or "tomorrow" — convert it to an absolute timestamp using the current local time from your context.' },
            context_mode: { type: 'string', enum: ['group', 'isolated'] },
        },
        required: ['prompt', 'schedule_type', 'schedule_value'],
    },
    handler: async (args, context) => {
        if (args.schedule_type === 'once') {
            if (!args.schedule_value || isNaN(new Date(args.schedule_value).getTime())) {
                return `Error: schedule_value "${args.schedule_value}" is not a valid timestamp. Pass an absolute local time like "2026-05-27T14:30:00" (no "Z"/timezone suffix), computed from the current local time you were given. Do NOT pass phrases like "in 5 minutes".`;
            }
        } else if (args.schedule_type === 'interval') {
            const ms = parseInt(args.schedule_value, 10);
            if (isNaN(ms) || ms <= 0) {
                return `Error: interval schedule_value must be a positive number of milliseconds (e.g. "300000" for 5 minutes).`;
            }
        }
        writeIpcFile(TASKS_DIR, {
            type: 'schedule_task', prompt: args.prompt, schedule_type: args.schedule_type,
            schedule_value: args.schedule_value, context_mode: args.context_mode || 'group',
            targetJid: context.chatJid, createdBy: context.groupFolder, timestamp: new Date().toISOString(),
        });
        return `Task scheduled: ${args.schedule_type} - ${args.schedule_value}`;
    },
    toolset: 'tasks',
    tier: 'public',
});

registry.register({
    name: 'atlas_background',
    description: 'Kick off a background Warden turn that delegates the given task to Atlas and reports the result back to the user as a new chat message when Atlas finishes. Use this for long-running Atlas work (web scraping, multi-step browser automation, large file generation) where you do NOT need the result to continue the current conversation — you return a confirmation immediately, and the user gets a separate message when the background work completes. Do NOT use this for quick tasks that you need the result of in the same turn; use the synchronous `atlas` delegate for those.',
    schema: {
        type: 'object',
        properties: {
            task: { type: 'string', description: 'The plain-language goal to hand to Atlas. Include any specifics Atlas needs (URLs, file paths, names, IDs).' },
        },
        required: ['task'],
    },
    handler: async (args, context) => {
        const task = String(args?.task || '').trim();
        if (!task) return 'Error: task is required.';
        // Schedule a 'once' task ~2s in the future. The host's schedule_task
        // callback creates a ScheduledTask; computeNextRun converts the local
        // timestamp to UTC and stores it as next_run; the scheduler polls
        // getDueTasks and runs it as a fresh Warden turn, which delegates to
        // atlas and sendMessage's the result back to the user.
        const fire = new Date(Date.now() + 2000);
        const pad = (n: number) => String(n).padStart(2, '0');
        const schedule_value = `${fire.getFullYear()}-${pad(fire.getMonth() + 1)}-${pad(fire.getDate())}T${pad(fire.getHours())}:${pad(fire.getMinutes())}:${pad(fire.getSeconds())}`;
        const prompt = `Background Atlas task (kicked off from a previous conversation). Delegate the following to atlas, then report atlas's result back to me as a normal chat message. Do not do anything else.\n\nTask: ${task}`;
        writeIpcFile(TASKS_DIR, {
            type: 'schedule_task',
            prompt,
            schedule_type: 'once',
            schedule_value,
            context_mode: 'isolated',
            targetJid: context.chatJid,
            createdBy: context.groupFolder,
            timestamp: new Date().toISOString(),
        });
        return `Kicked off Atlas in the background. It will run as a separate turn and report back as a new chat message when it finishes. Task: "${task.slice(0, 120)}${task.length > 120 ? '...' : ''}"`;
    },
    toolset: 'tasks',
    tier: 'public',
});

registry.register({
    name: 'list_tasks',
    description: 'List all scheduled tasks.',
    schema: { type: 'object', properties: {} },
    handler: async (_args, _context) => {
        const tasksFile = path.join(IPC_DIR, 'current_tasks.json');
        if (fs.existsSync(tasksFile)) {
            const data = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
            return `Scheduled tasks:\n${JSON.stringify(data, null, 2).slice(0, 2000)}`;
        }
        return 'No scheduled tasks found.';
    },
    toolset: 'tasks',
    tier: 'public',
});

registry.register({
    name: 'pause_task',
    description: 'Pause a scheduled task by ID.',
    schema: {
        type: 'object',
        properties: { task_id: { type: 'string' } },
        required: ['task_id'],
    },
    handler: async (args, context) => {
        writeIpcFile(TASKS_DIR, { type: 'pause_task', taskId: args.task_id, groupFolder: context.groupFolder, isMain: context.isMain, timestamp: new Date().toISOString() });
        return `Task ${args.task_id} paused.`;
    },
    toolset: 'tasks',
    tier: 'public',
});

registry.register({
    name: 'resume_task',
    description: 'Resume a paused task by ID.',
    schema: {
        type: 'object',
        properties: { task_id: { type: 'string' } },
        required: ['task_id'],
    },
    handler: async (args, context) => {
        writeIpcFile(TASKS_DIR, { type: 'resume_task', taskId: args.task_id, groupFolder: context.groupFolder, isMain: context.isMain, timestamp: new Date().toISOString() });
        return `Task ${args.task_id} resumed.`;
    },
    toolset: 'tasks',
    tier: 'public',
});

registry.register({
    name: 'cancel_task',
    description: 'Cancel and delete a scheduled task by ID.',
    schema: {
        type: 'object',
        properties: { task_id: { type: 'string' } },
        required: ['task_id'],
    },
    handler: async (args, context) => {
        writeIpcFile(TASKS_DIR, { type: 'cancel_task', taskId: args.task_id, groupFolder: context.groupFolder, isMain: context.isMain, timestamp: new Date().toISOString() });
        return `Task ${args.task_id} cancelled.`;
    },
    toolset: 'tasks',
    tier: 'public',
});

registry.register({
    name: 'update_task',
    description: 'Update an existing scheduled task.',
    schema: {
        type: 'object',
        properties: {
            task_id: { type: 'string' }, prompt: { type: 'string' },
            schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'] },
            schedule_value: { type: 'string', description: 'Same format as schedule_task: cron expression | milliseconds | absolute local timestamp "2026-05-27T09:25:00" (no Z suffix). Never natural language.' },
        },
        required: ['task_id'],
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'update_task', taskId: args.task_id, prompt: args.prompt, schedule_type: args.schedule_type, schedule_value: args.schedule_value, timestamp: new Date().toISOString() });
        return `Task ${args.task_id} updated.`;
    },
    toolset: 'tasks',
    tier: 'public',
});
