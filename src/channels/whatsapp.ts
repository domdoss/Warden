import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  WASocket,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  STORE_DIR,
  WORKSPACE_ROOT,
} from '../config.js';
import { isImageMessage, processImage } from '../image.js';
import { logger } from '../logger.js';
import { isVoiceMessage, transcribeAudioMessage } from '../transcription.js';
import {
  Channel,
  OnInboundMessage,
  OWNER_JID,
} from '../types.js';
import { registerChannel, ChannelOpts } from './registry.js';

export interface WhatsAppChannelOpts {
  /** Unique user identifier. Defaults to 'admin'. */
  userId?: string;
  /** Directory for auth state (creds.json etc). Defaults to `<STORE_DIR>/auth`. */
  authDir?: string;
  /** Fires when the WhatsApp connection opens successfully, with the linked phone number. */
  onConnected?: (phoneNumber: string) => void;
  /** If true, attempt to connect even when no creds.json is present. */
  forceConnect?: boolean;
}

export class WhatsAppChannel implements Channel {
  name = 'whatsapp';
  readonly userId: string;

  private sock!: WASocket;
  private connected = false;
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private _pendingQr: string | null = null;
  private _qrFailed = false;
  private _sentMessageIds = new Set<string>();
  private _authDir: string;
  private _onConnected?: (phoneNumber: string) => void;
  private _onMessage: OnInboundMessage | null = null;

  constructor(opts: WhatsAppChannelOpts) {
    this.userId = opts.userId ?? 'admin';
    this._authDir = opts.authDir ?? path.join(STORE_DIR, 'auth');
    this._onConnected = opts.onConnected;
    // Kick off connection automatically — the simplified Channel interface
    // has no connect() method.
    this.connectInternal().catch((err) => {
      logger.error({ err }, 'WhatsApp initial connect failed');
    });
  }

  onMessage(cb: OnInboundMessage): void {
    this._onMessage = cb;
  }

  getQrCode(): string | null {
    return this._pendingQr;
  }

  getQrStatus(): { qr: string | null; connected: boolean; failed: boolean } {
    return { qr: this._pendingQr, connected: this.connected, failed: this._qrFailed };
  }

