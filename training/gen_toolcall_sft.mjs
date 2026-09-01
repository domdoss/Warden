// Full toolcall-model SFT dataset generator.
//
// Produces JSONL for a single LoRA fine-tune that serves TWO toolcall subagents
// from one Granite 4.1:3b model: byte (work/projects) and iris (email +
// digests + tasks/scheduling). dexter is GONE — iris absorbed its scheduling
// role and is now the sole toolcall agent covering email, digests, tasks, and
// calendar. Each row is OpenAI-style messages + a `tools` array, so the Granite
// chat template renders the EXACT system block + tool schemas the agent sees
// at inference, and the assistant target is a Granite tool call.
//
// iris is SINGLE-SHOT: one tool call per request, then return. She chains no
// steps herself; the orchestrator supplies the specific id and calls her again
// for the next step. Manage flows (list → id → act) are split into standalone
// examples: a list example (→ list_tasks/list_calendar_events) OR an
// act-with-id example (id already supplied in the request → cancel/update).
// byte is multi-step and keeps its exManage list→act flows.
//
// The `tools` array is loaded from tool_schemas.json, dumped straight from the
// compiled agent-runner registry (see dump_tool_schemas.mjs) — so the SFT tool
// shapes are byte-for-byte the live schemas, not hand-copied.
//
// Coverage is weighted to the hard calls each agent fumbles:
//   iris:   schedule_value forms (PT2M vs timestamp vs cron vs ms), field
//           placement, ask-back when no payload, manage flows (id supplied),
//           email read/send/search, digests (post_summary as final action),
//           list_api_keys → api_request.
//   byte:   create_work_task project_id="personal" default + priority enum,
//           update_project status enum, add_blocker/add_priority enums,
//           log_time/update_financials numeric fields, list-first manage flows
//
// Request strings are written in the real orchestrator-brief style (verbose,
// parenthetical timezone, ALLCAPS emphasis, explicit ids, em-dashes) so
// train≈infer — the model must extract clean tool args from emphatic prose.

import { readFileSync, writeFileSync } from 'node:fs';

const SCHEMAS = JSON.parse(readFileSync(new URL('./tool_schemas.json', import.meta.url), 'utf8'));
export const TOOLS = {
  byte: SCHEMAS.byte,
  iris: SCHEMAS.iris,
};

const BYTE_SYSTEM = `You are Byte, the work-management agent.

CAPABILITIES: Manage projects, work tasks, deliverables, blockers, priorities, financials, and time tracking. Read the user's inbox and turn actionable emails into projects and work tasks.

GUIDELINES:
- Act as the domain expert: the task states WHAT; choose the HOW (calls and order) yourself.
- Read before writing: list or get the relevant record first.
- Supply required fields for every item — blockers: title + description; tasks and deliverables: title; financials: amount + category. Infer reasonable values when the task omits them.
- create_work_task always needs project_id. Pass "personal" (the permanent Personal project) when the task names no project; pass the named project's ID only when the user specifies one. priority is low | medium | high | urgent (default medium).
- Call each tool once; move on after a success.
- Use only IDs and data your tools return.
- Inbox scan: read_emails, keep messages in the requested range (filter by Date), then create a work task (and a project when warranted) for each actionable item. Treat newsletters, confirmations, receipts, shipping notices, and ads as non-actionable.

Example:
Task: "Record a new work task: 'Fix the login bug' — add it to my personal list."
→ create_work_task(title="Fix the login bug", project_id="personal")

FORMAT: one plain-text line or short list naming what you created or changed, with the IDs returned.`;

const IRIS_SYSTEM = `You are Iris, the personal information and scheduling agent: email, digests, tasks, and calendar.

# Role
You execute exactly one tool call per request, then return the result. You chain no steps yourself; the orchestrator supplies the specific id and calls you again for the next step.

# Capabilities
- Email: read_emails (inbox search/scan), get_email (full body), send_email, refresh_email_cache, get_cached_emails.
- Digests: compile from the INPUT block plus read_emails output, publish via post_summary(span, text) as your final action.
- Tasks: schedule_task, list_tasks, pause_task, resume_task, cancel_task, update_task.
- Calendar: create_calendar_event, list_calendar_events, update_calendar_event, delete_calendar_event.
- API: list_api_keys, api_request.

# Guidelines
- The first line of the task is the current local time in the form "Current local time is YYYY-MM-DDTHH:MM:SS (timezone ...)." Compute every absolute timestamp from this.
- schedule_task schedule_value forms:
  - once, relative time ("in 2 minutes", "tomorrow"): ISO-8601 duration (PT2M, PT1H30M, P1D).
  - once, absolute clock time ("at 3pm today", "on Sep 5 at 2pm"): local YYYY-MM-DDTHH:MM:SS.
  - interval ("every 5 minutes"): milliseconds as a string (300000).
  - recurring schedule ("every weekday at 9am", "every Monday at 6pm"): 5-field cron, local time (0 9 * * 1-5).
- To cancel, pause, resume, or update a task, use the task id supplied in the request. Call list_tasks only when the request is to list reminders.
- To update or delete a calendar event, use the event id supplied in the request. Call list_calendar_events only when the request is to list events.
- When the request names both a reminder and a calendar event, make both tool calls in one turn.
- When the request gives a time but no content, reply in one short line asking for the content.
- A plain to-do with no time trigger is a work task for Byte; reply in one line that this is a work task.
- Email: keep real addresses (on-device). To save an email, call get_email, then write a file named <date>_<from>_<subject>.md.
- Digests: compile ONLY from the INPUT block and read_emails output. State each section plainly; if a section is empty, say so. post_summary is the only way the digest reaches the dashboard; call it as your final action.

# Format
One plain-text line naming the ids you returned, or the published span.`;

const SYSTEMS = { byte: BYTE_SYSTEM, iris: IRIS_SYSTEM };
export { SYSTEMS, BYTE_SYSTEM, IRIS_SYSTEM };

// Fixed anchor so iris's absolute timestamps are reproducible. Matches the
// injected time-header format exactly (the dispatch path prepends this for
// every iris call).
const ANCHOR = 'Current local time is 2026-08-31T14:05:00 (timezone America/Vancouver). Compute every absolute timestamp from this.';
export { ANCHOR };

// ---- example builders ---------------------------------------------------

// Single-turn: user request → one or more tool calls, then an optional text
// reply (emitted as a separate assistant turn after a synthetic tool result).
// iris requests get the ANCHOR prepended (iris does time math); byte does not.
function ex(agent, request, toolCalls, opts = {}) {
  const sys = SYSTEMS[agent], tools = TOOLS[agent];
  const userLine = agent === 'iris' ? `${ANCHOR}\n\n${request}` : request;
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user', content: userLine },
  ];
  msgs.push({
    role: 'assistant', content: '',
    tool_calls: toolCalls.map(tc => ({ type: 'function', function: tc })),
  });
  const results = opts.results || toolCalls.map(() => 'OK');
  for (let i = 0; i < toolCalls.length; i++) {
    msgs.push({ role: 'tool', name: toolCalls[i].name, content: String(results[i]) });
  }
  if (opts.reply) msgs.push({ role: 'assistant', content: opts.reply });
  return { messages: msgs, tools };
}

// No-tool: assistant replies with text only (ask-back / out-of-scope / empty).
function exText(agent, request, reply) {
  const userLine = agent === 'iris' ? `${ANCHOR}\n\n${request}` : request;
  return {
    messages: [
      { role: 'system', content: SYSTEMS[agent] },
      { role: 'user', content: userLine },
      { role: 'assistant', content: reply },
    ],
    tools: TOOLS[agent],
  };
}

// Multi-turn manage: list first, then act on a returned id. byte ONLY — iris
// is single-shot and never lists-then-acts in one delegation; her manage calls
// arrive with the id already supplied (use ex('iris', ...) for those).
function exManage(agent, request, { listTool, listArgs, listResult, actionTool, actionArgs, actionResult, reply }) {
  const sys = SYSTEMS[agent], tools = TOOLS[agent];
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user', content: request },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: listTool, arguments: listArgs || {} } }] },
    { role: 'tool', name: listTool, content: listResult },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'update_work_task', arguments: { task_id: 'wt-2001', status: 'done' } } }] },
  ];
  // overwrite the action call built above (kept the builder simple)
  msgs[4] = { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: actionTool, arguments: actionArgs } }] };
  msgs.push({ role: 'tool', name: actionTool, content: actionResult });
  msgs.push({ role: 'assistant', content: reply });
  return { messages: msgs, tools };
}

const examples = [];

// =========================================================================
// IRIS — scheduling (ported from the dexter-only generator: the proven
// failure classes). iris is single-shot; every example is one tool call (or
// parallel calls in one turn for "both reminder + calendar").
// =========================================================================

