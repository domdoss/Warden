"""Alternative 1-minute price-data sources for the day-trade engine.

The engine has always used Alpaca (free Basic: SIP history + IEX live) with a
Yahoo fallback. This module adds the common paid minute-bar APIs so the engine
can be pointed at any of them instead. Every provider fills the same OHLCV
1-minute frame the engine trains and trades on (ET-indexed), cached per ticker
in its own directory under ``.alpha-stack/daytrade/<source>/`` so switching
sources never mixes one provider's bars with another's.

Credentials come from ``~/.config/alpha-stack/<source>.env`` (one ``KEY=VALUE``
per line, same layout as the existing ``alpaca.env``) or the matching
environment variable:

    polygon.env      POLYGON_API_KEY       https://polygon.io
    tiingo.env       TIINGO_API_KEY        https://tiingo.io
    twelvedata.env   TWELVEDATA_API_KEY    https://twelvedata.com

Each provider's ``bars`` returns OHLCV; VWAP and trade count are stored as NaN
where the API doesn't serve them. The engine recomputes VWAP from OHLCV, so
nothing downstream depends on those two columns.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

ET = ZoneInfo("America/New_York")
ENV_DIR = Path.home() / ".config" / "alpha-stack"
CACHE_ROOT = Path(__file__).resolve().parent.parent / ".alpha-stack" / "daytrade"
COLS = ["Open", "High", "Low", "Close", "Volume"]


def _empty() -> pd.DataFrame:
    """Typed empty frame — an untyped one turns the history to object dtype
    when concatenated onto the cache (np.log then fails)."""
    return pd.DataFrame({c: pd.Series(dtype=float) for c in COLS + ["VWAP", "TradeCount"]},
                        index=pd.DatetimeIndex([], tz=ET))


def _read_env(name: str, var: str) -> str | None:
    val = os.environ.get(var)
    if val:
        return val.strip()
    path = ENV_DIR / name
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            if k.strip() == var:
                return v.strip().strip('"').strip("'")
    return None


def _cached_history(cache_dir: Path, ticker: str, days: int, fetch, cutoff_min: int = 0) -> pd.DataFrame:
    """Incremental per-ticker cache: extend the tail, refetch whole when the
    cache is missing, shallow or stale, and never shrink what's stored. Mirrors
    ``alpaca_data.history`` so every source behaves the same way."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{ticker}.pkl"
    end = datetime.now(timezone.utc) - timedelta(minutes=cutoff_min)
    start = end - timedelta(days=days)
    df = None
    if path.exists():
        # A cache that can't be read is an error, not "no cache": refetching
        # only the requested window would overwrite a deep history with a
        # shallow one.
        df = pd.read_pickle(path)
    if (df is not None and not df.empty and df.index[0] <= start + timedelta(days=5)
            and set(COLS) <= set(df.columns)):
        tail_start = df.index[-1].to_pydatetime() + timedelta(minutes=1)
        if tail_start < end:
            df = pd.concat([df, fetch(ticker, tail_start, end)])
    else:
        deep_from = df.index[0].to_pydatetime() if df is not None and not df.empty else start
        df = fetch(ticker, min(start, deep_from), end)
    for c in ("VWAP", "TradeCount"):
        if c not in df.columns:
            df[c] = np.nan
    full = df[~df.index.duplicated(keep="last")].sort_index().astype(float)
    tmp = path.with_suffix(f".tmp{os.getpid()}")
    full.to_pickle(tmp)
    os.replace(tmp, path)
    return full[full.index >= start.astimezone(ET)]


