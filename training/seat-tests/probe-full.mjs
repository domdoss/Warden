#!/usr/bin/env node
// probe-full.mjs — does the FULL tool universe (78 tools, incl. stremio/websearch)
// push "play that X" off youtube:play? Runs training prompt + full merged tools.

import { loadToolSchemas, systemPrompt, parseCalls, chatRaw, ANCHOR } from './lib.mjs';

const MODEL = process.env.MODEL || 'orchatlas-ft';
const ASKS = process.env.ASKS
  ? process.env.ASKS.split('|')
  : ['play that dark cyberpunk mix', 'put that lofi mix back on', 'play that ambient thing from earlier'];

const { merged } = loadToolSchemas();
const system = systemPrompt();

async function one(ask, temperature) {
  const msg = await chatRaw({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `${ANCHOR}\n\n${ask}` },
    ],
    tools: merged,
    temperature,
  });
  const calls = parseCalls(msg);
  if (!calls.length) return '(no tool)';
  return calls.map((c) => `${c.name}:${c.arguments?.action || ''}:${c.arguments?.query || ''}`).join('; ');
}

const main = async () => {
  for (const ask of ASKS) {
    console.log(`\nASK: ${ask}`);
    for (const t of [1.0]) {
      const picks = [];
      for (let i = 0; i < 6; i++) {
        try { picks.push(await one(ask, t)); }
        catch (e) { picks.push(`ERR:${e.message.slice(0, 40)}`); }
      }
      const counts = {};
      for (const p of picks) counts[p] = (counts[p] || 0) + 1;
      console.log(`  full-tools temp ${t}: ${JSON.stringify(counts)}`);
    }
  }
};

main().catch((e) => { console.error(`probe failed: ${e.message}`); process.exit(1); });