// ---- A. Relative once reminders (duration) — the clock-math bug class ----
examples.push(ex('iris', 'Set a one-time reminder to fire in 2 minutes (current time is 2026-08-31 2:05 PM America/Vancouver) with the message "Check the oven" — it should fire around 2:07 PM.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the oven.', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the oven in 2 minutes (PT2M).' }));
examples.push(ex('iris', 'In 90 seconds, ping me to stand up and stretch.',
  [{ name: 'schedule_task', arguments: { prompt: 'Stand up and stretch.', schedule_type: 'once', schedule_value: 'PT90S', context_mode: 'group' } }],
  { reply: 'Set a reminder to stand up in 90 seconds (PT90S).' }));
examples.push(ex('iris', 'Set a one-time reminder to call mom in an hour and a half (1 hour 30 minutes).',
  [{ name: 'schedule_task', arguments: { prompt: 'Call mom.', schedule_type: 'once', schedule_value: 'PT1H30M', context_mode: 'group' } }],
  { reply: 'Set a reminder to call mom in 1 hour 30 minutes (PT1H30M).' }));
examples.push(ex('iris', 'Set a one-time reminder for tomorrow (America/Vancouver) to pay rent.',
  [{ name: 'schedule_task', arguments: { prompt: 'Pay rent.', schedule_type: 'once', schedule_value: 'P1D', context_mode: 'group' } }],
  { reply: 'Set a reminder to pay rent tomorrow (P1D).' }));
examples.push(ex('iris', 'Set a one-time reminder to renew your passport in 2 days — a two-day delay.',
  [{ name: 'schedule_task', arguments: { prompt: 'Renew your passport.', schedule_type: 'once', schedule_value: 'P2D', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your passport in 2 days (P2D).' }));
examples.push(ex('iris', 'In 45 seconds ping me about the build.',
  [{ name: 'schedule_task', arguments: { prompt: 'The build is done — check the results.', schedule_type: 'once', schedule_value: 'PT45S', context_mode: 'group' } }],
  { reply: 'Set a reminder about the build in 45 seconds (PT45S).' }));
examples.push(ex('iris', 'Set a one-time reminder to take the cake out in 3 hours.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take the cake out of the oven.', schedule_type: 'once', schedule_value: 'PT3H', context_mode: 'group' } }],
  { reply: 'Set a reminder to take the cake out in 3 hours (PT3H).' }));
examples.push(ex('iris', 'Set a one-time reminder to flip the timer in 1 minute.',
  [{ name: 'schedule_task', arguments: { prompt: 'Flip the timer.', schedule_type: 'once', schedule_value: 'PT1M', context_mode: 'group' } }],
  { reply: 'Set a reminder to flip the timer in 1 minute (PT1M).' }));

// ---- B. Absolute once reminders (named clock time) — compute from anchor ----
examples.push(ex('iris', 'Set a one-time reminder to fire at 3:00 PM today (America/Vancouver) to pick up the kids.',
  [{ name: 'schedule_task', arguments: { prompt: 'Pick up the kids.', schedule_type: 'once', schedule_value: '2026-08-31T15:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to pick up the kids at 3 PM today (2026-08-31T15:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to take your medication at 5:00 AM tomorrow morning (America/Vancouver).',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your medication.', schedule_type: 'once', schedule_value: '2026-09-01T05:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take your medication at 5:00 tomorrow morning (2026-09-01T05:00:00).' }));
examples.push(ex('iris', 'At 9:30 AM on March 20, remind me to submit the quarterly report.',
  [{ name: 'schedule_task', arguments: { prompt: 'Submit the quarterly report.', schedule_type: 'once', schedule_value: '2026-03-20T09:30:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the quarterly report at 9:30am on March 20 (2026-03-20T09:30:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to water the plants tonight at 8 PM.',
  [{ name: 'schedule_task', arguments: { prompt: 'Water the plants.', schedule_type: 'once', schedule_value: '2026-08-31T20:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to water the plants tonight at 8pm (2026-08-31T20:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to call the dentist at noon tomorrow.',
  [{ name: 'schedule_task', arguments: { prompt: 'Call the dentist to book an appointment.', schedule_type: 'once', schedule_value: '2026-09-01T12:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call the dentist at noon tomorrow (2026-09-01T12:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder for September 5 at 2:00 PM (America/Vancouver) to submit the visa application.',
  [{ name: 'schedule_task', arguments: { prompt: 'Submit the visa application.', schedule_type: 'once', schedule_value: '2026-09-05T14:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the visa application on September 5 at 2pm (2026-09-05T14:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to renew your drivers license on October 1 at 9 AM.',
  [{ name: 'schedule_task', arguments: { prompt: 'Renew your drivers license.', schedule_type: 'once', schedule_value: '2026-10-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your drivers license on October 1 at 9am (2026-10-01T09:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to take out the recycling tonight at 11:45 PM.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take out the recycling.', schedule_type: 'once', schedule_value: '2026-08-31T23:45:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take out the recycling tonight at 11:45pm (2026-08-31T23:45:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to catch your flight on September 10 at 8 AM.',
  [{ name: 'schedule_task', arguments: { prompt: 'Head to the airport — your flight is soon.', schedule_type: 'once', schedule_value: '2026-09-10T08:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to catch your flight on September 10 at 8am (2026-09-10T08:00:00).' }));

// ---- C. Recurring cron — the field-placement bug class -----------------
examples.push(ex('iris', 'Create a daily recurring reminder for 10:30 AM (America/Vancouver) to take my medication.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your medication.', schedule_type: 'cron', schedule_value: '30 10 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily reminder at 10:30am to take your medication (cron 30 10 * * *).' }));
examples.push(ex('iris', 'Create a daily recurring reminder for 11:30 AM (America/Vancouver) to take xyz medication.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take xyz medication.', schedule_type: 'cron', schedule_value: '30 11 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 11:30am reminder to take xyz medication (cron 30 11 * * *).' }));
examples.push(ex('iris', 'Every day at 7 AM remind me to meditate.',
  [{ name: 'schedule_task', arguments: { prompt: 'Meditate.', schedule_type: 'cron', schedule_value: '0 7 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 7am meditation reminder (cron 0 7 * * *).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 9:00 AM (America/Vancouver) to stand up and stretch.',
  [{ name: 'schedule_task', arguments: { prompt: 'Stand up and stretch.', schedule_type: 'cron', schedule_value: '0 9 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 9am stand-up reminder (cron 0 9 * * 1-5).' }));
examples.push(ex('iris', 'Every Monday at 6 PM remind me to take out the trash.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take out the trash.', schedule_type: 'cron', schedule_value: '0 18 * * 1', context_mode: 'group' } }],
  { reply: 'Set a Monday 6pm trash reminder (cron 0 18 * * 1).' }));
examples.push(ex('iris', 'Set a recurring Friday reminder at 5 PM to file your timesheet.',
  [{ name: 'schedule_task', arguments: { prompt: 'File your timesheet.', schedule_type: 'cron', schedule_value: '0 17 * * 5', context_mode: 'group' } }],
  { reply: 'Set a Friday 5pm timesheet reminder (cron 0 17 * * 5).' }));
examples.push(ex('iris', 'Set a recurring reminder on the 1st of every month at 9 AM to pay rent.',
  [{ name: 'schedule_task', arguments: { prompt: 'Pay rent.', schedule_type: 'cron', schedule_value: '0 9 1 * *', context_mode: 'group' } }],
  { reply: 'Set a monthly 1st-at-9am rent reminder (cron 0 9 1 * *).' }));
examples.push(ex('iris', 'Every 15th at noon, remind me to review the budget.',
  [{ name: 'schedule_task', arguments: { prompt: 'Review the budget.', schedule_type: 'cron', schedule_value: '0 12 15 * *', context_mode: 'group' } }],
  { reply: 'Set a monthly 15th-at-noon budget review (cron 0 12 15 * *).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 8:15 AM to leave for work.',
  [{ name: 'schedule_task', arguments: { prompt: 'Leave for work.', schedule_type: 'cron', schedule_value: '15 8 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 8:15am leave-for-work reminder (cron 15 8 * * 1-5).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 5:30 PM to log off work.',
  [{ name: 'schedule_task', arguments: { prompt: 'Log off work for the day.', schedule_type: 'cron', schedule_value: '30 17 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 5:30pm log-off reminder (cron 30 17 * * *).' }));
examples.push(ex('iris', 'Every Sunday at 9 AM remind me to plan the week.',
  [{ name: 'schedule_task', arguments: { prompt: 'Plan the week ahead.', schedule_type: 'cron', schedule_value: '0 9 * * 0', context_mode: 'group' } }],
  { reply: 'Set a Sunday 9am weekly planning reminder (cron 0 9 * * 0).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 12:30 PM to eat lunch.',
  [{ name: 'schedule_task', arguments: { prompt: 'Eat lunch.', schedule_type: 'cron', schedule_value: '30 12 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 12:30pm lunch reminder (cron 30 12 * * 1-5).' }));
examples.push(ex('iris', 'Set a recurring reminder on the last day of every month at 6 PM to close the books.',
  [{ name: 'schedule_task', arguments: { prompt: 'Close the books for the month.', schedule_type: 'cron', schedule_value: '0 18 28-31 * *', context_mode: 'group' } }],
  { reply: 'Set a month-end 6pm close-the-books reminder (cron 0 18 28-31 * *).' }));
// ---- C2. Cron with step / comma / range fields --------------------------
examples.push(ex('iris', 'Set a recurring reminder every 2 hours on the hour to drink water.',
  [{ name: 'schedule_task', arguments: { prompt: 'Drink some water.', schedule_type: 'cron', schedule_value: '0 */2 * * *', context_mode: 'group' } }],
  { reply: 'Set a water reminder every 2 hours on the hour (cron 0 */2 * * *).' }));
examples.push(ex('iris', 'Set a recurring reminder every 15 minutes to check the queue.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the queue.', schedule_type: 'cron', schedule_value: '*/15 * * * *', context_mode: 'group' } }],
  { reply: 'Set a queue-check reminder every 15 minutes (cron */15 * * * *).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 9 AM and 9 PM to take your eye drops.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your eye drops.', schedule_type: 'cron', schedule_value: '0 9,21 * * *', context_mode: 'group' } }],
  { reply: 'Set a twice-daily 9am/9pm eye-drops reminder (cron 0 9,21 * * *).' }));
examples.push(ex('iris', 'Set a recurring reminder every other day at 8 AM to water the plants.',
  [{ name: 'schedule_task', arguments: { prompt: 'Water the plants.', schedule_type: 'cron', schedule_value: '0 8 */2 * *', context_mode: 'group' } }],
  { reply: 'Set an every-other-day 8am plant-watering reminder (cron 0 8 */2 * *).' }));
examples.push(ex('iris', 'Set a recurring weekend reminder at 10 AM to do laundry.',
  [{ name: 'schedule_task', arguments: { prompt: 'Do laundry.', schedule_type: 'cron', schedule_value: '0 10 * * 0,6', context_mode: 'group' } }],
  { reply: 'Set a weekend 10am laundry reminder (cron 0 10 * * 0,6).' }));
examples.push(ex('iris', 'Set a recurring reminder every 6 hours to change the laundry over.',
  [{ name: 'schedule_task', arguments: { prompt: 'Change the laundry over.', schedule_type: 'cron', schedule_value: '0 */6 * * *', context_mode: 'group' } }],
  { reply: 'Set a laundry reminder every 6 hours (cron 0 */6 * * *).' }));

// ---- D. Interval -------------------------------------------------------
examples.push(ex('iris', 'Set a recurring interval reminder every 5 minutes to check the build status.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the build status.', schedule_type: 'interval', schedule_value: '300000', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the build every 5 minutes (interval 300000ms).' }));
examples.push(ex('iris', 'Every 30 minutes remind me to drink water.',
  [{ name: 'schedule_task', arguments: { prompt: 'Drink some water.', schedule_type: 'interval', schedule_value: '1800000', context_mode: 'group' } }],
  { reply: 'Set a water reminder every 30 minutes (interval 1800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 2 hours to stretch your back.',
  [{ name: 'schedule_task', arguments: { prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 90 minutes to check the server.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the server.', schedule_type: 'interval', schedule_value: '5400000', context_mode: 'group' } }],
  { reply: 'Set a server-check reminder every 90 minutes (interval 5400000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 10 minutes to check the build log.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the build log for failures.', schedule_type: 'interval', schedule_value: '600000', context_mode: 'group' } }],
  { reply: 'Set a build-log reminder every 10 minutes (interval 600000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 45 minutes to look away from the screen and rest your eyes.',
  [{ name: 'schedule_task', arguments: { prompt: 'Look away from the screen and rest your eyes.', schedule_type: 'interval', schedule_value: '2700000', context_mode: 'group' } }],
  { reply: 'Set an eye-rest reminder every 45 minutes (interval 2700000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 8 hours to take your antibiotics.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your antibiotics.', schedule_type: 'interval', schedule_value: '28800000', context_mode: 'group' } }],
  { reply: 'Set an antibiotics reminder every 8 hours (interval 28800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 3 hours to feed the cat.',
  [{ name: 'schedule_task', arguments: { prompt: 'Feed the cat.', schedule_type: 'interval', schedule_value: '10800000', context_mode: 'group' } }],
  { reply: 'Set a cat-feeding reminder every 3 hours (interval 10800000ms).' }));

// ---- E. Manage flows (single-shot: id ALREADY SUPPLIED by the orchestrator) ----
// iris never lists-then-acts in one delegation. The orchestrator already ran the
// list, picked the id, and hands it to iris in the request. Each example below
// is ONE tool call with the id in the request.
examples.push(ex('iris', 'Cancel the reminder task-cb-1788206097352-yadl0c — that is the 11:30 AM "Take xyz medication" daily reminder.',
  [{ name: 'cancel_task', arguments: { task_id: 'task-cb-1788206097352-yadl0c' } }],
  { results: ['Task task-cb-1788206097352-yadl0c cancelled.'],
    reply: 'Cancelled the "Take xyz medication" reminder (task-cb-1788206097352-yadl0c).' }));
examples.push(ex('iris', 'Pause the reminder task-cb-1788206097352-abc123 — the 7 AM daily meditation reminder.',
  [{ name: 'pause_task', arguments: { task_id: 'task-cb-1788206097352-abc123' } }],
  { results: ['Task task-cb-1788206097352-abc123 paused.'],
    reply: 'Paused the 7am meditation reminder (task-cb-1788206097352-abc123).' }));
examples.push(ex('iris', 'Reschedule the reminder task-cb-1788206097352-def456 (the weekday 9 AM stand-up) to 10 AM on weekdays — update its cron to "0 10 * * 1-5".',
  [{ name: 'update_task', arguments: { task_id: 'task-cb-1788206097352-def456', schedule_type: 'cron', schedule_value: '0 10 * * 1-5' } }],
  { results: ['Task task-cb-1788206097352-def456 updated.'],
    reply: 'Moved the weekday stand-up reminder from 9am to 10am (task-cb-1788206097352-def456).' }));
examples.push(ex('iris', 'Resume the reminder task-cb-1788206097352-abc123 — the 7 AM meditation reminder I paused.',
  [{ name: 'resume_task', arguments: { task_id: 'task-cb-1788206097352-abc123' } }],
  { results: ['Task task-cb-1788206097352-abc123 resumed.'],
    reply: 'Resumed the 7am meditation reminder (task-cb-1788206097352-abc123).' }));
examples.push(ex('iris', 'Cancel the reminder task-cb-1788206097352-leave01 — the weekday 8:15 AM leave-for-work reminder.',
  [{ name: 'cancel_task', arguments: { task_id: 'task-cb-1788206097352-leave01' } }],
  { results: ['Task task-cb-1788206097352-leave01 cancelled.'],
    reply: 'Cancelled the weekday 8:15am leave-for-work reminder (task-cb-1788206097352-leave01).' }));
examples.push(ex('iris', 'Change the reminder task-cb-1788206097352-yadl0c (the "Take xyz medication" reminder) from 11:30 AM to 12:30 PM daily — update its cron to "30 12 * * *".',
  [{ name: 'update_task', arguments: { task_id: 'task-cb-1788206097352-yadl0c', schedule_type: 'cron', schedule_value: '30 12 * * *' } }],
  { results: ['Task task-cb-1788206097352-yadl0c updated.'],
    reply: 'Moved the medication reminder from 11:30am to 12:30pm daily (task-cb-1788206097352-yadl0c).' }));
// List-only requests (orchestrator asks iris to list, then calls her again to act).
examples.push(ex('iris', 'What reminders do I have set right now?',
  [{ name: 'list_tasks', arguments: {} }],
  { results: ['3 tasks:\n1. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n2. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active\n3. task-cb-1788206097352-xyz789 | once PT2M | Check the oven | active'],
    reply: 'You have 3 active reminders: take xyz medication daily at 11:30am, meditate daily at 7am, and check the oven in 2 minutes.' }));

// ---- F. Calendar events ------------------------------------------------
examples.push(ex('iris', 'Create a calendar event — a meeting tomorrow at 2:00 PM (America/Vancouver) called "Project Review".',
  [{ name: 'create_calendar_event', arguments: { title: 'Project Review', start_time: '2026-09-01T14:00:00' } }],
  { reply: 'Created a "Project Review" calendar event tomorrow at 2pm (2026-09-01T14:00:00).' }));
examples.push(ex('iris', 'Schedule a dentist appointment on March 15 at 10 AM.',
  [{ name: 'create_calendar_event', arguments: { title: 'Dentist appointment', start_time: '2026-03-15T10:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event on March 15 at 10am.' }));
examples.push(ex('iris', 'Create an all-day calendar event on Friday called "Company Holiday".',
  [{ name: 'create_calendar_event', arguments: { title: 'Company Holiday', start_time: '2026-09-04T00:00:00', all_day: true } }],
  { reply: 'Created an all-day "Company Holiday" calendar event on Friday 2026-09-04.' }));
examples.push(ex('iris', 'Create a 1-hour meeting at 3 PM today called "Team Sync".',
  [{ name: 'create_calendar_event', arguments: { title: 'Team Sync', start_time: '2026-08-31T15:00:00', end_time: '2026-08-31T16:00:00' } }],
  { reply: 'Created a "Team Sync" meeting today 3–4pm (2026-08-31T15:00:00–16:00:00).' }));
examples.push(ex('iris', 'Book the conference room for a meeting tomorrow 10 AM to 11:30 AM called "Vendor Demo".',
  [{ name: 'create_calendar_event', arguments: { title: 'Vendor Demo', start_time: '2026-09-01T10:00:00', end_time: '2026-09-01T11:30:00', location: 'Conference room' } }],
  { reply: 'Created a "Vendor Demo" in the conference room tomorrow 10–11:30am.' }));
examples.push(ex('iris', 'What is on my calendar this week?',
  [{ name: 'list_calendar_events', arguments: { start: '2026-08-31T00:00:00', end: '2026-09-06T23:59:59' } }],
  { results: ['2 events:\n1. 2026-09-01T14:00:00 → 2026-09-01T15:00:00 | Project Review\n2. 2026-09-04T00:00:00 | Company Holiday'],
    reply: 'This week you have: Project Review tomorrow 2–3pm, and an all-day Company Holiday on Friday.' }));
// Calendar manage (id supplied — single call).
examples.push(ex('iris', 'Delete the calendar event ev-1001 — the "Project Review" meeting tomorrow at 2 PM.',
  [{ name: 'delete_calendar_event', arguments: { event_id: 'ev-1001' } }],
  { results: ['Calendar event ev-1001 deleted.'],
    reply: 'Cancelled the Project Review meeting (ev-1001).' }));
examples.push(ex('iris', 'Move the calendar event ev-1001 (the 2 PM "Project Review" meeting) to 3 PM — set start_time to 2026-09-01T15:00:00 and end_time to 2026-09-01T16:00:00.',
  [{ name: 'update_calendar_event', arguments: { event_id: 'ev-1001', start_time: '2026-09-01T15:00:00', end_time: '2026-09-01T16:00:00' } }],
  { results: ['Calendar event ev-1001 updated.'],
    reply: 'Moved the Project Review from 2pm to 3pm tomorrow (ev-1001).' }));

// ---- G. Both reminder + calendar event in one turn ---------------------
examples.push(ex('iris', 'Set a 2 PM reminder about the meeting and create a calendar event for it at the same time.',
  [
    { name: 'schedule_task', arguments: { prompt: 'It is time for the meeting.', schedule_type: 'once', schedule_value: '2026-08-31T14:00:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Meeting', start_time: '2026-08-31T14:00:00' } },
  ],
  { reply: 'Set a 2pm reminder for the meeting and created a calendar event for it (2026-08-31T14:00:00).' }));
examples.push(ex('iris', 'Put a 3 PM "Project Review" meeting on my calendar tomorrow, and remind me 30 minutes before.',
  [
    { name: 'schedule_task', arguments: { prompt: 'Project Review starts in 30 minutes.', schedule_type: 'once', schedule_value: '2026-09-01T14:30:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Project Review', start_time: '2026-09-01T15:00:00' } },
  ],
  { reply: 'Created a "Project Review" tomorrow at 3pm and set a reminder 30 minutes before, at 2:30pm.' }));

// ---- G2. Real production traffic (from logs/warden.log, 2026-08-31) -----
examples.push(ex('iris', 'Set a one-time reminder to fire in 2 minutes, and the message text should be exactly: "test".',
  [{ name: 'schedule_task', arguments: { prompt: 'test', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder with message "test" to fire in 2 minutes (PT2M).' }));
examples.push(ex('iris', 'Set a one-time reminder for 3 minutes from now with the message "test".',
  [{ name: 'schedule_task', arguments: { prompt: 'test', schedule_type: 'once', schedule_value: 'PT3M', context_mode: 'group' } }],
  { reply: 'Set a reminder with message "test" to fire in 3 minutes (PT3M).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 9:15 AM to take your vitamins.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your vitamins.', schedule_type: 'cron', schedule_value: '15 9 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 9:15am vitamins reminder (cron 15 9 * * *).' }));
examples.push(ex('iris', 'Every day at 6:45 PM remind me to close my laptop.',
  [{ name: 'schedule_task', arguments: { prompt: 'Close your laptop and wrap up for the day.', schedule_type: 'cron', schedule_value: '45 18 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 6:45pm close-laptop reminder (cron 45 18 * * *).' }));
examples.push(ex('iris', 'Set a recurring reminder every Tuesday and Thursday at 7 AM to go for a run.',
  [{ name: 'schedule_task', arguments: { prompt: 'Go for a run.', schedule_type: 'cron', schedule_value: '0 7 * * 2,4', context_mode: 'group' } }],
  { reply: 'Set a Tue/Thu 7am run reminder (cron 0 7 * * 2,4).' }));

// ---- H. No-payload / no-time / out-of-scope — do NOT invent ------------
examples.push(exText('iris', 'Set a reminder.',
  'What should the reminder say and when should it fire? Tell me the content and the time.'));
examples.push(exText('iris', 'Set a reminder.',
  'What should I remind you about, and when?'));
examples.push(exText('iris', 'Set a reminder for 10 minutes from now.',
  'What should the reminder be about? Give me the content and I will set it for 10 minutes from now.'));
examples.push(exText('iris', 'Set a timer.',
  'What is the timer for, and how long? Tell me the content and the duration (e.g. "5 minutes" or "1 hour").'));
examples.push(exText('iris', 'Set a reminder for tomorrow morning.',
  'What should the reminder say, and what time tomorrow morning? Give me the content and a specific time (e.g. "8am").'));
examples.push(exText('iris', 'Set a reminder to take your medication.',
  'When should I remind you to take your medication? Give me a time (e.g. "every day at 11:30am" or "in 2 hours").'));
examples.push(exText('iris', 'Set a daily reminder at 11:30am.',
  'What should the daily 11:30am reminder say? Give me the content.'));
examples.push(exText('iris', 'Set a reminder on the 15th of every month.',
  'What should the monthly 15th reminder say? Give me the content.'));
examples.push(exText('iris', 'Add a to-do item to fix the kitchen sink.',
  'A plain to-do with no time trigger is a work task for Byte, not me. I have noted "fix the kitchen sink" — Byte can track it as a work task.'));
examples.push(exText('iris', 'Set a reminder to call the bank.',
  'When should I remind you to call the bank? Give me a time (e.g. "tomorrow at 10am" or "in 3 hours").'));

// =========================================================================
// IRIS — reinforcement reps (relative/interval/cron/absolute, more phrasings)
// so the tool-call EMISSION is the overwhelming habit for every schedule form.
// =========================================================================

// ---- W1. Relative duration, more phrasings ----
examples.push(ex('iris', 'Set a one-time reminder to check the laundry in 5 minutes.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the laundry.', schedule_type: 'once', schedule_value: 'PT5M', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the laundry in 5 minutes (PT5M).' }));
examples.push(ex('iris', 'Set a reminder for 10 minutes from now to call the bank.',
  [{ name: 'schedule_task', arguments: { prompt: 'Call the bank.', schedule_type: 'once', schedule_value: 'PT10M', context_mode: 'group' } }],
  { reply: 'Set a reminder to call the bank in 10 minutes (PT10M).' }));
examples.push(ex('iris', 'In 20 minutes remind me to take the pizza out.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take the pizza out of the oven.', schedule_type: 'once', schedule_value: 'PT20M', context_mode: 'group' } }],
  { reply: 'Set a reminder to take the pizza out in 20 minutes (PT20M).' }));
examples.push(ex('iris', 'Set a one-time reminder in 3 minutes about the meeting.',
  [{ name: 'schedule_task', arguments: { prompt: 'The meeting starts soon.', schedule_type: 'once', schedule_value: 'PT3M', context_mode: 'group' } }],
  { reply: 'Set a reminder about the meeting in 3 minutes (PT3M).' }));
examples.push(ex('iris', 'Set a one-time reminder to take the trash out in 4 hours.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take the trash out.', schedule_type: 'once', schedule_value: 'PT4H', context_mode: 'group' } }],
  { reply: 'Set a reminder to take the trash out in 4 hours (PT4H).' }));
examples.push(ex('iris', 'In 1 hour remind me to leave for the airport.',
  [{ name: 'schedule_task', arguments: { prompt: 'Leave for the airport.', schedule_type: 'once', schedule_value: 'PT1H', context_mode: 'group' } }],
  { reply: 'Set a reminder to leave for the airport in 1 hour (PT1H).' }));
examples.push(ex('iris', 'Set a one-time reminder to flip the steak in 12 minutes.',
  [{ name: 'schedule_task', arguments: { prompt: 'Flip the steak.', schedule_type: 'once', schedule_value: 'PT12M', context_mode: 'group' } }],
  { reply: 'Set a reminder to flip the steak in 12 minutes (PT12M).' }));
examples.push(ex('iris', 'Set a one-time reminder to pick up the kids in 2 hours and 15 minutes.',
  [{ name: 'schedule_task', arguments: { prompt: 'Pick up the kids.', schedule_type: 'once', schedule_value: 'PT2H15M', context_mode: 'group' } }],
  { reply: 'Set a reminder to pick up the kids in 2 hours 15 minutes (PT2H15M).' }));
examples.push(ex('iris', 'Set a timer for 30 minutes to remind me about the oven.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the oven.', schedule_type: 'once', schedule_value: 'PT30M', context_mode: 'group' } }],
  { reply: 'Set a 30-minute reminder about the oven (PT30M).' }));
examples.push(ex('iris', 'Set a one-time reminder to stir the soup in 6 minutes.',
  [{ name: 'schedule_task', arguments: { prompt: 'Stir the soup.', schedule_type: 'once', schedule_value: 'PT6M', context_mode: 'group' } }],
  { reply: 'Set a reminder to stir the soup in 6 minutes (PT6M).' }));
examples.push(ex('iris', 'Set a one-time reminder to join the call in 15 minutes.',
  [{ name: 'schedule_task', arguments: { prompt: 'Join the call.', schedule_type: 'once', schedule_value: 'PT15M', context_mode: 'group' } }],
  { reply: 'Set a reminder to join the call in 15 minutes (PT15M).' }));

// ---- W2. Interval, more phrasings ----
examples.push(ex('iris', 'Set a recurring interval reminder every 10 minutes to check the deploy.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the deploy.', schedule_type: 'interval', schedule_value: '600000', context_mode: 'group' } }],
  { reply: 'Set a deploy-check reminder every 10 minutes (interval 600000ms).' }));
examples.push(ex('iris', 'Every 20 minutes ping me about the queue.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the queue.', schedule_type: 'interval', schedule_value: '1200000', context_mode: 'group' } }],
  { reply: 'Set a queue reminder every 20 minutes (interval 1200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 4 hours to take your antibiotics.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your antibiotics.', schedule_type: 'interval', schedule_value: '14400000', context_mode: 'group' } }],
  { reply: 'Set an antibiotics reminder every 4 hours (interval 14400000ms).' }));
examples.push(ex('iris', 'Every 6 hours remind me to change the laundry over.',
  [{ name: 'schedule_task', arguments: { prompt: 'Change the laundry over.', schedule_type: 'interval', schedule_value: '21600000', context_mode: 'group' } }],
  { reply: 'Set a laundry reminder every 6 hours (interval 21600000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 45 minutes to stretch your back.',
  [{ name: 'schedule_task', arguments: { prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '2700000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 45 minutes (interval 2700000ms).' }));

// ---- W3. Cron, more phrasings (the wrong-field / no-tool bug class) ----
examples.push(ex('iris', 'Set a recurring daily reminder at 6 AM to drink water.',
  [{ name: 'schedule_task', arguments: { prompt: 'Drink some water.', schedule_type: 'cron', schedule_value: '0 6 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 6am water reminder (cron 0 6 * * *).' }));
examples.push(ex('iris', 'Every day at 9 PM remind me to journal.',
  [{ name: 'schedule_task', arguments: { prompt: 'Journal.', schedule_type: 'cron', schedule_value: '0 21 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 9pm journaling reminder (cron 0 21 * * *).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 8 AM to start work.',
  [{ name: 'schedule_task', arguments: { prompt: 'Start work.', schedule_type: 'cron', schedule_value: '0 8 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 8am start-work reminder (cron 0 8 * * 1-5).' }));
examples.push(ex('iris', 'Every Tuesday and Thursday at 6 PM remind me about yoga.',
  [{ name: 'schedule_task', arguments: { prompt: 'Yoga time.', schedule_type: 'cron', schedule_value: '0 18 * * 2,4', context_mode: 'group' } }],
  { reply: 'Set a Tue/Thu 6pm yoga reminder (cron 0 18 * * 2,4).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 5 PM to log off.',
  [{ name: 'schedule_task', arguments: { prompt: 'Log off for the day.', schedule_type: 'cron', schedule_value: '0 17 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 5pm log-off reminder (cron 0 17 * * 1-5).' }));
examples.push(ex('iris', 'Every Sunday at 8 PM remind me to plan the week.',
  [{ name: 'schedule_task', arguments: { prompt: 'Plan the week ahead.', schedule_type: 'cron', schedule_value: '0 20 * * 0', context_mode: 'group' } }],
  { reply: 'Set a Sunday 8pm weekly-planning reminder (cron 0 20 * * 0).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 7:45 AM to catch the bus.',
  [{ name: 'schedule_task', arguments: { prompt: 'Catch the bus.', schedule_type: 'cron', schedule_value: '45 7 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 7:45am bus reminder (cron 45 7 * * *).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 10:15 PM to lock the doors.',
  [{ name: 'schedule_task', arguments: { prompt: 'Lock the doors.', schedule_type: 'cron', schedule_value: '15 22 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 10:15pm lock-doors reminder (cron 15 22 * * *).' }));

// ---- W4. Absolute timestamp, more phrasings ----
examples.push(ex('iris', 'Set a one-time reminder to go to the gym at 6 AM tomorrow.',
  [{ name: 'schedule_task', arguments: { prompt: 'Go to the gym.', schedule_type: 'once', schedule_value: '2026-09-01T06:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to go to the gym at 6am tomorrow (2026-09-01T06:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to catch the bus at 7:30 AM on Monday.',
  [{ name: 'schedule_task', arguments: { prompt: 'Catch the bus.', schedule_type: 'once', schedule_value: '2026-09-01T07:30:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to catch the bus at 7:30am Monday (2026-09-01T07:30:00).' }));
examples.push(ex('iris', 'At 10 PM tonight remind me to brush my teeth.',
  [{ name: 'schedule_task', arguments: { prompt: 'Brush your teeth.', schedule_type: 'once', schedule_value: '2026-08-31T22:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to brush your teeth at 10pm tonight (2026-08-31T22:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to submit the report at 4 PM today.',
  [{ name: 'schedule_task', arguments: { prompt: 'Submit the report.', schedule_type: 'once', schedule_value: '2026-08-31T16:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the report at 4pm today (2026-08-31T16:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to close the laptop at 9 PM tonight.',
  [{ name: 'schedule_task', arguments: { prompt: 'Close the laptop and wind down.', schedule_type: 'once', schedule_value: '2026-08-31T21:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to close the laptop at 9pm tonight (2026-08-31T21:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to wake up at 6:30 AM tomorrow.',
  [{ name: 'schedule_task', arguments: { prompt: 'Wake up.', schedule_type: 'once', schedule_value: '2026-09-01T06:30:00', context_mode: 'group' } }],
  { reply: 'Set a wake-up reminder for 6:30am tomorrow (2026-09-01T06:30:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to submit the timesheet at 11 AM on Friday.',
  [{ name: 'schedule_task', arguments: { prompt: 'Submit the timesheet.', schedule_type: 'once', schedule_value: '2026-09-04T11:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the timesheet at 11am Friday (2026-09-04T11:00:00).' }));

// ---- W5. Both reminder + calendar in one turn, more reps ----
examples.push(ex('iris', 'Put a 4 PM dentist appointment on my calendar tomorrow and remind me an hour before.',
  [
    { name: 'schedule_task', arguments: { prompt: 'Dentist appointment soon.', schedule_type: 'once', schedule_value: '2026-09-01T15:00:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Dentist appointment', start_time: '2026-09-01T16:00:00' } },
  ],
  { reply: 'Created a 4pm dentist appointment tomorrow and set a reminder an hour before, at 3pm.' }));
examples.push(ex('iris', 'Schedule a 1 PM lunch meeting on Friday and remind me 15 minutes before.',
  [
    { name: 'schedule_task', arguments: { prompt: 'Lunch meeting starts in 15 minutes.', schedule_type: 'once', schedule_value: '2026-09-04T12:45:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Lunch meeting', start_time: '2026-09-04T13:00:00' } },
  ],
  { reply: 'Created a 1pm Friday lunch meeting and set a reminder 15 minutes before, at 12:45pm.' }));

// ---- W12. Calendar manage (id supplied — single call) -------------------
examples.push(ex('iris', 'Cancel the dentist appointment — delete calendar event ev-1003 (the Sep 3 10 AM dentist appointment).',
  [{ name: 'delete_calendar_event', arguments: { event_id: 'ev-1003' } }],
  { results: ['Calendar event ev-1003 deleted.'],
    reply: 'Cancelled the dentist appointment (ev-1003).' }));
examples.push(ex('iris', 'Reschedule the "Team Sync" — update event ev-1004 to start at 4 PM (2026-08-31T16:00:00) and end at 5 PM (2026-08-31T17:00:00).',
  [{ name: 'update_calendar_event', arguments: { event_id: 'ev-1004', start_time: '2026-08-31T16:00:00', end_time: '2026-08-31T17:00:00' } }],
  { results: ['Calendar event ev-1004 updated.'],
    reply: 'Moved the Team Sync from 3pm to 4pm today (ev-1004).' }));
examples.push(ex('iris', 'Cancel my meeting tomorrow — delete calendar event ev-1005 (the 9 AM standup on Sep 2).',
  [{ name: 'delete_calendar_event', arguments: { event_id: 'ev-1005' } }],
  { results: ['Calendar event ev-1005 deleted.'],
    reply: 'Cancelled tomorrow\'s 9am Standup (ev-1005).' }));
examples.push(ex('iris', 'Move the "Vendor Demo" — update event ev-1006 to 2 PM tomorrow (start 2026-09-01T14:00:00, end 2026-09-01T15:30:00).',
  [{ name: 'update_calendar_event', arguments: { event_id: 'ev-1006', start_time: '2026-09-01T14:00:00', end_time: '2026-09-01T15:30:00' } }],
  { results: ['Calendar event ev-1006 updated.'],
    reply: 'Moved the Vendor Demo to 2pm tomorrow (ev-1006).' }));
examples.push(ex('iris', 'Delete the "Company Holiday" event — calendar event ev-1002.',
  [{ name: 'delete_calendar_event', arguments: { event_id: 'ev-1002' } }],
  { results: ['Calendar event ev-1002 deleted.'],
    reply: 'Deleted the Company Holiday event (ev-1002).' }));

// =========================================================================
// IRIS — email + digests. Heavy on post_summary digest formatting for the
// dashboard UI plus email read/send/search and list_api_keys → api_request.
// =========================================================================

// ---- R. Digest: daily — full INPUT, read_emails, then post_summary ------
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Compile the daily digest.\n\nINPUT:\nCurrent time: 2026-08-31T08:00:00 (America/Vancouver)\nUser: Dominic — software engineer, prefers terse summaries, deep-work mornings.\nCalendar: 2026-08-31T14:00:00 Project Review (1h); 2026-08-31T18:00:00 Dentist (30m)\nWork tasks: wt-1001 Finish API spec (high, due 2026-09-01); wt-1002 Fix login bug (urgent, due 2026-08-31)\nWeather: 18°C partly cloudy, high 22°C, 0% rain.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_emails', arguments: { limit: 30, since: '2026-08-30T00:00:00' } } }] },
    { role: 'tool', name: 'read_emails', content: '3 emails:\n1. 2026-08-30T22:14 sarah@acme.io | "Re: Q4 budget approval needed" — needs sign-off by Friday\n2. 2026-08-30T19:02 jason@partnerco.com | "Action required: sign the NDA"\n3. 2026-08-30T15:30 newsletter@hackernews.com | "HN Weekly" (newsletter)' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'post_summary', arguments: {
      span: 'daily',
      text: '# Daily Digest — Mon Aug 31\n\n## Calendar\n- **2:00–3:00 PM** — Project Review\n- **6:00–6:30 PM** — Dentist\n\n## Priority work\n- 🔴 **Fix login bug** (wt-1002) — urgent, due today\n- 🟡 **Finish API spec** (wt-1001) — high, due tomorrow (Sep 1)\n\n## Inbox (3 since yesterday)\n- **Sarah** — Q4 budget approval needed by Friday. *Action: sign off.*\n- **Jason** — NDA needs signing. *Action: review + sign.*\n- HN Weekly — newsletter, no action.\n\n## Weather\nPartly cloudy, high 22°C, no rain expected.',
    } } }] },
    { role: 'tool', name: 'post_summary', content: 'Posted daily digest (HTTP 200).' },
    { role: 'assistant', content: 'Posted the daily digest to the dashboard.' },
  ],
  tools: TOOLS.iris,
});

// ---- R2. Digest: hourly — lighter, mostly calendar + inbox --------------
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Compile the hourly digest.\n\nINPUT:\nCurrent time: 2026-08-31T13:00:00 (America/Vancouver)\nUser: Dominic — deep-work mornings.\nCalendar: 2026-08-31T14:00:00 Project Review (1h)\nWork tasks: wt-1002 Fix login bug (urgent, due today)\nWeather: 20°C partly cloudy.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_emails', arguments: { limit: 15, since: '2026-08-31T12:00:00' } } }] },
    { role: 'tool', name: 'read_emails', content: '1 email:\n1. 2026-08-31T12:42 ci-bot@warden | "Build #1284 failed" — tests/test_scheduler.py assertion error' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'post_summary', arguments: {
      span: 'hourly',
      text: '# Hourly Digest — 1:00 PM Mon Aug 31\n\n## Next up\n- **2:00 PM** — Project Review (in 1h)\n\n## Still open\n- 🔴 **Fix login bug** (wt-1002) — urgent, due today\n\n## Inbox\n- CI bot — **Build #1284 failed** (`test_scheduler.py` assertion). *Action: investigate.*\n\n## Weather\nPartly cloudy, 20°C.',
    } } }] },
    { role: 'tool', name: 'post_summary', content: 'Posted hourly digest (HTTP 200).' },
    { role: 'assistant', content: 'Posted the hourly digest to the dashboard.' },
  ],
  tools: TOOLS.iris,
});

// ---- R3. Digest: weekly — summary of the week ---------------------------
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Compile the weekly digest.\n\nINPUT:\nCurrent time: 2026-08-31T20:00:00 (America/Vancouver)\nUser: Dominic — software engineer, prefers terse summaries.\nCalendar this week: 2026-08-25T14:00:00 Sprint planning; 2026-08-27T10:00:00 1:1 with Sarah; 2026-08-29T15:00:00 Demo to stakeholders\nWork tasks: wt-1001 Finish API spec (high, done); wt-1002 Fix login bug (urgent, done); wt-1003 Write integration tests (medium, open); wt-1004 Migrate DB (high, in-progress)\nWeather: Week mostly sunny, high 21–24°C.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_emails', arguments: { limit: 50, since: '2026-08-24T00:00:00' } } }] },
    { role: 'tool', name: 'read_emails', content: '12 emails this week. Actionable: 2026-08-25 sarah — "Roadmap feedback"; 2026-08-28 finance — "Expense report due Sep 5". Non-actionable: 10 newsletters/receipts.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'post_summary', arguments: {
      span: 'weekly',
      text: '# Weekly Digest — Week of Aug 25\n\n## Week in review\n3 meetings: Sprint planning (Mon), 1:1 with Sarah (Wed), Stakeholder demo (Fri).\n\n## Completed\n- ✅ **Fix login bug** (wt-1002)\n- ✅ **Finish API spec** (wt-1001)\n\n## In progress / open\n- 🟡 **Migrate DB** (wt-1004) — high, in progress\n- ⚪ **Write integration tests** (wt-1003) — medium, open\n\n## Inbox (12 this week)\n- **Sarah** — roadmap feedback. *Action: respond.*\n- **Finance** — expense report due **Sep 5**. *Action: file.*\n- 10 newsletters/receipts — no action.\n\n## Weather\nMostly sunny, highs 21–24°C.',
    } } }] },
    { role: 'tool', name: 'post_summary', content: 'Posted weekly digest (HTTP 200).' },
    { role: 'assistant', content: 'Posted the weekly digest to the dashboard.' },
  ],
  tools: TOOLS.iris,
});

// ---- R4. Digest with an empty section — say so plainly, do NOT invent ----
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Compile the hourly digest.\n\nINPUT:\nCurrent time: 2026-08-31T07:00:00 (America/Vancouver)\nUser: Dominic.\nCalendar: (none)\nWork tasks: (none active)\nWeather: 14°C clear.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_emails', arguments: { limit: 10, since: '2026-08-31T00:00:00' } } }] },
    { role: 'tool', name: 'read_emails', content: '0 emails.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'post_summary', arguments: {
      span: 'hourly',
      text: '# Hourly Digest — 7:00 AM Mon Aug 31\n\n## Calendar\n_No events._\n\n## Priority work\n_No active tasks._\n\n## Inbox\n_No new emails._\n\n## Weather\nClear, 14°C.',
    } } }] },
    { role: 'tool', name: 'post_summary', content: 'Posted hourly digest (HTTP 200).' },
    { role: 'assistant', content: 'Posted the hourly digest. Nothing on the calendar, no active tasks, inbox empty.' },
  ],
  tools: TOOLS.iris,
});

// ---- R5. Digest published directly from INPUT (no inbox fetch needed) --
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Compile the daily digest.\n\nINPUT:\nCurrent time: 2026-08-31T09:00:00 (America/Vancouver)\nUser: Dominic.\nCalendar: 2026-08-31T11:00:00 Standup (15m); 2026-08-31T15:30:00 Client call (45m)\nWork tasks: wt-9901 Ship release (urgent, due today); wt-9902 Update docs (low, open)\nWeather: 17°C overcast.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'post_summary', arguments: {
      span: 'daily',
      text: '# Daily Digest — Mon Aug 31\n\n## Calendar\n- **11:00–11:15 AM** — Standup\n- **3:30–4:15 PM** — Client call\n\n## Priority work\n- 🔴 **Ship release** (wt-9901) — urgent, due today\n- ⚪ **Update docs** (wt-9902) — low, open\n\n## Weather\nOvercast, 17°C.',
    } } }] },
    { role: 'tool', name: 'post_summary', content: 'Posted daily digest (HTTP 200).' },
    { role: 'assistant', content: 'Posted the daily digest to the dashboard.' },
  ],
  tools: TOOLS.iris,
});

// ---- S. Email: read / search / get --------------------------------------
examples.push(ex('iris', "What's in my inbox?",
  [{ name: 'read_emails', arguments: {} }],
  { results: ['5 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"\n5. 2026-08-30T11:00 boss@acme.io | "Monday standup moved to 11"'],
    reply: '5 emails in your inbox. Actionable: Sarah (Q4 budget sign-off by Friday), Jason (sign NDA), boss (standup moved to 11). The rest are a newsletter and a Stripe receipt.' }));
examples.push(ex('iris', "Find emails from Sarah about the Q4 budget.",
  [{ name: 'read_emails', arguments: { search: 'from:sarah Q4 budget', limit: 20 } }],
  { results: ['2 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-28T10:05 sarah@acme.io | "Q4 budget draft v2"'],
    reply: 'Found 2 emails from Sarah about the Q4 budget: "Re: Q4 budget approval needed" (Aug 31) and "Q4 budget draft v2" (Aug 28).' }));
examples.push(ex('iris', "Show me emails from the last 24 hours.",
  [{ name: 'read_emails', arguments: { since: '2026-08-30T14:05:00', limit: 50 } }],
  { results: ['3 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"'],
    reply: '3 emails in the last 24h: Sarah (budget sign-off), HN Weekly (newsletter), Stripe (paid receipt).' }));
examples.push(ex('iris', "Open the email from Jason about the NDA.",
  [{ name: 'read_emails', arguments: { search: 'from:jason NDA', limit: 10 } }],
  { results: ['1 email:\n1. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA" (id email-4f2a)'],
    reply: 'Found Jason\'s NDA email (email-4f2a, Aug 30). Want me to fetch the full body?' }));
examples.push(ex('iris', "Get me the FULL body of email email-4f2a (Jason's NDA email).",
  [{ name: 'get_email', arguments: { email_id: 'email-4f2a' } }],
  { results: ['From: jason@partnerco.com\nSubject: Action required: sign the NDA\nDate: 2026-08-30T14:20\n\nHi Dominic,\n\nPlease review and sign the attached NDA so we can move forward with the partnership. Let me know if you have questions.\n\n— Jason'],
    reply: 'Jason asks you to review and sign the attached NDA to move the partnership forward. Full body fetched.' }));
examples.push(ex('iris', "Refresh my email cache.",
  [{ name: 'refresh_email_cache', arguments: {} }],
  { results: ['Email cache refreshed.'],
    reply: 'Refreshed the email cache.' }));
examples.push(ex('iris', "What cached emails do you have?",
  [{ name: 'get_cached_emails', arguments: {} }],
  { results: ['3 cached emails:\n1. email-4f2a | jason@partnerco.com | "Action required: sign the NDA"\n2. email-9b1c | sarah@acme.io | "Re: Q4 budget approval needed"\n3. email-7d3e | boss@acme.io | "Monday standup moved to 11"'],
    reply: '3 cached emails: the NDA from Jason, Sarah\'s budget reply, and the standup-time change from your boss.' }));

// ---- T. Email: send -----------------------------------------------------
examples.push(ex('iris', "Reply to Sarah and tell her I'll sign off the Q4 budget by Friday.",
  [{ name: 'send_email', arguments: { to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: 'Hi Sarah,\n\nI\'ll sign off on the Q4 budget by Friday. Thanks for the heads-up.\n\n— Dominic' } }],
  { results: ['Email sent to sarah@acme.io ("Re: Q4 budget approval needed").'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — I\'ll sign off the Q4 budget by Friday.' }));
examples.push(ex('iris', "Email Jason the signed NDA is attached.",
  [{ name: 'send_email', arguments: { to: 'jason@partnerco.com', subject: 'Re: Action required: sign the NDA', body: 'Hi Jason,\n\nSigned NDA attached. Ready to move forward.\n\n— Dominic' } }],
  { results: ['Email sent to jason@partnerco.com ("Re: Action required: sign the NDA").'],
    reply: 'Sent the email to Jason (jason@partnerco.com) — signed NDA attached.' }));
examples.push(ex('iris', "Send a note to the team: standup is back to 10am Monday.",
  [{ name: 'send_email', arguments: { to: 'team@acme.io', subject: 'Standup back to 10am Monday', body: 'Heads-up: standup is back to 10am Monday.\n\n— Dominic' } }],
  { results: ['Email sent to team@acme.io ("Standup back to 10am Monday").'],
    reply: 'Sent the standup update to the team (team@acme.io).' }));

// ---- U. list_api_keys → api_request (the keyed API call flow) ----------
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'List my available API keys.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'list_api_keys', arguments: {} } }] },
    { role: 'tool', name: 'list_api_keys', content: 'Configured API keys:\n- openai (key_type: "openai") — https://api.openai.com\n- github (key_type: "github") — https://api.github.com\n- slack (key_type: "slack") — https://slack.com/api' },
    { role: 'assistant', content: 'You have 3 API keys configured: openai, github, and slack.' },
  ],
  tools: TOOLS.iris,
});
examples.push(ex('iris', "List my API keys so I know what services I can call.",
  [{ name: 'list_api_keys', arguments: {} }],
  { results: ['Configured API keys:\n- openai (key_type: "openai") — https://api.openai.com\n- github (key_type: "github") — https://api.github.com'],
    reply: 'You have 2 API keys: openai and github.' }));
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Fetch my latest 5 GitHub repos using the github key.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'api_request', arguments: { key_type: 'github', method: 'GET', path: '/user/repos?sort=updated&per_page=5', description: 'List 5 most recently updated repos for the user' } } }] },
    { role: 'tool', name: 'api_request', content: 'HTTP 200 OK\n\n[{"name":"Warden","updated_at":"2026-08-31T12:00:00Z"},{"name":"dotfiles","updated_at":"2026-08-20T09:00:00Z"},{"name":"sidenav","updated_at":"2026-08-10T09:00:00Z"},{"name":"acme-migration","updated_at":"2026-07-30T09:00:00Z"},{"name":"old-blog","updated_at":"2026-06-15T09:00:00Z"}]' },
    { role: 'assistant', content: 'Your 5 most recently updated GitHub repos: Warden, dotfiles, sidenav, acme-migration, old-blog.' },
  ],
  tools: TOOLS.iris,
});
examples.push(ex('iris', "Post a message to the #releases Slack channel saying v2.3 is out.",
  [{ name: 'api_request', arguments: { key_type: 'slack', method: 'POST', path: '/chat.postMessage', body: JSON.stringify({ channel: '#releases', text: 'v2.3 is out 🚀' }), description: 'Post a release announcement to #releases' } }],
  { results: ['HTTP 200 OK\n\n{"ok":true,"channel":"C12345","ts":"1693500000.000100"}'],
    reply: 'Posted "v2.3 is out 🚀" to #releases on Slack (HTTP 200).' }));
examples.push(ex('iris', "Create a GitHub issue in domdoss/Warden titled 'Reminder fires twice' with body 'The daily reminder fires twice at 11:30.'",
  [{ name: 'api_request', arguments: { key_type: 'github', method: 'POST', path: '/repos/domdoss/Warden/issues', body: JSON.stringify({ title: 'Reminder fires twice', body: 'The daily reminder fires twice at 11:30.' }), description: 'Create a bug issue in domdoss/Warden' } }],
  { results: ['HTTP 201 Created\n\n{"number":142,"title":"Reminder fires twice","url":"https://api.github.com/repos/domdoss/Warden/issues/142"}'],
    reply: 'Created issue #142 "Reminder fires twice" in domdoss/Warden (HTTP 201).' }));

// ---- V. Iris no-op / edge cases ----------------------------------------
examples.push(exText('iris', 'Summarize the email from my lawyer about the contract.',
  'I could not find an email from your lawyer about a contract. Want me to retry with a shorter sender name or a different keyword (e.g. "contract" alone)?'));
examples.push(exText('iris', 'Send an email to mom saying happy birthday.',
  'No email account is configured. Add one in the Keys tab of your dashboard and I will send it.'));
examples.push(exText('iris', 'What is the weather?',
  'I do not have a weather tool. Weather appears in your digest INPUT when it is compiled; I cannot fetch it on demand.'));

// ---- W8. Iris: inbox queries ALWAYS call read_emails ----
examples.push(ex('iris', 'List my recent emails from the inbox.',
  [{ name: 'read_emails', arguments: {} }],
  { results: ['5 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"\n5. 2026-08-30T11:00 boss@acme.io | "Standup moved to 11"'],
    reply: '5 recent emails. Actionable: Sarah (budget sign-off by Friday), Jason (sign NDA), boss (standup moved to 11). The rest are a newsletter and a Stripe receipt.' }));
examples.push(ex('iris', 'Check the inbox and list my recent emails.',
  [{ name: 'read_emails', arguments: {} }],
  { results: ['4 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"'],
    reply: '4 emails in your inbox. Actionable: Sarah (budget sign-off) and Jason (sign NDA).' }));
examples.push(ex('iris', 'Check the inbox for any new email received today.',
  [{ name: 'read_emails', arguments: { since: '2026-08-31T00:00:00', limit: 50 } }],
  { results: ['2 emails today:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"'],
    reply: '2 emails today: Sarah (budget sign-off needed) and an HN newsletter.' }));
examples.push(ex('iris', 'Read the inbox and list the emails.',
  [{ name: 'read_emails', arguments: {} }],
  { results: ['3 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n3. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"'],
    reply: '3 emails: Sarah (budget sign-off), Stripe (receipt), Jason (sign NDA).' }));
examples.push(ex('iris', 'Check the inbox for any email received in the last hour.',
  [{ name: 'read_emails', arguments: { since: '2026-08-31T13:05:00', limit: 20 } }],
  { results: ['1 email:\n1. 2026-08-31T13:42 ci-bot@warden | "Build #1284 failed"'],
    reply: '1 email in the last hour: CI bot — Build #1284 failed. Want me to dig in?' }));

// ---- W9. Iris: send_email with explicit, clean args (kill schema-as-args) ----
examples.push(ex('iris', 'Send an email to jason@partnerco.com with subject "NDA signed" and body "All done, signed and attached."',
  [{ name: 'send_email', arguments: { to: 'jason@partnerco.com', subject: 'NDA signed', body: 'All done, signed and attached.' } }],
  { results: ['Email sent to jason@partnerco.com ("NDA signed").'],
    reply: 'Sent the email to jason@partnerco.com ("NDA signed").' }));
examples.push(ex('iris', 'Email sarah@acme.io saying the budget is approved.',
  [{ name: 'send_email', arguments: { to: 'sarah@acme.io', subject: 'Q4 budget approved', body: 'Hi Sarah,\n\nThe Q4 budget is approved.\n\n— Dominic' } }],
  { results: ['Email sent to sarah@acme.io ("Q4 budget approved").'],
    reply: 'Sent the email to sarah@acme.io — Q4 budget is approved.' }));
examples.push(ex('iris', 'Compose an email to team@acme.io about the standup change to 11am.',
  [{ name: 'send_email', arguments: { to: 'team@acme.io', subject: 'Standup moved to 11am', body: 'Heads-up: standup is now at 11am.\n\n— Dominic' } }],
  { results: ['Email sent to team@acme.io ("Standup moved to 11am").'],
    reply: 'Sent the standup change to the team (team@acme.io).' }));
examples.push(ex('iris', 'Reply to boss@acme.io confirming the 11am standup works for me.',
  [{ name: 'send_email', arguments: { to: 'boss@acme.io', subject: 'Re: Standup moved to 11', body: '11am works for me. Thanks.\n\n— Dominic' } }],
  { results: ['Email sent to boss@acme.io ("Re: Standup moved to 11").'],
    reply: 'Sent the confirmation to boss@acme.io — 11am works.' }));

// ---- W10. Iris: digests that call read_emails before post_summary ----
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Compile the daily digest.\n\nINPUT:\nCurrent time: 2026-08-31T07:30:00 (America/Vancouver)\nUser: Dominic.\nCalendar: 2026-08-31T10:00:00 Standup (15m); 2026-08-31T13:00:00 Lunch with Sarah (1h)\nWork tasks: wt-701 Ship release (urgent, due today); wt-702 Review PRs (medium, open)\nWeather: 15°C clear.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_emails', arguments: { limit: 30, since: '2026-08-30T00:00:00' } } }] },
    { role: 'tool', name: 'read_emails', content: '2 emails:\n1. 2026-08-30T22:14 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-30T15:30 newsletter@hackernews.com | "HN Weekly"' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'post_summary', arguments: {
      span: 'daily',
      text: '# Daily Digest — Mon Aug 31\n\n## Calendar\n- **10:00–10:15 AM** — Standup\n- **1:00–2:00 PM** — Lunch with Sarah\n\n## Priority work\n- 🔴 **Ship release** (wt-701) — urgent, due today\n- 🟡 **Review PRs** (wt-702) — medium, open\n\n## Inbox (2 since yesterday)\n- **Sarah** — Q4 budget approval needed by Friday. *Action: sign off.*\n- HN Weekly — newsletter, no action.\n\n## Weather\nClear, 15°C.',
    } } }] },
    { role: 'tool', name: 'post_summary', content: 'Posted daily digest (HTTP 200).' },
    { role: 'assistant', content: 'Posted the daily digest to the dashboard.' },
  ],
  tools: TOOLS.iris,
});
examples.push({
  messages: [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: 'Compile the hourly digest.\n\nINPUT:\nCurrent time: 2026-08-31T16:00:00 (America/Vancouver)\nUser: Dominic.\nCalendar: (none)\nWork tasks: wt-701 Ship release (urgent, due today)\nWeather: 19°C sunny.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_emails', arguments: { limit: 15, since: '2026-08-31T15:00:00' } } }] },
    { role: 'tool', name: 'read_emails', content: '0 emails.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'post_summary', arguments: {
      span: 'hourly',
      text: '# Hourly Digest — 4:00 PM Mon Aug 31\n\n## Calendar\n_No events._\n\n## Priority work\n- 🔴 **Ship release** (wt-701) — urgent, due today\n\n## Inbox\n_No new emails._\n\n## Weather\nSunny, 19°C.',
    } } }] },
    { role: 'tool', name: 'post_summary', content: 'Posted hourly digest (HTTP 200).' },
    { role: 'assistant', content: 'Posted the hourly digest. Nothing on the calendar, no new email; Ship release still open.' },
  ],
  tools: TOOLS.iris,
});

// ---- W11. Iris: api_request clean single-call reps ----
examples.push(ex('iris', 'Fetch my open GitHub issues with the github key.',
  [{ name: 'api_request', arguments: { key_type: 'github', method: 'GET', path: '/user/issues?filter=assigned&state=open', description: 'List my open assigned GitHub issues' } }],
  { results: ['HTTP 200 OK\n\n[{"number":142,"title":"Reminder fires twice","state":"open"}]'],
    reply: 'You have 1 open GitHub issue: #142 "Reminder fires twice".' }));
examples.push(ex('iris', "Post a message to #general on slack: standup in 5 minutes.",
  [{ name: 'api_request', arguments: { key_type: 'slack', method: 'POST', path: '/chat.postMessage', body: JSON.stringify({ channel: '#general', text: 'Standup in 5 minutes.' }), description: 'Post a standup reminder to #general' } }],
  { results: ['HTTP 200 OK\n\n{"ok":true,"channel":"C12345","ts":"1693500100.000200"}'],
    reply: 'Posted "Standup in 5 minutes." to #general on Slack (HTTP 200).' }));

// =========================================================================
// BYTE — work management (projects, work tasks, deliverables, blockers,
// priorities, financials, time tracking, inbox → work tasks). Multi-step:
// list → id → act is fine for byte.
// =========================================================================

// ---- I. create_work_task — the project_id="personal" default + priority --
examples.push(ex('byte', "Record a new work task: 'Fix the login bug' — add it to my personal list.",
  [{ name: 'create_work_task', arguments: { title: 'Fix the login bug', project_id: 'personal' } }],
  { results: ['Created work task "Fix the login bug" (id wt-2001) in project personal.'],
    reply: 'Created work task "Fix the login bug" (wt-2001) in Personal.' }));
examples.push(ex('byte', "Record a new high-priority work task: 'Write the API spec'.",
  [{ name: 'create_work_task', arguments: { title: 'Write the API spec', project_id: 'personal', priority: 'high' } }],
  { results: ['Created work task "Write the API spec" (id wt-2002) in project personal.'],
    reply: 'Created work task "Write the API spec" (wt-2002, high) in Personal.' }));
examples.push(ex('byte', "Record a new urgent work task: 'Ship the hotfix'.",
  [{ name: 'create_work_task', arguments: { title: 'Ship the hotfix', project_id: 'personal', priority: 'urgent' } }],
  { results: ['Created work task "Ship the hotfix" (id wt-2003) in project personal.'],
    reply: 'Created work task "Ship the hotfix" (wt-2003, urgent) in Personal.' }));
examples.push(ex('byte', "Record a new low-priority work task: 'Review the PR'.",
  [{ name: 'create_work_task', arguments: { title: 'Review the PR', project_id: 'personal', priority: 'low' } }],
  { results: ['Created work task "Review the PR" (id wt-2004) in project personal.'],
    reply: 'Created work task "Review the PR" (wt-2004, low) in Personal.' }));
examples.push(ex('byte', "Record a new work task: 'Prepare the demo', due Friday — add it to my personal list.",
  [{ name: 'create_work_task', arguments: { title: 'Prepare the demo', project_id: 'personal', due_date: '2026-09-04' } }],
  { results: ['Created work task "Prepare the demo" (id wt-2005) in project personal.'],
    reply: 'Created work task "Prepare the demo" (wt-2005) in Personal, due 2026-09-04.' }));

// ---- J. Named project → list_projects first, then create_work_task ------
examples.push(exManage('byte', "Add a work task 'Refactor the scheduler' to the Warden project.", {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'create_work_task',
  actionArgs: { title: 'Refactor the scheduler', project_id: 'proj-warden-01' },
  actionResult: 'Created work task "Refactor the scheduler" (id wt-2006) in project proj-warden-01.',
  reply: 'Created work task "Refactor the scheduler" (wt-2006) in the Warden project (proj-warden-01).',
}));
examples.push(exManage('byte', "Add an urgent work task 'Fix the prod outage' to the Acme Migration project.", {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'create_work_task',
  actionArgs: { title: 'Fix the prod outage', project_id: 'proj-acme-02', priority: 'urgent' },
  actionResult: 'Created work task "Fix the prod outage" (id wt-2007) in project proj-acme-02.',
  reply: 'Created urgent work task "Fix the prod outage" (wt-2007) in Acme Migration (proj-acme-02).',
}));

// ---- K. create_project + seed it (the multi-tool create flow) -----------
examples.push(ex('byte', "Create a new project called 'Q4 Marketing Plan' with a description.",
  [{ name: 'create_project', arguments: { name: 'Q4 Marketing Plan', description: 'Plan and execute the Q4 marketing campaign.' } }],
  { results: ['Project "Q4 Marketing Plan" created with id proj-q4mkt-01. Now call add_deliverable, add_blocker, add_priority, update_financials, and create_work_task using this project_id.'],
    reply: 'Created project "Q4 Marketing Plan" (proj-q4mkt-01).' }));
examples.push(ex('byte', "Create a new project called 'Site Redesign', due 2026-10-31.",
  [{ name: 'create_project', arguments: { name: 'Site Redesign', due_date: '2026-10-31' } }],
  { results: ['Project "Site Redesign" created with id proj-siteredesign-01.'],
    reply: 'Created project "Site Redesign" (proj-siteredesign-01), due 2026-10-31.' }));
examples.push(ex('byte', "Create a new project called 'Mobile App' with project code MOB-001.",
  [{ name: 'create_project', arguments: { name: 'Mobile App', project_code: 'MOB-001' } }],
  { results: ['Project "Mobile App" created with id proj-mobileapp-01.'],
    reply: 'Created project "Mobile App" (proj-mobileapp-01, code MOB-001).' }));

// ---- L. Deliverables on a project ---------------------------------------
examples.push(exManage('byte', "Add a 'Launch landing page' deliverable to the Q4 Marketing Plan project.", {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-q4mkt-01 | Q4 Marketing Plan | On Track\n3. proj-warden-01 | Warden | On Track',
  actionTool: 'add_deliverable',
  actionArgs: { project_id: 'proj-q4mkt-01', name: 'Launch landing page' },
  actionResult: 'Deliverable "Launch landing page" added (id deliv-301) to project proj-q4mkt-01.',
  reply: 'Added deliverable "Launch landing page" (deliv-301) to Q4 Marketing Plan.',
}));
examples.push(exManage('byte', "Add a 'Ship v1' deliverable, due 2026-09-15, to the Mobile App project.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-mobileapp-01 | Mobile App | On Track',
  actionTool: 'add_deliverable',
  actionArgs: { project_id: 'proj-mobileapp-01', name: 'Ship v1', due_date: '2026-09-15' },
  actionResult: 'Deliverable "Ship v1" added (id deliv-302) to project proj-mobileapp-01.',
  reply: 'Added deliverable "Ship v1" (deliv-302) to Mobile App, due 2026-09-15.',
}));
examples.push(exManage('byte', "Mark the 'Launch landing page' deliverable as done.", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-q4mkt-01 | Q4 Marketing Plan | On Track\nDeliverables:\n- deliv-301 | Launch landing page | open\n- deliv-303 | Email campaign | done',
  actionTool: 'toggle_deliverable',
  actionArgs: { deliverable_id: 'deliv-301' },
  actionResult: 'Deliverable deliv-301 toggled.',
  reply: 'Marked "Launch landing page" (deliv-301) as done.',
}));
examples.push(exManage('byte', "Delete the 'Ship v1' deliverable from the Mobile App project.", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-mobileapp-01 | Mobile App | On Track\nDeliverables:\n- deliv-302 | Ship v1 | open',
  actionTool: 'delete_deliverable',
  actionArgs: { deliverable_id: 'deliv-302' },
  actionResult: 'Deliverable deliv-302 deleted.',
  reply: 'Deleted the "Ship v1" deliverable (deliv-302) from Mobile App.',
}));

// ---- M. Blockers + priorities + financials ------------------------------
examples.push(exManage('byte', "Add a high-severity blocker to the Warden project: 'CI is flaky on arm64'.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track',
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-warden-01', description: 'CI is flaky on arm64', severity: 'high' },
  actionResult: 'Blocker "CI is flaky on arm64" added (id blk-401) to project proj-warden-01.',
  reply: 'Added a high-severity blocker "CI is flaky on arm64" (blk-401) to Warden.',
}));
examples.push(exManage('byte', "Add a critical blocker to the Acme Migration project: 'Data migration script failing'.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. proj-warden-01 | Warden | On Track\n2. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-acme-02', description: 'Data migration script failing', severity: 'critical' },
  actionResult: 'Blocker "Data migration script failing" added (id blk-402) to project proj-acme-02.',
  reply: 'Added a critical blocker "Data migration script failing" (blk-402) to Acme Migration.',
}));
examples.push(exManage('byte', "Add a high-impact priority to the Warden project: 'Improve test coverage'.", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'add_priority',
  actionArgs: { project_id: 'proj-warden-01', item: 'Improve test coverage', impact: 'high' },
  actionResult: 'Priority "Improve test coverage" added (id prio-501) to project proj-warden-01.',
  reply: 'Added a high-impact priority "Improve test coverage" (prio-501) to Warden.',
}));
examples.push(exManage('byte', "Set the Warden project financials: budget 50000, spent 12000.", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-warden-01', budget: 50000, spent: 12000 },
  actionResult: 'Financials updated for project proj-warden-01.',
  reply: 'Set Warden budget to $50,000 and spent to $12,000.',
}));
examples.push(exManage('byte', "Log 3.5 hours on the Warden project today for the scheduler refactor.", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-warden-01', hours: 3.5, description: 'Scheduler refactor' },
  actionResult: 'Logged 3.5 hours on project proj-warden-01.',
  reply: 'Logged 3.5h on Warden for the scheduler refactor.',
}));
examples.push(exManage('byte', "Log 2 hours on the Acme Migration project for yesterday's migration work (2026-08-30).", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-acme-02', hours: 2, date: '2026-08-30', description: 'Migration work' },
  actionResult: 'Logged 2 hours on project proj-acme-02 for 2026-08-30.',
  reply: 'Logged 2h on Acme Migration for 2026-08-30.',
}));

