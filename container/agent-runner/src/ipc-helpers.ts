import fs from 'fs';
import os from 'os';
import path from 'path';

// IPC dir for parent<->agent-runner communication. Previously `/workspace/ipc`
// (a Docker mount); on host, use a per-session temp dir so concurrent runs don't
// collide. The parent doesn't read these files anymore (stdio is the channel),
// but some legacy sub-agent paths still writeIpcFile + waitForResult. Pointing
// the dir at a real writable path keeps them from throwing EACCES.
export const IPC_DIR: string = process.env.WARDEN_IPC_DIR
  || path.join(os.tmpdir(), 'warden-ipc');
export const TASKS_DIR = path.join(IPC_DIR, 'tasks');
export const RESULTS_DIR = path.join(IPC_DIR, 'results');

// Ensure the dirs exist on import so writeIpcFile doesn't race with mkdir.
try {
  fs.mkdirSync(IPC_DIR, { recursive: true });
  fs.mkdirSync(TASKS_DIR, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
} catch { /* ignore — best-effort */ }

export function log(message: string): void {
    console.error(`[agent-runner] ${message}`);
}

export function writeIpcFile(dir: string, data: any): string {
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const filepath = path.join(dir, filename);
    const tempPath = `${filepath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filepath);
    return filename;
}

export async function waitForResult(prefix: string, timeoutMs = 30000): Promise<any> {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const beforeFiles = new Set(fs.readdirSync(RESULTS_DIR));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 200));
        try {
            const currentFiles = fs.readdirSync(RESULTS_DIR);
            for (const f of currentFiles) {
                if (!beforeFiles.has(f) && f.startsWith(prefix) && f.endsWith('.json')) {
                    const fp = path.join(RESULTS_DIR, f);
                    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
                    fs.unlinkSync(fp);
                    return data;
                }
            }
        } catch { /* dir may not exist yet */ }
    }
    return null;
}

export function cleanFilePath(p: string): string {
    return String(p)
        .replace(/^(?:\/workspace\/project\/groups\/[^/]+\/|\/workspace\/group\/|workspace\/group\/|\/workspace\/|workspace\/|group\/)+/, '');
}

/**
 * Resolve a model-supplied file path the way a shell would: bare `~` and a
 * leading `~/` are the user's home, absolute paths stay absolute, and only
 * genuine relatives land under the runner cwd (WORKSPACE_ROOT). Without this,
 * Write('~/Desktop/x') silently creates a literal "~" directory inside the
 * workspace and still reports success — the file never reaches where the user
 * asked, and the digest then parrots a false "it's on your desktop".
 */
export function resolveUserPath(p: string, cwd: string = process.cwd()): string {
    const cleaned = cleanFilePath(p);
    const home = os.homedir();
    const expanded = cleaned === '~' ? home
        : cleaned.startsWith('~/') ? path.join(home, cleaned.slice(2))
        : cleaned;
    return path.isAbsolute(expanded) ? path.normalize(expanded) : path.join(cwd, expanded);
}
