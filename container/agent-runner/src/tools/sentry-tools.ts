import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

async function callHost(tool: string, args: any, timeoutMs = 30000): Promise<any> {
    try {
        return await writeCallbackAsync(tool, args, timeoutMs);
    } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
    }
}

// Sentry tools — Sentry is the background software-security scanner (network
// traffic, listening ports, running services, autostart, user crontabs). It
// runs with NO elevated permissions: everything it reads is user-readable
// (ss, ps, systemctl, crontab -l as the logged-in user). sentry_report is its
// single submission: the agent runs the scan commands with Bash, assembles the
// raw inventory, and submits it once — the HOST does the mechanical diff
// against the baseline deterministically (models diffing lists is
// failure-prone, same reasoning as host-computed reminder durations).
registry.register({
    name: 'sentry_report',
    // Tool descriptions are clamped at 200 chars (stripTier) — this is sentry's
    // ONLY tool, so the per-category formats and their source commands live in
    // the parameter descriptions below, which are NOT clamped.
    description: '{"what":"submit the finished scan inventory, get the verdict back","when":"ONCE, after collecting every category your mode covers","answer":"state the returned verdict as your final answer"}',
    schema: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['peek', 'deep'],
                description: '{"what":"the scan mode you were asked to run","vals":"peek|deep","peek_fills":"listening, connections, services","deep_fills":"every category"}',
            },
            listening: {
                type: 'array',
                items: { type: 'string' },
                description: '{"what":"listening sockets, one string per socket","format":"proto|addr:port|process","source":"ss -tulpn"}',
            },
            connections: {
                type: 'array',
                items: { type: 'string' },
                description: '{"what":"established connections, one string each","format":"proto|local|remote|process","source":"ss -tunp"}',
            },
            services: {
                type: 'array',
                items: { type: 'string' },
                description: '{"what":"running service names, one per entry","source":"systemctl list-units --type=service --state=running"}',
            },
            autostart: {
                type: 'array',
                items: { type: 'string' },
                description: '{"what":"autostart entries, one string each","format":"scope|name|command","source":"~/.config/autostart and /etc/xdg/autostart","mode":"deep only"}',
            },
            crontab: {
                type: 'array',
                items: { type: 'string' },
                description: '{"what":"user crontab lines, one per entry","source":"crontab -l","mode":"deep only"}',
            },
            units: {
                type: 'array',
                items: { type: 'string' },
                description: '{"what":"enabled user units, one per entry","source":"systemctl --user list-unit-files --state=enabled","mode":"deep only"}',
            },
            suspicious: {
                type: 'array',
                items: { type: 'string' },
                description: '{"what":"anything that looked wrong to YOU while scanning","format":"what — why","effect":"the host reports these even when the item is in the baseline"}',
            },
        },
        required: ['mode'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('sentry_report', args || {});
        if (resp?.ok) return resp.verdict || 'Scan logged.';
        return `sentry_report failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'sentry-core',
    tier: 'public',
});