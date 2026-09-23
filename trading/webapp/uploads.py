"""Manual price-data upload for the day-trade engine.

Accepts almost any table of price bars and merges it into the same 1-minute
cache the engine trains and replays on (alpaca_data.CACHE_DIR/<TICKER>.pkl).

Formats: CSV / TSV / any-delimiter text, Excel (.xlsx .xlsm .xls .ods), JSON
(records, columns, {"bars": [...]}, {"<TICKER>": [...]}, JSON lines),
Parquet / Feather / Arrow, HTML tables, and .zip .gz .bz2 .xz .zst archives
holding any of those. Pickles are refused (they can run code).

Columns are matched case-insensitively with many aliases; time can be one
datetime column, separate date + time columns, epoch s/ms/us/ns, or the
index. Naive times are read in the chosen timezone (default New York). The
ticker comes from a column (multi-ticker files are split), the caller, or
the filename. Close-only data gets open/high/low = close; missing volume = 0.

1-minute bars merge into the engine cache (existing bars win on overlap
unless ``overwrite``); any other interval is kept in uploads/ and reported,
because the engine trades 1-minute bars.
"""

from __future__ import annotations

import bz2
import gzip
import io
import json
import lzma
import os
import re
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

import alpaca_data

ET = ZoneInfo("America/New_York")
UPLOAD_DIR = alpaca_data.CACHE_DIR.parent / "uploads"
LOG = UPLOAD_DIR / "upload_log.jsonl"
COLS = ["Open", "High", "Low", "Close", "Volume"]

ALIASES = {
    "Open": ["open", "o", "opening", "openprice", "open_price", "first", "openingprice"],
    "High": ["high", "h", "max", "highprice", "high_price", "hi"],
    "Low": ["low", "l", "min", "lowprice", "low_price", "lo"],
    "Close": ["close", "c", "closeprice", "close_price", "last", "lastprice", "last_price", "price",
              "adjclose", "adj_close", "adjustedclose", "closelast", "settle", "mid", "value"],
    "Volume": ["volume", "v", "vol", "qty", "quantity", "size", "shares", "totalvolume", "tickvolume"],
    "VWAP": ["vwap", "vw", "averageprice", "avgprice"],
    "TradeCount": ["tradecount", "n", "trades", "numtrades", "transactions", "count"],
}
TIME_ALIASES = ["timestamp", "datetime", "date_time", "time_stamp", "t", "ts", "time", "date", "dt",
                "datetimeutc", "timeutc", "localtime", "gmt time", "bar_time", "start", "begins_at"]
DATE_ONLY = ["date", "day", "tradedate", "trade_date", "session"]
TIME_ONLY = ["time", "clock", "hhmm", "minute"]
TICKER_ALIASES = ["ticker", "symbol", "sym", "code", "instrument", "stock", "security", "asset", "name"]
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9_ ]", "", str(s).strip().lower()).replace(" ", "")


# ---------------------------------------------------------------------------
# Reading: bytes -> list of (name, DataFrame)
# ---------------------------------------------------------------------------

def _decompress(name: str, data: bytes) -> list[tuple[str, bytes]]:
    low = name.lower()
    if low.endswith((".xlsx", ".xlsm", ".ods", ".xltx")):
        return [(name, data)]            # zip-based office files: read as spreadsheets, not archives
    if data[:4] == b"PK\x03\x04" or low.endswith(".zip"):
        out = []
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                if not info.is_dir() and not info.filename.startswith("__MACOSX"):
                    out += _decompress(info.filename, z.read(info))
        return out
    if data[:2] == b"\x1f\x8b" or low.endswith(".gz"):
        return _decompress(re.sub(r"\.gz$", "", name, flags=re.I), gzip.decompress(data))
    if data[:3] == b"BZh" or low.endswith(".bz2"):
        return _decompress(re.sub(r"\.bz2$", "", name, flags=re.I), bz2.decompress(data))
    if data[:6] == b"\xfd7zXZ\x00" or low.endswith(".xz"):
        return _decompress(re.sub(r"\.xz$", "", name, flags=re.I), lzma.decompress(data))
    if data[:4] == b"\x28\xb5\x2f\xfd" or low.endswith(".zst"):
        import zstandard
        return _decompress(re.sub(r"\.zst$", "", name, flags=re.I),
                           zstandard.ZstdDecompressor().decompress(data, max_output_size=2 << 30))
    return [(name, data)]


