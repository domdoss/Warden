export interface ChatRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
        tool_calls?: any[];
        tool_call_id?: string;
        name?: string;
        images?: string[];
    }>;
    tools?: any[];
    stream?: boolean;
    options?: Record<string, any>;
    keep_alive?: number;
    think?: boolean;
    /** Ollama structured-outputs JSON schema (passed as the `format` field).
     *  When set, the model's output is grammar-constrained to this schema. */
    format?: Record<string, any>;
    /** Optional caller-supplied abort signal (e.g. a silence watchdog for a
     *  streaming request). Passed through to the underlying fetch. */
    signal?: AbortSignal;
}

export interface ChatResult {
    message: {
        role: string;
        content: string | null;
        /** Thinking/chain-of-thought text (thinking-capable models). Surfaced
         *  live in Oversight and used by sub-agents that plan before acting. */
        thinking?: string;
        tool_calls?: Array<{
            id?: string;
            type?: string;
            function: {
                name: string;
                arguments: Record<string, any>;
            };
        }>;
    };
    done: boolean;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}

export type StreamHandler = (chunk: ChatResult) => void;

export interface Model {
    name: string;
    size?: number;
    modified_at?: string;
}

export interface ProviderConfig {
    type: 'ollama' | 'openai';
    baseUrl?: string;
    apiKey?: string;
}

export interface ChatProvider {
    chat(request: ChatRequest): Promise<ChatResult>;
    chatStream(request: ChatRequest, onChunk: StreamHandler): Promise<ChatResult>;
    listModels(): Promise<Model[]>;
    isAvailable(): Promise<boolean>;
}
