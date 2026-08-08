import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

/**
 * A shared pool of short findings any agent (Atlas, mostly) drops in via the
 * `add_digest_note` tool. Iris's digest reads notes relevant to its cadence
 * and folds them in — "Atlas gathers, Iris synthesizes."
 *
 * Lifecycle model — each note carries its own expiry + target cadence:
 *   - `spans`: which digests the note is relevant to (default all three). A
 *     "game today" note targets just `['hourly']` so it never pollutes the
 *     weekly roundup.
 *   - `expires_at`: when the note stops being relevant. A note WITH an
 *     expiry is "live" — it shows in every targeted digest until it expires
 *     (a game-today reminder repeats each hour until the game ends), then is
 *     purged. A note WITHOUT an expiry is a one-shot snapshot — delivered to
 *     each target span exactly once, then purged once all targets consumed.
 *   - Safety net: anything older than MAX_AGE is purged regardless.
 *
 * Stored as JSON next to summaries.json (DATA_DIR/digest_notes.json).
 */
export interface DigestNote {
  text: string;
  source?: string;
  ts: string; // created (ISO)
  expires_at?: string; // when to drop (ISO); absent = one-shot
  spans?: string[]; // target cadences; absent = all
  delivered?: string[]; // one-shot: which spans have already folded it in
}

const FILE = path.join(DATA_DIR, 'digest_notes.json');
const MAX_AGE_MS = 7 * 24 * 3600_000; // safety net only
const ALL_SPANS = ['hourly', 'daily', 'weekly'];

function load(): DigestNote[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save(notes: DigestNote[]): void {
  try {
    fs.writeFileSync(FILE, JSON.stringify(notes, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err }, 'Failed to write digest_notes.json');
  }
}

function isExpired(n: DigestNote, now = Date.now()): boolean {
  return !!n.expires_at && now >= new Date(n.expires_at).getTime();
}

function targetSpans(n: DigestNote): string[] {
  return n.spans && n.spans.length ? n.spans : ALL_SPANS;
}

/** One-shot notes are purged once every target span has delivered them. */
function fullyConsumed(n: DigestNote): boolean {
  if (n.expires_at) return false; // live notes purge on expiry, not delivery
  const delivered = n.delivered ?? [];
  return targetSpans(n).every((s) => delivered.includes(s));
}

export interface AddNoteOpts {
  expires_at?: string;
  ttl_minutes?: number;
  spans?: string[];
}

export function addDigestNote(text: string, source = '', opts: AddNoteOpts = {}): DigestNote {
  let expires_at = opts.expires_at;
  if (!expires_at && opts.ttl_minutes) {
    expires_at = new Date(Date.now() + opts.ttl_minutes * 60_000).toISOString();
  }
  // Sanitize spans to known cadences.
  let spans = opts.spans;
  if (spans) spans = spans.filter((s) => ALL_SPANS.includes(s));
  const note: DigestNote = {
    text,
    source: source || undefined,
    ts: new Date().toISOString(),
    expires_at: expires_at || undefined,
    spans: spans && spans.length ? spans : undefined,
  };
  const notes = load();
  notes.push(note);
  // Drop already-expired / over-MAX_AGE on write (cheap cleanup).
  const now = Date.now();
  const kept = notes.filter((n) => now - new Date(n.ts).getTime() < MAX_AGE_MS && !isExpired(n, now));
  save(kept);
  return note;
}

/**
 * Return notes this span should include now, and update state. Reads + writes
 * in one pass so a one-shot note is delivered to a span exactly once:
 *   - Live note (has expires_at, not expired): included every call until it
 *     expires — so a game-today reminder repeats each hourly.
 *   - One-shot note (no expires_at): included once per target span, then
 *     marked delivered.
 * Purges expired, fully-consumed, and over-MAX_AGE notes.
 */
export function getDigestNotesForSpan(span: string, sinceMs: number): DigestNote[] {
  const notes = load();
  const now = Date.now();
  const cutoff = now - sinceMs;
  const toDeliver: DigestNote[] = [];
  for (const n of notes) {
    if (!targetSpans(n).includes(span)) continue; // not relevant to this cadence
    if (isExpired(n, now)) continue; // handled by purge below
    const live = !!n.expires_at; // live notes repeat until expiry
    if (!live && new Date(n.ts).getTime() < cutoff) continue; // one-shot: freshness window
    const delivered = n.delivered ?? (n.delivered = []);
    if (live) {
      toDeliver.push(n);
      if (!delivered.includes(span)) delivered.push(span);
    } else if (!delivered.includes(span)) {
      delivered.push(span);
      toDeliver.push(n);
    }
  }
  const kept = notes.filter((n) =>
    now - new Date(n.ts).getTime() < MAX_AGE_MS &&
    !isExpired(n, now) &&
    !fullyConsumed(n),
  );
  save(kept);
  return toDeliver;
}