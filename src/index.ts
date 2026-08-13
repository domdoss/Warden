import fs from 'fs';
import http from 'node:http';
import path from 'path';
import { spawn, execSync } from 'node:child_process';

import { processImage } from './image.js';

import {
  AGENT_TIMEOUT,
  ASSISTANT_NAME,
  DATA_DIR,
  OLLAMA_CHAT_MODEL,
  POLL_INTERVAL,
  TIMEZONE,
  WORKSPACE_ROOT,
} from './config.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import { runAgent, killCurrentAgent, CallbackMap, pushSupervisorNote, runSubAgentBackground, runSubAgentSync, setActivityPublisher } from './agent-spawn.js';
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
  getUserApiKeys,
  getActiveUserApiKeyByType,
  getAllUserApiKeys,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  getTaskById,
} from './db.js';
import { decryptApiKey } from './encryption.js';
import { fetchEmails, sendEmail } from './email.js';
import { addMcpServer, removeMcpServer, McpServerConfig } from './mcp-registry.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { formatLocalTime } from './timezone.js';
import { CronExpressionParser } from 'cron-parser';
import { computeNextRun, buildDigestContext, startSchedulerLoop } from './task-scheduler.js';
import { runMemoryWriteback } from './memory-writeback.js';
import { startCalendarSyncPoller } from './calendar-sync.js';
import { startStatusServer, pushNotification, pushActivityLine, getCachedInboxEmails } from './status-server.js';
import { startLogCap } from './log-rotator.js';
import { Channel, NewMessage, OWNER_JID, AgentInput, ScheduledTask } from './types.js';
import { logger } from './logger.js';
import { captureScreenshot, captureWebcam, captureWebcamFromSecurityApp, securityAppHasFrameServer, readHostImage } from './capture.js';
import { securityLog, awarenessLog, recordAwarenessEvent, queryAwarenessHostEvents } from './security-log.js';

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
let lastAwarenessEvent: string = '';

