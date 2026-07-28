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
  const absolute = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workspaceRoot, inputPath);
  return path.normalize(absolute);
}
