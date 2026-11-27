#!/usr/bin/env node
// probe-prompt.mjs — the live seat builds a FULL prompt (ORCH + modeBlock +
// now + skills + default_apps/media + fabric + marm recall) that my training
// harness's extractFewModeSystemPrompt() omits. Reproduce the full prompt and
// bisect which added section pushes "play that X" off youtube:play → search.

import { extractFewModeSystemPrompt } from '../extract_runner_source.mjs';
import { extractKeywords, buildRelevantPatternsSection } from '../../dist/agent-runner/dynamic-selection.js';
import { loadToolSchemas, parseCalls, chatRaw, ANCHOR } from './lib.mjs';

const MODEL = process.env.MODEL || 'orchatlas-ft';
const ASK = process.env.ASK || 'play that dark cyberpunk mix';

const { merged } = loadToolSchemas();
const base = extractFewModeSystemPrompt(); // ORCH + modeBlock (what training saw)

function nowLine() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const localIso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `\n\n{"now":{"local":"${localIso} (America/Vancouver)","rule":"use this for time and date asks; if more than a minute has passed, run \`date\` via Bash to refresh"}}`;
}

const skillIndex = '\n\n{"skills":{"discover":"list_skills() → names+descriptions","load":"activate_skill(name) — this turn","core":"already active"}}';

const defaults = '\n\n{"default_apps":{"note":"these providers were chosen in Settings — always use them for their capability","browser":{"provider":"browser-driving","does":"reading and acting on any website page (facebook, social media, forums, news): navigate there, read it, act on it"},"media":{"tool":"youtube","does":"music/mix/song/playlist/video: play, pause, resume, skip, seek, now playing; a stop ask = pause","rule":"one call, its result is the answer; a movie or TV show title is stremio (mcp__stremio__*), not youtube"}}}\n';

const marm = '\n{"long_term_recall":{"when":"the ask is about the user\'s own projects, company, machine, files, accounts, or past work, or names a specific project/person/file → call mcp__marm__marm_smart_recall with search_all:true and include_logs:true, then answer from what it returns","skip":"self-contained questions (math, definitions, general knowledge) → answer directly, no recall call","remember":"when the user asks you to remember something → mcp__marm__marm_log_entry, once per fact","code":"working on Warden\'s own code → mcp__marm__marm_code_context for symbols, mcp__marm__marm_graph_trace for a call path, mcp__marm__marm_graph_impact before a change"}}\n';

function fabricFor(ask) {
  const kw = extractKeywords([{ role: 'user', content: ask }]);
  return buildRelevantPatternsSection(kw, 5);
}

async function sample(system, ask, n = 5) {
  const picks = [];
  for (let i = 0; i < n; i++) {
    try {
      const msg = await chatRaw({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${ANCHOR}\n\n${ask}` },
        ],
        tools: merged,
        temperature: 1.0,
      });
      const calls = parseCalls(msg);
      picks.push(calls.length ? calls.map((c) => `${c.name}:${c.arguments?.action || ''}`).join(';') : '(no tool)');
    } catch (e) { picks.push(`ERR:${e.message.slice(0, 30)}`); }
  }
  const counts = {};
  for (const p of picks) counts[p] = (counts[p] || 0) + 1;
  return counts;
}

const main = async () => {
  const variants = {
    'base (training prompt)': base,
    'base + now': base + nowLine(),
    'base + now + skills': base + nowLine() + skillIndex,
    'base + now + skills + defaults/media': base + nowLine() + skillIndex + defaults,
    'base + now + skills + defaults + fabric': base + nowLine() + skillIndex + defaults + fabricFor(ASK),
    'FULL (live prompt)': base + nowLine() + skillIndex + defaults + fabricFor(ASK) + marm,
  };

  console.log(`ASK: ${ASK}\n`);
  for (const [name, sys] of Object.entries(variants)) {
    const counts = await sample(sys, ASK);
    console.log(`  ${name}: ${JSON.stringify(counts)}`);
  }
};

main().catch((e) => { console.error(`probe failed: ${e.message}`); process.exit(1); });
