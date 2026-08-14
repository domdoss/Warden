import { logger } from './logger.js';
import { getSatelliteIp } from './db.js';

// Oculus's log store lives on the LAPTOP (the eyes frame server, port 8765),
// NOT on the Pi — so awareness/security logs don't fill up the Pi's SD card.
// The Warden server + Oculus agent run on the Pi and reach the store over the
// network: every record/query is an HTTP call to http://<satellite>:8765/log/*.
// There is no local copy and no fallback — the laptop store is the one way.
//
// Two tables live there (mirrored from the old Pi-side store/security.db):
//   security_log  — condition assessments (record/query/stats)
//   awareness_log — one row per AWARENESS event. Host auto-log rows have
//                   assessment NULL; Oculus verdict rows set assessment.
// recordAwarenessEvent parses the raw AWARENESS text and asks the laptop to
// record the host event row (the laptop computes seconds_empty for arrivals
// from its own last-departure row).

const LOG_TIMEOUT = 15000;

function logUrl(path: string): string {
  return `http://${getSatelliteIp()}:8765${path}`;
}

async function logPost(path: string, body: any): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOG_TIMEOUT);
  try {
    const res = await fetch(logUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return data;
  } catch (err: any) {
    logger.warn({ err }, `oculus log POST ${path}: laptop store unreachable`);
    return { ok: false, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function securityLog(args: any): Promise<{ ok: boolean; summary?: string; error?: string; rows?: any[] }> {
  return logPost('/log/security', args);
}

export async function awarenessLog(args: any): Promise<{ ok: boolean; summary?: string; error?: string; rows?: any[] }> {
  return logPost('/log/awareness', args);
}

/** Recent host AWARENESS event rows (assessment IS NULL — the rows the host
 *  auto-logged, not Oculus's verdict rows), newest insertion first. Ordered by
 *  created_at (not ts) so a mix of compact and ISO ts strings doesn't break the
 *  ordering. Served by the laptop store. */
export async function queryAwarenessHostEvents(limit: number): Promise<any[]> {
  const n = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOG_TIMEOUT);
  try {
    const res = await fetch(logUrl(`/log/host-events?limit=${n}`), {
      signal: controller.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) { logger.warn({ status: res.status }, 'queryAwarenessHostEvents: laptop store unreachable'); return []; }
    return Array.isArray(data?.rows) ? data.rows : [];
  } catch (err: any) {
    logger.warn({ err }, 'queryAwarenessHostEvents: laptop store unreachable');
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Host-side auto-log: parse an incoming AWARENESS text and record the raw event
 *  to the laptop awareness_log, INDEPENDENT of the Oculus agent — so an event is
 *  always recorded even if Oculus crashes, loops, or skips its tool. The laptop
 *  computes seconds_empty for arrivals from its own last-departure row.
 *
 *  assessment is left null on purpose: that's the discriminator between host
 *  event rows (this function) and Oculus's verdict rows (which set assessment).
 *  The dashboard Oculus feed filters on assessment IS NULL for a clean feed.
 *
 *  Never throws. */
export async function recordAwarenessEvent(awarenessText: string): Promise<void> {
  try {
    const m = awarenessText.match(/^AWARENESS\s+—\s+(\w+)\s+at\s+(\S+)\.\s+data:\s+(\{.*\})/);
    if (!m) return;
    const event = m[1];
    const compactTs = m[2];
    let data: any = {};
    try { data = JSON.parse(m[3]); } catch { /* leave empty */ }

    // Convert the detector's compact local ts YYYYMMDDTHHMMSS -> ISO
    // YYYY-MM-DDTHH:MM:SS so every row is string-comparable for ORDER BY ts.
    const iso =
      compactTs.length === 15 && /^\d{8}T\d{6}$/.test(compactTs)
        ? `${compactTs.slice(0, 4)}-${compactTs.slice(4, 6)}-${compactTs.slice(6, 8)}T${compactTs.slice(9, 11)}:${compactTs.slice(11, 13)}:${compactTs.slice(13, 15)}`
        : compactTs;

    const label = typeof data.label === 'string' ? data.label : undefined;
    const is_known = typeof data.is_known === 'boolean' ? data.is_known : undefined;

    await logPost('/log/awareness', {
      action: 'record_host_event',
      ts: iso,
      event,
      label,
      is_known,
      data,
    });
  } catch (err: any) {
    logger.error({ err }, 'recordAwarenessEvent: failed');
  }
}

/** Clear all Oculus logs (both tables) on the laptop store. Backs the
 *  dashboard "Clear logs" button. */
export async function clearOculusLogs(): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOG_TIMEOUT);
  try {
    const res = await fetch(logUrl('/log'), { method: 'DELETE', signal: controller.signal });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    logger.warn({ err }, 'clearOculusLogs: laptop store unreachable');
    return { ok: false, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}