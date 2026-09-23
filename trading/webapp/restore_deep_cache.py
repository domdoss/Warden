"""Restore a truncated deep (multi-year) 1-min cache: fetch the missing older
span, paced so it shares the free plan's 200 req/min with the running flow
backfill (~160/min), and merge it under the existing newer bars.

    ./bin/python webapp/restore_deep_cache.py AAPL NVDA
"""
import os
import sys
import time
from datetime import datetime, timezone

import pandas as pd

import alpaca_data as ad

FROM = datetime(2021, 9, 1, tzinfo=timezone.utc)
PAGE_SLEEP_S = 3.0          # ≈20 req/min


def fetch_paced(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    params = {"timeframe": "1Min", "start": start.isoformat().replace("+00:00", "Z"),
              "end": end.isoformat().replace("+00:00", "Z"),
              "feed": "sip", "adjustment": "all", "limit": 10000, "sort": "asc"}
    out, pages = [], 0
    while True:
        d = ad._get(f"{ticker}/bars", params)
        out += d.get("bars") or []
        pages += 1
        token = d.get("next_page_token")
        if pages % 10 == 0:
            print(f"{ticker}: {pages} pages, {len(out)} bars", flush=True)
        if not token:
            break
        params["page_token"] = token
        time.sleep(PAGE_SLEEP_S)
    return ad._frame(out)


for t in sys.argv[1:]:
    path = ad.CACHE_DIR / f"{t}.pkl"
    cur = pd.read_pickle(path)
    if cur.index[0] <= pd.Timestamp(FROM).tz_convert(ad.ET) + pd.Timedelta(days=5):
        print(f"{t}: already deep from {cur.index[0].date()} — skipped", flush=True)
        continue
    old = fetch_paced(t, FROM, cur.index[0].to_pydatetime().astimezone(timezone.utc))
    full = pd.concat([old, cur])
    full = full[~full.index.duplicated(keep="last")].sort_index().astype(float)
    tmp = path.with_suffix(f".tmp{os.getpid()}")
    full.to_pickle(tmp)
    os.replace(tmp, path)
    print(f"{t}: restored {len(full)} bars {full.index[0].date()} .. {full.index[-1].date()} "
          f"(columns {list(full.columns)})", flush=True)
print("DONE restore", flush=True)
