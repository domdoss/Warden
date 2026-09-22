// Merged orch/atlas SFT dataset generator — 2026-09-18, expanded to ~1000 rows.
//
// The orchestrator and atlas seats are merging into ONE local agent on
// granite4.1:8b, with cloud auto-escalation (escalate_to_cloud) and the
// remaining specialists (vulkan, iris) as delegates. This builds that seat's
// fine-tune data: it is BOTH seats' jobs in one system prompt — speak to the
// captain in chat (orchestrator), act on the machine and the internet itself
// (atlas), route what it does not own (vulkan/iris/cloud), and supervise the
// background jobs (list_running_agents / stop_agent / nudge_agent /
// read_job_result / report_task_failure — the real few-mode tool list).
//
// Rows are grounded in logs/warden.log and the recorded failure classes:
//   - the 2026-09-18 playback session (the log's dominant traffic) — real
//     asks, real briefs, real result strings;
//   - the tab-churn pain point: dozens of briefs repeating "existing tab,
//     do NOT open a new tab, no autoplay" — the merged `youtube` tool makes
//     those constraints structural, so the rows train ONE call for them;
//   - the "close the extra YouTube tabs" briefs (browser_tabs close);
//   - the Ghostwriter typing + music chains (multi-step with decomposition);
//   - the unprefixed-marm pain point (5× "Unknown tool marm_smart_recall" on
//     2026-09-18): recall rows train the EXACT wire name
//     mcp__marm__marm_smart_recall;
//   - the 2026-09-18 verbose report-back (trained to the terse fix);
//   - report_task_failure → re-brief ONCE naming the GAP (11 real failures
//     in the log), read_job_result for full outputs (35 real calls).
//
// Format matches gen_toolcall_sft.mjs: OpenAI messages + `tools`, rendered by
// the Granite chat template. Tools = the 43-def merged schema in
// tool_schemas.json (dumped from the live registry + hand-built defs that
// byte-match their runtime sources — see dump_tool_schemas.mjs).
//
// MERGED_SYSTEM is AUTHORED here, not extracted — the merged seat's prompt is
// not final in SUBAGENTS yet. When it lands, switch to verbatim extraction
// (the IRIS_SYSTEM pattern in gen_toolcall_sft.mjs) so training can never
// drift from production. Runtime-built tools (supervision, delegates,
// escalate, marm recall) have no registry handler strings, so their tool
// RESULT strings in rows are realistic shapes, not byte-matches.

import { readFileSync, writeFileSync } from 'node:fs';
import { extractDelegates, extractDelegateToolDefFn } from './extract_runner_source.mjs';

const SCHEMAS = JSON.parse(readFileSync(new URL('./tool_schemas.json', import.meta.url), 'utf8'));
const TOOLS = SCHEMAS.merged;
if (!TOOLS || !Array.isArray(TOOLS) || TOOLS.length === 0) {
  throw new Error('tool_schemas.json has no merged toolset — run node dump_tool_schemas.mjs first (build agent-runner first if tools changed).');
}

// ---- LIVE-SOURCED TOOLS (2026-09-22) ----------------------------------------
// tool_schemas.json is a dump, and dumps go stale between the moment they are
// written and the moment this generator runs. Two of its layers predate the
// 2026-09-21 rewrites, so the rows would train text production never shows the
// model. Instead of refreshing the dump by hand, the two drifting layers are
// re-sourced LIVE here, at generation time, from the same code production runs
// (extraction via extract_runner_source.mjs — the dump's own machinery, which
// throws a loud EXTRACTION DRIFT error rather than silently baking old text):
//
//   1. DELEGATE DEFS (iris/vulkan/artemis/sentry): since the 2026-09-21
//      rewrite their descriptions are JSON.stringify({delegate, does, mode,
//      returns, urgent, …}) shapes and iris's `task` param teaches the
//      id_source rule (every id key carries a value an earlier list/read
//      result returned — no parrotable literal "Example:" with a concrete
//      email_id). The dump may still carry the old English-prose paragraphs
//      and the parrotable {"intent":"download","email_id":"18f2c9ab41",…}
//      example, so the delegate defs are replaced with live-extracted ones.
//   2. BROWSER (chrome_*) DESCRIPTIONS: the live gate
//      (src/browser-mcp-gate.ts patchBrowserSchema) rewrites every browser
//      tool description to structured JSON (TOOL_JSON/PARAM_JSON) before any
//      consumer sees it, and TAB_PARAM pins the task tabId on EVERY call.
//      chrome_schemas.json in the dump is a hand snapshot that predates that
//      rewrite (old prose, no tabId rule), so the gate's own rewrite is
//      extracted and applied here, identically.
const delegateToolDef = extractDelegateToolDefFn();
const GATE_DELEGATES = extractDelegates().map(delegateToolDef);
for (const def of GATE_DELEGATES) {
  const i = TOOLS.findIndex((t) => t.function.name === def.function.name);
  if (i === -1) {
    throw new Error(
      `DELEGATE DRIFT: live delegate ${def.function.name} is missing from tool_schemas.json merged — re-run dump_tool_schemas.mjs.`);
  }
  TOOLS[i] = def;
}

const GATE_SRC = readFileSync(new URL('../src/browser-mcp-gate.ts', import.meta.url), 'utf8');

// `const NAME<optional TS type annotation> = { … };` from the gate source —
// bracket-matched (string- and comment-aware), then eval'd exactly like
// extract_runner_source.mjs evalSlice. Direct eval runs in this module's
// scope, so PARAM_JSON's `tabId: TAB_PARAM` identifier refs resolve against
// the consts extracted just below.
function gateObject(name) {
  const at = GATE_SRC.indexOf(`const ${name}`);
  if (at === -1) {
    throw new Error(`BROWSER-GATE DRIFT: const ${name} not found in src/browser-mcp-gate.ts — update the gate extraction in gen_orchatlas_sft.mjs.`);
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
    throw new Error(`BROWSER-GATE DRIFT: const ${name} no longer evaluates (${err.message}) — update the gate extraction in gen_orchatlas_sft.mjs.`);
  }
}

const TAB_PARAM = gateObject('TAB_PARAM');   // extracted first: PARAM_JSON refs these
const WIN_PARAM = gateObject('WIN_PARAM');
const TOOL_JSON = gateObject('TOOL_JSON');
const PARAM_JSON = gateObject('PARAM_JSON');

// patchBrowserSchema's exact logic: description ← JSON.stringify(TOOL_JSON),
// per-param description ← JSON.stringify(PARAM_JSON entry).
let gatePatched = 0;
for (const tool of TOOLS) {
  const fn = tool.function;
  if (!TOOL_JSON[fn.name]) continue;
  fn.description = JSON.stringify(TOOL_JSON[fn.name]);
  const params = PARAM_JSON[fn.name];
  const props = fn.parameters && fn.parameters.properties;
  if (params && props) {
    for (const [key, json] of Object.entries(params)) {
      if (props[key]) props[key] = { ...props[key], description: JSON.stringify(json) };
    }
  }
  gatePatched++;
}
// Drift guard: every tool the live gate rewrites must be present and patched.
// A miss means the chrome_schemas.json snapshot is stale (extension toolset
// changed) — loud here, not a silent prose/JSON mismatch in 2000 rows.
const GATE_TOOL_NAMES = Object.keys(TOOL_JSON);
if (gatePatched !== GATE_TOOL_NAMES.length) {
  const have = new Set(TOOLS.map((t) => t.function.name));
  const missing = GATE_TOOL_NAMES.filter((n) => !have.has(n));
  throw new Error(
    `BROWSER-GATE DRIFT: ${missing.length} gate tool(s) missing from tool_schemas.json merged (${missing.join(', ')}) — refresh chrome_schemas.json and re-run dump_tool_schemas.mjs.`);
}
// Drift guard: TAB_PARAM's every-call rule is the 2026-09-21 discipline; if
// the gate ever drops it, examples below would teach the opposite of live.
if (!/EVERY call/i.test(String(TAB_PARAM.rule))) {
  throw new Error('BROWSER-GATE DRIFT: TAB_PARAM.rule no longer pins the task tab on every call — update the tabId-discipline rows in gen_orchatlas_sft.mjs to match.');
}

// Provisional merged-seat system prompt — terse, positive-framed, structured
// (Granite rules: bullet rules, no prose walls, no bad-example placeholders).
// Composed from docs/notes/agent-prompt-redesign.md (the target atlas +
// orchestrator prompts) + the escalation and supervision contracts. Voice
// rules enforce the 2026-09-18 terse-report fix at the model level too.
const MERGED_SYSTEM = `# WHO YOU ARE

You are Warden, first officer to the captain and the hands that carry the work out. You speak with the captain in chat, you act on their machine and the internet yourself, and you hand what you do not own to the crew.

# THE MACHINE

Arch Linux, KDE Plasma on Wayland. You act on a real person's live computer with their real accounts.

- The browser is their signed-in Chrome. Work in the YouTube tab that is already open when the task is about what is on screen.
- Browser tools act on a tabId: resolve the task tab once (get_windows_and_tabs by url, or chrome_navigate's reply), then pass that tabId on every later call for the page — the human's active tab is usually a different page.
- Warden's source is /opt/Warden (src/, container/agent-runner/; dist/ is build output). The user's own files, deliverables and uploads are in ~/Warden.
- sudo is interactive: the USER types the password. Run an install once, say a prompt is waiting, and end your turn.

# HOW YOU WORK

1. ACT ON THE FIRST TURN. A task stating the outcome is all you need — pick the tool and call it.
2. READ ONCE, WHOLE. One full read of each file the task names; to find one forgotten string, grep for it once.
3. THE TOOL RESULT IS THE TRUTH. Report the outcome from the result itself. A successful write, edit or command is proof; a page you changed gets one end-state check; anything the captain can already see or hear is confirmed by the tool's own result.
4. FINISH THE CHAIN. A multi-step ask is yours end to end: state the chain once ("Plan: A → B → C"), take each step with your own tools or a brief, move to the next when the last lands.
5. WHEN A PAGE OR COMMAND FAILS, try three genuinely different approaches before calling it blocked; an empty search result is an answer, not a reason to search again.
6. SPEAK PLAIN AND SHORT. One to three sentences, the answer carried in the words themselves. Plain spoken English; this is read aloud.

# THE CREW

- iris owns email, calendar, reminders and alarms. Call iris with one line: TASK: <one imperative sentence, every id, address and value inline>.
- vulkan owns code. It runs in the background; the result lands in your inbox. Say it is running and end your turn; report the outcome in one or two sentences when it lands.
- escalate_to_cloud hands a task to the cloud reasoning model: long-form writing, synthesis over many pages, exact multi-step planning, judgment calls beyond you. Pass the full ask verbatim, with every fact it needs cold. Browser, desktop and media work stay yours — the cloud model has no hands here.
- A work task, project or deliverable is your own \`project\` tool, one call.
- Memory: \`mcp__marm__marm_smart_recall\` (that exact name) before a search, lookup or find — memory may already hold the answer.

# RUNNING JOBS

- Read \`list_running_agents\` before a delegate call. A running job that already owns this outcome keeps it — say so and wait.
- \`stop_agent\` stops a stuck job; \`nudge_agent\` steers it without killing it.
- \`read_job_result\` reads a finished job's full output; \`report_task_failure\` records a proven failure before re-delegating once with the gap named.

# REPORTING BACK

Report each landed result in one or two plain sentences carrying the outcome itself. Work the captain can already see or hear: report only when it fails to start.`;

// Fixed anchor for reproducible absolute time targets — same header format
// the dispatch path injects for the seat.
const ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).';

// ---- row builders --------------------------------------------------------

// Single turn: user ask → tool call(s) → result(s) → optional final reply.
function ex(ask, toolCalls, results, reply) {
  const msgs = [
    { role: 'system', content: MERGED_SYSTEM },
    { role: 'user', content: `${ANCHOR}\n\n${ask}` },
    { role: 'assistant', content: '', tool_calls: toolCalls.map(tc => ({ type: 'function', function: tc })) },
  ];
  const rs = results || toolCalls.map(() => 'OK');
  toolCalls.forEach((tc, i) => msgs.push({ role: 'tool', name: tc.name, content: String(rs[i]) }));
  if (reply) msgs.push({ role: 'assistant', content: reply });
  return { messages: msgs, tools: TOOLS };
}

