/**
 * Microsoft OAuth provider: Graph API for calendar and email.
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

const MS_AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2';
const MS_AUTH_URL = `${MS_AUTH_BASE}/authorize`;
const MS_TOKEN_URL = `${MS_AUTH_BASE}/token`;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me';

interface MicrosoftProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class MicrosoftProvider implements OAuthProvider {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(config?: MicrosoftProviderConfig) {
    this.clientId = config?.clientId ?? '';
    this.clientSecret = config?.clientSecret ?? '';
    this.redirectUri = config?.redirectUri ?? '';
  }

  // ── Auth ──────────────────────────────────────────────────────────

  getAuthUrl(state: string, scopes: string[]): string {
    // Always include offline_access so we get a refresh token
    const allScopes = Array.from(new Set([...scopes, 'offline_access']));

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: allScopes.join(' '),
      state,
      response_mode: 'query',
    });
    return `${MS_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const res = await fetch(MS_TOKEN_URL, {
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
        `Microsoft token exchange failed (${res.status}): ${text}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const email = await this.fetchUserEmail(data.access_token);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      email,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
    const res = await fetch(MS_TOKEN_URL, {
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
        `Microsoft token refresh failed (${res.status}): ${text}`,
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
    const res = await fetch(`${GRAPH_BASE}/calendars`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Microsoft listCalendars failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as {
      value?: Array<{ id: string; name?: string; isDefaultCalendar?: boolean; color?: string }>;
    };
    return (data.value ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      primary: c.isDefaultCalendar,
      color: c.color,
    }));
  }

  async fetchEvents(
    token: string,
    startDate: string,
    endDate: string,
    calendarId?: string,
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      startDateTime: startDate,
      endDateTime: endDate,
      $orderby: 'start/dateTime',
    });

    const base = calendarId
      ? `${GRAPH_BASE}/calendars/${encodeURIComponent(calendarId)}/calendarView`
      : `${GRAPH_BASE}/calendarView`;
    const res = await fetch(
      `${base}?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Microsoft fetchEvents failed (${res.status}): ${text}`,
      );
    }

    const data = (await res.json()) as {
      value?: Array<{
        id: string;
        subject?: string;
        bodyPreview?: string;
        start?: { dateTime: string; timeZone: string };
        end?: { dateTime: string; timeZone: string };
        isAllDay?: boolean;
        location?: { displayName?: string };
        iCalUId?: string;
      }>;
    };

    return (data.value ?? []).map((item) => ({
      providerEventId: item.id,
      title: item.subject ?? '(No title)',
      description: item.bodyPreview,
      startTime: item.start?.dateTime
        ? this.ensureIso(item.start.dateTime)
        : '',
      endTime: item.end?.dateTime
        ? this.ensureIso(item.end.dateTime)
        : '',
      allDay: item.isAllDay ?? false,
      location: item.location?.displayName,
      icalUid: item.iCalUId,
    }));
  }

  async createEvent(token: string, event: CalendarEvent, calendarId?: string): Promise<string> {
    const body = this.calendarEventToGraphBody(event);
    const endpoint = calendarId
      ? `${GRAPH_BASE}/calendars/${encodeURIComponent(calendarId)}/events`
      : `${GRAPH_BASE}/events`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Microsoft createEvent failed (${res.status}): ${text}`,
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
    const body = this.calendarEventToGraphBody(event);

    const res = await fetch(
      `${GRAPH_BASE}/events/${encodeURIComponent(providerEventId)}`,
      {
        method: 'PATCH',
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
        `Microsoft updateEvent failed (${res.status}): ${text}`,
      );
    }
  }

  async deleteEvent(
    token: string,
    providerEventId: string,
    calendarId?: string,
  ): Promise<void> {
    const res = await fetch(
      `${GRAPH_BASE}/events/${encodeURIComponent(providerEventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Microsoft deleteEvent failed (${res.status}): ${text}`,
      );
    }
  }

  // ── Email (Microsoft Graph) ──────────────────────────────────────

  async fetchEmails(
    token: string,
    folder: string,
    limit: number,
    search?: string,
    previewOnly?: boolean,
  ): Promise<Email[]> {
    const graphFolder = this.folderToGraphFolder(folder);
    const emails: Email[] = [];
    let url: string | undefined = `${GRAPH_BASE}/mailFolders/${graphFolder}/messages?$top=${Math.min(limit, 500)}&$orderby=receivedDateTime desc`;

    if (search) {
      // Microsoft Graph supports $search across subject, body, from
      url += `&$search="${encodeURIComponent(search)}"`;
    }

    if (previewOnly) {
      // Only select required fields
      url += '&$select=id,from,toRecipients,subject,receivedDateTime,isRead,bodyPreview';
    }

    // Handle pagination to fetch all requested emails
    while (url && emails.length < limit) {
      const res = await fetch(
        url,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Microsoft fetchEmails failed (${res.status}): ${text}`,
        );
      }

      const data = (await res.json()) as {
        value?: Array<{
          id: string;
          from?: { emailAddress?: { address?: string } };
          toRecipients?: Array<{
            emailAddress?: { address?: string };
          }>;
          subject?: string;
          body?: { content?: string };
          bodyPreview?: string;
          receivedDateTime?: string;
          isRead?: boolean;
        }>;
        '@odata.nextLink'?: string;
      };

      const batch = (data.value ?? []).map((msg) => ({
        id: msg.id,
        from: msg.from?.emailAddress?.address ?? '',
        to: (msg.toRecipients ?? [])
          .map((r) => r.emailAddress?.address ?? '')
          .filter(Boolean),
        subject: msg.subject ?? '',
        body: previewOnly ? (msg.bodyPreview ?? '') : (msg.body?.content ?? ''),
        snippet: msg.bodyPreview ?? '',
        date: msg.receivedDateTime ?? '',
        folder,
        isRead: msg.isRead ?? false,
      }));

      emails.push(...batch);

      // Get next page URL if available and we need more
      if (emails.length < limit && data['@odata.nextLink']) {
        url = data['@odata.nextLink'];
      } else {
        url = undefined;
      }
    }

    return emails.slice(0, limit);
  }

  async sendEmail(
    token: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    const res = await fetch(`${GRAPH_BASE}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: {
            contentType: 'Text',
            content: body,
          },
          toRecipients: [
            {
              emailAddress: { address: to },
            },
          ],
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Microsoft sendEmail failed (${res.status}): ${text}`,
      );
    }
  }

  async getEmailById(
    token: string,
    emailId: string,
  ): Promise<Email | null> {
    try {
      const res = await fetch(
        `${GRAPH_BASE}/messages/${emailId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Microsoft getEmailById failed (${res.status}): ${text}`,
        );
      }

      const msg = (await res.json()) as {
        id: string;
        from?: { emailAddress?: { address?: string } };
        toRecipients?: Array<{ emailAddress?: { address?: string } }>;
        subject?: string;
        body?: { content?: string };
        receivedDateTime?: string;
        isRead?: boolean;
      };

      return {
        id: msg.id,
        from: msg.from?.emailAddress?.address ?? '',
        to: (msg.toRecipients ?? [])
          .map((r) => r.emailAddress?.address ?? '')
          .filter(Boolean),
        subject: msg.subject ?? '',
        body: msg.body?.content ?? '',
        date: msg.receivedDateTime ?? '',
        folder: 'INBOX',
        isRead: msg.isRead ?? false,
      };
    } catch (err) {
      return null;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  private async fetchUserEmail(accessToken: string): Promise<string> {
    const res = await fetch(`${GRAPH_BASE}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      logger.warn('Failed to fetch Microsoft user email, returning empty');
      return '';
    }
    const data = (await res.json()) as {
      mail?: string;
      userPrincipalName?: string;
    };
    return data.mail ?? data.userPrincipalName ?? '';
  }

  private calendarEventToGraphBody(
    event: CalendarEvent,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      subject: event.title,
      body: event.description
        ? { contentType: 'Text', content: event.description }
        : undefined,
      isAllDay: event.allDay,
    };

    if (event.location) {
      body.location = { displayName: event.location };
    }

    if (event.allDay) {
      // Microsoft all-day events still use dateTime but with midnight times
      body.start = { dateTime: event.startTime.slice(0, 10), timeZone: 'UTC' };
      body.end = { dateTime: event.endTime.slice(0, 10), timeZone: 'UTC' };
    } else {
      body.start = { dateTime: event.startTime, timeZone: 'UTC' };
      body.end = { dateTime: event.endTime, timeZone: 'UTC' };
    }

    return body;
  }

  /**
   * Graph API returns UTC datetimes without a Z suffix from calendarView
   * when Prefer: outlook.timezone="UTC" is set. Append Z if missing.
   */
  private ensureIso(dateTime: string): string {
    if (dateTime.endsWith('Z') || dateTime.includes('+') || dateTime.includes('-', 10)) {
      return dateTime;
    }
    return dateTime + 'Z';
  }

  private folderToGraphFolder(folder: string): string {
    const map: Record<string, string> = {
      inbox: 'inbox',
      sent: 'sentitems',
      drafts: 'drafts',
      trash: 'deleteditems',
      junk: 'junkemail',
      archive: 'archive',
    };
    return map[folder.toLowerCase()] ?? 'inbox';
  }
}
