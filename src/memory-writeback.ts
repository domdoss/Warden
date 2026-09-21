/**
 * End-of-session memory writeback.
 *
 * After a chat turn completes, distill durable facts from the recent
 * conversation with a local model and append them to MEMORY.md, plus a dated
 * entry in JOURNAL.md. Replaces the never-wired context-compressor/agent-
 * session-store scaffolding with something small that actually runs.
 *
 * MEMORY.md and JOURNAL.md live at WORKSPACE_ROOT — the same place the
 * orchestrator loads them from every turn (host memoryContext + agent-runner
 * journalSection) and the same place Mercury writes MERCURY_MEMORY.md. So the
 * distilled facts are visible to the agent on the very next turn. (An earlier
 * version wrote to groups/<folder>/, which the agent never reads — that was a
 * silent no-op.)
 *
 * Design constraints:
 * - Fire-and-forget: never blocks or fails the message loop.
 * - Throttled: per-chat cooldown so a busy session doesn't hammer the model.
 * - Bounded: MEMORY.md is auto-compacted by the same model when oversized.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WORKSPACE_ROOT, OLLAMA_URL } from './config.js';
import { getChatHistory, getRouterState } from './db.js';
import { pushAgentStatus } from './agent-spawn.js';
import { logger } from './logger.js';
// Circular with memory-tree.ts (it imports marmLogEntries from here) — safe:
// both sides only call the other's exports at runtime, and noteTreeActivity
// is a hoisted function declaration.
import { noteTreeActivity } from './memory-tree.js';

const COOLDOWN_MS = 15 * 60 * 1000; // max one writeback per chat per 15 min
const MIN_NEW_MESSAGES = 25; // wait for a real run of conversation before distilling
const TRANSCRIPT_LIMIT = 30; // messages fed to the distiller
const MEMORY_COMPACT_THRESHOLD = 16_000; // chars — compact MEMORY.md beyond this
const MEMORY_COMPACT_TARGET = 8_000;
const JOURNAL_COMPACT_THRESHOLD = 20_000; // chars — compact JOURNAL.md beyond this
const JOURNAL_COMPACT_TARGET = 8_000;
const JOURNAL_HARD_CAP_ENTRIES = 120;   // fallback ceiling: never keep more than this many session entries
const REQUEST_TIMEOUT_MS = 120_000;

const lastWriteback: Record<string, { ts: number; lastMessageTs: string }> = {};

/**
 * Resolve the distill model. The dashboard Settings rows are the ONLY source
 * of model selection — no env override, no hardcoded fallback. Falls back from
 * the Mercury row to the Orchestrator row (both are user-set settings), and if
 * both are blank writeback no-ops rather than silently distilling on a model
 * the user never chose.
 */
function resolveMemoryModel(): string {
  return (getRouterState('mercury:model') || getRouterState('orchestrator:model') || '')
    .replace(/^local:/, '')
    .trim();
}

/**
 * Don't evict a resident model to distill memory. Writeback is background
 * housekeeping, but its model (the toolcall fine-tune) is not the one in VRAM,
 * so asking for it makes Ollama unload the 17 GB orchestrator/atlas model —
 * and the next user turn pays an ~85s cold reload. Measured 2026-09-18 13:16:
 * atlas finishes a song, writeback pulls the small model in, granite is gone.
 * When the configured model is not already loaded and the orchestrator's IS,
 * distill on the resident one instead. Same work, no eviction. Settings are
 * untouched — this only picks which of the user's own models answers now.
 */
async function residentOrConfiguredModel(wanted: string): Promise<string> {
  const orch = (getRouterState('orchestrator:model') || '').replace(/^local:/, '').trim();
  if (!orch || orch === wanted) return wanted;
  if (/cloud/i.test(wanted) || /cloud/i.test(orch)) return wanted; // cloud holds no VRAM
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return wanted;
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const loaded = (data.models || []).map((m) => (m.name || m.model || '').trim()).filter(Boolean);
    if (loaded.length === 0) return wanted;
    const has = (n: string) => loaded.some((l) => l === n || l.replace(/:latest$/, '') === n.replace(/:latest$/, ''));
    if (has(wanted)) return wanted;
    if (has(orch)) {
      logger.info({ wanted, using: orch }, 'Memory writeback: configured model not resident — distilling on the loaded model instead of evicting it');
      return orch;
    }
    return wanted;
  } catch {
    return wanted;
  }
}

