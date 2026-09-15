// Full toolcall-model SFT dataset generator.
//
// Produces JSONL for the single LoRA fine-tune that powers IRIS — the one
// toolcall agent since 2026-10-05, when byte was merged in (one toolcall agent,
// one fine-tuned model). The 2026-09-09 collapse stripped iris to the CORE:
// FOUR action-parameterized tools — email, task (scheduled reminders), calendar,
// alarm. Project management, work tasks, and admin were dropped entirely.
// Each row is OpenAI-style messages +
// a `tools` array, so the Granite chat template renders the EXACT system block
// + tool schemas the agent sees at inference, and the assistant target is a
// Granite tool call.
//
// IRIS IS MULTI-TURN (maxIterations: 3, raised from 1 on 2026-09-15): up to
// 3 sequential tool calls per request, each using a fact an earlier call
// returned (an id from a read/list, a filename from a get result); never
// repeating a call that already succeeded. Most rows are still ONE turn — one
// tool call (or a parallel set when the request names several things, e.g. the
// reminder+calendar pair); a small 2-turn section teaches the email chains
// (read→get, get→download) the third iteration exists for. Manage flows stay
// id-supplied: the orchestrator resolves ids (its own list dispatch) and the
// brief carries them.
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
//           email read/get/download/send/search.
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
const ANCHOR = 'Current local time is 2026-09-15T14:05:00 (timezone America/Vancouver). Compute every absolute timestamp from this.';
export { ANCHOR };

// ---- example builders ---------------------------------------------------

// Single agent since the byte merge — every builder below hard-fails on
// anything but 'iris' so a stale byte call site can't silently emit a
// never-seen-at-inference system prompt.
function assertIris(agent) {
  if (agent !== 'iris') {
    throw new Error(`ex('${agent}', ...) — iris is the only toolcall agent (byte merged 2026-10-05). Retag the call site.`);
  }
}

// Single-turn: user request → one tool call (or a parallel set when the
// request names several things), then an optional text reply (emitted as a
// separate assistant turn after a synthetic tool result). Every request gets
// the ANCHOR prepended — the dispatch path injects the time header into ALL
// iris tasks, work management included. 2-turn chains use exMulti below.
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

// Multi-turn chain (2026-09-15, maxIterations 1→3): user request → tool call
// → result → next tool call → result → … → final one-line reply. Each step's
// call must use a fact the PREVIOUS result returned (an id from a read, a
// filename from a get's Attachments line) — that dependency is the whole point
// of these rows. steps: [{ call: {name, arguments}, result }, …].
function exMulti(agent, request, steps, reply) {
  assertIris(agent);
  const msgs = [
    { role: 'system', content: IRIS_SYSTEM },
    { role: 'user', content: `${ANCHOR}\n\n${request}` },
  ];
  for (const s of steps) {
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ type: 'function', function: s.call }] });
    msgs.push({ role: 'tool', name: s.call.name, content: String(s.result) });
  }
  msgs.push({ role: 'assistant', content: reply });
  return { messages: msgs, tools: TOOLS.iris };
}

const examples = [];

// =========================================================================
// IRIS — scheduling (ported from the dexter-only generator: the proven
// failure classes). iris is single-shot; every example is one tool call (or
// parallel calls in one turn for "both reminder + calendar").
// =========================================================================

// ---- A. Relative once reminders (duration) — the clock-math bug class ----
examples.push(ex('iris', 'Set a one-time reminder to fire in 2 minutes (current time is 2026-09-15 2:05 PM America/Vancouver) with the message "Check the oven" — it should fire around 2:07 PM.',
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
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Pick up the kids.', schedule_type: 'once', schedule_value: '2026-09-15T15:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to pick up the kids at 3 PM today (2026-09-15T15:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to take your medication at 5:00 AM tomorrow morning (America/Vancouver).',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take your medication.', schedule_type: 'once', schedule_value: '2026-09-16T05:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take your medication at 5:00 tomorrow morning (2026-09-16T05:00:00).' }));
examples.push(ex('iris', 'At 9:30 AM on March 20, remind me to submit the quarterly report.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the quarterly report.', schedule_type: 'once', schedule_value: '2026-03-20T09:30:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the quarterly report at 9:30am on March 20 (2026-03-20T09:30:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to water the plants tonight at 8 PM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Water the plants.', schedule_type: 'once', schedule_value: '2026-09-15T20:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to water the plants tonight at 8pm (2026-09-15T20:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to call the dentist at noon tomorrow.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call the dentist to book an appointment.', schedule_type: 'once', schedule_value: '2026-09-16T12:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call the dentist at noon tomorrow (2026-09-16T12:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder for October 5 at 2:00 PM (America/Vancouver) to submit the visa application.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the visa application.', schedule_type: 'once', schedule_value: '2026-10-05T14:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the visa application on October 5 at 2pm (2026-10-05T14:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to renew your drivers license on October 1 at 9 AM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Renew your drivers license.', schedule_type: 'once', schedule_value: '2026-10-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your drivers license on October 1 at 9am (2026-10-01T09:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to take out the recycling tonight at 11:45 PM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Take out the recycling.', schedule_type: 'once', schedule_value: '2026-09-15T23:45:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take out the recycling tonight at 11:45pm (2026-09-15T23:45:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to catch your flight on October 10 at 8 AM.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Head to the airport — your flight is soon.', schedule_type: 'once', schedule_value: '2026-10-10T08:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to catch your flight on October 10 at 8am (2026-10-10T08:00:00).' }));

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

// ---- E. Manage flows (single-turn: id ALREADY SUPPLIED by the orchestrator) ----
// Task/calendar/alarm manage stays id-supplied: the orchestrator already ran
// the list, picked the id, and hands it to iris in the request. Each example
// below is ONE tool call with the id in the request. (Email is the one noun
// with in-dispatch chains — see the 2-turn section.)
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
  [{ name: 'calendar', arguments: { action: 'create', title: 'Project Review', start_time: '2026-09-16T14:00:00' } }],
  { reply: 'Created a "Project Review" calendar event tomorrow at 2pm (2026-09-16T14:00:00).' }));
examples.push(ex('iris', 'Schedule a dentist appointment on March 15 at 10 AM.',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-03-15T10:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event on March 15 at 10am.' }));
examples.push(ex('iris', 'Create an all-day calendar event on Friday called "Company Holiday".',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Company Holiday', start_time: '2026-09-18T00:00:00', all_day: true } }],
  { reply: 'Created an all-day "Company Holiday" calendar event on Friday 2026-09-18.' }));
examples.push(ex('iris', 'Create a 1-hour meeting at 3 PM today called "Team Sync".',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Team Sync', start_time: '2026-09-15T15:00:00', end_time: '2026-09-15T16:00:00' } }],
  { reply: 'Created a "Team Sync" meeting today 3–4pm (2026-09-15T15:00:00–16:00:00).' }));
examples.push(ex('iris', 'Book the conference room for a meeting tomorrow 10 AM to 11:30 AM called "Vendor Demo".',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Vendor Demo', start_time: '2026-09-16T10:00:00', end_time: '2026-09-16T11:30:00', location: 'Conference room' } }],
  { reply: 'Created a "Vendor Demo" in the conference room tomorrow 10–11:30am.' }));
examples.push(ex('iris', 'What is on my calendar this week?',
  [{ name: 'calendar', arguments: { action: 'list', start: '2026-09-14T00:00:00', end: '2026-09-20T23:59:59' } }],
  { results: ['2 events:\n1. 2026-09-16T14:00:00 → 2026-09-16T15:00:00 | Project Review (uid ev-1001)\n\n2. 2026-09-18T00:00:00 | Company Holiday (uid ev-1002)'],
    reply: 'This week you have: Project Review tomorrow 2–3pm (ev-1001), and an all-day Company Holiday on Friday (ev-1002).' }));
// Calendar manage (id supplied — single call).
examples.push(ex('iris', 'Delete the calendar event ev-1001 — the "Project Review" meeting tomorrow at 2 PM.',
  [{ name: 'calendar', arguments: { action: 'delete', event_id: 'ev-1001' } }],
  { results: ['Calendar event ev-1001 deleted.'],
    reply: 'Cancelled the Project Review meeting (ev-1001).' }));
examples.push(ex('iris', 'Move the calendar event ev-1001 (the 2 PM "Project Review" meeting) to 3 PM — set start_time to 2026-09-16T15:00:00 and end_time to 2026-09-16T16:00:00.',
  [{ name: 'calendar', arguments: { action: 'update', event_id: 'ev-1001', start_time: '2026-09-16T15:00:00', end_time: '2026-09-16T16:00:00' } }],
  { results: ['Calendar event ev-1001 updated.'],
    reply: 'Moved the Project Review from 2pm to 3pm tomorrow (ev-1001).' }));

// ---- G. Both reminder + calendar event in one turn ---------------------
examples.push(ex('iris', 'Set a 2 PM reminder about the meeting and create a calendar event for it at the same time.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'It is time for the meeting.', schedule_type: 'once', schedule_value: '2026-09-15T14:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Meeting', start_time: '2026-09-15T14:00:00' } },
  ],
  { reply: 'Set a 2pm reminder for the meeting and created a calendar event for it (2026-09-15T14:00:00).' }));
examples.push(ex('iris', 'Put a 3 PM "Project Review" meeting on my calendar tomorrow, and remind me 30 minutes before.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Project Review starts in 30 minutes.', schedule_type: 'once', schedule_value: '2026-09-16T14:30:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Project Review', start_time: '2026-09-16T15:00:00' } },
  ],
  { reply: 'Created a "Project Review" tomorrow at 3pm and set a reminder 30 minutes before, at 2:30pm.' }));

// ---- G2. Real production traffic (from logs/warden.log, 2026-09-15) -----
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
  'When should I remind you to renew your passport? Give me a date (e.g. "next Monday" or "October 10th").'));
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
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Go to the gym.', schedule_type: 'once', schedule_value: '2026-09-16T06:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to go to the gym at 6am tomorrow (2026-09-16T06:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to catch the bus at 7:30 AM on Monday.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Catch the bus.', schedule_type: 'once', schedule_value: '2026-09-16T07:30:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to catch the bus at 7:30am Monday (2026-09-16T07:30:00).' }));
examples.push(ex('iris', 'At 10 PM tonight remind me to brush my teeth.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Brush your teeth.', schedule_type: 'once', schedule_value: '2026-09-15T22:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to brush your teeth at 10pm tonight (2026-09-15T22:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to submit the report at 4 PM today.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the report.', schedule_type: 'once', schedule_value: '2026-09-15T16:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the report at 4pm today (2026-09-15T16:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to close the laptop at 9 PM tonight.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Close the laptop and wind down.', schedule_type: 'once', schedule_value: '2026-09-15T21:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to close the laptop at 9pm tonight (2026-09-15T21:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to wake up at 6:30 AM tomorrow.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Wake up.', schedule_type: 'once', schedule_value: '2026-09-16T06:30:00', context_mode: 'group' } }],
  { reply: 'Set a wake-up reminder for 6:30am tomorrow (2026-09-16T06:30:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to submit the timesheet at 11 AM on Friday.',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Submit the timesheet.', schedule_type: 'once', schedule_value: '2026-09-18T11:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the timesheet at 11am Friday (2026-09-18T11:00:00).' }));

// ---- W5. Both reminder + calendar in one turn, more reps ----
examples.push(ex('iris', 'Put a 4 PM dentist appointment on my calendar tomorrow and remind me an hour before.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Dentist appointment soon.', schedule_type: 'once', schedule_value: '2026-09-16T15:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-09-16T16:00:00' } },
  ],
  { reply: 'Created a 4pm dentist appointment tomorrow and set a reminder an hour before, at 3pm.' }));
examples.push(ex('iris', 'Schedule a 1 PM lunch meeting on Friday and remind me 15 minutes before.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Lunch meeting starts in 15 minutes.', schedule_type: 'once', schedule_value: '2026-09-18T12:45:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Lunch meeting', start_time: '2026-09-18T13:00:00' } },
  ],
  { reply: 'Created a 1pm Friday lunch meeting and set a reminder 15 minutes before, at 12:45pm.' }));
// Reinforcement for the "reminder … and create a calendar event called X"
// phrasing — the 2026-09-02 checkpoint emitted an EMPTY turn (no calls, no
// text) on this exact shape, deterministically. Same-time (not offset) pairs:
examples.push(ex('iris', 'Set a one-time reminder about the team meeting at 2:00 PM today, and create a calendar event called "Team meeting" at 2:00 PM today.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Team meeting.', schedule_type: 'once', schedule_value: '2026-09-15T14:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Team meeting', start_time: '2026-09-15T14:00:00' } },
  ],
  { reply: 'Set a 2pm reminder for the team meeting and created a "Team meeting" calendar event (2026-09-15T14:00:00).' }));
