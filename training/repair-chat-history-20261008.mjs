// One-shot corpus repair (2026-10-08, follow-on to repair-parts-20261008.mjs):
// the atlas seat's live tool pool has NO get_chat_history (it is vulkan-owned
// via vulkan-core, and neither ATLAS_OWNED nor ORCHESTRATOR_SHARED_TOOLS
// includes it — verified against the live filter at agent-runner index.ts:4336
// and the fresh dump_tool_schemas.mjs output). 29 part rows teach the seat to
// call it anyway; the stale Sep-21 tool_schemas.json had been masking this.
//
// Transform: the history content the row's answer is built on becomes REAL
// prior context — actual user/assistant messages placed before the recall
// ask — and the get_chat_history call + its tool result are removed. The
// final answer is untouched. The seat learns to answer recall questions from
// the context it is given, which is exactly how the live host feeds it.
//
// Idempotent: re-running finds no get_chat_history calls left. Aborts
// without writing if any row fails to parse.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PARTS_DIR = path.join(HERE, 'orchatlas-parts');
const ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).';

const u = (text) => ({ role: 'user', content: `${ANCHOR}\n\n${text}` });
const a = (text) => ({ role: 'assistant', content: text });

// ── Group D: prose-shaped history results (no dialogue markers to parse).
// Each becomes one hand-authored prior pair that grounds the row's final
// answer. Two pairs for s22-1:7 (the email + the Wednesday constraint).
const PRIOR_PAIRS = {
  's11-2.jsonl:18': [[
    u('quick recap of the week when you have a sec'),
    a('Sure — this week: the toolcalling-model retrain (2 epochs, eval 45 of 50), the 400ms feed-fragment slicing fix, the orchatlas SFT dataset committed, and the wifi drops resolved — NetworkManager across the board.'),
  ]],
  's11-4.jsonl:8': [[
    u('set a trash reminder for 11 this morning would you'),
    a('Reminder set for 11:00 AM — take the trash out.'),
  ]],
  's18-2.jsonl:8': [[
    u('give me a quick rundown of the morning so far'),
    a("So far: the inbox check at 12:01 — three new (Dana Whitfield, UPS, Renner Contracting); vulkan's on the permit-parser fix as of 11:58; and your 3pm dentist reminder is confirmed (11:40)."),
  ]],
  's18-3.jsonl:12': [[
    u("how's the morning been? anything pending?"),
    a('Quiet — inbox check at 12:01, the permit-parser fix dispatched to vulkan at 11:58, and the dentist reminder confirmed at 11:40 for 3pm.'),
  ]],
  's22-1.jsonl:7': [
    [u('take a look at the email that just came in — the recruiter one'),
     a('Sarah Miles at talentpath.ca — a phone screen offer, Wednesday Sep 24 at 2pm. Want me to draft a reply?')],
    [u("not yet — and heads up, I can't take Wednesday afternoon calls"),
     a("Noted — Wednesday afternoons are out. I'll hold the reply.")],
  ],
};

// ── Group A: "[HH:MM] user: …" / "[HH:MM] warden: …" turn lines
// (timestamps may carry a date: "[2026-09-14 09:30]").
function parseTurnLines(content, where) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    if (/^Recent turns:?$/.test(l)) continue;
    const m = l.match(/^\[[^\]]+\] (user|warden): (.*)$/);
    if (!m) throw `${where}: unparseable turn line "${l.slice(0, 90)}"`;
    const text = m[2].replace(/^\((?:ran|edited)[^)]*\)\s*/, '').trim();
    if (m[1] === 'user') out.push(u(text));
    else {
      if (!out.length || out[out.length - 1].role !== 'user') throw `${where}: warden turn with no preceding user turn`;
      out.push(a(text));
    }
  }
  return out;
}

// ── Group B: "User: …" / "Assistant: …" lines, no timestamps (s19-1).
function parseUserAssistant(content, where) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    if (/^Recent turns:?$/.test(l)) continue;
    const m = l.match(/^(User|Assistant): (.*)$/);
    if (!m) throw `${where}: unparseable User/Assistant line "${l.slice(0, 90)}"`;
    const text = m[2].trim();
    if (m[1] === 'User') out.push(u(text));
    else {
      if (!out.length || out[out.length - 1].role !== 'user') throw `${where}: Assistant turn with no preceding User turn`;
      out.push(a(text));
    }
  }
  return out;
}

// ── Group C: single-line fragments, newest first:
//   "(11:58) User: demo doc summary for Dana."
//   "(11:32) User: voice app reconnect check — Warden: reattaches to 8767 fine."
// A " — Warden: " split carries the reply; reply-less fragments stay as
// plain user turns (no invented replies). Reversed to chronological order.
function parseParens(content, where) {
  const body = content.replace(/^\s*Recent turns:\s*/, '').trim();
  const raw = body.split(/(?=\(\d{1,2}:\d{2}\) User: )/).map((s) => s.trim()).filter(Boolean);
  const frags = [];
  for (const frag of raw) {
    const m = frag.match(/^\((?:today )?\d{1,2}:\d{2}\) User: (.+)$/);
    if (!m) throw `${where}: unparseable fragment "${frag.slice(0, 90)}"`;
    const parts = m[1].split(' — Warden: ');
    const userText = parts[0].trim();
    if (!userText) throw `${where}: empty user turn in "${frag.slice(0, 90)}"`;
    // a reply stays GLUED to its user turn; reversal happens on fragments
    const turn = [u(userText)];
    if (parts.length > 1) turn.push(a(parts.slice(1).join(' — Warden: ').trim()));
    frags.push(turn);
  }
  if (!frags.length) throw `${where}: no turns parsed`;
  return frags.reverse().flat(); // listed newest-first → chronological
}

