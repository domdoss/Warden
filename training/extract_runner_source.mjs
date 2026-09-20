// Extract the live seat's definitions straight out of the runner SOURCE
// (container/agent-runner/src/) so the training data can never drift from
// production. This is the ORCH_SYSTEM lesson applied to everything the
// orchatlas dataset bakes in: the 2026-09-19 skew (57-tool schema vs 46-tool
// pool; 4571-char _sys.txt vs the live prompt) happened because training
// carried hand COPIES. Every function here re-reads the source on every call
// and THROWS LOUDLY when the source moves — a silent fallback would recreate
// the drift these exist to prevent.
//
// Read-only by design: the main session edits the runner; training only reads.
import { readFileSync } from 'node:fs';

const INDEX_TS = '/opt/Warden/container/agent-runner/src/index.ts';
const SKILLS_TS = '/opt/Warden/container/agent-runner/src/skills.ts';

const _src = (p) => readFileSync(p, 'utf8');
export const runnerSrc = () => _src(INDEX_TS);
export const skillsSrc = () => _src(SKILLS_TS);

const drift = (what) =>
  `EXTRACTION DRIFT: ${what} no longer matches the runner source (${INDEX_TS} / ${SKILLS_TS}). ` +
  `Update the regex/scan in training/extract_runner_source.mjs — do NOT copy the text by hand.`;

/** Walk a balanced {...} (or [...]) block starting at src[startIdx] (which must
 *  be the opening brace). String- AND comment-aware: quotes inside comments
 *  (the orchestrator's inbox) would otherwise open a phantom string and
 *  unbalance the scan. Returns the index of the matching close. */
function matchBracket(src, startIdx) {
  const open = src[startIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw new Error(`matchBracket: src[${startIdx}] is not { or [`);
  let depth = 0, q = null, lineComment = false, blockComment = false;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && src[i + 1] === '/') { blockComment = false; i++; } continue; }
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  throw new Error(drift('unbalanced block'));
}

/** Evaluate a slice of runner source as an expression. The slices this is
 *  used on are pure literals (object/array/template strings) with no
 *  interpolation; `${` inside a backtick would be evaluated against nothing
 *  and fail loudly, which is the desired behaviour. */
function evalSlice(text, what) {
  try {
    return eval(`(${text})`);
  } catch (err) {
    throw new Error(drift(`${what}: slice does not evaluate (${err.message})`));
  }
}

