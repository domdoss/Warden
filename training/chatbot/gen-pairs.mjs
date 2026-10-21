// Custom chatbot, step 1: intake form → persona prompt → SFT pairs.
//
//   node training/chatbot/gen-pairs.mjs --slug <bot> [--count 100]
//
// Reads bots/<slug>/intake.json (written by the dashboard's Custom chatbot
// tab), renders the persona system prompt from it, and has the cloud model (gemma4:31b-cloud) write
// single-turn user/assistant pairs across a fixed set of personality
// categories. Output: bots/<slug>/persona.txt + bots/<slug>/pairs.jsonl, one
// {"messages":[system, user, assistant]} row per pair — the same row shape
// train_iris_lora.py trains (no tools field).
//
// Granite's reply is constrained by a JSON schema (Ollama `format`), so every
// batch comes back as parseable {pairs:[{user,assistant}]} — no re-ask loop.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitMsg, log, ollamaChat } from '../loop/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The studio is isolated to one LLM: the selected cloud model writes the pairs too.
const GEN_MODEL = 'gemma4:31b-cloud';
const BATCH = 10;

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const slug = arg('slug', '');
if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)) exitMsg(`bad --slug "${slug}"`);
const count = Math.max(BATCH, Math.min(400, parseInt(arg('count', '100'), 10) || 100));

log(`writer model: ${GEN_MODEL}`);

const BOT_DIR = path.join(HERE, 'bots', slug);
let intake;
try {
  intake = JSON.parse(readFileSync(path.join(BOT_DIR, 'intake.json'), 'utf8'));
} catch (err) {
  exitMsg(`cannot read ${BOT_DIR}/intake.json: ${err.message}`);
}
const f = intake.fields || {};
for (const k of ['name', 'what_it_is', 'what_it_does', 'who_for']) {
  if (!String(f[k] || '').trim()) exitMsg(`intake field "${k}" is empty — fill it in and generate again`);
}

// --- 1. persona prompt (Role → Capabilities → Guidelines → Format) --------
const line = (label, v) => (String(v || '').trim() ? `${label}: ${String(v).trim()}\n` : '');
// the advanced prompt (written by the dashboard's "Generate advanced prompt") wins over the basic one
const advanced = existsSync(path.join(BOT_DIR, 'system-prompt.txt')) ? readFileSync(path.join(BOT_DIR, 'system-prompt.txt'), 'utf8').trim() : '';
const persona = advanced ||
  `You are ${f.name.trim()}, ${f.what_it_is.trim()}${f.owner?.trim() ? ` for ${f.owner.trim()}` : ''}.\n\n` +
  `Role\n` +
  line('Serves', f.who_for) +
  `\nCapabilities\n` +
  line('Helps with', f.what_it_does) +
  `\nGuidelines\n` +
  line('Personality and tone', f.personality) +
  line('Outside its scope, it', f.handoff) +
  `Stays in character as ${f.name.trim()} in every reply.\n` +
  `\n` + readFileSync(path.join(HERE, 'tools-prompt.txt'), 'utf8').trim();
writeFileSync(path.join(BOT_DIR, 'persona.txt'), persona + '\n');
log(`persona prompt written (${persona.length} chars, ${advanced ? 'advanced prompt' : 'basic prompt from the intake'})`);

// --- 2. categories: the pairs spread evenly across these -------------------
const CATEGORIES = [
  ['identity', `The user asks who or what the assistant is, its name, or whether it is a bot. The assistant answers as ${f.name.trim()}.`],
  ['purpose', 'The user asks what the assistant can do or how it can help. The assistant describes its capabilities in its own voice.'],
  ['audience', 'The user asks who the assistant is for, or describes themselves. The assistant relates its help to the people it serves.'],
  ['owner', f.owner?.trim()
    ? `The user asks who made the assistant or who it works for. The assistant names ${f.owner.trim()}.`
    : 'The user asks who made the assistant or who it works for. The assistant answers from its described role.'],
  ['greeting', 'The user opens with a greeting or small talk. The assistant greets back in character and offers help.'],
  ['in-scope', 'The user asks a concrete question or request squarely within the capabilities. The assistant helps helpfully and specifically.'],
  ['out-of-scope', `The user asks for something outside the assistant's scope. The assistant ${f.handoff?.trim() ? `responds the way its guidelines describe: ${f.handoff.trim()}` : 'says kindly that it is outside what it does and steers back to what it can help with'}.`],
  ['tone', 'The user is confused, frustrated, or terse. The assistant stays in its described personality and moves the conversation forward.'],
];

const SCHEMA = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { user: { type: 'string' }, assistant: { type: 'string' } },
        required: ['user', 'assistant'],
      },
    },
  },
  required: ['pairs'],
};

const WRITER_SYSTEM = `Role
You write training conversations for a custom chatbot. Each conversation is one user message and the chatbot's reply.

The chatbot's persona
${persona}

Guidelines
- Every reply is written fully in the chatbot's personality and tone.
- User messages sound like real people: varied length, wording, and phrasing, sometimes casual or with typos.
- Every user message in a batch is distinct from the others.
- Replies are one to four sentences.

Format
Return JSON: {"pairs":[{"user":"...","assistant":"..."}]}`;

// --- 3. generate -----------------------------------------------------------
const perCat = Math.ceil(count / CATEGORIES.length);
const seen = new Set();
const rows = [];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

for (const [cat, brief] of CATEGORIES) {
  let got = 0;
  for (let b = 0; got < perCat && b < Math.ceil(perCat / BATCH); b++) {
    const want = Math.min(BATCH, perCat - got);
    const content = await ollamaChat(GEN_MODEL, [
      { role: 'system', content: WRITER_SYSTEM },
      { role: 'user', content: `Category: ${cat}\n${brief}\n\nWrite ${want} conversations for this category.` },
    ], { format: SCHEMA, think: false, options: { temperature: 0.8 } });
    let pairs = [];
    try { pairs = JSON.parse(content).pairs || []; } catch { pairs = []; }
    for (const p of pairs) {
      const u = String(p?.user || '').trim();
      const a = String(p?.assistant || '').trim();
      if (!u || !a || a.length > 1200 || seen.has(norm(u))) continue;
      seen.add(norm(u));
      rows.push({ category: cat, messages: [
        { role: 'system', content: persona },
        { role: 'user', content: u },
        { role: 'assistant', content: a },
      ] });
      got++;
      if (got >= perCat) break;
    }
    log(`${cat}: ${got}/${perCat}`);
  }
}
if (!rows.length) exitMsg('the cloud model produced no usable pairs');

writeFileSync(path.join(BOT_DIR, 'pairs.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
log(`DONE — ${rows.length} pairs written to bots/${slug}/pairs.jsonl`);