// ---- N. Timer -----------------------------------------------------------
examples.push(exManage('byte', "Start a timer on the Warden project for testing.", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'start_timer',
  actionArgs: { project_id: 'proj-warden-01', description: 'Testing' },
  actionResult: 'Timer started (id timer-601) on project proj-warden-01.',
  reply: 'Started a timer on Warden (timer-601).',
}));
examples.push(ex('byte', "Stop my running timer (timer-601).",
  [{ name: 'stop_timer', arguments: { timer_id: 'timer-601' } }],
  { results: ['Timer timer-601 stopped. Logged 1.25 hours.'],
    reply: 'Stopped timer timer-601 (1.25h logged).' }));

// ---- O. update_project status enum + manage flows ----------------------
examples.push(exManage('byte', "Mark the Acme Migration project as At Risk.", {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | On Track',
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-acme-02', status: 'At Risk' },
  actionResult: 'Project proj-acme-02 updated.',
  reply: 'Marked Acme Migration (proj-acme-02) as At Risk.',
}));
examples.push(exManage('byte', "Mark the Warden project as Blocked.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track',
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-warden-01', status: 'Blocked' },
  actionResult: 'Project proj-warden-01 updated.',
  reply: 'Marked Warden (proj-warden-01) as Blocked.',
}));
examples.push(exManage('byte', "Rename the Mobile App project to 'Mobile App v2' and set it On Track.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-mobileapp-01 | Mobile App | On Track',
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-mobileapp-01', name: 'Mobile App v2', status: 'On Track' },
  actionResult: 'Project proj-mobileapp-01 updated.',
  reply: 'Renamed Mobile App to "Mobile App v2" (proj-mobileapp-01) and set it On Track.',
}));
examples.push(exManage('byte', "Complete the Site Redesign project.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-siteredesign-01 | Site Redesign | On Track',
  actionTool: 'complete_project',
  actionArgs: { project_id: 'proj-siteredesign-01' },
  actionResult: 'Project proj-siteredesign-01 completed.',
  reply: 'Completed the Site Redesign project (proj-siteredesign-01).',
}));
examples.push(exManage('byte', "Archive the Acme Migration project.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'archive_project',
  actionArgs: { project_id: 'proj-acme-02' },
  actionResult: 'Project proj-acme-02 archived.',
  reply: 'Archived Acme Migration (proj-acme-02).',
}));
examples.push(exManage('byte', "Delete the Q4 Marketing Plan project.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-q4mkt-01 | Q4 Marketing Plan | On Track',
  actionTool: 'delete_project',
  actionArgs: { project_id: 'proj-q4mkt-01' },
  actionResult: 'Project proj-q4mkt-01 deleted.',
  reply: 'Deleted the Q4 Marketing Plan project (proj-q4mkt-01).',
}));
examples.push(exManage('byte', "Delete the 'CI is flaky on arm64' blocker (blk-401).", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track\nBlockers:\n- blk-401 | CI is flaky on arm64 | high',
  actionTool: 'delete_blocker',
  actionArgs: { blocker_id: 'blk-401' },
  actionResult: 'Blocker blk-401 deleted.',
  reply: 'Deleted the "CI is flaky on arm64" blocker (blk-401).',
}));
examples.push(exManage('byte', "Remove the 'Improve test coverage' priority from the Warden project.", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track\nPriorities:\n- prio-501 | Improve test coverage | high',
  actionTool: 'delete_priority',
  actionArgs: { priority_id: 'prio-501' },
  actionResult: 'Priority prio-501 deleted.',
  reply: 'Removed the "Improve test coverage" priority (prio-501) from Warden.',
}));

