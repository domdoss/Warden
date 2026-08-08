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
    name: 'add_digest_note',
    description: 'Add a finding for Iris to fold into the digest. Call AFTER looking something up. Short and factual.\n\nTargeting by WHEN it matters (set spans + expires_at accordingly):\n- Today / in-progress → spans=["hourly"], expires_at = when it ends (repeats each hour until then).\n- Tomorrow → spans=["daily"], expires_at = start of the event day (so the day-of, an hourly note takes over).\n- Next week or beyond → spans=["weekly"], expires_at = the day before the event.\n- Snapshot (a result, a fact, news) → omit expiry; shown once per target span then dropped.\nThe day before an event, also post a daily "X tomorrow" note.',
    schema: {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'The finding — one concise sentence or a few markdown bullets.' },
            source: { type: 'string', description: 'Optional label, e.g. "canucks", "news", "tour", "aapl"' },
            expires_at: { type: 'string', description: 'ISO timestamp when this stops being relevant (e.g. game end). While unexpired the note repeats in each target digest; after, it is purged. Omit for a one-shot snapshot.' },
            ttl_minutes: { type: 'number', description: 'Alternative to expires_at: minutes from now until expiry (e.g. 180 for 3h).' },
            spans: { type: 'array', items: { type: 'string', enum: ['hourly', 'daily', 'weekly'] }, description: 'Which digests should include this. Default all three. Use ["hourly"] for today-only items.' },
        },
        required: ['text'],
    },
    handler: async (args, _context) => {
        try {
            const spans = Array.isArray(args.spans) ? args.spans.map(String) : undefined;
            const data = await writeCallbackAsync('add_digest_note', {
                text: String(args.text || ''),
                source: String(args.source || ''),
                expires_at: args.expires_at ? String(args.expires_at) : undefined,
                ttl_minutes: typeof args.ttl_minutes === 'number' ? args.ttl_minutes : undefined,
                spans,
            }, 15000);
            if (data && data.error) return `Error: ${data.error}`;
            return data && data.ok ? 'Added to digest context — Iris will fold it into the next digest.' : 'Failed to add digest note.';
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
            body: args.body ? (typeof args.body === 'string' ? (() => { try { return JSON.parse(args.body); } catch { return args.body; } })() : args.body) : undefined,
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
