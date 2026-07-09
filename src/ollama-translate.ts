/**
 * Anthropic API ↔ OpenAI API translation layer for Ollama.
 * Allows the Claude SDK to talk to Ollama models transparently.
 */

import { request as httpRequest, IncomingMessage, ServerResponse } from 'http';
import { request as httpsRequest } from 'https';
import { logger } from './logger.js';
import { OLLAMA_URL } from './config.js';

export interface TranslationTarget {
  url: string;
  authHeaders?: Record<string, string>;
  path?: string;
}

// Models that should go to Anthropic (everything else → Ollama)
const ANTHROPIC_MODEL_PREFIXES = ['claude-', 'claude_'];
const ANTHROPIC_ALIASES = new Set(['opus', 'sonnet', 'haiku']);

function isAnthropicModel(model: string): boolean {
  if (!model) return true;
  const lower = model.toLowerCase();
  if (ANTHROPIC_ALIASES.has(lower)) return true;
  return ANTHROPIC_MODEL_PREFIXES.some(p => lower.startsWith(p));
}

// ── Anthropic → OpenAI request translation ──

interface AnthropicMessage {
  role: string;
  content: string | Array<{ type: string; [key: string]: any }>;
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: object;
}

function translateMessages(
  messages: AnthropicMessage[],
  system?: string | Array<{ type: string; text: string }>,
): Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }> {
  const result: any[] = [];

  // System prompt
  if (system) {
    const sysText = typeof system === 'string'
      ? system
      : system.map(b => b.text).join('\n');
    if (sysText) result.push({ role: 'system', content: sysText });
  }

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // May contain text + tool_use blocks
        let text = '';
        const toolCalls: any[] = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            text += block.text || '';
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
              },
            });
          }
        }
        const entry: any = { role: 'assistant', content: text || null };
        if (toolCalls.length > 0) entry.tool_calls = toolCalls;
        result.push(entry);
      }
    } else if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // May contain text + image + tool_result blocks
        const contentParts: any[] = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            contentParts.push({ type: 'text', text: block.text || '' });
          } else if (block.type === 'image' && block.source?.type === 'base64') {
            // Translate Anthropic image blocks to OpenAI image_url format
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type || 'image/jpeg'};base64,${block.source.data}`,
              },
            });
          } else if (block.type === 'tool_result') {
            // Tool results become separate 'tool' messages in OpenAI format
            // Flush any pending content parts first
            if (contentParts.length > 0) {
              const hasImages = contentParts.some((p: any) => p.type === 'image_url');
              if (hasImages) {
                result.push({ role: 'user', content: contentParts.splice(0) });
              } else {
                const text = contentParts.splice(0).map((p: any) => p.text || '').join('\n');
                if (text.trim()) result.push({ role: 'user', content: text });
              }
            }
            const toolContent = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('\n')
                : JSON.stringify(block.content);
            result.push({
              role: 'tool',
              content: toolContent || '',
              tool_call_id: block.tool_use_id,
            });
          }
        }
        if (contentParts.length > 0) {
          const hasImages = contentParts.some((p: any) => p.type === 'image_url');
          if (hasImages) {
            // Send as multimodal content array (OpenAI vision format)
            result.push({ role: 'user', content: contentParts });
          } else {
            const text = contentParts.map((p: any) => p.text || '').join('\n');
            if (text.trim()) result.push({ role: 'user', content: text });
          }
        }
      }
    }
  }

  return result;
}

function translateTools(tools?: AnthropicTool[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

// ── OpenAI → Anthropic response translation ──

function translateResponse(openaiResp: any, requestModel: string): any {
  const choice = openaiResp.choices?.[0];
  if (!choice) {
    return {
      id: openaiResp.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      model: requestModel,
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const msg = choice.message;
  const content: any[] = [];

  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let input: any = {};
      try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
      content.push({
        type: 'tool_use',
        id: (tc.id && /^[a-zA-Z0-9_-]+$/.test(tc.id)) ? tc.id : `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: tc.function.name,
        input,
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  const stopReason = msg.tool_calls?.length ? 'tool_use' : 'end_turn';

  return {
    id: openaiResp.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: requestModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
    },
  };
}

// ── Streaming translation ──

