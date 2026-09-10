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
//   (A sentry run-mode suite existed here until 2026-09-08, when the user
//   switched sentry to share the orchestrator/atlas model — the toolcall
//   fine-tune no longer covers sentry, so its cases were removed.)
//
//   node dryfire.mjs                      # default model toolcall-ft
//   MODEL=granite4.1:3b node dryfire.mjs   # baseline stock model for compare
//   OLLAMA=http://host:11434 node dryfire.mjs
//
// Exits non-zero if any case fails.

import { SYSTEMS, TOOLS, ANCHOR } from './gen_toolcall_sft.mjs';

const MODEL = process.env.MODEL || 'toolcall-ft';
const OLLAMA = (process.env.OLLAMA || 'http://localhost:11434').replace(/\/$/, '');

// ---- test cases ----------------------------------------------------------
// expect: the EXACT call set for the single turn, ordered steps {name, args?}
// (args = case-insensitive substring per key). Single-shot means no
// error-recovery turns exist — a wrong first call is a failure, full stop.
// noTool: the model must NOT call any tool — it asks back in text.
// replyIncludes: the text reply must contain the string (case-insensitive).
const CASES = [
  // ---- iris: relative duration (the clock-math bug class) — brief style --
  { agent: 'iris', req: 'Set a one-time reminder to check the oven in 2 minutes.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: 'PT2M', prompt: 'Check the oven.' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to stand up and stretch in 90 seconds.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: 'PT90S' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to call mom in an hour and a half.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: 'PT1H30M' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to pay rent tomorrow.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: 'P1D' } }] },
  // ---- iris: absolute clock time, computed from the anchor --------------
  { agent: 'iris', req: 'Set a one-time reminder to pick up the kids at 3:00 PM today.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: '2026-08-31T15:00:00' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to take medication at 5:00 AM tomorrow.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: '2026-09-01T05:00:00' } }] },
  { agent: 'iris', req: 'Set a one-time reminder to water the plants at 8:00 PM today.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: '2026-08-31T20:00:00' } }] },
  // ---- iris: cron (the wrong-field bug class) ----------------------------
  { agent: 'iris', req: 'Set a recurring reminder daily at 10:30 AM to take medication.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'cron', schedule_value: '30 10 * * *' } }] },
  { agent: 'iris', req: 'Set a recurring reminder daily at 11:30 AM to take xyz medication.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'cron', schedule_value: '30 11 * * *' } }] },
  { agent: 'iris', req: 'Set a recurring reminder every day at 7 AM to meditate.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'cron', schedule_value: '0 7 * * *' } }] },
  { agent: 'iris', req: 'Set a recurring reminder weekdays at 9 AM to stand up.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'cron', schedule_value: '0 9 * * 1-5' } }] },
  { agent: 'iris', req: 'Set a recurring reminder every Monday at 6 PM to take out the trash.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'cron', schedule_value: '0 18 * * 1' } }] },
  { agent: 'iris', req: 'Set a recurring reminder weekdays at 12:30 PM to eat lunch.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'cron', schedule_value: '30 12 * * 1-5' } }] },
  // ---- iris: interval (ms) ------------------------------------------------
  { agent: 'iris', req: 'Set a recurring interval reminder every 5 minutes to check the build status.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'interval', schedule_value: '300000' } }] },
  { agent: 'iris', req: 'Set a recurring interval reminder every 2 hours to stretch your back.',
    expect: [{ name: 'task', args: { action: 'schedule',  schedule_type: 'interval', schedule_value: '7200000' } }] },
  // ---- iris: manage — id supplied by the orchestrator, one call ----------
  { agent: 'iris', req: 'Cancel the reminder task task-cb-1788206097352-yadl0c (the daily 11:30 AM "Take xyz medication").',
    expect: [{ name: 'task', args: { action: 'cancel',  task_id: 'task-cb-1788206097352-yadl0c' } }] },
  { agent: 'iris', req: 'Pause the reminder task task-cb-1788206097352-abc123 (the daily 7 AM "Meditate").',
    expect: [{ name: 'task', args: { action: 'pause',  task_id: 'task-cb-1788206097352-abc123' } }] },
  { agent: 'iris', req: 'Reschedule the reminder task task-cb-1788206097352-def456 (the weekday 9 AM stand-up) to 10:00 AM on weekdays.',
    expect: [{ name: 'task', args: { action: 'update',  task_id: 'task-cb-1788206097352-def456', schedule_value: '0 10 * * 1-5' } }] },
  { agent: 'iris', req: 'List my current reminders.',
    expect: [{ name: 'task', args: { action: 'list' } }] },
  // ---- iris: calendar ------------------------------------------------------
  { agent: 'iris', req: 'Create a calendar event tomorrow at 2:00 PM called "Project Review".',
    expect: [{ name: 'calendar', args: { action: 'create',  title: 'Project Review', start_time: '2026-09-01T14:00:00' } }] },
  { agent: 'iris', req: 'Delete the calendar event ev-1001 (the "Project Review" meeting tomorrow at 2 PM).',
    expect: [{ name: 'calendar', args: { action: 'delete',  event_id: 'ev-1001' } }] },
  { agent: 'iris', req: "List this week's calendar events.",
    expect: [{ name: 'calendar', args: { action: 'list' } }] },
  // ---- iris: reminder + calendar in ONE turn (the one allowed multi-call) -
  { agent: 'iris', req: 'Set a one-time reminder about the team meeting at 2:00 PM today, and create a calendar event called "Team meeting" at 2:00 PM today.',
    expect: [
      { name: 'task', args: { action: 'schedule',  schedule_type: 'once', schedule_value: '2026-08-31T14:00:00' } },
      { name: 'calendar', args: { action: 'create',  title: 'Team meeting', start_time: '2026-08-31T14:00:00' } },
    ] },
  // ---- iris: alarms (create/list/update/delete — id supplied) ------------
  { agent: 'iris', req: 'Set an alarm for 6:30 AM labeled "Wake up", repeating daily.',
    expect: [{ name: 'alarm', args: { action: 'create', label: 'Wake up', alarm_time: '06:30', repeat_type: 'daily' } }] },
  { agent: 'iris', req: 'Set a one-time alarm for 8:00 AM on 2026-09-01 called "Airport run".',
    expect: [{ name: 'alarm', args: { action: 'create', label: 'Airport run', alarm_time: '08:00', alarm_date: '2026-09-01', repeat_type: 'none' } }] },
  { agent: 'iris', req: 'List my alarms.',
    expect: [{ name: 'alarm', args: { action: 'list' } }] },
  { agent: 'iris', req: 'Delete the alarm alm-3 (the 21:00 "Wind down").',
    expect: [{ name: 'alarm', args: { action: 'delete', alarm_id: 'alm-3' } }] },
  { agent: 'iris', req: 'Rename the alarm alm-2 to "Get to work" and make it ring only on weekdays.',
    expect: [{ name: 'alarm', args: { action: 'update', alarm_id: 'alm-2', label: 'Get to work', repeat_type: 'weekdays' } }] },

  // ---- iris: ask-back — do NOT invent content -----------------------------
  { agent: 'iris', req: 'Set a one-time reminder in 10 minutes.', noTool: true, replyIncludes: 'content' },
  { agent: 'iris', req: 'Set a recurring reminder daily at 11:30 AM.', noTool: true, replyIncludes: 'content' },
  { agent: 'iris', req: 'Set a reminder to take medication.', noTool: true, replyIncludes: 'time' },
  // ---- iris: email — briefs carry resolved addresses/ids ----------------
  { agent: 'iris', req: 'Check my inbox — what emails are there?',
    expect: [{ name: 'email', args: { action: 'read' } }] },
  { agent: 'iris', req: 'Search emails from Sarah about the Q4 budget.',
    expect: [{ name: 'email', args: { action: 'read',  search: 'sarah' } }] },
  { agent: 'iris', req: 'Reply to Sarah (sarah@acme.io) and tell her I will sign off the Q4 budget by Friday — send the reply.',
    expect: [{ name: 'email', args: { action: 'send',  to: 'sarah@acme.io' } }] },
  { agent: 'iris', req: 'Get the full body of email email-4f2a.',
    expect: [{ name: 'email', args: { action: 'get',  email_id: 'email-4f2a' } }] },
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

// ---- main -------------------------------------------------------------------
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';
let pass = 0, fail = 0;

const total = CASES.length;
console.log(`${BOLD}dryfire → ${MODEL} @ ${OLLAMA}${RST}  (${total} cases: ${CASES.length} iris single-shot)\n`);

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

console.log(`\n${BOLD}${pass}/${total} passed${RST}` + (fail ? `, ${RED}${fail} failed${RST}` : ''));
if (fail) process.exit(1);
