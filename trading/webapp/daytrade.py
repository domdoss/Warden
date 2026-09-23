"""Intraday (day-trading) engine for the alpha stack — PAPER ONLY.

Nothing here talks to a broker. Every order is booked against a simulated
intraday account kept in ``.alpha-stack/daytrade/state.json``.

Pieces:
- Data: yfinance 1-minute bars (regular session only). Yahoo serves 1m bars
  for the last 30 days, at most ~8 days per request, so history is fetched in
  7-day chunks (~20 sessions). Bar age is measured, never assumed.
- Model: per ticker, a liquid time-constant network (ncps CfC, torch) over the
  last 30 one-minute bars of scale-free features predicting the log return
  over the next ``horizon_min`` minutes. Default 15 min: long enough that the
  expected move is several times the round-trip cost on liquid large caps,
  short enough to stay an intraday call, and tolerant of a delayed feed.
- Edge: walk-forward (3 chronological folds, each trained only on earlier
  sessions), trading the exact live rules with spread + slippage charged on
  every fill. A ticker whose out-of-sample edge net of costs is not positive
  gets STAND ASIDE regardless of what the model predicts.
- Engine: one thread. Live mode polls the last price every few seconds,
  re-evaluates on each completed 1m bar, manages stops/targets/time exits,
  a daily-loss kill switch and a flatten before the close. Replay mode runs
  the same code over the last session at an accelerated speed.
- Stream: every engine update bumps ``seq`` and wakes SSE listeners.
"""

from __future__ import annotations

import copy
import json
import math
import os
import sys
import queue
import threading
import time
import traceback
from datetime import date, datetime, time as dtime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parent.parent / ".alpha-stack" / "daytrade"
STATE_FILE = ROOT / "state.json"
MODEL_DIR = ROOT / "models"
# Named snapshots of a whole trained model set ("model saves"): each is a
# folder of model files plus set.json (the settings they were trained with).
MODEL_SETS_DIR = ROOT / "model_sets"
BARS_DIR = ROOT / "bars"

HISTORY_DAYS = 29          # Yahoo: 1m bars reach back ~30 days
ALPACA_HISTORY_DAYS = 365  # Alpaca (free SIP history): one year of sessions


def history_days() -> int:
    import alpaca_data
    return ALPACA_HISTORY_DAYS if alpaca_data.available() else HISTORY_DAYS
PRICE_POLL_S = 5

# NYSE full-day holidays and 1pm early closes. Beyond the listed years the
# calendar falls back to weekdays only (the bar feed then shows no session).
HOLIDAYS = {
    "2021-01-01", "2021-01-18", "2021-02-15", "2021-04-02", "2021-05-31",
    "2021-07-05", "2021-09-06", "2021-11-25", "2021-12-24",
    "2022-01-17", "2022-02-21", "2022-04-15", "2022-05-30", "2022-06-20",
    "2022-07-04", "2022-09-05", "2022-11-24", "2022-12-26",
    "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29",
    "2023-06-19", "2023-07-04", "2023-09-04", "2023-11-23", "2023-12-25",
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
    "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18",
    "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27",
    "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
}
EARLY_CLOSE = {
    "2021-11-26",
    "2022-11-25",
    "2023-07-03", "2023-11-24",
    "2024-07-03", "2024-11-29", "2024-12-24",
    "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-11-27", "2026-12-24", "2027-11-26",
}

import knobs

# Every user-facing knob (defaults, ranges, help) lives in knobs.py.
# start_equity only sizes replays when the shared account can't be read.
DEFAULT_CONFIG = {**knobs.defaults(), "start_equity": 25000.0}
# Bumped when defaults change meaningfully: a saved config from an older
# version keeps only the user's own choices below and takes the new defaults.
KNOBS_VERSION = 2
KEEP_ON_UPGRADE = ("tickers", "extra_tickers", "auto_execute", "train_window", "train_workers")

# Calendar days of history per training window. Yahoo (no Alpaca key) caps
# every window at the ~30 days of 1m bars it serves.
TRAIN_WINDOWS = {"week": 7, "month": 30, "year": 365, "2years": 730, "all": 3650}
MIN_SESSIONS = 5

# All computable inputs; each model uses the subset in cfg["features"].
FEATS = ["r1", "r5", "r15", "vwap_dist", "open_ret", "range_pos", "rsi", "atr",
         "vol_z", "tod_sin", "tod_cos", "gap"]


def log(msg: str) -> None:
    print(f"[daytrade] {msg}", file=sys.stderr, flush=True)


def _atomic_write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Market calendar
# ---------------------------------------------------------------------------

def session_bounds(d: date) -> tuple[datetime, datetime] | None:
    if d.weekday() >= 5 or d.isoformat() in HOLIDAYS:
        return None
    close_t = dtime(13, 0) if d.isoformat() in EARLY_CLOSE else dtime(16, 0)
    return datetime.combine(d, dtime(9, 30), ET), datetime.combine(d, close_t, ET)


