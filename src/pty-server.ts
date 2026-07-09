/**
 * Per-connection PTY for the dashboard's terminal pane.
 *
 * Each /api/terminal WebSocket gets its OWN independent shell pty — the
 * user's own terminal, not shared with the agent. The agent's Bash tool
 * does NOT route through here; it runs commands directly via child_process
 * spawn (see agent-spawn.ts execRequestHandler). If the agent wants to show
 * the user something in a visible terminal, it runs `gnome-terminal ...` (or
 * equivalent) as a command.
 */
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

/** True if the `node-pty` native binding is installed. Memoized. */
let _ptyChecked = false;
let _ptyAvailable = false;
export function nodePtyIsAvailable(): boolean {
  if (_ptyChecked) return _ptyAvailable;
  _ptyChecked = true;
  try {
    require('node-pty');
    _ptyAvailable = true;
  } catch {
    _ptyAvailable = false;
  }
  return _ptyAvailable;
}

export interface PtySession {
  readonly id: string;
  write(data: Buffer | string): void;
  onOutput(cb: (data: Buffer) => void): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  wait(): Promise<{ exitCode: number }>;
}

/**
 * Spawn an independent shell pty for one WS client. Not shared with the
 * agent or any other client.
 */
export function spawnPty(opts?: { cols?: number; rows?: number; cwd?: string; command?: string; args?: string[] }): PtySession {
  const id = randomUUID();
  const cols = opts?.cols ?? 80;
  const rows = opts?.rows ?? 24;
  const cwd = opts?.cwd ?? process.cwd();

  let pty: any;
  try {
    pty = require('node-pty');
  } catch (err) {
    throw new Error('node-pty is not installed. Run `npm install` after adding it to package.json.');
  }

  const shell = opts?.command || process.env.SHELL || '/bin/zsh';
  const shellArgs = opts?.args || [];
  const proc = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  const outputCbs = new Set<(data: Buffer) => void>();
  let exited = false;
  let exitCode = 0;
  let exitResolvers: Array<(v: { exitCode: number }) => void> = [];

  proc.onData((data: string) => {
    const buf = Buffer.from(data, 'utf8');
    for (const cb of outputCbs) {
      try { cb(buf); } catch { /* listener fault */ }
    }
  });

  proc.onExit(({ exitCode: code }: { exitCode: number; signal?: number }) => {
    exited = true;
    exitCode = code ?? 0;
    for (const resolve of exitResolvers) resolve({ exitCode });
    exitResolvers = [];
  });

  return {
    id,
    write(data: Buffer | string) {
      if (exited) return;
      try {
        proc.write(typeof data === 'string' ? data : data.toString('utf8'));
      } catch (err) {
        logger.warn({ err }, 'pty-server: write failed');
      }
    },
    onOutput(cb) {
      outputCbs.add(cb);
    },
    resize(cols: number, rows: number) {
      try {
        proc.resize(Math.max(1, cols), Math.max(1, rows));
      } catch { /* pty may have exited */ }
    },
    kill() {
      try { proc.kill(); } catch { /* already dead */ }
    },
    wait() {
      if (exited) return Promise.resolve({ exitCode });
      return new Promise((resolve) => exitResolvers.push(resolve));
    },
  };
}

// --- Legacy compatibility shims -------------------------------------------
// Older callers referenced these names. They're kept as thin no-ops/wrappers
// so imports don't break during the migration. The agent's exec path no
// longer touches this module.

/** Always false now: tmux is no longer used. */
export function tmuxIsAvailable(): boolean {
  return nodePtyIsAvailable();
}

export function killTmuxSession(): void { /* no-op */ }

export function broadcastToTerminalClients(_data: Buffer): void { /* no-op */ }