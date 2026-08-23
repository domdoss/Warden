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
import { runAgent, killCurrentAgent, cancelCurrentTurn, CallbackMap, pushSupervisorNote, runSubAgentBackground, runSubAgentSync, setActivityPublisher } from './agent-spawn.js';
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
  getCalendarEventByIcalUid,
  listCalendarEvents,
  getTaskById,
  getSatelliteIp,
} from './db.js';
import { decryptApiKey } from './encryption.js';
import { fetchEmails, sendEmail, getEmailById } from './email.js';
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
import { captureScreenshotFromSecurityApp, captureWebcamFromSecurityApp, readHostImage } from './capture.js';
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

// Oculus senders — background agents (Oculus) whose send_message output
// should also be spoken over the voice client's SSE stream.
const OCULUS_SENDERS = new Set(['Oculus']);

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
  // Exclude background agent messages (Oculus security alerts and greetings) —
  // they are stored for the user/dashboard, but the orchestrator must NOT see them
  // in its history (otherwise it parrots/acknowledges them).
  const contextMessages = rawHistory
    .filter((m) => !pendingIds.has(m.id) && m.sender_name !== 'Oculus')
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
 * Oculus (situational-awareness agent) model resolution. Uses the dedicated
 * oculus:model router setting (dashboard Models card) — no fallback. A `local:`
 * prefix is stripped. seedPerAgentModelSettings() materializes oculus:model from
 * the orchestrator model on first boot, so this is never empty in normal use.
 */