def market_clock(now: datetime | None = None) -> dict:
    now = now or datetime.now(ET)
    b = session_bounds(now.date())
    if b and b[0] <= now < b[1]:
        return {"open": True, "now": now.isoformat(), "closes_at": b[1].isoformat(),
                "seconds_to_close": int((b[1] - now).total_seconds())}
    if b and now < b[0]:
        nxt = b[0]
    else:
        d = now.date() + timedelta(days=1)
        while session_bounds(d) is None:
            d += timedelta(days=1)
        nxt = session_bounds(d)[0]
    return {"open": False, "now": now.isoformat(), "next_open": nxt.isoformat(),
            "seconds_to_open": int((nxt - now).total_seconds())}


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def _pick(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        lv0 = set(df.columns.get_level_values(0))
        if ticker in lv0:
            df = df[ticker]
        else:
            df = df.xs(ticker, axis=1, level=1)
    cols = ["Open", "High", "Low", "Close", "Volume"]
    if not set(cols) <= set(df.columns):
        return pd.DataFrame()
    df = df[cols].dropna(subset=["Close"])
    idx = df.index
    idx = idx.tz_localize("UTC") if idx.tz is None else idx
    df.index = idx.tz_convert(ET)
    return _session_only(df)


def _session_only(df: pd.DataFrame) -> pd.DataFrame:
    """Regular-session bars only. One session_bounds call per day, then a
    single vectorized comparison (a per-day mask over the whole frame took
    ~27 s on 5 years of 1-min bars; this is ~0.4 s, identical output)."""
    if df.empty:
        return df
    days = pd.Series(df.index.date, index=df.index)
    b = {d: session_bounds(d) for d in days.unique()}
    op = days.map({d: (v[0] if v else pd.NaT) for d, v in b.items()})
    cl = days.map({d: (v[1] if v else pd.NaT) for d, v in b.items()})
    ts = pd.Series(df.index, index=df.index)
    return df[((ts >= op) & (ts < cl)).to_numpy(dtype=bool)]


def fetch_history(ticker: str, days: int = ALPACA_HISTORY_DAYS) -> pd.DataFrame:
    """Training history of 1m bars: ``days`` of Alpaca SIP bars when an Alpaca
    key is configured (default a year), else ~20 sessions from Yahoo. Beyond a
    year it uses only what the cache already holds — the deep multi-year
    caches — so a long window never starts a multi-year download."""
    import alpaca_data
    if alpaca_data.available():
        if days > ALPACA_HISTORY_DAYS:
            days = max(ALPACA_HISTORY_DAYS, min(days, alpaca_data.cached_depth_days(ticker)))
        return _session_only(alpaca_data.history(ticker, days))
    today = datetime.now(ET).date().isoformat()
    cache = BARS_DIR / f"{ticker}_{today}.pkl"
    if cache.exists():
        try:
            return pd.read_pickle(cache)
        except Exception:
            pass
    end = datetime.now(ET) + timedelta(days=1)
    start = end - timedelta(days=HISTORY_DAYS + 1)
    parts = []
    s = start
    while s < end:
        e = min(s + timedelta(days=7), end)
        raw = yf.download(ticker, start=s.date().isoformat(), end=e.date().isoformat(),
                          interval="1m", progress=False, auto_adjust=True, prepost=False)
        part = _pick(raw, ticker)
        if not part.empty:
            parts.append(part)
        s = e
    if not parts:
        return pd.DataFrame()
    df = pd.concat(parts)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    BARS_DIR.mkdir(parents=True, exist_ok=True)
    for old in BARS_DIR.glob(f"{ticker}_*.pkl"):
        old.unlink(missing_ok=True)
    df.to_pickle(cache)
    return df


def fetch_recent(tickers: list[str], period: str = "1d") -> dict[str, pd.DataFrame]:
    if not tickers:
        return {}
    import alpaca_data
    if alpaca_data.available():
        # Live bars: Alpaca's real-time IEX feed (free plan).
        return {t: _session_only(df) for t, df in alpaca_data.recent(tickers, int(period.rstrip("d"))).items()}
    raw = yf.download(tickers, period=period, interval="1m", progress=False,
                      auto_adjust=True, prepost=False, group_by="ticker", threads=True)
    return {t: _pick(raw, t) for t in tickers}


# ---------------------------------------------------------------------------
# Features + model
# ---------------------------------------------------------------------------

def features(df: pd.DataFrame) -> pd.DataFrame:
    c, o, h, l, v = df["Close"], df["Open"], df["High"], df["Low"], df["Volume"]
    day = pd.Series(df.index.date, index=df.index)
    lc = np.log(c)
    f = pd.DataFrame(index=df.index)
    f["r1"] = lc.diff()
    f["r5"] = lc.diff(5)
    f["r15"] = lc.diff(15)
    tp = (h + l + c) / 3
    vwap = (tp * v).groupby(day).cumsum() / v.groupby(day).cumsum().replace(0, np.nan)
    f["vwap_dist"] = c / vwap - 1
    day_open = o.groupby(day).transform("first")
    f["open_ret"] = c / day_open - 1
    hi, lo = h.groupby(day).cummax(), l.groupby(day).cummin()
    f["range_pos"] = ((c - lo) / (hi - lo).replace(0, np.nan) - 0.5).fillna(0)
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    f["rsi"] = (100 - 100 / (1 + gain / loss.replace(0, np.nan))) / 100 - 0.5
    prev = c.shift(1)
    tr = pd.concat([h - l, (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    f["atr"] = tr.ewm(alpha=1 / 14, adjust=False).mean() / c
    lv = np.log1p(v)
    f["vol_z"] = (lv - lv.rolling(60).mean()) / lv.rolling(60).std()
    mins = (df.index.hour * 60 + df.index.minute - 570) / 390.0
    f["tod_sin"] = np.sin(2 * np.pi * mins)
    f["tod_cos"] = np.cos(2 * np.pi * mins)
    last_close = c.groupby(day).last()
    prev_close = last_close.shift(1)
    f["gap"] = (day_open / day.map(prev_close) - 1).fillna(0)
    return f.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def atr_px(df: pd.DataFrame) -> pd.Series:
    c, h, l = df["Close"], df["High"], df["Low"]
    prev = c.shift(1)
    tr = pd.concat([h - l, (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / 14, adjust=False).mean()


def _day_keys(idx: pd.DatetimeIndex) -> np.ndarray:
    """Session date of every bar as an int (YYYYMMDD). Membership tests on
    these are vectorized; on python date objects np.isin/== over 5 years of
    1-min bars took ~7 s per call under the GIL."""
    return (idx.year.values * 10000 + idx.month.values * 100 + idx.day.values).astype(np.int64)


def _dkey(d) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def forward_return(df: pd.DataFrame, horizon: int) -> np.ndarray:
    lc = np.log(df["Close"].values)
    days = np.array(df.index.date)
    fwd = np.full(len(df), np.nan)
    if len(df) > horizon:
        same = days[horizon:] == days[:-horizon]
        r = lc[horizon:] - lc[:-horizon]
        fwd[:-horizon] = np.where(same, r, np.nan)
    return fwd


def _net_class(n_feats: int, units: int):
    import torch
    from ncps.torch import CfC

    class Net(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.rnn = CfC(n_feats, units, batch_first=True)
            self.head = torch.nn.Linear(units, 1)

        def forward(self, x):
            out, _ = self.rnn(x)
            return self.head(out[:, -1])
    return Net


def _windows(z: np.ndarray, look_back: int) -> np.ndarray:
    from numpy.lib.stride_tricks import sliding_window_view
    return sliding_window_view(z, (look_back, z.shape[1]))[:, 0].astype(np.float32)


# Training runs several tickers at once (config "train_workers", 1–6): one
# device slot per worker, dealt round-robin across the GPUs. The model is
# small, so one ticker per GPU leaves it mostly idle between steps.
MAX_TRAIN_WORKERS = 6
_SLOTS: queue.Queue | None = None
_SLOTS_N = 0
_SLOTS_LOCK = threading.Lock()


def free_gpu_from_ollama() -> None:
    """Unload every model ollama holds in VRAM (keep_alive 0) so training gets
    the GPUs. Ollama reloads a model on its next request."""
    base = "http://127.0.0.1:11434"
    try:
        import urllib.request
        with urllib.request.urlopen(f"{base}/api/ps", timeout=5) as r:
            loaded = [m["name"] for m in json.loads(r.read()).get("models", [])]
        for name in loaded:
            req = urllib.request.Request(f"{base}/api/generate", data=json.dumps({"model": name, "keep_alive": 0}).encode(),
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=30).read()
        if loaded:
            log(f"unloaded ollama models for training: {', '.join(loaded)}")
    except Exception as exc:
        log(f"could not unload ollama models: {exc}")


def free_gpu_memory() -> None:
    """Release PyTorch's cached GPU memory on every device (kept models stay
    loaded — they're a few MB). Called when a training batch ends."""
    import gc
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                with torch.cuda.device(i):
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
    except Exception as exc:
        log(f"could not release GPU memory: {exc}")


def set_train_workers(n: int) -> None:
    """Size the slot pool to ``n``. Only rebuilt while every slot is free, so
    a change made mid-batch takes effect on the next batch."""
    global _SLOTS, _SLOTS_N
    with _SLOTS_LOCK:
        if _SLOTS is not None and (n == _SLOTS_N or _SLOTS.qsize() != _SLOTS_N):
            return
        import torch
        gpus = torch.cuda.device_count() if torch.cuda.is_available() else 0
        _SLOTS = queue.Queue()
        for i in range(n):
            _SLOTS.put(f"cuda:{i % gpus}" if gpus else "cpu")
        _SLOTS_N = n


def _device_slots() -> queue.Queue:
    if _SLOTS is None:
        set_train_workers(DEFAULT_CONFIG["train_workers"])
    return _SLOTS


def fit(df: pd.DataFrame, train_days: list, cfg: dict, on_epoch=None, device: str | None = None,
        feats_df: pd.DataFrame | None = None) -> dict:
    """Train on ``train_days`` (the newest val_share_pct of them held out for
    early stopping). Returns a pack usable by ``predict``.

    The look-back windows are never materialized in RAM: the normalized
    feature table goes to the device once and each batch gathers its windows
    from an ``unfold`` view there. (Building every window on the CPU took
    ~1.4 GB per ticker for 5 years and pinned one core for minutes.)
    ``feats_df`` lets a caller compute ``features(df)`` once for many fits."""
    import torch
    horizon, look_back, units = int(cfg["horizon_min"]), int(cfg["look_back"]), int(cfg["hidden_units"])
    cols = list(cfg["features"])
    feats = (feats_df if feats_df is not None else features(df))[cols].values.astype(np.float64)
    y = forward_return(df, horizon)
    days = _day_keys(df.index)
    n_val = max(2, int(round(len(train_days) * cfg["val_share_pct"] / 100)))
    fit_days = np.array([_dkey(x) for x in train_days[:-n_val]], dtype=np.int64)
    val_days = np.array([_dkey(x) for x in train_days[-n_val:]], dtype=np.int64)
    in_fit = np.isin(days, fit_days)
    mu = feats[in_fit].mean(0)
    sd = feats[in_fit].std(0)
    sd = np.where(sd == 0, 1.0, sd)
    z = np.clip((feats - mu) / sd, -6, 6)
    end = np.arange(look_back - 1, len(z))
    y_end = y[end]
    ok = ~np.isnan(y_end)
    tr = ok & np.isin(days[end], fit_days)
    va = ok & np.isin(days[end], val_days)
    y_sd = float(np.nanstd(y_end[tr])) or 1e-3

    dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
    torch.manual_seed(0)
    net = _net_class(len(cols), units)().to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=float(cfg["learning_rate"]), weight_decay=float(cfg["weight_decay"]))
    batch, epochs, patience = int(cfg["batch_size"]), int(cfg["max_epochs"]), int(cfg["patience"])
    # Research objective (edge_lab): "sign" trains the output's SIGN toward sign(y),
    # weighted by move size — decide() trades the sign, so this aligns the loss with
    # the decision. Default "mse" keeps the live models byte-identical.
    objective = str(cfg.get("objective") or "mse").lower()
    loss_fn = torch.nn.MSELoss()
    # Windows as a device-side view: W[k] = z[k : k+look_back] (window ending at end[k]).
    zt = torch.from_numpy(z.astype(np.float32)).to(dev)
    W = zt.unfold(0, look_back, 1).permute(0, 2, 1)
    tr_i = torch.from_numpy(np.nonzero(tr)[0]).to(dev)
    va_i = torch.from_numpy(np.nonzero(va)[0]).to(dev)
    y0 = np.nan_to_num(y_end)
    y_all = torch.from_numpy((y0 / y_sd).astype(np.float32)[:, None]).to(dev)
    if objective == "sign":
        sg_all = torch.from_numpy(np.sign(y0).astype(np.float32)).to(dev)
        wt_all = torch.from_numpy(np.where(np.sign(y0) == 0, 0.0, 1.0 + np.abs(y0) / y_sd).astype(np.float32)).to(dev)

        def sign_loss(out_b, sg_b, wt_b):
            return (wt_b * torch.nn.functional.softplus(-sg_b * out_b[:, 0])).mean()

    def batch_loss(idx):
        out = net(W[idx])
        if objective == "sign":
            return sign_loss(out, sg_all[idx], wt_all[idx])
        return loss_fn(out, y_all[idx])
    best, best_state, bad = float("inf"), None, 0
    for ep in range(epochs):
        if on_epoch:
            on_epoch(ep + 1, epochs)
        net.train()
        perm = torch.randperm(len(tr_i), device=dev)
        for i in range(0, len(tr_i), batch):
            idx = tr_i[perm[i:i + batch]]
            opt.zero_grad()
            loss = batch_loss(idx)
            loss.backward()
            opt.step()
        net.eval()
        with torch.no_grad():
            # Chunked, count-weighted mean = the same number as one big pass.
            tot, n = 0.0, 0
            for i in range(0, len(va_i), batch):
                idx = va_i[i:i + batch]
                tot += float(batch_loss(idx)) * len(idx)
                n += len(idx)
            vl = tot / n if n else 0.0
        if vl < best - 1e-5:
            best, bad = vl, 0
            best_state = {k: t.detach().clone() for k, t in net.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                break
    if best_state is not None:
        net.load_state_dict(best_state)
    net.eval()
    return {"net": net, "mu": mu, "sd": sd, "y_sd": y_sd, "dev": dev, "horizon": horizon,
            "val_loss": best, "features": cols, "look_back": look_back, "units": units}


def predict(pack: dict, df: pd.DataFrame, feats_df: pd.DataFrame | None = None) -> np.ndarray:
    """Predicted forward log return in bps for every bar (NaN before a full
    window). Windows are cut on the device from an ``unfold`` view."""
    import torch
    lb = pack["look_back"]
    feats = (feats_df if feats_df is not None else features(df))[pack["features"]].values.astype(np.float64)
    z = np.clip((feats - pack["mu"]) / pack["sd"], -6, 6)
    out = np.full(len(df), np.nan)
    if len(z) < lb:
        return out
    W = torch.from_numpy(z.astype(np.float32)).to(pack["dev"]).unfold(0, lb, 1).permute(0, 2, 1)
    preds = []
    with torch.no_grad():
        for i in range(0, W.shape[0], 16384):
            preds.append(pack["net"](W[i:i + 16384].contiguous()).cpu().numpy()[:, 0])
    out[lb - 1:] = np.concatenate(preds) * pack["y_sd"] * 1e4
    return out


# ---------------------------------------------------------------------------
# Paper book + the one decision rule (live, replay and backtest all use it)
# ---------------------------------------------------------------------------

def cost_per_fill(cfg: dict) -> float:
    return (cfg["spread_bps"] / 2 + cfg["slippage_bps"]) / 1e4


def round_trip_bps(cfg: dict) -> float:
    return cfg["spread_bps"] + 2 * cfg["slippage_bps"]


class TrainingStopped(Exception):
    """Raised inside a fit (at an epoch boundary) when training is stopped."""


class SharedAccount:
    """The Alpha Stack paper account (paper.py), seen from the intraday book.

    Same account for long-term holdings and day trades: the book sizes off
    its equity, is capped by its cash, and posts every closed round trip's
    net P&L into it. Snapshots are cached briefly — equity marks long-term
    positions at the last daily close, so it only moves when cash does.
    """
    TTL = 30.0

    def __init__(self):
        self._snap: dict | None = None
        self._at = 0.0

    def _get(self) -> dict:
        if self._snap is None or time.time() - self._at > self.TTL:
            import paper
            self._snap = paper.account_snapshot()
            self._at = time.time()
        return self._snap

    def equity(self) -> float:
        return self._get()["equity"]

    def cash(self) -> float:
        return self._get()["cash"]

    def start_equity(self) -> float:
        return self._get()["start_equity"]

    def post(self, trade: dict) -> None:
        import paper
        paper.post_intraday_close(trade)
        self._snap = None


def _week_key(d: str) -> str:
    """ISO week for a date string, e.g. '2026-09-21' -> '2026-W39'."""
    iso = date.fromisoformat(d).isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


class Book:
    def __init__(self, cfg: dict, data: dict | None = None, shared: SharedAccount | None = None):
        d = data or {}
        # Live book: money lives in the shared paper account. Replay and the
        # walk-forward backtest use a standalone book (shared=None).
        self.shared = shared
        # P&L of closed trades whose post to the shared account failed; still
        # counted in equity so the book never loses track of it.
        self.unposted = float(d.get("unposted", 0.0))
        self.start_equity = float(d.get("start_equity", cfg.get("start_equity", 25000.0)))
        self.realized_total = float(d.get("realized_total", 0.0))
        self.day = d.get("day")
        self.day_start_equity = float(d.get("day_start_equity", self.start_equity))
        self.realized_today = float(d.get("realized_today", 0.0))
        self.killed_day = d.get("killed_day")
        self.banked_day = d.get("banked_day")
        self.week = d.get("week") or (_week_key(self.day) if self.day else None)
        self.week_start_equity = float(d.get("week_start_equity", self.start_equity))
        self.killed_week = d.get("killed_week")
        self.loss_streak = int(d.get("loss_streak", 0))
        self.positions: dict[str, dict] = d.get("positions", {})
        self.trades: list[dict] = d.get("trades", [])
        self.fills: list[dict] = d.get("fills", [])

    def to_dict(self) -> dict:
        return {"start_equity": self.start_equity, "realized_total": self.realized_total,
                "day": self.day, "day_start_equity": self.day_start_equity,
                "realized_today": self.realized_today, "killed_day": self.killed_day,
                "banked_day": self.banked_day,
                "week": self.week, "week_start_equity": self.week_start_equity,
                "killed_week": self.killed_week, "loss_streak": self.loss_streak,
                "unposted": self.unposted,
                "positions": self.positions, "trades": self.trades[-500:],
                "fills": self.fills[-1000:]}

    def unrealized(self, marks: dict[str, float]) -> float:
        u = 0.0
        for t, p in self.positions.items():
            m = marks.get(t, p["entry_mid"])
            u += (m - p["entry"]) * p["qty"] * (1 if p["side"] == "long" else -1)
        return u

    def equity(self, marks: dict[str, float]) -> float:
        if self.shared:
            # Closed trades are already in the shared account's cash.
            return self.shared.equity() + self.unposted + self.unrealized(marks)
        return self.start_equity + self.realized_total + self.unrealized(marks)

    def exposure(self) -> float:
        return sum(p["entry"] * p["qty"] for p in self.positions.values())

    def cash(self) -> float:
        """Cash after open intraday positions: longs debit, shorts credit."""
        signed = sum(p["entry"] * p["qty"] * (1 if p["side"] == "long" else -1)
                     for p in self.positions.values())
        base = (self.shared.cash() + self.unposted) if self.shared else (self.start_equity + self.realized_total)
        return base - signed

    def roll_day(self, d: str, marks: dict[str, float]) -> None:
        if self.day != d:
            # Close the books on the day just ended: a losing day extends the
            # losing streak, any other day (or a flat day) resets it.
            if self.day is not None:
                self.loss_streak = self.loss_streak + 1 if self.realized_today < 0 else 0
            self.day = d
            self.day_start_equity = self.equity(marks)
            self.realized_today = 0.0
            wk = _week_key(d)
            if wk != self.week:
                self.week = wk
                self.week_start_equity = self.equity(marks)
                self.killed_week = None
                self.loss_streak = 0

    def open(self, ticker: str, side: str, mid: float, when: datetime, stop: float, target: float,
             exit_by: datetime, reason: str, cfg: dict, marks: dict[str, float]) -> dict | None:
        if ticker in self.positions or len(self.positions) >= cfg["max_positions"]:
            return None
        if self.killed_day == self.day or self.banked_day == self.day:
            return None
        if self.killed_week == self.week:
            return None
        eq = self.equity(marks)
        per_share_risk = abs(mid - stop)
        if per_share_risk <= 0:
            return None
        risk_pct = cfg["risk_per_trade_pct"]
        # Recoup mode: from midday on, while the day is down, risk less per trade.
        mult = float(cfg.get("recoup_risk_mult") or 1.0)
        if mult < 1.0:
            b = session_bounds(when.date())
            if b and when >= b[0] + (b[1] - b[0]) / 2 and eq < self.day_start_equity:
                risk_pct *= mult
        qty = math.floor(eq * risk_pct / 100 / per_share_risk)
        qty = min(qty, math.floor(eq * cfg["max_position_pct"] / 100 / mid))
        if self.shared:
            # Buying power = the shared account's free cash, less what open
            # day trades already tie up (long-term holdings keep theirs).
            avail = self.shared.cash() + self.unposted - self.exposure()
            qty = min(qty, math.floor(max(avail, 0.0) / mid))
        if qty < 1:
            return None
        c = cost_per_fill(cfg)
        fill = mid * (1 + c) if side == "long" else mid * (1 - c)
        pos = {"ticker": ticker, "side": side, "qty": qty, "entry": round(fill, 4),
               "entry_mid": mid, "stop": round(stop, 4), "target": round(target, 4),
               "opened_at": when.isoformat(), "exit_by": exit_by.isoformat(), "reason": reason}
        self.positions[ticker] = pos
        self.fills.append({"ts": when.isoformat(), "ticker": ticker, "side": side, "action": "open",
                           "qty": qty, "price": round(fill, 4), "reason": reason})
        return pos

    def close(self, ticker: str, mid: float, when: datetime, reason: str, cfg: dict) -> dict | None:
        p = self.positions.pop(ticker, None)
        if not p:
            return None
        c = cost_per_fill(cfg)
        sgn = 1 if p["side"] == "long" else -1
        fill = mid * (1 - c) if p["side"] == "long" else mid * (1 + c)
        pnl = (fill - p["entry"]) * p["qty"] * sgn
        t = {**p, "exit": round(fill, 4), "exit_mid": mid, "closed_at": when.isoformat(),
             "exit_reason": reason, "pnl": round(pnl, 2),
             "net_bps": round(sgn * (fill / p["entry"] - 1) * 1e4, 2),
             "gross_bps": round(sgn * (mid / p["entry_mid"] - 1) * 1e4, 2),
             "long_net_bps": round(((mid * (1 - c)) / (p["entry_mid"] * (1 + c)) - 1) * 1e4, 2)}
        self.realized_total += pnl
        self.realized_today += pnl
        if self.shared:
            try:
                self.shared.post(t)
                t["posted"] = True
            except Exception as exc:
                log(f"post to paper account failed for {ticker}: {exc}")
                t["posted"] = False
                self.unposted += pnl
        self.trades.append(t)
        self.fills.append({"ts": when.isoformat(), "ticker": ticker, "side": p["side"], "action": "close",
                           "qty": p["qty"], "price": round(fill, 4), "pnl": round(pnl, 2), "reason": reason})
        return t


def align_gate(cfg: dict, stance: dict | None) -> tuple[str | None, str]:
    """How the ``lt_align`` setting gates this ticker's entries.

    Returns (blocked_sides, reason): blocked_sides is "long", "short",
    "both" or None. "off" never blocks. "with_stance" holds back entries
    against the stance (shorts on bullish names, longs on bearish ones).
    "with_stance_hold" also stands aside entirely on names whose stance is
    hold. Walk-forward edge tests and backtests never pass a stance, so a
    measured edge stays the intraday model's own.
    """
    mode = cfg.get("lt_align") or "off"
    if not stance or mode == "off":
        return None, ""
    d = stance.get("direction")
    if mode == "follow":
        # Follow the long-term call: its side only; Hold per the lt_hold setting.
        if d == "bullish":
            return "short", stance.get("reason") or "the long-term call is Buy"
        if d == "bearish":
            return "long", stance.get("reason") or "the long-term call is Sell"
        if d == "hold" and cfg.get("lt_hold") == "aside":
            return "both", stance.get("reason") or "the long-term call is Hold"
        return None, ""
    if d == "bullish":
        return "short", stance.get("reason") or "the long-term stack is bullish"
    if d == "bearish":
        return "long", stance.get("reason") or "the long-term stack is bearish"
    if d == "hold" and mode == "with_stance_hold":
        return "both", stance.get("reason") or "the long-term stack says hold"
    return None, ""


def move_bps(done: pd.DataFrame, horizon_min: int) -> float | None:
    """The plain-move signal: the ticker's own move over the horizon window,
    in bps — close now vs close ``horizon_min`` minutes ago. Used when
    signal_source is "move"; the knobs then decide when it's a trade."""
    h = int(horizon_min)
    if len(done) < h + 1:
        return None
    now, then = float(done["Close"].iloc[-1]), float(done["Close"].iloc[-1 - h])
    if not then > 0:
        return None
    return (now / then - 1) * 1e4


def decide(pred_bps: float, pos: dict | None, edge: dict, cfg: dict, price: float,
           atr: float, now: datetime, close_dt: datetime,
           lt_stance: dict | None = None) -> dict:
    thr = round_trip_bps(cfg) * cfg["edge_mult"]
    h = cfg["horizon_min"]
    sigma = max(atr * math.sqrt(h), price * 1e-4)
    blocked, why = align_gate(cfg, lt_stance)
    base = {"pred_bps": None if pred_bps is None or math.isnan(pred_bps) else round(pred_bps, 2),
            "threshold_bps": round(thr, 2), "entry": None, "stop": None, "target": None}
    if pred_bps is None or math.isnan(pred_bps):
        return {**base, "call": "HOLD", "action": "none", "reason": "warming up — not enough bars yet"}
    if pos:
        against = (pos["side"] == "long" and pred_bps < -thr) or (pos["side"] == "short" and pred_bps > thr)
        if against:
            call = "SELL NOW" if pos["side"] == "long" else "BUY NOW"
            return {**base, "call": call, "action": "exit",
                    "reason": f"exit {pos['side']}: model now predicts {pred_bps:+.1f} bps over {h} min, against the position"}
        return {**base, "call": "HOLD", "action": "none",
                "reason": f"in a {pos['side']} position; stop {pos['stop']}, target {pos['target']}, time exit {pos['exit_by'][11:16]}"}
    if not edge_ok(edge, cfg):
        dh = edge.get("direction_hit_pct")
        dir_txt = (f"direction call {dh:.1f}% (needs {cfg['min_direction_pct']:.1f}%)"
                   if dh is not None else "no direction score")
        return {**base, "call": "STAND ASIDE", "action": "none",
                "reason": (f"no edge: out-of-sample {edge.get('avg_net_bps', 0):+.1f} bps/trade net of costs "
                           f"over {edge.get('trades', 0)} trades, {dir_txt}")}
    mins_left = (close_dt - now).total_seconds() / 60
    if mins_left < cfg["last_entry_min"]:
        return {**base, "call": "HOLD", "action": "none",
                "reason": f"{mins_left:.0f} min to the close — too late for a {h}-min trade"}
    if blocked == "both":
        return {**base, "call": "STAND ASIDE", "action": "none",
                "reason": f"long-term alignment: {why} — no day trades on this ticker"}
    if pred_bps > thr:
        if blocked == "long":
            return {**base, "call": "HOLD", "action": "none",
                    "reason": f"predicts {pred_bps:+.1f} bps over {h} min — long entry held back by long-term alignment: {why}"}
        return {**base, "call": "BUY NOW", "action": "buy", "entry": round(price, 4),
                "stop": round(price - cfg["stop_sigma"] * sigma, 4),
                "target": round(price + cfg["target_sigma"] * sigma, 4),
                "reason": f"predicts {pred_bps:+.1f} bps over {h} min, above the {thr:.1f} bps cost bar"}
    if pred_bps < -thr and cfg["allow_short"]:
        if blocked == "short":
            return {**base, "call": "HOLD", "action": "none",
                    "reason": f"predicts {pred_bps:+.1f} bps over {h} min — short entry held back by long-term alignment: {why}"}
        return {**base, "call": "SELL NOW", "action": "sell", "entry": round(price, 4),
                "stop": round(price + cfg["stop_sigma"] * sigma, 4),
                "target": round(price - cfg["target_sigma"] * sigma, 4),
                "reason": f"predicts {pred_bps:+.1f} bps over {h} min — short, beyond the {thr:.1f} bps cost bar"}
    if pred_bps < -thr:
        return {**base, "call": "HOLD", "action": "none",
                "reason": f"bearish ({pred_bps:+.1f} bps) but shorting is off"}
    return {**base, "call": "HOLD", "action": "none",
            "reason": f"predicted {pred_bps:+.1f} bps is inside the ±{thr:.1f} bps cost band — wait"}


def _ratchet_stop(pos: dict, bar: dict, cfg: dict) -> None:
    """Tighten a winner's stop — never loosen it. Called AFTER this bar's exit
    checks so a stop raised by this bar's high can't be "hit" by this bar's
    low (intra-bar order is unknowable); the ratchet takes effect next bar.

    ``be_trigger``: once profit reaches that many stop-distances (measured on
    the original stop), move the stop to the entry — a winner can't turn into
    a loser. ``trail_sigma``: ratchet the stop that many stop-distances behind
    the best price the trade has reached. Both default 0 = off.
    """
    be = float(cfg.get("be_trigger") or 0)
    trail = float(cfg.get("trail_sigma") or 0)
    if not (be or trail):
        return
    long = pos["side"] == "long"
    if "risk0" not in pos:
        pos["risk0"] = abs(pos["entry"] - pos["stop"])
    best = pos.get("best_px", pos["entry"])
    pos["best_px"] = max(best, bar["high"]) if long else min(best, bar["low"])
    gain = (pos["best_px"] - pos["entry"]) if long else (pos["entry"] - pos["best_px"])
    if be and gain >= be * pos["risk0"]:
        if long:
            pos["stop"] = max(pos["stop"], pos["entry"])
        else:
            pos["stop"] = min(pos["stop"], pos["entry"])
    if trail:
        cand = pos["best_px"] - trail * pos["risk0"] if long else pos["best_px"] + trail * pos["risk0"]
        if long:
            pos["stop"] = max(pos["stop"], cand)
        else:
            pos["stop"] = min(pos["stop"], cand)


def _daily_lock(book: "Book", cfg: dict, now: datetime, marks: dict[str, float]) -> list[dict]:
    """Daily circuit breakers, shared by live, replay and backtest:
    - up ``daily_take_usd`` dollars → bank the day (flatten, no entries till tomorrow);
    - down ``max_daily_loss_usd`` dollars → cut the day the same way.
    Either knob at 0 leaves it off."""
    events: list[dict] = []
    if book.day is None:
        return events
    day_pnl = book.equity(marks) - book.day_start_equity
    take = float(cfg.get("daily_take_usd") or 0)
    cut = float(cfg.get("max_daily_loss_usd") or 0)
    if take and book.banked_day != book.day and day_pnl >= take:
        book.banked_day = book.day
        for t in list(book.positions):
            tr = book.close(t, marks.get(t, book.positions[t]["entry_mid"]), now, "daily profit lock", cfg)
            if tr:
                events.append({"type": "close", "trade": tr})
        events.append({"type": "bank", "at": now.isoformat(),
                       "reason": f"daily profit lock ${take:g} reached — flat, no entries until tomorrow"})
        return events
    if cut and book.killed_day != book.day and day_pnl <= -cut:
        book.killed_day = book.day
        for t in list(book.positions):
            tr = book.close(t, marks.get(t, book.positions[t]["entry_mid"]), now, "daily loss cutoff", cfg)
            if tr:
                events.append({"type": "close", "trade": tr})
        events.append({"type": "kill", "at": now.isoformat(),
                       "reason": f"daily loss cutoff ${cut:g} reached — flat, no entries until tomorrow"})
    return events


def _weekly_lock(book: "Book", cfg: dict, now: datetime, marks: dict[str, float]) -> list[dict]:
    """Weekly circuit breakers, shared by live and replay:
    - down ``max_weekly_loss_pct``% or ``max_weekly_loss_usd`` dollars since
      Monday's open → cut the week (flat, no entries until next Monday);
    - ``max_consecutive_loss_days`` losing days in a row → stand aside for the
      rest of the week the same way.
    Each knob at 0 leaves that guard off."""
    events: list[dict] = []
    if book.week is None or book.killed_week == book.week:
        return events
    pct = float(cfg.get("max_weekly_loss_pct") or 0)
    usd = float(cfg.get("max_weekly_loss_usd") or 0)
    streak = int(cfg.get("max_consecutive_loss_days") or 0)
    week_pnl = book.equity(marks) - book.week_start_equity
    hit = None
    if pct and week_pnl <= -book.week_start_equity * pct / 100:
        hit = f"weekly loss limit {pct:g}% hit"
    elif usd and week_pnl <= -usd:
        hit = f"weekly loss cutoff ${usd:g} reached"
    elif streak and book.loss_streak >= streak:
        hit = f"{streak} losing days in a row"
    if hit:
        book.killed_week = book.week
        for t in list(book.positions):
            tr = book.close(t, marks.get(t, book.positions[t]["entry_mid"]), now, "weekly loss cutoff", cfg)
            if tr:
                events.append({"type": "close", "trade": tr})
        events.append({"type": "kill", "at": now.isoformat(),
                       "reason": f"{hit} — flat, no entries until next week"})
    return events


def on_bar(book: Book, ticker: str, bar_time: datetime, bar: dict, pred_bps: float, atr: float,
           edge: dict, cfg: dict, auto: bool, close_dt: datetime, marks: dict[str, float],
           lt_stance: dict | None = None) -> tuple[dict, list]:
    """Process one completed 1m bar: exits first, then the decision, then (auto) execution.
    ``lt_stance`` is the Alpha Stack's long-term stance for this ticker; the
    backtests call this without one, so alignment never colors a measured edge."""
    events = []
    now = bar_time + timedelta(minutes=1)
    pos = book.positions.get(ticker)
    if pos:
        exit_px, why = None, None
        if pos["side"] == "long":
            if bar["low"] <= pos["stop"]:
                exit_px, why = min(pos["stop"], bar["open"]), "stop"
            elif bar["high"] >= pos["target"]:
                exit_px, why = max(pos["target"], bar["open"]), "target"
        else:
            if bar["high"] >= pos["stop"]:
                exit_px, why = max(pos["stop"], bar["open"]), "stop"
            elif bar["low"] <= pos["target"]:
                exit_px, why = min(pos["target"], bar["open"]), "target"
        if not why and now >= datetime.fromisoformat(pos["exit_by"]):
            exit_px, why = bar["close"], f"time exit ({cfg['horizon_min']} min)"
        if not why and (close_dt - now).total_seconds() <= cfg["flatten_min"] * 60:
            exit_px, why = bar["close"], "flatten before the close"
        take = float(cfg.get("take_profit_usd") or 0)
        if not why and take:
            gain = (bar["close"] - pos["entry_mid"]) * pos["qty"] * (1 if pos["side"] == "long" else -1)
            if gain >= take:
                exit_px, why = bar["close"], f"profit taken (${gain:.0f} up in the trade)"
        trail = float(cfg.get("trail_profit_usd") or 0)
        if not why and trail:
            gain = (bar["close"] - pos["entry_mid"]) * pos["qty"] * (1 if pos["side"] == "long" else -1)
            pos["peak_gain_usd"] = max(pos.get("peak_gain_usd", 0.0), gain)
            if pos["peak_gain_usd"] >= trail and gain < trail:
                exit_px, why = bar["close"], (f"profit trailed off (${gain:.0f} left of a "
                                               f"${pos['peak_gain_usd']:.0f} peak)")
        if why:
            t = book.close(ticker, exit_px, now, why, cfg)
            events.append({"type": "close", "trade": t})
    pos = book.positions.get(ticker)
    if pos:
        _ratchet_stop(pos, bar, cfg)
    events += _daily_lock(book, cfg, now, marks)
    events += _weekly_lock(book, cfg, now, marks)
    pos = book.positions.get(ticker)
    sig = decide(pred_bps, pos, edge, cfg, bar["close"], atr, now, close_dt, lt_stance=lt_stance)
    if auto:
        if sig["action"] == "exit" and pos:
            t = book.close(ticker, bar["close"], now, "model flipped", cfg)
            events.append({"type": "close", "trade": t})
        elif sig["action"] in ("buy", "sell") and not pos:
            side = "long" if sig["action"] == "buy" else "short"
            exit_by = min(now + timedelta(minutes=cfg["horizon_min"]),
                          close_dt - timedelta(minutes=cfg["flatten_min"]))
            p = book.open(ticker, side, bar["close"], now, sig["stop"], sig["target"], exit_by,
                          sig["reason"], cfg, marks)
            if p:
                events.append({"type": "open", "position": p})
    return sig, events


def edge_metrics(trades: list[dict], test_days: int, horizon: int) -> dict:
    n = len(trades)
    if not n:
        return {"trades": 0, "has_edge": False, "avg_net_bps": 0.0, "total_net_bps": 0.0,
                "win_rate_pct": None, "profit_factor": None, "avg_gross_bps": 0.0,
                "always_long_avg_net_bps": None, "test_days": test_days, "horizon_min": horizon}
    net = np.array([t["net_bps"] for t in trades])
    gross = np.array([t["gross_bps"] for t in trades])
    longb = np.array([t["long_net_bps"] for t in trades])
    wins, losses = net[net > 0].sum(), -net[net < 0].sum()
    return {
        "trades": n,
        "avg_net_bps": round(float(net.mean()), 2),
        "total_net_bps": round(float(net.sum()), 1),
        "avg_gross_bps": round(float(gross.mean()), 2),
        "win_rate_pct": round(float((net > 0).mean() * 100), 1),
        "profit_factor": round(float(wins / losses), 2) if losses > 0 else None,
        "always_long_avg_net_bps": round(float(longb.mean()), 2),
        "test_days": test_days,
        "horizon_min": horizon,
        "has_edge": None,          # set by edge_metrics' caller via edge_ok (depends on the gate knobs)
    }


def edge_ok(edge: dict, cfg: dict) -> bool:
    """The trade gate: enough test trades, and an average net result above
    the required margin. ``force_edge`` marks backtests/research replays."""
    if edge.get("force_edge"):
        return True
    dh = edge.get("direction_hit_pct")
    return bool((edge.get("trades") or 0) >= cfg["min_edge_trades"]
                and (edge.get("avg_net_bps") or 0) > cfg["min_edge_bps"]
                and dh is not None and dh >= cfg["min_direction_pct"])


def simulate(df: pd.DataFrame, preds: np.ndarray, days: list, ticker: str, cfg: dict) -> list[dict]:
    """Backtest the live rules over ``days`` for one ticker (edge gate forced on).

    The book here is a fake $10M account, so the absolute-dollar rules
    (daily_take_usd / max_daily_loss_usd / take_profit_usd / trail_profit_usd /
    max_weekly_loss_usd) are disabled: on a $10M book one trade swings more
    than every one of those thresholds, so they would fire on the FIRST trade
    and cut every test to one trade a day. The weekly-loss and losing-day
    guards are disabled for the same reason — those are live-account risk
    controls; the edge measurement must see the whole day and week."""
    scfg = {**cfg, "max_positions": 1,
            "daily_take_usd": 0.0, "max_daily_loss_usd": 0.0, "take_profit_usd": 0.0,
            "trail_profit_usd": 0.0,
            "max_weekly_loss_pct": 0.0, "max_weekly_loss_usd": 0.0, "max_consecutive_loss_days": 0}
    book = Book(scfg, {"start_equity": 1e7})
    atr = atr_px(df).values
    idx_days = _day_keys(df.index)
    o, h, l, c = (df[k].values for k in ("Open", "High", "Low", "Close"))
    force = {"force_edge": True}
    for d in days:
        b = session_bounds(d)
        if not b:
            continue
        for i in np.where(idx_days == _dkey(d))[0]:
            bt = df.index[i].to_pydatetime()
            bar = {"open": o[i], "high": h[i], "low": l[i], "close": c[i]}
            book.roll_day(d.isoformat(), {ticker: c[i]})
            on_bar(book, ticker, bt, bar, preds[i], atr[i], force, scfg, True, b[1], {ticker: c[i]})
        if ticker in book.positions:   # data ended early — close at the last bar
            j = np.where(idx_days == _dkey(d))[0][-1]
            book.close(ticker, c[j], df.index[j].to_pydatetime(), "session end", scfg)
    return book.trades


def model_key(ticker: str, cfg: dict, through: date) -> str:
    """Cache key: ticker + a hash of every knob that changes the model + date."""
    import hashlib
    spec = json.dumps({k: cfg[k] for k in sorted(knobs.RETRAIN_KEYS)}, sort_keys=True)
    return f"{ticker}_{hashlib.sha1(spec.encode()).hexdigest()[:10]}_{through.isoformat()}"


def train_ticker(ticker: str, through: date, cfg: dict, progress=None, persist: bool = True) -> dict:
    """Walk-forward edge + a final model trained through ``through``. Cached.
    ``progress(phase, step, steps, epoch=None, epochs=None)`` reports where it is."""
    report = progress or (lambda *a, **k: None)
    key = model_key(ticker, cfg, through)
    meta_path = MODEL_DIR / f"{key}.json"
    pt_path = MODEL_DIR / f"{key}.pt"
    if meta_path.exists() and pt_path.exists():
        return load_model(key)
    slots = _device_slots()
    dev = slots.get()
    try:
        return _train_ticker_on(ticker, through, cfg, report, key, meta_path, pt_path, dev, persist)
    finally:
        slots.put(dev)


def _train_ticker_on(ticker, through, cfg, report, key, meta_path, pt_path, dev, persist=True) -> dict:
    import torch
    h = int(cfg["horizon_min"])
    window = cfg.get("train_window", "year")
    t0 = time.time()
    report("loading price history", 0, 0)
    df = fetch_history(ticker, TRAIN_WINDOWS.get(window, 365))
    if df.empty:
        raise RuntimeError("no intraday bars returned")
    since = through - timedelta(days=TRAIN_WINDOWS.get(window, 365))
    dates = np.array(df.index.date)
    df = df[(dates <= through) & (dates > since)]
    days = sorted(set(df.index.date))
    if len(days) < MIN_SESSIONS:
        raise RuntimeError(f"only {len(days)} sessions of 1m bars in the {window} window")
    report("computing indicators", 0, 0)
    feats_all = features(df)          # once per ticker, shared by every fit/predict below
    n_folds = int(cfg["test_folds"])
    n_test = max(n_folds, int(round(len(days) * cfg["test_share_pct"] / 100)))
    test_days = days[-n_test:]
    folds = np.array_split(np.array(test_days, dtype=object), n_folds)
    oos_trades, hits, tot = [], 0, 0
    for k, fold in enumerate(folds, 1):
        fold = list(fold)
        if not fold:
            continue
        prior = [d for d in days if d < fold[0]]
        pack = fit(df, prior, cfg, feats_df=feats_all, on_epoch=lambda e, n, k=k: report("walk-forward test", k, len(folds) + 1, e, n), device=dev)
        preds = predict(pack, df, feats_all)
        oos_trades += simulate(df, preds, fold, ticker, cfg)
        y = forward_return(df, h) * 1e4
        m = np.isin(_day_keys(df.index), [_dkey(x) for x in fold]) & ~np.isnan(preds) & ~np.isnan(y) & (y != 0)
        hits += int((np.sign(preds[m]) == np.sign(y[m])).sum())
        tot += int(m.sum())
    edge = edge_metrics(oos_trades, len(test_days), h)
    edge["direction_hit_pct"] = round(hits / tot * 100, 1) if tot else None
    edge["has_edge"] = edge_ok(edge, cfg)
    pack = fit(df, days, cfg, feats_df=feats_all, on_epoch=lambda e, n: report("final model", len(folds) + 1, len(folds) + 1, e, n), device=dev)
    meta = {"ticker": ticker, "key": key, "through": through.isoformat(), "horizon_min": h,
            "trained_at": datetime.now(ET).isoformat(), "sessions": len(days),
            "train_window": window,
            "bars": int(len(df)), "edge": edge, "train_seconds": round(time.time() - t0, 1),
            "device": pack["dev"], "mu": pack["mu"].tolist(), "sd": pack["sd"].tolist(),
            "y_sd": pack["y_sd"],
            "features": pack["features"], "look_back": pack["look_back"], "units": pack["units"],
            "knobs": {k: cfg[k] for k in sorted(knobs.RETRAIN_KEYS)},
            "model": f"CfC liquid NN ({pack['units']} units), {pack['look_back']}-bar look-back, {len(pack['features'])} features"}
    if not persist:
        # Throwaway model (an honest replay): used in memory, never saved.
        return {"meta": meta, "pack": pack}
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(pack["net"].state_dict(), pt_path)
    _atomic_write(meta_path, meta)
    for old in MODEL_DIR.glob(f"{ticker}_*.json"):
        if old.name != meta_path.name and old.stem.split("_")[-1] < (through - timedelta(days=10)).isoformat():
            old.unlink(missing_ok=True)
            old.with_suffix(".pt").unlink(missing_ok=True)
    return load_model(key)


def load_model(key: str) -> dict:
    import torch
    meta = json.loads((MODEL_DIR / f"{key}.json").read_text(encoding="utf-8"))
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    net = _net_class(len(meta["features"]), meta["units"])().to(dev)
    net.load_state_dict(torch.load(MODEL_DIR / f"{key}.pt", map_location=dev))
    net.eval()
    return {"meta": meta, "pack": {"net": net, "mu": np.array(meta["mu"]), "sd": np.array(meta["sd"]),
                                   "y_sd": meta["y_sd"], "dev": dev, "horizon": meta["horizon_min"],
                                   "features": meta["features"], "look_back": meta["look_back"], "units": meta["units"]}}


def last_session(before: date | None = None) -> date:
    """Most recent completed session (strictly before ``before`` if given)."""
    now = datetime.now(ET)
    d = before - timedelta(days=1) if before else now.date()
    while True:
        b = session_bounds(d)
        if b and (before or now >= b[1]):
            return d
        d -= timedelta(days=1)


# ---------------------------------------------------------------------------
# Long-term stance (the Alpha Stack's view of each ticker)
# ---------------------------------------------------------------------------

# app.py installs the stance source: tickers -> {ticker: stance | None}, where
# a stance is {"direction": "bullish"|"bearish"|None, "reason": str, ...}.
# The engine never imports app.py (which imports this module), so the bridge
# is a callback. Without one, or when it fails, signals simply show no stance.
_STANCE_FN = None
_STANCE_LOCK = threading.Lock()
_STANCE_CACHE: dict[str, tuple[float, dict | None]] = {}
_STANCE_TTL = 60.0  # the source reads report dirs + the ledger; once a minute is plenty


def set_stance_provider(fn) -> None:
    """Install app.py's stance source (TradingAgents rating, Liquid NN call,
    long-term holdings)."""
    global _STANCE_FN
    _STANCE_FN = fn


def long_term_stances(tickers: list[str]) -> dict[str, dict | None]:
    """Per-ticker long-term stance, cached for a minute so the live loop
    (which asks under the engine lock, once per snapshot) stays cheap."""
    out: dict[str, dict | None] = {}
    missing: list[str] = []
    now = time.time()
    with _STANCE_LOCK:
        for t in tickers:
            hit = _STANCE_CACHE.get(t)
            if hit and now - hit[0] < _STANCE_TTL:
                out[t] = hit[1]
            else:
                missing.append(t)
    if missing:
        fresh: dict[str, dict] = {}
        if _STANCE_FN is not None:
            try:
                fresh = _STANCE_FN(missing) or {}
            except Exception as exc:
                log(f"long-term stance fetch failed: {exc}")
        with _STANCE_LOCK:
            for t in missing:
                stance = fresh.get(t)
                _STANCE_CACHE[t] = (now, stance)
                out[t] = stance
    return out


# ---------------------------------------------------------------------------
# Engine (singleton): state, trainer queue, live loop, replay, stream
# ---------------------------------------------------------------------------

class Engine:
    def __init__(self):
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)
        self.seq = 0
        self.tickers_fn = lambda: []
        self.cfg = dict(DEFAULT_CONFIG)
        self.engine_on = False
        self.book: Book | None = None
        self.models: dict[str, dict] = {}         # ticker -> loaded model (live)
        self.model_state: dict[str, str] = {}     # ticker -> ready|queued|training|error:<msg>
        self.hist: dict[str, pd.DataFrame] = {}
        self.last_bar: dict[str, pd.Timestamp] = {}
        self.signals: dict[str, dict] = {}
        self.prices: dict[str, dict] = {}
        self.events: list[dict] = []
        self.mode = "off"
        self.replay: dict | None = None
        self.replay_req: dict | None = None
        self.replay_stop = False
        self.wake = threading.Event()
        self.train_q: list[tuple[str, date]] = []
        self.training: set[str] = set()
        self.train_threads: list[threading.Thread] = []
        # The dashboard's training panel: one run = one batch of queued tickers.
        self.train_run: dict | None = None
        self.train_stop = threading.Event()
        self.thread: threading.Thread | None = None
        self.last_error: str | None = None
        self.last_tick: str | None = None
        self.changed_at: dict[str, str] = {}
        self._replay_book: Book | None = None
        self._load()

    # -- persistence ------------------------------------------------------
    def _load(self) -> None:
        data = {}
        if STATE_FILE.exists():
            try:
                data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {}
        saved = data.get("config") or {}
        if data.get("knobs_version") != KNOBS_VERSION:
            saved = {k: v for k, v in saved.items() if k in KEEP_ON_UPGRADE}
        self.cfg = {**DEFAULT_CONFIG, **{k: v for k, v in saved.items() if k in DEFAULT_CONFIG}}
        self.engine_on = bool(data.get("engine_on"))
        self.shared = SharedAccount()
        self.book = Book(self.cfg, data.get("account"), shared=self.shared)

    def _save(self) -> None:
        _atomic_write(STATE_FILE, {"config": self.cfg, "knobs_version": KNOBS_VERSION, "engine_on": self.engine_on,
                                   "account": self.book.to_dict()})

    def tickers(self) -> list[str]:
        """Override list if set, else portfolio ∪ watchlist plus the extras."""
        t = [x.strip().upper() for x in (self.cfg.get("tickers") or []) if x.strip()]
        if t:
            return t
        base = [x.upper() for x in self.tickers_fn()]
        return list(dict.fromkeys(base + [x.upper() for x in self.cfg.get("extra_tickers") or []]))

    # -- publish ----------------------------------------------------------
    def _bump(self) -> None:
        with self.cond:
            self.seq += 1
            self.cond.notify_all()

    def wait_seq(self, seq: int, timeout: float) -> int:
        with self.cond:
            if self.seq == seq:
                self.cond.wait(timeout)
            return self.seq

    # -- trainer ----------------------------------------------------------
    def request_models(self, tickers: list[str], through: date) -> None:
        with self.lock:
            for t in tickers:
                cur = self.models.get(t)
                if cur and cur["meta"]["key"] == model_key(t, self.cfg, through):
                    continue
                if (t, through) not in self.train_q and t not in self.training:
                    self.train_q.append((t, through))
                    self.model_state[t] = "queued"
                    # Track the batch for the dashboard's training panel.
                    run = self.train_run
                    if not run or run.get("finished"):
                        free_gpu_from_ollama()
                        self.train_stop.clear()
                        run = self.train_run = {"started": time.time(), "window": self.cfg.get("train_window", "year"),
                                                "tickers": [], "done": [], "current": {}, "finished": None}
                    if t not in run["tickers"]:
                        run["tickers"].append(t)
            self.train_threads = [th for th in self.train_threads if th.is_alive()]
            set_train_workers(int(self.cfg["train_workers"]))
            want = min(len(self.train_q), _SLOTS_N - len(self.train_threads))
            for _ in range(max(0, want)):
                th = threading.Thread(target=self._train_loop, name="daytrade-trainer", daemon=True)
                self.train_threads.append(th)
                th.start()
        self._bump()

    def train_all(self) -> tuple[int, dict]:
        """Dashboard "Train models": queue every ticker (portfolio ∪ watchlist
        unless overridden) on the current window + horizon. Already-current
        models are skipped; a ticker that errored earlier is tried again."""
        if self.mode == "replay":
            return 409, {"ok": False, "error": "a replay is running — train after it finishes"}
        tickers = self.tickers()
        with self.lock:
            for t in tickers:
                if str(self.model_state.get(t, "")).startswith("error"):
                    self.model_state.pop(t, None)
        self.request_models(tickers, self._model_through())
        with self.lock:
            queued = [t for t, _ in self.train_q] + sorted(self.training)
        return 202, {"ok": True, "tickers": tickers, "queued": queued,
                     "train_window": self.cfg.get("train_window", "year")}

    def load_saved_models(self) -> None:
        """After a restart, pick up models already trained on the current
        settings (loads from disk; never trains). The newest saved model for
        those settings is used whatever its training cut-off date — keying on
        today's cut-off would drop every model the day after it was trained."""
        through = self._model_through()
        for t in self.tickers():
            prefix = model_key(t, self.cfg, through).rsplit("_", 1)[0]
            found = sorted(p for p in MODEL_DIR.glob(f"{prefix}_*.json") if p.with_suffix(".pt").exists())
            if not found:
                continue
            key = found[-1].stem
            try:
                m = load_model(key)
                with self.lock:
                    self.models[t] = m
                    self.model_state[t] = "ready"
                self._idle_eval(t)
            except Exception as exc:
                log(f"{t}: could not load saved model: {exc}")
        self._bump()

    def stop_training(self) -> tuple[int, dict]:
        """Cancel queued tickers and interrupt running ones at their next
        epoch. Models that already finished are kept."""
        with self.lock:
            if not self.train_q and not self.training:
                return 409, {"ok": False, "error": "no training is running"}
            cancelled = [t for t, _ in self.train_q]
            self.train_q.clear()
            for t in cancelled:
                self.model_state.pop(t, None)
            run = self.train_run
            if run:
                run["done"] += [{"ticker": t, "ok": False, "error": "stopped", "seconds": 0} for t in cancelled]
            interrupted = sorted(self.training)
            self.train_stop.set()
        self._bump()
        return 200, {"ok": True, "cancelled": cancelled, "interrupting": interrupted}

    # -- model saves -------------------------------------------------------
    @staticmethod
    def _set_dir(name: str) -> Path | None:
        import re
        slug = re.sub(r"[^A-Za-z0-9._ +$-]", "", str(name or "")).strip()[:60]
        return MODEL_SETS_DIR / slug if slug else None

    def list_model_sets(self) -> dict:
        sets = []
        for f in sorted(MODEL_SETS_DIR.glob("*/set.json")):
            try:
                sets.append(json.loads(f.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError) as exc:
                log(f"unreadable model save {f.parent.name}: {exc}")
        sets.sort(key=lambda s: s.get("saved_at", ""), reverse=True)
        return {"ok": True, "sets": sets}

    def save_model_set(self, name: str, note: str = "") -> tuple[int, dict]:
        """Copy every loaded model + the settings it was trained with into a
        named save, so it can be restored after other models are trained."""
        import shutil
        dest = self._set_dir(name)
        if dest is None:
            return 400, {"ok": False, "error": "give the save a name"}
        with self.lock:
            if not self.models:
                return 409, {"ok": False, "error": "no trained models to save"}
            models = {t: m["meta"] for t, m in self.models.items()}
            cfg = dict(self.cfg)
        if dest.exists():
            return 409, {"ok": False, "error": f"a save named '{dest.name}' already exists — pick another name or delete it first"}
        tmp = dest.with_name(dest.name + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        for t, meta in models.items():
            for ext in (".json", ".pt"):
                shutil.copy2(MODEL_DIR / f"{meta['key']}{ext}", tmp / f"{meta['key']}{ext}")
        info = {
            "name": dest.name, "note": str(note or "")[:300],
            "saved_at": datetime.now(ET).isoformat(timespec="seconds"),
            "tickers": sorted(models),
            "keys": {t: meta["key"] for t, meta in models.items()},
            "trained_through": sorted({meta.get("through") for meta in models.values()})[-1],
            "train_window": cfg.get("train_window"), "horizon_min": cfg.get("horizon_min"),
            "model_knobs": {k: cfg[k] for k in sorted(knobs.RETRAIN_KEYS)},
            "settings": {k: v for k, v in cfg.items() if k not in knobs.RETRAIN_KEYS},
            "edge": {t: {"avg_net_bps": (meta.get("edge") or {}).get("avg_net_bps"),
                         "trades": (meta.get("edge") or {}).get("trades")} for t, meta in models.items()},
        }
        (tmp / "set.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
        tmp.rename(dest)
        log(f"model save '{dest.name}': {len(models)} models")
        return 200, {"ok": True, "set": info}

    def load_model_set(self, name: str, with_settings: bool = True) -> tuple[int, dict]:
        """Put a saved model set back: its model files, the model settings it
        was trained with (so the keys match), and — unless with_settings is
        false — the trading settings it was saved with."""
        import shutil
        src = self._set_dir(name)
        if src is None or not (src / "set.json").exists():
            return 404, {"ok": False, "error": f"no model save named '{name}'"}
        info = json.loads((src / "set.json").read_text(encoding="utf-8"))
        with self.lock:
            if self.train_q or self.training:
                return 409, {"ok": False, "error": "training is running — stop it first"}
            if self.mode == "replay":
                return 409, {"ok": False, "error": "a replay is running — load after it finishes"}
            MODEL_DIR.mkdir(parents=True, exist_ok=True)
            for f in src.iterdir():
                if f.suffix in (".json", ".pt") and f.name != "set.json":
                    shutil.copy2(f, MODEL_DIR / f.name)
            new = dict(self.cfg)
            new.update({k: v for k, v in info.get("model_knobs", {}).items() if k in DEFAULT_CONFIG})
            if with_settings:
                new.update({k: v for k, v in info.get("settings", {}).items() if k in DEFAULT_CONFIG})
            self.cfg = new
            self._save()
            self.models.clear()
            self.signals.clear()
            self.last_bar.clear()
            self.model_state.clear()
            for t, key in info.get("keys", {}).items():
                try:
                    self.models[t] = load_model(key)
                    self.model_state[t] = "ready"
                except Exception as exc:
                    self.model_state[t] = f"error: {exc}"
        for t in list(self.models):
            self._idle_eval(t)
        self._bump()
        log(f"model save '{info['name']}' loaded ({len(self.models)} models, settings={'yes' if with_settings else 'no'})")
        return 200, {"ok": True, "set": info, "loaded": sorted(self.models)}

    def delete_model_set(self, name: str) -> tuple[int, dict]:
        import shutil
        src = self._set_dir(name)
        if src is None or not src.exists():
            return 404, {"ok": False, "error": f"no model save named '{name}'"}
        shutil.rmtree(src)
        return 200, {"ok": True}

    def clear_models(self) -> tuple[int, dict]:
        """Delete every saved day-trading model; all tickers go back to untrained."""
        with self.lock:
            if self.train_q or self.training:
                return 409, {"ok": False, "error": "training is running — stop it first"}
            removed = 0
            for f in MODEL_DIR.glob("*"):
                if f.suffix in (".json", ".pt"):
                    f.unlink(missing_ok=True)
                    removed += 1
            self.models.clear()
            self.model_state.clear()
            self.signals.clear()
            self.last_bar.clear()
            self.train_run = None
        self._bump()
        return 200, {"ok": True, "removed_files": removed}

    def _train_loop(self) -> None:
        while True:
            with self.lock:
                if not self.train_q:
                    return
                t, through = self.train_q.pop(0)
                self.training.add(t)
                self.model_state[t] = "training"
                run = self.train_run
                if run:
                    run["current"][t] = {"ticker": t, "phase": "waiting for a GPU slot", "step": 0, "steps": 0,
                                         "epoch": None, "epochs": None, "since": time.time()}
            self._bump()

            def progress(phase, step, steps, epoch=None, epochs=None, t=t, run=run):
                if self.train_stop.is_set():
                    raise TrainingStopped()
                cur = run and run["current"].get(t)
                if cur:
                    cur.update(phase=phase, step=step, steps=steps, epoch=epoch, epochs=epochs)
                    self._bump()

            t_start = time.time()
            try:
                m = train_ticker(t, through, dict(self.cfg), progress)
                with self.lock:
                    self.models[t] = m
                    self.model_state[t] = "ready"
                log(f"{t} model through {through}: {m['meta']['edge']}")
                if run:
                    e = m["meta"].get("edge") or {}
                    run["done"].append({"ticker": t, "ok": True, "seconds": round(time.time() - t_start, 1),
                                        "sessions": m["meta"].get("sessions"), "has_edge": bool(e.get("has_edge")),
                                        "avg_net_bps": e.get("avg_net_bps"), "trades": e.get("trades")})
                if self.mode != "live":
                    self._idle_eval(t)
            except TrainingStopped:
                with self.lock:
                    self.model_state.pop(t, None)
                if run:
                    run["done"].append({"ticker": t, "ok": False, "error": "stopped",
                                        "seconds": round(time.time() - t_start, 1)})
            except Exception as exc:
                log(f"{t} training failed: {exc}\n{traceback.format_exc()}")
                with self.lock:
                    self.model_state[t] = f"error: {exc}"
                if run:
                    run["done"].append({"ticker": t, "ok": False, "error": str(exc),
                                        "seconds": round(time.time() - t_start, 1)})
            with self.lock:
                self.training.discard(t)
                batch_over = not self.train_q and not self.training
                if run:
                    run["current"].pop(t, None)
                    if batch_over:
                        run["finished"] = time.time()
            if batch_over:
                # The batch is over (finished or stopped): hand the GPU memory
                # PyTorch was caching back to the system, so VRAM drops right away.
                free_gpu_memory()
            self.wake.set()
            self._bump()

    def _idle_eval(self, t: str) -> None:
        """Signal as of the last completed bar while the engine isn't live
        (e.g. after hours). Runs against a scratch copy of the book with
        auto-execute off, so it never changes the account."""
        try:
            df = fetch_recent([t], "5d").get(t)
            if df is None or df.empty:
                return
            self.hist[t] = df
            now = datetime.now(ET)
            done = df[df.index + pd.Timedelta(minutes=1) <= now]
            if done.empty:
                return
            last = done.index[-1]
            b = session_bounds(last.date())
            with self.lock:
                scratch = Book(self.cfg, copy.deepcopy(self.book.to_dict()))
                self.prices[t] = {"price": float(done["Close"].iloc[-1]), "bar_time": last.isoformat(),
                                  "fetched_at": now.isoformat()}
                self._evaluate(t, done, last.to_pydatetime(), b[1], {}, live=False,
                               book=scratch, auto=False)
            self._bump()
        except Exception as exc:
            log(f"{t} idle eval failed: {exc}")

    # -- lifecycle --------------------------------------------------------
    def boot(self, tickers_fn) -> None:
        self.tickers_fn = tickers_fn
        # Long-term link: paper.py reads the link settings from this engine and
        # asks it whether it will time a long-term order intraday.
        import paper
        paper.set_link(lambda: self.cfg, self._engine_fills)
        threading.Thread(target=self.load_saved_models, name="daytrade-load-models", daemon=True).start()
        self.thread = threading.Thread(target=self._run, name="daytrade-engine", daemon=True)
        self.thread.start()
        if self.engine_on:
            log("engine was on before restart — resuming live mode with open positions")
            self.start()

    def start(self) -> dict:
        with self.lock:
            self.engine_on = True
            self._save()
        self.request_models(self.tickers(), self._model_through())
        self.wake.set()
        return {"ok": True, "engine_on": True}

    def stop(self) -> dict:
        with self.lock:
            self.engine_on = False
            if self.replay and not self.replay.get("done"):
                self.replay_stop = True
            self._save()
        self.wake.set()
        self._bump()
        return {"ok": True, "engine_on": False}

    def _model_through(self) -> date:
        """Live models train through the last completed session."""
        return last_session()

    # -- engine thread ----------------------------------------------------
    def _run(self) -> None:
        next_price = 0.0
        while True:
            try:
                req = None
                with self.lock:
                    if self.replay_req:
                        req, self.replay_req = self.replay_req, None
                if req:
                    self._do_replay(req)
                    continue
                clock = market_clock()
                if self.engine_on and clock["open"]:
                    self.mode = "live"
                    if time.time() >= next_price:
                        next_price = time.time() + PRICE_POLL_S
                        self._live_tick()
                elif self.engine_on:
                    self.mode = "closed"
                else:
                    self.mode = "off"
                self._bump() if self.mode != "live" else None
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                log(f"engine error: {self.last_error}\n{traceback.format_exc()}")
            self.wake.wait(1.0 if self.mode == "live" else 15.0)
            self.wake.clear()

    def _live_tick(self) -> None:
        tickers = self.tickers()
        now = datetime.now(ET)
        today = now.date()
        b = session_bounds(today)
        # Models through the last completed session; queue any missing.
        self.request_models(tickers, self._model_through())
        need_hist = [t for t in tickers if t not in self.hist
                     or (len(self.hist[t]) and self.hist[t].index[-1].date() < today - timedelta(days=6))]
        if need_hist:
            for t, df in fetch_recent(need_hist, "5d").items():
                self.hist[t] = df
        recent = fetch_recent(tickers, "1d")
        self.last_tick = now.isoformat()
        marks = {}
        for t in tickers:
            df = recent.get(t)
            if df is None or df.empty:
                continue
            h = self.hist.get(t, pd.DataFrame())
            h = pd.concat([h, df]) if not h.empty else df
            h = h[~h.index.duplicated(keep="last")].sort_index()
            self.hist[t] = h.tail(3000)
            last_ts = df.index[-1]
            self.prices[t] = {"price": float(df["Close"].iloc[-1]), "bar_time": last_ts.isoformat(),
                              "fetched_at": now.isoformat()}
            marks[t] = float(df["Close"].iloc[-1])
        with self.lock:
            self.book.roll_day(today.isoformat(), marks)
            for t in tickers:
                h = self.hist.get(t)
                if h is None or h.empty:
                    continue
                done = h[h.index + pd.Timedelta(minutes=1) <= now]   # completed bars only
                if done.empty:
                    continue
                last = done.index[-1]
                if self.last_bar.get(t) == last:
                    continue
                self.last_bar[t] = last
                self._evaluate(t, done, last.to_pydatetime(), b[1], marks, live=True)
            self._kill_switch(marks, now)
            self._save()
        self._bump()

    def _evaluate(self, t: str, done: pd.DataFrame, bar_time: datetime, close_dt: datetime,
                  marks: dict, live: bool, preds: np.ndarray | None = None, i: int | None = None,
                  models: dict | None = None, book: Book | None = None, auto: bool | None = None,
                  ignore_edge: bool = False) -> None:
        models = models if models is not None else self.models
        book = book or self.book
        m = models.get(t)
        row = done.iloc[-1]
        bar = {"open": float(row["Open"]), "high": float(row["High"]), "low": float(row["Low"]),
               "close": float(row["Close"])}
        if self.cfg.get("signal_source") == "move":
            # Plain move: no model and no edge gate — the knobs are the rulebook.
            m = {"meta": {"edge": {}}}
            edge = {}
            pred = move_bps(done, self.cfg["horizon_min"])
            a = float(atr_px(done.tail(200)).iloc[-1])
            sig, events = on_bar(book, t, bar_time, bar, pred, a, {"force_edge": True}, self.cfg,
                                 self.cfg["auto_execute"] if auto is None else auto, close_dt, marks,
                                 lt_stance=long_term_stances([t]).get(t))
            for e in events:
                e["ticker"] = t
                e["at"] = (bar_time + timedelta(minutes=1)).isoformat()
                self.events.append(e)
            self.events = self.events[-50:]
        elif m is None:
            state = self.model_state.get(t, "queued")
            sig = {"call": "STAND ASIDE", "action": "none", "pred_bps": None, "threshold_bps": None,
                   "entry": None, "stop": None, "target": None,
                   "reason": f"model {state}" if not state.startswith("error") else state}
            edge = {}
        else:
            edge = m["meta"]["edge"]
            # AI mode (default): the net's calls trade on every ticker.
            # Edge mode: only tickers that passed the edge test trade.
            gate = edge if self.cfg.get("trade_mode") == "edge" and not ignore_edge else {**edge, "force_edge": True}
            if preds is not None:
                pred = preds[i]
            else:
                tail = done.tail(600)
                pred = float(predict(m["pack"], tail)[-1])
            a = float(atr_px(done.tail(200)).iloc[-1])
            sig, events = on_bar(book, t, bar_time, bar, pred, a, gate, self.cfg,
                                 self.cfg["auto_execute"] if auto is None else auto, close_dt, marks,
                                 lt_stance=long_term_stances([t]).get(t))
            for e in events:
                e["ticker"] = t
                e["at"] = (bar_time + timedelta(minutes=1)).isoformat()
                self.events.append(e)
            self.events = self.events[-50:]
        prev = self.signals.get(t, {}).get("call")
        if prev != sig["call"]:
            self.changed_at[t] = (bar_time + timedelta(minutes=1)).isoformat()
        spark = [round(float(x), 4) for x in done["Close"].tail(60).values]
        self.signals[t] = {**sig, "ticker": t, "bar_time": bar_time.isoformat(), "bar_close": bar["close"],
                           "changed_from": prev if prev and prev != sig["call"] else None,
                           "edge": edge, "spark": spark,
                           "confidence_pct": edge.get("win_rate_pct") if sig["call"] in ("BUY NOW", "SELL NOW") else None}
        if live:
            self._lt_execute(t, sig, bar_time, close_dt, bar["close"])

    # -- long-term link: the day trader places TradingAgents' orders ---------
    def _engine_fills(self, pending: dict) -> bool:
        """paper.resolve_pending asks: will the engine time this order? Yes
        while it runs live and the link says the day trader places orders."""
        return bool(self.engine_on and self.cfg.get("lt_execution") == "day_trader")

    def _lt_orders(self) -> list[dict]:
        hit = getattr(self, "_lt_cache", None)
        if hit and time.time() - hit[0] < 20:
            return hit[1]
        import paper
        orders = paper.pending_orders()
        self._lt_cache = (time.time(), orders)
        return orders

    @staticmethod
    def _order_side(rows: list[dict]) -> str:
        """buy or sell: the direction the order's last row trades (a reversal
        is close + open, so the open decides)."""
        r = rows[-1]
        if r.get("close_existing") or r.get("partial_close"):
            return "buy" if float(r.get("qty") or 0) > 0 else "sell"
        return "sell" if (r.get("intent") or {}).get("action") == "sell" else "buy"

    def _lt_execute(self, t: str, sig: dict, bar_time: datetime, close_dt: datetime, price: float) -> None:
        """Fill this ticker's pending long-term orders when the day trader's
        own call agrees with the order's direction, or at market once the
        deadline (lt_fill_deadline_min before the close) is reached."""
        if self.cfg.get("lt_execution") != "day_trader":
            return
        mine = [o for o in self._lt_orders() if o.get("ticker") == t]
        if not mine:
            return
        import paper
        deadline = (close_dt - bar_time).total_seconds() / 60 <= int(self.cfg.get("lt_fill_deadline_min", 30))
        for ref in dict.fromkeys(o.get("decision_ref") for o in mine):
            rows = [o for o in mine if o.get("decision_ref") == ref]
            side = self._order_side(rows)
            agrees = sig.get("call") == ("BUY NOW" if side == "buy" else "SELL NOW")
            if not (agrees or deadline):
                continue
            how = "timed with its call" if agrees else "deadline, at market"
            done = paper.fill_pending_now(ref, price, bar_time.isoformat(), how)
            if done:
                self._lt_cache = None
                if self.book and self.book.shared:
                    self.book.shared._snap = None
                with _STANCE_LOCK:
                    _STANCE_CACHE.pop(t, None)
                self.events.append({"type": "lt_fill", "ticker": t, "at": bar_time.isoformat(),
                                    "reason": f"long-term {side} filled at {price:.2f} — {how}"})
                log(f"long-term order {ref} ({t} {side}) filled at {price:.2f}: {how}")

    def _kill_switch(self, marks: dict, now: datetime) -> None:
        book = self.book
        if book.killed_day == book.day or not book.positions and book.realized_today >= 0:
            return
        eq = book.equity(marks)
        if eq - book.day_start_equity <= -book.day_start_equity * self.cfg["max_daily_loss_pct"] / 100:
            for t in list(book.positions):
                book.close(t, marks.get(t, book.positions[t]["entry_mid"]), now, "daily loss limit", self.cfg)
            book.killed_day = book.day
            self.events.append({"type": "kill", "at": now.isoformat(),
                                "reason": f"daily loss limit {self.cfg['max_daily_loss_pct']}% hit — flat, no entries until tomorrow"})

    # -- manual actions ---------------------------------------------------
    def manual(self, ticker: str, action: str) -> tuple[int, dict]:
        ticker = ticker.upper()
        with self.lock:
            now = datetime.now(ET)
            price = (self.prices.get(ticker) or {}).get("price")
            if price is None:
                return 409, {"ok": False, "error": f"no live price for {ticker} yet"}
            b = session_bounds(now.date())
            if not (b and b[0] <= now < b[1]):
                return 409, {"ok": False, "error": "market is closed — paper fills need a live price"}
            marks = {t: p["price"] for t, p in self.prices.items()}
            self.book.roll_day(now.date().isoformat(), marks)
            if action == "close":
                t = self.book.close(ticker, price, now, "manual", self.cfg)
                if not t:
                    return 409, {"ok": False, "error": f"no open {ticker} position"}
                self._save()
                self._bump()
                return 200, {"ok": True, "trade": t}
            if action not in ("buy", "sell"):
                return 400, {"ok": False, "error": "action must be buy, sell or close"}
            sig = self.signals.get(ticker) or {}
            h = self.hist.get(ticker)
            a = float(atr_px(h.tail(200)).iloc[-1]) if h is not None and len(h) > 20 else price * 1e-3
            sigma = max(a * math.sqrt(self.cfg["horizon_min"]), price * 1e-4)
            side = "long" if action == "buy" else "short"
            sgn = 1 if side == "long" else -1
            stop = sig.get("stop") if sig.get("action") == action and sig.get("stop") else price - sgn * self.cfg["stop_sigma"] * sigma
            target = sig.get("target") if sig.get("action") == action and sig.get("target") else price + sgn * self.cfg["target_sigma"] * sigma
            exit_by = min(now + timedelta(minutes=self.cfg["horizon_min"]), b[1] - timedelta(minutes=self.cfg["flatten_min"]))
            p = self.book.open(ticker, side, price, now, stop, target, exit_by, "manual", self.cfg, marks)
            if not p:
                return 409, {"ok": False, "error": "not opened (already in a position, position limit, kill switch, or size < 1 share)"}
            self._save()
            self._bump()
            return 200, {"ok": True, "position": p}

    def reset(self) -> dict:
        with self.lock:
            # Clears the intraday book only; the shared paper account (and the
            # P&L day trades already posted to it) is reset from its own panel.
            self.book = Book(self.cfg, shared=self.shared)
            self._save()
        self._bump()
        return {"ok": True}

    def set_config(self, body: dict) -> tuple[int, dict]:
        """Partial update, each value validated against its knob in knobs.py.
        Changing any model knob drops the current models (Train models or the
        live engine's start retrains them)."""
        try:
            body = self.set_cost(body)
        except (TypeError, ValueError):
            return 400, {"ok": False, "error": "cost_bps: must be a number"}
        with self.lock:
            new = dict(self.cfg)
            for k, v in body.items():
                if k not in knobs.BY_KEY:
                    continue
                try:
                    new[k] = knobs.coerce(k, v)
                except ValueError as exc:
                    return 400, {"ok": False, "error": str(exc), "key": k}
            return self._apply_config(new)

    def reset_config(self, group: str | None = None) -> tuple[int, dict]:
        """Restore defaults for one knob group, or all of them."""
        if group and group not in {g["id"] for g in knobs.GROUPS}:
            return 400, {"ok": False, "error": f"unknown group {group}"}
        with self.lock:
            new = dict(self.cfg)
            for k in knobs.KNOBS:
                if not group or k["group"] == group:
                    new[k["key"]] = DEFAULT_CONFIG[k["key"]]
            return self._apply_config(new)

    def _apply_config(self, new: dict) -> tuple[int, dict]:
        retrain = any(new[k] != self.cfg.get(k) for k in knobs.RETRAIN_KEYS)
        self.cfg = new
        if retrain:
            self.models.clear()
            self.signals.clear()
            self.last_bar.clear()
            for t in list(self.model_state):
                if self.model_state[t] not in ("queued", "training"):
                    self.model_state.pop(t)
        self._save()
        engine_on = self.engine_on
        if retrain and engine_on:
            self.request_models(self.tickers(), self._model_through())
        self._bump()
        return 200, {"ok": True, "config": self.cfg, "retrain_needed": retrain and not engine_on}

    def knob_catalog(self) -> dict:
        with self.lock:
            return knobs.catalog(self.cfg)

    # -- replay -----------------------------------------------------------
    def start_replay(self, body: dict) -> tuple[int, dict]:
        with self.lock:
            if self.mode == "live" and self.book.positions:
                return 409, {"ok": False, "error": "live engine has open positions — replay runs when it is flat or the market is closed"}
            if self.replay and not self.replay.get("done"):
                return 409, {"ok": False, "error": "a replay is already running"}
            tickers = [t.strip().upper() for t in (body.get("tickers") or []) if str(t).strip()] or self.tickers()
            speed = float(body.get("speed") or self.cfg["replay_speed"])
            # A replay covers one ISO week (Mon–Fri): "week" = "YYYY-Www";
            # a "date" picks the week containing it; neither = the latest week.
            try:
                if body.get("week"):
                    y, w = str(body["week"]).split("-W")
                    monday = date.fromisocalendar(int(y), int(w), 1)
                elif body.get("date"):
                    d0 = date.fromisoformat(str(body["date"]))
                    monday = d0 - timedelta(days=d0.weekday())
                else:
                    d0 = last_session()
                    monday = d0 - timedelta(days=d0.weekday())
            except (ValueError, TypeError):
                return 400, {"ok": False, "error": "week must be YYYY-Www (e.g. 2026-W38)"}
            last = last_session()
            sessions = [monday + timedelta(days=i) for i in range(5)]
            sessions = [d for d in sessions if session_bounds(d) and d <= last]
            if not sessions:
                return 400, {"ok": False, "error": f"no completed sessions in the week of {monday}"}
            if (datetime.now(ET).date() - sessions[0]).days > history_days() - 7:
                return 400, {"ok": False, "error": f"that week is outside the {history_days()}-day history"}
            mode = str(body.get("model") or "current")
            if mode not in ("current", "fresh"):
                return 400, {"ok": False, "error": "model must be current or fresh"}
            if self.cfg.get("signal_source") == "move":
                missing = []            # plain move: no models needed
            elif mode == "current":
                missing = [t for t in tickers if t not in self.models]
                tickers = [t for t in tickers if t in self.models]
                if not tickers:
                    return 409, {"ok": False, "error": "no trained models — press Train models, or replay with model=fresh"}
            else:
                missing = []
            iso = monday.isocalendar()
            self.replay_req = {"tickers": tickers, "speed": max(0.5, min(speed, 120.0)),
                               "auto": bool(body.get("auto", True)),
                               "week": f"{iso[0]}-W{iso[1]:02d}", "sessions": [d.isoformat() for d in sessions],
                               "model": mode, "skipped_untrained": missing,
                               # research only: trade the model's calls even where it has no edge
                               "ignore_edge": bool(body.get("ignore_edge", False))}
            self.replay_stop = False
        self.wake.set()
        return 202, {"ok": True, **self.replay_req}

    def stop_replay(self) -> tuple[int, dict]:
        with self.lock:
            if not self.replay or self.replay.get("done"):
                return 409, {"ok": False, "error": "no replay running"}
            self.replay_stop = True
        return 202, {"ok": True}

    def _do_replay(self, req: dict) -> None:
        """Replay one week, session by session, then score the week.
        model="current": the trained live models (fast; the week is usually
        inside their training data, so results are in-sample). model="fresh":
        each ticker retrained only on sessions before the week (honest test)."""
        sessions = [date.fromisoformat(d) for d in req["sessions"]]
        tickers = req["tickers"]
        fresh = req["model"] == "fresh"
        through = last_session(before=sessions[0])
        self.mode = "replay"
        first_b = session_bounds(sessions[0])
        rep = {"session": req["week"], "week": req["week"], "sessions": req["sessions"], "model": req["model"],
               "trained_through": through.isoformat() if fresh else None, "in_sample": False,
               "tickers": tickers, "speed": req["speed"], "auto": req["auto"],
               "phase": "training" if fresh else "loading", "skipped_untrained": req.get("skipped_untrained", []),
               "progress": 0.0, "clock": first_b[0].isoformat(), "done": False, "summary": None,
               "trades": [], "trained": 0, "ignore_edge": req.get("ignore_edge", False)}
        self.replay = rep
        saved = (self.signals, self.events)
        self.signals, self.events = {}, []
        self._bump()
        models, data, preds = {}, {}, {}
        for t in tickers:
            if self.replay_stop:
                break
            try:
                df = fetch_history(t)
                df = df[np.array(df.index.date) <= sessions[-1]]
                if self.cfg.get("signal_source") == "move":
                    data[t], preds[t] = df, None      # signal computed per bar from the prices
                else:
                    m = train_ticker(t, through, dict(self.cfg), persist=False) if fresh else self.models[t]
                    models[t], data[t] = m, df
                    preds[t] = predict(m["pack"], df)
            except Exception as exc:
                log(f"replay {t}: {exc}")
                if fresh:
                    self.model_state[t] = f"error: {exc}"
            rep["trained"] += 1
            self._bump()
        if not fresh:
            thr = sorted({m["meta"]["through"] for m in models.values()})
            rep["trained_through"] = thr[-1] if thr else None
            rep["in_sample"] = bool(thr and thr[-1] >= sessions[0].isoformat())
        # Replay never touches the shared account, but it sizes from the same
        # money so its dollars mean what live dollars would.
        try:
            start = self.shared.equity()
        except Exception as exc:
            log(f"replay: shared account unavailable ({exc}); sizing from start_equity")
            start = self.cfg["start_equity"]
        book = Book(self.cfg, {"start_equity": start})
        rep["phase"] = "replaying"
        pos_idx = {t: {ts: i for i, ts in enumerate(df.index)} for t, df in data.items()}
        calls: dict[str, int] = {}
        self._replay_book = book
        plan = []
        for d in sessions:
            b = session_bounds(d)
            plan += [(d, b, ts) for ts in pd.date_range(b[0], b[1] - timedelta(minutes=1), freq="1min", tz=ET)]
        for k, (d, b, ts) in enumerate(plan):
            if self.replay_stop:
                break
            book.roll_day(d.isoformat(), {})
            marks = {}
            for t, df in data.items():
                i = pos_idx[t].get(ts)
                if i is None:
                    continue
                marks[t] = float(df["Close"].iloc[i])
                self.prices[t] = {"price": marks[t], "bar_time": ts.isoformat(), "fetched_at": ts.isoformat()}
            with self.lock:
                for t, df in data.items():
                    i = pos_idx[t].get(ts)
                    if i is None:
                        continue
                    self._evaluate(t, df.iloc[:i + 1], ts.to_pydatetime(), b[1], marks, live=False,
                                   preds=preds[t], i=i, models=models, book=book, auto=req["auto"],
                                   ignore_edge=req.get("ignore_edge", False))
                    c = self.signals[t]["call"]
                    calls[c] = calls.get(c, 0) + 1
                rep["clock"] = (ts + timedelta(minutes=1)).isoformat()
                rep["progress"] = round((k + 1) / len(plan), 4)
                rep["marks"] = marks
            self._bump()
            time.sleep(1.0 / req["speed"])
        net = [t["net_bps"] for t in book.trades]
        rep["summary"] = {
            "trades": len(book.trades),
            "pnl": round(sum(t["pnl"] for t in book.trades), 2),
            "net_bps_total": round(float(sum(net)), 1),
            "avg_net_bps": round(float(np.mean(net)), 2) if net else None,
            "win_rate_pct": round(float(np.mean([x > 0 for x in net]) * 100), 1) if net else None,
            "calls": calls,
            "week": req["week"],
            "model": req["model"],
            "in_sample": rep.get("in_sample", False),
            # The week is the unit that's scored; days are shown for context.
            "per_day": [{"date": d, "trades": len([x for x in book.trades if x["closed_at"][:10] == d]),
                         "pnl": round(sum(x["pnl"] for x in book.trades if x["closed_at"][:10] == d), 2)}
                        for d in req["sessions"]],
            "stopped_early": self.replay_stop,
            "ignore_edge": req.get("ignore_edge", False),
            "per_ticker": {t: {"trades": len([x for x in book.trades if x["ticker"] == t]),
                               "pnl": round(sum(x["pnl"] for x in book.trades if x["ticker"] == t), 2),
                               "net_bps": round(sum(x["net_bps"] for x in book.trades if x["ticker"] == t), 1)}
                           for t in data},
            "per_ticker_edge": {t: m["meta"]["edge"] for t, m in models.items()},
        }
        rep["trades"] = book.trades[-100:]
        rep["phase"] = "done"
        rep["done"] = True
        self._replay_book = None
        self.signals, self.events = saved
        self.mode = "off"
        log(f"replay {req['week']}: {rep['summary']}")
        self._bump()
        # Models that finished training while the replay held the board.
        for t in [t for t in self.models if t not in self.signals]:
            self._idle_eval(t)

    # -- snapshot ---------------------------------------------------------
    @staticmethod
    def _edge_out(edge: dict, cfg: dict) -> dict | None:
        if not edge or "trades" not in edge:
            return None
        return {**edge, "net_bps_per_trade": edge.get("avg_net_bps"),
                "beats_flat": edge_ok(edge, cfg),
                "cost_bps": round_trip_bps(cfg)}

    def snapshot(self) -> dict:
        """Status + signals in one payload (the stream sends this). Contract
        fields (market/engine/positions/…) sit alongside the engine's own."""
        with self.lock:
            replaying = self.mode == "replay"
            book = (self._replay_book if replaying else None) or self.book
            marks = (self.replay or {}).get("marks", {}) if replaying else {t: p["price"] for t, p in self.prices.items()}
            now = datetime.now(ET)
            clock = market_clock()
            rows = []
            names = (self.replay or {}).get("tickers", []) if replaying else self.tickers()
            # The long-term stance shown on every card (annotation only; the
            # lt_align knob decides whether decide() also gates entries).
            lt_stances = long_term_stances(names)
            for t in names:
                sig = dict(self.signals.get(t) or {
                    "ticker": t, "call": "STAND ASIDE", "action": "none", "pred_bps": None,
                    "entry": None, "stop": None, "target": None, "edge": {},
                    "reason": f"model {self.model_state.get(t, 'not trained')}"})
                sig["lt"] = lt_stances.get(t) or None
                pr = self.prices.get(t)
                sig["last_price"] = pr["price"] if pr else sig.get("bar_close")
                sig["bar_age_s"] = None
                if pr and not replaying:
                    bt = datetime.fromisoformat(pr["bar_time"])
                    sig["bar_age_s"] = max(0, int((now - bt).total_seconds()) - 60)
                pos = book.positions.get(t)
                if pos:
                    m = marks.get(t, pos["entry_mid"])
                    sgn = 1 if pos["side"] == "long" else -1
                    pos = {**pos, "mark": m, "unrealized": round((m - pos["entry"]) * pos["qty"] * sgn, 2),
                           "upnl": round((m - pos["entry"]) * pos["qty"] * sgn, 2),
                           "unrealized_pct": round(sgn * (m / pos["entry"] - 1) * 100, 3)}
                sig["position"] = pos
                raw_state = "ready" if (replaying or t in self.models) else self.model_state.get(t, "untrained")
                sig["model_detail"] = raw_state
                sig["model_state"] = ("ready" if raw_state == "ready"
                                      else "error" if str(raw_state).startswith("error")
                                      else "untrained" if raw_state == "untrained" else "training")
                meta = (self.models.get(t) or {}).get("meta")
                if meta and not replaying:
                    sig["model_through"] = meta["through"]
                sig["edge"] = self._edge_out(sig.get("edge") or (meta or {}).get("edge") or {}, self.cfg)
                sig["pred_return_bps"] = sig.get("pred_bps")
                sig["horizon_min"] = self.cfg["horizon_min"]
                wr = (sig["edge"] or {}).get("win_rate_pct")
                sig["confidence"] = round(wr / 100, 3) if wr is not None and sig["call"] in ("BUY NOW", "SELL NOW") else None
                sig["changed_at"] = self.changed_at.get(t)
                # While the engine is off (never in replay, live or closed)
                # the cards show prices only — a call appears once the engine
                # runs, not from the idle pass that populates the panel.
                if self.mode == "off":
                    sig["call"], sig["action"] = "OFF", "none"
                    sig["reason"] = "engine off — press Start live; calls appear once the engine runs"
                rows.append(sig)
            eq = book.equity(marks)
            today_trades = [x for x in book.trades if (x.get("closed_at") or "")[:10] == (book.day or "")]
            positions = []
            for r in rows:
                p = r.get("position")
                if p:
                    positions.append({"ticker": p["ticker"], "side": p["side"], "qty": p["qty"],
                                      "entry": p["entry"], "stop": p["stop"], "target": p["target"],
                                      "mark": p["mark"], "upnl": p["upnl"], "opened_at": p["opened_at"],
                                      "exit_by": p["exit_by"]})
            cash = book.cash()
            killed = book.killed_day == book.day and book.day is not None
            account = {
                "paper": True, "cash": round(cash, 2), "equity": round(eq, 2),
                "shared": bool(book.shared),
                "start_equity": book.shared.start_equity() if book.shared else book.start_equity,
                "day": book.day,
                # Until a session rolls the book's day, there is no "today" P&L.
                "pnl_today": round(eq - book.day_start_equity, 2) if book.day == now.date().isoformat() else 0.0,
                "day_pnl": round(eq - book.day_start_equity, 2) if book.day == now.date().isoformat() else 0.0,
                "realized_today": round(book.realized_today, 2),
                "unrealized": round(book.unrealized(marks), 2),
                "kill_switch": killed, "killed": killed,
                "open_positions": len(book.positions), "trades_today": len(today_trades),
            }
            today = now.date()
            if clock["open"]:
                next_close = clock["closes_at"]
            else:
                nb = session_bounds(datetime.fromisoformat(clock["next_open"]).date())
                next_close = nb[1].isoformat()
            market = {"open": clock["open"], "now_et": now.isoformat(),
                      "next_open": clock.get("next_open"), "next_close": next_close,
                      "seconds_to_open": clock.get("seconds_to_open"),
                      "seconds_to_close": clock.get("seconds_to_close"),
                      "holiday": today.isoformat() in HOLIDAYS}
            rep = self.replay
            engine = {"running": self.engine_on or replaying,
                      "mode": "replay" if replaying else ("live" if self.engine_on else "off"),
                      "replay": ({"date": rep["session"], "speed": rep["speed"],
                                  "progress_pct": round(rep["progress"] * 100, 1), "phase": rep["phase"],
                                  "clock": rep["clock"], "trained": rep["trained"],
                                  "tickers": len(rep["tickers"]),
                                  "ignore_edge": rep.get("ignore_edge", False)} if replaying and rep else None),
                      "last_tick": self.last_tick}
            config = {**self.cfg, "cost_bps": round_trip_bps(self.cfg)}
            tr = self.train_run
            training = None
            if tr:
                running = []
                for c in tr["current"].values():
                    c = dict(c)
                    c["elapsed_s"] = round(time.time() - c.pop("since"), 1)
                    running.append(c)
                training = {"window": tr["window"], "total": len(tr["tickers"]), "done": list(tr["done"]),
                            "running": running, "workers": _SLOTS_N,
                            "queued": [t for t, _ in self.train_q],
                            "elapsed_s": round((tr["finished"] or time.time()) - tr["started"], 1),
                            "finished": bool(tr["finished"])}
            return {
                "training": training,
                "seq": self.seq,
                "asof": now.isoformat(),
                "mode": self.mode,
                "engine_on": self.engine_on,
                "market": market,
                "engine": engine,
                "clock": clock,
                "updated_at": now.isoformat(),
                "config": config,
                "round_trip_bps": round_trip_bps(self.cfg),
                "account": account,
                "positions": positions,
                "tickers": rows,
                "events": self.events[-20:],
                "replay": {k: v for k, v in (rep or {}).items() if k != "marks"} or None,
                "trainer": {"training": sorted(self.training), "queued": [t for t, _ in self.train_q]},
                "last_error": self.last_error,
                "paper_only": True,
                "data_note": ("Yahoo 1-minute bars, regular session. bar_age_s = seconds since the bar closed; "
                              "Yahoo quotes can lag the tape."),
            }

    def signals_payload(self, snap: dict | None = None) -> dict:
        snap = snap or self.snapshot()
        return {"asof": snap["asof"], "tickers": snap["tickers"]}

    def stream_payload(self) -> dict:
        snap = self.snapshot()
        status = {k: snap[k] for k in ("market", "engine", "config", "account", "positions")}
        return {**snap, "status": status, "signals": self.signals_payload(snap)}

    def trades(self) -> dict:
        with self.lock:
            return {"trades": list(reversed(self.book.fills[-300:])),
                    "round_trips": list(reversed(self.book.trades[-200:])),
                    "replay_trades": list(reversed((self.replay or {}).get("trades", [])))}

    def longterm_payload(self) -> dict:
        """The engine's state for the Alpha Stack view: today's $-lock status,
        realized day P&L, open day positions and each watched ticker's
        measured edge — the intraday half of the shared paper account."""
        with self.lock:
            book = self.book
            now = datetime.now(ET)
            marks = {t: p["price"] for t, p in self.prices.items()}
            clock = market_clock()
            day = book.day
            today = day == now.date().isoformat()
            banked = bool(day and book.banked_day == day)
            killed = bool(day and book.killed_day == day)
            lock_reason = None
            if day:
                for e in reversed(self.events):
                    if e.get("type") in ("bank", "kill") and str(e.get("at") or "").startswith(day):
                        lock_reason = e.get("reason")
                        break
            per = []
            for t in self.tickers():
                meta = (self.models.get(t) or {}).get("meta") or {}
                edge = self._edge_out(meta.get("edge") or (self.signals.get(t) or {}).get("edge") or {},
                                      self.cfg)
                pos = book.positions.get(t)
                p = None
                if pos:
                    m = marks.get(t, pos["entry_mid"])
                    sgn = 1 if pos["side"] == "long" else -1
                    p = {"side": pos["side"], "qty": pos["qty"],
                         "unrealized": round((m - pos["entry"]) * pos["qty"] * sgn, 2)}
                state = "ready" if t in self.models else self.model_state.get(t, "untrained")
                per.append({"ticker": t,
                             "call": (self.signals.get(t) or {}).get("call"),
                             "model_state": "error" if str(state).startswith("error")
                                            else "ready" if state == "ready" else "untrained" if state == "untrained" else "training",
                             "edge": edge,
                             "has_edge": bool(edge and edge.get("beats_flat")),
                             "position": p})
            return {
                "asof": now.isoformat(),
                "engine_on": self.engine_on,
                "mode": self.mode,
                "auto_execute": bool(self.cfg.get("auto_execute")),
                "market_open": clock["open"],
                "paper": True,
                "account": {
                    "day_pnl": round(book.equity(marks) - book.day_start_equity, 2) if today else 0.0,
                    "realized_today": round(book.realized_today, 2) if today else 0.0,
                    "open_positions": len(book.positions),
                    "trades_today": len([x for x in book.trades
                                         if (x.get("closed_at") or "")[:10] == day]) if today else 0,
                    "week_pnl": round(book.equity(marks) - book.week_start_equity, 2) if book.week else 0.0,
                },
                "banked": banked,
                "killed": killed,
                "week_killed": bool(book.week and book.killed_week == book.week),
                "loss_streak": book.loss_streak,
                "lock_reason": lock_reason,
                "tickers": per,
            }

    def context_line(self, ticker: str) -> str:
        """One factual line about the engine for the TradingAgents quant
        context: its state today, and this ticker's measured intraday edge."""
        with self.lock:
            book = self.book
            day = book.day
            bits = []
            if book.week and book.killed_week == book.week:
                bits.append("the day-trade engine is cut for the week (weekly loss limit reached)")
            elif day and book.banked_day == day:
                bits.append("the day-trade engine is banked for today (daily profit lock reached)")
            elif day and book.killed_day == day:
                bits.append("the day-trade engine is cut for the day (daily loss cutoff reached)")
            elif self.engine_on:
                bits.append("the day-trade engine is running today")
            else:
                bits.append("the day-trade engine is off")
            m = self.models.get(ticker.upper())
        if m:
            e = (m.get("meta") or {}).get("edge") or {}
            if e.get("trades"):
                if (e.get("avg_net_bps") or 0) > 0:
                    bits.append(f"its intraday model shows {e['avg_net_bps']:+.1f} bps per trade "
                                f"after costs over {e['trades']} out-of-sample trades")
                else:
                    bits.append(f"its intraday model has no measured edge after costs "
                                f"({e.get('avg_net_bps') or 0:+.1f} bps per trade over {e['trades']} out-of-sample trades)")
            else:
                bits.append("its intraday model is untested")
        else:
            bits.append("it has no trained intraday model")
        return "; ".join(bits)

    def set_cost(self, body: dict) -> dict:
        """Contract ``cost_bps`` (round trip) → spread + slippage, keeping
        their current proportion (round trip = spread + 2 × slippage)."""
        if "cost_bps" in body and "spread_bps" not in body and "slippage_bps" not in body:
            total = float(body["cost_bps"])
            cur = round_trip_bps(self.cfg) or 1.0
            body = {**body, "spread_bps": self.cfg["spread_bps"] * total / cur,
                    "slippage_bps": self.cfg["slippage_bps"] * total / cur}
        return body


ENGINE = Engine()
