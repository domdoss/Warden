import { ToolsetDef, registry } from './tool-registry.js';

export const TOOLSETS: Record<string, ToolsetDef> = {
    file:      { name: 'file',      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'query_image'], tier: 'both' },
    web:       { name: 'web',       tools: ['WebSearch', 'WebFetch'], tier: 'public' },
    // browser_snapshot/browser_screenshot stay HERE so the background atlas job
    // keeps them. They are withheld from the CHAT SEAT via
    // BLOCKED_ORCHESTRATOR_TOOLS instead — deleting them from the toolset made
    // them un-owned, and the seat's filter keeps every un-owned tool, so the
    // seat kept them and background atlas lost them (the exact inverse).
    browser:   { name: 'browser',   tools: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
                                             'browser_press_key', 'browser_select_option', 'browser_hover',
                                             'browser_screenshot', 'browser_evaluate', 'browser_wait_for',
                                             'browser_tabs', 'browser_back', 'browser_current_url'], tier: 'public' },
    terminal:  { name: 'terminal',  tools: ['Bash', 'open_app', 'desktop_click', 'desktop_type'], tier: 'public' },
    // Vision capture belongs to VULKAN, not the local seat: the local seat runs
    // a visionless model (granite4.1:8b), so handing it a screenshot tool buys
    // a capture nothing can read. Vulkan is the cloud seat, so it is the one
    // that can actually look at the frame.
    // Desktop vision — desktop_screenshot is the one capture sub-agents need, so
    // they can SEE the screen while driving native apps with desktop_click/type.
    // runSubAgent drains _pendingImages into the next iteration (mirroring the
    // orchestrator loop), so Atlas can see the frame it just captured. webcam_capture
    // and read_image stay orchestrator-only (in `capture` below).
    'desktop-vision': { name: 'desktop-vision', tools: ['desktop_screenshot'], tier: 'public' },
    capture:   { name: 'capture',   tools: ['desktop_screenshot', 'webcam_capture', 'read_image'], tier: 'public' },
    // Iris's merged action tools (2026-09-09 collapse): one tool per noun,
    // `action` param selects the operation. Admin was dropped from iris
    // entirely — email, scheduled tasks, calendar, and alarms are the core.
    tasks:     { name: 'tasks',     tools: ['task'], tier: 'public' },
    email:     { name: 'email',     tools: ['email'], tier: 'private' },
    calendar:  { name: 'calendar',  tools: ['calendar'], tier: 'private' },
    alarms:    { name: 'alarms',    tools: ['alarm'], tier: 'private' },
    // Projects/work-tasks (re-wired 2026-09-11): the 17 flat tools from the
    // 2026-09-09 collapse are ONE merged `project` tool (kind + action).
    projects:  { name: 'projects',  tools: ['project'], tier: 'public' },
    documents: { name: 'documents', tools: ['generate_pdf','convert_file'], tier: 'public' },
    context:   { name: 'context',   tools: ['clear_context'], tier: 'public' },
    fabric:    { name: 'fabric',    tools: ['fabric_pattern'], tier: 'both' },
    agent:     { name: 'agent',     tools: ['atlas','vulkan','artemis','iris','sentry'], tier: 'public' },

    // Sentry — the software-security scanner (reborn 2026-09-08). Bash for the
    // read-only scan commands (ss, ps, systemctl, crontab — all user-readable,
    // NO elevated permissions anywhere) + sentry_report to submit the inventory
    // once. A narrow toolset on purpose: a security scanner gets no
    // fabric/MCP/web/browser tools.
    'sentry-core': { name: 'sentry-core', tools: ['Bash', 'sentry_report'], tier: 'public' },

    // Media (speaker/mic volume + playback) — atlas drives the hardware.
    // (Byte was merged into iris 2026-09-05; its work-management toolsets were
    // dropped entirely in the 2026-09-09 collapse.)
    media:        { name: 'media',     tools: ['audio_volume','mic_volume','media_control'], tier: 'public' },
    // YouTube is atlas's alone (2026-09-18, with the orchestrator's web/browser
    // tools removed): one merged `youtube` tool — find it, open it, confirm it
    // is actually playing — instead of search → navigate → evaluate by hand.
    // Deliberately NOT in `media`: `media` is shared with the orchestrator for
    // pause/skip/volume, and youtube needs the browser, which the orchestrator
    // no longer has.
    youtube:      { name: 'youtube',   tools: ['youtube'], tier: 'public' },
    // desktop-vision rides WITH terminal (2026-09-19): terminal carries
    // desktop_click/desktop_type, and a seat that can click and type needs to
    // see the frame (runSubAgent drains captures into the next iteration) —
    // without this include the seat drove native apps blind.
    'atlas-core':    { name: 'atlas-core',    includes: ['web','browser','terminal','desktop-vision','documents','media','youtube'] },
    // Vulkan — the coding specialist, coding-only. Read/Write/Edit/Glob/Grep
    // to edit source, Bash to run builds/tests/git. NO browser, NO desktop,
    // NO screenshot, NO open_app — vulkan edits code and reports done; seeing
    // the result (opening a page, launching an app, showing a file) is atlas's
    // job, routed by the orchestrator. Giving vulkan browser/desktop tools let
    // it "verify" its own subjective edits by screenshot-looping, hitting the
    // file://-open wall and spinning on http.server workarounds. With those
    // tools absent the spiral is physically impossible. Both Atlas and Vulkan
    // merge active skill tools at spawn, so the data/skills/ library is inherited.
    // 'email' added 2026-09-15 (Dom, "just in case"): vulkan can email Dom a
    // bug report / .patch directly instead of only reporting via orchestrator.
    'vulkan-core': { name: 'vulkan-core', tools: ['Read','Write','Edit','Glob','Grep','Bash','email'], includes: ['capture'] },
    'artemis-core':  { name: 'artemis-core',  tools: ['Read','Grep','Glob','Bash','get_chat_history'] },
    // Iris — single toolcall agent (byte merged in 2026-09-05). 2026-09-09
    // collapse: 4 merged action tools (email/task/calendar/alarm), one per
    // noun with an `action` param. Iris's fine-tune is trained on exactly
    // these four schemas. 2026-09-11: the merged `project` tool (kind+action,
    // in projects/ above) is deliberately NOT here — no subagent owns it, so
    // it flows into the orchestrator's own tool pool and the orchestrator
    // handles projects/work-tasks DIRECTLY (simple CRUD is one tool call;
    // no delegation, and iris stays in-distribution). Iris is single-shot
    // (one tool call per delegation); the orchestrator drives any
    // multi-step flow by calling iris once per step.
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

