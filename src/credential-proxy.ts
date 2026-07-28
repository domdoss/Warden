/**
 * Credential proxy for container isolation (Ollama-first).
 *
 * Containers never see real API keys. Instead they send Ollama-format
 * requests to this proxy. The proxy:
 *   1. Validates the per-user HMAC token in the URL path.
 *   2. Looks up and decrypts the user's API key from the DB.
 *   3. Routes the request:
 *      - Local Ollama model → forward to OLLAMA_URL as-is
 *      - Anthropic model    → translate Ollama→Anthropic, inject key
 *      - OpenAI-compat endpoint → translate Ollama→OpenAI, inject key
 */
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { logger } from './logger.js';
import { OLLAMA_URL } from './config.js';
import { validateContainerAuthToken } from './encryption.js';
import { getActiveUserApiKey, getUserApiKeyById, logApiUsage } from './db.js';
import { decryptApiKey } from './encryption.js';
import { anthropicChatStream } from './anthropic-translate.js';

// ── Key cache ──────────────────────────────────────────────────────────

interface CachedKey {
  apiKey: string;
  keyType: string;
  keyId: string;
  baseUrl: string;
  defaultModel: string;
  expiresAt: number;
}

const userKeyCache = new Map<string, CachedKey>();
const CACHE_TTL_MS = 60_000;

function getCachedKey(cacheKey: string): CachedKey | null {
  const cached = userKeyCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    userKeyCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function resolveUserApiKey(userId: string, keyId?: string): CachedKey | null {
  const cacheKey = keyId || userId;
  const cached = getCachedKey(cacheKey);
  if (cached) return cached;
  try {
    const row = keyId ? getUserApiKeyById(keyId) : getActiveUserApiKey(userId);
    if (!row) return null;
    if (keyId && row.user_id !== userId) return null;
    const plainKey = decryptApiKey(row.encrypted_key, row.iv, row.auth_tag);
    const entry: CachedKey = {
      apiKey: plainKey,
      keyType: row.key_type,
      keyId: row.id,
      baseUrl: row.base_url || '',
      defaultModel: row.default_model || '',
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    userKeyCache.set(cacheKey, entry);
    return entry;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to resolve user API key');
    return null;
  }
}

export function clearUserKeyCache(userId?: string): void {
  if (userId) userKeyCache.delete(userId);
  else userKeyCache.clear();
}

// ── URL parsing ────────────────────────────────────────────────────────

function parseUserAuth(url: string): { userId: string; keyId?: string; strippedPath: string } | null {
  const match = url.match(/^\/user\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  const validated = validateContainerAuthToken(match[1]);
  if (!validated) return null;
  const parts = validated.split('|');
  return { userId: parts[0], keyId: parts[1], strippedPath: match[2] || '/' };
}

// ── Model detection ────────────────────────────────────────────────────

function isAnthropicModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('claude') || m.includes('anthropic');
}

function isLocalOllamaModel(model: string, userKey: CachedKey | null): boolean {
  if (userKey) return false; // user key = external provider
  if (isAnthropicModel(model)) return false;
  return true;
}

// ── Ollama → OpenAI format translation ─────────────────────────────────

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

function translateOllamaToOpenAI(body: any): { messages: OpenAIMessage[]; tools?: any[]; model: string; stream: boolean } {
  const messages: OpenAIMessage[] = [];
  for (const msg of body.messages || []) {
    if (msg.role === 'tool') {
      messages.push({ role: 'tool', content: msg.content || '', tool_call_id: msg.tool_call_id || `call_${messages.length}` });
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls.map((tc: any, i: number) => ({
          id: tc.id || `call_${i}`,
          type: 'function' as const,
          function: {
            name: tc.function?.name || tc.name || '',
            arguments: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
          },
        })),
      });
    } else {
      messages.push({ role: msg.role, content: msg.content || '' });
    }
  }

  let tools: any[] | undefined;
  if (body.tools?.length) {
    tools = body.tools.map((t: any) => ({
      type: 'function',
      function: {
        name: t.function?.name || t.name || '',
        description: t.function?.description || t.description || '',
        parameters: t.function?.parameters || t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  return { messages, tools, model: body.model, stream: !!body.stream };
}

// ── Request handlers ───────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function jsonError(res: ServerResponse, message: string, status = 500): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/** Forward an Ollama-format request to the local Ollama server as-is. */
function forwardToOllama(body: Buffer, req: IncomingMessage, res: ServerResponse, ollamaPath: string): void {
  const ollamaUrl = new URL(OLLAMA_URL);
  const isHttps = ollamaUrl.protocol === 'https:';
  const makeReq = isHttps ? httpsRequest : httpRequest;

  const upstream = makeReq(
    {
      hostname: ollamaUrl.hostname,
      port: ollamaUrl.port || (isHttps ? 443 : 80),
      path: ollamaPath,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    } as RequestOptions,
    (upRes) => {
      res.writeHead(upRes.statusCode!, upRes.headers);
      upRes.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    logger.error({ err }, 'Credential proxy → Ollama error');
    if (!res.headersSent) jsonError(res, 'Ollama upstream error', 502);
  });

  upstream.write(body);
  upstream.end();
}

/** Route to Anthropic using the translation layer. Streams Ollama-format NDJSON back. */
async function routeToAnthropic(ollamaBody: any, apiKey: string, res: ServerResponse): Promise<void> {
  try {
    const result = await anthropicChatStream(ollamaBody, apiKey, (chunk) => {
      if (chunk.done) return;
      // Stream Ollama-compatible NDJSON back to the container
      const ollamaChunk: any = {
        model: ollamaBody.model,
        message: { role: 'assistant', content: chunk.content || '' },
        done: false,
      };
      if (chunk.tool_calls) {
        ollamaChunk.message.tool_calls = chunk.tool_calls;
      }
      res.write(JSON.stringify(ollamaChunk) + '\n');
    });

    // Final "done" message with the full result
    const finalMsg: any = {
      model: result.model || ollamaBody.model,
      message: { role: 'assistant', content: result.content },
      done: true,
      total_duration: 0,
      eval_count: result.usage?.output_tokens || 0,
      prompt_eval_count: result.usage?.input_tokens || 0,
    };
    if (result.tool_calls) {
      finalMsg.message.tool_calls = result.tool_calls;
    }
    res.write(JSON.stringify(finalMsg) + '\n');
    res.end();
  } catch (err: any) {
    logger.error({ err }, 'Credential proxy → Anthropic error');
    if (!res.headersSent) {
      jsonError(res, `Anthropic error: ${err.message}`, 502);
    } else {
      res.end();
    }
  }
}

/** Route to an OpenAI-compatible endpoint (e.g. Augure/Ossington). */
async function routeToOpenAI(ollamaBody: any, baseUrl: string, apiKey: string, res: ServerResponse): Promise<void> {
  const openaiPayload = translateOllamaToOpenAI(ollamaBody);
  const bodyStr = JSON.stringify({
    ...openaiPayload,
    stream: true,
  });

  const url = new URL(baseUrl.replace(/\/$/, '') + '/chat/completions');
  const isHttps = url.protocol === 'https:';
  const makeReq = isHttps ? httpsRequest : httpRequest;

  const upstream = makeReq(
    {
      hostname: url.hostname,
      port: url.port || (isHttps ? '443' : '80'),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    } as RequestOptions,
    (upRes) => {
      if (upRes.statusCode && upRes.statusCode >= 400) {
        const chunks: Buffer[] = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          logger.error({ status: upRes.statusCode, raw: raw.slice(0, 500) }, 'OpenAI-compat endpoint error');
          if (!res.headersSent) jsonError(res, raw, upRes.statusCode);
        });
        return;
      }

      // Stream OpenAI SSE → Ollama NDJSON
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      let buffer = '';
      let fullContent = '';
      const collectedToolCalls: any[] = [];

      upRes.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              fullContent += delta.content;
              res.write(JSON.stringify({
                model: ollamaBody.model,
                message: { role: 'assistant', content: delta.content },
                done: false,
              }) + '\n');
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? collectedToolCalls.length;
                if (!collectedToolCalls[idx]) {
                  collectedToolCalls[idx] = { function: { name: '', arguments: '' } };
                }
                if (tc.function?.name) collectedToolCalls[idx].function.name += tc.function.name;
                if (tc.function?.arguments) collectedToolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch { /* skip malformed lines */ }
        }
      });

      upRes.on('end', () => {
        // Parse collected tool call argument strings
        const toolCalls = collectedToolCalls.map((tc) => {
          try {
            return { function: { name: tc.function.name, arguments: JSON.parse(tc.function.arguments || '{}') } };
          } catch {
            return { function: { name: tc.function.name, arguments: {} } };
          }
        }).filter(tc => tc.function.name);

        const finalMsg: any = {
          model: ollamaBody.model,
          message: { role: 'assistant', content: fullContent },
          done: true,
        };
        if (toolCalls.length > 0) {
          finalMsg.message.tool_calls = toolCalls;
        }
        res.write(JSON.stringify(finalMsg) + '\n');
        res.end();
      });
    },
  );

  upstream.on('error', (err) => {
    logger.error({ err, baseUrl }, 'Credential proxy → OpenAI-compat error');
    if (!res.headersSent) jsonError(res, 'Upstream error', 502);
  });

  upstream.write(bodyStr);
  upstream.end();
}

