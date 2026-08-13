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
    name: 'read_emails',
    description: "Read emails from the user's connected email account. Account is resolved automatically from the user's identity. Use `since` (and optionally `before`) to fetch emails in a specific date range — both are ISO 8601 timestamps (e.g. \"2026-08-01T00:00:00Z\"). Use this when the user asks to look up emails from a past period (\"my emails from last week\", \"anything from August\"). Leave both empty for just the most recent emails.",
    schema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Max emails to fetch before date filtering (default: 500)' },
            preview_only: { type: 'boolean', description: 'Return previews only (default: true)' },
            folder: { type: 'string', description: 'Mail folder (default: INBOX)' },
            search: { type: 'string', description: 'Optional text search (provider query, e.g. Gmail q=)' },
            since: { type: 'string', description: 'ISO 8601 timestamp — only return emails received at/after this' },
            before: { type: 'string', description: 'ISO 8601 timestamp — only return emails received before this' },
        },
    },
    handler: async (args, context) => {
        const limit = Math.min(parseInt(args.limit) || 500, 500);
        // A date-range lookup (since/before) with a large limit can take well
        // over the default 30s — fetching hundreds of emails from Gmail/Graph
        // is slow. Give read_emails a 90s ceiling so Iris/Byte don't get a
        // spurious timeout on a week-long range. Plain recent-email reads still
        // finish in a few seconds.
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
                // Include whatever body text the host returned (full body from the
                // warm cache, or the provider snippet for a live preview-only
                // fetch). The full body is available via get_email using the id.
                const body = (e.body || e.snippet || '').replace(/\s+/g, ' ').trim();
                const preview = body ? `\n   ${body.slice(0, 500)}` : '';
                return `${head}${preview}`;
            }).join('\n');
            return `${emails.length} emails found:\n${summaries}`;
        }
        return `Email read failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'email',
    tier: 'private',
});

registry.register({
    name: 'send_email',
    description: "Send an email from the user's connected email account.",
    schema: {
        type: 'object',
        properties: {
            to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
    },
    handler: async (args, context) => {
        const resp = await callHost('send_email', {
            userId: context.userId, to: args.to, subject: args.subject, body: args.body, html: false,
            chatJid: context.chatJid,
        });
        if (resp?.ok) return `Email sent to ${args.to} with subject: ${args.subject}`;
        return `Email send failed: ${resp?.error || 'Unknown error'}`;
    },
    toolset: 'email',
    tier: 'private',
});

registry.register({
    name: 'get_email',
    description: 'Get a specific email by ID.',
    schema: {
        type: 'object',
        properties: { email_id: { type: 'string' } },
        required: ['email_id'],
    },
    handler: async (args, context) => {
        const resp = await callHost('get_email', { emailId: args.email_id, userId: context.userId }, 60000);
        if (resp?.ok && resp.email) {
            const e = resp.email;
            return `Email content:\nFrom: ${e.from || 'unknown'}\nSubject: ${e.subject || '(no subject)'}\nDate: ${e.date || ''}\n\n${e.body || ''}`;
        }
        return `Email fetch failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'email',
    tier: 'private',
});

registry.register({
    name: 'refresh_email_cache',
    description: "Refresh the email cache for the user's account.",
    schema: { type: 'object', properties: {} },
    handler: async (args, context) => {
        const resp = await callHost('refresh_email_cache', { userId: context.userId });
        if (resp?.ok) return `Email cache refreshed: ${resp.count ?? 0} emails cached.`;
        return `Email cache refresh failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'email',
    tier: 'private',
});

registry.register({
    name: 'get_cached_emails',
    description: 'Get emails from local cache. Use refresh_email_cache first.',
    schema: { type: 'object', properties: {} },
    handler: async (args, context) => {
        const resp = await callHost('get_cached_emails', { userId: context.userId });
        if (resp?.ok) return `Cached emails:\n${JSON.stringify(resp.emails, null, 2).slice(0, 4000)}`;
        return `Cached emails fetch failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'email',
    tier: 'private',
});