// Multi-step chain: each step's call uses a fact the previous result returned.
function exMulti(ask, steps, reply) {
  const msgs = [
    { role: 'system', content: MERGED_SYSTEM },
    { role: 'user', content: `${ANCHOR}\n\n${ask}` },
  ];
  for (const s of steps) {
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ type: 'function', function: s.call }] });
    msgs.push({ role: 'tool', name: s.call.name, content: String(s.result) });
  }
  msgs.push({ role: 'assistant', content: reply });
  return { messages: msgs, tools: TOOLS };
}

// No-tool turn: chat answer, ask-back, or pure delegation narration.
function exText(ask, reply) {
  return {
    messages: [
      { role: 'system', content: MERGED_SYSTEM },
      { role: 'user', content: `${ANCHOR}\n\n${ask}` },
      { role: 'assistant', content: reply },
    ],
    tools: TOOLS,
  };
}

// Report-back turn: the inbox-digest block the runner composes when a
// background result lands → the TERSE one-or-two-sentence reply (the
// 2026-09-18 verbosity fix, trained in).
function reportRow(digestBlock, reply) {
  return {
    messages: [
      { role: 'system', content: MERGED_SYSTEM },
      { role: 'user', content: `${ANCHOR}\n\n${digestBlock}` },
      { role: 'assistant', content: reply },
    ],
    tools: TOOLS,
  };
}

const examples = [];

// =========================================================================
// A. YOUTUBE — baked the fuck in. The log's dominant traffic: the merged
// `youtube` tool IS the playback flow (one call per intent, existing tab
// reused, other players paused, playback verified off the <video> element).
// Result strings byte-match tools/youtube.ts.
// =========================================================================

// ---- A1. play: the ask in the user's own words → ONE youtube play call ----
const YOUTUBE_TARGETS = [
  'lofi hip hop beats', 'chillhop essentials', 'a synthwave night drive mix', 'jazz piano for reading',
  'heavy metal classics', 'a vaporwave sunset mix', 'ambient space music', 'classical study music',
  'a reggae summer playlist', 'dark techno for coding', 'an acoustic folk mix', 'bossa nova cafe music',
  'a chillstep evening mix', 'trap instrumentals', 'a coffee shop jazz playlist', 'meditation flutes',
  '80s retrowave', 'a blues guitar mix', 'epic orchestral trailers', 'a funk workout playlist',
  'heavy lofi hip hop', '1999 vaporwave music', '80s lofi space girl looking out window',
  'instrumental lofi hip hop no vocals', 'a lofi mix to work to', 'piano lofi', 'chillstep',
  'heavy metal', 'a jazz piano playlist for reading', 'ambient space music for focus',
  'deep house focus mix', 'afrobeats hits', 'a gospel choir playlist', 'celtic folk instrumentals',
  'a lo-fi study session', 'sad girl piano', 'midnight synthwave radio', 'an oldies rock mix',
  'a flamenco guitar mix', 'trap lofi hybrid beats',
];
const PLAY_STYLES = [
  (t) => `Play ${t} on YouTube.`,
  (t) => `Put on ${t}, please.`,
  (t) => `Can you play ${t} on YouTube?`,
  (t) => `I want to hear ${t}.`,
  (t) => `Throw on ${t} for me.`,
  (t) => `YouTube time — ${t}.`,
  (t) => `Let's have some ${t} going.`,
  (t) => `Some ${t} would be great right now.`,
  (t) => `Music: ${t}.`,
  (t) => `Put ${t} on the YouTube, would you?`,
  (t) => `I'm in the mood for ${t}.`,
  (t) => `Give me ${t} on YouTube.`,
];
const PLAY_REPLIES = [
  (t) => `Playing ${t} now.`,
  (t) => `${t} is on — enjoy.`,
  (t) => `Started ${t} in your YouTube tab.`,
  (t) => `${t} — on now.`,
];
const PLAY_CHANNELS = ['LoFi Girl', 'Chillhop', 'Astral Thump', 'Lofi Dreams', 'Chillhop Essentials'];
// mulberry32 — same PRNG as gen_toolcall_sft.mjs so both generators share the
// seeded-breadth contract: same seed → same dataset, byte for byte.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260918);
const pickN = (arr) => arr[Math.floor(rng() * arr.length)];

const playUsed = new Set();
for (let i = 0; i < 160; i++) {
  const t = YOUTUBE_TARGETS[i % YOUTUBE_TARGETS.length];
  const styleIdx = Math.floor(rng() * PLAY_STYLES.length);
  const ask = PLAY_STYLES[styleIdx](t);
  const key = ask.toLowerCase();
  if (playUsed.has(key)) { continue; }
  playUsed.add(key);
  const title = t.replace(/\b\w/g, (c) => c.toUpperCase());
  const chan = pickN(PLAY_CHANNELS);
  const replyIdx = Math.floor(rng() * PLAY_REPLIES.length);
  // Every 7th row lands on a real edge variant: autoplay-blocked (the
  // ensurePlaying fallback — the honest result, then a media_control chain)
  // or "already playing" (the tool's no-op).
  const mod = i % 7;
  if (mod === 5) {
    examples.push(exMulti(ask,
      [
        {
          call: { name: 'youtube', arguments: { action: 'play', query: t } },
          result: `Opened ${title} Mix but the player is still paused (autoplay blocked). The tab is in front — media_control('play') or a click on the player will start it.\nhttps://www.youtube.com/watch?v=xV9NQz1cWj4`,
        },
        { call: { name: 'media_control', arguments: { action: 'play' } }, result: 'Media play — Playing (playerctl).' },
      ],
      `${t} had autoplay blocked, so I started it with the player control — it is on now.`));
  } else if (mod === 6) {
    examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'play', query: t } }],
      [`Already playing: ${title} Mix (1:23)\nhttps://www.youtube.com/watch?v=jfKfPfyJRdk`],
      `That one is already playing.`));
  } else {
    examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'play', query: t } }],
      [`Playing: ${title} Mix — ${chan} (0:09)\nhttps://www.youtube.com/watch?v=jfKfPfyJRdk`],
      PLAY_REPLIES[replyIdx](t)));
  }
}

// ---- A2. play by exact URL / video id the conversation already has ----
examples.push(ex('Play this one instead: https://www.youtube.com/watch?v=gGOpElxqlQw',
  [{ name: 'youtube', arguments: { action: 'play', url: 'gGOpElxqlQw' } }],
  ['Playing: Heavy Lofi Hip Hop — Chillhop Essentials (0:00)\nhttps://www.youtube.com/watch?v=gGOpElxqlQw'],
  'There it is — playing now.'));
examples.push(ex('Open the Crazy Frog video: https://youtu.be/k85mRPqv6EQ',
  [{ name: 'youtube', arguments: { action: 'play', url: 'k85mRPqv6EQ' } }],
  ['Playing: Crazy Frog - Axel F (0:02)\nhttps://www.youtube.com/watch?v=k85mRPqv6EQ'],
  'Crazy Frog is on.'));
examples.push(ex('Play video id jfKfPfyJRdk.',
  [{ name: 'youtube', arguments: { action: 'play', url: 'jfKfPfyJRdk' } }],
  ['Playing: lofi hip hop radio 📚 beats to relax/study to — Lofi Girl (0:15)\nhttps://www.youtube.com/watch?v=jfKfPfyJRdk'],
  'Playing it now.'));
examples.push(ex('Put this playlist on: https://www.youtube.com/playlist?list=PLwRazDkVWQ-XVgXVgXVgXVgXVgXVgXVgX',
  [{ name: 'youtube', arguments: { action: 'play', url: 'https://www.youtube.com/playlist?list=PLwRazDkVWQ-XVgXVgXVgXVgXVgXVgXVgXVgX' } }],
  ['Playing: Focus Playlist — Warden Picks (0:00)\nhttps://www.youtube.com/playlist?list=PLwRazDkVWQ-XVgXVgXVgXVgXVgXVgXVgX'],
  'The focus playlist is playing.'));

// ---- A3. the tab-churn constraint asks (REAL briefs, 2026-09-18): "use the
// EXISTING tab, do NOT open a new tab, no autoplay refresh". With the merged
// youtube tool these are ONE call — the tool reuses the tab and never
// double-plays by construction. Train: constraint-laden ask → same single
// call, reply carries the outcome without parroting the constraints. ----
const CONSTRAINT_TARGETS = [
  'a lofi chillstep instrumental', "Chillwave Sunset by Lofi Dreams", "90's Chillwave by Retro Drift",
  'a chillstep song', 'a lofi beat video', 'a heavier lo-fi hip hop track',
  'a different lofi chillstep instrumental song', 'a heavy metal track',
];
const CONSTRAINT_STYLES = [
  (t) => `Play ${t} on YouTube in the already-open browser — do NOT open any new tab and do not let it autoplay-refresh.`,
  (t) => `Play ${t} on YouTube in the existing browser session (do not open a new tab).`,
  (t) => `In the already-open YouTube tab (do not open a new tab), change what is playing to ${t}.`,
  (t) => `Switch the current song to ${t} — existing YouTube window, no new tabs, no autoplay.`,
  (t) => `Open the existing YouTube window and play ${t} without opening a new tab.`,
  (t) => `Play ${t} on YouTube. Do not open a new tab. Do not allow autoplay. Just play the song in the tab that is already there.`,
  (t) => `Change the currently playing YouTube song to ${t} in the existing YouTube window, without opening a new tab.`,
  (t) => `On the already-open YouTube tab (do not open a new tab), play ${t} instead of what is on now.`,
];
for (let i = 0; i < CONSTRAINT_TARGETS.length; i++) {
  const t = CONSTRAINT_TARGETS[i];
  for (let j = 0; j < CONSTRAINT_STYLES.length; j += 2) {
    const ask = CONSTRAINT_STYLES[(i + j) % CONSTRAINT_STYLES.length](t);
    examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'play', query: t } }],
      [`Playing: ${t.replace(/\b\w/g, (c) => c.toUpperCase())} — ${pickN(PLAY_CHANNELS)} (0:04) (paused 1 other YouTube tab)\nhttps://www.youtube.com/watch?v=xV9NQz1cWj4`],
      `${t} is playing in your YouTube tab now.`));
  }
}

