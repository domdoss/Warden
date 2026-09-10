// Iris's merged action tools — ONE tool per noun, `action` selects the
// operation (2026-09-09 collapse: 41 flat schemas → 4 core tools — email,
// scheduled tasks, calendar, alarms; project management + admin dropped from
// iris entirely). Every action calls the SAME host callback with the SAME
// payload the old flat tool used, and returns the SAME result text — only the
// tool-call surface changed, so the host is untouched. The fine-tune is
// retrained on these schemas (see training/).
//
// Dispatch notes:
// - task() replicates the old name-keyed interception in index.ts
//   (schedule/cancel/pause/resume/update are parent-routed and must report the
//   parent's REAL result; list is fire-and-forget "requested from parent").
//   The interception matched on tool names that no longer exist, so the logic
//   lives here now.
import { registry } from '../tool-registry.js';
import { writeCallback, writeCallbackAsync } from '../index.js';

async function callHost(tool: string, args: any, timeoutMs = 30000): Promise<any> {
    try {
        return await writeCallbackAsync(tool, args, timeoutMs);
    } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
    }
}

// ─── email: read | get | send | refresh | cached ──────────────────────────
registry.register({
    name: 'email',
    description: "The user's email. action=read lists recent emails (or a date range via since/before, both ISO 8601); action=get fetches one full email by id; action=send sends from the user's account; action=refresh re-syncs the local cache; action=cached lists from the local cache. For an inbox scan, read with the window the request names and report what you find.",
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['read', 'get', 'send', 'refresh', 'cached'], description: 'Which email operation to perform.' },
            limit: { type: 'number', description: 'read: max emails to fetch before date filtering (default: 500)' },
            preview_only: { type: 'boolean', description: 'read: return previews only (default: true)' },
            folder: { type: 'string', description: 'read: mail folder (default: INBOX)' },
            search: { type: 'string', description: 'read: optional text search (provider query, e.g. Gmail q=)' },
            since: { type: 'string', description: 'read: ISO 8601 timestamp — only emails received at/after this' },
            before: { type: 'string', description: 'read: ISO 8601 timestamp — only emails received before this' },
            email_id: { type: 'string', description: 'get: the email id from a read result' },
            to: { type: 'string', description: 'send: recipient address' },
            subject: { type: 'string', description: 'send: subject line' },
            body: { type: 'string', description: 'send: email body' },
        },
        required: ['action'],
    },
    handler: async (args, context) => {
        const a = String(args.action || '');
        if (a === 'read') {
            const limit = Math.min(parseInt(args.limit) || 500, 500);
            // A date-range lookup (since/before) with a large limit can take well
            // over the default 30s — fetching hundreds of emails from Gmail/Graph
            // is slow, so a read gets a 90s ceiling. Plain recent-email reads
            // still finish in a few seconds.
            const resp = await callHost('read_emails', {
                userId: context.userId, folder: args.folder || 'INBOX',
                limit,
                search: typeof args.search === 'string' ? args.search : undefined,
                since: typeof args.since === 'string' ? args.since : undefined,
                before: typeof args.before === 'string' ? args.before : undefined,
                preview_only: args.preview_only !== false && args.preview_only !== 'false',
            }, 90000);
            if (resp?.ok) {
                const emails = resp.emails || [];
                if (emails.length === 0) return 'No emails found.';
                const summaries = emails.slice(0, 50).map((e: any, i: number) => {
                    const id = e.id ? `[id: ${e.id}] ` : '';
                    const head = `${i + 1}. ${id}From: ${e.from || 'unknown'} | Subject: ${e.subject || '(no subject)'} | Date: ${e.date || ''}`;
                    const body = (e.body || e.snippet || '').replace(/\s+/g, ' ').trim();
                    const preview = body ? `\n   ${body.slice(0, 500)}` : '';
                    return `${head}${preview}`;
                }).join('\n');
                return `${emails.length} emails found:\n${summaries}`;
            }
            return `Email read failed: ${resp?.error || 'unknown error'}`;
        }
        if (a === 'get') {
            const resp = await callHost('get_email', { emailId: args.email_id, userId: context.userId }, 60000);
            if (resp?.ok && resp.email) {
                const e = resp.email;
                return `Email content:\nFrom: ${e.from || 'unknown'}\nSubject: ${e.subject || '(no subject)'}\nDate: ${e.date || ''}\n\n${e.body || ''}`;
            }
            return `Email fetch failed: ${resp?.error || 'unknown error'}`;
        }
        if (a === 'send') {
            const resp = await callHost('send_email', {
                userId: context.userId, to: args.to, subject: args.subject, body: args.body, html: false,
                chatJid: context.chatJid,
            });
            if (resp?.ok) return `Email sent to ${args.to} with subject: ${args.subject}`;
            return `Email send failed: ${resp?.error || 'Unknown error'}`;
        }
        if (a === 'refresh') {
            const resp = await callHost('refresh_email_cache', { userId: context.userId });
            if (resp?.ok) return `Email cache refreshed: ${resp.count ?? 0} emails cached.`;
            return `Email cache refresh failed: ${resp?.error || 'unknown error'}`;
        }
        if (a === 'cached') {
            const resp = await callHost('get_cached_emails', { userId: context.userId });
            if (resp?.ok) return `Cached emails:\n${JSON.stringify(resp.emails, null, 2).slice(0, 4000)}`;
            return `Cached emails fetch failed: ${resp?.error || 'unknown error'}`;
        }
        return `Unknown email action "${a}" — use read, get, send, refresh, or cached.`;
    },
    toolset: 'email',
    tier: 'private',
});