function translateStreamChunk(line: string, requestModel: string, state: StreamState): string[] {
  if (!line.startsWith('data: ')) return [];
  const data = line.slice(6).trim();
  if (data === '[DONE]') {
    if (!state.started) return []; // No chunks received, nothing to close
    return [
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: state.hasToolCalls ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: state.outputTokens } })}\n\n`,
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
    ];
  }

  let chunk: any;
  try { chunk = JSON.parse(data); } catch { return []; }
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return [];

  const events: string[] = [];

  // First chunk — emit message_start
  if (!state.started) {
    state.started = true;
    events.push(`event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: chunk.id || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [],
        model: requestModel,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })}\n\n`);
  }

  // Text content
  if (delta.content) {
    if (!state.textBlockStarted) {
      state.textBlockStarted = true;
      state.blockIndex++;
      events.push(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: state.blockIndex,
        content_block: { type: 'text', text: '' },
      })}\n\n`);
    }
    events.push(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: state.blockIndex,
      delta: { type: 'text_delta', text: delta.content },
    })}\n\n`);
    state.outputTokens++;
  }

  // Tool calls
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      state.hasToolCalls = true;

      if (tc.function?.name) {
        // Close text block if open
        if (state.textBlockStarted) {
          events.push(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: state.blockIndex,
          })}\n\n`);
          state.textBlockStarted = false;
        }

        // Start new tool_use block
        state.blockIndex++;
        const toolId = (tc.id && /^[a-zA-Z0-9_-]+$/.test(tc.id)) ? tc.id : `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        state.currentToolId = toolId;
        state.currentToolArgs = '';
        events.push(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: state.blockIndex,
          content_block: { type: 'tool_use', id: toolId, name: tc.function.name, input: {} },
        })}\n\n`);
      }

      if (tc.function?.arguments) {
        state.currentToolArgs += tc.function.arguments;
        events.push(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: state.blockIndex,
          delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
        })}\n\n`);
      }
    }
  }

  // Finish reason
  if (chunk.choices?.[0]?.finish_reason) {
    // Close any open block
    if (state.textBlockStarted || state.hasToolCalls) {
      events.push(`event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: state.blockIndex,
      })}\n\n`);
    }
  }

  return events;
}

interface StreamState {
  started: boolean;
  textBlockStarted: boolean;
  blockIndex: number;
  outputTokens: number;
  hasToolCalls: boolean;
  currentToolId: string;
  currentToolArgs: string;
}

// ── Main handler ──

/**
 * Check if an Anthropic API request should be routed to Ollama.
 * Returns the parsed body if yes, null if it should go to Anthropic.
 */
export function shouldRouteToOllama(body: Buffer, url?: string): any | null {
  // Only intercept Messages API calls
  if (url && !url.includes('/messages')) return null;

  try {
    const parsed = JSON.parse(body.toString());
    logger.debug({ model: parsed.model, isAnthropic: isAnthropicModel(parsed.model) }, 'Proxy routing check');
    if (parsed.model && !isAnthropicModel(parsed.model)) {
      return parsed;
    }
  } catch {}

  return null;
}

/**
 * Handle an Anthropic API request by translating it to OpenAI format,
 * forwarding to Ollama, and translating the response back.
 */
export function handleOllamaRequest(
  anthropicBody: any,
  res: ServerResponse,
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
  target?: TranslationTarget,
): void {
  const targetUrl = target?.url ? new URL(target.url) : new URL(OLLAMA_URL);
  // Preserve the path from the base URL (e.g. Groq needs /openai/v1/chat/completions)
  const basePath = targetUrl.pathname.replace(/\/+$/, ''); // strip trailing slash
  const targetPath = target?.path || (basePath && basePath !== '/' ? basePath + '/chat/completions' : '/v1/chat/completions');
  const isTargetHttps = targetUrl.protocol === 'https:';
  const makeReq = isTargetHttps ? httpsRequest : httpRequest;
  const isStreaming = anthropicBody.stream === true;

  // Translate request
  const openaiMessages = translateMessages(anthropicBody.messages, anthropicBody.system);
  const openaiTools = translateTools(anthropicBody.tools);

  const openaiBody: any = {
    model: anthropicBody.model,
    messages: openaiMessages,
    stream: isStreaming,
  };
  if (openaiTools) openaiBody.tools = openaiTools;
  if (anthropicBody.max_tokens) openaiBody.max_tokens = Math.min(anthropicBody.max_tokens, 32768);
  if (anthropicBody.temperature != null) openaiBody.temperature = anthropicBody.temperature;

  const bodyStr = JSON.stringify(openaiBody);

  logger.debug(
    { model: anthropicBody.model, streaming: isStreaming, target: targetUrl.hostname },
    'Routing to OpenAI-compatible endpoint',
  );

  const reqHeaders: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr),
  };
  if (target?.authHeaders) Object.assign(reqHeaders, target.authHeaders);

  const ollamaReq = makeReq(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isTargetHttps ? 443 : 80),
      path: targetPath,
      method: 'POST',
      headers: reqHeaders,
    },
    (ollamaRes: IncomingMessage) => {
      if (isStreaming) {
        handleStreamingResponse(ollamaRes, res, anthropicBody.model, onUsage);
      } else {
        handleNonStreamingResponse(ollamaRes, res, anthropicBody.model, onUsage);
      }
    },
  );

  ollamaReq.on('error', (err) => {
    logger.error({ err }, 'Ollama translation proxy error');
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: `Ollama connection failed: ${err.message}` },
      }));
    }
  });

  ollamaReq.write(bodyStr);
  ollamaReq.end();
}

function handleNonStreamingResponse(
  ollamaRes: IncomingMessage,
  res: ServerResponse,
  model: string,
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
): void {
  const chunks: Buffer[] = [];
  ollamaRes.on('data', c => chunks.push(c));
  ollamaRes.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString();
      const openaiResp = JSON.parse(raw);

      // Check for Ollama error responses
      if (ollamaRes.statusCode && ollamaRes.statusCode >= 400 || openaiResp.error) {
        const errMsg = openaiResp.error?.message || raw.slice(0, 200);
        logger.error({ status: ollamaRes.statusCode, error: errMsg }, 'Ollama returned error');
        res.writeHead(ollamaRes.statusCode || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: errMsg },
        }));
        return;
      }

      const anthropicResp = translateResponse(openaiResp, model);
      const respBody = JSON.stringify(anthropicResp);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(respBody),
      });
      res.end(respBody);
      if (onUsage) {
        try {
          onUsage({
            inputTokens: anthropicResp.usage?.input_tokens ?? 0,
            outputTokens: anthropicResp.usage?.output_tokens ?? 0,
          });
        } catch { /* never break response */ }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to translate Ollama response');
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Translation error');
      }
    }
  });
}

function handleStreamingResponse(
  ollamaRes: IncomingMessage,
  res: ServerResponse,
  model: string,
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
): void {
  // Check for error status before starting stream
  if (ollamaRes.statusCode && ollamaRes.statusCode >= 400) {
    const chunks: Buffer[] = [];
    ollamaRes.on('data', c => chunks.push(c));
    ollamaRes.on('end', () => {
      const errMsg = Buffer.concat(chunks).toString().slice(0, 200);
      logger.error({ status: ollamaRes.statusCode }, `Ollama streaming error: ${errMsg}`);
      res.writeHead(ollamaRes.statusCode!, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: errMsg },
      }));
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const state: StreamState = {
    started: false,
    textBlockStarted: false,
    blockIndex: -1,
    outputTokens: 0,
    hasToolCalls: false,
    currentToolId: '',
    currentToolArgs: '',
  };

  let buffer = '';

  ollamaRes.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const events = translateStreamChunk(trimmed, model, state);
      for (const event of events) {
        res.write(event);
      }
    }
  });

  ollamaRes.on('end', () => {
    // Process any remaining buffer
    if (buffer.trim()) {
      const events = translateStreamChunk(buffer.trim(), model, state);
      for (const event of events) {
        res.write(event);
      }
    }
    // Ensure we send final events if not already
    if (state.started) {
      if (state.textBlockStarted) {
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: state.blockIndex })}\n\n`);
      }
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: state.hasToolCalls ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: state.outputTokens } })}\n\n`);
      res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
    }
    res.end();
    if (onUsage) {
      try { onUsage({ inputTokens: 0, outputTokens: state.outputTokens }); } catch { /* */ }
    }
  });

  ollamaRes.on('error', (err) => {
    logger.error({ err }, 'Ollama streaming error');
    res.end();
  });
}
