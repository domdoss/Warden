/**
 * OpenCode runner — the "night and day" path.
 *
 * When the seat is switched to OpenCode (WARDEN_RUNNER=opencode, or the
 * `local:runner` router_state row is "opencode"), a seat turn is handed to the
 * OpenCode agent instead of the in-process agent-runner loop. OpenCode owns the
 * model loop, tool calling, and (via MCP) MARM memory and the Warden browser
 * gate. Warden's host stays the body: channels, message store, scheduler,
 * dashboard.
 *
 * Transport: we shell out to `opencode run --format json`, one process per
 * turn, using OpenCode's persistent background service for session continuity
 * (per-chat `--session`). This is deliberately simple and robust — no in-tree
 * dependency on OpenCode's SDK, no HTTP listener to babysit. A future revision
 * can move to `opencode serve` + the HTTP API if per-turn process startup
 * matters.
 */

import { spawn } from 'node:child_process';
import { AgentInput, AgentOutput } from './types.js';
import { logger } from './logger.js';
import { getRouterState } from './db.js';

/** Whether the seat should run through OpenCode instead of the built-in runner. */
export function isOpencodeRunner(): boolean {
  const env = (process.env.WARDEN_RUNNER || '').trim().toLowerCase();
  if (env) return env === 'opencode' || env === '1' || env === 'true';
  return (getRouterState('local:runner') || '').trim() === 'opencode';
}

const DEFAULT_SEAT_MODEL = 'ollama/qwen3.8:27b';
const DEFAULT_CLOUD_MODEL = 'deepseek/deepseek-v4-pro';

/**
 * Map a Warden model name (the `atlas:model` router_state value, e.g.
 * `orchatlas-ft:latest` or `qwen3.8:27b`) to an OpenCode `provider/model` ref.
 * Local Ollama models get an `ollama/` prefix; cloud Ollama models
 * (`…:cloud`) already resolve under `ollama/` too. A value that already carries
 * a provider slash is passed through untouched.
 */
function toOpencodeRef(model: string | undefined): string | null {
  const m = (model || '').replace(/^local:/, '').trim();
  if (!m) return null;
  if (m.includes('/')) return m; // already provider/model
  return `ollama/${m}`;
}

/** The seat model to use for an OpenCode turn (hybrid: local first, cloud override). */
function seatModel(input: AgentInput): string {
  // 1. explicit env override wins (per-host pinning)
  const envModel = process.env.WARDEN_OPENCODE_MODEL?.trim();
  if (envModel) return toOpencodeRef(envModel) ?? envModel;
  // 2. the dashboard's configured seat model, when it is a real model and not
  //    the retired orchatlas-ft default
  const configured = toOpencodeRef(input.model);
  if (configured && !configured.startsWith('ollama/orchatlas-ft')) return configured;
  // 3. local-first default
  return process.env.WARDEN_OPENCODE_SEAT_MODEL?.trim() || DEFAULT_SEAT_MODEL;
}

/** Resolve the `opencode` binary (configurable for non-PATH installs). */
function opencodeBin(): string {
  return process.env.OPENCODE_BIN || 'opencode';
}

/** Collect the assistant's text from `opencode run --format json` output lines. */
function parseJsonLines(raw: string): string {
  const parts: string[] = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const evt = JSON.parse(s);
      const part = evt?.part;
      if (part && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        parts.push(part.text);
      }
    } catch {
      // ignore non-JSON lines (loading banners, warnings)
    }
  }
  return parts.join('\n').trim();
}

/**
 * Run one seat turn through OpenCode. Mirrors `AgentOutput` so the host's
 * post-processing (cleanAgentText, JSON unwrap) is unchanged.
 */
export function runOpencodeTurn(input: AgentInput): Promise<AgentOutput> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeoutMs = input.timeoutMs || 180000;
    const model = seatModel(input);
    // OpenCode session IDs must start with "ses". Keep them stable per Warden
    // sessionId so chat continuity survives across turns and process restarts.
    const slug = String(input.sessionId || 'warden-owner').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^_+|_+$/g, '').slice(0, 110);
    const sessionId = `ses_${slug || 'warden-owner'}`;

    const args = [
      'run',
      '--agent', 'warden',
      '--session', sessionId,
      '--model', model,
      '--format', 'json',
      '--auto',
      input.prompt,
    ];

    logger.info({ model, sessionId, promptLen: input.prompt.length }, 'opencode-runner: dispatching turn');

    const child = spawn(opencodeBin(), args, {
      env: process.env,
      cwd: process.cwd(), // /opt/Warden — resolves .opencode/opencode.json + agents/warden.md
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });

    let settled = false;
    const finish = (o: AgentOutput) => { if (!settled) { settled = true; resolve(o); } };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ text: '', exitCode: 124, durationMs: Date.now() - start, error: 'opencode turn timed out' });
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ text: '', exitCode: 1, durationMs: Date.now() - start, error: `opencode spawn failed: ${e.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const text = parseJsonLines(out);
      if (text) {
        finish({ text, exitCode: code ?? 0, durationMs: Date.now() - start });
      } else if (code !== 0) {
        finish({ text: '', exitCode: code ?? 1, durationMs: Date.now() - start, error: err.trim().slice(0, 500) || `opencode exited ${code}` });
      } else {
        finish({ text: '', exitCode: code ?? 0, durationMs: Date.now() - start, error: 'opencode produced no text' });
      }
    });
  });
}

export { DEFAULT_CLOUD_MODEL };
