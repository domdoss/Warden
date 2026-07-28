/**
 * Shared types and interface for OAuth providers (Google, Microsoft).
 * Each provider implements calendar and email operations via REST APIs.
 */

export interface CalendarEvent {
  providerEventId?: string;
  title: string;
  description?: string;
  startTime: string; // ISO
  endTime: string; // ISO
  allDay: boolean;
  location?: string;
  icalUid?: string;
}

export interface Email {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: string; // ISO
  folder: string;
  isRead: boolean;
  snippet?: string; // Preview text (first ~100 chars of body)
  attachments?: Array<{ filename: string; size: number; contentType: string }>;
}

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email: string;
};

export type RefreshedToken = {
  accessToken: string;
  expiresIn: number;
};

export interface ProviderCalendar {
  id: string;          // provider's calendar ID (e.g. "primary", "work@group.calendar.google.com")
  name: string;        // display name (e.g. "Work", "Birthdays")
  primary?: boolean;
  color?: string;
}

export interface OAuthProvider {
  // Auth
  getAuthUrl(state: string, scopes: string[]): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  refreshAccessToken(refreshToken: string): Promise<RefreshedToken>;

  // Calendar
  listCalendars(token: string): Promise<ProviderCalendar[]>;
  fetchEvents(
    token: string,
    startDate: string,
    endDate: string,
    calendarId?: string,
  ): Promise<CalendarEvent[]>;
  createEvent(token: string, event: CalendarEvent, calendarId?: string): Promise<string>;
  updateEvent(
    token: string,
    providerEventId: string,
    event: CalendarEvent,
    calendarId?: string,
  ): Promise<void>;
  deleteEvent(token: string, providerEventId: string, calendarId?: string): Promise<void>;

  // Email
  fetchEmails(
    token: string,
    folder: string,
    limit: number,
    search?: string,
    previewOnly?: boolean,
  ): Promise<Email[]>;
  getEmailById?(
    token: string,
    emailId: string,
  ): Promise<Email | null>;
  sendEmail(
    token: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<void>;
}

export type OAuthProviderType = 'google' | 'microsoft';
