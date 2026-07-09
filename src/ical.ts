/**
 * iCal (.ics) generation and parsing — no external dependencies.
 *
 * Supports VCALENDAR containers holding VEVENT and VTODO components, with
 * DTSTART/DTEND/DUE/COMPLETED, SUMMARY, DESCRIPTION, LOCATION, UID, STATUS,
 * PRIORITY, RRULE, and all-day events.
 *
 * Timezone handling (mandatory — see the 2026-07-02 dexter hour-off bug):
 * every parsed datetime is normalized at the parse boundary to a naive local
 * ISO string in the system timezone (e.g. `2026-07-02T09:00:00`, no `Z`), the
 * format dexter/scheduler already use. Three input forms are handled:
 *
 *   - `DTSTART;TZID=America/Vancouver:20260702T090000`  (zoned wall time)
 *   - `DTSTART:20260702T170000Z`                        (UTC, Z-suffixed)
 *   - `DTSTART:20260702T090000`                          (floating — viewer-local)
 *
 * All three normalize to the same local wall instant so the agent and the
 * scheduler agree on when something happens. Emitters serialize naive local
 * ISO back to UTC-with-Z for wire transport, so round-tripping is lossless.
 */

export interface ICalEvent {
  uid: string;
  title: string;
  description?: string;
  start: string; // naive local ISO, e.g. 2026-07-02T09:00:00 (or YYYY-MM-DD for all-day)
  end?: string;
  allDay?: boolean;
  location?: string;
  recurrence?: string; // RRULE string
}

export type TodoStatus = 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED';

export interface ICalTodo {
  uid: string;
  summary: string;
  description?: string;
  status?: TodoStatus;
  priority?: number; // 1 (highest) .. 9 (lowest), 0 = unset
  due?: string; // naive local ISO
  dtstart?: string; // naive local ISO
  completed?: string; // naive local ISO
  relatedTo?: string; // RELATED-TO UID — used by the project→VTODO projection
}

// ---------------------------------------------------------------------------
// Timezone helpers (Intl-only, no deps)
// ---------------------------------------------------------------------------

// System timezone for normalization. Honor TZ env (dexter/scheduler read the
// same value), fall back to the runtime's resolved zone.
const SYSTEM_TZ: string =
  process.env.TZ ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  'America/Vancouver';

const PARTS_FMT = (tz: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Convert a wall-clock time in `tzid` to a UTC epoch ms. Two iterations handle
 *  DST-transition edge cases where the naive guess and the answer sit on
 * opposite sides of a DST jump. */
function zonedToUtcMs(
  y: number, mo: number, d: number, h: number, mi: number, s: number,
  tzid: string,
): number {
  const fmt = PARTS_FMT(tzid);
  const targetWall = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = targetWall;
  for (let i = 0; i < 2; i++) {
    const p = fmt.formatToParts(new Date(utc));
    const gp = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
    const wallAsUtc = Date.UTC(
      +gp('year'), +gp('month') - 1, +gp('day'),
      (+gp('hour')) % 24, +gp('minute'), +gp('second'),
    );
    const offset = utc - wallAsUtc;
    utc = targetWall + offset;
  }
  return utc;
}

/** Format a UTC epoch ms as a naive local ISO in SYSTEM_TZ. */
function toLocalIso(utcMs: number): string {
  const p = PARTS_FMT(SYSTEM_TZ).formatToParts(new Date(utcMs));
  const gp = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return `${gp('year')}-${gp('month')}-${gp('day')}T${gp('hour')}:${gp('minute')}:${gp('second')}`;
}

/** Resolve the system timezone (exported for tests + diagnostics). */
export function systemTimezone(): string {
  return SYSTEM_TZ;
}

// ---------------------------------------------------------------------------
// Property line parsing
// ---------------------------------------------------------------------------

interface ICalProp {
  name: string; // uppercased property name, e.g. DTSTART
  params: Record<string, string>; // e.g. { TZID: 'America/Vancouver', VALUE: 'DATE' }
  value: string;
}

function parsePropLine(line: string): ICalProp | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) return null;
  const keyPart = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segs = keyPart.split(';');
  const name = segs[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i].indexOf('=');
    if (eq < 0) continue;
    params[segs[i].slice(0, eq).toUpperCase()] = segs[i].slice(eq + 1);
  }
  return { name, params, value };
}

