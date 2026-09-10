import { ToolsetDef, registry } from './tool-registry.js';

export const TOOLSETS: Record<string, ToolsetDef> = {
    file:      { name: 'file',      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'query_image'], tier: 'both' },
    web:       { name: 'web',       tools: ['WebSearch', 'WebFetch'], tier: 'public' },
    browser:   { name: 'browser',   tools: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
                                             'browser_press_key', 'browser_select_option', 'browser_hover',
                                             'browser_screenshot', 'browser_evaluate', 'browser_wait_for',
                                             'browser_tabs', 'browser_back', 'browser_current_url'], tier: 'public' },
    terminal:  { name: 'terminal',  tools: ['Bash', 'open_app', 'desktop_click', 'desktop_type'], tier: 'public' },
    // Desktop vision — desktop_screenshot is the one capture sub-agents need, so
    // they can SEE the screen while driving native apps with desktop_click/type.
    // runSubAgent drains _pendingImages into the next iteration (mirroring the
    // orchestrator loop), so Atlas can see the frame it just captured. webcam_capture
    // and read_image stay orchestrator-only (in `capture` below).
    'desktop-vision': { name: 'desktop-vision', tools: ['desktop_screenshot'], tier: 'public' },
    capture:   { name: 'capture',   tools: ['desktop_screenshot', 'webcam_capture', 'read_image'], tier: 'public' },
    // Iris's merged action tools (2026-09-09 collapse): one tool per noun,
    // `action` param selects the operation. Project management + admin were
    // dropped from iris entirely — email, scheduled tasks, calendar, and
    // alarms are the core.
    tasks:     { name: 'tasks',     tools: ['task'], tier: 'public' },
    email:     { name: 'email',     tools: ['email'], tier: 'private' },
    calendar:  { name: 'calendar',  tools: ['calendar'], tier: 'private' },
    alarms:    { name: 'alarms',    tools: ['alarm'], tier: 'private' },
    documents: { name: 'documents', tools: ['generate_pdf','convert_file'], tier: 'public' },
    context:   { name: 'context',   tools: ['clear_context'], tier: 'public' },
    fabric:    { name: 'fabric',    tools: ['fabric_pattern'], tier: 'both' },
    agent:     { name: 'agent',     tools: ['atlas','vulkan','artemis','iris','sentry'], tier: 'public' },

    // Security tools — used by Oculus (the single background security agent) to
    // Oculus awareness tools — look at the live frame + log. Oculus is a SILENT
    // awareness agent: it records to awareness_log/security_log and can look at the
    // frame / register a known face, but it has NO send_message, NO alerting, NO
    // arm/disarm — it never proactively speaks or raises an alert. The user opens
    // / closes the eyes (toggles eyes_open) and queries Oculus at will.
    security:     { name: 'security',     tools: ['security_frame','security_caption','save_known_person','security_log','oculus_capture'], tier: 'public' },
    'security-core': { name: 'security-core', includes: ['security'] },

    // awareness_log / awareness_status — the record/query + live-room-state tools
    // Oculus uses on every event and every orchestrator query. No send_message
    // here either: Oculus is silent by design.
    awareness:    { name: 'awareness',    tools: ['awareness_log','awareness_status'], tier: 'public' },
    'awareness-core': { name: 'awareness-core', includes: ['awareness'] },

    // Sentry — the software-security scanner (reborn 2026-09-08; the old webcam
    // awareness job belongs to oculus above). Bash for the read-only scan
    // commands (ss, ps, systemctl, crontab — all user-readable, NO elevated
    // permissions anywhere) + sentry_report to submit the inventory once; the
    // host does the baseline diff. Like awareness, a narrow toolset on purpose:
    // a security scanner gets no fabric/MCP/web/browser tools.
    'sentry-core': { name: 'sentry-core', tools: ['Bash', 'sentry_report'], tier: 'public' },

    // Media (speaker/mic volume + playback) — atlas drives the hardware.
    // (Byte was merged into iris 2026-09-05; its work-management toolsets were
    // dropped entirely in the 2026-09-09 collapse.)
    media:        { name: 'media',     tools: ['audio_volume','mic_volume','media_control'], tier: 'public' },
    'atlas-core':    { name: 'atlas-core',    includes: ['web','browser','terminal','documents','desktop-vision','media'] },
    // Vulkan — the coding specialist, coding-only. Read/Write/Edit/Glob/Grep
    // to edit source, Bash to run builds/tests/git. NO browser, NO desktop,
    // NO screenshot, NO open_app — vulkan edits code and reports done; seeing
    // the result (opening a page, launching an app, showing a file) is atlas's
    // job, routed by the orchestrator. Giving vulkan browser/desktop tools let
    // it "verify" its own subjective edits by screenshot-looping, hitting the
    // file://-open wall and spinning on http.server workarounds. With those
    // tools absent the spiral is physically impossible. Both Atlas and Vulkan
    // merge active skill tools at spawn, so the data/skills/ library is inherited.
    'vulkan-core': { name: 'vulkan-core', tools: ['Read','Write','Edit','Glob','Grep','Bash'] },
    'artemis-core':  { name: 'artemis-core',  tools: ['Read','Grep','Glob','Bash','get_chat_history'] },
    // Iris — single toolcall agent (byte merged in 2026-09-05). 2026-09-09
    // collapse: 4 merged action tools (email/task/calendar/alarm), one per
    // noun with an `action` param. Project management, work tasks, and admin
    // were dropped entirely. Iris is single-shot (one tool call per
    // delegation); the orchestrator drives any multi-step flow by calling
    // iris once per step.
    'iris-core':     { name: 'iris-core',     tools: ['email','task','calendar','alarm'] },
    'file-core':     { name: 'file-core',     includes: ['file','chat'] },
};

// Register all toolsets
for (const ts of Object.values(TOOLSETS)) {
    registry.registerToolset(ts);
}

export function resolveToolset(name: string): string[] {
    return registry.resolveToolset(name);
}

export function resolveMultipleToolsets(names: string[]): string[] {
    return registry.resolveMultipleToolsets(names);
}
