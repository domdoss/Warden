import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

/**
 * Suggested Tasks — actionable items Byte surfaces from email scans for the
 * user to review and commit to a real project/task via the dashboard. The
 * agent only writes suggestions here; it never creates real work tasks. The
 * user edits the title + picks a project + clicks Add, and an HTTP POST does
 * the real createWorkTask.
 *
 * Simple flat list, NO expiry, NO spans, NO delivery tracking — a suggestion
 * stays pending until the user commits (→ 'added') or dismisses it. Dedup
 * prevents a re-scan from re-adding a suggestion that's still pending.
 *
 * Stored as DATA_DIR/suggested_tasks.json.
 */
export interface SuggestedTask {
  id: string;
  title: string;
  body: string;
  suggested_project: string; // project name or 'personal'
  due_date?: string | null;
  source: string; // source email subject/sender
  status: 'pending' | 'added' | 'dismissed';
  created_at: string; // ISO
}

const FILE = path.join(DATA_DIR, 'suggested_tasks.json');

function load(): SuggestedTask[] {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function save(tasks: SuggestedTask[]): void {
  try {
    fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err }, 'Failed to write suggested_tasks.json');
  }
}

function newId(): string {
  return `sug_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export interface AddSuggestedTaskOpts {
  body?: string;
  suggested_project?: string;
  due_date?: string | null;
  source?: string;
}

/**
 * Add a suggestion. Dedup: if a pending suggestion with the same title + source
 * already exists, return it without adding a duplicate (returns {ok, duplicate}).
 */
export function addSuggestedTask(title: string, opts: AddSuggestedTaskOpts = {}): { ok: boolean; id?: string; duplicate: boolean } {
  const t = (title || '').trim();
  if (!t) return { ok: false, duplicate: false };
  const source = (opts.source || '').trim();
  const tasks = load();
  const dup = tasks.find(
    (x) => x.status === 'pending' && x.title === t && x.source === source,
  );
  if (dup) return { ok: true, id: dup.id, duplicate: true };
  const task: SuggestedTask = {
    id: newId(),
    title: t,
    body: (opts.body || '').trim(),
    suggested_project: (opts.suggested_project || 'personal').trim() || 'personal',
    due_date: opts.due_date ? String(opts.due_date) : null,
    source,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  tasks.push(task);
  save(tasks);
  return { ok: true, id: task.id, duplicate: false };
}

/** Pending suggestions only, newest first. */
export function getSuggestedTasks(): SuggestedTask[] {
  return load()
    .filter((t) => t.status === 'pending')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getSuggestedTask(id: string): SuggestedTask | undefined {
  return load().find((t) => t.id === id);
}

export interface UpdateSuggestedTaskOpts {
  title?: string;
  body?: string;
  suggested_project?: string;
  due_date?: string | null;
  status?: 'pending' | 'added' | 'dismissed';
}

export function updateSuggestedTask(id: string, opts: UpdateSuggestedTaskOpts): boolean {
  const tasks = load();
  const t = tasks.find((x) => x.id === id);
  if (!t) return false;
  if (typeof opts.title === 'string') t.title = opts.title.trim();
  if (typeof opts.body === 'string') t.body = opts.body;
  if (typeof opts.suggested_project === 'string') t.suggested_project = opts.suggested_project.trim() || 'personal';
  if (opts.due_date !== undefined) t.due_date = opts.due_date ? String(opts.due_date) : null;
  if (opts.status) t.status = opts.status;
  save(tasks);
  return true;
}