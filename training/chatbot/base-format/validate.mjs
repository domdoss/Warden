// Validates the base formatting set (base-format/*.jsonl). Every bot trains on these rows on top of
// its own pairs, so each row must match the EXACT prompt shape the studio sends at answer time.
//   node training/chatbot/base-format/validate.mjs            (all files)
//   node training/chatbot/base-format/validate.mjs pie.jsonl  (one file)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTR = 'Answer the question using the documents above, citing sources like [1]. If the documents do not contain the answer, say so. Format the answer in Markdown; use tables for comparisons and a ```mermaid block for any chart or graph.';
const CHART_KIND = {
  pie: /^pie\b/, 'xy-bar': /^xychart-beta\b[\s\S]*\bbar\b/, 'xy-line': /^xychart-beta\b[\s\S]*\bline\b/, quadrant: /^quadrantChart\b/,
  flowchart: /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/, sequence: /^sequenceDiagram\b/, state: /^stateDiagram-v2\b/, journey: /^journey\b/,
  gantt: /^gantt\b/, timeline: /^timeline\b/, mindmap: /^mindmap\b/,
};
const files = process.argv[2] ? [process.argv[2]] : readdirSync(HERE).filter((f) => f.endsWith('.jsonl'));
let bad = 0, total = 0;
for (const f of files) {
  const style = path.basename(f, '.jsonl');
  const lines = readFileSync(path.join(HERE, path.basename(f)), 'utf8').split('\n').filter((l) => l.trim());
  lines.forEach((line, n) => {
    total++;
    const err = (m) => { bad++; console.log(`${f}:${n + 1}  ${m}`); };
    let r;
    try { r = JSON.parse(line); } catch { return err('not valid JSON'); }
    const m = r.messages;
    if (r.category !== 'fmt-' + style) return err(`category must be "fmt-${style}"`);
    if (!Array.isArray(m) || m.length !== 3 || m[0].role !== 'system' || m[1].role !== 'user' || m[2].role !== 'assistant') return err('messages must be [system, user, assistant]');
    if (m[0].content !== 'PERSONA') return err('system content must be exactly "PERSONA" (train.sh stamps the bot persona in)');
    const u = String(m[1].content || '');
    if (!/^<documents>\n\[1\] \([^)\n]+\)\n/.test(u)) return err('user must start with "<documents>\\n[1] (file.md)\\n"');
    if (!u.includes('\n</documents>\n\n' + INSTR + '\n\nQuestion: ')) return err('user must contain the exact </documents> + instruction + "Question: " block');
    const a = String(m[2].content || '');
    if (a.length < 40) return err('assistant answer too short');
    if (/<\/?think>/i.test(a)) return err('assistant must not contain think tags');
    const fences = [...a.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((x) => x[1].trim());
    if (style === 'not-found') { if (!/don.t|do not|doesn.t|does not|not (in|included|covered|mentioned)/i.test(a)) err('not-found answer must say the documents lack it'); return; }
    if (!/\[\d+\]/.test(a)) return err('assistant must cite a source like [1]');
    if (CHART_KIND[style]) {
      if (fences.length !== 1) return err(`needs exactly one \`\`\`mermaid block (found ${fences.length})`);
      if (!CHART_KIND[style].test(fences[0])) return err(`mermaid block must be a ${style} chart`);
    } else if (style === 'mixed') {
      if (fences.length !== 1 || !/\n\|[^\n]*\|\n\|\s*:?-{3,}/.test('\n' + a)) err('mixed needs one mermaid block AND one Markdown table');
    } else if (style === 'table') {
      if (!/\n\|[^\n]*\|\n\|\s*:?-{3,}/.test('\n' + a)) err('needs a Markdown table');
    } else if (fences.length) err('Markdown-only styles must not contain a mermaid block');
  });
}
console.log(`${total} rows checked, ${bad} problems`);
process.exit(bad ? 1 : 0);
