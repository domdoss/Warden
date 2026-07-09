import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

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

// --- Projects ---
registry.register({
    name: 'list_projects',
    description: 'List projects for this group.',
    schema: { type: 'object', properties: {} },
    handler: async (_args, _context) => {
        const resp = await callHost('list_projects', {});
        return fmtResult(resp, 'Projects:', 'list_projects failed');
    },
    toolset: 'projects',
    tier: 'public',
});

registry.register({
    name: 'create_project',
    description: 'Create a new project.',
    schema: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            due_date: { type: 'string' },
            project_code: { type: 'string' },
        },
        required: ['name'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('create_project', {
            name: args.name, description: args.description || '',
            dueDate: args.due_date, projectCode: args.project_code,
        });
        if (resp?.ok && resp.project) {
            return `Project "${args.name}" created with id ${resp.project.id}. Now call add_deliverable, add_blocker, add_priority, update_financials, and create_work_task using this project_id.`;
        }
        return `Project creation failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'projects',
    tier: 'public',
});

registry.register({
    name: 'get_project',
    description: 'Get full project details.',
    schema: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('get_project', { projectId: args.project_id });
        return fmtResult(resp, 'Project details:', 'get_project failed');
    },
    toolset: 'projects',
    tier: 'public',
});

registry.register({
    name: 'update_project',
    description: 'Update project details.',
    schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
            status: { type: 'string', enum: ['On Track', 'At Risk', 'Blocked'] },
            due_date: { type: 'string' }, project_code: { type: 'string' },
        },
        required: ['project_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('update_project', {
            projectId: args.project_id, name: args.name, description: args.description,
            status: args.status, dueDate: args.due_date, projectCode: args.project_code,
        });
        return fmtResult(resp, `Project ${args.project_id} updated.`, `update_project failed`);
    },
    toolset: 'projects',
    tier: 'public',
});

registry.register({
    name: 'archive_project',
    description: 'Archive a project.',
    schema: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('archive_project', { projectId: args.project_id });
        return fmtResult(resp, `Project ${args.project_id} archived.`, `archive_project failed`);
    },
    toolset: 'projects',
    tier: 'public',
});

registry.register({
    name: 'complete_project',
    description: 'Mark a project as completed.',
    schema: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('complete_project', { projectId: args.project_id });
        return fmtResult(resp, `Project ${args.project_id} marked complete.`, `complete_project failed`);
    },
    toolset: 'projects',
    tier: 'public',
});

registry.register({
    name: 'delete_project',
    description: 'Permanently delete a project.',
    schema: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('delete_project', { projectId: args.project_id });
        return fmtResult(resp, `Project ${args.project_id} deleted.`, `delete_project failed`);
    },
    toolset: 'projects',
    tier: 'public',
});

// --- Work Tasks ---
registry.register({
    name: 'list_work_tasks',
    description: 'List work tasks from the dashboard.',
    schema: {
        type: 'object',
        properties: { assigned_to: { type: 'string' } },
    },
    handler: async (args, _context) => {
        const resp = await callHost('list_work_tasks', { assignedTo: args.assigned_to || undefined });
        return fmtResult(resp, 'Work tasks:', 'list_work_tasks failed');
    },
    toolset: 'worktasks',
    tier: 'public',
});

registry.register({
    name: 'create_work_task',
    description: 'Create a work task visible in the user dashboard. project_id is required.',
    schema: {
        type: 'object',
        properties: {
            title: { type: 'string' }, description: { type: 'string' }, notes: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            assigned_to: { type: 'string' }, due_date: { type: 'string' }, project_id: { type: 'string' },
        },
        required: ['title', 'project_id'],
    },
    handler: async (args, context) => {
        const resp = await callHost('create_work_task', {
            title: args.title, description: args.description || '', notes: args.notes || '',
            priority: args.priority || 'medium', assignedTo: args.assigned_to || undefined,
            createdBy: args.created_by || context.groupFolder, dueDate: args.due_date || undefined,
            projectId: args.project_id || undefined,
        });
        return fmtResult(resp, `Work task "${args.title}" created.`, `create_work_task failed`);
    },
    toolset: 'worktasks',
    tier: 'public',
});

registry.register({
    name: 'update_work_task',
    description: 'Update an existing work task.',
    schema: {
        type: 'object',
        properties: {
            task_id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, notes: { type: 'string' },
            status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            assigned_to: { type: 'string' }, due_date: { type: 'string' }, project_id: { type: 'string' },
        },
        required: ['task_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('update_work_task', {
            taskId: args.task_id, title: args.title, description: args.description, notes: args.notes,
            status: args.status, priority: args.priority, assignedTo: args.assigned_to,
            dueDate: args.due_date, projectId: args.project_id,
        });
        return fmtResult(resp, `Work task ${args.task_id} updated.`, `update_work_task failed`);
    },
    toolset: 'worktasks',
    tier: 'public',
});

registry.register({
    name: 'delete_work_task',
    description: 'Delete a work task by ID.',
    schema: {
        type: 'object',
        properties: { task_id: { type: 'string' } },
        required: ['task_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('delete_work_task', { taskId: args.task_id });
        return fmtResult(resp, `Work task ${args.task_id} deleted.`, `delete_work_task failed`);
    },
    toolset: 'worktasks',
    tier: 'public',
});

// --- Deliverables ---
registry.register({
    name: 'add_deliverable',
    description: 'Add a deliverable to a project.',
    schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' }, name: { type: 'string' }, due_date: { type: 'string' },
        },
        required: ['project_id', 'name'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('add_deliverable', {
            projectId: args.project_id, name: args.name, dueDate: args.due_date,
        });
        return fmtResult(resp, `Deliverable "${args.name}" added.`, `add_deliverable failed`);
    },
    toolset: 'deliverables',
    tier: 'public',
});

registry.register({
    name: 'toggle_deliverable',
    description: 'Toggle a deliverable done/not done.',
    schema: {
        type: 'object',
        properties: { deliverable_id: { type: 'string' } },
        required: ['deliverable_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('toggle_deliverable', { deliverableId: args.deliverable_id });
        return fmtResult(resp, `Deliverable ${args.deliverable_id} toggled.`, `toggle_deliverable failed`);
    },
    toolset: 'deliverables',
    tier: 'public',
});

registry.register({
    name: 'delete_deliverable',
    description: 'Delete a deliverable.',
    schema: {
        type: 'object',
        properties: { deliverable_id: { type: 'string' } },
        required: ['deliverable_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('delete_deliverable', { deliverableId: args.deliverable_id });
        return fmtResult(resp, `Deliverable ${args.deliverable_id} deleted.`, `delete_deliverable failed`);
    },
    toolset: 'deliverables',
    tier: 'public',
});

// --- Blockers ---
registry.register({
    name: 'add_blocker',
    description: 'Add a blocker to a project.',
    schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' }, description: { type: 'string' },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        },
        required: ['project_id', 'description'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('add_blocker', {
            projectId: args.project_id, description: args.description, severity: args.severity,
        });
        return fmtResult(resp, 'Blocker added.', `add_blocker failed`);
    },
    toolset: 'blockers',
    tier: 'public',
});

registry.register({
    name: 'delete_blocker',
    description: 'Remove a blocker.',
    schema: {
        type: 'object',
        properties: { blocker_id: { type: 'string' } },
        required: ['blocker_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('delete_blocker', { blockerId: args.blocker_id });
        return fmtResult(resp, `Blocker ${args.blocker_id} deleted.`, `delete_blocker failed`);
    },
    toolset: 'blockers',
    tier: 'public',
});

registry.register({
    name: 'add_priority',
    description: 'Add a priority item to a project.',
    schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' }, item: { type: 'string' },
            impact: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['project_id', 'item'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('add_priority', {
            projectId: args.project_id, item: args.item, impact: args.impact,
        });
        return fmtResult(resp, 'Priority added.', `add_priority failed`);
    },
    toolset: 'blockers',
    tier: 'public',
});

registry.register({
    name: 'delete_priority',
    description: 'Remove a priority item.',
    schema: {
        type: 'object',
        properties: { priority_id: { type: 'string' } },
        required: ['priority_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('delete_priority', { priorityId: args.priority_id });
        return fmtResult(resp, `Priority ${args.priority_id} deleted.`, `delete_priority failed`);
    },
    toolset: 'blockers',
    tier: 'public',
});

registry.register({
    name: 'update_financials',
    description: 'Update project financial data.',
    schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' }, budget: { type: 'number' }, spent: { type: 'number' },
            revenue: { type: 'number' }, notes: { type: 'string' },
        },
        required: ['project_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('update_financials', {
            projectId: args.project_id, budget: args.budget, spent: args.spent,
            revenue: args.revenue, notes: args.notes,
        });
        return fmtResult(resp, 'Financials updated.', `update_financials failed`);
    },
    toolset: 'blockers',
    tier: 'public',
});