function resolveAwarenessModel(): string {
  // Oculus has its own model row in Settings (oculus:model) — no sharing, no
  // fallback: seedPerAgentModelSettings materializes it on first boot, so an
  // empty value here means it was manually cleared and should surface loudly.
  return (getRouterState('oculus:model') || '').trim().replace(/^local:/, '');
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

/** Latest security frame reference fetched for the current Oculus run, so the
 *  host can attach it to Oculus's send_message even if the model forgets. */
let latestOculusFrame: string | null = null;

/** Spawn Oculus, the single background security/awareness agent (fire-and-forget).
 *  Never awaited. Pass the original awareness text so Oculus has full context.
 *
 *  eyes_open gates the IMAGE only. Text awareness events are always logged
 *  (arrivals/departures/face labels) while the eyes server runs; "eyes closed"
 *  means Oculus logs the text event with no image. "eyes open" means on a new
 *  (debounced) event the host fetches the frame so Oculus can look at it,
 *  describe it, log it, and move on. The detector reports eyes_open in the
 *  AWARENESS payload; if it's missing we default to text-only (eyes closed). */
export function spawnOculusBackground(task: string, awarenessText?: string): void {
  if (awarenessText) {
    lastAwarenessEvent = awarenessText;
  }
  let eyesOpen = false;
  if (awarenessText) {
    const m = awarenessText.match(/data:\s*(\{.*\})/);
    if (m) {
      try { eyesOpen = !!JSON.parse(m[1]).eyes_open; } catch { /* default text-only */ }
    }
  }
  const spawn = (prompt: string) =>
    runSubAgentBackground({
      agent: 'oculus',
      prompt,
      model: resolveAwarenessModel(),
      sessionId: 'owner',
      workspaceRoot: WORKSPACE_ROOT,
      chatJid: OWNER_JID,
      groupFolder: 'owner',
      isMain: true,
      timeoutMs: 90 * 1000, // short — don't let a stuck model linger
      callbacks: buildAgentCallbacks({ awarenessText }),
    } as any);

  // Eyes closed: log the text event only — no image fetch, no description.
  if (!eyesOpen) {
    latestOculusFrame = null;
    spawn(task);
    return;
  }
  // Eyes open: wait ~2s for the person to settle, then pull the frame so Oculus
  // can look at it + describe it. If the frame server is slow/down, Oculus still
  // runs with text only rather than being blocked.
  void new Promise((resolve) => setTimeout(resolve, 2000))
    .then(() => fetchAndSaveSecurityFrame())
    .then((imageTag) => {
      latestOculusFrame = imageTag || null;
      if (!imageTag) {
        logger.warn('spawnOculusBackground: could not fetch security frame for Oculus');
      }
      const prompt = imageTag ? `${task}\n\nLatest security frame: ${imageTag}` : task;
      spawn(prompt);
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

        // For Oculus security alerts, append the real pre-fetched security
        // frame so Telegram sends the photo. Only swap when we actually have a
        // frame — otherwise leave whatever [Image: ...] reference Oculus wrote
        // in place so Telegram can still resolve and send it.
        let finalText = text;
        if (senderName === 'Oculus' && latestOculusFrame) {
          finalText = finalText.replace(/\s*\[Image:\s*[^\]]+\]/gi, '').trim();
          finalText = `${finalText} ${latestOculusFrame}`;
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
        // The Pi is headless — it has no display to capture. The screenshot is
        // pulled from the laptop satellite's /screenshot endpoint (the security
        // app's frame server, which runs in the laptop's graphical session).
        // Region is cropped here from the full-screen PNG. window_title is not
        // supported remotely (no way to focus a window on the laptop from here).
        let region: { x: number; y: number; w: number; h: number } | undefined;
        const r = args?.region;
        if (r && typeof r === 'object') {
          const w = Math.max(0, Math.round(+r.w || 0));
          const h = Math.max(0, Math.round(+r.h || 0));
          if (w > 0 && h > 0) {
            region = { x: Math.round(+r.x || 0), y: Math.round(+r.y || 0), w, h };
          }
        }
        const shotUrl = `http://${getSatelliteIp()}:8765/screenshot`;
        const cap = await captureScreenshotFromSecurityApp(shotUrl, region);
        logger.info(
          { width: cap.width, height: cap.height, mediaType: cap.mediaType, region, url: shotUrl },
          'desktop_screenshot: captured from laptop satellite',
        );
        return { ok: true, image: cap.image, mediaType: cap.mediaType, width: cap.width, height: cap.height };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    webcam_capture: async (args: any) => {
      try {
        // The webcam lives on the laptop, and the security detector owns
        // /dev/video0 there. Pull the latest frame from the satellite's /frame
        // endpoint — the one way Warden gets a webcam photo. No ffmpeg/local
        // fallback: the Pi has no webcam, and a fallback would mask the real
        // path failing.
        const frameUrl = `http://${getSatelliteIp()}:8765/frame`;
        const cap = await captureWebcamFromSecurityApp(frameUrl);
        logger.info(
          { width: cap.width, height: cap.height, mediaType: cap.mediaType, url: frameUrl },
          'webcam_capture: captured from laptop satellite',
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

    // ─── Oculus alert (close) ──────────────────────────────────────────────
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

    // "Open your eyes" — toggle the detector's eyes_open flag on (it will POST
    // AWARENESS events again). Mirrors close_oculus_alert. The detector keeps
    // running + showing the feed; eyes_open means awareness is active, eyes
    // closed means it's paused.
    arm_security: async (_args: any) => {
      const ip = getSatelliteIp();
      const url = `http://${ip}:8765/open`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(url, { method: 'POST', signal: controller.signal });
          const body = await res.text().catch(() => '');
          logger.info({ status: res.status, body: body.slice(0, 120) }, 'arm_security: eyes opened');
          return { ok: res.ok, state: body };
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        logger.warn({ err }, 'arm_security: oculus app not reachable');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // "Close your eyes" — toggle the detector's eyes_open flag off (stop posting
    // AWARENESS events).
    disarm_security: async (_args: any) => {
      const ip = getSatelliteIp();
      const url = `http://${ip}:8765/close`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(url, { method: 'POST', signal: controller.signal });
          const body = await res.text().catch(() => '');
          logger.info({ status: res.status, body: body.slice(0, 120) }, 'disarm_security: eyes closed');
          return { ok: res.ok, state: body };
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        logger.warn({ err }, 'disarm_security: oculus app not reachable');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Oculus's conditions log (own sqlite store, store/security.db). Records
    // each alert assessment with an exact timestamp, and queries history by
    // local-time range so Oculus can reference events by time/date.
    security_log: async (args: any) => {
      return securityLog(args);
    },

    // Oculus's situational-awareness history (arrivals/departures/greetings).
    awareness_log: async (args: any) => {
      return awarenessLog(args);
    },

    // Oculus watch-out-for match: copy the latest fetched frame into the owner's
    // uploads tree (groups/owner/oculus/<ts>.jpg) so the user can review it later,
    // and return the uploads path. Silent — no message to the user. Called by the
    // Oculus agent when an AWARENESS event matches a user-defined watch-out-for
    // situation. The frame was already pulled + saved by fetchAndSaveSecurityFrame.
    oculus_capture: async (_args: any) => {
      try {
        if (!latestOculusFrame) return { ok: false, error: 'no frame available' };
        const m = latestOculusFrame.match(/\[Image:\s*(.+?)\]/);
        if (!m) return { ok: false, error: 'could not parse frame reference' };
        const rel = m[1].trim();                      // e.g. attachments/xyz.jpg
        const src = path.join(WORKSPACE_ROOT, 'groups', 'owner', rel);
        if (!fs.existsSync(src)) return { ok: false, error: 'frame file not found' };
        const destDir = path.join(WORKSPACE_ROOT, 'groups', 'owner', 'oculus');
        fs.mkdirSync(destDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const base = path.basename(rel);
        const dest = path.join(destDir, `${stamp}-${base}`);
        fs.copyFileSync(src, dest);
        const uploadPath = `oculus/${stamp}-${base}`;
        logger.info({ uploadPath }, 'oculus_capture: watch-out-for match saved to uploads');
        return { ok: true, path: uploadPath };
      } catch (err: any) {
        logger.warn({ err }, 'oculus_capture: failed to save frame');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Oculus registers a known person; the satellite computes the face embedding
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

    // Orchestrator vision aid: the latest AWARENESS info from Oculus / the
    // camera detector — the most recent event text plus the recent host event
    // rows (event, is_known/label, person_count, how long the room's been
    // occupied/empty). Lets the orchestrator answer "who's in the room" by
    // combining a webcam_capture photo with this structured context (names,
    // counts, durations) that the photo alone can't provide.
    awareness_status: async () => {
      try {
        const recent = await queryAwarenessHostEvents(5);
        return { ok: true, latest: lastAwarenessEvent, recent };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Orchestrator → Oculus direct. The user tells Jarvis a presence/schedule
    // note (e.g. "heading out for the evening"); Oculus processes it according to
    // the rules in eyes_ears/oculus.md. Oculus does not reply in the chat.
    tell_oculus: async (args: any) => {
      try {
        const message = typeof args?.message === 'string' ? args.message.trim() : '';
        if (!message) return { ok: false, error: 'missing message' };
        const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const localNow = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
        const compactTs = localNow.replace(/[-:]/g, ''); // match the detector's %Y%m%dT%H%M%S
        const task =
          `Current local time is ${localNow} (timezone ${tz}).\n\n` +
          `AWARENESS — note at ${compactTs}. data: {"event":"note","message":${JSON.stringify(message)},"ts":"${compactTs}"}\n\n` +
          `The user passed you a note. Read eyes_ears/oculus.md and follow its rules. ` +
          `Do NOT send_message and do NOT reply in chat unless the rules explicitly tell you to greet. Stop after one action.`;
        spawnOculusBackground(task);
        logger.info('tell_oculus: spawned Oculus to process note');
        return { ok: true };
      } catch (err: any) {
        logger.warn({ err }, 'tell_oculus: failed to spawn Oculus');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Orchestrator → Oculus live status query. Spawns Oculus synchronously so
    // it can pull/process live data and return a concise report, instead of
    // returning stale cached rows. The orchestrator uses this to decide whether
    // a current room-status question needs a webcam frame.
    oculus_query: async (args: any) => {
      try {
        const question = typeof args?.question === 'string' && args.question.trim()
          ? args.question.trim()
          : 'live status';
        const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const localNow = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
        const task =
          `[ORCHESTRATOR_QUERY] Current local time is ${localNow} (timezone ${tz}).\n\n` +
          `The orchestrator asks: "${question}"\n\n` +
          `You are Oculus, the situational-awareness agent. This is a live query from the orchestrator, NOT an AWARENESS event. ` +
          `Do NOT send_message to the user (you do not have it). ` +
          `If the question is about what is happening NOW or what is on screen: call awareness_status for the current room state, and security_frame once to look at the live screen if it would help answer. ` +
          `If the question is about what happened at or around a given time: query awareness_log (action: query) and security_log for that time window to read the text logs. ` +
          `Then return a concise report as your final plain-text output. ` +
          `Start with NOTHING_NOTEWORTHY if the room is currently empty and there is no person present, no recent motion/arrival/departure, and the camera is normal. ` +
          `Start with NOTEWORTHY if a person is currently present, an unknown person is detected, there is recent motion, or the camera is covered/moved. ` +
          `If the user asked about a specific time, report what the logs show for that window. ` +
          `Then add one sentence of detail. Read eyes_ears/oculus.md if you need user-specific rules, but do not greet or alert the user directly.`;
        const model = resolveAwarenessModel();
        const result = await runSubAgentSync({
          agent: 'oculus',
          prompt: task,
          model,
          workspaceRoot: WORKSPACE_ROOT,
          chatJid: OWNER_JID,
          groupFolder: 'owner',
          isMain: true,
          timeoutMs: 30 * 1000,
          callbacks: buildAgentCallbacks({}),
        } as any);
        logger.info({ report: result.content.slice(0, 200), exitCode: result.exitCode }, 'oculus_query: got report');
        return { ok: true, report: result.content };
      } catch (err: any) {
        logger.warn({ err }, 'oculus_query: failed to query Oculus');
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    // Oculus raised an alert → light the red alert on the satellite detector.
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

    // Mercury respects the dashboard Mercury rows (mercury:model /
    // local:mercury_ctx) — the same rows the memory writeback resolves. A bare
    // /api/chat goes straight to the endpoint with the model and ctx the
    // dashboard actually shows, instead of spawning through the agent loop on
    // the shared Toolcall row. Explicit env override still wins.
    const model = (process.env.WARDEN_MEMORY_MODEL
      || getRouterState('mercury:model')
      || getRouterState('local:subagent_model')
      || '').replace(/^local:/, '').trim();
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
    let summary = '';
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: 'user', content: summaryPrompt }],
          options: { temperature: 0, ...(numCtx ? { num_ctx: numCtx } : {}) },
          keep_alive: keepAlive,
        }),
      });
      if (!resp.ok) {
        logger.warn({ status: resp.status, model }, 'Mercury summary call failed');
        return;
      }
      const data = (await resp.json()) as { message?: { content?: string } };
      summary = cleanAgentText(data.message?.content || '');
    } catch (err: any) {
      logger.warn({ err: err?.message ?? err, model }, 'Mercury summary call failed');
      return;
    } finally {
      clearTimeout(timer);
    }
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
  // Oculus never closes an ABNORMAL alert itself; the user closes it after
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
    let reply = 'Alert closed.';
    try {
      const r = await buildAgentCallbacks().close_security_alert({});
      if (r && r.ok === false) reply = `Tried to close the security alert: ${r.error || 'detector app not reachable'}.`;
    } catch (err: any) {
      reply = `Could not close the security alert: ${err?.message ?? err}.`;
    }
    await deliverReply(reply);
    pushNotification('owner', { type: 'chat_complete', message: reply, from: OWNER_JID });
    logger.info({ chatJid: OWNER_JID }, 'Oculus alert closed by user');
    return;
  }

  // ── "Open / close your eyes" — the user toggles the detector's eyes_open
  // flag (awareness on/off). We call the arm_security/disarm_security host
  // callback directly (the orchestrator doesn't own that tool — the callback
  // POSTs to the detector's /open or /close) and acknowledge — no orchestrator
  // turn needed.
  const closeEyesText = pending.some((m) => {
    const s = (m.content || '').toLowerCase();
    return (/\bclose\b/.test(s) && /\beyes?\b/.test(s)) || /\bshut\b.*\beyes?\b/.test(s);
  });
  const openEyesText = pending.some((m) => {
    const s = (m.content || '').toLowerCase();
    return /\bopen\b/.test(s) && /\beyes?\b/.test(s);
  });
  if (openEyesText || closeEyesText) {
    lastAgentTimestamp = pending[pending.length - 1]!.timestamp;
    saveState();
    let reply = '';
    try {
      const cb = buildAgentCallbacks();
      if (closeEyesText) {
        const r = await cb.disarm_security({});
        reply = r && r.ok === false
          ? `Tried to close your eyes: ${r.error || 'detector app not reachable'}.`
          : 'Eyes closed — awareness paused.';
      } else {
        const r = await cb.arm_security({});
        reply = r && r.ok === false
          ? `Tried to open your eyes: ${r.error || 'detector app not reachable'}.`
          : 'Eyes open — awareness active.';
      }
    } catch (err: any) {
      reply = `Could not toggle the eyes: ${err?.message ?? err}.`;
    }
    await deliverReply(reply);
    pushNotification('owner', { type: 'chat_complete', message: reply, from: OWNER_JID });
    logger.info({ chatJid: OWNER_JID, open: openEyesText, close: closeEyesText }, 'Eyes toggled by user');
    return;
  }

  // ── Awareness events → Oculus direct pipe ───────────────────────────────
  // An AWARENESS message (posted by the standalone detector's presence
  // tracker — arrival/departure/note, event-driven, never per-frame) is piped
  // straight to Oculus, the background situational-awareness agent, in code.
  // Same engrained pattern: the event row is pre-written to awareness_log
  // (so it's recorded even if Oculus crashes), Oculus runs on the model
  // configured in dashboard (oculus:model), and we return so the orchestrator
  // never burns a turn on it.
  // Independent of the arm/disarm state — awareness ≠ security arming.
  const isAwareness = pending.some((m) => (m.content || '').startsWith('AWARENESS'));
  if (isAwareness) {
    lastAgentTimestamp = pending[pending.length - 1]!.timestamp;
    saveState();
    logger.info({ chatJid: OWNER_JID, messageCount: pending.length }, 'Awareness → routing to Oculus (background)');

    const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localNow = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
    const events = pending.filter((m) => (m.content || '').startsWith('AWARENESS'));
    const latest = events.length > 0 ? events[events.length - 1] : pending[pending.length - 1]!;
    const awarenessText = latest.content || '';
    // Pull the user's "watch out for" list so Oculus can match silently.
    let watchOut: string[] = [];
    try { watchOut = JSON.parse(getRouterState('oculus:watch_out_for') || '[]'); } catch { watchOut = []; }
    const watchOutBlock = watchOut.length
      ? `\n\nWatch out for (user-defined situations; if this event CLEARLY matches one, record it in awareness_log with assessment "flagged" and the matched situation, then call oculus_capture to save the photo to uploads — stay SILENT, do not message the user):\n${watchOut.map((w) => `- ${w}`).join('\n')}`
      : '';
    const task = `Current local time is ${localNow} (timezone ${tz}).\n\n${awarenessText}\n\nYou are Oculus, Warden's SILENT situational-awareness agent. Use tools only. Read eyes_ears/oculus.md and apply its rules exactly. Your ONLY job is to LOG this event silently: call awareness_log (action: record) with the event details, then stop. Do NOT message the user, do NOT greet, do NOT alert — you have no send_message.${watchOutBlock}\n\nThe AWARENESS payload includes:\n- event type (arrival|departure|camera_covered|camera_moved|motion_burst|note)\n- person_count\n- is_known and label (from InsightFace face embeddings when a face is visible)\n- room occupancy, motion area, camera state\n\nDo not write a plain-text response; use tools only.`;

    try {
      // Host-side auto-log of the raw event, independent of Oculus.
      recordAwarenessEvent(awarenessText);
      spawnOculusBackground(task, awarenessText);
    } catch (err: any) {
      logger.warn({ err }, 'Awareness: failed to spawn Oculus');
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
    // Supervisor (monitor-tick) model — blank inherits the orchestrator model in
    // the runner. No ctx row: cloud/small models use their native window.
    supervisorModel: (getRouterState('supervisor:model') || '').replace(/^local:/, '') || undefined,
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
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nWINDOW: This is the HOURLY digest. Only consider activity in the LAST HOUR (emails received in the last hour; calendar events in the next 2 hours; tasks that were created, completed, or updated in the last hour). Do NOT mention the user bio, sleep schedule, daily routine, or long-running projects unless something about them changed in the last hour.\n\nGROUNDING: Use only facts in INPUT or in the read_emails results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call read_emails with the `since` and `before` values copied verbatim from the INPUT "Email window (UTC)" line (limit 50, preview_only true). Do not invent your own timestamps.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or read_emails, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nACTIONABLE EXTRACTION: From the emails you read with read_emails, also extract concrete actionable items the user must do or attend. This is separate from the "Recent Emails" display block — these drive task/event creation.\n- A task is a concrete to-do the user must do, expressed as an action the user performs: prepare, make sure, get ready, confirm, review, send, schedule, fix, follow up, deliver, pay, book, submit. Put "due" in ISO only when the message states a deadline; leave it empty otherwise.\n- An event is a scheduled meeting, appointment, or dated occasion the user will attend, where the date and start time are stated inside the message. Title it with the scheduled thing itself (a demo, a review, an appointment). Put "start" in ISO using that stated meeting time. Put "end" in ISO when an end time is stated; leave it empty otherwise. The receive/arrival date of an email is metadata — it is NEVER an event start time. Promotional emails, receipts, newsletters, account alerts, shipping notices, and automated reminders are NOT items.\n- A single message may yield both an event and a task. The scheduled thing at a stated time is an event; a readiness or follow-up action around it (prepare, make sure, get ready, confirm, follow up) is a separate task.\n- Set "project_hint" to "personal", "work", or a project name when the item clearly belongs to one; leave it empty otherwise.\n- Extract only items explicitly stated in the emails. Greetings, questions, opinions, status updates, and automated/bot-sent messages are not items. Empty arrays are the correct answer when nothing is actionable. Do not invent items.\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing, and [] for the actionable arrays when nothing is actionable):\n{"title":"<current date and time as shown in INPUT>","summary":"<one or two sentences in markdown about what happened in the LAST HOUR only — or say it was quiet>","alerts":[],"blocks":[{"icon":"inbox","label":"Recent Emails","type":"list","items":["From: <sender>: <subject> (<time>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing in the next 2 hours."]},{"icon":"tasks","label":"Active Tasks","type":"list","items":["No active tasks."]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}],"actionable_tasks":[{"title":"","due":"","project_hint":""}],"actionable_events":[{"title":"","start":"","end":""}]}',
  },
  {
    id: 'iris-digest-daily',
    cron: '17 21 * * *',
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nGROUNDING: Use only facts in INPUT or in the read_emails results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call read_emails with the `since` and `before` values copied verbatim from the INPUT "Email window (UTC)" line (limit 100, preview_only true). Do not invent your own timestamps.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or read_emails, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing):\n{"title":"<date from INPUT>","summary":"<Start with: Good morning. Then one or two sentences briefing Dominic on today — calendar events, active tasks, and notable emails. Do NOT mention sleep schedule, wake times, or daily routine.>","alerts":[],"blocks":[{"icon":"review","label":"Day in Review","type":"prose","text":"<one or two sentences on calendar events, tasks, and emails for today from INPUT/emails — or empty if there is no data. Do not mention sleep schedule or daily routine.>"},{"icon":"inbox","label":"Recent Emails","type":"list","items":["From: <sender>: <subject> (<time>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing on the calendar today."]},{"icon":"tasks","label":"Active Tasks","type":"list","items":["No active tasks."]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"tomorrow","label":"Tomorrow","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}]}',
  },
  {
    id: 'iris-digest-weekly',
    cron: '30 20 * * 0',
    prompt: 'Scan INPUT and recent emails, then output a JSON object. No commentary, no markdown outside the JSON.\n\nGROUNDING: Use only facts in INPUT or in the read_emails results. Use the empty-state value shown for a section with no data. Do not invent emails, events, or tasks.\n\nEmails: call read_emails with the `since` and `before` values copied verbatim from the INPUT "Email window (UTC)" line (limit 200, preview_only true). Do not invent your own timestamps. Pick the 6-10 most relevant.\n\nLook Out For: INPUT has a "Look Out For" list. For each item, if it matches an email, calendar event, task, or weather in INPUT or read_emails, add to "alerts": "<item> - matched by <what matched>". Otherwise alerts is [].\n\nOutput this shape (fill every field from INPUT/emails; use "" for a field with nothing):\n{"title":"<week-of date from INPUT>","summary":"<two or three sentences in markdown summarizing the shape of the week, from INPUT/emails>","alerts":[],"blocks":[{"icon":"review","label":"Week in Review","type":"prose","text":"<two or three sentences on the shape of the week from INPUT/emails, or empty if there is no data>"},{"icon":"inbox","label":"Email Activity","type":"list","items":["From: <sender>: <subject> (<date>)"]},{"icon":"calendar","label":"Calendar","type":"list","items":["Nothing on the calendar this week."]},{"icon":"tasks","label":"Tasks","type":"list","items":["[status] <title>"]},{"icon":"weather","label":"Weather","type":"prose","text":""},{"icon":"nudge","label":"Nudge","type":"prose","text":""}]}',
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
      // Mercury compaction scheduler: same poll loop, time/downtime trigger.
      // Fire-and-forget; idle-gated + shared cleaner lock so it never overlaps
      // a turn or another cleaner.
      void maybeScheduleMercury();
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
  chromeHeadless = headless;
  logger.info({ cdpPort: CHROME_CDP_PORT, headless, wayland: hasWayland, ...displayEnv }, 'Launched persistent Chrome');
}

function startChromeWatchdog(): void {
  // Kill any stale chrome on this port before starting fresh.
  try { execSync(`pkill -f "remote-debugging-port=${CHROME_CDP_PORT}" 2>/dev/null`); } catch {}
  let chromeLaunchTime = Date.now();
  let chromeFailures = 0;
  let chromeLaunched = false;

  function restartChrome(reason: string): void {
    logger.warn({ reason, chromeFailures }, 'Relaunching Chrome');
    try { execSync(`pkill -f "remote-debugging-port=${CHROME_CDP_PORT}" 2>/dev/null`); } catch {}
    chromeFailures = 0;
    chromeLaunchTime = Date.now();
    spawnChrome();
    chromeLaunched = true;
  }

  // Initial launch: wait for the graphical session to come up so Chrome starts
  // headed (a visible window) instead of going headless. systemd user services
  // start at login, so the Wayland/X session is usually up within seconds;
  // poll for up to 30s. If no session is found, Chrome launches headless as a
  // fallback (this desktop always has a Wayland session, so the wait resolves
  // in seconds). This does not block the rest of startup — it runs async while
  // DB/channels/agents come up.
  void (async () => {
    for (let i = 0; i < 15; i++) {
      const e = discoverDisplayEnv();
      if ((e.WAYLAND_DISPLAY && e.XDG_RUNTIME_DIR) || e.DISPLAY) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    spawnChrome();
    chromeLaunched = true;
    chromeLaunchTime = Date.now();
  })();

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
  seed('oculus:model', orch);
  // Supervisor (monitor-tick) model inherits the orchestrator on first boot —
  // no blank anywhere: every dashboard model dropdown always shows a concrete
  // model. The user picks a small/cloud one afterward if they want.
  seed('supervisor:model', orch);
  // ctx — preserve each agent's current effective value.
  seed('local:byte_ctx', toolsCtx);
  seed('local:dexter_ctx', toolsCtx);
  seed('local:iris_ctx', toolsCtx);
  seed('local:artemis_ctx', atlasCtx);
  // Oculus bakes in 8192 today (granite4.1:8b overflows at the 2048 default) —
  // materialize that as its ctx setting so the hardcoded bake can be removed.
  seed('local:oculus_ctx', '8192');
  // Vulkan had no ctx override (native window) — leave it blank (native).
}

/**
 * Sync every per-agent num_ctx override from router_state into process.env so
 * the agent-runner child (and background spawns like Oculus, which inherit
 * ...process.env) always sees the current value. Called at boot (after the
 * migration seed, so background spawns before the first chat turn are covered)
 * and again per turn (so dashboard changes take effect immediately).
 */
export function syncAgentCtxEnv(): void {
  process.env.ORCHESTRATOR_NUM_CTX = getRouterState('local:orchestrator_ctx') || '';
  process.env.SUBAGENT_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.ATLAS_NUM_CTX = getRouterState('local:atlas_ctx') || '';
  process.env.TOOLS_NUM_CTX = getRouterState('local:tools_ctx') || '';
  // Byte, Dexter, and Iris share one ctx (local:subagent_ctx).
  process.env.BYTE_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.DEXTER_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.IRIS_NUM_CTX = getRouterState('local:subagent_ctx') || '';
  process.env.ARTEMIS_NUM_CTX = getRouterState('local:artemis_ctx') || '';
  process.env.VULKAN_NUM_CTX = getRouterState('local:vulkan_ctx') || '';
  // Mercury and Oculus have their own ctx rows in Settings. Until a per-agent
  // value is saved they inherit the shared toolcall ctx so effective behavior
  // is unchanged.
  process.env.MERCURY_NUM_CTX =
    getRouterState('local:mercury_ctx') || getRouterState('local:subagent_ctx') || '';
  process.env.OCULUS_NUM_CTX =
    getRouterState('local:oculus_ctx') || getRouterState('local:subagent_ctx') || '';
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
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: ' ', keep_alive: -1, stream: false }),
      });
      logger.info({ model, ok: res.ok }, 'Warmed resident Ollama model');
    } catch (err) {
      logger.warn({ model, err }, 'Model warmup failed (non-fatal)');
    }
  }
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