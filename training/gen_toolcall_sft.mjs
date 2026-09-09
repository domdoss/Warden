// Full toolcall-model SFT dataset generator.
//
// Produces JSONL for the single LoRA fine-tune that powers IRIS — the one
// toolcall agent since 2026-09-05, when byte was merged in (one toolcall agent,
// one fine-tuned model). Iris covers email, digests, scheduled tasks, calendar,
// AND work management (projects, work tasks, deliverables, blockers,
// priorities, financials, time tracking). Each row is OpenAI-style messages +
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
// Digest examples (section D) train the REAL digest run-mode — the agent-runner
// `iris-digest-<span>` branch: the digest system prompt, read_emails as the only
// tool, and the JSON digest object as FINAL TEXT (the runner publishes it;
// the model never calls post_summary). Everything below for the digest comes
// from digest_reality.mjs, which reads the live prompts straight out of the
// Warden sources.
//
// Coverage is weighted to the hard calls the 3B Granite fumbles:
//   scheduling: schedule_value forms (PT2M vs timestamp vs cron vs ms), field
//           placement, ask-back when no payload, id-supplied manage flows,
//           email read/send/search, list_api_keys → api_request.
//   digest: verbatim since/before copy from the INPUT window line, grounded
//           JSON (empty states, no invented facts), actionable extraction.
//   work mgmt: create_work_task project_id="personal" default + priority enum,
//           update_project status enum, add_blocker/add_priority enums,
//           log_time/update_financials numeric fields, id-supplied manage.
//
// Every request carries the ANCHOR time header (the dispatch path prepends it
// to ALL iris tasks, work management included). Request strings are written in
// the real orchestrator-brief style (verbose, parenthetical timezone, ALLCAPS
// emphasis, explicit ids, em-dashes) so train≈infer — the model must extract
// clean tool args from emphatic prose.

import { readFileSync, writeFileSync } from 'node:fs';
import { DIGEST_SYSTEM, DIGEST_PROMPTS, DIGEST_TOOLS, buildDigestInput } from './digest_reality.mjs';
export { DIGEST_SYSTEM, DIGEST_PROMPTS, DIGEST_TOOLS };
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
// Plain to-do → iris creates the work task herself now (the byte hand-off is
// gone — she owns work management). One create_work_task call.
examples.push(ex('iris', 'Add a to-do item to fix the kitchen sink.',
  [{ name: 'create_work_task', arguments: { title: 'Fix the kitchen sink', project_id: 'personal' } }],
  { results: ['Created work task "Fix the kitchen sink" (id wt-2100) in project personal.'],
    reply: 'Created work task "Fix the kitchen sink" (wt-2100) in Personal.' }));
examples.push(exText('iris', 'Set a reminder to call the bank.',
  'When should I remind you to call the bank? Give me a time (e.g. "tomorrow at 10am" or "in 3 hours").'));

// ---- H2. Ask-back reinforcement — MORE phrasings of the same two gaps ----
// The 4-case dryfire regression (2026-09-02: model invented "Check the inbox
// for unread emails." as reminder content, schedule_value P1D for a no-time
// request, a reminder for a plain to-do) was a RATIO problem: ~7 schedule_task
// examples per ask-back. These reps keep it ~3:1. Every variant is one of
// the same two gaps: time-without-content or content-without-time. (The third
// gap — plain to-dos — is now a create_work_task call, not an ask-back: iris
// owns work management since the byte merge.)
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
// Plain to-dos, more phrasings → create_work_task (one call, project_id
// "personal" — the permanent Personal project, per the prompt default):
examples.push(ex('iris', 'Add a to-do item: fix the kitchen sink.',
  [{ name: 'create_work_task', arguments: { title: 'Fix the kitchen sink', project_id: 'personal' } }],
  { results: ['Created work task "Fix the kitchen sink" (id wt-2101) in project personal.'],
    reply: 'Created work task "Fix the kitchen sink" (wt-2101) in Personal.' }));
examples.push(ex('iris', 'Add a todo to renew the car insurance.',
  [{ name: 'create_work_task', arguments: { title: 'Renew the car insurance', project_id: 'personal' } }],
  { results: ['Created work task "Renew the car insurance" (id wt-2102) in project personal.'],
    reply: 'Created work task "Renew the car insurance" (wt-2102) in Personal.' }));
examples.push(ex('iris', "Put 'book the dentist' on my todo list.",
  [{ name: 'create_work_task', arguments: { title: 'Book the dentist', project_id: 'personal' } }],
  { results: ['Created work task "Book the dentist" (id wt-2103) in project personal.'],
    reply: 'Created work task "Book the dentist" (wt-2103) in Personal.' }));
examples.push(ex('iris', 'Add "call the ISP" to my to-dos.',
  [{ name: 'create_work_task', arguments: { title: 'Call the ISP', project_id: 'personal' } }],
  { results: ['Created work task "Call the ISP" (id wt-2104) in project personal.'],
    reply: 'Created work task "Call the ISP" (wt-2104) in Personal.' }));
examples.push(ex('iris', 'Todo: reorganize the garage shelves.',
  [{ name: 'create_work_task', arguments: { title: 'Reorganize the garage shelves', project_id: 'personal' } }],
  { results: ['Created work task "Reorganize the garage shelves" (id wt-2105) in project personal.'],
    reply: 'Created work task "Reorganize the garage shelves" (wt-2105) in Personal.' }));
// Colon-phrased variants — the 2026-09-02 checkpoint scheduled "Add a to-do
// item: fix the kitchen sink." with schedule_value "now" (invalid server-side).
// A plain to-do is a create_work_task, NEVER a schedule_task.
examples.push(ex('iris', 'Add to-do: pick up dry cleaning.',
  [{ name: 'create_work_task', arguments: { title: 'Pick up dry cleaning', project_id: 'personal' } }],
  { results: ['Created work task "Pick up dry cleaning" (id wt-2106) in project personal.'],
    reply: 'Created work task "Pick up dry cleaning" (wt-2106) in Personal.' }));
examples.push(ex('iris', 'New to-do: replace the furnace filter.',
  [{ name: 'create_work_task', arguments: { title: 'Replace the furnace filter', project_id: 'personal' } }],
  { results: ['Created work task "Replace the furnace filter" (id wt-2107) in project personal.'],
    reply: 'Created work task "Replace the furnace filter" (wt-2107) in Personal.' }));

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
// Reinforcement for the "reminder … and create a calendar event called X"
// phrasing — the 2026-09-02 checkpoint emitted an EMPTY turn (no calls, no
// text) on this exact shape, deterministically. Same-time (not offset) pairs:
examples.push(ex('iris', 'Set a one-time reminder about the team meeting at 2:00 PM today, and create a calendar event called "Team meeting" at 2:00 PM today.',
  [
    { name: 'schedule_task', arguments: { prompt: 'Team meeting.', schedule_type: 'once', schedule_value: '2026-08-31T14:00:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Team meeting', start_time: '2026-08-31T14:00:00' } },
  ],
  { reply: 'Set a 2pm reminder for the team meeting and created a "Team meeting" calendar event (2026-08-31T14:00:00).' }));