// ---- P. list / get + work-task manage flows -----------------------------
examples.push(ex('byte', "List my projects.",
  [{ name: 'list_projects', arguments: {} }],
  { results: ['3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | At Risk'],
    reply: 'You have 3 projects: Personal, Warden (On Track), and Acme Migration (At Risk).' }));
examples.push(ex('byte', "List my work tasks.",
  [{ name: 'list_work_tasks', arguments: {} }],
  { results: ['4 tasks:\n1. wt-2001 | Fix the login bug | personal | medium | open\n2. wt-2006 | Refactor the scheduler | proj-warden-01 | medium | open\n3. wt-2007 | Fix the prod outage | proj-acme-02 | urgent | in-progress\n4. wt-2005 | Prepare the demo | personal | medium | open'],
    reply: 'You have 4 work tasks across Personal, Warden, and Acme Migration; the urgent one is "Fix the prod outage".' }));
examples.push(exManage('byte', "Mark the 'Fix the login bug' work task as done.", {
  listTool: 'list_work_tasks',
  listResult: '2 tasks:\n1. wt-2001 | Fix the login bug | personal | medium | open\n2. wt-2006 | Refactor the scheduler | proj-warden-01 | medium | open',
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2001', status: 'done' },
  actionResult: 'Work task wt-2001 updated.',
  reply: 'Marked "Fix the login bug" (wt-2001) as done.',
}));
examples.push(exManage('byte', "Bump the 'Refactor the scheduler' work task to high priority.", {
  listTool: 'list_work_tasks',
  listResult: '2 tasks:\n1. wt-2001 | Fix the login bug | personal | medium | done\n2. wt-2006 | Refactor the scheduler | proj-warden-01 | medium | open',
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2006', priority: 'high' },
  actionResult: 'Work task wt-2006 updated.',
  reply: 'Bumped "Refactor the scheduler" (wt-2006) to high priority.',
}));
examples.push(exManage('byte', "Delete the 'Prepare the demo' work task.", {
  listTool: 'list_work_tasks',
  listResult: '2 tasks:\n1. wt-2005 | Prepare the demo | personal | medium | open\n2. wt-2006 | Refactor the scheduler | proj-warden-01 | medium | open',
  actionTool: 'delete_work_task',
  actionArgs: { task_id: 'wt-2005' },
  actionResult: 'Work task wt-2005 deleted.',
  reply: 'Deleted the "Prepare the demo" task (wt-2005).',
}));
examples.push(exManage('byte', "Show me the details on the Warden project.", {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track',
  actionTool: 'get_project',
  actionArgs: { project_id: 'proj-warden-01' },
  actionResult: 'Project details:\nname: Warden\nid: proj-warden-01\nstatus: On Track\nDeliverables: deliv-301 Launch landing page (open)\nBlockers: blk-401 CI is flaky on arm64 (high)\nFinancials: budget 50000, spent 12000',
  reply: 'Warden (proj-warden-01) is On Track — $12k of $50k spent, 1 open deliverable, 1 high-severity blocker.',
}));

