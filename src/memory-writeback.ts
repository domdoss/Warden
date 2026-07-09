/**
 * End-of-session memory writeback.
 *
 * After a chat session completes, distill durable facts from the recent
 * conversation with a local model and append them to the group's MEMORY.md,
 * plus a dated entry in JOURNAL.md. Replaces the never-wired
 * context-compressor/agent-session-store scaffolding with something small
 * that actually runs.
 *
 * Design constraints:
 * - Fire-and-forget: never blocks or fails the message loop.
 * - Throttled: per-group cooldown so busy chats don't hammer the model.
 * - Bounded: MEMORY.md is auto-compacted by the same model when oversized.
 */
import * as fs from 'fs';
import * as path from 'path';
import { GROUPS_DIR, OLLAMA_URL } from './config.js';
import { getChatHistory } from './db.js';
import { logger } from './logger.js';
import { resolveGroupFolderPath } from './group-folder.js';

const MEMORY_MODEL = process.env.PROMETHEUS_MEMORY_MODEL || 'gemma4:latest';
const COOLDOWN_MS = 15 * 60 * 1000; // max one writeback per group per 15 min
const MIN_NEW_MESSAGES = 4; // skip trivial exchanges
const TRANSCRIPT_LIMIT = 30; // messages fed to the distiller
const MEMORY_COMPACT_THRESHOLD = 16_000; // chars — compact MEMORY.md beyond this
const MEMORY_COMPACT_TARGET = 8_000;
const REQUEST_TIMEOUT_MS = 120_000;

const lastWriteback: Record<string, { ts: number; lastMessageTs: string }> = {};

async function ollamaChat(system: string, user: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MEMORY_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: { temperature: 0.2 },
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
      ? obj.memory.filter((m: unknown) => typeof m === 'string' && (m as string).trim().length > 0).slice(0, 8)
      : [];
    const journal = typeof obj.journal === 'string' ? obj.journal.trim() : '';
    if (memory.length === 0 && !journal) return null;
    return { memory, journal };
  } catch {
    return null;
  }
}

async function compactMemoryFile(memoryPath: string): Promise<void> {
  const content = fs.readFileSync(memoryPath, 'utf-8');
  if (content.length <= MEMORY_COMPACT_THRESHOLD) return;
  const compacted = await ollamaChat(
    'You compact an agent memory file. Merge duplicates, drop stale/ephemeral items, keep all durable facts about people, preferences, decisions, and standing instructions. Preserve the markdown structure (# Memory, ## People, ## Notes). Output ONLY the new file content.',
    `Compact this memory file to under ${MEMORY_COMPACT_TARGET} characters:\n\n${content}`,
  );
  const cleaned = compacted ? cleanModelOutput(compacted) : '';
  // Only accept a sane result — never destroy memory on a bad model reply.
  if (cleaned.startsWith('# ') && cleaned.length > 200 && cleaned.length < content.length) {
    fs.writeFileSync(memoryPath + '.bak', content, 'utf-8');
    fs.writeFileSync(memoryPath, cleaned + '\n', 'utf-8');
    logger.info({ memoryPath, from: content.length, to: cleaned.length }, 'Compacted MEMORY.md');
  }
}

/**
 * Distill the recent conversation into MEMORY.md / JOURNAL.md appends.
 * Call after a successful chat session; safe to fire-and-forget.
 */
export async function runMemoryWriteback(groupFolder: string, chatJid: string): Promise<void> {
  try {
    const history = getChatHistory(chatJid, TRANSCRIPT_LIMIT);
    if (history.length === 0) return;

    const newest = history[history.length - 1].timestamp;
    const prev = lastWriteback[groupFolder];
    if (prev) {
      if (Date.now() - prev.ts < COOLDOWN_MS) return;
      const newCount = history.filter((m) => m.timestamp > prev.lastMessageTs).length;
      if (newCount < MIN_NEW_MESSAGES) return;
    }
    // Claim the slot up-front so concurrent calls for the same group bail out.
    lastWriteback[groupFolder] = { ts: Date.now(), lastMessageTs: newest };

    const groupDir = resolveGroupFolderPath(groupFolder);
    const memoryPath = path.join(groupDir, 'MEMORY.md');
    const journalPath = path.join(groupDir, 'JOURNAL.md');
    const existingMemory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';

    const transcript = history
      .map((m) => `${m.is_bot_message ? 'Assistant' : m.sender_name}: ${m.content.slice(0, 1500)}`)
      .join('\n');

    const raw = await ollamaChat(
      `You distill chat sessions into durable agent memory. Reply with ONLY a JSON object:
{"memory": ["fact 1", ...], "journal": "1-3 sentence session summary"}
Rules for "memory": only durable facts worth remembering across sessions (user preferences, decisions, project state, standing instructions, names/relationships). NO ephemeral task chatter. NO facts already present in the existing memory file. Empty array if nothing qualifies.`,
      `Existing memory file:\n${existingMemory.slice(0, 6000)}\n\nSession transcript:\n${transcript.slice(0, 12000)}`,
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
        { groupFolder, facts: distilled.memory.length, journal: !!distilled.journal },
        'Memory writeback complete',
      );
    }

    if (fs.existsSync(memoryPath)) {
      await compactMemoryFile(memoryPath);
    }
  } catch (err) {
    logger.warn({ groupFolder, err }, 'Memory writeback failed (non-fatal)');
  }
}
