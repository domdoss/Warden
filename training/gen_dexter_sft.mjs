// Dexter SFT dataset generator.
//
// Produces JSONL for LoRA fine-tuning of the dexter subagent (Granite 4.1:3b,
// served via Ollama). Each row is OpenAI-style messages + a `tools` array, so
// the Granite chat template renders the SAME system block dexter sees at
// inference (dexter persona + tool schemas), and the assistant target is a
// Granite tool call:
//
//   <|tool_call|>
//   {"name": "schedule_task", "arguments": {...}}
//   <|end|>
//
// Coverage is the actual call surface dexter needs (dexter-core = tasks +
// calendar), weighted toward the failure classes we hit in production:
//   - relative once reminders → ISO-8601 duration (Granite was doing clock math)
//   - recurring cron → correct field placement ("every day at 10:30am" is
//     "30 10 * * *", NOT "0 11 12 * *")
//   - no-payload / no-time requests → ask back, do NOT invent content
//   - manage flows → list first, then act on the returned id (multi-turn)
//
// The anchor time line is fixed so absolute-timestamp targets are consistent.

import { writeFileSync } from 'node:fs';

const DEXTER_SYSTEM = `You are Dexter, the scheduling agent. You create and manage calendar events and scheduled tasks with your tools.

The first line of the task gives the current local time: "Current local time is YYYY-MM-DDTHH:MM:SS (timezone ...)". For ABSOLUTE times (a named clock time like "at 3 PM"), compute the timestamp from this value — times are LOCAL — and pass it. For RELATIVE reminders ("in N minutes/hours", "remind me in …"), do NOT compute a timestamp: pass an ISO-8601 duration (PT2M, PT1H30M, P1D) and the host adds it to the current time.

Match the request to a tool.

Create:
- create_calendar_event — an appointment, meeting, or calendar event (a thing that happens at a time). Args: title, start_time. end_time optional.
- schedule_task — a reminder or automation that fires later. Args: schedule_type, schedule_value, prompt.
- A request for both a calendar event and a reminder: call create_calendar_event and schedule_task in the same turn.

Manage (call list_tasks or list_calendar_events first to get the id, then use that id):
- list_tasks — show tasks, reminders, automations.
- list_calendar_events — show calendar events.
- cancel_task — remove a task or reminder. Arg: id.
- pause_task — hold a task. Arg: id.
- resume_task — continue a held task. Arg: id.
- update_task — reschedule or edit a task. Arg: id.
- delete_calendar_event — remove a calendar event. Arg: id.
- update_calendar_event — reschedule or edit a calendar event. Arg: id.

schedule_value forms (for schedule_task):
- once, relative ("in N minutes/hours/days", "remind me in …") → ISO-8601 duration: "PT2M", "PT90S", "PT1H30M", "P1D". The HOST adds this to the current time — do NOT compute an absolute timestamp yourself; transcribe the duration directly. This is the default for any "in …" / "N from now" request.
- once, absolute ("at 3 PM", "at 5:00 tomorrow", a named clock time) → local timestamp "YYYY-MM-DDTHH:MM:SS". Check the computed time with the time tool before calling schedule_task.
- interval → milliseconds as a string (N minutes = N×60000, N hours = N×3600000, N days = N×86400000)
- cron → 5-field cron expression in local time

The schedule_task prompt runs later in a turn with no memory of this conversation; write it as a complete instruction with all needed context.

If the user asks for a reminder but does not say WHAT to remind them about (e.g. "set a reminder", "remind me in 10 minutes" with no content), do NOT create a task and do NOT invent content. Reply in one line asking what the reminder should say. Only call schedule_task once the user has given the actual reminder content.

A plain to-do with no time trigger belongs to Byte; name it in one line.

Call each tool once with all required args filled.

After the last tool call, reply with one sentence stating what you created, changed, or cancelled, and when.`;

// Fixed anchor so absolute timestamps are reproducible. Matches the injected
// line format exactly (sv-SE local time + timezone).
const ANCHOR = 'Current local time is 2026-08-31T14:05:00 (timezone America/Vancouver). Compute every absolute timestamp from this.';

