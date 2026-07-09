/**
 * Unified LLM Client - Routes between Ollama (native) and Anthropic (reverse translation)
 *
 * Primary: Ollama native (direct API)
 * Fallback: Anthropic API (when user provides their own key)
 */

import {
  ollamaChat,
  ollamaChatStream,
  ollamaIsAvailable,
  OllamaMessage,
  OllamaTool,
  OllamaStreamHandler,
} from './ollama-native.js';
import {
  anthropicChat,
  anthropicChatStream,
} from './anthropic-translate.js';
import { logger } from './logger.js';
import { getUserApiKeys } from './db.js';
import { DEFAULT_CLOUD_MODEL } from './config.js';

export type LLMProvider = 'ollama' | 'anthropic' | 'openai';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ChatRequest {
  messages: OllamaMessage[];
  model?: string;
  stream?: boolean;
  tools?: OllamaTool[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, any>;
    };
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  model: string;
}

export type StreamHandler = (chunk: { content?: string; tool_calls?: any[]; done: boolean }) => void;

/**
 * Get LLM configuration for a user.
 * Priority:
 * 1. User's explicit provider choice (stored in DB)
 * 2. User has Anthropic API key configured
 * 3. Ollama available locally
 * 4. Error (no provider configured)
 */
export async function getLLMConfig(userId?: string): Promise<LLMConfig> {
  // Check if user has API keys configured (TODO: decrypt and use keys)
  // For now, Ollama is the primary provider
  // Anthropic/OpenAI keys can be added via settings and will be stored
  // in router_state or a separate table with proper encryption

  // Default to Ollama if available
  const ollamaAvailable = await ollamaIsAvailable();
  if (ollamaAvailable) {
    return {
      provider: 'ollama',
      model: DEFAULT_CLOUD_MODEL,
    };
  }

  // No provider available
  throw new Error(
    'No LLM provider configured. Please either:\n' +
    '1. Start Ollama locally (port 11434)\n' +
    '2. Add your Anthropic API key in Settings > API Keys'
  );
}

/**
 * Non-streaming chat with automatic provider selection.
 */
export async function llmChat(
  request: ChatRequest,
  config?: LLMConfig,
): Promise<ChatResult> {
  const provider = config || await getLLMConfig();

  logger.info(
    { provider: provider.provider, model: provider.model || request.model },
    'LLM chat request'
  );

  if (provider.provider === 'ollama') {
    return ollamaChat(
      {
        model: request.model || provider.model || DEFAULT_CLOUD_MODEL,
        messages: request.messages,
        tools: request.tools,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
      },
      provider.baseUrl,
    );
  }

  if (provider.provider === 'anthropic') {
    if (!provider.apiKey) {
      throw new Error('Anthropic API key not configured');
    }
    const result = await anthropicChat(
      {
        model: request.model || provider.model || 'claude-sonnet-4-6',
        messages: request.messages,
        tools: request.tools,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
      },
      provider.apiKey,
    );
    return result;
  }

  throw new Error(`Unknown provider: ${provider.provider}`);
}

/**
 * Streaming chat with automatic provider selection.
 */
export async function llmChatStream(
  request: ChatRequest,
  onChunk: StreamHandler,
  config?: LLMConfig,
): Promise<ChatResult> {
  const provider = config || await getLLMConfig();

  logger.info(
    { provider: provider.provider, model: provider.model || request.model, streaming: true },
    'LLM streaming chat request'
  );

  if (provider.provider === 'ollama') {
    return ollamaChatStream(
      {
        model: request.model || provider.model || DEFAULT_CLOUD_MODEL,
        messages: request.messages,
        tools: request.tools,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
      },
      onChunk as OllamaStreamHandler,
      provider.baseUrl,
    );
  }

  if (provider.provider === 'anthropic') {
    if (!provider.apiKey) {
      throw new Error('Anthropic API key not configured');
    }
    return anthropicChatStream(
      {
        model: request.model || provider.model || 'claude-sonnet-4-6',
        messages: request.messages,
        tools: request.tools,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
      },
      provider.apiKey,
      onChunk,
    );
  }

  throw new Error(`Unknown provider: ${provider.provider}`);
}

/**
 * Check which providers are available.
 */
export async function getAvailableProviders(): Promise<LLMProvider[]> {
  const providers: LLMProvider[] = [];

  const ollamaOk = await ollamaIsAvailable();
  if (ollamaOk) providers.push('ollama');

  // Anthropic is always "available" if user has key, but we check at request time
  providers.push('anthropic');

  return providers;
}

/**
 * Format messages for tool results (common pattern).
 */
export function createToolResultMessage(
  toolUseId: string,
  result: string,
): OllamaMessage {
  return {
    role: 'tool',
    content: result,
  };
}

/**
 * Create a tool call message.
 */
export function createToolCallMessage(
  toolCalls: Array<{ name: string; arguments: Record<string, any> }>,
): OllamaMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: toolCalls.map((tc) => ({
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    })),
  };
}