  private async connectInternal(): Promise<void> {
    fs.mkdirSync(this._authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(this._authDir);

    const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
      logger.warn(
        { err },
        'Failed to fetch latest WA Web version, using default',
      );
      return { version: undefined };
    });
    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'),
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this._pendingQr = qr;
        this._qrFailed = false;
        logger.info('WhatsApp QR code generated — waiting for scan via dashboard');
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        if (reason === DisconnectReason.timedOut) {
          this._qrFailed = true;
          this._pendingQr = null;
        }
        logger.info(
          { reason, queuedMessages: this.outgoingQueue.length },
          'Connection closed — reconnecting',
        );
        this.scheduleReconnect(1);
      } else if (connection === 'open') {
        this.connected = true;
        this._pendingQr = null;
        logger.info('Connected to WhatsApp');

        this.sock.sendPresenceUpdate('available').catch((err) => {
          logger.warn({ err }, 'Failed to send presence update');
        });

        if (this._onConnected && this.sock.user) {
          const phoneNumber = this.sock.user.id.split(':')[0];
          try {
            this._onConnected(phoneNumber);
          } catch (err) {
            logger.error({ err }, 'onConnected callback error');
          }
        }

        this.flushOutgoingQueue().catch((err) =>
          logger.error({ err }, 'Failed to flush outgoing queue'),
        );
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        // Skip messages we sent via sendMessage() (bot response echoes)
        if (msg.key.fromMe && msg.key.id && this._sentMessageIds.has(msg.key.id)) {
          this._sentMessageIds.delete(msg.key.id);
          continue;
        }
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;

        const timestamp = new Date(
          Number(msg.messageTimestamp) * 1000,
        ).toISOString();

        let content =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '';

        // Image attachment handling
        if (isImageMessage(msg)) {
          try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            const caption = msg.message?.imageMessage?.caption ?? '';
            const result = await processImage(
              buffer as Buffer,
              WORKSPACE_ROOT,
              caption,
            );
            if (result) {
              content = result.content;
            }
          } catch (err) {
            logger.warn({ err }, 'Image - download failed');
          }
        }

        // Skip protocol messages with no text content (encryption keys, read receipts, etc.)
        // but allow voice messages through for transcription
        if (!content && !isVoiceMessage(msg)) continue;

        const sender = msg.key.participant || msg.key.remoteJid || '';
        const senderName = msg.pushName || sender.split('@')[0];

        const fromMe = msg.key.fromMe || false;
        const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
          ? fromMe
          : content.startsWith(`${ASSISTANT_NAME}:`);

        // Transcribe voice messages before storing
        let finalContent = content;
        if (isVoiceMessage(msg)) {
          try {
            const transcript = await transcribeAudioMessage(msg, this.sock);
            if (transcript) {
              finalContent = `[Voice: ${transcript}]`;
              logger.info(
                { length: transcript.length },
                'Transcribed voice message',
              );
            } else {
              finalContent = '[Voice Message - transcription unavailable]';
            }
          } catch (err) {
            logger.error({ err }, 'Voice transcription error');
            finalContent = '[Voice Message - transcription failed]';
          }
        }

        // All inbound messages route to the single owner chat.
        if (this._onMessage) {
          this._onMessage(OWNER_JID, {
            id: msg.key.id || '',
            chat_jid: OWNER_JID,
            sender,
            sender_name: senderName,
            content: finalContent,
            timestamp,
            is_from_me: fromMe,
            is_bot_message: isBotMessage,
          });
        }
      }
    });
  }

  async sendMessage(jid: string, text: string, senderName?: string): Promise<void> {
    // jid is always the owner JID in the simplified architecture, but we
    // still send to the WhatsApp account that the user linked. The owner's
    // own phone (self-chat) is the target.
    const targetJid = this.sock?.user?.id ? `${this.sock.user.id.split(':')[0]}@s.whatsapp.net` : jid;
    const label = senderName || ASSISTANT_NAME;
    const prefixed = ASSISTANT_HAS_OWN_NUMBER
      ? text
      : `${label}: ${text}`;

    // Chunk long messages — oversized sends get silently truncated mid-sentence
    // on the receiving side. Prefer breaking at newlines so content stays readable.
    const MAX_LENGTH = 4096;
    const chunks: string[] = [];
    let rest = prefixed;
    while (rest.length > MAX_LENGTH) {
      let cut = rest.lastIndexOf('\n', MAX_LENGTH);
      if (cut < MAX_LENGTH * 0.5) cut = rest.lastIndexOf(' ', MAX_LENGTH);
      if (cut < MAX_LENGTH * 0.5) cut = MAX_LENGTH;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\s+/, '');
    }
    if (rest) chunks.push(rest);

    if (!this.connected) {
      for (const chunk of chunks) this.outgoingQueue.push({ jid: targetJid, text: chunk });
      logger.info(
        { length: prefixed.length, queueSize: this.outgoingQueue.length },
        'WA disconnected, message queued',
      );
      return;
    }
    for (const chunk of chunks) {
      try {
        const sent = await this.sock.sendMessage(targetJid, { text: chunk });
        if (sent?.key?.id) this._sentMessageIds.add(sent.key.id);
      } catch (err) {
        this.outgoingQueue.push({ jid: targetJid, text: chunk });
        logger.warn(
          { err, queueSize: this.outgoingQueue.length },
          'Failed to send, message queued',
        );
      }
    }
    logger.info({ length: prefixed.length, chunks: chunks.length }, 'Message sent');
  }

  private scheduleReconnect(attempt: number): void {
    const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 300000);
    logger.info({ attempt, delayMs }, 'Reconnecting...');
    setTimeout(() => {
      this.connectInternal().catch((err) => {
        logger.error({ err, attempt }, 'Reconnection attempt failed');
        this.scheduleReconnect(attempt + 1);
      });
    }, delayMs);
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing outgoing message queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        await this.sock.sendMessage(item.jid, { text: item.text });
        logger.info(
          { length: item.text.length },
          'Queued message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}

registerChannel('whatsapp', (opts: ChannelOpts & { forceConnect?: boolean; authDir?: string }) => {
  const authDir = opts.authDir ?? path.join(STORE_DIR, 'auth');
  if (!opts.forceConnect && !fs.existsSync(path.join(authDir, 'creds.json'))) {
    logger.warn(
      'WhatsApp: credentials not found. Use Connected Accounts to pair.',
    );
    return null;
  }
  return new WhatsAppChannel(opts);
});