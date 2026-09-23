"""Liquid Neural Network next-day forecaster for the alpha stack.

Adapted from HusseinJammal/Liquid-Neural-Networks-in-Stock-Market-Prediction
(Apache-2.0, cloned at trading/LiquidNN). Kept from upstream: the 28-feature
technical-indicator set (MACD 14/21/9, pivots, momentum, ATR, SMA/EMA, RSI,
Bollinger 14/2, OBV, stochastics, Fibonacci levels, ROC, returns), the 80/20
chronological split and a 10-day look-back predicting the next close.
Changed: features are made scale-free and the net predicts the next-day
return (not the price level), scaling is fit on the training slice only;
upstream ships TensorFlow .h5 weights for AAPL/TSLA only and
its "LTCCell" is a plain tanh RNN; here each ticker gets a real liquid
time-constant network (ncps CfC, torch) trained on its own history, and
pandas_ta is replaced by the equivalent pure-pandas formulas.

Results are cached per ticker per trading day under
``.alpha-stack/liquid/``; the evaluation reports the model's test-set error
next to a naive "tomorrow = today" baseline so the forecast can be judged
honestly rather than taken on faith.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

LOOK_BACK = 10
EPOCHS = 60
UNITS = 32
PERIOD = "5y"

CACHE_DIR = Path(__file__).resolve().parent.parent / ".alpha-stack" / "liquid"

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()

FEATURES = [
    "Open", "High", "Low", "Close", "Volume",
    "MACD", "MACDh", "MACDs", "Daily Returns", "5-Day Momentum", "14-Day ATR",
    "14 Day SMA", "14 Day EMA", "14-Day RSI",
    "BBL", "BBM", "BBU", "BBB", "BBP", "OBV",
    "STOCHk_14", "STOCHd_14", "STOCHk_3", "STOCHd_3",
    "Fib 38.2%", "Fib 50%", "Fib 61.8%", "3 Day ROC",
]


def _yf_symbol(ticker: str) -> str:
    crypto_roots = {"BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "MATIC"}
    if ticker.upper() in crypto_roots and "-" not in ticker:
        return ticker.upper() + "-USD"
    return ticker


def fetch_ohlcv(ticker: str, period: str = PERIOD) -> pd.DataFrame:
    df = yf.download(_yf_symbol(ticker), period=period, interval="1d",
                     progress=False, auto_adjust=True)
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df[["Open", "High", "Low", "Close", "Volume"]].dropna()


def _stoch(df: pd.DataFrame, k: int, d: int, smooth: int) -> tuple[pd.Series, pd.Series]:
    lo = df["Low"].rolling(k).min()
    hi = df["High"].rolling(k).max()
    raw = 100 * (df["Close"] - lo) / (hi - lo).replace(0, np.nan)
    k_line = raw.rolling(smooth).mean()
    return k_line, k_line.rolling(d).mean()


def feature_engineering(df: pd.DataFrame) -> pd.DataFrame:
    """Upstream's indicator set, in pure pandas (auto-adjusted Close = Adj Close)."""
    d = df.copy()
    c = d["Close"]

    ema_fast = c.ewm(span=14, adjust=False).mean()
    ema_slow = c.ewm(span=21, adjust=False).mean()
    d["MACD"] = ema_fast - ema_slow
    d["MACDs"] = d["MACD"].ewm(span=9, adjust=False).mean()
    d["MACDh"] = d["MACD"] - d["MACDs"]

    d["5-Day Momentum"] = c - c.shift(5)

    prev = c.shift(1)
    tr = pd.concat([d["High"] - d["Low"], (d["High"] - prev).abs(), (d["Low"] - prev).abs()], axis=1).max(axis=1)
    d["14-Day ATR"] = tr.ewm(alpha=1 / 14, adjust=False).mean()

    d["14 Day SMA"] = c.rolling(14).mean()
    d["14 Day EMA"] = c.ewm(span=14, adjust=False).mean()

    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    d["14-Day RSI"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))

    mid = c.rolling(14).mean()
    std = c.rolling(14).std(ddof=0)
    d["BBM"], d["BBU"], d["BBL"] = mid, mid + 2 * std, mid - 2 * std
    d["BBB"] = 100 * (d["BBU"] - d["BBL"]) / mid
    d["BBP"] = (c - d["BBL"]) / (d["BBU"] - d["BBL"]).replace(0, np.nan)

    d["OBV"] = (np.sign(delta).fillna(0) * d["Volume"]).cumsum()

    d["STOCHk_14"], d["STOCHd_14"] = _stoch(d, 14, 3, 3)
    d["STOCHk_3"], d["STOCHd_3"] = _stoch(d, 3, 3, 3)

    span = d["High"].max() - d["Low"].min()
    lo = d["Low"].min()
    d["Fib 38.2%"] = 0.382 * span + lo
    d["Fib 50%"] = 0.5 * span + lo
    d["Fib 61.8%"] = 0.618 * span + lo

    d["3 Day ROC"] = c.pct_change(periods=3)
    d["Daily Returns"] = c.pct_change()
    return d.replace([np.inf, -np.inf], np.nan).dropna()