def _get_json(url: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _frame(bars: list[dict], rename: dict) -> pd.DataFrame:
    if not bars:
        return _empty()
    df = pd.DataFrame(bars)
    df = df.rename(columns=rename)
    for c in COLS:
        if c not in df.columns:
            df[c] = np.nan
    return df[COLS + [c for c in ("VWAP", "TradeCount") if c in df.columns]].astype(float)


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

class _Provider:
    key: str = ""
    label: str = ""
    env_file: str = ""
    env_var: str = ""
    depth_cap: int = 365        # calendar days the API can serve 1m bars back
    cutoff_min: int = 0         # minutes of delay on the most recent bar

    def _key(self) -> str | None:
        return _read_env(self.env_file, self.env_var)

    def available(self) -> bool:
        return self._key() is not None

    @property
    def cache_dir(self) -> Path:
        return CACHE_ROOT / self.key

    def bars(self, ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
        raise NotImplementedError

    def history(self, ticker: str, days: int) -> pd.DataFrame:
        # A training window asks for its own depth (week=7, month=30, …),
        # capped at what this API can actually serve. ``_cached_history``
        # extends the tail or refetches from the cache's own first bar, so the
        # stored frame only ever grows deeper, never shallower.
        return _cached_history(self.cache_dir, ticker, min(days, self.depth_cap), self.bars, self.cutoff_min)

    def cached_depth_days(self, ticker: str) -> int:
        path = self.cache_dir / f"{ticker}.pkl"
        if not path.exists():
            return 0
        first = pd.read_pickle(path).index[0]
        return max(0, (datetime.now(timezone.utc) - first.to_pydatetime()).days - 1)

    def recent(self, tickers: list[str], days: int) -> dict[str, pd.DataFrame]:
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)
        return {t: self.bars(t, start, end) for t in tickers}


class Polygon(_Provider):
    """Polygon.io aggregates — deep, split-adjusted 1m bars with VWAP and
    trade count. Free tier: 2 years, 5 calls/min; paid tiers go deeper."""
    key = "polygon"
    label = "Polygon.io"
    env_file = "polygon.env"
    env_var = "POLYGON_API_KEY"
    depth_cap = 3650
    cutoff_min = 16
    BASE = "https://api.polygon.io/v2/aggs/ticker"

    def bars(self, ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
        key = self._key()
        s = int(start.astimezone(timezone.utc).timestamp() * 1000)
        e = int(end.astimezone(timezone.utc).timestamp() * 1000)
        url = f"{self.BASE}/{ticker}/range/1/minute/{s}/{e}?adjusted=true&sort=asc&limit=50000"
        out: list[dict] = []
        while url:
            d = _get_json(url, {"Authorization": f"Bearer {key}"})
            if d.get("results") is None:
                raise ValueError(f"polygon: {d.get('error', d)}")
            out += d["results"]
            url = d.get("next_url")
        if not out:
            return _empty()
        df = pd.DataFrame(out)
        df.index = pd.to_datetime(df["t"], unit="ms", utc=True).dt.tz_convert(ET)
        return df.rename(columns={"o": "Open", "h": "High", "l": "Low", "c": "Close",
                                  "v": "Volume", "vw": "VWAP", "n": "TradeCount"})[COLS + ["VWAP", "TradeCount"]].astype(float)


class Tiingo(_Provider):
    """Tiingo IEX 1m bars (~5 years deep). No VWAP/trade count; volume is
    IEX-only and may be thin. Free tier: 5 calls/min."""
    key = "tiingo"
    label = "Tiingo"
    env_file = "tiingo.env"
    env_var = "TIINGO_API_KEY"
    depth_cap = 1825
    cutoff_min = 0
    BASE = "https://api.tiingo.com/iex"

    def bars(self, ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
        key = self._key()
        s = start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        e = end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        url = f"{self.BASE}/{ticker}/prices?startDate={s}&endDate={e}&resampleFreq=1min"
        d = _get_json(url, {"Authorization": f"Token {key}"})
        if isinstance(d, dict) and d.get("detail"):
            raise ValueError(f"tiingo: {d['detail']}")
        if not d:
            return _empty()
        df = pd.DataFrame(d)
        df.index = pd.to_datetime(df["date"], utc=True).dt.tz_convert(ET)
        return df.rename(columns={"open": "Open", "high": "High", "low": "Low",
                                  "close": "Close", "volume": "Volume"})[COLS].astype(float)


class TwelveData(_Provider):
    """Twelve Data 1m bars. Generous free tier (8 credits/min); deeper history
    and more symbols on paid plans."""
    key = "twelvedata"
    label = "Twelve Data"
    env_file = "twelvedata.env"
    env_var = "TWELVEDATA_API_KEY"
    depth_cap = 730
    cutoff_min = 0
    BASE = "https://api.twelvedata.com/time_series"

    def bars(self, ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
        key = self._key()
        params = {"symbol": ticker, "interval": "1min", "outputsize": 5000,
                  "start_date": start.astimezone(ET).strftime("%Y-%m-%d %H:%M:%S"),
                  "end_date": end.astimezone(ET).strftime("%Y-%m-%d %H:%M:%S"),
                  "timezone": "America/New_York", "apikey": key}
        out: list[dict] = []
        while True:
            d = _get_json(f"{self.BASE}?{urllib.parse.urlencode(params)}")
            if d.get("status") == "error":
                raise ValueError(f"twelvedata: {d.get('message', d)}")
            out += d.get("values") or []
            nxt = d.get("next_page")
            if not nxt or nxt == params.get("next_page"):
                break
            params["next_page"] = nxt
        if not out:
            return _empty()
        df = pd.DataFrame(out)
        df.index = pd.to_datetime(df["datetime"]).dt.tz_localize(ET)
        return df.rename(columns={"open": "Open", "high": "High", "low": "Low",
                                  "close": "Close", "volume": "Volume"})[COLS].astype(float)


SOURCES: dict[str, _Provider] = {c.key: c() for c in (Polygon, Tiingo, TwelveData)}
DEPTH_CAP = {k: v.depth_cap for k, v in SOURCES.items()}


def available_sources() -> dict[str, bool]:
    """key -> whether its credentials are configured."""
    return {k: v.available() for k, v in SOURCES.items()}


def depth_days(source: str) -> int:
    return DEPTH_CAP.get(source, 365)


def fetch_history(source: str, ticker: str, days: int) -> pd.DataFrame:
    if source not in SOURCES:
        raise ValueError(f"unknown data source {source!r}")
    return SOURCES[source].history(ticker, days)


def fetch_recent(source: str, tickers: list[str], days: int) -> dict[str, pd.DataFrame]:
    if source not in SOURCES:
        raise ValueError(f"unknown data source {source!r}")
    return SOURCES[source].recent(tickers, days)