// ─── task: schedule | list | pause | resume | cancel | update ─────────────
registry.register({
    name: 'task',
    description: 'Scheduled tasks / reminders — things that fire on a clock. action=schedule creates a recurring or one-time task; action=list lists all scheduled tasks; pause/resume/cancel/update manage one by task_id. For schedule: pass an ISO-8601 duration (e.g. "PT2M") for a relative "in N minutes/hours" once task and the host computes the fire time — do NOT do timestamp arithmetic yourself; for an absolute "at a specific time" once task pass a LOCAL timestamp computed from the current local time in your context.',
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['schedule', 'list', 'pause', 'resume', 'cancel', 'update'], description: 'Which scheduled-task operation to perform.' },
            task_id: { type: 'string', description: 'pause/resume/cancel/update: the task id' },
            prompt: { type: 'string', description: 'schedule/update: what the task does when it fires' },
            schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'], description: 'schedule/update: cron=recurring at set times, interval=every N milliseconds, once=single run at a specific time or after a delay' },
            schedule_value: { type: 'string', description: 'schedule/update: cron: five fields in order — minute hour day-of-month month day-of-week, "*" = any ("30 10 * * *" = 10:30 AM daily) | interval: milliseconds like "300000" (5 min) | once: either an ISO-8601 DURATION like "PT2M" (in 2 minutes), "PT1H30M", "P1D" — the host adds this to now, so prefer this for any "in …"/"N from now" request and do NOT compute a timestamp yourself — OR an ABSOLUTE local timestamp like "2026-05-27T09:25:00" (no "Z"/timezone suffix) for a named clock time. NEVER pass natural language such as "in 5 minutes" or "tomorrow".' },
            context_mode: { type: 'string', enum: ['group', 'isolated'], description: 'schedule: whether the fired turn sees the conversation history' },
        },
        required: ['action'],
    },
    handler: async (args, context) => {
        const a = String(args.action || '');
        // schedule/cancel/pause/resume/update are parent-routed and must report
        // the parent's REAL result: the parent creates/updates the DB record and
        // returns { ok, taskId } or { ok: false, error } — never fabricate
        // success (the old fire-and-forget path claimed "scheduled" even when
        // the DB insert failed).
        if (['schedule', 'cancel', 'pause', 'resume', 'update'].includes(a)) {
            const hostArgs: any = a === 'schedule'
                ? { prompt: args.prompt, schedule_type: args.schedule_type, schedule_value: args.schedule_value, context_mode: args.context_mode || 'group', targetJid: context.chatJid, createdBy: context.groupFolder }
                : a === 'update'
                    ? { taskId: args.task_id, prompt: args.prompt, schedule_type: args.schedule_type, schedule_value: args.schedule_value }
                    : { taskId: args.task_id, groupFolder: context.groupFolder, isMain: context.isMain };
            try {
                const cbResult = await writeCallbackAsync(a === 'schedule' ? 'schedule_task' : `${a}_task`, hostArgs, 15000);
                if (cbResult?.ok) {
                    return a === 'schedule'
                        ? JSON.stringify({ ok: true, taskId: cbResult.taskId, message: `Task scheduled (id: ${cbResult.taskId}, type: ${args.schedule_type}, value: ${args.schedule_value}, prompt: "${String(args.prompt || '').slice(0, 200)}"). It will run at the specified time.` })
                        : JSON.stringify({ ok: true, message: `Task ${args.task_id || 'n/a'} ${a === 'cancel' ? 'cancelled' : a + 'd'}.` });
                }
                return JSON.stringify({ ok: false, error: cbResult?.error || `${a} failed in the parent process` });
            } catch (err: any) {
                return JSON.stringify({ ok: false, error: `${a} callback failed: ${err?.message ?? err}` });
            }
        }
        if (a === 'list') {
            // Parent-routed too — only the parent has DB access. Fire-and-forget:
            // the parent writes the list into the shared IPC state.
            writeCallback('list_tasks', {});
            return JSON.stringify({ ok: true, message: 'Task list requested from parent.' });
        }
        return `Unknown task action "${a}" — use schedule, list, pause, resume, cancel, or update.`;
    },
    toolset: 'tasks',
    tier: 'public',
});

