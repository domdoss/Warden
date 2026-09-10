// Full toolcall-model SFT dataset generator.
//
// Produces JSONL for the single LoRA fine-tune that powers IRIS — the one
// toolcall agent since 2026-09-05, when byte was merged in (one toolcall agent,
// one fine-tuned model). The 2026-09-09 collapse stripped iris to the CORE:
// FOUR action-parameterized tools — email, task (scheduled reminders), calendar,
// alarm. Project management, work tasks, and admin were dropped entirely.
// Each row is OpenAI-style messages +
// a `tools` array, so the Granite chat template renders the EXACT system block
// + tool schemas the agent sees at inference, and the assistant target is a
// Granite tool call.
//
// IRIS IS SINGLE-SHOT (maxIterations: 1): ONE model turn per request — one
// tool call (or parallel calls when the request names several things, e.g. the
// reminder+calendar pair). Manage flows are id-supplied: the orchestrator
// resolves ids (its own list dispatch) and the brief carries them. No
// list→act chains anywhere in the data.
//
// The system prompt is EXTRACTED from the live runner source at gen time
// (see IRIS_SYSTEM below) — training always matches production, and a source
// edit that breaks extraction throws here, loudly. The `tools` array is loaded
// from tool_schemas.json, dumped straight from the compiled agent-runner
// registry (see dump_tool_schemas.mjs) — so the SFT tool shapes are
// byte-for-byte the live schemas, not hand-copied.
//
// Coverage is weighted to the hard calls the 3B Granite fumbles:
//   scheduling: schedule_value forms (PT2M vs timestamp vs cron vs ms), field
//           placement, ask-back when no payload, id-supplied manage flows,
//           email read/send/search.
//   alarms: create/list/update/delete — HH:MM, repeat patterns, id-supplied
//           manage.
//
// Every request carries the ANCHOR time header (the dispatch path prepends it
// to ALL iris tasks). Request strings are written in
// the real orchestrator-brief style (verbose, parenthetical timezone, ALLCAPS
// emphasis, explicit ids, em-dashes) so train≈infer — the model must extract
// clean tool args from emphatic prose.

import { readFileSync, writeFileSync } from 'node:fs';
// Sentry run-mode rows REMOVED 2026-09-08: the user switched sentry to share
// the orchestrator/atlas model (dashboard-set), so the toolcall fine-tune no
// longer covers sentry — this dataset trains only what toolcall-ft runs.

const SCHEMAS = JSON.parse(readFileSync(new URL('./tool_schemas.json', import.meta.url), 'utf8'));
export const TOOLS = { iris: SCHEMAS.iris };

// IRIS_SYSTEM — extracted VERBATIM from the live runner source so the SFT
// system block is exactly what the merged agent ships with. If the iris
// SUBAGENTS entry moves or its prompt is edited, this throws at gen time
// rather than silently training a stale prompt.
const runnerSrc = readFileSync('/opt/Warden/container/agent-runner/src/index.ts', 'utf8');
const irisPromptMatch = runnerSrc.match(/delegate: 'iris',[\s\S]*?systemPrompt: `([\s\S]*?)`,\s*\n\s*toolsets:/);
if (!irisPromptMatch) {
  throw new Error("iris systemPrompt not found in container/agent-runner/src/index.ts — extraction drifted from source (was the SUBAGENTS entry renamed or the systemPrompt moved?)");
}
const IRIS_SYSTEM = irisPromptMatch[1];
const SYSTEMS = { iris: IRIS_SYSTEM };
export { SYSTEMS, IRIS_SYSTEM };

// Fixed anchor so iris's absolute timestamps are reproducible. Matches the
// injected time-header format exactly (the dispatch path prepends this for
// every iris call).
const ANCHOR = 'Current local time is 2026-08-31T14:05:00 (timezone America/Vancouver). Compute every absolute timestamp from this.';
export { ANCHOR };

// ---- example builders ---------------------------------------------------

// Single agent since the byte merge — every builder below hard-fails on
// anything but 'iris' so a stale byte call site can't silently emit a
// never-seen-at-inference system prompt.
function assertIris(agent) {
  if (agent !== 'iris') {
    throw new Error(`ex('${agent}', ...) — iris is the only toolcall agent (byte merged 2026-09-05). Retag the call site.`);
  }
}

// Single-shot: user request → one tool call (or a parallel set when the
// request names several things), then an optional text reply (emitted as a
// separate assistant turn after a synthetic tool result). Every request gets
// the ANCHOR prepended — the dispatch path injects the time header into ALL
// iris tasks, work management included.
function ex(agent, request, toolCalls, opts = {}) {
  assertIris(agent);
  const msgs = [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: `${ANCHOR}\n\n${request}` },
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
  return { messages: msgs, tools: TOOLS.iris };
}

// No-tool: assistant replies with text only (ask-back / out-of-scope / empty).
function exText(agent, request, reply) {
  assertIris(agent);
  return {
    messages: [
      { role: 'system', content: IRIS_SYSTEM },
      { role: 'user', content: `${ANCHOR}\n\n${request}` },
      { role: 'assistant', content: reply },
    ],
    tools: TOOLS.iris,
  };
}

// Single-shot manage: the id arrives ALREADY SUPPLIED in the request — the
// orchestrator resolves it (its own list dispatch) and the brief names it. The
// id clause is derived from actionArgs and appended to the request, matching
// how real orchestrator briefs carry explicit ids ("…the Warden project
// (proj-warden-01)…"). Emits exactly ONE tool call.
function exManage(agent, request, { actionTool, actionArgs, actionResult, reply }) {
  assertIris(agent);
  const idKey = Object.keys(actionArgs).find((k) => /_id$/.test(k));
  const brief = idKey ? `${request} (id: ${actionArgs[idKey]} — use that exact id.)` : request;
  const msgs = [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: `${ANCHOR}\n\n${brief}` },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: actionTool, arguments: actionArgs } }] },
    { role: 'tool', name: actionTool, content: actionResult },
    { role: 'assistant', content: reply },
  ];
  return { messages: msgs, tools: TOOLS.iris };
}

const examples = [];

// =========================================================================
// IRIS — scheduling (ported from the dexter-only generator: the proven
// failure classes). iris is single-shot; every example is one tool call (or
// parallel calls in one turn for "both reminder + calendar").
// =========================================================================

// ---- A. Relative once reminders (duration) — the clock-math bug class ----
examples.push(ex('iris', 'Set a one-time reminder to fire in 2 minutes (current time is 2026-08-31 2:05 PM America/Vancouver) with the message "Check the oven" — it should fire around 2:07 PM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the oven.', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the oven in 2 minutes (PT2M).' }));
examples.push(ex('iris', 'In 90 seconds, ping me to stand up and stretch.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Stand up and stretch.', schedule_type: 'once', schedule_value: 'PT90S', context_mode: 'group' } }],
  { reply: 'Set a reminder to stand up in 90 seconds (PT90S).' }));
examples.push(ex('iris', 'Set a one-time reminder to call mom in an hour and a half (1 hour 30 minutes).',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call mom.', schedule_type: 'once', schedule_value: 'PT1H30M', context_mode: 'group' } }],
  { reply: 'Set a reminder to call mom in 1 hour 30 minutes (PT1H30M).' }));
examples.push(ex('iris', 'Set a one-time reminder for tomorrow (America/Vancouver) to pay rent.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Pay rent.', schedule_type: 'once', schedule_value: 'P1D', context_mode: 'group' } }],
  { reply: 'Set a reminder to pay rent tomorrow (P1D).' }));
examples.push(ex('iris', 'Set a one-time reminder to renew your passport in 2 days — a two-day delay.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Renew your passport.', schedule_type: 'once', schedule_value: 'P2D', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your passport in 2 days (P2D).' }));
examples.push(ex('iris', 'In 45 seconds ping me about the build.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'The build is done — check the results.', schedule_type: 'once', schedule_value: 'PT45S', context_mode: 'group' } }],
  { reply: 'Set a reminder about the build in 45 seconds (PT45S).' }));
examples.push(ex('iris', 'Set a one-time reminder to take the cake out in 3 hours.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take the cake out of the oven.', schedule_type: 'once', schedule_value: 'PT3H', context_mode: 'group' } }],
  { reply: 'Set a reminder to take the cake out in 3 hours (PT3H).' }));
examples.push(ex('iris', 'Set a one-time reminder to flip the timer in 1 minute.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Flip the timer.', schedule_type: 'once', schedule_value: 'PT1M', context_mode: 'group' } }],
  { reply: 'Set a reminder to flip the timer in 1 minute (PT1M).' }));

