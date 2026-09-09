// dryfire.mjs — stand-alone verification of the fine-tuned toolcall model
// against the REAL per-agent execution model (verified 2026-09-05 against the
// live sources — the merged, single-agent reality since byte folded into
// iris):
//
//   iris   — the SINGLE toolcall delegate (maxIterations: 1). Exactly ONE
//            model turn: every tool call it can make must be in that turn
//            (one call, or a parallel set when the request names several
//            things — the reminder+calendar pair). Tool results go straight
//            back to the orchestrator — the model never sees them. So this
//            harness makes ONE Ollama call per case and scores that turn; a
//            model that tries to chain (call a tool "first") has FAILED the
//            real contract, because in production the run ends there and the
//            raw tool result is handed back. Manage (cancel/pause/update,
//            work tasks, projects) requests arrive WITH the id — the
//            orchestrator resolves it in its own dispatch — and email replies
//            arrive WITH the resolved address ("Reply to Sarah
//            (sarah@acme.io) …").
//   digest — the `iris-digest-<span>` background run-mode (container/
//            agent-runner iris-digest branch). Digest system prompt,
//            read_emails as the ONLY tool, prompt = buildDigestContext INPUT
//            + "---" + the baked span prompt — all pulled from the live
//            sources via digest_reality.mjs. Correct behavior: read_emails
//            with since/before copied VERBATIM from the INPUT "Email window
//            (UTC)" line (limit 50/100/200, preview_only true), then the
//            digest JSON object as FINAL TEXT. The runner publishes that text
//            to /api/summaries — the model never calls post_summary (it isn't
//            even in the tool list).
//
//   (A sentry run-mode suite existed here until 2026-09-08, when the user
//   switched sentry to share the orchestrator/atlas model — the toolcall
//   fine-tune no longer covers sentry, so its cases were removed.)
//
//   node dryfire.mjs                      # default model toolcall-ft
//   MODEL=granite4.1:3b node dryfire.mjs   # baseline stock model for compare
//   OLLAMA=http://host:11434 node dryfire.mjs
//
// Exits non-zero if any case fails.

import {
  SYSTEMS, TOOLS, ANCHOR, DIGEST_SYSTEM, DIGEST_PROMPTS, DIGEST_TOOLS,
} from './gen_toolcall_sft.mjs';
import { buildDigestInput, validateDigestJson } from './digest_reality.mjs';

const MODEL = process.env.MODEL || 'toolcall-ft';
const OLLAMA = (process.env.OLLAMA || 'http://localhost:11434').replace(/\/$/, '');
const DIGEST_TURNS = 3;    // read once (maybe retry once), then JSON text

