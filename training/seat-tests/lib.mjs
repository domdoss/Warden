// seat-tests/lib.mjs — shared helpers for the Warden seat training/testing loop.
// Plain Node ESM, no deps. Reuses the LIVE runner's prompt extraction and
// dynamic tool-selection code, so a test reflects what the running seat does
// rather than a hand-rolled approximation.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFewModeSystemPrompt } from '../extract_runner_source.mjs';
import { extractKeywords, rankTools } from '../../dist/agent-runner/dynamic-selection.js';
import { shouldAutoRecall } from '../../dist/agent-runner/marm-recall.js';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TRAINING = path.join(HERE, '..');
export const WARDEN = path.join(TRAINING, '..');
const SCHEMAS_PATH = path.join(TRAINING, 'tool_schemas.json');

export const ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).';
export const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
export const ALWAYS_IN = ['read_file', 'write_file', 'list_file'];
export const TOP_K = 12;

// ---- corpus -----------------------------------------------------------------

export function loadCases(file = path.join(HERE, 'cases.jsonl')) {
  const cases = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#')) continue;
    try { cases.push(JSON.parse(t)); }
    catch (e) { throw new Error(`bad case line ${i + 1} in ${file}: ${e.message}\n  ${t.slice(0, 200)}`); }
  }
  return cases;
}

// ---- prompt + tool schemas ----------------------------------------------------

let _system;
export function systemPrompt() {
  if (!_system) _system = extractFewModeSystemPrompt();
  return _system;
}

export function refreshToolSchemas() {
  const r = spawnSync('node', ['dump_tool_schemas.mjs'], { cwd: TRAINING, encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`dump_tool_schemas.mjs failed (exit ${r.status}):\n${(r.stderr || r.stdout || '').slice(-800)}`);
}

export function loadToolSchemas() {
  if (process.env.NO_REFRESH !== '1') refreshToolSchemas();
  if (!existsSync(SCHEMAS_PATH)) refreshToolSchemas();
  const data = JSON.parse(readFileSync(SCHEMAS_PATH, 'utf8'));
  return { merged: data.merged, byName: new Map(data.merged.map((t) => [t.function.name, t])) };
}

// ---- selection (Layer A — pure code, no model) --------------------------------

export function selection(ask, merged) {
  const keywords = extractKeywords([{ role: 'user', content: ask }]);
  const ranked = rankTools(merged, keywords, TOP_K);
  return { keywords, ranked };
}

export function rankPass(ranked, rank) {
  if (!rank) return { pass: true, note: '' };
  const want = rank.want || [];
  const above = rank.above || [];
  const fails = [];
  for (const w of want) {
    const wi = ranked.indexOf(w);
    if (wi === -1) { fails.push(`${w} not in top-${TOP_K}`); continue; }
    for (const a of above) {
      const ai = ranked.indexOf(a);
      if (ai !== -1 && ai < wi) fails.push(`${a}(#${ai + 1}) outranks ${w}(#${wi + 1})`);
    }
  }
  return { pass: fails.length === 0, note: fails.join('; ') };
}

// Recall is offered via auto-recall (shouldAutoRecall) + always-in in
// mergeSkillTools, NOT via rankTools — so a recall case asserts the gate
// recognizes the ask, not that the tool wins a keyword tiebreak.
export function recallOk(ask) {
  return shouldAutoRecall(ask);
}

// ---- tool subset for a case (Layer B) ------------------------------------------

export function expectedNames(c) {
  if (c.expect?.noTool) return [];
  const steps = Array.isArray(c.expect) ? c.expect : [c.expect];
  const names = [];
  for (const s of steps) for (const n of (s.anyOf || [s.name])) names.push(n);
  return names;
}

export function buildTools(c, merged) {
  const { ranked } = selection(c.ask, merged);
  const names = new Set([...ALWAYS_IN, ...ranked, ...expectedNames(c)]);
  return merged.filter((t) => names.has(t.function.name));
}

// ---- scoring (ported from dryfire.mjs) -----------------------------------------

export function argsMatch(actual, exp) {
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

export function stepMatches(call, step) {
  const names = step.anyOf || [step.name];
  if (!names.includes(call?.name)) return false;
  return argsMatch(call?.arguments, step.args);
}

export function parseCalls(message) {
  return (message?.tool_calls || []).map((tc) => {
    let args = tc.function?.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* keep raw */ } }
    return { name: tc.function?.name, arguments: args || {} };
  });
}

export function replyOk(finalText, reply) {
  if (!reply) return true;
  const lower = (finalText || '').toLowerCase();
  for (const r of reply.require || []) if (!lower.includes(String(r).toLowerCase())) return false;
  for (const f of reply.forbid || []) if (lower.includes(String(f).toLowerCase())) return false;
  return true;
}

// ---- ollama chat (non-streaming; returns the raw message, tool_calls intact) ---

export async function chatRaw({ model, messages, tools, temperature = 0, timeoutMs = 120_000, numPredict = 512 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('wall-clock exceeded')), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, stream: false, options: { temperature, num_predict: numPredict } }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 404) throw new Error(`model "${model}" not found in Ollama at ${OLLAMA}`);
      throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const j = await res.json();
    if (j.error) throw new Error(`Ollama error: ${j.error}`);
    const msg = j.message || { role: 'assistant', content: '' };
    if (!msg.role) msg.role = 'assistant';
    return msg;
  } finally {
    clearTimeout(t);
  }
}

// ---- one case through the model (Layer B) ---------------------------------------

export async function runModelCase(c, { model, system, merged }) {
  const tools = buildTools(c, merged);
  const base = [
    { role: 'system', content: system },
    { role: 'user', content: `${ANCHOR}\n\n${c.ask}` },
  ];

  const turn1 = await chatRaw({ model, messages: base, tools });
  const calls = parseCalls(turn1);
  const text1 = (turn1.content || '').trim();

  let callPass, callNote = '';
  if (c.expect.noTool) {
    callPass = calls.length === 0 && text1.length > 0;
    if (callPass && c.expect.replyIncludes && !text1.toLowerCase().includes(String(c.expect.replyIncludes).toLowerCase())) {
      callPass = false; callNote = `reply missing "${c.expect.replyIncludes}"`;
    }
  } else {
    const steps = Array.isArray(c.expect) ? c.expect : [c.expect];
    callPass = calls.length === steps.length && steps.every((s, i) => stepMatches(calls[i], s));
    if (!callPass) callNote = `expected ${steps.map((s) => (s.anyOf || [s.name]).join('|')).join(' → ')}`;
  }

  let replyPass = true, replyNote = '', finalText = text1;
  if (c.reply) {
    if (c.expect.noTool) {
      replyPass = replyOk(text1, c.reply);
      if (!replyPass) replyNote = 'reply failed require/forbid';
    } else if (c.toolResult && calls.length > 0) {
      const msgs2 = [...base, turn1, { role: 'tool', content: c.toolResult }];
      const turn2 = await chatRaw({ model, messages: msgs2, tools });
      finalText = (turn2.content || '').trim();
      replyPass = replyOk(finalText, c.reply);
      if (!replyPass) replyNote = 'reply failed require/forbid';
    }
  }

  return {
    callPass, callNote, replyPass, replyNote,
    calls: calls.map((x) => `${x.name}${JSON.stringify(x.arguments)}`),
    finalText,
  };
}