// ---- B. Absolute once reminders (named clock time) — compute from anchor ----
examples.push(ex('iris', 'Set a one-time reminder to fire at 3:00 PM today (America/Vancouver) to pick up the kids.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Pick up the kids.', schedule_type: 'once', schedule_value: '2026-08-31T15:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to pick up the kids at 3 PM today (2026-08-31T15:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to take your medication at 5:00 AM tomorrow morning (America/Vancouver).',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your medication.', schedule_type: 'once', schedule_value: '2026-09-01T05:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take your medication at 5:00 tomorrow morning (2026-09-01T05:00:00).' }));
examples.push(ex('iris', 'At 9:30 AM on March 20, remind me to submit the quarterly report.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the quarterly report.', schedule_type: 'once', schedule_value: '2026-03-20T09:30:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the quarterly report at 9:30am on March 20 (2026-03-20T09:30:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to water the plants tonight at 8 PM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Water the plants.', schedule_type: 'once', schedule_value: '2026-08-31T20:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to water the plants tonight at 8pm (2026-08-31T20:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to call the dentist at noon tomorrow.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call the dentist to book an appointment.', schedule_type: 'once', schedule_value: '2026-09-01T12:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call the dentist at noon tomorrow (2026-09-01T12:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder for September 5 at 2:00 PM (America/Vancouver) to submit the visa application.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the visa application.', schedule_type: 'once', schedule_value: '2026-09-05T14:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the visa application on September 5 at 2pm (2026-09-05T14:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to renew your drivers license on October 1 at 9 AM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Renew your drivers license.', schedule_type: 'once', schedule_value: '2026-10-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your drivers license on October 1 at 9am (2026-10-01T09:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to take out the recycling tonight at 11:45 PM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take out the recycling.', schedule_type: 'once', schedule_value: '2026-08-31T23:45:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take out the recycling tonight at 11:45pm (2026-08-31T23:45:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to catch your flight on September 10 at 8 AM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Head to the airport — your flight is soon.', schedule_type: 'once', schedule_value: '2026-09-10T08:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to catch your flight on September 10 at 8am (2026-09-10T08:00:00).' }));

// ---- C. Recurring cron — the field-placement bug class -----------------
examples.push(ex('iris', 'Create a daily recurring reminder for 10:30 AM (America/Vancouver) to take my medication.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your medication.', schedule_type: 'cron', schedule_value: '30 10 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily reminder at 10:30am to take your medication (cron 30 10 * * *).' }));
examples.push(ex('iris', 'Create a daily recurring reminder for 11:30 AM (America/Vancouver) to take xyz medication.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take xyz medication.', schedule_type: 'cron', schedule_value: '30 11 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 11:30am reminder to take xyz medication (cron 30 11 * * *).' }));
examples.push(ex('iris', 'Every day at 7 AM remind me to meditate.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Meditate.', schedule_type: 'cron', schedule_value: '0 7 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 7am meditation reminder (cron 0 7 * * *).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 9:00 AM (America/Vancouver) to stand up and stretch.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Stand up and stretch.', schedule_type: 'cron', schedule_value: '0 9 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 9am stand-up reminder (cron 0 9 * * 1-5).' }));
examples.push(ex('iris', 'Every Monday at 6 PM remind me to take out the trash.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take out the trash.', schedule_type: 'cron', schedule_value: '0 18 * * 1', context_mode: 'group' } }],
  { reply: 'Set a Monday 6pm trash reminder (cron 0 18 * * 1).' }));
examples.push(ex('iris', 'Set a recurring Friday reminder at 5 PM to file your timesheet.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'File your timesheet.', schedule_type: 'cron', schedule_value: '0 17 * * 5', context_mode: 'group' } }],
  { reply: 'Set a Friday 5pm timesheet reminder (cron 0 17 * * 5).' }));
examples.push(ex('iris', 'Set a recurring reminder on the 1st of every month at 9 AM to pay rent.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Pay rent.', schedule_type: 'cron', schedule_value: '0 9 1 * *', context_mode: 'group' } }],
  { reply: 'Set a monthly 1st-at-9am rent reminder (cron 0 9 1 * *).' }));
examples.push(ex('iris', 'Every 15th at noon, remind me to review the budget.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Review the budget.', schedule_type: 'cron', schedule_value: '0 12 15 * *', context_mode: 'group' } }],
  { reply: 'Set a monthly 15th-at-noon budget review (cron 0 12 15 * *).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 8:15 AM to leave for work.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Leave for work.', schedule_type: 'cron', schedule_value: '15 8 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 8:15am leave-for-work reminder (cron 15 8 * * 1-5).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 5:30 PM to log off work.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Log off work for the day.', schedule_type: 'cron', schedule_value: '30 17 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 5:30pm log-off reminder (cron 30 17 * * *).' }));
examples.push(ex('iris', 'Every Sunday at 9 AM remind me to plan the week.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Plan the week ahead.', schedule_type: 'cron', schedule_value: '0 9 * * 0', context_mode: 'group' } }],
  { reply: 'Set a Sunday 9am weekly planning reminder (cron 0 9 * * 0).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 12:30 PM to eat lunch.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Eat lunch.', schedule_type: 'cron', schedule_value: '30 12 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 12:30pm lunch reminder (cron 30 12 * * 1-5).' }));
examples.push(ex('iris', 'Set a recurring reminder on the last day of every month at 6 PM to close the books.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Close the books for the month.', schedule_type: 'cron', schedule_value: '0 18 28-31 * *', context_mode: 'group' } }],
  { reply: 'Set a month-end 6pm close-the-books reminder (cron 0 18 28-31 * *).' }));
// ---- C2. Cron with step / comma / range fields --------------------------
examples.push(ex('iris', 'Set a recurring reminder every 2 hours on the hour to drink water.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Drink some water.', schedule_type: 'cron', schedule_value: '0 */2 * * *', context_mode: 'group' } }],
  { reply: 'Set a water reminder every 2 hours on the hour (cron 0 */2 * * *).' }));
examples.push(ex('iris', 'Set a recurring reminder every 15 minutes to check the queue.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the queue.', schedule_type: 'cron', schedule_value: '*/15 * * * *', context_mode: 'group' } }],
  { reply: 'Set a queue-check reminder every 15 minutes (cron */15 * * * *).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 9 AM and 9 PM to take your eye drops.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your eye drops.', schedule_type: 'cron', schedule_value: '0 9,21 * * *', context_mode: 'group' } }],
  { reply: 'Set a twice-daily 9am/9pm eye-drops reminder (cron 0 9,21 * * *).' }));
examples.push(ex('iris', 'Set a recurring reminder every other day at 8 AM to water the plants.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Water the plants.', schedule_type: 'cron', schedule_value: '0 8 */2 * *', context_mode: 'group' } }],
  { reply: 'Set an every-other-day 8am plant-watering reminder (cron 0 8 */2 * *).' }));
examples.push(ex('iris', 'Set a recurring weekend reminder at 10 AM to do laundry.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Do laundry.', schedule_type: 'cron', schedule_value: '0 10 * * 0,6', context_mode: 'group' } }],
  { reply: 'Set a weekend 10am laundry reminder (cron 0 10 * * 0,6).' }));
examples.push(ex('iris', 'Set a recurring reminder every 6 hours to change the laundry over.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Change the laundry over.', schedule_type: 'cron', schedule_value: '0 */6 * * *', context_mode: 'group' } }],
  { reply: 'Set a laundry reminder every 6 hours (cron 0 */6 * * *).' }));

// ---- D. Interval -------------------------------------------------------
examples.push(ex('iris', 'Set a recurring interval reminder every 5 minutes to check the build status.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the build status.', schedule_type: 'interval', schedule_value: '300000', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the build every 5 minutes (interval 300000ms).' }));
examples.push(ex('iris', 'Every 30 minutes remind me to drink water.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Drink some water.', schedule_type: 'interval', schedule_value: '1800000', context_mode: 'group' } }],
  { reply: 'Set a water reminder every 30 minutes (interval 1800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 2 hours to stretch your back.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 90 minutes to check the server.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the server.', schedule_type: 'interval', schedule_value: '5400000', context_mode: 'group' } }],
  { reply: 'Set a server-check reminder every 90 minutes (interval 5400000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 10 minutes to check the build log.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the build log for failures.', schedule_type: 'interval', schedule_value: '600000', context_mode: 'group' } }],
  { reply: 'Set a build-log reminder every 10 minutes (interval 600000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 45 minutes to look away from the screen and rest your eyes.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Look away from the screen and rest your eyes.', schedule_type: 'interval', schedule_value: '2700000', context_mode: 'group' } }],
  { reply: 'Set an eye-rest reminder every 45 minutes (interval 2700000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 8 hours to take your antibiotics.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your antibiotics.', schedule_type: 'interval', schedule_value: '28800000', context_mode: 'group' } }],
  { reply: 'Set an antibiotics reminder every 8 hours (interval 28800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 3 hours to feed the cat.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Feed the cat.', schedule_type: 'interval', schedule_value: '10800000', context_mode: 'group' } }],
  { reply: 'Set a cat-feeding reminder every 3 hours (interval 10800000ms).' }));