/** `const NAME = { ... };` — object-literal const (the *_TOOL_DEFs). */
export function extractObjectConst(name, src = runnerSrc()) {
  const at = src.indexOf(`const ${name} = `);
  if (at === -1) throw new Error(drift(`const ${name}`));
  const openIdx = src.indexOf('{', at);
  const closeIdx = matchBracket(src, openIdx);
  const text = src.slice(openIdx, closeIdx + 1);
  if (/`/.test(text)) throw new Error(drift(`${name} grew a template literal`));
  return evalSlice(text, name);
}

/** `const NAME = new Set<string>([ ... ]);` → the inner array, evaluated. */
export function extractSetArray(name, src = runnerSrc()) {
  const m = src.match(new RegExp(`const ${name} = new Set(?:<[^>]*>)?\\(\\[`));
  if (!m) throw new Error(drift(`Set ${name}`));
  const openIdx = src.indexOf('[', m.index);
  const closeIdx = matchBracket(src, openIdx);
  return evalSlice(src.slice(openIdx, closeIdx + 1), name);
}

/** `const ORCH_SYSTEM = \`...\`;` — the template-literal body, decoded. The
 *  template contains escaped backticks (\`) and NO interpolation; assert the
 *  latter so an edit that adds ${...} fails here instead of silently baking
 *  "undefined" into 2000 rows. */
export function extractORCHSystem(src = runnerSrc()) {
  const at = src.indexOf('const ORCH_SYSTEM = `');
  if (at === -1) throw new Error(drift('ORCH_SYSTEM'));
  let i = at + 'const ORCH_SYSTEM = `'.length, out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
    if (ch === '`') break;
    out += ch; i++;
  }
  if (src[i] !== '`' || src[i + 1] !== ';') throw new Error(drift('ORCH_SYSTEM terminator'));
  if (out.includes('${')) throw new Error(drift('ORCH_SYSTEM gained interpolation'));
  return evalSlice('`' + out + '`', 'ORCH_SYSTEM');
}

/** One SUBAGENTS entry's fields, extracted individually (the full array
 *  literal is too big to eval against nothing). Only the fields the tool
 *  defs and crewBlock use are pulled: delegate / label / summary / routing /
 *  background / toolsets. */
export function extractSubagentFields(delegate, src = runnerSrc()) {
  const startRe = new RegExp(`delegate: '${delegate}',`);
  const sm = src.match(startRe);
  if (!sm) throw new Error(drift(`SUBAGENTS entry '${delegate}'`));
  const next = src.slice(sm.index + 1).search(/\n\s*delegate: '|\n\]/);
  const slice = next === -1 ? src.slice(sm.index, sm.index + 4000)
    : src.slice(sm.index, sm.index + 1 + next);
  const field = (re, what) => {
    const m = slice.match(re);
    if (!m) throw new Error(drift(`SUBAGENTS '${delegate}' field ${what}`));
    return m[1];
  };
  const strField = (name) => evalSlice(
    field(new RegExp(`${name}: (('(?:\\\\.|[^'])*')|("(?:\\\\.|[^"])*"))`), name),
    `${delegate}.${name}`);
  const toolsets = (() => {
    const m = slice.match(/toolsets: \[/);
    if (!m) throw new Error(drift(`SUBAGENTS '${delegate}' toolsets`));
    const openIdx = slice.indexOf('[', m.index);
    const closeIdx = matchBracket(slice, openIdx);
    return evalSlice(slice.slice(openIdx, closeIdx + 1), `${delegate}.toolsets`);
  })();
  return {
    delegate,
    label: strField('label'),
    summary: strField('summary'),
    routing: strField('routing'),
    background: /^true$/.test(field(/background: (true|false)/, 'background')),
    toolsets,
  };
}

/** All non-atlas SUBAGENTS delegates (the ones delegateToolDef is called on).
 *  orch included since 8ddc077: it is a background subagent the seat calls for
 *  long multi-specialist chains — the seat cannot call itself. */
export function extractDelegates(src = runnerSrc()) {
  const names = ['vulkan', 'iris', 'artemis', 'sentry', 'orch'];
  const out = [];
  for (const n of names) {
    try { out.push(extractSubagentFields(n, src)); }
    catch (err) { throw new Error(drift(`delegate list (${err.message})`)); }
  }
  return out;
}

/** A function declaration extracted from the source and eval'd with its TS
 *  annotations stripped (`function f(s: SubAgentDef): any {` → `f(s)`). Only
 *  the three shapes below use this; anything else in the body that is not
 *  plain JS will throw at eval — loudly, as intended. */
function extractFunction(name, src, prologue = '') {
  const at = src.indexOf(`function ${name}(`);
  if (at === -1) throw new Error(drift(`function ${name}`));
  const headEnd = src.indexOf('{', at);
  const head = src.slice(at, headEnd);
  // `function f(a: X, b?: Y): Z {` → `function f(a, b)`. Params keep their
  // names, drop their annotations; the return annotation after `)` goes too.
  const hm = head.match(/^function ([A-Za-z0-9_]+)\(([^)]*)\)/);
  if (!hm) throw new Error(drift(`function ${name} signature (${head.trim()})`));
  const params = hm[2].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean).join(', ');
  const bare = `function ${hm[1]}(${params})`;
  const closeIdx = matchBracket(src, headEnd);
  const body = src.slice(headEnd, closeIdx + 1);
  try {
    return eval(`(() => { ${prologue} return (${bare} ${body}); })()`);
  } catch (err) {
    throw new Error(drift(`function ${name} does not evaluate (${err.message})`));
  }
}

/** delegateToolDef(): SubAgentDef → Ollama tool def, byte-faithful to source. */
export function extractDelegateToolDefFn(src = runnerSrc()) {
  return extractFunction('delegateToolDef', src);
}

/** crewBlock(): the # THE CREW roster, generated from the extracted SUBAGENTS
 *  fields exactly the way the source generates it from the real array. The
 *  function body reads the module-level SUBAGENTS const, so the roster is
 *  injected into the eval scope in source order (atlas first — crewBlock
 *  filters it out itself). */
export function extractCrewBlock(src = runnerSrc()) {
  const order = ['atlas', 'vulkan', 'iris', 'artemis', 'sentry'];
  const roster = order.map((n) => extractSubagentFields(n, src));
  const fn = extractFunction('crewBlock', src, `const SUBAGENTS = ${JSON.stringify(roster)};`);
  const out = fn();
  if (typeof out !== 'string' || out.includes('undefined')) {
    throw new Error(drift('crewBlock output'));
  }
  return out;
}

/** The few-mode system prompt the merged seat actually composes:
 *  ORCH_SYSTEM + modeBlock. Since 8ddc077 the seat has ONE mode (atlas IS the
 *  seat), so modeBlock is a plain string-concat expression — extracted
 *  verbatim and evaluated with the real crewBlock, so a prompt edit flows
 *  into the dataset on the next merge and an edit that references anything
 *  undefined throws here. Env-dependent sections the live builder appends
 *  after modeBlock (journal, skill index, default apps, MARM recall) are
 *  deliberately NOT part of training rows. */
export function extractFewModeSystemPrompt(src = runnerSrc()) {
  const start = src.indexOf("const modeBlock = '");
  if (start === -1) throw new Error(drift('modeBlock'));
  // Walk to the statement's `;` outside any string — the concat branches are
  // `'...'` literals + `crewBlock()`, so the first unquoted `;` ends it. (A
  // fixed offset used to skip the terminator when the block got shorter.)
  const bodyStart = start + 'const modeBlock = '.length;
  let end = -1, inStr = false;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === "'") inStr = false; continue; }
    if (ch === "'") { inStr = true; continue; }
    if (ch === ';') { end = i; break; }
  }
  if (end === -1 || end - start > 8000) throw new Error(drift('modeBlock extent'));
  const expr = src.slice(bodyStart, end);
  if (!expr.includes('crewBlock()')) throw new Error(drift('modeBlock shape'));
  const crew = extractCrewBlock(src);
  const evalOut = eval(`(() => { const crewBlock = () => ${JSON.stringify(crew)}; return ${expr}; })()`);
  if (typeof evalOut !== 'string' || evalOut.includes('undefined')) {
    throw new Error(drift('modeBlock output'));
  }
  return extractORCHSystem(src) + evalOut;
}

/** skills.ts buildAlwaysOnTools(): the 13 always-on "core" skill tool defs the
 *  runner layers onto every live turn via mergeSkillTools(). */
export function extractAlwaysOnTools(src = skillsSrc()) {
  const fn = extractFunction('buildAlwaysOnTools', src.replace(/export function/, 'function'));
  const out = fn();
  if (!Array.isArray(out) || out.length === 0 || out.some((t) => !t?.function?.name)) {
    throw new Error(drift('buildAlwaysOnTools output'));
  }
  return out;
}