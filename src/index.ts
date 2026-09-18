import fs from 'fs';
import http from 'node:http';
import path from 'path';
import { spawn, execSync } from 'node:child_process';

import {
  AGENT_TIMEOUT,
  ASSISTANT_NAME,
  DATA_DIR,
  OLLAMA_URL,
  POLL_INTERVAL,
  TIMEZONE,
  WORKSPACE_ROOT,
} from './config.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import { runAgent, killCurrentAgent, cancelCurrentTurn, CallbackMap, runSubAgentBackground, setActivityPublisher, isForegroundTurnActive, STOP_COMMAND_RE, isStopWord } from './agent-spawn.js';
import { maybeClassifyMemoryTree } from './memory-tree.js';
import {
  createTask,
  getAllTasks,
  updateTask,
  deleteTask,
  getEmailAccounts,
  getOAuthAccount,
  getChatHistory,
  getMessagesForDashboard,
  getMessagesSince,
  getNewMessages,
  getRecentInboundMessages,
  initDatabase,
  storeMessage,
  setRouterState,
  getRouterState,
  createProject,
  getProjectsByGroup,
  getProject,
  updateProject,
  archiveProject,
  completeProject,
  deleteProject,
  resolveProjectId,
  seedPersonalProject,
  PERSONAL_PROJECT_ID,
  addProjectDeliverable,
  toggleDeliverable,
  deleteDeliverable,
  addProjectBlocker,
  deleteBlocker,
  addProjectPriority,
  deleteProjectPriority,
  getProjectFinancials,
  updateProjectFinancials,
  getWorkTasks,
  createWorkTask,
  updateWorkTask,
  deleteWorkTask,
  getActiveAgentTasks,
  getAgentTask,
  getAgentTaskBacklog,
  getAgentTaskBacklogSize,
  appendAgentTaskHistory,
  claimNextAgentTask,
  finishAgentTask,
  getUserApiKeys,
  getActiveUserApiKeyByType,
  getAllUserApiKeys,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  getCalendarEventByIcalUid,
  listCalendarEvents,
  getFiredCalendarReminderIds,
  markCalendarReminderFired,
  getTaskById,
  logSentryScan,
  createAlarm,
  getUserAlarms,
  updateAlarm,
  deleteAlarm as deleteAlarmDb,
} from './db.js';
import { decryptApiKey } from './encryption.js';
import { fetchEmails, sendEmail, getEmailById, downloadEmailAttachment } from './email.js';
import { addMcpServer, removeMcpServer, McpServerConfig } from './mcp-registry.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { formatLocalTime } from './timezone.js';
import { CronExpressionParser } from 'cron-parser';
import { computeNextRun, buildDeterministicDigest, startSchedulerLoop } from './task-scheduler.js';
import { runMemoryWriteback } from './memory-writeback.js';
import { startCalendarSyncPoller } from './calendar-sync.js';
import { startStatusServer, pushNotification, pushActivityLine, getCachedInboxEmails } from './status-server.js';
import { startLogCap } from './log-rotator.js';
import { Channel, NewMessage, OWNER_JID, AgentInput, ScheduledTask } from './types.js';
import { logger } from './logger.js';
import { captureScreenshot, captureWebcam, readHostImage } from './capture.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

// ---------------------------------------------------------------------------
// BROWSER-AUTOMATION GUIDANCE (permanent instruction for the Warden agent)
// ---------------------------------------------------------------------------
// For any browser, media, screenshot, YouTube, or other web-content task,
// ALWAYS drive the already-running Chrome browser via Playwright, which is
// connected to the user's real Chrome profile on CDP port 9222
// (127.0.0.1:9222 — sessions, cookies, and sign-ins are all intact).
// Do NOT fall back to direct desktop automation tools such as xdotool or
// wtype for these tasks: they frequently fail on this host due to input
// group mismatch or timeout issues under the Wayland/KDE session.
// Preferred entry points are the Playwright MCP tools (browser_navigate,
// browser_click, browser_type, browser_snapshot, browser_take_screenshot,
// browser_evaluate, etc.). If a Playwright action fails, retry with an
// alternative Playwright approach (keyboard shortcut, browser_eval click,
// direct URL) rather than switching to xdotool/wtype.
// ---------------------------------------------------------------------------

/**
 * Single-chat orchestrator (Warden).
 *
 * All inbound messages from every channel land in the `messages` table with
 * `chat_jid = OWNER_JID`. The message loop polls that single chat, builds an
 * AgentInput, and calls runAgent() (./agent-spawn.ts). The agent's text reply
 * is stored as a bot message and forwarded to every connected channel.
 *
 * Group registration, container spawning, IPC watchers, and multi-user routing
 * are gone. Task 8 will wire runAgent's callback handler for send_message /
 * schedule_task / read_emails / send_email; until then, the agent's only
 * side-effect is its text output.
 */

let lastTimestamp = '';
let lastAgentTimestamp = '';
let messageLoopRunning = false;
export let agentProcessing = false;

const channels: Channel[] = [];

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  lastAgentTimestamp = getRouterState('last_agent_timestamp') || '';

  // If the agent cursor ever lags behind the channel cursor (e.g., a failed
  // run rolled it back while the channel cursor stayed advanced), reconcile
  // them on startup so we don't re-process messages the channel already saw.
  if (lastTimestamp && lastAgentTimestamp && lastTimestamp > lastAgentTimestamp) {
    logger.info({ lastTimestamp, lastAgentTimestamp }, 'Reconciling lagging agent cursor on startup');
    lastAgentTimestamp = lastTimestamp;
  }

  // Reset any stale processing state from a previous crash/restart.
  setRouterState('agent:processing', 'false');
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', lastAgentTimestamp);
}

const MERCURY_MEMORY_FILE = 'MERCURY_MEMORY.md';
const MERCURY_RECENT_MESSAGES = 12;
const MERCURY_CONTEXT_TURNS = 8;

// Mercury's I/O contract. Mercury shares the toolcall fine-tune with iris, so
// the task is shaped the way Granite is strongest and the way that model is
// already trained: STRUCTURED IN, STRUCTURED OUT. State goes in as JSON, the
// merged state comes back as JSON, and `format` (below) constrains decoding on
// the local path. Prose summarization was the old shape and was off
// distribution for a tool-call fine-tune — it kept emitting JSON anyway.
//
// This prompt is the CANONICAL source: training/gen_mercury_sft.mjs extracts
// it verbatim from this file, exactly as the iris rows extract theirs from the
// agent-runner, so the fine-tune can never drift from what production sends.
// Editing it here changes the next dataset. Keep the marker comments intact —
// extraction anchors on them.
// MERCURY_SYSTEM_PROMPT_START
const MERCURY_SYSTEM_PROMPT = `You are Mercury: rolling conversation memory for Warden.

CONTRACT: one compaction request → one JSON object. You merge the state you are given with new turns and return the merged state.

INPUT
- STATE: the memory you already hold, as JSON. It is empty on the first compaction.
- TURNS: the user's own messages that have scrolled out of the live window, oldest first. These are the user's own words. The assistant's replies are not shown to you.

FIELDS
- facts: durable statements about the user or the project — including how the user wants work done (their standing preferences and constraints). Never describe what the assistant is or does.
- decisions: choices that were made, each with the reason when the turns give one — including the user's standing instructions about how work should be done.
- open: questions still unanswered and tasks still outstanding.
- refs: file paths, URLs, and ids worth keeping.

GUIDELINES
- TURNS are the user's own words. Record what the user said, wants, or decided — never what the assistant is or does.
- A user's standing instruction or preference is the highest-value thing to keep: when a turn shows the user telling the assistant HOW to work, record it as a fact or decision and carry it even after the task that prompted it is done. Losing one of these is exactly what makes the user repeat themselves.
- Carry every STATE item forward unless a turn supersedes it or resolves it.
- Add what the TURNS establish, placing each item in the field that fits it.
- Merge two items that say the same thing into one. Replace a superseded item with its current version.
- Drop an open item once a turn answers it, and record the answer as a fact or a decision.
- Compress the oldest material hardest: keep its conclusion, shed its detail.
- Write each item as one standalone sentence that reads correctly on its own, with no pronouns pointing outside it.
- Keep 40 items or fewer across all four fields.

FORMAT
Output one JSON object only.
{"facts": [], "decisions": [], "open": [], "refs": []}`;
// MERCURY_SYSTEM_PROMPT_END

// Ollama `format` schema — the single biggest lever for holding a 3B to valid
// structured output. Local path only; a cloud seat ignores it and relies on
// the FORMAT block above plus the parser's tolerance.
const MERCURY_FORMAT = {
  type: 'object',
  properties: {
    facts: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    open: { type: 'array', items: { type: 'string' } },
    refs: { type: 'array', items: { type: 'string' } },
  },
  required: ['facts', 'decisions', 'open', 'refs'],
};

interface MercuryState { facts: string[]; decisions: string[]; open: string[]; refs: string[] }
const MERCURY_FIELDS: (keyof MercuryState)[] = ['facts', 'decisions', 'open', 'refs'];
const EMPTY_MERCURY_STATE: MercuryState = { facts: [], decisions: [], open: [], refs: [] };

/** Coerce whatever the model returned into a MercuryState, dropping junk. */
function parseMercuryState(raw: string): MercuryState | null {
  if (!raw?.trim()) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: any;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const out: MercuryState = { facts: [], decisions: [], open: [], refs: [] };
  for (const f of MERCURY_FIELDS) {
    const v = obj[f];
    if (!Array.isArray(v)) continue;
    out[f] = v.map((x: any) => String(x ?? '').trim()).filter(Boolean);
  }
  return MERCURY_FIELDS.some((f) => out[f].length > 0) ? out : null;
}

/** Render state as the text pinned into every prompt as <mercury_summary>. */
function renderMercuryState(s: MercuryState): string {
  const section = (title: string, items: string[]) =>
    items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}` : '';
  return [
    section('Facts', s.facts),
    section('Decisions', s.decisions),
    section('Open', s.open),
    section('References', s.refs),
  ].filter(Boolean).join('\n\n');
}

function mercuryMode(): 'off' | 'rag' | 'summary' | 'full' {
  const m = (getRouterState('mercury:mode') || 'full').toLowerCase();
  if (m === 'off' || m === 'rag' || m === 'summary') return m;
  return 'full';
}

function loadMercurySummary(clearAt = ''): string | undefined {
  try {
    const root = WORKSPACE_ROOT.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
    const text = fs.readFileSync(path.join(root, MERCURY_MEMORY_FILE), 'utf-8').trim();
    if (!text) return undefined;
    // A context clear (New Thought / driving-force switch / idle auto-clear /
    // clear_context tool) sets orchestrator:context_clear_at. The summary file
    // carries its own write timestamp on its first line; if it predates the
    // clear boundary, ignore it — otherwise pre-clear topics (e.g. an old
    // TaskPoints scope draft) keep bleeding into the fresh conversation even
    // though <chat_history> is correctly empty post-clear.
    if (clearAt) {
      const m = text.match(/^#\s*Mercury summary updated\s+(\S+)/i);
      const stamp = m?.[1] ?? '';
      if (stamp && stamp <= clearAt) return undefined;
    }
    return text;
  } catch { return undefined; }
}

const STOPWORDS = new Set([
  'the','and','for','are','but','not','you','all','any','can','her','was','one','our','out','his','has','have','had','how','its','may','new','now','old','see','two','way','who','did','get','got','him','she','too','use','that','this','with','from','they','will','would','there','their','what','about','which','when','were','them','then','than','some','into','only','over','such','your','just','also','like','want','need','make','made','please','could','should','been','being','does','done','here','each','very','more','most','much','many','after','before','where','while','these','those','because','between','something','anything','thing','things','give','know','let','lets','tell','show','okay','yes','no','hey','hello','thanks','thank','going','doing','really','good','bad','yes','no',
]);

function tokenizeMercury(text: string): string[] {
  return (text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Lightweight RAG over conversation history: retrieve older turns relevant to the current user message(s). */
function mercuryRetrieveRelevant(newMessages: NewMessage[], topK = MERCURY_CONTEXT_TURNS, clearAt = ''): NewMessage[] {
  const query = newMessages
    .filter((m) => !m.is_bot_message)
    .map((m) => m.content || '')
    .join(' ');
  const keywords = tokenizeMercury(query);
  if (keywords.length === 0) return [];

  // Search a deeper window of older messages, excluding the recent verbatim window.
  const deepHistory = getChatHistory(OWNER_JID, 120) as unknown as NewMessage[];
  // Gate by the clear boundary so a context clear also empties Mercury RAG —
  // otherwise pre-clear turns resurface here even though <chat_history> is
  // correctly empty post-clear (this was the "worse than overfilling" leak:
  // the model answered stale topics pulled in only via Mercury).
  const gated = clearAt ? deepHistory.filter((m) => (m.timestamp || '') > clearAt) : deepHistory;
  const candidates = gated.slice(0, -MERCURY_RECENT_MESSAGES);
  if (candidates.length === 0) return [];

  // Evidence floor: a longer query collides with old turns on single keywords
  // by chance (the "5 concrete examples" ask matched a day-old eyes_ears
  // thread purely on the word "concrete" and the model replayed it as current).
  // Require ≥2 DISTINCT keyword matches once the query carries 3+ keywords;
  // shorter queries keep the ≥1 floor so single-topic recalls still work.
  const minMatches = keywords.length >= 3 ? 2 : 1;

  const scored = candidates.map((m, i) => {
    const words = tokenizeMercury(m.content || '');
    const lower = (m.content || '').toLowerCase();
    let score = 0;
    let matched = 0;
    for (const kw of keywords) {
      const whole = words.includes(kw);
      if (whole) matched += 1;
      if (whole) score += 1;
      if (lower.includes(kw)) score += 0.5;
    }
    // Recency prior: a position bonus (0 = oldest candidate, 1 = newest) breaks
    // score ties toward recent turns. Without it the stable sort + topK slice
    // favored the OLDEST equally-scoring messages — exactly how stale threads
    // crowded out fresh ones. The bonus can lift a tie but never outrank a
    // genuinely stronger keyword match.
    const recency = candidates.length > 1 ? i / (candidates.length - 1) : 1;
    return { m, score, matched, rank: score + recency };
  });
  scored.sort((a, b) => b.rank - a.rank);
  return scored
    .filter((s) => s.matched >= minMatches)
    .slice(0, topK)
    .map((s) => s.m)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Build the XML prompt for the agent: Mercury rolling summary + RAG-retrieved
 * older context + recent chat history + the new actionable messages from the owner.
 */
function buildPrompt(newMessages: NewMessage[]): string {
  let prompt = '';

  const mode = mercuryMode();
  // Resolved once, up front, so both the Mercury summary/RAG injection and the
  // <chat_history> gate share the same clear boundary this turn.
  const clearAt = getRouterState('orchestrator:context_clear_at') || '';

  // Mercury rolling memory — compacted context from older conversation turns.
  if (mode === 'summary' || mode === 'full') {
    const mercury = loadMercurySummary(clearAt);
    if (mercury) {
      prompt += `<mercury_summary>\n${mercury.replace(/^#\s*Mercury summary updated\s+\S+\s*\n/, '')}\n</mercury_summary>\n\n`;
    }
  }

  // Mercury RAG: pull older conversation snippets relevant to the current ask.
  if (mode === 'rag' || mode === 'full') {
    const relevant = mercuryRetrieveRelevant(newMessages, MERCURY_CONTEXT_TURNS, clearAt);
    if (relevant.length > 0) {
      const lines = relevant.map((m) => {
        const role = m.is_bot_message ? ASSISTANT_NAME : (m.sender_name || 'User');
        const time = formatLocalTime(m.timestamp, TIMEZONE);
        return `<message sender="${role}" time="${time}" history="relevant">${m.content}</message>`;
      });
      // The `time` on each line is the anti-hijack: keyword matches can surface
      // day-old turns, and without a visible timestamp the model cannot tell a
      // stale thread from the current one (it once answered a fresh question by
      // replaying a day-old exchange retrieved this way). The note states the
      // hierarchy: these are background, never a substitute for the ask.
      prompt += `<mercury_context count="${relevant.length}" note="older turns keyword-matched to this ask — background only; check each timestamp; the current ask and recent chat history always take priority">\n${lines.join('\n')}\n</mercury_context>\n\n`;
    }
  }

  // Get recent conversation context including bot replies (not just user messages).
  // getMessagesForDashboard returns both sides of the conversation.
  const pendingIds = new Set(newMessages.map((m) => m.id));
  // Fetch last N+2 messages (both sides) and exclude the current pending ones to
  // get up to N turns of real back-and-forth context. A driving-force switch (or
  // any explicit context clear) drops history before the clear marker so a new
  // persona starts clean instead of inheriting the old conversation; the pending
  // cursor (last_agent_timestamp) is advanced separately on the clear.
  const allHistory = getChatHistory(OWNER_JID, MERCURY_RECENT_MESSAGES + 2) as unknown as NewMessage[];
  const rawHistory = clearAt
    ? allHistory.filter((m) => (m.timestamp || '') > clearAt)
    : allHistory;
  const contextMessages = rawHistory
    .filter((m) => !pendingIds.has(m.id))
    .slice(-MERCURY_RECENT_MESSAGES);

  if (contextMessages.length > 0) {
    const MAX_HISTORY_CHARS = 12000;
    let histChars = 0;
    const trimmed: NewMessage[] = [];
    for (let i = contextMessages.length - 1; i >= 0; i--) {
      const m = contextMessages[i]!;
      const len = (m.content || '').length;
      if (histChars + len > MAX_HISTORY_CHARS && trimmed.length > 0) break;
      trimmed.unshift(m);
      histChars += len;
    }
    const histLines = trimmed.map((m) => {
      const role = m.is_bot_message ? ASSISTANT_NAME : (m.sender_name || 'User');
      const time = formatLocalTime(m.timestamp, TIMEZONE);
      return `<message sender="${role}" time="${time}" history="true">${m.content}</message>`;
    });
    prompt += `<chat_history count="${trimmed.length}">\n${histLines.join('\n')}\n</chat_history>\n\n`;
  }
  prompt += formatMessages(newMessages, TIMEZONE);
  return prompt;
}