// Security senders — background agents (Sentry) whose send_message output
// should also be spoken over the voice client's SSE stream.
const SECURITY_SENDERS = new Set(['Sentry']);

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
const MERCURY_SUMMARY_EVERY = 15;

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

  const scored = candidates.map((m) => {
    const words = tokenizeMercury(m.content || '');
    let score = 0;
    for (const kw of keywords) {
      if (words.includes(kw)) score += 1;
      if ((m.content || '').toLowerCase().includes(kw)) score += 0.5;
    }
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
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
      prompt += `<mercury_summary>\n${mercury}\n</mercury_summary>\n\n`;
    }
  }

  // Mercury RAG: pull older conversation snippets relevant to the current ask.
  if (mode === 'rag' || mode === 'full') {
    const relevant = mercuryRetrieveRelevant(newMessages, MERCURY_CONTEXT_TURNS, clearAt);
    if (relevant.length > 0) {
      const lines = relevant.map((m) => {
        const role = m.is_bot_message ? ASSISTANT_NAME : (m.sender_name || 'User');
        return `<message sender="${role}" history="relevant">${m.content}</message>`;
      });
      prompt += `<mercury_context count="${relevant.length}">\n${lines.join('\n')}\n</mercury_context>\n\n`;
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
  // Exclude background agent messages (Sentry security alerts and greetings) —
  // they are stored for the user/dashboard, but the orchestrator must NOT see them
  // in its history (otherwise it parrots/acknowledges them).
  const contextMessages = rawHistory
    .filter((m) => !pendingIds.has(m.id) && m.sender_name !== 'Sentry')
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
 * Sentry (situational-awareness agent) model resolution. Uses the dedicated
 * sentry:model router setting (dashboard Models card) — no fallback. A `local:`
 * prefix is stripped. seedPerAgentModelSettings() materializes sentry:model from
 * the orchestrator model on first boot, so this is never empty in normal use.
 */
function resolveAwarenessModel(): string {
  // Sentry shares the Toolcall model (local:subagent_model).
  return (getRouterState('local:subagent_model') || '').trim().replace(/^local:/, '');
}

/** Satellite IP where the security detector runs. Read from router state first,
 *  then env, then localhost fallback. */
function getSatelliteIp(): string {
  return (
    getRouterState('security:satellite_ip') ||
    getRouterState('security:laptop_ip') ||
    process.env.WARDEN_SECURITY_SATELLITE_IP ||
    process.env.WARDEN_SECURITY_LAPTOP_IP ||
    '127.0.0.1'
  ).trim();
}

/** Pull the current frame from the satellite security detector and save it to
 *  the desktop's owner attachments. Returns the [Image: ...] reference string. */
async function fetchAndSaveSecurityFrame(): Promise<string | null> {
  const ip = getSatelliteIp();
  const url = `http://${ip}:8765/frame`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`frame server returned ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf || buf.length === 0) throw new Error('empty frame');
    const groupDir = path.join(WORKSPACE_ROOT, 'groups', 'owner');
    const processed = await processImage(buf, groupDir, '');
    if (!processed) throw new Error('processImage failed');
    return processed.content; // e.g. "[Image: attachments/xyz.jpg]"
  } catch (err: any) {
    logger.warn({ err, url }, 'fetchAndSaveSecurityFrame: failed to pull/save satellite frame');
    return null;
  }
}

/** Latest security frame reference fetched for the current Sentry run, so the
 *  host can attach it to Sentry's send_message even if the model forgets. */
let latestSentryFrame: string | null = null;

/** Spawn Sentry, the single background security/awareness agent (fire-and-forget).
 *  Never awaited. Pass the original awareness text so Sentry has full context. */
export function spawnSentryBackground(task: string, awarenessText?: string): void {
  if (awarenessText) {
    lastAwarenessEvent = awarenessText;
  }
  // Pre-fetch the latest security frame so Sentry can include it in any alert
  // message it sends. If the frame server is slow/down, Sentry still runs without
  // the image rather than being blocked. Wait ~2s before pulling the frame so the
  // person has settled into view — fetching the instant the event arrives is too
  // quick and often catches an empty or mid-entry frame.
  void new Promise((resolve) => setTimeout(resolve, 2000))
    .then(() => fetchAndSaveSecurityFrame())
    .then((imageTag) => {
    latestSentryFrame = imageTag || null;
    if (!imageTag) {
      logger.warn('spawnSentryBackground: could not fetch security frame for Sentry');
    }
    const prompt = imageTag ? `${task}\n\nLatest security frame: ${imageTag}` : task;
    runSubAgentBackground({
      agent: 'sentry',
      prompt,
      model: resolveAwarenessModel(),
      sessionId: 'owner',
      workspaceRoot: WORKSPACE_ROOT,
      chatJid: OWNER_JID,
      groupFolder: 'owner',
      isMain: true,
      timeoutMs: 90 * 1000, // greetings are short — don't let a stuck model linger
      callbacks: buildAgentCallbacks({ awarenessText }),
    } as any);
  });
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
export function buildAgentCallbacks(opts?: { awarenessText?: string }): CallbackMap {
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

        // For Sentry security alerts, append the real pre-fetched security
        // frame so Telegram sends the photo. Only swap when we actually have a
        // frame — otherwise leave whatever [Image: ...] reference Sentry wrote
        // in place so Telegram can still resolve and send it.
        let finalText = text;
        if (senderName === 'Sentry' && latestSentryFrame) {
          finalText = finalText.replace(/\s*\[Image:\s*[^\]]+\]/gi, '').trim();
          finalText = `${finalText} ${latestSentryFrame}`;
        }
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
        // The agent doesn't supply an accountId. Try each enabled account until
        // one connects, so a broken OAuth-linked account (dangling
        // oauth_account_id — the oauth_accounts row was deleted but the
        // email_accounts row still references it) no longer masks a working
        // IMAP/password account that sorts after it.
        const accounts = getEmailAccounts(null).filter((a) => a.enabled);
        if (accounts.length === 0) {
          return { ok: false, error: 'no enabled email account' };
        }
        const errors: string[] = [];
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
            return { ok: true, emails: filtered };
          } catch (err: any) {
            errors.push(`${account.email}: ${String(err?.message ?? err)}`);
          }
        }
        return { ok: false, error: `all email accounts failed — ${errors.join('; ')}` };
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
        const existing = getCalendarEvent(id) ?? (args?.uid ? getCalendarEvent(args.uid) : undefined);
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
        const ok = deleteCalendarEvent(id);
        return ok ? { ok: true } : { ok: false, error: 'event not found' };
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
    // callbacks had "no registered handler" and Byte could never add a task.
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
        // project actually exists — Byte's retry loop created duplicates because
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
        const windowTitle =
          typeof args?.window_title === 'string' && args.window_title.trim()
            ? args.window_title.trim()
            : undefined;
        let region: { x: number; y: number; w: number; h: number } | undefined;
        const r = args?.region;
        if (r && typeof r === 'object') {
          const w = Math.max(0, Math.round(+r.w || 0));
          const h = Math.max(0, Math.round(+r.h || 0));
          if (w > 0 && h > 0) {
            region = { x: Math.round(+r.x || 0), y: Math.round(+r.y || 0), w, h };
          }
        }
        const cap = await captureScreenshot({ windowTitle, region });
        logger.info(
          { width: cap.width, height: cap.height, mediaType: cap.mediaType, windowTitle, region },
          'desktop_screenshot: captured on host',
        );
        return { ok: true, image: cap.image, mediaType: cap.mediaType, width: cap.width, height: cap.height };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    webcam_capture: async (args: any) => {
      try {
        // Prefer the satellite's Security Mode frame server. The detector owns the
        // webcam, so grabbing /dev/video0 directly would fail. Fall back to ffmpeg.
        let cap;
        let source = 'ffmpeg';
        const satelliteIp = getSatelliteIp();
        const frameUrl = `http://${satelliteIp}:8765/frame`;
        if (await securityAppHasFrameServer(frameUrl)) {
          try {
            cap = await captureWebcamFromSecurityApp(frameUrl);
            source = 'security-app';
          } catch (err: any) {
            logger.warn({ err }, 'webcam_capture: security frame server up but fetch failed — falling back to ffmpeg');
            cap = await captureWebcam({
              device: typeof args?.device === 'string' ? args.device : undefined,
              width: typeof args?.width === 'number' ? args.width : undefined,
            });
          }
        } else {
          cap = await captureWebcam({
            device: typeof args?.device === 'string' ? args.device : undefined,
            width: typeof args?.width === 'number' ? args.width : undefined,
          });
        }
        logger.info(
          { source, width: cap.width, height: cap.height, mediaType: cap.mediaType },
          'webcam_capture: captured on host',
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

    // Orchestrator monitor-tick reports route HERE (not send_message), so the
    // tick's supervision prose lands in the dashboard's progress panel instead
    // of spamming the chat. The chat only carries completed-task reports
    // (inbox digest) and interventions.
    progress_event: async (args: any) => {
      try {
        const text = typeof args?.text === 'string' ? args.text : '';
        if (!text.trim()) return { ok: true, skipped: true };
        pushSupervisorNote(text);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // ─── Security Mode ─────────────────────────────────────────────────────
    // Close the open security alert on the standalone detector app, re-arming
    // it so it can raise the next alert. The detector holds an alert OPEN until
    // this is called (one alert per incident, not one per detection).
    close_security_alert: async (_args: any) => {
      const ip = getSatelliteIp();
      const url = `http://${ip}:8765/alert/close`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(url, { method: 'POST', signal: controller.signal });
          const body = await res.text().catch(() => '');
          logger.info({ status: res.status, body: body.slice(0, 120) }, 'close_security_alert: detector re-armed');
          return { ok: res.ok, state: body };
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        logger.warn({ err }, 'close_security_alert: security app not reachable');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Guard's chat command: arm the standalone detector (enable flagging).
    // Mirrors close_security_alert. The detector keeps running + showing the
    // feed; armed means Sentry flagging is active, disarmed means it's paused.
    arm_security: async (_args: any) => {
      const ip = getSatelliteIp();
      const url = `http://${ip}:8765/arm`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(url, { method: 'POST', signal: controller.signal });
          const body = await res.text().catch(() => '');
          logger.info({ status: res.status, body: body.slice(0, 120) }, 'arm_security: detector armed');
          return { ok: res.ok, state: body };
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        logger.warn({ err }, 'arm_security: security app not reachable');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Guard's chat command: disarm the standalone detector (stop flagging).
    disarm_security: async (_args: any) => {
      const ip = getSatelliteIp();
      const url = `http://${ip}:8765/disarm`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(url, { method: 'POST', signal: controller.signal });
          const body = await res.text().catch(() => '');
          logger.info({ status: res.status, body: body.slice(0, 120) }, 'disarm_security: detector disarmed');
          return { ok: res.ok, state: body };
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        logger.warn({ err }, 'disarm_security: security app not reachable');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Sentry's conditions log (own sqlite store, store/security.db). Records
    // each alert assessment with an exact timestamp, and queries history by
    // local-time range so Sentry can reference events by time/date.
    security_log: async (args: any) => {
      return securityLog(args);
    },

    // Sentry's situational-awareness history (arrivals/departures/greetings).
    awareness_log: async (args: any) => {
      return awarenessLog(args);
    },

    // Sentry registers a known person; the satellite computes the face embedding
    // on CPU and stores it locally.
    save_known_person: async (args: any) => {
      try {
        const label = String(args?.label || '').trim();
        if (!label) return { ok: false, error: 'missing label' };
        const ip = getSatelliteIp();
        const url = `http://${ip}:8765/known/save`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok || !body?.ok) {
          return { ok: false, error: body?.error || `HTTP ${res.status}` };
        }
        return { ok: true, label };
      } catch (err: any) {
        logger.warn({ err }, 'save_known_person: failed to reach satellite');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Orchestrator vision aid: the latest AWARENESS info from Sentry / the
    // camera detector — the most recent event text plus the recent host event
    // rows (event, is_known/label, person_count, how long the room's been
    // occupied/empty). Lets the orchestrator answer "who's in the room" by
    // combining a webcam_capture photo with this structured context (names,
    // counts, durations) that the photo alone can't provide.
    awareness_status: async () => {
      try {
        const recent = queryAwarenessHostEvents(5);
        return { ok: true, latest: lastAwarenessEvent, recent };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Orchestrator → Sentry direct. The user tells Jarvis a presence/schedule
    // note (e.g. "heading out for the evening"); Sentry processes it according to
    // the rules in security/sentry.md. Sentry does not reply in the chat.
    tell_sentry: async (args: any) => {
      try {
        const message = typeof args?.message === 'string' ? args.message.trim() : '';
        if (!message) return { ok: false, error: 'missing message' };
        const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const localNow = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
        const compactTs = localNow.replace(/[-:]/g, ''); // match the detector's %Y%m%dT%H%M%S
        const task =
          `Current local time is ${localNow} (timezone ${tz}).\n\n` +
          `AWARENESS — note at ${compactTs}. data: {"event":"note","message":${JSON.stringify(message)},"ts":"${compactTs}"}\n\n` +
          `The user passed you a note. Read security/sentry.md and follow its rules. ` +
          `Do NOT send_message and do NOT reply in chat unless the rules explicitly tell you to greet. Stop after one action.`;
        spawnSentryBackground(task);
        logger.info('tell_sentry: spawned Sentry to process note');
        return { ok: true };
      } catch (err: any) {
        logger.warn({ err }, 'tell_sentry: failed to spawn Sentry');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Orchestrator → Sentry live status query. Spawns Sentry synchronously so
    // it can pull/process live data and return a concise report, instead of
    // returning stale cached rows. The orchestrator uses this to decide whether
    // a current room-status question needs a webcam frame.
    sentry_query: async (args: any) => {
      try {
        const question = typeof args?.question === 'string' && args.question.trim()
          ? args.question.trim()
          : 'live status';
        const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const localNow = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
        const task =
          `[ORCHESTRATOR_QUERY] Current local time is ${localNow} (timezone ${tz}).\n\n` +
          `The orchestrator asks: "${question}"\n\n` +
          `You are Sentry, the situational-awareness agent. This is a live status query from the orchestrator, NOT an AWARENESS event. ` +
          `Do NOT send_message to the user. Do NOT use security_log. Use ONLY awareness_log (action: query) and awareness_status. ` +
          `Decide the CURRENT room state and return a concise report as your final plain-text output. ` +
          `Start with NOTHING_NOTEWORTHY if the room is currently empty and there is no person present, no recent motion/arrival/departure/alert, and the camera is normal. ` +
          `Start with NOTEWORTHY if a person is currently present, an unknown person is detected, there is recent motion, an alert is open, or the camera is covered/moved. ` +
          `Then add one sentence of detail. Read security/sentry.md if you need user-specific rules, but do not greet or alert the user directly.`;
        const model = resolveAwarenessModel();
        const result = await runSubAgentSync({
          agent: 'sentry',
          prompt: task,
          model,
          workspaceRoot: WORKSPACE_ROOT,
          chatJid: OWNER_JID,
          groupFolder: 'owner',
          isMain: true,
          timeoutMs: 30 * 1000,
          callbacks: buildAgentCallbacks({}),
        } as any);
        logger.info({ report: result.content.slice(0, 200), exitCode: result.exitCode }, 'sentry_query: got report');
        return { ok: true, report: result.content };
      } catch (err: any) {
        logger.warn({ err }, 'sentry_query: failed to query Sentry');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Sentry raised an alert → light the red alert on the satellite detector.
    open_security_alert: async (args: any) => {
      const reason = String(args?.reason || '').trim();
      if (!reason) return { ok: false, error: 'missing reason' };
      const ip = getSatelliteIp();
      const url = `http://${ip}:8765/alert/open`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(url, { method: 'POST', signal: controller.signal });
          const body = await res.text().catch(() => '');
          logger.info({ status: res.status, body: body.slice(0, 120) }, 'open_security_alert: detector ALERTED');
          return { ok: res.ok, state: body };
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        logger.warn({ err }, 'open_security_alert: security app not reachable');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // The orchestrator called its clear_context tool. Record the clear boundary
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

        return { ok: false, error: `unknown ipc type: ${type}` };
      } catch (err: any) {
        logger.warn({ err, type: args?.type }, 'ipc callback: error');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

  };
}

let mercuryTurnCounter = 0;

function maybeUpdateMercurySummary(): void {
  mercuryTurnCounter++;
  if (mercuryTurnCounter % MERCURY_SUMMARY_EVERY === 0) {
    void updateMercurySummary();
  }
}

/**
 * Mercury — automatic rolling conversation compaction.
 *
 * Reads the last ~40 messages, preserves the most recent turns verbatim, and
 * asks the orchestrator model to compress the older turns into a concise
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

    const olderLines = older.map((m) => {
      const role = m.is_bot_message ? ASSISTANT_NAME : (m.sender_name || 'User');
      return `${role}: ${m.content}`;
    }).join('\n');

    const summaryPrompt =
      `You are Mercury — a conversation compaction layer for Warden. Summarize the following older conversation turns into a concise memory note. ` +
      `Preserve facts, decisions, values, file paths, URLs, and any open tasks or questions. ` +
      `Drop pleasantries, filler, and exact wording unless it's important. ` +
      `Do NOT include the most recent ${MERCURY_RECENT_MESSAGES} turns; they are kept verbatim. ` +
      `Write in short bullet/paragraph form so the main agent can scan it quickly.\n\n${olderLines}\n\nMercury summary:`;

    // Mercury shares the Toolcall model (local:subagent_model).
    const model = (getRouterState('local:subagent_model') || '').replace(/^local:/, '') || undefined;
    const mercuryInput: AgentInput = {
      prompt: summaryPrompt,
      sessionId: 'mercury',
      workspaceRoot: WORKSPACE_ROOT,
      history: [],
      timeoutMs: 120_000,
      orchestratorModel: model,
      showThinking: 'false',
      verbose: false,
    };

    const result = await runAgent({ ...mercuryInput, callbacks: {} });
    let summary = cleanAgentText(result.text || '');
    try {
      const parsed = JSON.parse(summary);
      if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string') summary = cleanAgentText(parsed.result);
    } catch { /* not JSON */ }
    if (!summary.trim()) return;

    const root = WORKSPACE_ROOT.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
    const mercuryPath = path.join(root, MERCURY_MEMORY_FILE);
    const stamp = new Date().toISOString();
    const entry = `# Mercury summary updated ${stamp}\n\n${summary}\n\n---\n\n`;
    fs.writeFileSync(mercuryPath, entry, 'utf8');
    logger.info({ chars: summary.length }, 'Mercury summary updated');
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
  const pending = getMessagesSince(OWNER_JID, since, ASSISTANT_NAME);
  if (pending.length === 0) return;

  // ── Idle context clear ──────────────────────────────────────────────────
  // If the user's last message was older than the configured threshold (Model
  // Configuration → Idle clear; default 30 min), drop the orchestrator's
  // accumulated context before this turn so testing chatter can't bloat the
  // working window. Setting orchestrator:context_clear_at to the latest pending
  // timestamp makes the agent-runner reset its in-memory conversation (it
  // resets when the marker changes) and gates <chat_history> to messages after
  // it. 0 = disabled. We also remember this message's time so the next idle
  // check measures from here.
  const latestUserTs = pending[pending.length - 1]!.timestamp;
  const idleRaw = getRouterState('orchestrator:context_idle_clear_minutes') || '';
  const idleMin = idleRaw === '' ? 30 : (parseInt(idleRaw, 10) || 0);
  const prevUserTs = getRouterState('orchestrator:last_user_message_at') || '';
  if (idleMin > 0 && prevUserTs) {
    const gapMin = (Date.parse(latestUserTs) - Date.parse(prevUserTs)) / 60000;
    if (gapMin > idleMin) {
      setRouterState('orchestrator:context_clear_at', latestUserTs);
      logger.info({ idleMin: Math.round(gapMin) }, 'Orchestrator context auto-cleared after user idle');
    }
  }
  setRouterState('orchestrator:last_user_message_at', latestUserTs);

  // ── "Close the alert" — the person at the keyboard re-arms the detector ──
  // Sentry never closes an ABNORMAL alert itself; the user closes it after
  // they've checked / acted on it. This intercepts that command and calls the
  // close_security_alert host callback directly (the orchestrator doesn't own
  // that tool), then acknowledges — no orchestrator turn needed.
  const closeText = pending.some((m) => {
    const s = (m.content || '').toLowerCase();
    return (/\b(close|clear|dismiss)\b/.test(s) && /\balert|security|intruder|threat\b/.test(s))
      || /\b(stand\s+down|all\s+clear)\b/.test(s)
      || /close.*alert/.test(s);
  });
  if (closeText) {
    lastAgentTimestamp = pending[pending.length - 1]!.timestamp;
    saveState();
    let reply = 'Security alert closed — detector re-armed.';
    try {
      const r = await buildAgentCallbacks().close_security_alert({});
      if (r && r.ok === false) reply = `Tried to close the security alert: ${r.error || 'detector app not reachable'}.`;
    } catch (err: any) {
      reply = `Could not close the security alert: ${err?.message ?? err}.`;
    }
    await deliverReply(reply);
    pushNotification('owner', { type: 'chat_complete', message: reply, from: OWNER_JID });
    logger.info({ chatJid: OWNER_JID }, 'Security alert closed by user → detector re-armed');
    return;
  }

  // ── "Arm / disarm the system" — the guard toggles the detector ──────────
  // 2-way: the user says "arm the system"/"disarm" in chat; we call the
  // arm_security/disarm_security host callback directly (the orchestrator
  // doesn't own that tool) and acknowledge — no orchestrator turn needed.
  // "disarm" is specific enough to match alone; "arm" requires a security
  // context word so body-part / "alarm" uses don't fire.
  const disarmText = pending.some((m) => /\bdisarm\b/.test((m.content || '').toLowerCase()));
  const armText = pending.some((m) => {
    const s = (m.content || '').toLowerCase();
    return /\barm\b/.test(s) && /\b(system|security|detector|camera|it)\b/.test(s);
  });
  if (armText || disarmText) {
    lastAgentTimestamp = pending[pending.length - 1]!.timestamp;
    saveState();
    let reply = '';
    try {
      const cb = buildAgentCallbacks();
      if (disarmText) {
        const r = await cb.disarm_security({});
        reply = r && r.ok === false
          ? `Tried to disarm: ${r.error || 'detector app not reachable'}.`
          : 'Security system disarmed — flagging paused.';
      } else {
        const r = await cb.arm_security({});
        reply = r && r.ok === false
          ? `Tried to arm: ${r.error || 'detector app not reachable'}.`
          : 'Security system armed — flagging enabled.';
      }
    } catch (err: any) {
      reply = `Could not toggle the security system: ${err?.message ?? err}.`;
    }
    await deliverReply(reply);
    pushNotification('owner', { type: 'chat_complete', message: reply, from: OWNER_JID });
    logger.info({ chatJid: OWNER_JID, arm: armText, disarm: disarmText }, 'Security system toggled by user');
    return;
  }

  // ── Awareness events → Sentry direct pipe ───────────────────────────────
  // An AWARENESS message (posted by the standalone detector's presence
  // tracker — arrival/departure/note, event-driven, never per-frame) is piped
  // straight to Sentry, the background situational-awareness agent, in code.
  // Same engrained pattern: the event row is pre-written to awareness_log
  // (so it's recorded even if Sentry crashes), Sentry runs on the model
  // configured in dashboard (sentry:model), and we return so the orchestrator
  // never burns a turn on it.
  // Independent of the arm/disarm state — awareness ≠ security arming.
  const isAwareness = pending.some((m) => (m.content || '').startsWith('AWARENESS'));
  if (isAwareness) {
    lastAgentTimestamp = pending[pending.length - 1]!.timestamp;
    saveState();
    logger.info({ chatJid: OWNER_JID, messageCount: pending.length }, 'Security awareness → routing to Sentry (background)');

    const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localNow = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
    const events = pending.filter((m) => (m.content || '').startsWith('AWARENESS'));
    const latest = events.length > 0 ? events[events.length - 1] : pending[pending.length - 1]!;
    const awarenessText = latest.content || '';
    const task = `Current local time is ${localNow} (timezone ${tz}).\n\n${awarenessText}\n\nYou are Sentry, Warden's situational-awareness agent. Use tools only. Read security/sentry.md and apply its rules exactly. Decide: alert, greet, or stay silent.\n\nThe AWARENESS payload now includes:\n- event type (arrival|departure|camera_covered|camera_moved|motion_burst|note)\n- person_count\n- is_known and label (from InsightFace face embeddings when a face is visible)\n- room occupancy, motion area, camera state, and keypoint/bbox data\n\nUse awareness_log (action: record/query) to record your verdict and avoid repeating greetings.\n\nDo not write a plain-text response; use tools only.`;

    try {
      // Host-side auto-log of the raw event, independent of Sentry.
      recordAwarenessEvent(awarenessText);
      spawnSentryBackground(task, awarenessText);
    } catch (err: any) {
      logger.warn({ err }, 'Awareness: failed to spawn Sentry');
    }
    return; // do NOT run the orchestrator for awareness events
  }

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

  const input: AgentInput = {
    prompt,
    sessionId: 'owner',
    workspaceRoot: WORKSPACE_ROOT,
    history: pending,
    timeoutMs: 10 * 60 * 1000, // orchestrator turns must be short: Atlas is always async; a stuck model/tool call recovers in 10 min
    memoryContext,
    orchestratorModel: (getRouterState('orchestrator:model') || '').replace(/^local:/, '') || undefined,
    model: (getRouterState('atlas:model') || '').replace(/^local:/, '') || undefined,
    vulkanModel: (getRouterState('vulkan:model') || '').replace(/^local:/, '') || undefined,
    // byte/dexter/iris share the Toolcall model (dashboard "Toolcall model" row,
    // persisted as local:subagent_model). The host feeds the same value into each
    // per-agent IPC field so the runner's dispatch is unchanged.
    byteModel: (getRouterState('local:subagent_model') || '').replace(/^local:/, '') || undefined,
    dexterModel: (getRouterState('local:subagent_model') || '').replace(/^local:/, '') || undefined,
    irisModel: (getRouterState('local:subagent_model') || '').replace(/^local:/, '') || undefined,
    artemisModel: (getRouterState('artemis:model') || '').replace(/^local:/, '') || undefined,
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
    // Keep the cursor advanced so the failed turn is not retried indefinitely
    // and the user doesn't get a re-reply to the same message every loop tick.
    return;
  }
  agentProcessing = false;
  setRouterState('agent:processing', 'false');
  if (output.userStopped) {
    logger.info('Agent run stopped by user; no reply delivered and cursor stays advanced');
    return;
  }

  let rawText = cleanAgentText(output.text);
  // Agent-runner emits JSON: {"status":"success","result":"..."} — extract the text.
  // If result is null/empty/non-string, the agent produced no user-facing reply — drop it
  // rather than forwarding the raw envelope (e.g. '{"status":"success","result":null}') to the chat.
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.result === 'string' && parsed.result.trim()) {
        rawText = cleanAgentText(parsed.result);
      } else {
        rawText = '';
      }
    }
  } catch { /* not JSON, use as-is */ }
  const text = rawText;
  if (!text) {
    if (output.error) {
      logger.warn(
        { error: output.error, exitCode: output.exitCode },
        'Agent returned no text + an error',
      );
    }
    return;
  }

  await deliverReply(text);

  // Mercury: asynchronously compact the conversation after each turn so the
  // context window keeps flowing without manual resets.
  void maybeUpdateMercurySummary();

  // Memory writeback (Mercury's durable-memory half): distill durable facts
  // + a journal entry from this turn's conversation and append them to
  // MEMORY.md / JOURNAL.md at WORKSPACE_ROOT — which the orchestrator loads
  // next turn. Fire-and-forget; self-throttled (15-min cooldown, ≥4 new
  // messages) and non-fatal so it can never break the message loop.
  void runMemoryWriteback(OWNER_JID);

  // Push a notification so the dashboard SSE can react even if it polls slowly.
  pushNotification('owner', {
    type: 'chat_complete',
    message: text,
    from: OWNER_JID,
  });
}

// Bare stop commands a user can send as a chat message (Telegram/voice) to
// kill an in-flight agent run. Deliberately strict — the message must be
// nothing but the stop word, so "stop by the store" never triggers it.
const STOP_COMMAND_RE = /^\s*(stop|cancel|abort|halt|never\s?mind|nvm|shut up)[\s.!]*$/i;

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
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nWINDOW: This is the HOURLY digest. Only consider activity in the LAST HOUR (emails received in the last hour; calendar events in the next 2 hours; tasks that were created, completed, or updated in the last hour). Do NOT mention the user bio, sleep schedule, daily routine, or long-running projects unless something about them changed in the last hour.\n\nGROUNDING: Use only facts in INPUT or in the read_emails results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call read_emails (limit 50, preview_only true). Use only emails whose Date is within the last hour.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or read_emails, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing):\n{"title":"<current date and time as shown in INPUT>","summary":"<one or two sentences in markdown about what happened in the LAST HOUR only — or say it was quiet>","alerts":[],"blocks":[{"icon":"inbox","label":"Recent Emails","type":"list","items":["From: <sender>: <subject> (<time>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing in the next 2 hours."]},{"icon":"tasks","label":"Active Tasks","type":"list","items":["No active tasks."]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}]}',
  },
  {
    id: 'iris-digest-daily',
    cron: '17 21 * * *',
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nGROUNDING: Use only facts in INPUT or in the read_emails results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call read_emails (limit 100, preview_only true). Use only emails whose Date is within the last 24 hours (today).\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or read_emails, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing):\n{"title":"<date from INPUT>","summary":"<Start with: Good morning. Then one or two sentences briefing Dominic on today — calendar events, active tasks, and notable emails. Do NOT mention sleep schedule, wake times, or daily routine.>","alerts":[],"blocks":[{"icon":"review","label":"Day in Review","type":"prose","text":"<one or two sentences on calendar events, tasks, and emails for today from INPUT/emails — or empty if there is no data. Do not mention sleep schedule or daily routine.>"},{"icon":"inbox","label":"Recent Emails","type":"list","items":["From: <sender>: <subject> (<time>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing on the calendar today."]},{"icon":"tasks","label":"Active Tasks","type":"list","items":["No active tasks."]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"tomorrow","label":"Tomorrow","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}]}',
  },
  {
    id: 'iris-digest-weekly',
    cron: '30 20 * * 0',
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nGROUNDING: Use only facts in INPUT or in the read_emails results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call read_emails (limit 200, preview_only true). Use only emails whose Date is within the last 7 days. Pick the 6-10 most relevant.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or read_emails, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing):\n{"title":"<week-of date from INPUT>","summary":"<two or three sentences in markdown summarizing the shape of the week, from INPUT/emails>","alerts":[],"blocks":[{"icon":"review","label":"Week in Review","type":"prose","text":"<two or three sentences on the shape of the week from INPUT/emails, or empty if there is no data>"},{"icon":"inbox","label":"Email Activity","type":"list","items":["From: <sender>: <subject> (<date>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing on the calendar this week."]},{"icon":"tasks","label":"Tasks","type":"list","items":["[status] <title>"]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}]}',
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
  // Iris digest is a granite toolcall agent — use the shared Toolcall model
  // (local:subagent_model), falling back to the legacy iris:model key only if
  // the shared key is unset. The ctx/keep_alive/temp come from the toolcall
  // settings in the runner (IRIS_NUM_CTX / TOOLCALL_KEEP_ALIVE / temp 0), so
  // only the model identity is resolved here.
  const irisModel = (getRouterState('local:subagent_model') || getRouterState('iris:model') || '').replace(/^local:/, '');
  if (!irisModel) {
    logger.warn({ span }, 'runDigest: no toolcall/iris model configured (local:subagent_model or iris:model) — skipping');
    return { ok: false, error: 'no toolcall model configured (set the Toolcall model in the Agents panel)' };
  }
  const baked = IRIS_DIGEST_TASKS.find((x) => x.id === `iris-digest-${span}`);
  if (!baked) return { ok: false, error: `no baked digest prompt for ${span}` };
  // Read the live cron from the scheduled_tasks row if it exists; otherwise use
  // the baked default. This lets the user edit the digest schedule in the UI.
  const cron = getDigestTaskCron(span);
  const t = { ...baked, cron };
  let prompt = t.prompt;
  try {
    const ctx = await buildDigestContext(span);
    if (ctx) prompt = `${ctx}\n\n---\n\n${prompt}`;
  } catch (err: any) {
    logger.warn({ span, err }, 'runDigest: buildDigestContext failed — running ungrounded');
  }
  logger.info({ span, model: irisModel, manual }, 'runDigest: spawning iris-digest directly');
  runSubAgentBackground({
    agent: `iris-digest-${span}`,
    prompt,
    model: irisModel,
    sessionId: 'owner',
    workspaceRoot: WORKSPACE_ROOT,
    chatJid: OWNER_JID,
    groupFolder: 'owner',
    isMain: true,
    timeoutMs: 5 * 60 * 1000,
    callbacks: digestCallbacks(span),
  } as any);
  return { ok: true };
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
        setRouterState(lastrunKey, new Date(now).toISOString());
        logger.info({ span, cron: liveCron }, 'checkDigestsDue: firing scheduled digest');
        void runDigest(span, false).catch((err) => logger.warn({ span, err }, 'runDigest failed'));
      }
    }
  } finally {
    digestMonitorBusy = false;
  }
}

// ── Actionable Items Scanner ─────────────────────────────────────────────
// Scans recent email (all enabled accounts) + chat logs (allowed channels)
// for actionable tasks/events, then either creates them immediately (auto-
// accept on) or queues them for manual confirmation. Mirrors the digest
// architecture: a scheduled run rides the poll loop, the model is the same
// Granite used by Iris, and the extraction is a one-shot model call with NO
// tools — the host gathers all content and packs it into the prompt.

const SCAN_SPANS = ['hourly', 'daily', 'weekly'] as const;
type ScanSpan = (typeof SCAN_SPANS)[number];
const SPAN_WINDOW_MS: Record<ScanSpan, number> = {
  hourly: 3600_000,
  daily: 24 * 3600_000,
  weekly: 7 * 24 * 3600_000,
};
// Default scan cadence: every 20 min (off the :00/:30 marks). Overridden by
// router_state scan:cron so the user can program the daily scan for 6am etc.
const DEFAULT_SCAN_CRON = '13,33,53 * * * *';
const SCAN_CRON = DEFAULT_SCAN_CRON;
const SCAN_MSG_LIMIT = 400;       // cap inbound chat rows fed to the model
const SCAN_EMAIL_LIMIT = 40;      // cap emails per account fed to the model

// An item the model extracted from email/chat. The scanner creates a real row
// (work task or calendar event) for each of these immediately — there is no
// separate confirmation queue. `confirmed` flags rows the user hasn't green-
// checked yet (0 = awaiting review in Ops -> Inbox, 1 = confirmed).
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
  allowedChats: string;
  model: string;
  ctx: string;            // scan:ctx override; empty = inherit the toolcall ctx
  cron: string;
  lastrun: string | null;
}

function scanModel(): string {
  // Optional per-scan model override; falls back to the Iris model (same
  // Granite that powers the digest). Never falls back to a hardcoded default.
  return (getRouterState('scan:model') || getRouterState('local:subagent_model') || '').replace(/^local:/, '');
}

function scanAutoAccept(): boolean {
  return getRouterState('scan:auto_accept') === 'true';
}

function scanCron(): string {
  const cron = (getRouterState('scan:cron') || '').trim();
  if (!cron) return DEFAULT_SCAN_CRON;
  return cron;
}

function scanAllowedChannels(): string[] | null {
  // Comma-separated channel names in router_state scan:allowed_chats
  // (e.g. "telegram,slack"). Empty/unset → all channels (no filter).
  const raw = (getRouterState('scan:allowed_chats') || '').trim();
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Build the INPUT block the model scans: recent emails (every enabled account)
// + recent inbound chat messages (allowed channels) within the window.
async function buildScanInput(span: ScanSpan): Promise<string> {
  const now = Date.now();
  const sinceMs = now - SPAN_WINDOW_MS[span];
  const sinceISO = new Date(sinceMs).toISOString();
  const lines: string[] = [];
  lines.push(`Scan window: ${span} (since ${sinceISO}). Current local time: ${new Date().toLocaleString('en-US', { timeZone: TIMEZONE })} (${TIMEZONE}).`);
  lines.push('Extract ONLY actionable items — concrete tasks the user committed to / was asked to do, and events with a clear date/time. Ignore greetings, questions, opinions, status updates, and bot-sent messages.');

  // ── Email: every enabled account ──
  // fetchEmails' 4th param is a TEXT search (Gmail q= / MS $search), NOT a date
  // filter — so we can't filter by date at the provider. Instead we fetch the N
  // most recent emails (N scales with the window so a weekly catch-up pulls
  // more than an hourly tick) and keep only those whose `date` falls inside the
  // window. This is what actually makes "hourly = last hour only" true.
  const SPAN_EMAIL_LIMIT: Record<ScanSpan, number> = { hourly: 40, daily: 200, weekly: 500 };
  const emailBlocks: string[] = [];
  const accounts = getEmailAccounts(null).filter((a) => a.enabled);
  for (const account of accounts) {
    try {
      const fetched = await fetchEmails(account.id, 'INBOX', SPAN_EMAIL_LIMIT[span], undefined);
      const inWindow = (fetched as any[]).filter((e: any) => {
        if (!e.date) return false;
        const t = new Date(e.date).getTime();
        return !Number.isNaN(t) && t >= sinceMs;
      });
      const items = inWindow.map((e: any) => {
        const from = e.from || e.sender || '';
        const subj = e.subject || '';
        const snippet = (e.snippet || e.preview || '').slice(0, 400);
        // Deliberately DO NOT render the email's receive/arrival date. The
        // window filtering already happened above (client-side, on e.date), so
        // the date is not needed here — and an 8B extractor will grab any bare
        // timestamp as an event start / task due, turning every promotional
        // email and receipt into a bogus calendar event. Dates the model SHOULD
        // use (a stated meeting time, a stated deadline) live in the subject
        // and snippet, which we keep. With no date in the envelope, "expires
        // Aug 20" in the body still works, but the receive date cannot leak in.
        return `from: ${from}\nsubject: ${subj}\n${snippet}`;
      });
      if (items.length) emailBlocks.push(`### Inbox: ${account.email} (${items.length} in window)\n${items.join('\n\n')}`);
    } catch (err: any) {
      emailBlocks.push(`### Inbox: ${account.email} — unreadable (${String(err?.message ?? err)})`);
    }
  }
  lines.push(emailBlocks.length ? `\nEMAILS:\n${emailBlocks.join('\n\n')}` : '\nEMAILS: none');

  // ── Chat logs: DISABLED (email-only scan) ──
  // Chat/message scanning was removed because the extractor kept re-surfacing
  // items from message text (appointments, pharmacy visits) that Warden had
  // already handled in conversation, and could not reliably distinguish its own
  // outbound messages from genuine new actionable inbound. The Actionable scan
  // is now EMAIL-ONLY. Do not re-add getRecentInboundMessages here without
  // solving the self-message / re-extraction problem.

  lines.push('\n=== INSTRUCTIONS ===\nExtract the actionable tasks and events from the emails above. Output only the JSON object (keys: tasks, events).');
  return lines.join('\n');
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

// Process the JSON the model returned: dedup against the real tables, then
// create a real work task / calendar event row for each new item. There is no
// queue — every item lands in the store immediately. Rows are created with
// confirmed=0 (awaiting review in Ops -> Inbox) unless auto-confirm is on,
// in which case confirmed=1. `pending` counts the rows created unconfirmed.
function processScanResult(span: ScanSpan, jsonText: string): { created: number; pending: number; skipped: number } {
  let parsed: { tasks?: any[]; events?: any[] };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    logger.warn({ span, jsonText: jsonText.slice(0, 300) }, 'processScanResult: model output not valid JSON — skipping');
    return { created: 0, pending: 0, skipped: 0 };
  }
  logger.info({ span, rawLen: jsonText.length, keys: Object.keys(parsed||{}), tasks: (parsed?.tasks||[]).length, events: (parsed?.events||[]).length, snippet: jsonText.slice(0, 120) }, 'processScanResult: parsed model output');
  const confirmed = scanAutoAccept() ? 1 : 0;
  let created = 0, pending = 0, skipped = 0;

  const addTask = (t: any) => {
    const title = String(t?.title || '').trim();
    if (!title) { skipped++; return; }
    if (taskAlreadyExists(title)) { skipped++; return; }
    const item: ExtractedItem = {
      kind: 'task', title, due: t?.due || undefined,
      project_hint: t?.project_hint || undefined,
      source: String(t?.source || 'chat'), span,
    };
    const r = createTaskFromItem(item, confirmed);
    if (r.ok) { created++; if (!confirmed) pending++; }
    else { logger.warn({ err: r.error, title }, 'processScanResult: create task failed'); skipped++; }
  };
  const addEvent = (e: any) => {
    const title = String(e?.title || '').trim();
    const start = String(e?.start || '').trim();
    if (!title || !start) { skipped++; return; }
    if (eventAlreadyExists(title, start)) { skipped++; return; }
    const item: ExtractedItem = {
      kind: 'event', title, start, end: e?.end || undefined,
      source: String(e?.source || 'chat'), span,
    };
    const r = createEventFromItem(item, confirmed);
    if (r.ok) { created++; if (!confirmed) pending++; }
    else { logger.warn({ err: r.error, title }, 'processScanResult: create event failed'); skipped++; }
  };
  (parsed.tasks || []).forEach(addTask);
  (parsed.events || []).forEach(addEvent);
  return { created, pending, skipped };
}

async function runScan(span: string): Promise<{ ok: boolean; error?: string; created?: number; pending?: number; skipped?: number }> {
  if (!SCAN_SPANS.includes(span as ScanSpan)) return { ok: false, error: `invalid span: ${span}` };
  const model = scanModel();
  if (!model) {
    logger.warn({ span }, 'runScan: no scan model configured (scan:model or iris:model) — skipping');
    return { ok: false, error: 'no scan model configured (set iris:model or scan:model in the Agents panel)' };
  }
  let prompt: string;
  try {
    prompt = await buildScanInput(span as ScanSpan);
  } catch (err: any) {
    logger.warn({ span, err }, 'runScan: buildScanInput failed — aborting scan');
    return { ok: false, error: `scan input failed: ${String(err?.message ?? err)}` };
  }
  logger.info({ span, model, promptChars: prompt.length }, 'runScan: spawning chat-scan (sync)');
  let content = '';
  try {
    const r = await runSubAgentSync({
      agent: 'chat-scan',
      prompt,
      model,
      sessionId: 'owner',
      workspaceRoot: WORKSPACE_ROOT,
      chatJid: OWNER_JID,
      groupFolder: 'owner',
      isMain: true,
      timeoutMs: 4 * 60 * 1000,
    } as any);
    content = (r.content || '').trim();
  } catch (err: any) {
    logger.warn({ span, err }, 'runScan: chat-scan child failed');
    return { ok: false, error: `scan child failed: ${String(err?.message ?? err)}` };
  }
  if (!content) {
    logger.warn({ span }, 'runScan: chat-scan returned no output');
    return { ok: false, error: 'scan returned no output' };
  }
  const counts = processScanResult(span as ScanSpan, content);
  setRouterState('scan:lastrun', new Date().toISOString());
  logger.info({ span, ...counts }, 'runScan: complete');
  return { ok: true, ...counts };
}

// Scheduled-scan monitor — rides the existing poll loop (no separate timer),
// the same pattern as checkDigestsDue. Fires runScan at SCAN_CRON cadence.
// First boot seeds lastrun=now so the first scan waits for the next slot
// (no backlog dump), matching the digest's skip-on-boot behaviour.
let scanMonitorBusy = false;
async function checkScanDue(): Promise<void> {
  if (scanMonitorBusy) return;
  scanMonitorBusy = true;
  try {
    const now = Date.now();
    const last = getRouterState('scan:lastrun');
    if (!last) { setRouterState('scan:lastrun', new Date(now).toISOString()); return; }
    const cron = scanCron();
    let nextFireMs: number;
    try {
      nextFireMs = CronExpressionParser.parse(cron, {
        tz: TIMEZONE,
        currentDate: new Date(last),
      }).next().getTime();
    } catch { return; }
    if (now >= nextFireMs) {
      setRouterState('scan:lastrun', new Date(now).toISOString());
      // Auto cadence scans ONLY the last hour (hourly window) — it never
      // backfills missed time. Reading a 24h/7d window on every cron tick would
      // re-process everything and be too much info. The user manually triggers
      // daily/weekly scans from the Actionable tab to catch up on missed spans.
      logger.info({ cron }, 'checkScanDue: firing scheduled hourly scan');
      void runScan('hourly').catch((err) => logger.warn({ err }, 'scheduled runScan failed'));
    }
  } finally {
    scanMonitorBusy = false;
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
  return {
    tasks,
    events,
    autoConfirm: scanAutoAccept(),
    allowedChats: getRouterState('scan:allowed_chats') || '',
    model: scanModel(),
    ctx: getRouterState('scan:ctx') || '',
    cron: scanCron(),
    lastrun: getRouterState('scan:lastrun') || null,
  };
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

function setScanConfig(cfg: { autoAccept?: boolean; allowedChats?: string; model?: string; ctx?: string; cron?: string }): void {
  if (cfg.autoAccept !== undefined) setRouterState('scan:auto_accept', cfg.autoAccept ? 'true' : 'false');
  if (cfg.allowedChats !== undefined) setRouterState('scan:allowed_chats', cfg.allowedChats);
  if (cfg.model !== undefined && cfg.model.trim()) setRouterState('scan:model', cfg.model.trim());
  // Empty ctx clears the override → chat-scan inherits the toolcall ctx.
  if (cfg.ctx !== undefined) setRouterState('scan:ctx', cfg.ctx.trim());
  if (cfg.cron !== undefined) {
    const cron = cfg.cron.trim();
    if (!cron) {
      setRouterState('scan:cron', '');
    } else {
      // Light validation: let the parser tell us if it's garbage.
      try {
        CronExpressionParser.parse(cron, { tz: TIMEZONE }).next();
        setRouterState('scan:cron', cron);
      } catch (err: any) {
        throw new Error(`Invalid cron expression: ${err?.message ?? err}`); // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    }
  }
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
            logger.info({ text: stopMsg.content }, 'Stop command received mid-run — killing agent');
            killCurrentAgent();
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
      // Actionable-items scanner monitor — same fire-and-forget poll-loop
      // pattern as the digest monitor. Never blocks message pickup.
      void checkScanDue();
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

// dockbox runs as a systemd user unit without DISPLAY/XAUTHORITY in its env,
// so Chrome can't reach the X server and dies on launch. Discover the active
// session's display env from a running user process (plasmashell, kded, or
// anything with DISPLAY set) so Chrome can attach to the visible session.
function discoverDisplayEnv(): { DISPLAY?: string; XAUTHORITY?: string } {
  const uid = process.getuid?.() ?? 0;
  // Prefer processes likely to own the user's graphical session.
  const candidates = ['plasmashell', 'kded', 'gnome-shell', 'Xwayland', 'Xorg', 'sway', 'i3'];
  for (const name of candidates) {
    try {
      const pids = execSync(`pgrep -u ${uid} -x ${name} 2>/dev/null`, { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        const DISPLAY = env.find((e) => e.startsWith('DISPLAY='));
        const XAUTHORITY = env.find((e) => e.startsWith('XAUTHORITY='));
        if (DISPLAY) {
          return {
            DISPLAY: DISPLAY.slice('DISPLAY='.length),
            XAUTHORITY: XAUTHORITY ? XAUTHORITY.slice('XAUTHORITY='.length) : undefined,
          };
        }
      }
    } catch { /* try next candidate */ }
  }
  // Fallback: scan any user process for DISPLAY.
  try {
    const pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p));
    for (const pid of pids) {
      try {
        const stat = fs.statSync(`/proc/${pid}`);
        if (stat.uid !== uid) continue;
        const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        const DISPLAY = env.find((e) => e.startsWith('DISPLAY='));
        if (DISPLAY) {
          const XAUTHORITY = env.find((e) => e.startsWith('XAUTHORITY='));
          return {
            DISPLAY: DISPLAY.slice('DISPLAY='.length),
            XAUTHORITY: XAUTHORITY ? XAUTHORITY.slice('XAUTHORITY='.length) : undefined,
          };
        }
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
  // Headless hosts (the Pi runs Warden as a systemd user unit with no X/Wayland
  // session) can't open a display, so Chrome exits immediately and the watchdog
  // relaunches it in a boot loop. Run headless when there's no DISPLAY to attach
  // to; --disable-gpu skips the EGL init noise on those boxes.
  const headless = !displayEnv.DISPLAY;
  const chromeArgs = [
    `--remote-debugging-port=${CHROME_CDP_PORT}`,
    `--user-data-dir=${WARDEN_CHROME_PROFILE}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=LockProfileCookieDatabase',
  ];
  if (headless) {
    chromeArgs.push('--headless=new', '--disable-gpu');
  }
  const child = spawn(CHROME_BIN, chromeArgs, {
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
  logger.info({ cdpPort: CHROME_CDP_PORT, headless, ...displayEnv }, 'Launched persistent Chrome');
}

function startChromeWatchdog(): void {
  // Kill any stale chrome on this port before starting fresh.
  try { execSync(`pkill -f "remote-debugging-port=${CHROME_CDP_PORT}" 2>/dev/null`); } catch {}
  let chromeLaunchTime = Date.now();
  let chromeFailures = 0;

  function restartChrome(reason: string): void {
    logger.warn({ reason, chromeFailures }, 'Relaunching Chrome');
    try { execSync(`pkill -f "remote-debugging-port=${CHROME_CDP_PORT}" 2>/dev/null`); } catch {}
    chromeFailures = 0;
    chromeLaunchTime = Date.now();
    spawnChrome();
  }

  spawnChrome();

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

  // Re-check every 15 seconds; restart Chrome only after repeated failures
  // and never within a 10 s grace period after a fresh launch.
  setInterval(async () => {
    const now = Date.now();
    if (now - chromeLaunchTime < 10000) return;

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
  // The five toolcall agents share one model/ctx (local:subagent_model/_ctx),
  // written by the dashboard "Toolcall model" row. On the first boot after this
  // consolidation, preserve the user's current toolcall agent model (Iris is the
  // representative one — typically granite4.1:8b) and ctx so nothing changes.
  const toolcall = getRouterState('local:subagent_model')
    || getRouterState('iris:model')
    || getRouterState('byte:model')
    || orch;
  const toolcallCtx = getRouterState('local:subagent_ctx')
    || getRouterState('local:iris_ctx')
    || getRouterState('local:byte_ctx')
    || '';
  const subagent = toolcall;
  const atlas = getRouterState('atlas:model') || orch;
  const toolsCtx = toolcallCtx;
  const atlasCtx = getRouterState('local:atlas_ctx') || '';
  const seed = (key: string, value: string) => {
    if (!getRouterState(key) && value) setRouterState(key, value);
  };
  // Seed the shared toolcall model/ctx (the real runtime source for the 5 agents).
  seed('local:subagent_model', toolcall);
  seed('local:subagent_ctx', toolcallCtx);
  // Orchestrator has historically been resident (keep_alive -1); materialize that
  // as the default so the checkbox reflects reality. Toolcall/Atlas stay unset →
  // the runner defaults to 300 (their historic sub-agent TTL).
  seed('local:orch_keep_alive', '-1');
  // New per-agent model keys inherit the legacy shared value.
  seed('byte:model', subagent);
  seed('dexter:model', subagent);
  seed('iris:model', subagent);
  seed('artemis:model', atlas);
  // Existing keys that previously fell back to orchestrator at runtime — seed
  // them too so that runtime fallback can be removed without breaking agents.
  seed('atlas:model', orch);
  seed('vulkan:model', orch);
  seed('mercury:model', orch);
  seed('sentry:model', orch);
  // ctx — preserve each agent's current effective value.
  seed('local:byte_ctx', toolsCtx);
  seed('local:dexter_ctx', toolsCtx);
  seed('local:iris_ctx', toolsCtx);
  seed('local:artemis_ctx', atlasCtx);
  // Sentry bakes in 8192 today (granite4.1:8b overflows at the 2048 default) —
  // materialize that as its ctx setting so the hardcoded bake can be removed.
  seed('local:sentry_ctx', '8192');
  // Vulkan had no ctx override (native window) — leave it blank (native).
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
  // The five toolcall agents share one ctx (local:subagent_ctx).
  process.env.MERCURY_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.BYTE_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.DEXTER_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.IRIS_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.ARTEMIS_NUM_CTX = getRouterState('local:artemis_ctx') || '';
  process.env.VULKAN_NUM_CTX = getRouterState('local:vulkan_ctx') || '';
  process.env.SENTRY_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  // chat-scan inherits the toolcall ctx when scan:ctx is unset (empty). Setting
  // scan:ctx overrides it — e.g. to run the scan on a smaller/cloud model.
  process.env.SCAN_NUM_CTX = getRouterState('scan:ctx') || '';
  // Per-agent Ollama keep_alive (-1 = resident, 300 = 5 min).
  process.env.ORCHESTRATOR_KEEP_ALIVE = getRouterState('local:orch_keep_alive') || '';
  process.env.ATLAS_KEEP_ALIVE = getRouterState('local:atlas_keep_alive') || '';
  process.env.TOOLCALL_KEEP_ALIVE = getRouterState('local:toolcall_keep_alive') || '';
}

async function main(): Promise<void> {
  initDatabase();
  logger.info('Database initialized');
  startChromeWatchdog();
  loadState();
  // Seed the three Iris digest automations (hourly/daily/weekly) as
  // scheduled_tasks rows so they show in the Sched tab and the host poll loop
  // can fire them. Re-syncs the prompt/cron when the baked values change.
  seedIrisDigestTasks();
  // Materialize a concrete per-agent model + ctx for every agent from the
  // legacy shared values BEFORE any agent runs, so every Agents-panel dropdown
  // is populated (no blank) and the agent-runner never sees an empty key. This
  // is a migration, not a runtime fallback: it writes a real value once (only
  // when the key is empty), then runtime uses the key directly with no `||`.
  seedPerAgentModelSettings();
  syncAgentCtxEnv();

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
      const processing = getRouterState('agent:processing') === 'true';
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
          onMessage: (chatJid, msg) => storeMessage({ ...msg, chat_jid: OWNER_JID }),
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
    triggerScan: (span: string) => runScan(span),
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