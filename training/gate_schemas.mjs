// The live browser gate (src/browser-mcp-gate.ts) decides which browser tools
// the seat sees and rewrites their descriptions to structured JSON
// (TOOL_JSON/PARAM_JSON) before any consumer reads them. Training has to see
// exactly that, so this module extracts the gate's own tables and applies the
// gate's own filter + rewrite to the chrome_schemas.json snapshot.
import { readFileSync } from 'node:fs';

const GATE_SRC = readFileSync(new URL('../src/browser-mcp-gate.ts', import.meta.url), 'utf8');

// `const NAME<optional TS type annotation> = { … };` from the gate source —
// bracket-matched (string- and comment-aware), then eval'd exactly like
// extract_runner_source.mjs evalSlice. Direct eval runs in this module's
// scope, so PARAM_JSON's `tabId: TAB_PARAM` identifier refs resolve against
// the consts extracted just below.
function gateObject(name) {
  const at = GATE_SRC.indexOf(`const ${name}`);
  if (at === -1) {
    throw new Error(`BROWSER-GATE DRIFT: const ${name} not found in src/browser-mcp-gate.ts — update training/gate_schemas.mjs.`);
  }
  const openIdx = GATE_SRC.indexOf('{', at);
  let depth = 0, i = openIdx, inStr = null, esc = false;
  while (i < GATE_SRC.length) {
    const ch = GATE_SRC[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
    } else if (ch === "'" || ch === '"' || ch === '`') inStr = ch;
    else if (ch === '/' && GATE_SRC[i + 1] === '/') { while (i < GATE_SRC.length && GATE_SRC[i] !== '\n') i++; }
    else if (ch === '/' && GATE_SRC[i + 1] === '*') { i += 2; while (i < GATE_SRC.length && !(GATE_SRC[i] === '*' && GATE_SRC[i + 1] === '/')) i++; i++; }
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  if (depth !== 0) {
    throw new Error(`BROWSER-GATE DRIFT: const ${name} in src/browser-mcp-gate.ts has unbalanced braces.`);
  }
  try {
    return eval(`(${GATE_SRC.slice(openIdx, i + 1)})`);
  } catch (err) {
    throw new Error(`BROWSER-GATE DRIFT: const ${name} no longer evaluates (${err.message}) — update training/gate_schemas.mjs.`);
  }
}

export const TAB_PARAM = gateObject('TAB_PARAM');   // extracted first: PARAM_JSON refs these
export const WIN_PARAM = gateObject('WIN_PARAM');
export const TOOL_JSON = gateObject('TOOL_JSON');
export const PARAM_JSON = gateObject('PARAM_JSON');

/** The gate's isServed + patchBrowserSchema, on OpenAI-shaped defs
 *  ({type:'function', function:{name, description, parameters}}). Tools the
 *  gate does not serve are dropped; every served tool must be present. */
export function servedBrowserTools(defs) {
  const out = [];
  for (const def of defs) {
    const fn = def.function || def;
    if (!TOOL_JSON[fn.name]) continue;
    const copy = JSON.parse(JSON.stringify(def));
    const cfn = copy.function || copy;
    cfn.description = JSON.stringify(TOOL_JSON[cfn.name]);
    const params = PARAM_JSON[cfn.name];
    const props = cfn.parameters && cfn.parameters.properties;
    if (params && props) {
      for (const [key, json] of Object.entries(params)) {
        if (props[key]) props[key] = { ...props[key], description: JSON.stringify(json) };
      }
    }
    out.push(copy);
  }
  const have = new Set(out.map((d) => (d.function || d).name));
  const missing = Object.keys(TOOL_JSON).filter((n) => !have.has(n));
  if (missing.length) {
    throw new Error(`BROWSER-GATE DRIFT: ${missing.length} gate tool(s) missing from chrome_schemas.json (${missing.join(', ')}) — refresh chrome_schemas.json from the gate's tools/list.`);
  }
  return out;
}
