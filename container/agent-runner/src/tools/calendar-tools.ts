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
    name: 'create_calendar_event',
    description: 'Create a calendar event. Visible in KOrganizer via the shared CalDAV calendar.',
    schema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Event title' },
            description: { type: 'string' },
            start_time: { type: 'string', description: 'Local ISO e.g. "2026-03-20T14:00:00"' },
            end_time: { type: 'string' },
            all_day: { type: 'boolean' },
            location: { type: 'string' },
        },
        required: ['title', 'start_time'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('create_calendar_event', {
            title: args.title, description: args.description,
            start_time: args.start_time, end_time: args.end_time,
            all_day: args.all_day, location: args.location,
        });
        if (resp?.ok) return `Calendar event "${args.title}" created (id ${resp.eventId}). Visible in KOrganizer.`;
        return `Calendar event create failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'calendar',
    tier: 'private',
});

registry.register({
    name: 'list_calendar_events',
    description: 'List calendar events in a date range (local ISO start/end). Source of truth is the shared CalDAV calendar.',
    schema: {
        type: 'object',
        properties: {
            start: { type: 'string', description: 'Local ISO lower bound' },
            end: { type: 'string', description: 'Local ISO upper bound' },
        },
    },
    handler: async (args, _context) => {
        const resp = await callHost('list_calendar_events', { start: args.start, end: args.end }, 60000);
        if (resp?.ok) {
            const events = resp.events || [];
            if (events.length === 0) return 'No calendar events found.';
            const lines = events.slice(0, 50).map((e: any, i: number) =>
                `${i + 1}. ${e.start} | ${e.title}${e.location ? ' @ ' + e.location : ''} (uid ${e.uid})`,
            ).join('\n');
            return `${events.length} events:\n${lines}`;
        }
        return `Calendar list failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'calendar',
    tier: 'private',
});

registry.register({
    name: 'update_calendar_event',
    description: 'Update an existing calendar event by uid. Only provided fields are changed.',
    schema: {
        type: 'object',
        properties: {
            event_id: { type: 'string', description: 'Event uid' },
            title: { type: 'string' }, description: { type: 'string' },
            start_time: { type: 'string' }, end_time: { type: 'string' },
            location: { type: 'string' }, all_day: { type: 'boolean' },
        },
        required: ['event_id'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('update_calendar_event', {
            event_id: args.event_id, title: args.title, description: args.description,
            start_time: args.start_time, end_time: args.end_time, location: args.location, all_day: args.all_day,
        });
        if (resp?.ok) return `Calendar event ${args.event_id} updated.`;
        return `Calendar event update failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'calendar',
    tier: 'private',
});

registry.register({
    name: 'delete_calendar_event',
    description: 'Delete a calendar event by uid.',
    schema: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] },
    handler: async (args, _context) => {
        const resp = await callHost('delete_calendar_event', { event_id: args.event_id });
        if (resp?.ok) return `Calendar event ${args.event_id} deleted.`;
        return `Calendar event delete failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'calendar',
    tier: 'private',
});