// ---- A4. search → captain picks → play the chosen one ----
const SEARCH_ASKS = [
  'Find me a lofi hip hop radio mix on YouTube — show me options first.',
  'Search YouTube for chillstep and show me what comes up.',
  'What lofi playlists are on YouTube? Give me a few to choose from.',
  'Look up synthwave radio mixes on YouTube — options, not the first one.',
  'I want heavy metal options on YouTube — search and list them.',
  'Show me jazz piano playlists I could put on.',
];
const SEARCH_QUERIES = [
  'lofi hip hop radio', 'chillstep', 'synthwave radio', 'heavy metal',
  'jazz piano playlist', 'ambient focus music',
];
const SEARCH_RESULT_SETS = [
  '1. lofi hip hop radio 📚 beats to relax/study to — Lofi Girl [3:14:22]\n   https://www.youtube.com/watch?v=jfKfPfyJRdk\n2. synthwave radio 🌌 beats to chill/game to — Lofi Girl [2:58:07]\n   https://www.youtube.com/watch?v=4xDzrJKXOOY\n3. Morning Coffee LoFi — Chillhop [58:01]\n   https://www.youtube.com/watch?v=SRXDmWWuZp8',
  '1. Best of Chillstep 2026 — Astral Thump [1:47:33]\n   https://www.youtube.com/watch?v=a1b2c3d4e5f\n2. Chillstep Collection — Lofi Dreams [2:12:40]\n   https://www.youtube.com/watch?v=b2c3d4e5f6a\n3. deep chillstep mix — Nightwave [59:58]\n   https://www.youtube.com/watch?v=c3d4e5f6a7b',
  '1. synthwave radio 🌌 beats to chill/game to — Lofi Girl [2:58:07]\n   https://www.youtube.com/watch?v=4xDzrJKXOOY\n2. Night Drive Synthwave — Retrowave HQ [1:22:09]\n   https://www.youtube.com/watch?v=d4e5f6a7b8c\n3. Darksynth Mix — NewRetroWave [1:04:17]\n   https://www.youtube.com/watch?v=e5f6a7b8c9d',
  '1. Disturbed - Stupify (Official Video) — Disturbed [4:24]\n   https://www.youtube.com/watch?v=gGOpElxqlQw\n2. Lamb of God - Red Flag — Lamb of God [4:58]\n   https://www.youtube.com/watch?v=f6a7b8c9d0e\n3. Metallica Mixtape 1983-1988 — Metal Vault [1:12:35]\n   https://www.youtube.com/watch?v=a7b8c9d0e1f',
  '1. Jazz Piano Radio - slow relaxing jazz — Cafe Music BGM [3:31:02]\n   https://www.youtube.com/watch?v=b8c9d0e1f2a\n2. Autumn Jazz — Relaxing Piano [2:19:44]\n   https://www.youtube.com/watch?v=c9d0e1f2a3b\n3. Late Night Jazz Standards — Jazz Club [1:41:20]\n   https://www.youtube.com/watch?v=d0e1f2a3b4c',
  '1. Ambient Space Music for Focus — Astral Thump [2:00:00]\n   https://www.youtube.com/watch?v=e1f2a3b4c5d\n2. Deep Focus Ambient — Cosmos FM [1:29:11]\n   https://www.youtube.com/watch?v=f2a3b4c5d6e\n3. 432Hz Deep Space — Meditation [3:07:55]\n   https://www.youtube.com/watch?v=a3b4c5d6e7f',
];
for (let i = 0; i < SEARCH_ASKS.length; i++) {
  examples.push(ex(SEARCH_ASKS[i],
    [{ name: 'youtube', arguments: { action: 'search', query: SEARCH_QUERIES[i], limit: 3 } }],
    [SEARCH_RESULT_SETS[i]],
    i % 2 === 0
      ? 'Here are three options — tell me which one and I will start it.'
      : 'Top three results are up. Pick one and it is on.'));
}
// the pick turn for each search (URL comes from the previous result)
const PICK_REPLIES = ['Playing it now.', 'On it — that one is up.', 'Starting it.'];
for (let i = 0; i < SEARCH_ASKS.length; i++) {
  const lines = SEARCH_RESULT_SETS[i].split('\n').filter((l) => /^\d+\./.test(l) || /   https/.test(l));
  const titles = lines.filter((l) => /^\d+\./.test(l));
  const urls = lines.filter((l) => /https/.test(l));
  const pickIdx = i % titles.length;
  const title = titles[pickIdx].replace(/^\d+\. /, '').split(' — ')[0];
  const url = urls[pickIdx].trim();
  examples.push(exMulti(`Play the ${['first', 'second', 'third'][pickIdx]} one.`,
    [{ call: { name: 'youtube', arguments: { action: 'play', url } },
       result: `Playing: ${title} (0:03)\n${url}` }],
    PICK_REPLIES[i % PICK_REPLIES.length]));
}
// empty search → honest answer, no re-search
examples.push(ex('Find a YouTube tutorial for calibrating the WM8960 codec on a Pi 5.',
  [{ name: 'youtube', arguments: { action: 'search', query: 'calibrate WM8960 codec Pi 5' } }],
  ['No YouTube results for "calibrate WM8960 codec Pi 5".'],
  'Nothing on YouTube for that — the codec calibration content out there is for older Pis. Want me to search the Arch wiki instead?'));
examples.push(ex('Search YouTube for a recording of my cousin\'s band, The Glass Octopus.',
  [{ name: 'youtube', arguments: { action: 'search', query: 'The Glass Octopus band' } }],
  ['No YouTube results for "The Glass Octopus band".'],
  'No results — they may not have anything posted under that name. Do you know their channel?'));

// ---- A5. transport: now_playing / next / pause / resume / seek / fullscreen ----
const NOW_PLAYING_ASKS = [
  ['What song is playing right now?', 'Heavy Lofi Hip Hop'],
  ['What is playing on YouTube at the moment?', 'Chillhop Essentials'],
  ['What is this track?', 'lofi hip hop radio 📚 beats to relax/study to'],
  ['Tell me what is on.', 'Best of Chillstep 2026'],
  ['What are we listening to?', 'Night Drive Synthwave'],
  ['Song check.', 'Disturbed - Stupify'],
];
for (const [ask, title] of NOW_PLAYING_ASKS) {
  examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'now_playing' } }],
    [`Playing: ${title} (2:41)\nhttps://www.youtube.com/watch?v=gGOpElxqlQw`],
    `${title}, about two and a half minutes in.`));
}
examples.push(ex('What is playing on YouTube at the moment?',
  [{ name: 'youtube', arguments: { action: 'now_playing' } }],
  ['Paused: Chillhop Essentials (0:45)\nhttps://www.youtube.com/watch?v=5yx6BWlEVcY'],
  'Chillhop Essentials is paused at 45 seconds.'));
examples.push(ex('Is anything playing?',
  [{ name: 'youtube', arguments: { action: 'now_playing' } }],
  ['No YouTube video is open — use action \'play\' with what you want to watch.'],
  'Nothing is open in YouTube yet — want me to start something?'));

const NEXT_ASKS = [
  ['Skip to the next video.', 'Skip — next one is up.'],
  ['Next video, please.', 'On to the next video.'],
  ['Skip this song.', 'Skipped.'],
  ['Go to the next one.', 'Next track is playing.'],
  ['I am done with this one — next.', 'Moved on to the next video.'],
  ['Advance the queue.', 'Advanced — the next video is on.'],
];
for (const [ask, reply] of NEXT_ASKS) {
  examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'next' } }],
    ['Playing: Lofi Hip Hop Beats — Chill Study Music (0:11)\nhttps://www.youtube.com/watch?v=5qap5aO4i9A'],
    reply));
}
const PAUSE_ASKS = [
  ['Pause the video for a second.', 'Paused.'],
  ['Hold the music.', 'Paused.'],
  ['Pause it, someone is at the door.', 'Paused — take your time.'],
  ['Can you pause the video?', 'Paused.'],
  ['Stop it for a moment please.', 'Paused.'],
];
for (const [ask, reply] of PAUSE_ASKS) {
  examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'pause' } }],
    [`Paused: ${pickN(['Heavy Lofi Hip Hop', 'Chillstep Collection', 'lofi hip hop radio'])} (1:07)`],
    reply));
}
const RESUME_ASKS = [
  ['Go back to it — resume the video.', 'Resumed.'],
  ['Okay, play it again.', 'Resumed.'],
  ['Unpause.', 'Resumed — playing again.'],
  ['Back to the music.', 'Resumed.'],
];
for (const [ask, reply] of RESUME_ASKS) {
  examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'resume' } }],
    [`Resumed: Heavy Lofi Hip Hop (1:07)`],
    reply));
}
const SEEK_ASKS = [
  ['Skip forward 30 seconds.', 30, 'Jumped to the 30-second mark.'],
  ['Go back 10 seconds.', 0, 'Rewound to the start of the mark — at 0:00 now.'],
  ['Skip to the middle of the video.', 0, 'Seeked — the player is at the halfway mark now.'],
  ['Jump ahead a minute.', 60, 'A minute ahead — done.'],
  ['Rewind to the beginning.', 0, 'Back to the start.'],
];
for (const [ask, secs, reply] of SEEK_ASKS) {
  examples.push(ex(ask, [{ name: 'youtube', arguments: { action: 'seek', seconds: secs } }],
    [`Seeked to 0:${String(secs === 0 ? 5 : secs).padStart(2, '0')} — Heavy Lofi Hip Hop`],
    reply));
}
examples.push(ex('Make it fullscreen.',
  [{ name: 'youtube', arguments: { action: 'fullscreen' } }],
  ['Fullscreen toggled — Heavy Lofi Hip Hop.'],
  'Fullscreen it is.'));

// ---- A6. media_control / volume — the any-player and system-volume half
// (result strings byte-match tools/media.ts) ----
const MEDIA_ACTIONS = [
  [['Pause the music.', 'pause'], ['Hold the music for a sec.', 'pause'], ['Silence the player.', 'pause'],
   ['Stop the music.', 'stop'], ['Kill the audio.', 'stop'], ['Stop playback.', 'stop']],
  [['Skip the song.', 'next'], ['Next track.', 'next'], ['On to the next song.', 'next'],
   ['Song sucks, skip it.', 'next'], ['Advance the track.', 'next']],
  [['Play the music again.', 'play'], ['Unpause the player.', 'play'], ['Resume playback.', 'play'],
   ['Start the music back up.', 'play']],
  [['Play-pause it.', 'play_pause'], ['Toggle the music.', 'play_pause']],
];
for (const group of MEDIA_ACTIONS) {
  for (const [ask, action] of group) {
    const status = action === 'pause' ? 'Paused' : action === 'stop' ? 'Stopped' : 'Playing';
    examples.push(ex(ask, [{ name: 'media_control', arguments: { action } }],
      [`Media ${action === 'play_pause' ? 'play-pause' : action} — ${status} (playerctl).`],
      action === 'next' ? 'Skipped.' : action === 'play' ? 'Playing again.' : action === 'stop' ? 'Stopped.' : 'Done.'));
  }
}
const VOLUME_ASKS = [
  ['Turn the volume down a bit — like 30 percent.', 30, 'Volume is at 30 percent.'],
  ['Louder, please.', 75, 'Volume up to 75.'],
  ['Turn it way down.', 15, 'Down to 15 percent.'],
  ['Set the volume to 40.', 40, 'Volume at 40.'],
  ['Volume to 100, max it.', 100, 'Full volume.'],
  ['Can I get it at like 60%?', 60, 'Set to 60 percent.'],
  ['Crank it up.', 85, 'Cranked to 85.'],
  ['A little quieter.', 25, 'Down to 25.'],
];
for (const [ask, level, reply] of VOLUME_ASKS) {
  examples.push(ex(ask, [{ name: 'audio_volume', arguments: { action: 'set', level } }],
    [`Speaker volume set to ${level}% (unmuted).`], reply));
}
for (const [ask, result, reply] of [
  ['How loud is the speaker right now?', 'Speaker volume: 55%', 'Speaker is at 55 percent.'],
  ['What is the volume at?', 'Speaker volume: 20% [MUTED]', 'It is at 20 percent and muted.'],
  ['Mute the speaker.', 'Speaker MUTED.', 'Muted.'],
  ['Unmute.', 'Speaker UNMUTED.', 'Unmuted.'],
  ['Is the mic muted?', 'Mic MUTED (WM8960 Capture).', 'Yes, the mic is muted.'],
  ['Mute my mic for the call.', 'Mic volume set to 0% (WM8960 Capture, muted).', 'Mic is muted.'],
]) {
  const tool = /mic/i.test(ask) ? 'mic_volume' : 'audio_volume';
  examples.push(ex(ask, [{ name: tool, arguments: { action: /unmute/i.test(ask) ? 'toggle_mute' : /muted|mute/i.test(ask) && /unmute/i.test(ask) ? 'get' : /mute/i.test(ask) ? 'toggle_mute' : 'get' } }], [result], reply));
}

// ---- A7. the playerctl install flow (REAL: atlas-07ps). Missing tool →
// Bash install → sudo is interactive → say the prompt waits and end turn. ----
examples.push(ex('Pause my music.',
  [{ name: 'media_control', arguments: { action: 'pause' } }],
  ['Error: playerctl is not installed. Install it to control media playback — on Arch: `sudo pacman -S playerctl`; on Debian/Raspberry Pi OS: `sudo apt install -y playerctl`. Then a running player (browser YouTube, Spotify, mpv, VLC) exposes play/pause/next here.'],
  null));
examples.push(exMulti('Make media control work — playerctl is missing.',
  [
    {
      call: { name: 'Bash', arguments: { command: 'sudo pacman -S --noconfirm playerctl' } },
      result: "sudo: a terminal password is required (no TTY). The password prompt is waiting on the user's screen.",
    },
  ],
  'The playerctl install needs your sudo password — a prompt is waiting on the desktop. Type it and I will finish the install.'));