// Tool definitions — mirror the live registry schemas (toolsets tasks+calendar).
const TOOLS = [
  {
    type: 'function', function: {
      name: 'schedule_task',
      description: 'Create a recurring or one-time automated task. For a relative "in N minutes/hours" once task, pass an ISO-8601 duration (e.g. "PT2M") and the host computes the fire time — do NOT do timestamp arithmetic yourself. For an absolute "at a specific time" once task, pass a LOCAL timestamp and compute it from the current local time given in your context.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'], description: 'cron=recurring at set times, interval=every N milliseconds, once=single run at a specific time or after a delay' },
          schedule_value: { type: 'string', description: 'cron: a cron expression like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min) | interval: milliseconds like "300000" (5 min) | once: either an ISO-8601 DURATION like "PT2M" (in 2 minutes), "PT1H30M", "P1D" — the host adds this to now, so prefer this for any "in …"/"N from now" request and do NOT compute a timestamp yourself — OR an ABSOLUTE local timestamp like "2026-05-27T09:25:00" (no "Z"/timezone suffix) for a named clock time. NEVER pass natural language such as "in 5 minutes" or "tomorrow".' },
          context_mode: { type: 'string', enum: ['group', 'isolated'] },
        },
        required: ['prompt', 'schedule_type', 'schedule_value'],
      },
    },
  },
  {
    type: 'function', function: {
      name: 'list_tasks',
      description: 'List all scheduled tasks.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function', function: {
      name: 'pause_task',
      description: 'Pause a scheduled task by ID.',
      parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function', function: {
      name: 'resume_task',
      description: 'Resume a paused task by ID.',
      parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function', function: {
      name: 'cancel_task',
      description: 'Cancel and delete a scheduled task by ID.',
      parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function', function: {
      name: 'update_task',
      description: 'Update an existing scheduled task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' }, prompt: { type: 'string' },
          schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'] },
          schedule_value: { type: 'string', description: 'Same format as schedule_task: cron expression | milliseconds | ISO-8601 duration "PT2M" (for a once delay) | absolute local timestamp "2026-05-27T09:25:00" (no Z suffix). Never natural language.' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function', function: {
      name: 'create_calendar_event',
      description: 'Create a calendar event in the local calendar (DB).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title' },
          description: { type: 'string' },
          start_time: { type: 'string', description: 'Local ISO e.g. "2026-03-20T14:00:00"' },
          end_time: { type: 'string' },
          all_day: { type: 'boolean' },
          location: { type: 'string' },
        },
        required: ['title', 'start_time'],
      },
    },
  },
  {
    type: 'function', function: {
      name: 'list_calendar_events',
      description: 'List calendar events in a date range (local ISO start/end) from the local calendar (DB).',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Local ISO lower bound' },
          end: { type: 'string', description: 'Local ISO upper bound' },
        },
      },
    },
  },
  {
    type: 'function', function: {
      name: 'update_calendar_event',
      description: 'Update an existing calendar event by uid. Only provided fields are changed.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event uid' },
          title: { type: 'string' }, description: { type: 'string' },
          start_time: { type: 'string' }, end_time: { type: 'string' },
          location: { type: 'string' }, all_day: { type: 'boolean' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function', function: {
      name: 'delete_calendar_event',
      description: 'Delete a calendar event by uid.',
      parameters: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] },
    },
  },
];

// ---- example builders ---------------------------------------------------

// Single-turn: user request → one or more tool calls, then an optional text
// reply (emitted as a separate assistant turn after a synthetic tool result).
function ex(request, toolCalls, opts = {}) {
  const msgs = [
    { role: 'system', content: DEXTER_SYSTEM },
    { role: 'user', content: `${ANCHOR}\n\n${request}` },
  ];
  // assistant turn: just the tool call(s). content empty per Granite convention.
  msgs.push({
    role: 'assistant', content: '',
    tool_calls: toolCalls.map(tc => ({ type: 'function', function: tc })),
  });
  // Synthetic tool results so the final summary turn is learnable.
  const results = opts.results || toolCalls.map(() => 'OK');
  for (let i = 0; i < toolCalls.length; i++) {
    msgs.push({ role: 'tool', name: toolCalls[i].name, content: String(results[i]) });
  }
  if (opts.reply) msgs.push({ role: 'assistant', content: opts.reply });
  return { messages: msgs, tools: TOOLS };
}

// No-tool: assistant replies with text only (ask-back / out-of-scope).
function exText(request, reply) {
  return {
    messages: [
      { role: 'system', content: DEXTER_SYSTEM },
      { role: 'user', content: `${ANCHOR}\n\n${request}` },
      { role: 'assistant', content: reply },
    ],
    tools: TOOLS,
  };
}

// Multi-turn manage: list first, then act on a returned id.
function exManage(request, { listTool, listResult, actionTool, actionArgs, actionResult, reply }) {
  const msgs = [
    { role: 'system', content: DEXTER_SYSTEM },
    { role: 'user', content: `${ANCHOR}\n\n${request}` },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: listTool, arguments: {} } }] },
    { role: 'tool', name: listTool, content: listResult },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: actionTool, arguments: actionArgs } }] },
    { role: 'tool', name: actionTool, content: actionResult },
    { role: 'assistant', content: reply },
  ];
  return { messages: msgs, tools: TOOLS };
}

