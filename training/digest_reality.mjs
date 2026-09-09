// digest_reality.mjs — the digest pipeline as production ACTUALLY runs it.
//
// Digests do NOT go through the single-shot `iris` delegate and there is no
// post_summary tool call in the path. Reality (verified 2026-09-01):
//
//   - Host runDigest(span) (src/index.ts) fires the digest DIRECTLY as an
//     `iris-digest-<span>` background run — never the chat, never the
//     orchestrator. Prompt = buildDigestContext(span) INPUT block + "\n\n---\n\n"
//     + the baked span prompt (IRIS_DIGEST_TASKS).
//   - The agent-runner iris-digest-* branch (container/agent-runner/src/index.ts)
//     gives the model the DIGEST system prompt below and exactly ONE tool:
//     read_emails. The model calls read_emails with the since/before copied
//     VERBATIM from the INPUT "Email window (UTC)" line, then emits the
//     structured JSON digest object as its FINAL TEXT.
//   - The RUNNER extracts that JSON text and POSTs it to /api/summaries itself,
//     then notifies the host via digest_complete. The model publishes nothing.
//
// This module reads the real strings out of the live source files so the SFT
// dataset and the dryfire harness can't drift from what ships. If a source
// edit changes those shapes, extraction throws — loudly, at gen time.
//
// Used by gen_toolcall_sft.mjs (training data) and dryfire.mjs (the test).

import { readFileSync } from 'node:fs';

const REPO = '/opt/Warden';

// ---- the digest system prompt (verbatim from the runner source) ----------
const runnerSrc = readFileSync(`${REPO}/container/agent-runner/src/index.ts`, 'utf8');
const sysMatch = runnerSrc.match(/const digestSystemPrompt = `([\s\S]*?)`;/);
if (!sysMatch) {
  throw new Error('digestSystemPrompt not found in container/agent-runner/src/index.ts — extraction drifted from source');
}
export const DIGEST_SYSTEM = sysMatch[1];

// ---- the baked per-span digest prompts (verbatim from the host source) ----
const hostSrc = readFileSync(`${REPO}/src/index.ts`, 'utf8');
function bakedPrompt(span) {
  const re = new RegExp(`id: 'iris-digest-${span}',\\s*\\n\\s*cron:[^,]+,\\s*\\n\\s*prompt: '((?:\\\\.|[^'\\\\])*)'`);
  const m = hostSrc.match(re);
  if (!m) throw new Error(`baked digest prompt 'iris-digest-${span}' not found in src/index.ts`);
  // re-wrap as a JS single-quoted literal and evaluate it to resolve escapes
  return (0, eval)(`'${m[1]}'`);
}
export const DIGEST_PROMPTS = {
  hourly: bakedPrompt('hourly'),
  daily: bakedPrompt('daily'),
  weekly: bakedPrompt('weekly'),
};

// ---- the only tool a digest run gets --------------------------------------
const SCHEMAS = JSON.parse(readFileSync(new URL('./tool_schemas.json', import.meta.url), 'utf8'));
export const DIGEST_TOOLS = SCHEMAS.iris.filter((t) => t.function.name === 'read_emails');
if (DIGEST_TOOLS.length !== 1) throw new Error('tool_schemas.json drifted — expected exactly one digest tool (read_emails)');

// ---- INPUT block shape (mirrors buildDigestContext in src/task-scheduler.ts)
// Section labels are the exact strings the host emits; a dryfire INPUT that
// uses anything else would train/test the model on a prompt distribution it
// never sees in production.
export function buildDigestInput({ localTime, since, before, bio, calendar, tasks, weather, lookout }) {
  const lines = [
    `Current local time: ${localTime} (timezone America/Vancouver)`,
    `Email window (UTC): since ${since} before ${before}`,
  ];
  if (bio) lines.push(`\nUser bio / habits:\n${bio}`);
  lines.push(calendar && calendar.length
    ? `\nCalendar events (last 6h → next 48h):\n${calendar.join('\n')}`
    : '\nCalendar events (last 6h → next 48h): none');
  lines.push(tasks && tasks.length
    ? `\nActive work tasks:\n${tasks.join('\n')}`
    : '\nActive work tasks: none');
  if (weather && weather.length) lines.push(`\nWeather (Victoria):\n${weather.join('\n')}`);
  lines.push(lookout && lookout.length
    ? `\nLook Out For (things the user is watching for — flag any match in the digest):\n${lookout.join('\n')}`
    : '\nLook Out For: none');
  return lines.join('\n');
}

// ---- the digest JSON contract, per the baked prompts -----------------------
// What the dashboard/speakable path requires of the final-text JSON. Mirrors
// host extractFirstJsonObject (src/index.ts): first balanced {...} object.
export const DIGEST_BLOCK_LABELS = {
  hourly: ['Recent Emails', 'Calendar', 'Active Tasks', 'Weather', 'Nudge'],
  daily: ['Day in Review', 'Recent Emails', 'Calendar', 'Active Tasks', 'Weather', 'Tomorrow', 'Nudge'],
  weekly: ['Week in Review', 'Email Activity', 'Calendar', 'Tasks', 'Weather', 'Nudge'],
};

export function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Validate a model-emitted digest against the real contract.
// emailsInWindow: sender addresses the fake read_emails returned — anything
// else with an @ in the email block is a hallucination.
export function validateDigestJson(span, text, emailsInWindow = []) {
  const problems = [];
  const json = extractFirstJsonObject(text);
  if (!json) { problems.push('final text contains no JSON object'); return { ok: false, problems }; }
  let parsed;
  try { parsed = JSON.parse(json); } catch (e) { problems.push(`JSON does not parse: ${e.message}`); return { ok: false, problems }; }

  if (typeof parsed.title !== 'string' || !parsed.title.trim()) problems.push('missing/empty "title"');
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) problems.push('missing/empty "summary"');
  if (!Array.isArray(parsed.alerts)) problems.push('"alerts" is not an array');
  if (!Array.isArray(parsed.blocks)) problems.push('"blocks" is not an array');

  const wantLabels = DIGEST_BLOCK_LABELS[span];
  if (Array.isArray(parsed.blocks)) {
    const got = parsed.blocks.map((b) => b?.label);
    for (const label of wantLabels) {
      if (!got.includes(label)) problems.push(`missing block "${label}"`);
    }
  }
  if (span === 'hourly') {
    for (const k of ['actionable_tasks', 'actionable_events']) {
      if (!Array.isArray(parsed[k])) problems.push(`"${k}" is not an array`);
    }
  }

  // Grounding: every "From: x@y" the model cited must be a sender the fake
  // tool actually returned; an empty window means no From: items at all.
  const emailBlock = (parsed.blocks || []).find((b) => b?.icon === 'inbox');
  const items = (emailBlock?.items || []).filter((i) => typeof i === 'string');
  const cited = items.map((i) => (i.match(/From:\s*(\S+@\S+)/) || [])[1]).filter(Boolean);
  for (const addr of cited) {
    if (!emailsInWindow.some((e) => addr.toLowerCase().includes(e.toLowerCase()))) {
      problems.push(`hallucinated sender "${addr}" (not in read_emails output)`);
    }
  }
  if (!emailsInWindow.length && cited.length) problems.push('cited emails from an empty window');
  if (emailsInWindow.length && !cited.length && !items.length) problems.push('window had emails but the inbox block is empty');

  return { ok: problems.length === 0, problems, parsed };
}