// ─── calendar: create | list | update | delete ────────────────────────────
registry.register({
    name: 'calendar',
    description: 'The local calendar (DB). action=create adds an event; action=list shows events in a date range; action=update changes an existing event by event_id (only provided fields change); action=delete removes one by event_id.',
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['create', 'list', 'update', 'delete'], description: 'Which calendar operation to perform.' },
            title: { type: 'string', description: 'create/update: event title' },
            description: { type: 'string', description: 'create/update: event description' },
            start_time: { type: 'string', description: 'create/update: local ISO e.g. "2026-03-20T14:00:00"' },
            end_time: { type: 'string', description: 'create/update: local ISO end time' },
            all_day: { type: 'boolean', description: 'create/update: all-day event' },
            location: { type: 'string', description: 'create/update: event location' },
            start: { type: 'string', description: 'list: local ISO lower bound' },
            end: { type: 'string', description: 'list: local ISO upper bound' },
            event_id: { type: 'string', description: 'update/delete: the event uid from a list result' },
        },
        required: ['action'],
    },
    handler: async (args, _context) => {
        const a = String(args.action || '');
        if (a === 'create') {
            const resp = await callHost('create_calendar_event', {
                title: args.title, description: args.description,
                start_time: args.start_time, end_time: args.end_time,
                all_day: args.all_day, location: args.location,
            });
            if (resp?.ok) return `Calendar event "${args.title}" created (id ${resp.eventId}). Stored in the local calendar.`;
            return `Calendar event create failed: ${resp?.error || 'unknown error'}`;
        }
        if (a === 'list') {
            const resp = await callHost('list_calendar_events', { start: args.start, end: args.end }, 60000);
            if (resp?.ok) {
                const events = resp.events || [];
                if (events.length === 0) return 'No calendar events found.';
                const lines = events.slice(0, 50).map((e: any, i: number) => {
                    const start = e.start || e.start_time || '';
                    const end = e.end || e.end_time || '';
                    const allDay = e.all_day || e.allDay;
                    const when = allDay ? start : `${start}${end ? ' → ' + end : ''}`;
                    const desc = e.description ? `\n      ${String(e.description).slice(0, 280)}` : '';
                    return `${i + 1}. ${when} | ${e.title}${e.location ? ' @ ' + e.location : ''} (uid ${e.uid || e.event_id})${desc}`;
                }).join('\n\n');
                return `${events.length} events:\n${lines}`;
            }
            return `Calendar list failed: ${resp?.error || 'unknown error'}`;
        }
        if (a === 'update') {
            const resp = await callHost('update_calendar_event', {
                event_id: args.event_id, title: args.title, description: args.description,
                start_time: args.start_time, end_time: args.end_time, location: args.location, all_day: args.all_day,
            });
            if (resp?.ok) return `Calendar event ${args.event_id} updated.`;
            return `Calendar event update failed: ${resp?.error || 'unknown error'}`;
        }
        if (a === 'delete') {
            const resp = await callHost('delete_calendar_event', { event_id: args.event_id });
            if (resp?.ok) return `Calendar event ${args.event_id} deleted.`;
            return `Calendar event delete failed: ${resp?.error || 'unknown error'}`;
        }
        return `Unknown calendar action "${a}" — use create, list, update, or delete.`;
    },
    toolset: 'calendar',
    tier: 'private',
});