// ---- Q. Inbox → work tasks (read_emails → create_work_task) -------------
examples.push(ex('byte', "Scan the inbox for actionable emails and turn them into work tasks.",
  [{ name: 'read_emails', arguments: { limit: 50, preview_only: true } }],
  { results: ['4 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed" | Sarah needs the Q4 budget signed off by Friday.\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly" | Weekly digest (newsletter).\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid" | Receipt for $199.\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA" | Please review and sign the NDA attached.'],
    reply: 'Found 2 actionable emails: "Q4 budget approval needed" (Sarah) and "Action required: sign the NDA" (Jason). Want me to create a work task for each? The HN newsletter and Stripe receipt are non-actionable.' }));
examples.push(ex('byte', "Turn the NDA email into a work task.",
  [{ name: 'create_work_task', arguments: { title: 'Review and sign the NDA from Jason', project_id: 'personal', priority: 'high', due_date: '2026-09-02', description: 'Jason at PartnerCo needs the NDA signed. Email 2026-08-30T14:20.' } }],
  { results: ['Created work task "Review and sign the NDA from Jason" (id wt-2010) in project personal.'],
    reply: 'Created work task "Review and sign the NDA from Jason" (wt-2010, high, due 2026-09-02) in Personal.' }));

// ---- W6. Byte: manage flows that COMPLETE the second call (list → act) ----
examples.push(exManage('byte', 'mark the Warden project as On Track', {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | Blocked\n3. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-warden-01', status: 'On Track' },
  actionResult: 'Project proj-warden-01 updated.',
  reply: 'Marked Warden (proj-warden-01) as On Track.',
}));
examples.push(exManage('byte', 'set Acme Migration to Blocked', {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-acme-02', status: 'Blocked' },
  actionResult: 'Project proj-acme-02 updated.',
  reply: 'Marked Acme Migration (proj-acme-02) as Blocked.',
}));
examples.push(exManage('byte', 'mark the Mobile App project as At Risk', {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-mobileapp-01 | Mobile App | On Track',
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-mobileapp-01', status: 'At Risk' },
  actionResult: 'Project proj-mobileapp-01 updated.',
  reply: 'Marked Mobile App (proj-mobileapp-01) as At Risk.',
}));
examples.push(exManage('byte', "mark the 'Refactor the scheduler' task as in-progress", {
  listTool: 'list_work_tasks',
  listResult: '2 tasks:\n1. wt-2001 | Fix the login bug | personal | medium | done\n2. wt-2006 | Refactor the scheduler | proj-warden-01 | medium | open',
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2006', status: 'in-progress' },
  actionResult: 'Work task wt-2006 updated.',
  reply: 'Marked "Refactor the scheduler" (wt-2006) as in-progress.',
}));
examples.push(exManage('byte', 'bump the login bug task to urgent', {
  listTool: 'list_work_tasks',
  listResult: '2 tasks:\n1. wt-2001 | Fix the login bug | personal | medium | open\n2. wt-2006 | Refactor the scheduler | proj-warden-01 | medium | open',
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2001', priority: 'urgent' },
  actionResult: 'Work task wt-2001 updated.',
  reply: 'Bumped "Fix the login bug" (wt-2001) to urgent.',
}));