// ---- digest case fixtures -------------------------------------------------
// INPUT blocks in the exact buildDigestContext shape; since/before are what a
// correct model must pass verbatim. senders = addresses the fake returns
// (grounding check). limit per the baked prompt (50/100/200).
const DIGEST_CASES = [
  {
    span: 'daily',
    input: buildDigestInput({
      localTime: '8/31/2026, 8:00:07 AM',
      since: '2026-08-30T15:00:07.000Z', before: '2026-08-31T15:00:07.000Z',
      bio: 'Location: Victoria, BC\nDominic — software engineer; prefers terse summaries; deep-work mornings.',
      calendar: ['- 2026-08-31T14:00:00 → 2026-08-31T15:00:00: Project Review', '- 2026-08-31T18:00:00 → 2026-08-31T18:30:00: Dentist'],
      tasks: ['- [todo] Finish API spec (project personal)', '- [todo] Fix login bug (project personal)'],
      weather: ['Now: 18°C, Partly cloudy, humidity 58%', 'Next hours: 09:00 18°C, 10:00 19°C, 11:00 20°C'],
      lookout: ['- Q4 budget sign-off from Sarah'],
    }),
    since: '2026-08-30T15:00:07.000Z', before: '2026-08-31T15:00:07.000Z', limit: 100,
    fakeResult: '3 emails:\n1. 2026-08-30T22:14 sarah@acme.io | "Re: Q4 budget approval needed" — needs sign-off by Friday\n2. 2026-08-30T19:02 jason@partnerco.com | "Action required: sign the NDA"\n3. 2026-08-30T15:30 newsletter@hackernews.com | "HN Weekly" (newsletter)',
    senders: ['sarah@acme.io', 'jason@partnerco.com', 'newsletter@hackernews.com'],
    wantAlert: true, // lookout item matched Sarah's email
  },
  {
    span: 'hourly',
    input: buildDigestInput({
      localTime: '8/31/2026, 1:07:00 PM',
      since: '2026-08-31T19:07:00.000Z', before: '2026-08-31T20:07:00.000Z',
      bio: 'Location: Victoria, BC\nDominic — deep-work mornings.',
      calendar: ['- 2026-08-31T14:00:00 → 2026-08-31T15:00:00: Project Review'],
      tasks: ['- [todo] Fix login bug (project personal)'],
      weather: ['Now: 20°C, Partly cloudy, humidity 55%', 'Next hours: 14:00 20°C, 15:00 21°C, 16:00 21°C'],
      lookout: ['- Build failures from CI'],
    }),
    since: '2026-08-31T19:07:00.000Z', before: '2026-08-31T20:07:00.000Z', limit: 50,
    fakeResult: '1 email:\n1. 2026-08-31T12:42 ci-bot@warden | "Build #1284 failed" — tests/test_scheduler.py assertion error',
    senders: ['ci-bot@warden'],
    wantAlert: true,
    wantEmptyActionables: true, // bot-sent mail is never an actionable item
  },
  {
    span: 'hourly',
    input: buildDigestInput({
      localTime: '8/31/2026, 4:07:00 PM',
      since: '2026-08-31T22:07:00.000Z', before: '2026-08-31T23:07:00.000Z',
      bio: 'Location: Victoria, BC\nDominic.',
      calendar: [],
      tasks: ['- [todo] Review PRs (project proj-warden-01)'],
      weather: ['Now: 19°C, Sunny, humidity 52%'],
      lookout: [],
    }),
    since: '2026-08-31T22:07:00.000Z', before: '2026-08-31T23:07:00.000Z', limit: 50,
    fakeResult: '1 email:\n1. 2026-08-31T15:55 jason@partnerco.com | "Action required: sign the NDA" — please review and sign the attached NDA by end of week',
    senders: ['jason@partnerco.com'],
    wantActionables: true, // the NDA email is a genuine to-do
  },
  {
    span: 'weekly',
    input: buildDigestInput({
      localTime: '8/30/2026, 8:32:00 PM',
      since: '2026-08-24T03:32:00.000Z', before: '2026-08-31T03:32:00.000Z',
      bio: 'Location: Victoria, BC\nDominic — software engineer; prefers terse summaries.',
      calendar: ['- 2026-08-31T14:00:00 → 2026-08-31T15:00:00: Project Review', '- 2026-09-01T10:00:00 → 2026-09-01T10:30:00: 1:1 with Sarah'],
      tasks: ['- [doing] Migrate DB (project proj-warden-01)', '- [todo] Write integration tests (project proj-warden-01)'],
      weather: ['Now: 17°C, Clear, humidity 60%'],
      lookout: [],
    }),
    since: '2026-08-24T03:32:00.000Z', before: '2026-08-31T03:32:00.000Z', limit: 200,
    fakeResult: '12 emails this week. From: 2026-08-25 sarah@acme.io — "Roadmap feedback"; 2026-08-28 finance@acme.io — "Expense report due Sep 5". 10 newsletters/receipts — non-actionable.',
    senders: ['sarah@acme.io', 'finance@acme.io'],
  },
  {
    span: 'hourly',
    input: buildDigestInput({
      localTime: '8/31/2026, 7:07:00 AM',
      since: '2026-08-31T13:07:00.000Z', before: '2026-08-31T14:07:00.000Z',
      bio: 'Location: Victoria, BC\nDominic.',
      calendar: [],
      tasks: [],
      weather: ['Now: 14°C, Clear, humidity 70%'],
      lookout: [],
    }),
    since: '2026-08-31T13:07:00.000Z', before: '2026-08-31T14:07:00.000Z', limit: 50,
    fakeResult: '0 emails received in this window.',
    senders: [],
    wantEmptyActionables: true,
  },
];

