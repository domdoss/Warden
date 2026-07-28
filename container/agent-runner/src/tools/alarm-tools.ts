import { registry } from '../tool-registry.js';
import { writeIpcFile, waitForResult, TASKS_DIR } from '../ipc-helpers.js';

registry.register({
    name: 'create_alarm',
    description: 'Create an alarm.',
    schema: {
        type: 'object',
        properties: {
            label: { type: 'string', description: 'Alarm label/message' },
            alarm_time: { type: 'string', description: 'Time in HH:MM format' },
            alarm_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            repeat_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'custom'] },
            repeat_days: { type: 'string', description: 'Comma-separated days for custom repeat (mon,tue,wed...)' },
            sound: { type: 'string' },
        },
        required: ['label', 'alarm_time'],
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'create_alarm', label: args.label, alarm_time: args.alarm_time, alarm_date: args.alarm_date, repeat_type: args.repeat_type, repeat_days: args.repeat_days, sound: args.sound, timestamp: new Date().toISOString() });
        return 'Alarm created.';
    },
    toolset: 'alarms',
    tier: 'private',
});

registry.register({
    name: 'list_alarms',
    description: 'List alarms.',
    schema: { type: 'object', properties: {} },
    handler: async (_args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'list_alarms', timestamp: new Date().toISOString() });
        const data = await waitForResult('alarms-');
        if (data) return `Alarms:\n${JSON.stringify(data, null, 2).slice(0, 4000)}`;
        return 'Alarms list requested. Timeout waiting for results.';
    },
    toolset: 'alarms',
    tier: 'private',
});

registry.register({
    name: 'update_alarm',
    description: 'Update an alarm.',
    schema: {
        type: 'object',
        properties: {
            alarm_id: { type: 'string' }, label: { type: 'string' }, alarm_time: { type: 'string' },
            alarm_date: { type: 'string' }, repeat_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'custom'] },
            repeat_days: { type: 'string' }, enabled: { type: 'boolean' }, sound: { type: 'string' },
        },
        required: ['alarm_id'],
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'update_alarm', alarm_id: args.alarm_id, label: args.label, alarm_time: args.alarm_time, alarm_date: args.alarm_date, repeat_type: args.repeat_type, repeat_days: args.repeat_days, enabled: args.enabled, sound: args.sound, timestamp: new Date().toISOString() });
        return 'Alarm updated.';
    },
    toolset: 'alarms',
    tier: 'private',
});

registry.register({
    name: 'delete_alarm',
    description: 'Delete an alarm.',
    schema: {
        type: 'object',
        properties: { alarm_id: { type: 'string' } },
        required: ['alarm_id'],
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'delete_alarm', alarm_id: args.alarm_id, timestamp: new Date().toISOString() });
        return 'Alarm deleted.';
    },
    toolset: 'alarms',
    tier: 'private',
});
