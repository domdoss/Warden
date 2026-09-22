import fs from 'fs';
import path from 'path';
import os from 'os';
import { registry, ToolContext } from '../tool-registry.js';
import { log, cleanFilePath, writeIpcFile, waitForResult, TASKS_DIR } from '../ipc-helpers.js';

// Resolve a user-supplied path to an absolute filesystem path. Handles three
// cases the workspace-relative default doesn't:
//  - "~/..."  → expand to the home directory
//  - "/abs..." → an absolute local path OUTSIDE the workspace (e.g. a file the
//    user "attached" by pointing the chat at a local file/dir). Warden has no
//    sandbox, so the agent can read any local path the user has access to.
//  - everything else → resolved relative to the workspace (existing behavior).
export function resolveFilePath(rawPath: string): string {
    const cleanedPath = cleanFilePath(rawPath);
    if (rawPath.startsWith('~')) {
        return path.join(os.homedir(), rawPath.slice(1));
    }
    if (rawPath.startsWith('/workspace/global/')) return rawPath;
    if (cleanedPath.startsWith('global/')) return '/workspace/' + cleanedPath;
    if (cleanedPath.startsWith('/')) return cleanedPath; // absolute local path
    return path.join(process.cwd(), cleanedPath);
}

registry.register({
    name: 'Read',
    description: '{"what":"read a text file, list a directory, or view an image","paths":"workspace-relative, absolute, or ~/ under home","images":"you see the image — the one way, before Bash"}',
    schema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: '{"what":"the file to read","format":"workspace-relative, absolute (starts with /), or ~/ under home","directory":"a directory returns a listing of its contents"}' },
            offset: { type: 'number', description: '{"what":"first line to read","unit":"line number","default":1,"text_files":"only"}' },
            limit: { type: 'number', description: '{"what":"how many lines to read","default":"all remaining","text_files":"only"}' },
        },
        required: ['file_path'],
    },
    handler: async (args, _context) => {
        const rawPath = String(args.file_path);
        const filePath = resolveFilePath(rawPath);
        try {
            if (!fs.existsSync(filePath)) {
                return `Error: File not found: ${args.file_path}`;
            }
            // Directory → list its contents so the agent can "look at a dir".
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                try {
                    const entries = fs.readdirSync(filePath, { withFileTypes: true })
                        .map((e) => `${e.isDirectory() ? 'd' : e.isSymbolicLink() ? 'l' : '-'} ${e.name}`)
                        .sort()
                        .slice(0, 500);
                    return `Directory listing for ${args.file_path} (${entries.length} entries):\n${entries.join('\n')}`;
                } catch (err: any) {
                    return `Error listing directory ${args.file_path}: ${err.message}`;
                }
            }
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
