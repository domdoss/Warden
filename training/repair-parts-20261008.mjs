// One-shot corpus repair for the 2026-10-08 audit findings:
//   (a) rows whose final assistant message is empty — the model is being
//       taught to end the turn silently after a tool result (216 merged rows,
//       9.2% of the dataset). Fill each with a short factual answer derived
//       from the row's own last tool result, in the s10 house style
//       ("Dark cyberpunk Nightdrive Mix is on now.").
//   (b) s7-1's 14 rows where the "act" call of a conditional ask has no tool
//       result before the final answer — the answer-without-grounding shape.
//       Insert the confirming result the final answer already claims.
// Idempotent: re-running finds nothing left to do. Aborts without writing if
// any row cannot be handled automatically.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PARTS_DIR = path.join(HERE, 'orchatlas-parts');

// ── (b) hand-authored results for s7-1's unanswered calls, keyed by the
// call signature. Content mirrors what the row's final answer already states.
const S7_FILL = [
  { file: 's7-1.jsonl', call: 'audio_volume', arg: '"level":60', result: 'Speaker volume: 60%' },
  { file: 's7-1.jsonl', call: 'audio_volume', arg: '"level":40', result: 'Speaker volume: 40%' },
  { file: 's7-1.jsonl', call: 'youtube', arg: '"action":"next"', result: 'Playing: Midnight Coffee by Lofi Girl\nhttps://www.youtube.com/watch?v=lofigirl1' },
  { file: 's7-1.jsonl', call: 'audio_volume', arg: '"level":50', result: 'Speaker volume: 50%' },
  { file: 's7-1.jsonl', call: 'chrome_navigate', arg: 'localhost:3200', result: 'Navigated to the Warden dashboard — it is up and answering.' },
  { file: 's7-1.jsonl', call: 'iris', arg: 'a reminder for 4pm today', result: 'Reminder set for 4:00 PM today: hit the water when the swell peaks.' },
  { file: 's7-1.jsonl', call: 'iris', arg: 'a 7am alarm tomorrow', result: 'Alarm set for 7:00 AM tomorrow.' },
  { file: 's7-1.jsonl', call: 'Bash', arg: 'du -sh /opt/Warden', result: '2.1G\t/opt/Warden/logs\n1.4G\t/opt/Warden/.git\n940M\t/opt/Warden/dist' },
  { file: 's7-1.jsonl', call: 'youtube', arg: '"query":"jazz"', result: 'Playing: Autumn Jazz — Cafe Music BGM\nhttps://www.youtube.com/watch?v=autumnjazz1' },
  { file: 's7-1.jsonl', call: 'iris', arg: 'the unread email from dana', result: 'Flagged: "Re: demo timing" — it is marked for follow-up.' },
  { file: 's7-1.jsonl', call: 'open_app', arg: '"app":"Konsole"', result: 'Konsole is running.' },
  { file: 's7-1.jsonl', call: 'iris', arg: 'a reminder at 2pm today', result: 'Reminder set for 2:00 PM today: stretch your legs.' },
  { file: 's7-1.jsonl', call: 'audio_volume', arg: '"level":30', result: 'Speaker volume: 30%' },
  { file: 's7-1.jsonl', call: 'Bash', arg: 'systemctl --user restart warden.service', result: 'active' },
];

// ── (a) derive a short factual answer from the row's last tool result.
function answerFrom(resultText) {
  const text = String(resultText);
  const lines = text.split('\n');
  const line = lines.find((l) => {
    const t = l.trim();
    return t && !/^https?:\/\//.test(t) && !t.includes('This is the answer to the ask');
  });
  if (!line) return null;
  let m = line.match(/^Playing:\s*(.+?)(?:\s*\([^)]*\))?\s*$/);
  if (m) return `${m[1].trim()} is on now.`;
  m = line.match(/^Already playing:\s*(.+?)(?:\s*\([^)]*\))?\s*$/);
  if (m) return `${m[1].trim()} is already playing.`;
  m = line.match(/^Paused:\s*(.+?)\s*\((\d[\d:]+)\)\s*$/);
  if (m) return `${m[1].trim()} is paused.`;
  m = line.match(/^Resumed:\s*(.+)$/);
  if (m) return `${m[1].trim()} is playing again.`;
  m = line.match(/^Speaker volume:\s*(\d+)%/);
  if (m) return `The volume is at ${m[1]}%.`;
  // A numbered results list is itself the answer — present it minus the
  // coaching line.
  if (/^\d+\./.test(line.trim())) {
    const kept = lines.filter((l) => l.trim() && !l.includes('This is the answer to the ask'));
    return kept.join('\n');
  }
  // A bare title line (a play result with no "Playing:" prefix) — the media
  // parts end with the title of whatever is now on.
  if (lines.some((l) => /^https?:\/\//.test(l.trim()))) {
    return `${line.trim()} is on now.`;
  }
  return null;
}

const files = readdirSync(PARTS_DIR).filter((f) => f.endsWith('.jsonl')).sort();
const report = [];
const unhandled = [];
const changed = new Map();

for (const f of files) {
  const fp = path.join(PARTS_DIR, f);
  const raw = readFileSync(fp, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  let fileChanged = false;
  const rows = lines.map((line, i) => {
    const row = JSON.parse(line);
    const where = `${f}:${i + 1}`;
    const msgs = row.messages;

    // (a) empty final assistant → derive the answer
    const last = msgs[msgs.length - 1];
    if (last.role === 'assistant' && !last.content && !Array.isArray(last.tool_calls)) {
      let lastTool = null;
      for (const m of msgs) if (m.role === 'tool') lastTool = m;
      if (!lastTool) { unhandled.push(`${where}: empty final with no tool result to derive from`); return row; }
      const answer = answerFrom(lastTool.content);
      if (!answer) { unhandled.push(`${where}: no template for tool result "${String(lastTool.content).slice(0, 80)}"`); return row; }
      last.content = answer;
      fileChanged = true;
      report.push(`${where}: filled final answer → "${answer.slice(0, 90)}"`);
    }

    // (b) unanswered tool call before the next non-tool message → insert the
    // mapped result
    for (let k = 0; k < msgs.length; k++) {
      const m = msgs[k];
      if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
      const next = msgs[k + 1];
      if (next && next.role === 'tool') continue;
      for (const tc of m.tool_calls) {
        const name = tc.function?.name;
        const argStr = JSON.stringify(tc.function?.arguments || {});
        const hit = S7_FILL.find(
          (c) => c.file === f && c.call === name && argStr.includes(c.arg),
        );
        if (!hit) { unhandled.push(`${where}: unanswered ${name} call with no mapped result (args ${argStr.slice(0, 60)})`); continue; }
        msgs.splice(k + 1, 0, { role: 'tool', name, content: hit.result });
        fileChanged = true;
        report.push(`${where}: inserted ${name} result → "${hit.result.slice(0, 70)}"`);
        k++; // step past the inserted tool message
      }
    }
    return row;
  });
  if (fileChanged) {
    changed.set(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
}

if (unhandled.length) {
  console.error(`ABORT — ${unhandled.length} unhandled rows (nothing written):`);
  for (const u of unhandled) console.error(`  ${u}`);
  process.exit(1);
}
if (!changed.size) { console.log('Nothing to repair — all parts already clean.'); process.exit(0); }
for (const [f, data] of changed) {
  writeFileSync(path.join(PARTS_DIR, f), data);
  console.log(`wrote ${f}`);
}
console.log(`\n${report.length} repairs across ${changed.size} files:`);
for (const r of report) console.log(`  ${r}`);