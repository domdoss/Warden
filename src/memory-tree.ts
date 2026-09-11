/**
 * Memory-tree log classifier — the "dump period" job.
 *
 * The memory tree (data/memory-tree.json) is the taxonomy of everything
 * Warden should know about the user and the machine: 28 base points (the
 * user side weighted heaviest — routines, family, people, projects,
 * preferences — plus the system/Warden side), 2-3 branches deep. The
 * STRUCTURE is curated; the DETAILS are picked up from the logs: when
 * nothing is happening (no agent run in flight and nothing big loaded in
 * Ollama — the orchestrator model has been unloaded) or on request
 * (POST /api/memory/classify), this job loads granite4.1:30b, reads the
 * warden.log backlog the classifier hasn't processed yet, and classifies
 * durable facts out of it into the taxonomy, filing each one into MARM as
 * "memory tree — <path>: <fact>" (first write opens the "memory tree"
 * topic).
 *
 * A run processes the WHOLE backlog that existed when it began: the log size
 * is snapshotted at run start, and everything written after that (including
 * the classifier's own log lines) belongs to the NEXT run. The target is
 * therefore always finite and the run always finishes — no time cap. The
 * byte cursor is persisted after every batch, so a crash (or an aborted
 * run) resumes where it left off at the next dump period. Mid-run it gives
 * up if a big model (not ours) loads into VRAM — the machine is needed
 * again — or the model/MARM starts failing. The eyes_ears memory galaxy
 * renders the same taxonomy and pulls each node's memories back out of
 * MARM, so filed facts show up as the tree filling in.
 */
import fs from 'fs';
import path from 'path';
import { OLLAMA_URL } from './config.js';
import { getDb, getRouterState, setRouterState } from './db.js';
import { logger } from './logger.js';
import { marmLogEntries, cleanModelOutput, marmToolCall } from './memory-writeback.js';

export interface TreeNode { n: string; q?: string; c?: TreeNode[]; }

const MTREE_MODEL = process.env.MTREE_MODEL || 'granite4.1:30b';
const CURSOR_KEY = 'mtree:cursor';
const IDLE_CHECK_MS = 5 * 60 * 1000; // cadence for the idle-gated autostart probe
const BIG_VRAM = 8 * 1024 ** 3;      // "big" = a model holding ≥8 GB of VRAM
const BATCH_LINES = 200;
const LINE_TRUNC = 400;
const MAX_BATCH_CHARS = 14_000;
const MAX_FACTS_PER_BATCH = 12;
const CLASSIFY_TIMEOUT_MS = 300_000; // per batch — the 30b can share the GPU with a live session; a solo-only 180s timed out under contention

const TREE_PATH = path.join(process.cwd(), 'data', 'memory-tree.json');
const LOG_PATH = path.join(process.cwd(), 'logs', 'warden.log');

let cachedTree: TreeNode[] | null = null;
let running = false;
let lastIdleCheck = 0;

// Recently-filed facts + assistant recalls, newest last — served to the
// eyes_ears galaxy for its brain-scan flares (GET /api/memory-tree/activity;
// the agent-runner POSTs its recalls there). A ring so a slow poller still
// sees the last minute of activity; process-local, so it resets on restart
// (the galaxy baselines on boot — no history replay).
export interface TreeActivityEvent {
  ts: number; kind: 'write' | 'recall'; path?: string; fact?: string; query?: string;
}
const TREE_ACTIVITY: TreeActivityEvent[] = [];
const TREE_ACTIVITY_MAX = 60;
export function noteTreeActivity(ev: Omit<TreeActivityEvent, 'ts'>): void {
  TREE_ACTIVITY.push({ ts: Date.now(), ...ev });
  if (TREE_ACTIVITY.length > TREE_ACTIVITY_MAX) TREE_ACTIVITY.shift();
}
export function treeActivity(): TreeActivityEvent[] {
  return TREE_ACTIVITY.slice();
}
export function memoryTreeRunning(): boolean {
  return running;
}

/** The taxonomy (data/memory-tree.json), cached after first load. */
export function loadMemoryTree(): TreeNode[] {
  if (!cachedTree) {
    cachedTree = (JSON.parse(fs.readFileSync(TREE_PATH, 'utf-8')) as { roots: TreeNode[] }).roots;
  }
  return cachedTree!;
}

/** Flattened "Root > Branch > Leaf" paths for the classifier prompt and the
 *  galaxy's recall queries. */