examples.push(ex('iris', 'Remind me at 5 PM today about the server restart, and create a calendar event called "Server restart" at 5 PM today.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Server restart.', schedule_type: 'once', schedule_value: '2026-09-15T17:00:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Server restart', start_time: '2026-09-15T17:00:00' } },
  ],
  { reply: 'Set a 5pm reminder for the server restart and created a "Server restart" calendar event (2026-09-15T17:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder about the phone call at 4:30 PM tomorrow, and create a calendar event called "Phone call" at 4:30 PM tomorrow.',
  [
    { name: 'task', arguments: { action: 'schedule', prompt: 'Phone call.', schedule_type: 'once', schedule_value: '2026-09-16T16:30:00', context_mode: 'group' } },
    { name: 'calendar', arguments: { action: 'create', title: 'Phone call', start_time: '2026-09-16T16:30:00' } },
  ],
  { reply: 'Set a 4:30pm reminder for the phone call and created a "Phone call" calendar event tomorrow (2026-09-16T16:30:00).' }));

// ---- W12. Calendar manage (id supplied — single call) -------------------
examples.push(ex('iris', 'Cancel the dentist appointment — delete calendar event ev-1003 (the Sep 3 10 AM dentist appointment).',
  [{ name: 'calendar', arguments: { action: 'delete', event_id: 'ev-1003' } }],
  { results: ['Calendar event ev-1003 deleted.'],
    reply: 'Cancelled the dentist appointment (ev-1003).' }));
examples.push(ex('iris', 'Reschedule the "Team Sync" — update event ev-1004 to start at 4 PM (2026-09-15T16:00:00) and end at 5 PM (2026-09-15T17:00:00).',
  [{ name: 'calendar', arguments: { action: 'update', event_id: 'ev-1004', start_time: '2026-09-15T16:00:00', end_time: '2026-09-15T17:00:00' } }],
  { results: ['Calendar event ev-1004 updated.'],
    reply: 'Moved the Team Sync from 3pm to 4pm today (ev-1004).' }));
examples.push(ex('iris', 'Cancel my meeting tomorrow — delete calendar event ev-1005 (the 9 AM standup on Sep 2).',
  [{ name: 'calendar', arguments: { action: 'delete', event_id: 'ev-1005' } }],
  { results: ['Calendar event ev-1005 deleted.'],
    reply: 'Cancelled tomorrow\'s 9am Standup (ev-1005).' }));
examples.push(ex('iris', 'Move the "Vendor Demo" — update event ev-1006 to 2 PM tomorrow (start 2026-09-16T14:00:00, end 2026-09-16T15:30:00).',
  [{ name: 'calendar', arguments: { action: 'update', event_id: 'ev-1006', start_time: '2026-09-16T14:00:00', end_time: '2026-09-16T15:30:00' } }],
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
  [{ name: 'alarm', arguments: { action: 'create', label: 'Airport run', alarm_time: '08:00', alarm_date: '2026-09-16', repeat_type: 'none' } }],
  { results: ['Alarm created: "Airport run" at 08:00 on 2026-09-16.'],
    reply: 'Set an 8:00am "Airport run" alarm for tomorrow (Sep 1) only.' }));
examples.push(ex('iris', 'Set an alarm for 6:45 AM on Monday, Wednesday and Friday called "Gym".',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Gym', alarm_time: '06:45', repeat_type: 'custom', repeat_days: 'mon,wed,fri' } }],
  { results: ['Alarm created: "Gym" at 06:45 (repeats custom).'],
    reply: 'Set a 6:45am "Gym" alarm for Mon/Wed/Fri.' }));
examples.push(ex('iris', 'Wake me up at 7:15 tomorrow morning — call it "Late start".',
  [{ name: 'alarm', arguments: { action: 'create', label: 'Late start', alarm_time: '07:15', alarm_date: '2026-09-16', repeat_type: 'none' } }],
  { results: ['Alarm created: "Late start" at 07:15 on 2026-09-16.'],
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
// (Result strings byte-match the runner's email handler: read = "N emails
// found:" + "[id: …] From: … | Subject: … | Date: …" + optional preview;
// get = "Email content:" + Attachments line; refresh/cached = the handler's
// own strings.)
examples.push(ex('iris', "What's in my inbox?",
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['5 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   Hi Dominic, the Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-44e1] From: newsletter@hackernews.com | Subject: HN Weekly | Date: 2026-09-15T08:40:00\n   Top stories this week, plus the usual roundup of links.\n3. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.\n4. [id: email-4f2a] From: jason@partnerco.com | Subject: Action required: sign the NDA | Date: 2026-09-14T14:20:00\n   Please review and sign the attached NDA so we can move forward with the partnership.\n5. [id: email-11a9] From: boss@acme.io | Subject: Monday standup moved to 11 | Date: 2026-09-14T11:00:00\n   Heads-up — standup moves to 11am from Monday.'],
    reply: '5 emails in your inbox. Actionable: Sarah (Q4 budget sign-off by Friday), Jason (sign NDA), boss (standup moved to 11). The rest are a newsletter and a Stripe receipt.' }));
examples.push(ex('iris', "Find emails from Sarah about the Q4 budget.",
  [{ name: 'email', arguments: { action: 'read', search: 'from:sarah Q4 budget', limit: 20 } }],
  { results: ['2 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-9b1c] From: sarah@acme.io | Subject: Q4 budget draft v2 | Date: 2026-09-12T10:05:00\n   Attached is draft v2 of the Q4 budget for your review.'],
    reply: 'Found 2 emails from Sarah about the Q4 budget: "Re: Q4 budget approval needed" (Sep 15) and "Q4 budget draft v2" (Sep 12).' }));
examples.push(ex('iris', "Show me emails from the last 24 hours.",
  [{ name: 'email', arguments: { action: 'read', since: '2026-09-14T14:05:00', limit: 50 } }],
  { results: ['3 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-44e1] From: newsletter@hackernews.com | Subject: HN Weekly | Date: 2026-09-15T08:40:00\n   Top stories this week, plus the usual roundup of links.\n3. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.'],
    reply: '3 emails in the last 24h: Sarah (budget sign-off), HN Weekly (newsletter), Stripe (paid receipt).' }));
// (The old "Open the email from Jason about the NDA" row lived here — a bare
// read + "want me to fetch the full body?" It taught stopping after the read,
// which the maxIterations 3 contract replaces: that request now chains
// read→get, covered by the 2-turn section below.)
examples.push(ex('iris', "Get me the FULL body of email email-4f2a (Jason's NDA email).",
  [{ name: 'email', arguments: { action: 'get', email_id: 'email-4f2a' } }],
  { results: ['Email content:\nFrom: jason@partnerco.com\nSubject: Action required: sign the NDA\nDate: 2026-09-14T14:20:00\n\nHi Dominic,\n\nPlease review and sign the attached NDA so we can move forward with the partnership. Let me know if you have questions.\n\n— Jason\n\nAttachments (1): NDA-partnership.pdf (245 KB)'],
    reply: 'Jason asks you to review and sign the attached NDA (NDA-partnership.pdf, 245 KB) to move the partnership forward. Full body fetched.' }));
examples.push(ex('iris', "Refresh my email cache.",
  [{ name: 'email', arguments: { action: 'refresh' } }],
  { results: ['Email cache refreshed: 42 emails cached.'],
    reply: 'Refreshed the email cache — 42 emails cached.' }));
examples.push(ex('iris', "What cached emails do you have?",
  [{ name: 'email', arguments: { action: 'cached' } }],
  { results: ['Cached emails:\n[\n  {\n    "id": "email-4f2a",\n    "from": "jason@partnerco.com",\n    "subject": "Action required: sign the NDA",\n    "date": "2026-09-14T14:20:00"\n  },\n  {\n    "id": "email-9b2f",\n    "from": "sarah@acme.io",\n    "subject": "Re: Q4 budget approval needed",\n    "date": "2026-09-15T09:12:00"\n  },\n  {\n    "id": "email-11a9",\n    "from": "boss@acme.io",\n    "subject": "Monday standup moved to 11",\n    "date": "2026-09-14T11:00:00"\n  }\n]'],
    reply: '3 cached emails: the NDA from Jason, Sarah\'s budget reply, and the standup-time change from your boss.' }));

// ---- T. Email: send -----------------------------------------------------
examples.push(ex('iris', "Reply to Sarah and tell her I'll sign off the Q4 budget by Friday.",
  [{ name: 'email', arguments: { action: 'send', to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: 'Hi Sarah,\n\nI\'ll sign off on the Q4 budget by Friday. Thanks for the heads-up.\n\n— Dominic' } }],
  { results: ['Email sent to sarah@acme.io with subject: Re: Q4 budget approval needed'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — I\'ll sign off the Q4 budget by Friday.' }));
examples.push(ex('iris', "Email Jason the signed NDA is attached.",
  [{ name: 'email', arguments: { action: 'send', to: 'jason@partnerco.com', subject: 'Re: Action required: sign the NDA', body: 'Hi Jason,\n\nSigned NDA attached. Ready to move forward.\n\n— Dominic' } }],
  { results: ['Email sent to jason@partnerco.com with subject: Re: Action required: sign the NDA'],
    reply: 'Sent the email to Jason (jason@partnerco.com) — signed NDA attached.' }));
examples.push(ex('iris', "Send a note to the team: standup is back to 10am Monday.",
  [{ name: 'email', arguments: { action: 'send', to: 'team@acme.io', subject: 'Standup back to 10am Monday', body: 'Heads-up: standup is back to 10am Monday.\n\n— Dominic' } }],
  { results: ['Email sent to team@acme.io with subject: Standup back to 10am Monday'],
    reply: 'Sent the standup update to the team (team@acme.io).' }));

// ---- T2. Email: download (single-turn — the brief carries id + filename) --
// The orchestrator already resolved both facts (its own read + get dispatches)
// and hands them to iris, exactly like the manage flows above.
examples.push(ex('iris', "Download the attachment NDA-partnership.pdf from the email email-4f2a (Jason's 'Action required: sign the NDA' email) and tell me where it lands.",
  [{ name: 'email', arguments: { action: 'download', email_id: 'email-4f2a', filename: 'NDA-partnership.pdf' } }],
  { results: ['Attachment saved: /home/dominic/Warden/data/email-attachments/email-4f2a_NDA-partnership.pdf (NDA-partnership.pdf, 251234 bytes). Use this path for any further work on the file.'],
    reply: "Saved NDA-partnership.pdf from Jason's NDA email (email-4f2a) to /home/dominic/Warden/data/email-attachments/email-4f2a_NDA-partnership.pdf." }));
examples.push(ex('iris', "Save the attachment Q4-budget-v2.xlsx from email email-9b2f (Sarah's Q4 budget email) — give me the file path.",
  [{ name: 'email', arguments: { action: 'download', email_id: 'email-9b2f', filename: 'Q4-budget-v2.xlsx' } }],
  { results: ['Attachment saved: /home/dominic/Warden/data/email-attachments/email-9b2f_Q4-budget-v2.xlsx (Q4-budget-v2.xlsx, 48210 bytes). Use this path for any further work on the file.'],
    reply: "Saved Q4-budget-v2.xlsx from Sarah's budget email (email-9b2f) to /home/dominic/Warden/data/email-attachments/email-9b2f_Q4-budget-v2.xlsx." }));
examples.push(ex('iris', "Download invoice-4421.pdf from email email-7d3e — the Stripe 'Invoice #4421 paid' receipt — so I have a local copy.",
  [{ name: 'email', arguments: { action: 'download', email_id: 'email-7d3e', filename: 'invoice-4421.pdf' } }],
  { results: ['Attachment saved: /home/dominic/Warden/data/email-attachments/email-7d3e_invoice-4421.pdf (invoice-4421.pdf, 96500 bytes). Use this path for any further work on the file.'],
    reply: 'Saved invoice-4421.pdf from the Stripe receipt (email-7d3e) to /home/dominic/Warden/data/email-attachments/email-7d3e_invoice-4421.pdf.' }));
examples.push(ex('iris', "Pull the shipping label label-48215.pdf out of email email-a1b2 (the orders@shop.io 'Order #48215 shipped' email) and save it.",
  [{ name: 'email', arguments: { action: 'download', email_id: 'email-a1b2', filename: 'label-48215.pdf' } }],
  { results: ['Attachment saved: /home/dominic/Warden/data/email-attachments/email-a1b2_label-48215.pdf (label-48215.pdf, 33400 bytes). Use this path for any further work on the file.'],
    reply: 'Saved label-48215.pdf from the Order #48215 email (email-a1b2) to /home/dominic/Warden/data/email-attachments/email-a1b2_label-48215.pdf.' }));

// ---- U. Email 2-turn chains (read→get, get→download — the maxIterations 3
// contract: call 2 must use an id/filename call 1's result returned) --------
examples.push(exMulti('iris', 'Find the email from Jason about the NDA and show me the full body.',
  [
    { call: { name: 'email', arguments: { action: 'read', search: 'from:jason NDA', limit: 10 } },
      result: '1 email found:\n1. [id: email-4f2a] From: jason@partnerco.com | Subject: Action required: sign the NDA | Date: 2026-09-14T14:20:00\n   Please review and sign the attached NDA so we can move forward with the partnership.' },
    { call: { name: 'email', arguments: { action: 'get', email_id: 'email-4f2a' } },
      result: 'Email content:\nFrom: jason@partnerco.com\nSubject: Action required: sign the NDA\nDate: 2026-09-14T14:20:00\n\nHi Dominic,\n\nPlease review and sign the attached NDA so we can move forward with the partnership. Let me know if you have questions.\n\n— Jason\n\nAttachments (1): NDA-partnership.pdf (245 KB)' },
  ],
  "Jason's NDA email (email-4f2a, Sep 14): review and sign the attached NDA (NDA-partnership.pdf, 245 KB) to move the partnership forward."));
examples.push(exMulti('iris', "Look up Sarah's latest email about the Q4 budget and show me what she needs.",
  [
    { call: { name: 'email', arguments: { action: 'read', search: 'from:sarah Q4 budget', limit: 20 } },
      result: '2 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-9b1c] From: sarah@acme.io | Subject: Q4 budget draft v2 | Date: 2026-09-12T10:05:00\n   Attached is draft v2 of the Q4 budget for your review.' },
    { call: { name: 'email', arguments: { action: 'get', email_id: 'email-9b2f' } },
      result: 'Email content:\nFrom: sarah@acme.io\nSubject: Re: Q4 budget approval needed\nDate: 2026-09-15T09:12:00\n\nHi Dominic,\n\nThe Q4 budget needs your sign-off by Friday — draft v2 is attached. Let me know if anything looks off.\n\n— Sarah\n\nAttachments (1): Q4-budget-v2.xlsx (47 KB)' },
  ],
  'Sarah (email-9b2f) needs the Q4 budget signed off by Friday; draft v2 (Q4-budget-v2.xlsx) is attached.'));
examples.push(exMulti('iris', 'Get the full body of the email from billing@stripe.com about invoice #4421 and tell me the total.',
  [
    { call: { name: 'email', arguments: { action: 'read', search: 'from:billing 4421', limit: 10 } },
      result: '1 email found:\n1. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00. A PDF copy is attached.' },
    { call: { name: 'email', arguments: { action: 'get', email_id: 'email-7d3e' } },
      result: 'Email content:\nFrom: billing@stripe.com\nSubject: Invoice #4421 paid\nDate: 2026-09-14T17:55:00\n\nHi Dominic,\n\nYour invoice #4421 was paid — total $199.00. A PDF copy is attached.\n\n— Stripe Billing\n\nAttachments (1): invoice-4421.pdf (94 KB)' },
  ],
  'Stripe invoice #4421 (email-7d3e) is paid — total $199.00, PDF copy attached (invoice-4421.pdf).'));
examples.push(exMulti('iris', "Download the NDA attachment from email email-4f2a (Jason's NDA email).",
  [
    { call: { name: 'email', arguments: { action: 'get', email_id: 'email-4f2a' } },
      result: 'Email content:\nFrom: jason@partnerco.com\nSubject: Action required: sign the NDA\nDate: 2026-09-14T14:20:00\n\nHi Dominic,\n\nPlease review and sign the attached NDA so we can move forward with the partnership. Let me know if you have questions.\n\n— Jason\n\nAttachments (1): NDA-partnership.pdf (245 KB)' },
    { call: { name: 'email', arguments: { action: 'download', email_id: 'email-4f2a', filename: 'NDA-partnership.pdf' } },
      result: 'Attachment saved: /home/dominic/Warden/data/email-attachments/email-4f2a_NDA-partnership.pdf (NDA-partnership.pdf, 251234 bytes). Use this path for any further work on the file.' },
  ],
  'Saved NDA-partnership.pdf from email-4f2a to /home/dominic/Warden/data/email-attachments/email-4f2a_NDA-partnership.pdf (251234 bytes).'));
examples.push(exMulti('iris', "Save the budget spreadsheet attached to email email-9b2f (Sarah's Q4 budget email) — I need the file.",
  [
    { call: { name: 'email', arguments: { action: 'get', email_id: 'email-9b2f' } },
      result: 'Email content:\nFrom: sarah@acme.io\nSubject: Re: Q4 budget approval needed\nDate: 2026-09-15T09:12:00\n\nHi Dominic,\n\nThe Q4 budget needs your sign-off by Friday — draft v2 is attached. Let me know if anything looks off.\n\n— Sarah\n\nAttachments (1): Q4-budget-v2.xlsx (47 KB)' },
    { call: { name: 'email', arguments: { action: 'download', email_id: 'email-9b2f', filename: 'Q4-budget-v2.xlsx' } },
      result: 'Attachment saved: /home/dominic/Warden/data/email-attachments/email-9b2f_Q4-budget-v2.xlsx (Q4-budget-v2.xlsx, 48210 bytes). Use this path for any further work on the file.' },
  ],
  "Saved Q4-budget-v2.xlsx from Sarah's email (email-9b2f) to /home/dominic/Warden/data/email-attachments/email-9b2f_Q4-budget-v2.xlsx."));
examples.push(exMulti('iris', "Email email-11d0 from support@saas.io has the maintenance plan attached — download just the plan PDF, not the ticket transcript.",
  [
    { call: { name: 'email', arguments: { action: 'get', email_id: 'email-11d0' } },
      result: 'Email content:\nFrom: support@saas.io\nSubject: Maintenance window Sunday\nDate: 2026-09-11T15:40:00\n\nHi Dominic,\n\nSunday\'s maintenance window runs 02:00–04:00. The plan and the ticket transcript are attached.\n\n— Support\n\nAttachments (2): maintenance-plan.pdf (210 KB), ticket-4421-transcript.txt (6 KB)' },
    { call: { name: 'email', arguments: { action: 'download', email_id: 'email-11d0', filename: 'maintenance-plan.pdf' } },
      result: 'Attachment saved: /home/dominic/Warden/data/email-attachments/email-11d0_maintenance-plan.pdf (maintenance-plan.pdf, 215040 bytes). Use this path for any further work on the file.' },
  ],
  'Saved maintenance-plan.pdf from the support email (email-11d0) to /home/dominic/Warden/data/email-attachments/email-11d0_maintenance-plan.pdf.'));
// The full 3-call chain — the outer edge of the maxIterations: 3 contract.
examples.push(exMulti('iris', "Find Sarah's Q4 budget email, open it, and save the attached spreadsheet.",
  [
    { call: { name: 'email', arguments: { action: 'read', search: 'from:sarah Q4 budget', limit: 20 } },
      result: '2 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-9b1c] From: sarah@acme.io | Subject: Q4 budget draft v2 | Date: 2026-09-12T10:05:00\n   Attached is draft v2 of the Q4 budget for your review.' },
    { call: { name: 'email', arguments: { action: 'get', email_id: 'email-9b2f' } },
      result: 'Email content:\nFrom: sarah@acme.io\nSubject: Re: Q4 budget approval needed\nDate: 2026-09-15T09:12:00\n\nHi Dominic,\n\nThe Q4 budget needs your sign-off by Friday — draft v2 is attached. Let me know if anything looks off.\n\n— Sarah\n\nAttachments (1): Q4-budget-v2.xlsx (47 KB)' },
    { call: { name: 'email', arguments: { action: 'download', email_id: 'email-9b2f', filename: 'Q4-budget-v2.xlsx' } },
      result: 'Attachment saved: /home/dominic/Warden/data/email-attachments/email-9b2f_Q4-budget-v2.xlsx (Q4-budget-v2.xlsx, 48210 bytes). Use this path for any further work on the file.' },
  ],
  "Saved Q4-budget-v2.xlsx from Sarah's budget reply (email-9b2f) to /home/dominic/Warden/data/email-attachments/email-9b2f_Q4-budget-v2.xlsx."));

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
  { results: ['5 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-44e1] From: newsletter@hackernews.com | Subject: HN Weekly | Date: 2026-09-15T08:40:00\n   Top stories this week, plus the usual roundup of links.\n3. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.\n4. [id: email-4f2a] From: jason@partnerco.com | Subject: Action required: sign the NDA | Date: 2026-09-14T14:20:00\n   Please review and sign the attached NDA so we can move forward with the partnership.\n5. [id: email-11a9] From: boss@acme.io | Subject: Standup moved to 11 | Date: 2026-09-14T11:00:00\n   Heads-up — standup moves to 11am from Monday.'],
    reply: '5 recent emails. Actionable: Sarah (budget sign-off by Friday), Jason (sign NDA), boss (standup moved to 11). The rest are a newsletter and a Stripe receipt.' }));
examples.push(ex('iris', 'Check the inbox and list my recent emails.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['4 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-44e1] From: newsletter@hackernews.com | Subject: HN Weekly | Date: 2026-09-15T08:40:00\n   Top stories this week, plus the usual roundup of links.\n3. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.\n4. [id: email-4f2a] From: jason@partnerco.com | Subject: Action required: sign the NDA | Date: 2026-09-14T14:20:00\n   Please review and sign the attached NDA so we can move forward with the partnership.'],
    reply: '4 emails in your inbox. Actionable: Sarah (budget sign-off) and Jason (sign NDA).' }));