// ─── alarm: create | list | update | delete ───────────────────────────────
registry.register({
    name: 'alarm',
    description: 'Alarms — clock alerts with a label. action=create sets one (label + alarm_time HH:MM required); action=list shows all; action=update changes one by alarm_id; action=delete removes one by alarm_id.',
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['create', 'list', 'update', 'delete'], description: 'Which alarm operation to perform.' },
            label: { type: 'string', description: 'create/update: alarm label/message' },
            alarm_time: { type: 'string', description: 'create/update: time in HH:MM format' },
            alarm_date: { type: 'string', description: 'create/update: date in YYYY-MM-DD (one-time alarms only; omit for today)' },
            repeat_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'custom'], description: 'create/update: repeat pattern' },
            repeat_days: { type: 'string', description: 'create/update: comma-separated days for custom repeat (mon,tue,wed...)' },
            enabled: { type: 'boolean', description: 'update: enable/disable the alarm' },
            sound: { type: 'string', description: 'create/update: alarm sound' },
            alarm_id: { type: 'string', description: 'update/delete: the alarm id' },
        },
        required: ['action'],
    },
    handler: async (args, context) => {
        const a = String(args.action || '');
        const ipc = (payload: any) => writeCallbackAsync('ipc', { userId: context.userId || '', groupFolder: context.groupFolder || '', ...payload });
        if (a === 'create') {
            const res = await ipc({ type: 'create_alarm', label: args.label, alarm_time: args.alarm_time, alarm_date: args.alarm_date, repeat_type: args.repeat_type, repeat_days: args.repeat_days, sound: args.sound });
            if (res?.ok) {
                const al = res.alarm || {};
                return `Alarm created: "${al.label ?? args.label}" at ${al.alarm_time ?? args.alarm_time}${al.alarm_date ? ` on ${al.alarm_date}` : ''}${al.repeat_type && al.repeat_type !== 'once' ? ` (repeats ${al.repeat_type})` : ''}.`;
            }
            return `Failed to create alarm: ${res?.error ?? 'no response from host'}`;
        }
        if (a === 'list') {
            const res = await ipc({ type: 'list_alarms' });
            if (res?.ok) {
                const alarms = res.alarms || [];
                if (!alarms.length) return 'No alarms set.';
                return `Alarms:\n${alarms.map((al: any) => `- [${al.id}] ${al.enabled ? '' : '(disabled) '}"${al.label}" at ${al.alarm_time}${al.alarm_date ? ` on ${al.alarm_date}` : ''} repeat=${al.repeat_type}`).join('\n')}`;
            }
            return `Failed to list alarms: ${res?.error ?? 'no response from host'}`;
        }
        if (a === 'update') {
            const res = await ipc({ type: 'update_alarm', alarm_id: args.alarm_id, label: args.label, alarm_time: args.alarm_time, alarm_date: args.alarm_date, repeat_type: args.repeat_type, repeat_days: args.repeat_days, enabled: args.enabled, sound: args.sound });
            if (res?.ok) return `Alarm updated.`;
            return `Failed to update alarm: ${res?.error ?? 'no response from host'}`;
        }
        if (a === 'delete') {
            const res = await ipc({ type: 'delete_alarm', alarm_id: args.alarm_id });
            if (res?.ok) return 'Alarm deleted.';
            return `Failed to delete alarm: ${res?.error ?? 'no response from host'}`;
        }
        return `Unknown alarm action "${a}" — use create, list, update, or delete.`;
    },
    toolset: 'alarms',
    tier: 'private',
});