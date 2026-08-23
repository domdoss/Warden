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

const COOLDOWN_MS = 15 * 60 * 1000; // max one writeback per chat per 15 min
const MIN_NEW_MESSAGES = 25; // wait for a real run of conversation before distilling
const TRANSCRIPT_LIMIT = 30; // messages fed to the distiller
const MEMORY_COMPACT_THRESHOLD = 16_000; // chars — compact MEMORY.md beyond this
const MEMORY_COMPACT_TARGET = 8_000;
const JOURNAL_COMPACT_THRESHOLD = 20_000; // chars — compact JOURNAL.md beyond this
const JOURNAL_COMPACT_TARGET = 8_000;
const JOURNAL_HARD_CAP_ENTRIES = 120;   // fallback ceiling: never keep more than this many session entries
const REQUEST_TIMEOUT_MS = 120_000;
// Last-resort default — a model that exists on the Pi's ollama. Normally
// overridden by WARDEN_MEMORY_MODEL env or the dashboard's mercury/orchestrator
// model (see resolveMemoryModel).
const FALLBACK_MODEL = 'glm-5.2:cloud';

const lastWriteback: Record<string, { ts: number; lastMessageTs: string }> = {};

/**
 * Resolve the distill model. Priority: WARDEN_MEMORY_MODEL env (explicit
 * override) → dashboard `mercury:model` → dashboard `orchestrator:model`
 * (same convention Mercury's compaction uses) → FALLBACK_MODEL. This must
 * resolve to a model the ollama endpoint actually serves — the Pi has no
 * local models, only `:cloud` ones, so a bare `gemma4:latest` default would
 * 404 and writeback would silently no-op.
 */
function resolveMemoryModel(): string {
  const env = process.env.WARDEN_MEMORY_MODEL;
  if (env) return env.replace(/^local:/, '');
  const fromDashboard = (getRouterState('mercury:model') || getRouterState('orchestrator:model') || '')
    .replace(/^local:/, '')
    .trim();
  if (fromDashboard) return fromDashboard;
  return FALLBACK_MODEL;
}

// Memory writeback has its own model + ctx rows in Settings (mercury:model /
// local:mercury_ctx). A bare /api/chat with no num_ctx/keep_alive loads a
// SECOND copy of the model at Ollama's native 2048 ctx / 300s default, which
// can evict an instance the user keeps resident. Until a per-agent Mercury ctx
// is saved it inherits the shared toolcall ctx so effective behavior is
// unchanged; keep_alive still follows the toolcall setting.
function resolveMemoryCtx(): number | undefined {
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

async function ollamaChat(system: string, user: string, model: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Granite (the toolcall/Mercury model) needs temperature 0 for reliable,
    // deterministic structured output — same as the runner's sub-agent defs.
    const options: Record<string, unknown> = { temperature: 0 };
    const numCtx = resolveMemoryCtx();
    if (numCtx) options.num_ctx = numCtx;
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

/** Strip <think> blocks and code fences a local model may wrap output in. */
function cleanModelOutput(raw: string): string {
  let out = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = out.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) out = fence[1].trim();
  return out;
}

interface Distilled {
  memory: string[];
  journal: string;
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
  const compacted = await ollamaChat(
    'You compact an agent memory file. Merge duplicates, drop stale/ephemeral items, keep all durable facts about people, preferences, decisions, and standing instructions. Preserve the markdown structure (# Memory, ## People, ## Notes). Output ONLY the new file content.',
    `Compact this memory file to under ${MEMORY_COMPACT_TARGET} characters:\n\n${content}`,
    model,
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

  const compacted = await ollamaChat(
    'You compact a session journal. Keep the most recent session entries VERBATIM with their ### date headers and one-line summaries. Condense everything older into a "## Earlier sessions" bullet list: one short line per session (date + gist). Preserve markdown. Output ONLY the new file content, starting with "# Journal".',
    `Compact this journal to under ${JOURNAL_COMPACT_TARGET} characters:\n\n${content}`,
    model,
  );
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

  // Fallback: model failed to shrink safely — hard-cap to the most recent
  // entries so the journal can never become a multi-megabyte mess.
  const entries = content.split(/\n(?=### )/).filter((e) => e.trim());
  const kept = entries.slice(-JOURNAL_HARD_CAP_ENTRIES).join('\n').trim();
  if (kept && kept.length < content.length) {
    fs.writeFileSync(journalPath + '.bak', content, 'utf-8');
    fs.writeFileSync(journalPath, '# Journal\n' + kept + '\n', 'utf-8');
    logger.info(
      { journalPath, from: content.length, to: kept.length, entries: entries.length, kept: JOURNAL_HARD_CAP_ENTRIES },
      'JOURNAL.md hard-capped (model compaction rejected)',
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

    const model = resolveMemoryModel();
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
    );
    if (!raw) return;
    const distilled = parseDistilled(raw);
    if (!distilled) return;

    const today = new Date().toISOString().slice(0, 10);
    if (distilled.memory.length > 0) {
      const block = `\n### ${today}\n${distilled.memory.map((m) => `- ${m}`).join('\n')}\n`;
      fs.appendFileSync(memoryPath, block, 'utf-8');
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
