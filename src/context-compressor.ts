import { AgentSessionStore } from './agent-session-store.js';

interface CompressedResult {
    messages: any[];
    newSystemPrompt: string;
    newSessionId: string;
}

export class ContextCompressor {
    protectFirstN = 3;
    protectLastN = 5;
    thresholdTokens = 8000;

    constructor(
        private sessionStore: AgentSessionStore,
        private compressionModel: string
    ) {}

    /**
     * Estimate token count from message list. Rough heuristic: ~4 chars per token.
     */
    private estimateTokens(messages: any[]): number {
        let chars = 0;
        for (const msg of messages) {
            if (msg.content) chars += String(msg.content).length;
            if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length;
            if (msg.tool_result) chars += String(msg.tool_result).length;
        }
        return Math.ceil(chars / 4);
    }

    /**
     * Build a summarization prompt for the middle portion of the conversation.
     */
    private buildSummaryPrompt(head: any[], middle: any[], tail: any[]): string {
        const middleText = middle.map((m) => {
            if (m.role === 'tool') {
                return `[Tool result for ${m.tool_name || 'unknown'}]: ${String(m.content || '').slice(0, 500)}`;
            }
            if (m.tool_calls) {
                const calls = (typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls) : m.tool_calls);
                const names = calls.map((tc: any) => tc.function?.name || 'unknown').join(', ');
                return `[Assistant called tools: ${names}]${m.content ? ' ' + String(m.content).slice(0, 300) : ''}`;
            }
            return `[${m.role}]: ${String(m.content || '').slice(0, 800)}`;
        }).join('\n\n');

        return `Summarize the middle section of this conversation. Keep key facts, decisions, and actions. Be concise.

BEGINNING (kept verbatim, for context only):
${head.map((m: any) => `[${m.role}]: ${String(m.content || '').slice(0, 200)}`).join('\n')}

MIDDLE (to summarize):
${middleText}

END (kept verbatim, for context only):
${tail.map((m: any) => `[${m.role}]: ${String(m.content || '').slice(0, 200)}`).join('\n')}

Produce a concise summary of the middle section only. Include: key user requests, decisions made, files created/modified, and important findings.`;
    }

    /**
     * Compress a conversation by summarizing the middle portion.
     * Returns compressed message list, updated system prompt, and new session ID.
     */
    async compress(
        sessionId: string,
        systemPrompt: string
    ): Promise<CompressedResult> {
        const allMessages = this.sessionStore.getMessages(sessionId, 10000);
        if (allMessages.length <= this.protectFirstN + this.protectLastN) {
            // Not enough messages to compress
            return { messages: allMessages, newSystemPrompt: systemPrompt, newSessionId: sessionId };
        }

        const estimatedTokens = this.estimateTokens(allMessages);
        if (estimatedTokens < this.thresholdTokens) {
            return { messages: allMessages, newSystemPrompt: systemPrompt, newSessionId: sessionId };
        }

        // Split: head (N) + middle + tail (N)
        const head = allMessages.slice(0, this.protectFirstN);
        const tail = allMessages.slice(-this.protectLastN);
        const middle = allMessages.slice(this.protectFirstN, -this.protectLastN);

        const summaryPrompt = this.buildSummaryPrompt(head, middle, tail);

        // Call the compression model via Ollama
        let summary = '';
        try {
            const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
            const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.compressionModel,
                    prompt: summaryPrompt,
                    stream: false,
                    options: { num_predict: 500, temperature: 0.3 },
                }),
            });
            if (resp.ok) {
                const data = await resp.json() as any;
                summary = data.response || '';
            }
        } catch {
            // If compression model is unavailable, use a simple truncation summary
            const toolCount = middle.filter((m: any) => m.role === 'tool').length;
            const assistantCount = middle.filter((m: any) => m.role === 'assistant').length;
            summary = `[Compressed ${middle.length} messages: ${assistantCount} assistant responses, ${toolCount} tool results.]`;
        }

        // Build compressed message list: head + summary as user msg + tail
        const summaryMsg = {
            role: 'user',
            content: `[CONVERSATION SUMMARY]\n${summary || 'Prior conversation context compressed.'}`,
        };

        // Split the session: end old, create child
        const newSessionId = this.sessionStore.splitSession(sessionId, 'compression');

        // Write the compressed messages to the new session
        for (const msg of head) {
            this.sessionStore.addMessage(newSessionId, {
                session_id: newSessionId,
                role: msg.role,
                content: msg.content || null,
                tool_calls: msg.tool_calls || null,
                tool_call_id: null,
                tool_name: msg.tool_name || null,
                tool_result: msg.tool_result || null,
                timestamp: msg.timestamp || new Date().toISOString(),
                token_count: 0,
            });
        }
        this.sessionStore.addMessage(newSessionId, {
            session_id: newSessionId,
            role: summaryMsg.role,
            content: summaryMsg.content,
            tool_calls: null,
            tool_call_id: null,
            tool_name: null,
            tool_result: null,
            timestamp: new Date().toISOString(),
            token_count: 0,
        });
        for (const msg of tail) {
            this.sessionStore.addMessage(newSessionId, {
                session_id: newSessionId,
                role: msg.role,
                content: msg.content || null,
                tool_calls: msg.tool_calls || null,
                tool_call_id: null,
                tool_name: msg.tool_name || null,
                tool_result: msg.tool_result || null,
                timestamp: msg.timestamp || new Date().toISOString(),
                token_count: 0,
            });
        }

        const compressedMessages = this.sessionStore.getMessages(newSessionId, 10000);
        const compressedSystemPrompt = systemPrompt + '\n\n[Prior conversation was compressed. Key context is summarized above.]';

        return {
            messages: compressedMessages,
            newSystemPrompt: compressedSystemPrompt,
            newSessionId,
        };
    }
}
