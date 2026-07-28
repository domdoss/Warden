import { ChatProvider, ChatRequest, ChatResult, StreamHandler, Model, ProviderConfig } from './types.js';

export class OllamaProvider implements ChatProvider {
    private baseUrl: string;

    constructor(config: ProviderConfig) {
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
    }

    async chat(request: ChatRequest): Promise<ChatResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min hard timeout
        try {
            const resp = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: request.model,
                    messages: request.messages,
                    tools: request.tools,
                    stream: false,
                    options: request.options || {},
                    ...(request.keep_alive !== undefined ? { keep_alive: request.keep_alive } : {}),
                    ...(request.think !== undefined ? { think: request.think } : {}),
                }),
                signal: controller.signal,
            });
            if (!resp.ok) {
                // Include the model and Ollama's error body — a bare "404 Not Found"
                // hides the actual cause (almost always: the model isn't installed).
                const body = await resp.text().catch(() => '');
                const hint = resp.status === 404 ? ` — model "${request.model}" not found` : '';
                throw new Error(`Ollama chat error: ${resp.status} ${resp.statusText}${hint}${body ? ` (${body.slice(0, 200)})` : ''}`);
            }
            const data = await resp.json() as any;
            return {
                message: data.message || { role: 'assistant', content: null },
                done: data.done !== false,
                usage: data.usage || undefined,
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    async chatStream(request: ChatRequest, onChunk: StreamHandler): Promise<ChatResult> {
        const resp = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                tools: request.tools,
                stream: true,
                options: request.options || {},
                ...(request.keep_alive !== undefined ? { keep_alive: request.keep_alive } : {}),
                ...(request.think !== undefined ? { think: request.think } : {}),
            }),
        });
        if (!resp.ok) {
            throw new Error(`Ollama stream error: ${resp.status} ${resp.statusText}`);
        }
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let finalMessage: any = { role: 'assistant', content: '' };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line);
                    if (chunk.message) {
                        if (chunk.message.content) {
                            finalMessage.content = (finalMessage.content || '') + chunk.message.content;
                        }
                        if (chunk.message.tool_calls) {
                            finalMessage.tool_calls = chunk.message.tool_calls;
                        }
                        onChunk({
                            message: chunk.message,
                            done: chunk.done || false,
                        });
                    }
                } catch {}
            }
        }

        return {
            message: finalMessage,
            done: true,
        };
    }

    async listModels(): Promise<Model[]> {
        const resp = await fetch(`${this.baseUrl}/api/tags`);
        if (!resp.ok) return [];
        const data = await resp.json() as any;
        return (data.models || []).map((m: any) => ({
            name: m.name,
            size: m.size,
            modified_at: m.modified_at,
        }));
    }

    async isAvailable(): Promise<boolean> {
        try {
            const resp = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            return resp.ok;
        } catch {
            return false;
        }
    }
}
