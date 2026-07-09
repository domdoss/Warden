import fs from 'fs';
import path from 'path';
import { registry } from '../tool-registry.js';
import { writeIpcFile, waitForResult, TASKS_DIR, IPC_DIR, cleanFilePath } from '../ipc-helpers.js';

// --- Chat tools ---
registry.register({
    name: 'get_chat_history',
    description: 'Get recent chat history.',
    schema: {
        type: 'object',
        properties: { limit: { type: 'number' } },
    },
    handler: async (args, context) => {
        try {
            const dbPath = process.env.MESSAGES_DB_PATH || path.join(process.env.PROMETHEUS_ROOT || path.join(process.env.HOME || '~', 'dockbox'), 'store', 'messages.db');
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(dbPath, { readonly: true });
            const limit = Math.min(args.limit || 50, 200);
            const jid = context.chatJid || 'owner@local';
            const rows = db.prepare(
                `SELECT sender_name, content, timestamp, is_bot_message FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?`
            ).all(jid, limit).reverse();
            db.close();
            if (!rows.length) return 'No chat history found.';
            return 'Chat history:\n' + rows.map((r: any) =>
                `[${r.timestamp}] ${r.sender_name || (r.is_bot_message ? 'Prometheus' : 'User')}: ${r.content}`
            ).join('\n');
        } catch (err: any) {
            return `Error reading chat history: ${err?.message ?? err}`;
        }
    },
    toolset: 'chat',
    tier: 'both',
});

registry.register({
    name: 'ping_user',
    description: 'Send a notification ping to a user.',
    schema: {
        type: 'object',
        properties: {
            user_id: { type: 'string' },
            message: { type: 'string' },
        },
        required: ['user_id', 'message'],
    },
    handler: async (args, _context) => {
        writeIpcFile(TASKS_DIR, { type: 'ping_user', userId: args.user_id, message: args.message, timestamp: new Date().toISOString() });
        return `Ping sent to ${args.user_id}.`;
    },
    toolset: 'chat',
    tier: 'both',
});

registry.register({
    name: 'attach_file',
    description: 'Send a file to the chat as a downloadable attachment.',
    schema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Relative path to file' },
            type: { type: 'string', enum: ['file', 'image'], description: 'file for download, image for inline' },
            message: { type: 'string', description: 'Optional message with file' },
        },
        required: ['path'],
    },
    handler: async (args, context) => {
        let filePath = args.path;
        if (filePath.startsWith('/tmp/')) {
            const basename = path.basename(filePath);
            try {
                fs.copyFileSync(filePath, path.join(process.cwd(), basename));
                filePath = basename;
            } catch {
                return `Error: could not copy file from ${filePath}`;
            }
        }
        const full = path.resolve(process.cwd(), cleanFilePath(filePath));
        if (!full.startsWith(process.cwd())) return 'Error: path must be relative to workspace';
        if (!fs.existsSync(full)) return `Error: file not found at ${filePath}`;
        const relPath = path.relative(process.cwd(), full);
        const tag = args.type === 'image' ? `[Image: ${relPath}]` : `[File: ${relPath}]`;
        const text = args.message ? `${args.message}\n\n${tag}` : tag;
        writeIpcFile(path.join(IPC_DIR, 'messages'), {
            type: 'message', chatJid: context.chatJid, text, groupFolder: context.groupFolder, timestamp: new Date().toISOString(),
        });
        return `File attached: ${filePath}`;
    },
    toolset: 'chat',
    tier: 'both',
});

registry.register({
    name: 'set_user_email',
    description: "Set the user's email address for password resets and notifications.",
    schema: {
        type: 'object',
        properties: { email: { type: 'string', description: 'Email address to set' } },
        required: ['email'],
    },
    handler: async (args, _context) => {
        const email = args.email?.trim();
        if (!email) return 'Error: email is required';
        writeIpcFile(TASKS_DIR, { type: 'set_user_email', email, timestamp: new Date().toISOString() });
        const data = await waitForResult('set-email-');
        if (data) {
            if (data.error) return `Error: ${data.error}`;
            return 'Email updated to ' + email;
        }
        return 'Email update timed out.';
    },
    toolset: 'chat',
    tier: 'public',
});
