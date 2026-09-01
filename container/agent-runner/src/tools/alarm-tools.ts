import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

// Alarms are created/listed/updated/deleted in-process on the host through the
// stdio `ipc` callback channel (see the `ipc` handler in src/index.ts). The
// previous writeIpcFile(TASKS_DIR) implementation dropped files into a dir no
// watcher reads, so the host never saw them and alarms silently never fired.

registry.register({
    name: 'create_alarm',
    description: 'Create an alarm.',
    schema: {
        type: 'object',
        properties: {
            label: { type: 'string', description: 'Alarm label/message' },
            alarm_time: { type: 'string', description: 'Time in HH:MM format' },
            alarm_date: { type: 'string', description: 'Date in YYYY-MM-DD format (one-time alarms only; omit for today)' },
            repeat_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'custom'] },
            repeat_days: { type: 'string', description: 'Comma-separated days for custom repeat (mon,tue,wed...)' },
            sound: { type: 'string' },
        },
        required: ['label', 'alarm_time'],
    },
    handler: async (args, context) => {
        const res = await writeCallbackAsync('ipc', { type: 'create_alarm', label: args.label, alarm_time: args.alarm_time, alarm_date: args.alarm_date, repeat_type: args.repeat_type, repeat_days: args.repeat_days, sound: args.sound, userId: context.userId || '', groupFolder: context.groupFolder || '' });
        if (res?.ok) {
            const a = res.alarm || {};
            return `Alarm created: "${a.label ?? args.label}" at ${a.alarm_time ?? args.alarm_time}${a.alarm_date ? ` on ${a.alarm_date}` : ''}${a.repeat_type && a.repeat_type !== 'once' ? ` (repeats ${a.repeat_type})` : ''}.`;
        }
        return `Failed to create alarm: ${res?.error ?? 'no response from host'}`;
    },
    toolset: 'alarms',
    tier: 'private',
});

registry.register({
    name: 'list_alarms',
    description: 'List alarms.',
    schema: { type: 'object', properties: {} },
    handler: async (_args, context) => {
        const res = await writeCallbackAsync('ipc', { type: 'list_alarms', userId: context.userId || '' });
        if (res?.ok) {
            const alarms = res.alarms || [];
            if (!alarms.length) return 'No alarms set.';
            return `Alarms:\n${alarms.map((a: any) => `- [${a.id}] ${a.enabled ? '' : '(disabled) '}"${a.label}" at ${a.alarm_time}${a.alarm_date ? ` on ${a.alarm_date}` : ''} repeat=${a.repeat_type}`).join('\n')}`;
        }
        return `Failed to list alarms: ${res?.error ?? 'no response from host'}`;
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
    handler: async (args, context) => {
        const res = await writeCallbackAsync('ipc', { type: 'update_alarm', alarm_id: args.alarm_id, label: args.label, alarm_time: args.alarm_time, alarm_date: args.alarm_date, repeat_type: args.repeat_type, repeat_days: args.repeat_days, enabled: args.enabled, sound: args.sound, userId: context.userId || '' });
        if (res?.ok) return `Alarm updated.`;
        return `Failed to update alarm: ${res?.error ?? 'no response from host'}`;
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
    handler: async (args, context) => {
        const res = await writeCallbackAsync('ipc', { type: 'delete_alarm', alarm_id: args.alarm_id, userId: context.userId || '' });
        if (res?.ok) return 'Alarm deleted.';
        return `Failed to delete alarm: ${res?.error ?? 'no response from host'}`;
    },
    toolset: 'alarms',
    tier: 'private',
});
