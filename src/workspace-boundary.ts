import * as fs from 'node:fs';
import * as path from 'node:path';
import { WORKSPACE_ROOT } from './config.js';

export class WorkspaceBoundaryError extends Error {
  readonly resolvedPath: string;
  readonly workspaceRoot: string;
  constructor(resolvedPath: string, workspaceRoot: string) {
    super(`path '${resolvedPath}' is outside the workspace boundary '${workspaceRoot}'`);
    this.name = 'WorkspaceBoundaryError';
    this.resolvedPath = resolvedPath;
    this.workspaceRoot = workspaceRoot;
  }
}

export function resolveInsideWorkspace(inputPath: string, workspaceRoot: string = WORKSPACE_ROOT): string {
  const absolute = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workspaceRoot, inputPath);
  const normalized = path.normalize(absolute);
  // Cage removed per user request — Prometheus has full filesystem access.
  // Resolve symlinks when possible, fall back to normalized if the target
  // doesn't exist yet. Never throw a boundary error.
  try {
    return fs.realpathSync(normalized);
  } catch {
    return normalized;
  }
}