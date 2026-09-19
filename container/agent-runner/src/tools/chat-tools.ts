import fs from 'fs';
import path from 'path';
import { registry } from '../tool-registry.js';
import { writeCallback } from '../index.js';
import { resolveUserPath } from '../ipc-helpers.js';

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
            // The host sets MESSAGES_DB_PATH in its process.env at startup
            // (src/config.ts → STORE_DIR), and spawns this child with
            // `...process.env`, so the canonical DB path is inherited. WARDEN_ROOT
            // is a legacy fallback. Never fall back to a hard-coded ~/dockbox path
            // — that directory doesn't exist on this host and the silent failure
            // starves the orchestrator of history across turns.
            const dbPath = process.env.MESSAGES_DB_PATH
                || (process.env.WARDEN_ROOT ? path.join(process.env.WARDEN_ROOT, 'store', 'messages.db') : '');
            if (!dbPath) {
                return 'Error reading chat history: MESSAGES_DB_PATH is not set (the host did not propagate the DB path to this child).';
            }
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
                `[${r.timestamp}] ${r.sender_name || (r.is_bot_message ? 'Warden' : 'User')}: ${r.content}`
            ).join('\n');
        } catch (err: any) {
            return `Error reading chat history: ${err?.message ?? err}`;
        }
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
        // Resolve like a shell would: ~ → home, absolutes stay absolute (the
        // agent can already Read/Edit files outside the workspace, so the old
        // "path must be relative to workspace" refusal just rejected the very
        // files users ask to attach, e.g. ~/Projects/site/index.html).
        const filePath = resolveUserPath(args.path);
        if (!fs.existsSync(filePath)) return `Error: file not found at ${args.path}`;
        const tag = args.type === 'image' ? `[Image: ${filePath}]` : `[File: ${filePath}]`;
        const text = args.message ? `${args.message}\n\n${tag}` : tag;
        // Deliver through the live stdio callback channel — the old
        // writeIpcFile(IPC_DIR/messages) path was dead (the host no longer
        // polls the IPC dir), so attachments silently vanished there.
        writeCallback('send_message', {
            type: 'message', chatJid: context.chatJid, text, groupFolder: context.groupFolder, timestamp: new Date().toISOString(),
        });
        return `File attached: ${args.path}`;
    },
    toolset: 'chat',
    tier: 'both',
});
