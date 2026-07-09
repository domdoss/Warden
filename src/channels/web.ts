/**
 * Web Channel — Direct Claude session via the Prometheus Dashboard.
 *
 * No external service needed. Messages flow:
 *   Browser → POST /api/messages → SQLite → message loop → agent → response
 *   Response → channel.sendMessage() → SQLite → browser polls → displayed
 *
 * Always available (no credentials required). Inbound messages from the
 * dashboard are written directly to the DB by the status server; this
 * channel exists only so the orchestrator can call sendMessage() on it.
 */
import { Channel, OnInboundMessage, OWNER_JID } from '../types.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { logger } from '../logger.js';

class WebChannel implements Channel {
  name = 'web';
  private onMessageCb: OnInboundMessage | null = null;

  onMessage(cb: OnInboundMessage): void {
    this.onMessageCb = cb;
  }

  async sendMessage(_jid: string, _text: string): Promise<void> {
    // No-op: bot responses are stored by the orchestrator (index.ts).
    // The dashboard polls the DB directly. OWNER_JID is the only chat.
  }
}

registerChannel('web', (opts: ChannelOpts) => {
  const channel = new WebChannel();
  channel.onMessage(opts.onMessage);
  logger.info('Web channel ready (dashboard direct session)');
  return channel;
});