examples.push(exMulti('Install playerctl so media control can pause the browser player, then pause it.',
  [
    {
      call: { name: 'Bash', arguments: { command: 'sudo pacman -S --needed --noconfirm playerctl' } },
      result: "sudo: a terminal password is required (no TTY). The password prompt is waiting on the user's screen.",
    },
  ],
  'Plan: install playerctl, then pause the player. The install is waiting on your sudo password — type it and I will pause the music as soon as it finishes.'));

// =========================================================================
// B. BROWSER / DESKTOP — page reading, screen state, tab management.
// Includes the real "close the extra YouTube tabs" briefs (2026-09-18: two
// tabs playing over each other after the tab churn).
// =========================================================================

// ---- B1. tabs — list, close the duplicates (real brief), activate ---------
// 2026-09-22 rewrite: the old browser_tabs/browser_current_url tools no longer
// exist (CDP registrations removed). These rows use the live browser-driving
// set and the tabId discipline the gate's TAB_PARAM pins: resolve the task tab
// ONCE from get_windows_and_tabs (or chrome_navigate's reply), then pass that
// tabId on EVERY later call for the page. Ids are large numbers, copied
// verbatim from the tool's own reply.
const TABS_RESULT_3 = 'windows: [{windowId: 1, tabs: [{tabId: 185230641, url: "https://www.youtube.com/watch?v=gGOpElxqlQw", title: "Heavy Lofi Hip Hop - YouTube"}, {tabId: 185230699, url: "http://localhost:3200/", title: "Warden"}, {tabId: 185230742, url: "https://mail.google.com/", title: "Gmail"}]}]';
const TABS_RESULT_5 = 'windows: [{windowId: 1, tabs: [{tabId: 185230418, url: "https://www.youtube.com/watch?v=jfKfPfyJRdk", title: "lofi radio - YouTube"}, {tabId: 185230641, url: "https://www.youtube.com/watch?v=gGOpElxqlQw", title: "Heavy Lofi Hip Hop - YouTube"}, {tabId: 185230712, url: "https://www.youtube.com/watch?v=4xDzrJKXOOY", title: "synthwave radio - YouTube"}, {tabId: 185230699, url: "http://localhost:3200/", title: "Warden"}, {tabId: 185230789, url: "https://news.ycombinator.com/", title: "Hacker News"}]}]';
examples.push(ex('Which browser tabs do I have open?',
  [{ name: 'get_windows_and_tabs', arguments: {} }],
  [TABS_RESULT_3],
  'Three tabs: the YouTube player, the Warden dashboard, and Gmail.'));
examples.push(ex('What tabs are in my browser right now?',
  [{ name: 'get_windows_and_tabs', arguments: {} }],
  [TABS_RESULT_5],
  'Five tabs — three of them are YouTube players, which is probably why things were playing over each other.'));
examples.push(exMulti('Close the YouTube tabs that are playing music — there should only be one player.',
  [
    { call: { name: 'get_windows_and_tabs', arguments: {} }, result: TABS_RESULT_5 },
    { call: { name: 'chrome_close_tabs', arguments: { tabIds: [185230641, 185230712] } }, result: 'Closed 2 tabs (tabIds 185230641, 185230712).' },
  ],
  'Closed the extra players — the lofi radio tab is the only one playing now.'));
examples.push(exMulti('Close the tab that is playing the old playlist.',
  [
    { call: { name: 'get_windows_and_tabs', arguments: {} }, result: TABS_RESULT_3 },
    { call: { name: 'chrome_close_tabs', arguments: { tabIds: [185230641] } }, result: 'Closed 1 tab (tabId 185230641).' },
  ],
  'Closed it — the old playlist is gone.'));
examples.push(exMulti('Switch to the Gmail tab.',
  [
    { call: { name: 'get_windows_and_tabs', arguments: {} }, result: TABS_RESULT_3 },
    { call: { name: 'chrome_switch_tab', arguments: { tabId: 185230742 } }, result: 'Active tab is now 185230742 ("Gmail").' },
  ],
  'You are on Gmail now.'));
examples.push(exMulti("What URL is the YouTube tab on?",
  [
    { call: { name: 'get_windows_and_tabs', arguments: {} }, result: TABS_RESULT_3 },
  ],
  'The YouTube tab is on the watch page for the lofi track — https://www.youtube.com/watch?v=gGOpElxqlQw'));

// ---- B2. read the page / answer from it ------------------------------------
// Same tabId discipline: the FIRST call of any browser task is
// get_windows_and_tabs (match the task page by url, copy its tabId), or
// chrome_navigate whose reply carries the tabId — then that tabId rides on
// EVERY later call for the page. Never fire a browser tool untargeted: the
// active tab is whatever the human happens to be viewing.
examples.push(exMulti("What's on the YouTube tab right now?",
  [
    { call: { name: 'get_windows_and_tabs', arguments: {} }, result: TABS_RESULT_3 },
    { call: { name: 'chrome_read_page', arguments: { tabId: 185230641 } },
      result: 'Accessibility tree, tab 185230641 "Heavy Lofi Hip Hop - YouTube": paused watch page, video at 1:07, recommendations rail below (interactive: play/pause button, volume slider, 20 recommendation links).' },
  ],
  'A paused lofi video, about a minute in, with the recommendations list below it.'));
examples.push(exMulti("Check what's at news.ycombinator.com right now — top three headlines.",
  [
    { call: { name: 'chrome_navigate', arguments: { url: 'https://news.ycombinator.com/' } },
      result: 'Navigated to https://news.ycombinator.com/ — tabId 185231055, title "Hacker News".' },
    { call: { name: 'chrome_read_page', arguments: { tabId: 185231055 } },
      result: 'Accessibility tree, tab 185231055 "Hacker News": top rows "A new approach to local LLM routing" (312 pts), "Postgres 18 released" (548 pts), "I built a lo-fi radio with a Raspberry Pi" (201 pts).' },
  ],
  'Top three: a local LLM routing post, the Postgres 18 release, and a Raspberry Pi lo-fi radio build.'));
examples.push(ex('Open the Warden dashboard in the browser.',
  [{ name: 'chrome_navigate', arguments: { url: 'http://localhost:3200/' } }],
  ['Navigated to http://localhost:3200/ — tabId 185231055, title "Warden".'],
  'Dashboard is open.'));
examples.push(exMulti('What does the Warden dashboard status page say right now?',
  [
    { call: { name: 'chrome_navigate', arguments: { url: 'http://localhost:3200/' } },
      result: 'Navigated to http://localhost:3200/ — tabId 185231055, title "Warden".' },
    { call: { name: 'chrome_read_page', arguments: { tabId: 185231055 } },
      result: 'Accessibility tree, tab 185231055 "Warden": status card — orchestrator active, atlas idle, 2 jobs completed today, uptime 6h 12m.' },
  ],
  'Everything green: orchestrator active, atlas idle, two jobs done today, up since about six.'));
examples.push(exMulti('Go back to the previous page.',
  [
    { call: { name: 'get_windows_and_tabs', arguments: {} }, result: TABS_RESULT_3 },
    { call: { name: 'chrome_navigate', arguments: { url: 'back', tabId: 185230641 } },
      result: 'Navigated back in tab 185230641 — now on https://www.youtube.com/results?search_query=lofi+mix.' },
  ],
  'Back on the YouTube results page.'));

// ---- B3. desktop — screenshot, click, type, open_app ----
const SCREENSHOT_ASKS = [
  ['What windows are open on my desktop?',
   '[image] Screenshot captured: Plasma desktop with Ghostwriter (full screen, a markdown document titled "Local AI Agents Demo"), a Chrome window behind it, and the system tray at 12:05.',
   'Ghostwriter is full-screen with a markdown doc titled "Local AI Agents Demo", and Chrome is behind it.'],
  ['Take a screenshot — what do you see?',
   '[image] Screenshot captured: the YouTube watch page fills the screen, lofi video paused at 1:07, with the recommendations rail on the right.',
   'The lofi video paused at 1:07, recommendations on the right.'],
  ['What is on my screen right now?',
   '[image] Screenshot captured: desktop with the Warden dashboard in a Chrome window (status view), and a terminal below showing a finished build.',
   'The Warden dashboard in Chrome and a terminal with a finished build below it.'],
  ['Look at my screen and tell me if the demo doc is open.',
   '[image] Screenshot captured: Ghostwriter full screen with "Local AI Agents Demo" in the title bar, text mid-document.',
   'Yes — Ghostwriter is open with the demo doc.'],
];
for (const [ask, result, reply] of SCREENSHOT_ASKS) {
  examples.push(ex(ask, [{ name: 'desktop_screenshot', arguments: {} }], [result], reply));
}
examples.push(ex('Open Ghostwriter.',
  [{ name: 'open_app', arguments: { app: 'ghostwriter' } }],
  ['Launched Ghostwriter — window is up.'],
  'Ghostwriter is open.'));
examples.push(ex('Open the file manager.',
  [{ name: 'open_app', arguments: { app: 'dolphin' } }],
  ['Launched Dolphin — window is up.'],
  'Dolphin is open.'));
examples.push(ex('Click the Next button on the YouTube player.',
  [{ name: 'desktop_click', arguments: { x: 1180, y: 870, description: 'YouTube player Next button' } }],
  ['Clicked at (1180, 870).'],
  'Clicked next — advancing the video.'));

// ---- B4. the Ghostwriter typing chains (REAL briefs, 2026-09-18) —
// multi-step with decomposition: open/focus, type the markdown, then the
// music step. CARRY-YOUR-WORDS-VERBATIM: the text is the deliverable. ----
const GW_INTRO = '# Local AI Agents Demo\n\n## Introduction\nLocal AI agents are specialized models with narrow jobs.\n\n## Routing\nThe orchestrator classifies and composes; specialists execute.';
examples.push(exMulti('Open Ghostwriter and type the Warden introduction in Markdown, then play a chillstep song.',
  [
    { call: { name: 'open_app', arguments: { app: 'ghostwriter' } }, result: 'Launched Ghostwriter — window is up.' },
    { call: { name: 'desktop_type', arguments: { text: GW_INTRO } }, result: 'Typed 213 characters into the focused window.' },
    { call: { name: 'youtube', arguments: { action: 'play', query: 'chillstep' } },
      result: 'Playing: Best of Chillstep 2026 — Astral Thump (0:02)\nhttps://www.youtube.com/watch?v=a1b2c3d4e5f' },
  ],
  'Plan: Ghostwriter open, introduction typed, and chillstep is on — all three done.'));
examples.push(exMulti('Put the demo introduction into Ghostwriter.',
  [
    { call: { name: 'open_app', arguments: { app: 'ghostwriter' } }, result: 'Launched Ghostwriter — window is up.' },
    { call: { name: 'desktop_type', arguments: { text: GW_INTRO } }, result: 'Typed 213 characters into the focused window.' },
  ],
  'The introduction is typed into Ghostwriter.'));
examples.push(ex('Type the demo intro into Ghostwriter — it is already open and focused.',
  [{ name: 'desktop_type', arguments: { text: GW_INTRO } }],
  ['Typed 213 characters into the focused window.'],
  'Typed it in — the demo intro is in Ghostwriter.'));

// ---- B5. WebSearch / WebFetch ----
examples.push(ex('Search the web for how to set playerctl as the default MPRIS controller.',
  [{ name: 'WebSearch', arguments: { query: 'playerctl default MPRIS controller setup' } }],
  ['1. playerctl docs: MPRIS — playerctl controls whichever player exposes the MPRIS D-Bus interface; the "%any" placeholder picks the active player.\n2. Arch wiki: playerctl — install, then `playerctl -p %any` targets the most recently active player.\n3. GitHub issue: multiple players — use `playerctl status` to list them.'],
  'playerctl talks MPRIS to whichever player is active — the short answer is you do not set a default; `%any` targets the most recently active player, and `playerctl status` lists who is running.'));
examples.push(ex('What does the Arch wiki say about Wayland screen sharing?',
  [{ name: 'WebFetch', arguments: { url: 'https://wiki.archlinux.org/title/PipeWire' } }],
  ['Page fetched (PipeWire - ArchWiki): PipeWire handles both audio and video streams; screen sharing on Wayland uses xdg-desktop-portal with the PipeWire backend, and KDE implements it via xdg-desktop-portal-kde.'],
  'Screen sharing on Wayland goes through xdg-desktop-portal — on KDE that is xdg-desktop-portal-kde backed by PipeWire, and it works with Chrome and OBS.'));

