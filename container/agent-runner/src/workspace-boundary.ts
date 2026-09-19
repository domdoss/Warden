import * as path from 'node:path';

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

function expandTilde(p: string): string {
  if (!p) return p;
  return p.startsWith('~/') || p === '~' ? path.join(process.env.HOME ?? '', p.slice(1)) : p;
}
function defaultWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT
    ? path.resolve(expandTilde(process.env.WORKSPACE_ROOT))
    : path.resolve(process.env.HOME ?? '/root');
}

export function resolveInsideWorkspace(inputPath: string, workspaceRoot: string = defaultWorkspaceRoot()): string {
  // `~` is a shell convention, not a path segment. expandTilde was applied to
  // WORKSPACE_ROOT but never to the caller's path, so "~/Desktop/notes.md" was
  // treated as relative and landed in a literal `~` DIRECTORY inside the
  // workspace (/home/dominic/Warden/~/Desktop/...). read_file resolved it the
  // same wrong way, so the file read back fine and the agent reported "saved to
  // your Desktop" for a file that was not on the Desktop (2026-09-18).
  const expanded = expandTilde(inputPath);
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(workspaceRoot, expanded);
  return path.normalize(absolute);
}