// ---- E. Manage flows (single-shot: id ALREADY SUPPLIED by the orchestrator) ----
// iris never lists-then-acts in one delegation. The orchestrator already ran the
// list, picked the id, and hands it to iris in the request. Each example below
// is ONE tool call with the id in the request.
examples.push(ex('iris', 'Cancel the reminder task-cb-1788206097352-yadl0c — that is the 11:30 AM "Take xyz medication" daily reminder.',
  [{ name: 'task', arguments: { action: 'cancel', task_id: 'task-cb-1788206097352-yadl0c' } }],
  { results: ['Task task-cb-1788206097352-yadl0c cancelled.'],
    reply: 'Cancelled the "Take xyz medication" reminder (task-cb-1788206097352-yadl0c).' }));
examples.push(ex('iris', 'Pause the reminder task-cb-1788206097352-abc123 — the 7 AM daily meditation reminder.',
  [{ name: 'task', arguments: { action: 'pause', task_id: 'task-cb-1788206097352-abc123' } }],
  { results: ['Task task-cb-1788206097352-abc123 paused.'],
    reply: 'Paused the 7am meditation reminder (task-cb-1788206097352-abc123).' }));
examples.push(ex('iris', 'Reschedule the reminder task-cb-1788206097352-def456 (the weekday 9 AM stand-up) to 10 AM on weekdays — update its cron to "0 10 * * 1-5".',
  [{ name: 'task', arguments: { action: 'update', task_id: 'task-cb-1788206097352-def456', schedule_type: 'cron', schedule_value: '0 10 * * 1-5' } }],
  { results: ['Task task-cb-1788206097352-def456 updated.'],
    reply: 'Moved the weekday stand-up reminder from 9am to 10am (task-cb-1788206097352-def456).' }));
examples.push(ex('iris', 'Resume the reminder task-cb-1788206097352-abc123 — the 7 AM meditation reminder I paused.',
  [{ name: 'task', arguments: { action: 'resume', task_id: 'task-cb-1788206097352-abc123' } }],
  { results: ['Task task-cb-1788206097352-abc123 resumed.'],
    reply: 'Resumed the 7am meditation reminder (task-cb-1788206097352-abc123).' }));
examples.push(ex('iris', 'Cancel the reminder task-cb-1788206097352-leave01 — the weekday 8:15 AM leave-for-work reminder.',
  [{ name: 'task', arguments: { action: 'cancel', task_id: 'task-cb-1788206097352-leave01' } }],
  { results: ['Task task-cb-1788206097352-leave01 cancelled.'],
    reply: 'Cancelled the weekday 8:15am leave-for-work reminder (task-cb-1788206097352-leave01).' }));
examples.push(ex('iris', 'Change the reminder task-cb-1788206097352-yadl0c (the "Take xyz medication" reminder) from 11:30 AM to 12:30 PM daily — update its cron to "30 12 * * *".',
  [{ name: 'task', arguments: { action: 'update', task_id: 'task-cb-1788206097352-yadl0c', schedule_type: 'cron', schedule_value: '30 12 * * *' } }],
  { results: ['Task task-cb-1788206097352-yadl0c updated.'],
    reply: 'Moved the medication reminder from 11:30am to 12:30pm daily (task-cb-1788206097352-yadl0c).' }));
// List-only requests (orchestrator asks iris to list, then calls her again to act).
examples.push(ex('iris', 'What reminders do I have set right now?',
  [{ name: 'task', arguments: { action: 'list' } }],
  { results: ['3 tasks:\n1. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n2. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active\n3. task-cb-1788206097352-xyz789 | once PT2M | Check the oven | active'],
    reply: 'You have 3 active reminders: take xyz medication daily at 11:30am, meditate daily at 7am, and check the oven in 2 minutes.' }));

// ---- F. Calendar events ------------------------------------------------
examples.push(ex('iris', 'Create a calendar event — a meeting tomorrow at 2:00 PM (America/Vancouver) called "Project Review".',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Project Review', start_time: '2026-09-01T14:00:00' } }],
  { reply: 'Created a "Project Review" calendar event tomorrow at 2pm (2026-09-01T14:00:00).' }));
examples.push(ex('iris', 'Schedule a dentist appointment on March 15 at 10 AM.',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-03-15T10:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event on March 15 at 10am.' }));
examples.push(ex('iris', 'Create an all-day calendar event on Friday called "Company Holiday".',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Company Holiday', start_time: '2026-09-04T00:00:00', all_day: true } }],
  { reply: 'Created an all-day "Company Holiday" calendar event on Friday 2026-09-04.' }));
examples.push(ex('iris', 'Create a 1-hour meeting at 3 PM today called "Team Sync".',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Team Sync', start_time: '2026-08-31T15:00:00', end_time: '2026-08-31T16:00:00' } }],
  { reply: 'Created a "Team Sync" meeting today 3–4pm (2026-08-31T15:00:00–16:00:00).' }));
examples.push(ex('iris', 'Book the conference room for a meeting tomorrow 10 AM to 11:30 AM called "Vendor Demo".',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Vendor Demo', start_time: '2026-09-01T10:00:00', end_time: '2026-09-01T11:30:00', location: 'Conference room' } }],
  { reply: 'Created a "Vendor Demo" in the conference room tomorrow 10–11:30am.' }));
examples.push(ex('iris', 'What is on my calendar this week?',
  [{ name: 'calendar', arguments: { action: 'list', start: '2026-08-31T00:00:00', end: '2026-09-06T23:59:59' } }],
  { results: ['2 events:\n1. 2026-09-01T14:00:00 → 2026-09-01T15:00:00 | Project Review\n2. 2026-09-04T00:00:00 | Company Holiday'],
    reply: 'This week you have: Project Review tomorrow 2–3pm, and an all-day Company Holiday on Friday.' }));
// Calendar manage (id supplied — single call).
examples.push(ex('iris', 'Delete the calendar event ev-1001 — the "Project Review" meeting tomorrow at 2 PM.',
  [{ name: 'calendar', arguments: { action: 'delete', event_id: 'ev-1001' } }],
  { results: ['Calendar event ev-1001 deleted.'],
    reply: 'Cancelled the Project Review meeting (ev-1001).' }));
examples.push(ex('iris', 'Move the calendar event ev-1001 (the 2 PM "Project Review" meeting) to 3 PM — set start_time to 2026-09-01T15:00:00 and end_time to 2026-09-01T16:00:00.',
  [{ name: 'calendar', arguments: { action: 'update', event_id: 'ev-1001', start_time: '2026-09-01T15:00:00', end_time: '2026-09-01T16:00:00' } }],
  { results: ['Calendar event ev-1001 updated.'],
    reply: 'Moved the Project Review from 2pm to 3pm tomorrow (ev-1001).' }));

// ---- G. Both reminder + calendar event in one turn ---------------------
examples.push(ex('iris', 'Set a 2 PM reminder about the meeting and create a calendar event for it at the same time.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'It is time for the meeting.', schedule_type: 'once', schedule_value: '2026-08-31T14:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Meeting', start_time: '2026-08-31T14:00:00' } },
  ],
  { reply: 'Set a 2pm reminder for the meeting and created a calendar event for it (2026-08-31T14:00:00).' }));
examples.push(ex('iris', 'Put a 3 PM "Project Review" meeting on my calendar tomorrow, and remind me 30 minutes before.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Project Review starts in 30 minutes.', schedule_type: 'once', schedule_value: '2026-09-01T14:30:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Project Review', start_time: '2026-09-01T15:00:00' } },
  ],
  { reply: 'Created a "Project Review" tomorrow at 3pm and set a reminder 30 minutes before, at 2:30pm.' }));

// ---- G2. Real production traffic (from logs/warden.log, 2026-08-31) -----
examples.push(ex('iris', 'Set a one-time reminder to fire in 2 minutes, and the message text should be exactly: "test".',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'test', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder with message "test" to fire in 2 minutes (PT2M).' }));
examples.push(ex('iris', 'Set a one-time reminder for 3 minutes from now with the message "test".',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'test', schedule_type: 'once', schedule_value: 'PT3M', context_mode: 'group' } }],
  { reply: 'Set a reminder with message "test" to fire in 3 minutes (PT3M).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 9:15 AM to take your vitamins.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your vitamins.', schedule_type: 'cron', schedule_value: '15 9 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 9:15am vitamins reminder (cron 15 9 * * *).' }));
examples.push(ex('iris', 'Every day at 6:45 PM remind me to close my laptop.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Close your laptop and wrap up for the day.', schedule_type: 'cron', schedule_value: '45 18 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 6:45pm close-laptop reminder (cron 45 18 * * *).' }));
examples.push(ex('iris', 'Set a recurring reminder every Tuesday and Thursday at 7 AM to go for a run.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Go for a run.', schedule_type: 'cron', schedule_value: '0 7 * * 2,4', context_mode: 'group' } }],
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
// Plain to-dos (no time) — the 2026-09-09 collapse dropped work tasks, so a
// to-do has no tool until it gets a time. Iris converts it: ask for a time and
// turn it into a scheduled reminder. NEVER invent content or fire time.
examples.push(exText('iris', 'Add a to-do item to fix the kitchen sink.',
  'I can set a scheduled reminder for it — when should I remind you to fix the kitchen sink? Give me a time (e.g. "tomorrow at 10am" or "in 3 hours").'));
