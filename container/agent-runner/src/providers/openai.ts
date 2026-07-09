import { ChatProvider, ChatRequest, ChatResult, StreamHandler, Model, ProviderConfig } from './types.js';

export class OpenAIProvider implements ChatProvider {
    private baseUrl: string;
    private apiKey: string;

    constructor(config: ProviderConfig) {
        this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
        this.apiKey = config.apiKey || '';
    }

    async chat(request: ChatRequest): Promise<ChatResult> {
        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                tools: request.tools?.map((t: any) => ({
                    type: 'function',
                    function: t.function,
                })),
                stream: false,
                ...(request.options || {}),
            }),
        });
        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`OpenAI chat error: ${resp.status} ${resp.statusText}${errText ? ' - ' + errText : ''}`);
        }
        const data = await resp.json() as any;
        const choice = data.choices?.[0] || {};
        return {
            message: {
                role: choice.message?.role || 'assistant',
                content: choice.message?.content || null,
                tool_calls: choice.message?.tool_calls?.map((tc: any) => ({
                    id: tc.id,
                    type: tc.type,
                    function: {
                        name: tc.function?.name,
                        arguments: typeof tc.function?.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function?.arguments || {},
                    },
                })),
            },
            done: choice.finish_reason !== null,
            usage: data.usage,
        };
    }

    async chatStream(request: ChatRequest, onChunk: StreamHandler): Promise<ChatResult> {
        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                tools: request.tools?.map((t: any) => ({
                    type: 'function',
                    function: t.function,
                })),
                stream: true,
                ...(request.options || {}),
            }),
        });
        if (!resp.ok) {
            throw new Error(`OpenAI stream error: ${resp.status} ${resp.statusText}`);
        }
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let finalContent = '';
        const toolCalls: Map<number, any> = new Map();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]') continue;
                try {
                    const chunk = JSON.parse(dataStr);
                    const delta = chunk.choices?.[0]?.delta;
                    if (!delta) continue;
                    if (delta.content) {
                        finalContent += delta.content;
                    }
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!toolCalls.has(idx)) {
                                toolCalls.set(idx, { id: tc.id, type: tc.type || 'function', function: { name: '', arguments: '' } });
                            }
                            const existing = toolCalls.get(idx)!;
                            if (tc.id) existing.id = tc.id;
                            if (tc.function?.name) existing.function.name += tc.function.name;
                            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                        }
                    }
                    onChunk({
                        message: { role: 'assistant', content: delta.content || null },
                        done: chunk.choices?.[0]?.finish_reason === 'stop',
                    });
                } catch {}
            }
        }

        const parsedToolCalls = [...toolCalls.values()].map(tc => ({
            ...tc,
            function: {
                name: tc.function.name,
                arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
            },
        }));

        return {
            message: {
                role: 'assistant',
                content: finalContent || null,
                tool_calls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
            },
            done: true,
        };
    }

    async listModels(): Promise<Model[]> {
        try {
            const resp = await fetch(`${this.baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
            });
            if (!resp.ok) return [];
            const data = await resp.json() as any;
            return (data.data || []).map((m: any) => ({ name: m.id }));
        } catch {
            return [];
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const resp = await fetch(`${this.baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(3000),
            });
            return resp.ok;
        } catch {
            return false;
        }
    }
}
