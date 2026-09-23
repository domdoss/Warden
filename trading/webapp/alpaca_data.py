"""Alpaca market data for the day-trading engine (free Basic plan).

- History: full-market SIP 1-minute bars, split/dividend adjusted. Free on
  Basic for anything older than 15 minutes; years deep. Cached per ticker on
  disk and extended incrementally, so each ticker downloads its history once.
- Live: the IEX feed — the one real-time feed the free plan includes.
  Prices track the full market closely for liquid names; IEX carries a small
  share of volume, so live volume is thinner than the SIP history's.

Credentials come from ~/.config/alpha-stack/alpaca.env (APCA_API_KEY_ID,
APCA_API_SECRET_KEY). Without that file ``available()`` is False and the
engine keeps using Yahoo.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

ET = ZoneInfo("America/New_York")
ENV_FILE = Path.home() / ".config" / "alpha-stack" / "alpaca.env"
DATA_URL = "https://data.alpaca.markets/v2/stocks"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".alpha-stack" / "daytrade" / "alpaca"
COLS = {"o": "Open", "h": "High", "l": "Low", "c": "Close", "v": "Volume",
        "vw": "VWAP", "n": "TradeCount"}


def _creds() -> tuple[str, str] | None:
    key, secret = os.environ.get("APCA_API_KEY_ID"), os.environ.get("APCA_API_SECRET_KEY")
    if not (key and secret) and ENV_FILE.exists():
        vals = {}
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
        key, secret = vals.get("APCA_API_KEY_ID"), vals.get("APCA_API_SECRET_KEY")
    return (key, secret) if key and secret else None


def available() -> bool:
    return _creds() is not None


def _get(path: str, params: dict) -> dict:
    key, secret = _creds()
    url = f"{DATA_URL}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _frame(bars: list[dict]) -> pd.DataFrame:
    if not bars:
        # Typed empty frame: an untyped one turns the whole history to object
        # dtype when concatenated onto the cache (np.log then fails).
        return pd.DataFrame({c: pd.Series(dtype=float) for c in COLS.values()},
                            index=pd.DatetimeIndex([], tz=ET))
    df = pd.DataFrame(bars)
    df.index = pd.to_datetime(df["t"], utc=True).dt.tz_convert(ET)
    df.index.name = None
    return df.rename(columns=COLS)[list(COLS.values())].astype(float)


def bars(ticker: str, start: datetime, end: datetime, feed: str = "sip") -> pd.DataFrame:
    """1-minute bars in [start, end), all pages."""
    params = {"timeframe": "1Min", "start": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
              "end": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
              "feed": feed, "adjustment": "all", "limit": 10000, "sort": "asc"}
    out: list[dict] = []
    while True:
        d = _get(f"{ticker}/bars", params)
        out += d.get("bars") or []
        token = d.get("next_page_token")
        if not token:
            break
        params["page_token"] = token
    return _frame(out)


def history(ticker: str, days: int) -> pd.DataFrame:
    """SIP 1m bars for the last ``days`` calendar days, ending 16 minutes ago
    (the free plan's SIP cut-off). Cached; only the missing tail is fetched."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{ticker}.pkl"
    end = datetime.now(timezone.utc) - timedelta(minutes=16)
    start = end - timedelta(days=days)
    df = None
    if path.exists():
        # A cache that can't be read is an error, not "no cache": treating it
        # as absent refetched only the requested window and overwrote a
        # multi-year research history with one year (AAPL/NVDA, 2026-09-22).
        df = pd.read_pickle(path)
    # A cached history is extended forward; one that doesn't reach back far
    # enough is refetched whole. A cache from before the free bar fields
    # (VWAP, TradeCount) were kept lacks their columns — it is stale the
    # same way and refetched whole. A split between pulls leaves the older
    # cached bars on the old basis — delete the ticker's .pkl to refetch it
    # adjusted.
    if (df is not None and not df.empty and df.index[0] <= start + timedelta(days=5)
            and all(c in df.columns for c in ("VWAP", "TradeCount"))):
        # Only ask for the tail when there is one: a cache already past the
        # SIP cut-off would request an empty/inverted range (Alpaca → 400).
        tail_start = df.index[-1].to_pydatetime() + timedelta(minutes=1)
        if tail_start < end:
            df = pd.concat([df, bars(ticker, tail_start, end)])
    else:
        # Refetch whole — from the requested start, or from the cache's own
        # first bar if it already reaches deeper, so a refetch never makes
        # the stored history shallower than it was.
        deep_from = df.index[0].to_pydatetime() if df is not None and not df.empty else start
        df = bars(ticker, min(start, deep_from), end)
    # The cache on disk is never shrunk: a pull that went deep (multi-year
    # research history) stays deep, and a later shallower request returns its
    # window without cutting the stored frame back down. Callers only consume
    # the returned frame, so the live path's data is exactly what it was.
    full = df[~df.index.duplicated(keep="last")].sort_index().astype(float)
    # The tmp name carries the pid: parallel backfill workers all extend
    # the SPY calendar at boot, and a shared tmp name made worker B's
    # os.replace move the file out from under worker A (FileNotFoundError).
    tmp = path.with_suffix(f".tmp{os.getpid()}")
    full.to_pickle(tmp)
    os.replace(tmp, path)
    return full[full.index >= start.astimezone(ET)]


def cached_depth_days(ticker: str) -> int:
    """How many calendar days of history the ticker's cache already holds
    (0 = no cache). Lets long training windows use deep caches without
    triggering a multi-year download for tickers that don't have one."""
    path = CACHE_DIR / f"{ticker}.pkl"
    if not path.exists():
        return 0
    first = pd.read_pickle(path).index[0]
    return max(0, (datetime.now(timezone.utc) - first.to_pydatetime()).days - 1)


def recent(tickers: list[str], days: int = 1) -> dict[str, pd.DataFrame]:
    """Real-time IEX 1m bars covering the last ``days`` calendar days."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    return {t: bars(t, start, end, feed="iex") for t in tickers}