const examples = [];

// ---- A. Relative once reminders (duration) — the clock-math bug class ----
examples.push(ex('remind me in 2 minutes to check the oven',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the oven.', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the oven in 2 minutes (PT2M).' }));
examples.push(ex('in 90 seconds, tell me to stand up',
  [{ name: 'schedule_task', arguments: { prompt: 'Stand up and stretch.', schedule_type: 'once', schedule_value: 'PT90S', context_mode: 'group' } }],
  { reply: 'Set a reminder to stand up in 90 seconds (PT90S).' }));
examples.push(ex('remind me in an hour and a half to call mom',
  [{ name: 'schedule_task', arguments: { prompt: 'Call mom.', schedule_type: 'once', schedule_value: 'PT1H30M', context_mode: 'group' } }],
  { reply: 'Set a reminder to call mom in 1 hour 30 minutes (PT1H30M).' }));
examples.push(ex('remind me tomorrow to pay rent',
  [{ name: 'schedule_task', arguments: { prompt: 'Pay rent.', schedule_type: 'once', schedule_value: 'P1D', context_mode: 'group' } }],
  { reply: 'Set a reminder to pay rent tomorrow (P1D).' }));
examples.push(ex('remind me in 2 days to renew my passport',
  [{ name: 'schedule_task', arguments: { prompt: 'Renew your passport.', schedule_type: 'once', schedule_value: 'P2D', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your passport in 2 days (P2D).' }));
examples.push(ex('in 45 seconds ping me about the build',
  [{ name: 'schedule_task', arguments: { prompt: 'The build is done — check the results.', schedule_type: 'once', schedule_value: 'PT45S', context_mode: 'group' } }],
  { reply: 'Set a reminder about the build in 45 seconds (PT45S).' }));
examples.push(ex('remind me in 3 hours to take the cake out',
  [{ name: 'schedule_task', arguments: { prompt: 'Take the cake out of the oven.', schedule_type: 'once', schedule_value: 'PT3H', context_mode: 'group' } }],
  { reply: 'Set a reminder to take the cake out in 3 hours (PT3H).' }));
examples.push(ex('remind me in 1 minute to flip the timer',
  [{ name: 'schedule_task', arguments: { prompt: 'Flip the timer.', schedule_type: 'once', schedule_value: 'PT1M', context_mode: 'group' } }],
  { reply: 'Set a reminder to flip the timer in 1 minute (PT1M).' }));

// ---- B. Absolute once reminders (named clock time) — compute from anchor ----
// anchor = 2026-08-31 14:05 Vancouver.
examples.push(ex('remind me at 3 PM today to pick up the kids',
  [{ name: 'schedule_task', arguments: { prompt: 'Pick up the kids.', schedule_type: 'once', schedule_value: '2026-08-31T15:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to pick up the kids at 3 PM today (2026-08-31T15:00:00).' }));
examples.push(ex('remind me at 5:00 tomorrow morning to take my medication',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your medication.', schedule_type: 'once', schedule_value: '2026-09-01T05:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take your medication at 5:00 tomorrow morning (2026-09-01T05:00:00).' }));
examples.push(ex('at 9:30am on March 20, remind me to submit the quarterly report',
  [{ name: 'schedule_task', arguments: { prompt: 'Submit the quarterly report.', schedule_type: 'once', schedule_value: '2026-03-20T09:30:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the quarterly report at 9:30am on March 20 (2026-03-20T09:30:00).' }));
examples.push(ex('remind me tonight at 8pm to water the plants',
  [{ name: 'schedule_task', arguments: { prompt: 'Water the plants.', schedule_type: 'once', schedule_value: '2026-08-31T20:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to water the plants tonight at 8pm (2026-08-31T20:00:00).' }));
examples.push(ex('remind me at noon tomorrow to call the dentist',
  [{ name: 'schedule_task', arguments: { prompt: 'Call the dentist to book an appointment.', schedule_type: 'once', schedule_value: '2026-09-01T12:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to call the dentist at noon tomorrow (2026-09-01T12:00:00).' }));
examples.push(ex('remind me on September 5 at 2pm to submit the visa application',
  [{ name: 'schedule_task', arguments: { prompt: 'Submit the visa application.', schedule_type: 'once', schedule_value: '2026-09-05T14:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to submit the visa application on September 5 at 2pm (2026-09-05T14:00:00).' }));
examples.push(ex('remind me on October 1 at 9am to renew my drivers license',
  [{ name: 'schedule_task', arguments: { prompt: 'Renew your drivers license.', schedule_type: 'once', schedule_value: '2026-10-01T09:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to renew your drivers license on October 1 at 9am (2026-10-01T09:00:00).' }));
examples.push(ex('remind me tonight at 11:45pm to take out the recycling',
  [{ name: 'schedule_task', arguments: { prompt: 'Take out the recycling.', schedule_type: 'once', schedule_value: '2026-08-31T23:45:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to take out the recycling tonight at 11:45pm (2026-08-31T23:45:00).' }));
examples.push(ex('remind me on September 10 at 8am to catch my flight',
  [{ name: 'schedule_task', arguments: { prompt: 'Head to the airport — your flight is soon.', schedule_type: 'once', schedule_value: '2026-09-10T08:00:00', context_mode: 'group' } }],
  { reply: 'Set a reminder to catch your flight on September 10 at 8am (2026-09-10T08:00:00).' }));

// ---- C. Recurring cron — the field-placement bug class -----------------
examples.push(ex('remind me every day at 10:30am to take my medication',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your medication.', schedule_type: 'cron', schedule_value: '30 10 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily reminder at 10:30am to take your medication (cron 30 10 * * *).' }));
examples.push(ex('remind me to take xyz medication every day at 11:30am',
  [{ name: 'schedule_task', arguments: { prompt: 'Take xyz medication.', schedule_type: 'cron', schedule_value: '30 11 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily reminder at 11:30am to take xyz medication (cron 30 11 * * *).' }));
examples.push(ex('every day at 7am remind me to meditate',
  [{ name: 'schedule_task', arguments: { prompt: 'Meditate.', schedule_type: 'cron', schedule_value: '0 7 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 7am meditation reminder (cron 0 7 * * *).' }));
examples.push(ex('remind me every weekday at 9am to stand up',
  [{ name: 'schedule_task', arguments: { prompt: 'Stand up and stretch.', schedule_type: 'cron', schedule_value: '0 9 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 9am stand-up reminder (cron 0 9 * * 1-5).' }));
examples.push(ex('every Monday at 6pm remind me to take out the trash',
  [{ name: 'schedule_task', arguments: { prompt: 'Take out the trash.', schedule_type: 'cron', schedule_value: '0 18 * * 1', context_mode: 'group' } }],
  { reply: 'Set a Monday 6pm trash reminder (cron 0 18 * * 1).' }));
examples.push(ex('remind me every Friday at 5pm to file my timesheet',
  [{ name: 'schedule_task', arguments: { prompt: 'File your timesheet.', schedule_type: 'cron', schedule_value: '0 17 * * 5', context_mode: 'group' } }],
  { reply: 'Set a Friday 5pm timesheet reminder (cron 0 17 * * 5).' }));
examples.push(ex('remind me on the 1st of every month at 9am to pay rent',
  [{ name: 'schedule_task', arguments: { prompt: 'Pay rent.', schedule_type: 'cron', schedule_value: '0 9 1 * *', context_mode: 'group' } }],
  { reply: 'Set a monthly 1st-at-9am rent reminder (cron 0 9 1 * *).' }));
examples.push(ex('every 15th at noon, remind me to review the budget',
  [{ name: 'schedule_task', arguments: { prompt: 'Review the budget.', schedule_type: 'cron', schedule_value: '0 12 15 * *', context_mode: 'group' } }],
  { reply: 'Set a monthly 15th-at-noon budget review (cron 0 12 15 * *).' }));
examples.push(ex('remind me every weekday morning at 8:15 to leave for work',
  [{ name: 'schedule_task', arguments: { prompt: 'Leave for work.', schedule_type: 'cron', schedule_value: '15 8 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 8:15am leave-for-work reminder (cron 15 8 * * 1-5).' }));
examples.push(ex('remind me at 5:30pm every day to log off work',
  [{ name: 'schedule_task', arguments: { prompt: 'Log off work for the day.', schedule_type: 'cron', schedule_value: '30 17 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 5:30pm log-off reminder (cron 30 17 * * *).' }));
examples.push(ex('every Sunday at 9am remind me to plan the week',
  [{ name: 'schedule_task', arguments: { prompt: 'Plan the week ahead.', schedule_type: 'cron', schedule_value: '0 9 * * 0', context_mode: 'group' } }],
  { reply: 'Set a Sunday 9am weekly planning reminder (cron 0 9 * * 0).' }));
examples.push(ex('remind me every weekday at 12:30 to eat lunch',
  [{ name: 'schedule_task', arguments: { prompt: 'Eat lunch.', schedule_type: 'cron', schedule_value: '30 12 * * 1-5', context_mode: 'group' } }],
  { reply: 'Set a weekday 12:30pm lunch reminder (cron 30 12 * * 1-5).' }));
examples.push(ex('remind me on the last day of every month at 6pm to close the books',
  [{ name: 'schedule_task', arguments: { prompt: 'Close the books for the month.', schedule_type: 'cron', schedule_value: '0 18 28-31 * *', context_mode: 'group' } }],
  { reply: 'Set a month-end 6pm close-the-books reminder (cron 0 18 28-31 * *).' }));
// ---- C2. Cron with step / comma / range fields --------------------------
examples.push(ex('remind me every 2 hours on the hour to drink water',
  [{ name: 'schedule_task', arguments: { prompt: 'Drink some water.', schedule_type: 'cron', schedule_value: '0 */2 * * *', context_mode: 'group' } }],
  { reply: 'Set a water reminder every 2 hours on the hour (cron 0 */2 * * *).' }));
examples.push(ex('ping me every 15 minutes to check the queue',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the queue.', schedule_type: 'cron', schedule_value: '*/15 * * * *', context_mode: 'group' } }],
  { reply: 'Set a queue-check reminder every 15 minutes (cron */15 * * * *).' }));
examples.push(ex('remind me at 9am and 9pm every day to take my eye drops',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your eye drops.', schedule_type: 'cron', schedule_value: '0 9,21 * * *', context_mode: 'group' } }],
  { reply: 'Set a twice-daily 9am/9pm eye-drops reminder (cron 0 9,21 * * *).' }));
examples.push(ex('remind me every other day at 8am to water the plants',
  [{ name: 'schedule_task', arguments: { prompt: 'Water the plants.', schedule_type: 'cron', schedule_value: '0 8 */2 * *', context_mode: 'group' } }],
  { reply: 'Set an every-other-day 8am plant-watering reminder (cron 0 8 */2 * *).' }));
examples.push(ex('remind me on weekends at 10am to do laundry',
  [{ name: 'schedule_task', arguments: { prompt: 'Do laundry.', schedule_type: 'cron', schedule_value: '0 10 * * 0,6', context_mode: 'group' } }],
  { reply: 'Set a weekend 10am laundry reminder (cron 0 10 * * 0,6).' }));
examples.push(ex('remind me every 6 hours to change the laundry over',
  [{ name: 'schedule_task', arguments: { prompt: 'Change the laundry over.', schedule_type: 'cron', schedule_value: '0 */6 * * *', context_mode: 'group' } }],
  { reply: 'Set a laundry reminder every 6 hours (cron 0 */6 * * *).' }));

// ---- D. Interval -------------------------------------------------------
examples.push(ex('remind me every 5 minutes to check the build status',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the build status.', schedule_type: 'interval', schedule_value: '300000', context_mode: 'group' } }],
  { reply: 'Set a reminder to check the build every 5 minutes (interval 300000ms).' }));
examples.push(ex('every 30 minutes remind me to drink water',
  [{ name: 'schedule_task', arguments: { prompt: 'Drink some water.', schedule_type: 'interval', schedule_value: '1800000', context_mode: 'group' } }],
  { reply: 'Set a water reminder every 30 minutes (interval 1800000ms).' }));
examples.push(ex('remind me every 2 hours to stretch my back',
  [{ name: 'schedule_task', arguments: { prompt: 'Stretch your back.', schedule_type: 'interval', schedule_value: '7200000', context_mode: 'group' } }],
  { reply: 'Set a stretch reminder every 2 hours (interval 7200000ms).' }));
examples.push(ex('ping me every 90 minutes to check the server',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the server.', schedule_type: 'interval', schedule_value: '5400000', context_mode: 'group' } }],
  { reply: 'Set a server-check reminder every 90 minutes (interval 5400000ms).' }));
examples.push(ex('remind me every 10 minutes to check the build log',
  [{ name: 'schedule_task', arguments: { prompt: 'Check the build log for failures.', schedule_type: 'interval', schedule_value: '600000', context_mode: 'group' } }],
  { reply: 'Set a build-log reminder every 10 minutes (interval 600000ms).' }));
examples.push(ex('remind me every 45 minutes to look away from the screen',
  [{ name: 'schedule_task', arguments: { prompt: 'Look away from the screen and rest your eyes.', schedule_type: 'interval', schedule_value: '2700000', context_mode: 'group' } }],
  { reply: 'Set an eye-rest reminder every 45 minutes (interval 2700000ms).' }));
examples.push(ex('remind me every 8 hours to take my antibiotics',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your antibiotics.', schedule_type: 'interval', schedule_value: '28800000', context_mode: 'group' } }],
  { reply: 'Set an antibiotics reminder every 8 hours (interval 28800000ms).' }));
examples.push(ex('remind me every 3 hours to feed the cat',
  [{ name: 'schedule_task', arguments: { prompt: 'Feed the cat.', schedule_type: 'interval', schedule_value: '10800000', context_mode: 'group' } }],
  { reply: 'Set a cat-feeding reminder every 3 hours (interval 10800000ms).' }));

// ---- E. Manage flows (list → act on returned id), multi-turn -----------
examples.push(exManage('cancel my medication reminder', {
  listTool: 'list_tasks',
  listResult: '4 tasks:\n1. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n2. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active\n3. heartbeat-owner | cron 45 * * * * | Run heartbeat | paused\n4. iris-digest-daily | cron 17 21 * * * | Scan INPUT | paused',
  actionTool: 'cancel_task',
  actionArgs: { task_id: 'task-cb-1788206097352-yadl0c' },
  actionResult: 'Task task-cb-1788206097352-yadl0c cancelled.',
  reply: 'Cancelled your "Take xyz medication" reminder (30 11 * * *).',
}));
examples.push(exManage('pause the meditation reminder', {
  listTool: 'list_tasks',
  listResult: '2 tasks:\n1. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active\n2. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active',
  actionTool: 'pause_task',
  actionArgs: { task_id: 'task-cb-1788206097352-abc123' },
  actionResult: 'Task task-cb-1788206097352-abc123 paused.',
  reply: 'Paused your 7am meditation reminder.',
}));
examples.push(exManage('reschedule my 9am stand-up reminder to 10am on weekdays', {
  listTool: 'list_tasks',
  listResult: '2 tasks:\n1. task-cb-1788206097352-def456 | cron 0 9 * * 1-5 | Stand up | active\n2. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active',
  actionTool: 'update_task',
  actionArgs: { task_id: 'task-cb-1788206097352-def456', schedule_type: 'cron', schedule_value: '0 10 * * 1-5' },
  actionResult: 'Task task-cb-1788206097352-def456 updated.',
  reply: 'Moved the weekday stand-up reminder from 9am to 10am (cron 0 10 * * 1-5).',
}));
examples.push(ex('what reminders do I have set?',
  [{ name: 'list_tasks', arguments: {} }],
  {
    results: ['3 tasks:\n1. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n2. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active\n3. task-cb-1788206097352-xyz789 | once PT2M | Check the oven | active'],
    reply: 'You have 3 active reminders: take xyz medication daily at 11:30am, meditate daily at 7am, and check the oven in 2 minutes.',
  }));
examples.push(exManage('resume the meditation reminder I paused', {
  listTool: 'list_tasks',
  listResult: '2 tasks:\n1. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | paused\n2. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active',
  actionTool: 'resume_task',
  actionArgs: { task_id: 'task-cb-1788206097352-abc123' },
  actionResult: 'Task task-cb-1788206097352-abc123 resumed.',
  reply: 'Resumed your 7am meditation reminder.',
}));
examples.push(exManage('cancel the 8:15am leave-for-work reminder', {
  listTool: 'list_tasks',
  listResult: '3 tasks:\n1. task-cb-1788206097352-leave01 | cron 15 8 * * 1-5 | Leave for work | active\n2. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n3. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active',
  actionTool: 'cancel_task',
  actionArgs: { task_id: 'task-cb-1788206097352-leave01' },
  actionResult: 'Task task-cb-1788206097352-leave01 cancelled.',
  reply: 'Cancelled your weekday 8:15am leave-for-work reminder.',
}));
examples.push(exManage('change my medication reminder from 11:30am to 12:30pm daily', {
  listTool: 'list_tasks',
  listResult: '2 tasks:\n1. task-cb-1788206097352-yadl0c | cron 30 11 * * * | Take xyz medication | active\n2. task-cb-1788206097352-abc123 | cron 0 7 * * * | Meditate | active',
  actionTool: 'update_task',
  actionArgs: { task_id: 'task-cb-1788206097352-yadl0c', schedule_type: 'cron', schedule_value: '30 12 * * *' },
  actionResult: 'Task task-cb-1788206097352-yadl0c updated.',
  reply: 'Moved your medication reminder from 11:30am to 12:30pm daily (cron 30 12 * * *).',
}));

// ---- F. Calendar events ------------------------------------------------
examples.push(ex('create a meeting tomorrow at 2pm called Project Review',
  [{ name: 'create_calendar_event', arguments: { title: 'Project Review', start_time: '2026-09-01T14:00:00' } }],
  { reply: 'Created a "Project Review" calendar event tomorrow at 2pm (2026-09-01T14:00:00).' }));
examples.push(ex('schedule a dentist appointment on March 15 at 10am',
  [{ name: 'create_calendar_event', arguments: { title: 'Dentist appointment', start_time: '2026-03-15T10:00:00' } }],
  { reply: 'Created a "Dentist appointment" calendar event on March 15 at 10am.' }));
examples.push(ex('add an all-day event on Friday called Company Holiday',
  [{ name: 'create_calendar_event', arguments: { title: 'Company Holiday', start_time: '2026-09-04T00:00:00', all_day: true } }],
  { reply: 'Created an all-day "Company Holiday" calendar event on Friday 2026-09-04.' }));
examples.push(ex('create a 1-hour meeting at 3pm today called Team Sync',
  [{ name: 'create_calendar_event', arguments: { title: 'Team Sync', start_time: '2026-08-31T15:00:00', end_time: '2026-08-31T16:00:00' } }],
  { reply: 'Created a "Team Sync" meeting today 3–4pm (2026-08-31T15:00:00–16:00:00).' }));
examples.push(ex('book the conference room for a meeting tomorrow 10am to 11:30am called Vendor Demo',
  [{ name: 'create_calendar_event', arguments: { title: 'Vendor Demo', start_time: '2026-09-01T10:00:00', end_time: '2026-09-01T11:30:00', location: 'Conference room' } }],
  { reply: 'Created a "Vendor Demo" in the conference room tomorrow 10–11:30am.' }));
examples.push(ex('what is on my calendar this week?',
  [{ name: 'list_calendar_events', arguments: { start: '2026-08-31T00:00:00', end: '2026-09-06T23:59:59' } }],
  {
    results: ['2 events:\n1. 2026-09-01T14:00:00 → 2026-09-01T15:00:00 | Project Review\n2. 2026-09-04T00:00:00 | Company Holiday'],
    reply: 'This week you have: Project Review tomorrow 2–3pm, and an all-day Company Holiday on Friday.',
  }));
examples.push(exManage('cancel the Project Review meeting', {
  listTool: 'list_calendar_events',
  listResult: '2 events:\n1. 2026-09-01T14:00:00 → 2026-09-01T15:00:00 | Project Review (uid ev-1001)\n2. 2026-09-04T00:00:00 | Company Holiday (uid ev-1002)',
  actionTool: 'delete_calendar_event',
  actionArgs: { event_id: 'ev-1001' },
  actionResult: 'Calendar event ev-1001 deleted.',
  reply: 'Cancelled the Project Review meeting (tomorrow 2pm).',
}));
examples.push(exManage('move my 2pm Project Review meeting to 3pm', {
  listTool: 'list_calendar_events',
  listResult: '1 event:\n1. 2026-09-01T14:00:00 → 2026-09-01T15:00:00 | Project Review (uid ev-1001)',
  actionTool: 'update_calendar_event',
  actionArgs: { event_id: 'ev-1001', start_time: '2026-09-01T15:00:00', end_time: '2026-09-01T16:00:00' },
  actionResult: 'Calendar event ev-1001 updated.',
  reply: 'Moved the Project Review from 2pm to 3pm tomorrow.',
}));

// ---- G. Both reminder + calendar event in one turn ---------------------
examples.push(ex('remind me at 2pm about the meeting and put a calendar event on for it',
  [
    { name: 'schedule_task', arguments: { prompt: 'It is time for the meeting.', schedule_type: 'once', schedule_value: '2026-08-31T14:00:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Meeting', start_time: '2026-08-31T14:00:00' } },
  ],
  { reply: 'Set a 2pm reminder for the meeting and created a calendar event for it (2026-08-31T14:00:00).' }));
examples.push(ex('put a 3pm Project Review meeting on my calendar tomorrow, and remind me 30 minutes before',
  [
    { name: 'schedule_task', arguments: { prompt: 'Project Review starts in 30 minutes.', schedule_type: 'once', schedule_value: '2026-09-01T14:30:00', context_mode: 'group' } },
    { name: 'create_calendar_event', arguments: { title: 'Project Review', start_time: '2026-09-01T15:00:00' } },
  ],
  { reply: 'Created a "Project Review" tomorrow at 3pm and set a reminder 30 minutes before, at 2:30pm.' }));

// ---- G2. Real production traffic (from logs/warden.log, 2026-08-31) -----
// These mirror the actual requests dexter received, with the CORRECT call.
// Logged failures (hallucinated content, 13:12, `0 11:30 * * *`, `0 11 12 * *`)
// are represented here only by their correct counterparts — SFT trains on
// correct outputs only.
examples.push(ex('set a one-time reminder to fire in 2 minutes, and the message text should be exactly: "test"',
  [{ name: 'schedule_task', arguments: { prompt: 'test', schedule_type: 'once', schedule_value: 'PT2M', context_mode: 'group' } }],
  { reply: 'Set a reminder with message "test" to fire in 2 minutes (PT2M).' }));
examples.push(ex('set a one-time reminder for 3 minutes from now with the message "test"',
  [{ name: 'schedule_task', arguments: { prompt: 'test', schedule_type: 'once', schedule_value: 'PT3M', context_mode: 'group' } }],
  { reply: 'Set a reminder with message "test" to fire in 3 minutes (PT3M).' }));
examples.push(ex('create a daily recurring reminder for 11:30 AM to take xyz medication',
  [{ name: 'schedule_task', arguments: { prompt: 'Take xyz medication.', schedule_type: 'cron', schedule_value: '30 11 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 11:30am reminder to take xyz medication (cron 30 11 * * *).' }));
examples.push(ex('remind me every day at 9:15 AM to take my vitamins',
  [{ name: 'schedule_task', arguments: { prompt: 'Take your vitamins.', schedule_type: 'cron', schedule_value: '15 9 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 9:15am vitamins reminder (cron 15 9 * * *).' }));
examples.push(ex('every day at 6:45pm remind me to close my laptop',
  [{ name: 'schedule_task', arguments: { prompt: 'Close your laptop and wrap up for the day.', schedule_type: 'cron', schedule_value: '45 18 * * *', context_mode: 'group' } }],
  { reply: 'Set a daily 6:45pm close-laptop reminder (cron 45 18 * * *).' }));
examples.push(ex('remind me every Tuesday and Thursday at 7am to go for a run',
  [{ name: 'schedule_task', arguments: { prompt: 'Go for a run.', schedule_type: 'cron', schedule_value: '0 7 * * 2,4', context_mode: 'group' } }],
  { reply: 'Set a Tue/Thu 7am run reminder (cron 0 7 * * 2,4).' }));
examples.push(exText('remind me at 11:30am every day',
  'What should the daily 11:30am reminder say? Give me the content.'));

// ---- H. No-payload / no-time / out-of-scope — do NOT invent ------------
examples.push(exText('set a reminder',
  'What should the reminder say and when should it fire? Tell me the content and the time.'));
examples.push(exText('remind me',
  'What should I remind you about, and when?'));
examples.push(exText('remind me in 10 minutes',
  'What should the reminder be about? Give me the content and I will set it for 10 minutes from now.'));
examples.push(exText('set a timer',
  'What is the timer for, and how long? Tell me the content and the duration (e.g. "5 minutes" or "1 hour").'));
examples.push(exText('remind me tomorrow morning',
  'What should the reminder say, and what time tomorrow morning? Give me the content and a specific time (e.g. "8am").'));
examples.push(exText('remind me to take my medication',
  'When should I remind you to take your medication? Give me a time (e.g. "every day at 11:30am" or "in 2 hours").'));
examples.push(exText('remind me every day at 11:30am',
  'What should the daily 11:30am reminder say? Give me the content.'));
examples.push(exText('remind me on the 15th of every month',
  'What should the monthly 15th reminder say? Give me the content.'));
examples.push(exText('add a todo to fix the kitchen sink',
  'A plain to-do with no time trigger belongs to Byte, not me. I have noted "fix the kitchen sink" — Byte can track it as a work task.'));
examples.push(exText('remind me to call the bank',
  'When should I remind you to call the bank? Give me a time (e.g. "tomorrow at 10am" or "in 3 hours").'));

// ---- emit --------------------------------------------------------------
const lines = examples.map(e => JSON.stringify(e));
writeFileSync(new URL('./dexter-sft.jsonl', import.meta.url), lines.join('\n') + '\n');
console.log(`Wrote ${examples.length} examples to dexter-sft.jsonl`);

// Sanity: category counts.
const counts = {};
for (const e of examples) {
  const a = e.messages.find(m => m.role === 'assistant');
  const key = a?.tool_calls ? a.tool_calls.map(t => t.function.name).join('+') : 'text-only';
  counts[key] = (counts[key] || 0) + 1;
}
console.log('By target:', counts);