def _read_text_table(data: bytes) -> pd.DataFrame:
    text = data.decode("utf-8-sig", errors="replace")
    sample = "\n".join(text.splitlines()[:50])
    import csv
    try:
        sep = csv.Sniffer().sniff(sample, delimiters=",;\t| ").delimiter
    except csv.Error:
        sep = None
    df = pd.read_csv(io.StringIO(text), sep=sep, engine="python", skipinitialspace=True)
    # yfinance-style exports: 2–3 header rows ("Price/Ticker/Date").
    first = str(df.columns[0]).strip().lower()
    if first in ("price", "ticker") and len(df) > 2:
        head = df.iloc[:2].astype(str)
        tick = [v for v in head.iloc[0].tolist()[1:] if v and v.lower() != "nan"]
        df = df.iloc[2:].reset_index(drop=True)
        df.columns = ["Date"] + list(df.columns[1:])
        if tick and len(set(tick)) == 1 and TICKER_RE.match(tick[0].upper()):
            df["__ticker"] = tick[0].upper()
    return df


def _read_json(data: bytes) -> list[pd.DataFrame]:
    text = data.decode("utf-8-sig", errors="replace").strip()
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return [pd.read_json(io.StringIO(text), lines=True)]
    if isinstance(obj, list):
        return [pd.DataFrame(obj)]
    if isinstance(obj, dict):
        if isinstance(obj.get("bars"), list):
            return [pd.DataFrame(obj["bars"]).assign(__ticker=obj.get("symbol"))]
        if isinstance(obj.get("bars"), dict):          # {"bars": {"AAPL": [...]}}
            return [pd.DataFrame(v).assign(__ticker=k) for k, v in obj["bars"].items()]
        lists = {k: v for k, v in obj.items() if isinstance(v, list) and v and isinstance(v[0], dict)}
        if lists and all(TICKER_RE.match(str(k).upper()) for k in lists):
            return [pd.DataFrame(v).assign(__ticker=str(k).upper()) for k, v in lists.items()]
        for key in ("data", "results", "candles", "values", "prices", "items", "records"):
            if isinstance(obj.get(key), list):
                return [pd.DataFrame(obj[key]).assign(__ticker=obj.get("ticker") or obj.get("symbol"))]
        return [pd.DataFrame(obj)]                     # columnar {"open": [...], ...}
    raise ValueError("JSON is neither a list nor an object of bars")


def read_any(name: str, data: bytes) -> list[tuple[str, pd.DataFrame]]:
    out: list[tuple[str, pd.DataFrame]] = []
    for fname, blob in _decompress(name, data):
        low = fname.lower()
        if low.endswith((".pkl", ".pickle")):
            raise ValueError(f"{fname}: pickle files are refused (they can run code) — export as CSV or Parquet")
        if low.endswith((".xlsx", ".xlsm", ".xls", ".ods")) or blob[:4] == b"\xd0\xcf\x11\xe0":
            sheets = pd.read_excel(io.BytesIO(blob), sheet_name=None)
            out += [(f"{fname}:{s}", df) for s, df in sheets.items() if not df.empty]
        elif low.endswith((".parquet", ".pq")) or blob[:4] == b"PAR1":
            out.append((fname, pd.read_parquet(io.BytesIO(blob))))
        elif low.endswith((".feather", ".arrow", ".ipc")) or blob[:6] == b"ARROW1":
            out.append((fname, pd.read_feather(io.BytesIO(blob))))
        elif low.endswith((".json", ".jsonl", ".ndjson")) or blob.lstrip()[:1] in (b"{", b"["):
            out += [(fname, df) for df in _read_json(blob)]
        elif low.endswith((".html", ".htm")) or b"<table" in blob[:5000].lower():
            out += [(f"{fname}#{i}", df) for i, df in enumerate(pd.read_html(io.BytesIO(blob)))]
        else:
            out.append((fname, _read_text_table(blob)))
    return out


# ---------------------------------------------------------------------------
# Normalizing: any table -> {ticker: OHLCV frame on an ET DatetimeIndex}
# ---------------------------------------------------------------------------

