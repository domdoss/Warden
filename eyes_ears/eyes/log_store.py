"""Oculus log store (sqlite) — lives on the LAPTOP so the Pi doesn't fill up.

The Warden server + Oculus agent run on the Pi; they POST their log writes and
GET their queries here, over the existing 8765 network path that already carries
the frame server. Two tables mirror what used to be store/security.db on the Pi:

  security_log  — Oculus condition assessments (one row per recorded condition)
  awareness_log — one row per AWARENESS event (host auto-log rows have
                  assessment NULL; Oculus verdict rows set assessment)

WAL mode so the detector thread and HTTP handlers writing concurrently don't
block each other. The store is the single source of truth — the Pi holds no
local copy, by design (the one way).
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime
from typing import Any

_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "oculus.db",
)

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS security_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          alert_ts TEXT,
          camera TEXT,
          assessment TEXT,
          condition TEXT,
          person_count INTEGER,
          escalated INTEGER DEFAULT 0,
          tags TEXT,
          data TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_security_log_ts ON security_log(ts);
        CREATE INDEX IF NOT EXISTS idx_security_log_assessment ON security_log(assessment);
        CREATE INDEX IF NOT EXISTS idx_security_log_camera ON security_log(camera);
        CREATE TABLE IF NOT EXISTS awareness_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          event TEXT,
          label TEXT,
          is_known INTEGER,
          seconds_empty REAL,
          assessment TEXT,
          spoken TEXT,
          data TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_awareness_log_ts ON awareness_log(ts);
        CREATE INDEX IF NOT EXISTS idx_awareness_log_event ON awareness_log(event);
        """
    )
    # In-place migrations for older security_log schemas (CREATE TABLE IF NOT
    # EXISTS won't upgrade an existing table). Idempotent.
    have = {r["name"] for r in conn.execute("PRAGMA table_info(security_log)")}
    for col, defn in (
        ("camera", "TEXT"),
        ("person_count", "INTEGER"),
        ("tags", "TEXT"),
        ("data", "TEXT"),
        ("created_at", "TEXT NOT NULL DEFAULT ''"),
    ):
        if col not in have:
            conn.execute(f"ALTER TABLE security_log ADD COLUMN {col} {defn}")
    _conn = conn
    return conn


# ── helpers ──────────────────────────────────────────────────────────────────

_SECURITY_KNOWN = {"action", "alert_ts", "camera", "assessment", "condition",
                   "person_count", "escalated", "tags"}
_AWARENESS_KNOWN = {"action", "ts", "event", "label", "is_known",
                    "seconds_empty", "assessment", "spoken"}