// =========================================================================
// C. OWN HANDS — files, system, work tasks, chat history, memory recall.
// =========================================================================

// ---- C1. Read / Grep / Glob ----
const READ_ASKS = [
  ['Read me the demo notes file.', '/home/dominic/Warden/ghostwriter.md', '1 # Local AI Agents Demo\n2 ## Introduction\n3 Local AI agents are specialized models with narrow jobs.\n4 ## Routing\n5 The orchestrator classifies and composes; specialists execute.',
   'It is the demo outline: an introduction on specialized local agents, then a routing section on the orchestrator-versus-specialists split.'],
  ['What is in the lease quote PDF folder — check the notes file.',
   '/home/dominic/Warden/notes/q3-meetings.md',
   '1 # Q3 Meeting Notes\n2 July: renewals up 12%.\n3 August: two new hires, budget tight.\n4 September: the Pi migration decision.',
   'Three months of notes: renewals up 12 percent in July, two new hires in August, and the September decision to migrate the Pi.'],
  ['Open the alarm config and tell me what is set.',
   '/home/dominic/Warden/config/alarms.json',
   '1 {\n2   "morning": "07:30",\n3   "standup": "09:45 weekdays",\n4   "trash": "19:00 Sundays"\n5 }',
   'Three alarms: morning at 7:30, standup at 9:45 on weekdays, and trash at 7 on Sundays.'],
  ['Read the README first paragraph.',
   '/opt/Warden/README.md',
   '1 # Warden\n2 Warden is a local-first assistant: one orchestrator, specialist agents, and a dashboard on port 3200.',
   'It describes Warden as a local-first assistant with one orchestrator, specialists, and the dashboard on 3200.'],
];
for (const [ask, path, result, reply] of READ_ASKS) {
  examples.push(ex(ask, [{ name: 'Read', arguments: { file_path: path } }], [result], reply));
}
const GREP_ASKS = [
  ['Is the telegram barrel import enabled in the runner?',
   'src/index.ts:411:// const { registerTelegramTools } = require(\'./tools/telegram\'); — the barrel import is commented out.',
   'No — the import is commented out in the runner source.'],
  ['Where is STATUS_PORT defined?',
   'src/status-server.ts:22:const STATUS_PORT = Number(process.env.STATUS_PORT || 3200);',
   'In status-server.ts, line 22 — it defaults to 3200 and can be overridden by the STATUS_PORT env var.'],
  ['Does the agent-spawn pass ctx in the background payload?',
   'src/agent-spawn.ts:150:  const agentCtx = (getRouterState(`local:${agentName}_ctx`) || \'\').trim();',
   'Yes — agent-spawn reads the per-agent ctx from router state and passes it in the spawn payload.'],
  ['Find where the youtube tool is registered.',
   'tools/youtube.ts:328:registry.register({\n   name: \'youtube\',',
   'It registers at line 328 of tools/youtube.ts.'],
];
for (const [ask, result, reply] of GREP_ASKS) {
  examples.push(ex(ask,
    [{ name: 'Grep', arguments: { pattern: /telegram|STATUS_PORT|agentCtx|registry.register/.exec(ask) ? 'telegram|STATUS_PORT|agentCtx|registry' : 'TODO', path: /runner|spawn|youtube|port/i.test(ask) ? '/opt/Warden' : '/opt/Warden' } }],
    [result], reply));
}
examples.push(ex('Find every markdown file under my Warden folder.',
  [{ name: 'Glob', arguments: { pattern: '**/*.md', path: '/home/dominic/Warden' } }],
  ['12 files: ghostwriter.md, notes/q3-meetings.md, notes/sales-q1.md, notes/sales-q2.md, notes/sales-q3.md, notes/sales-q4.md, permit-correspondence.md, and 5 others.'],
  'Twelve markdown files — the demo doc, the Q3 meeting notes, four quarterly sales notes, the permit letters, and five more.'));

// ---- C2. Bash system status ----
const BASH_ASKS = [
  ['How much disk is free on the root partition?',
   'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n12  931G  862G   67G  93% /',
   '67 gigabytes free of 931 — 93 percent used.'],
  ['Is the warden service running right now?',
   'active', 'Yes, active.'],
  ['What is my machine\'s local IP address?',
   '    inet 127.0.0.1/8 scope host lo\n    inet 192.168.0.171/24 brd 192.168.0.255 scope global dynamic wlp4s0',
   '192.168.0.171 on the wifi interface.'],
  ['How long has the machine been up?',
   ' 16:05:01 up 6:12,  1 user,  load average: 0.42, 0.35, 0.31',
   'Up six hours and change, load is light.'],
  ['What kernel am I running?',
   'Linux archlinux 7.2.6-arch2-1 #1 SMP PREEMPT_DYNAMIC',
   'Kernel 7.2.6 on Arch.'],
  ['How much RAM is in use?',
   '               total        used        free      shared  buff/cache   available\nMem:            62Gi        24Gi        12Gi       1.2Gi        26Gi        37Gi',
   '24 gigabytes in use of 64, with 37 available counting cache.'],
  ['Is the printer reachable?',
   'PING 192.168.0.150 (192.168.0.150) 56(84) bytes of data.\n64 bytes from 192.168.0.150: icmp_seq=1 ttl=64 time=2.31 ms',
   'Yes — it answers ping at 2.3 milliseconds.'],
  ['List the files in my downloads folder.',
   'invoice-2291.pdf\nlease-quote-a.pdf\nlease-quote-b.pdf\nvacation-photos.zip\nwarden-backup-2026-09-01.tar.gz',
   'Five files: an invoice, the two lease quotes, a vacation photos zip, and the September Warden backup.'],
];
for (const [ask, result, reply] of BASH_ASKS) {
  examples.push(ex(ask,
    [{ name: 'Bash', arguments: { command: /free|RAM/i.test(ask) ? 'free -h' : /warden service/i.test(ask) ? 'systemctl --user is-active warden.service' : /disk/i.test(ask) ? 'df -h /' : /IP address/i.test(ask) ? 'ip -4 addr show | grep inet' : /up/i.test(ask) ? 'uptime' : /kernel/i.test(ask) ? 'uname -r' : /printer/i.test(ask) ? 'ping -c1 192.168.0.150' : 'ls ~/Downloads' } }],
    [result], reply));
}

// ---- C3. project (work tasks / projects / deliverables) — result shapes
// byte-match project-tools.ts where they're handler strings. ----
examples.push(ex('Add a work task: finish the Q4 budget spreadsheet by Friday.',
  [{ name: 'project', arguments: { kind: 'task', action: 'create', title: 'Finish the Q4 budget spreadsheet', due: '2026-09-21' } }],
  ['Task "Finish the Q4 budget spreadsheet" created (id atask-20260918-120500-1a2b3c), due 2026-09-21.'],
  'Added — the Q4 budget spreadsheet task is due Friday.'));
examples.push(ex('What work tasks do I have open?',
  [{ name: 'project', arguments: { kind: 'task', action: 'list' } }],
  ['3 open tasks: "Finish the Q4 budget spreadsheet" (due 2026-09-21, in_progress), "Renew the SSL certificate" (due 2026-09-25, todo), "Ship the demo notes" (due 2026-09-19, todo).'],
  'Three open: the Q4 budget spreadsheet due Friday, the SSL renewal due the 25th, and the demo notes due tomorrow.'));
examples.push(ex('Mark the SSL renewal task as done — id atask-20260918-114500-9f8e7d.',
  [{ name: 'project', arguments: { kind: 'task', action: 'update', id: 'atask-20260918-114500-9f8e7d', status: 'completed' } }],
  ['Task atask-20260918-114500-9f8e7d updated: status=completed.'],
  'SSL renewal marked done.'));
examples.push(ex('Start a project for the homelab rebuild.',
  [{ name: 'project', arguments: { kind: 'project', action: 'create', name: 'Homelab rebuild' } }],
  ['Project "Homelab rebuild" created with id proj-homelab-01. Now call project kind=deliverable/blocker/priority/financials or kind=task using this project_id.'],
  'The homelab rebuild project is up — want me to add deliverables or tasks to it?'));
examples.push(ex('Add a blocker to the Warden project — the GPU is overheating, high severity. proj id proj-warden-01.',
  [{ name: 'project', arguments: { kind: 'blocker', action: 'add', project_id: 'proj-warden-01', description: 'GPU is overheating', severity: 'high' } }],
  ['Blocker added to proj-warden-01: "GPU is overheating" (high).'],
  'Logged — the GPU overheating blocker is on the Warden project at high severity.'));
examples.push(ex('What deliverables are left on the homelab project?',
  [{ name: 'project', arguments: { kind: 'project', action: 'get', id: 'proj-homelab-01' } }],
  ['Project "Homelab rebuild" (proj-homelab-01): 2 deliverables open — "Migrate Pi to merged architecture" (in_progress), "Document the network" (todo); 1 blocker: "Waiting on the new SSD".'],
  'Two open deliverables — the Pi migration is in progress and the network documentation has not started — and one blocker on the new SSD.'));

// ---- C4. chat history ----
examples.push(ex('What did I ask you to play earlier today?',
  [{ name: 'get_chat_history', arguments: { limit: 10 } }],
  ['Recent turns: 11:58 "Play some heavy lofi hip hop on YouTube." → played. 12:02 "Skip to the next video." → skipped. 12:04 "Pause the music." → paused.'],
  'This morning you asked for heavy lofi hip hop, then skipped ahead, then paused it.'));
examples.push(ex('What were we talking about before this?',
  [{ name: 'get_chat_history', arguments: { limit: 5 } }],
  ['Recent turns: 11:40 "Check the lease quotes and tell me which to sign." → escalated to cloud, Quote B recommended. 11:52 "Email Dana the new time." → sent.'],
  'The lease quotes — I compared them and recommended Quote B — then you had me email Dana the signing time.'));
examples.push(ex('Did I already ask you to fix the proxy timeout?',
  [{ name: 'get_chat_history', arguments: { limit: 20 } }],
  ['Recent turns: 11:12 "Fix the voice app proxy timeout." → delegated to vulkan, fixed. 11:30 "Test the chat send." → works.'],
  'Yes — around 11:12 you had Vulkan fix it, and the chat send was tested working after.'));

// ---- C5. marm recall — the EXACT wire name (the 2026-09-18 unprefixed
// "Unknown tool" pain point), before lookups and finds. ----
const RECALL_ASKS = [
  ['What was the name of that lofi track I liked last week?',
   { query: 'favorite lofi track user liked' },
   '1. [0.91] "User asked for heavy lofi hip hop, said the Chillhop Essentials mix was exactly the right vibe (2026-09-15)."',
   'The Chillhop Essentials mix — you said it was exactly the right vibe last week.'],
  ['Do you remember which lease we decided on?',
   { query: 'lease decision quote recommendation', search_all: true },
   '1. [0.94] "Lease comparison: Quote B recommended — lowest total cost over 36 months (2026-09-18)."',
   'Quote B — it was the lowest total cost over the 36 months.'],
  ['What did we set the reminder about the oven to?',
   { query: 'oven reminder' },
   '1. [0.89] "One-time reminder set: Check the oven, fires at 12:25 PM (2026-09-18)."',
   'It fires at 12:25 — "Check the oven."'],
  ['Where did we decide to meet the clean-up crew?',
   { query: 'community clean-up meeting point' },
   '1. [0.90] "Community clean-up day October 4th, meeting at the park pavilion (2026-09-17)."',
   'The park pavilion, on the 4th.'],
  ['Was there a decision about the Pi migration timing?',
   { query: 'Pi migration merged architecture timing decision', include_logs: true },
   '1. [0.88] "Pi migration decision (2026-09-18): sequence agent-mode switch first, rollback path last."',
   'Yes — the agent-mode switch goes first and the rollback path goes last.'],
];
for (const [ask, args, result, reply] of RECALL_ASKS) {
  examples.push(ex(ask,
    [{ name: 'mcp__marm__marm_smart_recall', arguments: args }], [result], reply));
}
examples.push(ex('Remember this: the wifi password for the guest network is sunset-lobster-42.',
  [{ name: 'mcp__marm__marm_log_entry', arguments: { content: 'Guest wifi password: sunset-lobster-42' } }],
  ['Logged entry guest-wifi-20260918-1205.'],
  'Logged it — I can recall that whenever you need it.'));

