/**
 * Reverse translation: Ollama format -> Anthropic API
 *
 * Used when user provides their own Anthropic API key.
 * This is the inverse of the old ollama-translate.ts.
 */

import { request as httpsRequest } from 'https';
import { logger } from './logger.js';

const ANTHROPIC_API_HOST = 'api.anthropic.com';
const ANTHROPIC_API_VERSION = '2023-06-01';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
    | { type: 'tool_result'; tool_use_id: string; content: string }
  >;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  >;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type AnthropicStreamEvent =
  | { type: 'message_start'; message: { id: string; role: 'assistant'; content: []; model: string } }
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: {} } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: string; stop_sequence?: string | null }; usage?: { output_tokens: number } }
  | { type: 'message_stop' };

// Ollama format (input)
interface OllamaInput {
  model: string;
  messages: Array<{ role: string; content: string; images?: string[] }>;
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: any };
  }>;
  options?: { temperature?: number; num_predict?: number };
}

/**
 * Translate Ollama format to Anthropic format.
 */
function translateToAnthropic(input: OllamaInput): AnthropicRequest {
  // Extract system message
  let system: string | undefined;
  const messages: AnthropicMessage[] = [];

  for (const msg of input.messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else if (msg.role === 'user') {
      // Handle images if present
      if (msg.images && msg.images.length > 0) {
        const content: AnthropicMessage['content'] = [
          { type: 'text', text: msg.content },
        ];
        for (const img of msg.images) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg', // or detect from data
              data: img,
            },
          });
        }
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: msg.content });
      }
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  // Translate tools
  let tools: AnthropicTool[] | undefined;
  if (input.tools && input.tools.length > 0) {
    tools = input.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
  }

  // Map model name (ollama -> anthropic)
  const modelMap: Record<string, string> = {
    'claude': 'claude-sonnet-4-6',
    'claude-opus': 'claude-opus-4-6',
    'claude-haiku': 'claude-haiku-4-5',
  };
  const model = modelMap[input.model] || input.model;

  return {
    model,
    messages,
    system,
    max_tokens: input.options?.num_predict || 4096,
    temperature: input.options?.temperature,
    stream: input.stream,
    tools,
  };
}

/**
 * Translate Anthropic response back to Ollama-like format.
 */
function translateFromAnthropic(response: AnthropicResponse): {
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, any> } }>;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
} {
  let content = '';
  const toolCalls: Array<{ function: { name: string; arguments: Record<string, any> } }> = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      content += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        function: {
          name: block.name,
          arguments: block.input,
        },
      });
    }
  }

  return {
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    },
    model: response.model,
  };
}

/**
 * Non-streaming chat with Anthropic API.
 * Input: Ollama format, Output: Ollama-like format
 */
export async function anthropicChat(
  ollamaInput: OllamaInput,
  apiKey: string,
): Promise<{
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, any> } }>;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}> {
  const anthropicRequest = translateToAnthropic(ollamaInput);
  const bodyStr = JSON.stringify(anthropicRequest);

  logger.debug(
    { model: anthropicRequest.model, messageCount: anthropicRequest.messages.length },
    'Sending to Anthropic API'
  );

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: ANTHROPIC_API_HOST,
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString();
            const response: AnthropicResponse | { error: { message: string } } = JSON.parse(raw);

            if (res.statusCode && res.statusCode >= 400) {
              const errMsg = (response as any).error?.message || raw;
              logger.error({ status: res.statusCode, error: errMsg }, 'Anthropic API error');
              reject(new Error(`Anthropic error: ${errMsg}`));
              return;
            }

            const result = translateFromAnthropic(response as AnthropicResponse);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Streaming chat with Anthropic API.
 */
export async function anthropicChatStream(
  ollamaInput: OllamaInput,
  apiKey: string,
  onChunk: (chunk: { content?: string; tool_calls?: any[]; done: boolean }) => void,
): Promise<{
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, any> } }>;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}> {
  const anthropicRequest = translateToAnthropic(ollamaInput);
  const bodyStr = JSON.stringify({ ...anthropicRequest, stream: true });

  return new Promise((resolve, reject) => {
    let fullContent = '';
    const toolCalls: Array<{ id: string; name: string; args: string }> = [];
    let currentToolIndex = -1;
    let finalUsage = { input_tokens: 0, output_tokens: 0 };

    const req = httpsRequest(
      {
        hostname: ANTHROPIC_API_HOST,
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            logger.error({ status: res.statusCode, raw }, 'Anthropic streaming error');
            reject(new Error(`Anthropic error: ${raw}`));
          });
          return;
        }

        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event: AnthropicStreamEvent = JSON.parse(data);

              if (event.type === 'content_block_delta') {
                const delta = event.delta;
                if (delta.type === 'text_delta') {
                  fullContent += delta.text;
                  onChunk({ content: delta.text, done: false });
                } else if (delta.type === 'input_json_delta') {
                  // Tool call partial JSON
                  if (currentToolIndex >= 0 && toolCalls[currentToolIndex]) {
                    toolCalls[currentToolIndex].args += delta.partial_json;
                  }
                }
              } else if (event.type === 'content_block_start') {
                const block = event.content_block;
                if (block.type === 'tool_use') {
                  currentToolIndex++;
                  toolCalls.push({ id: block.id, name: block.name, args: '' });
                }
              } else if (event.type === 'message_delta') {
                if (event.usage) {
                  finalUsage.output_tokens = event.usage.output_tokens;
                }
              }
            } catch (err) {
              logger.warn({ line, err }, 'Failed to parse Anthropic stream event');
            }
          }
        });

        res.on('end', () => {
          // Parse accumulated tool calls
          const parsedToolCalls = toolCalls
            .filter((t) => t.name)
            .map((t) => {
              try {
                return {
                  function: {
                    name: t.name,
                    arguments: JSON.parse(t.args || '{}'),
                  },
                };
              } catch {
                return {
                  function: {
                    name: t.name,
                    arguments: {},
                  },
                };
              }
            });

          onChunk({ done: true });
          resolve({
            content: fullContent,
            tool_calls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
            usage: finalUsage,
            model: anthropicRequest.model,
          });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}