// Memory writeback has its own model + ctx rows in Settings (mercury:model /
// local:mercury_ctx). A bare /api/chat with no num_ctx/keep_alive loads a
// SECOND copy of the model at Ollama's native 2048 ctx / 300s default, which
// can evict an instance the user keeps resident. Until a per-agent Mercury ctx
// is saved it inherits the shared toolcall ctx so effective behavior is
// unchanged; keep_alive still follows the toolcall setting.
//
// The ctx belongs to the SEAT, so it may only be sent when this seat's own
// model is the one being called. residentOrConfiguredModel() can answer on a
// different model that happens to be loaded, and Ollama keys a runner by
// (weights + context window) — sending Mercury's window with someone else's
// weights spawns a SECOND runner of that model beside the resident one, the
// exact VRAM churn the swap exists to prevent. On a swap, send no num_ctx and
// let Ollama reuse the runner that is already up. No model is named here: the
// seat's model and ctx are both dashboard settings.
function resolveMemoryCtx(model?: string): number | undefined {
  const configured = (getRouterState('mercury:model') || getRouterState('local:subagent_model') || '')
    .replace(/^local:/, '').trim();
  const called = (model || '').replace(/^local:/, '').trim();
  const sameSeat = (a: string, b: string) => a.replace(/:latest$/, '') === b.replace(/:latest$/, '');
  if (called && configured && !sameSeat(called, configured)) return undefined; // swapped off this seat
  const raw = (getRouterState('local:mercury_ctx') || getRouterState('local:subagent_ctx') || '').trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function resolveMemoryKeepAlive(): number {
  const raw = (getRouterState('local:toolcall_keep_alive') || '').trim();
  if (raw === '-1') return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 300;
}

async function ollamaChat(system: string, user: string, model: string, maxTokens?: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Granite (the toolcall/Mercury model) needs temperature 0 for reliable,
    // deterministic structured output — same as the runner's sub-agent defs.
    const options: Record<string, unknown> = { temperature: 0 };
    const numCtx = resolveMemoryCtx(model);
    if (numCtx) options.num_ctx = numCtx;
    // ALWAYS cap the generation. Without num_predict a small model that loses
    // the thread never stops: llama.cpp context-shifts (n_keep=4, discard half)
    // and generates until the 120s abort — 2026-09-18 10:57, a journal
    // compaction burned GPU0 at 95% for the full two minutes and emitted 10k
    // tokens of nothing, then fell through to the deterministic path anyway.
    // Every call here has a known output size, so bound it: the reply is
    // rejected on truncation, which costs seconds instead of minutes.
    if (maxTokens && maxTokens > 0) options.num_predict = maxTokens;
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options,
        keep_alive: resolveMemoryKeepAlive(),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Rough token estimate for an English/markdown blob (~4 chars per token). */
function estTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Can this model actually rewrite `contentChars` down to `targetChars` in one
 *  pass? A rewrite has to hold the whole input AND emit the whole output inside
 *  one context window. When it doesn't fit, the model cannot succeed — it
 *  context-shifts and babbles until the timeout — so the caller skips it and
 *  uses its deterministic fallback instead of burning the GPU to fail. */
function compactionFits(contentChars: number, targetChars: number, model?: string): boolean {
  const ctx = resolveMemoryCtx(model);
  if (!ctx) return true; // no ctx row: Ollama's own default applies, leave the call alone
  const needed = estTokens(contentChars) + estTokens(targetChars) + 512; // +512 prompt/format overhead
  return needed < ctx;
}

/** Strip <think> blocks and code fences a local model may wrap output in. */
export function cleanModelOutput(raw: string): string {
  let out = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = out.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) out = fence[1].trim();
  return out;
}

interface Distilled {
  memory: string[];
  journal: string;
}

// ---------------------------------------------------------------------------
// MARM mirror (http://github.com/Lyellr88/marm-memory)
//
// Every fact the distiller appends to MEMORY.md is also logged into the MARM
// memory server (hybrid BM25+semantic recall + concept graph) so the
// orchestrator can retrieve it later via the marm_smart_recall MCP tool.
// MARM speaks MCP streamable-HTTP on loopback:8001 — one initialize, one
// tools/call. The whole mirror is fire-and-forget with a short timeout: if
// MARM is down or slow, writeback is completely unaffected. Only the first
// failure per process is logged so a stopped MARM doesn't spam the log.
// ---------------------------------------------------------------------------
const MARM_URL = process.env.MARM_URL || 'http://127.0.0.1:8001/mcp';
const MARM_TIMEOUT_MS = 10_000;
let marmWarned = false;

async function marmRpc(sessionId: string | undefined, body: Record<string, unknown>): Promise<Record<string, any> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MARM_TIMEOUT_MS);
  try {
    const res = await fetch(MARM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const newSession = res.headers.get('mcp-session-id');
    if (newSession) marmSessionId = newSession;
    const ctype = res.headers.get('content-type') || '';
    let text = await res.text();
    if (ctype.includes('text/event-stream')) {
      // SSE framing: take the first data: line holding a JSON-RPC object
      const line = text.split('\n').find((l) => l.startsWith('data:'));
      text = line ? line.slice(5).trim() : '';
    }
    const start = text.indexOf('{');
    if (start === -1) return null;
    return JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
  } finally {
    clearTimeout(timer);
  }
}

