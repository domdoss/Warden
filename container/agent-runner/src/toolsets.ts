import { ToolsetDef, registry } from './tool-registry.js';

export const TOOLSETS: Record<string, ToolsetDef> = {
    file:      { name: 'file',      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'], tier: 'both' },
    web:       { name: 'web',       tools: ['WebSearch', 'WebFetch'], tier: 'public' },
    browser:   { name: 'browser',   tools: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
                                             'browser_press_key', 'browser_select_option', 'browser_hover',
                                             'browser_screenshot', 'browser_evaluate', 'browser_wait_for',
                                             'browser_tabs', 'browser_back', 'browser_current_url'], tier: 'public' },
    terminal:  { name: 'terminal',  tools: ['Bash', 'desktop_click', 'desktop_type'], tier: 'public' },
    // Desktop vision — desktop_screenshot is the one capture sub-agents need, so
    // they can SEE the screen while driving native apps with desktop_click/type.
    // runSubAgent drains _pendingImages into the next iteration (mirroring the
    // orchestrator loop), so Atlas can see the frame it just captured. webcam_capture
    // and read_image stay orchestrator-only (in `capture` below).
    'desktop-vision': { name: 'desktop-vision', tools: ['desktop_screenshot'], tier: 'public' },
    capture:   { name: 'capture',   tools: ['desktop_screenshot', 'webcam_capture', 'read_image'], tier: 'public' },
    projects:  { name: 'projects',  tools: ['create_project','get_project','update_project','archive_project',
                                             'complete_project','delete_project','list_projects'], tier: 'public' },
    worktasks: { name: 'worktasks', tools: ['create_work_task','list_work_tasks','update_work_task',
                                             'delete_work_task'], tier: 'public' },
    tasks:     { name: 'tasks',     tools: ['schedule_task','list_tasks','pause_task','resume_task',
                                             'cancel_task','update_task'], tier: 'public' },
    deliverables: { name: 'deliverables', tools: ['add_deliverable','toggle_deliverable','delete_deliverable'], tier: 'public' },
    blockers:  { name: 'blockers',  tools: ['add_blocker','delete_blocker','add_priority','delete_priority',
                                             'update_financials'], tier: 'public' },
    tracking:  { name: 'tracking',  tools: ['log_time','start_timer','stop_timer'], tier: 'public' },
    email:     { name: 'email',     tools: ['read_emails','send_email','get_email','refresh_email_cache',
                                             'get_cached_emails'], tier: 'private' },
    calendar:  { name: 'calendar',  tools: ['create_calendar_event','list_calendar_events',
                                             'update_calendar_event','delete_calendar_event'], tier: 'private' },
    alarms:    { name: 'alarms',    tools: ['create_alarm','list_alarms','update_alarm','delete_alarm'], tier: 'private' },
    sms:       { name: 'sms',       tools: ['send_sms','read_sms'], tier: 'private' },
    chat:      { name: 'chat',      tools: ['get_chat_history','ping_user','attach_file','set_user_email','tell_oculus'], tier: 'both' },
    // admin tools must be listed explicitly — resolveToolset() only walks the
    // `tools` array + `includes`, NOT the `toolset` property tools are
    // registered with. post_summary was registered with toolset:'admin' but
    // must be listed here to be reachable.
    // (add_digest_note was removed — the digest-notes expiry system is gone;
    // a time-bound reminder is just a calendar event.)
    admin:     { name: 'admin',     tools: ['register_group','list_api_keys','api_request','post_summary'], tier: 'public' },
    documents: { name: 'documents', tools: ['generate_pdf','convert_file'], tier: 'public' },
    context:   { name: 'context',   tools: ['clear_context'], tier: 'public' },
    fabric:    { name: 'fabric',    tools: ['fabric_pattern'], tier: 'both' },
    agent:     { name: 'agent',     tools: ['byte','dexter','atlas','vulkan','artemis','iris'], tier: 'public' },

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

    // Byte — work management. `email` is included so Byte can read the inbox
    // and turn actionable messages into real projects/work tasks when the
    // user asks in chat.
    'byte-core':     { name: 'byte-core',     includes: ['projects','worktasks','deliverables','blockers','tracking','admin','email'] },
    'dexter-core':   { name: 'dexter-core',   includes: ['tasks','calendar'] },
    // Media (speaker/mic volume + playback) — atlas/vulkan drive the hardware.
    media:        { name: 'media',     tools: ['audio_volume','mic_volume','media_control'], tier: 'public' },
    'atlas-core':    { name: 'atlas-core',    includes: ['web','browser','terminal','documents','admin','desktop-vision','media'] },
    // Vulkan — the coding specialist. Like atlas-core but adds `file`
    // (Read/Write/Edit/Glob/Grep) so it can edit source, plus browser +
    // desktop-vision for webapp/UI testing. Both Atlas and Vulkan merge
    // active skill tools at spawn, so the data/skills/ library is inherited.
    'vulkan-core': { name: 'vulkan-core', includes: ['file','web','browser','terminal','documents','admin','desktop-vision','media'] },
    'artemis-core':  { name: 'artemis-core',  tools: ['Read','Grep','Glob','Bash','get_chat_history'] },
    // Iris (digest compiler) — email (IMAP read_emails, works) + admin
    // (post_summary, list_api_keys, api_request). Contacts/todos toolsets were
    // removed entirely (no DB backend, were Radicale-only). Calendar + tasks
    // come from buildDigestContext (DB) in INPUT (above), not from tools.
    'iris-core':     { name: 'iris-core',     includes: ['email','admin','calendar'] },
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
