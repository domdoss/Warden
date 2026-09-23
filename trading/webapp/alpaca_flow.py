#!/usr/bin/env python3
"""NBBO quote + trade backfill for flow-based features (free Basic plan).

Historical SIP quotes (>=15 min old) and IEX trades are free on the Basic
plan, just like the SIP bars ``alpaca_data`` fetches. Quotes (feed=sip)
carry the NBBO (bp/bs/ap/as); trades (feed=iex) carry the prints (p, s).
Both are collected per ticker/session and saved as parquet under
.alpha-stack/daytrade/flow/{TICKER}_{feed}_{YYYYMMDD}.parquet — one file
per ticker/feed/session, so an interrupted backfill resumes at file
granularity (existing files are skipped, never re-read).

Request shape: each session is walked in 5-minute windows (the quote
stream is far too dense for one request per day), paginating every window
to exhaustion. Pacing targets ~160 req/min sustained (the free plan
allows ~200/minute; measured 2026-09-22: ~0.55s transfer+parse per
request + 0.55s sleep per worker, 3 workers). On HTTP 429 the fleet
drops to ~120 req/min for 5 minutes (shared flag file), then returns to
the fast lane, and progress is appended to logs/flow_backfill.log.

CLI:
    python alpaca_flow.py AAPL 2                 # last 2 sessions, 1 worker
    python alpaca_flow.py ALL 100 3              # all 10 engine tickers, 3 workers
    python alpaca_flow.py --catchup              # recent missing sessions (timer)
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import alpaca_data  # noqa: E402

ET = alpaca_data.ET
FLOW_DIR = alpaca_data.CACHE_DIR.parent / "flow"
LOG_PATH = Path(__file__).resolve().parent.parent / "logs" / "flow_backfill.log"
# The 10 day-trade engine tickers (Alpha Stack portfolio + SPY watchlist).
ENGINE_TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
# Quote/trade columns kept on disk. Timestamps are int64 epoch-ns (compact,
# tz-free); prices/sizes are float64 as the API returns them.
QUOTE_COLS = ("bp", "bs", "ap", "as")
TRADE_COLS = ("p", "s")
WINDOW = timedelta(minutes=5)
# Backfill depth is capped at 100 sessions per ticker (~7 GB for all 10):
# that matches the fold depth the other validators use. The daily timer
# below keeps it growing forward, not backward.
BACKFILL_SESSIONS = 100
CATCHUP_SESSIONS = 20           # missed days pulled the next time the PC is on
REQUEST_SLEEP = 0.55           # fast lane: 3 workers x (sleep + ~0.55s transfer) ~= 160 req/min
SLOW_SLEEP = 0.95              # throttle lane: ~= 120 req/min across the 3 workers
BACKOFF_SLEEP = 60.0            # HTTP 429: wait, then re-issue the same request
THROTTLE_S = 300.0              # after a 429 the whole fleet runs slow for 5 min
THROTTLE_PATH = FLOW_DIR / ".throttle"   # shared flag file across worker processes


def _log(msg: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(ET).strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(f"{stamp} {msg}\n")


def _throttled() -> bool:
    """True while the shared 429 flag (written by any worker) is live."""
    try:
        return time.time() < float(THROTTLE_PATH.read_text().strip() or 0)
    except (OSError, ValueError):
        return False


def _throttle_all() -> None:
    """One 429 anywhere: the whole fleet drops to ~120 req/min for 5
    minutes, then returns to the fast lane."""
    try:
        FLOW_DIR.mkdir(parents=True, exist_ok=True)
        THROTTLE_PATH.write_text(str(time.time() + THROTTLE_S))
    except OSError:
        pass


def _get(path: str, params: dict) -> dict:
    """One API request with the protocol-required 429 backoff; otherwise
    errors propagate and kill the backfill (visible, not masked)."""
    key, secret = alpaca_data._creds()
    url = f"{alpaca_data.DATA_URL}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": key,
                                                "APCA-API-SECRET-KEY": secret})
    while True:
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            _log(f"429 rate-limited on {path} {params.get('start','')}..{params.get('end','')}"
                 f" — backing off {BACKOFF_SLEEP:.0f}s, fleet slow for {THROTTLE_S:.0f}s")
            _throttle_all()
            time.sleep(BACKOFF_SLEEP)


def _window_rows(kind: str, ticker: str, start: datetime, end: datetime,
                 stats: dict) -> pd.DataFrame:
    """All rows in [start, end) for one feed, paginated. ``stats`` is
    incremented per request."""
    feed = "sip" if kind == "quotes" else "iex"
    params = {"start": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
              "end": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
              "feed": feed, "limit": 10000}
    out: list[dict] = []
    while True:
        stats["requests"] += 1
        time.sleep(SLOW_SLEEP if _throttled() else REQUEST_SLEEP)
        d = _get(f"{ticker}/{kind}", params)
        out += d.get(kind) or []
        token = d.get("next_page_token")
        if not token:
            break
        params["page_token"] = token
    if not out:
        return pd.DataFrame()
    df = pd.DataFrame(out)
    cols = list(QUOTE_COLS if kind == "quotes" else TRADE_COLS)
    df["t"] = pd.to_datetime(df["t"], utc=True).astype("int64")
    df[cols] = df[cols].astype(float)
    return df[["t"] + cols].rename(columns={"t": "ts"})


def _session(kind: str, ticker: str, day, stats: dict) -> pd.DataFrame:
    """One ticker/session of quotes or trades: 09:30-16:00 ET in 5-min
    windows."""
    t0 = datetime(day.year, day.month, day.day, 9, 30, tzinfo=ET)
    parts = []
    while t0 < t0.replace(hour=16, minute=0):
        part = _window_rows(kind, ticker, t0, t0 + WINDOW, stats)
        if not part.empty:
            parts.append(part)
        t0 += WINDOW
    return pd.concat(parts) if parts else pd.DataFrame()


def _path(ticker: str, kind: str, day) -> Path:
    feed = "sip" if kind == "quotes" else "iex"
    return FLOW_DIR / f"{ticker}_{feed}_{day:%Y%m%d}.parquet"


def backfill_day(ticker: str, day) -> dict:
    """Both feeds for one ticker/session; returns per-file stats."""
    out = {}
    for kind in ("quotes", "trades"):
        path = _path(ticker, kind, day)
        if path.exists():
            out[kind] = {"skipped": True, "requests": 0,
                         "bytes": path.stat().st_size, "rows": None}
            continue
        stats = {"requests": 0}
        df = _session(kind, ticker, day, stats)
        FLOW_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        df.to_parquet(tmp, index=False)
        os.replace(tmp, path)
        out[kind] = {"skipped": False, "requests": stats["requests"],
                     "bytes": path.stat().st_size, "rows": len(df)}
    return out


def session_days(count: int) -> list:
    """The ``count`` most recent completed US-equity sessions, most recent
    first, from the SPY bar calendar (SPY trades every session the targets
    do). history() tail-extends the SPY cache first, so the calendar is
    current even when this runs from the daily timer after days off.
    Today's session is excluded unless it is fully over AND past the free
    plan's 15-minute SIP delay — a partial session is not a session."""
    df = alpaca_data.history("SPY", 400)
    now = datetime.now(ET)
    today = now.date()
    cutoff_ok = now.hour > 16 or (now.hour == 16 and now.minute >= 20)
    days = sorted({d for d in df.index.date if d < today or cutoff_ok}, reverse=True)
    return days[:count]