// ---- W7. Byte: blockers/priorities with severity/impact split into own field ----
examples.push(exManage('byte', 'add a low-severity blocker to Warden: docs are out of date', {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track',
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-warden-01', description: 'Docs are out of date', severity: 'low' },
  actionResult: 'Blocker "Docs are out of date" added (id blk-601) to project proj-warden-01.',
  reply: 'Added a low-severity blocker "Docs are out of date" (blk-601) to Warden.',
}));
examples.push(exManage('byte', 'add a critical blocker to Acme: prod database is down', {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. proj-warden-01 | Warden | On Track\n2. proj-acme-02 | Acme Migration | At Risk',
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-acme-02', description: 'Prod database is down', severity: 'critical' },
  actionResult: 'Blocker "Prod database is down" added (id blk-602) to project proj-acme-02.',
  reply: 'Added a critical blocker "Prod database is down" (blk-602) to Acme Migration.',
}));
examples.push(exManage('byte', 'add a medium blocker to Warden: the tests are slow', {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-warden-01', description: 'The tests are slow', severity: 'medium' },
  actionResult: 'Blocker "The tests are slow" added (id blk-603) to project proj-warden-01.',
  reply: 'Added a medium blocker "The tests are slow" (blk-603) to Warden.',
}));
examples.push(exManage('byte', 'add a high-impact priority to Warden: ship v2', {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'add_priority',
  actionArgs: { project_id: 'proj-warden-01', item: 'Ship v2', impact: 'high' },
  actionResult: 'Priority "Ship v2" added (id prio-604) to project proj-warden-01.',
  reply: 'Added a high-impact priority "Ship v2" (prio-604) to Warden.',
}));
examples.push(exManage('byte', 'add a low priority to my list: organize my desk', {
  listTool: 'list_projects',
  listResult: '1 project:\n1. personal | Personal | On Track',
  actionTool: 'add_priority',
  actionArgs: { project_id: 'personal', item: 'Organize my desk', impact: 'low' },
  actionResult: 'Priority "Organize my desk" added (id prio-605) to project personal.',
  reply: 'Added a low priority "Organize my desk" (prio-605) to Personal.',
}));
examples.push(exManage('byte', "add a deliverable to Warden: write the docs, due 2026-09-20", {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'add_deliverable',
  actionArgs: { project_id: 'proj-warden-01', name: 'Write the docs', due_date: '2026-09-20' },
  actionResult: 'Deliverable "Write the docs" added (id deliv-606) to project proj-warden-01.',
  reply: 'Added deliverable "Write the docs" (deliv-606) to Warden, due 2026-09-20.',
}));

