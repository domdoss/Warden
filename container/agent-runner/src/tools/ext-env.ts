// Reads a credential from the runtime environment: process.env first (the host
// may pass it through), then the project env file at data/env/env (the canonical
// secrets location — see src/env.ts on the host side). The agent-runner child
// process does not inherit the host's lazily-read env-file values, so this reads
// the file directly, mirroring the host's readEnvFile parsing exactly.
import fs from 'fs';
import path from 'path';

export function readToken(key: string): string {
    const fromEnv = process.env[key] || '';
    if (fromEnv) return fromEnv;
    try {
        const root = process.env.WARDEN_ROOT || process.cwd();
        const content = fs.readFileSync(path.join(root, 'data', 'env', 'env'), 'utf-8');
        for (const line of content.split('\n')) {
            const t = line.trim();
            if (!t || t.startsWith('#')) continue;
            const eq = t.indexOf('=');
            if (eq === -1) continue;
            if (t.slice(0, eq).trim() !== key) continue;
            let v = t.slice(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1);
            }
            return v;
        }
    } catch {
        /* file missing/unreadable — token not set */
    }
    return '';
}
