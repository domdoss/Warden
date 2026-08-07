import { CronExpressionParser } from 'cron-parser';
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
  getBackupConfig,
  createFullBackup,
  createIncrementalBackup,
  listBackups,
} from './backup.js';
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
  addProjectDeliverable,
  toggleDeliverable,
  deleteDeliverable,
  addProjectBlocker,
  deleteBlocker,
  addProjectPriority,
  deleteProjectPriority,
  getProjectFinancials,
  updateProjectFinancials,
} from './db.js';
import { fetchEmails, sendEmail } from './email.js';
import {
  listEvents, getEvent, upsertEvent, deleteEvent,
  listTodos, upsertTodo, deleteTodo,
} from './providers/caldav.js';
import {
  listContacts, searchContacts, getContact, upsertContact, deleteContact,
} from './providers/carddav.js';
import { addMcpServer, removeMcpServer, McpServerConfig } from './mcp-registry.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { formatLocalTime } from './timezone.js';
import { computeNextRun, startSchedulerLoop } from './task-scheduler.js';
import { startCalendarSyncPoller } from './calendar-sync.js';
import { projectAllDeliverables, startKontactWatcher } from './kontact-projection.js';
import { startStatusServer, pushNotification, pushActivityLine } from './status-server.js';
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
 * sentry:model router setting (dashboard Models card). Falls back to the
 * orchestrator model only if unset. A `local:` prefix is stripped.
 */
