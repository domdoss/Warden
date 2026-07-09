import fs from 'fs';
import { registry } from '../tool-registry.js';

registry.register({
    name: 'Glob',
    description: 'Find files matching a pattern.',
    schema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Glob pattern like "**/*.ts"' },
            path: { type: 'string', description: 'Directory to search' },
        },
        required: ['pattern'],
    },
    handler: async (args, _context) => {
        try {
            try { fs.writeFileSync('/workspace/ipc/status.json', JSON.stringify({ phase: 'tool', tool: 'Glob', label: `Searching: ${args.pattern}`, ts: Date.now() })); } catch {}
            try { fs.appendFileSync('/workspace/ipc/activity.log', JSON.stringify({ type: 'tool', name: 'Glob', label: `Searching: ${args.pattern}`, ts: Date.now() }) + '\n'); } catch {}
            const globModule = await import('glob');
            const searchPath = args.path || process.cwd();
            const globFn = (globModule as any).glob || (globModule as any).default || globModule;
            const files: string[] = await globFn(args.pattern, { cwd: searchPath, absolute: false } as any);
            return files.join('\n') || 'No files found.';
        } catch (err: any) {
            return `Error searching files: ${err.message}`;
        }
    },
    toolset: 'file',
    tier: 'both',
});
