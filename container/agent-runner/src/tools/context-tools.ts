import { registry } from '../tool-registry.js';
import { writeIpcFile, TASKS_DIR } from '../ipc-helpers.js';

// clear_context is a special tool — it sets a flag on the module-level variable in index.ts
// We import and use the flag setter from the registry pattern.

// Declare global for clear_context flag
declare global {
    var _clearContextRequested: boolean;
}

registry.register({
    name: 'clear_context',
    description: 'Clear conversation history and start fresh. Keeps the system prompt. Use when context is confused, polluted, or you need a clean slate.',
    schema: {
        type: 'object',
        properties: { reason: { type: 'string', description: 'Why context is being cleared' } },
    },
    handler: async (args, context) => {
        globalThis._clearContextRequested = true;
        // Tell the server to record the clear boundary, otherwise pre-clear chat
        // history gets re-injected into the next container's prompt.
        try {
            writeIpcFile(TASKS_DIR, { type: 'context_cleared', chatJid: context?.chatJid, timestamp: new Date().toISOString() });
        } catch { /* non-fatal — in-container clear still happens */ }
        return `Context cleared${args.reason ? ': ' + args.reason : ''}. Continuing with fresh conversation.`;
    },
    toolset: 'context',
    tier: 'public',
});