examples.push(ex('iris', 'Remind me at 5 PM today about the server restart, and create a calendar event called "Server restart" at 5 PM today.',
  [
    { name: 'schedule_task', arguments: { prompt: 'Server restart.', schedule_type: 'once', schedule_value: '2026-08-31T17:00:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Server restart', start_time: '2026-08-31T17:00:00' } },
  ],
  { reply: 'Set a 5pm reminder for the server restart and created a "Server restart" calendar event (2026-08-31T17:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder about the phone call at 4:30 PM tomorrow, and create a calendar event called "Phone call" at 4:30 PM tomorrow.',
  [
    { name: 'schedule_task', arguments: { prompt: 'Phone call.', schedule_type: 'once', schedule_value: '2026-09-01T16:30:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Phone call', start_time: '2026-09-01T16:30:00' } },
  ],
  { reply: 'Set a 4:30pm reminder for the phone call and created a "Phone call" calendar event tomorrow (2026-09-01T16:30:00).' }));

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
// IRIS-DIGEST — the digest pipeline as production ACTUALLY runs it. The host
// spawns an `iris-digest-<span>` run DIRECTLY (no chat, no orchestrator) with
// the digest system prompt, read_emails as the ONLY tool, and a prompt =
// buildDigestContext INPUT + "---" + the baked span prompt. The model calls
// read_emails with since/before copied VERBATIM from the INPUT's
// "Email window (UTC)" line, then emits the digest JSON object as FINAL TEXT
// (the agent-runner extracts and publishes it — the model never publishes).
// digest_reality.mjs pulls the real prompts/tool defs out of the live
// sources, so these examples can't drift from what ships.
// =========================================================================

// exDigest: digest system + INPUT, one read_emails call with the verbatim
// window (limit 50/100/200 per span, preview_only — as the baked prompt
// instructs), then the digest JSON object as the final assistant text.
function exDigest(span, input, emailsResult, digestObj) {
  const win = input.match(/Email window \(UTC\): since (\S+) before (\S+)/);
  if (!win) throw new Error('exDigest: INPUT is missing the "Email window (UTC)" line');
  const limit = span === 'hourly' ? 50 : span === 'daily' ? 100 : 200;
  return {
    messages: [
      { role: 'system', content: DIGEST_SYSTEM },
      { role: 'user', content: `${input}\n\n---\n\n${DIGEST_PROMPTS[span]}` },
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_emails', arguments: { since: win[1], before: win[2], limit, preview_only: true } } }] },
      { role: 'tool', name: 'read_emails', content: emailsResult },
      { role: 'assistant', content: JSON.stringify(digestObj) },
    ],
    tools: DIGEST_TOOLS,
  };
}

// ---- D1. Daily, morning: emails in window + a Look Out For match ---------
examples.push(exDigest('daily', buildDigestInput({
  localTime: '8/31/2026, 8:00:07 AM',
  since: '2026-08-30T15:00:07.000Z', before: '2026-08-31T15:00:07.000Z',
  bio: 'Location: Victoria, BC\nDominic — software engineer; prefers terse summaries; deep-work mornings.',
  calendar: ['- 2026-08-31T14:00:00 → 2026-08-31T15:00:00: Project Review', '- 2026-08-31T18:00:00 → 2026-08-31T18:30:00: Dentist'],
  tasks: ['- [todo] Finish API spec (project personal)', '- [todo] Fix login bug (project personal)'],
  weather: ['Now: 18°C, Partly cloudy, humidity 58%', 'Next hours: 09:00 18°C, 10:00 19°C, 11:00 20°C'],
  lookout: ['- Q4 budget sign-off from Sarah'],
}),
'3 emails:\n1. 2026-08-30T22:14 sarah@acme.io | "Re: Q4 budget approval needed" — needs sign-off by Friday\n2. 2026-08-30T19:02 jason@partnerco.com | "Action required: sign the NDA"\n3. 2026-08-30T15:30 newsletter@hackernews.com | "HN Weekly" (newsletter)',
{
  title: '2026-08-31 8:00 AM',
  summary: 'Good morning. Project Review at 2 PM and Dentist at 6 PM today. Sarah needs the Q4 budget signed off by Friday.',
  alerts: ['Q4 budget sign-off from Sarah - matched by email sarah@acme.io: "Re: Q4 budget approval needed"'],
  blocks: [
    { icon: 'review', label: 'Day in Review', type: 'prose', text: 'Today: Project Review 2:00–3:00 PM and Dentist 6:00–6:30 PM. Open tasks are the API spec and the login bug. Notable email: Sarah needs the Q4 budget signed off by Friday.' },
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: sarah@acme.io: Re: Q4 budget approval needed (Aug 30, 10:14 PM)', 'From: jason@partnerco.com: Action required: sign the NDA (Aug 30, 7:02 PM)', 'From: newsletter@hackernews.com: HN Weekly (Aug 30, 3:30 PM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['14:00 Project Review (1h)', '18:00 Dentist (30m)'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[todo] Finish API spec', '[todo] Fix login bug'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 18°C, partly cloudy. Next hours 18–20°C.' },
    { icon: 'tomorrow', label: 'Tomorrow', type: 'prose', text: '' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Sign off the Q4 budget for Sarah before Friday.' },
  ],
}));

// ---- D2. Hourly: CI bot is automated — matched as an alert, NOT actionable
examples.push(exDigest('hourly', buildDigestInput({
  localTime: '8/31/2026, 1:07:00 PM',
  since: '2026-08-31T19:07:00.000Z', before: '2026-08-31T20:07:00.000Z',
  bio: 'Location: Victoria, BC\nDominic — deep-work mornings.',
  calendar: ['- 2026-08-31T14:00:00 → 2026-08-31T15:00:00: Project Review'],
  tasks: ['- [todo] Fix login bug (project personal)'],
  weather: ['Now: 20°C, Partly cloudy, humidity 55%', 'Next hours: 14:00 20°C, 15:00 21°C, 16:00 21°C'],
  lookout: ['- Build failures from CI'],
}),
'1 email:\n1. 2026-08-31T12:42 ci-bot@warden | "Build #1284 failed" — tests/test_scheduler.py assertion error',
{
  title: '2026-08-31 1:07 PM',
  summary: 'Mostly quiet hour. CI reported build #1284 failed on a scheduler test assertion. Project Review at 2 PM.',
  alerts: ['Build failures from CI - matched by email ci-bot@warden: "Build #1284 failed"'],
  blocks: [
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: ci-bot@warden: Build #1284 failed (12:42 PM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['14:00 Project Review (1h)'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[todo] Fix login bug'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 20°C, partly cloudy. Next hours 20–21°C.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Project Review in under an hour; CI build #1284 failed on a test assertion.' },
  ],
  actionable_tasks: [], actionable_events: [],
}));

// ---- D3. Hourly: a real actionable email drives actionable_tasks ---------
examples.push(exDigest('hourly', buildDigestInput({
  localTime: '8/31/2026, 4:07:00 PM',
  since: '2026-08-31T22:07:00.000Z', before: '2026-08-31T23:07:00.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: [],
  tasks: ['- [todo] Review PRs (project proj-warden-01)'],
  weather: ['Now: 19°C, Sunny, humidity 52%'],
  lookout: [],
}),
'1 email:\n1. 2026-08-31T15:55 jason@partnerco.com | "Action required: sign the NDA" — please review and sign the attached NDA by end of week',
{
  title: '2026-08-31 4:07 PM',
  summary: 'Jason at PartnerCo asked for the NDA to be reviewed and signed by end of week; otherwise a quiet hour.',
  alerts: [],
  blocks: [
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: jason@partnerco.com: Action required: sign the NDA (3:55 PM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['Nothing in the next 2 hours.'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[todo] Review PRs'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 19°C, sunny.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Sign the NDA Jason sent before end of week.' },
  ],
  actionable_tasks: [{ title: 'Sign the NDA', due: '', project_hint: '' }],
  actionable_events: [],
}));

// ---- D4. Weekly: week in review from INPUT + email activity --------------
examples.push(exDigest('weekly', buildDigestInput({
  localTime: '8/30/2026, 8:32:00 PM',
  since: '2026-08-24T03:32:00.000Z', before: '2026-08-31T03:32:00.000Z',
  bio: 'Location: Victoria, BC\nDominic — software engineer; prefers terse summaries.',
  calendar: ['- 2026-08-31T14:00:00 → 2026-08-31T15:00:00: Project Review', '- 2026-09-01T10:00:00 → 2026-09-01T10:30:00: 1:1 with Sarah'],
  tasks: ['- [doing] Migrate DB (project proj-warden-01)', '- [todo] Write integration tests (project proj-warden-01)'],
  weather: ['Now: 17°C, Clear, humidity 60%'],
  lookout: [],
}),
'12 emails this week. From: 2026-08-25 sarah@acme.io — "Roadmap feedback"; 2026-08-28 finance@acme.io — "Expense report due Sep 5". 10 newsletters/receipts — non-actionable.',
{
  title: 'Week of 2026-08-24',
  summary: 'Project Review on Monday and a 1:1 with Sarah on Tuesday close out the calendar. The DB migration is still in progress, and the expense report is due Sep 5.',
  alerts: [],
  blocks: [
    { icon: 'review', label: 'Week in Review', type: 'prose', text: 'On the calendar: Project Review (Mon 2 PM) and a 1:1 with Sarah (Tue 10 AM). Migrate DB is in progress; Write integration tests is open. Expense report is due Sep 5.' },
    { icon: 'inbox', label: 'Email Activity', type: 'list', items: ['From: sarah@acme.io: Roadmap feedback (Aug 25)', 'From: finance@acme.io: Expense report due Sep 5 (Aug 28)', '10 newsletters/receipts — no action'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['2026-08-31 14:00 Project Review', '2026-09-01 10:00 1:1 with Sarah'] },
    { icon: 'tasks', label: 'Tasks', type: 'list', items: ['[doing] Migrate DB', '[todo] Write integration tests'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 17°C, clear.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'File the expense report before Sep 5.' },
  ],
}));

// ---- D5. Hourly, EMPTY window: empty-state values, nothing invented ------
examples.push(exDigest('hourly', buildDigestInput({
  localTime: '8/31/2026, 7:07:00 AM',
  since: '2026-08-31T13:07:00.000Z', before: '2026-08-31T14:07:00.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: [],
  tasks: [],
  weather: ['Now: 14°C, Clear, humidity 70%'],
  lookout: [],
}),
'0 emails received in this window.',
{
  title: '2026-08-31 7:07 AM',
  summary: 'Quiet hour — no new emails, nothing on the calendar, and no active tasks.',
  alerts: [],
  blocks: [
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: [] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['Nothing in the next 2 hours.'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['No active tasks.'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 14°C, clear.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: '' },
  ],
  actionable_tasks: [], actionable_events: [],
}));

// ---- D6. Daily, no emails: Look Out For present but unmatched → alerts []
examples.push(exDigest('daily', buildDigestInput({
  localTime: '8/31/2026, 9:00:12 AM',
  since: '2026-08-30T16:00:12.000Z', before: '2026-08-31T16:00:12.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: ['- 2026-08-31T11:00:00 → 2026-08-31T11:15:00: Standup', '- 2026-08-31T15:30:00 → 2026-08-31T16:15:00: Client call'],
  tasks: ['- [todo] Ship release (project personal)'],
  weather: ['Now: 17°C, Overcast, humidity 62%'],
  lookout: ['- Reply from Jason about the NDA'],
}),
'0 emails received in this window.',
{
  title: '2026-08-31 9:00 AM',
  summary: 'Good morning. Standup at 11 AM and a client call at 3:30 PM; the release is the open task. No new email overnight.',
  alerts: [],
  blocks: [
    { icon: 'review', label: 'Day in Review', type: 'prose', text: 'Today: Standup 11:00–11:15 AM and Client call 3:30–4:15 PM. Ship release is the open task. The inbox is quiet.' },
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: [] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['11:00 Standup (15m)', '15:30 Client call (45m)'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[todo] Ship release'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 17°C, overcast.' },
    { icon: 'tomorrow', label: 'Tomorrow', type: 'prose', text: '' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Client call at 3:30 PM — the release task is still open.' },
  ],
}));

// ---- D7. Hourly, evening: several emails, one a real to-do ---------------
examples.push(exDigest('hourly', buildDigestInput({
  localTime: '8/31/2026, 8:07:00 PM',
  since: '2026-09-01T02:07:00.000Z', before: '2026-09-01T03:07:00.000Z',
  bio: 'Location: Victoria, BC\nDominic — software engineer; prefers terse summaries.',
  calendar: [],
  tasks: ['- [todo] Finish API spec (project personal)'],
  weather: ['Now: 15°C, Clear, humidity 64%'],
  lookout: ['- Invoice from the contractor'],
}),
'3 emails:\n1. 2026-08-31T19:40 contractor@buildit.ca | "Invoice #77 attached" — $1,240, due Sep 15\n2. 2026-08-31T19:12 mom@gmail.com | "Dinner on Sunday?"\n3. 2026-08-31T18:58 newsletter@hackernews.com | "HN Weekly" (newsletter)',
{
  title: '2026-08-31 8:07 PM',
  summary: 'The contractor invoice ($1,240, due Sep 15) arrived, and mom asked about Sunday dinner.',
  alerts: ['Invoice from the contractor - matched by email contractor@buildit.ca: "Invoice #77 attached"'],
  blocks: [
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: contractor@buildit.ca: Invoice #77 attached (7:40 PM)', 'From: mom@gmail.com: Dinner on Sunday? (7:12 PM)', 'From: newsletter@hackernews.com: HN Weekly (6:58 PM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['Nothing in the next 2 hours.'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[todo] Finish API spec'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 15°C, clear.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Pay the contractor invoice before Sep 15 and reply to mom about Sunday.' },
  ],
  actionable_tasks: [{ title: 'Pay contractor invoice #77 ($1,240)', due: '2026-09-15', project_hint: '' }],
  actionable_events: [],
}));

// ---- D8. Hourly, midday: only newsletters → no actionables, no alerts ----
examples.push(exDigest('hourly', buildDigestInput({
  localTime: '9/1/2026, 11:07:00 AM',
  since: '2026-09-01T17:07:00.000Z', before: '2026-09-01T18:07:00.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: ['- 2026-09-01T13:00:00 → 2026-09-01T13:30:00: Call with accountant'],
  tasks: ['- [doing] Migrate DB (project proj-warden-01)'],
  weather: ['Now: 21°C, Sunny, humidity 50%'],
  lookout: ['- Build failures from CI'],
}),
'2 emails:\n1. 2026-09-01T10:33 newsletter@hackernews.com | "HN Weekly" (newsletter)\n2. 2026-09-01T10:05 receipts@amazon.ca | "Your order has shipped" (receipt)',
{
  title: '2026-09-01 11:07 AM',
  summary: 'Nothing actionable this hour — a newsletter and a shipping receipt. Call with the accountant at 1 PM.',
  alerts: [],
  blocks: [
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: newsletter@hackernews.com: HN Weekly (10:33 AM)', 'From: receipts@amazon.ca: Your order has shipped (10:05 AM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['13:00 Call with accountant (30m)'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[doing] Migrate DB'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 21°C, sunny.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Call with the accountant at 1 PM.' },
  ],
  actionable_tasks: [], actionable_events: [],
}));

// ---- D9. Daily, evening: long busy window, two actionable emails ---------
examples.push(exDigest('daily', buildDigestInput({
  localTime: '8/31/2026, 9:00:04 PM',
  since: '2026-08-31T04:00:04.000Z', before: '2026-09-01T04:00:04.000Z',
  bio: 'Location: Victoria, BC\nDominic — software engineer; prefers terse summaries; deep-work mornings.',
  calendar: ['- 2026-08-31T14:00:00 → 2026-08-31T15:00:00: Project Review (today)', '- 2026-09-01T10:00:00 → 2026-09-01T10:30:00: 1:1 with Sarah (tomorrow)'],
  tasks: ['- [doing] Migrate DB (project proj-warden-01)', '- [todo] Write integration tests (project proj-warden-01)'],
  weather: ['Now: 14°C, Clear, humidity 68%'],
  lookout: ['- Q4 budget sign-off from Sarah'],
}),
'6 emails:\n1. 2026-08-31T20:15 sarah@acme.io | "Q4 budget approved — thanks!"\n2. 2026-08-31T16:40 jason@partnerco.com | "Action required: sign the NDA" — please sign by end of week\n3. 2026-08-31T15:02 contractor@buildit.ca | "Invoice #77 attached" — due Sep 15\n4. 2026-08-31T12:11 newsletter@hackernews.com | "HN Weekly" (newsletter)\n5. 2026-08-31T09:30 billing@stripe.com | "Invoice #4421 paid" (receipt)\n6. 2026-08-31T08:02 boss@acme.io | "Great review today"',
{
  title: '2026-08-31 9:00 PM',
  summary: 'Sarah approved the Q4 budget. Still open: sign the NDA by end of week and pay contractor invoice #77 by Sep 15. 1:1 with Sarah tomorrow at 10 AM.',
  alerts: ['Q4 budget sign-off from Sarah - matched by email sarah@acme.io: "Q4 budget approved — thanks!"'],
  blocks: [
    { icon: 'review', label: 'Day in Review', type: 'prose', text: 'Busy day: Project Review at 2 PM, six emails. Sarah approved the Q4 budget; Jason still needs the NDA signed; the contractor invoice (#77, due Sep 15) is in. Tomorrow: 1:1 with Sarah at 10 AM.' },
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: sarah@acme.io: Q4 budget approved — thanks! (8:15 PM)', 'From: jason@partnerco.com: Action required: sign the NDA (4:40 PM)', 'From: contractor@buildit.ca: Invoice #77 attached (3:02 PM)', 'From: boss@acme.io: Great review today (8:02 AM)', 'Newsletter/receipt: HN Weekly, Stripe receipt'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['Today 14:00 Project Review (done)', 'Tomorrow 10:00 1:1 with Sarah'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[doing] Migrate DB', '[todo] Write integration tests'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 14°C, clear.' },
    { icon: 'tomorrow', label: 'Tomorrow', type: 'prose', text: '1:1 with Sarah at 10 AM.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Sign the NDA for Jason before end of week.' },
  ],
  actionable_tasks: [{ title: 'Sign the NDA', due: '', project_hint: '' }, { title: 'Pay contractor invoice #77', due: '2026-09-15', project_hint: '' }],
  actionable_events: [],
}));

// ---- D10. Weekly with a Look Out For match -------------------------------
examples.push(exDigest('weekly', buildDigestInput({
  localTime: '9/6/2026, 8:30:00 PM',
  since: '2026-08-31T03:30:00.000Z', before: '2026-09-07T03:30:00.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: ['- 2026-09-08T14:00:00 → 2026-09-08T15:00:00: Sprint planning'],
  tasks: ['- [doing] Migrate DB (project proj-warden-01)'],
  weather: ['Now: 16°C, Partly cloudy, humidity 63%'],
  lookout: ['- Invoice from the contractor'],
}),
'9 emails this week. From: 2026-09-04 contractor@buildit.ca — "Invoice #77 attached"; 2026-09-03 sarah@acme.io — "Sprint planning agenda". 7 newsletters/receipts — non-actionable.',
{
  title: 'Week of 2026-08-31',
  summary: 'The contractor invoice (#77) came in and Sarah sent the sprint-planning agenda; sprint planning is Tuesday at 2 PM. The DB migration is still in progress.',
  alerts: ['Invoice from the contractor - matched by email contractor@buildit.ca: "Invoice #77 attached"'],
  blocks: [
    { icon: 'review', label: 'Week in Review', type: 'prose', text: 'Notable: contractor invoice #77 arrived and Sarah circulated the sprint-planning agenda. Migrate DB is still in progress. Coming up: Sprint planning on Tuesday at 2 PM.' },
    { icon: 'inbox', label: 'Email Activity', type: 'list', items: ['From: contractor@buildit.ca: Invoice #77 attached (Sep 4)', 'From: sarah@acme.io: Sprint planning agenda (Sep 3)', '7 newsletters/receipts — no action'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['2026-09-08 14:00 Sprint planning'] },
    { icon: 'tasks', label: 'Tasks', type: 'list', items: ['[doing] Migrate DB'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 16°C, partly cloudy.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Pay contractor invoice #77 before Sep 15; skim the sprint agenda before Tuesday.' },
  ],
}));

// ---- D11. Hourly, INPUT with no weather/bio sections included ------------
// (buildDigestContext omits those when absent — the model sees fewer sections)
examples.push(exDigest('hourly', buildDigestInput({
  localTime: '9/1/2026, 3:07:00 PM',
  since: '2026-09-01T21:07:00.000Z', before: '2026-09-01T22:07:00.000Z',
  bio: '',
  calendar: [],
  tasks: ['- [todo] Write integration tests (project proj-warden-01)'],
  weather: [],
  lookout: [],
}),
'1 email:\n1. 2026-09-01T14:52 jason@partnerco.com | "NDA — checking in" — any blockers on your end?',
{
  title: '2026-09-01 3:07 PM',
  summary: 'Jason followed up on the NDA, asking about blockers; otherwise quiet.',
  alerts: [],
  blocks: [
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: jason@partnerco.com: NDA — checking in (2:52 PM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['Nothing in the next 2 hours.'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[todo] Write integration tests'] },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Reply to Jason — the NDA is still unsigned.' },
  ],
  actionable_tasks: [{ title: 'Reply to Jason about the NDA', due: '', project_hint: '' }],
  actionable_events: [],
}));

// ---- D12. Daily, quiet weekend: no tasks, one email ----------------------
examples.push(exDigest('daily', buildDigestInput({
  localTime: '8/30/2026, 8:00:09 AM',
  since: '2026-08-29T15:00:09.000Z', before: '2026-08-30T15:00:09.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: ['- 2026-08-30T12:00:00 → 2026-08-30T13:00:00: Lunch with mom'],
  tasks: [],
  weather: ['Now: 15°C, Fog, humidity 78%', 'Next hours: 09:00 15°C, 10:00 16°C, 11:00 17°C'],
  lookout: [],
}),
'1 email:\n1. 2026-08-29T22:31 mom@gmail.com | "Dinner on Sunday?"',
{
  title: '2026-08-30 8:00 AM',
  summary: 'Good morning — a quiet Sunday. Lunch with mom at noon; she also emailed about Sunday dinner.',
  alerts: [],
  blocks: [
    { icon: 'review', label: 'Day in Review', type: 'prose', text: 'One email overnight (mom, about Sunday dinner) and lunch with mom on the calendar at 12:00. No active tasks.' },
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: mom@gmail.com: Dinner on Sunday? (Aug 29, 10:31 PM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['12:00 Lunch with mom (1h)'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['No active tasks.'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 15°C, fog. Next hours 15–17°C.' },
    { icon: 'tomorrow', label: 'Tomorrow', type: 'prose', text: 'Nothing on the calendar yet.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: '' },
  ],
  actionable_tasks: [], actionable_events: [],
}));

// ---- D12b. Daily, BUSY morning: full read_emails args on the longest span -
// (2026-09-08 dryfire: the daily digest case stably called read_emails with
// EMPTY args — the window transcription needs the most reinforcement on the
// daily span, where the INPUT is longest and limit=100.)
examples.push(exDigest('daily', buildDigestInput({
  localTime: '9/1/2026, 8:00:05 AM',
  since: '2026-08-31T15:00:05.000Z', before: '2026-09-01T15:00:05.000Z',
  bio: 'Location: Victoria, BC\nDominic — software engineer; prefers terse summaries.',
  calendar: ['- 2026-09-01T10:00:00 → 2026-09-01T10:30:00: Standup', '- 2026-09-01T16:00:00 → 2026-09-01T17:00:00: 1:1 with Jason'],
  tasks: ['- [doing] Finish the API spec (project personal)', '- [todo] Review the NDA (project personal)'],
  weather: ['Now: 16°C, Rain, humidity 84%', 'Next hours: 09:00 16°C, 10:00 17°C, 11:00 17°C'],
  lookout: ['- Anything from Jason about the NDA'],
}),
'4 emails:\n1. 2026-08-31T23:40 jason@partnerco.com | "Re: NDA — one more clause" — wants section 4 reworded before signing\n2. 2026-08-31T21:12 sarah@acme.io | "Roadmap feedback" — notes attached\n3. 2026-08-31T18:03 billing@stripe.com | "Invoice #4502 paid" (receipt)\n4. 2026-08-31T16:20 newsletter@hackernews.com | "HN Weekly" (newsletter)',
{
  title: '2026-09-01 8:00 AM',
  summary: 'Good morning. Standup at 10 and a 1:1 with Jason at 4 PM; he emailed again about rewording NDA section 4 before signing.',
  alerts: ['Anything from Jason about the NDA - matched by email jason@partnerco.com: "Re: NDA — one more clause"'],
  blocks: [
    { icon: 'review', label: 'Day in Review', type: 'prose', text: 'Two meetings today: Standup (10:00) and the 1:1 with Jason (16:00). Jason asked for section 4 of the NDA to be reworded; the API spec is in progress and the NDA review is open. Rain all morning.' },
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: ['From: jason@partnerco.com: Re: NDA — one more clause (Aug 31, 11:40 PM)', 'From: sarah@acme.io: Roadmap feedback (Aug 31, 9:12 PM)', 'From: billing@stripe.com: Invoice #4502 paid (Aug 31, 6:03 PM)', 'From: newsletter@hackernews.com: HN Weekly (Aug 31, 4:20 PM)'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['10:00 Standup (30m)', '16:00 1:1 with Jason (1h)'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['[doing] Finish the API spec', '[todo] Review the NDA'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 16°C, rain. Next hours 16–17°C.' },
    { icon: 'tomorrow', label: 'Tomorrow', type: 'prose', text: '' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Reword NDA section 4 for Jason before the 4 PM 1:1.' },
  ],
}));

// ---- D13. Weekly, EMPTY week: no emails at all ----------------------------
examples.push(exDigest('weekly', buildDigestInput({
  localTime: '8/23/2026, 8:28:00 PM',
  since: '2026-08-17T03:28:00.000Z', before: '2026-08-24T03:28:00.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: ['- 2026-08-25T09:00:00 → 2026-08-25T09:30:00: Dentist'],
  tasks: ['- [todo] Refactor the scheduler (project proj-warden-01)'],
  weather: ['Now: 16°C, Clear, humidity 66%'],
  lookout: ['- Build failures from CI'],
}),
'0 emails received in this window.',
{
  title: 'Week of 2026-08-17',
  summary: 'A silent week on email. Dentist on Tuesday at 9 AM; the scheduler refactor is the open task.',
  alerts: [],
  blocks: [
    { icon: 'review', label: 'Week in Review', type: 'prose', text: 'No email all week and a thin calendar — Dentist Tuesday 9 AM. Refactor the scheduler is the open task.' },
    { icon: 'inbox', label: 'Email Activity', type: 'list', items: ['No emails this week.'] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['2026-08-25 09:00 Dentist'] },
    { icon: 'tasks', label: 'Tasks', type: 'list', items: ['[todo] Refactor the scheduler'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 16°C, clear.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Dentist Tuesday 9 AM.' },
  ],
}));

// ---- D14. Hourly: calendar event imminent, no emails (nudge leads it) ----
examples.push(exDigest('hourly', buildDigestInput({
  localTime: '8/31/2026, 12:52:00 PM',
  since: '2026-08-31T18:52:00.000Z', before: '2026-08-31T19:52:00.000Z',
  bio: 'Location: Victoria, BC\nDominic.',
  calendar: ['- 2026-08-31T13:00:00 → 2026-08-31T13:30:00: Call with accountant'],
  tasks: [],
  weather: ['Now: 20°C, Partly cloudy, humidity 57%'],
  lookout: [],
}),
'0 emails received in this window.',
{
  title: '2026-08-31 12:52 PM',
  summary: 'Call with the accountant in 8 minutes; no new email this hour.',
  alerts: [],
  blocks: [
    { icon: 'inbox', label: 'Recent Emails', type: 'list', items: [] },
    { icon: 'calendar', label: 'Calendar', type: 'list', items: ['13:00 Call with accountant (30m) — starts in 8 minutes'] },
    { icon: 'tasks', label: 'Active Tasks', type: 'list', items: ['No active tasks.'] },
    { icon: 'weather', label: 'Weather', type: 'prose', text: 'Now 20°C, partly cloudy.' },
    { icon: 'nudge', label: 'Nudge', type: 'prose', text: 'Call with the accountant at 1 PM — heads up.' },
  ],
  actionable_tasks: [], actionable_events: [],
}));

// ---- S. Email: read / search / get ---------------------------------------
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
    { role: 'user', content: `${ANCHOR}\n\nList my available API keys.` },
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
    { role: 'user', content: `${ANCHOR}\n\nFetch my latest 5 GitHub repos using the github key.` },
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

// ---- W10 REMOVED: the read_emails → post_summary digest chain it taught
// never existed in production — digests are direct `iris-digest-<span>`
// background spawns where the model emits JSON as final text and the RUNNER
// publishes it. The real digest examples live in section D above. ----------

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
// IRIS — work management (projects, work tasks, deliverables, blockers,
// priorities, financials, time tracking, inbox → work tasks). Absorbed from
// byte 2026-09-05. Single-shot: the brief carries the id; one call per
// request.
// =========================================================================

// ---- I. create_work_task — the project_id="personal" default + priority --
examples.push(ex('iris', "Record a new work task: 'Fix the login bug' — add it to my personal list.",
  [{ name: 'create_work_task', arguments: { title: 'Fix the login bug', project_id: 'personal' } }],
  { results: ['Created work task "Fix the login bug" (id wt-2001) in project personal.'],
    reply: 'Created work task "Fix the login bug" (wt-2001) in Personal.' }));
examples.push(ex('iris', "Record a new high-priority work task: 'Write the API spec'.",
  [{ name: 'create_work_task', arguments: { title: 'Write the API spec', project_id: 'personal', priority: 'high' } }],
  { results: ['Created work task "Write the API spec" (id wt-2002) in project personal.'],
    reply: 'Created work task "Write the API spec" (wt-2002, high) in Personal.' }));
examples.push(ex('iris', "Record a new urgent work task: 'Ship the hotfix'.",
  [{ name: 'create_work_task', arguments: { title: 'Ship the hotfix', project_id: 'personal', priority: 'urgent' } }],
  { results: ['Created work task "Ship the hotfix" (id wt-2003) in project personal.'],
    reply: 'Created work task "Ship the hotfix" (wt-2003, urgent) in Personal.' }));
examples.push(ex('iris', "Record a new low-priority work task: 'Review the PR'.",
  [{ name: 'create_work_task', arguments: { title: 'Review the PR', project_id: 'personal', priority: 'low' } }],
  { results: ['Created work task "Review the PR" (id wt-2004) in project personal.'],
    reply: 'Created work task "Review the PR" (wt-2004, low) in Personal.' }));
examples.push(ex('iris', "Record a new work task: 'Prepare the demo', due Friday — add it to my personal list.",
  [{ name: 'create_work_task', arguments: { title: 'Prepare the demo', project_id: 'personal', due_date: '2026-09-04' } }],
  { results: ['Created work task "Prepare the demo" (id wt-2005) in project personal.'],
    reply: 'Created work task "Prepare the demo" (wt-2005) in Personal, due 2026-09-04.' }));

// ---- J. Named project → list_projects first, then create_work_task ------
examples.push(exManage('iris', "Add a work task 'Refactor the scheduler' to the Warden project.", {
  actionTool: 'create_work_task',
  actionArgs: { title: 'Refactor the scheduler', project_id: 'proj-warden-01' },
  actionResult: 'Created work task "Refactor the scheduler" (id wt-2006) in project proj-warden-01.',
  reply: 'Created work task "Refactor the scheduler" (wt-2006) in the Warden project (proj-warden-01).',
}));
examples.push(exManage('iris', "Add an urgent work task 'Fix the prod outage' to the Acme Migration project.", {
  actionTool: 'create_work_task',
  actionArgs: { title: 'Fix the prod outage', project_id: 'proj-acme-02', priority: 'urgent' },
  actionResult: 'Created work task "Fix the prod outage" (id wt-2007) in project proj-acme-02.',
  reply: 'Created urgent work task "Fix the prod outage" (wt-2007) in Acme Migration (proj-acme-02).',
}));

// ---- K. create_project + seed it (the multi-tool create flow) -----------
examples.push(ex('iris', "Create a new project called 'Q4 Marketing Plan' with a description.",
  [{ name: 'create_project', arguments: { name: 'Q4 Marketing Plan', description: 'Plan and execute the Q4 marketing campaign.' } }],
  { results: ['Project "Q4 Marketing Plan" created with id proj-q4mkt-01. Now call add_deliverable, add_blocker, add_priority, update_financials, and create_work_task using this project_id.'],
    reply: 'Created project "Q4 Marketing Plan" (proj-q4mkt-01).' }));
examples.push(ex('iris', "Create a new project called 'Site Redesign', due 2026-10-31.",
  [{ name: 'create_project', arguments: { name: 'Site Redesign', due_date: '2026-10-31' } }],
  { results: ['Project "Site Redesign" created with id proj-siteredesign-01.'],
    reply: 'Created project "Site Redesign" (proj-siteredesign-01), due 2026-10-31.' }));
examples.push(ex('iris', "Create a new project called 'Mobile App' with project code MOB-001.",
  [{ name: 'create_project', arguments: { name: 'Mobile App', project_code: 'MOB-001' } }],
  { results: ['Project "Mobile App" created with id proj-mobileapp-01.'],
    reply: 'Created project "Mobile App" (proj-mobileapp-01, code MOB-001).' }));

// ---- L. Deliverables on a project ---------------------------------------
examples.push(exManage('iris', "Add a 'Launch landing page' deliverable to the Q4 Marketing Plan project.", {
  actionTool: 'add_deliverable',
  actionArgs: { project_id: 'proj-q4mkt-01', name: 'Launch landing page' },
  actionResult: 'Deliverable "Launch landing page" added (id deliv-301) to project proj-q4mkt-01.',
  reply: 'Added deliverable "Launch landing page" (deliv-301) to Q4 Marketing Plan.',
}));
examples.push(exManage('iris', "Add a 'Ship v1' deliverable, due 2026-09-15, to the Mobile App project.", {
  actionTool: 'add_deliverable',
  actionArgs: { project_id: 'proj-mobileapp-01', name: 'Ship v1', due_date: '2026-09-15' },
  actionResult: 'Deliverable "Ship v1" added (id deliv-302) to project proj-mobileapp-01.',
  reply: 'Added deliverable "Ship v1" (deliv-302) to Mobile App, due 2026-09-15.',
}));
examples.push(exManage('iris', "Mark the 'Launch landing page' deliverable as done.", {
  actionTool: 'toggle_deliverable',
  actionArgs: { deliverable_id: 'deliv-301' },
  actionResult: 'Deliverable deliv-301 toggled.',
  reply: 'Marked "Launch landing page" (deliv-301) as done.',
}));
examples.push(exManage('iris', "Delete the 'Ship v1' deliverable from the Mobile App project.", {
  actionTool: 'delete_deliverable',
  actionArgs: { deliverable_id: 'deliv-302' },
  actionResult: 'Deliverable deliv-302 deleted.',
  reply: 'Deleted the "Ship v1" deliverable (deliv-302) from Mobile App.',
}));

// ---- M. Blockers + priorities + financials ------------------------------
examples.push(exManage('iris', "Add a high-severity blocker to the Warden project: 'CI is flaky on arm64'.", {
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-warden-01', description: 'CI is flaky on arm64', severity: 'high' },
  actionResult: 'Blocker "CI is flaky on arm64" added (id blk-401) to project proj-warden-01.',
  reply: 'Added a high-severity blocker "CI is flaky on arm64" (blk-401) to Warden.',
}));
examples.push(exManage('iris', "Add a critical blocker to the Acme Migration project: 'Data migration script failing'.", {
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-acme-02', description: 'Data migration script failing', severity: 'critical' },
  actionResult: 'Blocker "Data migration script failing" added (id blk-402) to project proj-acme-02.',
  reply: 'Added a critical blocker "Data migration script failing" (blk-402) to Acme Migration.',
}));
examples.push(exManage('iris', "Add a high-impact priority to the Warden project: 'Improve test coverage'.", {
  actionTool: 'add_priority',
  actionArgs: { project_id: 'proj-warden-01', item: 'Improve test coverage', impact: 'high' },
  actionResult: 'Priority "Improve test coverage" added (id prio-501) to project proj-warden-01.',
  reply: 'Added a high-impact priority "Improve test coverage" (prio-501) to Warden.',
}));
examples.push(exManage('iris', "Set the Warden project financials: budget 50000, spent 12000.", {
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-warden-01', budget: 50000, spent: 12000 },
  actionResult: 'Financials updated for project proj-warden-01.',
  reply: 'Set Warden budget to $50,000 and spent to $12,000.',
}));
examples.push(exManage('iris', "Log 3.5 hours on the Warden project today for the scheduler refactor.", {
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-warden-01', hours: 3.5, description: 'Scheduler refactor' },
  actionResult: 'Logged 3.5 hours on project proj-warden-01.',
  reply: 'Logged 3.5h on Warden for the scheduler refactor.',
}));
examples.push(exManage('iris', "Log 2 hours on the Acme Migration project for yesterday's migration work (2026-08-30).", {
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-acme-02', hours: 2, date: '2026-08-30', description: 'Migration work' },
  actionResult: 'Logged 2 hours on project proj-acme-02 for 2026-08-30.',
  reply: 'Logged 2h on Acme Migration for 2026-08-30.',
}));

// ---- N. Timer -----------------------------------------------------------
examples.push(exManage('iris', "Start a timer on the Warden project for testing.", {
  actionTool: 'start_timer',
  actionArgs: { project_id: 'proj-warden-01', description: 'Testing' },
  actionResult: 'Timer started (id timer-601) on project proj-warden-01.',
  reply: 'Started a timer on Warden (timer-601).',
}));
examples.push(ex('iris', "Stop my running timer (timer-601).",
  [{ name: 'stop_timer', arguments: { timer_id: 'timer-601' } }],
  { results: ['Timer timer-601 stopped. Logged 1.25 hours.'],
    reply: 'Stopped timer timer-601 (1.25h logged).' }));

// ---- O. update_project status enum + manage flows ----------------------
examples.push(exManage('iris', "Mark the Acme Migration project as At Risk.", {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-acme-02', status: 'At Risk' },
  actionResult: 'Project proj-acme-02 updated.',
  reply: 'Marked Acme Migration (proj-acme-02) as At Risk.',
}));
examples.push(exManage('iris', "Mark the Warden project as Blocked.", {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-warden-01', status: 'Blocked' },
  actionResult: 'Project proj-warden-01 updated.',
  reply: 'Marked Warden (proj-warden-01) as Blocked.',
}));
// Reinforcement: the 2026-09-02 checkpoint answered "mark Warden as Blocked"
// by CREATING a junk project and a work task instead of updating status.
// More status-update phrasings, with varied project names in the listing:
examples.push(exManage('iris', "Mark Warden as Blocked.", {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-warden-01', status: 'Blocked' },
  actionResult: 'Project proj-warden-01 updated.',
  reply: 'Marked Warden (proj-warden-01) as Blocked.',
}));
examples.push(exManage('iris', "Set the Warden project status to At Risk.", {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-warden-01', status: 'At Risk' },
  actionResult: 'Project proj-warden-01 updated.',
  reply: 'Set Warden (proj-warden-01) to At Risk.',
}));
examples.push(exManage('iris', "Mark the Site Redesign project as Completed.", {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-siteredesign-01', status: 'Completed' },
  actionResult: 'Project proj-siteredesign-01 updated.',
  reply: 'Marked Site Redesign (proj-siteredesign-01) as Completed.',
}));
examples.push(exManage('iris', "Move the Acme Migration project back to On Track.", {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-acme-02', status: 'On Track' },
  actionResult: 'Project proj-acme-02 updated.',
  reply: 'Moved Acme Migration (proj-acme-02) back to On Track.',
}));
// Priority reinforcement — the same checkpoint answered "add a priority" with
// create_work_task (wrong artifact, drops the impact arg). Priority = the
// add_priority tool; a work task is only for "add a task".
examples.push(exManage('iris', "Add a priority to the Warden project: improve test coverage, high impact.", {
  actionTool: 'add_priority',
  actionArgs: { project_id: 'proj-warden-01', item: 'Improve test coverage', impact: 'high' },
  actionResult: 'Priority "Improve test coverage" added (id prio-502) to project proj-warden-01.',
  reply: 'Added a high-impact priority "Improve test coverage" (prio-502) to Warden.',
}));
examples.push(exManage('iris', "Add a priority to Acme Migration: finish the data backfill, medium impact.", {
  actionTool: 'add_priority',
  actionArgs: { project_id: 'proj-acme-02', item: 'Finish the data backfill', impact: 'medium' },
  actionResult: 'Priority "Finish the data backfill" added (id prio-503) to project proj-acme-02.',
  reply: 'Added a medium-impact priority "Finish the data backfill" (prio-503) to Acme Migration.',
}));
examples.push(exManage('iris', "Rename the Mobile App project to 'Mobile App v2' and set it On Track.", {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-mobileapp-01', name: 'Mobile App v2', status: 'On Track' },
  actionResult: 'Project proj-mobileapp-01 updated.',
  reply: 'Renamed Mobile App to "Mobile App v2" (proj-mobileapp-01) and set it On Track.',
}));
examples.push(exManage('iris', "Complete the Site Redesign project.", {
  actionTool: 'complete_project',
  actionArgs: { project_id: 'proj-siteredesign-01' },
  actionResult: 'Project proj-siteredesign-01 completed.',
  reply: 'Completed the Site Redesign project (proj-siteredesign-01).',
}));
examples.push(exManage('iris', "Archive the Acme Migration project.", {
  actionTool: 'archive_project',
  actionArgs: { project_id: 'proj-acme-02' },
  actionResult: 'Project proj-acme-02 archived.',
  reply: 'Archived Acme Migration (proj-acme-02).',
}));
examples.push(exManage('iris', "Delete the Q4 Marketing Plan project.", {
  actionTool: 'delete_project',
  actionArgs: { project_id: 'proj-q4mkt-01' },
  actionResult: 'Project proj-q4mkt-01 deleted.',
  reply: 'Deleted the Q4 Marketing Plan project (proj-q4mkt-01).',
}));
examples.push(exManage('iris', "Delete the 'CI is flaky on arm64' blocker (blk-401).", {
  actionTool: 'delete_blocker',
  actionArgs: { blocker_id: 'blk-401' },
  actionResult: 'Blocker blk-401 deleted.',
  reply: 'Deleted the "CI is flaky on arm64" blocker (blk-401).',
}));
examples.push(exManage('iris', "Remove the 'Improve test coverage' priority from the Warden project.", {
  actionTool: 'delete_priority',
  actionArgs: { priority_id: 'prio-501' },
  actionResult: 'Priority prio-501 deleted.',
  reply: 'Removed the "Improve test coverage" priority (prio-501) from Warden.',
}));

// ---- P. list / get + work-task manage flows -----------------------------
examples.push(ex('iris', "List my projects.",
  [{ name: 'list_projects', arguments: {} }],
  { results: ['3 projects:\n1. personal | Personal | On Track\n2. proj-warden-01 | Warden | On Track\n3. proj-acme-02 | Acme Migration | At Risk'],
    reply: 'You have 3 projects: Personal, Warden (On Track), and Acme Migration (At Risk).' }));
examples.push(ex('iris', "List my work tasks.",
  [{ name: 'list_work_tasks', arguments: {} }],
  { results: ['4 tasks:\n1. wt-2001 | Fix the login bug | personal | medium | open\n2. wt-2006 | Refactor the scheduler | proj-warden-01 | medium | open\n3. wt-2007 | Fix the prod outage | proj-acme-02 | urgent | in-progress\n4. wt-2005 | Prepare the demo | personal | medium | open'],
    reply: 'You have 4 work tasks across Personal, Warden, and Acme Migration; the urgent one is "Fix the prod outage".' }));
examples.push(exManage('iris', "Mark the 'Fix the login bug' work task as done.", {
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2001', status: 'done' },
  actionResult: 'Work task wt-2001 updated.',
  reply: 'Marked "Fix the login bug" (wt-2001) as done.',
}));
examples.push(exManage('iris', "Bump the 'Refactor the scheduler' work task to high priority.", {
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2006', priority: 'high' },
  actionResult: 'Work task wt-2006 updated.',
  reply: 'Bumped "Refactor the scheduler" (wt-2006) to high priority.',
}));
examples.push(exManage('iris', "Delete the 'Prepare the demo' work task.", {
  actionTool: 'delete_work_task',
  actionArgs: { task_id: 'wt-2005' },
  actionResult: 'Work task wt-2005 deleted.',
  reply: 'Deleted the "Prepare the demo" task (wt-2005).',
}));
examples.push(exManage('iris', "Show me the details on the Warden project.", {
  actionTool: 'get_project',
  actionArgs: { project_id: 'proj-warden-01' },
  actionResult: 'Project details:\nname: Warden\nid: proj-warden-01\nstatus: On Track\nDeliverables: deliv-301 Launch landing page (open)\nBlockers: blk-401 CI is flaky on arm64 (high)\nFinancials: budget 50000, spent 12000',
  reply: 'Warden (proj-warden-01) is On Track — $12k of $50k spent, 1 open deliverable, 1 high-severity blocker.',
}));

// ---- Q. Inbox → work tasks (read_emails → create_work_task) -------------
examples.push(ex('iris', "Scan the inbox for actionable emails and turn them into work tasks.",
  [{ name: 'read_emails', arguments: { limit: 50, preview_only: true } }],
  { results: ['4 emails:\n1. 2026-08-31T09:12 sarah@acme.io | "Re: Q4 budget approval needed" | Sarah needs the Q4 budget signed off by Friday.\n2. 2026-08-31T08:40 newsletter@hackernews.com | "HN Weekly" | Weekly digest (newsletter).\n3. 2026-08-30T17:55 billing@stripe.com | "Invoice #4421 paid" | Receipt for $199.\n4. 2026-08-30T14:20 jason@partnerco.com | "Action required: sign the NDA" | Please review and sign the NDA attached.'],
    reply: 'Found 2 actionable emails: "Q4 budget approval needed" (Sarah) and "Action required: sign the NDA" (Jason). Want me to create a work task for each? The HN newsletter and Stripe receipt are non-actionable.' }));
examples.push(ex('iris', "Turn the NDA email into a work task.",
  [{ name: 'create_work_task', arguments: { title: 'Review and sign the NDA from Jason', project_id: 'personal', priority: 'high', due_date: '2026-09-02', description: 'Jason at PartnerCo needs the NDA signed. Email 2026-08-30T14:20.' } }],
  { results: ['Created work task "Review and sign the NDA from Jason" (id wt-2010) in project personal.'],
    reply: 'Created work task "Review and sign the NDA from Jason" (wt-2010, high, due 2026-09-02) in Personal.' }));

// ---- W6. Iris: id-supplied manage (the brief names the id — one call) ----
examples.push(exManage('iris', 'mark the Warden project as On Track', {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-warden-01', status: 'On Track' },
  actionResult: 'Project proj-warden-01 updated.',
  reply: 'Marked Warden (proj-warden-01) as On Track.',
}));
examples.push(exManage('iris', 'set Acme Migration to Blocked', {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-acme-02', status: 'Blocked' },
  actionResult: 'Project proj-acme-02 updated.',
  reply: 'Marked Acme Migration (proj-acme-02) as Blocked.',
}));
examples.push(exManage('iris', 'mark the Mobile App project as At Risk', {
  actionTool: 'update_project',
  actionArgs: { project_id: 'proj-mobileapp-01', status: 'At Risk' },
  actionResult: 'Project proj-mobileapp-01 updated.',
  reply: 'Marked Mobile App (proj-mobileapp-01) as At Risk.',
}));
examples.push(exManage('iris', "mark the 'Refactor the scheduler' task as in-progress", {
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2006', status: 'in_progress' },   // schema enum is in_progress (underscore)
  actionResult: 'Work task wt-2006 updated.',
  reply: 'Marked "Refactor the scheduler" (wt-2006) as in-progress.',
}));
examples.push(exManage('iris', 'bump the login bug task to urgent', {
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2001', priority: 'urgent' },
  actionResult: 'Work task wt-2001 updated.',
  reply: 'Bumped "Fix the login bug" (wt-2001) to urgent.',
}));
// Status/priority transition variants (2026-09-08 expansion — the full enum
// range and field combinations, all single-call with the id in the brief):
examples.push(exManage('iris', 'move the login bug task (wt-2001) back to to-do', {
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2001', status: 'todo' },
  actionResult: 'Work task wt-2001 updated.',
  reply: 'Moved "Fix the login bug" (wt-2001) back to to-do.',
}));
examples.push(exManage('iris', 'lower the priority of the API spec task (wt-2002) to medium', {
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2002', priority: 'medium' },
  actionResult: 'Work task wt-2002 updated.',
  reply: 'Lowered "Write the API spec" (wt-2002) to medium priority.',
}));
examples.push(exManage('iris', 'mark the prod outage task (wt-2007) as done and drop it to low priority', {
  actionTool: 'update_work_task',
  actionArgs: { task_id: 'wt-2007', status: 'done', priority: 'low' },
  actionResult: 'Work task wt-2007 updated.',
  reply: 'Marked "Fix the prod outage" (wt-2007) as done and lowered it to low priority.',
}));

// ---- W7. Iris: blockers/priorities with severity/impact split into own field ----
examples.push(exManage('iris', 'add a low-severity blocker to Warden: docs are out of date', {
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-warden-01', description: 'Docs are out of date', severity: 'low' },
  actionResult: 'Blocker "Docs are out of date" added (id blk-601) to project proj-warden-01.',
  reply: 'Added a low-severity blocker "Docs are out of date" (blk-601) to Warden.',
}));
examples.push(exManage('iris', 'add a critical blocker to Acme: prod database is down', {
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-acme-02', description: 'Prod database is down', severity: 'critical' },
  actionResult: 'Blocker "Prod database is down" added (id blk-602) to project proj-acme-02.',
  reply: 'Added a critical blocker "Prod database is down" (blk-602) to Acme Migration.',
}));
examples.push(exManage('iris', 'add a medium blocker to Warden: the tests are slow', {
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-warden-01', description: 'The tests are slow', severity: 'medium' },
  actionResult: 'Blocker "The tests are slow" added (id blk-603) to project proj-warden-01.',
  reply: 'Added a medium blocker "The tests are slow" (blk-603) to Warden.',
}));
examples.push(exManage('iris', 'add a high-impact priority to Warden: ship v2', {
  actionTool: 'add_priority',
  actionArgs: { project_id: 'proj-warden-01', item: 'Ship v2', impact: 'high' },
  actionResult: 'Priority "Ship v2" added (id prio-604) to project proj-warden-01.',
  reply: 'Added a high-impact priority "Ship v2" (prio-604) to Warden.',
}));
examples.push(exManage('iris', 'add a low priority to my list: organize my desk', {
  actionTool: 'add_priority',
  actionArgs: { project_id: 'personal', item: 'Organize my desk', impact: 'low' },
  actionResult: 'Priority "Organize my desk" added (id prio-605) to project personal.',
  reply: 'Added a low priority "Organize my desk" (prio-605) to Personal.',
}));
examples.push(exManage('iris', "add a deliverable to Warden: write the docs, due 2026-09-20", {
  actionTool: 'add_deliverable',
  actionArgs: { project_id: 'proj-warden-01', name: 'Write the docs', due_date: '2026-09-20' },
  actionResult: 'Deliverable "Write the docs" added (id deliv-606) to project proj-warden-01.',
  reply: 'Added deliverable "Write the docs" (deliv-606) to Warden, due 2026-09-20.',
}));

// Trailing-clause severity (2026-09-08 dryfire: "…, high severity" omitted the
// severity field — every prior rep put severity BEFORE the noun, so the
// trailing form was untrained). Bake the trailing form with severity split out.
examples.push(exManage('iris', 'add a blocker to Warden (proj-warden-01): CI is flaky on arm64, high severity', {
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-warden-01', description: 'CI is flaky on arm64', severity: 'high' },
  actionResult: 'Blocker "CI is flaky on arm64" added (id blk-607) to project proj-warden-01.',
  reply: 'Added a high-severity blocker "CI is flaky on arm64" (blk-607) to Warden.',
}));
examples.push(exManage('iris', 'add a blocker to Acme (proj-acme-02): deploy pipeline breaks nightly, medium severity', {
  actionTool: 'add_blocker',
  actionArgs: { project_id: 'proj-acme-02', description: 'Deploy pipeline breaks nightly', severity: 'medium' },
  actionResult: 'Blocker "Deploy pipeline breaks nightly" added (id blk-608) to project proj-acme-02.',
  reply: 'Added a medium-severity blocker "Deploy pipeline breaks nightly" (blk-608) to Acme Migration.',
}));
examples.push(exManage('iris', 'add a priority to Warden (proj-warden-01): improve test coverage, high impact', {
  actionTool: 'add_priority',
  actionArgs: { project_id: 'proj-warden-01', item: 'Improve test coverage', impact: 'high' },
  actionResult: 'Priority "Improve test coverage" added (id prio-609) to project proj-warden-01.',
  reply: 'Added a high-impact priority "Improve test coverage" (prio-609) to Warden.',
}));

// ---- W13. Iris: financials / log_time — the brief carries the proj id; use
// returned proj-id, NEVER the project name as project_id. ----
examples.push(exManage('iris', 'set the Acme Migration budget to 80000', {
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-acme-02', budget: 80000 },
  actionResult: 'Financials updated for project proj-acme-02.',
  reply: 'Set Acme Migration (proj-acme-02) budget to $80,000.',
}));
examples.push(exManage('iris', 'update the Warden spent to 15000', {
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-warden-01', spent: 15000 },
  actionResult: 'Financials updated for project proj-warden-01.',
  reply: 'Set Warden (proj-warden-01) spent to $15,000.',
}));
examples.push(exManage('iris', 'set Warden revenue to 100000', {
  actionTool: 'update_financials',
  actionArgs: { project_id: 'proj-warden-01', revenue: 100000 },
  actionResult: 'Financials updated for project proj-warden-01.',
  reply: 'Set Warden (proj-warden-01) revenue to $100,000.',
}));
examples.push(exManage('iris', 'log 2 hours on the Warden project for today', {
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-warden-01', hours: 2 },
  actionResult: 'Logged 2 hours on project proj-warden-01.',
  reply: 'Logged 2h on Warden (proj-warden-01).',
}));
examples.push(exManage('iris', 'log 1.5 hours on Acme Migration', {
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-acme-02', hours: 1.5 },
  actionResult: 'Logged 1.5 hours on project proj-acme-02.',
  reply: 'Logged 1.5h on Acme Migration (proj-acme-02).',
}));
examples.push(exManage('iris', 'log 4 hours on Warden yesterday for the bug fix', {
  actionTool: 'log_time',
  actionArgs: { project_id: 'proj-warden-01', hours: 4, date: '2026-08-30', description: 'Bug fix' },
  actionResult: 'Logged 4 hours on project proj-warden-01 for 2026-08-30.',
  reply: 'Logged 4h on Warden (proj-warden-01) for 2026-08-30.',
}));

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

// ---- RG8. Work-management briefs (orch style: "Record/List/Break down …") -
examples.push(ex('iris', "Record a new work task: 'Buy new headphones' — add it to my personal list.",
  [{ name: 'create_work_task', arguments: { title: 'Buy new headphones', project_id: 'personal' } }],
  { results: ['Created work task "Buy new headphones" (id wt-2080) in project personal.'],
    reply: 'Created work task "Buy new headphones" (wt-2080) in Personal.' }));
examples.push(ex('iris', 'List my work tasks marked high priority.',
  [{ name: 'list_work_tasks', arguments: {} }],
  { results: ['3 tasks:\n1. wt-2003 | Ship the hotfix | proj-acme-02 | urgent | open\n2. wt-2002 | Write the API spec | personal | high | open\n3. wt-2001 | Fix the login bug | personal | high | open'],
    reply: '3 high/urgent tasks: Ship the hotfix (urgent), Write the API spec (high), and Fix the login bug (high).' }));
examples.push(ex('iris', 'List my work tasks that are past due / overdue.',
  [{ name: 'list_work_tasks', arguments: {} }],
  { results: ['2 tasks:\n1. wt-1002 | Fix login bug | personal | urgent | open | due 2026-08-31 (overdue)\n2. wt-2005 | Prepare the demo | personal | medium | open | due 2026-08-31 (overdue)'],
    reply: '2 overdue tasks, both due today: "Fix login bug" (urgent) and "Prepare the demo".' }));
examples.push(ex('iris', "Break the goal 'Launch Blog Update' into three subtasks — create each as a work task in the personal list.",
  [
    { name: 'create_work_task', arguments: { title: 'Draft the blog post', project_id: 'personal' } },
    { name: 'create_work_task', arguments: { title: 'Add images and formatting', project_id: 'personal' } },
    { name: 'create_work_task', arguments: { title: 'Publish and share the post', project_id: 'personal' } },
  ],
  { results: ['Created work task "Draft the blog post" (id wt-2090) in project personal.', 'Created work task "Add images and formatting" (id wt-2091) in project personal.', 'Created work task "Publish and share the post" (id wt-2092) in project personal.'],
    reply: 'Broke "Launch Blog Update" into 3 subtasks: Draft the blog post (wt-2090), Add images and formatting (wt-2091), Publish and share (wt-2092).' }));
// Real multi-item create flow, single-shot reality: the project is created
// first (its id comes back in the result — the orchestrator reads it from the
// reply), then the orchestrator re-briefs with the id for the deliverable +
// blocker pair (both named in one request → both calls in one turn).
examples.push(ex('iris', "Create a new work project called 'Jarvis Audit' — an audit of assistant capabilities and coverage.",
  [{ name: 'create_project', arguments: { name: 'Jarvis Audit', description: 'Audit of assistant capabilities and coverage.' } }],
  { results: ['Project "Jarvis Audit" created with id proj-jarvisaudit-01.'],
    reply: 'Created project "Jarvis Audit" (proj-jarvisaudit-01).' }));
examples.push(ex('iris', "Add a deliverable titled 'Capability Report' and a blocker 'No email account configured' (medium severity) to the Jarvis Audit project (proj-jarvisaudit-01).",
  [
    { name: 'add_deliverable', arguments: { project_id: 'proj-jarvisaudit-01', name: 'Capability Report' } },
    { name: 'add_blocker', arguments: { project_id: 'proj-jarvisaudit-01', description: 'No email account configured', severity: 'medium' } },
  ],
  { results: ['Deliverable "Capability Report" added (id deliv-700) to project proj-jarvisaudit-01.', 'Blocker "No email account configured" added (id blk-700) to project proj-jarvisaudit-01.'],
    reply: 'Added the "Capability Report" deliverable (deliv-700) and a "No email account configured" blocker (blk-700) to Jarvis Audit (proj-jarvisaudit-01).' }));

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