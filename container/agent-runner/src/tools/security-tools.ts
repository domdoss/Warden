import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

async function callHost(tool: string, args: any, timeoutMs = 10000): Promise<any> {
    try {
        return await writeCallbackAsync(tool, args, timeoutMs);
    } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
    }
}

/** Push a base64 image into the vision-context queue consumed after this tool call. */
function queueForVision(b64: string): void {
    if (!b64) return;
    if (!(globalThis as any)._pendingImages) (globalThis as any)._pendingImages = [];
    (globalThis as any)._pendingImages.push(b64);
}

// Poll the running security detector (security/main.py) for its current frame.
// The detector owns the webcam, so this fetches the live frame from its HTTP
// frame server (http://127.0.0.1:8765/frame) via the host's webcam_capture
// callback — it does NOT open /dev/video0 (which is held by the detector).
registry.register({
    name: 'security_frame',
    description:
        "Poll the running security detector for its current camera frame and load it into your " +
        "vision context. The detector owns the webcam, so this fetches the live frame from the " +
        "security app's frame server — not /dev/video0. Use this (not webcam_capture) when the " +
        "security program is running and you need to see the frame. Returns the resolution.",
    schema: { type: 'object', properties: {}, required: [] },
    handler: async (_args) => {
        try {
            const res = await writeCallbackAsync('webcam_capture', {}, 20000);
            if (!res || res.ok === false) return `Error polling security frame: ${res?.error || 'host callback failed'}`;
            const b64 = typeof res.image === 'string' ? res.image : '';
            if (!b64) return `Error: host returned no frame${res?.error ? ` (${res.error})` : ''} — is the security detector running?`;
            queueForVision(b64);
            return `Security frame captured (${res.width}×${res.height}px). The image is now in your vision context — describe what you see.`;
        } catch (err: any) {
            return `Error polling security frame: ${err.message}`;
        }
    },
    toolset: 'security',
    tier: 'public',
});

// Security Mode tools (Oculus, the single background security agent). The
// standalone detector app holds an alert OPEN until Warden closes it;
// close_security_alert (via dismiss_security_flag) re-arms it. alert_security
// is the MOCK external-escalation call (no real guard service yet — it just
// acknowledges it would alert them). arm_security/disarm_security toggle the
// detector's flagging. send_message lets Oculus tell the user about an abnormal
// alert. security_log lets it persist/query a dated conditions history.

registry.register({
    name: 'dismiss_security_flag',
    description:
        "Dismiss a flagged review and re-arm the detector. Call this ONCE, ONLY when you DECLARE " +
        "the flagged detection NORMAL (a non-event) — it clears the flag so the detector can review " +
        "the next detection. This also closes any open alert (equivalent to the guard pressing " +
        "STAND DOWN). Never call this on an abnormal alert you want to stay open.",
    schema: { type: 'object', properties: {} },
    handler: async (_args, _context) => {
        const resp = await callHost('close_security_alert', {});
        if (resp?.ok) return 'Flag dismissed — detector re-armed.';
        return `Could not dismiss flag: ${resp?.error || 'security app not reachable'}`;
    },
    toolset: 'security',
    tier: 'public',
});

registry.register({
    name: 'alert_security',
    description:
        "Escalate the current security alert to the security service (a call-to-action for a real " +
        "guard/response). Call this when you have judged the alert ABNORMAL and want to raise the " +
        "alarm. NOTE: this is currently a MOCK stub — there is no real security service wired yet, " +
        "so this call does not actually contact anyone; it just acknowledges the escalation. Call " +
        "it for real regardless so the escalation path is exercised.",
    schema: {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Why you are escalating (what is abnormal).' },
        },
        required: ['reason'],
    },
    handler: async (args, _context) => {
        const reason = String(args?.reason || '').trim();
        // MOCK — no external call is made yet. The tool exists so Oculus calls
        // it for real and the escalation path is wired; swap the body for a real
        // HTTP call to a guard/dispatch service when one exists.
        return `Mock Alert: If there were security guards I would be alerting them now.${reason ? ` (reason: ${reason})` : ''}`;
    },
    toolset: 'security',
    tier: 'public',
});

registry.register({
    name: 'arm_security',
    description:
        "Arm the security system — enable the detector's flagging (so it raises alerts to Oculus). " +
        "Use this when the user wants flagging on.",
    schema: { type: 'object', properties: {} },
    handler: async (_args, _context) => {
        const resp = await callHost('arm_security', {});
        if (resp?.ok) return 'Security system armed — flagging enabled.';
        return `Could not arm: ${resp?.error || 'security app not reachable'}`;
    },
    toolset: 'security',
    tier: 'public',
});

registry.register({
    name: 'disarm_security',
    description:
        "Disarm the security system — pause the detector's flagging (no alerts raised to Oculus). " +
        "Use this when the user wants flagging off.",
    schema: { type: 'object', properties: {} },
    handler: async (_args, _context) => {
        const resp = await callHost('disarm_security', {});
        if (resp?.ok) return 'Security system disarmed — flagging paused.';
        return `Could not disarm: ${resp?.error || 'security app not reachable'}`;
    },
    toolset: 'security',
    tier: 'public',
});

registry.register({
    name: 'open_security_alert',
    description:
        "Spawn the security alert on the detector: opens the red STAND DOWN button + flips the " +
        "detector to ALERTED. Call this ONCE, only when you DECLARE the flagged detection ABNORMAL, " +
        "after send_message. Do NOT call it for a normal/non-event. The alert stays open until the " +
        "guard presses STAND DOWN.",
    schema: {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Why this is an alert (abnormal).' },
        },
        required: ['reason'],
    },
    handler: async (args, _context) => {
        const resp = await callHost('open_security_alert', { reason: String(args?.reason || '') });
        if (resp?.ok) return 'Security alert opened on the detector (red button).';
        return `Could not open security alert: ${resp?.error || 'detector app not reachable'}`;
    },
    toolset: 'security',
    tier: 'public',
});