examples.push(exText('iris', 'Add a to-do item: fix the kitchen sink.',
  'I can remind you about that — when should the kitchen-sink reminder fire? Give me a time (e.g. "tomorrow at 10am").'));
examples.push(exText('iris', 'Add a todo to renew the car insurance.',
  'When should I remind you to renew the car insurance? Give me a time (e.g. "tomorrow at 9am" or "in 2 hours").'));
examples.push(exText('iris', "Put 'book the dentist' on my todo list.",
  'I can set a reminder to book the dentist — when? Give me a time (e.g. "tomorrow morning at 9am").'));
examples.push(exText('iris', 'Add "call the ISP" to my to-dos.',
  'When should I remind you to call the ISP? Give me a time (e.g. "today at 4pm" or "in an hour").'));
examples.push(exText('iris', 'Add to-do: pick up dry cleaning.',
  'I can turn that into a scheduled reminder — when should the dry-cleaning reminder fire? Give me a time.'));
examples.push(exText('iris', 'New to-do: replace the furnace filter.',
  'When should I remind you to replace the furnace filter? Give me a time (e.g. "Saturday at 10am").'));
examples.push(exText('iris', 'Set a reminder to call the bank.',
  'When should I remind you to call the bank? Give me a time (e.g. "tomorrow at 10am" or "in 3 hours").'));

// ---- H2. Ask-back reinforcement — MORE phrasings of the same two gaps ----
// The 4-case dryfire regression (2026-09-02: model invented "Check the inbox
// for unread emails." as reminder content, schedule_value P1D for a no-time
// request, a reminder for a plain to-do) was a RATIO problem: ~7 task examples
// per ask-back. These reps keep it ~3:1. Every variant is one of
// the same two gaps: time-without-content or content-without-time. (The third
// gap — plain to-dos — is an ask-back again since the 2026-09-09 collapse
// dropped work tasks: iris converts a to-do into a scheduled reminder by
// asking when it should fire.)
// Time-but-no-content:
examples.push(exText('iris', 'Remind me in 10 minutes.',
  'What should I remind you about in 10 minutes? Give me the content.'));
examples.push(exText('iris', 'Remind me in 5 minutes.',
  'What should the 5-minute reminder say? Give me the content.'));
examples.push(exText('iris', 'Set a one-time reminder in 30 seconds.',
  'What should the reminder be about? Give me the content and I will set it for 30 seconds from now.'));
examples.push(exText('iris', 'Set a reminder for every hour.',
  'What should the hourly reminder say? Give me the content.'));
examples.push(exText('iris', 'Remind me every day at noon.',
  'What should the daily noon reminder say? Give me the content.'));
examples.push(exText('iris', 'Set a recurring reminder daily at 11:30 AM.',
  'What should the daily 11:30am reminder say? Give me the content.'));
examples.push(exText('iris', 'Remind me weekdays at 8am.',
  'What should the weekday 8am reminder say? Give me the content.'));
examples.push(exText('iris', 'Remind me tonight at 9.',
  'What should the 9pm reminder be about? Give me the content.'));
examples.push(exText('iris', 'Remind me every Friday.',
  'What should the Friday reminder say, and what time? Give me the content and a time (e.g. "9am").'));
examples.push(exText('iris', 'Set a reminder in 2 hours.',
  'What should I remind you about in 2 hours? Give me the content.'));
// Content-but-no-time:
examples.push(exText('iris', 'Remind me to take medication.',
  'When should I remind you to take your medication? Give me a time (e.g. "every day at 11:30am" or "in 2 hours").'));
examples.push(exText('iris', 'Set a reminder to buy milk.',
  'When should I remind you to buy milk? Give me a time (e.g. "tomorrow at 8am" or "in 3 hours").'));
examples.push(exText('iris', 'Set a reminder to check the mail.',
  'When should I remind you to check the mail? Give me a time (e.g. "today at 5pm" or "in 1 hour").'));
examples.push(exText('iris', 'Remind me about the dentist appointment.',
  'When should I remind you about the dentist appointment? Give me a date and time.'));
examples.push(exText('iris', 'Remind me to call the plumber.',
  'When should I remind you to call the plumber? Give me a time (e.g. "tomorrow at 9am").'));
examples.push(exText('iris', 'Remind me to renew my passport.',
  'When should I remind you to renew your passport? Give me a date (e.g. "next Monday" or "September 10th").'));
// Exact shapes of the two live 2026-09-08 dryfire failures — the model invented
// content for time-only requests ("Set a reminder in 10 minutes.", "Daily
// reminder"). Same gap, the exact phrasings that failed:
examples.push(exText('iris', 'Set a one-time reminder in 10 minutes.',
  'What should the 10-minute reminder say? Give me the content.'));
examples.push(exText('iris', 'Set a one-time reminder in 20 minutes.',
  'What should the 20-minute reminder say? Give me the content.'));
examples.push(exText('iris', 'Set a recurring reminder every day at 7:30 PM.',
  'What should the daily 7:30pm reminder say? Give me the content.'));
examples.push(exText('iris', 'Set a recurring reminder daily at 9 AM.',
  'What should the daily 9am reminder say? Give me the content.'));

// =========================================================================
// IRIS — reinforcement reps (relative/interval/cron/absolute, more phrasings)
// so the tool-call EMISSION is the overwhelming habit for every schedule form.
// =========================================================================

// ---- W1. Relative duration, more phrasings ----
examples.push(ex('iris', 'Set a one-time reminder to check the laundry in 5 minutes.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the laundry.', schedule_type: 'once', schedule_value: 'PT5M', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the laundry in 5 minutes (PT5M).' }));
examples.push(ex('iris', 'Set a reminder for 10 minutes from now to call the bank.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call the bank.', schedule_type: 'once', schedule_value: 'PT10M', context_mode: 'group' } }],
  { reply: 'Set a reminder to call the bank in 10 minutes (PT10M).' }));
examples.push(ex('iris', 'In 20 minutes remind me to take the pizza out.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take the pizza out of the oven.', schedule_type: 'once', schedule_value: 'PT20M', context_mode: 'group' } }],
  { reply: 'Set a reminder to take the pizza out in 20 minutes (PT20M).' }));
examples.push(ex('iris', 'Set a one-time reminder in 3 minutes about the meeting.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'The meeting starts soon.', schedule_type: 'once', schedule_value: 'PT3M', context_mode: 'group' } }],
  { reply: 'Set a reminder about the meeting in 3 minutes (PT3M).' }));
examples.push(ex('iris', 'Set a one-time reminder to take the trash out in 4 hours.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take the trash out.', schedule_type: 'once', schedule_value: 'PT4H', context_mode: 'group' } }],
  { reply: 'Set a reminder to take the trash out in 4 hours (PT4H).' }));
examples.push(ex('iris', 'In 1 hour remind me to leave for the airport.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Leave for the airport.', schedule_type: 'once', schedule_value: 'PT1H', context_mode: 'group' } }],
  { reply: 'Set a reminder to leave for the airport in 1 hour (PT1H).' }));
examples.push(ex('iris', 'Set a one-time reminder to flip the steak in 12 minutes.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Flip the steak.', schedule_type: 'once', schedule_value: 'PT12M', context_mode: 'group' } }],
  { reply: 'Set a reminder to flip the steak in 12 minutes (PT12M).' }));
examples.push(ex('iris', 'Set a one-time reminder to pick up the kids in 2 hours and 15 minutes.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Pick up the kids.', schedule_type: 'once', schedule_value: 'PT2H15M', context_mode: 'group' } }],
  { reply: 'Set a reminder to pick up the kids in 2 hours 15 minutes (PT2H15M).' }));
examples.push(ex('iris', 'Set a timer for 30 minutes to remind me about the oven.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the oven.', schedule_type: 'once', schedule_value: 'PT30M', context_mode: 'group' } }],
  { reply: 'Set a 30-minute reminder about the oven (PT30M).' }));
examples.push(ex('iris', 'Set a one-time reminder to stir the soup in 6 minutes.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Stir the soup.', schedule_type: 'once', schedule_value: 'PT6M', context_mode: 'group' } }],
  { reply: 'Set a reminder to stir the soup in 6 minutes (PT6M).' }));
examples.push(ex('iris', 'Set a one-time reminder to join the call in 15 minutes.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Join the call.', schedule_type: 'once', schedule_value: 'PT15M', context_mode: 'group' } }],
  { reply: 'Set a reminder to join the call in 15 minutes (PT15M).' }));

// ---- W2. Interval, more phrasings ----
examples.push(ex('iris', 'Set a recurring interval reminder every 10 minutes to check the deploy.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the deploy.', schedule_type: 'interval', schedule_value: '600000', context_mode: 'group' } }],
  { reply: 'Set a deploy-check reminder every 10 minutes (interval 600000ms).' }));