def _windows(x: np.ndarray, look_back: int) -> np.ndarray:
    """Window i covers rows i .. i+look_back-1 (ends on row i+look_back-1)."""
    return np.stack([x[i:i + look_back] for i in range(len(x) - look_back + 1)]).astype(np.float32)


PRICE_COLS = ["Open", "High", "Low", "14 Day SMA", "14 Day EMA", "BBL", "BBM", "BBU",
              "Fib 38.2%", "Fib 50%", "Fib 61.8%"]


def _stationary(feats: pd.DataFrame) -> pd.DataFrame:
    """Upstream's features re-expressed scale-free so the net sees the same
    ranges at any price level: price levels as a ratio to that day's close,
    price differences as a fraction of close, volume/OBV as rolling z-scores."""
    c = feats["Close"]
    out = pd.DataFrame(index=feats.index)
    for col in FEATURES:
        v = feats[col]
        if col in PRICE_COLS:
            out[col] = v / c - 1
        elif col == "Close":
            out[col] = c.pct_change()
        elif col in ("MACD", "MACDh", "MACDs", "5-Day Momentum", "14-Day ATR"):
            out[col] = v / c
        elif col in ("Volume", "OBV"):
            base = v.diff() if col == "OBV" else v
            out[col] = (base - base.rolling(60).mean()) / base.rolling(60).std()
        else:
            out[col] = v
    return out.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def _train_and_predict(df: pd.DataFrame) -> dict:
    import torch
    from ncps.torch import CfC

    feats = feature_engineering(df)
    x_raw = _stationary(feats).values.astype(np.float64)
    close = feats["Close"].values.astype(np.float64)
    # Target: next-day return. Predicting the raw price level (as upstream
    # does) cannot extrapolate past the training range — a stock at new highs
    # gets forecast back into the old range.
    ret_next = np.append(close[1:] / close[:-1] - 1, np.nan)

    split = int(len(feats) * 0.8)
    # Standardise on the training slice only — upstream fit its scaler on the
    # whole series, which leaks future ranges into the test metrics.
    mu, sd = x_raw[:split].mean(0), x_raw[:split].std(0)
    sd = np.where(sd == 0, 1.0, sd)
    xs = (x_raw - mu) / sd
    y_mu, y_sd = np.nanmean(ret_next[:split]), np.nanstd(ret_next[:split]) or 1.0
    ys = ((ret_next - y_mu) / y_sd)[:, None]

    X = _windows(xs, LOOK_BACK)          # X[j] ends on row j + LOOK_BACK - 1
    end = np.arange(LOOK_BACK - 1, len(xs))
    Y = ys[end].astype(np.float32)
    train = end < split - 1                # target (row end+1) inside the training slice
    test = (end >= split - 1) & ~np.isnan(Y[:, 0])
    X_tr, Y_tr, X_te = X[train], Y[train], X[test]

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(0)

    class Net(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.rnn = CfC(len(FEATURES), UNITS, batch_first=True)
            self.head = torch.nn.Linear(UNITS, 1)

        def forward(self, x):
            out, _ = self.rnn(x)
            return self.head(out[:, -1])

    net = Net().to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = torch.nn.MSELoss()
    xt = torch.from_numpy(X_tr).to(dev)
    yt = torch.from_numpy(Y_tr).to(dev)
    net.train()
    for _ in range(EPOCHS):
        perm = torch.randperm(len(xt), device=dev)
        for i in range(0, len(xt), 64):
            idx = perm[i:i + 64]
            opt.zero_grad()
            loss = loss_fn(net(xt[idx]), yt[idx])
            loss.backward()
            opt.step()

    net.eval()
    with torch.no_grad():
        pred_ret = net(torch.from_numpy(X_te).to(dev)).cpu().numpy()[:, 0] * y_sd + y_mu
        next_ret = float(net(torch.from_numpy(X[-1:]).to(dev)).cpu().numpy()[0, 0] * y_sd + y_mu)

    today = close[end[test]]
    actual = close[end[test] + 1]
    pred = today * (1 + pred_ret)
    err = pred - actual
    naive_err = today - actual
    rmse = float(np.sqrt(np.mean(err ** 2)))
    naive_rmse = float(np.sqrt(np.mean(naive_err ** 2)))
    mape = float(np.mean(np.abs(err / actual)) * 100)
    moved = actual != today
    dir_acc = float(np.mean(np.sign(pred - today)[moved] == np.sign(actual - today)[moved]) * 100)
    up_share = float(np.mean((actual > today)[moved]) * 100)

    last_close = float(close[-1])
    next_close = last_close * (1 + next_ret)
    return {
        "last_close": round(last_close, 4),
        "last_date": str(feats.index[-1].date()),
        "predicted_close": round(next_close, 4),
        "predicted_change_pct": round((next_close / last_close - 1) * 100, 3),
        "direction": "up" if next_close > last_close else "down",
        "eval": {
            "test_days": int(len(actual)),
            "rmse": round(rmse, 4),
            "naive_rmse": round(naive_rmse, 4),
            "beats_naive": rmse < naive_rmse,
            "mape_pct": round(mape, 3),
            "directional_accuracy_pct": round(dir_acc, 1),
            "always_up_accuracy_pct": round(up_share, 1),
        },
        "model": f"CfC liquid NN ({UNITS} units), look-back {LOOK_BACK}d, {EPOCHS} epochs, {len(FEATURES)} features",
        "device": dev,
    }


def _lock_for(ticker: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(ticker, threading.Lock())


def _cache_path(ticker: str) -> Path:
    return CACHE_DIR / f"{ticker.upper().replace('/', '_')}.json"


def cached(ticker: str) -> dict | None:
    p = _cache_path(ticker)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def forecast(ticker: str, force: bool = False) -> dict:
    """Next-day liquid-NN forecast for ``ticker``; trains at most once per day."""
    ticker = ticker.strip().upper()
    with _lock_for(ticker):
        today = datetime.now().strftime("%Y-%m-%d")
        hit = cached(ticker)
        if hit and not force and hit.get("trained_on") == today:
            return hit
        df = fetch_ohlcv(ticker)
        if len(df) < 200:
            return {"ticker": ticker, "error": f"not enough price history ({len(df)} rows)"}
        t0 = time.time()
        result = {"ticker": ticker, **_train_and_predict(df)}
        result["trained_on"] = today
        result["train_seconds"] = round(time.time() - t0, 1)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(ticker).write_text(json.dumps(result, indent=2), encoding="utf-8")
        return result


def context_line(ticker: str) -> str:
    """One-line summary for the TradingAgents quant context."""
    r = forecast(ticker)
    if "error" in r:
        return ""
    e = r["eval"]
    return (f"liquid-NN next-day close {r['predicted_close']:.2f} "
            f"({r['predicted_change_pct']:+.2f}%; test directional accuracy "
            f"{e['directional_accuracy_pct']:.0f}%, "
            f"{'beats' if e['beats_naive'] else 'does not beat'} naive baseline)")


# ---------------------------------------------------------------------------
# Background trainer — one worker thread, one ticker at a time, so the list
# view's "pending" tickers really are being trained (serialised to keep a
# single model on the GPU at once).
# ---------------------------------------------------------------------------

_QUEUE: list[str] = []
_QUEUE_LOCK = threading.Lock()
_WORKER: threading.Thread | None = None
_TRAINING: str | None = None


def _worker_loop() -> None:
    global _WORKER, _TRAINING
    while True:
        with _QUEUE_LOCK:
            if not _QUEUE:
                _WORKER = None
                _TRAINING = None
                return
            ticker = _QUEUE.pop(0)
            _TRAINING = ticker
        try:
            r = forecast(ticker)
            if "error" in r:
                _write_error(ticker, r["error"])
        except Exception as exc:  # one ticker's failure never stops the queue
            _write_error(ticker, str(exc))


def _write_error(ticker: str, msg: str) -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(ticker).write_text(json.dumps(
        {"ticker": ticker.upper(), "error": msg, "trained_on": today}), encoding="utf-8")


def enqueue(tickers: list[str]) -> None:
    """Queue tickers for background training (dedup) and start the worker."""
    global _WORKER
    with _QUEUE_LOCK:
        for t in tickers:
            t = t.strip().upper()
            if t and t not in _QUEUE and t != _TRAINING:
                _QUEUE.append(t)
        if _QUEUE and _WORKER is None:
            _WORKER = threading.Thread(target=_worker_loop, name="liquid-trainer", daemon=True)
            _WORKER.start()


def queue_state() -> dict:
    with _QUEUE_LOCK:
        return {"training": _TRAINING, "queued": list(_QUEUE)}


def today_cached(ticker: str) -> dict | None:
    """Cached result only if it is from today (a stale day counts as pending)."""
    hit = cached(ticker)
    if hit and hit.get("trained_on") == datetime.now().strftime("%Y-%m-%d"):
        return hit
    return None
