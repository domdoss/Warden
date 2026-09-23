#!/usr/bin/env python3
"""Pull multi-year Alpaca SIP 1m history for the 10 engine tickers.

Extends each ticker's cache (.alpha-stack/daytrade/alpaca/{T}.pkl) back to
2021-09-01, or as deep as the API serves. Writes the SAME format the live
engine path expects (Open/High/Low/Close/Volume/VWAP/TradeCount, tz-aware
ET index, extended-hours bars included; daytrade filters to the session at
use). The whole range is fetched in ONE pass with adjustment=all, so every
bar — old and new — is on the same split-adjusted basis (no mixed-basis
frames). Polite: ~0.4s pacing between page requests, and the one allowed
retry shape — waiting out the API's own 429 backoff.

Per ticker it logs a JSON line: served depth, rows, sessions, and split
sanity (largest overnight close-to-close move; a missed split adjustment
shows up as a multi-x jump there).

Usage: scripts/pull_deep_history.py [--start 2021-09-01] [--tickers A,B,...]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, "/opt/Warden/trading/webapp")
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import alpaca_data  # noqa: E402

ET = ZoneInfo("America/New_York")
DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
PAGE_LIMIT = 10000
PACE_S = 0.4


def fetch_all(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Every 1m SIP bar in [start, end), all pages, paced; 429 waits out the
    API's own backoff (the one retry shape the protocol allows)."""
    key, secret = alpaca_data._creds()
    params = {"timeframe": "1Min",
              "start": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
              "end": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
              "feed": "sip", "adjustment": "all", "limit": PAGE_LIMIT, "sort": "asc"}
    out: list[dict] = []
    pages = 0
    while True:
        url = f"{alpaca_data.DATA_URL}/{ticker}/bars?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": key,
                                                   "APCA-API-SECRET-KEY": secret})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                d = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                wait = float(exc.headers.get("Retry-After") or 5.0)
                wait = max(wait, 5.0)
                print(json.dumps({"ticker": ticker, "note": f"429, waiting {wait:.0f}s"}), flush=True)
                time.sleep(wait)
                continue
            raise
        out += d.get("bars") or []
        pages += 1
        params["page_token"] = d.get("next_page_token")
        if not params["page_token"]:
            break
        time.sleep(PACE_S)
    print(json.dumps({"ticker": ticker, "pages": pages, "bars_fetched": len(out)}), flush=True)
    return alpaca_data._frame(out)


def split_sanity(df: pd.DataFrame) -> dict:
    """Largest overnight close-to-close move between consecutive sessions; a
    split inside an unadjusted frame shows up as a multi-x ratio there."""
    closes = df.groupby(np.array(df.index.date))["Close"].last()
    r = closes / closes.shift(1)
    worst = r.dropna().abs().sub(1).idxmax() if len(r.dropna()) else None
    flagged = [d.isoformat() for d, x in r.dropna().items() if x > 1.5 or x < 0.667]
    return {"max_overnight_move_pct": round(float(r.dropna().abs().sub(1).max() * 100), 2) if len(r.dropna()) else None,
            "worst_session": worst.isoformat() if worst else None,
            "jump_flagged_sessions": flagged}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2021-09-01")
    ap.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    args = ap.parse_args()
    start = datetime.fromisoformat(args.start).replace(tzinfo=ET)
    end = datetime.now(timezone.utc) - timedelta(minutes=16)

    for t in [x.strip().upper() for x in args.tickers.split(",") if x.strip()]:
        t0 = time.time()
        path = alpaca_data.CACHE_DIR / f"{t}.pkl"
        old = None
        if path.exists():
            try:
                old = pd.read_pickle(path)
            except Exception:
                old = None
        df = fetch_all(t, start, end)
        df = df[~df.index.duplicated(keep="last")].sort_index().astype(float)
        if df.empty:
            print(json.dumps({"ticker": t, "error": "API returned no bars"}), flush=True)
            continue
        tmp = path.with_suffix(".tmp")
        df.to_pickle(tmp)
        import os
        os.replace(tmp, path)
        sess = sorted(set(df.index.date))
        print(json.dumps({"ticker": t, "served_from": sess[0].isoformat(),
                          "served_through": sess[-1].isoformat(),
                          "served_depth_days": (sess[-1] - sess[0]).days,
                          "rows": int(len(df)), "sessions": len(sess),
                          "old_cache_from": old.index[0].date().isoformat() if old is not None and len(old) else None,
                          "split_sanity": split_sanity(df),
                          "seconds": round(time.time() - t0, 1)}), flush=True)
    print("DONE pull-deep-history", flush=True)


if __name__ == "__main__":
    main()