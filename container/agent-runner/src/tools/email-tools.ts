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
    description: "Read emails from the user's connected email account. Account is resolved automatically from the user's identity.",
    schema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Max emails (default: 500)' },
            preview_only: { type: 'boolean', description: 'Return previews only (default: true)' },
            folder: { type: 'string', description: 'Mail folder (default: INBOX)' },
            search: { type: 'string' },
        },
    },
    handler: async (args, context) => {
        const resp = await callHost('read_emails', {
            userId: context.userId, folder: args.folder || 'INBOX',
            limit: Math.min(parseInt(args.limit) || 500, 500), search: args.search || undefined,
            preview_only: args.preview_only !== false && args.preview_only !== 'false',
        });
        if (resp?.ok) {
            const emails = resp.emails || [];
            if (emails.length === 0) return 'No emails found.';
            const summaries = emails.slice(0, 50).map((e: any, i: number) =>
                `${i + 1}. From: ${e.from || 'unknown'} | Subject: ${e.subject || '(no subject)'} | Date: ${e.date || ''}`
            ).join('\n');
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
        const resp = await callHost('get_email', { emailId: args.email_id, userId: context.userId });
        if (resp?.ok) return `Email content:\n${JSON.stringify(resp.email, null, 2).slice(0, 4000)}`;
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
