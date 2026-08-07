import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

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
        // Tell the HOST to record the clear boundary (sets orchestrator:context_clear_at,
        // which gates <chat_history> on the next turn). Without this the host re-injects
        // pre-clear turns every turn — the in-container reset alone isn't enough.
        try {
            await writeCallbackAsync('clear_context', { reason: args?.reason, chatJid: context?.chatJid }, 10000);
        } catch (err: any) {
            // Non-fatal: the in-container clear (flag above) still happens. The host
            // boundary just won't move this turn, so old history may resurface until
            // the next New Thought / idle clear.
            globalThis._clearContextRequested = true;
        }
        return `Context cleared${args.reason ? ': ' + args.reason : ''}. Continuing with fresh conversation.`;
    },
    toolset: 'context',
    tier: 'public',
});
