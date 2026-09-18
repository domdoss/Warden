// Agent-task scribe tool (2026-09-17) — the user-visible internal "task"
// record that carries a SHARED history across every subagent in a chain (the
// anti-"marco polo" bus). Each user command becomes an agent task; the runner
// auto-scribes each background job's outcome into its history; the dashboard
// shows the active queue + a recallable backlog. This ONE merged tool lets the
// orchestrator inspect and manage that record directly (list / read / append /
// complete / stop) — the record itself is owned by the host, not the model, so
// scribing never depends on the model remembering to call this.
import { registry } from '../tool-registry.js';
import { writeCallbackAsync, noteLocalTaskHistory } from '../index.js';

async function callHost(tool: string, args: any, timeoutMs = 30000): Promise<any> {
    try {
        return await writeCallbackAsync(tool, args, timeoutMs);
    } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
    }
}

function fmtResult(resp: any, okPrefix: string, failPrefix: string): string {
    if (resp?.ok) {
        const detail = resp.data ? `\n${JSON.stringify(resp.data, null, 2).slice(0, 4000)}` : '';
        return `${okPrefix}${detail}`;
    }
    return `${failPrefix}: ${resp?.error || 'unknown error'}`;
}

registry.register({
    name: 'agent_task',
    description: 'The internal agent-task queue — user commands recorded as tasks with a shared history that every specialist reads, so a chain never redoes work a sibling already finished. action=list: active queue + recallable backlog. action=read: full history for one task (task_id). action=append: add a note/decision line to a task history (task_id, text). action=complete: mark a task done (task_id). action=stop: mark a task stopped (task_id).',
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['list', 'read', 'append', 'complete', 'stop'], description: 'Which operation to perform.' },
            task_id: { type: 'string', description: 'read/append/complete/stop: the agent-task id (from list).' },
            text: { type: 'string', description: 'append: the note/decision line to add to the task history.' },
        },
        required: ['action'],
    },
    handler: async (args) => {
        const action = String(args.action || '');
        if (action === 'list') {
            const resp = await callHost('list_agent_tasks', {});
            return fmtResult(resp, 'Agent tasks:', 'list_agent_tasks failed');
        }
        if (action === 'read') {
            if (!args.task_id) return 'read needs task_id (from agent_task list).';
            const resp = await callHost('read_agent_task', { taskId: args.task_id });
            return fmtResult(resp, `Agent task ${args.task_id}:`, 'read_agent_task failed');
        }
        if (action === 'append') {
            if (!args.task_id || !args.text) return 'append needs task_id and text.';
            noteLocalTaskHistory(String(args.text));
            const resp = await callHost('append_agent_task_history', { taskId: args.task_id, text: String(args.text) });
            return fmtResult(resp, `Appended to ${args.task_id}.`, 'append_agent_task_history failed');
        }
        if (action === 'complete') {
            if (!args.task_id) return 'complete needs task_id.';
            const resp = await callHost('complete_agent_task', { taskId: args.task_id });
            return fmtResult(resp, `Agent task ${args.task_id} completed.`, 'complete_agent_task failed');
        }
        if (action === 'stop') {
            if (!args.task_id) return 'stop needs task_id.';
            const resp = await callHost('stop_agent_task', { taskId: args.task_id });
            return fmtResult(resp, `Agent task ${args.task_id} stopped.`, 'stop_agent_task failed');
        }
        return 'Unknown action — use list, read, append, complete, or stop.';
    },
    toolset: 'agent-tasks',
    tier: 'public',
});