export function taxonomyPaths(tree: TreeNode[] = loadMemoryTree()): string[] {
  const out: string[] = [];
  const walk = (nodes: TreeNode[], prefix: string) => {
    for (const nd of nodes) {
      const p = prefix ? prefix + ' > ' + nd.n : nd.n;
      out.push(p);
      if (nd.c?.length) walk(nd.c, p);
    }
  };
  walk(tree, '');
  return out;
}

/** Models (other than ours) big enough to mean "the machine is in use".
 *  Unreachable /api/ps counts as busy — never classify blind. */
async function bigModelsLoaded(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return ['ps-unreachable'];
    const data = (await res.json()) as { models?: Array<{ name: string; size_vram?: number }> };
    return (data.models || [])
      .filter((m) => (m.size_vram || 0) >= BIG_VRAM && m.name !== MTREE_MODEL)
      .map((m) => m.name);
  } catch {
    return ['ps-unreachable'];
  }
}

/** Ask Ollama to unload a model (keep_alive 0 — same as `ollama stop`). */
async function unloadModel(name: string): Promise<void> {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: name, keep_alive: 0 }),
    });
  } catch {
    // unload request failed — the re-probe decides whether it took
  }
}

/** Auto-dump the big models squatting in VRAM so the scan can load.
 *  Returns the models still loaded after the attempt (empty = GPU free,
 *  'ps-unreachable' = can't tell — treat as busy, never dump blind). */
async function dumpBigModels(): Promise<string[]> {
  let big = await bigModelsLoaded();
  if (big.includes('ps-unreachable')) return big;
  for (const m of big) {
    logger.info({ model: m }, 'memory-tree: unloading big model to free VRAM');
    await unloadModel(m);
  }
  if (big.length) {
    await new Promise((r) => setTimeout(r, 2000));
    big = await bigModelsLoaded();
  }
  return big;
}

interface Batch { lines: string[]; nextCursor: number }

/** Read the next batch of COMPLETE log lines from the byte cursor, never
 *  reading past `limit` (the run-start snapshot of the log size — lines
 *  written after the run began are the next run's backlog). Only advances
 *  over lines it returns, so the cursor never skips unclassified content.
 *  A shrunk file (rotation/truncation) resets to 0. */
