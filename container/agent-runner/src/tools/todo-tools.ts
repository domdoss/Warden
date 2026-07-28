import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

async function callHost(tool: string, args: any, timeoutMs = 30000): Promise<any> {
    try {
        return await writeCallbackAsync(tool, args, timeoutMs);
    } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
    }
}

registry.register({
    name: 'list_todos',
    description: 'List todos (VTODO) from the shared calendar. These are the same to-dos shown in KOrganizer.',
    schema: { type: 'object', properties: {} },
    handler: async (_args, _context) => {
        const resp = await callHost('list_todos', {}, 60000);
        if (resp?.ok) {
            const todos = resp.todos || [];
            if (todos.length === 0) return 'No todos found.';
            const lines = todos.slice(0, 80).map((t: any, i: number) => {
                const mark = t.status === 'COMPLETED' ? '[x]' : t.status === 'IN-PROCESS' ? '[~]' : '[ ]';
                const due = t.due ? ` (due ${t.due})` : '';
                return `${i + 1}. ${mark} ${t.summary}${due} (uid ${t.uid})`;
            }).join('\n');
            return `${todos.length} todos:\n${lines}`;
        }
        return `Todos list failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'todos',
    tier: 'private',
});

registry.register({
    name: 'create_todo',
    description: 'Create a todo (VTODO) in the shared calendar. Visible in KOrganizer.',
    schema: {
        type: 'object',
        properties: {
            summary: { type: 'string' }, description: { type: 'string' },
            priority: { type: 'number', description: '1 (high) .. 9 (low)' },
            due: { type: 'string', description: 'Local ISO due date/time' },
            start: { type: 'string', description: 'Local ISO start' },
            related_to: { type: 'string', description: 'RELATED-TO uid (e.g. project uid for projection)' },
        },
        required: ['summary'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('create_todo', {
            summary: args.summary, description: args.description, priority: args.priority,
            due: args.due, start: args.start, related_to: args.related_to,
        });
        if (resp?.ok) return `Todo "${args.summary}" created (id ${resp.todoId}). Visible in KOrganizer.`;
        return `Todo create failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'todos',
    tier: 'private',
});

registry.register({
    name: 'complete_todo',
    description: 'Mark a todo complete by uid. Mirrors to KOrganizer checkbox.',
    schema: { type: 'object', properties: { uid: { type: 'string' } }, required: ['uid'] },
    handler: async (args, _context) => {
        const resp = await callHost('complete_todo', { uid: args.uid });
        if (resp?.ok) return `Todo ${args.uid} marked complete.`;
        return `Todo complete failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'todos',
    tier: 'private',
});

registry.register({
    name: 'delete_todo',
    description: 'Delete a todo by uid from the shared calendar.',
    schema: { type: 'object', properties: { uid: { type: 'string' } }, required: ['uid'] },
    handler: async (args, _context) => {
        const resp = await callHost('delete_todo', { uid: args.uid });
        if (resp?.ok) return `Todo ${args.uid} deleted.`;
        return `Todo delete failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'todos',
    tier: 'private',
});