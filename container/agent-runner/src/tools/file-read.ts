import fs from 'fs';
import path from 'path';
import { registry, ToolContext } from '../tool-registry.js';
import { log, cleanFilePath, writeIpcFile, waitForResult, TASKS_DIR } from '../ipc-helpers.js';

registry.register({
    name: 'Read',
    description: 'Read a file from the workspace. For image files (png, jpg, jpeg, gif, webp), this gives you vision — you will see the image contents. Always use Read on images instead of Bash/PIL.',
    schema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Relative path to file (e.g. "notes.md" or "attachments/photo.jpg")' },
            offset: { type: 'number', description: 'Line number to start from (text files only)' },
            limit: { type: 'number', description: 'Number of lines to read (text files only)' },
        },
        required: ['file_path'],
    },
    handler: async (args, _context) => {
        const rawPath = String(args.file_path);
        const cleanedPath = cleanFilePath(rawPath);
        const filePath = rawPath.startsWith('/workspace/global/')
            ? rawPath
            : cleanedPath.startsWith('global/')
            ? '/workspace/' + cleanedPath
            : path.join(process.cwd(), cleanedPath);
        try {
            if (!fs.existsSync(filePath)) {
                return `Error: File not found: ${args.file_path}`;
            }
            try { fs.writeFileSync('/workspace/ipc/status.json', JSON.stringify({ phase: 'tool', tool: 'Read', label: `Reading: ${args.file_path}`, ts: Date.now() })); } catch {}
            try { fs.appendFileSync('/workspace/ipc/activity.log', JSON.stringify({ type: 'tool', name: 'Read', label: `Reading: ${args.file_path}`, ts: Date.now() }) + '\n'); } catch {}
            const ext = path.extname(filePath).toLowerCase();
            const probe = Buffer.alloc(512);
            const fd = fs.openSync(filePath, 'r');
            const bytesRead = fs.readSync(fd, probe, 0, 512, 0);
            fs.closeSync(fd);
            const hasNull = probe.slice(0, bytesRead).includes(0);
            if (hasNull) {
                const stat = fs.statSync(filePath);
                const sizeKB = Math.round(stat.size / 1024);
                if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'].includes(ext)) {
                    try {
                        const { execSync: es } = await import('child_process');
                        const buf = es(`convert "${filePath}" -resize 512x512\\> -quality 75 jpeg:- 2>/dev/null`, { maxBuffer: 5 * 1024 * 1024 });
                        if (!(globalThis as any)._pendingImages) (globalThis as any)._pendingImages = [];
                        (globalThis as any)._pendingImages.push(buf.toString('base64'));
                        log(`Image read: ${args.file_path} (${sizeKB}KB) — queued for vision`);
                        return `[Image: ${args.file_path} loaded (${sizeKB}KB). The image is in your context — describe or analyze it directly.]`;
                    } catch {
                        const buf = fs.readFileSync(filePath);
                        if (!(globalThis as any)._pendingImages) (globalThis as any)._pendingImages = [];
                        (globalThis as any)._pendingImages.push(buf.toString('base64'));
                        return `[Image: ${args.file_path} loaded (${sizeKB}KB). The image is in your context.]`;
                    }
                }
                return `[Binary file: ${args.file_path} (${sizeKB}KB, type: ${ext || 'unknown'}). Use Bash to process this file.]`;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            if (args.offset || args.limit) {
                const lines = content.split('\n');
                const offset = (args.offset || 1) - 1;
                const limit = args.limit || lines.length;
                return lines.slice(offset, offset + limit).join('\n');
            }
            return content;
        } catch (err: any) {
            return `Error reading file: ${err.message}`;
        }
    },
    toolset: 'file',
    tier: 'both',
});