examples.push(ex('iris', 'Check the inbox for any new email received today.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-09-15T00:00:00', limit: 50 } }],
  { results: ['2 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-44e1] From: newsletter@hackernews.com | Subject: HN Weekly | Date: 2026-09-15T08:40:00\n   Top stories this week, plus the usual roundup of links.'],
    reply: '2 emails today: Sarah (budget sign-off needed) and an HN newsletter.' }));
examples.push(ex('iris', 'Read the inbox and list the emails.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['3 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.\n3. [id: email-4f2a] From: jason@partnerco.com | Subject: Action required: sign the NDA | Date: 2026-09-14T14:20:00\n   Please review and sign the attached NDA so we can move forward with the partnership.'],
    reply: '3 emails: Sarah (budget sign-off), Stripe (receipt), Jason (sign NDA).' }));
examples.push(ex('iris', 'Check the inbox for any email received in the last hour.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-09-15T13:05:00', limit: 20 } }],
  { results: ['1 email found:\n1. [id: email-c1b0] From: ci-bot@warden | Subject: Build #1284 failed | Date: 2026-09-15T13:42:00\n   Pipeline run #1284 failed at the test stage — see the logs for the failing job.'],
    reply: '1 email in the last hour: CI bot — Build #1284 failed. Want me to dig in?' }));

// ---- W9. Iris: email(action="send") with explicit, clean args (kill schema-as-args) ----
examples.push(ex('iris', 'Send an email to jason@partnerco.com with subject "NDA signed" and body "All done, signed and attached."',
  [{ name: 'email', arguments: { action: 'send', to: 'jason@partnerco.com', subject: 'NDA signed', body: 'All done, signed and attached.' } }],
  { results: ['Email sent to jason@partnerco.com with subject: NDA signed'],
    reply: 'Sent the email to jason@partnerco.com ("NDA signed").' }));
examples.push(ex('iris', 'Email sarah@acme.io saying the budget is approved.',
  [{ name: 'email', arguments: { action: 'send', to: 'sarah@acme.io', subject: 'Q4 budget approved', body: 'Hi Sarah,\n\nThe Q4 budget is approved.\n\n— Dominic' } }],
  { results: ['Email sent to sarah@acme.io with subject: Q4 budget approved'],
    reply: 'Sent the email to sarah@acme.io — Q4 budget is approved.' }));
examples.push(ex('iris', 'Compose an email to team@acme.io about the standup change to 11am.',
  [{ name: 'email', arguments: { action: 'send', to: 'team@acme.io', subject: 'Standup moved to 11am', body: 'Heads-up: standup is now at 11am.\n\n— Dominic' } }],
  { results: ['Email sent to team@acme.io with subject: Standup moved to 11am'],
    reply: 'Sent the standup change to the team (team@acme.io).' }));