examples.push(ex('iris', 'Every 20 minutes ping me about the queue.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the queue.', schedule_type: 'interval', schedule_value: '1200000', context_mode: 'group' } }],
  { reply: 'Set a queue reminder every 20 minutes (interval 1200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 4 hours to take your antibiotics.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your antibiotics.', schedule_type: 'interval', schedule_value: '14400000', context_mode: 'group' } }],
  { reply: 'Set an antibiotics reminder every 4 hours (interval 14400000ms).' }));
examples.push(ex('iris', 'Every 6 hours remind me to change the laundry over.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Change the laundry over.', schedule_type: 'interval', schedule_value: '21600000', context_mode: 'group' } }],
  { reply: 'Set a laundry reminder every 6 hours (interval 21600000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder every 45 minutes to stretch your back.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '2700000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 45 minutes (interval 2700000ms).' }));

// ---- W3. Cron, more phrasings (the wrong-field / no-tool bug class) ----
examples.push(ex('iris', 'Set a recurring daily reminder at 6 AM to drink water.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Drink some water.', schedule_type: 'cron', schedule_value: '0 6 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 6am water reminder (cron 0 6 * * *).' }));
examples.push(ex('iris', 'Every day at 9 PM remind me to journal.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Journal.', schedule_type: 'cron', schedule_value: '0 21 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 9pm journaling reminder (cron 0 21 * * *).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 8 AM to start work.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Start work.', schedule_type: 'cron', schedule_value: '0 8 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 8am start-work reminder (cron 0 8 * * 1-5).' }));
examples.push(ex('iris', 'Every Tuesday and Thursday at 6 PM remind me about yoga.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Yoga time.', schedule_type: 'cron', schedule_value: '0 18 * * 2,4', context_mode: 'group' } }],
  { reply: 'Set a Tue/Thu 6pm yoga reminder (cron 0 18 * * 2,4).' }));
examples.push(ex('iris', 'Set a recurring weekday reminder at 5 PM to log off.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Log off for the day.', schedule_type: 'cron', schedule_value: '0 17 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 5pm log-off reminder (cron 0 17 * * 1-5).' }));
examples.push(ex('iris', 'Every Sunday at 8 PM remind me to plan the week.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Plan the week ahead.', schedule_type: 'cron', schedule_value: '0 20 * * 0', context_mode: 'group' } }],
  { reply: 'Set a Sunday 8pm weekly-planning reminder (cron 0 20 * * 0).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 7:45 AM to catch the bus.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Catch the bus.', schedule_type: 'cron', schedule_value: '45 7 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 7:45am bus reminder (cron 45 7 * * *).' }));
examples.push(ex('iris', 'Set a recurring daily reminder at 10:15 PM to lock the doors.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Lock the doors.', schedule_type: 'cron', schedule_value: '15 22 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 10:15pm lock-doors reminder (cron 15 22 * * *).' }));

// ---- W4. Absolute timestamp, more phrasings ----
examples.push(ex('iris', 'Set a one-time reminder to go to the gym at 6 AM tomorrow.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Go to the gym.', schedule_type: 'once', schedule_value: '2026-09-01T06:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to go to the gym at 6am tomorrow (2026-09-01T06:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to catch the bus at 7:30 AM on Monday.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Catch the bus.', schedule_type: 'once', schedule_value: '2026-09-01T07:30:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to catch the bus at 7:30am Monday (2026-09-01T07:30:00).' }));
examples.push(ex('iris', 'At 10 PM tonight remind me to brush my teeth.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Brush your teeth.', schedule_type: 'once', schedule_value: '2026-08-31T22:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to brush your teeth at 10pm tonight (2026-08-31T22:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to submit the report at 4 PM today.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the report.', schedule_type: 'once', schedule_value: '2026-08-31T16:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the report at 4pm today (2026-08-31T16:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to close the laptop at 9 PM tonight.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Close the laptop and wind down.', schedule_type: 'once', schedule_value: '2026-08-31T21:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to close the laptop at 9pm tonight (2026-08-31T21:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to wake up at 6:30 AM tomorrow.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Wake up.', schedule_type: 'once', schedule_value: '2026-09-01T06:30:00', context_mode: 'group' } }],
  { reply: 'Set a wake-up reminder for 6:30am tomorrow (2026-09-01T06:30:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to submit the timesheet at 11 AM on Friday.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the timesheet.', schedule_type: 'once', schedule_value: '2026-09-04T11:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the timesheet at 11am Friday (2026-09-04T11:00:00).' }));

// ---- W5. Both reminder + calendar in one turn, more reps ----
examples.push(ex('iris', 'Put a 4 PM dentist appointment on my calendar tomorrow and remind me an hour before.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Dentist appointment soon.', schedule_type: 'once', schedule_value: '2026-09-01T15:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-09-01T16:00:00' } },
  ],
  { reply: 'Created a 4pm dentist appointment tomorrow and set a reminder an hour before, at 3pm.' }));
examples.push(ex('iris', 'Schedule a 1 PM lunch meeting on Friday and remind me 15 minutes before.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Lunch meeting starts in 15 minutes.', schedule_type: 'once', schedule_value: '2026-09-04T12:45:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Lunch meeting', start_time: '2026-09-04T13:00:00' } },
  ],
  { reply: 'Created a 1pm Friday lunch meeting and set a reminder 15 minutes before, at 12:45pm.' }));
// Reinforcement for the "reminder … and create a calendar event called X"
// phrasing — the 2026-09-02 checkpoint emitted an EMPTY turn (no calls, no
// text) on this exact shape, deterministically. Same-time (not offset) pairs:
examples.push(ex('iris', 'Set a one-time reminder about the team meeting at 2:00 PM today, and create a calendar event called "Team meeting" at 2:00 PM today.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Team meeting.', schedule_type: 'once', schedule_value: '2026-08-31T14:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Team meeting', start_time: '2026-08-31T14:00:00' } },
  ],
  { reply: 'Set a 2pm reminder for the team meeting and created a "Team meeting" calendar event (2026-08-31T14:00:00).' }));
examples.push(ex('iris', 'Remind me at 5 PM today about the server restart, and create a calendar event called "Server restart" at 5 PM today.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Server restart.', schedule_type: 'once', schedule_value: '2026-08-31T17:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Server restart', start_time: '2026-08-31T17:00:00' } },
  ],
  { reply: 'Set a 5pm reminder for the server restart and created a "Server restart" calendar event (2026-08-31T17:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder about the phone call at 4:30 PM tomorrow, and create a calendar event called "Phone call" at 4:30 PM tomorrow.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Phone call.', schedule_type: 'once', schedule_value: '2026-09-01T16:30:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Phone call', start_time: '2026-09-01T16:30:00' } },
  ],
  { reply: 'Set a 4:30pm reminder for the phone call and created a "Phone call" calendar event tomorrow (2026-09-01T16:30:00).' }));

// ---- W12. Calendar manage (id supplied — single call) -------------------
examples.push(ex('iris', 'Cancel the dentist appointment — delete calendar event ev-1003 (the Sep 3 10 AM dentist appointment).',
  [{ name: 'calendar', arguments: { action: 'delete', event_id: 'ev-1003' } }],
  { results: ['Calendar event ev-1003 deleted.'],
    reply: 'Cancelled the dentist appointment (ev-1003).' }));
examples.push(ex('iris', 'Reschedule the "Team Sync" — update event ev-1004 to start at 4 PM (2026-08-31T16:00:00) and end at 5 PM (2026-08-31T17:00:00).',
  [{ name: 'calendar', arguments: { action: 'update', event_id: 'ev-1004', start_time: '2026-08-31T16:00:00', end_time: '2026-08-31T17:00:00' } }],
  { results: ['Calendar event ev-1004 updated.'],
    reply: 'Moved the Team Sync from 3pm to 4pm today (ev-1004).' }));
examples.push(ex('iris', 'Cancel my meeting tomorrow — delete calendar event ev-1005 (the 9 AM standup on Sep 2).',
  [{ name: 'calendar', arguments: { action: 'delete', event_id: 'ev-1005' } }],
  { results: ['Calendar event ev-1005 deleted.'],
    reply: 'Cancelled tomorrow\'s 9am Standup (ev-1005).' }));
examples.push(ex('iris', 'Move the "Vendor Demo" — update event ev-1006 to 2 PM tomorrow (start 2026-09-01T14:00:00, end 2026-09-01T15:30:00).',
  [{ name: 'calendar', arguments: { action: 'update', event_id: 'ev-1006', start_time: '2026-09-01T14:00:00', end_time: '2026-09-01T15:30:00' } }],
  { results: ['Calendar event ev-1006 updated.'],
    reply: 'Moved the Vendor Demo to 2pm tomorrow (ev-1006).' }));
examples.push(ex('iris', 'Delete the "Company Holiday" event — calendar event ev-1002.',
  [{ name: 'calendar', arguments: { action: 'delete', event_id: 'ev-1002' } }],
  { results: ['Calendar event ev-1002 deleted.'],
    reply: 'Deleted the Company Holiday event (ev-1002).' }));