function readBatch(cursor: number, limit: number): Batch | null {
  let size: number;
  try {
    size = fs.statSync(LOG_PATH).size;
  } catch {
    return null;
  }
  const start = size < cursor ? 0 : cursor; // rotated/truncated — start over
  const end = Math.min(size, limit);
  if (end <= start) return null;
  const fd = fs.openSync(LOG_PATH, 'r');
  try {
    const len = Math.min(end - start, 1024 * 1024);
    const buf = Buffer.alloc(len);
    const bytes = fs.readSync(fd, buf, 0, len, start);
    const text = buf.subarray(0, bytes).toString('utf-8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return null; // no complete line in this window yet
    const rawLines = text.slice(0, lastNl).split('\n');
    const lines: string[] = [];
    let consumedBytes = 0;
    let chars = 0;
    for (const l of rawLines) {
      if (lines.length >= BATCH_LINES || chars >= MAX_BATCH_CHARS) break;
      const t = l.trim().slice(0, LINE_TRUNC);
      lines.push(t);
      chars += t.length;
      consumedBytes += Buffer.byteLength(l, 'utf-8') + 1; // + newline
    }
    return { lines: lines.filter(Boolean), nextCursor: start + consumedBytes };
  } finally {
    fs.closeSync(fd);
  }
}

interface Fact { path: string; fact: string }

/** Durability gate: a second granite pass over the batch's candidates.
 *  Classification at temp 0 reliably produces session narrative no matter
 *  the rules ("agent ran ls -la", "rewrite will produce…") — the same model
 *  that over-files is a reliable keep/drop judge (proven by the cleanup
 *  runs). Each candidate lives or dies here, before MARM ever sees it.
 *  Returns null on model failure — same failure class as classification. */
// One junk shape granite's judge keeps failing on at temp 0: the sentence's
// SUBJECT is a Warden agent/component and its verb is a completed action.
// Durable facts don't start "The Vulkan agent performed…" — mechanical,
// precise, cheaper than another prompt round.
const AGENT_SUBJECT_RE = /^(the\s+)?(warden|vulkan|atlas|iris|mercury|oculus|sentry|byte|dexter|artemis|granite|ollama|jarvis|marm|agent|agents|runner|sub-?agent|job|tool|model)\b/i;
const ACTION_VERB_RE = /\b(performed|performing|invoked|invoking|ran|executed|executing|read|wrote|edited|editing|deleted|deleting|generated|generating|searched|searching|scanned|scanning|checked|checking|listed|listing|attempted|attempting|started|starting|finished|spawning|spawned|returned|fired|captured|capturing|completed)\b/i;
function isAgentAction(fact: string): boolean {
  return AGENT_SUBJECT_RE.test(fact) && ACTION_VERB_RE.test(fact);
}

async function curateFacts(facts: Fact[]): Promise<Fact[] | null> {
  const candidates = facts.filter((f) => !isAgentAction(f.fact));
  if (candidates.length === 0) return [];
  if (candidates.length < 2) return candidates; // tiny batch: not worth a judge call
  const schema = {
    type: 'object',
    properties: { keep: { type: 'array', items: { type: 'integer' } } },
    required: ['keep'],
  };
  const system =
    'Role: you keep the permanent memory of Warden (an assistant) and its user.\n\n' +
    'Input: numbered candidate facts.\n\n' +
    'Rules:\n' +
    '- KEEP only what remains true a month from now\n' +
    '- A fact IS: accounts, people, projects (what, where, goal), preferences, environment, wiring\n' +
    '- Everything else is a moment of work — plans, progress, tool runs, agent actions, future tense — not memory\n' +
    '- Doubt = DROP\n\n' +
    'Output: the numbers to KEEP.';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MTREE_MODEL,
        stream: false,
        format: schema,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: candidates.map((f, i) => `${i}: ${f.path}: ${f.fact}`).join('\n') },
        ],
        // same num_ctx as the classify call — a different value would
        // reload the model between passes; this rides the loaded instance.
        options: { temperature: 0, num_ctx: 32768 },
        keep_alive: 600,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const cleaned = cleanModelOutput(data.message?.content || '');
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    const obj = JSON.parse(cleaned.slice(s, e + 1)) as { keep?: unknown };
    if (!Array.isArray(obj.keep)) return null;
    const seen = new Set<number>();
    const out: Fact[] = [];
    for (const k of obj.keep) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < candidates.length && !seen.has(i)) {
        seen.add(i);
        out.push(candidates[i]);
      }
    }
    return out;
  } catch (err) {
    logger.warn({ err }, 'memory-tree: curate facts failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Near-duplicate filter: log lines repeat the same status events across
// batches, so the same "fact" gets filed batch after batch (one run produced
// 22 restart facts). Signatures of filed facts persist in router_state
// (capped, oldest dropped), so repeats never reach MARM.
const FACTSIG_KEY = 'mtree:factsigs';
let factSigs: Set<string> | null = null;
function factSig(path: string, fact: string): string {
  return path.toLowerCase() + '|' + fact.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}
function loadFactSigs(): Set<string> {
  if (factSigs) return factSigs;
  try {
    factSigs = new Set(JSON.parse(getRouterState(FACTSIG_KEY) || '[]'));
  } catch {
    factSigs = new Set();
  }
  return factSigs;
}
function rememberFactSigs(sigs: string[]): void {
  const s = loadFactSigs();
  for (const g of sigs) s.add(g);
  const arr = [...s];
  const capped = arr.length > 2000 ? arr.slice(arr.length - 2000) : arr;
  factSigs = new Set(capped);
  setRouterState(FACTSIG_KEY, JSON.stringify(capped));
}

// The filed facts themselves (newest last), so each batch can be shown to the
// model what's already on file — text signatures only block identical
// restatements, paraphrases need the model to see the fact and skip it.
const FILED_KEY = 'mtree:filed';
const FILED_MAX = 400;
const FILED_PROMPT_MAX = 120;
let filedFacts: Array<{ p: string; f: string }> | null = null;
function loadFiledFacts(): Array<{ p: string; f: string }> {
  if (filedFacts) return filedFacts;
  try {
    filedFacts = JSON.parse(getRouterState(FILED_KEY) || '[]') as Array<{ p: string; f: string }>;
  } catch {
    filedFacts = [];
  }
  return filedFacts;
}
function rememberFiledFacts(fs: Array<{ p: string; f: string }>): void {
  const all = loadFiledFacts();
  for (const r of fs) all.push(r);
  filedFacts = all.length > FILED_MAX ? all.slice(all.length - FILED_MAX) : all;
  setRouterState(FILED_KEY, JSON.stringify(filedFacts));
}

// ---------- Durable fact index (store.db memory_tree_facts) ----------
// The galaxy needs per-node counts for all 211 taxonomy nodes on load.
// Re-deriving them client-side meant one paced semantic recall per node
// (4-15 min against MARM's rate limit, and semantic misses left lit paths
// dark). The server already knows every fact at file time — record it here
// and serve the whole index in one API call. sig-keyed, so a re-run or a
// paraphrase that slipped the filters can't duplicate a row.
export interface FiledFact { path: string; fact: string; ts: string }
export function recordTreeFacts(fresh: Fact[]): void {
  const db = getDb();
  const ins = db.prepare('INSERT OR IGNORE INTO memory_tree_facts (sig, path, fact) VALUES (?, ?, ?)');
  db.transaction((rows: Fact[]) => {
    for (const f of rows) ins.run(factSig(f.path, f.fact), f.path, f.fact);
  })(fresh);
}
export function filedTreeFacts(): FiledFact[] {
  return getDb()
    .prepare('SELECT path, fact, ts FROM memory_tree_facts ORDER BY ts, rowid')
    .all() as FiledFact[];
}

// One-time backfill of the index from MARM: facts filed before the index
// existed are enumerated straight out of the classifier's own log sessions
// ("memory tree-<date>") — marm_log_show with no args lists every session,
// then returns each session's entries verbatim. No semantic queries, no
// limits. Fires once per process, only while the index is empty; afterwards
// the classifier keeps the index current at file time.
const MTREE_TAG = 'memory tree — ';
let backfillTried = false;
export async function maybeBackfillTreeFacts(): Promise<void> {
  if (backfillTried) return;
  backfillTried = true;
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM memory_tree_facts').get() as { c: number };
    if (row.c > 0) return;
    const list = await marmToolCall('marm_log_show', {});
    const sessions = (Array.isArray(list?.sessions) ? list!.sessions : [])
      .map((s: { session_name?: string }) => String(s?.session_name || ''))
      .filter((n: string) => n.startsWith('memory tree'));
    if (!sessions.length) return;
    const valid = new Set(taxonomyPaths().map((p) => p.toLowerCase()));
    const facts: Fact[] = [];
    for (const s of sessions) {
      const entries = await marmToolCall('marm_log_show', { session_name: s });
      for (const e of Array.isArray(entries?.entries) ? entries!.entries : []) {
        const c = String(e?.full_entry || e?.summary || '');
        if (!c.startsWith(MTREE_TAG)) continue;
        const rest = c.slice(MTREE_TAG.length);
        const colon = rest.indexOf(': ');
        if (colon === -1) continue;
        const p = rest.slice(0, colon).trim();
        const fact = rest.slice(colon + 2).trim().slice(0, 300);
        if (p && fact && valid.has(p.toLowerCase())) facts.push({ path: p, fact });
      }
    }
    if (facts.length) {
      recordTreeFacts(facts);
      logger.info({ sessions: sessions.length, facts: facts.length }, 'memory-tree: backfilled fact index from MARM');
    }
  } catch (err) {
    logger.warn({ err }, 'memory-tree: fact-index backfill failed');
  }
}

// Paths the dump classifier never files into: the log is a terrible source
// for them (session noise drowns signal). MARM Memory is the flood case —
// its durable facts get curated from docs, not from Warden's own chatter.
const SKIP_PATHS = new Set(['Projects > AI & Tools > MARM Memory']);

// Word-overlap paraphrase filter: the model restates the same fact in new
// wording across (and within) batches — "resides at /x" vs "is located at
// /x" — and text signatures can't catch that. Two facts with the same path
// whose word sets overlap enough are the same fact.
const OVERLAP_STOP = new Set(['the', 'and', 'with', 'has', 'have', 'had', 'for', 'are', 'was', 'from', 'this', 'that', 'its', 'also', 'user', 'users']);
function wordSet(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !OVERLAP_STOP.has(w)),
  );
}
function sameFact(a: string, b: string): boolean {
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size < 2 || B.size < 2) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= 0.75;
}