// ---------------------------------------------------------------------------
// Date conversion (parse boundary normalization)
// ---------------------------------------------------------------------------

interface ParsedDate {
  date: string; // naive local ISO, or YYYY-MM-DD for all-day
  allDay: boolean;
}

function fromICalDate(value: string, params: Record<string, string>): ParsedDate {
  // All-day: YYYYMMDD (8 chars), or explicit VALUE=DATE
  if (value.length === 8 || params.VALUE?.toUpperCase() === 'DATE') {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return { date: `${y}-${m}-${d}`, allDay: true };
  }
  // Full datetime: YYYYMMDDTHHMMSS[Z]
  const y = +value.slice(0, 4);
  const mo = +value.slice(4, 6);
  const d = +value.slice(6, 8);
  const h = +value.slice(9, 11);
  const mi = +value.slice(11, 13);
  const s = +value.slice(13, 15) ? +value.slice(13, 15) : 0;

  let utcMs: number;
  if (value.endsWith('Z')) {
    utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  } else if (params.TZID) {
    utcMs = zonedToUtcMs(y, mo, d, h, mi, s, params.TZID);
  } else {
    // Floating: interpret as viewer-local (SYSTEM_TZ)
    utcMs = zonedToUtcMs(y, mo, d, h, mi, s, SYSTEM_TZ);
  }
  return { date: toLocalIso(utcMs), allDay: false };
}

/** Serialize a naive local ISO (or YYYY-MM-DD) to an iCal UTC-with-Z datetime,
 *  or YYYYMMDD for all-day. Emitters always emit UTC Z so KOrganizer/Radicale
 *  get an unambiguous instant. */