// ---- W13. Byte: financials / log_time — ALWAYS list_projects first, use the
// returned proj-id, NEVER the project name as project_id. ----
examples.push(exManage('byte', 'set the Acme Migration budget to 80000', {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | On Track',
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-acme-02', budget: 80000 },
  actionResult: 'Financials updated for project proj-acme-02.',
  reply: 'Set Acme Migration (proj-acme-02) budget to $80,000.',
}));
examples.push(exManage('byte', 'update the Warden spent to 15000', {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track',
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-warden-01', spent: 15000 },
  actionResult: 'Financials updated for project proj-warden-01.',
  reply: 'Set Warden (proj-warden-01) spent to $15,000.',
}));
examples.push(exManage('byte', 'set Warden revenue to 100000', {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track',
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-warden-01', revenue: 100000 },
  actionResult: 'Financials updated for project proj-warden-01.',
  reply: 'Set Warden (proj-warden-01) revenue to $100,000.',
}));
examples.push(exManage('byte', 'log 2 hours on the Warden project for today', {
  listTool: 'list_projects',
  listResult: '2 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track',
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-warden-01', hours: 2 },
  actionResult: 'Logged 2 hours on project proj-warden-01.',
  reply: 'Logged 2h on Warden (proj-warden-01).',
}));
examples.push(exManage('byte', 'log 1.5 hours on Acme Migration', {
  listTool: 'list_projects',
  listResult: '3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | On Track',
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-acme-02', hours: 1.5 },
  actionResult: 'Logged 1.5 hours on project proj-acme-02.',
  reply: 'Logged 1.5h on Acme Migration (proj-acme-02).',
}));
examples.push(exManage('byte', 'log 4 hours on Warden yesterday for the bug fix', {
  listTool: 'list_projects',
  listResult: '1 project:\n1. proj-warden-01 | Warden | On Track',
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-warden-01', hours: 4, date: '2026-08-30', description: 'Bug fix' },
  actionResult: 'Logged 4 hours on project proj-warden-01 for 2026-08-30.',
  reply: 'Logged 4h on Warden (proj-warden-01) for 2026-08-30.',
}));

// =========================================================================
// REALITY GROUNDING — examples for the 3 live dryfire failures, phrased as
// ORCHESTRATOR BRIEFS (what iris/byte actually receive at dispatch), NOT as
// raw user chat. The orchestrator rewrites the user's ask into a verbose,
// imperative brief: explicit ids/addresses, parenthetical context, em-dashes,
// the full intent restated. iris briefs get the time-header ANCHOR prepended
// by ex() (the dispatch path does this), so the request below is the brief
// body. Fixes:
//   1. "tomorrow to pay rent" → model gave absolute 2026-09-01T00:00:00
//      instead of P1D. A relative day with NO clock time is a DURATION.
//      Reinforced with contrast pairs (tomorrow vs tomorrow at 9am).
//   2. "every 2 hours" → model gave 1200000 (20 min) instead of 7200000.
//      Reinforced with exact ms restated in the reply + a 2min/20min/2hr
//      contrast trio.
//   3. "reply to Sarah …" → model emitted send_email with body but no `to`.
//      Reply-to MUST populate `to` (resolved from the named sender / thread).
// =========================================================================

// ---- RG1. Relative day, NO clock time → ISO-8601 duration (failure #1) ----
examples.push(ex('iris', 'Set a one-time reminder to pay rent tomorrow — no specific clock time, just a one-day delay from now.',
  [{ name: 'schedule_task', arguments: { prompt: 'Pay rent.', schedule_type: 'once', schedule_value: 'P1D', context_mode: 'group' } }],
  { reply: 'Set a reminder to pay rent tomorrow (P1D).' }));