let marmSessionId: string | undefined;

// Returns true when every entry was logged, false when MARM was unreachable
// or a call failed (the memory-tree classifier aborts its run on false so the
// batch is retried at the next dump period instead of silently skipped).
export async function marmLogEntries(facts: string[]): Promise<boolean> {
  if (facts.length === 0) return true;
  try {
    const init = await marmRpc(undefined, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'warden-memory-writeback', version: '1.0.0' },
      },
    });
    if (!init) throw new Error('initialize failed (MARM not running?)');
    await marmRpc(marmSessionId, { jsonrpc: '2.0', method: 'notifications/initialized' });
    for (const fact of facts) {
      const r = await marmRpc(marmSessionId, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'marm_log_entry', arguments: { entry: fact } },
      });
      if (!r || !r.result) throw new Error('marm_log_entry returned no result');
    }
    if (marmWarned) marmWarned = false;
    return true;
  } catch (err) {
    if (!marmWarned) {
      marmWarned = true;
      logger.warn({ err, facts: facts.length }, 'MARM mirror failed (MARM down? writeback unaffected)');
    }
    return false;
  }
}

/** One MCP tools/call against MARM, parsed. Initialize reuses the cached
 *  session, the courtesy notification, then the call. Returns the tool's
 *  JSON payload — MARM prepends banner blocks to the content array on first
 *  calls, so take the newest block that parses. Null on any failure. */
export async function marmToolCall(name: string, args: Record<string, unknown>): Promise<Record<string, any> | null> {
  try {
    const init = await marmRpc(undefined, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'warden-memory-writeback', version: '1.0.0' },
      },
    });
    if (!init) throw new Error('initialize failed (MARM not running?)');
    await marmRpc(marmSessionId, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const r = await marmRpc(marmSessionId, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (!r || !r.result) return null;
    const blocks = ((r.result as Record<string, any>).content || [])
      .map((c: any) => c && c.text).filter(Boolean);
    for (let i = blocks.length - 1; i >= 0; i--) {
      try { return JSON.parse(blocks[i]); } catch { /* banner block — keep going */ }
    }
    return null;
  } catch (err) {
    if (!marmWarned) {
      marmWarned = true;
      logger.warn({ err, tool: name }, 'MARM tool call failed (MARM down?)');
    }
    return null;
  }
}

function parseDistilled(raw: string): Distilled | null {
  try {
    const cleaned = cleanModelOutput(raw);
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    const memory = Array.isArray(obj.memory)
      ? obj.memory.filter((m: unknown) => typeof m === 'string' && (m as string).trim().length > 0).slice(0, 5)
      : [];
    const journal = typeof obj.journal === 'string' ? obj.journal.trim() : '';
    if (memory.length === 0 && !journal) return null;
    return { memory, journal };
  } catch {
    return null;
  }
}

async function compactMemoryFile(memoryPath: string, model: string): Promise<void> {
  const content = fs.readFileSync(memoryPath, 'utf-8');
  if (content.length <= MEMORY_COMPACT_THRESHOLD) return;
  if (!compactionFits(content.length, MEMORY_COMPACT_TARGET, model)) {
    // No safe fallback here (memory is curated durable facts — never trim it
    // blind), so leave the file alone and say why.
    logger.info(
      { memoryPath, chars: content.length, model, ctx: resolveMemoryCtx(model) },
      'MEMORY.md compaction skipped — file does not fit the memory model context',
    );
    return;
  }
  const compacted = await ollamaChat(
    'You compact an agent memory file. Merge duplicates, drop stale/ephemeral items, keep all durable facts about people, preferences, decisions, and standing instructions. Preserve the markdown structure (# Memory, ## People, ## Notes). Output ONLY the new file content.',
    `Compact this memory file to under ${MEMORY_COMPACT_TARGET} characters:\n\n${content}`,
    model,
    estTokens(MEMORY_COMPACT_TARGET) + 256,
  );
  const cleaned = compacted ? cleanModelOutput(compacted) : '';
  // Only accept a sane result — never destroy memory on a bad model reply.
  if (cleaned.startsWith('# ') && cleaned.length > 200 && cleaned.length < content.length) {
    fs.writeFileSync(memoryPath + '.bak', content, 'utf-8');
    fs.writeFileSync(memoryPath, cleaned + '\n', 'utf-8');
    logger.info({ memoryPath, from: content.length, to: cleaned.length }, 'Compacted MEMORY.md');
  }
}