/** Strip internal/thinking blocks + sanitize true internal /tmp paths from agent output. */
function cleanAgentText(raw: string): string {
  return raw
    .replace(/<internal>[\s\S]*?<\/internal>/g, '')
    // Strip known internal build/IPC paths completely
    .replace(/\/tmp\/dist\//g, '')
    .replace(/\/tmp\/input\.json/g, 'input')
    .replace(/\/tmp\/warden-ipc\/[^\s)'"`,]*/g, '')
    .replace(/\/tmp\/agent-runner[^\s)'"`,]*/g, '')
    // For other /tmp paths: strip the directory prefix but keep the basename so
    // filenames remain readable in responses (e.g. /tmp/foo/bar/file.txt → file.txt).
    // This avoids leaking internal workspace paths while keeping names like "file1.txt"
    // visible when the agent reports results.
    .replace(/\/tmp\/[^\s)'"`,]*\/([^\/\s)'"`,]+)/g, '$1')
    // Any remaining bare /tmp paths with no subdirectory
    .replace(/\/tmp\/[a-zA-Z0-9._-]+(?=[^\w/]|$)/g, '[tmp]')
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]\s*/g, '')
    .replace(/<(?:think|reasoning)>[\s\S]*?<\/(?:think|reasoning)>\s*/g, '')
    .replace(/<\/?(?:think|reasoning)>\s*/g, '')
    .replace(/\[\/thinking\]\s*/g, '')
    .trim();
}

/** Forward the bot's reply to every connected channel + persist to DB. */
async function deliverReply(text: string): Promise<void> {
  const messageId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storeMessage({
    id: messageId,
    chat_jid: OWNER_JID,
    sender: 'assistant:local',
    sender_name: ASSISTANT_NAME,
    content: text,
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
  });
  await Promise.allSettled(
    channels.map((ch) =>
      ch.sendMessage(OWNER_JID, text).catch((err) =>
        logger.warn({ channel: ch.name, err }, 'Failed to deliver reply to channel'),
      ),
    ),
  );
}

/**
 * Local calendar reminder loop. Fires one automated chat message per event at
 * (or just after) its start_time, regardless of Google sync. Idempotent via the
 * calendar_reminders table — survives restarts, fires exactly once per event.
 */
function startCalendarReminderLoop(): void {
  const TICK_MS = 30_000;
  // Look back 2h on each tick so a restart (or a service down period) doesn't
  // silently swallow a reminder whose start_time already passed.
  const LOOKBACK_MS = 2 * 60 * 60 * 1000;

  const tick = () => {
    try {
      const fired = getFiredCalendarReminderIds();
      const now = Date.now();
      const events = listCalendarEvents();
      for (const e of events) {
        if (fired.has(e.id) || !e.start_time) continue;
        const startMs = new Date(e.start_time).getTime();
        if (Number.isNaN(startMs)) continue;
        if (startMs <= now && startMs >= now - LOOKBACK_MS) {
          const loc = e.location ? ` @ ${e.location}` : '';
          const desc = e.description ? `\n${e.description}` : '';
          const text = `⏰ Calendar: "${e.title}" starts now (${e.start_time})${loc}${desc}`;
          deliverReply(text).catch((err) =>
            logger.warn({ err, eventId: e.id }, 'calendar reminder delivery failed'),
          );
          markCalendarReminderFired(e.id);
          logger.info({ eventId: e.id, title: e.title, start_time: e.start_time }, 'calendar reminder fired');
        }
      }
    } catch (err) {
      logger.warn({ err }, 'calendar reminder tick failed');
    }
    setTimeout(tick, TICK_MS);
  };

  tick();
  logger.info('calendar reminder loop started');
}

/**
 * Build the parent-side callback map the agent-runner can invoke when the
 * agent calls one of the side-effecting tools (send_message, schedule_task,
 * read_emails, send_email, install_mcp_server, uninstall_mcp_server,
 * create_skill). Each handler runs in the Warden parent process and has
 * access to the DB, channels, and filesystem.
 *
 * Handlers return `{ ok: true, ... }` on success or `{ ok: false, error }`
 * on failure. The agent-runner parser surfaces the error to the agent.
 */
export function buildAgentCallbacks(): CallbackMap {
  return {
    send_message: async (args: any) => {
      try {
        const text = typeof args?.text === 'string' ? args.text : '';
        const senderName = typeof args?.sender === 'string' && args.sender.trim() ? args.sender.trim() : ASSISTANT_NAME;

        // `type: 'notification'` is intermediate agent narration during tool
        // calls — drop it. Only the final writeOutput response should appear
        // in the chat history.
        if (args?.type === 'notification') {
          return { ok: true, skipped: true };
        }

        let finalText = text;
        if (!finalText.trim()) return { ok: false, error: 'missing text' };
        const messageId = `bot-cb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        storeMessage({
          id: messageId,
          chat_jid: OWNER_JID,
          sender: 'assistant:local',
          sender_name: senderName,
          content: finalText,
          timestamp: new Date().toISOString(),
          is_from_me: false,
          is_bot_message: true,
        });

        const targetChannel = typeof args?.channel === 'string'
          ? channels.find((c) => c.name === args.channel)
          : undefined;
        const targets = targetChannel ? [targetChannel] : channels;
        logger.info({ sender: senderName, channels: targets.map((c) => c.name), messageId }, 'send_message callback: delivering to channels');
        await Promise.allSettled(
          targets.map((ch) =>
            ch.sendMessage(OWNER_JID, finalText).then(
              () => logger.info({ channel: ch.name, messageId }, 'send_message callback: channel delivered'),
              (err) => logger.warn({ channel: ch.name, err }, 'send_message callback: channel send failed'),
            ),
          ),
        );

        // Push a chat_complete notification so the voice client can speak the
        // reply. The orchestrator's own runAgent reply also emits one, so a
        // direct orchestrator reply may double-speak if the agent also calls
        // send_message. The voice client deduplicates by content to handle this.
        pushNotification('owner', { type: 'chat_complete', message: finalText, from: OWNER_JID });
        return { ok: true, messageId };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    schedule_task: async (args: any) => {
      try {
        const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
        if (!prompt) return { ok: false, error: 'missing prompt' };
        const scheduleType = args?.schedule_type === 'cron' || args?.schedule_type === 'interval' || args?.schedule_type === 'once'
          ? args.schedule_type
          : 'once';
        const scheduleValue = typeof args?.schedule_value === 'string' ? args.schedule_value : '';
        if (!scheduleValue && scheduleType !== 'once') {
          return { ok: false, error: 'missing schedule_value' };
        }
        const contextMode = args?.context_mode === 'group' || args?.context_mode === 'isolated'
          ? args.context_mode
          : 'isolated';
        const taskId = `task-cb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        const task: ScheduledTask = {
          id: taskId,
          chat_jid: OWNER_JID,
          prompt,
          schedule_type: scheduleType,
          schedule_value: scheduleValue,
          context_mode: contextMode,
          next_run: null,
          last_run: null,
          last_result: null,
          status: 'active',
          created_at: now,
        };
        task.next_run = computeNextRun(task);
        if (!task.next_run) {
          return { ok: false, error: `could not compute a fire time from schedule_value "${scheduleValue}". For a relative once task use an ISO-8601 duration (e.g. "PT2M", "PT1H30M"); for an absolute time use a LOCAL timestamp "YYYY-MM-DDTHH:MM:SS" (no Z suffix).` };
        }
        createTask(task);
        logger.info({ taskId, scheduleType, scheduleValue }, 'schedule_task callback: task created');
        return { ok: true, taskId };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    list_tasks: async () => {
      try {
        const tasks = getAllTasks();
        return { ok: true, tasks };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    cancel_task: async (args: any) => {
      try {
        const id = typeof args?.task_id === 'string' ? args.task_id : '';
        if (!id) return { ok: false, error: 'missing task_id' };
        deleteTask(id);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    pause_task: async (args: any) => {
      try {
        const id = typeof args?.task_id === 'string' ? args.task_id : '';
        if (!id) return { ok: false, error: 'missing task_id' };
        updateTask(id, { status: 'paused' });
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    resume_task: async (args: any) => {
      try {
        const id = typeof args?.task_id === 'string' ? args.task_id : '';
        if (!id) return { ok: false, error: 'missing task_id' };
        updateTask(id, { status: 'active' });
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    update_task: async (args: any) => {
      try {
        const id = typeof args?.task_id === 'string' ? args.task_id : '';
        if (!id) return { ok: false, error: 'missing task_id' };
        const updates: any = {};
        if (args?.prompt) updates.prompt = args.prompt;
        if (args?.schedule_type) updates.schedule_type = args.schedule_type;
        if (args?.schedule_value) updates.schedule_value = args.schedule_value;
        updateTask(id, updates);

        // If the schedule changed, recompute next_run so the task actually
        // fires at the new time. Without this, editing schedule_value left the
        // old next_run in place and the reschedule silently didn't take. Skip
        // for once tasks that already ran (last_run set → computeNextRun
        // correctly returns null, meaning "done"); and skip when only the
        // prompt was edited (no timing change).
        const scheduleChanged = !!(args?.schedule_type || args?.schedule_value);
        if (scheduleChanged) {
          const current = getTaskById(id);
          if (current && current.status === 'active' && !current.last_run) {
            const nextRun = computeNextRun(current);
            if (!nextRun) {
              return {
                ok: false,
                error: `could not compute a fire time from schedule_value "${current.schedule_value}". For a relative once task use an ISO-8601 duration (e.g. "PT2M", "PT1H30M"); for an absolute time use a LOCAL timestamp "YYYY-MM-DDTHH:MM:SS" (no Z suffix).`,
              };
            }
            updateTask(id, { next_run: nextRun });
          }
        }
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    read_emails: async (args: any) => {
      try {
        const folder = typeof args?.folder === 'string' ? args.folder : 'INBOX';
        const limit = typeof args?.limit === 'number' ? Math.min(args.limit, 500) : 500;
        // `search` is a provider text query (Gmail q= / MS $search). `since` and
        // `before` are ISO 8601 timestamps for date-range filtering, which the
        // providers do NOT support via the search param — so we filter those
        // client-side after fetching. Keep them distinct from `search` so a
        // date range doesn't get fed to the provider as a text query.
        const search = typeof args?.search === 'string' && args.search ? args.search : undefined;
        const sinceMs = args?.since ? new Date(args.since).getTime() : NaN;
        const beforeMs = args?.before ? new Date(args.before).getTime() : NaN;
        const previewOnly = args?.preview_only === true;
        // The agent doesn't supply an accountId. Aggregate EVERY enabled
        // account — the first-success-wins loop read only the newest-linked
        // account's mailbox (getEmailAccounts orders created_at DESC), so the
        // digest and iris never saw mail from the other accounts at all.
        // A dangling oauth_account_id (oauth_accounts row deleted but the
        // email_accounts row still references it) is skipped per-account, not
        // allowed to abort the rest.
        const accounts = getEmailAccounts(null).filter((a) => a.enabled);
        if (accounts.length === 0) {
          return { ok: false, error: 'no enabled email account' };
        }
        const errors: string[] = [];
        const merged: any[] = [];
        let anyAccountServed = false;
        for (const account of accounts) {
          if (account.oauth_account_id && !getOAuthAccount(account.oauth_account_id)) {
            errors.push(`${account.email}: linked OAuth account was deleted, skipping`);
            continue;
          }
          try {
            // Prefer the warm INBOX cache (refreshed every ~5 min by
            // startInboxCacheWarmer). The agent usually wants "recent mail
            // since X" — the cached recent batch covers that and avoids a live
            // fetch of up to `limit` messages one-by-one from the provider
            // (Gmail does sequential per-message GETs → tens of seconds for
            // limit 500). Serve the cache without a length check: the agent's
            // limit is an upper bound, not a minimum, and the date filter
            // narrows the cached set.
            let emails: any[];
            const cached = getCachedInboxEmails(account.id, folder);
            if (cached) {
              emails = cached.emails;
            } else {
              emails = await fetchEmails(account.id, folder, limit, search, previewOnly);
            }
            anyAccountServed = true;
            // Client-side date-range filter — fetchEmails' 4th param is a text
            // search, not a date filter, so the providers can't do this.
            const filtered = (Number.isNaN(sinceMs) && Number.isNaN(beforeMs))
              ? emails
              : emails.filter((e: any) => {
                  if (!e.date) return false;
                  const t = new Date(e.date).getTime();
                  if (Number.isNaN(t)) return false;
                  if (!Number.isNaN(sinceMs) && t < sinceMs) return false;
                  if (!Number.isNaN(beforeMs) && t >= beforeMs) return false;
                  return true;
                });
            merged.push(...filtered);
          } catch (err: any) {
            errors.push(`${account.email}: ${String(err?.message ?? err)}`);
          }
        }
        if (!anyAccountServed && errors.length > 0) {
          return { ok: false, error: `all email accounts failed — ${errors.join('; ')}` };
        }
        // Newest first across all mailboxes, capped at the caller's limit.
        merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return {
          ok: true,
          emails: merged.slice(0, limit),
          ...(errors.length > 0 ? { account_errors: errors } : {}),
        };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    send_email: async (args: any) => {
      try {
        const to = typeof args?.to === 'string' ? args.to : '';
        const subject = typeof args?.subject === 'string' ? args.subject : '';
        const body = typeof args?.body === 'string' ? args.body : '';
        if (!to || !subject || !body) {
          return { ok: false, error: 'missing to/subject/body' };
        }
        const accounts = getEmailAccounts(null);
        const account = accounts.find((a) => a.enabled && !a.read_only);
        if (!account) {
          // TODO: wire to actual email function once a writable account is configured.
          return { ok: false, error: 'no enabled read-write email account' };
        }
        const result = await sendEmail(account.id, to, subject, body);
        if (!result.success) return { ok: false, error: result.error ?? 'send failed' };
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Read a single email's full body by id. The agent's read_emails tool now
    // passes each email's `id` through, and the runner's get_email tool calls
    // this with { emailId }. No accountId is supplied, so try each enabled
    // account and return the first that has a message with that id.
    get_email: async (args: any) => {
      try {
        const emailId = args?.emailId ?? args?.email_id;
        if (typeof emailId !== 'string' || !emailId) {
          return { ok: false, error: 'missing emailId' };
        }
        const accounts = getEmailAccounts(null).filter((a) => a.enabled);
        if (accounts.length === 0) {
          return { ok: false, error: 'no enabled email account' };
        }
        const errors: string[] = [];
        for (const account of accounts) {
          if (account.oauth_account_id && !getOAuthAccount(account.oauth_account_id)) {
            continue;
          }
          try {
            const email = await getEmailById(account.id, emailId);
            if (email) return { ok: true, email };
          } catch (err: any) {
            errors.push(`${account.email}: ${String(err?.message ?? err)}`);
          }
        }
        return { ok: false, error: `email not found — ${errors.join('; ')}` };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Download one attachment from an email and save it under the workspace
    // (data/email-attachments/) so other agents can Read it. Accepts the
    // attachment's id or just its filename. Without this, "email me the PDF"
    // routed to atlas, which scraped Gmail's DOM in the browser.
    download_email_attachment: async (args: any) => {
      try {
        const emailId = args?.emailId ?? args?.email_id;
        if (typeof emailId !== 'string' || !emailId) {
          return { ok: false, error: 'missing emailId' };
        }
        const attachmentId = typeof args?.attachmentId === 'string' ? args.attachmentId : undefined;
        const filename = typeof args?.filename === 'string' ? args.filename : undefined;
        if (!attachmentId && !filename) {
          return { ok: false, error: 'missing attachmentId or filename' };
        }
        const accounts = getEmailAccounts(null).filter((a) => a.enabled);
        if (accounts.length === 0) {
          return { ok: false, error: 'no enabled email account' };
        }
        const errors: string[] = [];
        for (const account of accounts) {
          if (account.oauth_account_id && !getOAuthAccount(account.oauth_account_id)) {
            continue;
          }
          try {
            const att = await downloadEmailAttachment(account.id, emailId, attachmentId, filename);
            if (!att) continue;
            // Sanitize the filename: strip directories and shell-unfriendly
            // characters so a hostile filename can't escape the target dir.
            const safeName = att.filename.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '_');
            const root = WORKSPACE_ROOT.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
            const dir = path.join(root, 'data', 'email-attachments');
            fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, `${emailId}_${safeName}`);
            fs.writeFileSync(filePath, att.data);
            return { ok: true, path: filePath, filename: att.filename, size: att.data.length };
          } catch (err: any) {
            errors.push(`${account.email}: ${String(err?.message ?? err)}`);
          }
        }
        return { ok: false, error: `attachment not downloaded — ${errors.join('; ')}` };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // ─── Calendar (local DB calendar_events table; OAuth-synced + agent-created) ──
    list_calendar_events: async (args: any) => {
      try {
        const dbEvents = listCalendarEvents({ start: args?.start, end: args?.end });
        const events = dbEvents.map((e) => ({
          title: e.title,
          start: e.start_time,
          start_time: e.start_time,
          end: e.end_time,
          end_time: e.end_time,
          all_day: e.all_day === 1,
          location: e.location || '',
          description: e.description || '',
          calendar_source: e.calendar_source || 'google',
          uid: e.ical_uid || e.id,
          event_id: e.ical_uid || e.id,
        }));
        return { ok: true, events };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    create_calendar_event: async (args: any) => {
      try {
        const title = typeof args?.title === 'string' ? args.title : '';
        const start = typeof args?.start_time === 'string' ? args.start_time : '';
        if (!title || !start) return { ok: false, error: 'missing title/start_time' };
        const icalUid = args?.event_id || `jarvis-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ev = createCalendarEvent({
          title,
          description: args?.description,
          start_time: start,
          end_time: args?.end_time,
          all_day: args?.all_day === true,
          location: args?.location,
          calendar_source: 'local',
          ical_uid: icalUid,
        });
        return { ok: true, eventId: ev.id, uid: icalUid };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    update_calendar_event: async (args: any) => {
      try {
        const id = typeof args?.event_id === 'string' ? args.event_id : '';
        if (!id) return { ok: false, error: 'missing event_id' };
        const existing = getCalendarEvent(id)
          ?? (args?.uid ? getCalendarEvent(args.uid) : undefined)
          ?? getCalendarEventByIcalUid(id);
        if (!existing) return { ok: false, error: 'event not found' };
        const updates: Partial<typeof existing> = {};
        if (typeof args?.title === 'string') updates.title = args.title;
        if (typeof args?.description === 'string') updates.description = args.description;
        if (typeof args?.start_time === 'string') updates.start_time = args.start_time;
        if (args?.end_time !== undefined) updates.end_time = args.end_time;
        if (typeof args?.all_day === 'boolean') updates.all_day = args.all_day ? 1 : 0;
        if (typeof args?.location === 'string') updates.location = args.location;
        const ev = updateCalendarEvent(existing.id, updates);
        if (!ev) return { ok: false, error: 'event not found' };
        return { ok: true, eventId: ev.id, uid: ev.ical_uid || ev.id };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_calendar_event: async (args: any) => {
      try {
        const id = typeof args?.event_id === 'string' ? args.event_id : '';
        if (!id) return { ok: false, error: 'missing event_id' };
        const existing = getCalendarEvent(id) ?? getCalendarEventByIcalUid(id);
        if (!existing) return { ok: false, error: 'event not found' };
        return deleteCalendarEvent(existing.id) ? { ok: true } : { ok: false, error: 'event not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },

    // ─── Project management (wired to db.ts) ────────────────────────────────
    list_projects: async (_args: any) => {
      try {
        const projects = getProjectsByGroup(OWNER_JID);
        return { ok: true, data: projects };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    create_project: async (args: any) => {
      try {
        const name = typeof args?.name === 'string' ? args.name : '';
        if (!name) return { ok: false, error: 'missing name' };
        const project = createProject({
          name,
          group_jid: OWNER_JID,
          description: typeof args?.description === 'string' ? args.description : '',
          due_date: typeof args?.dueDate === 'string' ? args.dueDate : undefined,
          project_code: typeof args?.projectCode === 'string' ? args.projectCode : undefined,
        });
        return { ok: true, project };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    get_project: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
        const project = getProject(resolved);
        if (!project) return { ok: false, error: 'project not found' };
        return { ok: true, data: project };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    update_project: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
        const updates: any = {};
        if (typeof args?.name === 'string') updates.name = args.name;
        if (typeof args?.description === 'string') updates.description = args.description;
        if (typeof args?.status === 'string') updates.status = args.status;
        if (typeof args?.dueDate === 'string') updates.due_date = args.dueDate;
        if (typeof args?.projectCode === 'string') updates.project_code = args.projectCode;
        const project = updateProject(resolved, updates);
        if (!project) return { ok: false, error: 'project not found' };
        return { ok: true, data: project };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    archive_project: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
        if (resolved === PERSONAL_PROJECT_ID) return { ok: false, error: 'Personal project cannot be archived' };
        const ok = archiveProject(resolved);
        return ok ? { ok: true } : { ok: false, error: 'project not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    complete_project: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
        if (resolved === PERSONAL_PROJECT_ID) return { ok: false, error: 'Personal project cannot be completed' };
        const ok = completeProject(resolved);
        return ok ? { ok: true } : { ok: false, error: 'project not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_project: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
        if (resolved === PERSONAL_PROJECT_ID) return { ok: false, error: 'Personal project cannot be deleted' };
        const ok = deleteProject(resolved);
        return ok ? { ok: true } : { ok: false, error: 'project not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    add_deliverable: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const name = typeof args?.name === 'string' ? args.name : '';
        if (!name) return { ok: false, error: 'missing name' };
        const resolved = resolveProjectId(id) || id;
        const d = addProjectDeliverable(resolved, name, typeof args?.dueDate === 'string' ? args.dueDate : undefined);
        return { ok: true, data: d };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    toggle_deliverable: async (args: any) => {
      try {
        const id = typeof args?.deliverableId === 'string' ? args.deliverableId : '';
        const d = toggleDeliverable(id);
        if (!d) return { ok: false, error: 'deliverable not found' };
        return { ok: true, data: d };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_deliverable: async (args: any) => {
      try {
        const id = typeof args?.deliverableId === 'string' ? args.deliverableId : '';
        const ok = deleteDeliverable(id);
        return ok ? { ok: true } : { ok: false, error: 'deliverable not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    add_blocker: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const desc = typeof args?.description === 'string' ? args.description : '';
        if (!desc) return { ok: false, error: 'missing description' };
        const resolved = resolveProjectId(id) || id;
        const sev = typeof args?.severity === 'string' ? args.severity : 'medium';
        const b = addProjectBlocker(resolved, desc, sev);
        return { ok: true, data: b };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_blocker: async (args: any) => {
      try {
        const id = typeof args?.blockerId === 'string' ? args.blockerId : '';
        const ok = deleteBlocker(id);
        return ok ? { ok: true } : { ok: false, error: 'blocker not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    add_priority: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const item = typeof args?.item === 'string' ? args.item : '';
        if (!item) return { ok: false, error: 'missing item' };
        const resolved = resolveProjectId(id) || id;
        const impact = typeof args?.impact === 'string' ? args.impact : 'medium';
        const p = addProjectPriority(resolved, item, impact);
        return { ok: true, data: p };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_priority: async (args: any) => {
      try {
        const id = typeof args?.priorityId === 'string' ? args.priorityId : '';
        const ok = deleteProjectPriority(id);
        return ok ? { ok: true } : { ok: false, error: 'priority not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    update_financials: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
        const updates: any = {};
        if (typeof args?.budget === 'number') updates.budget = args.budget;
        if (typeof args?.spent === 'number') updates.spent = args.spent;
        if (typeof args?.revenue === 'number') updates.revenue = args.revenue;
        if (typeof args?.notes === 'string') updates.notes = args.notes;
        const f = updateProjectFinancials(resolved, updates);
        return { ok: true, data: f };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },

    // ─── Work tasks (wired to db.ts user_work_tasks) ───────────────────────
    // The agent-runner's create_work_task/list_work_tasks/update_work_task/
    // delete_work_task tools delegate here via callHost(); without these the
    // callbacks had "no registered handler" and the work-management agent could never add a task.
    list_work_tasks: async (args: any) => {
      try {
        // Single-user schema: every work task is the owner's, so list all of
        // them. Tasks are routinely created with assigned_to NULL; filtering
        // by a passed assignedTo would hide those and make "my work tasks"
        // look empty even when tasks exist.
        void args;
        const tasks = getWorkTasks();
        return { ok: true, data: tasks };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    create_work_task: async (args: any) => {
      try {
        const title = typeof args?.title === 'string' ? args.title : '';
        if (!title) return { ok: false, error: 'missing title' };
        let projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
        // No project given → land in the permanent Personal catch-all rather
        // than failing. The system requires a project per task; assorted /
        // email-driven tasks that don't fit a specific project go here.
        if (!projectId) projectId = PERSONAL_PROJECT_ID;
        // Resolve name→id if the model passed the project name, and confirm the
        // project actually exists — an early work-management agent's retry loop created duplicates because
        // it kept re-creating projects when its task calls silently failed.
        const resolved = resolveProjectId(projectId) || projectId;
        if (!getProject(resolved)) return { ok: false, error: 'project not found' };
        const task = createWorkTask({
          title,
          description: typeof args?.description === 'string' ? args.description : '',
          notes: typeof args?.notes === 'string' ? args.notes : '',
          priority: typeof args?.priority === 'string' ? args.priority : 'medium',
          created_by: typeof args?.createdBy === 'string' && args.createdBy ? args.createdBy : OWNER_JID,
          due_date: typeof args?.dueDate === 'string' && args.dueDate ? args.dueDate : undefined,
          project_id: resolved,
        });
        return { ok: true, data: task };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    update_work_task: async (args: any) => {
      try {
        const taskId = typeof args?.taskId === 'string' ? args.taskId : '';
        if (!taskId) return { ok: false, error: 'missing task_id' };
        const updates: any = {};
        if (typeof args?.title === 'string') updates.title = args.title;
        if (typeof args?.description === 'string') updates.description = args.description;
        if (typeof args?.notes === 'string') updates.notes = args.notes;
        if (typeof args?.status === 'string') updates.status = args.status;
        if (typeof args?.priority === 'string') updates.priority = args.priority;
        if (typeof args?.dueDate === 'string') updates.due_date = args.dueDate;
        if (typeof args?.projectId === 'string') {
          const resolved = resolveProjectId(args.projectId) || args.projectId;
          updates.project_id = resolved;
        }
        const task = updateWorkTask(taskId, updates);
        if (!task) return { ok: false, error: 'task not found' };
        return { ok: true, data: task };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_work_task: async (args: any) => {
      try {
        const taskId = typeof args?.taskId === 'string' ? args.taskId : '';
        if (!taskId) return { ok: false, error: 'missing task_id' };
        const ok = deleteWorkTask(taskId);
        return ok ? { ok: true } : { ok: false, error: 'task not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },

    // ─── Agent tasks (internal run records + shared history) ───────────────
    // The runner auto-scribes job outcomes here, and the agent-task tools
    // (iris/orchestrator) read/append/finish the same records.
    list_agent_tasks: async (_args: any) => {
      try {
        return {
          ok: true,
          data: {
            active: getActiveAgentTasks(),
            backlog: getAgentTaskBacklog(getAgentTaskBacklogSize()),
          },
        };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    read_agent_task: async (args: any) => {
      try {
        const taskId = typeof args?.taskId === 'string' ? args.taskId : '';
        const t = taskId ? getAgentTask(taskId) : undefined;
        return t ? { ok: true, data: t } : { ok: false, error: 'task not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    append_agent_task_history: async (args: any) => {
      try {
        const taskId = typeof args?.taskId === 'string' ? args.taskId : '';
        const text = typeof args?.text === 'string' ? args.text : '';
        if (!taskId || !text.trim()) return { ok: false, error: 'missing taskId or text' };
        const t = appendAgentTaskHistory(taskId, text);
        return t ? { ok: true, data: t } : { ok: false, error: 'task not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    complete_agent_task: async (args: any) => {
      try {
        const taskId = typeof args?.taskId === 'string' ? args.taskId : '';
        const t = taskId ? finishAgentTask(taskId, 'done') : undefined;
        return t ? { ok: true, data: t } : { ok: false, error: 'task not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    stop_agent_task: async (args: any) => {
      try {
        const taskId = typeof args?.taskId === 'string' ? args.taskId : '';
        const t = taskId ? finishAgentTask(taskId, 'stopped') : undefined;
        return t ? { ok: true, data: t } : { ok: false, error: 'task not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },

    install_mcp_server: async (args: any) => {
      try {
        const name = typeof args?.name === 'string' ? args.name : '';
        const command = typeof args?.command === 'string' ? args.command : '';
        if (!name || !command) {
          return { ok: false, error: 'missing name or command' };
        }
        const entry: McpServerConfig = {
          name,
          command,
          args: Array.isArray(args?.args) ? args.args.map(String) : [],
          env: args?.env && typeof args.env === 'object' ? args.env : undefined,
          transport: 'stdio',
          enabled: true,
        };
        addMcpServer(entry);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    uninstall_mcp_server: async (args: any) => {
      try {
        const name = typeof args?.name === 'string' ? args.name : '';
        if (!name) return { ok: false, error: 'missing name' };
        removeMcpServer(name);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    create_skill: async (args: any) => {
      try {
        const name = typeof args?.name === 'string' ? args.name : '';
        if (!name || !/^[a-z0-9-]+$/i.test(name)) {
          return { ok: false, error: 'invalid skill name (must match /^[a-z0-9-]+$/i)' };
        }
        // Guard against path traversal — the regex above already rejects slashes,
        // but be explicit so a future regex change can't create an escape.
        if (name.includes('..') || name.includes('/') || name.includes(path.sep)) {
          return { ok: false, error: 'invalid skill name' };
        }
        const description = typeof args?.description === 'string' ? args.description : '';
        const tools = Array.isArray(args?.tools) ? args.tools : [];
        const instructions = typeof args?.instructions === 'string' ? args.instructions : '';
        const whenToUse = typeof args?.when_to_use === 'string' ? args.when_to_use : '';
        const examplePrompt = typeof args?.example_prompt === 'string' ? args.example_prompt : '';
        const parameters = Array.isArray(args?.parameters) ? args.parameters : [];
        const steps = Array.isArray(args?.steps) ? args.steps : [];
        if (!description) {
          return { ok: false, error: 'missing description' };
        }
        const skillsRoot = path.join(DATA_DIR, 'skills');
        const skillDir = path.join(skillsRoot, name);
        fs.mkdirSync(skillDir, { recursive: true });
        const frontmatter = [
          '---',
          `name: ${name}`,
          `description: ${JSON.stringify(description)}`,
          tools.length ? `tools: ${JSON.stringify(tools)}` : null,
          '---',
        ].filter(Boolean).join('\n');

        const bodyParts: string[] = [];
        if (whenToUse) {
          bodyParts.push('## When to use', '', whenToUse.trim(), '');
        }
        if (parameters.length > 0) {
          bodyParts.push('## Parameters', '');
          for (const p of parameters) {
            const pname = typeof p?.name === 'string' ? p.name : '';
            const pdesc = typeof p?.description === 'string' ? p.description : '';
            const pex = typeof p?.example === 'string' && p.example ? ` (example: \`${p.example}\`)` : '';
            if (pname) bodyParts.push(`- **${pname}** — ${pdesc}${pex}`);
          }
          bodyParts.push('');
        }
        if (steps.length > 0) {
          bodyParts.push('## Steps', '');
          steps.forEach((s: any, i: number) => {
            const sdesc = typeof s?.description === 'string' ? s.description : '';
            const stool = typeof s?.tool === 'string' && s.tool ? ` [tool: \`${s.tool}\`${typeof s?.key_args === 'string' && s.key_args ? ` — \`${s.key_args}\`` : ''}]` : '';
            bodyParts.push(`${i + 1}. ${sdesc}${stool}`);
          });
          bodyParts.push('');
        }
        if (examplePrompt) {
          bodyParts.push('## Example prompt', '', '> ' + examplePrompt.trim().replace(/\n/g, '\n> '), '');
        }
        if (instructions) {
          bodyParts.push('## Notes', '', instructions.trim(), '');
        }
        const body = bodyParts.length > 0
          ? bodyParts.join('\n')
          : `# ${name}\n\n${description}\n`;
        const skillPath = path.join(skillDir, 'SKILL.md');
        fs.writeFileSync(skillPath, `${frontmatter}\n\n${body}\n`, 'utf8');
        return { ok: true, path: skillPath };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    get_chat_history: async (args: any) => {
      try {
        const limit = typeof args?.limit === 'number' ? Math.min(args.limit, 100) : 50;
        const messages = getMessagesForDashboard(OWNER_JID, '', limit);
        return { ok: true, messages };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    open_app: async (args: any) => {
      try {
        const app = typeof args?.app === 'string' ? args.app.trim() : '';
        if (!app) return { ok: false, error: 'missing app name' };
        const extraArgs: string[] = Array.isArray(args?.args) ? args.args.map(String) : [];
        const hostEnv = {
          ...process.env,
          DISPLAY: process.env.DISPLAY || ':0',
          WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || '',
          XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE || '',
          XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`,
          DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || '',
        };
        const { spawn: nodeSpawn } = await import('child_process');
        const child = nodeSpawn(app, extraArgs, {
          env: hostEnv,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        logger.info({ app, args: extraArgs }, 'open_app: launched host application');
        return { ok: true, message: `Launched ${app}` };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // ─── Host-side image capture ───────────────────────────────────────────
    // Screenshots, webcam frames, and arbitrary host image files are captured
    // here in the orchestrator process (which has the host display + devices),
    // not inside the container. The container tool pushes the returned base64
    // into its vision-context queue.

    desktop_screenshot: async (args: any) => {
      try {
        // This host IS the desktop — capture the screen locally, no satellite.
        let region: { x: number; y: number; w: number; h: number } | undefined;
        const r = args?.region;
        if (r && typeof r === 'object') {
          const w = Math.max(0, Math.round(+r.w || 0));
          const h = Math.max(0, Math.round(+r.h || 0));
          if (w > 0 && h > 0) {
            region = { x: Math.round(+r.x || 0), y: Math.round(+r.y || 0), w, h };
          }
        }
        const cap = await captureScreenshot({ windowTitle: args?.window_title, region });
        logger.info(
          { width: cap.width, height: cap.height, mediaType: cap.mediaType, region, window_title: args?.window_title },
          'desktop_screenshot: captured local desktop',
        );
        return { ok: true, image: cap.image, mediaType: cap.mediaType, width: cap.width, height: cap.height };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    webcam_capture: async (args: any) => {
      try {
        // The webcam is on this host (/dev/video0), captured locally.
        const cap = await captureWebcam({ device: args?.device, width: args?.width });
        logger.info(
          { width: cap.width, height: cap.height, mediaType: cap.mediaType, device: args?.device },
          'webcam_capture: captured local webcam',
        );
        return { ok: true, image: cap.image, mediaType: cap.mediaType, width: cap.width, height: cap.height };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    read_image: async (args: any) => {
      try {
        const p = typeof args?.path === 'string' ? args.path.trim() : '';
        if (!p) return { ok: false, error: 'missing path' };
        const cap = await readHostImage(p);
        logger.info(
          { path: p, width: cap.width, height: cap.height, mediaType: cap.mediaType },
          'read_image: loaded host image',
        );
        return { ok: true, image: cap.image, mediaType: cap.mediaType, width: cap.width, height: cap.height, path: p };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Sentry scan submission. The agent collects the raw inventory with Bash,
    // JUDGES it itself (a smart model knows what a normal Linux desktop looks
    // like), and submits it ONCE with its `suspicious` flags. THIS handler
    // only logs the scan row and relays the flags — no baseline, no host-side
    // diff. Clean scans are logged and silent.
    sentry_report: async (args: any) => {
      try {
        const mode = args?.mode === 'deep' ? 'deep' : 'peek';
        const arr = (v: any): string[] =>
          Array.isArray(v) ? v.map((x: any) => String(x).trim()).filter(Boolean) : [];
        const inventory: Record<string, string[]> = {
          listening: arr(args?.listening),
          connections: arr(args?.connections),
          services: arr(args?.services),
        };
        if (mode === 'deep') {
          inventory.autostart = arr(args?.autostart);
          inventory.crontab = arr(args?.crontab);
          inventory.units = arr(args?.units);
        }
        const suspicious = arr(args?.suspicious);
        const nowIso = new Date().toISOString();
        const checked = Object.values(inventory).reduce((n, a) => n + a.length, 0);
        const verdict = suspicious.length > 0 ? 'FINDINGS' : 'CLEAN';

        logSentryScan({
          ts: nowIso,
          mode,
          verdict,
          summary: `${checked} items checked${suspicious.length ? `, ${suspicious.length} finding(s)` : ''}`,
          rawJson: JSON.stringify(inventory),
          findingsJson: JSON.stringify(suspicious),
        });

        // Speak only when something's wrong. Dedup announcements: a flag
        // spoken once stays quiet while it keeps appearing, and a clean scan
        // clears the set so anything that reappears later speaks again.
        let fresh = suspicious;
        if (suspicious.length > 0) {
          let reported = new Set<string>();
          try { reported = new Set(JSON.parse(getRouterState('sentry:reported') || '[]')); } catch { /* fresh set */ }
          fresh = suspicious.filter((f) => !reported.has(f));
          if (fresh.length > 0) {
            reported = new Set([...reported, ...fresh]);
            setRouterState('sentry:reported', JSON.stringify([...reported].slice(-200)));
            const text = `🛡 Security scan found something new:\n${fresh.map((f) => `• ${f}`).join('\n')}`;
            const messageId = `sentry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            storeMessage({
              id: messageId,
              chat_jid: OWNER_JID,
              sender: 'assistant:sentry',
              sender_name: '🛡 Sentry',
              content: text,
              timestamp: nowIso,
              is_from_me: false,
              is_bot_message: true,
            });
            await Promise.allSettled(
              channels.map((ch) =>
                ch.sendMessage(OWNER_JID, text).catch((err) =>
                  logger.warn({ channel: ch.name, err }, 'Failed to deliver Sentry finding to channel'),
                ),
              ),
            );
          }
        } else {
          setRouterState('sentry:reported', '[]');
        }

        const verdictText =
          verdict === 'CLEAN'
            ? `CLEAN — ${checked} items checked, nothing looked wrong.`
            : `FINDINGS — ${suspicious.length} item(s) flagged${fresh.length < suspicious.length ? ` (${fresh.length} new)` : ''}: ${suspicious.join('; ').slice(0, 400)}`;
        return { ok: true, verdict: verdictText };
      } catch (err: any) {
        logger.warn({ err }, 'sentry_report: failed');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // on the host so <chat_history> is gated to messages AFTER this point —
    // otherwise pre-clear turns (e.g. a STT-misheard "dental file" thread the
    // small model keeps latching onto) get re-injected every turn. The
    // agent-runner also resets its own in-memory messages when it sees
    // input.contextClearAt change next turn.
    clear_context: async (args: any) => {
      try {
        const now = new Date().toISOString();
        setRouterState('orchestrator:context_clear_at', now);
        setRouterState('last_agent_timestamp', now);
        logger.info({ reason: args?.reason }, 'clear_context tool: host boundary recorded');
        return { ok: true, clearedAt: now };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // api_request / list_api_keys — the agent-runner's `admin` toolset delegates
    // to the host via a {tool:'ipc', args:{type:'api_request'|'list_api_keys',...}}
    // callback. The agent-runner child never sees real API keys: it sends the
    // key_type + path here, and the host resolves the key from the DB, injects
    // auth, and makes the HTTP call. key_type "warden" is the internal case — a
    // loopback to this status server with no auth (e.g. Iris POSTing a digest to
    // /api/summaries). Without this handler Iris's api_request calls fail with
    // "no handler for tool: ipc".
    ipc: async (args: any) => {
      try {
        const type = args?.type;
        let userId = args?.userId || OWNER_JID;

        if (type === 'list_api_keys') {
          let rows = getUserApiKeys(userId).filter((r: any) => r.is_active);
          if (!rows.length && (userId === OWNER_JID || !userId)) {
            rows = getAllUserApiKeys().filter((r: any) => r.is_active);
          }
          const keys = rows.map((r: any) => ({
            key_type: r.key_type, label: r.label || r.key_type, base_url: r.base_url || '',
          }));
          // Always advertise the internal Warden API — it needs no configured
          // key (it loopbacks to this status server). Agents discover it via
          // list_api_keys, then POST digests / summaries with key_type "warden".
          // Without this, an agent that calls list_api_keys first sees "no keys"
          // and gives up before ever trying the keyless internal call.
          if (!keys.some((k: any) => k.key_type === 'warden' || k.key_type === 'internal')) {
            keys.unshift({ key_type: 'warden', label: 'Warden (internal, no key needed)', base_url: 'http://localhost:3200' });
          }
          return { ok: true, keys };
        }

        if (type === 'api_request') {
          const keyType = String(args.key_type || '');
          const method = String(args.method || 'GET').toUpperCase();
          const headers: Record<string, string> = { ...(args.headers || {}) };
          let url: string;

          if (keyType === 'warden' || keyType === 'internal' || keyType === 'self' || keyType === 'localhost') {
            // Internal loopback to this Warden status server — no auth needed.
            // Iris's prompt says key_type "warden", but she often reads "the
            // internal /api/summaries endpoint" and sends key_type "internal"
            // instead — accept both (and self/localhost) so the POST still lands.
            const port = process.env.STATUS_PORT || '3200';
            const p = String(args.path || '/');
            url = p.startsWith('http') ? p : `http://127.0.0.1:${port}${p.startsWith('/') ? '' : '/'}${p}`;
          } else {
            // External service — resolve the stored key + base_url, inject auth.
            let row = getActiveUserApiKeyByType(userId, keyType);
            if (!row && (userId === OWNER_JID || !userId)) {
              row = getAllUserApiKeys().find((r: any) => r.key_type === keyType && r.is_active) as any;
            }
            if (!row) return { ok: false, error: `no API key configured for key_type "${keyType}"` };
            const plainKey = decryptApiKey(row.encrypted_key, row.iv, row.auth_tag);
            const base = (row.base_url || '').replace(/\/$/, '');
            const p = String(args.path || '');
            url = p.startsWith('http') ? p : `${base}${p.startsWith('/') ? '' : '/'}${p}`;
            const fmt = row.auth_header_format || 'Bearer {key}';
            const auth = fmt.includes('{key}') ? fmt.replace('{key}', plainKey) : `Bearer ${plainKey}`;
            const cidx = auth.indexOf(':');
            if (cidx > -1 && !/^authorization$/i.test(auth.slice(0, cidx).trim())) {
              headers[auth.slice(0, cidx).trim()] = auth.slice(cidx + 1).trim();
            } else {
              headers['Authorization'] = auth;
            }
          }

          const init: any = { method, headers };
          if (args.body !== undefined && args.body !== null && method !== 'GET' && method !== 'HEAD') {
            init.body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
            if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30000);
          try {
            const res = await fetch(url, { ...init, signal: controller.signal });
            const text = await res.text().catch(() => '');
            logger.info({ keyType, method, url, status: res.status }, 'ipc api_request: dispatched');
            let body: any = text;
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) { try { body = JSON.parse(text); } catch { /* keep text */ } }
            return { ok: res.ok, status: res.status, statusText: res.statusText, body };
          } finally {
            clearTimeout(timer);
          }
        }

        // post_summary — keyless internal loopback so Iris can publish a digest
        // without going through api_request (which requires a key_type and was
        // failing with "no API key configured" when Iris forgot it). POSTs to
        // this Warden's own /api/summaries?span=X; the dashboard digest panel
        // reads from there. No auth, no stored key, no base_url to resolve.
        if (type === 'post_summary') {
          const span = String(args.span || '');
          if (!['hourly', 'daily', 'weekly'].includes(span)) {
            return { ok: false, error: `invalid span: ${span}` };
          }
          const port = process.env.STATUS_PORT || '3200';
          const url = `http://127.0.0.1:${port}/api/summaries?span=${encodeURIComponent(span)}`;
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: String(args.text || '') }),
              signal: AbortSignal.timeout(30000),
            });
            const respText = await res.text().catch(() => '');
            logger.info({ span, status: res.status }, 'ipc post_summary: dispatched');
            return { ok: res.ok, status: res.status, statusText: res.statusText, body: respText };
          } catch (err: any) {
            logger.warn({ span, err }, 'ipc post_summary: failed');
            return { ok: false, error: String(err?.message ?? err) };
          }
        }

        // Alarm IPC — the agent-runner's `alarms` toolset (create/list/update/
        // delete_alarm) used to write these as task files into an IPC dir the
        // host no longer watches, so alarms were accepted ("Alarm created.")
        // but never persisted and never fired. Handle them in-process instead.
        // Single-user: all alarms belong to OWNER_JID.
        if (type === 'create_alarm') {
          const label = String(args.label || '').trim();
          const rawTime = String(args.alarm_time || '').trim();
          if (!label || !/^\d{1,2}:\d{2}$/.test(rawTime)) {
            return { ok: false, error: 'create_alarm requires label and alarm_time (HH:MM)' };
          }
          // Normalize to HH:MM and default a one-time alarm to today — the
          // model should never have to compute today's date.
          const [h, m] = rawTime.split(':');
          const hhmm = `${String(h).padStart(2, '0')}:${m}`;
          const now = new Date();
          const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          let repeatType = String(args.repeat_type || 'once');
          if (repeatType === 'none') repeatType = 'once';
          const alarmDate = repeatType === 'once' ? (args.alarm_date || today) : (args.alarm_date || null);
          const alarm = createAlarm(OWNER_JID, {
            label, alarm_time: hhmm, alarm_date: alarmDate || undefined,
            repeat_type: repeatType, repeat_days: args.repeat_days, sound: args.sound,
          });
          pushNotification(OWNER_JID, { type: 'alarm_created', message: `Alarm "${label}" set for ${hhmm}`, taskId: alarm?.id });
          logger.info({ label: alarm.label, time: alarm.alarm_time, date: alarm.alarm_date, repeat: alarm.repeat_type }, 'Alarm created via ipc callback');
          return { ok: true, alarm };
        }

        if (type === 'list_alarms') {
          return { ok: true, alarms: getUserAlarms(OWNER_JID) };
        }

        if (type === 'update_alarm') {
          const alarmId = String(args.alarm_id || '');
          if (!alarmId) return { ok: false, error: 'update_alarm requires alarm_id' };
          const updates: Record<string, unknown> = {};
          if (typeof args.label === 'string') updates.label = args.label;
          if (typeof args.alarm_time === 'string') updates.alarm_time = args.alarm_time;
          if (args.alarm_date === null || typeof args.alarm_date === 'string') updates.alarm_date = args.alarm_date;
          if (typeof args.repeat_type === 'string') updates.repeat_type = args.repeat_type === 'none' ? 'once' : args.repeat_type;
          if (typeof args.repeat_days === 'string') updates.repeat_days = args.repeat_days;
          if (typeof args.enabled === 'boolean') updates.enabled = args.enabled ? 1 : 0;
          if (typeof args.sound === 'string') updates.sound = args.sound;
          const updated = updateAlarm(alarmId, updates);
          if (!updated) return { ok: false, error: 'alarm not found' };
          return { ok: true, alarm: updated };
        }

        if (type === 'delete_alarm') {
          const alarmId = String(args.alarm_id || '');
          if (!alarmId) return { ok: false, error: 'delete_alarm requires alarm_id' };
          return { ok: deleteAlarmDb(alarmId) };
        }

        return { ok: false, error: `unknown ipc type: ${type}` };
      } catch (err: any) {
        logger.warn({ err, type: args?.type }, 'ipc callback: error');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

  };
}

// Mercury scheduling — runs on the 2s poll loop (see startMessageLoop), not
// the per-turn tail, so the downtime trigger can fire while no turn is in
// flight. Two independent triggers, both idle-gated (agent:processing !==
// 'true') so a compaction never contends with an in-flight orchestrator turn:
//   - interval  (mercury:interval_minutes,  default 30, 0 = off): fire if it's
//     been at least this long since the last compaction.
//   - downtime  (mercury:downtime_minutes,  default  5, 0 = off): fire if the
//     user has been quiet this long (and at least this long since the last run).
// All thresholds are read LIVE from router_state, so a dashboard settings
// change takes effect on the next tick — no restart. cleanerBusy is the
// shared stagger lock (see digestMonitorBusy): Mercury compaction, the Iris
// digests, and memory writeback all acquire it so no two cleaners run at once.
let cleanerBusy = false;
let mercuryRunning = false;

function maybeScheduleMercury(): void {
  if (mercuryMode() === 'off') return;
  if (cleanerBusy || mercuryRunning) return;
  const now = Date.now();
  // Lazy first-boot seed (mirrors digest:lastrun seeding): advance to now and
  // wait for the interval/downtime rather than compacting immediately at boot.
  const lastRaw = getRouterState('mercury:lastrun') || '';
  const last = Date.parse(lastRaw) || 0;
  if (!last) {
    setRouterState('mercury:lastrun', new Date(now).toISOString());
    return;
  }
  // '' → default, '0' → disabled — same parse as the idle-clear consumer.
  const intervalRaw = getRouterState('mercury:interval_minutes') || '';
  const intervalMin = intervalRaw === '' ? 30 : (parseInt(intervalRaw, 10) || 0);
  const downtimeRaw = getRouterState('mercury:downtime_minutes') || '';
  const downtimeMin = downtimeRaw === '' ? 5 : (parseInt(downtimeRaw, 10) || 0);
  if (intervalMin === 0 && downtimeMin === 0) return;
  if (getRouterState('agent:processing') === 'true') return; // idle-gate

  const sinceRun = now - last;
  // Only compact when there is NEW conversation since the last run — otherwise
  // a long idle would re-compact identical content every few minutes (and an
  // unchanged summary is pure token waste).
  const lastUser = Date.parse(getRouterState('orchestrator:last_user_message_at') || '');
  const newContent = !!lastUser && lastUser > last;
  const timeDue = intervalMin > 0 && sinceRun >= intervalMin * 60_000 && newContent;
  const downDue =
    downtimeMin > 0 &&
    newContent &&
    now - lastUser >= downtimeMin * 60_000; // user quiet, and (since lastUser > last) it's been at least this long since the last run
  if (!timeDue && !downDue) return;

  // Advance lastrun BEFORE firing so a slow run can't double-fire on the next tick.
  setRouterState('mercury:lastrun', new Date(now).toISOString());
  cleanerBusy = true;
  mercuryRunning = true;
  void updateMercurySummary()
    .catch((err) => logger.warn({ err: err?.message ?? err }, 'Mercury scheduled summary failed'))
    .finally(() => {
      cleanerBusy = false;
      mercuryRunning = false;
    });
}

/**
 * File each mercury summary into MARM (session "mercury") so the rolling
 * conversation state stays recallable via marm_smart_recall even after the
 * 120-message RAG horizon passes — the first step toward MARM-first recall.
 * Fire-and-forget: MARM being down or slow must never block compaction.
 * Dedup on the summary body: compaction rewrites the whole file each run and
 * consecutive summaries overlap heavily, so only file when the text changed.
 */
let marmHostSessionId: string | undefined;

async function marmRpc(sessionId: string | undefined, body: Record<string, unknown>): Promise<Record<string, any> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(process.env.MARM_URL || 'http://127.0.0.1:8001/mcp', {
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
    if (newSession) marmHostSessionId = newSession;
    const ctype = res.headers.get('content-type') || '';
    let text = await res.text();
    if (ctype.includes('text/event-stream')) {
      const line = text.split('\n').find((l) => l.startsWith('data:'));
      text = line ? line.slice(5).trim() : '';
    }
    const start = text.indexOf('{');
    if (start === -1) return null;
    return JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fileMercurySummaryToMarm(newItems: string[]): void {
  // File only the DELTA — the items this compaction added that the previous
  // state didn't hold — one entry per item, into the "mercury" session. The
  // old shape filed the whole rendered summary on every compaction; since the
  // summary is a rolling superset it never repeated byte-for-byte, so the
  // last-file guard never skipped and a day of compactions left dozens of
  // overlapping documents in MARM — which auto-recall then injected into every
  // turn, crowding out distinct facts. Discrete delta items also recall
  // better than blobs. Dedupe is by comparison against the previous state at
  // the call site, not by string equality here.
  if (!newItems.length) return;
  void (async () => {
    const init = await marmRpc(undefined, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'warden-mercury-filing', version: '1.0.0' },
      },
    });
    if (!init) {
      logger.warn('Mercury→MARM filing skipped: MARM unreachable');
      return;
    }
    await marmRpc(marmHostSessionId, { jsonrpc: '2.0', method: 'notifications/initialized' });
    let filed = 0;
    for (const item of newItems) {
      if (!item.trim()) continue;
      const res = await marmRpc(marmHostSessionId, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'marm_log_entry',
          arguments: {
            session_name: 'mercury',
            entry: `${new Date().toISOString().slice(0, 10)} - ${item}`,
          },
        },
      });
      if (res?.error || res?.result?.isError) {
        logger.warn({ err: res?.error?.message ?? 'tool error', item: item.slice(0, 80) }, 'Mercury→MARM filing failed');
        return;
      }
      filed++;
    }
    if (filed > 0) logger.info({ count: filed }, 'Mercury delta items filed to MARM (session: mercury)');
  })().catch((err) => logger.warn({ err: err?.message ?? err }, 'Mercury→MARM filing failed'));
}

/**
 * Mercury — automatic rolling conversation compaction.
 *
 * Reads the last ~40 messages, preserves the most recent turns verbatim, and
 * asks the dashboard Mercury model to compress the older turns into a concise
 * summary of facts, decisions, open questions, and relevant context. Writes the
 * result to MERCURY_MEMORY.md so every subsequent prompt starts with compact
 * context instead of an ever-growing transcript.
 *
 * Runs asynchronously after each reply so it never blocks the chat flow.
 */
async function updateMercurySummary(): Promise<void> {
  try {
    const clearAt = getRouterState('orchestrator:context_clear_at') || '';
    const allRaw = getChatHistory(OWNER_JID, 45) as unknown as NewMessage[];
    // Gate by the clear boundary so a context clear also stops Mercury from
    // compacting pre-clear turns into the rolling summary — otherwise the next
    // compaction rebuilds the very pre-clear content the clear was meant to
    // drop, and <mercury_summary> re-injects it every turn.
    const raw = clearAt ? allRaw.filter((m) => (m.timestamp || '') > clearAt) : allRaw;
    if (raw.length <= MERCURY_RECENT_MESSAGES + 3) return;

    const recent = raw.slice(-MERCURY_RECENT_MESSAGES);
    const older = raw.slice(0, -MERCURY_RECENT_MESSAGES);
    if (older.length === 0) return;

    // Only the USER's own messages. Feeding the assistant's turns too is what
    // produced the useless summary: the assistant's self-narration (results,
    // "Atlas is a digital assistant…", tool output) drowns out the user's few
    // terse instructions, so the distiller filed what the assistant DOES as
    // facts instead of what the user TOLD it. Mirrors the memory-writeback
    // user-only filter.
    const olderLines = older
      .filter((m) => !m.is_bot_message)
      .map((m) => `User: ${m.content}`)
      .join('\n');
    if (!olderLines.trim()) return;

    // STRUCTURED CONTRACT — this is the shape the toolcall fine-tune is
    // TRAINED on (training/gen_mercury_sft.mjs extracts MERCURY_SYSTEM_PROMPT
    // from this file, so train can never drift from serve). The previous
    // merged state goes in as JSON (STATE), the newly-dropped turns as
    // ROLE: text lines (TURNS), and the merged state comes back as JSON held
    // to MERCURY_FORMAT by constrained decoding. Folding is
    // merge(STATE, TURNS) → new STATE, so nothing older than the verbatim
    // window silently falls out — the thread-loss this layer exists to
    // prevent. The old prose-summarizer shape was off-distribution for a
    // tool-call fine-tune: it kept answering in JSON anyway, which is why a
    // defensive JSON.parse unwrap used to sit below.
    let state: MercuryState = EMPTY_MERCURY_STATE;
    try {
      const stored = getRouterState('mercury:state');
      if (stored) {
        const parsed = JSON.parse(stored) as { ts?: string; state?: Partial<MercuryState> };
        // Same clearAt invalidation as the summary file: a context clear
        // drops the memory along with the context it belonged to.
        const stale = !!(parsed?.ts && clearAt && parsed.ts <= clearAt);
        if (!stale && parsed?.state) {
          const cand = parsed.state as Record<string, unknown>;
          state = {
            facts: Array.isArray(cand.facts) ? cand.facts.filter((x): x is string => typeof x === 'string') : [],
            decisions: Array.isArray(cand.decisions) ? cand.decisions.filter((x): x is string => typeof x === 'string') : [],
            open: Array.isArray(cand.open) ? cand.open.filter((x): x is string => typeof x === 'string') : [],
            refs: Array.isArray(cand.refs) ? cand.refs.filter((x): x is string => typeof x === 'string') : [],
          };
        }
      }
    } catch { /* corrupt stored state — start empty */ }

    // Mercury's model comes ONLY from the dashboard Mercury row (mercury:model)
    // — no env override, no fallback to the shared Toolcall row. Settings is
    // the single source of model selection; a blank Mercury row means
    // compaction no-ops rather than silently distilling on a model the user
    // never chose.
    const model = (getRouterState('mercury:model') || '')
      .replace(/^local:/, '').trim();
    if (!model) return;
    // num_ctx and keep_alive must travel with the call — a bare request without
    // them loads a second copy of the model at Ollama's native 2048 ctx / 300s
    // default, which can evict an instance the user keeps resident.
    const ctxRaw = (getRouterState('local:mercury_ctx') || getRouterState('local:subagent_ctx') || '').trim();
    const ctxNum = Number(ctxRaw);
    const numCtx = Number.isFinite(ctxNum) && ctxNum > 0 ? ctxNum : undefined;
    const keepRaw = (getRouterState('local:toolcall_keep_alive') || '').trim();
    const keepAlive = keepRaw === '-1' ? -1 : (Number.isFinite(Number(keepRaw)) && keepRaw ? Number(keepRaw) : 300);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    let merged: MercuryState | null = null;
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: false,
          // Constrained decoding: the single biggest lever for holding a 3B
          // to valid structured output. Every model seat is Ollama in this
          // install (local and cloud), so format applies on both paths.
          format: MERCURY_FORMAT,
          messages: [
            { role: 'system', content: MERCURY_SYSTEM_PROMPT },
            { role: 'user', content: `STATE:\n${JSON.stringify(state)}\n\nTURNS:\n${olderLines}` },
          ],
          options: { temperature: 0, ...(numCtx ? { num_ctx: numCtx } : {}) },
          keep_alive: keepAlive,
        }),
      });
      if (!resp.ok) {
        logger.warn({ status: resp.status, model }, 'Mercury summary call failed');
        return;
      }
      const data = (await resp.json()) as { message?: { content?: string } };
      merged = parseMercuryState(cleanAgentText(data.message?.content || ''));
    } catch (err: any) {
      logger.warn({ err: err?.message ?? err, model }, 'Mercury merge call failed');
      return;
    } finally {
      clearTimeout(timer);
    }
    if (!merged) {
      logger.warn({ model }, 'Mercury merge returned no valid state — keeping previous summary');
      return;
    }

    const root = WORKSPACE_ROOT.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
    const mercuryPath = path.join(root, MERCURY_MEMORY_FILE);
    const stamp = new Date().toISOString();
    // The file holds the human/orchestrator-readable rendering (its header
    // stamp is the clearAt invalidation marker); router state holds the raw
    // JSON, which is what the next compaction's STATE input needs.
    const rendered = renderMercuryState(merged);
    const entry = `# Mercury summary updated ${stamp}\n\n${rendered}\n\n---\n\n`;
    fs.writeFileSync(mercuryPath, entry, 'utf8');
    setRouterState('mercury:state', JSON.stringify({ ts: stamp, state: merged }));
    logger.info(
      { facts: merged.facts.length, decisions: merged.decisions.length, open: merged.open.length, refs: merged.refs.length },
      'Mercury state updated',
    );
    // Delta for MARM: items the previous state didn't already hold. Filed
    // discretely; nothing is filed when the compaction added nothing.
    const prevItems = new Set<string>(MERCURY_FIELDS.flatMap((f) => state[f]));
    const delta = MERCURY_FIELDS.flatMap((f) => merged[f]).filter((i) => !prevItems.has(i));
    fileMercurySummaryToMarm(delta);
  } catch (err: any) {
    logger.warn({ err: err?.message ?? err }, 'Mercury summary update failed');
  }
}

/**
 * Poll the single owner chat for new messages since the last agent run.
 * If any are present, build an AgentInput and call runAgent().
 */
async function processOwnerMessages(): Promise<void> {
  // Re-sync cursor with router state in case an external stop/advance changed it.
  lastAgentTimestamp = getRouterState('last_agent_timestamp') || lastAgentTimestamp;
  const since = lastAgentTimestamp;
  let pending = getMessagesSince(OWNER_JID, since, ASSISTANT_NAME);

  // Requeue after a user stop: if the previous turn was stopped (soft interrupt
  // or kill), its messages were dropped by the cursor advance. The marker holds
  // the timestamp just BEFORE the stopped turn's first message — extend `since`
  // back to it so that turn's text is answered alongside the new message. Only
  // when something newer is actually pending; a bare stop must not retrigger.
  if (pending.length > 0) {
    const stoppedSince = getRouterState('orchestrator:stopped_turn_since');
    if (stoppedSince && stoppedSince < since) {
      setRouterState('orchestrator:stopped_turn_since', '');
      pending = getMessagesSince(OWNER_JID, stoppedSince, ASSISTANT_NAME);
      logger.info({ stoppedSince }, 'Re-including messages from the stopped turn');
    }
  }
  if (pending.length === 0) return;

  // ── Idle context clear ──────────────────────────────────────────────────
  // If the user's last message was older than the configured threshold (Model
  // Configuration → Idle clear; default OFF), drop the orchestrator's
  // accumulated context before this turn so testing chatter can't bloat the
  // working window. Setting orchestrator:context_clear_at to the latest pending
  // timestamp makes the agent-runner reset its in-memory conversation (it
  // resets when the marker changes) and gates <chat_history> to messages after
  // it. 0 = disabled.
  //
  // DEFAULT IS OFF (0). This is a single-user desktop assistant, not a testbed:
  // the normal pattern is to walk away for an hour and come back with "yes" to a
  // pending question. A 30-min idle auto-clear ate exactly that — it gated
  // <chat_history> to after the "yes", so the question the "yes" was answering
  // vanished and the orchestrator replied "I don't see a pending question in
  // front of me" (2026-08-29). Context bloat is already handled by Mercury
  // compaction (mercury:interval_minutes), so this idle-clear is redundant for
  // bloat and harmful for continuity. The dashboard dropdown still lets the
  // user opt back in (15/30/60/120/240 min) if they ever want it.
  const latestUserTs = pending[pending.length - 1]!.timestamp;
  const idleRaw = getRouterState('orchestrator:context_idle_clear_minutes') || '';
  const idleMin = idleRaw === '' ? 0 : (parseInt(idleRaw, 10) || 0);
  const prevUserTs = getRouterState('orchestrator:last_user_message_at') || '';
  if (idleMin > 0 && prevUserTs) {
    const gapMin = (Date.parse(latestUserTs) - Date.parse(prevUserTs)) / 60000;
    if (gapMin > idleMin) {
      setRouterState('orchestrator:context_clear_at', latestUserTs);
      logger.info({ idleMin: Math.round(gapMin) }, 'Orchestrator context auto-cleared after user idle');
    }
  }
  setRouterState('orchestrator:last_user_message_at', latestUserTs);

  const prompt = buildPrompt(pending);

  // Advance cursor before invoking the agent so a crash between cursor advance
  // and agent completion doesn't re-process the same messages.
  lastAgentTimestamp = pending[pending.length - 1]!.timestamp;
  saveState();

  logger.info(
    { chatJid: OWNER_JID, messageCount: pending.length },
    'Processing messages for owner chat',
  );

  // Sync tools model into env so agent subprocess inherits it
  const subagentModel = getRouterState('local:subagent_model');
  if (subagentModel) process.env.SUBAGENT_MODEL = subagentModel;

  // Sync per-agent num_ctx overrides from dashboard settings into env.
  // Atlas has no override — it always gets the model max (see getNumCtx).
  // Always assign (even when empty) so clearing the field in the dashboard
  // actually clears the override — otherwise the previous value sticks across
  // turns and ollama never sees the smaller ctx.
  syncAgentCtxEnv();

  // Load workspace memory files and inject into agent context every turn.
  const memoryContext = (() => {
    const root = WORKSPACE_ROOT.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
    try {
      const content = fs.readFileSync(path.join(root, 'MEMORY.md'), 'utf-8').trim();
      return content || undefined;
    } catch { return undefined; }
  })();

  // ── Agent task (internal run record + shared history) ────────────────────
  // Every user command becomes an "agent task": a persistent record whose
  // shared history every specialist reads (the anti-"marco polo" bus) and the
  // dashboard shows. The task id + history ride into the runner via AgentInput;
  // the runner auto-scribes each background job's outcome back into the history.
  // Marked done on completion, stopped on user stop. Bot-only turns (digest,
  // reminders) and control words don't create a task.
  const userCommand = pending
    .filter((m) => !m.is_bot_message)
    .map((m) => m.content || '')
    .join('\n')
    .trim();
  // Claim the queued task created at ingestion (queued → running). Falls back
  // to creating one for messages ingested before task tracking was on.
  const activeTask = userCommand ? claimNextAgentTask(userCommand) : undefined;
  const taskContext = activeTask ? `${activeTask.command}\n\n[Task history:]\n${activeTask.history}` : undefined;

  const input: AgentInput = {
    prompt,
    sessionId: 'owner',
    workspaceRoot: WORKSPACE_ROOT,
    history: pending,
    // Host-side backstop for an owner-chat turn. Aligned just past the runner's
    // own 3h WALL_CLOCK_MS (container/agent-runner/src/index.ts) so long legitimate
    // work — e.g. a complex on-device install that runs inline — completes instead
    // of being SIGTERM'd at 10 min. The runner's wall-clock is the primary cap and
    // exits cleanly; this host timer only reaps a persistent child that hangs past
    // 3h05m. Stuck *model* calls are reaped far earlier by provider-level timeouts
    // (120s cloud fetch + retries, 20min Ollama), so the old 10-min turn cap only
    // killed real work. Cleared on normal completion (agent-spawn turnTimeout clear).
    timeoutMs: 3 * 60 * 60 * 1000 + 5 * 60 * 1000,
    memoryContext,
    taskId: activeTask?.id,
    taskContext,
    orchestratorModel: (getRouterState('orchestrator:model') || '').replace(/^local:/, '') || undefined,
    model: (getRouterState('atlas:model') || '').replace(/^local:/, '') || undefined,
    vulkanModel: (getRouterState('vulkan:model') || '').replace(/^local:/, '') || undefined,
    // Supervisor (completion-verdict) model — blank inherits the orchestrator model in
    // the runner. No ctx row: cloud/small models use their native window.
    supervisorModel: (getRouterState('supervisor:model') || '').replace(/^local:/, '') || undefined,
    // Supervisor completion verdict on/off (dashboard "Supervisor" row).
    supervisorEnabled: getRouterState('supervisor:enabled') !== 'false',
    // Iris is the single toolcall agent (byte merged in 2026-09-05) and runs
    // on the Toolcall model (dashboard "Toolcall model" row, persisted as
    // local:subagent_model).
    irisModel: (getRouterState('local:subagent_model') || '').replace(/^local:/, '') || undefined,
    artemisModel: (getRouterState('artemis:model') || '').replace(/^local:/, '') || undefined,
    // Sentry (software-security scanner) has its own model row; blank inherits
    // the ORCHESTRATOR model (not the shared toolcall wire — Sentry is meant
    // to run on the big resident model, and only diverges if explicitly set).
    sentryModel: (getRouterState('sentry:model') || getRouterState('orchestrator:model') || '').replace(/^local:/, '') || undefined,
    drivingForce: getRouterState('orchestrator:driving_force') || '',
    contextClearAt: getRouterState('orchestrator:context_clear_at') || '',
    councilSkepticModel: (getRouterState('council:skeptic_model') || '').replace(/^local:/, '') || undefined,
    councilPragmatistModel: (getRouterState('council:pragmatist_model') || '').replace(/^local:/, '') || undefined,
    councilSynthesistModel: (getRouterState('council:synthesist_model') || '').replace(/^local:/, '') || undefined,
    showThinking: getRouterState(`thinking:${OWNER_JID}`)
      || getRouterState('local:thinking')
      || 'true',
    verbose: true,
  };

  agentProcessing = true;
  setRouterState('agent:processing', 'true');
  let output;
  try {
    output = await runAgent({ ...input, callbacks: buildAgentCallbacks() });
  } catch (err) {
    agentProcessing = false;
    setRouterState('agent:processing', 'false');
    logger.error({ err }, 'runAgent threw');
    if (activeTask) finishAgentTask(activeTask.id, 'stopped');
    // Keep the cursor advanced so the failed turn is not retried indefinitely
    // and the user doesn't get a re-reply to the same message every loop tick.
    return;
  }
  agentProcessing = false;
  setRouterState('agent:processing', 'false');
  if (output.userStopped) {
    if (activeTask) finishAgentTask(activeTask.id, 'stopped');
    // Mark the window BEFORE this turn's first message so the next real message
    // re-includes the stopped turn's text (see the extension above). `since`
    // still holds the pre-turn cursor value at this point.
    setRouterState('orchestrator:stopped_turn_since', since);
    logger.info('Agent run stopped by user; no reply delivered — turn marked for requeue on next message');
    return;
  }

  let rawText = cleanAgentText(output.text);
  // Agent-runner emits JSON: {"status":"success","result":"..."} — extract the text.
  // If result is null/empty/non-string, the agent produced no user-facing reply — drop it
  // rather than forwarding the raw envelope (e.g. '{"status":"success","result":null}') to the chat.
  let spontaneousDigest = false;
  let delegated = false;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.result === 'string' && parsed.result.trim()) {
        rawText = cleanAgentText(parsed.result);
      } else {
        rawText = '';
      }
      // Digest turns (inbox draining — no user message prompted them) deliver
      // through the runner's send_message path. If a user message arrived
      // concurrently and left a resolve pending, this OUTPUT would ALSO be
      // delivered below — the double report observed 2026-08-24. Suppress here.
      if (parsed.spontaneous === true) spontaneousDigest = true;
      // The runner flagged that a background subagent is still running when this
      // OUTPUT was emitted — the task's chain is not finished yet. The host must
      // NOT mark the agent_task done here; the final non-delegated turn will.
      if (parsed.delegated === true) delegated = true;
    }
  } catch { /* not JSON, use as-is */ }
  const text = rawText;
  if (spontaneousDigest) {
    logger.info('spontaneous (digest) OUTPUT suppressed — send_message path owns digest delivery');
    if (activeTask && !delegated) finishAgentTask(activeTask.id, 'done');
    return;
  }
  if (!text) {
    if (output.error) {
      logger.warn(
        { error: output.error, exitCode: output.exitCode },
        'Agent returned no text + an error',
      );
      if (activeTask) finishAgentTask(activeTask.id, 'stopped');
    } else if (activeTask && !delegated) {
      finishAgentTask(activeTask.id, 'done');
    }
    return;
  }

  await deliverReply(text);
  if (activeTask && !delegated) finishAgentTask(activeTask.id, 'done');

  // Mercury compaction now runs on the 2s poll loop (maybeScheduleMercury in
  // startMessageLoop) on a time/downtime schedule — not after every turn.

  // Memory writeback (Mercury's durable-memory half): distill durable facts
  // + a journal entry from this turn's conversation and append them to
  // MEMORY.md / JOURNAL.md at WORKSPACE_ROOT — which the orchestrator loads
  // next turn. Fire-and-forget; self-throttled (15-min cooldown, ≥4 new
  // messages) and non-fatal so it can never break the message loop. Skips this
  // turn if another cleaner (Mercury compaction / an Iris digest) is running,
  // and holds the cleaner lock while it runs so no cleaner starts mid-writeback.
  if (!cleanerBusy) {
    cleanerBusy = true;
    void runMemoryWriteback(OWNER_JID)
      .catch(() => { /* already logs internally */ })
      .finally(() => { cleanerBusy = false; });
  }

  // Push a notification so the dashboard SSE can react even if it polls slowly.
  pushNotification('owner', {
    type: 'chat_complete',
    message: text,
    from: OWNER_JID,
  });
}

// Bare stop commands a user can send as a chat message (Telegram/voice) to
// kill an in-flight agent run. STOP_COMMAND_RE is imported from agent-spawn
// (shared with the /api/messages hard-kill path so both match identically).

// ── Iris digest task seeding ──────────────────────────────────────────────
// Three recurring tasks (hourly/daily/weekly) that ask Iris to compile a
// digest and POST it to /api/summaries, feeding the dashboard digest panel.
// The scheduler injects each prompt into the owner chat; the orchestrator
// routes it to Iris. Cron times are deliberately off the :00 mark so the
// fleet-wide API doesn't all hit at once. Idempotent via stable ids.
const IRIS_DIGEST_TASKS = [
  {
    id: 'iris-digest-hourly',
    cron: '7 * * * *',
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nWINDOW: This is the HOURLY digest. Only consider activity in the LAST HOUR (emails received in the last hour; calendar events in the next 2 hours; tasks that were created, completed, or updated in the last hour). Do NOT mention the user bio, sleep schedule, daily routine, or long-running projects unless something about them changed in the last hour.\n\nGROUNDING: Use only facts in INPUT or in the email read results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call email with action="read" and the `since` and `before` values copied verbatim from the INPUT "Email window (UTC)" line (limit 50, preview_only true). Do not invent your own timestamps.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or the email read results, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nACTIONABLE EXTRACTION: From the emails you read with email action="read", also extract concrete actionable items the user must do or attend. This is separate from the "Recent Emails" display block — these drive task/event creation.\n- A task is a concrete to-do the user must do, expressed as an action the user performs: prepare, make sure, get ready, confirm, review, send, schedule, fix, follow up, deliver, pay, book, submit. Put "due" in ISO only when the message states a deadline; leave it empty otherwise.\n- An event is a scheduled meeting, appointment, or dated occasion the user will attend, where the date and start time are stated inside the message. Title it with the scheduled thing itself (a demo, a review, an appointment). Put "start" in ISO using that stated meeting time. Put "end" in ISO when an end time is stated; leave it empty otherwise. The receive/arrival date of an email is metadata — it is NEVER an event start time. Promotional emails, receipts, newsletters, account alerts, shipping notices, and automated reminders are NOT items.\n- A single message may yield both an event and a task. The scheduled thing at a stated time is an event; a readiness or follow-up action around it (prepare, make sure, get ready, confirm, follow up) is a separate task.\n- Set "project_hint" to "personal", "work", or a project name when the item clearly belongs to one; leave it empty otherwise.\n- Extract only items explicitly stated in the emails. Greetings, questions, opinions, status updates, and automated/bot-sent messages are not items. Empty arrays are the correct answer when nothing is actionable. Do not invent items.\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing, and [] for the actionable arrays when nothing is actionable):\n{"title":"<current date and time as shown in INPUT>","summary":"<one or two sentences in markdown about what happened in the LAST HOUR only — or say it was quiet>","alerts":[],"blocks":[{"icon":"inbox","label":"Recent Emails","type":"list","items":["From: <sender>: <subject> (<time>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing in the next 2 hours."]},{"icon":"tasks","label":"Active Tasks","type":"list","items":["No active tasks."]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}],"actionable_tasks":[{"title":"","due":"","project_hint":""}],"actionable_events":[{"title":"","start":"","end":""}]}',
  },
  {
    id: 'iris-digest-daily',
    cron: '17 21 * * *',
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nGROUNDING: Use only facts in INPUT or in the email read results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call email with action="read" and the `since` and `before` values copied verbatim from the INPUT "Email window (UTC)" line (limit 100, preview_only true). Do not invent your own timestamps.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or the email read results, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing):\n{"title":"<date from INPUT>","summary":"<Start with: Good morning. Then one or two sentences briefing Dominic on today — calendar events, active tasks, and notable emails. Do NOT mention sleep schedule, wake times, or daily routine.>","alerts":[],"blocks":[{"icon":"review","label":"Day in Review","type":"prose","text":"<one or two sentences on calendar events, tasks, and emails for today from INPUT/emails — or empty if there is no data. Do not mention sleep schedule or daily routine.>"},{"icon":"inbox","label":"Recent Emails","type":"list","items":["From: <sender>: <subject> (<time>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing on the calendar today."]},{"icon":"tasks","label":"Active Tasks","type":"list","items":["No active tasks."]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"tomorrow","label":"Tomorrow","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}]}',
  },
  {
    id: 'iris-digest-weekly',
    cron: '30 20 * * 0',
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nGROUNDING: Use only facts in INPUT or in the email read results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call email with action="read" and the `since` and `before` values copied verbatim from the INPUT "Email window (UTC)" line (limit 200, preview_only true). Do not invent your own timestamps. Pick the 6-10 most relevant. For each picked email, write its list item from that email\'s actual snippet/body in the email read result — one short line saying what the email is about, grounded in its content. Do not invent details the email does not contain.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or the email read results, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing). Every "items" entry in every block is ONE plain string — never an object, never a nested list:\n{"title":"<week-of date from INPUT>","summary":"<two or three sentences in markdown summarizing the shape of the week, from INPUT/emails>","alerts":[],"blocks":[{"icon":"review","label":"Week in Review","type":"prose","text":"<two or three sentences on the shape of the week from INPUT/emails, or empty if there is no data>"},{"icon":"inbox","label":"Email Activity","type":"list","items":["From: <sender>: <subject> (<date>) — <one short line saying what the email says, from its snippet/body>"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing on the calendar this week."]},{"icon":"tasks","label":"Tasks","type":"list","items":["[status] <title>"]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}]}',
  },
];

function seedIrisDigestTasks(): void {
  const existing = new Map((getAllTasks() ?? []).map((t) => [t.id, t]));
  for (const t of IRIS_DIGEST_TASKS) {
    const found = existing.get(t.id);
    // The span belongs in the URL path (?span=hourly) so the orchestrator
    // can't drop it — the first cut put it in the body and the orchestrator
    // posted hourly digests tagged "daily", leaving the Hourly tab empty.
    // Re-sync only the PROMPT on already-seeded tasks so prompt fixes
    // propagate without deleting/recreating the task. The cron is NOT
    // re-synced — the user customizes it from the dashboard Schedules tab
    // (PATCH /api/tasks/:id → schedule_value), and overwriting it here with
    // the baked default would revert their chosen time on every restart.
    if (found) {
      if (found.prompt !== t.prompt) {
        updateTask(t.id, { prompt: t.prompt });
        logger.info({ taskId: t.id }, 'updated Iris digest task prompt');
      }
      continue;
    }
    const task: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
      id: t.id,
      chat_jid: OWNER_JID,
      prompt: t.prompt,
      schedule_type: 'cron',
      schedule_value: t.cron,
      context_mode: 'isolated',
      next_run: computeNextRun({
        id: t.id, chat_jid: OWNER_JID, prompt: t.prompt,
        schedule_type: 'cron', schedule_value: t.cron,
        context_mode: 'isolated', next_run: null,
        last_run: null, last_result: null, status: 'active', created_at: '',
      }),
      status: 'active',
      created_at: new Date().toISOString(),
    };
    createTask(task);
    logger.info({ taskId: t.id, cron: t.cron }, 'seeded Iris digest task');
  }
}

// ── Iris digest: direct Iris spawn (no orchestrator, no chat pipeline) ──────
// runDigest(span) spawns the Iris sub-agent DIRECTLY with a grounded prompt
// (buildDigestContext + the baked digest prompt). Iris compiles the digest and
// publishes it to the dashboard via post_summary (keyless loopback to
// /api/summaries). Nothing is written to the chat and the orchestrator model is
// never involved — this is a hardcoded function, not a routed task. Fired by
// checkDigestsDue() (the host poll loop's schedule monitor) and by the dashboard
// "Generate" button (deps.triggerDigest). The three schedules + prompts live in
// IRIS_DIGEST_TASKS above, baked into TS — no scheduled_tasks DB rows.
const DIGEST_SPANS = ['hourly', 'daily', 'weekly'] as const;
type DigestSpan = (typeof DIGEST_SPANS)[number];

// Default digest prompts + crons. These are seeded as scheduled_tasks rows on
// first boot and re-synced when the code prompt changes. The ACTIVE cron is read
// from the scheduled_tasks row (via getTaskById) so the user can edit it from the
// schedule UI; this keeps the row visible alongside other recurring automations.
function getDigestTaskCron(span: string): string {
  const t = getTaskById(`iris-digest-${span}`);
  if (t?.schedule_value) return t.schedule_value;
  const baked = IRIS_DIGEST_TASKS.find((x) => x.id === `iris-digest-${span}`);
  return baked?.cron || '';
}

function digestCallbacks(span: string): CallbackMap {
  // Minimal: only read_emails (Iris may call it once for recent inbox
  // activity). Iris compiles + outputs the digest as its final text and the
  // agent-runner publishes that text to /api/summaries directly — so there is
  // no post_summary/ipc callback here, and no send_message (a digest must not
  // write to the chat).
  const base = buildAgentCallbacks();
  return {
    read_emails: base.read_emails!,
    // The runner calls this after publishing to /api/summaries so the host can
    // optionally echo the digest into the chat (TTS reads it out loud).
    digest_complete: async (args: any) => {
      const text = String(args?.text || '');
      if (!text) return { ok: false };
      // The hourly digest's second job: extract actionable tasks/events from
      // the digest JSON Iris emitted and create real rows (deduped). Runs even
      // when the digest is silent (manual generate). Daily/weekly don't extract.
      if (span === 'hourly') {
        try {
          const json = extractFirstJsonObject(text);
          const parsed = json ? JSON.parse(json) : null;
          if (parsed) {
            const counts = createActionableItems(parsed);
            if (counts.created || counts.skipped) {
              logger.info({ span, ...counts }, 'digest_complete: actionable items extracted');
            }
          }
        } catch (err: any) {
          logger.warn({ span, err }, 'digest_complete: actionable extraction failed (non-fatal)');
        }
      }
      // Manual "Generate" clicks are always silent (dashboard only). Scheduled
      // runs speak when digest:talk:<span> is true.
      if (!digestTalk(span)) return { ok: true, silent: true };
      try {
        const digestText = extractSpeakableDigest(text, span, 1200);
        storeMessage({
          id: `digest-${span}-${Date.now()}`,
          chat_jid: OWNER_JID,
          sender: ASSISTANT_NAME,
          sender_name: ASSISTANT_NAME,
          content: `Iris ${span} digest:\n\n${digestText}`,
          timestamp: new Date().toISOString(),
          is_from_me: false,
          is_bot_message: true,
          channel: 'web',
        } as NewMessage);
        // Push the same notification path normal agent replies use so the voice
        // client (and dashboard SSE) will speak/read this digest out loud.
        pushNotification('owner', { type: 'chat_complete', message: digestText, from: OWNER_JID });
        return { ok: true };
      } catch (err: any) {
        logger.warn({ span, err }, 'digest_complete: failed to store spoken digest');
        return { ok: false, error: err?.message ?? String(err) }; // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    },
  };
}


async function runDigest(span: string, manual = false): Promise<{ ok: boolean; error?: string }> {
  if (!DIGEST_SPANS.includes(span as DigestSpan)) {
    return { ok: false, error: `invalid span: ${span}` };
  }
  // Deterministic digest (2026-09-09): built by code from real data — the
  // host's own read_emails, calendar, work tasks, wttr.in weather, and
  // LOOK_OUT_FOR.md — with NO model in the loop. The granite toolcall model
  // authored the digest before and fabricated emails/events to fill blocks
  // with no data ("Ollama Team plan", "DeepSeek price drop" — none real).
  // runDigest assembles the JSON the dashboard renders and publishes it to
  // /api/summaries over the same keyless loopback the agent-runner used, then
  // runs the digest_complete callback (hourly actionable extraction + the
  // digest:talk voice path) so spoken digests keep working.
  logger.info({ span, manual }, 'runDigest: building deterministic digest (no model)');
  try {
    const base = buildAgentCallbacks();
    const digest = await buildDeterministicDigest(span as DigestSpan, base.read_emails!);
    const text = JSON.stringify(digest);
    const port = process.env.STATUS_PORT || '3200';
    const res = await fetch(`http://127.0.0.1:${port}/api/summaries?span=${encodeURIComponent(span)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      logger.warn({ span, status: res.status }, 'runDigest: publish to /api/summaries failed');
      return { ok: false, error: `publish failed: HTTP ${res.status}` };
    }
    logger.info({ span, status: res.status }, 'runDigest: published deterministic digest to /api/summaries');
    await digestCallbacks(span).digest_complete({ text });
    return { ok: true };
  } catch (err: any) {
    logger.warn({ span, err }, 'runDigest: deterministic digest failed');
    return { ok: false, error: String(err?.message ?? err) };
  }
}

function digestTalk(span: string): boolean {
  return getRouterState(`digest:talk:${span}`) === 'true';
}
function setDigestTalk(span: string, talk: boolean): void {
  setRouterState(`digest:talk:${span}`, talk ? 'true' : 'false');
}

// Convert the structured JSON digest Iris emits into plain, speakable prose for
// the chat channel / TTS. Keeps only the human-readable summary and any alerts;
// never dumps raw JSON or markdown tables into chat.
// Extract the first balanced {...} JSON object from text that may carry a
// trailing extra brace or surrounding prose/fences. Granite sometimes emits
// a stray '}' after the object; the old slice(first '{', last '}') swallowed
// it, JSON.parse threw, and the fallback then read the raw JSON aloud —
// icons, labels, blocks and all. This scans braces (respecting string
// literals) and returns exactly the first complete object.
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractSpeakableDigest(raw: string, span: string, maxLen = 1200): string {
  const json = extractFirstJsonObject(raw);
  let parsed: any;
  try {
    parsed = json ? JSON.parse(json) : null;
  } catch (e: any) {
    throw new Error(`${span} digest JSON parse failed: ${e.message}`);
  }
  const summary = String(parsed?.summary ?? '').trim();
  if (!summary) throw new Error(`${span} digest has no summary field`);
  return summary.length > maxLen
    ? summary.slice(0, maxLen).replace(/\s+\S*$/, '') + '…'
    : summary;
}

// The hourly digest's second job: create real work-task / calendar-event rows
// from the `actionable_tasks` / `actionable_events` arrays Iris emitted in the
// digest JSON. This replaces the old separate chat-scan subagent — finding
// actionable items is now just another part of Iris's hourly task. Rows are
// deduped against the existing tables (taskAlreadyExists / eventAlreadyExists)
// and created with confirmed=0 (awaiting review in Ops -> Inbox) unless
// scan:auto_accept is on. Non-fatal: a parse/extract failure never blocks the
// speakable digest.
function createActionableItems(parsed: any): { created: number; pending: number; skipped: number } {
  const confirmed = scanAutoAccept() ? 1 : 0;
  let created = 0, pending = 0, skipped = 0;
  const addTask = (t: any) => {
    const title = String(t?.title || '').trim();
    if (!title) { skipped++; return; }
    if (taskAlreadyExists(title)) { skipped++; return; }
    const item: ExtractedItem = {
      kind: 'task', title, due: t?.due || undefined,
      project_hint: t?.project_hint || undefined, source: 'email', span: 'hourly',
    };
    const r = createTaskFromItem(item, confirmed);
    if (r.ok) { created++; if (!confirmed) pending++; }
    else { logger.warn({ err: r.error, title }, 'createActionableItems: create task failed'); skipped++; }
  };
  const addEvent = (e: any) => {
    const title = String(e?.title || '').trim();
    const start = String(e?.start || '').trim();
    if (!title || !start) { skipped++; return; }
    if (eventAlreadyExists(title, start)) { skipped++; return; }
    const item: ExtractedItem = {
      kind: 'event', title, start, end: e?.end || undefined,
      source: 'email', span: 'hourly',
    };
    const r = createEventFromItem(item, confirmed);
    if (r.ok) { created++; if (!confirmed) pending++; }
    else { logger.warn({ err: r.error, title }, 'createActionableItems: create event failed'); skipped++; }
  };
  (parsed?.actionable_tasks || []).forEach(addTask);
  (parsed?.actionable_events || []).forEach(addEvent);
  return { created, pending, skipped };
}

// The host poll loop (startMessageLoop) calls this every tick. It checks the
// baked-in cron schedules against each span's last-run timestamp (kept in
// router_state) and fires runDigest when one is due. No separate timer thread
// — this rides the existing 2s poll. Each span fires once per due slot then
// advances lastrun to now, so missed slots do NOT catch up in a storm.
let digestMonitorBusy = false;
async function checkDigestsDue(): Promise<void> {
  if (digestMonitorBusy) return;
  digestMonitorBusy = true;
  try {
    const now = Date.now();
    for (const t of IRIS_DIGEST_TASKS) {
      const span = t.id.replace('iris-digest-', '');
      // Respect the Sched UI pause/resume toggle: if the scheduled_tasks row
      // is paused (or missing), skip this span. The row is seeded at boot, so
      // missing only happens if the user deleted it (guarded in the UI).
      const row = getTaskById(t.id);
      if (row && row.status !== 'active') continue;
      const lastrunKey = `digest:lastrun:${span}`;
      const last = getRouterState(lastrunKey);
      if (!last) {
        // First boot: seed lastrun to now so the first digest fires at the next
        // cron slot, not immediately on startup.
        setRouterState(lastrunKey, new Date(now).toISOString());
        continue;
      }
      let nextFireMs: number;
      const liveCron = getDigestTaskCron(span);
      try {
        // Next cron occurrence AFTER lastrun — currentDate is the reference.
        // CronDate wraps Luxon (not a real Date); use getTime() directly.
        nextFireMs = CronExpressionParser.parse(liveCron, {
          tz: TIMEZONE,
          currentDate: new Date(last),
        }).next().getTime();
      } catch {
        continue;
      }
      if (now >= nextFireMs) {
        // Stagger against the other cleaners (Mercury compaction, memory
        // writeback): if one is running, skip this tick WITHOUT advancing
        // lastrun, so the digest retries on the next 2s tick once the lock is
        // free. (Advancing lastrun here would burn the slot entirely — the
        // digest wouldn't fire again until the NEXT cron occurrence.)
        if (cleanerBusy) continue;
        setRouterState(lastrunKey, new Date(now).toISOString());
        cleanerBusy = true;
        logger.info({ span, cron: liveCron }, 'checkDigestsDue: firing scheduled digest');
        void runDigest(span, false)
          .catch((err) => logger.warn({ span, err }, 'runDigest failed'))
          .finally(() => { cleanerBusy = false; });
      }
    }
  } finally {
    digestMonitorBusy = false;
  }
}

// ── Sentry: scheduled software-security scans ──────────────────────────────
// Sentry (reborn 2026-09-08 — the old webcam-awareness Sentry died with the
// oculus consolidation) is the antivirus-like background scanner: hourly PEEK
// (listening sockets, established connections, running services) + daily DEEP
// (adds autostart, user crontab, enabled user units, rc-file/process audit).
// It runs with NO elevated permissions — every scan command is user-readable.
// The agent runs the commands, JUDGES the output itself (it's an
// orchestrator-class model that knows what a normal Linux desktop looks like),
// and submits once via sentry_report with its suspicious flags; THAT HOST
// CALLBACK logs the scan row to sentry_scans and relays the flags, posting a
// chat message ONLY when something's wrong. No baseline, no host-side diff.
// Scheduled
// scans bypass the chat pipeline exactly like the iris digests: scheduled_tasks
// rows (visibility + cron editing in the Sched UI) fired by checkSentryDue()
// on the poll loop, spawning the sentry child directly. Clean scans are silent.

function resolveSentryModel(): string {
  // Sentry has its own model wire (sentry:model — the dashboard Sentry row).
  // Unset, it inherits the ORCHESTRATOR model — never the shared toolcall
  // wire, which is the small model this setting exists to get away from.
  return (getRouterState('sentry:model') || getRouterState('orchestrator:model') || '')
    .trim().replace(/^local:/, '');
}

const SENTRY_TASK_DEFS = [
  { id: 'sentry-peek', mode: 'peek' as const, cron: '23 * * * *', prompt: 'Run a PEEK (fast) security scan of the PC: listening sockets, established connections, running services. Collect every category, then submit the inventory once with sentry_report.' },
  { id: 'sentry-deep', mode: 'deep' as const, cron: '17 4 * * *', prompt: 'Run a DEEP (full) security scan of the PC: listening sockets, established connections, running services, autostart entries, user crontab, enabled user units, shell rc files, and a process audit. Collect every category, then submit the inventory once with sentry_report.' },
];

function seedSentryTasks(): void {
  const existing = new Map((getAllTasks() ?? []).map((t) => [t.id, t]));
  for (const t of SENTRY_TASK_DEFS) {
    const found = existing.get(t.id);
    // Same re-sync policy as the Iris digests: prompt fixes propagate, the
    // cron does NOT (the user customizes it in the Sched UI and a re-seed
    // would revert their chosen time on every restart).
    if (found) {
      if (found.prompt !== t.prompt) {
        updateTask(t.id, { prompt: t.prompt });
        logger.info({ taskId: t.id }, 'updated Sentry scan task prompt');
      }
      continue;
    }
    createTask({
      id: t.id,
      chat_jid: OWNER_JID,
      prompt: t.prompt,
      schedule_type: 'cron',
      schedule_value: t.cron,
      context_mode: 'isolated',
      next_run: computeNextRun({
        id: t.id, chat_jid: OWNER_JID, prompt: t.prompt,
        schedule_type: 'cron', schedule_value: t.cron,
        context_mode: 'isolated', next_run: null,
        last_run: null, last_result: null, status: 'active', created_at: '',
      }),
      status: 'active',
      created_at: new Date().toISOString(),
    });
    logger.info({ taskId: t.id, cron: t.cron }, 'seeded Sentry scan task');
  }
}

let sentryScanBusy = false;
// True once checkSentryDue has run at least once this process lifetime. The
// first check after boot SKIPS overdue catch-up: a scan slot missed while
// Warden was down has nothing to report the next slot won't, and firing it on
// restart made every mid-hour restart trigger an immediate scan.
let sentryBootChecked = false;

/** Fire a Sentry scan (peek or deep) as a direct background child spawn — no
 *  orchestrator, no chat pipeline. Used by checkSentryDue() for the scheduled
 *  scans; also exported so an API route / future automation can trigger one. */
export function runSentryScan(mode: 'peek' | 'deep'): { ok: boolean; error?: string } {
  const model = resolveSentryModel();
  if (!model) {
    logger.warn({ mode }, 'runSentryScan: no sentry model configured (sentry:model) — skipping');
    return { ok: false, error: 'no sentry model configured (set sentryModel in the Agents panel)' };
  }
  const baked = SENTRY_TASK_DEFS.find((t) => t.mode === mode);
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localNow = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
  // Already-announced findings (sentry:reported) go to the model verbatim so a
  // recurring item can be phrased EXACTLY the same — the host silences exact
  // repeats, and paraphrases would defeat that. The host only relays; the
  // model stays the analyst.
  let alreadyReported = '';
  try {
    const reported = JSON.parse(getRouterState('sentry:reported') || '[]');
    if (Array.isArray(reported) && reported.length) {
      alreadyReported =
        `\nFindings already announced to the user (they stay silenced unless your wording matches exactly — if one of these is still present, re-flag it VERBATIM from this list; only list it again if it got worse):\n` +
        reported.map((r: string) => `- ${r}`).join('\n') + '\n\n';
    }
  } catch { /* unparseable dedup state — scan without it */ }
  const task =
    `Current local time is ${localNow} (timezone ${tz}).\n\n` +
    `${baked?.prompt ?? 'Run a security scan of the PC, then submit the inventory once with sentry_report.'}\n\n` +
    alreadyReported +
    `This is a scheduled ${mode} scan. Submit your inventory with sentry_report and stop.`;
  logger.info({ mode, model }, 'runSentryScan: spawning sentry directly');
  runSubAgentBackground({
    agent: 'sentry',
    prompt: task,
    model,
    sessionId: 'owner',
    workspaceRoot: WORKSPACE_ROOT,
    chatJid: OWNER_JID,
    groupFolder: 'owner',
    isMain: true,
    timeoutMs: 10 * 60 * 1000, // deep scans run many read commands; generous but bounded
    callbacks: buildAgentCallbacks(),
  } as any);
  return { ok: true };
}

/** Scheduled-scan monitor, riding the same poll loop as checkDigestsDue().
 *  Fires runSentryScan(mode) when the live cron (from the scheduled_tasks row,
 *  so the user can edit it in the Sched UI) is due. Pause/resume via the row
 *  status. Never throws, never blocks message pickup. */
function checkSentryDue(): void {
  if (sentryScanBusy) return;
  sentryScanBusy = true;
  const firstCheck = !sentryBootChecked;
  sentryBootChecked = true;
  try {
    const now = Date.now();
    for (const t of SENTRY_TASK_DEFS) {
      const row = getTaskById(t.id);
      if (row && row.status !== 'active') continue;
      const cron = row?.schedule_value || t.cron;
      const lastrunKey = `sentry:lastrun:${t.mode}`;
      const last = getRouterState(lastrunKey);
      if (!last) {
        // First boot: seed lastrun to now so the first scan fires at the next
        // cron slot, not immediately on startup.
        setRouterState(lastrunKey, new Date(now).toISOString());
        continue;
      }
      let nextFireMs: number;
      try {
        nextFireMs = CronExpressionParser.parse(cron, {
          tz: TIMEZONE,
          currentDate: new Date(last),
        }).next().getTime();
      } catch {
        continue;
      }
      if (now >= nextFireMs) {
        setRouterState(lastrunKey, new Date(now).toISOString());
        if (firstCheck) {
          // Overdue slot missed while Warden was down — advance the schedule
          // and wait for the next slot instead of catch-up firing on boot.
          logger.info({ mode: t.mode }, 'checkSentryDue: overdue slot missed while Warden was down — skipping catch-up scan, next scan at the next cron slot');
          continue;
        }
        logger.info({ mode: t.mode, cron }, 'checkSentryDue: firing scheduled security scan');
        try {
          runSentryScan(t.mode);
        } catch (err) {
          logger.warn({ mode: t.mode, err }, 'runSentryScan failed');
        }
      }
    }
  } finally {
    sentryScanBusy = false;
  }
}

// ── Actionable extraction (part of Iris's hourly digest) ────────────────
// Iris's hourly digest emits actionable_tasks / actionable_events in its JSON;
// the host creates real work-task / calendar-event rows from them (see
// createActionableItems above, called from digest_complete). The helpers below
// (dedup + create) are reused by that path. There is no separate scan agent —
// this used to be a standalone chat-scan subagent and has been removed.

// An item Iris extracted from email. The host creates a real row (work task or
// calendar event) for each of these immediately — there is no separate
// confirmation queue. `confirmed` flags rows the user hasn't green-checked yet
// (0 = awaiting review in Ops -> Inbox, 1 = confirmed).
interface ExtractedItem {
  kind: 'task' | 'event';
  title: string;
  due?: string;          // task
  start?: string;        // event
  end?: string;          // event
  project_hint?: string; // task
  source: string;        // 'email' | 'chat'
  span: string;
}

interface ScanInbox {
  tasks: any[];           // unconfirmed user_work_tasks rows (confirmed = 0)
  events: any[];          // unconfirmed calendar_events rows (confirmed = 0)
  autoConfirm: boolean;
}

function scanAutoAccept(): boolean {
  return getRouterState('scan:auto_accept') === 'true';
}

// Dedup guard: skip a task whose title already exists (case-insensitive,
// trimmed) in the work-task table — regardless of confirmed state, so a re-scan
// never stacks a duplicate on top of an unconfirmed row awaiting review.
function taskAlreadyExists(title: string): boolean {
  const norm = title.trim().toLowerCase();
  if (!norm) return true;
  try {
    return getWorkTasks().some((t) => (t.title || '').trim().toLowerCase() === norm);
  } catch { return false; }
}

// Dedup guard for events: same title + same start time already on the local
// calendar (any confirmed state).
function eventAlreadyExists(title: string, start: string): boolean {
  const norm = title.trim().toLowerCase();
  if (!norm) return true;
  try {
    return listCalendarEvents({ start, end: start }).some(
      (e) => (e.title || '').trim().toLowerCase() === norm && (e.start_time || '') === start,
    );
  } catch { return false; }
}

// Create a real work task from an extracted item. project_hint resolves to
// an existing project by name; anything that doesn't match lands in the
// Personal catch-all (never fails). `confirmed` is 0 for scanned rows awaiting
// user review, 1 when auto-confirm is on.
function createTaskFromItem(item: ExtractedItem, confirmed: number): { ok: boolean; id?: string; error?: string } {
  try {
    const title = (item.title || '').trim();
    if (!title) return { ok: false, error: 'missing title' };
    const hint = (item.project_hint || '').trim();
    let projectId = '';
    if (hint) {
      const resolved = resolveProjectId(hint) || hint;
      if (getProject(resolved)) projectId = resolved;
    }
    if (!projectId) projectId = PERSONAL_PROJECT_ID;
    const task = createWorkTask({
      title,
      description: `Extracted by Actionable scan (${item.source}, ${item.span} window).`,
      priority: 'medium',
      created_by: OWNER_JID,
      due_date: item.due || undefined,
      project_id: projectId,
      confirmed,
    });
    return { ok: true, id: task.id };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// Create a local-only calendar event from an extracted item.
function createEventFromItem(item: ExtractedItem, confirmed: number): { ok: boolean; id?: string; error?: string } {
  try {
    const title = (item.title || '').trim();
    const start = item.start || '';
    if (!title || !start) return { ok: false, error: 'missing title/start' };
    const icalUid = `scan-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ev = createCalendarEvent({
      title,
      description: `Extracted by Actionable scan (${item.source}, ${item.span} window).`,
      start_time: start,
      end_time: item.end || undefined,
      all_day: false,
      calendar_source: 'local',
      ical_uid: icalUid,
      confirmed,
    });
    return { ok: true, id: String(ev.id) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ── Inbox + confirm exposed to the API (deps callbacks) ──────────────────
// Scanned items live in the real tables with confirmed=0 until the user green-
// checks them in Ops -> Inbox. "Confirm" flips confirmed to 1 (the row stays in
// the table, it just graduates out of the Inbox). "Delete" is the existing
// DELETE /api/work-tasks/:id or /api/calendar/events/:id, fired from the UI.

function getScanInbox(): ScanInbox {
  let tasks: any[] = [];
  let events: any[] = [];
  try { tasks = getWorkTasks().filter((t) => !t.confirmed); } catch { /* ignore */ }
  try { events = listCalendarEvents().filter((e) => !e.confirmed); } catch { /* ignore */ }
  return { tasks, events, autoConfirm: scanAutoAccept() };
}

function confirmScanItem(kind: 'task' | 'event', id: string): { ok: boolean; error?: string; result_id?: string } {
  try {
    if (kind === 'task') {
      const t = updateWorkTask(id, { confirmed: 1 });
      if (!t) return { ok: false, error: 'task not found' };
      return { ok: true, result_id: id };
    } else {
      const e = updateCalendarEvent(id, { confirmed: 1 } as any);
      if (!e) return { ok: false, error: 'event not found' };
      return { ok: true, result_id: id };
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

function setScanConfig(cfg: { autoAccept?: boolean }): void {
  if (cfg.autoAccept !== undefined) setRouterState('scan:auto_accept', cfg.autoAccept ? 'true' : 'false');
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;
  logger.info(`Warden running (single chat: ${OWNER_JID})`);

  // The agent run is fired without awaiting so this loop keeps polling while
  // it works — otherwise a long run (e.g. an atlas delegation) blocks message
  // pickup entirely and a chat "stop" can't take effect until it finishes.
  // The flag guards re-entry: exactly one run at a time.
  let agentRunInFlight = false;

  while (true) {
    try {
      const { messages, newTimestamp } = getNewMessages(
        [OWNER_JID],
        lastTimestamp,
        ASSISTANT_NAME,
      );
      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');
        lastTimestamp = newTimestamp;
        saveState();
        if (agentRunInFlight) {
          const stopMsg = [...messages].reverse().find((m) => STOP_COMMAND_RE.test(m.content || ''));
          if (stopMsg) {
            logger.info({ text: stopMsg.content }, 'Stop command received mid-run — interrupting agent');
            // Soft-interrupt so the warm runner child survives the stop; fall
            // back to a kill only when there is no persistent child.
            if (!cancelCurrentTurn()) killCurrentAgent();
            // Consume everything up to and including the stop message so it
            // isn't replayed as a prompt on the next tick. Messages sent
            // after the stop stay pending and start a fresh run.
            lastAgentTimestamp = stopMsg.timestamp;
            saveState();
          }
          // Non-stop messages queue as before: processOwnerMessages picks
          // them up via lastAgentTimestamp once the current run resolves.
        }
      }
      if (!agentRunInFlight) {
        agentRunInFlight = true;
        void processOwnerMessages()
          .catch((err) => logger.error({ err }, 'Error in message loop'))
          .finally(() => { agentRunInFlight = false; });
      }
      // Digest schedule monitor: rides the existing poll loop — no separate
      // timer. Fires runDigest(span) directly (Iris, no chat) when a baked-in
      // cron schedule is due. Fire-and-forget; never blocks message pickup.
      void checkDigestsDue();
      // Sentry schedule monitor: same poll-loop pattern — fires the hourly
      // peek / daily deep security scans directly as background sentry
      // spawns (no chat, no orchestrator turn) when their cron is due.
      void checkSentryDue();
      // Mercury compaction scheduler: same poll loop, time/downtime trigger.
      // Fire-and-forget; idle-gated + shared cleaner lock so it never overlaps
      // a turn or another cleaner.
      void maybeScheduleMercury();
      // Memory-tree classifier: same rider. When nothing is happening (no
      // agent run, no big model holding VRAM) it classifies the unprocessed
      // warden.log backlog into the memory tree with granite4.1:30b — runs
      // until the backlog is finished, cursor-persisted, aborts if the
      // machine is claimed again.
      void maybeClassifyMemoryTree(agentRunInFlight);
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: if messages arrived between the last agent run and a
 * crash, the cursor is stale. Roll it back so the next loop tick processes
 * them.
 */
function recoverPendingMessages(): void {
  const pending = getMessagesSince(OWNER_JID, lastAgentTimestamp, ASSISTANT_NAME);
  if (pending.length > 0) {
    logger.info(
      { pendingCount: pending.length },
      'Recovery: found unprocessed messages for owner chat',
    );
  }
}

// Dedicated persistent Chrome profile for Warden automation.
// Chrome runs as a standalone process with --remote-debugging-port. The
// agent-runner's native browser_* tools attach to it over CDP (playwright-core
// connectOverCDP); when an agent session ends the CDP connection drops but
// Chrome (and every open tab) stays alive.
// Sign into Google once; the profile persists across restarts.
const CHROME_CDP_PORT = 9222;
const WARDEN_CHROME_PROFILE = path.join(process.env.HOME ?? '/root', '.config', 'playwright-jarvis');
const CHROME_BIN = '/usr/bin/google-chrome-stable';
// Tracks whether the currently-running Chrome was launched headless (no
// graphical session existed at launch time). The watchdog watches this so it
// can relaunch Chrome headed once a session appears.
let chromeHeadless = false;

// dockbox runs as a systemd user unit without DISPLAY/XAUTHORITY in its env,
// so Chrome can't reach the X server and dies on launch. Discover the active
// session's display env from a running user process (plasmashell, kded, or
// anything with DISPLAY set) so Chrome can attach to the visible session.
function discoverDisplayEnv(): { DISPLAY?: string; XAUTHORITY?: string; WAYLAND_DISPLAY?: string; XDG_RUNTIME_DIR?: string } {
  const uid = process.getuid?.() ?? 0;
  // Prefer processes likely to own the user's graphical session.
  const candidates = ['plasmashell', 'kded', 'gnome-shell', 'Xwayland', 'Xorg', 'sway', 'i3'];
  const readEnv = (pid: string) => {
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const get = (prefix: string) => env.find((e) => e.startsWith(prefix))?.slice(prefix.length);
    return {
      DISPLAY: get('DISPLAY='),
      XAUTHORITY: get('XAUTHORITY='),
      WAYLAND_DISPLAY: get('WAYLAND_DISPLAY='),
      XDG_RUNTIME_DIR: get('XDG_RUNTIME_DIR='),
    };
  };
  for (const name of candidates) {
    try {
      const pids = execSync(`pgrep -u ${uid} -x ${name} 2>/dev/null`, { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        const e = readEnv(pid);
        if (e.DISPLAY || e.WAYLAND_DISPLAY) return e;
      }
    } catch { /* try next candidate */ }
  }
  // Fallback: scan any user process for a display (X or Wayland).
  try {
    const pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p));
    for (const pid of pids) {
      try {
        const stat = fs.statSync(`/proc/${pid}`);
        if (stat.uid !== uid) continue;
        const e = readEnv(pid);
        if (e.DISPLAY || e.WAYLAND_DISPLAY) return e;
      } catch { /* process died */ }
    }
  } catch { /* /proc unreadable */ }
  return {};
}

function spawnChrome(): void {
  // Clear stale profile locks so Chrome doesn't refuse to start after a crash.
  try {
    fs.rmSync(path.join(WARDEN_CHROME_PROFILE, 'SingletonLock'), { force: true });
    fs.rmSync(path.join(WARDEN_CHROME_PROFILE, 'SingletonSocket'), { force: true });
  } catch { /* ignore */ }
  const displayEnv = discoverDisplayEnv();
  // Run headed on the user's live graphical session so the agent-driven browser
  // is a real, visible window. Wayland is preferred (native window, no X-auth
  // dependency); XWayland is the fallback. Headless is only a safety net for a
  // session-less host — this desktop always has a Wayland session, so in
  // practice Chrome always launches headed. --disable-gpu skips EGL noise
  // headless.
  const hasWayland = !!(displayEnv.WAYLAND_DISPLAY && displayEnv.XDG_RUNTIME_DIR);
  const hasX = !!displayEnv.DISPLAY;
  const headless = !hasWayland && !hasX;
  const chromeArgs = [
    `--remote-debugging-port=${CHROME_CDP_PORT}`,
    `--user-data-dir=${WARDEN_CHROME_PROFILE}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    // Suppress the recurring "Verify it's you" Google-account sync re-auth
    // prompt: disable Chrome Sync entirely (site login cookies persist, so
    // signed-in sessions like YouTube keep working) and block the sync
    // sign-in/consent dialogs. NB: Chrome only honors the LAST --disable-features
    // flag, so all disabled features go in ONE comma-separated list.
    '--disable-sync',
    '--disable-features=Translate,LockProfileCookieDatabase,SyncSignin,SyncConsentDialog',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ];
  if (headless) {
    chromeArgs.push('--headless=new', '--disable-gpu');
  } else if (hasWayland) {
    // Native Wayland window on the user's Plasma desktop.
    chromeArgs.push('--ozone-platform=wayland');
  }
  // Launch inside a transient scope unit so Chrome lives OUTSIDE warden's
  // cgroup — a service restart kills everything in the cgroup (observed:
  // the user's window died on every restart despite the adopt-on-start
  // watchdog, because Chrome was already dead before the probe ran). With
  // Chrome in its own scope it survives restarts and the watchdog ADOPTS
  // the live instance (see startChromeWatchdog). Direct spawn is the
  // fallback when systemd-run isn't available.
  const systemdRun = '/usr/bin/systemd-run';
  const scopeLaunch = fs.existsSync(systemdRun);
  const launchBin = scopeLaunch ? systemdRun : CHROME_BIN;
  const launchArgs = scopeLaunch ? ['--user', '--scope', CHROME_BIN, ...chromeArgs] : chromeArgs;
  const child = spawn(launchBin, launchArgs, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...displayEnv },
  });
  child.on('error', (err) => logger.warn({ err }, 'Chrome spawn failed'));
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trim();
    if (line) logger.debug({ chrome: line }, 'chrome stderr');
  });
  child.on('exit', (code, signal) => {
    logger.warn({ code, signal }, 'Chrome process exited');
  });
  child.unref();
  chromeHeadless = headless;
  logger.info({ cdpPort: CHROME_CDP_PORT, headless, wayland: hasWayland, ...displayEnv }, 'Launched persistent Chrome');
}

function startChromeWatchdog(): void {
  let chromeLaunchTime = Date.now();
  let chromeFailures = 0;
  let chromeLaunched = false;

  const httpOk = (url: string, timeoutMs = 3000) =>
    new Promise<boolean>((resolve) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        resolve(res.statusCode != null && res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      setTimeout(() => { req.destroy(); resolve(false); }, timeoutMs);
    });

  function restartChrome(reason: string): void {
    logger.warn({ reason, chromeFailures }, 'Relaunching Chrome');
    try { execSync(`pkill -f "remote-debugging-port=${CHROME_CDP_PORT}" 2>/dev/null`); } catch {}
    chromeFailures = 0;
    chromeLaunchTime = Date.now();
    spawnChrome();
    chromeLaunched = true;
  }

  // Initial launch: ADOPT a live Warden Chrome if one is already running — a
  // service restart must NOT throw away the user's browser window and tabs. If
  // CDP answers on the watchdog port, that Chrome IS the persistent Warden
  // profile browser, so skip the pkill+respawn entirely and let it keep
  // running; the 15s health loop below takes over from there. Only when CDP
  // is down do we kill a stale/zombie instance and wait for the graphical
  // session to launch fresh (headed once a session exists, headless only as a
  // session-less fallback). This does not block the rest of startup.
  void (async () => {
    if (await httpOk(`http://localhost:${CHROME_CDP_PORT}/json/version`, 2000)) {
      chromeLaunched = true;
      chromeLaunchTime = Date.now();
      // Detect adopted headless instances so the health loop still flips them
      // headed once a graphical session appears.
      try {
        const body = await new Promise<string>((resolve, reject) => {
          const req = http.get(`http://localhost:${CHROME_CDP_PORT}/json/version`, { timeout: 2000 }, (res) => {
            let buf = '';
            res.on('data', (c: Buffer) => { buf += c.toString('utf8'); });
            res.on('end', () => resolve(buf));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });
        chromeHeadless = /Headless/i.test(body);
      } catch { chromeHeadless = false; }
      logger.info({ cdpPort: CHROME_CDP_PORT, headless: chromeHeadless }, 'Adopted already-running Warden Chrome — no relaunch');
      return;
    }
    // CDP unreachable: a hung Warden-profile Chrome may still hold the port or
    // profile lock — kill it before starting fresh.
    try { execSync(`pkill -f "remote-debugging-port=${CHROME_CDP_PORT}" 2>/dev/null`); } catch {}
    for (let i = 0; i < 15; i++) {
      const e = discoverDisplayEnv();
      if ((e.WAYLAND_DISPLAY && e.XDG_RUNTIME_DIR) || e.DISPLAY) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    spawnChrome();
    chromeLaunched = true;
    chromeLaunchTime = Date.now();
  })();

  // Re-check every 15 seconds; restart Chrome only after repeated failures
  // and never within a 10 s grace period after a fresh launch.
  setInterval(async () => {
    const now = Date.now();
    if (now - chromeLaunchTime < 10000) return;
    if (!chromeLaunched) return; // still waiting for the session before first launch

    // If Chrome started headless (no session yet) but one has since appeared,
    // relaunch it headed — visible window, and plasma-browser-integration-host
    // stops crashing (the Qt6 helper gets a real display instead of aborting).
    if (chromeHeadless) {
      const e = discoverDisplayEnv();
      if ((e.WAYLAND_DISPLAY && e.XDG_RUNTIME_DIR) || e.DISPLAY) {
        restartChrome('graphical session appeared — switching to headed');
        return;
      }
    }

    const chromeUp = await httpOk(`http://localhost:${CHROME_CDP_PORT}/json/version`, 3000);
    if (!chromeUp) {
      chromeFailures++;
      if (chromeFailures >= 3) {
        restartChrome('Chrome CDP unreachable');
      }
      return;
    }
    chromeFailures = 0;
  }, 15000).unref();
}


/**
 * One-time migration: materialize a concrete per-agent model + ctx for every
 * agent from the legacy shared values, so every Agents-panel dropdown is
 * populated (no blank) and the agent-runner never sees an empty key. This is a
 * MIGRATION, not a runtime fallback — it writes a real value once (only when the
 * key is empty), then runtime uses the key directly with no `||`. After this the
 * popover can't produce an empty model (the dropdown has no blank option), so a
 * per-agent key is never empty in normal use; a manually-cleared key errors
 * loudly instead of falling back.
 */
function seedPerAgentModelSettings(): void {
  const orch = getRouterState('orchestrator:model') || '';
  // MODELS ONLY. num_ctx is NEVER seeded or hardcoded here — every ctx value
  // lives in the settings (router_state local:*_ctx, written by the Agents
  // panel) and syncAgentCtxEnv copies it to the env verbatim. Baking a ctx
  // "default" here has repeatedly overridden the user's chosen settings.
  const toolcall = getRouterState('local:subagent_model')
    || getRouterState('iris:model')
    || orch;
  const atlas = getRouterState('atlas:model') || orch;
  const seed = (key: string, value: string) => {
    if (!getRouterState(key) && value) setRouterState(key, value);
  };
  // Seed the shared toolcall model (the real runtime source for the toolcall
  // agents: Iris, Sentry). ctx is NOT seeded — settings only.
  seed('local:subagent_model', toolcall);
  // Orchestrator has historically been resident (keep_alive -1); materialize that
  // as the default so the checkbox reflects reality. Toolcall/Atlas stay unset →
  // the runner defaults to 300 (their historic sub-agent TTL).
  seed('local:orch_keep_alive', '-1');
  // New per-agent model keys inherit the legacy shared value.
  seed('iris:model', toolcall);
  seed('artemis:model', atlas);
  // Existing keys that previously fell back to orchestrator at runtime — seed
  // them too so that runtime fallback can be removed without breaking agents.
  seed('atlas:model', orch);
  seed('vulkan:model', orch);
  seed('mercury:model', orch);
  // Supervisor (completion-verdict) model inherits the orchestrator on first boot —
  // no blank anywhere: every dashboard model dropdown always shows a concrete
  // model. The user picks a small/cloud one afterward if they want.
  seed('supervisor:model', orch);
  // Supervisor completion verdict: on by default. Large local models
  // routinely spend 10-30 min on one task. The user can toggle it off in settings.
  seed('supervisor:enabled', 'true');
}

/**
 * Sync every per-agent num_ctx override from router_state into process.env so
 * the agent-runner child (and background spawns like Sentry, which inherit
 * ...process.env) always sees the current value. Called at boot (after the
 * migration seed, so background spawns before the first chat turn are covered)
 * and again per turn (so dashboard changes take effect immediately).
 */
export function syncAgentCtxEnv(): void {
  process.env.ORCHESTRATOR_NUM_CTX = getRouterState('local:orchestrator_ctx') || '';
  process.env.SUBAGENT_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.ATLAS_NUM_CTX = getRouterState('local:atlas_ctx') || '';
  process.env.TOOLS_NUM_CTX = getRouterState('local:tools_ctx') || '';
  // Iris has its own ctx row in Settings (local:iris_ctx). Until a per-agent
  // value is saved it inherits the shared toolcall ctx (local:subagent_ctx)
  // so behavior is unchanged. Reading the per-agent key here (and the host
  // re-syncing env per turn before runAgent) is what lets the dropdown
  // override the spawn-time 32k the persistent child was locked to.
  process.env.IRIS_NUM_CTX =
    getRouterState('local:iris_ctx') || getRouterState('local:subagent_ctx') || '';
  process.env.ARTEMIS_NUM_CTX = getRouterState('local:artemis_ctx') || '';
  process.env.VULKAN_NUM_CTX = getRouterState('local:vulkan_ctx') || '';
  // Mercury has its own ctx row in Settings. Until a per-agent value is saved
  // it inherits the shared toolcall ctx so effective behavior is unchanged.
  process.env.MERCURY_NUM_CTX =
    getRouterState('local:mercury_ctx') || getRouterState('local:subagent_ctx') || '';
  process.env.SENTRY_NUM_CTX =
    getRouterState('local:sentry_ctx') || getRouterState('local:orchestrator_ctx') || '';
  // Per-agent Ollama keep_alive (-1 = resident, 300 = 5 min).
  process.env.ORCHESTRATOR_KEEP_ALIVE = getRouterState('local:orch_keep_alive') || '';
  process.env.ATLAS_KEEP_ALIVE = getRouterState('local:atlas_keep_alive') || '';
  process.env.TOOLCALL_KEEP_ALIVE = getRouterState('local:toolcall_keep_alive') || '';
}

/**
 * Fire-and-forget Ollama model warmup at boot. Every model configured to stay
 * resident (keep_alive = -1) gets a trivial /api/generate so the first real
 * message doesn't pay a multi-minute cold load. Only the models that should
 * stay resident: orchestrator, atlas, and the shared toolcall model when
 * local:toolcall_keep_alive is -1. Cloud models are excluded (no VRAM to warm).
 * Retries /api/ps until Ollama is reachable (it may still be starting).
 */
async function warmResidentOllamaModels(): Promise<void> {
  // Wait for Ollama to answer (service may start before Ollama is up).
  let up = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/ps`);
      if (res.ok) { up = true; break; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!up) {
    logger.warn('Ollama unreachable after 60s — skipping model warmup');
    return;
  }

  const candidates = [
    getRouterState('orchestrator:model'),
    getRouterState('atlas:model'),
    getRouterState('local:toolcall_keep_alive') === '-1'
      ? getRouterState('local:subagent_model')
      : '',
  ];
  const toWarm = [
    ...new Set(
      candidates
        .map((m) => (m || '').replace(/^local:/, '').trim())
        .filter((m) => m && !/cloud/i.test(m)),
    ),
  ];
  for (const model of toWarm) {
    try {
      // Warm at the SAME num_ctx the settings page configures for this model —
      // a warmup load at Ollama's default ctx creates a resident instance that
      // the first real request (at the settings ctx) immediately discards and
      // reloads, defeating the warmup. ctx is 100% settings-derived: no literal.
      const ctxFor = (m: string): number | undefined => {
        if (m === (getRouterState('local:subagent_model') || '').replace(/^local:/, '').trim()) {
          const n = parseInt(getRouterState('local:subagent_ctx') || '', 10);
          return n > 0 ? n : undefined;
        }
        if (m === (getRouterState('orchestrator:model') || '').replace(/^local:/, '').trim()) {
          const n = parseInt(getRouterState('local:orchestrator_ctx') || '', 10);
          return n > 0 ? n : undefined;
        }
        if (m === (getRouterState('atlas:model') || '').replace(/^local:/, '').trim()) {
          const n = parseInt(getRouterState('local:atlas_ctx') || '', 10);
          return n > 0 ? n : undefined;
        }
        return undefined;
      };
      const numCtx = ctxFor(model);
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: ' ',
          keep_alive: -1,
          stream: false,
          ...(numCtx ? { options: { num_ctx: numCtx } } : {}),
        }),
      });
      logger.info({ model, ok: res.ok, numCtx: numCtx || 'native' }, 'Warmed resident Ollama model');
    } catch (err) {
      logger.warn({ model, err }, 'Model warmup failed (non-fatal)');
    }
  }
}

async function main(): Promise<void> {
  initDatabase();
  logger.info('Database initialized');
  // The auto-spawned dedicated Chrome session was disabled (2026-09-03) but
  // re-enabled after Chrome was killed during debugging. Browser-automation
  // tools attach over CDP :9222 to this persistent Chrome instance.
  startChromeWatchdog();
  loadState();
  // Seed the three Iris digest automations (hourly/daily/weekly) as
  // scheduled_tasks rows so they show in the Sched tab and the host poll loop
  // can fire them. Re-syncs the prompt/cron when the baked values change.
  seedIrisDigestTasks();
  // Seed the two Sentry security scans (hourly peek / daily deep) the same
  // way: scheduled_tasks rows for visibility + cron editing, fired by
  // checkSentryDue() on the poll loop.
  seedSentryTasks();
  // Materialize a concrete per-agent model + ctx for every agent from the
  // legacy shared values BEFORE any agent runs, so every Agents-panel dropdown
  // is populated (no blank) and the agent-runner never sees an empty key. This
  // is a migration, not a runtime fallback: it writes a real value once (only
  // when the key is empty), then runtime uses the key directly with no `||`.
  seedPerAgentModelSettings();
  syncAgentCtxEnv();
  // Warm resident Ollama models in the background (fire-and-forget) so the
  // first message after a service start doesn't pay a multi-minute cold load.
  void warmResidentOllamaModels();

  // Wire the activity publisher so agent-runner stderr thinking tokens reach
  // the dashboard's live thinking bar via SSE.
  setActivityPublisher(pushActivityLine);

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    for (const ch of channels) {
      try { await (ch as any).disconnect?.(); } catch { /* ignore */ }
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks — every channel routes inbound messages to OWNER_JID.
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => {
      // Panic word from ANY channel (Telegram/web/voice): a bare stop-word
      // hard-kills everything — current turn, all background jobs, the whole
      // agent child — and is consumed as a control word, never stored.
      if (!msg.is_bot_message && isStopWord(msg.content)) {
        const killed = killCurrentAgent(true);
        setRouterState('agent:processing', 'false');
        logger.info({ chatJid: _chatJid, text: msg.content, killed }, 'Hard-kill control word received via channel');
        return;
      }
      // Force every inbound message to OWNER_JID — the single chat.
      storeMessage({ ...msg, chat_jid: OWNER_JID });
    },
  };

  // Create and connect all registered channels. Each channel self-registers
  // via the barrel import above. Factories return null when credentials are
  // missing, so unconfigured channels are skipped.
  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(channelOpts);
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.',
      );
      continue;
    }
    try {
      await (channel as any).connect?.();
      channels.push(channel);
    } catch (err) {
      logger.error({ channel: channelName, err }, 'Channel failed to connect — skipping');
    }
  }
  if (channels.length === 0) {
    logger.fatal('No channels connected');
    process.exit(1);
  }

  // Start status server. Task 11 will slim its deps down; for now we pass
  // stubs for the group/queue fields it still expects.
  // schedulerDeps is shared with startSchedulerLoop below; the manual digest
  // trigger (POST /api/digest/generate) reuses the same grounded runTask path
  // as the cron, so Generate and the scheduled digest are one Iris behavior.
  const schedulerDeps = {
    registeredGroups: () => ({ [OWNER_JID]: { name: 'Owner', folder: 'owner', trigger: '', added_at: '', isMain: true, requiresTrigger: false } }) as any,
    queue: { enqueueMessageCheck: () => {} },
  };
  startStatusServer({
    queue: { enqueueMessageCheck() {}, enqueueTask() {}, setActiveMode() {}, getStatus: () => {
      // A turn is in flight if the host drove it (agent:processing, set in
      // processOwnerMessages around runAgent) OR the runner is running a
      // spontaneous digest turn — the report-back reply after a background job
      // finishes. Those run inside the persistent child with no runAgent
      // wrapper, so the fg statuses the runner streams are the only in-flight
      // signal the host gets (isForegroundTurnActive).
      const processing = getRouterState('agent:processing') === 'true' || isForegroundTurnActive();
      return {
        activeCount: processing ? 1 : 0,
        groups: [{
          jid: OWNER_JID,
          active: processing,
          idle: !processing,
          containerName: null,
          pendingMessages: false,
          pendingTasks: 0,
          parallelContainers: 0,
        }],
      };
    }, killIfModeChanged: () => false, closeStdin() {}, notifyIdle() {}, stopGroup() {}, isActive: () => false, sendMessage: () => false, getIdleWithPending: () => [], wasUserStopped: () => false, isKilling: () => false, shutdown: async () => {}, registerProcess() {} } as any,
    channels,
    registeredGroups: () => ({ [OWNER_JID]: { name: 'Owner', folder: 'owner', trigger: '', added_at: '', isMain: true, requiresTrigger: false } }) as any,
    startedAt: Date.now(),
    getMessagesForDashboard: (_jid: string, since: string, limit?: number, idea?: string) =>
      getMessagesForDashboard(OWNER_JID, since, limit ?? 500, idea),
    getAllTasks: () => getAllTasks(),
    storeMessage,
    sendChannelMessage: async (jid: string, text: string, _senderName?: string) => {
      const formatted = formatOutbound(text);
      if (!formatted) return;
      const channel = findChannel(channels, jid);
      if (channel) await channel.sendMessage(jid, formatted);
    },
    advanceCursor: (_jid: string, timestamp: string) => {
      lastAgentTimestamp = timestamp;
      saveState();
    },
    clearSessions: () => {
      // No-op: sessions are owned by the agent-runner child process now.
    },
    reconnectChannel: async (type: string) => {
      try {
        const factory = getChannelFactory(type);
        if (!factory) return false;
        // Remove existing channel of this type if present
        const existingIdx = channels.findIndex((c) => c.name === type);
        if (existingIdx >= 0) {
          const old = channels[existingIdx];
          try { await (old as any).disconnect?.(); } catch { /* ignore */ }
          channels.splice(existingIdx, 1);
        }
        // WhatsApp needs forceConnect to generate a QR code when creds are missing
        const isWa = type === 'whatsapp';
        const newChannel = factory({
          onMessage: (chatJid, msg) => {
            if (!msg.is_bot_message && isStopWord(msg.content)) {
              const killed = killCurrentAgent(true);
              setRouterState('agent:processing', 'false');
              logger.info({ chatJid, text: msg.content, killed }, 'Hard-kill control word received via reconnected channel');
              return;
            }
            storeMessage({ ...msg, chat_jid: OWNER_JID });
          },
          ...(isWa ? { forceConnect: true } : {}),
        });
        if (!newChannel) return false;
        try {
          await (newChannel as any).connect?.();
        } catch { /* connect is optional; some channels auto-connect in constructor */ }
        channels.push(newChannel);
        return true;
      } catch (err) {
        logger.error({ type, err }, 'reconnectChannel failed');
        return false;
      }
    },
    triggerDigest: (span: string, manual?: boolean) => runDigest(span, manual),
    getDigestConfig: () => ({
      hourly: { talk: digestTalk('hourly') },
      daily: { talk: digestTalk('daily') },
      weekly: { talk: digestTalk('weekly') },
    }),
    setDigestConfig: (cfg) => {
      for (const span of ['hourly', 'daily', 'weekly']) {
        const t = (cfg as any)?.[span]?.talk;
        if (typeof t === 'boolean') setDigestTalk(span, t);
      }
    },
    getScanInbox: () => getScanInbox(),
    confirmScanItem: (kind: 'task' | 'event', id: string) => confirmScanItem(kind, id),
    setScanConfig: (cfg: any) => { setScanConfig(cfg); },
  });

  // Start the scheduled-task loop. The scheduler no longer runs agents — it
  // injects each due task's prompt into the owner chat as a regular message
  // (attributed to Automation) and lets the normal message pipeline handle it.
  // The message loop polls the owner chat every POLL_INTERVAL, so the injected
  // prompt is picked up without an explicit poke; enqueueMessageCheck is a
  // no-op here (it exists for the GroupQueue architecture).
  startSchedulerLoop(schedulerDeps);

  // ── Iris digest tasks (hourly / daily / weekly) ───────────────────────
  // The three schedules + prompts are baked into IRIS_DIGEST_TASKS and seeded
  // as scheduled_tasks rows by seedIrisDigestTasks() (so they show in the Sched
  // UI for cron editing + pause/resume). checkDigestsDue() — riding the message
  // poll loop above — fires runDigest(span) directly (direct Iris spawn →
  // post_summary → /api/summaries). The scheduler loop skips iris-digest-*
  // rows (see task-scheduler.ts) so they can't double-fire through the chat.
  // The dashboard "Generate" button calls the same runDigest via deps.triggerDigest.

  // ── Personal catch-all project ────────────────────────────────────────
  // The system requires every work task to belong to a project. Personal is
  // the permanent default home for assorted / email-driven tasks that don't
  // fit a specific project. Seeded with a stable id; cannot be deleted,
  // archived, or completed (guarded in db.ts).
  seedPersonalProject(OWNER_JID);

  startCalendarSyncPoller();
  startCalendarReminderLoop();

  // Cap warden.log at ~5 MB in-process (trim the head, keep the tail) so the
  // log file can't fill the disk — or, on a ramdisk, eat RAM. See log-rotator.
  startLogCap(path.resolve(process.cwd(), 'logs', 'warden.log'));

  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start Warden');
    process.exit(1);
  });
}