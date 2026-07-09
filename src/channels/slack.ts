import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnInboundMessage,
  OWNER_JID,
} from '../types.js';

const POLL_INTERVAL_MS = 3000;

async function slackApi(
  token: string,
  method: string,
  params: Record<string, string> = {},
): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function slackPost(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export class SlackChannel implements Channel {
  name = 'slack';

  private token: string;
  private onMessageCb: OnInboundMessage | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  /** Track latest message timestamp so we don't re-deliver. */
  private latestTs: string | null = null;
  /** Bot's own user ID, used to skip self-messages. */
  private botUserId: string | null = null;
  /** Slack channel id that maps to the single owner chat. */
  private channelId: string | null = null;

  constructor(token: string) {
    this.token = token;
    // Kick off polling automatically — the simplified Channel interface
    // has no connect() method.
    this.start().catch((err) => {
      logger.error({ err }, 'Slack channel failed to start');
    });
  }

  onMessage(cb: OnInboundMessage): void {
    this.onMessageCb = cb;
  }

  private async start(): Promise<void> {
    const authResp = await slackApi(this.token, 'auth.test');
    if (!authResp.ok) {
      logger.warn({ error: authResp.error }, 'Slack auth.test failed');
      return;
    }
    this.botUserId = authResp.user_id;
    this.connected = true;

    // Resolve the owner channel id from env, defaulting to the bot's DM channel.
    const envVars = readEnvFile(['SLACK_CHANNEL_ID']);
    const fromEnv = process.env.SLACK_CHANNEL_ID || envVars.SLACK_CHANNEL_ID;
    if (fromEnv) {
      this.channelId = fromEnv;
    } else {
      // The bot's own DM channel — DMs with the bot are opened by default.
      const dm = await slackApi(this.token, 'conversations.list', {
        types: 'im',
        limit: '1',
      });
      if (dm.ok && dm.channels?.length) {
        this.channelId = dm.channels[0].id;
      }
    }

    logger.info({ bot: authResp.user, team: authResp.team, channel: this.channelId }, 'Slack bot connected');
    console.log(`\n  Slack bot: @${authResp.user} (${authResp.team})`);

    // Seed latest timestamp so we don't flood on startup
    if (this.channelId) {
      try {
        const resp = await slackApi(this.token, 'conversations.history', {
          channel: this.channelId,
          limit: '1',
        });
        if (resp.ok && resp.messages?.length) {
          this.latestTs = resp.messages[0].ts;
        }
      } catch (err) {
        logger.debug({ err }, 'Slack seed timestamp failed');
      }
    }

    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (!this.connected) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
      } catch (err) {
        logger.error({ err }, 'Slack poll error');
      } finally {
        this.schedulePoll();
      }
    }, POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.channelId) return;

    const oldest = this.latestTs;
    const params: Record<string, string> = {
      channel: this.channelId,
      limit: '20',
    };
    if (oldest) params.oldest = oldest;

    const resp = await slackApi(this.token, 'conversations.history', params);
    if (!resp.ok) {
      logger.debug({ error: resp.error }, 'Slack poll error');
      return;
    }

    // Messages come newest-first; reverse to process in chronological order
    const messages: any[] = (resp.messages || []).reverse();

    for (const msg of messages) {
      if (msg.subtype) continue;
      if (msg.bot_id) continue;
      if (msg.user === this.botUserId) continue;
      if (oldest && msg.ts <= oldest) continue;

      const prevTs = this.latestTs || '0';
      if (msg.ts > prevTs) this.latestTs = msg.ts;

      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
      const senderName = await this.resolveUserName(msg.user);

      // Translate bot mentions to trigger pattern
      let content = msg.text || '';
      const botMentionRegex = new RegExp(`<@${this.botUserId}>`, 'gi');
      if (this.botUserId && botMentionRegex.test(content)) {
        content = content.replace(botMentionRegex, '').trim();
        if (!TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      if (this.onMessageCb) {
        this.onMessageCb(OWNER_JID, {
          id: msg.ts,
          chat_jid: OWNER_JID,
          sender: msg.user || 'unknown',
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });
        logger.info(
          { sender: senderName, content: content.slice(0, 80) },
          'Slack message received',
        );
      }
    }
  }

  private userNameCache: Map<string, string> = new Map();
  private async resolveUserName(userId: string): Promise<string> {
    if (!userId) return 'Unknown';
    if (this.userNameCache.has(userId)) return this.userNameCache.get(userId)!;
    try {
      const resp = await slackApi(this.token, 'users.info', { user: userId });
      if (resp.ok) {
        const name =
          resp.user?.profile?.display_name ||
          resp.user?.real_name ||
          resp.user?.name ||
          userId;
        this.userNameCache.set(userId, name);
        return name;
      }
    } catch {
      /* fall through */
    }
    return userId;
  }

  async sendMessage(_jid: string, text: string): Promise<void> {
    if (!this.channelId) {
      logger.warn('Slack: no owner channel configured (set SLACK_CHANNEL_ID)');
      return;
    }
    const MAX_LENGTH = 4000;

    const chunks =
      text.length <= MAX_LENGTH
        ? [text]
        : Array.from(
            { length: Math.ceil(text.length / MAX_LENGTH) },
            (_, i) => text.slice(i * MAX_LENGTH, (i + 1) * MAX_LENGTH),
          );

    for (const chunk of chunks) {
      const resp = await slackPost(this.token, 'chat.postMessage', {
        channel: this.channelId,
        text: chunk,
        mrkdwn: true,
      });
      if (!resp.ok) {
        logger.error({ error: resp.error }, 'Slack sendMessage failed');
      }
    }

    logger.info({ length: text.length }, 'Slack message sent');
  }
}

registerChannel('slack', (_opts: ChannelOpts) => {
  const envVars = readEnvFile(['SLACK_BOT_TOKEN']);
  const token = process.env.SLACK_BOT_TOKEN || envVars.SLACK_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Slack: SLACK_BOT_TOKEN not set');
    return null;
  }
  return new SlackChannel(token);
});