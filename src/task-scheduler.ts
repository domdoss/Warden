import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE, WORKSPACE_ROOT, AGENT_TIMEOUT } from './config.js';
import {
  deleteTask,
  getDueTasks,
  getRouterState,
  getTaskById,
  logTaskRun,
  pruneTaskRunLogs,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { runAgent, type CallbackMap } from './agent-spawn.js';
import { buildAgentCallbacks } from './index.js';
import { resolveGroupFolderPath, type RegisteredGroup } from './group-folder.js';
import { logger } from './logger.js';
import { ScheduledTask } from './types.js';

/**
 * Compute the next run time for a recurring task, anchored to the
 * task's scheduled time rather than Date.now() to prevent cumulative
 * drift on interval-based tasks.
 *
 * Co-authored-by: @community-pr-601
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') {
    // After the task has run at least once, there is no next run — return null
    // so updateTaskAfterRun marks it completed. On the initial creation call
    // (task.last_run is null), convert the local schedule_value timestamp to a
    // UTC ISO string so getDueTasks' `next_run <= now` comparison (which uses
    // new Date().toISOString() = UTC) works correctly.
    if (task.last_run) return null;
    if (!task.schedule_value) return null;
    const d = new Date(task.schedule_value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      // Guard against malformed interval that would cause an infinite loop
      logger.warn(
        { taskId: task.id, value: task.schedule_value },
        'Invalid interval value',
      );
      return new Date(now + 60_000).toISOString();
    }
    // Guard against null/invalid next_run — fall back to now + interval
    const anchor = task.next_run ? new Date(task.next_run).getTime() : NaN;
    if (isNaN(anchor)) {
      logger.warn(
        { taskId: task.id, next_run: task.next_run },
        'Null or invalid next_run for interval task, falling back to now + interval',
      );
      return new Date(now + ms).toISOString();
    }
    // Anchor to the scheduled time, not now, to prevent drift.
    // Skip past any missed intervals so we always land in the future.
    let next = anchor + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

/**
 * Minimal scheduler queue interface. GroupQueue is gone; the scheduler only
 * needs a way to serialize tasks per-chat so a single chat doesn't run two
 * tasks concurrently.
 */
export interface SchedulerQueue {
  enqueueTask(jid: string, id: string, fn: () => Promise<void>): void;
}

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: SchedulerQueue;
  sendMessage: (jid: string, text: string, model?: string) => Promise<void>;
  onTaskResult?: (task: ScheduledTask, result: string) => void;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  // Single-user schema dropped the group_folder column, so tasks read from the
  // DB carry undefined here — every task is the owner's. Default it or every
  // scheduled task errors out ("Invalid group folder") at fire time.
  if (!task.group_folder) task.group_folder = 'owner';
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Stop retry churn for malformed legacy rows.
    updateTask(task.id, { status: 'paused' });
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, error },
      'Task has invalid group folder',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    return;
  }
  fs.mkdirSync(groupDir, { recursive: true });

  // For heartbeat tasks, inject HEARTBEAT.md contents directly into the prompt
  // so the agent gets the instructions immediately without a file-read tool call.
  let prompt = task.prompt;
  if (task.id.startsWith('heartbeat-')) {
    const heartbeatPath = `${groupDir}/HEARTBEAT.md`;
    try {
      const content = fs.readFileSync(heartbeatPath, 'utf-8').trim();
      if (content) {
        prompt = `[HEARTBEAT] Execute the following instructions:\n\n---\n${content}\n---\n\nBe efficient and concise.`;
      }
    } catch {
      // File missing — keep original prompt as fallback
    }
  }

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  // Per-task model overrides the global automation model preference.
  // Strip 'local:' prefix — it's a UI convention from the dashboard dropdown,
  // not a valid Ollama model name.
  let automationModel =
    task.model || getRouterState('automation:model') || '';
  if (automationModel.startsWith('local:')) {
    automationModel = automationModel.slice(6);
  }

  // For group context mode, use the group's current session id (if any).
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  let result: string | null = null;
  let error: string | null = null;

  try {
    const output = await runAgent({
      prompt,
      workspaceRoot: WORKSPACE_ROOT,
      sessionId: sessionId || `scheduled-${task.id}`,
      model: automationModel || undefined,
      timeoutMs: AGENT_TIMEOUT,
      history: [],
      callbacks: buildAgentCallbacks(),
    });

    if (output.error) {
      error = output.error;
    }
    if (output.text) {
      // Agent output sometimes arrives as the raw {"status","result"} JSON
      // envelope — unwrap it here so chat, notifications, and last_result all
      // get the actual text (single choke point for every delivery path).
      let text = output.text;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.result === 'string') text = parsed.result;
      } catch { /* already plain text */ }
      output.text = text;
      result = text;
      // Forward result to user (sendMessage handles formatting)
      await deps.sendMessage(task.chat_jid, output.text, automationModel || undefined);
      if (deps.onTaskResult) deps.onTaskResult(task, output.text);
      // If the task was created from a web-only JID, also send to the
      // main channel so the user gets a real notification
      if (task.chat_jid.startsWith('web:')) {
        for (const [jid, g] of Object.entries(groups)) {
          if (g.isMain && !jid.startsWith('web:')) {
            await deps.sendMessage(jid, output.text, automationModel || undefined).catch(() => {});
            break;
          }
        }
      }
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  // Retry once after 60s if the model was temporarily unavailable
  if (error && (error.includes('overloaded') || error.includes('Bad Request') || error.includes('temporarily')) && !(task as any)._retried) {
    logger.info({ taskId: task.id }, 'Retrying task in 60s after transient error');
    await new Promise(r => setTimeout(r, 60_000));
    (task as any)._retried = true;
    return runTask(task, deps);
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const nextRun = computeNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';

  // One-time tasks are automatically deleted after completion
  if (task.schedule_type === 'once') {
    deleteTask(task.id);
    logger.info({ taskId: task.id }, 'One-time task auto-deleted after completion');
  } else {
    updateTaskAfterRun(task.id, nextRun, resultSummary);
  }
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      // Prune task-run logs every loop tick (cheap; getDueTasks runs frequently).
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        deps.queue.enqueueTask(currentTask.chat_jid, currentTask.id, () =>
          runTask(currentTask, deps),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  // Periodic housekeeping: prune task-run logs every 12 hours.
  setInterval(() => {
    try {
      const pruned = pruneTaskRunLogs(100);
      logger.info({ pruned }, 'Task logs pruned (12h cycle)');
    } catch (err) {
      logger.warn({ err }, 'Prune task logs failed');
    }
  }, 12 * 60 * 60 * 1000).unref();

  loop();
}

/** @internal - for tests only. */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}