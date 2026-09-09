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
    description:
        "Submit the completed security-scan inventory to the host and get the verdict back. " +
        "Call this ONCE at the end of your scan, after collecting every category your mode covers. " +
        "Each array entry is one plain string; use the exact formats below. " +
        "For 'peek' mode fill: listening, connections, services. For 'deep' mode fill all categories. " +
        "listening entries: 'proto|addr:port|process' (from ss -tulpn, e.g. 'tcp|0.0.0.0:3200|node'). " +
        "connections entries: 'proto|local|remote|process' (established, from ss -tunp). " +
        "services entries: running service names (systemctl list-units --type=service --state=running). " +
        "autostart entries: 'scope|name|command' from ~/.config/autostart, /etc/xdg/autostart (deep only). " +
        "crontab entries: user crontab lines from crontab -l (deep only). " +
        "units entries: enabled user units from systemctl --user list-unit-files --state=enabled (deep only). " +
        "suspicious entries: anything that looked wrong to YOU while scanning, as 'what — why' " +
        "(e.g. 'port 4444 listening — 4444 is a common backdoor port'); the host reports these even if the item is in the baseline. " +
        "The host diffs your inventory against the known-good baseline and returns the verdict — clean, findings, or baseline-learned. " +
        "State that returned verdict as your final answer.",
    schema: {
        type: 'object',
        properties: {
            mode: { type: 'string', enum: ['peek', 'deep'], description: "The scan mode you were asked to run." },
            listening: { type: 'array', items: { type: 'string' }, description: "Listening sockets as 'proto|addr:port|process'." },
            connections: { type: 'array', items: { type: 'string' }, description: "Established connections as 'proto|local|remote|process'." },
            services: { type: 'array', items: { type: 'string' }, description: "Names of running services." },
            autostart: { type: 'array', items: { type: 'string' }, description: "Deep: autostart entries as 'scope|name|command'." },
            crontab: { type: 'array', items: { type: 'string' }, description: "Deep: user crontab lines." },
            units: { type: 'array', items: { type: 'string' }, description: "Deep: enabled user units." },
            suspicious: { type: 'array', items: { type: 'string' }, description: "Items you judge suspicious, as 'what — why'." },
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