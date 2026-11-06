// Slack — personal-assistant queries over the user's Slack workspace. ONE merged
// action tool (the iris/project pattern): `action` picks the operation. Reads the
// bot token directly (process.env first, then data/env/env) so it works in the
// agent-runner child process with no host plumbing. All calls hit the Slack Web
// API over plain HTTPS. Credentials: SLACK_BOT_TOKEN (xoxb-…, required) and, for
// the `mentions` action, SLACK_USER_ID (the user's own Slack member id, U…).
import { registry } from '../tool-registry.js';
import { readToken } from './ext-env.js';

const SLACK_API = 'https://slack.com/api/';

async function slackApi(token: string, method: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(method, SLACK_API);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
    });
    return res.json().catch(() => ({ ok: false, error: 'non-JSON response' }));
}

async function slackPost(token: string, method: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(SLACK_API + method, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    return res.json().catch(() => ({ ok: false, error: 'non-JSON response' }));
}

function fmtMessage(m: any, i: number): string {
    const ts = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : '';
    const user = m.username || m.user || 'unknown';
    const text = String(m.text || '').replace(/<@([A-Z0-9]+)>/g, '@$1').replace(/\s+/g, ' ').trim().slice(0, 400);
    const channel = m.channel?.name || m.channel?.id || '';
    return `${i + 1}. ${ts}${channel ? ` #${channel}` : ''} ${user}: ${text}`;
}

registry.register({
    name: 'slack',
    description: '{"what":"query the user\'s Slack workspace","how":"action picks the operation","answer":"the returned result text","actions":{"mentions":"search messages that @-mention the user","search":"keyword search over messages","channels":"list channels","history":"recent messages in one channel","send":"post a message"}}',
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['mentions', 'search', 'channels', 'history', 'send'], description: '{"what":"the operation","vals":"mentions|search|channels|history|send"}' },
            query: { type: 'string', description: '{"what":"mentions/search: the search text","mentions":"optional — omit to auto-search for <@SLACK_USER_ID>","search":"required keyword"}' },
            channel: { type: 'string', description: '{"what":"history/send: the channel id or name (e.g. general or C0123ABC)"}' },
            limit: { type: 'number', description: '{"what":"history: max messages","default":20,"max":100}' },
            text: { type: 'string', description: '{"what":"send: the message text to post"}' },
        },
        required: ['action'],
    },
    handler: async (args) => {
        const action = String(args.action || '');
        const token = readToken('SLACK_BOT_TOKEN');
        if (!token) {
            return 'Slack is not configured (SLACK_BOT_TOKEN is not set in data/env/env).';
        }

        if (action === 'mentions') {
            const userId = readToken('SLACK_USER_ID');
            const query = typeof args.query === 'string' && args.query.trim()
                ? args.query.trim()
                : (userId ? `<@${userId}>` : '');
            if (!query) {
                return 'Cannot search Slack mentions: SLACK_USER_ID (the user\'s Slack member id, U…) is not set in data/env/env, and no query was given.';
            }
            const r = await slackApi(token, 'search.messages', { query, count: '20', sort: 'timestamp' });
            if (!r.ok) return `Slack mention search failed: ${r.error || 'unknown error'}`;
            const msgs = r.messages?.matches || [];
            if (!msgs.length) return `No recent Slack messages mention ${userId ? 'you' : `"${query}"`}.`;
            return `${msgs.length} Slack mention(s):\n${msgs.map(fmtMessage).join('\n')}`;
        }

        if (action === 'search') {
            const query = String(args.query || '').trim();
            if (!query) return 'Slack search needs a query.';
            const r = await slackApi(token, 'search.messages', { query, count: '20', sort: 'timestamp' });
            if (!r.ok) return `Slack search failed: ${r.error || 'unknown error'}`;
            const msgs = r.messages?.matches || [];
            if (!msgs.length) return `No Slack messages match "${query}".`;
            return `${msgs.length} Slack match(es) for "${query}":\n${msgs.map(fmtMessage).join('\n')}`;
        }

        if (action === 'channels') {
            const r = await slackApi(token, 'conversations.list', { types: 'public_channel,private_channel', limit: '200' });
            if (!r.ok) return `Slack channel list failed: ${r.error || 'unknown error'}`;
            const chans = r.channels || [];
            if (!chans.length) return 'No Slack channels found.';
            return `Slack channels:\n${chans.map((c: any) => `- #${c.name} (${c.id})${c.is_private ? ' [private]' : ''}`).join('\n')}`;
        }

        if (action === 'history') {
            const channel = String(args.channel || '').trim();
            if (!channel) return 'Slack history needs a channel id or name.';
            const limit = Math.min(parseInt(String(args.limit), 10) || 20, 100);
            const r = await slackApi(token, 'conversations.history', { channel, limit: String(limit) });
            if (!r.ok) return `Slack history failed: ${r.error || 'unknown error'}`;
            const msgs = (r.messages || []).reverse();
            if (!msgs.length) return `No recent messages in ${channel}.`;
            return `Recent Slack messages in ${channel}:\n${msgs.map(fmtMessage).join('\n')}`;
        }

        if (action === 'send') {
            const channel = String(args.channel || '').trim();
            const text = String(args.text || '');
            if (!channel || !text) return 'Slack send needs both channel and text.';
            const r = await slackPost(token, 'chat.postMessage', { channel, text, mrkdwn: true });
            if (!r.ok) return `Slack send failed: ${r.error || 'unknown error'}`;
            return `Message posted to Slack #${channel}.`;
        }

        return `Unknown slack action "${action}" — use mentions, search, channels, history, or send.`;
    },
    toolset: 'slack',
    tier: 'public',
});
