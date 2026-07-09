/**
 * Group folder path resolution + registration type.
 *
 * Extracted from the deleted `group-folder.ts` / `legacy-shims.ts` so that
 * task-scheduler.ts and memory-writeback.ts can share the same strict
 * folder-name validation without pulling in any multi-user stubs.
 */
import path from 'path';
import { GROUPS_DIR } from './config.js';

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger?: string;
  added_at: string;
  isMain?: boolean;
  requiresTrigger?: boolean;
  [k: string]: any;
}

const GROUP_FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Resolve a group folder name to an absolute path under GROUPS_DIR, with
 * traversal validation. Throws on invalid folder names or paths that escape
 * GROUPS_DIR.
 */
export function resolveGroupFolderPath(folder: string): string {
  if (!folder || !GROUP_FOLDER_PATTERN.test(folder) || folder.includes('..')) {
    throw new Error(`Invalid group folder "${folder}"`);
  }
  const base = GROUPS_DIR;
  const resolved = path.resolve(base, folder);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${resolved}`);
  }
  return resolved;
}