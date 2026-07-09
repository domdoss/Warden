import { ChatProvider, ProviderConfig } from './types.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';

export function createProvider(config: ProviderConfig): ChatProvider {
    switch (config.type) {
        case 'ollama':
            return new OllamaProvider(config);
        case 'openai':
            return new OpenAIProvider(config);
        default:
            throw new Error(`Unknown provider type: ${(config as any).type}`);
    }
}

export type { ChatProvider, ChatRequest, ChatResult, StreamHandler, Model, ProviderConfig } from './types.js';
