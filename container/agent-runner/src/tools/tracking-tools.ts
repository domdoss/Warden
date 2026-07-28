import { registry } from '../tool-registry.js';
import { writeIpcFile, waitForResult, TASKS_DIR } from '../ipc-helpers.js';

registry.register({
    name: 'log_time',
    description: 'Log time spent on a project.',
    schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' }, hours: { type: 'number', description: 'Hours spent' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD (default: today)' },
            description: { type: 'string' },
        },
        required: ['project_id', 'hours'],
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'log_time', projectId: args.project_id, hours: args.hours || 0, date: args.date || new Date().toISOString().split('T')[0], description: args.description, timestamp: new Date().toISOString() });
        return `Time logged: ${args.hours || 0} hours.`;
    },
    toolset: 'tracking',
    tier: 'public',
});

registry.register({
    name: 'start_timer',
    description: 'Start a timer for a project.',
    schema: {
        type: 'object',
        properties: { project_id: { type: 'string' }, description: { type: 'string' } },
        required: ['project_id'],
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'start_timer', projectId: args.project_id, description: args.description, timestamp: new Date().toISOString() });
        return 'Timer started.';
    },
    toolset: 'tracking',
    tier: 'public',
});

registry.register({
    name: 'stop_timer',
    description: 'Stop the active timer.',
    schema: {
        type: 'object',
        properties: { timer_id: { type: 'string', description: 'Timer ID (optional, stops most recent if omitted)' } },
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'stop_timer', timerId: args.timer_id, timestamp: new Date().toISOString() });
        return 'Timer stopped.';
    },
    toolset: 'tracking',
    tier: 'public',
});