// ── Server ─────────────────────────────────────────────────────────────

export function startCredentialProxy(port: number, host = '127.0.0.1'): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const requestUrl = req.url || '/';

        // Parse /user/{token}/... from URL
        const userAuth = parseUserAuth(requestUrl);
        if (!userAuth) {
          // No user auth — could be a health check or local-only request.
          // Forward directly to Ollama (no key injection).
          const body = await readBody(req);
          return forwardToOllama(body, req, res, requestUrl);
        }

        const { userId, keyId, strippedPath } = userAuth;
        const userKey = resolveUserApiKey(userId, keyId);

        const body = await readBody(req);
        let ollamaBody: any;
        try {
          ollamaBody = JSON.parse(body.toString());
        } catch {
          return jsonError(res, 'Invalid JSON', 400);
        }

        const model = (ollamaBody.model || '').toLowerCase();

        // Route decision
        if (isLocalOllamaModel(model, userKey)) {
          // Local Ollama — forward as-is, no key needed
          return forwardToOllama(body, req, res, '/api/chat');
        }

        if (!userKey) {
          return jsonError(res, 'No API key configured for external model', 403);
        }

        logger.info({ userId, model, keyType: userKey.keyType }, 'Routing external model');

        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

        if (isAnthropicModel(model) || userKey.keyType.startsWith('anthropic')) {
          return await routeToAnthropic(ollamaBody, userKey.apiKey, res);
        }

        // OpenAI-compatible (Augure/Ossington, OpenAI, Groq, DeepSeek, etc.)
        const baseUrl = userKey.baseUrl || 'https://api.openai.com/v1';
        return await routeToOpenAI(ollamaBody, baseUrl, userKey.apiKey, res);

      } catch (err) {
        logger.error({ err }, 'Credential proxy request error');
        if (!res.headersSent) jsonError(res, 'Internal proxy error', 500);
      }
    });

    server.listen(port, host, () => {
      logger.info({ port, host }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}
