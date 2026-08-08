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
    contacts:  { name: 'contacts',  tools: ['list_contacts','search_contacts','get_contact',
                                             'create_contact','update_contact','delete_contact'], tier: 'private' },
    todos:     { name: 'todos',     tools: ['list_todos','create_todo','complete_todo','delete_todo'], tier: 'private' },
    alarms:    { name: 'alarms',    tools: ['create_alarm','list_alarms','update_alarm','delete_alarm'], tier: 'private' },
    sms:       { name: 'sms',       tools: ['send_sms','read_sms'], tier: 'private' },
    chat:      { name: 'chat',      tools: ['get_chat_history','ping_user','attach_file','set_user_email','tell_sentry'], tier: 'both' },
    // admin tools must be listed explicitly — resolveToolset() only walks the
    // `tools` array + `includes`, NOT the `toolset` property tools are
    // registered with. post_summary + suggest_task were registered with
    // toolset:'admin' but must be listed here to be reachable.
    // (add_digest_note was removed — the digest-notes expiry system is gone;
    // a time-bound reminder is just a calendar event.)
    admin:     { name: 'admin',     tools: ['register_group','list_api_keys','api_request','post_summary','suggest_task'], tier: 'public' },
    documents: { name: 'documents', tools: ['generate_pdf','convert_file'], tier: 'public' },
    context:   { name: 'context',   tools: ['clear_context'], tier: 'public' },
    fabric:    { name: 'fabric',    tools: ['fabric_pattern'], tier: 'both' },
    agent:     { name: 'agent',     tools: ['byte','dexter','atlas','hephaestus','artemis','iris'], tier: 'public' },

    // Security tools — used by Sentry (the single background security agent) to
    // send alerts, open/dismiss detector alerts, arm/disarm, and log events.
    security:     { name: 'security',     tools: ['security_frame','security_caption','save_known_person','send_message','open_security_alert','security_log','dismiss_security_flag','alert_security','arm_security','disarm_security'], tier: 'public' },
    'security-core': { name: 'security-core', includes: ['security'] },

    // Sentry — the single background situational-awareness + security agent.
    // Decides whether to alert/greet/silent, sends the captioned photo alert, and
    // updates physical security state. No file tools, no fabric, no web.
    awareness:    { name: 'awareness',    tools: ['send_message'], tier: 'public' },
    'awareness-core': { name: 'awareness-core', includes: ['awareness'] },

    // Byte — work management. `email` is included so Byte can read the inbox
    // and surface actionable tasks as suggestions (suggest_task, in admin) in
    // one subagent turn during an on-demand scan.
    'byte-core':     { name: 'byte-core',     includes: ['projects','worktasks','deliverables','blockers','tracking','admin','email'] },
    'dexter-core':   { name: 'dexter-core',   includes: ['tasks'] },
    // Media (speaker/mic volume + playback) — atlas/hephaestus drive the hardware.
    media:        { name: 'media',     tools: ['audio_volume','mic_volume','media_control'], tier: 'public' },
    'atlas-core':    { name: 'atlas-core',    includes: ['web','browser','terminal','documents','admin','desktop-vision','media'] },
    // Hephaestus — the coding specialist. Like atlas-core but adds `file`
    // (Read/Write/Edit/Glob/Grep) so it can edit source, plus browser +
    // desktop-vision for webapp/UI testing. Both Atlas and Hephaestus merge
    // active skill tools at spawn, so the data/skills/ library is inherited.
    'hephaestus-core': { name: 'hephaestus-core', includes: ['file','web','browser','terminal','documents','admin','desktop-vision','media'] },
    'artemis-core':  { name: 'artemis-core',  tools: ['Read','Grep','Glob','Bash','get_chat_history'] },
    // Iris (digest compiler) — email (IMAP read_emails, works) + admin
    // (post_summary, list_api_keys, api_request). The
    // contacts/calendar/todos toolsets were dropped: those tools hit Radicale
    // (127.0.0.1:5232) which isn't provisioned, so every list_calendar_events /
    // list_todos / list_contacts call failed with ECONNREFUSED and tempted Iris
    // to fabricate. Calendar + tasks now come from buildDigestContext (DB) in
    // INPUT (above), not from Radicale tools.
    'iris-core':     { name: 'iris-core',     includes: ['email','admin'] },
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
