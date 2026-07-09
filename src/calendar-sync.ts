/**
 * Calendar sync module for Prometheus.
 * Pulls calendar events from OAuth providers (Google, Microsoft) and pushes
 * local events back. Background poller runs every 15 minutes.
 */
import Database from 'better-sqlite3';
import path from 'path';

import { STORE_DIR } from './config.js';
import {
  type CalendarEvent as DbCalendarEvent,
  type OAuthAccount,
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  getOAuthAccount,
  getOAuthAccountsWithCalendar,
  listCalendarEvents,
  updateCalendarEvent,
  updateOAuthAccount,
} from './db.js';
import { logger } from './logger.js';
import { ensureFreshToken, getProviderInstance } from './oauth.js';
import type {
  CalendarEvent as ProviderCalendarEvent,
  OAuthProviderType,
} from './providers/types.js';

// ---------------------------------------------------------------------------
// Direct DB access for fields not covered by updateCalendarEvent
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null;

function getRawDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.join(STORE_DIR, 'messages.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  return _db;
}

/**
 * Set ical_uid on a calendar event. updateCalendarEvent doesn't include
 * ical_uid in its allowed fields, so we write it directly.
 */
function setIcalUid(eventId: string, icalUid: string): void {
  getRawDb()
    .prepare(
      'UPDATE calendar_events SET ical_uid = ?, updated_at = ? WHERE id = ?',
    )
    .run(icalUid, new Date().toISOString(), eventId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map provider name to the calendar_source value stored in calendar_events.
 * Google uses 'google', Microsoft uses 'outlook' per the spec.
 */
function calendarSourceForProvider(provider: string): string {
  return provider === 'microsoft' ? 'outlook' : provider;
}

/**
 * Convert a db CalendarEvent row to the provider CalendarEvent format.
 */
function dbEventToProviderEvent(row: DbCalendarEvent): ProviderCalendarEvent {
  return {
    title: row.title,
    description: row.description || undefined,
    startTime: row.start_time,
    endTime: row.end_time || row.start_time,
    allDay: row.all_day === 1,
    location: row.location || undefined,
    icalUid: row.ical_uid || undefined,
  };
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * Pull calendar events from an OAuth account's provider into calendar_events.
 *
 * 1. Loads the oauth_accounts row
 * 2. Refreshes the access token if needed
 * 3. Fetches events from provider (now - 7d to now + 30d)
 * 4. Matches by ical_uid: insert new, update changed, remove disappeared
 * 5. Updates last_calendar_sync timestamp
 */
export async function pullCalendarEvents(
  accountId: string,
): Promise<{ inserted: number; updated: number; removed: number }> {
  const account = getOAuthAccount(accountId);
  if (!account) {
    throw new Error(`OAuth account not found: ${accountId}`);
  }

  const token = await ensureFreshToken(accountId);
  const provider = getProviderInstance(account.provider as OAuthProviderType);
  const source = calendarSourceForProvider(account.provider);

  // Sync window: 7 days back, 30 days forward
  const now = new Date();
  const startDate = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const endDate = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Fetch all provider calendars and iterate each one
  let providerCalendars: Array<{ id: string; name: string }> = [];
  try {
    const cals = await provider.listCalendars(token);
    providerCalendars = cals.map(c => ({ id: c.id, name: c.name }));
  } catch (err) {
    // If listing fails, fall back to pulling from default calendar
    logger.warn({ err, accountId }, 'Failed to list provider calendars, using default');
    providerCalendars = [{ id: '', name: 'Default' }];
  }

  // Load existing events from this provider for this user
  const allUserEvents = listCalendarEvents({ assigned_to: account.user_id });
  const existingEvents = allUserEvents.filter(
    (e) => e.calendar_source === source,
  );

  // Index existing events by ical_uid for fast lookup
  const existingByUid = new Map<string, DbCalendarEvent>();
  for (const evt of existingEvents) {
    if (evt.ical_uid) {
      existingByUid.set(evt.ical_uid, evt);
    }
  }

  const seenUids = new Set<string>();
  let inserted = 0;
  let updated = 0;

  for (const cal of providerCalendars) {
    let remoteEvents;
    try {
      remoteEvents = await provider.fetchEvents(token, startDate, endDate, cal.id || undefined);
    } catch (err) {
      logger.warn({ err, accountId, calendarId: cal.id, calendarName: cal.name }, 'Failed to fetch events for calendar, skipping');
      continue;
    }

    for (const remote of remoteEvents) {
      const uid = remote.icalUid || remote.providerEventId;
      if (!uid) continue;

      seenUids.add(uid);
      const existing = existingByUid.get(uid);

      if (!existing) {
        createCalendarEvent({
          title: remote.title,
          description: remote.description,
          start_time: remote.startTime,
          end_time: remote.endTime || undefined,
          all_day: remote.allDay,
          location: remote.location,
          calendar_source: source,
          ical_uid: uid,
          assigned_to: account.user_id,
          provider_calendar_id: cal.id,
          provider_calendar_name: cal.name,
        });
        inserted++;
      } else {
        const lastSync = account.last_calendar_sync;
        const localModifiedAfterSync =
          lastSync && existing.updated_at > lastSync;

        if (!localModifiedAfterSync) {
          updateCalendarEvent(existing.id, {
            title: remote.title,
            description: remote.description || '',
            start_time: remote.startTime,
            end_time: remote.endTime || null,
            all_day: remote.allDay ? 1 : 0,
            location: remote.location || '',
            provider_calendar_id: cal.id,
            provider_calendar_name: cal.name,
            calendar_source: source,
          });
          updated++;
        }
      }
    }
  }

  // Remove events that disappeared from the provider's response
  let removed = 0;
  for (const existing of existingEvents) {
    if (existing.ical_uid && !seenUids.has(existing.ical_uid)) {
      deleteCalendarEvent(existing.id);
      removed++;
    }
  }

  // Update last_calendar_sync timestamp
  updateOAuthAccount(accountId, {
    last_calendar_sync: new Date().toISOString(),
  });

  return { inserted, updated, removed };
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Push local calendar events to the connected provider.
 *
 * 1. Loads the oauth_accounts row, refreshes token
 * 2. If eventIds === 'all_local': loads all local events for the user
 * 3. For each event: update if ical_uid exists, otherwise create
 * 4. Stores the returned provider ID as ical_uid, updates calendar_source
 */
export async function pushCalendarEvents(
  accountId: string,
  eventIds: string[] | 'all_local',
): Promise<{ pushed: number; errors: number }> {
  const account = getOAuthAccount(accountId);
  if (!account) {
    throw new Error(`OAuth account not found: ${accountId}`);
  }

  const token = await ensureFreshToken(accountId);
  const provider = getProviderInstance(account.provider as OAuthProviderType);
  const source = calendarSourceForProvider(account.provider);

  let events: DbCalendarEvent[];

  if (eventIds === 'all_local') {
    // listCalendarEvents doesn't filter by calendar_source, so filter in code
    const allUserEvents = listCalendarEvents({ assigned_to: account.user_id });
    events = allUserEvents.filter((e) => e.calendar_source === 'local');
  } else {
    events = [];
    for (const id of eventIds) {
      const evt = getCalendarEvent(id);
      if (evt) events.push(evt);
    }
  }

  let pushed = 0;
  let errors = 0;

  for (const evt of events) {
    try {
      const providerEvent = dbEventToProviderEvent(evt);

      if (evt.ical_uid) {
        // Previously pushed -- update on provider
        await provider.updateEvent(token, evt.ical_uid, providerEvent);
        // Update calendar_source if it was still 'local'
        if (evt.calendar_source === 'local') {
          updateCalendarEvent(evt.id, { calendar_source: source });
        }
      } else {
        // New push -- create on provider, store the returned ID as ical_uid
        const providerEventId = await provider.createEvent(
          token,
          providerEvent,
        );
        // Store the provider event ID and update source
        setIcalUid(evt.id, providerEventId);
        updateCalendarEvent(evt.id, { calendar_source: source });
      }

      pushed++;
    } catch (err) {
      errors++;
      logger.error(
        {
          eventId: evt.id,
          accountId,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to push calendar event to provider',
      );
    }
  }

  return { pushed, errors };
}

// ---------------------------------------------------------------------------
// Combined sync
// ---------------------------------------------------------------------------

/**
 * Convenience function: pulls events, then optionally pushes if eventIds provided.
 */
export async function syncCalendar(
  accountId: string,
  eventIds?: string[] | 'all_local',
): Promise<{
  pull: { inserted: number; updated: number; removed: number };
  push?: { pushed: number; errors: number };
}> {
  const pull = await pullCalendarEvents(accountId);

  let push: { pushed: number; errors: number } | undefined;
  if (eventIds) {
    push = await pushCalendarEvents(accountId, eventIds);
  }

  return { pull, push };
}

// ---------------------------------------------------------------------------
// Background poller
// ---------------------------------------------------------------------------

const CALENDAR_SYNC_INTERVAL = 900_000; // 15 minutes

let pollerRunning = false;

/**
 * Start the background calendar sync poller. Every 15 minutes, iterates all
 * oauth_accounts where calendar_enabled = 1 AND enabled = 1, pulling events
 * for each. Follows the same error handling pattern as task-scheduler.ts:
 * errors are logged but never crash the loop.
 */
export function startCalendarSyncPoller(): void {
  if (pollerRunning) {
    logger.debug(
      'Calendar sync poller already running, skipping duplicate start',
    );
    return;
  }
  pollerRunning = true;
  logger.info('Calendar sync poller started');

  const loop = async () => {
    try {
      const accounts = getOAuthAccountsWithCalendar();

      if (accounts.length > 0) {
        logger.debug(
          { count: accounts.length },
          'Running calendar sync for enabled accounts',
        );
      }

      for (const account of accounts) {
        try {
          const result = await pullCalendarEvents(account.id);
          if (
            result.inserted > 0 ||
            result.updated > 0 ||
            result.removed > 0
          ) {
            logger.info(
              {
                accountId: account.id,
                provider: account.provider,
                ...result,
              },
              'Calendar sync completed',
            );
          }
        } catch (err) {
          logger.error(
            {
              err,
              accountId: account.id,
              provider: account.provider,
            },
            'Calendar sync failed for account',
          );
          // Continue to next account
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in calendar sync poller');
    }

    setTimeout(loop, CALENDAR_SYNC_INTERVAL);
  };

  loop();
}

/** @internal -- for tests only. */
export function _resetCalendarSyncPollerForTests(): void {
  pollerRunning = false;
}