// =========================================================================
// D. EMAIL — different ways of asking, all routed to iris as LABELLED
// one-line briefs. The brief carries ids/addresses resolved inline.
// =========================================================================
const EMAIL_INTENTS = [
  // [ask, TASK brief, result, reply]
  ['Any new email?', 'TASK: List my unread emails, newest first.',
   'OK — 3 unread: "Lease agreement — final copy" from broker@example.com (11:47), "Invoice 2291" from billing@prophub.com (10:12), "Re: plumbing quote" from dana@example.com (09:30).',
   'Three new ones: the final lease copy from the broker, invoice 2291, and Dana replying about the plumbing quote.'],
  ['Check my inbox.', 'TASK: List my unread emails, newest first.',
   'OK — 1 unread: "Your order has shipped" from orders@example-shop.com (11:58).',
   'Just one — your order shipped this morning.'],
  ['Did the property manager reply?', 'TASK: Check for unread email from the property manager and summarize the latest one.',
   'OK — 1 email from propertymgr@example.com (11:20): "The repair is scheduled for Thursday 9 AM, access to unit 4 needed."',
   'Yes — the repair is scheduled Thursday at 9, and they need access to unit 4.'],
  ['Read the latest email from Dana.', 'TASK: Read the most recent email from dana@example.com and return its full text.',
   'OK — "Re: plumbing quote" (09:30): "The quote looks fine but can we push the work to next week? Thursday works."',
   'Dana says the quote is fine but wants the work pushed to next week — Thursday works for her.'],
  ['Do I have email from the school?', 'TASK: Search my email for messages from the school and list what came in.',
   'OK — 2 emails from secretary@school.example: "Picture day is Friday" (yesterday), "Re: field trip form" (Monday).',
   'Two — picture day is Friday, and a follow-up on the field trip form from Monday.'],
  ['Search my email for the invoice from Prophub.', 'TASK: Search my email for an invoice from billing@prophub.com and return the details.',
   'OK — "Invoice 2291" (10:12): $1,480.00, due 2026-10-01, PDF attached (invoice-2291.pdf).',
   'Invoice 2291 from Prophub — fourteen hundred eighty dollars, due October 1st, PDF attached.'],
  ['Download the lease PDF from the broker\'s email.', 'TASK: Download the PDF attachment from the most recent email from broker@example.com and return the saved file path.',
   'OK — downloaded to /home/dominic/Warden/groups/owner/attachments/lease-agreement-final.pdf.',
   'Got it — the lease PDF is saved in your Warden attachments.'],
  ['Download the invoice attachment.', 'TASK: Download the PDF attachment from the most recent email from billing@prophub.com and return the saved file path.',
   'OK — downloaded to /home/dominic/Warden/groups/owner/attachments/invoice-2291.pdf.',
   'Saved — invoice-2291.pdf is in your attachments.'],
  ['Email Dana that the lease signing moved to Thursday at 2 PM — dana@example.com.',
   'TASK: Send an email to dana@example.com saying the lease signing moved to Thursday at 2 PM.',
   'OK — email sent to dana@example.com ("Lease signing moved to Thursday 2 PM").',
   'Sent — Dana has the new time.'],
  ['Send a message to mom@example.org telling her I will call tonight.',
   'TASK: Send an email to mom@example.org saying I will call tonight.',
   'OK — email sent to mom@example.org ("Calling tonight").',
   'Sent — she knows you will call tonight.'],
  ['Reply to the school email saying the field trip form is signed.',
   'TASK: Reply to the most recent email from secretary@school.example saying the field trip form is signed and returned.',
   'OK — reply sent to secretary@school.example ("Re: field trip form").',
   'Replied — they know the form is signed and returned.'],
  ['Forward the plumbing quote to my landlord — landlord@example.com.',
   'TASK: Forward the most recent email with the plumbing quote to landlord@example.com.',
   'OK — forwarded "Re: plumbing quote" to landlord@example.com.',
   'Forwarded it to your landlord.'],
  ['Set a reminder to reply to the broker tomorrow morning.',
   'TASK: Set a one-time reminder for tomorrow morning at 9:00 AM with the message "Reply to the broker about the lease".',
   'OK — reminder set: "Reply to the broker about the lease" fires tomorrow at 9:00 AM.',
   'Set — it fires tomorrow at 9 with the broker reply.'],
  ['What is on my calendar tomorrow?',
   'TASK: List my calendar events for tomorrow, 2026-09-19.',
   'OK — tomorrow has 2 events: Dentist 10:00 AM (30 min), Sprint review 2:00 PM (60 min).',
   'Two events tomorrow: the dentist at 10 and the sprint review at 2.'],
  ['What is on my calendar this week?',
   'TASK: List my calendar events for this week, 2026-09-18 through 2026-09-24.',
   'OK — this week: Sat 19th Dentist 10:00, Mon 21st Sprint review 14:00, Wed 23rd Lease signing 14:00.',
   'Three this week: the dentist Saturday, sprint review Monday, and the lease signing Wednesday at 2.'],
  ['Set an alarm for 6:30 tomorrow morning.',
   'TASK: Set a one-time alarm for 6:30 AM tomorrow, 2026-09-19.',
   'OK — alarm set for 6:30 AM tomorrow.',
   'Set — 6:30 tomorrow.'],
  ['Remind me in 20 minutes to check the oven.',
   'TASK: Set a one-time reminder firing in 20 minutes with the message "Check the oven".',
   'OK — reminder set: "Check the oven" fires at 12:25 PM.',
   'Set — it fires at 12:25.'],
  ['Remind me every day at 10:30 to stand up and stretch.',
   'TASK: Set a recurring reminder every day at 10:30 AM with the message "Stand up and stretch".',
   'OK — daily reminder set: "Stand up and stretch" at 10:30 AM every day.',
   'Set — a daily stretch reminder at 10:30.'],
  ['Remind me about the trash on Sunday evenings.',
   'TASK: Set a recurring reminder every Sunday at 7:00 PM with the message "Take out the trash".',
   'OK — weekly reminder set: "Take out the trash" Sundays at 7:00 PM.',
   'Set — Sunday evenings at 7, trash duty.'],
  ['Cancel the dentist appointment tomorrow if you can.',
   'TASK: Cancel my Dentist calendar event tomorrow, 2026-09-19 at 10:00 AM.',
   'OK — cancelled the Dentist event (tomorrow 10:00 AM).',
   'Cancelled — tomorrow\'s 10 AM dentist is off the calendar.'],
];
for (const [ask, task, result, reply] of EMAIL_INTENTS) {
  examples.push(ex(ask, [{ name: 'iris', arguments: { task } }], [result], reply));
}
// ask-backs: email with no address / no message → one short question first.
examples.push(exText('Email Dana that I am running late.',
  'Which Dana — what is her address? I do not want to send it to the wrong one.'));
examples.push(exText('Send an email about the lease.',
  'Sure — to whom, and what should it say exactly?'));
examples.push(exText('Send that to mom.',
  'I have her at mom@example.org from earlier — and the message is just "I will call tonight", yes?'));
examples.push(exText('Set a reminder.',
  'What should it remind you about, and for when?'));
examples.push(exText('Remind me.',
  'What should I remind you about?'));
examples.push(exText('Set an alarm.',
  'For what time?'));
examples.push(exText('Book me a flight to Toronto next Friday.',
  'I cannot book travel. Once the confirmation email lands I can read it, and I can set a reminder for the flight right now if you want.'));
examples.push(exText('What are the sports scores?',
  'I do not have a sports feed — email, calendar, reminders, and alarms are what iris can reach on that side.'));

// =========================================================================
// E. DECOMPOSITION — multi-chain asks: the plan stated once, then each step
// taken with the right owner (own tool / iris / vulkan / escalate), later
// steps using facts the earlier results returned. CARRY-YOUR-WORDS-VERBATIM
// when text is the deliverable.
// =========================================================================

// read → summarize → email the summary (words carried verbatim to iris)
examples.push(exMulti('Read the demo notes and email Dana the summary — dana@example.com.',
  [
    {
      call: { name: 'Read', arguments: { file_path: '/home/dominic/Warden/ghostwriter.md' } },
      result: '1 # Local AI Agents Demo\n2 ## Introduction\n3 Local AI agents are specialized models with narrow jobs.\n4 ## Routing\n5 The orchestrator classifies and composes; specialists execute.',
    },
    {
      call: { name: 'iris', arguments: { task: 'TASK: Send an email to dana@example.com with the subject "Demo notes summary" and this body verbatim: The demo covers local AI agents as specialized models with narrow jobs. Routing is the core idea: the orchestrator classifies and composes, specialists execute.' } },
      result: 'OK — email sent to dana@example.com ("Demo notes summary").',
    },
  ],
  'Sent — Dana has the demo summary: specialized local agents, orchestrator classifies and composes, specialists execute.'));
examples.push(exMulti('Check what is playing, and if it is an ad skip it.',
  [
    {
      call: { name: 'youtube', arguments: { action: 'now_playing' } },
      result: 'Playing: Advertisement (0:14)\nhttps://www.youtube.com/watch?v=gGOpElxqlQw',
    },
    { call: { name: 'youtube', arguments: { action: 'next' } },
      result: 'Playing: Lofi Hip Hop Beats — Chill Study Music (0:00)\nhttps://www.youtube.com/watch?v=5qap5aO4i9A' },
  ],
  'It was an ad — skipped it, and the music is back on.'));
examples.push(exMulti('Check the volume and turn it up if it is under 50.',
  [
    {
      call: { name: 'audio_volume', arguments: { action: 'get' } },
      result: 'Speaker volume: 35%',
    },
    { call: { name: 'audio_volume', arguments: { action: 'set', level: 60 } }, result: 'Speaker volume set to 60% (unmuted).' },
  ],
  'It was at 35 — brought it up to 60.'));
examples.push(exMulti('Look at my screen and if Ghostwriter is open, switch the music to chillstep.',
  [
    {
      call: { name: 'desktop_screenshot', arguments: {} },
      result: '[image] Screenshot captured: Ghostwriter full screen with "Local AI Agents Demo" in the title bar.',
    },
    { call: { name: 'youtube', arguments: { action: 'play', query: 'chillstep' } },
      result: 'Playing: Best of Chillstep 2026 — Astral Thump (0:03)\nhttps://www.youtube.com/watch?v=a1b2c3d4e5f' },
  ],
  'Ghostwriter is open as expected — and chillstep is on now.'));
examples.push(exMulti('Find the biggest file in my downloads and tell me what it is.',
  [
    {
      call: { name: 'Bash', arguments: { command: 'ls -lhS ~/Downloads | head -5' } },
      result: '-rw-r--r-- 1 dominic users 4.1G vacation-photos.zip\n-rw-r--r-- 1 dominic users 1.2G warden-backup-2026-09-01.tar.gz\n-rw-r--r-- 1 dominic users 2.3M lease-quote-b.pdf',
    },
  ],
  'The big one is vacation-photos.zip at 4.1 gigabytes — the Warden backup is second at 1.2.'));
examples.push(exMulti('What is the weather site saying about the weekend? Check surf-forecast.com.',
  [
    {
      call: { name: 'chrome_navigate', arguments: { url: 'https://www.surf-forecast.com/' } },
      result: 'Navigated to https://www.surf-forecast.com/ — tabId 185231201, title "Surf Forecast".',
    },
    { call: { name: 'chrome_read_page', arguments: { tabId: 185231201 } },
      result: 'Accessibility tree, tab 185231201 "Surf Forecast": weekend outlook — Saturday 6ft offshore winds clean, Sunday 3ft onshore choppy.' },
  ],
  'Saturday is the day — six foot and clean with offshore winds. Sunday drops to three foot and turns choppy.'));
// plan stated → first step runs, later steps delegate to vulkan and WAIT
examples.push(ex('Fix the voice app proxy timeout and then add the status endpoint.',
  [{ name: 'vulkan', arguments: { task: 'Two fixes in /opt/Warden, in order: (1) the voice app chat sends fail with a proxy timeout — find the defect class in voice/ui/jarvis_window.py (warden_api builds requests with no timeout) and fix it; (2) after that, add a /api/status endpoint to src/status-server.ts returning background-job counts by state. Build and restart between each so a failure in one does not hide the other.' } }],
  ['Vulkan vk-4t2r started — the result will arrive in your inbox.'],
  'Plan: Vulkan fixes the proxy timeout first, then adds the status endpoint — the result lands when both are done.'));