def _find(cols: dict, names: list[str]) -> str | None:
    for n in names:
        if n in cols:
            return cols[n]
    return None


def _parse_time(s: pd.Series, tz: ZoneInfo) -> pd.DatetimeIndex:
    if pd.api.types.is_numeric_dtype(s):
        v = pd.to_numeric(s, errors="coerce")
        mx = float(np.nanmax(np.abs(v.values))) if len(v) else 0
        unit = "ns" if mx > 1e17 else "us" if mx > 1e14 else "ms" if mx > 1e11 else "s"
        return pd.DatetimeIndex(pd.to_datetime(v, unit=unit, utc=True)).tz_convert(ET)
    t = pd.to_datetime(s, errors="coerce", utc=False, format="mixed")
    if getattr(t.dt, "tz", None) is None:
        t = t.dt.tz_localize(tz, ambiguous="NaT", nonexistent="shift_forward")
    return pd.DatetimeIndex(t).tz_convert(ET)


def normalize(df: pd.DataFrame, tz: ZoneInfo, ticker_hint: str | None) -> dict[str, pd.DataFrame]:
    df = df.copy()
    if not isinstance(df.index, pd.RangeIndex):
        df = df.reset_index()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = ["_".join(str(x) for x in c if str(x) != "") for c in df.columns]
    cols = {_norm(c): c for c in df.columns}
    # time
    tcol = _find(cols, [_norm(x) for x in TIME_ALIASES])
    dcol, hcol = _find(cols, DATE_ONLY), _find(cols, TIME_ONLY)
    if dcol and hcol and dcol != hcol:
        idx = _parse_time(df[dcol].astype(str) + " " + df[hcol].astype(str), tz)
    elif tcol:
        idx = _parse_time(df[tcol], tz)
    else:
        raise ValueError("no date/time column found (tried timestamp, datetime, date, time, t, …)")
    # prices
    got = {}
    for k in ("Open", "High", "Low", "Close", "Volume", "VWAP", "TradeCount"):
        c = _find(cols, ALIASES[k])
        if c is not None and c not in (tcol, dcol, hcol):
            got[k] = pd.to_numeric(df[c].astype(str).str.replace(r"[,$\s]", "", regex=True), errors="coerce").values
    if "Close" not in got:
        raise ValueError(f"no price column found (tried close, c, last, price, adj close, …) among {list(df.columns)[:12]}")
    n = len(df)
    for k in ("Open", "High", "Low"):
        got.setdefault(k, got["Close"])
    got.setdefault("Volume", np.zeros(n))
    frame = pd.DataFrame({k: got[k] for k in COLS + [x for x in ("VWAP", "TradeCount") if x in got]}, index=idx)
    # ticker
    tick_col = _find(cols, TICKER_ALIASES)
    if "__ticker" in df.columns and df["__ticker"].notna().any():
        tickers = df["__ticker"].astype(str).str.upper().values
    elif tick_col is not None:
        tickers = df[tick_col].astype(str).str.strip().str.upper().values
    elif ticker_hint:
        tickers = np.full(n, ticker_hint.upper())
    else:
        raise ValueError("no ticker: add a ticker/symbol column, type the ticker, or name the file after it (e.g. AAPL.csv)")
    frame["__t"] = tickers
    frame = frame[frame.index.notna() & np.isfinite(frame["Close"].values) & (frame["Close"].values > 0)]
    out = {}
    for t, g in frame.groupby("__t"):
        if not TICKER_RE.match(str(t)):
            continue
        g = g.drop(columns="__t").sort_index()
        g = g[~g.index.duplicated(keep="last")]
        hi = g[["Open", "High", "Low", "Close"]].max(axis=1)
        lo = g[["Open", "High", "Low", "Close"]].min(axis=1)
        g["High"], g["Low"] = np.maximum(g["High"], hi), np.minimum(g["Low"], lo)
        out[str(t)] = g.astype(float)
    return out


