/**
 * Google OAuth provider: Calendar v3 + Gmail API.
 * All HTTP calls use native fetch. No external libraries.
 */
import { logger } from '../logger.js';
import type {
  OAuthProvider,
  OAuthTokens,
  RefreshedToken,
  CalendarEvent,
  Email,
  ProviderCalendar,
} from './types.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GoogleProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleProvider implements OAuthProvider {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(config?: GoogleProviderConfig) {
    this.clientId = config?.clientId ?? '';
    this.clientSecret = config?.clientSecret ?? '';
    this.redirectUri = config?.redirectUri ?? '';
  }

  // ── Auth ──────────────────────────────────────────────────────────

  getAuthUrl(state: string, scopes: string[]): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Google token exchange failed (${res.status}): ${text}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Fetch the user's email from the userinfo endpoint
    const email = await this.fetchUserEmail(data.access_token);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      email,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Google token refresh failed (${res.status}): ${text}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  // ── Calendar ──────────────────────────────────────────────────────

  async listCalendars(token: string): Promise<ProviderCalendar[]> {
    const res = await fetch(
      `${CALENDAR_BASE}/users/me/calendarList`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google listCalendars failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as {
      items?: Array<{ id: string; summary?: string; primary?: boolean; backgroundColor?: string }>;
    };
    return (data.items ?? []).map((c) => ({
      id: c.id,
      name: c.summary ?? c.id,
      primary: c.primary,
      color: c.backgroundColor,
    }));
  }

  async fetchEvents(
    token: string,
    startDate: string,
    endDate: string,
    calendarId?: string,
  ): Promise<CalendarEvent[]> {
    const calId = encodeURIComponent(calendarId || 'primary');
    const params = new URLSearchParams({
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const res = await fetch(
      `${CALENDAR_BASE}/calendars/${calId}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Google fetchEvents failed (${res.status}): ${text}`,
      );
    }

    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        location?: string;
        iCalUID?: string;
      }>;
    };

    return (data.items ?? []).map((item) => {
      const allDay = !item.start?.dateTime;
      return {
        providerEventId: item.id,
        title: item.summary ?? '(No title)',
        description: item.description,
        startTime: item.start?.dateTime ?? item.start?.date ?? '',
        endTime: item.end?.dateTime ?? item.end?.date ?? '',
        allDay,
        location: item.location,
        icalUid: item.iCalUID,
      };
    });
  }

  async createEvent(token: string, event: CalendarEvent, calendarId?: string): Promise<string> {
    const calId = encodeURIComponent(calendarId || 'primary');
    const body = this.calendarEventToGoogleBody(event);

    const res = await fetch(
      `${CALENDAR_BASE}/calendars/${calId}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Google createEvent failed (${res.status}): ${text}`,
      );
    }

    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async updateEvent(
    token: string,
    providerEventId: string,
    event: CalendarEvent,
    calendarId?: string,
  ): Promise<void> {
    const calId = encodeURIComponent(calendarId || 'primary');
    const body = this.calendarEventToGoogleBody(event);

    const res = await fetch(
      `${CALENDAR_BASE}/calendars/${calId}/events/${encodeURIComponent(providerEventId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Google updateEvent failed (${res.status}): ${text}`,
      );
    }
  }

  async deleteEvent(
    token: string,
    providerEventId: string,
    calendarId?: string,
  ): Promise<void> {
    const calId = encodeURIComponent(calendarId || 'primary');
    const res = await fetch(
      `${CALENDAR_BASE}/calendars/${calId}/events/${encodeURIComponent(providerEventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Google deleteEvent failed (${res.status}): ${text}`,
      );
    }
  }

  // ── Email (Gmail API) ────────────────────────────────────────────

  async fetchEmails(
    token: string,
    folder: string,
    limit: number,
    search?: string,
    previewOnly?: boolean,
  ): Promise<Email[]> {
    const labelId = this.folderToLabel(folder);
    const maxResultsPerPage = Math.min(limit, 500); // Gmail API max is 500

    // Fetch all message IDs (handles pagination)
    const messageIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        maxResults: String(Math.min(maxResultsPerPage - messageIds.length, 500)),
        labelIds: labelId,
      });
      if (search) {
        params.set('q', search);
      }
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const listRes = await fetch(
        `${GMAIL_BASE}/messages?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!listRes.ok) {
        const text = await listRes.text();
        throw new Error(
          `Gmail list messages failed (${listRes.status}): ${text}`,
        );
      }

      const listData = (await listRes.json()) as {
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      };

      if (listData.messages) {
        messageIds.push(...listData.messages.map(m => m.id));
      }
      pageToken = listData.nextPageToken;
    } while (pageToken && messageIds.length < limit);

    if (messageIds.length === 0) return [];

    // Fetch email details (metadata for preview, full for non-preview)
    const emails: Email[] = [];
    for (const msgId of messageIds.slice(0, limit)) {
      try {
        if (previewOnly) {
          const email = await this.fetchEmailMetadata(token, msgId, folder);
          emails.push(email);
        } else {
          const email = await this.fetchSingleEmail(token, msgId, folder);
          emails.push(email);
        }
      } catch (err) {
        logger.warn({ err, messageId: msgId }, 'Failed to fetch Gmail message');
      }
    }

    return emails;
  }

  async sendEmail(
    token: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    // Build RFC 2822 message
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ];
    const rawMessage = messageParts.join('\r\n');

    // base64url encode
    const encoded = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch(`${GMAIL_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Gmail sendEmail failed (${res.status}): ${text}`,
      );
    }
  }

  async getEmailById(
    token: string,
    emailId: string,
  ): Promise<Email | null> {
    try {
      return await this.fetchSingleEmail(token, emailId, 'INBOX');
    } catch (err) {
      logger.warn({ err, emailId }, 'Failed to fetch Gmail message by ID');
      return null;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  private async fetchUserEmail(accessToken: string): Promise<string> {
    const res = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      logger.warn('Failed to fetch Google user email, returning empty');
      return '';
    }
    const data = (await res.json()) as { email?: string };
    return data.email ?? '';
  }

  private calendarEventToGoogleBody(event: CalendarEvent): Record<string, unknown> {
    const body: Record<string, unknown> = {
      summary: event.title,
      description: event.description,
      location: event.location,
    };

    if (event.allDay) {
      // Google all-day events use date (YYYY-MM-DD) not dateTime
      body.start = { date: event.startTime.slice(0, 10) };
      body.end = { date: event.endTime.slice(0, 10) };
    } else {
      body.start = { dateTime: event.startTime };
      body.end = { dateTime: event.endTime };
    }

    return body;
  }

  private async fetchSingleEmail(
    token: string,
    messageId: string,
    folder: string,
  ): Promise<Email> {
    const res = await fetch(
      `${GMAIL_BASE}/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Gmail fetch message ${messageId} failed (${res.status}): ${text}`,
      );
    }

    const msg = (await res.json()) as {
      id: string;
      labelIds?: string[];
      payload?: {
        headers?: Array<{ name: string; value: string }>;
        body?: { data?: string };
        parts?: Array<{
          mimeType?: string;
          body?: { data?: string };
        }>;
      };
    };

    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = getHeader('From');
    const toRaw = getHeader('To');
    const subject = getHeader('Subject');
    const date = getHeader('Date');

    // Parse To into array (handles "a@b.com, c@d.com" format)
    const toList = toRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Decode body: try top-level body first, then look in parts for text/plain
    let bodyText = '';
    const topBody = msg.payload?.body?.data;
    if (topBody) {
      bodyText = this.decodeBase64Url(topBody);
    } else if (msg.payload?.parts) {
      const textPart = msg.payload.parts.find(
        (p) => p.mimeType === 'text/plain',
      );
      if (textPart?.body?.data) {
        bodyText = this.decodeBase64Url(textPart.body.data);
      }
    }

    const isRead = !(msg.labelIds ?? []).includes('UNREAD');

    return {
      id: msg.id,
      from,
      to: toList,
      subject,
      body: bodyText,
      date: date ? new Date(date).toISOString() : '',
      folder,
      isRead,
    };
  }

  private async fetchEmailMetadata(
    token: string,
    messageId: string,
    folder: string,
  ): Promise<Email> {
    // Fetch only metadata (no body) - much faster
    const res = await fetch(
      `${GMAIL_BASE}/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Gmail fetch metadata ${messageId} failed (${res.status}): ${text}`,
      );
    }

    const msg = (await res.json()) as {
      id: string;
      labelIds?: string[];
      payload?: {
        headers?: Array<{ name: string; value: string }>;
      };
      snippet?: string;
    };

    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = getHeader('From');
    const toRaw = getHeader('To');
    const subject = getHeader('Subject');
    const date = getHeader('Date');

    // Parse To into array
    const toList = toRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const isRead = !(msg.labelIds ?? []).includes('UNREAD');

    return {
      id: msg.id,
      from,
      to: toList,
      subject,
      body: msg.snippet ?? '', // Gmail provides a snippet
      date: date ? new Date(date).toISOString() : '',
      folder,
      isRead,
      snippet: msg.snippet ?? '',
    };
  }

  private decodeBase64Url(data: string): string {
    // Gmail uses base64url encoding (RFC 4648 section 5)
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  private folderToLabel(folder: string): string {
    const map: Record<string, string> = {
      inbox: 'INBOX',
      sent: 'SENT',
      drafts: 'DRAFT',
      trash: 'TRASH',
      spam: 'SPAM',
      starred: 'STARRED',
    };
    return map[folder.toLowerCase()] ?? 'INBOX';
  }
}
