import fs from 'fs';
import { registry } from '../tool-registry.js';

registry.register({
    name: 'Grep',
    description: 'Search for text in files.',
    schema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Regex to search for' },
            path: { type: 'string', description: 'Directory or file to search' },
            glob: { type: 'string', description: 'File pattern filter' },
        },
        required: ['pattern'],
    },
    handler: async (args, _context) => {
        try {
            try { fs.writeFileSync('/workspace/ipc/status.json', JSON.stringify({ phase: 'tool', tool: 'Grep', label: `Grepping: ${args.pattern}`, ts: Date.now() })); } catch {}
            try { fs.appendFileSync('/workspace/ipc/activity.log', JSON.stringify({ type: 'tool', name: 'Grep', label: `Grepping: ${args.pattern}`, ts: Date.now() }) + '\n'); } catch {}
            const { execSync } = await import('child_process');
            const searchPath = args.path || process.cwd();
            const globPattern = args.glob ? `--include="${args.glob}"` : '';
            const cmd = `grep -rn ${globPattern} "${args.pattern}" "${searchPath}" 2>/dev/null || true`;
            const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
            return result || 'No matches found.';
        } catch (err: any) {
            return `Error searching: ${err.message}`;
        }
    },
    toolset: 'file',
    tier: 'both',
});
