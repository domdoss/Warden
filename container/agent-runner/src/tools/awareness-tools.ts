import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

// The Oculus run-mode branch in index.ts sets this to the original task prompt
// so the host callback tools can log the full AWARENESS context if needed.
let oculusTaskPrompt = '';
export function setOculusTaskPrompt(prompt: string): void { oculusTaskPrompt = prompt; }

async function callHost(tool: string, args: any, timeoutMs = 10000): Promise<any> {
    try {
        return await writeCallbackAsync(tool, args, timeoutMs);
    } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
    }
}

/** Whether the current task is an orchestrator status query (not an AWARENESS event). */
function isStatusQuery(): boolean {
    return oculusTaskPrompt.startsWith('[ORCHESTRATOR_QUERY]');
}

// Situational-awareness tools (Oculus, the background awareness agent). Mirrors
// security-tools.ts. awareness_log records/queries Oculus's sqlite history;
// tell_oculus lets the orchestrator pass a fact to Oculus (recorded as context).

registry.register({
    name: 'awareness_log',
    description:
        "Record or query Oculus's situational-awareness log. Use this FIRST on every AWARENESS event. " +
        "ACTION 'record': append a verdict row. Required fields: action='record', ts (YYYY-MM-DDTHH:MM:SS), " +
        "event (arrival|departure|movement|motion_burst|camera_covered|camera_moved|note), assessment " +
        "('spoken'|'silent'|'note'|'flagged'), and optionally label, is_known, seconds_empty, " +
        "seconds_occupied, motion_area, person_count, spoken (exact line if assessment='spoken'), data (extra json). " +
        "Do NOT invent field names like event_type, timestamp, or details. " +
        "ACTION 'query': return rows, newest-first, up to limit, filter by event/assessment/since/until. " +
        "ACTION 'stats': counts by event. " +
        "Examples: awareness_log({\"action\":\"record\",\"ts\":\"2026-07-27T22:00:00\",\"event\":\"arrival\",\"is_known\":true,\"assessment\":\"silent\"}); " +
        "awareness_log({\"action\":\"record\",\"ts\":\"2026-07-27T22:00:00\",\"event\":\"arrival\",\"label\":\"dominic\",\"is_known\":true,\"seconds_empty\":120,\"assessment\":\"spoken\",\"spoken\":\"Welcome back.\"});",
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['record', 'query', 'stats'], description: "'record' to append, 'query' to read, 'stats' for counts." },
            ts: { type: 'string', description: "record: local time (YYYY-MM-DDTHH:MM:SS)." },
            event: { type: 'string', description: "record: the event type (arrival|departure|movement|motion_burst|camera_covered|camera_uncovered|camera_moved|note)." },
            label: { type: 'string', description: "record: the known-person label, if recognized." },
            is_known: { type: 'boolean', description: "record: whether the person is a known person." },
            person_count: { type: 'number', description: "record: number of people." },
            seconds_empty: { type: 'number', description: "record: how long the room was empty." },
            seconds_occupied: { type: 'number', description: "record: how long the room was occupied." },
            motion_area: { type: 'number', description: "record: motion area in pixels." },
            assessment: { type: 'string', enum: ['spoken', 'silent', 'note', 'flagged'], description: "record: your verdict." },
            spoken: { type: 'string', description: "record: the line you spoke via send_message, if any." },
            since: { type: 'string', description: "query: lower bound local time." },
            until: { type: 'string', description: "query: upper bound local time." },
            limit: { type: 'number', description: "query: max rows (default 50)." },
            data: { type: 'object', description: "record: extra json to store." },
        },
        required: ['action'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('awareness_log', args || {});
        if (resp?.ok) {
            if ((args as any)?.action === 'query' || (args as any)?.action === 'stats') {
                return resp.summary || 'No matching rows.';
            }
            return 'Logged.';
        }
        return `awareness_log failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'awareness',
    tier: 'public',
});

// Orchestrator → Oculus direct. tier:'public' + toolset 'chat' keeps it
// orchestrator-only (sub-agents don't include 'chat'). The user tells Jarvis a
// fact that should affect greeting behavior; Oculus records it silently, no chat
// reply.
registry.register({
    name: 'tell_oculus',
    description:
        "Send a message directly to Oculus, the background situational-awareness agent. Use this when " +
        "the user wants to tell Jarvis something about their presence/schedule that should affect " +
        "greeting behavior (e.g. 'heading out for the evening', 'I'm back, no need to greet me', " +
        "'my partner is staying over') so Oculus records it and factors it into future greetings. Do NOT " +
        "use the security agent for awareness notes — use this. Oculus records the message silently; it " +
        "will not reply in the chat. Returns confirmation.",
    schema: {
        type: 'object',
        properties: {
            message: { type: 'string', description: 'The message to pass to Oculus.' },
        },
        required: ['message'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('tell_oculus', { message: String(args?.message || '') });
        if (resp?.ok) return `Told Oculus: ${String(args?.message || '').slice(0, 120)}. It will record this for future greetings.`;
        return `Could not reach Oculus: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'chat',
    tier: 'public',
});

