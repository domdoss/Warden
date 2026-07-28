/**
 * Kontact projection + mirror-back (KONTACT_PLAN Stage 4).
 *
 * One-way projection: project deliverables render as VTODOs in the shared
 * /cal/ Radicale collection, so they show up in KOrganizer alongside normal
 * todos. The rich project graph (financials, blockers, timesheets) never
 * leaves Warden — only the actionable todo surface is projected.
 *
 * Two-way on todo fields only: a VTODO status flip in Radicale (the user
 * checked the box in KOrganizer) mirrors completion back into the internal
 * project_deliverables table. The graph stays the source of truth; only the
 * done bit flows back.
 *
 * VTODO UID scheme: jarvis-proj-<projectId>-deliv-<deliverableId>
 * RELATED-TO:   jarvis-proj-project-<projectId>
 *
 * Change trigger: fs.watch on the Radicale storage dir (fix #1 in the plan) is
 * the event source — there is no cache to refresh. A 5-min fallback reconcile
 * catches anything fs.watch misses on exotic filesystems.
 */

import fs from 'node:fs';
import path from 'node:path';
import { listTodos, upsertTodo, deleteTodo, type CalDavTodo } from './providers/caldav.js';
import { getAllProjects, getProjectDeliverables, setDeliverableDone } from './db.js';
import { logger } from './logger.js';

const DELIV_UID_RE = /^jarvis-proj-(.+)-deliv-(.+)$/;
const RADICALE_STORAGE_DIR = process.env.RADICALE_STORAGE_DIR || '';

function deliverableVtodoUid(projectId: string, deliverableId: string): string {
  return `jarvis-proj-${projectId}-deliv-${deliverableId}`;
}
function projectVtodoRelated(projectId: string): string {
  return `jarvis-proj-project-${projectId}`;
}

interface WantedTodo {
  summary: string;
  due?: string;
  status: 'NEEDS-ACTION' | 'COMPLETED';
  relatedTo: string;
}

/**
 * Push the current set of project deliverables into the shared /cal/
 * collection. Creates, updates, and deletes VTODOs so the Radicale state
 * matches the internal graph. Safe to call repeatedly (idempotent; only writes
 * on diff).
 */
export async function projectAllDeliverables(): Promise<void> {
  const projects = getAllProjects();
  const wanted = new Map<string, WantedTodo>();

  for (const p of projects) {
    if (p.archived) continue;
    const delivs = getProjectDeliverables(p.id);
    for (const d of delivs) {
      const uid = deliverableVtodoUid(p.id, d.id);
      wanted.set(uid, {
        summary: `${p.name}: ${d.name}`,
        due: d.due_date || undefined,
        status: d.done ? 'COMPLETED' : 'NEEDS-ACTION',
        relatedTo: projectVtodoRelated(p.id),
      });
    }
  }

  const todos = await listTodos();
  const ours = todos.filter((t) => DELIV_UID_RE.test(t.uid));

  for (const [uid, w] of wanted) {
    const existing = ours.find((t) => t.uid === uid);
    if (
      existing &&
      existing.summary === w.summary &&
      (existing.due || '') === (w.due || '') &&
      (existing.status || 'NEEDS-ACTION') === w.status
    ) {
      continue; // unchanged — skip the round-trip
    }
    const r = await upsertTodo(
      { uid, summary: w.summary, due: w.due, status: w.status, relatedTo: w.relatedTo },
      existing?.etag,
    );
    if (!r.ok) logger.warn({ uid, err: r.error }, 'kontact-projection: upsert failed');
  }

  // Delete orphaned VTODOs (deliverable was removed / project archived).
  for (const t of ours) {
    if (!wanted.has(t.uid)) {
      const r = await deleteTodo(t.uid, t.etag);
      if (!r.ok) logger.warn({ uid: t.uid, err: r.error }, 'kontact-projection: delete failed');
    }
  }
}

/**
 * Mirror-back: read VTODOs from /cal/ and reflect status into the internal
 * project_deliverables table. Only the done bit flows back; the graph is
 * untouched. Called by the fs.watch event source and the periodic fallback.
 */
export async function reconcileDeliverablesFromTodos(): Promise<void> {
  let todos: CalDavTodo[];
  try {
    todos = await listTodos();
  } catch (err: any) {
    logger.warn({ err }, 'kontact-projection: reconcile listTodos failed');
    return;
  }

  for (const t of todos) {
    const m = DELIV_UID_RE.exec(t.uid);
    if (!m) continue;
    const projectId = m[1];
    const deliverableId = m[2];
    const wantDone: 0 | 1 = t.status === 'COMPLETED' || t.status === 'CANCELLED' ? 1 : 0;

    const delivs = getProjectDeliverables(projectId);
    const d = delivs.find((x) => x.id === deliverableId);
    if (!d) continue; // VTODO for a deliverable we don't know about — leave it

    if (d.done !== wantDone) {
      const changed = setDeliverableDone(deliverableId, wantDone);
      if (changed) {
        logger.info({ deliverableId, projectId, wantDone }, 'kontact-projection: mirrored VTODO status into deliverable');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// fs.watch event source (fix #1)
// ---------------------------------------------------------------------------

let watcher: fs.FSWatcher | null = null;
let debounce: NodeJS.Timeout | null = null;
let fallbackTimer: NodeJS.Timeout | null = null;

function scheduleReconcile(): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void reconcileDeliverablesFromTodos().catch((err) =>
      logger.warn({ err }, 'kontact-projection: debounced reconcile failed'),
    );
  }, 1500);
}

/** Start watching the Radicale storage tree + a periodic fallback reconcile.
 *  No-ops gracefully if the storage dir isn't configured or doesn't exist yet
 *  (Radicale not provisioned) so startup never breaks on a fresh box. */
export function startKontactWatcher(): void {
  if (watcher) return;

  const dir = RADICALE_STORAGE_DIR;
  if (!dir) {
    logger.info('kontact-projection: RADICALE_STORAGE_DIR not set; watcher disabled (projection still runs on deliverable changes)');
  } else if (!fs.existsSync(dir)) {
    logger.info({ dir }, 'kontact-projection: Radicale storage dir not present yet; watcher will not start (Radicale unprovisioned)');
  } else {
    try {
      watcher = fs.watch(dir, { recursive: true }, () => scheduleReconcile());
      watcher.on('error', (err) => logger.warn({ err }, 'kontact-projection: fs.watch error'));
      logger.info({ dir }, 'kontact-projection: fs.watch armed on Radicale storage');
    } catch (err: any) {
      logger.warn({ err, dir }, 'kontact-projection: fs.watch unavailable on this FS — falling back to interval only');
    }
  }

  // Fallback reconcile every 5 min catches anything fs.watch misses.
  if (!fallbackTimer) {
    fallbackTimer = setInterval(() => { void reconcileDeliverablesFromTodos(); }, 5 * 60 * 1000);
    fallbackTimer.unref?.();
  }
}

/** Stop the watcher + fallback (tests). */
export function stopKontactWatcher(): void {
  if (watcher) { watcher.close(); watcher = null; }
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
  if (debounce) { clearTimeout(debounce); debounce = null; }
}