/** One granite4.1:30b call: classify a batch of log lines into taxonomy
 *  facts. Returns null on model failure (the run aborts and resumes later),
 *  an empty array for a noisy batch with nothing durable in it. */
async function classifyBatch(lines: string[], onFile: string[]): Promise<Fact[] | null> {
  const paths = taxonomyPaths();
  const system =
    'You curate the permanent memory of Warden (an assistant) and its user, built from activity-log lines.\n\n' +
    'Taxonomy paths (use EXACTLY one, verbatim, deepest that fits):\n' +
    paths.join('\n') + '\n\n' +
    'A line can be transient activity yet reveal a durable fact — file what the activity reveals about the user and their world (accounts, calendars, people, projects, preferences, environment), never the activity itself.\n' +
    'A project or system earns durable facts — what it is, how it works, how it is wired, where it lives — never a progress narrative (attempts, iterations, pending, failed, edited, generated, screenshots).\n' +
    'Warden editing itself is normal: file what its components ARE, never the dev session that did the editing.\n' +
    'Pure status with nothing behind it (builds, restarts, timings, retries) is skipped. Doubt = skip. Prefer a shallow correct path over a deep wrong one.\n' +
    'Never restate or paraphrase a fact already on file — skip it even if a new log line repeats it. New, distinct facts about the same topic are fine.\n' +
    'Facts about the user are the most valuable. A work or system fact never goes under a personal path.\n' +
    'Max ' + MAX_FACTS_PER_BATCH + ' facts, one short sentence each, each stated once — never two facts conveying the same thing.\n\n' +
    'Reply with facts only — the output schema is enforced.';
  // Structured outputs: the taxonomy paths are an ENUM in the schema, so the
  // model cannot emit a path that isn't verbatim taxonomy — enforcement at
  // decode time, not validation after the fact.
  const schema = {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', enum: paths },
            fact: { type: 'string' },
          },
          required: ['path', 'fact'],
        },
      },
    },
    required: ['facts'],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MTREE_MODEL,
        stream: false,
        format: schema,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content:
              (onFile.length ? 'Already on file (do not restate):\n' + onFile.join('\n') + '\n\n' : '') +
              'Log lines:\n' + lines.join('\n'),
          },
        ],
        // num_ctx 32768: a full batch (200 truncated lines + the ~190-path
        // taxonomy prompt) needs headroom; this is a fresh load of the 30b
        // for the dump period, not a tweak to a resident instance.
        options: { temperature: 0, num_ctx: 32768 },
        keep_alive: 600,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const cleaned = cleanModelOutput(data.message?.content || '');
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    const obj = JSON.parse(cleaned.slice(s, e + 1)) as { facts?: Array<{ path?: string; fact?: string }> };
    const valid = new Set(paths.map((p) => p.toLowerCase()));
    const out: Fact[] = [];
    for (const f of Array.isArray(obj.facts) ? obj.facts : []) {
      const p = String(f?.path || '').trim();
      const fact = String(f?.fact || '').trim().slice(0, 300);
      if (!p || !fact || !valid.has(p.toLowerCase())) continue; // unknown path — drop
      out.push({ path: p, fact });
      if (out.length >= MAX_FACTS_PER_BATCH) break;
    }
    return curateFacts(out);
  } catch (err) {
    logger.warn({ err }, 'memory-tree: classify batch failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ClassifyResult { ok: boolean; reason?: string; batches: number; facts: number }

/** Classify the whole unprocessed warden.log backlog into the memory tree.
 *  The backlog is snapshotted at run start (log size at that moment) and the
 *  run loops batches until that snapshot is fully classified — new log lines
 *  written meanwhile are the next run's backlog, so the target is always
 *  finite and the run always finishes. Cursor persisted per batch.
 *  The idle gate is just that: a big model loaded means the machine is in
 *  use — the run stays off. Only the on-request run (the user fired it)
 *  auto-dumps big models (keep_alive 0) first. Aborts mid-run if the
 *  machine is claimed again. */
export async function runMemoryClassification(force = false): Promise<ClassifyResult> {
  if (running) return { ok: false, reason: 'already running', batches: 0, facts: 0 };
  if (!fs.existsSync(LOG_PATH)) return { ok: false, reason: 'no log file', batches: 0, facts: 0 };
  // Snapshot: classify exactly what existed when the run began.
  const target = fs.statSync(LOG_PATH).size;
  let cursor0 = Number(getRouterState(CURSOR_KEY) || 0);
  if (target < cursor0) cursor0 = 0; // rotated/truncated
  if (target <= cursor0) return { ok: false, reason: 'no backlog', batches: 0, facts: 0 };
  if (!force) {
    // Idle-gated: a big model loaded means the machine is in use — stay off.
    const busy = await bigModelsLoaded();
    if (busy.length) return { ok: false, reason: 'gpu busy: ' + busy.join(','), batches: 0, facts: 0 };
  } else {
    // On-request (the user fired the scan): auto-dump whatever's squatting —
    // best-effort, the run itself fails gracefully if the 30b can't load.
    await dumpBigModels();
  }
  running = true;
  let batches = 0;
  let facts = 0;
  let aborted: string | undefined;
  let topicSent = false;
  logger.info({ model: MTREE_MODEL, backlog: target - cursor0 }, 'memory-tree: classification run starting (dump period)');
  try {
    let cursor = cursor0;
    for (;;) {
      const batch = readBatch(cursor, target);
      if (!batch) break; // snapshot fully classified — run finished
      if (batch.lines.length === 0) {
        // Only blank lines in this window — advance past them, nothing to classify.
        setRouterState(CURSOR_KEY, String(batch.nextCursor));
        cursor = batch.nextCursor;
        continue;
      }
      const found = await classifyBatch(
        batch.lines,
        loadFiledFacts().slice(-FILED_PROMPT_MAX).map((r) => r.p + ': ' + r.f),
      );
      if (found == null) {
        aborted = 'model failed mid-run — resumes next dump period';
        break;
      }
      if (found.length) {
        // Drop skipped paths, near-identical repeats, and paraphrase
        // restatements — of facts already on file and of each other.
        const sigs = loadFactSigs();
        const onFile = loadFiledFacts();
        const fresh: Fact[] = [];
        for (const f of found) {
          if (SKIP_PATHS.has(f.path)) continue;
          if (sigs.has(factSig(f.path, f.fact))) continue;
          // Path-agnostic: the same text under two paths is the same fact
          // (the ---WARDEN_STATUS--- fact filed under Build & Deploy AND
          // Agent Runner) — the taxonomy offers many homes for one truth.
          if (onFile.some((r) => sameFact(r.f, f.fact))) continue;
          if (fresh.some((r) => sameFact(r.fact, f.fact))) continue;
          fresh.push(f);
        }
        if (fresh.length) {
          // First write of the run opens the topic; the rest ride the same session.
          const entries = [
            ...(topicSent ? [] : ['Topic: memory tree']),
            ...fresh.map((f) => `memory tree — ${f.path}: ${f.fact}`),
          ];
          topicSent = true;
          const ok = await marmLogEntries(entries);
          if (!ok) {
            aborted = 'MARM failed mid-run — resumes next dump period';
            break;
          }
          facts += fresh.length;
          recordTreeFacts(fresh);
          rememberFactSigs(fresh.map((f) => factSig(f.path, f.fact)));
          rememberFiledFacts(fresh.map((f) => ({ p: f.path, f: f.fact })));
          fresh.forEach((f) => noteTreeActivity({ kind: 'write', path: f.path, fact: f.fact }));
        }
      }
      batches++;
      cursor = batch.nextCursor;
      setRouterState(CURSOR_KEY, String(cursor));
      // The machine is needed again — a big model (not ours) got loaded.
      const busy = await bigModelsLoaded();
      if (busy.length) {
        aborted = 'gpu claimed by ' + busy.join(',');
        break;
      }
    }
  } finally {
    running = false;
  }
  logger.info({ batches, facts, aborted }, 'memory-tree: classification run finished');
  return { ok: !aborted, reason: aborted, batches, facts };
}

/** Idle-gated autostart from the message poll loop: when no agent run is in
 *  flight, the GPU is free, and there's a backlog, kick a classification
 *  run (which itself loops until the backlog is finished). Cheap — the
 *  backlog check is synchronous and the /api/ps probe is throttled to one
 *  per IDLE_CHECK_MS. */
export function maybeClassifyMemoryTree(agentBusy: boolean): void {
  if (agentBusy || running) return;
  if (Date.now() - lastIdleCheck < IDLE_CHECK_MS) return;
  lastIdleCheck = Date.now();
  void runMemoryClassification(false).catch((err) => logger.warn({ err }, 'memory-tree: idle run failed'));
}