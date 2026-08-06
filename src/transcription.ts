import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';
import { getRouterState } from './db.js';

const env = readEnvFile(['WHISPER_URL', 'WHISPER_API_URL', 'WHISPER_MODEL', 'GROQ_API_KEY']);

// When set, requests are authenticated as Groq (or any OpenAI-compatible
// provider needing a Bearer key). Absent → local whisper server, no auth.
const GROQ_API_KEY = process.env.GROQ_API_KEY || env.GROQ_API_KEY || '';
const GROQ_BASE_URL = 'https://api.groq.com/openai';

// Read at call time — router_state lives in SQLite, which isn't initialised
// until initDatabase() runs. Evaluating this at module load would crash with
// "Cannot read properties of undefined (reading 'prepare')" because the db
// handle is still undefined during import.
//
// Primary whisper endpoint — the local whisper server. The satellite always
// defaults to local STT.
function getWhisperUrl(): string {
  return (
    getRouterState('transcription:whisper_url') ||
    process.env.WHISPER_URL || env.WHISPER_URL || 'http://127.0.0.1:8000'
  );
}

// API fallback endpoint — autofilled to the Groq API when a Groq key is
// present. Used when the local whisper server is unreachable or fails. Empty
// (no API fallback) when no key and no URL is configured.
function getWhisperApiUrl(): string {
  return (
    getRouterState('transcription:whisper_api_url') ||
    process.env.WHISPER_API_URL || env.WHISPER_API_URL ||
    (GROQ_API_KEY ? GROQ_BASE_URL : '')
  );
}
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || env.WHISPER_MODEL || 'whisper-large-v3-turbo';

const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

// POST an audio buffer to one whisper endpoint. Returns the transcript or
// null on any failure (non-ok status, network error, empty body). `apiKey`
// adds a Bearer header for OpenAI-compatible providers (Groq); pass '' for a
// bare local whisper server.
async function postTranscription(
  baseUrl: string,
  audioBuffer: Buffer,
  fmt: 'ogg' | 'wav',
  apiKey: string,
): Promise<string | null> {
  try {
    // Build multipart form data manually (no external dependency)
    const boundary = '----WhisperBoundary' + Date.now();
    const parts: Buffer[] = [];

    // file field — declared filename/content-type must match the actual
    // audio bytes, or Groq's format detection can reject the upload. WhatsApp
    // voice notes are OGG; the GPIO button records WAV.
    const filename = fmt === 'wav' ? 'voice.wav' : 'voice.ogg';
    const mimeType = fmt === 'wav' ? 'audio/wav' : 'audio/ogg';
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
    );
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // model field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${WHISPER_MODEL}\r\n`,
      ),
    );

    // response_format field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`,
      ),
    );

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const resp = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body,
    });

    if (!resp.ok) {
      console.error(
        `Whisper transcription failed (${baseUrl}): ${resp.status} ${resp.statusText}`,
      );
      return null;
    }

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = (await resp.json()) as { text?: string };
      return data.text || null;
    }

    // Plain text response
    const text = await resp.text();
    return text.trim() || null;
  } catch (err) {
    console.error(`Whisper transcription failed (${baseUrl}):`, err);
    return null;
  }
}

export async function transcribeLocal(
  audioBuffer: Buffer,
  fmt: 'ogg' | 'wav' = 'ogg',
): Promise<string | null> {
  // Primary endpoint — the local whisper server. No auth.
  const primaryUrl = getWhisperUrl();
  let result = await postTranscription(primaryUrl, audioBuffer, fmt, '');
  if (result !== null) return result;

  // Fallback to the API (Groq, autofilled) if configured and different from
  // the primary. Authed with the Groq key. This keeps STT working when the
  // local server is down, as long as an API key / URL is configured.
  const apiUrl = getWhisperApiUrl();
  const norm = (u: string) => u.trim().replace(/\/+$/, '');
  if (apiUrl && norm(apiUrl) !== norm(primaryUrl)) {
    console.log(`Whisper local (${primaryUrl}) failed — falling back to API ${apiUrl}`);
    result = await postTranscription(apiUrl, audioBuffer, fmt, GROQ_API_KEY);
  }
  return result;
}

export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      console.error('Failed to download audio message');
      return FALLBACK_MESSAGE;
    }

    console.log(`Downloaded audio message: ${buffer.length} bytes`);

    const transcript = await transcribeLocal(buffer);

    if (!transcript) {
      return FALLBACK_MESSAGE;
    }

    return transcript.trim();
  } catch (err) {
    console.error('Transcription error:', err);
    return FALLBACK_MESSAGE;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