// ---- test cases ----------------------------------------------------------
// expect: the EXACT call set for the single turn, ordered steps {name, args?}
// (args = case-insensitive substring per key). Single-shot means no
// error-recovery turns exist — a wrong first call is a failure, full stop.
// noTool: the model must NOT call any tool — it asks back in text.
// replyIncludes: the text reply must contain the string (case-insensitive).
const CASES = [
  // ---- iris: relative duration (the clock-math bug class) — brief style --
  { agent: 'iris', req: 'Set a one-time reminder to check the oven in 2 minutes.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'once', schedule_value: 'PT2M', prompt: 'Check the oven.' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to stand up and stretch in 90 seconds.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'once', schedule_value: 'PT90S' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to call mom in an hour and a half.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'once', schedule_value: 'PT1H30M' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to pay rent tomorrow.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'once', schedule_value: 'P1D' } }] },
  // ---- iris: absolute clock time, computed from the anchor --------------
  { agent: 'iris', req: 'Set a one-time reminder to pick up the kids at 3:00 PM today.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'once', schedule_value: '2026-08-31T15:00:00' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to take medication at 5:00 AM tomorrow.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'once', schedule_value: '2026-09-01T05:00:00' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to water the plants at 8:00 PM today.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'once', schedule_value: '2026-08-31T20:00:00' } }] },
  // ---- iris: cron (the wrong-field bug class) ----------------------------
  { agent: 'iris', req: 'Set a recurring reminder daily at 10:30 AM to take medication.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'cron', schedule_value: '30 10 * * *' } }] },
  { agent: 'iris', req: 'Set a recurring reminder daily at 11:30 AM to take xyz medication.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'cron', schedule_value: '30 11 * * *' } }] },
  { agent: 'iris', req: 'Set a recurring reminder every day at 7 AM to meditate.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'cron', schedule_value: '0 7 * * *' } }] },
  { agent: 'iris', req: 'Set a recurring reminder weekdays at 9 AM to stand up.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'cron', schedule_value: '0 9 * * 1-5' } }] },
  { agent: 'iris', req: 'Set a recurring reminder every Monday at 6 PM to take out the trash.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'cron', schedule_value: '0 18 * * 1' } }] },
  { agent: 'iris', req: 'Set a recurring reminder weekdays at 12:30 PM to eat lunch.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'cron', schedule_value: '30 12 * * 1-5' } }] },
  // ---- iris: interval (ms) ------------------------------------------------
  { agent: 'iris', req: 'Set a recurring interval reminder every 5 minutes to check the build status.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'interval', schedule_value: '300000' } }] },
  { agent: 'iris', req: 'Set a recurring interval reminder every 2 hours to stretch your back.',
    expect: [{ name: 'schedule_task', args: { schedule_type: 'interval', schedule_value: '7200000' } }] },
  // ---- iris: manage — id supplied by the orchestrator, one call ----------
  { agent: 'iris', req: 'Cancel the reminder task task-cb-1788206097352-yadl0c (the daily 11:30 AM "Take xyz medication").',
    expect: [{ name: 'cancel_task', args: { task_id: 'task-cb-1788206097352-yadl0c' } }] },
  { agent: 'iris', req: 'Pause the reminder task task-cb-1788206097352-abc123 (the daily 7 AM "Meditate").',
    expect: [{ name: 'pause_task', args: { task_id: 'task-cb-1788206097352-abc123' } }] },
  { agent: 'iris', req: 'Reschedule the reminder task task-cb-1788206097352-def456 (the weekday 9 AM stand-up) to 10:00 AM on weekdays.',
    expect: [{ name: 'update_task', args: { task_id: 'task-cb-1788206097352-def456', schedule_value: '0 10 * * 1-5' } }] },
  { agent: 'iris', req: 'List my current reminders.',
    expect: [{ name: 'list_tasks' }] },
  // ---- iris: calendar ------------------------------------------------------
  { agent: 'iris', req: 'Create a calendar event tomorrow at 2:00 PM called "Project Review".',
    expect: [{ name: 'create_calendar_event', args: { title: 'Project Review', start_time: '2026-09-01T14:00:00' } }] },
  { agent: 'iris', req: 'Delete the calendar event ev-1001 (the "Project Review" meeting tomorrow at 2 PM).',
    expect: [{ name: 'delete_calendar_event', args: { event_id: 'ev-1001' } }] },
  { agent: 'iris', req: "List this week's calendar events.",
    expect: [{ name: 'list_calendar_events' }] },
  // ---- iris: reminder + calendar in ONE turn (the one allowed multi-call) -
  { agent: 'iris', req: 'Set a one-time reminder about the team meeting at 2:00 PM today, and create a calendar event called "Team meeting" at 2:00 PM today.',
    expect: [
      { name: 'schedule_task', args: { schedule_type: 'once', schedule_value: '2026-08-31T14:00:00' } },
      { name: 'create_calendar_event', args: { title: 'Team meeting', start_time: '2026-08-31T14:00:00' } },
    ] },
  // ---- iris: ask-back — do NOT invent content -----------------------------
  { agent: 'iris', req: 'Set a one-time reminder in 10 minutes.', noTool: true, replyIncludes: 'content' },
  { agent: 'iris', req: 'Set a recurring reminder daily at 11:30 AM.', noTool: true, replyIncludes: 'content' },
  { agent: 'iris', req: 'Set a reminder to take medication.', noTool: true, replyIncludes: 'time' },
  // ---- iris: email — briefs carry resolved addresses/ids ----------------
  { agent: 'iris', req: 'Check my inbox — what emails are there?',
    expect: [{ name: 'read_emails' }] },
  { agent: 'iris', req: 'Search emails from Sarah about the Q4 budget.',
    expect: [{ name: 'read_emails', args: { search: 'sarah' } }] },
  { agent: 'iris', req: 'Reply to Sarah (sarah@acme.io) and tell her I will sign off the Q4 budget by Friday — send the reply.',
    expect: [{ name: 'send_email', args: { to: 'sarah@acme.io' } }] },
  { agent: 'iris', req: 'Get the full body of email email-4f2a.',
    expect: [{ name: 'get_email', args: { email_id: 'email-4f2a' } }] },
  // ---- iris: admin --------------------------------------------------------
  { agent: 'iris', req: 'List my API keys.',
    expect: [{ name: 'list_api_keys' }] },
  { agent: 'iris', req: 'Fetch my 5 most recently updated GitHub repos using the github key.',
    expect: [{ name: 'api_request', args: { key_type: 'github' } }] },

  // ---- iris: work management (absorbed from byte; single-shot — the brief
  // carries the id, one call per request) ----------------------------------
  { agent: 'iris', req: "add 'fix the login bug' to my list",
    expect: [{ name: 'create_work_task', args: { title: 'Fix the login bug', project_id: 'personal' } }] },
  { agent: 'iris', req: "add 'write the API spec' as a high priority task",
    expect: [{ name: 'create_work_task', args: { title: 'Write the API spec', project_id: 'personal', priority: 'high' } }] },
  { agent: 'iris', req: 'add an urgent task to ship the hotfix',
    expect: [{ name: 'create_work_task', args: { title: 'Ship the hotfix', project_id: 'personal', priority: 'urgent' } }] },
  // A plain to-do is iris's own work task now — she creates it directly.
  { agent: 'iris', req: 'Add a to-do item: fix the kitchen sink.',
    expect: [{ name: 'create_work_task', args: { title: 'Fix the kitchen sink', project_id: 'personal' } }] },
  // Named project → the orchestrator resolves the id; the brief carries it.
  { agent: 'iris', req: "add 'refactor the scheduler' to the Warden project (proj-warden-01)",
    expect: [{ name: 'create_work_task', args: { title: 'Refactor the scheduler', project_id: 'proj-warden-01' } }] },
  { agent: 'iris', req: 'mark the Acme Migration project (proj-acme-02) as At Risk',
    expect: [{ name: 'update_project', args: { project_id: 'proj-acme-02', status: 'At Risk' } }] },
  { agent: 'iris', req: 'mark Warden as Blocked (project id proj-warden-01)',
    expect: [{ name: 'update_project', args: { project_id: 'proj-warden-01', status: 'Blocked' } }] },
  { agent: 'iris', req: 'add a blocker to Warden (proj-warden-01): CI is flaky on arm64, high severity',
    expect: [{ name: 'add_blocker', args: { project_id: 'proj-warden-01', description: 'CI is flaky on arm64', severity: 'high' } }] },
  { agent: 'iris', req: 'add a priority to Warden (proj-warden-01): improve test coverage, high impact',
    expect: [{ name: 'add_priority', args: { project_id: 'proj-warden-01', item: 'Improve test coverage', impact: 'high' } }] },
  { agent: 'iris', req: 'set the Warden project (proj-warden-01) budget to 50000 and spent to 12000',
    expect: [{ name: 'update_financials', args: { project_id: 'proj-warden-01', budget: 50000, spent: 12000 } }] },
  { agent: 'iris', req: 'log 3.5 hours on Warden (proj-warden-01) today for the scheduler refactor',
    expect: [{ name: 'log_time', args: { project_id: 'proj-warden-01', hours: 3.5 } }] },
  // ---- iris: list / work-task manage (id supplied) ------------------------
  { agent: 'iris', req: 'what projects do I have?',
    expect: [{ name: 'list_projects' }] },
  { agent: 'iris', req: "mark the 'Fix the login bug' task as done (work task id wt-2001)",
    expect: [{ name: 'update_work_task', args: { task_id: 'wt-2001', status: 'done' } }] },
];

// ---- Ollama chat call ------------------------------------------------------
// STREAMING, on purpose: a non-streaming reply sends headers only after the
// whole generation, and Node's fetch (undici) gives up on headers after 300s —
// so a runaway generation aborts the CALL at ~302s while Ollama keeps
// generating server-side, and that zombie queues every later case past the same
// wall (2026-09-08: the whole first sentry baseline was poisoned this way).
// Streaming returns headers immediately, and an abort propagates the
// disconnect to Ollama, so the wall-clock cap below actually cancels runaways.
// A runaway generation (expected pre-training, esp. sentry) must be RECORDED
// as a case failure, not kill the suite — a wall-clock abort is the harness
// working as designed. Errors from a timeout carry .dryfireTimeout; other
// errors (model missing, malformed stream) stay fatal.
function isWallClock(e) {
  return Boolean(e?.dryfireTimeout) || e?.name === 'AbortError' || /wall-clock/.test(String(e?.message));
}

async function chat(messages, tools, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const timeoutErr = new Error('dryfire wall-clock exceeded');
  timeoutErr.dryfireTimeout = true;
  const t = setTimeout(() => ctrl.abort(timeoutErr), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, messages, tools, stream: true,
        options: { temperature: 0 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 404) throw new Error(`model "${MODEL}" not found in Ollama at ${OLLAMA} — run ./run.sh to build it, or set MODEL=<name>`);
      throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    // reassemble the streamed message: content concatenates; tool_calls come
    // per-index either as complete objects (this Ollama build sends the whole
    // call in one chunk) or as JSON string fragments (older builds) — support
    // both so neither form corrupts the other.
    let content = '';
    let buf = '';
    const dec = new TextDecoder();  // res.body chunks are Uint8Array — .toString() on those is "123,34,…"
    const names = [], argStrs = [], argObjs = [];
    const takeLine = (line) => {
      line = line.trim();
      if (!line) return;
      let j; try { j = JSON.parse(line); } catch { return; }
      if (j.error) throw new Error(`Ollama stream error: ${j.error}`);
      const m = j.message || {};
      if (m.content) content += m.content;
      for (const tc of m.tool_calls || []) {
        const i = tc.function?.index ?? 0;
        if (tc.function?.name) names[i] = tc.function.name;
        const a = tc.function?.arguments;
        if (typeof a === 'string') argStrs[i] = (argStrs[i] || '') + a;
        else if (a && typeof a === 'object') argObjs[i] = a;
      }
    };
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        takeLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    buf += dec.decode();      // flush trailing partial UTF-8
    takeLine(buf);            // then any final unterminated line
    const tool_calls = names.map((name, i) => {
      let args;
      if (argObjs[i] !== undefined) args = argObjs[i];
      else {
        args = argStrs[i] || '{}';
        try { args = JSON.parse(args); } catch { /* malformed — keep raw so the scorer sees it */ }
      }
      return { function: { name, arguments: args } };
    });
    return { content, tool_calls };
  } finally {
    clearTimeout(t);
  }
}

function parseCalls(msg) {
  return (msg.tool_calls || []).map((tc) => {
    let args = tc.function.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* leave */ } }
    return { name: tc.function.name, arguments: args || {} };
  });
}

// ---- runners (mirroring the live caps) -------------------------------------

// iris: ONE turn. The production single-shot contract — tool results are never
// fed back to the model, so there is exactly one Ollama call per case.
async function runIris(c) {
  const messages = [
    { role: 'system', content: SYSTEMS.iris },
    { role: 'user', content: `${ANCHOR}\n\n${c.req}` },
  ];
  const msg = await chat(messages, TOOLS.iris);
  return { calls: parseCalls(msg), finalText: msg.content || '' };
}

// digest: the iris-digest run-mode. DIGEST system prompt, read_emails only,
// INPUT + baked prompt; the model reads the window once then emits JSON text.
async function runDigest(c) {
  const messages = [
    { role: 'system', content: DIGEST_SYSTEM },
    { role: 'user', content: `${c.input}\n\n---\n\n${DIGEST_PROMPTS[c.span]}` },
  ];
  const calls = [];
  let finalText = '';
  for (let turn = 0; turn < DIGEST_TURNS; turn++) {
    const msg = await chat(messages, DIGEST_TOOLS);
    const tcs = parseCalls(msg);
    if (tcs.length) {
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const call of tcs) {
        calls.push(call);
        messages.push({ role: 'tool', name: call.name, content: call.name === 'read_emails' ? c.fakeResult : '(tool not available in a digest run)' });
      }
      continue;
    }
    finalText = msg.content || '';
    break;
  }
  return { calls, finalText };
}

// ---- matching -------------------------------------------------------------
function argsMatch(actual, exp) {
  if (!exp) return true;
  for (const k of Object.keys(exp)) {
    const av = actual?.[k];
    const ev = exp[k];
    if (typeof ev === 'string' && typeof av === 'string') {
      if (!av.toLowerCase().includes(ev.toLowerCase())) return false;
    } else if (av !== ev) {
      return false;
    }
  }
  return true;
}

function stepMatches(call, step) {
  const names = step.anyOf || [step.name];
  if (!names.includes(call?.name)) return false;
  return argsMatch(call?.arguments, step.args);
}

// ---- digest case scoring ----------------------------------------------------
function scoreDigest(c, calls, finalText) {
  const problems = [];
  const win = calls.filter((x) => x.name === 'read_emails');
  if (!win.length) problems.push('never called read_emails (digest must ground on the email window)');
  const wrong = calls.filter((x) => x.name !== 'read_emails');
  if (wrong.length) problems.push(`called unavailable tool(s): ${wrong.map((w) => w.name).join(', ')}`);
  if (win.length) {
    const a = win[0].arguments;
    if (a.since !== c.since) problems.push(`since not verbatim (got "${a.since}", want "${c.since}")`);
    if (a.before !== c.before) problems.push(`before not verbatim (got "${a.before}", want "${c.before}")`);
    if (a.limit !== c.limit) problems.push(`limit ${a.limit} (baked prompt says ${c.limit})`);
    if (a.preview_only !== true) problems.push('preview_only not true (baked prompt requires it)');
  }
  if (!finalText.trim()) problems.push('no final JSON text (the runner publishes the final text — empty means nothing published)');
  const v = validateDigestJson(c.span, finalText, c.senders);
  problems.push(...v.problems);
  if (v.parsed) {
    if (c.wantAlert && !v.parsed.alerts?.length) problems.push('a Look Out For item was matched but alerts is empty');
    if (!c.wantAlert && v.parsed.alerts?.length) problems.push('invented an alert with no Look Out For match');
    if (c.wantEmptyActionables && ((v.parsed.actionable_tasks || []).length || (v.parsed.actionable_events || []).length))
      problems.push('extracted actionable items from non-actionable mail (bot/newsletter/empty window)');
    if (c.wantActionables && !(v.parsed.actionable_tasks || []).length)
      problems.push('missed the actionable to-do in the email (actionable_tasks empty)');
  }
  return problems;
}

// ---- main -------------------------------------------------------------------
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';
let pass = 0, fail = 0;

const total = CASES.length + DIGEST_CASES.length;
console.log(`${BOLD}dryfire → ${MODEL} @ ${OLLAMA}${RST}  (${total} cases: ${CASES.length} iris single-shot, ${DIGEST_CASES.length} digest run-mode)\n`);

function fmtArgs(a) {
  const s = JSON.stringify(a);
  return s.length > 90 ? s.slice(0, 87) + '...' : s;
}

for (const c of CASES) {
  let out;
  try { out = await runIris(c); }
  catch (e) {
    if (isWallClock(e)) {
      fail++;
      console.log(`${RED}FAIL${RST} [${c.agent}] ${c.req.slice(0, 62)}`);
      console.log(`      ${DIM}·${RST} runaway: generation exceeded the wall-clock cap`);
      continue;
    }
    console.error(e.stack || e); process.exit(1);
  }
  const { calls, finalText } = out;
  let ok, note = '';
  if (c.noTool) {
    ok = calls.length === 0 && finalText.trim().length > 0;
    if (ok && c.replyIncludes && !finalText.toLowerCase().includes(c.replyIncludes.toLowerCase())) {
      ok = false; note = ` (reply missing "${c.replyIncludes}")`;
    }
  } else {
    // Single-shot: the exact expected call set, all in turn one, and nothing
    // else (extra calls in turn one are the fine-tune over-firing; a
    // list-first call is a chain the production run can never complete).
    ok = calls.length === c.expect.length && c.expect.every((e, i) => stepMatches(calls[i], e));
  }
  const tag = ok ? `${GREEN}PASS${RST}` : `${RED}FAIL${RST}`;
  console.log(`${tag} [${c.agent}] ${c.req.slice(0, 62)}${note}`);
  if (!ok) {
    fail++;
    console.log(`      ${DIM}expected:${RST} ${c.noTool ? '(no tool — ask back' + (c.replyIncludes ? `, mention "${c.replyIncludes}"` : '') + ')' : c.expect.map(e => `${e.anyOf ? e.anyOf.join('|') : e.name}${e.args ? fmtArgs(e.args) : ''}`).join(' → ')}`);
    console.log(`      ${DIM}actual:${RST}   ${calls.length ? calls.map(x => `${x.name}${fmtArgs(x.arguments)}`).join(' → ') : '(no tool)'}`);
    console.log(`      ${DIM}reply:${RST}    ${finalText.replace(/\n/g, ' ').slice(0, 140)}`);
  } else {
    pass++;
    console.log(`      ${DIM}calls:${RST} ${calls.length ? calls.map(x => x.name).join(' → ') : '(asked back)'}  ${DIM}| reply:${RST} ${finalText.replace(/\n/g, ' ').slice(0, 90)}`);
  }
}

for (const c of DIGEST_CASES) {
  let out;
  try { out = await runDigest(c); }
  catch (e) {
    if (isWallClock(e)) {
      fail++;
      console.log(`${RED}FAIL${RST} [digest:${c.span}] since ${c.since.slice(0, 16)}…`);
      console.log(`      ${DIM}·${RST} runaway: generation exceeded the wall-clock cap`);
      continue;
    }
    console.error(e.stack || e); process.exit(1);
  }
  const problems = scoreDigest(c, out.calls, out.finalText);
  const ok = problems.length === 0;
  const label = `[digest:${c.span}] since ${c.since.slice(0, 16)}…`;
  console.log(`${ok ? `${GREEN}PASS${RST}` : `${RED}FAIL${RST}`} ${label}`);
  if (!ok) {
    fail++;
    for (const p of problems) console.log(`      ${DIM}·${RST} ${p}`);
    console.log(`      ${DIM}calls:${RST} ${out.calls.map(x => `${x.name}${fmtArgs(x.arguments)}`).join(' → ') || '(none)'}`);
    console.log(`      ${DIM}final:${RST} ${out.finalText.replace(/\n/g, ' ').slice(0, 180)}`);
  } else {
    pass++;
    const peek = (out.finalText.match(/"summary"\s*:\s*"([^"]{0,80})/) || [])[1] || '';
    console.log(`      ${DIM}read_emails verbatim window ✓ → JSON valid; summary:${RST} "${peek}…"`);
  }
}

console.log(`\n${BOLD}${pass}/${total} passed${RST}` + (fail ? `, ${RED}${fail} failed${RST}` : ''));
if (fail) process.exit(1);
