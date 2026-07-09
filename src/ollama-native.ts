/**
 * Native Ollama client - Direct API communication without translation layers.
 * Replaces the current ollama-translate.ts approach.
 */

import { request as httpRequest } from 'http';
import { logger } from './logger.js';
import { OLLAMA_URL } from './config.js';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  images?: string[]; // base64 encoded images
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  tools?: OllamaTool[];
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    top_k?: number;
    seed?: number;
  };
  keep_alive?: number | string;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

export interface OllamaChatResult {
  content: string;
  tool_calls?: OllamaToolCall[];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  model: string;
}

export type OllamaStreamHandler = (
  chunk: { content?: string; tool_calls?: OllamaToolCall[]; done: boolean }
) => void;

/**
 * Non-streaming chat with Ollama.
 */
export async function ollamaChat(
  request: OllamaChatRequest,
  baseUrl: string = OLLAMA_URL,
): Promise<OllamaChatResult> {
  const url = new URL(baseUrl);
  const bodyStr = JSON.stringify({ ...request, stream: false });

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString();
            const response: OllamaChatResponse = JSON.parse(raw);

            if (res.statusCode && res.statusCode >= 400) {
              logger.error({ status: res.statusCode, response }, 'Ollama API error');
              reject(new Error(`Ollama error: ${response.message || raw}`));
              return;
            }

            resolve({
              content: response.message?.content || '',
              tool_calls: response.message?.tool_calls,
              usage: {
                input_tokens: response.prompt_eval_count || 0,
                output_tokens: response.eval_count || 0,
              },
              model: response.model,
            });
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Streaming chat with Ollama.
 */
export async function ollamaChatStream(
  request: OllamaChatRequest,
  onChunk: OllamaStreamHandler,
  baseUrl: string = OLLAMA_URL,
): Promise<OllamaChatResult> {
  const url = new URL(baseUrl);
  const bodyStr = JSON.stringify({ ...request, stream: true });

  return new Promise((resolve, reject) => {
    let fullContent = '';
    let toolCalls: OllamaToolCall[] | undefined;
    let finalModel = request.model;
    let inputTokens = 0;
    let outputTokens = 0;

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            logger.error({ status: res.statusCode, raw }, 'Ollama streaming error');
            reject(new Error(`Ollama error: ${raw}`));
          });
          return;
        }

        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data: OllamaStreamChunk = JSON.parse(line);

              if (data.done) {
                // Final stats in last chunk
                inputTokens = (data as any).prompt_eval_count || inputTokens;
                outputTokens = (data as any).eval_count || outputTokens;
              }

              const content = data.message?.content || '';
              const calls = data.message?.tool_calls;

              if (content) {
                fullContent += content;
              }

              if (calls && calls.length > 0) {
                toolCalls = calls;
              }

              if (data.model) {
                finalModel = data.model;
              }

              onChunk({
                content: data.message?.content,
                tool_calls: data.message?.tool_calls,
                done: data.done,
              });
            } catch (err) {
              logger.warn({ line, err }, 'Failed to parse Ollama stream chunk');
            }
          }
        });

        res.on('end', () => {
          resolve({
            content: fullContent,
            tool_calls: toolCalls,
            usage: {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            },
            model: finalModel,
          });
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Check if Ollama is available.
 */
export async function ollamaIsAvailable(baseUrl: string = OLLAMA_URL): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(baseUrl);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/tags',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        resolve(res.statusCode === 200);
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * List available models from Ollama.
 */
export async function ollamaListModels(
  baseUrl: string = OLLAMA_URL,
): Promise<Array<{ name: string; size: number; modified_at: string }>> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/tags',
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve(data.models || []);
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

/**
 * Check if an Ollama model supports thinking (extended reasoning).
 * Calls /api/show and looks for thinking capability in the model details.
 */
export async function ollamaModelSupportsThinking(
  model: string,
  baseUrl: string = OLLAMA_URL,
): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(baseUrl);
    const bodyStr = JSON.stringify({ model });
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/show',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            // Ollama returns capabilities in model_info or a top-level capabilities field
            const caps = data.capabilities || data.model_info?.capabilities || [];
            if (Array.isArray(caps) && caps.includes('thinking')) {
              resolve(true);
            } else if (data.parameters && typeof data.parameters === 'string' && data.parameters.includes('think')) {
              resolve(true);
            } else {
              resolve(false);
            }
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Pull a model from Ollama (download).
 */
export async function ollamaPullModel(
  model: string,
  baseUrl: string = OLLAMA_URL,
): Promise<void> {
  const url = new URL(baseUrl);
  const bodyStr = JSON.stringify({ name: model, stream: false });

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/pull',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Failed to pull model: ${model}`));
          } else {
            resolve();
          }
        });
      },
    );

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}