// =========================================================================
// IRIS — alarms (the alarm tool). Clock alerts with a label: HH:MM time,
// repeat patterns, id-supplied manage. Alarms were NEVER in the old flat
// dataset; the 2026-09-09 collapse makes them a core iris surface.
// =========================================================================

// ---- AL1. create — daily / weekdays / one-off / custom --------------------
examples.push(ex('iris', 'Set an alarm for 6:30 AM every day called "Wake up".',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Wake up', alarm_time: '06:30', repeat_type: 'daily' } }],
  { results: ['Alarm created: "Wake up" at 06:30 (repeats daily).'],
    reply: 'Set a daily 6:30am "Wake up" alarm.' }));
examples.push(ex('iris', 'Set a weekday alarm for 7:00 AM labeled "Work" — Mondays through Fridays.',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Work', alarm_time: '07:00', repeat_type: 'weekdays' } }],
  { results: ['Alarm created: "Work" at 07:00 (repeats weekdays).'],
    reply: 'Set a 7:00am "Work" alarm for weekdays.' }));
examples.push(ex('iris', 'Set an alarm for 9:00 PM tonight called "Wind down".',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Wind down', alarm_time: '21:00', repeat_type: 'none' } }],
  { results: ['Alarm created: "Wind down" at 21:00.'],
    reply: 'Set a one-time 9:00pm "Wind down" alarm for tonight.' }));
examples.push(ex('iris', 'Set an alarm for 8:00 AM tomorrow called "Airport run" — tomorrow only, not repeating.',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Airport run', alarm_time: '08:00', alarm_date: '2026-09-01', repeat_type: 'none' } }],
  { results: ['Alarm created: "Airport run" at 08:00 on 2026-09-01.'],
    reply: 'Set an 8:00am "Airport run" alarm for tomorrow (Sep 1) only.' }));
examples.push(ex('iris', 'Set an alarm for 6:45 AM on Monday, Wednesday and Friday called "Gym".',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Gym', alarm_time: '06:45', repeat_type: 'custom', repeat_days: 'mon,wed,fri' } }],
  { results: ['Alarm created: "Gym" at 06:45 (repeats custom).'],
    reply: 'Set a 6:45am "Gym" alarm for Mon/Wed/Fri.' }));
examples.push(ex('iris', 'Wake me up at 7:15 tomorrow morning — call it "Late start".',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Late start', alarm_time: '07:15', alarm_date: '2026-09-01', repeat_type: 'none' } }],
  { results: ['Alarm created: "Late start" at 07:15 on 2026-09-01.'],
    reply: 'Set a 7:15am "Late start" alarm for tomorrow.' }));

// ---- AL2. list + id-supplied manage --------------------------------------
examples.push(ex('iris', 'What alarms do I have set?',
  [{ name: 'alarm', arguments: { action: 'list' } }],
  { results: ['Alarms:\n- [alm-1] "Wake up" at 06:30 repeat=daily\n- [alm-2] "Work" at 07:00 repeat=weekdays\n- [alm-3] "Wind down" at 21:00 repeat=none'],
    reply: 'You have 3 alarms: "Wake up" daily 6:30am, "Work" weekdays 7:00am, and "Wind down" 9:00pm.' }));
examples.push(ex('iris', 'Delete the alarm alm-3 — the "Wind down" one.',
  [{ name: 'alarm', arguments: { action: 'delete', alarm_id: 'alm-3' } }],
  { results: ['Alarm deleted.'],
    reply: 'Deleted the "Wind down" alarm (alm-3).' }));
examples.push(ex('iris', 'Turn off the alarm alm-4 — the 5 AM "Early run" one — but keep it for later.',
  [{ name: 'alarm', arguments: { action: 'update', alarm_id: 'alm-4', enabled: false } }],
  { results: ['Alarm updated.'],
    reply: 'Disabled the "Early run" alarm (alm-4) — it is kept but will not ring.' }));
examples.push(ex('iris', 'Change the "Wake up" alarm (alm-1) to 7:00 AM.',
  [{ name: 'alarm', arguments: { action: 'update', alarm_id: 'alm-1', alarm_time: '07:00' } }],
  { results: ['Alarm updated.'],
    reply: 'Moved the "Wake up" alarm (alm-1) to 7:00am.' }));
examples.push(ex('iris', 'Rename the alarm alm-2 to "Get to work" and make it ring only on weekdays.',
  [{ name: 'alarm', arguments: { action: 'update', alarm_id: 'alm-2', label: 'Get to work', repeat_type: 'weekdays' } }],
  { results: ['Alarm updated.'],
    reply: 'Renamed alm-2 to "Get to work" (still weekdays).' }));

// ---- S. Email: read / search / get ---------------------------------------
examples.push(ex('iris', "What's in my inbox?",
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['5 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"\n5. 2026-08-30T11:00 boss@acme.io | "Monday standup moved to 11"'],
    reply: '5 emails in your inbox. Actionable: Sarah (Q4 budget sign-off by Friday), Jason (sign NDA), boss (standup moved to 11). The rest are a newsletter and a Stripe receipt.' }));
examples.push(ex('iris', "Find emails from Sarah about the Q4 budget.",
  [{ name: 'email', arguments: { action: 'read', search: 'from:sarah Q4 budget', limit: 20 } }],
  { results: ['2 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-28T10:05 sarah@acme.io | "Q4 budget draft v2"'],
    reply: 'Found 2 emails from Sarah about the Q4 budget: "Re: Q4 budget approval needed" (Aug 31) and "Q4 budget draft v2" (Aug 28).' }));
examples.push(ex('iris', "Show me emails from the last 24 hours.",
  [{ name: 'email', arguments: { action: 'read', since: '2026-08-30T14:05:00', limit: 50 } }],
  { results: ['3 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"'],
    reply: '3 emails in the last 24h: Sarah (budget sign-off), HN Weekly (newsletter), Stripe (paid receipt).' }));
examples.push(ex('iris', "Open the email from Jason about the NDA.",
  [{ name: 'email', arguments: { action: 'read', search: 'from:jason NDA', limit: 10 } }],
  { results: ['1 email:\n1. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA" (id email-4f2a)'],
    reply: 'Found Jason\'s NDA email (email-4f2a, Aug 30). Want me to fetch the full body?' }));
examples.push(ex('iris', "Get me the FULL body of email email-4f2a (Jason's NDA email).",
  [{ name: 'email', arguments: { action: 'get', email_id: 'email-4f2a' } }],
  { results: ['From: jason@partnerco.com\nSubject: Action required: sign the NDA\nDate: 2026-08-30T14:20\n\nHi Dominic,\n\nPlease review and sign the attached NDA so we can move forward with the partnership. Let me know if you have questions.\n\n— Jason'],
    reply: 'Jason asks you to review and sign the attached NDA to move the partnership forward. Full body fetched.' }));
examples.push(ex('iris', "Refresh my email cache.",
  [{ name: 'email', arguments: { action: 'refresh' } }],
  { results: ['Email cache refreshed.'],
    reply: 'Refreshed the email cache.' }));
examples.push(ex('iris', "What cached emails do you have?",
  [{ name: 'email', arguments: { action: 'cached' } }],
  { results: ['3 cached emails:\n1. email-4f2a | jason@partnerco.com | "Action required: sign the NDA"\n2. email-9b1c | sarah@acme.io | "Re: Q4 budget approval needed"\n3. email-7d3e | boss@acme.io | "Monday standup moved to 11"'],
    reply: '3 cached emails: the NDA from Jason, Sarah\'s budget reply, and the standup-time change from your boss.' }));

// ---- T. Email: send -----------------------------------------------------
examples.push(ex('iris', "Reply to Sarah and tell her I'll sign off the Q4 budget by Friday.",
  [{ name: 'email', arguments: { action: 'send', to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: 'Hi Sarah,\n\nI\'ll sign off on the Q4 budget by Friday. Thanks for the heads-up.\n\n— Dominic' } }],
  { results: ['Email sent to sarah@acme.io ("Re: Q4 budget approval needed").'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — I\'ll sign off the Q4 budget by Friday.' }));
examples.push(ex('iris', "Email Jason the signed NDA is attached.",
  [{ name: 'email', arguments: { action: 'send', to: 'jason@partnerco.com', subject: 'Re: Action required: sign the NDA', body: 'Hi Jason,\n\nSigned NDA attached. Ready to move forward.\n\n— Dominic' } }],
  { results: ['Email sent to jason@partnerco.com ("Re: Action required: sign the NDA").'],
    reply: 'Sent the email to Jason (jason@partnerco.com) — signed NDA attached.' }));
examples.push(ex('iris', "Send a note to the team: standup is back to 10am Monday.",
  [{ name: 'email', arguments: { action: 'send', to: 'team@acme.io', subject: 'Standup back to 10am Monday', body: 'Heads-up: standup is back to 10am Monday.\n\n— Dominic' } }],
  { results: ['Email sent to team@acme.io ("Standup back to 10am Monday").'],
    reply: 'Sent the standup update to the team (team@acme.io).' }));

// ---- V. Iris no-op / edge cases ----------------------------------------
examples.push(exText('iris', 'Summarize the email from my lawyer about the contract.',
  'I could not find an email from your lawyer about a contract. Want me to retry with a shorter sender name or a different keyword (e.g. "contract" alone)?'));
examples.push(exText('iris', 'Send an email to mom saying happy birthday.',
  'No email account is configured. Add one in the Keys tab of your dashboard and I will send it.'));
examples.push(exText('iris', 'What is the weather?',
  'I do not have a weather tool. Weather appears in your digest INPUT when it is compiled; I cannot fetch it on demand.'));

// ---- W8. Iris: inbox queries ALWAYS call email(action="read") ----
examples.push(ex('iris', 'List my recent emails from the inbox.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['5 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"\n5. 2026-08-30T11:00 boss@acme.io | "Standup moved to 11"'],
    reply: '5 recent emails. Actionable: Sarah (budget sign-off by Friday), Jason (sign NDA), boss (standup moved to 11). The rest are a newsletter and a Stripe receipt.' }));