registry.register({
    name: 'send_message',
    description:
        "Send a message to the user (or another chat) immediately. Use this to tell the user about " +
        "an ABNORMAL security alert — concisely, what you saw and whether they should be concerned. " +
        "If you have a frame reference from the task like [Image: attachments/...], include it in the " +
        "message so Telegram sends the photo as a caption. Do NOT use this for normal/non-events (die silently).",
    schema: {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'The message text to send.' },
            message: { type: 'string', description: 'Alias for text.' },
            target_jid: { type: 'string', description: 'Optional target chat jid; defaults to the owner chat.' },
            sender: { type: 'string', description: 'Optional sender identity name (e.g. "Oculus").' },
        },
        anyOf: [{ required: ['text'] }, { required: ['message'] }],
    },
    handler: async (args, _context) => {
        const content = String(args?.text ?? args?.message ?? '');
        const resp = await callHost('send_message', {
            text: content,
            target_jid: args?.target_jid,
            sender: args?.sender || 'Oculus',
        });
        if (resp?.ok) return 'Message sent.';
        return `send_message failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'security',
    tier: 'public',
});

registry.register({
    name: 'security_log',
    description:
        "Record or query Oculus's security-conditions log (a persistent sqlite store of every " +
        "alert assessment, by time). ACTION 'record': append a row {timestamp, alert_ts, assessment " +
        "('normal'|'abnormal'), condition, escalated (bool)}. ACTION 'query': return rows within an " +
        "optional since/until local-time range (YYYY-MM-DDTHH:MM:SS), newest-first, up to limit. Use " +
        "this to keep a dated history of what happened and to look back by time/date.",
    schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['record', 'query'], description: "'record' to append, 'query' to read." },
            assessment: { type: 'string', enum: ['normal', 'abnormal'], description: "record: your judgment." },
            condition: { type: 'string', description: "record: what you saw (e.g. 'owner at desk', 'unknown person', 'camera covered')." },
            alert_ts: { type: 'string', description: "record: the alert timestamp from the task." },
            escalated: { type: 'boolean', description: "record: whether you called alert_security." },
            since: { type: 'string', description: "query: lower bound local time (YYYY-MM-DDTHH:MM:SS)." },
            until: { type: 'string', description: "query: upper bound local time (YYYY-MM-DDTHH:MM:SS)." },
            limit: { type: 'number', description: "query: max rows (default 50)." },
        },
        required: ['action'],
    },
    handler: async (args, _context) => {
        // During orchestrator status queries, Oculus must use awareness_log/
        // awareness_status only. security_log is for alert-event logging, not
        // live room-status polling, and using it makes the query slow/wrong.
        if ((globalThis as any).__oculusQueryMode) {
            return 'security_log is not available during a live status query. Use awareness_log (action: query) and awareness_status instead.';
        }
        const resp = await callHost('security_log', args || {});
        if (resp?.ok) {
            if ((args as any)?.action === 'query') return resp.summary || 'No matching rows.';
            return 'Logged.';
        }
        return `security_log failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'security',
    tier: 'public',
});

// Register a known person so future arrivals report is_known + label. The
// satellite security app computes the face embedding on CPU from the current
// frame and stores it locally.
registry.register({
    name: 'save_known_person',
    description:
        "Tell the satellite security camera to save the current frame's face as a known person. " +
        "The laptop computes an InsightFace embedding on CPU and stores it. Future arrivals with " +
        "a visible face will report is_known=true and label. Use this when you are confident the " +
        "person in the latest frame is the owner or a regular guest and should not trigger alerts.",
    schema: {
        type: 'object',
        properties: {
            label: { type: 'string', description: 'Name or label for this person (e.g. "dominic").' },
        },
        required: ['label'],
    },
    handler: async (args, _context) => {
        const label = String(args?.label || '').trim();
        if (!label) return 'missing label';
        const resp = await callHost('save_known_person', { label });
        if (resp?.ok) return `Saved known person ${label}.`;
        return `save_known_person failed: ${resp?.error || 'unknown error'}`;
    },
    toolset: 'security',
    tier: 'public',
});

// Oculus watch-out-for capture: when an AWARENESS event matches one of the
// user's "watch out for" situations, Oculus calls this to save the latest
// frame into the owner's uploads tree (groups/owner/oculus/<ts>.jpg) so the
// user can review it later. Silent — it does NOT message the user; the photo
// in uploads + the awareness_log row IS the record.
registry.register({
    name: 'oculus_capture',
    description:
        "Save the latest camera frame to the user's uploads area (oculus/<timestamp>.jpg). Call this " +
        "ONCE, only when the current AWARENESS event matches one of the user's 'watch out for' " +
        "situations listed in your task. This is silent — it does not message the user. Record the " +
        "match in awareness_log first (assessment 'flagged'), then call this to keep the photo.",
    schema: { type: 'object', properties: {}, required: [] },
    handler: async (_args, _context) => {
        const resp = await callHost('oculus_capture', {});
        if (resp?.ok) return `Frame saved to uploads: ${resp.path}`;
        return `oculus_capture failed: ${resp?.error || 'no frame available'}`;
    },
    toolset: 'security',
    tier: 'public',
});