function toICalDate(localIso: string, allDay?: boolean): string {
  if (allDay) {
    // localIso may be YYYY-MM-DD or YYYY-MM-DDT00:00:00
    const d = new Date(localIso.length >= 10 ? localIso.slice(0, 10) + 'T00:00:00' : localIso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  const d = new Date(localIso); // naive local -> interpreted as local
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// ---------------------------------------------------------------------------
// Text escaping + line folding
// ---------------------------------------------------------------------------

function foldLine(line: string): string {
  const parts: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    parts.push(remaining.slice(0, 75));
    remaining = ' ' + remaining.slice(75);
  }
  parts.push(remaining);
  return parts.join('\r\n');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function unescapeText(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

export function generateICS(events: ICalEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prometheus//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${ev.uid}`));
    lines.push(foldLine(`SUMMARY:${escapeText(ev.title)}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`));
    if (ev.location) lines.push(foldLine(`LOCATION:${escapeText(ev.location)}`));

    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toICalDate(ev.start, true)}`);
      if (ev.end) lines.push(`DTEND;VALUE=DATE:${toICalDate(ev.end, true)}`);
    } else {
      lines.push(`DTSTART:${toICalDate(ev.start)}`);
      if (ev.end) lines.push(`DTEND:${toICalDate(ev.end)}`);
    }

    if (ev.recurrence) lines.push(`RRULE:${ev.recurrence}`);
    lines.push(`DTSTAMP:${toICalDate(new Date().toISOString())}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Todo emission
// ---------------------------------------------------------------------------

export function generateVTodo(todo: ICalTodo): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prometheus//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTODO',
  ];
  lines.push(foldLine(`UID:${todo.uid}`));
  lines.push(foldLine(`SUMMARY:${escapeText(todo.summary)}`));
  if (todo.description) lines.push(foldLine(`DESCRIPTION:${escapeText(todo.description)}`));
  if (todo.status) lines.push(`STATUS:${todo.status}`);
  if (todo.priority != null && todo.priority > 0) lines.push(`PRIORITY:${todo.priority}`);
  if (todo.dtstart) lines.push(`DTSTART:${toICalDate(todo.dtstart)}`);
  if (todo.due) lines.push(`DUE:${toICalDate(todo.due)}`);
  if (todo.completed) lines.push(`COMPLETED:${toICalDate(todo.completed)}`);
  if (todo.relatedTo) lines.push(foldLine(`RELATED-TO:${escapeText(todo.relatedTo)}`));
  lines.push(`DTSTAMP:${toICalDate(new Date().toISOString())}`);
  lines.push('END:VTODO');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function unfoldLines(raw: string): string[] {
  const unfolded = raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  return unfolded.split(/\r?\n/).filter((l) => l.length > 0);
}

export interface ParsedCalendar {
  events: ICalEvent[];
  todos: ICalTodo[];
}

function randUid(prefix: string): string {
  // Date.now/Math.random are fine here — parsing only, not run inside the
  // workflow-script sandbox.
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseCalendar(icsString: string): ParsedCalendar {
  const lines = unfoldLines(icsString);
  const events: ICalEvent[] = [];
  const todos: ICalTodo[] = [];

  let ev: Partial<ICalEvent> | null = null;
  let todo: Partial<ICalTodo> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      ev = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (ev && ev.title && ev.start) {
        events.push({
          uid: ev.uid || randUid('evt'),
          title: ev.title,
          description: ev.description,
          start: ev.start,
          end: ev.end,
          allDay: ev.allDay,
          location: ev.location,
          recurrence: ev.recurrence,
        });
      }
      ev = null;
      continue;
    }
    if (line === 'BEGIN:VTODO') {
      todo = {};
      continue;
    }
    if (line === 'END:VTODO') {
      if (todo && todo.summary) {
        todos.push({
          uid: todo.uid || randUid('todo'),
          summary: todo.summary,
          description: todo.description,
          status: todo.status,
          priority: todo.priority,
          due: todo.due,
          dtstart: todo.dtstart,
          completed: todo.completed,
          relatedTo: todo.relatedTo,
        });
      }
      todo = null;
      continue;
    }
    if (!ev && !todo) continue;

    const prop = parsePropLine(line);
    if (!prop) continue;

    if (ev) applyEventProp(ev, prop);
    else if (todo) applyTodoProp(todo, prop);
  }

  return { events, todos };
}

function applyEventProp(ev: Partial<ICalEvent>, prop: ICalProp): void {
  switch (prop.name) {
    case 'SUMMARY': ev.title = unescapeText(prop.value); break;
    case 'DESCRIPTION': ev.description = unescapeText(prop.value); break;
    case 'LOCATION': ev.location = unescapeText(prop.value); break;
    case 'UID': ev.uid = prop.value; break;
    case 'RRULE': ev.recurrence = prop.value; break;
    case 'DTSTART': {
      const p = fromICalDate(prop.value, prop.params);
      ev.start = p.date; ev.allDay = p.allDay; break;
    }
    case 'DTEND': {
      const p = fromICalDate(prop.value, prop.params);
      ev.end = p.date; break;
    }
  }
}

function applyTodoProp(todo: Partial<ICalTodo>, prop: ICalProp): void {
  switch (prop.name) {
    case 'SUMMARY': todo.summary = unescapeText(prop.value); break;
    case 'DESCRIPTION': todo.description = unescapeText(prop.value); break;
    case 'UID': todo.uid = prop.value; break;
    case 'STATUS': {
      const s = prop.value.toUpperCase();
      if (s === 'NEEDS-ACTION' || s === 'IN-PROCESS' || s === 'COMPLETED' || s === 'CANCELLED') {
        todo.status = s;
      }
      break;
    }
    case 'PRIORITY': todo.priority = parseInt(prop.value, 10) || 0; break;
    case 'DTSTART': todo.dtstart = fromICalDate(prop.value, prop.params).date; break;
    case 'DUE': todo.due = fromICalDate(prop.value, prop.params).date; break;
    case 'COMPLETED': todo.completed = fromICalDate(prop.value, prop.params).date; break;
    case 'RELATED-TO': todo.relatedTo = prop.value; break;
  }
}

/** Backward-compatible events-only parser. */
export function parseICS(icsString: string): ICalEvent[] {
  return parseCalendar(icsString).events;
}