function resolveAwarenessModel(): string {
  return (getRouterState('sentry:model') || getRouterState('orchestrator:model') || '').trim().replace(/^local:/, '');
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
        const limit = typeof args?.limit === 'number' ? args.limit : 20;
        // Iris sends `search`; older callers sent `since`. Accept both so the
        // search filter is no longer silently dropped.
        const search = typeof args?.search === 'string' ? args.search
                     : typeof args?.since === 'string' ? args.since : undefined;
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
            const emails = await fetchEmails(account.id, folder, limit, search);
            return { ok: true, emails };
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

    // ─── Calendar (stateless CalDAV against local Radicale) ──────────────
    list_calendar_events: async (args: any) => {
      try {
        const { listCalendarEvents } = await import('./db.js');
        const dbEvents = listCalendarEvents({ start: args?.start, end: args?.end });
        let caldavEvents: any[] = [];
        try {
          caldavEvents = await listEvents(args?.start, args?.end);
        } catch (err: any) {
          // Radicale/CalDAV often isn't running — fall back to DB events only
          // instead of failing the whole list.
          logger.warn({ err: String(err?.message ?? err) }, 'calendar: CalDAV unavailable, returning DB events only');
        }
        // Merge: DB events first, then CalDAV (dedup by title+start)
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const e of dbEvents) {
          const key = `${e.title}|${e.start_time || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
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
          });
        }
        for (const e of caldavEvents) {
          const key = `${e.title}|${e.start || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            title: e.title,
            start: e.start,
            start_time: e.start,
            end: e.end || null,
            end_time: e.end || null,
            all_day: e.allDay === true,
            location: e.location || '',
            description: e.description || '',
            calendar_source: 'caldav',
            uid: e.uid,
            event_id: e.uid,
          });
        }
        return { ok: true, events: merged };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    create_calendar_event: async (args: any) => {
      try {
        const title = typeof args?.title === 'string' ? args.title : '';
        const start = typeof args?.start_time === 'string' ? args.start_time : '';
        if (!title || !start) return { ok: false, error: 'missing title/start_time' };
        const uid = args?.event_id || `jarvis-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ev = {
          uid,
          title,
          description: args?.description,
          start,
          end: args?.end_time,
          allDay: args?.all_day === true,
          location: args?.location,
        };
        const r = await upsertEvent(ev);
        if (!r.ok) return r;
        return { ok: true, eventId: uid, etag: r.etag };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    update_calendar_event: async (args: any) => {
      try {
        const uid = typeof args?.event_id === 'string' ? args.event_id : '';
        if (!uid) return { ok: false, error: 'missing event_id' };
        const existing = await getEvent(uid);
        if (!existing) return { ok: false, error: 'event not found' };
        const ev = {
          uid,
          title: args?.title ?? existing.title,
          description: args?.description ?? existing.description,
          start: args?.start_time ?? existing.start,
          end: args?.end_time ?? existing.end,
          allDay: args?.start_time ? (args?.all_day === true) : existing.allDay,
          location: args?.location ?? existing.location,
        };
        const r = await upsertEvent(ev, existing.etag);
        if (!r.ok) return r;
        return { ok: true, eventId: uid, etag: r.etag };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_calendar_event: async (args: any) => {
      try {
        const uid = typeof args?.event_id === 'string' ? args.event_id : '';
        if (!uid) return { ok: false, error: 'missing event_id' };
        return await deleteEvent(uid);
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },

    // ─── Contacts (stateless CardDAV against local Radicale) ────────────
    list_contacts: async (args: any) => {
      try {
        if (args?.query) {
          const contacts = await searchContacts(String(args.query));
          return { ok: true, contacts };
        }
        const contacts = await listContacts();
        return { ok: true, contacts };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    search_contacts: async (args: any) => {
      try {
        const q = typeof args?.query === 'string' ? args.query : '';
        const contacts = await searchContacts(q);
        return { ok: true, contacts };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    get_contact: async (args: any) => {
      try {
        const c = await getContact(String(args?.uid || ''));
        if (!c) return { ok: false, error: 'contact not found' };
        return { ok: true, contact: c };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    create_contact: async (args: any) => {
      try {
        const uid = args?.uid || `jarvis-contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const c = {
          uid,
          fullName: args?.full_name,
          givenName: args?.given_name,
          familyName: args?.family_name,
          email: args?.email ? (Array.isArray(args.email) ? args.email : [args.email]) : [],
          phone: args?.phone ? (Array.isArray(args.phone) ? args.phone : [args.phone]) : [],
          org: args?.org,
          title: args?.title,
          note: args?.note,
        };
        const r = await upsertContact(c);
        if (!r.ok) return r;
        return { ok: true, contactId: uid, etag: r.etag };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    update_contact: async (args: any) => {
      try {
        const uid = typeof args?.uid === 'string' ? args.uid : '';
        if (!uid) return { ok: false, error: 'missing uid' };
        const existing = await getContact(uid);
        if (!existing) return { ok: false, error: 'contact not found' };
        const c = {
          uid,
          fullName: args?.full_name ?? existing.fullName,
          givenName: args?.given_name ?? existing.givenName,
          familyName: args?.family_name ?? existing.familyName,
          email: args?.email ? (Array.isArray(args.email) ? args.email : [args.email]) : existing.email,
          phone: args?.phone ? (Array.isArray(args.phone) ? args.phone : [args.phone]) : existing.phone,
          org: args?.org ?? existing.org,
          title: args?.title ?? existing.title,
          note: args?.note ?? existing.note,
          extra: existing.extra,
        };
        const r = await upsertContact(c, existing.etag);
        if (!r.ok) return r;
        return { ok: true, contactId: uid, etag: r.etag };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_contact: async (args: any) => {
      try {
        return await deleteContact(String(args?.uid || ''));
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },

    // ─── Todos (VTODO in the same /cal/ collection) ──────────────────────
    list_todos: async (_args: any) => {
      try {
        const todos = await listTodos();
        return { ok: true, todos };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    create_todo: async (args: any) => {
      try {
        const summary = typeof args?.summary === 'string' ? args.summary : '';
        if (!summary) return { ok: false, error: 'missing summary' };
        const uid = args?.uid || `jarvis-todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const todo = {
          uid,
          summary,
          description: args?.description,
          status: 'NEEDS-ACTION' as const,
          priority: typeof args?.priority === 'number' ? args.priority : undefined,
          due: args?.due,
          dtstart: args?.start,
          relatedTo: args?.related_to,
        };
        const r = await upsertTodo(todo);
        if (!r.ok) return r;
        return { ok: true, todoId: uid, etag: r.etag };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    complete_todo: async (args: any) => {
      try {
        const uid = typeof args?.uid === 'string' ? args.uid : '';
        if (!uid) return { ok: false, error: 'missing uid' };
        const todos = await listTodos();
        const existing = todos.find((t) => t.uid === uid);
        if (!existing) return { ok: false, error: 'todo not found' };
        const todo = {
          ...existing,
          status: 'COMPLETED' as const,
          completed: new Date().toISOString().slice(0, 19).replace('T', 'T'),
        };
        const r = await upsertTodo(todo, existing.etag);
        if (!r.ok) return r;
        return { ok: true, todoId: uid };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_todo: async (args: any) => {
      try {
        return await deleteTodo(String(args?.uid || ''));
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
        const ok = archiveProject(resolved);
        return ok ? { ok: true } : { ok: false, error: 'project not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    complete_project: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
        const ok = completeProject(resolved);
        return ok ? { ok: true } : { ok: false, error: 'project not found' };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_project: async (args: any) => {
      try {
        const id = typeof args?.projectId === 'string' ? args.projectId : '';
        const resolved = resolveProjectId(id) || id;
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
        void projectAllDeliverables().catch(() => { /* best-effort: Radicale may be down */ });
        return { ok: true, data: d };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    toggle_deliverable: async (args: any) => {
      try {
        const id = typeof args?.deliverableId === 'string' ? args.deliverableId : '';
        const d = toggleDeliverable(id);
        if (!d) return { ok: false, error: 'deliverable not found' };
        void projectAllDeliverables().catch(() => { /* best-effort */ });
        return { ok: true, data: d };
      } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
    },
    delete_deliverable: async (args: any) => {
      try {
        const id = typeof args?.deliverableId === 'string' ? args.deliverableId : '';
        const ok = deleteDeliverable(id);
        if (ok) void projectAllDeliverables().catch(() => { /* best-effort */ });
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

    const model = (getRouterState('mercury:model') || getRouterState('orchestrator:model') || '').replace(/^local:/, '') || undefined;
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
  const orchCtx = getRouterState('local:orchestrator_ctx');
  process.env.ORCHESTRATOR_NUM_CTX = orchCtx || '';
  const subCtx = getRouterState('local:subagent_ctx');
  process.env.SUBAGENT_NUM_CTX = subCtx || '';
  const atlasCtx = getRouterState('local:atlas_ctx');
  process.env.ATLAS_NUM_CTX = atlasCtx || '';
  const toolsCtx = getRouterState('local:tools_ctx');
  process.env.TOOLS_NUM_CTX = toolsCtx || '';
  const mercuryCtx = getRouterState('local:mercury_ctx');
  process.env.MERCURY_NUM_CTX = mercuryCtx || '';

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
    hephaestusModel: (getRouterState('hephaestus:model') || '').replace(/^local:/, '') || undefined,
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


async function main(): Promise<void> {
  initDatabase();
  logger.info('Database initialized');
  startChromeWatchdog();
  loadState();

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
  });

  // Start the scheduled-task loop. The scheduler no longer runs agents — it
  // injects each due task's prompt into the owner chat as a regular message
  // (attributed to Automation) and lets the normal message pipeline handle it.
  // The message loop polls the owner chat every POLL_INTERVAL, so the injected
  // prompt is picked up without an explicit poke; enqueueMessageCheck is a
  // no-op here (it exists for the GroupQueue architecture).
  startSchedulerLoop({
    registeredGroups: () => ({ [OWNER_JID]: { name: 'Owner', folder: 'owner', trigger: '', added_at: '', isMain: true, requiresTrigger: false } }) as any,
    queue: { enqueueMessageCheck: () => {} },
  });

  startCalendarSyncPoller();
  // Kontact projection: mirror project deliverables to/from the shared
  // Radicale /cal/ collection. No-ops cleanly if Radicale isn't provisioned.
  startKontactWatcher();
  void projectAllDeliverables().catch(() => { /* best-effort at boot */ });

  // ── Backup scheduler ─────────────────────────────────────────────────────
  // Check every minute whether a scheduled backup is due.
  // Seed from existing backups so a restart doesn't immediately trigger a new one.
  const existingBackups = (() => { try { return listBackups(); } catch { return []; } })();
  const lastFull = existingBackups.find((b) => b.type === 'full');
  const lastIncr = existingBackups.find((b) => b.type === 'incremental');
  let lastFullBackup: Date | null = lastFull ? new Date(lastFull.createdAt) : null;
  let lastIncrBackup: Date | null = lastIncr ? new Date(lastIncr.createdAt) : null;
  setInterval(async () => {
    try {
      const cfg = getBackupConfig();
      const now = new Date();

      if (cfg.fullEnabled && cfg.fullSchedule) {
        const interval = CronExpressionParser.parse(cfg.fullSchedule, { currentDate: now });
        const prev = interval.prev().toDate();
        if (!lastFullBackup || prev > lastFullBackup) {
          lastFullBackup = now;
          try { await createFullBackup(); }
          catch (err) { logger.error({ err }, 'Scheduled full backup failed'); }
        }
      }

      if (cfg.incrEnabled && cfg.incrSchedule) {
        const interval = CronExpressionParser.parse(cfg.incrSchedule, { currentDate: now });
        const prev = interval.prev().toDate();
        if (!lastIncrBackup || prev > lastIncrBackup) {
          lastIncrBackup = now;
          try { await createIncrementalBackup(); }
          catch (err) { logger.error({ err }, 'Scheduled incremental backup failed'); }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Backup scheduler error');
    }
  }, 60_000);

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