examples.push(ex('iris', 'Reply to boss@acme.io confirming the 11am standup works for me.',
  [{ name: 'email', arguments: { action: 'send', to: 'boss@acme.io', subject: 'Re: Standup moved to 11', body: '11am works for me. Thanks.\n\n— Dominic' } }],
  { results: ['Email sent to boss@acme.io with subject: Re: Standup moved to 11'],
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
//   1. "tomorrow to pay rent" → model gave absolute 2026-09-16T00:00:00
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
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call mom.', schedule_type: 'once', schedule_value: '2026-09-16T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call mom tomorrow at 9am (2026-09-16T09:00:00).' }));
examples.push(ex('iris', 'Set a one-time reminder to prep the standup tomorrow morning (around 9:00 AM).',
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Prep the standup.', schedule_type: 'once', schedule_value: '2026-09-16T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to prep the standup tomorrow morning (2026-09-16T09:00:00).' }));

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
  { results: ['Email sent to sarah@acme.io with subject: Re: Q4 budget approval needed'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — I will sign off the Q4 budget by Friday.' }));
examples.push(ex('iris', "Reply to Jason and tell him the NDA is signed — send the reply.",
  [{ name: 'email', arguments: { action: 'send', to: 'jason@partnerco.com', subject: 'Re: Action required: sign the NDA', body: 'Hi Jason,\n\nSigned the NDA — ready to move forward.\n\n— Dominic' } }],
  { results: ['Email sent to jason@partnerco.com with subject: Re: Action required: sign the NDA'],
    reply: 'Sent the reply to Jason (jason@partnerco.com) — NDA signed.' }));
examples.push(ex('iris', "Reply to Sarah's 'Q4 budget approval needed' email and tell her I'll sign off the Q4 budget by Friday.",
  [{ name: 'email', arguments: { action: 'send', to: 'sarah@acme.io', subject: 'Re: Q4 budget approval needed', body: "Hi Sarah,\n\nI'll sign off on the Q4 budget by Friday.\n\n— Dominic" } }],
  { results: ['Email sent to sarah@acme.io with subject: Re: Q4 budget approval needed'],
    reply: 'Sent the reply to Sarah (sarah@acme.io) — Q4 budget sign-off by Friday.' }));
examples.push(ex('iris', "Send an email to alex@example.com asking for a meeting next Thursday — then confirm it's sent.",
  [{ name: 'email', arguments: { action: 'send', to: 'alex@example.com', subject: 'Meeting next Thursday?', body: 'Hi Alex,\n\nAre you free for a meeting next Thursday? Let me know what time works.\n\n— Dominic' } }],
  { results: ['Email sent to alex@example.com with subject: Meeting next Thursday?'],
    reply: 'Sent the email to alex@example.com asking for a meeting next Thursday.' }));
examples.push(ex('iris', "Email my boss at boss@acme.io to confirm the standup moved to 11am — reply to the standup thread.",
  [{ name: 'email', arguments: { action: 'send', to: 'boss@acme.io', subject: 'Re: Standup moved to 11', body: '11am works for me — confirmed. Thanks.\n\n— Dominic' } }],
  { results: ['Email sent to boss@acme.io with subject: Re: Standup moved to 11'],
    reply: 'Sent the confirmation to your boss (boss@acme.io) — 11am standup confirmed.' }));

// ---- RG4. Calendar briefs (orch style: "Create a calendar event …") -----
examples.push(ex('iris', "Create a calendar event tomorrow at 2:00 PM called 'Dentist appointment'.",
  [{ name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-09-16T14:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event tomorrow at 2pm (2026-09-16T14:00:00).' }));
examples.push(ex('iris', 'Create a calendar event for next Tuesday at 3:00 PM — a dentist appointment.',
  [{ name: 'calendar', arguments: { action: 'create', title: 'Dentist appointment', start_time: '2026-09-16T15:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event next Tuesday at 3pm (2026-09-16T15:00:00).' }));
examples.push(ex('iris', "Create a calendar event this Friday at 6:00 PM called 'Poker night'.",
  [{ name: 'calendar', arguments: { action: 'create', title: 'Poker night', start_time: '2026-09-18T18:00:00' } }],
  { reply: 'Created a "Poker night" calendar event Friday at 6pm (2026-09-18T18:00:00).' }));
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
  [{ name: 'task', arguments: { action: 'schedule', prompt: 'Call Sam.', schedule_type: 'once', schedule_value: '2026-09-15T18:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call Sam at 6pm today (2026-09-15T18:00:00).' }));
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
  [{ name: 'email', arguments: { action: 'read', search: 'from:support', since: '2026-09-08T14:05:00', limit: 50 } }],
  { results: ['2 emails found:\n1. [id: email-11d0] From: support@saas.io | Subject: Ticket #4421 resolved | Date: 2026-09-13T10:11:00\n   Your ticket #4421 is resolved — see the transcript for details.\n2. [id: email-11c7] From: support@saas.io | Subject: Maintenance window Sunday | Date: 2026-09-11T15:40:00\n   Sunday\'s maintenance window runs 02:00–04:00.'],
    reply: '2 emails from support in the last 7 days: ticket #4421 resolved (Sep 13) and a Sunday maintenance window (Sep 11).' }));
examples.push(ex('iris', 'Search the emails for one containing the word "invoice" and report the total amount mentioned in it.',
  [{ name: 'email', arguments: { action: 'read', search: 'invoice', limit: 20 } }],
  { results: ['1 email found:\n1. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.'],
    reply: 'Found 1 invoice email: Stripe "Invoice #4421 paid" (Sep 14), total $199.00.' }));
examples.push(ex('iris', 'List my unread emails grouped by sender.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['4 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-44e1] From: newsletter@hackernews.com | Subject: HN Weekly | Date: 2026-09-15T08:40:00\n   Top stories this week, plus the usual roundup of links.\n3. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.\n4. [id: email-4f2a] From: jason@partnerco.com | Subject: Action required: sign the NDA | Date: 2026-09-14T14:20:00\n   Please review and sign the attached NDA so we can move forward with the partnership.'],
    reply: '4 unread, by sender: Sarah (budget sign-off), Jason (sign NDA), Stripe (receipt), Hacker News (newsletter).' }));
examples.push(ex('iris', 'Check for any new email received in the past hour.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-09-15T13:05:00', limit: 20 } }],
  { results: ['1 email found:\n1. [id: email-c1b0] From: ci-bot@warden | Subject: Build #1284 failed | Date: 2026-09-15T13:42:00\n   Pipeline run #1284 failed at the test stage — see the logs for the failing job.'],
    reply: '1 new email in the past hour: CI bot — Build #1284 failed.' }));
examples.push(ex('iris', 'Check for any emails received today that I should not have missed.',
  [{ name: 'email', arguments: { action: 'read', since: '2026-09-15T00:00:00', limit: 50 } }],
  { results: ['2 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-44e1] From: newsletter@hackernews.com | Subject: HN Weekly | Date: 2026-09-15T08:40:00\n   Top stories this week, plus the usual roundup of links.'],
    reply: '2 emails today: Sarah (Q4 budget sign-off by Friday — worth acting on) and an HN newsletter (no action).' }));
examples.push(ex('iris', 'Check whether I have any important emails in the inbox.',
  [{ name: 'email', arguments: { action: 'read',} }],
  { results: ['3 emails found:\n1. [id: email-9b2f] From: sarah@acme.io | Subject: Re: Q4 budget approval needed | Date: 2026-09-15T09:12:00\n   The Q4 budget needs your sign-off by Friday — draft v2 is attached.\n2. [id: email-4f2a] From: jason@partnerco.com | Subject: Action required: sign the NDA | Date: 2026-09-14T14:20:00\n   Please review and sign the attached NDA so we can move forward with the partnership.\n3. [id: email-7d3e] From: billing@stripe.com | Subject: Invoice #4421 paid | Date: 2026-09-14T17:55:00\n   Your invoice #4421 was paid — total $199.00.'],
    reply: '2 look important: Sarah needs the Q4 budget signed off by Friday, and Jason needs the NDA signed. The Stripe email is just a paid receipt.' }));
examples.push(ex('iris', 'Find the email for order #48215 and pull the tracking info out of it.',
  [{ name: 'email', arguments: { action: 'read', search: '48215', limit: 10 } }],
  { results: ['1 email found:\n1. [id: email-a1b2] From: orders@shop.io | Subject: Order #48215 shipped | Date: 2026-09-14T11:00:00\n   Your order #48215 shipped — tracking 1Z999AA10123456784.'],
    reply: 'Found order #48215 (orders@shop.io, Sep 14): tracking number 1Z999AA10123456784.' }));


// =========================================================================
// EMAIL BREADTH — systematic combinatorial rows (2026-09-15 expansion).
// iris answers at temperature 0, so it does what it SAW: breadth means MANY
// phrasings of the same canonical call, not new logic. This section is a
// DETERMINISTIC generator — a mulberry32 seeded PRNG (fixed seed, so regens
// are byte-stable) over banks of senders/subjects/attachments/phrasings; the
// request is paraphrased every time, the tool args stay canonical. Result
// strings byte-match the live email handler:
//   read     → "N emails found:" + "i. [id: …] From: … | Subject: … | Date: …" + "\n   <preview>"
//   get      → "Email content:" + body + "\n\nAttachments (n): name (KB), …"
//   download → "Attachment saved: /home/dominic/Warden/data/email-attachments/<id>_<file> (<file>, <bytes> bytes). Use this path for any further work on the file."
//   send     → "Email sent to <addr> with subject: <subject>"
//   refresh  → "Email cache refreshed: <n> emails cached."
// Scheduling chains use the alarm/calendar LIST result formats (task list is
// deliberately NOT chained: its list action is fire-and-forget in production —
// the model never sees task ids from a list, so a list→act task chain would
// train fabrication).
// =========================================================================

// ---- deterministic PRNG --------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260915);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
function pickDistinct(arr, n) {
  const out = [];
  while (out.length < n && out.length < arr.length) {
    const x = pick(arr);
    if (!out.includes(x)) out.push(x);
  }
  return out;
}
function hexId() {
  let s = '';
  for (let i = 0; i < 4; i++) s += '0123456789abcdef'[Math.floor(rng() * 16)];
  return `email-${s}`;
}

// ---- time helpers (UTC math on the anchor date; output strings carry no
// offset, matching the ANCHOR header) --------------------------------------
const ANCHOR_MS = Date.UTC(2026, 8, 15, 14, 5, 0);   // 2026-09-15T14:05:00
const pad2 = (x) => String(x).padStart(2, '0');
function isoAt(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:00`;
}
const isoAgoMin = (m) => isoAt(ANCHOR_MS - m * 60000);
const isoAgoH = (h) => isoAgoMin(Math.round(h * 60));
const dayAt = (d, hh, mm) => isoAt(Date.UTC(2026, 8, 15, hh, mm, 0) - d * 86400000);

// ---- result-format helpers (byte-match the handler) -----------------------
function fmtRead(items) {
  const lines = items.map((it, i) => {
    const prev = it.preview ? `\n   ${it.preview}` : '';
    return `${i + 1}. [id: ${it.id}] From: ${it.a} | Subject: ${it.s} | Date: ${it.date}${prev}`;
  });
  return `${items.length} emails found:\n${lines.join('\n')}`;
}
const kbOf = (bytes) => Math.max(1, Math.round(bytes / 1024));
function attLine(atts) {
  return atts.length
    ? `\n\nAttachments (${atts.length}): ${atts.map((x) => `${x.f} (${kbOf(x.z)} KB)`).join(', ')}`
    : '';
}
function fmtGet(from, subject, date, body, atts) {
  return `Email content:\nFrom: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${body}${attLine(atts)}`;
}
const ATT_DIR = '/home/dominic/Warden/data/email-attachments';
function fmtDownload(emailId, att) {
  return `Attachment saved: ${ATT_DIR}/${emailId}_${att.f} (${att.f}, ${att.z} bytes). Use this path for any further work on the file.`;
}
const fmtSend = (to, subject) => `Email sent to ${to} with subject: ${subject}`;

// ---- scenario banks -------------------------------------------------------
// n=name a=addr s=subject f=first-name p=preview b=body k=kind t=reply tag
// q=search-query words. k drives the reply style: action/meeting items are
// "actionable", the rest are noise (newsletters, receipts, shipping, …).
const SCEN = [
  { n: 'Sarah Chen', a: 'sarah.chen@acme.io', s: 'Re: Q4 budget approval needed', p: 'The Q4 budget needs your sign-off by Friday — draft v2 is attached.', b: 'Hi Dominic,\n\nThe Q4 budget needs your sign-off by Friday — draft v2 is attached. Let me know if anything looks off.\n\n— Sarah', k: 'action', t: 'Q4 budget sign-off by Friday', q: 'sarah budget' },
  { n: 'Jason Miller', a: 'jason.miller@partnerco.com', s: 'Action required: sign the NDA', p: 'Please review and sign the attached NDA so we can move forward with the partnership.', b: 'Hi Dominic,\n\nPlease review and sign the attached NDA so we can move forward with the partnership. Let me know if you have questions.\n\n— Jason', k: 'action', t: 'sign the NDA', q: 'jason NDA' },
  { n: 'Priya Nair', a: 'priya.nair@acme.io', s: 'Need your review on the migration plan by Thursday', p: 'The migration plan is ready for your review — Thursday is the cutoff.', b: 'Hi Dominic,\n\nThe migration plan is ready for your review and Thursday is the cutoff before we lock the schedule. Your call on the rollback section especially.\n\n— Priya', k: 'action', t: 'migration plan review by Thursday', q: 'priya migration' },
  { n: 'Marco Diaz', a: 'marco.diaz@acme.io', s: 'Re: design doc feedback', p: 'Left my comments in the doc — mostly on the auth flow.', b: 'Hi Dominic,\n\nLeft my comments in the design doc — mostly on the auth flow. Nothing blocking, just tighten the error paths.\n\n— Marco', k: 'action', t: 'design doc feedback', q: 'marco design' },
  { n: 'Lena Kowalski', a: 'lena.kowalski@acme.io', s: 'Can you approve the vendor renewal?', p: 'The vendor renewal needs an approver before the end of the month.', b: 'Hi Dominic,\n\nThe vendor renewal is due before the end of the month and needs an approver. It is the same terms as last year, just the paperwork.\n\n— Lena', k: 'action', t: 'approve the vendor renewal', q: 'lena vendor renewal' },
  { n: 'Tom Okafor', a: 'tom.okafor@acme.io', s: 'Decision needed: office move floor plan', p: 'Two floor-plan options for the new office — need a decision this week.', b: 'Hi Dominic,\n\nWe have two floor-plan options for the new office and need a decision this week so facilities can start. Both attached to the shared drive.\n\n— Tom', k: 'action', t: 'office move floor-plan decision', q: 'tom floor plan' },
  { n: 'Dana Whitfield', a: 'boss@acme.io', s: 'Monday standup moved to 11', p: 'Heads-up — standup moves to 11am from Monday.', b: 'Hi Dominic,\n\nHeads-up — standup moves to 11am from Monday to make room for the quarterly review. Flag it if that clashes with anything.\n\n— Dana', k: 'meeting', t: 'standup moved to 11', q: 'standup' },
  { n: 'Dana Whitfield', a: 'boss@acme.io', s: 'Invite: quarterly review Thu 3pm', p: 'Calendar invite for the quarterly review — Thursday 3pm, main room.', b: 'Hi Dominic,\n\nCalendar invite for the quarterly review is out — Thursday 3pm, main room. Bring the Q4 numbers you and Sarah are working on.\n\n— Dana', k: 'meeting', t: 'quarterly review Thu 3pm', q: 'dana quarterly review' },
  { n: 'Priya Nair', a: 'priya.nair@acme.io', s: 'Rescheduled: 1:1 moved to Wednesday', p: 'Our 1:1 moves to Wednesday 10am — conflict on the old slot.', b: 'Hi Dominic,\n\nOur 1:1 moves to Wednesday 10am — something came up on the old slot. Same agenda.\n\n— Priya', k: 'meeting', t: '1:1 moved to Wednesday', q: 'priya 1:1' },
  { n: 'Alex Turner', a: 'alex.turner@studio-nine.com', s: 'Lunch Thursday?', p: 'Are you free for lunch Thursday — the new ramen place?', b: 'Hi Dominic,\n\nAre you free for lunch Thursday? The new ramen place opened near your office and I hear the tonkotsu is worth the queue.\n\n— Alex', k: 'personal', t: 'lunch Thursday', q: 'alex lunch' },
  { n: 'Rachel Voss', a: 'rachel.voss@gmail.com', s: 'Photos from the hike', p: 'Grouse Mountain photos are up — the ridge shot came out great.', b: 'Hey,\n\nGrouse Mountain photos are up in the shared album — the ridge shot came out great. We should do the full loop next time.\n\n— Rachel', k: 'personal', t: 'hike photos', q: 'rachel hike' },
  { n: 'Joe Brennan', a: 'uncle.joe.brennan@shaw.ca', s: 'Thanks for the visit', p: 'Great having you up at the lake last weekend — come back before the snow.', b: 'Dom,\n\nGreat having you up at the lake last weekend. Come back before the snow and bring the telescope this time.\n\n— Uncle Joe', k: 'personal', t: 'thanks for the visit', q: 'joe lake' },
  { n: 'Hacker News', a: 'newsletter@hackernews.com', s: 'HN Weekly', p: 'Top stories this week, plus the usual roundup of links.', b: 'Top stories this week, plus the usual roundup of links. Unsubscribe below if this is no longer relevant to you.', k: 'newsletter', t: 'an HN newsletter', q: 'hackernews weekly' },
  { n: 'The Pragmatic Engineer', a: 'digest@pragmaticengineer.com', s: 'The Pragmatic Engineer — issue 112', p: 'Inside the platform team re-org, plus a deep dive on incident reviews.', b: 'Inside the platform team re-org, plus a deep dive on incident reviews. Read online or in your email client.', k: 'newsletter', t: 'a newsletter', q: 'pragmatic engineer' },
  { n: 'Morning Digest', a: 'hello@morningdigest.io', s: 'Your 5-minute morning read', p: 'Three stories to start the day, curated for you.', b: 'Three stories to start the day, curated for you. Manage your preferences at any time.', k: 'newsletter', t: 'a newsletter', q: 'morning digest' },
  { n: 'Stripe Billing', a: 'billing@stripe.com', s: 'Invoice #4421 paid', p: 'Your invoice #4421 was paid — total $199.00.', b: 'Hi Dominic,\n\nYour invoice #4421 was paid — total $199.00. A PDF copy is attached for your records.\n\n— Stripe Billing', k: 'receipt', t: 'a paid Stripe receipt', q: 'invoice stripe' },
  { n: 'Shop.io Orders', a: 'orders@shop.io', s: 'Order #48215 shipped', p: 'Your order #48215 shipped — tracking 1Z999AA10123456784.', b: 'Hi Dominic,\n\nYour order #48215 shipped and should arrive this week. Tracking: 1Z999AA10123456784. Reply to this email if anything arrives damaged.\n\n— The Shop.io team', k: 'shipping', t: 'an order-shipped notice', q: 'order shipping' },
  { n: 'UPS', a: 'shipping@ups.com', s: 'Your package is out for delivery', p: 'Package 1Z567AA9 is out for delivery today by 6pm.', b: 'Your package 1Z567AA9 is out for delivery today by 6pm. No signature required.', k: 'shipping', t: 'a delivery notice', q: 'ups delivery' },
  { n: 'Amazon', a: 'no-reply@amazon.ca', s: 'Your order has arrived', p: 'Your order arrived — see your photos and review the delivery.', b: 'Your order has arrived. Rate the delivery and view your past orders any time from your account.', k: 'shipping', t: 'an arrival confirmation', q: 'amazon order' },
  { n: 'SaaS.io Support', a: 'support@saas.io', s: 'Ticket #4421 resolved', p: 'Your ticket #4421 is resolved — see the transcript for details.', b: 'Hi Dominic,\n\nYour ticket #4421 is resolved. The latency spike was a bad index after the last deploy; it is rebuilt and we are watching it. See the transcript for details.\n\n— SaaS.io Support', k: 'system', t: 'a support resolution', q: 'support ticket' },
  { n: 'SaaS.io Support', a: 'support@saas.io', s: 'Maintenance window Sunday', p: 'Sunday\'s maintenance window runs 02:00–04:00.', b: 'Hi Dominic,\n\nSunday\'s maintenance window runs 02:00–04:00. Expect brief read-only periods. The plan and the ticket transcript are attached.\n\n— Support', k: 'system', t: 'a maintenance-window notice', q: 'maintenance window' },
  { n: 'Warden CI', a: 'ci-bot@warden', s: 'Build #1284 failed', p: 'Pipeline run #1284 failed at the test stage — see the logs for the failing job.', b: 'Pipeline run #1284 failed at the test stage. Failing job: integration-tests (3 red). See the logs for the failing assertions.', k: 'system', t: 'a failed build', q: 'build failed' },
  { n: 'Warden CI', a: 'ci-bot@warden', s: 'Nightly backup completed', p: 'Nightly backup completed — 12.4 GB written, all checksums verified.', b: 'Nightly backup completed — 12.4 GB written, all checksums verified. Next run: tonight 02:00.', k: 'system', t: 'a backup confirmation', q: 'backup nightly' },
  { n: 'Northgate HR', a: 'hr@northgate-studios.com', s: 'Open enrollment ends Friday', p: 'Benefits open enrollment closes Friday — pick your plan or stay on default.', b: 'Hi Dominic,\n\nBenefits open enrollment closes Friday. Pick your plan in the portal or you stay on the default coverage. The summary PDF has the plan deltas.\n\n— Northgate HR', k: 'hr', t: 'an HR benefits deadline', q: 'benefits enrollment' },
  { n: 'Northgate Payroll', a: 'payroll@northgate-studios.com', s: 'Your payslip for August', p: 'Your August payslip is ready in the portal.', b: 'Hi Dominic,\n\nYour August payslip is ready in the portal. This reflects the raise adjustment retroactive to the 1st.\n\n— Payroll', k: 'hr', t: 'a payslip notice', q: 'payslip payroll' },
  { n: 'Brightsmile Dental', a: 'frontdesk@brightsmile.ca', s: 'Appointment reminder — Wednesday 9:30am', p: 'Your cleaning is booked for Wednesday at 9:30am — reply C to confirm.', b: 'Hi Dominic,\n\nYour cleaning is booked for Wednesday at 9:30am. Reply C to confirm or R to reschedule. The new-patient form is attached if you still need it.\n\n— Brightsmile Dental', k: 'personal', t: 'a dentist appointment reminder', q: 'dentist appointment' },
  { n: 'FlyWest Air', a: 'notifications@flywestair.com', s: 'Check-in open — flight WQ 482 to Toronto', p: 'Online check-in is open for your Friday flight to Toronto.', b: 'Hi Dominic,\n\nOnline check-in is open for your Friday flight WQ 482 to Toronto. Gate and boarding pass in the app; the itinerary PDF is attached.\n\n— FlyWest Air', k: 'travel', t: 'a flight check-in notice', q: 'flight checkin' },
  { n: 'Firstbank Alerts', a: 'alerts@firstbank.com', s: 'Your statement is ready', p: 'Your September statement is available in online banking.', b: 'Your September statement is available in online banking. Never share your login details with anyone.', k: 'receipt', t: 'a bank statement notice', q: 'bank statement' },
  { n: 'Shield Insurance', a: 'policies@shieldco.ca', s: 'Policy renewal quote — auto', p: 'Your auto policy renewal quote is ready; unchanged from last year.', b: 'Hi Dominic,\n\nYour auto policy renewal quote is ready — unchanged from last year. Confirm by the end of the month to keep continuous coverage.\n\n— Shield Insurance', k: 'receipt', t: 'an insurance renewal', q: 'insurance renewal' },
  { n: 'Lakeview School', a: 'office@lakeview.edu', s: 'Photo day is next Tuesday', p: 'Photo day for Grade 4 is next Tuesday — order forms went home.', b: 'Hi Dominic,\n\nPhoto day for Grade 4 is next Tuesday. Order forms went home in the backpack — check the front pocket. Late orders go through the portal.\n\n— Lakeview School Office', k: 'personal', t: 'a school photo-day notice', q: 'school photo day' },
  { n: 'VanDevs', a: 'organizer@vandevs.org', s: 'Thursday meetup: profiling in production', p: 'This month: production profiling, plus lightning talks.', b: 'This month at the meetup: production profiling, plus the usual lightning talks. Doors at 6:30, talks at 7.', k: 'newsletter', t: 'a meetup announcement', q: 'vandevs meetup' },
  { n: 'City of Vancouver', a: 'services@vancouver.ca', s: 'Green bin collection schedule change', p: 'Your green bin collection moves to Thursdays starting next week.', b: 'Your green bin collection moves to Thursdays starting next week. No action needed — this is the fall schedule.', k: 'receipt', t: 'a collection schedule change', q: 'green bin collection' },
  { n: 'Marco Diaz', a: 'marco.diaz@acme.io', s: 'FYI: client kickoff notes', p: 'Notes from the kickoff for whoever misses the sync — nothing urgent.', b: 'Hi Dominic,\n\nNotes from the kickoff for whoever misses the sync — nothing urgent, the client is happy with the timeline.\n\n— Marco', k: 'fyi', t: 'kickoff notes (FYI)', q: 'kickoff notes' },
  { n: 'Tom Okafor', a: 'tom.okafor@acme.io', s: 'Re: retro action items', p: 'Retro action items assigned — yours is the flaky-test triage.', b: 'Hi Dominic,\n\nRetro action items are assigned — yours is the flaky-test triage, due next sprint. I took the docs cleanup.\n\n— Tom', k: 'fyi', t: 'retro action items (FYI)', q: 'retro action items' },
];
for (const sc of SCEN) sc.f = sc.n.split(' ')[0];

// Attachment scenarios — email bodies that carry files. Covers all 8 types,
// single/multi attachments, and the no-attachment get (plain SCEN entries).
const ATS = [
  { n: 'Jason Miller', a: 'jason.miller@partnerco.com', s: 'Action required: sign the NDA', b: 'Hi Dominic,\n\nPlease review and sign the attached NDA so we can move forward with the partnership. The signature fields are on the last two pages.\n\n— Jason', atts: [{ f: 'nda-partnership.pdf', z: 251234 }] },
  { n: 'Sarah Chen', a: 'sarah.chen@acme.io', s: 'Q4 budget draft v2', b: 'Hi Dominic,\n\nAttached is draft v2 of the Q4 budget for your review. Headcount assumptions are in the third tab.\n\n— Sarah', atts: [{ f: 'Q4-budget-v2.xlsx', z: 48210 }, { f: 'headcount-plan.xlsx', z: 27650 }] },
  { n: 'Stripe Billing', a: 'billing@stripe.com', s: 'Invoice #4421 paid', b: 'Hi Dominic,\n\nYour invoice #4421 was paid — total $199.00. A PDF copy is attached for your records.\n\n— Stripe Billing', atts: [{ f: 'invoice-4421.pdf', z: 96500 }] },
  { n: 'Shop.io Orders', a: 'orders@shop.io', s: 'Order #48215 shipped', b: 'Hi Dominic,\n\nYour order #48215 shipped. The packing slip is attached; tracking: 1Z999AA10123456784.\n\n— The Shop.io team', atts: [{ f: 'packing-slip-48215.pdf', z: 41200 }, { f: 'warranty-card.pdf', z: 15300 }] },
  { n: 'Priya Nair', a: 'priya.nair@acme.io', s: 'Migration plan v3 — for review', b: 'Hi Dominic,\n\nMigration plan v3 attached — rollback section rewritten per your comment. Thursday is still the cutoff.\n\n— Priya', atts: [{ f: 'migration-plan-v3.docx', z: 83400 }, { f: 'rollback-checklist.docx', z: 31200 }] },
  { n: 'Lena Kowalski', a: 'lena.kowalski@acme.io', s: 'Vendor renewal paperwork', b: 'Hi Dominic,\n\nThe vendor renewal paperwork is attached — same terms as last year. Needs an approver before month end.\n\n— Lena', atts: [{ f: 'vendor-renewal-2026.pdf', z: 187400 }] },
  { n: 'Tom Okafor', a: 'tom.okafor@acme.io', s: 'Floor plan options for the new office', b: 'Hi Dominic,\n\nBoth floor-plan options rendered — pick A or B so facilities can start this week.\n\n— Tom', atts: [{ f: 'floor-plan-option-a.png', z: 2140000 }, { f: 'floor-plan-option-b.png', z: 2089000 }] },
  { n: 'Dana Whitfield', a: 'boss@acme.io', s: 'All-hands deck — quarterly review', b: 'Hi Dominic,\n\nThe all-hands deck for the quarterly review attached — your numbers are slides 12-15.\n\n— Dana', atts: [{ f: 'all-hands-q3-review.pptx', z: 5830000 }] },
  { n: 'Marco Diaz', a: 'marco.diaz@acme.io', s: 'Design review — wireframes', b: 'Hi Dominic,\n\nWireframes for the new home attached. The auth-flow screens start on page 4 of the deck.\n\n— Marco', atts: [{ f: 'design-review.pptx', z: 2310000 }, { f: 'wireframe-home.png', z: 1450000 }] },
  { n: 'Northgate HR', a: 'hr@northgate-studios.com', s: 'Benefits summary — open enrollment', b: 'Hi Dominic,\n\nThe benefits summary with plan deltas attached. Enrollment closes Friday.\n\n— Northgate HR', atts: [{ f: 'benefits-summary-2026.pdf', z: 322100 }] },
  { n: 'Northgate Payroll', a: 'payroll@northgate-studios.com', s: 'Your payslip for August', b: 'Hi Dominic,\n\nAugust payslip attached. This reflects the raise adjustment retroactive to the 1st.\n\n— Payroll', atts: [{ f: 'payslip-2026-08.pdf', z: 128400 }] },
  { n: 'FlyWest Air', a: 'notifications@flywestair.com', s: 'Itinerary — flight WQ 482 to Toronto', b: 'Hi Dominic,\n\nYour itinerary is attached. Online check-in is open; gate and boarding pass in the app.\n\n— FlyWest Air', atts: [{ f: 'flight-itinerary-wq482.pdf', z: 88300 }] },
  { n: 'Brightsmile Dental', a: 'frontdesk@brightsmile.ca', s: 'New-patient form', b: 'Hi Dominic,\n\nThe new-patient form attached — bring it filled to your Wednesday 9:30am cleaning.\n\n— Brightsmile Dental', atts: [{ f: 'new-patient-form.pdf', z: 97000 }] },
  { n: 'Warden CI', a: 'ci-bot@warden', s: 'Build #1284 failure report', b: 'Pipeline run #1284 failed at the test stage. Failure report and the failing-test list attached.\n\n— Warden CI', atts: [{ f: 'failure-report-1284.csv', z: 8200 }] },
  { n: 'Warden CI', a: 'ci-bot@warden', s: 'Nightly metrics snapshot', b: 'Nightly metrics snapshot attached — disk usage is trending up on the data volume.\n\n— Warden CI', atts: [{ f: 'metrics-2026-09-15.csv', z: 6400 }, { f: 'disk-usage-plot.png', z: 74800 }] },
  { n: 'SaaS.io Support', a: 'support@saas.io', s: 'Maintenance window Sunday', b: 'Hi Dominic,\n\nSunday\'s maintenance window runs 02:00–04:00. The plan and the ticket transcript are attached.\n\n— Support', atts: [{ f: 'maintenance-plan.pdf', z: 215040 }, { f: 'ticket-4421-transcript.txt', z: 6144 }] },
  { n: 'Rachel Voss', a: 'rachel.voss@gmail.com', s: 'Photos from the hike', b: 'Hey,\n\nThe good ones from Grouse — the ridge shot and the group photo. Full album link in the message.\n\n— Rachel', atts: [{ f: 'ridge-shot.jpg', z: 3180000 }, { f: 'group-photo.jpg', z: 2740000 }] },
  { n: 'Alex Turner', a: 'alex.turner@studio-nine.com', s: 'The ramen place menu', b: 'Dom,\n\nMenu attached — the tonkotsu is third from the top. Thursday?\n\n— Alex', atts: [{ f: 'ramen-menu.jpg', z: 452000 }] },
  { n: 'Shield Insurance', a: 'policies@shieldco.ca', s: 'Policy renewal documents — auto', b: 'Hi Dominic,\n\nYour auto policy renewal documents attached. Confirm by month end to keep continuous coverage.\n\n— Shield Insurance', atts: [{ f: 'policy-renewal-auto.pdf', z: 156000 }, { f: 'coverage-table.xlsx', z: 19800 }] },
  { n: 'Tom Okafor', a: 'tom.okafor@acme.io', s: 'Office move checklist', b: 'Hi Dominic,\n\nThe office-move checklist attached — desk packing starts Friday. It is mostly IT\'s problem.\n\n— Tom', atts: [{ f: 'office-move-checklist.docx', z: 44100 }, { f: 'desk-map.png', z: 890500 }] },
  { n: 'City of Vancouver', a: 'services@vancouver.ca', s: 'Fall collection schedule', b: 'The fall green-bin collection schedule attached — Thursdays from next week.\n\n— City of Vancouver', atts: [{ f: 'fall-collection-schedule.pdf', z: 66300 }] },
];
for (const sc of ATS) sc.f = sc.n.split(' ')[0];

// Reply composer for inbox reads — one line, actionable vs noise.
const NOISE = { newsletter: 'a newsletter', receipt: 'a receipt', shipping: 'a shipping notice', system: 'a system notice', hr: 'an HR notice', travel: 'a travel update', personal: 'personal mail', fyi: 'an FYI' };
function readReply(items) {
  const act = items.filter((i) => i.k === 'action' || i.k === 'meeting');
  const noise = items.filter((i) => act.indexOf(i) < 0);
  const parts = [`${items.length} email${items.length === 1 ? '' : 's'} in your inbox.`];
  if (act.length) parts.push(`Actionable: ${act.map((i) => `${i.f} (${i.t})`).join(', ')}.`);
  if (noise.length) parts.push(`The rest: ${noise.map((i) => NOISE[i.k] || i.t).join(', ')}.`);
  return parts.join(' ');
}

// Random-but-plausible timestamp: minutes back from the anchor, snapped to
// 5 minutes, kept between lo and hi minutes ago.
function stamp(loMin, hiMin) {
  const m = Math.round((hiMin - rng() * (hiMin - loMin)) / 5) * 5;
  return isoAgoMin(Math.max(5, m));
}

// Read items: distinct scenarios with ids and dated near the anchor.
function readItems(n, loMin = 5, hiMin = 4300) {
  return pickDistinct(SCEN, n).map((sc) => ({
    ...sc, id: hexId(), date: stamp(loMin, hiMin), preview: sc.p,
  }));
}

// ---- read: plain recent ---------------------------------------------------
const READ_RECENT_REQS = [
  "What's in my inbox?", 'Check my inbox.', 'Any new email?', 'List my recent emails.',
  'Scan the inbox and tell me what is there.', 'Do I have anything new in email?',
  'Give me an inbox summary.', "What's come in since I last looked?", 'Read my inbox.',
  'Show me the latest emails.', 'Anything actionable in my inbox?', 'Take a look at my email.',
  'Check my email for me.', 'What landed in my inbox?', 'Pull up my recent mail.',
  'Inbox check, please.', 'What do I have waiting in my inbox?', 'Check the inbox and report.',
  'Give me the inbox rundown.', 'What is sitting unread in my inbox?', 'Quick inbox scan.',
  'Show my newest emails first.', 'Email check — anything worth my time?',
];
for (let i = 0; i < 80; i++) {
  const items = readItems(2 + Math.floor(rng() * 5));
  examples.push(ex('iris', pick(READ_RECENT_REQS),
    [{ name: 'email', arguments: { action: 'read' } }],
    { results: [fmtRead(items)], reply: readReply(items) }));
}

// ---- read: date ranges (since / before) -----------------------------------
const RANGES = [
  { req: 'Show me emails from the last 24 hours.', args: { since: isoAgoH(24), limit: 50 }, lo: 5, hi: 1440 },
  { req: 'Anything new in the last 6 hours?', args: { since: isoAgoH(6), limit: 50 }, lo: 5, hi: 360 },
  { req: 'Check for email received in the past hour.', args: { since: isoAgoH(1), limit: 20 }, lo: 5, hi: 60 },
  { req: 'What came in over the last 3 days?', args: { since: isoAgoH(72), limit: 100 }, lo: 5, hi: 4300 },
  { req: 'Emails since yesterday evening, please.', args: { since: isoAgoH(20), limit: 50 }, lo: 5, hi: 1200 },
  { req: 'Anything since this morning?', args: { since: dayAt(0, 8, 0), limit: 50 }, lo: 5, hi: 370 },
  { req: 'Check email from the weekend.', args: { since: '2026-09-11T17:00:00', before: '2026-09-14T00:00:00' }, lo: 845, hi: 5585 },
  { req: 'Anything from before the weekend?', args: { before: '2026-09-11T17:00:00', limit: 50 }, lo: 5585, hi: 7200 },
  { req: 'Emails between yesterday noon and now?', args: { since: dayAt(1, 12, 0), limit: 50 }, lo: 5, hi: 1565 },
  { req: 'What landed since Monday morning?', args: { since: dayAt(1, 9, 0), limit: 100 }, lo: 5, hi: 1745 },
  { req: 'Show me email from the last 2 days.', args: { since: isoAgoH(48), limit: 100 }, lo: 5, hi: 2880 },
  { req: 'Anything since lunch?', args: { since: dayAt(0, 12, 0), limit: 20 }, lo: 5, hi: 125 },
];
for (let i = 0; i < 55; i++) {
  const r = RANGES[i % RANGES.length];
  const items = readItems(1 + Math.floor(rng() * 4), r.lo, r.hi);
  examples.push(ex('iris', r.req,
    [{ name: 'email', arguments: { action: 'read', ...r.args } }],
    { results: [fmtRead(items)], reply: readReply(items) }));
}

// ---- read: search ---------------------------------------------------------
const SEARCH_REQS = [
  'Find emails from {F} about {TOPIC}.', 'Search my email for "{TOPIC}".',
  'Anything in the inbox from {F} regarding {TOPIC}?', 'Look for email about {TOPIC}.',
  'Search for messages from {F}.', 'Do I have any email about {TOPIC}?',
  'Track down the {TOPIC} email.', 'Search the inbox for {TOPIC}.',
  'Any mail from {F} lately?', 'Find the {TOPIC} thread.',
];
for (let i = 0; i < 50; i++) {
  const sc = pick(SCEN);
  const req = pick(SEARCH_REQS)
    .replace('{F}', sc.f).replace('{TOPIC}', sc.t.replace(/^an? /, '').replace(/ \(FYI\)/, ''));
  if (i % 7 === 5) {
    // a no-result search — the real "No emails found." result text
    examples.push(ex('iris', req,
      [{ name: 'email', arguments: { action: 'read', search: 'qq-unmatched-needle', limit: 10 } }],
      { results: ['No emails found.'], reply: 'No emails found for that search.' }));
  } else {
    const items = [{ ...sc, id: hexId(), date: stamp(5, 2600), preview: sc.p }];
    if (rng() < 0.3) {
      const sameSender = SCEN.filter((x) => x.n === sc.n && x.s !== sc.s);
      if (sameSender.length) {
        const extra = pick(sameSender);
        items.push({ ...extra, id: hexId(), date: stamp(2600, 5800), preview: extra.p });
      }
    }
    examples.push(ex('iris', req,
      [{ name: 'email', arguments: { action: 'read', search: sc.q, limit: 20 } }],
      { results: [fmtRead(items)], reply: readReply(items) }));
  }
}

// ---- read: folders --------------------------------------------------------
const FOLDERS = [
  { folder: 'Sent', reqs: ['Check my Sent folder for the reply to Sarah.', 'What did I send yesterday? Look in Sent.', 'Scan the Sent folder — did I answer the NDA thread?'] },
  { folder: 'Archive', reqs: ['Look in the Archive for the lease agreement thread.', "Anything in the Archive about last quarter's budget?", 'Search the Archive for the old vendor contracts.'] },
  { folder: 'Spam', reqs: ['Anything worth rescuing from Spam?', 'Check the Spam folder — a client said their email bounced.'] },
  { folder: 'Junk', reqs: ['Glance at the Junk folder for anything real.'] },
];
for (let i = 0; i < 15; i++) {
  const fo = FOLDERS[i % FOLDERS.length];
  const items = readItems(1 + Math.floor(rng() * 3));
  examples.push(ex('iris', fo.reqs[Math.floor(rng() * fo.reqs.length)],
    [{ name: 'email', arguments: { action: 'read', folder: fo.folder } }],
    { results: [fmtRead(items)], reply: readReply(items) }));
}

// ---- get (no attachments / single / multiple) -----------------------------
const GET_REQS = [
  'Get the full body of email {ID} ({N}\'s "{S}").', 'Open email {ID} and show me the whole thing.',
  'Pull up the complete text of email {ID}.', 'Read me the full email {ID}.',
  'Show me everything in email {ID}.', 'Fetch the whole email {ID}, start to finish.',
  'Get me the FULL body of email {ID}.', 'Expand email {ID} — I want the complete message.',
];
for (let i = 0; i < 125; i++) {
  const withAtt = i % 3 !== 0;                       // ~2/3 carry attachments
  const sc = withAtt ? pick(ATS) : pick(SCEN);
  const id = hexId();
  const date = stamp(5, 4000);
  const req = pick(GET_REQS).replace('{ID}', id).replace('{N}', sc.n).replace('{S}', sc.s);
  const atts = sc.atts || [];
  const result = fmtGet(sc.a, sc.s, date, sc.b, atts);
  const reply = atts.length
    ? `${sc.f}'s "${sc.s}" (${id}) — ${atts.length === 1 ? 'attachment ' + atts[0].f : 'attachments ' + atts.map((x) => x.f).join(', ')} ready.`
    : `${sc.f}'s "${sc.s}" (${id}) — full body fetched.`;
  examples.push(ex('iris', req,
    [{ name: 'email', arguments: { action: 'get', email_id: id } }],
    { results: [result], reply }));
}

// ---- download: single-turn, id + filename both supplied --------------------
const DL_IDF_REQS = [
  'Download {FILE} from the email {ID} ({N}\'s "{S}") and tell me where it lands.',
  'Save the attachment {FILE} from email {ID} — give me the file path.',
  'Pull {FILE} out of email {ID} and save it.',
  'Download {FILE} from email {ID} so I can review it.',
  'Grab {FILE} from email {ID} and tell me where it is.',
  'Save {FILE} (attached to email {ID}) to disk.',
];
for (let i = 0; i < 45; i++) {
  const sc = pick(ATS);
  const att = pick(sc.atts);
  const id = hexId();
  const req = pick(DL_IDF_REQS).replace('{FILE}', att.f).replace('{ID}', id).replace('{N}', sc.n).replace('{S}', sc.s);
  examples.push(ex('iris', req,
    [{ name: 'email', arguments: { action: 'download', email_id: id, filename: att.f } }],
    { results: [fmtDownload(id, att)], reply: `Saved ${att.f} from ${sc.f}'s email (${id}) to ${ATT_DIR}/${id}_${att.f}.` }));
}

// ---- download: single-turn, single attachment, no filename needed ----------
const DL_ID_REQS = [
  'Save the attachment from email {ID} and tell me the path.',
  'Download the file attached to email {ID}.',
  'Grab the attachment on email {ID} — where does it land?',
  'Pull the attachment off email {ID} and save it.',
];
for (let i = 0; i < 35; i++) {
  const sc = pick(ATS.filter((x) => x.atts.length === 1));
  const att = sc.atts[0];
  const id = hexId();
  const req = pick(DL_ID_REQS).replace('{ID}', id);
  examples.push(ex('iris', req,
    [{ name: 'email', arguments: { action: 'download', email_id: id } }],
    { results: [fmtDownload(id, att)], reply: `Saved ${att.f} from email ${id} to ${ATT_DIR}/${id}_${att.f}.` }));
}

// ---- download chains: get → download (filename from the Attachments line) --
const DL_CHAIN_REQS = [
  'Download the attachment from email {ID} ({N}\'s "{S}").',
  'Email {ID} ({N}) has a file attached — save it and tell me the path.',
  'Pull the attachment out of email {ID}.',
  'Save what is attached to email {ID} — I need the file.',
];
for (let i = 0; i < 45; i++) {
  const sc = pick(ATS);
  const att = pick(sc.atts);
  const id = hexId();
  const req = pick(DL_CHAIN_REQS).replace('{ID}', id).replace('{N}', sc.n).replace('{S}', sc.s);
  examples.push(exMulti('iris', req, [
    { call: { name: 'email', arguments: { action: 'get', email_id: id } },
      result: fmtGet(sc.a, sc.s, stamp(5, 4000), sc.b, sc.atts) },
    { call: { name: 'email', arguments: { action: 'download', email_id: id, filename: att.f } },
      result: fmtDownload(id, att) },
  ], `Saved ${att.f} from email ${id} to ${ATT_DIR}/${id}_${att.f} (${att.z} bytes).`));
}

// ---- download chains: read → get → download (the full 3-call flow) ---------
for (let i = 0; i < 35; i++) {
  const sc = pick(ATS);
  const att = pick(sc.atts);
  const id = hexId();
  const reqs = [
    `Find the email from ${sc.f} about "${sc.s}", open it, and save the attachment.`,
    `Track down ${sc.f}'s "${sc.s}" email and pull the file out of it.`,
    `Look up the "${sc.s}" email from ${sc.f}, then download what is attached.`,
  ];
  examples.push(exMulti('iris', pick(reqs), [
    { call: { name: 'email', arguments: { action: 'read', search: sc.q || sc.f, limit: 10 } },
      result: fmtRead([{ ...sc, id, date: stamp(5, 2400), preview: sc.p }]) },
    { call: { name: 'email', arguments: { action: 'get', email_id: id } },
      result: fmtGet(sc.a, sc.s, stamp(5, 2400), sc.b, sc.atts) },
    { call: { name: 'email', arguments: { action: 'download', email_id: id, filename: att.f } },
      result: fmtDownload(id, att) },
  ], `Saved ${att.f} from ${sc.f}'s "${sc.s}" (${id}) to ${ATT_DIR}/${id}_${att.f}.`));
}

// ---- send: new mail --------------------------------------------------------
const PEOPLE = [
  { n: 'Sarah Chen', a: 'sarah.chen@acme.io' }, { n: 'Jason Miller', a: 'jason.miller@partnerco.com' },
  { n: 'Priya Nair', a: 'priya.nair@acme.io' }, { n: 'Marco Diaz', a: 'marco.diaz@acme.io' },
  { n: 'Lena Kowalski', a: 'lena.kowalski@acme.io' }, { n: 'Tom Okafor', a: 'tom.okafor@acme.io' },
  { n: 'Alex Turner', a: 'alex.turner@studio-nine.com' }, { n: 'Rachel Voss', a: 'rachel.voss@gmail.com' },
  { n: 'Dana Whitfield', a: 'boss@acme.io' }, { n: 'Ralph Diaz', a: 'ralph.diaz@northgate-studios.com' },
];
const NEWMAIL = [
  { topic: 'the client kickoff', subj: 'Client kickoff — agenda draft', msg: 'the kickoff agenda draft is ready for review', body: 'Hi {F},\n\nThe kickoff agenda draft is ready — flag anything missing before Thursday.\n\n— Dominic' },
  { topic: 'lunch on Thursday', subj: 'Lunch Thursday?', msg: 'lunch Thursday works — usual place at 12:30', body: 'Hi {F},\n\nThursday works for lunch — usual place at 12:30?\n\n— Dominic' },
  { topic: 'the migration plan', subj: 'Re: migration plan v3', msg: 'the rollback section looks good now', body: 'Hi {F},\n\nReviewed v3 — the rollback section looks good now. Ship it Thursday.\n\n— Dominic' },
  { topic: 'the Q4 budget', subj: 'Re: Q4 budget approval needed', msg: 'the Q4 budget sign-off is coming Friday', body: 'Hi {F},\n\nSign-off is coming Friday — one open question on the headcount tab.\n\n— Dominic' },
  { topic: 'the standup change', subj: 'Standup back to 10am Monday', msg: 'standup is back to 10am Monday', body: 'Hi {F},\n\nHeads-up: standup is back to 10am Monday.\n\n— Dominic' },
  { topic: 'the design doc', subj: 'Re: design doc feedback', msg: 'the design doc comments are addressed', body: 'Hi {F},\n\nYour comments are addressed — error paths tightened as suggested.\n\n— Dominic' },
  { topic: 'the vendor renewal', subj: 'Re: vendor renewal', msg: 'the vendor renewal is approved', body: 'Hi {F},\n\nThe renewal is approved — paperwork goes back to the portal today.\n\n— Dominic' },
  { topic: 'the retro notes', subj: 'Retro notes — last sprint', msg: 'the retro notes are summarized', body: 'Hi {F},\n\nRetro notes summarized — the flaky-test triage stays with me.\n\n— Dominic' },
  { topic: 'the hiking trip', subj: 'Grouse Mountain loop?', msg: 'the full Grouse loop sounds good', body: 'Hey {F},\n\nThe full Grouse loop sounds good — early start, telescope this time?\n\n— Dominic' },
  { topic: 'the meeting request', subj: 'Meeting next Thursday?', msg: 'a meeting next Thursday would work', body: 'Hi {F},\n\nNext Thursday works for a meeting — morning is best. What time suits you?\n\n— Dominic' },
];
const SEND_NEW_REQS = [
  'Send an email to {A} with subject "{SUBJ}" and body "{BODYF}"',
  'Email {N} ({A}) and tell them {MSG}.',
  'Write to {A}: {MSG}.',
  'Send {N} a note saying {MSG}.',
  'Can you email {A} about {TOPIC}? Tell them {MSG}.',
];
for (let i = 0; i < 40; i++) {
  const p = pick(PEOPLE);
  const m = pick(NEWMAIL);
  const body = m.body.replace('{F}', p.n.split(' ')[0]);
  const req = pick(SEND_NEW_REQS)
    .replace('{A}', p.a).replace('{N}', p.n).replace('{SUBJ}', m.subj)
    .replace('{BODYF}', body.replace(/\n/g, ' '))
    .replace('{MSG}', m.msg).replace('{TOPIC}', m.topic);
  examples.push(ex('iris', req,
    [{ name: 'email', arguments: { action: 'send', to: p.a, subject: m.subj, body } }],
    { results: [fmtSend(p.a, m.subj)], reply: `Sent the email to ${p.n} (${p.a}) — ${m.topic}.` }));
}

// ---- send: replies with the address resolved in the brief ------------------
const REPLY_MSGS = [
  "I'll get back to them by Friday", 'the report is on its way', 'confirmed for Thursday',
  'thanks for the heads-up', 'approved — go ahead', 'the numbers check out',
  'one small comment, otherwise good to go', 'booked — see the calendar invite',
];
const SEND_REPLY_REQS = [
  "Reply to {N} ({A}) and tell them {MSG} — send the reply.",
  "Reply to {N}'s email ({A}) — say {MSG}.",
  'Answer {N} at {A}: {MSG}. Send the reply.',
  "Send {N} ({A}) a reply saying {MSG}.",
];
const REPLYABLE = SCEN.filter((s) => s.k === 'action' || s.k === 'meeting' || s.k === 'personal' || s.k === 'hr');
for (let i = 0; i < 35; i++) {
  const sc = pick(REPLYABLE);
  const msg = pick(REPLY_MSGS);
  const req = pick(SEND_REPLY_REQS).replace('{N}', sc.n).replace('{A}', sc.a).replace('{MSG}', msg);
  const body = `Hi ${sc.f},\n\n${msg[0].toUpperCase() + msg.slice(1)}.\n\n— Dominic`;
  examples.push(ex('iris', req,
    [{ name: 'email', arguments: { action: 'send', to: sc.a, subject: `Re: ${sc.s}`, body } }],
    { results: [fmtSend(sc.a, `Re: ${sc.s}`)], reply: `Sent the reply to ${sc.f} (${sc.a}) — ${msg}.` }));
}

// ---- refresh / cached -----------------------------------------------------
const REFRESH_REQS = [
  'Refresh my email cache.', 'Re-sync the email cache.', 'Refresh the cached emails.',
  'Sync the email cache again, please.', 'Refresh the cache and tell me how much is cached.',
  'Update the local email cache.',
];
for (let i = 0; i < 20; i++) {
  const n = 12 + Math.floor(rng() * 60);
  examples.push(ex('iris', pick(REFRESH_REQS),
    [{ name: 'email', arguments: { action: 'refresh' } }],
    { results: [`Email cache refreshed: ${n} emails cached.`], reply: `Refreshed the email cache — ${n} emails cached.` }));
}
const CACHED_REQS = [
  'What cached emails do you have?', 'Show me what is in the email cache.',
  'Anything in the local email cache?', 'List the cached emails.', 'What is cached locally?',
];
for (let i = 0; i < 20; i++) {
  const items = pickDistinct(SCEN, 2 + Math.floor(rng() * 3)).map((sc) => ({
    id: hexId(), from: sc.a, subject: sc.s, date: stamp(5, 4000),
  }));
  const json = JSON.stringify(items, null, 2);
  examples.push(ex('iris', pick(CACHED_REQS),
    [{ name: 'email', arguments: { action: 'cached' } }],
    { results: [`Cached emails:\n${json}`], reply: `${items.length} cached emails — latest: ${items[0].subject}.` }));
}

// ---- scheduling chains: alarm list → update/delete, calendar list → update/delete
// (ids come from the LIST result — the contract's "fact an earlier call
// returned". Task list is fire-and-forget in production, so no task chains.) --
const ALARMS = [
  { label: 'Wake up', time: '06:30', repeat: 'daily' },
  { label: 'Wind down', time: '21:00', repeat: 'none' },
  { label: 'Get to work', time: '08:15', repeat: 'weekdays' },
  { label: 'Gym session', time: '18:00', repeat: 'weekdays' },
  { label: 'Early run', time: '05:30', repeat: 'weekdays' },
  { label: 'Meditate', time: '07:00', repeat: 'daily' },
  { label: 'Water the plants', time: '19:00', repeat: 'daily' },
];
function alarmListResult() {
  const chosen = pickDistinct(ALARMS, 3 + Math.floor(rng() * 3));
  return {
    ids: chosen.map((_, i) => `alm-${i + 1}`),
    text: `Alarms:\n${chosen.map((al, i) => `- [alm-${i + 1}] "${al.label}" at ${al.time} repeat=${al.repeat}`).join('\n')}`,
    chosen,
  };
}
// alarm update chains
for (let i = 0; i < 25; i++) {
  const list = alarmListResult();
  const idx = Math.floor(rng() * list.chosen.length);
  const al = list.chosen[idx];
  const id = list.ids[idx];
  const moves = [
    { req: `Update my "${al.label}" alarm to ${al.time === '21:00' ? '21:30' : '06:45'}.`, args: { action: 'update', alarm_id: id, alarm_time: al.time === '21:00' ? '21:30' : '06:45' }, say: `moved ${al.label} to ${al.time === '21:00' ? '21:30' : '06:45'}` },
    { req: `Rename the "${al.label}" alarm to "${al.label} v2".`, args: { action: 'update', alarm_id: id, label: `${al.label} v2` }, say: `renamed ${al.label} to "${al.label} v2"` },
    { req: `Make my "${al.label}" alarm ring every day.`, args: { action: 'update', alarm_id: id, repeat_type: 'daily' }, say: `set ${al.label} to repeat daily` },
    { req: `Turn my "${al.label}" alarm off but keep it.`, args: { action: 'update', alarm_id: id, enabled: false }, say: `disabled ${al.label}` },
  ];
  const mv = moves[Math.floor(rng() * moves.length)];
  examples.push(exMulti('iris', mv.req, [
    { call: { name: 'alarm', arguments: { action: 'list' } }, result: list.text },
    { call: { name: 'alarm', arguments: mv.args }, result: 'Alarm updated.' },
  ], `Done — ${mv.say} (${id}).`));
}
// alarm delete chains
for (let i = 0; i < 20; i++) {
  const list = alarmListResult();
  const idx = Math.floor(rng() * list.chosen.length);
  const al = list.chosen[idx];
  const id = list.ids[idx];
  const reqs = [
    `Delete my "${al.label}" alarm.`,
    `Remove the "${al.label}" alarm — I do not need it anymore.`,
    `Get rid of the "${al.label}" alarm (${al.time}).`,
  ];
  examples.push(exMulti('iris', pick(reqs), [
    { call: { name: 'alarm', arguments: { action: 'list' } }, result: list.text },
    { call: { name: 'alarm', arguments: { action: 'delete', alarm_id: id } }, result: 'Alarm deleted.' },
  ], `Deleted the "${al.label}" alarm (${id}).`));
}
// calendar scenarios
const CALS = [
  { title: 'Team Sync', start: '2026-09-16T10:00:00', end: '2026-09-16T11:00:00', loc: 'Meet', uid: 'ev-1004' },
  { title: 'Vendor Demo', start: '2026-09-16T14:00:00', end: '2026-09-16T15:30:00', loc: 'Conference room', uid: 'ev-1006' },
  { title: 'Dentist appointment', start: '2026-09-17T09:30:00', end: '2026-09-17T10:30:00', loc: 'Brightsmile', uid: 'ev-1012' },
  { title: 'Design review', start: '2026-09-17T15:00:00', end: '2026-09-17T16:00:00', loc: 'Meet', uid: 'ev-1013' },
  { title: 'Project Review', start: '2026-09-16T14:00:00', end: '2026-09-16T15:00:00', loc: '', uid: 'ev-1001' },
  { title: 'Poker night', start: '2026-09-18T18:00:00', end: '2026-09-18T22:00:00', loc: "Alex's place", uid: 'ev-1020' },
  { title: 'Lunch with Dana', start: '2026-09-17T12:00:00', end: '2026-09-17T13:00:00', loc: 'Ramen place', uid: 'ev-1014' },
];
function calListResult() {
  const chosen = pickDistinct(CALS, 3 + Math.floor(rng() * 3));
  const lines = chosen.map((c, i) => {
    const when = c.end ? `${c.start} → ${c.end}` : c.start;
    return `${i + 1}. ${when} | ${c.title}${c.loc ? ` @ ${c.loc}` : ''} (uid ${c.uid})`;
  });
  return { chosen, text: `${chosen.length} events:\n${lines.join('\n\n')}` };
}
// calendar delete chains
for (let i = 0; i < 20; i++) {
  const range = i % 2 ? { start: '2026-09-14T00:00:00', end: '2026-09-20T23:59:59' } : {};
  const list = calListResult();
  const c = pick(list.chosen);
  const reqs = [
    `Cancel the "${c.title}" on my calendar.`,
    `Take the "${c.title}" event off my calendar.`,
    `Delete the "${c.title}" event — it is not happening anymore.`,
  ];
  examples.push(exMulti('iris', pick(reqs), [
    { call: { name: 'calendar', arguments: { action: 'list', ...range } }, result: list.text },
    { call: { name: 'calendar', arguments: { action: 'delete', event_id: c.uid } }, result: `Calendar event ${c.uid} deleted.` },
  ], `Deleted the "${c.title}" event (${c.uid}).`));
}
// calendar update chains
for (let i = 0; i < 20; i++) {
  const list = calListResult();
  const c = pick(list.chosen);
  const day = c.start.slice(0, 10);
  const moves = [
    { req: `Move the "${c.title}" event to 4 PM.`, args: { action: 'update', event_id: c.uid, start_time: `${day}T16:00:00` }, say: `moved ${c.title} to 4pm` },
    { req: `Push the "${c.title}" event back an hour.`, args: { action: 'update', event_id: c.uid, start_time: `${day}T${c.start.slice(11, 13) === '23' ? '23' : pad2(Number(c.start.slice(11, 13)) + 1)}:${c.start.slice(14, 16)}:00` }, say: `pushed ${c.title} back an hour` },
    { req: `Rename the "${c.title}" event to "${c.title} (final)".`, args: { action: 'update', event_id: c.uid, title: `${c.title} (final)` }, say: `renamed ${c.title}` },
    { req: `Add a location to the "${c.title}" event — main room.`, args: { action: 'update', event_id: c.uid, location: 'Main room' }, say: `set the ${c.title} location to Main room` },
  ];
  const mv = moves[Math.floor(rng() * moves.length)];
  examples.push(exMulti('iris', mv.req, [
    { call: { name: 'calendar', arguments: { action: 'list' } }, result: list.text },
    { call: { name: 'calendar', arguments: mv.args }, result: `Calendar event ${c.uid} updated.` },
  ], `Done — ${mv.say} (${c.uid}).`));
}

// ---- text-only clarification rows ------------------------------------------
// time without content → ask for the content
const ASK_CONTENT_REQS = [
  'Set a reminder for 6 PM.', 'Set an alarm for 7:30 AM.', 'Remind me at noon.',
  'Set a reminder tonight at 9.', 'Set an alarm for tomorrow at 6.',
  'Remind me at 5 PM tomorrow.', 'Set a reminder for Friday afternoon.',
  'Set an alarm at midnight.', 'Remind me in an hour.',
];
const ASK_CONTENT_REPLIES = [
  'What should the reminder say?',
  'What message should it fire with?',
  'What should I remind you about?',
  'Give me the reminder content and I will set it.',
  'What should the alarm say when it rings?',
];
for (let i = 0; i < 40; i++) {
  examples.push(exText('iris', pick(ASK_CONTENT_REQS), pick(ASK_CONTENT_REPLIES)));
}
// content without a time (a plain to-do) → ask for a time
const TODOS = [
  'file the expense report', 'call the plumber', 'renew the car insurance',
  'book the dentist appointment', 'water the plants', 'email the landlord about the leak',
  'pick up the prescription', 'submit the timesheet', 'RSVP to the wedding invite',
  'return the library books', 'defrost the freezer', 'back up the laptop',
];
const TODO_REQS = [
  'Remind me to {T}.', 'Set a reminder to {T}.', '{T} — do not let me forget.',
  'I need to {T} sometime.', 'Do not let me forget to {T}.', 'Add a reminder for me to {T}.',
];
const ASK_TIME_REPLIES = [
  'What time should I remind you to {T}? Give me a specific time (e.g. "6pm") or a relative time (e.g. "in 2 hours").',
  'When should the "{T}" reminder fire? A clock time or a relative time both work.',
  'What time works for the "{T}" reminder? Once you give me a time it becomes a scheduled reminder.',
];
for (let i = 0; i < 35; i++) {
  const t = pick(TODOS);
  examples.push(exText('iris', pick(TODO_REQS).replace('{T}', t), pick(ASK_TIME_REPLIES).replace('{T}', t)));
}
// out-of-scope asks → honest one-line answers, still helpful
examples.push(exText('iris', 'Book me a flight to Toronto next Friday.',
  'I do not have a travel-booking tool. I can set a reminder for the flight, and once the confirmation email arrives I can read it.'));
examples.push(exText('iris', 'What are the sports scores?',
  'I do not have a sports tool — alarms, reminders, calendar, and email are what I can reach.'));
examples.push(exText('iris', 'Text mom that I will be late.',
  'I do not have a messaging tool. I can send email instead — give me the address and the message.'));
examples.push(exText('iris', 'How much RAM does the server have?',
  'I do not have a system-info tool here. The CI bot emails build reports — I can search those if that helps.'));

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = [...examples];
  const lines = all.map(e => JSON.stringify(e));
  writeFileSync(new URL('./toolcall-sft.jsonl', import.meta.url), lines.join('\n') + '\n');
  console.log(`Wrote ${all.length} examples to toolcall-sft.jsonl`);

  // Per-agent + per-target + per-turn counts.
  const byAgent = {}, byTarget = {}, byTurns = {};
  for (const e of all) {
    const sys = e.messages[0].content;
    const agent = sys.startsWith('You are Iris') ? 'iris'
      : sys.startsWith('Scan the INPUT block') ? 'digest'
      : '?';
    byAgent[agent] = (byAgent[agent] || 0) + 1;
    const a = e.messages.find(m => m.role === 'assistant');
    const key = a?.tool_calls ? a.tool_calls.map(t => t.function.name).join('+') : 'text-only';
    byTarget[key] = (byTarget[key] || 0) + 1;
    const turns = e.messages.filter(m => m.role === 'assistant' && m.tool_calls?.length).length;
    byTurns[turns] = (byTurns[turns] || 0) + 1;
  }
  console.log('By agent:', byAgent);
  console.log('By target:', byTarget);
  console.log('By tool-call turns:', byTurns);
}

export { examples };