examples.push(ex('iris', 'Check the inbox and list my recent emails.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['4 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"'],
    reply: '4 emails in your inbox. Actionable: Sarah (budget sign-off) and Jason (sign NDA).' }));
examples.push(ex('iris', 'Check the inbox for any new email received today.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-08-31T00:00:00', limit: 50 } }],
  { results: ['2 emails today:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"'],
    reply: '2 emails today: Sarah (budget sign-off needed) and an HN newsletter.' }));
examples.push(ex('iris', 'Read the inbox and list the emails.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['3 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n3. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"'],
    reply: '3 emails: Sarah (budget sign-off), Stripe (receipt), Jason (sign NDA).' }));
examples.push(ex('iris', 'Check the inbox for any email received in the last hour.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-08-31T13:05:00', limit: 20 } }],
  { results: ['1 email:\n1. 2026-08-31T13:42 ci-bot@warden | "Build #1284 failed"'],
    reply: '1 email in the last hour: CI bot — Build #1284 failed. Want me to dig in?' }));

// ---- W9. Iris: email(action="send") with explicit, clean args (kill schema-as-args) ----
examples.push(ex('iris', 'Send an email to jason@partnerco.com with subject "NDA signed" and body "All done, signed and attached."',
  [{ name: 'email', arguments: { action: 'send', to: 'jason@partnerco.com', subject: 'NDA signed', body: 'All done, signed and attached.' } }],
  { results: ['Email sent to jason@partnerco.com ("NDA signed").'],
    reply: 'Sent the email to jason@partnerco.com ("NDA signed").' }));
examples.push(ex('iris', 'Email sarah@acme.io saying the budget is approved.',
  [{ name: 'email', arguments: { action: 'send', to: 'sarah@acme.io', subject: 'Q4 budget approved', body: 'Hi Sarah,\n\nThe Q4 budget is approved.\n\n— Dominic' } }],
  { results: ['Email sent to sarah@acme.io ("Q4 budget approved").'],
    reply: 'Sent the email to sarah@acme.io — Q4 budget is approved.' }));
examples.push(ex('iris', 'Compose an email to team@acme.io about the standup change to 11am.',
  [{ name: 'email', arguments: { action: 'send', to: 'team@acme.io', subject: 'Standup moved to 11am', body: 'Heads-up: standup is now at 11am.\n\n— Dominic' } }],
  { results: ['Email sent to team@acme.io ("Standup moved to 11am").'],
    reply: 'Sent the standup change to the team (team@acme.io).' }));
examples.push(ex('iris', 'Reply to boss@acme.io confirming the 11am standup works for me.',
  [{ name: 'email', arguments: { action: 'send', to: 'boss@acme.io', subject: 'Re: Standup moved to 11', body: '11am works for me. Thanks.\n\n— Dominic' } }],
  { results: ['Email sent to boss@acme.io ("Re: Standup moved to 11").'],
    reply: 'Sent the confirmation to boss@acme.io — 11am works.' }));

// ---- W10 REMOVED: the read_emails → post_summary digest chain it taught
// never existed in production — digests are direct `iris-digest-<span>`
// background spawns where the model emits JSON as final text and the RUNNER
// publishes it. The real digest examples live in section D above. ----------

// =========================================================================
// REALITY GROUNDING — examples for the 3 live dryfire failures, phrased as
// ORCHESTRATOR BRIEFS (what iris actually receives at dispatch), NOT as
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
//   3. "reply to Sarah …" → model emitted the email send with body but no `to`.
//      Reply-to MUST populate `to` (resolved from the named sender / thread).
// =========================================================================

// ---- RG1. Relative day, NO clock time → ISO-8601 duration (failure #1) ----
examples.push(ex('iris', 'Set a one-time reminder to pay rent tomorrow — no specific clock time, just a one-day delay from now.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Pay rent.', schedule_type: 'once', schedule_value: 'P1D', context_mode: 'group' } }],
  { reply: 'Set a reminder to pay rent tomorrow (P1D).' }));
examples.push(ex('iris', 'Set a one-time reminder to renew your passport the day after tomorrow — a two-day delay, no clock time.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Renew your passport.', schedule_type: 'once', schedule_value: 'P2D', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your passport the day after tomorrow (P2D).' }));
examples.push(ex('iris', 'Set a one-time reminder to follow up with the bank in 3 days — a relative delay, no clock time.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Follow up with the bank.', schedule_type: 'once', schedule_value: 'P3D', context_mode: 'group' } }],
  { reply: 'Set a reminder to follow up with the bank in 3 days (P3D).' }));
examples.push(ex('iris', 'Set a one-time reminder to review the contract in a week — a one-week delay from now, no clock time.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Review the contract.', schedule_type: 'once', schedule_value: 'P7D', context_mode: 'group' } }],
  { reply: 'Set a reminder to review the contract in a week (P7D).' }));
examples.push(ex('iris', 'Set a one-time reminder for tomorrow to pay rent.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Pay rent.', schedule_type: 'once', schedule_value: 'P1D', context_mode: 'group' } }],
  { reply: 'Set a reminder to pay rent tomorrow (P1D).' }));
// Contrast: a clock time on that day IS an absolute timestamp, not a duration.
examples.push(ex('iris', 'Set a one-time reminder to call mom tomorrow at 9:00 AM — fire at that specific clock time.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call mom.', schedule_type: 'once', schedule_value: '2026-09-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call mom tomorrow at 9am (2026-09-01T09:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to prep the standup tomorrow morning (around 9:00 AM).',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Prep the standup.', schedule_type: 'once', schedule_value: '2026-09-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to prep the standup tomorrow morning (2026-09-01T09:00:00).' }));

// ---- RG2. Interval ms arithmetic (failure #2) — value restated in reply ----
examples.push(ex('iris', "Set a recurring interval reminder named 'Hydration Check' that fires every 2 hours — remind me to drink water. Express the interval in milliseconds.",
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Hydration Check', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a "Hydration Check" reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to stretch every 2 hours — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to stretch my back — it should fire every 2 hours.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to take antibiotics every 8 hours — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your antibiotics.', schedule_type: 'interval', schedule_value: '28800000', context_mode: 'group' } }],
  { reply: 'Set an antibiotics reminder every 8 hours (interval 28800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to check the servers every 3 hours — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the servers.', schedule_type: 'interval', schedule_value: '10800000', context_mode: 'group' } }],
  { reply: 'Set a server-check reminder every 3 hours (interval 10800000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to rotate the logs every 4 hours — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Rotate the logs.', schedule_type: 'interval', schedule_value: '14400000', context_mode: 'group' } }],
  { reply: 'Set a log-rotation reminder every 4 hours (interval 14400000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to take eyedrops every 12 hours — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your eyedrops.', schedule_type: 'interval', schedule_value: '43200000', context_mode: 'group' } }],
  { reply: 'Set an eyedrops reminder every 12 hours (interval 43200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to back up the database every 24 hours — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Back up the database.', schedule_type: 'interval', schedule_value: '86400000', context_mode: 'group' } }],
  { reply: 'Set a DB-backup reminder every 24 hours (interval 86400000ms).' }));
// Minutes vs hours contrast trio — kills the 1200000 (=20min) confusion.
examples.push(ex('iris', 'Set a recurring interval reminder to check the queue every 2 minutes — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the queue.', schedule_type: 'interval', schedule_value: '120000', context_mode: 'group' } }],
  { reply: 'Set a queue-check reminder every 2 minutes (interval 120000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to check the deploy every 20 minutes — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the deploy.', schedule_type: 'interval', schedule_value: '1200000', context_mode: 'group' } }],
  { reply: 'Set a deploy-check reminder every 20 minutes (interval 1200000ms).' }));
examples.push(ex('iris', 'Set a recurring interval reminder to check the build status every 2 hours — interval in milliseconds.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the build status.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a build-status reminder every 2 hours (interval 7200000ms).' }));

