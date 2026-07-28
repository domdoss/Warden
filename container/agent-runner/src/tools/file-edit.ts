import fs from 'fs';
import path from 'path';
import { registry } from '../tool-registry.js';
import { cleanFilePath } from '../ipc-helpers.js';

registry.register({
    name: 'Edit',
    description: 'Edit a file by replacing text.',
    schema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Path to file' },
            old_string: { type: 'string', description: 'Exact text to replace' },
            new_string: { type: 'string', description: 'Replacement text' },
        },
        required: ['file_path', 'old_string', 'new_string'],
    },
    handler: async (args, _context) => {
        const cleaned = cleanFilePath(args.file_path);
        if (cleaned.startsWith('attachments/') || cleaned === 'attachments') {
            return `Error: attachments/ is read-only input. Copy the file first: Bash("cp attachments/${path.basename(cleaned)} myproject/")`;
        }
        const filePath = path.join(process.cwd(), cleaned);
        try {
            if (!fs.existsSync(filePath)) {
                return `Error: File not found: ${args.file_path}`;
            }
            try { fs.writeFileSync('/workspace/ipc/status.json', JSON.stringify({ phase: 'tool', tool: 'Edit', label: `Editing: ${args.file_path}`, ts: Date.now() })); } catch {}
            try { fs.appendFileSync('/workspace/ipc/activity.log', JSON.stringify({ type: 'tool', name: 'Edit', label: `Editing: ${args.file_path}`, ts: Date.now() }) + '\n'); } catch {}
            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content.includes(args.old_string)) {
                return `Error: old_string not found in file. Make sure it matches exactly.`;
            }
            const idx = content.indexOf(args.old_string);
            const newContent = content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
            fs.writeFileSync(filePath, newContent);
            return `File edited: ${args.file_path}`;
        } catch (err: any) {
            return `Error editing file: ${err.message}`;
        }
    },
    toolset: 'file',
    tier: 'both',
});
