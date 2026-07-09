import fs from 'fs';
import path from 'path';
import { registry } from '../tool-registry.js';
import { cleanFilePath } from '../ipc-helpers.js';

registry.register({
    name: 'Write',
    description: 'Write content to a file.',
    schema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Relative path to file (e.g. "notes.md" or "docs/plan.md")' },
            content: { type: 'string', description: 'Content to write' },
        },
        required: ['file_path', 'content'],
    },
    handler: async (args, _context) => {
        const cleaned = cleanFilePath(args.file_path);
        if (cleaned.startsWith('attachments/') || cleaned === 'attachments') {
            return `Error: attachments/ is read-only input. Copy the file first: Bash("cp attachments/${path.basename(cleaned)} myproject/")`;
        }
        const filePath = path.join(process.cwd(), cleaned);
        if (args.file_path.endsWith('.md') && (!args.content || args.content.trim() === '')) {
            return `Error: Cannot delete or clear .md files. Protected file: ${args.file_path}`;
        }
        try {
            try { fs.writeFileSync('/workspace/ipc/status.json', JSON.stringify({ phase: 'tool', tool: 'Write', label: `Writing: ${args.file_path}`, ts: Date.now() })); } catch {}
            try { fs.appendFileSync('/workspace/ipc/activity.log', JSON.stringify({ type: 'tool', name: 'Write', label: `Writing: ${args.file_path}`, ts: Date.now() }) + '\n'); } catch {}
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, args.content);
            return `File written: ${args.file_path}`;
        } catch (err: any) {
            return `Error writing file: ${err.message}`;
        }
    },
    toolset: 'file',
    tier: 'both',
});
