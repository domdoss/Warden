/**
 * Stateless CalDAV client for the local Radicale hub.
 *
 * No stored state, no cache, no etag column. Every tool call is a live HTTP
 * request to 127.0.0.1:5232. Etags are used per-request only (If-Match on
 * update, If-None-Match on create) so concurrent edits are safe; Radicale
 * owns conflict handling server-side.
 *
 * Collection layout (provisioned in KONTACT_PLAN Stage 0):
 *   /cal/   VCALENDAR collection holding VEVENT and VTODO objects
 *   /card/  vCard collection (see carddav.ts)
 *
 * Config (env, all optional — defaults are the localhost Radicale install):
 *   RADICALE_URL            default http://127.0.0.1:5232
 *   RADICALE_CAL_COLLECTION default /cal/
 *   RADICALE_USER / RADICALE_PASS  optional basic auth (future)
 */

import { generateICS, generateVTodo, parseCalendar, type ICalEvent, type ICalTodo } from '../ical.js';

const RADICALE_URL = (process.env.RADICALE_URL || 'http://127.0.0.1:5232').replace(/\/+$/, '');
const CAL_COLLECTION = process.env.RADICALE_CAL_COLLECTION || '/cal/';
const RADICALE_USER = process.env.RADICALE_USER || '';
const RADICALE_PASS = process.env.RADICALE_PASS || '';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function authHeader(): Record<string, string> {
  if (!RADICALE_USER) return {};
  const token = Buffer.from(`${RADICALE_USER}:${RADICALE_PASS}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

async function davRequest(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const url = RADICALE_URL + (path.startsWith('/') ? path : '/' + path);
  const res = await fetch(url, {
    method,
    headers: { ...authHeader(), ...(opts.headers || {}) },
    body: opts.body,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const body = await res.text();
  return { status: res.status, headers, body };
}

// ---------------------------------------------------------------------------
// Tolerant multistatus XML parsing (no XML dep — strip namespaces, regex by
// local element name, unescape entities in embedded calendar-data text).
// ---------------------------------------------------------------------------

function stripNs(tag: string): string {
  const i = tag.indexOf(':');
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

interface CalDavObject {
  href: string;     // e.g. /cal/jarvis-evt-123.ics
  etag: string;     // quoted string
  ical: string;     // the VCALENDAR body
}

function parseMultiStatus(xml: string): CalDavObject[] {
  const out: CalDavObject[] = [];
  // Split on <response> blocks (any namespace prefix).
  const respRe = /<(?:[A-Za-z0-9]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = respRe.exec(xml)) !== null) {
    const block = m[1];
    const href = matchTag(block, 'href');
    const etag = matchTag(block, 'getetag');
    const icalRaw = matchTag(block, 'calendar-data');
    if (!href) continue;
    out.push({
      href,
      etag: etag || '',
      ical: icalRaw ? unescapeXml(icalRaw) : '',
    });
  }
  return out;
}

function matchTag(block: string, localName: string): string | undefined {
  // Match <prefix?:localName ...>content</prefix?:localName>, capturing content.
  const re = new RegExp(
    `<(?:[A-Za-z0-9]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${localName}>`,
    'i',
  );
  const m = re.exec(block);
  return m ? m[1].trim() : undefined;
}

// ---------------------------------------------------------------------------
// Object href helpers
// ---------------------------------------------------------------------------

function objectPath(uid: string, ext: 'ics'): string {
  // Radicale stores each object at <collection>/<uid>.<ext>
  const base = CAL_COLLECTION.endsWith('/') ? CAL_COLLECTION : CAL_COLLECTION + '/';
  return `${base}${uid}.${ext}`;
}

// ---------------------------------------------------------------------------
// Public API — events
// ---------------------------------------------------------------------------

export interface CalDavEvent extends ICalEvent {
  etag?: string;
  href?: string;
}

// Radicale only returns calendar-data through a REPORT calendar-query; a
// PROPFIND asking for it yields 404 propstats with empty bodies.
async function calendarQuery(): Promise<CalDavObject[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"/></C:filter>
</C:calendar-query>`;
  const { status, body: xml } = await davRequest('REPORT', CAL_COLLECTION, {
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });
  if (status >= 400) throw new Error(`CalDAV REPORT failed: ${status}`);
  return parseMultiStatus(xml);
}

export async function listEvents(start?: string, end?: string): Promise<CalDavEvent[]> {
  const objs = await calendarQuery();
  const events: CalDavEvent[] = [];
  for (const o of objs) {
    if (!o.ical) continue;
    const { events: parsed } = parseCalendar(o.ical);
    for (const e of parsed) {
      events.push({ ...e, etag: o.etag, href: o.href });
    }
  }
  return filterByRange(events, start, end);
}

export async function getEvent(uid: string): Promise<CalDavEvent | null> {
  const { status, body, headers } = await davRequest('GET', objectPath(uid, 'ics'));
  if (status === 404) return null;
  if (status >= 400) throw new Error(`CalDAV GET failed: ${status}`);
  const { events } = parseCalendar(body);
  if (!events.length) return null;
  return { ...events[0], etag: headers.etag, href: objectPath(uid, 'ics') };
}

export async function upsertEvent(ev: ICalEvent, etag?: string): Promise<{ ok: true; uid: string; etag: string } | { ok: false; error: string }> {
  const path = objectPath(ev.uid, 'ics');
  const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' };
  if (etag) headers['If-Match'] = etag;
  else headers['If-None-Match'] = '*';
  const { status, body, headers: rh } = await davRequest('PUT', path, {
    headers,
    body: generateICS([ev]),
  });
  if (status >= 400) return { ok: false, error: `PUT ${status}: ${body.slice(0, 300)}` };
  return { ok: true, uid: ev.uid, etag: rh.etag || '' };
}

export async function deleteEvent(uid: string, etag?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const headers: Record<string, string> = {};
  if (etag) headers['If-Match'] = etag;
  const { status, body } = await davRequest('DELETE', objectPath(uid, 'ics'), { headers });
  if (status === 404) return { ok: true };
  if (status >= 400) return { ok: false, error: `DELETE ${status}: ${body.slice(0, 300)}` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public API — todos (same /cal/ collection, VTODO components)
// ---------------------------------------------------------------------------

export interface CalDavTodo extends ICalTodo {
  etag?: string;
  href?: string;
}

export async function listTodos(): Promise<CalDavTodo[]> {
  const objs = await calendarQuery();
  const todos: CalDavTodo[] = [];
  for (const o of objs) {
    if (!o.ical) continue;
    const { todos: parsed } = parseCalendar(o.ical);
    for (const t of parsed) {
      todos.push({ ...t, etag: o.etag, href: o.href });
    }
  }
  return todos;
}

export async function upsertTodo(todo: ICalTodo, etag?: string): Promise<{ ok: true; uid: string; etag: string } | { ok: false; error: string }> {
  const path = objectPath(todo.uid, 'ics');
  const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' };
  if (etag) headers['If-Match'] = etag;
  else headers['If-None-Match'] = '*';
  const { status, body, headers: rh } = await davRequest('PUT', path, {
    headers,
    body: generateVTodo(todo),
  });
  if (status >= 400) return { ok: false, error: `PUT ${status}: ${body.slice(0, 300)}` };
  return { ok: true, uid: todo.uid, etag: rh.etag || '' };
}

export async function deleteTodo(uid: string, etag?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return deleteEvent(uid, etag);
}

// ---------------------------------------------------------------------------
// Range filtering (client-side; single-user scale, event counts are modest)
// ---------------------------------------------------------------------------

function filterByRange<T extends { start?: string; dtstart?: string }>(items: T[], start?: string, end?: string): T[] {
  if (!start && !end) return items;
  const s = start ? new Date(start).getTime() : -Infinity;
  const e = end ? new Date(end).getTime() : Infinity;
  return items.filter((it) => {
    const v = it.start || it.dtstart;
    if (!v) return true; // keep items with no time — let the agent see them
    const t = new Date(v).getTime();
    return t >= s && t <= e;
  });
}

// ---------------------------------------------------------------------------
// Collection provisioning helper (Stage 0 sanity check / lazy create)
// ---------------------------------------------------------------------------

export async function ensureCalCollection(): Promise<boolean> {
  // MKCOL is idempotent-ish: 201 created, 405 already exists. Both fine.
  const { status } = await davRequest('MKCOL', CAL_COLLECTION);
  return status === 201 || status === 405 || status === 301;
}