const report = [];
const unhandled = [];
const changed = new Map();

// which parser per row (survey, 2026-10-08)
const ROW_PLAN = {
  's10-1.jsonl:18': parseTurnLines, 's10-1.jsonl:19': parseTurnLines,
  's10-2.jsonl:18': parseTurnLines, 's10-2.jsonl:19': parseTurnLines,
  's10-3.jsonl:18': parseTurnLines, 's10-3.jsonl:19': parseTurnLines, 's10-3.jsonl:20': parseTurnLines,
  's10-4.jsonl:20': parseTurnLines, 's10-4.jsonl:21': parseTurnLines, 's10-4.jsonl:22': parseTurnLines,
  's14-3.jsonl:20': parseTurnLines, 's14-3.jsonl:21': parseTurnLines, 's14-3.jsonl:22': parseTurnLines,
  's14-3.jsonl:23': parseTurnLines, 's14-3.jsonl:24': parseTurnLines, 's14-3.jsonl:25': parseTurnLines,
  's14-4.jsonl:24': parseTurnLines, 's14-4.jsonl:25': parseTurnLines,
  's19-1.jsonl:19': parseUserAssistant,
  's7-2.jsonl:3': parseParens, 's7-2.jsonl:13': parseParens,
  's7-3.jsonl:9': parseParens,
  's7-4.jsonl:3': parseParens, 's7-4.jsonl:13': parseParens,
  's11-2.jsonl:18': null, 's11-4.jsonl:8': null, 's18-2.jsonl:8': null,
  's18-3.jsonl:12': null, 's22-1.jsonl:7': null,
};

const byFile = new Map();
for (const key of Object.keys(ROW_PLAN)) {
  const [f, i] = [key.replace(/:\d+$/, ''), Number(key.split(':')[1])];
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(i);
}

for (const [f, idxs] of byFile) {
  const fp = path.join(PARTS_DIR, f);
  const lines = readFileSync(fp, 'utf8').split('\n').filter((l) => l.trim());
  const rows = lines.map((l) => JSON.parse(l));
  let fileChanged = false;

  for (const i of idxs) {
    const where = `${f}:${i}`;
    const row = rows[i - 1];
    const msgs = row.messages;
    const ai = msgs.findIndex((m) => m.role === 'assistant' && Array.isArray(m.tool_calls)
      && m.tool_calls.some((t) => t.function?.name === 'get_chat_history'));
    if (ai === -1) continue; // already repaired on a previous run

    const am = msgs[ai];
    const callIdx = am.tool_calls.findIndex((t) => t.function?.name === 'get_chat_history');

    // the tool results immediately following the call, in call order
    const run = [];
    for (let k = ai + 1; k < msgs.length && msgs[k].role === 'tool'; k++) run.push(msgs[k]);
    if (run.length !== am.tool_calls.length) {
      unhandled.push(`${where}: ${am.tool_calls.length} calls but ${run.length} results — layout not 1:1`);
      continue;
    }
    const history = String(run[callIdx].content);

    // build the prior context
    let prior;
    if (ROW_PLAN[where]) {
      try { prior = ROW_PLAN[where](history, where); } catch (e) { unhandled.push(String(e)); continue; }
    } else {
      prior = PRIOR_PAIRS[where].flat();
    }

    // splice out the history result, then the call
    msgs.splice(ai + 1 + callIdx, 1);
    am.tool_calls.splice(callIdx, 1);
    if (am.tool_calls.length === 0 && !String(am.content || '').trim()) msgs.splice(ai, 1);

    // prior context goes before the first user message
    const firstUser = msgs.findIndex((m) => m.role === 'user');
    if (firstUser === -1) { unhandled.push(`${where}: no user message to anchor the priors`); continue; }
    msgs.splice(firstUser, 0, ...prior);

    fileChanged = true;
    report.push(`${where}: ${prior.length} prior message(s) from history → ${prior.map((m) => m.role[0]).join('')}`);
  }

  if (fileChanged) changed.set(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

if (unhandled.length) {
  console.error(`ABORT — ${unhandled.length} unhandled rows (nothing written):`);
  for (const x of unhandled) console.error(`  ${x}`);
  process.exit(1);
}
if (!changed.size) { console.log('Nothing to repair — no get_chat_history rows left.'); process.exit(0); }
for (const [f, data] of changed) {
  writeFileSync(path.join(PARTS_DIR, f), data);
  console.log(`wrote ${f}`);
}
console.log(`\n${report.length} rows transformed:`);
for (const r of report) console.log(`  ${r}`);