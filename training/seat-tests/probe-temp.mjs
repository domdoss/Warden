#!/usr/bin/env node
// probe-temp.mjs — isolate WHY the live seat drifts "play that X" → youtube
// search instead of play. Runs the same prompt + constrained toolset that Layer
// B uses, but at BOTH temperatures, several samples each, and prints the tool
// call the model picks. If temp 1.0 drifts to search while temp 0 stays play,
// the harness was testing at the wrong temperature.

import { loadToolSchemas, systemPrompt, buildTools, parseCalls, chatRaw, ANCHOR } from './lib.mjs';

const MODEL = process.env.MODEL || 'orchatlas-ft';
const ASKS = process.env.ASKS
  ? process.env.ASKS.split('|')
  : ['play that dark cyberpunk mix', 'put that lofi mix back on', 'play that ambient thing from earlier'];

const { merged } = loadToolSchemas();
const system = systemPrompt();

async function one(ask, temperature) {
  const tools = merged.filter((t) => t.function.name === 'youtube');
  const msg = await chatRaw({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `${ANCHOR}\n\n${ask}` },
    ],
    tools,
    temperature,
  });
  const calls = parseCalls(msg);
  if (!calls.length) return '(no tool)';
  return calls.map((c) => `${c.name}:${c.arguments?.action || '?'}:${c.arguments?.query || ''}`).join('; ');
}

const main = async () => {
  for (const ask of ASKS) {
    console.log(`\nASK: ${ask}`);
    for (const t of [0, 1.0]) {
      const picks = [];
      for (let i = 0; i < 5; i++) {
        picks.push(await one(ask, t));
      }
      const counts = {};
      for (const p of picks) counts[p] = (counts[p] || 0) + 1;
      console.log(`  temp ${t}: ${JSON.stringify(counts)}`);
    }
  }
};

main().catch((e) => { console.error(`probe failed: ${e.message}`); process.exit(1); });