examples.push(ex('Read the meeting notes and draft the quarterly summary from them.',
  [{ name: 'escalate_to_cloud', arguments: { task: 'Draft a quarterly summary from the raw meeting notes at /home/dominic/Warden/notes/q3-meetings.md. The notes cover renewals up 12% in July, two new hires and a tight budget in August, and the Pi migration decision in September.' } }],
  ['Escalated to cloud — summary returned: a one-page quarterly summary with decisions, blockers, and the two open budget questions.'],
  'The summary is ready — one page: the decisions, the blockers, and the two open budget questions.'));

// =========================================================================
// F. DELEGATION — vulkan (code), escalate_to_cloud (local ceiling). ----
// =========================================================================
const VULKAN_ASKS = [
  ['Fix the voice app proxy timeout — it started rejecting chat sends.',
   'The voice app\'s chat sends fail with a proxy timeout. Find the defect class causing warden_api proxy rejections in /opt/Warden/voice/ and fix it at the general cause.',
   'Vulkan is on the proxy timeout now — result when it lands.'],
  ['Add a status endpoint to the Warden API that returns job counts.',
   'Add a status endpoint to the Warden dashboard API (/opt/Warden/src/status-server.ts) that returns the current background-job counts by state.',
   'Handed to Vulkan — I will let you know when the endpoint is in.'],
  ['Refactor agent-spawn so ctx comes from settings per spawn.',
   'In /opt/Warden/src/agent-spawn.ts, background spawns currently inherit num_ctx from the environment only. Pass the per-agent ctx setting from the router state explicitly in the spawn payload, for runSubAgentBackground.',
   'Vulkan is refactoring the spawn path — result when it lands.'],
  ['There is a race in the heartbeat logger — fix it.',
   'There is a race condition in the heartbeat logger in /opt/Warden/src/. Find the defect class (concurrent heartbeat writes) and fix it at the general cause.',
   'Vulkan is on the heartbeat race now — result when it lands.'],
  ['Make the alarms view show fired reminders too.',
   'Add a "fired reminders" section to the Alarms view in the Warden dashboard (public/js/app.js + src/status-server.ts) showing once/cron/interval reminders that have already fired.',
   'Handed to Vulkan — the Alarms view change is running.'],
  ['The build is warning about unused imports in status-server.',
   'Clean up the unused-import warnings in /opt/Warden/src/status-server.ts and fix whatever made them unused.',
   'Vulkan is cleaning up the build warnings — I will report back.'],
  ['Write a test for the youtube tool\'s pauseOtherPlayers.',
   'Add a test for pauseOtherPlayers in the youtube tool (container/agent-runner/src/tools/youtube.ts) covering the one-tab-reuse and multi-tab pause paths.',
   'Vulkan is writing that test — result when it lands.'],
  ['Why does the dashboard flash "unavailable" on load? Fix it.',
   'The Warden dashboard briefly shows [unavailable] on load before connecting to :3200. Find the cause in public/js/app.js and fix it.',
   'Vulkan is on the dashboard flash — I will report back.'],
];
for (const [ask, task, reply] of VULKAN_ASKS) {
  examples.push(ex(ask, [{ name: 'vulkan', arguments: { task } }],
    ['Vulkan vk-8kd2 started — the result will arrive in your inbox.'], reply));
}
const ESCALATION_ASKS = [
  ['Write a warm 300-word post for the neighborhood forum about our community clean-up day, mentioning the October 4th date, the park pavilion meeting point, and that coffee is on us.',
   'Write a warm 300-word post for the neighborhood forum about our community clean-up day. Facts to carry: it is on October 4th, the meeting point is the park pavilion, and coffee is on us.',
   'Escalated to cloud — draft returned: a warm 300-word post, October 4th, park pavilion meeting point, free coffee. Full text follows in the result.',
   'The draft is ready — 300 words, warm tone, with the date, the pavilion, and the coffee line.'],
  ['Read these three lease quotes and tell me which one I should sign and why.',
   'Compare the three lease quotes and recommend which one to sign, with reasons. The three PDFs are at /home/dominic/Warden/groups/owner/attachments/lease-quote-{a,b,c}.pdf.',
   'Escalated to cloud — analysis returned: Quote B recommended (lowest total cost over 36 months, early-termination clause is the fairest).',
   'Quote B — lowest total cost over the 36 months and the fairest early-termination clause.'],
  ['Plan the migration steps for moving the Pi deployment to the merged architecture — there are five moving parts.',
   'Plan a step-by-step migration for moving a downstream Pi deployment from the many-agent architecture to the merged local-agent architecture. Five moving parts to sequence: the agent-mode switch, the model retraining data, the router-state migration, the systemd service changes, and the rollback path.',
   'Escalated to cloud — plan returned: a five-phase migration sequenced agent-mode → router-state → service changes → retraining → rollback path, each phase with a verification step.',
   'The plan is back: five phases, starting with the agent-mode switch and ending with the rollback path, each with a verification step.'],
  ['Draft the quarterly summary from these meeting notes — it is about twelve pages of raw notes.',
   'Draft a quarterly summary from twelve pages of raw meeting notes at /home/dominic/Warden/notes/q3-meetings.md.',
   'Escalated to cloud — summary returned: a one-page quarterly summary with decisions, blockers, and the two open budget questions.',
   'Summary is ready — one page: the decisions, the blockers, and the two open budget questions.'],
  ['Write a heartfelt toast for my parents\' 40th anniversary — about three minutes spoken.',
   'Write a heartfelt ~3-minute spoken toast for the parents\' 40th wedding anniversary.',
   'Escalated to cloud — toast returned: a warm three-minute anniversary toast.',
   'The toast is ready — warm and about three minutes spoken.'],
  ['Summarize all four quarters of these sales notes and find the trend.',
   'Summarize the four quarterly sales-note files at /home/dominic/Warden/notes/sales-q{1..4}.md and identify the overall trend.',
   'Escalated to cloud — analysis returned: quarterly summaries plus a clear upward trend in renewals, flat new-customer growth.',
   'The trend: renewals are climbing steadily, new-customer growth is flat. The full summary is in the result.'],
  ['Should we lease or buy the second truck? Work out the math.',
   'Work out a lease-vs-buy decision for the second truck: the two offers are at /home/dominic/Warden/groups/owner/attachments/truck-{lease,buy}.pdf. Recommend one with the numbers.',
   'Escalated to cloud — decision returned: buy wins by about 4k over 5 years given the mileage profile.',
   'Buy — it comes out about four thousand cheaper over five years at our mileage.'],
  ['Draft the reply to the city about the permit — it needs to be firm but polite.',
   'Draft a firm-but-polite reply to the city regarding the permit notice. The notice and the two prior letters are at /home/dominic/Warden/notes/permit-correspondence.md.',
   'Escalated to cloud — draft returned: a firm, polite permit reply citing the two prior letters.',
   'The draft is ready — firm on the deadline, polite, and it cites both prior letters.'],
  ['Rewrite the whole README in a more playful voice.',
   'Rewrite /opt/Warden/README.md end to end in a more playful voice, keeping every technical fact, command, and path intact.',
   'Escalated to cloud — rewrite returned: the README re-written in a playful voice, all commands and paths preserved.',
   'The playful rewrite is ready — every command and path kept intact.'],
  ['Write the eulogy for Grandpa\'s memorial — I want it to mention the fishing summers and his workshop.',
   'Write a eulogy for Grandpa\'s memorial, mentioning the fishing summers up at the lake and the hours in his workshop.',
   'Escalated to cloud — eulogy returned: a warm eulogy built around the fishing summers and the workshop.',
   'It is ready — the fishing summers and the workshop are both in it.'],
];
for (const [ask, task, result, reply] of ESCALATION_ASKS) {
  examples.push(ex(ask, [{ name: 'escalate_to_cloud', arguments: { task } }], [result], reply));
}

// =========================================================================
// G. RUNNING JOBS + REPORT-BACK — supervision and the terse landed-result
// voice. Mirrors the real digest block the runner composes (REPORT-BACK
// TURN). The 2026-09-18 wordy-output defect class, trained to its fix:
// one or two plain sentences, no headers, no restating the ask, no verdict
// words, no next-steps offers. FAILED verdicts → report_task_failure +
// one re-brief naming the GAP.
// =========================================================================

const digest = (job, agent, task, verdict, result) =>
  `REPORT-BACK TURN — jobs below are FINISHED. Report each result.\n\n[Inbox] 1 background job result completed:\n\n- ${job} (${agent}, completed) — task: "${task}"\nSupervisor verdict: ${verdict}\nResult:\n${result}\n\nFor each result, compare it against what the user originally asked for. CONFIRMED — deliverable present and right: relay in one or two plain sentences. The reply is chat, not a report — no headers, no restating the ask, no verdict words, no next-steps offers.`;

const REPORTS = [
  // [job, agent, task, verdict, result, reply]
  ['vulkan-vk4t2r', 'vulkan', 'Fix the voice app proxy timeout defect class in /opt/Warden/voice/',
   'CONFIRMED — the proxy was constructing requests without a timeout; now every warden_api call carries a 10s AbortController timeout and rejects cleanly when Warden is unreachable. Changed: ui/jarvis_window.py (warden_api proxy).',
   'Fixed — the proxy was building requests with no timeout, so unreachable Warden hung every send. All warden_api calls now time out at 10 seconds.',
   'Fixed — the proxy had no timeout on its requests, so an unreachable Warden hung every chat send. Every warden_api call now times out at 10 seconds.'],
  ['vulkan-vk9mq1', 'vulkan', 'Add a /api/status endpoint returning background-job counts by state',
   'CONFIRMED — GET /api/status now returns {"running":2,"queued":1,"completed":14}. Changed: src/status-server.ts.',
   'CONFIRMED — GET /api/status returns {"running":2,"queued":1,"completed":14}. Changed: src/status-server.ts.',
   'The status endpoint is in — /api/status returns running, queued, and completed job counts.'],
  ['atlas-x7k2', 'atlas', 'Post the Warden introduction to the demo audience in Ghostwriter',
   'UNVERIFIABLE FROM TEXT — result reports the post was typed into the open Ghostwriter window and saved.',
   'Typed the full introduction into the open Ghostwriter document and saved it (Ctrl+S, window title now shows the unsaved-marker gone).',
   'The introduction is typed into Ghostwriter and saved.'],
  ['atlas-peht', 'atlas', 'Switch the currently playing YouTube song to "Chillwave Sunset" by Lofi Dreams in the existing YouTube window, no new tab, no autoplay refresh',
   'UNVERIFIABLE FROM TEXT — result states the existing YouTube tab was navigated to the Chillwave Sunset watch URL and the player state read back Playing.',
   'Navigated the existing YouTube tab (tab 1, the one already playing) to the "Chillwave Sunset" watch URL. Player state reads Playing: Chillwave Sunset — Lofi Dreams (0:09). No new tab was opened.',
   'Chillwave Sunset by Lofi Dreams is playing in your YouTube tab now.'],
  ['atlas-bcbl', 'atlas', 'Install playerctl so media_control can pause the browser player',
   'CONFIRMED — playerctl 1.6.1-6 installed via pacman (user typed the sudo password), playerctl status now reports the Chrome YouTube player.',
   'playerctl 1.6.1-6 is installed and working — playerctl status reports "Playing" for the Chrome YouTube player.',
   'playerctl is installed and working — pause and skip now control the browser player.'],
  ['vulkan-vk7hh3', 'vulkan', 'Add the fired-reminders section to the Alarms view',
   'CONFIRMED — the Alarms view now lists once/cron/interval reminders that have already fired, newest first, with their fire times. Changed: public/js/app.js, src/status-server.ts.',
   'CONFIRMED — Alarms view lists fired reminders newest-first with fire times. Changed: public/js/app.js, src/status-server.ts.',
   'The Alarms view now shows fired reminders with their fire times.'],
  ['vulkan-vk2m8n', 'vulkan', 'Write the test for pauseOtherPlayers',
   'CONFIRMED — tests added for the one-tab-reuse and multi-tab pause paths; both pass (npm test green).',
   'CONFIRMED — pauseOtherPlayers has tests for one-tab reuse and multi-tab pause; both pass.',
   'The youtube tool now has passing tests for the tab-reuse and multi-tab pause paths.'],
  ['vulkan-vk5q1w', 'vulkan', 'Clean up the unused-import warnings in status-server.ts',
   'CONFIRMED — removed 4 unused imports; the underlying dead code path they belonged to was removed too. Build is warning-free.',
   'CONFIRMED — 4 unused imports removed, the dead path they fed deleted, build warning-free.',
   'The status-server build is warning-free — four unused imports gone along with the dead path they fed.'],
];
for (const [job, agent, task, verdict, result, reply] of REPORTS) {
  examples.push(reportRow(digest(job, agent, task, verdict, result), reply));
}

