// The merged `project` action tool (2026-09-11): the 17 flat project/work-task/
// deliverable/blocker/priority/financial tools collapsed into ONE tool per the
// iris merged-action pattern — `kind` selects the noun (project | task |
// deliverable | blocker | priority | financials), `action` selects the
// operation. Every action calls the SAME host callback with the SAME payload
// the old flat tool used, and returns the SAME result text — only the
// tool-call surface changed, so the host is untouched. Wired into iris-core.
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

registry.register({
    name: 'project',
    description: 'Projects, work tasks, deliverables, blockers, priorities, and financials. kind=project: action=create (name, description, due_date), list, get (project_id), update (project_id + fields), archive, complete, delete. kind=task (work tasks on the user dashboard): action=create (title, description, notes, priority, due_date, project_id — a plain task with no project lands in the user Personal project), list, update (task_id), delete (task_id). kind=deliverable: action=add (project_id, name, due_date), toggle (deliverable_id), delete (deliverable_id). kind=blocker: action=add (project_id, description, severity), delete (blocker_id). kind=priority: action=add (project_id, item, impact), delete (priority_id). kind=financials: action=update (project_id, budget, spent, revenue, notes).',
    schema: {
        type: 'object',
        properties: {
            kind: { type: 'string', enum: ['project', 'task', 'deliverable', 'blocker', 'priority', 'financials'], description: 'Which record type to operate on.' },
            action: { type: 'string', enum: ['create', 'list', 'get', 'update', 'archive', 'complete', 'delete', 'add', 'toggle'], description: 'Which operation to perform (not all apply to every kind).' },
            project_id: { type: 'string', description: 'id of the project (most actions; task create: optional — omit to use the Personal project)' },
            id: { type: 'string', description: 'id of the record being managed: task_id for tasks, deliverable_id, blocker_id, priority_id' },
            name: { type: 'string', description: 'project create: project name | deliverable add: deliverable name' },
            title: { type: 'string', description: 'task create/update: task title' },
            description: { type: 'string', description: 'project/task create/update, blocker add: description text' },
            notes: { type: 'string', description: 'task create/update, financials update: notes' },
            due_date: { type: 'string', description: 'project/task/deliverable create: due date' },
            project_code: { type: 'string', description: 'project create/update: project code' },
            status: { type: 'string', enum: ['On Track', 'At Risk', 'Blocked'], description: 'project update: status' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'task create/update: priority' },
            task_status: { type: 'string', enum: ['todo', 'in_progress', 'done'], description: 'task update: status' },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'blocker add: severity' },
            item: { type: 'string', description: 'priority add: the priority item' },
            impact: { type: 'string', enum: ['low', 'medium', 'high'], description: 'priority add: impact' },
            budget: { type: 'number', description: 'financials update: budget' },
            spent: { type: 'number', description: 'financials update: amount spent' },
            revenue: { type: 'number', description: 'financials update: revenue' },
        },
        required: ['kind', 'action'],
    },
    handler: async (args, context) => {
        const kind = String(args.kind || '');
        const action = String(args.action || '');

        if (kind === 'project') {
            if (action === 'create') {
                const resp = await callHost('create_project', {
                    name: args.name, description: args.description || '',
                    dueDate: args.due_date, projectCode: args.project_code,
                });
                if (resp?.ok && resp.project) {
                    return `Project "${args.name}" created with id ${resp.project.id}. Now call project kind=deliverable/blocker/priority/financials or kind=task using this project_id.`;
                }
                return `Project creation failed: ${resp?.error || 'unknown error'}`;
            }
            if (action === 'list') {
                const resp = await callHost('list_projects', {});
                return fmtResult(resp, 'Projects:', 'list_projects failed');
            }
            if (action === 'get') {
                const resp = await callHost('get_project', { projectId: args.project_id });
                return fmtResult(resp, 'Project details:', 'get_project failed');
            }
            if (action === 'update') {
                const resp = await callHost('update_project', {
                    projectId: args.project_id, name: args.name, description: args.description,
                    status: args.status, dueDate: args.due_date, projectCode: args.project_code,
                });
                return fmtResult(resp, `Project ${args.project_id} updated.`, `update_project failed`);
            }
            if (action === 'archive') {
                const resp = await callHost('archive_project', { projectId: args.project_id });
                return fmtResult(resp, `Project ${args.project_id} archived.`, `archive_project failed`);
            }
            if (action === 'complete') {
                const resp = await callHost('complete_project', { projectId: args.project_id });
                return fmtResult(resp, `Project ${args.project_id} marked complete.`, `complete_project failed`);
            }
            if (action === 'delete') {
                const resp = await callHost('delete_project', { projectId: args.project_id });
                return fmtResult(resp, `Project ${args.project_id} deleted.`, `delete_project failed`);
            }
            return `Unknown project action "${action}" — use create, list, get, update, archive, complete, or delete.`;
        }

        if (kind === 'task') {
            if (action === 'create') {
                const resp = await callHost('create_work_task', {
                    title: args.title, description: args.description || '', notes: args.notes || '',
                    priority: args.priority || 'medium',
                    createdBy: context.groupFolder, dueDate: args.due_date || undefined,
                    projectId: args.project_id || undefined,
                });
                return fmtResult(resp, `Work task "${args.title}" created.`, `create_work_task failed`);
            }
            if (action === 'list') {
                const resp = await callHost('list_work_tasks', {});
                return fmtResult(resp, 'Work tasks:', 'list_work_tasks failed');
            }
            if (action === 'update') {
                const resp = await callHost('update_work_task', {
                    taskId: args.id, title: args.title, description: args.description, notes: args.notes,
                    status: args.task_status, priority: args.priority,
                    dueDate: args.due_date, projectId: args.project_id,
                });
                return fmtResult(resp, `Work task ${args.id} updated.`, `update_work_task failed`);
            }
            if (action === 'delete') {
                const resp = await callHost('delete_work_task', { taskId: args.id });
                return fmtResult(resp, `Work task ${args.id} deleted.`, `delete_work_task failed`);
            }
            return `Unknown task action "${action}" — use create, list, update, or delete.`;
        }

        if (kind === 'deliverable') {
            if (action === 'add') {
                const resp = await callHost('add_deliverable', { projectId: args.project_id, name: args.name, dueDate: args.due_date });
                return fmtResult(resp, `Deliverable "${args.name}" added.`, `add_deliverable failed`);
            }
            if (action === 'toggle') {
                const resp = await callHost('toggle_deliverable', { deliverableId: args.id });
                return fmtResult(resp, `Deliverable ${args.id} toggled.`, `toggle_deliverable failed`);
            }
            if (action === 'delete') {
                const resp = await callHost('delete_deliverable', { deliverableId: args.id });
                return fmtResult(resp, `Deliverable ${args.id} deleted.`, `delete_deliverable failed`);
            }
            return `Unknown deliverable action "${action}" — use add, toggle, or delete.`;
        }

        if (kind === 'blocker') {
            if (action === 'add') {
                const resp = await callHost('add_blocker', { projectId: args.project_id, description: args.description, severity: args.severity });
                return fmtResult(resp, 'Blocker added.', `add_blocker failed`);
            }
            if (action === 'delete') {
                const resp = await callHost('delete_blocker', { blockerId: args.id });
                return fmtResult(resp, `Blocker ${args.id} deleted.`, `delete_blocker failed`);
            }
            return `Unknown blocker action "${action}" — use add or delete.`;
        }

        if (kind === 'priority') {
            if (action === 'add') {
                const resp = await callHost('add_priority', { projectId: args.project_id, item: args.item, impact: args.impact });
                return fmtResult(resp, 'Priority added.', `add_priority failed`);
            }
            if (action === 'delete') {
                const resp = await callHost('delete_priority', { priorityId: args.id });
                return fmtResult(resp, `Priority ${args.id} deleted.`, `delete_priority failed`);
            }
            return `Unknown priority action "${action}" — use add or delete.`;
        }

        if (kind === 'financials') {
            if (action === 'update') {
                const resp = await callHost('update_financials', {
                    projectId: args.project_id, budget: args.budget, spent: args.spent,
                    revenue: args.revenue, notes: args.notes,
                });
                return fmtResult(resp, 'Financials updated.', `update_financials failed`);
            }
            return `Unknown financials action "${action}" — use update.`;
        }

        return `Unknown kind "${kind}" — use project, task, deliverable, blocker, priority, or financials.`;
    },
    toolset: 'projects',
    tier: 'public',
});