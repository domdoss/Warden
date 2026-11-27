#!/usr/bin/env node
// probe-mcp.mjs — confirm the live MCP "search"-heavy tools (stremio, filesystem,
// github) push "play that X" off youtube:play → search. Adds realistic defs for
// the connected MCP servers the training never saw, and re-runs the ask.

import { extractFewModeSystemPrompt } from '../extract_runner_source.mjs';
import { loadToolSchemas, parseCalls, chatRaw, ANCHOR } from './lib.mjs';

const MODEL = process.env.MODEL || 'orchatlas-ft';
const ASK = process.env.ASK || 'play that dark cyberpunk mix';

const { merged } = loadToolSchemas();
const system = extractFewModeSystemPrompt();

const mcpTools = [
  { type: 'function', function: { name: 'mcp__stremio__play', description: '{"what":"play a movie or TV show","query":"title as typed"}', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'mcp__stremio__search', description: '{"what":"search for a movie or TV show","query":"title"}', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'mcp__filesystem__search_files', description: '{"what":"search files by glob/path"}', parameters: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'mcp__github__search_repositories', description: '{"what":"search GitHub repos"}', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'mcp__mcp-server-time__get_current_time', description: '{"what":"current time"}', parameters: { type: 'object', properties: { timezone: { type: 'string' } }, required: ['timezone'] } } },
];

async function sample(tools, n = 6) {
  const picks = [];
  for (let i = 0; i < n; i++) {
    try {
      const msg = await chatRaw({
        model: MODEL, messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${ANCHOR}\n\n${ASK}` },
        ], tools, temperature: 1.0,
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
  console.log(`ASK: ${ASK}\n`);
  console.log('  training universe (78):', JSON.stringify(await sample(merged)));
  console.log('  + live MCP search tools: ', JSON.stringify(await sample([...merged, ...mcpTools])));
};

main().catch((e) => { console.error(`probe failed: ${e.message}`); process.exit(1); });