def _parse_ts(ts: str) -> datetime | None:
    """Parse ISO (YYYY-MM-DDTHH:MM:SS) or compact (YYYYMMDDTHHMMSS) local ts."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        pass
    if len(ts) == 15 and ts[8] == "T" and ts[:8].isdigit() and ts[9:].isdigit():
        return datetime.strptime(ts, "%Y%m%dT%H%M%S")
    return None


def _parse_tags(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, list):
        return ",".join(str(x) for x in v)
    if isinstance(v, str):
        return v
    return None


def _now() -> str:
    return datetime.now().isoformat()


def _rowdict(r: sqlite3.Row) -> dict[str, Any]:
    return {k: r[k] for k in r.keys()}


# ── security_log ──────────────────────────────────────────────────────────────

def security_log(args: dict[str, Any]) -> dict[str, Any]:
    action = args.get("action")
    with _lock:
        d = _db()
        if action == "record":
            extras: dict[str, Any] = {}
            for k, v in args.items():
                if k not in _SECURITY_KNOWN and k != "data":
                    extras[k] = v
            if isinstance(args.get("data"), dict):
                extras.update(args["data"])
            ts = args.get("ts") if isinstance(args.get("ts"), str) else _now()
            d.execute(
                "INSERT INTO security_log "
                "(ts, alert_ts, camera, assessment, condition, person_count, "
                " escalated, tags, data, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ts,
                    args.get("alert_ts") if isinstance(args.get("alert_ts"), str) else None,
                    args.get("camera") if isinstance(args.get("camera"), str) else None,
                    args.get("assessment") if isinstance(args.get("assessment"), str) else None,
                    args.get("condition") if isinstance(args.get("condition"), str) else None,
                    args.get("person_count") if isinstance(args.get("person_count"), int) else None,
                    1 if args.get("escalated") else 0,
                    _parse_tags(args.get("tags")),
                    json.dumps(extras) if extras else None,
                    _now(),
                ),
            )
            d.commit()
            return {"ok": True}

        if action == "query":
            since = args.get("since") if isinstance(args.get("since"), str) else None
            until = args.get("until") if isinstance(args.get("until"), str) else None
            assessment = args.get("assessment") if isinstance(args.get("assessment"), str) else None
            camera = args.get("camera") if isinstance(args.get("camera"), str) else None
            limit = min(max(int(args.get("limit") or 50), 1), 1000)
            sql = ("SELECT ts, alert_ts, camera, assessment, condition, "
                   "person_count, escalated, tags, data FROM security_log")
            cond: list[str] = []
            params: list[Any] = []
            if since:
                cond.append("ts >= ?"); params.append(since)
            if until:
                cond.append("ts <= ?"); params.append(until)
            if assessment:
                cond.append("assessment = ?"); params.append(assessment)
            if camera:
                cond.append("camera = ?"); params.append(camera)
            if cond:
                sql += " WHERE " + " AND ".join(cond)
            sql += " ORDER BY ts DESC LIMIT ?"
            params.append(limit)
            rows = d.execute(sql, params).fetchall()
            if not rows:
                return {"ok": True, "summary": "No matching rows.", "rows": []}
            lines = []
            for r in rows:
                tags = f" [{r['tags']}]" if r["tags"] else ""
                ppl = f" {r['person_count']}p" if r["person_count"] is not None else ""
                extra = f" {{{r['data']}}}" if r["data"] else ""
                lines.append(
                    f"[{r['ts']}]{(' ' + r['camera']) if r['camera'] else ''} "
                    f"{r['assessment'] or '?'}{' (escalated)' if r['escalated'] else ''}"
                    f"{ppl}{tags} — {r['condition'] or ''}{extra}"
                )
            return {"ok": True, "summary": f"{len(rows)} row(s):\n" + "\n".join(lines),
                    "rows": [_rowdict(r) for r in rows]}

        if action == "stats":
            since = args.get("since") if isinstance(args.get("since"), str) else None
            where = "WHERE ts >= ?" if since else ""
            params: list[Any] = [since] if since else []
            by = d.execute(
                f"SELECT assessment, COUNT(*) n FROM security_log {where} GROUP BY assessment",
                params,
            ).fetchall()
            total = sum(r["n"] for r in by)
            lines = [f"{r['assessment'] or 'null'}: {r['n']}" for r in by]
            return {"ok": True,
                    "summary": f"{total} record(s){(' since ' + since) if since else ''} — "
                               f"{', '.join(lines) or 'none'}"}

        return {"ok": False, "error": f"unknown action: {action} (use record | query | stats)"}


# ── awareness_log ─────────────────────────────────────────────────────────────

def awareness_log(args: dict[str, Any]) -> dict[str, Any]:
    action = args.get("action")
    with _lock:
        d = _db()
        if action == "record":
            # Oculus verdict rows. Plain insert — no seconds_empty.
            extras: dict[str, Any] = {}
            for k, v in args.items():
                if k not in _AWARENESS_KNOWN and k != "data":
                    extras[k] = v
            if isinstance(args.get("data"), dict):
                extras.update(args["data"])
            ts = args.get("ts") if isinstance(args.get("ts"), str) else _now()
            d.execute(
                "INSERT INTO awareness_log "
                "(ts, event, label, is_known, seconds_empty, assessment, spoken, data, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ts,
                    args.get("event") if isinstance(args.get("event"), str) else None,
                    args.get("label") if isinstance(args.get("label"), str) else None,
                    None if args.get("is_known") is None else (1 if args["is_known"] else 0),
                    args.get("seconds_empty") if isinstance(args.get("seconds_empty"), (int, float)) else None,
                    args.get("assessment") if isinstance(args.get("assessment"), str) else None,
                    args.get("spoken") if isinstance(args.get("spoken"), str) else None,
                    json.dumps(extras) if extras else None,
                    _now(),
                ),
            )
            d.commit()
            return {"ok": True}

        if action == "record_host_event":
            # Host auto-log of a raw AWARENESS event (assessment NULL), with
            # seconds_empty computed here for arrivals (seconds since the last
            # departure row in this store).
            ts = args.get("ts") if isinstance(args.get("ts"), str) else _now()
            event = args.get("event") if isinstance(args.get("event"), str) else None
            label = args.get("label") if isinstance(args.get("label"), str) else None
            is_known = args.get("is_known")
            data = args.get("data") if isinstance(args.get("data"), dict) else {}
            seconds_empty = None
            if event == "arrival":
                row = d.execute(
                    "SELECT ts FROM awareness_log WHERE event = 'departure' "
                    "ORDER BY created_at DESC LIMIT 1"
                ).fetchone()
                if row and row["ts"]:
                    dep = _parse_ts(row["ts"])
                    arr = _parse_ts(ts)
                    if dep and arr:
                        seconds_empty = max(0.0, (arr - dep).total_seconds())
            d.execute(
                "INSERT INTO awareness_log "
                "(ts, event, label, is_known, seconds_empty, assessment, spoken, data, created_at) "
                "VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
                (
                    ts, event, label,
                    None if is_known is None else (1 if is_known else 0),
                    seconds_empty,
                    json.dumps(data) if data else None,
                    _now(),
                ),
            )
            d.commit()
            return {"ok": True}

        if action == "query":
            since = args.get("since") if isinstance(args.get("since"), str) else None
            until = args.get("until") if isinstance(args.get("until"), str) else None
            event = args.get("event") if isinstance(args.get("event"), str) else None
            assessment = args.get("assessment") if isinstance(args.get("assessment"), str) else None
            limit = min(max(int(args.get("limit") or 50), 1), 1000)
            sql = ("SELECT ts, event, label, is_known, seconds_empty, assessment, spoken, data "
                   "FROM awareness_log")
            cond: list[str] = []
            params: list[Any] = []
            if since:
                cond.append("ts >= ?"); params.append(since)
            if until:
                cond.append("ts <= ?"); params.append(until)
            if event:
                cond.append("event = ?"); params.append(event)
            if assessment:
                cond.append("assessment = ?"); params.append(assessment)
            if cond:
                sql += " WHERE " + " AND ".join(cond)
            sql += " ORDER BY ts DESC LIMIT ?"
            params.append(limit)
            rows = d.execute(sql, params).fetchall()
            if not rows:
                return {"ok": True, "summary": "No matching rows.", "rows": []}
            lines = []
            for r in rows:
                who = (f" {r['label']}" if r["label"]
                       else (" known" if r["is_known"] == 1 else
                             (" unknown" if r["is_known"] == 0 else "")))
                empty = f" empty={round(r['seconds_empty'])}s" if r["seconds_empty"] is not None else ""
                said = f' said:"{r["spoken"]}"' if r["spoken"] else ""
                extra = f" {{{r['data']}}}" if r["data"] else ""
                lines.append(f"[{r['ts']}] {r['event'] or '?'}{who}{empty} — "
                             f"{r['assessment'] or '?'}{said}{extra}")
            return {"ok": True, "summary": f"{len(rows)} row(s):\n" + "\n".join(lines),
                    "rows": [_rowdict(r) for r in rows]}

        if action == "stats":
            since = args.get("since") if isinstance(args.get("since"), str) else None
            where = "WHERE ts >= ?" if since else ""
            params: list[Any] = [since] if since else []
            by = d.execute(
                f"SELECT event, COUNT(*) n FROM awareness_log {where} GROUP BY event", params,
            ).fetchall()
            total = sum(r["n"] for r in by)
            lines = [f"{r['event'] or 'null'}: {r['n']}" for r in by]
            return {"ok": True,
                    "summary": f"{total} record(s){(' since ' + since) if since else ''} — "
                               f"{', '.join(lines) or 'none'}"}

        return {"ok": False, "error": f"unknown action: {action} (use record | query | stats)"}


# ── host events + clear ───────────────────────────────────────────────────────

def host_events(limit: int) -> list[dict[str, Any]]:
    n = min(max(1, limit), 1000)
    with _lock:
        rows = _db().execute(
            "SELECT ts, event, label, is_known, seconds_empty, data "
            "FROM awareness_log WHERE assessment IS NULL "
            "ORDER BY created_at DESC LIMIT ?",
            (n,),
        ).fetchall()
    return [_rowdict(r) for r in rows]


def clear() -> dict[str, Any]:
    with _lock:
        d = _db()
        d.execute("DELETE FROM security_log")
        d.execute("DELETE FROM awareness_log")
        d.commit()
    return {"ok": True}