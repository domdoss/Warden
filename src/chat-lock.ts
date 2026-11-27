import { spawnSync } from 'child_process';
import fs from 'fs';
import { logger } from './logger.js';

/**
 * Chat lock — a cooperative gate that stops the owner chat from running a turn
 * while a heavy, model/GPU-contending job is active (MentaraIQ bug-fix loop,
 * Alpha Stack analysis). The message loop holds incoming messages (does not
 * advance the cursor) until the lock clears, then processes them in order.
 *
 * The lock is held per-holder so the two jobs never stomp each other, and
 * `refreshChatLocks()` is called from the main poll loop each tick to reconcile
 * the in-memory state with what is actually running.
 */

const holders = new Map<string, string>(); // holder -> human-readable reason

export function setChatLock(holder: string, reason: string): void {
  if (!holders.has(holder)) {
    holders.set(holder, reason);
    logger.info({ holder, reason }, 'chat-lock: acquired');
  }
}

export function clearChatLock(holder: string): void {
  if (holders.delete(holder)) {
    logger.info({ holder }, 'chat-lock: released');
  }
}

export function isChatLocked(): boolean {
  return holders.size > 0;
}

export function getChatLock(): { locked: boolean; reason: string } {
  if (holders.size === 0) return { locked: false, reason: '' };
  const reason = [...holders.entries()].map(([h, r]) => `${h}: ${r}`).join(' · ');
  return { locked: true, reason };
}

const BUGLOOP_RUN_JSON = '/home/user/Projects/MentaraIQ/local-bug-pipeline/work/run.json';

// Training-loop steps (audit → modify → train) are detached processes, so the
// authoritative signal that one is running is the process table. Checking every
// tick would spawn pgrep constantly; throttle it and cache the last answer.
const TRAINING_MARKERS = [
  'training/loop/audit-failures.mjs',
  'training/loop/modify-parts.mjs',
  'training/loop/train-1epoch.sh',
  'training/chatbot/train.sh',
];
let lastTrainingCheck = 0;
let trainingActive = false;

function trainingStepActive(): boolean {
  const now = Date.now();
  if (now - lastTrainingCheck < 4000) return trainingActive;
  lastTrainingCheck = now;
  trainingActive = TRAINING_MARKERS.some((marker) => {
    try {
      const r = spawnSync('pgrep', ['-f', marker], { encoding: 'utf-8' });
      return ((r.stdout || '').trim().length > 0);
    } catch {
      return false;
    }
  });
  return trainingActive;
}

/**
 * Reconcile the chat lock with the on-disk/process truth for the two jobs that
 * contend with the chat seat. Cheap (one file read + one loopback fetch), so it
 * rides the message loop's poll tick with no separate timer.
 */
export async function refreshChatLocks(): Promise<void> {
  // MentaraIQ bug-fix loop: active while its run.json reports a running batch.
  // The pipeline's own server owns this file and flips status to complete/failed
  // when the batch ends, so "running" is authoritative.
  try {
    const run = JSON.parse(fs.readFileSync(BUGLOOP_RUN_JSON, 'utf8'));
    if (run && run.status === 'running') setChatLock('bugloop', 'MentaraIQ bug-fix loop running');
    else clearChatLock('bugloop');
  } catch {
    clearChatLock('bugloop');
  }

  // Training loop (audit/modify/train): holds the chat seat and pauses all
  // scheduled tasks while a step runs, so nothing contends for the model/GPU.
  if (trainingStepActive()) {
    setChatLock('training', 'Training loop running');
  } else {
    clearChatLock('training');
  }

  // Alpha Stack: its webapp (spawned on 127.0.0.1:8765) exposes /api/status with
  // a `running` flag that is true only while the analysis worker is iterating
  // tickers. Probing the live endpoint is authoritative — the .nightly.lock PID
  // file is stale/unreliable. The analysis only runs inside the webapp process,
  // so a down webapp correctly means "not running".
  try {
    const resp = await fetch('http://127.0.0.1:8765/api/status', { signal: AbortSignal.timeout(1500) });
    if (resp.ok) {
      const data = (await resp.json()) as { running?: boolean };
      if (data && data.running) setChatLock('alphastack', 'Alpha Stack analysis running');
      else clearChatLock('alphastack');
    } else {
      clearChatLock('alphastack');
    }
  } catch {
    clearChatLock('alphastack');
  }
}