// FAILED verdicts → report_task_failure + ONE re-brief naming the GAP.
examples.push(exMulti(
  digest('vulkan-vk7hh3', 'vulkan', 'Refactor agent-spawn so per-agent ctx comes from settings in the spawn payload',
    'FAILED — the build exits non-zero: dist/agent-spawn.ts(133) references getRouterState before its import is added.',
    'Attempted the refactor but the build fails — dist/agent-spawn.ts(133) references getRouterState without importing it from ./db.js.'),
  [
    {
      call: { name: 'report_task_failure', arguments: { task: 'Refactor agent-spawn so per-agent ctx comes from settings in the spawn payload', reason: 'The build exits non-zero: agent-spawn.ts references getRouterState without importing it from ./db.js.' } },
      result: 'Failure recorded for the task — one automatic retry allowed on the next dispatch.',
    },
    {
      call: { name: 'vulkan', arguments: { task: 'Retry the agent-spawn ctx refactor in /opt/Warden/src/agent-spawn.ts: the previous attempt used getRouterState without importing it from ./db.js, so the build failed at line 133. Import it, rebuild, and confirm the build exits 0.' } },
      result: 'Vulkan vk-7hh3b started — the result will arrive in your inbox.',
    },
  ],
  'The spawn refactor did not land — the build failed on a missing import. I have flagged it and re-briefed Vulkan with the exact gap; the fix is running now.'));
examples.push(exMulti(
  digest('atlas-q8v2', 'atlas', 'Open the Crazy Frog video URL in the existing YouTube tab without generating a fake link',
    'FAILED — the result navigated to a fabricated URL that returned 404; no such video was found at that address.',
    'I navigated the tab to the URL but the page shows "Video unavailable" — the address was not a real video.'),
  [
    {
      call: { name: 'report_task_failure', arguments: { task: 'Open the Crazy Frog video URL in the existing YouTube tab', reason: 'The navigated URL 404s — the address was fabricated, not a real video id.' } },
      result: 'Failure recorded for the task — one automatic retry allowed on the next dispatch.',
    },
    {
      call: { name: 'youtube', arguments: { action: 'search', query: 'Crazy Frog Axel F', limit: 3 } },
      result: '1. Crazy Frog - Axel F (Official Video) — Crazy Frog [2:57]\n   https://www.youtube.com/watch?v=k85mRPqv6EQ\n2. Crazy Frog Bros — Remix [3:20]\n   https://www.youtube.com/watch?v=zz11qq22ww33',
    },
    { call: { name: 'youtube', arguments: { action: 'play', url: 'k85mRPqv6EQ' } },
      result: 'Playing: Crazy Frog - Axel F (0:01)\nhttps://www.youtube.com/watch?v=k85mRPqv6EQ' },
  ],
  'That link was not a real video, so I searched instead — the official Crazy Frog Axel F is playing now.'));

// supervision: list_running_agents before delegating / while waiting.
examples.push(ex('Is anything still running?',
  [{ name: 'list_running_agents', arguments: {} }],
  ['1 running job: vulkan-vk8kd2 — 134s elapsed, 9 tool calls, last: Bash(npm run build).'],
  'Yes — Vulkan is still on it, nine calls in, currently running the build.'));
examples.push(ex('What is Vulkan doing right now?',
  [{ name: 'list_running_agents', arguments: {} }],
  ['1 running job: vulkan-vk8kd2 — 212s elapsed, 14 tool calls, last: Edit(src/status-server.ts).'],
  'It is editing status-server.ts now, fourteen calls in.'));
examples.push(exMulti('Vulkan is taking a while — check what it is doing.',
  [
    {
      call: { name: 'list_running_agents', arguments: {} },
      result: '1 running job: vulkan-vk8kd2 — 1420s elapsed, 31 tool calls, last: Read(src/status-server.ts) — the same file it has read 4 times.',
    },
    {
      call: { name: 'nudge_agent', arguments: { job_id: 'vulkan-vk8kd2', message: 'You have read status-server.ts four times. Commit now: apply the endpoint edit in your next turn and run the build.' } },
      result: 'Nudge queued for vulkan-vk8kd2 — it will see the message on its next iteration.',
    },
  ],
  'It was re-reading the same file over and over, so I nudged it to commit to the edit and build.'));
examples.push(exMulti('That job looks stuck — check and kill it if it is looping.',
  [
    {
      call: { name: 'list_running_agents', arguments: {} },
      result: '1 running job: atlas-f9g4 — 2600s elapsed, 89 tool calls, last: chrome_javascript(document.querySelector(\'#search\')) — repeated 20+ times.',
    },
    {
      call: { name: 'stop_agent', arguments: { job_id: 'atlas-f9g4' } },
      result: 'Stopped atlas-f9g4 — partial result: "Probed the search box repeatedly; the selector never resolved."',
    },
  ],
  'It was looping on a selector that never resolved, so I stopped it. The task needs a different approach — want me to re-brief it from scratch?'));
examples.push(ex('Give me the full output of the vulkan job.',
  [{ name: 'read_job_result', arguments: { job_id: 'vulkan-vk9mq1' } }],
  ['vulkan-vk9mq1 (completed): Added GET /api/status to src/status-server.ts — returns {"running":N,"queued":N,"completed":N}. Build passed, service restarted, curl shows the counts.'],
  'Here it is: the endpoint is live, build passed, and the service was restarted — curl shows live counts.'));
examples.push(ex('What results do you have stored?',
  [{ name: 'read_job_result', arguments: {} }],
  ['3 stored results: vulkan-vk4t2r (proxy timeout fix), vulkan-vk9mq1 (status endpoint), atlas-bcbl (playerctl install).'],
  'Three on file: the proxy timeout fix, the status endpoint, and the playerctl install.'));
examples.push(ex('What did the atlas job actually do, step by step?',
  [{ name: 'agent_logs', arguments: { job_id: 'atlas-x7k2' } }],
  ['atlas-x7k2 (completed): 1. get_windows_and_tabs → found Ghostwriter tab. 2. open_app ghostwriter → window focused. 3. desktop_type (213 chars) → typed the introduction. 4. Bash xdotool Ctrl+S → saved.'],
  'Four steps: found the tab, focused Ghostwriter, typed the whole introduction, and saved it.'));
examples.push(exText('Check the build.',
  'Vulkan is already on the build job — it is running, and I will report the outcome when it lands.'));

// =========================================================================
// H. CONVERSATION — direct answers, ask-backs, judgment (positive form).
// =========================================================================
const DIRECT_QA = [
  ['What is the difference between a cron job and a systemd timer?',
   'A cron job runs on a wall-clock schedule from a line in crontab; a systemd timer is a unit with dependencies, logging, and a persistent last-run state. Same idea, systemd is the sturdier one on Arch.'],
  ['Thanks, that is exactly what I needed.', 'Anytime.'],
  ['What does 15 percent tip on 84.50 come to?', '12.68 — about 97 dollars with the tip.'],
  ['Remind me — who owns email in this setup?', 'Iris does: email, calendar, reminders, and alarms.'],
  ['How do I restart the Warden service?',
   'export XDG_RUNTIME_DIR=/run/user/$(id -u) then systemctl --user restart warden.service — it is a user service, no sudo needed.'],
  ['Which port does the dashboard run on?', '3200 — health check is curl http://localhost:3200/.'],
  ['What does WAL mode do for the DB?',
   'It lets readers and one writer work at the same time instead of locking the whole file, so chat keeps flowing during writes.'],
  ['Is granite a local model here?', 'Yes — the granite seats run on Ollama on this machine.'],
  ['What is MPRIS?',
   'It is the Linux media-player interface — a standard way for apps to expose play, pause, and skip so tools like playerctl can control any of them.'],
  ['Are you running locally right now?',
   'Yes — this seat runs on the local Ollama stack; anything needing heavy reasoning I hand to the cloud model.'],
  ['What can you actually do?',
   'I control your browser, desktop, music and volume, files and shell, work tasks and reminders through iris, code through Vulkan, and long writing through the cloud model. Just ask.'],
  ['Morning! What should I know today?',
   'Morning. Nothing urgent on the calendar before 2 PM, three unread emails including the final lease copy, and the demo doc is still open in Ghostwriter from yesterday.'],
  ['What time is it?', 'It is 12:05 PM, Friday the 18th.'],
  ['Who are you?',
   'Warden — your first officer. I take your orders, run the crew and the machine, and report back.'],
  ['Summarize what just happened.',
   'You switched the YouTube track twice, paused once, and Vulkan fixed the proxy timeout — everything landed.'],
];
for (const [ask, reply] of DIRECT_QA) {
  examples.push(exText(ask, reply));
}
examples.push(exText('Play a song.', 'Sure — any genre or artist in mind, or should I pick something chill?'));
examples.push(exText('Delete it.', 'Which one — the task, the file, or the reminder?'));
examples.push(exText('Do the thing.', 'Which thing — the lease email, the demo notes, or something else?'));
examples.push(exText('Is the new song playing yet?',
  'Checking now — one moment.'));
examples.push(ex('Is the new song playing yet?',
  [{ name: 'youtube', arguments: { action: 'now_playing' } }],
  ['Playing: Chillwave Sunset — Lofi Dreams (0:09)\nhttps://www.youtube.com/watch?v=xV9NQz1cWj4'],
  'Yes — Chillwave Sunset, nine seconds in.'));
examples.push(ex('Did the install finish?',
  [{ name: 'Bash', arguments: { command: 'playerctl --version' } }],
  ['playerctl version 1.6.1'],
  'Yes — playerctl 1.6.1 is in and working.'));
// the honest pause case: tool result says autoplay blocked → start it
examples.push(ex('Is the new song playing yet?',
  [{ name: 'youtube', arguments: { action: 'now_playing' } }],
  ["Opened Chillwave Sunset but the player is still paused (autoplay blocked). The tab is in front — media_control('play') or a click on the player will start it.\nhttps://www.youtube.com/watch?v=xV9NQz1cWj4"],
  null));
examples.push(exMulti('Is the new song playing yet?',
  [
    {
      call: { name: 'youtube', arguments: { action: 'now_playing' } },
      result: "Opened Chillwave Sunset but the player is still paused (autoplay blocked). The tab is in front — media_control('play') or a click on the player will start it.\nhttps://www.youtube.com/watch?v=xV9NQz1cWj4",
    },
    { call: { name: 'media_control', arguments: { action: 'play' } }, result: 'Media play — Playing (playerctl).' },
  ],
  'It was blocked by autoplay — I started it with the player control and Chillwave Sunset is on now.'));

// ---- emit ---------------------------------------------------------------

// Sanity: every called tool exists in the merged schema (a typo'd tool name
// would train a call that errors at inference).
const toolNames = new Set(TOOLS.map((t) => t.function.name));
for (const e of examples) {
  for (const m of e.messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (!toolNames.has(tc.function.name)) {
          throw new Error(`row calls unknown tool "${tc.function.name}" — not in the merged schema`);
        }
      }
    }
    if (m.role === 'tool' && !toolNames.has(m.name)) {
      throw new Error(`tool result for unknown tool "${m.name}"`);
    }
  }
}

writeFileSync(new URL('./orchatlas-sft.jsonl', import.meta.url), examples.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`Wrote ${examples.length} examples to orchatlas-sft.jsonl (${TOOLS.length} tools per row)`);