def _ticker_from_name(name: str) -> str | None:
    stem = re.split(r"[\\/]", name)[-1]
    stem = re.sub(r"\.(csv|tsv|txt|json|jsonl|ndjson|xlsx|xlsm|xls|ods|parquet|pq|feather|arrow|html?)$", "", stem, flags=re.I)
    for part in re.split(r"[_\-\s:#]+", stem):
        p = part.upper()
        if TICKER_RE.match(p) and not re.fullmatch(r"\d.*|1MIN|1M|MIN|MINUTE|BARS?|DATA|DAILY|INTRADAY|OHLCV?|US|EQUITY|STOCKS?|SIP|IEX", p):
            return p
    return None


def _interval_minutes(idx: pd.DatetimeIndex) -> float:
    if len(idx) < 3:
        return float("nan")
    d = np.diff(idx.values) / np.timedelta64(1, "m")      # unit-safe (ns or us indexes)
    d = d[(d > 0) & (d < 60 * 24 * 7)]
    return float(np.median(d)) if len(d) else float("nan")


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def ingest(name: str, data: bytes, ticker: str | None = None, tz_name: str = "America/New_York",
           overwrite: bool = False) -> dict:
    tz = ZoneInfo(tz_name or "America/New_York")
    hint = (ticker or "").strip().upper() or _ticker_from_name(name)
    results, errors = [], []
    for part, df in read_any(name, data):
        try:
            per = normalize(df, tz, hint or _ticker_from_name(part))
        except Exception as exc:
            errors.append(f"{part}: {exc}")
            continue
        for t, g in per.items():
            results.append(_merge(t, g, overwrite, source=part))
    rec = {"at": datetime.now(ET).isoformat(timespec="seconds"), "file": name, "results": results, "errors": errors}
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    return {"ok": bool(results), **rec}


def _merge(ticker: str, g: pd.DataFrame, overwrite: bool, source: str) -> dict:
    iv = _interval_minutes(g.index)
    info = {"ticker": ticker, "source": source, "rows": int(len(g)),
            "from": g.index[0].isoformat(), "to": g.index[-1].isoformat(),
            "interval_min": None if np.isnan(iv) else round(iv, 2)}
    if np.isnan(iv) or abs(iv - 1.0) > 0.01:
        # Not 1-minute: kept for reference; the engine trades 1-minute bars.
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        tag = "daily" if not np.isnan(iv) and iv >= 60 * 20 else f"{info['interval_min']}min"
        path = UPLOAD_DIR / f"{ticker}_{tag}.pkl"
        prev = pd.read_pickle(path) if path.exists() else None
        merged = g if prev is None else pd.concat([prev, g])
        merged = merged[~merged.index.duplicated(keep="last" if overwrite else "first")].sort_index()
        tmp = path.with_suffix(f".tmp{os.getpid()}")
        merged.to_pickle(tmp)
        os.replace(tmp, path)
        return {**info, "used_by_engine": False, "stored": str(path.name),
                "note": "not 1-minute bars — stored in uploads/, not used for training (the engine trades 1-minute bars)"}
    path = alpaca_data.CACHE_DIR / f"{ticker}.pkl"
    alpaca_data.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    prev = pd.read_pickle(path) if path.exists() else None
    if prev is None:
        merged, added = g, len(g)
    else:
        for c in prev.columns:
            if c not in g.columns:
                g[c] = np.nan
        both = pd.concat([prev, g[prev.columns]] if not overwrite else [g[prev.columns], prev])
        merged = both[~both.index.duplicated(keep="first")].sort_index()
        added = len(merged) - len(prev)
    for c in ("VWAP", "TradeCount"):            # the cache schema alpaca_data expects
        if c not in merged.columns:
            merged[c] = np.nan
    merged = merged.astype(float)
    tmp = path.with_suffix(f".tmp{os.getpid()}")
    merged.to_pickle(tmp)
    os.replace(tmp, path)
    return {**info, "used_by_engine": True, "new_bars": int(added),
            "overlap_kept": "uploaded" if overwrite else "existing",
            "cache_from": merged.index[0].isoformat(), "cache_to": merged.index[-1].isoformat(),
            "cache_bars": int(len(merged))}


def history_log(limit: int = 50) -> list[dict]:
    if not LOG.exists():
        return []
    rows = [json.loads(x) for x in LOG.read_text(encoding="utf-8").splitlines() if x.strip()]
    return rows[-limit:][::-1]
