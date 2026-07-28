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
}

export interface ChatResult {
    message: {
        role: string;
        content: string | null;
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
