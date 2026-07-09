import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';

const env = readEnvFile(['WHISPER_URL', 'WHISPER_MODEL']);

const WHISPER_URL =
  process.env.WHISPER_URL || env.WHISPER_URL || 'http://127.0.0.1:8000';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || env.WHISPER_MODEL || 'whisper-large-v3-turbo';

const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

export async function transcribeLocal(audioBuffer: Buffer): Promise<string | null> {
  try {
    // Build multipart form data manually (no external dependency)
    const boundary = '----WhisperBoundary' + Date.now();
    const parts: Buffer[] = [];

    // file field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`,
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

    const resp = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!resp.ok) {
      console.error(
        `Whisper transcription failed: ${resp.status} ${resp.statusText}`,
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
    console.error('Local Whisper transcription failed:', err);
    return null;
  }
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