def backfill(tickers: list[str], sessions: int, tag: str = "") -> None:
    days = session_days(sessions)
    _log(f"backfill start{tag} tickers={tickers} sessions={sessions} "
         f"({days[-1]} .. {days[0]})")
    # Day-major: every ticker's history grows evenly, so the per-day
    # walk-forward validation gets usable breadth early.
    for i, day in enumerate(days, 1):
        for t in tickers:
            st = backfill_day(t, day)
            q, tr = st["quotes"], st["trades"]
            if q.get("skipped") and tr.get("skipped"):
                _log(f"{t} {day:%Y-%m-%d} [{i}/{len(days)}] skipped (done)")
                continue
            _log(f"{t} {day:%Y-%m-%d} [{i}/{len(days)}] "
                 f"quotes={q.get('rows')} rows {q.get('requests')} req "
                 f"{q.get('bytes', 0) / 1e6:.1f} MB | "
                 f"trades={tr.get('rows')} rows {tr.get('requests')} req "
                 f"{tr.get('bytes', 0) / 1e6:.1f} MB")
    _log(f"backfill done tickers={tickers}")


def backfill_parallel(tickers: list[str], sessions: int, workers: int) -> None:
    """N worker processes over disjoint ticker chunks. One process per
    chunk keeps the total request rate near workers x 53/min ~= 160/min
    (sleep 0.55s + ~0.55s transfer/parse per request); the shared-flag
    429 throttle in _get covers the rest."""
    import multiprocessing

    chunks = [tickers[i::workers] for i in range(workers)]
    procs = []
    for chunk in chunks:
        p = multiprocessing.Process(target=backfill,
                                    args=(chunk, sessions, f" worker={chunk[0]}.."))
        p.start()
        procs.append(p)
    for p in procs:
        p.join()
    _log(f"backfill done all tickers={tickers} sessions={sessions} workers={workers}")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--catchup":
        backfill(ENGINE_TICKERS, CATCHUP_SESSIONS, " catchup")
        return
    spec = sys.argv[1].upper()
    tickers = ENGINE_TICKERS if spec == "ALL" else [t.strip().upper() for t in spec.split(",")]
    sessions = int(sys.argv[2])
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    if workers > 1:
        backfill_parallel(tickers, sessions, workers)
    else:
        backfill(tickers, sessions)


if __name__ == "__main__":
    main()