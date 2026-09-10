// Orchestrator-side API tools (2026-09-09: these used to live in
// admin-tools.ts and were shared with iris; the admin cut dropped them from
// iris — the orchestrator still calls external APIs with them, so they stay
// registered here, owned by nobody in particular).
import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

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
    toolset: 'api',
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
            body: args.body ? (typeof args.body === 'string' ? (() => {
                try { return JSON.parse(args.body); }
                catch {
                    // Models sometimes emit raw newlines/tabs inside JSON string
                    // values, which makes JSON.parse throw. Escape control chars
                    // and retry before falling back to the raw string, so the
                    // forwarded body stays valid.
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
    toolset: 'api',
    tier: 'public',
});