// Read-only access for the orchestrator to Oculus's latest AWARENESS data: the
// most recent event (arrival/departure/...) plus recognized person (is_known +
// label), person_count, and how long the room's been occupied/empty. Call this
// together with webcam_capture so a vision answer ("who's in the room", "what
// do you see") can name known people and add context the photo alone can't.
registry.register({
    name: 'awareness_status',
    description:
        "Get Oculus's latest AWARENESS info from the security camera: the most recent event " +
        "(arrival/departure/camera_covered/...), recognized person (is_known + label from " +
        "InsightFace), person_count, and how long the room's been occupied or empty. Use this " +
        "ALONGSIDE webcam_capture to answer 'who's in the room' or 'what do you see' accurately " +
        "— the structured data gives names, counts, and durations the photo alone can't.",
    schema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        const resp = await callHost('awareness_status', {});
        if (!resp || resp.ok === false) return `awareness_status unavailable: ${resp?.error || 'host unreachable'}`;
        const recent = Array.isArray(resp.recent) ? resp.recent : [];
        const lines = recent.map((r: any) => {
            const who = r.label ? ` ${r.label}` : (r.is_known != null ? (r.is_known ? ' known' : ' unknown') : '');
            const empty = r.seconds_empty != null ? ` empty=${Math.round(r.seconds_empty)}s` : '';
            let extra = '';
            if (r.data) { try { const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; if (d && d.person_count != null) extra = ` people=${d.person_count}`; } catch {} }
            return `[${r.ts}] ${r.event || '?'}${who}${empty}${extra}`;
        });
        return `Latest AWARENESS event:\n${resp.latest || '(none yet)'}\n\nRecent events:\n${lines.join('\n') || '(none yet)'}`;
    },
    toolset: 'chat',
    tier: 'public',
});

// Orchestrator → Oculus live status query. Oculus pulls current data, decides
// the CURRENT room state, and returns a concise report. The orchestrator uses
// this instead of stale cached rows to decide whether to pull a webcam frame.
registry.register({
    name: 'oculus_query',
    description:
        "Ask Oculus, the situational-awareness agent, for a live status report. " +
        "Oculus pulls current AWARENESS data from the satellite and decides the CURRENT room state. " +
        "If the report starts with NOTEWORTHY (person present, unknown person, recent motion, alert, camera issue), " +
        "you MUST then call webcam_capture to verify visually. If the report starts with NOTHING_NOTEWORTHY, " +
        "answer from the report alone and do NOT pull a frame. Use this for 'who's in the room' / 'what's happening' " +
        "/ 'security status' questions — NOT awareness_status, which only returns stale cached events.",
    schema: { type: 'object', properties: { question: { type: 'string', description: 'Optional question to pass to Oculus (e.g. who is in the room).' } }, required: [] },
    handler: async (args, _context) => {
        const resp = await callHost('oculus_query', { question: String(args?.question || 'live status') }, 35000);
        if (!resp || resp.ok === false) return `oculus_query unavailable: ${resp?.error || 'host unreachable'}`;
        return resp.report || '(no report)';
    },
    toolset: 'chat',
    tier: 'public',
});

