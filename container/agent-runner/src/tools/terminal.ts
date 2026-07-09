import fs from 'fs';
import { registry } from '../tool-registry.js';

const PROMETHEUS_SESSION = 'prometheus-shell';
const EXIT_FILE = '/tmp/.prometheus_last_exit';

registry.register({
    name: 'Bash',
    description: 'Execute a bash command.',
    schema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'Command to execute' },
            timeout: { type: 'number', description: 'Timeout in ms' },
        },
        required: ['command'],
    },
    handler: async (args, _context) => {
        const cmd = args.command;
        if (/\brm\b.*-[a-zA-Z]*[rf].*(\s+\*|\s+\.\/\*|\s+\/\s*$)/.test(cmd)) {
            return 'Error: Cannot rm -rf the entire filesystem root. Delete specific files by name.';
        }

        const { execSync, spawnSync } = await import('child_process');
        const label = `Running: ${cmd.slice(0, 80)}`;

        let useTmux = false;
        try { execSync(`tmux has-session -t ${PROMETHEUS_SESSION} 2>/dev/null`, { encoding: 'utf-8' }); useTmux = true; } catch {}

        if (!useTmux) {
            try {
                const result = execSync(cmd, { encoding: 'utf-8', timeout: args.timeout || 120000, cwd: process.cwd(), shell: '/bin/bash' });
                return result || 'Command executed successfully (no output).';
            } catch (err: any) {
                return `Error: ${err.message}`;
            }
        }

        // If PROMPT_COMMAND sentinel isn't installed yet (session created outside of
        // our init path, or reused from a previous process), source the init script
        // into the live session before sending any command. Without this every Bash
        // call polls indefinitely and times out because EXIT_FILE is never written.
        const INIT_SCRIPT = '/tmp/prometheus-shell-init.sh';
        if (!fs.existsSync(EXIT_FILE)) {
            try {
                fs.writeFileSync(INIT_SCRIPT,
                    `[ -f /etc/bash.bashrc ] && source /etc/bash.bashrc\n` +
                    `[ -f ~/.bashrc ] && source ~/.bashrc\n` +
                    `__prometheus_precmd() { local ec=$?; echo "$ec" > ${EXIT_FILE}; }\n` +
                    `PROMPT_COMMAND="__prometheus_precmd\${PROMPT_COMMAND:+;\${PROMPT_COMMAND}}"\n` +
                    `export PS1='[prometheus] \\w\\$ '\n`,
                    { mode: 0o644 });
            } catch { /* best-effort */ }
            spawnSync('tmux', ['send-keys', '-t', PROMETHEUS_SESSION, `source ${INIT_SCRIPT}`, 'Enter'], { encoding: 'utf-8', timeout: 3000 });
            const initDeadline = Date.now() + 2000;
            while (Date.now() < initDeadline) {
                if (fs.existsSync(EXIT_FILE)) break;
                try { execSync('sleep 0.02', { encoding: 'utf-8' }); } catch { break; }
            }
        }

        // Snapshot sentinel mtime and pane line count before sending.
        let beforeMtime = 0;
        try { beforeMtime = fs.statSync(EXIT_FILE).mtimeMs; } catch {}
        const capBefore = spawnSync('tmux', ['capture-pane', '-t', PROMETHEUS_SESSION, '-p', '-S', '-1000'], { encoding: 'utf-8', timeout: 5000 });
        const beforeLines = (capBefore.stdout || '').split('\n').length;

        try {
            const r1 = spawnSync('tmux', ['send-keys', '-t', PROMETHEUS_SESSION, '-l', cmd], { encoding: 'utf-8', timeout: 5000 });
            if (r1.status !== 0) throw new Error(`tmux send-keys failed: ${r1.stderr || r1.stdout}`);
            const r2 = spawnSync('tmux', ['send-keys', '-t', PROMETHEUS_SESSION, 'Enter'], { encoding: 'utf-8', timeout: 5000 });
            if (r2.status !== 0) throw new Error(`tmux Enter failed: ${r2.stderr || r2.stdout}`);
        } catch (err: any) {
            return `Error sending command to terminal: ${err.message}`;
        }

        const timeout = args.timeout || 120000;
        const start = Date.now();
        while (Date.now() - start < timeout) {
            let now = 0;
            try { now = fs.statSync(EXIT_FILE).mtimeMs; } catch {}
            if (now > beforeMtime) break;
            await new Promise(r => setTimeout(r, 30));
        }

        let exitCode = -1;
        try { exitCode = parseInt(fs.readFileSync(EXIT_FILE, 'utf-8').trim(), 10); } catch {}

        const capAfter = spawnSync('tmux', ['capture-pane', '-t', PROMETHEUS_SESSION, '-p', '-S', '-2000'], { encoding: 'utf-8', timeout: 5000 });
        let output = '';
        if (capAfter.stdout) {
            const lines = capAfter.stdout.split('\n');
            let slice = lines.slice(Math.max(0, beforeLines - 1));
            while (slice.length && !slice[slice.length - 1].trim()) slice.pop();
            if (slice.length && /[\$%#]\s*$/.test(slice[slice.length - 1])) slice.pop();
            output = slice.join('\n').trimStart();
        }

        if (Number.isNaN(exitCode) || exitCode === -1) {
            try { spawnSync('tmux', ['send-keys', '-t', PROMETHEUS_SESSION, 'C-c'], { encoding: 'utf-8', timeout: 3000 }); } catch {}
            return `Error: Command timed out after ${timeout}ms.\n${output}`;
        }
        if (exitCode !== 0) {
            return `Error (exit ${exitCode}): ${output}`;
        }
        return output || 'Command executed successfully (no output).';
    },
    toolset: 'terminal',
    tier: 'public',
});
