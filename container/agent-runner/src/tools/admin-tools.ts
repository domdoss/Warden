import { registry } from '../tool-registry.js';
import { writeCallback, writeCallbackAsync } from '../index.js';

registry.register({
    name: 'register_group',
    description: 'Register a new group (main session only).',
    schema: {
        type: 'object',
        properties: { name: { type: 'string' }, trigger_pattern: { type: 'string' } },
        required: ['name'],
    },
    handler: async (args, context) => {
        if (!context.isMain) return 'Error: Only main session can register groups.';
        const folder = args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const jid = `web:${folder}`;
        writeCallback('ipc', { type: 'register_group', jid, name: args.name, folder, trigger: args.trigger_pattern || args.name, timestamp: new Date().toISOString() });
        return `Group "${args.name}" registered.`;
    },
    toolset: 'admin',
    tier: 'public',
});

registry.register({
    name: 'list_api_keys',
    description: "List the user's configured API keys. Returns names and base URLs. Use to discover what services are available.",
    schema: { type: 'object', properties: {} },
    handler: async (args, context) => {
        const keyData = await writeCallbackAsync('ipc', { type: 'list_api_keys', userId: context.userId || '', groupFolder: context.groupFolder || '', timestamp: new Date().toISOString() });
        if (keyData) {
            if (keyData.error) return `Error: ${keyData.error}`;
            const keys = keyData.keys || [];
            if (keys.length === 0) return 'No API keys configured. The user can add keys in the Keys tab of their dashboard.';
            return `Configured API keys:\n${keys.map((k: any) => `- ${k.label} (key_type: "${k.key_type}")${k.base_url ? ' — ' + k.base_url : ''}`).join('\n')}`;
        }
        return 'Timeout listing API keys.';
    },
    toolset: 'admin',
    tier: 'public',
});

registry.register({
    name: 'suggest_task',
    description: 'Suggest an actionable task for the user to review in the dashboard Suggested Tasks box. This only writes a suggestion — it never creates a real task; the user edits and commits it via the UI. Call once per actionable item found while scanning email. Give each suggestion a clear, self-contained title.',
    schema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'A short, actionable task title, phrased as an imperative the user can do.' },
            body: { type: 'string', description: 'A short note on what the task is and why (1-2 sentences).' },
            suggested_project: { type: 'string', description: 'A project name the task fits, or "personal" if none fits. Default "personal".' },
            due_date: { type: 'string', description: 'Due date as YYYY-MM-DD, only if the email states a deadline. Omit otherwise.' },
            source: { type: 'string', description: 'The source email, e.g. "Alex <alex@example.com>: Re: send the Q3 budget draft".' },
        },
        required: ['title'],
    },
    handler: async (args, _context) => {
        try {
            const data = await writeCallbackAsync('suggest_task', {
                title: String(args.title || ''),
                body: String(args.body || ''),
                suggested_project: String(args.suggested_project || 'personal'),
                due_date: args.due_date ? String(args.due_date) : undefined,
                source: String(args.source || ''),
            }, 15000);
            if (data && data.error) return `Error: ${data.error}`;
            return data && data.ok
                ? `Suggested task: ${args.title}${data.duplicate ? ' (already suggested — skipped duplicate)' : ''}.`
                : 'Failed to suggest task.';
        } catch (err: any) {
            return `Error: ${err?.message ?? String(err)}`;
        }
    },
    toolset: 'admin',
    tier: 'public',
});

registry.register({
    name: 'api_request',
    description: 'Call any external API with automatic key injection. The system injects stored API keys automatically — never hardcode keys. Use list_api_keys first to discover available services.',
    schema: {
        type: 'object',
        properties: {
            key_type: { type: 'string', description: 'API key name from list_api_keys (e.g. "openai", "github", "slack")' },
            method: { type: 'string', description: 'HTTP method: GET, POST, PUT, PATCH, DELETE (default GET)' },
            path: { type: 'string', description: 'API endpoint path (e.g. "/v1/chat/completions" or full URL)' },
            body: { type: 'string', description: 'JSON request body as string' },
            description: { type: 'string', description: 'What this request does (for logging)' },
        },
        required: ['key_type', 'path'],
    },
    handler: async (args, context) => {
        const data = await writeCallbackAsync('ipc', {
            type: 'api_request', key_type: args.key_type,
            method: (args.method || 'GET').toUpperCase(), path: args.path,
            headers: args.headers ? (typeof args.headers === 'string' ? JSON.parse(args.headers) : args.headers) : undefined,
            body: args.body ? (typeof args.body === 'string' ? (() => {
                try { return JSON.parse(args.body); }
                catch {
                    // Models sometimes emit raw newlines/tabs inside JSON string
                    // values, which makes JSON.parse throw ("Bad control character
                    // in string literal") and the downstream POST get rejected.
                    // Escape any control chars as \uXXXX and retry before falling
                    // back to the raw string, so the forwarded body stays valid.
                    try {
                        return JSON.parse(args.body.replace(
                            /[\x00-\x1F\x7F]/g,
                            (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
                        ));
                    } catch { return args.body; }
                }
            })() : args.body) : undefined,
            description: args.description || '', userId: context.userId || '',
            groupFolder: context.groupFolder || '', timestamp: new Date().toISOString(),
        });
        if (data) {
            if (data.error) return `API request failed: ${data.error}`;
            const bodyStr = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2);
            return `HTTP ${data.status} ${data.statusText}\n\n${bodyStr}`;
        }
        return 'API request timed out.';
    },
    toolset: 'admin',
    tier: 'public',
});

// Dedicated keyless tool for publishing a compiled digest to the dashboard.
// This is the internal-loopback case (POST to this Warden's own /api/summaries),
// split out from api_request so Iris never has to get key_type right to post a
// digest — api_request is for EXTERNAL services (OpenAI/GitHub/Slack) where a
// stored key + base_url must be resolved; a digest post needs neither and was
// failing with "no API key configured for key_type \"\"" when Iris forgot
// key_type. The host handler does the loopback fetch (no auth, no key).
registry.register({
    name: 'post_summary',
    description: 'Publish a compiled digest/summary so it shows in the dashboard digest panel. Keyless internal call — do NOT use api_request for this. Args: span (hourly|daily|weekly — which tab) and text (the markdown digest). Call once after compiling the digest.',
    schema: {
        type: 'object',
        properties: {
            span: { type: 'string', enum: ['hourly', 'daily', 'weekly'], description: 'Which digest tab this lands under.' },
            text: { type: 'string', description: 'The compiled digest as markdown.' },
        },
        required: ['span', 'text'],
    },
    handler: async (args, _context) => {
        try {
            const data = await writeCallbackAsync('ipc', {
                type: 'post_summary',
                span: String(args.span || ''),
                text: String(args.text || ''),
            }, 30000);
            if (data && data.error) return `Error: ${data.error}`;
            return data && data.ok
                ? `Posted ${args.span} digest (HTTP ${data.status}).`
                : `Failed to post digest (HTTP ${data?.status ?? 'no response'}).`;
        } catch (err: any) {
            return `Error: ${err?.message ?? String(err)}`;
        }
    },
    toolset: 'admin',
    tier: 'public',
});