// ---- RG3. email(action="send") reply-to — resolve `to`, put it first (failure #3) ----
examples.push(ex('iris', "Reply to Sarah and tell her I'll sign off the Q4 budget by Friday — send the reply.",
  [{ name: 'email', arguments: { action: 'send', to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: "Hi Sarah,\n\nI'll sign off on the Q4 budget by Friday. Thanks for the heads-up.\n\n— Dominic" } }],
  { results: ['Email sent to sarah@acme.io ("Re: Q4 budget approval needed").'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — I will sign off the Q4 budget by Friday.' }));
examples.push(ex('iris', "Reply to Jason and tell him the NDA is signed — send the reply.",
  [{ name: 'email', arguments: { action: 'send', to: 'jason@partnerco.com', subject: 'Re: Action required: sign the NDA', body: 'Hi Jason,\n\nSigned the NDA — ready to move forward.\n\n— Dominic' } }],
  { results: ['Email sent to jason@partnerco.com ("Re: Action required: sign the NDA").'],
    reply: 'Sent the reply to Jason (jason@partnerco.com) — NDA signed.' }));
examples.push(ex('iris', "Reply to Sarah's 'Q4 budget approval needed' email and tell her I'll sign off the Q4 budget by Friday.",
  [{ name: 'email', arguments: { action: 'send', to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: "Hi Sarah,\n\nI'll sign off on the Q4 budget by Friday.\n\n— Dominic" } }],
  { results: ['Email sent to sarah@acme.io ("Re: Q4 budget approval needed").'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — Q4 budget sign-off by Friday.' }));
examples.push(ex('iris', "Send an email to alex@example.com asking for a meeting next Thursday — then confirm it's sent.",
  [{ name: 'email', arguments: { action: 'send', to: 'alex@example.com', subject: 'Meeting next Thursday?', body: 'Hi Alex,\n\nAre you free for a meeting next Thursday? Let me know what time works.\n\n— Dominic' } }],
  { results: ['Email sent to alex@example.com ("Meeting next Thursday?").'],
    reply: 'Sent the email to alex@example.com asking for a meeting next Thursday.' }));
examples.push(ex('iris', "Email my boss at boss@acme.io to confirm the standup moved to 11am — reply to the standup thread.",
  [{ name: 'email', arguments: { action: 'send', to: 'boss@acme.io', subject: 'Re: Standup moved to 11', body: '11am works for me — confirmed. Thanks.\n\n— Dominic' } }],
  { results: ['Email sent to boss@acme.io ("Re: Standup moved to 11").'],
    reply: 'Sent the confirmation to your boss (boss@acme.io) — 11am standup confirmed.' }));

// ---- RG4. Calendar briefs (orch style: "Create a calendar event …") -----
examples.push(ex('iris', "Create a calendar event tomorrow at 2:00 PM called 'Dentist appointment'.",
  [{ name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-09-01T14:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event tomorrow at 2pm (2026-09-01T14:00:00).' }));
examples.push(ex('iris', 'Create a calendar event for next Tuesday at 3:00 PM — a dentist appointment.',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-09-01T15:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event next Tuesday at 3pm (2026-09-01T15:00:00).' }));
examples.push(ex('iris', "Create a calendar event this Friday at 6:00 PM called 'Poker night'.",
  [{ name: 'calendar', arguments: { action: 'create', title: 'Poker night', start_time: '2026-09-04T18:00:00' } }],
  { reply: 'Created a "Poker night" calendar event Friday at 6pm (2026-09-04T18:00:00).' }));
examples.push(ex('iris', "Set up a recurring reminder every Monday at 9:00 AM called 'Project Sync'.",
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Project Sync', schedule_type: 'cron', schedule_value: '0 9 * * 1', context_mode: 'group' } }],
  { reply: 'Set a recurring "Project Sync" reminder every Monday at 9am (cron 0 9 * * 1).' }));

// ---- RG5. Reminder briefs + the 45-min vs 45-sec disambiguation ----------
examples.push(ex('iris', 'Set a one-time reminder to check the oven in 45 minutes — fire 45 minutes from now.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Check the oven.', schedule_type: 'once', schedule_value: 'PT45M', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the oven in 45 minutes (PT45M).' }));
examples.push(ex('iris', 'Set a one-time reminder to flip the laundry in 2 minutes.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Flip the laundry.', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder to flip the laundry in 2 minutes (PT2M).' }));
examples.push(ex('iris', 'Set a one-time reminder to call Sam today at 6:00 PM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call Sam.', schedule_type: 'once', schedule_value: '2026-08-31T18:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call Sam at 6pm today (2026-08-31T18:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to fire 10 minutes from now with the message "E2E_PING_TEST" — report the task id when created.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'E2E_PING_TEST', schedule_type: 'once', schedule_value: 'PT10M', context_mode: 'group' } }],
  { reply: 'Set a one-time reminder in 10 minutes (PT10M) with message "E2E_PING_TEST".' }));
examples.push(ex('iris', 'List all of my scheduled tasks.',
  [{ name: 'task', arguments: { action: 'list' } }],
  { results: ['3 tasks:\n1. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n2. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active\n3. task-cb-1788206097352-log01 | interval 7200000 | Hydration Check | active'],
    reply: 'You have 3 scheduled tasks: take xyz medication daily 11:30am, meditate daily 7am, and the Hydration Check every 2 hours.' }));
examples.push(ex('iris', 'Cancel the scheduled reminder task-cb-1788206097352-log01 — that is the "Hydration Check" one.',
  [{ name: 'task', arguments: { action: 'cancel', task_id: 'task-cb-1788206097352-log01' } }],
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
  [{ name: 'email', arguments: { action: 'read', search: 'from:support', since: '2026-08-24T14:05:00', limit: 50 } }],
  { results: ['2 emails from support in the last 7 days:\n1. 2026-08-29T10:11 support@saas.io | "Ticket #4421 resolved"\n2. 2026-08-26T15:40 support@saas.io | "Maintenance window Sunday"'],
    reply: '2 emails from support in the last 7 days: ticket #4421 resolved (Aug 29) and a Sunday maintenance window (Aug 26).' }));
examples.push(ex('iris', 'Search the emails for one containing the word "invoice" and report the total amount mentioned in it.',
  [{ name: 'email', arguments: { action: 'read', search: 'invoice', limit: 20 } }],
  { results: ['1 email:\n1. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid" — total $199.00'],
    reply: 'Found 1 invoice email: Stripe "Invoice #4421 paid" (Aug 30), total $199.00.' }));
examples.push(ex('iris', 'List my unread emails grouped by sender.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['4 unread:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid"\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"'],
    reply: '4 unread, by sender: Sarah (budget sign-off), Jason (sign NDA), Stripe (receipt), Hacker News (newsletter).' }));
examples.push(ex('iris', 'Check for any new email received in the past hour.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-08-31T13:05:00', limit: 20 } }],
  { results: ['1 email:\n1. 2026-08-31T13:42 ci-bot@warden | "Build #1284 failed"'],
    reply: '1 new email in the past hour: CI bot — Build #1284 failed.' }));
examples.push(ex('iris', 'Check for any emails received today that I should not have missed.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-08-31T00:00:00', limit: 50 } }],
  { results: ['2 emails today:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed"\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly"'],
    reply: '2 emails today: Sarah (Q4 budget sign-off by Friday — worth acting on) and an HN newsletter (no action).' }));
examples.push(ex('iris', 'Check whether I have any important emails in the inbox.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['3 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed" — needs sign-off by Friday\n2. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA"\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid" (receipt)'],
    reply: '2 look important: Sarah needs the Q4 budget signed off by Friday, and Jason needs the NDA signed. The Stripe email is just a paid receipt.' }));
examples.push(ex('iris', 'Find the email for order #48215 and pull the tracking info out of it.',
  [{ name: 'email', arguments: { action: 'read', search: '48215', limit: 10 } }],
  { results: ['1 email:\n1. 2026-08-30T11:00 orders@shop.io | "Order #48215 shipped" — tracking 1Z999AA10123456784'],
    reply: 'Found order #48215 (orders@shop.io, Aug 30): tracking number 1Z999AA10123456784. Want me to fetch the full body?' }));


if (import.meta.url === `file://${process.argv[1]}`) {
  const all = [...examples];
  const lines = all.map(e => JSON.stringify(e));
  writeFileSync(new URL('./toolcall-sft.jsonl', import.meta.url), lines.join('\n') + '\n');
  console.log(`Wrote ${all.length} examples to toolcall-sft.jsonl`);

  // Per-agent + per-target counts.
  const byAgent = {}, byTarget = {};
  for (const e of all) {
    const sys = e.messages[0].content;
    const agent = sys.startsWith('You are Iris') ? 'iris'
      : sys.startsWith('Scan the INPUT block') ? 'digest'
      : '?';
    byAgent[agent] = (byAgent[agent] || 0) + 1;
    const a = e.messages.find(m => m.role === 'assistant');
    const key = a?.tool_calls ? a.tool_calls.map(t => t.function.name).join('+') : 'text-only';
    byTarget[key] = (byTarget[key] || 0) + 1;
  }
  console.log('By agent:', byAgent);
  console.log('By target:', byTarget);
}

export { examples };