// ─── Default apps ───────────────────────────────────────────────────────────
// A CAPABILITY is a job some tool does — browsing, fetching a page, running a
// shell command. Warden ships a built-in provider for each (the "good enough to
// download a real browser" one). An installed MCP server can take that job over
// via router_state `default_app:<capability>` = 'builtin' | 'mcp:<server>'.
//
// The point is substitution, not addition: when a capability is handed to an
// MCP server the built-in tools are REMOVED, so exactly one provider can do
// each job. Two tools that both plausibly browse is how a small model ends up
// hand-driving a page instead of calling the tool that owns the task.
//
// Listed as explicit tool names rather than a toolset, because a toolset mixes
// capabilities: `terminal` holds Bash AND the desktop tools, and handing the
// shell to an MCP server must not take the desktop away with it.
export const CAPABILITY_BUILTINS: Record<string, string[]> = {
    browser: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
              'browser_press_key', 'browser_select_option', 'browser_hover',
              'browser_screenshot', 'browser_evaluate', 'browser_wait_for',
              'browser_tabs', 'browser_back', 'browser_current_url'],
    web:     ['WebSearch', 'WebFetch'],
    files:   ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    shell:   ['Bash'],
    capture: ['desktop_screenshot', 'webcam_capture', 'read_image'],
};
export const CAPABILITY_NAMES = Object.keys(CAPABILITY_BUILTINS);