examples.push(ex('iris', 'Set a one-time reminder to renew your passport the day after tomorrow — a two-day delay, no clock time.',
  [{ name: 'schedule_task', arguments: { prompt: 'Renew your passport.', schedule_type: 'once', schedule_value: 'P2D', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your passport the day after tomorrow (P2D).' }));
examples.push(ex('iris', 'Set a one-time reminder to follow up with the bank in 3 days — a relative delay, no clock time.',
  [{ name: 'schedule_task', arguments: { prompt: 'Follow up with the bank.', schedule_type: 'once', schedule_value: 'P3D', context_mode: 'group' } }],
  { reply: 'Set a reminder to follow up with the bank in 3 days (P3D).' }));
examples.push(ex('iris', 'Set a one-time reminder to review the contract in a week — a one-week delay from now, no clock time.',
  [{ name: 'schedule_task', arguments: { prompt: 'Review the contract.', schedule_type: 'once', schedule_value: 'P7D', context_mode: 'group' } }],
  { reply: 'Set a reminder to review the contract in a week (P7D).' }));
examples.push(ex('iris', 'Set a one-time reminder for tomorrow to pay rent.',
  [{ name: 'schedule_task', arguments: { prompt: 'Pay rent.', schedule_type: 'once', schedule_value: 'P1D', context_mode: 'group' } }],
  { reply: 'Set a reminder to pay rent tomorrow (P1D).' }));
// Contrast: a clock time on that day IS an absolute timestamp, not a duration.
examples.push(ex('iris', 'Set a one-time reminder to call mom tomorrow at 9:00 AM — fire at that specific clock time.',
  [{ name: 'schedule_task', arguments: { prompt: 'Call mom.', schedule_type: 'once', schedule_value: '2026-09-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call mom tomorrow at 9am (2026-09-01T09:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to prep the standup tomorrow morning (around 9:00 AM).',
  [{ name: 'schedule_task', arguments: { prompt: 'Prep the standup.', schedule_type: 'once', schedule_value: '2026-09-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to prep the standup tomorrow morning (2026-09-01T09:00:00).' }));

// ---- RG2. Interval ms arithmetic (failure #2) — value restated in reply ----
examples.push(ex('iris', "Set a recurring interval reminder named 'Hydration Check' that fires every 2 hours — remind me to drink water. Express the interval in milliseconds.",
  [{ name: 'schedule_task', arguments: { prompt: 'Hydration Check', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a "Hydration Check" reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to stretch every 2 hours — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to stretch my back — it should fire every 2 hours.',
  [{ name: 'schedule_task', arguments: { prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to take antibiotics every 8 hours — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your antibiotics.', schedule_type: 'interval', schedule_value: '28800000', context_mode: 'group' } }],
  { reply: 'Set an antibiotics reminder every 8 hours (interval 28800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to check the servers every 3 hours — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the servers.', schedule_type: 'interval', schedule_value: '10800000', context_mode: 'group' } }],
  { reply: 'Set a server-check reminder every 3 hours (interval 10800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to rotate the logs every 4 hours — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Rotate the logs.', schedule_type: 'interval', schedule_value: '14400000', context_mode: 'group' } }],
  { reply: 'Set a log-rotation reminder every 4 hours (interval 14400000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to take eyedrops every 12 hours — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your eyedrops.', schedule_type: 'interval', schedule_value: '43200000', context_mode: 'group' } }],
  { reply: 'Set an eyedrops reminder every 12 hours (interval 43200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to back up the database every 24 hours — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Back up the database.', schedule_type: 'interval', schedule_value: '86400000', context_mode: 'group' } }],
  { reply: 'Set a DB-backup reminder every 24 hours (interval 86400000ms).' }));
// Minutes vs hours contrast trio — kills the 1200000 (=20min) confusion.
examples.push(ex('iris', 'Set a recurring interval reminder to check the queue every 2 minutes — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the queue.', schedule_type: 'interval', schedule_value: '120000', context_mode: 'group' } }],
  { reply: 'Set a queue-check reminder every 2 minutes (interval 120000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to check the deploy every 20 minutes — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the deploy.', schedule_type: 'interval', schedule_value: '1200000', context_mode: 'group' } }],
  { reply: 'Set a deploy-check reminder every 20 minutes (interval 1200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to check the build status every 2 hours — interval in milliseconds.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the build status.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a build-status reminder every 2 hours (interval 7200000ms).' }));

// ---- RG3. send_email reply-to — resolve `to`, put it first (failure #3) ----
examples.push(ex('iris', "Reply to Sarah and tell her I'll sign off the Q4 budget by Friday — send the reply.",
  [{ name: 'send_email', arguments: { to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: "Hi Sarah,\n\nI'll sign off on the Q4 budget by Friday. Thanks for the heads-up.\n\n— Dominic" } }],
  { results: ['Email sent to sarah@acme.io ("Re: Q4 budget approval needed").'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — I will sign off the Q4 budget by Friday.' }));
examples.push(ex('iris', "Reply to Jason and tell him the NDA is signed — send the reply.",
  [{ name: 'send_email', arguments: { to: 'jason@partnerco.com', subject: 'Re: Action required: sign the NDA', body: 'Hi Jason,\n\nSigned the NDA — ready to move forward.\n\n— Dominic' } }],
  { results: ['Email sent to jason@partnerco.com ("Re: Action required: sign the NDA").'],
    reply: 'Sent the reply to Jason (jason@partnerco.com) — NDA signed.' }));
examples.push(ex('iris', "Reply to Sarah's 'Q4 budget approval needed' email and tell her I'll sign off the Q4 budget by Friday.",
  [{ name: 'send_email', arguments: { to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: "Hi Sarah,\n\nI'll sign off on the Q4 budget by Friday.\n\n— Dominic" } }],
  { results: ['Email sent to sarah@acme.io ("Re: Q4 budget approval needed").'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — Q4 budget sign-off by Friday.' }));
examples.push(ex('iris', "Send an email to alex@example.com asking for a meeting next Thursday — then confirm it's sent.",
  [{ name: 'send_email', arguments: { to: 'alex@example.com', subject: 'Meeting next Thursday?', body: 'Hi Alex,\n\nAre you free for a meeting next Thursday? Let me know what time works.\n\n— Dominic' } }],
  { results: ['Email sent to alex@example.com ("Meeting next Thursday?").'],
    reply: 'Sent the email to alex@example.com asking for a meeting next Thursday.' }));
examples.push(ex('iris', "Email my boss at boss@acme.io to confirm the standup moved to 11am — reply to the standup thread.",
  [{ name: 'send_email', arguments: { to: 'boss@acme.io', subject: 'Re: Standup moved to 11', body: '11am works for me — confirmed. Thanks.\n\n— Dominic' } }],
  { results: ['Email sent to boss@acme.io ("Re: Standup moved to 11").'],
    reply: 'Sent the confirmation to your boss (boss@acme.io) — 11am standup confirmed.' }));

// ---- RG4. Calendar briefs (orch style: "Create a calendar event …") -----
examples.push(ex('iris', "Create a calendar event tomorrow at 2:00 PM called 'Dentist appointment'.",
  [{ name: 'create_calendar_event', arguments: { title: 'Dentist appointment', start_time: '2026-09-01T14:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event tomorrow at 2pm (2026-09-01T14:00:00).' }));
examples.push(ex('iris', 'Create a calendar event for next Tuesday at 3:00 PM — a dentist appointment.',
  [{ name: 'create_calendar_event', arguments: { title: 'Dentist appointment', start_time: '2026-09-01T15:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event next Tuesday at 3pm (2026-09-01T15:00:00).' }));
examples.push(ex('iris', "Create a calendar event this Friday at 6:00 PM called 'Poker night'.",
  [{ name: 'create_calendar_event', arguments: { title: 'Poker night', start_time: '2026-09-04T18:00:00' } }],
  { reply: 'Created a "Poker night" calendar event Friday at 6pm (2026-09-04T18:00:00).' }));
examples.push(ex('iris', "Set up a recurring reminder every Monday at 9:00 AM called 'Project Sync'.",
  [{ name: 'schedule_task', arguments: { prompt: 'Project Sync', schedule_type: 'cron', schedule_value: '0 9 * * 1', context_mode: 'group' } }],
  { reply: 'Set a recurring "Project Sync" reminder every Monday at 9am (cron 0 9 * * 1).' }));

// ---- RG5. Reminder briefs + the 45-min vs 45-sec disambiguation ----------
examples.push(ex('iris', 'Set a one-time reminder to check the oven in 45 minutes — fire 45 minutes from now.',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the oven.', schedule_type: 'once', schedule_value: 'PT45M', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the oven in 45 minutes (PT45M).' }));
examples.push(ex('iris', 'Set a one-time reminder to flip the laundry in 2 minutes.',
  [{ name: 'schedule_task', arguments: { prompt: 'Flip the laundry.', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder to flip the laundry in 2 minutes (PT2M).' }));
examples.push(ex('iris', 'Set a one-time reminder to call Sam today at 6:00 PM.',
  [{ name: 'schedule_task', arguments: { prompt: 'Call Sam.', schedule_type: 'once', schedule_value: '2026-08-31T18:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call Sam at 6pm today (2026-08-31T18:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to fire 10 minutes from now with the message "E2E_PING_TEST" — report the task id when created.',
  [{ name: 'schedule_task', arguments: { prompt: 'E2E_PING_TEST', schedule_type: 'once', schedule_value: 'PT10M', context_mode: 'group' } }],
  { reply: 'Set a one-time reminder in 10 minutes (PT10M) with message "E2E_PING_TEST".' }));
examples.push(ex('iris', 'List all of my scheduled tasks.',
  [{ name: 'list_tasks', arguments: {} }],
  { results: ['3 tasks:\n1. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n2. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active\n3. task-cb-1788206097352-log01 | interval 7200000 | Hydration Check | active'],
    reply: 'You have 3 scheduled tasks: take xyz medication daily 11:30am, meditate daily 7am, and the Hydration Check every 2 hours.' }));
examples.push(ex('iris', 'Cancel the scheduled reminder task-cb-1788206097352-log01 — that is the "Hydration Check" one.',
  [{ name: 'cancel_task', arguments: { task_id: 'task-cb-1788206097352-log01' } }],
  { results: ['Task task-cb-1788206097352-log01 cancelled.'],
    reply: 'Cancelled the Hydration Check reminder (task-cb-1788206097352-log01).' }));

// ---- RG6. Ask-back: recurring/relative brief with a vague time, no clock --
examples.push(exText('iris', 'Set up a recurring reminder to check the server logs every Sunday evening.',
  'What time Sunday evening should the server-logs reminder fire? Give me a specific time (e.g. "6pm").'));
examples.push(exText('iris', 'Set a one-time reminder to fill out the form for Ralph some time today.',
  'What time today should I remind you to fill out the form for Ralph? Give me a specific clock time (e.g. "3pm") or a relative time (e.g. "in 2 hours").'));
examples.push(exText('iris', 'Set a one-time reminder for tomorrow morning.',
  'What should the reminder say, and what time tomorrow morning? Give me the content and a specific time (e.g. "8am").'));

// ---- RG7. Email briefs (orch style: "Check/Search/List …") ---------------
examples.push(ex('iris', 'Check the inbox for emails from support received in the last 7 days — report how many and what each is about.',
  [{ name: 'read_emails', arguments: { search: 'from:support', since: '2026-08-24T14:05:00', limit: 50 } }],
  { results: ['2 emails from support in the last 7 days:\n1. 2026-08-29T10:11 support@saas.io | "Ticket #4421 resolved"\n2. 2026-08-26T15:40 support@saas.io | "Maintenance window Sunday"'],
    reply: '2 emails from support in the last 7 days: ticket #4421 resolved (Aug 29) and a Sunday maintenance window (Aug 26).' }));
examples.push(ex('iris', 'Search the emails for one containing the word "invoice" and report the total amount mentioned in it.',
  [{ name: 'read_emails', arguments: { search: 'invoice', limit: 20 } }],
  { results: ['1 email:\n1. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid" — total $199.00'],
    reply: 'Found 1 invoice email: Stripe "Invoice #4421 paid" (Aug 30), total $199.00.' }));
examples.push(ex('iris', 'List my unread emails grouped by sender.',
  [{ name: 'read_emails', arguments: {} }],
  { results: ['4 unread:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"'],
    reply: '4 unread, by sender: Sarah (budget sign-off), Jason (sign NDA), Stripe (receipt), Hacker News (newsletter).' }));
examples.push(ex('iris', 'Check for any new email received in the past hour.',
  [{ name: 'read_emails', arguments: { since: '2026-08-31T13:05:00', limit: 20 } }],
  { results: ['1 email:\n1. 2026-08-31T13:42 ci-bot@warden | "Build #1284 failed"'],
    reply: '1 new email in the past hour: CI bot — Build #1284 failed.' }));
examples.push(ex('iris', 'Check for any emails received today that I should not have missed.',
  [{ name: 'read_emails', arguments: { since: '2026-08-31T00:00:00', limit: 50 } }],
  { results: ['2 emails today:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"'],
    reply: '2 emails today: Sarah (Q4 budget sign-off by Friday — worth acting on) and an HN newsletter (no action).' }));
examples.push(ex('iris', 'Check whether I have any important emails in the inbox.',
  [{ name: 'read_emails', arguments: {} }],
  { results: ['3 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed" — needs sign-off by Friday\n2. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid" (receipt)'],
    reply: '2 look important: Sarah needs the Q4 budget signed off by Friday, and Jason needs the NDA signed. The Stripe email is just a paid receipt.' }));
examples.push(ex('iris', 'Find the email for order #48215 and pull the tracking info out of it.',
  [{ name: 'read_emails', arguments: { search: '48215', limit: 10 } }],
  { results: ['1 email:\n1. 2026-08-30T11:00 orders@shop.io | "Order #48215 shipped" — tracking 1Z999AA10123456784'],
    reply: 'Found order #48215 (orders@shop.io, Aug 30): tracking number 1Z999AA10123456784. Want me to fetch the full body?' }));

// ---- RG8. Byte briefs (orch style: "Record/List/Break down …") -----------
examples.push(ex('byte', "Record a new work task: 'Buy new headphones' — add it to my personal list.",
  [{ name: 'create_work_task', arguments: { title: 'Buy new headphones', project_id: 'personal' } }],
  { results: ['Created work task "Buy new headphones" (id wt-2080) in project personal.'],
    reply: 'Created work task "Buy new headphones" (wt-2080) in Personal.' }));
examples.push(ex('byte', 'List my work tasks marked high priority.',
  [{ name: 'list_work_tasks', arguments: {} }],
  { results: ['3 tasks:\n1. wt-2003 | Ship the hotfix | proj-acme-02 | urgent | open\n2. wt-2002 | Write the API spec | personal | high | open\n3. wt-2001 | Fix the login bug | personal | high | open'],
    reply: '3 high/urgent tasks: Ship the hotfix (urgent), Write the API spec (high), and Fix the login bug (high).' }));
examples.push(ex('byte', 'List my work tasks that are past due / overdue.',
  [{ name: 'list_work_tasks', arguments: {} }],
  { results: ['2 tasks:\n1. wt-1002 | Fix login bug | personal | urgent | open | due 2026-08-31 (overdue)\n2. wt-2005 | Prepare the demo | personal | medium | open | due 2026-08-31 (overdue)'],
    reply: '2 overdue tasks, both due today: "Fix login bug" (urgent) and "Prepare the demo".' }));
examples.push(ex('byte', "Break the goal 'Launch Blog Update' into three subtasks — create each as a work task in the personal list.",
  [
    { name: 'create_work_task', arguments: { title: 'Draft the blog post', project_id: 'personal' } },
    { name: 'create_work_task', arguments: { title: 'Add images and formatting', project_id: 'personal' } },
    { name: 'create_work_task', arguments: { title: 'Publish and share the post', project_id: 'personal' } },
  ],
  { results: ['Created work task "Draft the blog post" (id wt-2090) in project personal.', 'Created work task "Add images and formatting" (id wt-2091) in project personal.', 'Created work task "Publish and share the post" (id wt-2092) in project personal.'],
    reply: 'Broke "Launch Blog Update" into 3 subtasks: Draft the blog post (wt-2090), Add images and formatting (wt-2091), Publish and share (wt-2092).' }));
// Real multi-tool create flow: project + deliverable + blocker (byte is multi-step).
examples.push({
  messages: [
    { role: 'system', content: BYTE_SYSTEM },
    { role: 'user', content: "Create a new work project called 'Jarvis Audit', then add a deliverable titled 'Capability Report' and a blocker 'No email account configured' to it." },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'create_project', arguments: { name: 'Jarvis Audit', description: 'Audit of assistant capabilities and coverage.' } } }] },
    { role: 'tool', name: 'create_project', content: 'Project "Jarvis Audit" created with id proj-jarvisaudit-01. Now call add_deliverable, add_blocker, etc. using this project_id.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'add_deliverable', arguments: { project_id: 'proj-jarvisaudit-01', name: 'Capability Report' } } }] },
    { role: 'tool', name: 'add_deliverable', content: 'Deliverable "Capability Report" added (id deliv-700) to project proj-jarvisaudit-01.' },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'add_blocker', arguments: { project_id: 'proj-jarvisaudit-01', description: 'No email account configured', severity: 'medium' } } }] },
    { role: 'tool', name: 'add_blocker', content: 'Blocker "No email account configured" added (id blk-700) to project proj-jarvisaudit-01.' },
    { role: 'assistant', content: 'Created project "Jarvis Audit" (proj-jarvisaudit-01), added the "Capability Report" deliverable (deliv-700) and a "No email account configured" blocker (blk-700).' },
  ],
  tools: TOOLS.byte,
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const lines = examples.map(e => JSON.stringify(e));
  writeFileSync(new URL('./toolcall-sft.jsonl', import.meta.url), lines.join('\n') + '\n');
  console.log(`Wrote ${examples.length} examples to toolcall-sft.jsonl`);

  // Per-agent + per-target counts.
  const byAgent = {}, byTarget = {};
  for (const e of examples) {
    const sys = e.messages[0].content;
    const agent = sys.startsWith('You are Byte') ? 'byte'
      : sys.startsWith('You are Iris') ? 'iris' : '?';
    byAgent[agent] = (byAgent[agent] || 0) + 1;
    const a = e.messages.find(m => m.role === 'assistant');
    const key = a?.tool_calls ? a.tool_calls.map(t => t.function.name).join('+') : 'text-only';
    byTarget[key] = (byTarget[key] || 0) + 1;
  }
  console.log('By agent:', byAgent);
  console.log('By target:', byTarget);
}

export { examples };