/** Compact JOURNAL.md. Unlike memory (curated durable facts), the journal is a
 *  growing append-only log of one-line session summaries. Beyond the threshold,
 *  ask the model to keep the most recent entries verbatim and condense older
 *  ones into a short "Earlier sessions" list. If the model reply is unusable,
 *  hard-cap to the most recent N entries — so the journal can never grow
 *  unbounded regardless of model quality. */
async function compactJournalFile(journalPath: string, model: string): Promise<void> {
  const content = fs.readFileSync(journalPath, 'utf-8');
  if (content.length <= JOURNAL_COMPACT_THRESHOLD) return;

  const headers = content.match(/^### .*$/gm) || [];
  const lastHeader = headers[headers.length - 1] || '';

  // Only ask the model when a full rewrite can actually fit its window. A
  // 20k-char journal against an 8k-ctx Mercury model cannot, and the attempt
  // is pure loss: two minutes of GPU, then this same deterministic trim.
  const compacted = compactionFits(content.length, JOURNAL_COMPACT_TARGET, model)
    ? await ollamaChat(
        'You compact a session journal. Keep the most recent session entries VERBATIM with their ### date headers and one-line summaries. Condense everything older into a "## Earlier sessions" bullet list: one short line per session (date + gist). Preserve markdown. Output ONLY the new file content, starting with "# Journal".',
        `Compact this journal to under ${JOURNAL_COMPACT_TARGET} characters:\n\n${content}`,
        model,
        estTokens(JOURNAL_COMPACT_TARGET) + 256,
      )
    : null;
  const cleaned = compacted ? cleanModelOutput(compacted) : '';
  if (
    cleaned.startsWith('# ') &&
    cleaned.length > 200 &&
    cleaned.length < content.length &&
    (!lastHeader || cleaned.includes(lastHeader))
  ) {
    fs.writeFileSync(journalPath + '.bak', content, 'utf-8');
    fs.writeFileSync(journalPath, cleaned + '\n', 'utf-8');
    logger.info({ journalPath, from: content.length, to: cleaned.length }, 'Compacted JOURNAL.md');
    return;
  }

  // Fallback: no model pass, or it failed to shrink safely — keep the most
  // recent entries that fit the TARGET (not just an entry count). Trimming to
  // the count alone left the file just under the threshold, so the next
  // writeback crossed it again and re-ran the whole thing; trimming to the
  // target gives real headroom. The entry ceiling still applies on top, so the
  // journal can never become a multi-megabyte mess.
  const entries = content.split(/\n(?=### )/).filter((e) => e.trim());
  const recent = entries.slice(-JOURNAL_HARD_CAP_ENTRIES);
  const fitted: string[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    used += recent[i].length + 1;
    if (used > JOURNAL_COMPACT_TARGET && fitted.length > 0) break;
    fitted.unshift(recent[i]);
  }
  const kept = fitted.join('\n').trim();
  if (kept && kept.length < content.length) {
    fs.writeFileSync(journalPath + '.bak', content, 'utf-8');
    fs.writeFileSync(journalPath, '# Journal\n' + kept + '\n', 'utf-8');
    logger.info(
      { journalPath, from: content.length, to: kept.length, entries: entries.length, kept: fitted.length, modelPass: !!compacted },
      'JOURNAL.md trimmed to the most recent entries',
    );
  }
}

/**
 * Distill the recent conversation into MEMORY.md / JOURNAL.md appends.
 * Call after a successful chat turn; safe to fire-and-forget. Writes to
 * WORKSPACE_ROOT so the orchestrator sees the new facts next turn.
 */
export async function runMemoryWriteback(chatJid: string): Promise<void> {
  try {
    const history = getChatHistory(chatJid, TRANSCRIPT_LIMIT);
    if (history.length === 0) return;

    const newest = history[history.length - 1].timestamp;
    const prev = lastWriteback[chatJid];
    // Distill only what's NEW since the last writeback (or the whole window on
    // the first run). Re-reading the full 30-message window every turn re-logs
    // old durable facts each time — a growing run-on duplicate. New-only keeps
    // each fact distilled once.
    let toDistill = history;
    if (prev) {
      if (Date.now() - prev.ts < COOLDOWN_MS) return;
      toDistill = history.filter((m) => m.timestamp > prev.lastMessageTs);
      if (toDistill.length < MIN_NEW_MESSAGES) return;
    }
    // Claim the slot up-front so concurrent calls for the same chat bail out.
    lastWriteback[chatJid] = { ts: Date.now(), lastMessageTs: newest };

    const configured = resolveMemoryModel();
    if (!configured) return; // no Mercury/Orchestrator model set in Settings — never fall back to a hardcoded model
    const model = await residentOrConfiguredModel(configured);
    const memoryPath = path.join(WORKSPACE_ROOT, 'MEMORY.md');
    const journalPath = path.join(WORKSPACE_ROOT, 'JOURNAL.md');
    const existingMemory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';

    // Only the USER's own messages. Conversational remembrances come from what
    // the user says; email summaries, task reports, and tool output all live in
    // assistant messages, so filtering to user-only structurally keeps emails and
    // other channel noise out of Mercury memory. (Mercury is for conversational
    // remembrances — never emails.)
    const transcript = toDistill
      .filter((m) => !m.is_bot_message)
      .map((m) => `User: ${m.content.slice(0, 1500)}`)
      .join('\n');
    if (!transcript.trim()) return;

    // Surface Mercury on the Agents panel: green "distilling…" while the
    // ollama call runs, then the result line once written. Non-spawned process,
    // so it publishes via pushAgentStatus instead of the runAgent progress path.
    pushAgentStatus('mercury', 'distilling conversation → memory…', 1);

    const raw = await ollamaChat(
      `Role: You are Mercury, the long-term memory distiller for a personal AI assistant.

Task: From the user's own messages below, extract DURABLE facts an assistant would still want to know months from now.

Guidelines:
- Keep only permanent facts the user personally stated: tastes, preferences, habits, people and relationships, permanent setup or identity facts, standing instructions, long-term goals and decisions.
- Select at most 3 facts. Quality over quantity. Return an empty array if the user said nothing durable.
- Skip any fact already present in the existing memory file.
- Keep each fact to one short line.

Format: Reply with ONLY this JSON object, no prose:
{"memory": ["short fact", ...], "journal": "one sentence: what this session was about"}`,
      `Existing memory file:\n${existingMemory.slice(0, 6000)}\n\nUser messages this session:\n${transcript.slice(0, 12000)}`,
      model,
      // The answer is a small JSON object (≤3 one-line facts + one sentence).
      // Anything past this is the model having lost the format, not content.
      512,
    );
    if (!raw) return;
    const distilled = parseDistilled(raw);
    if (!distilled) return;

    const today = new Date().toISOString().slice(0, 10);
    if (distilled.memory.length > 0) {
      const block = `\n### ${today}\n${distilled.memory.map((m) => `- ${m}`).join('\n')}\n`;
      fs.appendFileSync(memoryPath, block, 'utf-8');
      // Galaxy brain-scan feed: distiller writes carry no taxonomy path, so
      // they ride as query-text events the galaxy keyword-maps onto regions.
      distilled.memory.forEach((m) => noteTreeActivity({ kind: 'write', query: m }));
    }
    if (distilled.journal) {
      fs.appendFileSync(journalPath, `\n### ${today} — ${chatJid}\n${distilled.journal}\n`, 'utf-8');
    }
    if (distilled.memory.length > 0 || distilled.journal) {
      logger.info(
        { chatJid, facts: distilled.memory.length, journal: !!distilled.journal },
        'Memory writeback complete',
      );
      pushAgentStatus(
        'mercury',
        distilled.memory.length > 0
          ? `distilled ${distilled.memory.length} fact(s) → MEMORY.md`
          : 'updated JOURNAL.md',
        0,
      );
    }

    if (fs.existsSync(memoryPath)) {
      await compactMemoryFile(memoryPath, model);
    }
    if (fs.existsSync(journalPath)) {
      await compactJournalFile(journalPath, model);
    }
  } catch (err) {
    logger.warn({ chatJid, err }, 'Memory writeback failed (non-fatal)');
  }
}
