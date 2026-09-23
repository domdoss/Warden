"""Quant signal helpers for the alpha-stack dashboard.

Pure-pandas/numpy + stdlib urllib where possible. No heavy optional deps:
spaCy / GluonTS are deliberately NOT imported here (see the extensions doc
notes). These functions compute regime, portfolio correlation heat, order-flow
imbalance (Binance depth snapshot), perp funding rate, and backtest metrics,
and fetch the price history they need via yfinance (already in the venv).
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

# yfinance is present in the venv (scripts/ingest.py already depends on it).
import yfinance as yf


# ---------------------------------------------------------------------------
# Price history (shared, lightly cached in-process)
# ---------------------------------------------------------------------------

_PRICE_CACHE: dict[tuple[str, str], pd.Series] = {}
_PRICE_CACHE_TS: dict[tuple[str, str], float] = {}
_PRICE_TTL = 600.0  # 10 minutes


def close_series(ticker: str, period: str = "1y") -> pd.Series:
    """Return a close-price series for ``ticker`` (yfinance), cached briefly.

    Crypto tickers map to yfinance symbols (e.g. BTC -> BTC-USD); we let
    yfinance resolve suffixes and fall back to the raw symbol.
    """
    import time

    now = time.time()
    # Keyed on (ticker, period): a "1y" answer must never be served to a
    # "2y" caller just because it arrived first.
    key = (ticker, period)
    if key in _PRICE_CACHE and (now - _PRICE_CACHE_TS.get(key, 0.0)) < _PRICE_TTL:
        return _PRICE_CACHE[key]

    sym = ticker
    # yfinance expects BTC-USD style for crypto; only munge obvious crypto roots.
    crypto_roots = {"BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "MATIC"}
    if ticker.upper() in crypto_roots and "-" not in ticker:
        sym = ticker.upper() + "-USD"
    try:
        df = yf.download(sym, period=period, interval="1d", progress=False, auto_adjust=True)
    except Exception:
        df = pd.DataFrame()
    if df is None or df.empty:
        return pd.Series(dtype=float)
    close = df["Close"].squeeze() if "Close" in df else df.iloc[:, 0]
    close = pd.Series(close, name=ticker).dropna()
    _PRICE_CACHE[key] = close
    _PRICE_CACHE_TS[key] = now
    return close


def close_frame(tickers: list[str], period: str = "1y") -> pd.DataFrame:
    """Return an aligned close-price DataFrame, columns = tickers."""
    cols = {t: close_series(t, period) for t in tickers}
    cols = {t: s for t, s in cols.items() if s is not None and len(s)}
    if not cols:
        return pd.DataFrame()
    frame = pd.DataFrame(cols)
    return frame


# ---------------------------------------------------------------------------
# 1. Regime detection (Hurst exponent + volatility percentile)
# ---------------------------------------------------------------------------

def detect_regime(df: pd.DataFrame, lookback: int = 60) -> str:
    """Classify the recent price regime from a close series or OHLCV frame.

    Returns one of: trending, mean_reverting, high_volatility, random_walk,
    unknown. Uses the rescaled-range (Hurst) estimate via the std-of-differences
    across lags, plus a volatility percentile relative to the longer window.
    """
    if df is None or df.empty:
        return "unknown"
    close = df["close"] if "close" in df else df.squeeze()
    close = pd.Series(close).dropna()
    returns = close.pct_change().dropna()
    if len(returns) < lookback:
        return "unknown"

    lags = list(range(2, 20))
    try:
        # Use the raw ndarray: np.subtract on pandas Series aligns by index and
        # silently zeroes the overlapping-but-unaligned terms.
        r = returns.to_numpy()
        tau = [np.std(r[lag:] - r[:-lag]) for lag in lags]
        # Guard against zero/NaN before fitting in log space.
        pts = [(math.log(l), math.log(t)) for l, t in zip(lags, tau) if t and t > 0]
        if len(pts) < 3:
            return "unknown"
        xs = np.array([p[0] for p in pts])
        ys = np.array([p[1] for p in pts])
        slope = np.polyfit(xs, ys, 1)[0]
        hurst = slope * 2.0
    except Exception:
        return "unknown"

    recent_vol = returns.rolling(lookback).std().iloc[-1]
    long_vol = returns.rolling(252).std().iloc[-1] if len(returns) >= 252 else None
    if long_vol and long_vol > 0 and not math.isnan(long_vol):
        vol_percentile = float(recent_vol / long_vol) if not math.isnan(recent_vol) else 0.5
    else:
        vol_percentile = 0.5

    if vol_percentile > 0.8:
        return "high_volatility"
    if hurst > 0.55:
        return "trending"
    if hurst < 0.45:
        return "mean_reverting"
    return "random_walk"


def regime_for_ticker(ticker: str) -> str:
    """Convenience: regime from the cached daily close history."""
    s = close_series(ticker)
    if s is None or s.empty:
        return "unknown"
    return detect_regime(pd.DataFrame({"close": s}))


# ---------------------------------------------------------------------------
# 2. Portfolio correlation heat
# ---------------------------------------------------------------------------

def portfolio_heat(tickers: list[str], price_df: pd.DataFrame | None = None) -> tuple[float, list[str]]:
    """Max pairwise |correlation| among held tickers' daily returns.

    Returns (heat, list_of_tickers_used). <2 usable series -> (0.0, []).
    """
    if len(tickers) < 2:
        return 0.0, []
    if price_df is None:
        price_df = close_frame(tickers)
    if price_df is None or price_df.empty or price_df.shape[1] < 2:
        return 0.0, []
    usable = [t for t in price_df.columns if price_df[t].notna().sum() > 5]
    if len(usable) < 2:
        return 0.0, usable
    rets = price_df[usable].pct_change().dropna()
    if rets.empty:
        return 0.0, usable
    corr = rets.corr()
    vals = corr.abs().to_numpy().copy()  # .values is read-only on newer numpy
    np.fill_diagonal(vals, 0.0)
    heat = float(vals.max())
    return heat, usable


# ---------------------------------------------------------------------------
# 3. Order-flow imbalance (Binance depth snapshot, free, no key)
# ---------------------------------------------------------------------------

def ofi_snapshot(symbol: str = "BTCUSDT", limit: int = 100) -> float | None:
    """One-shot order-flow imbalance from Binance's public depth snapshot.

    Real sub-hourly OFI needs a live WebSocket (not in this stack); this is an
    instantaneous snapshot proxy. Returns OFI in [-1, 1] or None on failure.
    """
    url = f"https://api.binance.com/api/v3/depth?symbol={urllib.parse.quote(symbol)}&limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "alpha-stack/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
            book = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    bid_vol = sum(float(p[1]) for p in book.get("bids", []))
    ask_vol = sum(float(p[1]) for p in book.get("asks", []))
    total = bid_vol + ask_vol
    if total <= 0:
        return 0.0
    return (bid_vol - ask_vol) / total


def _binance_symbol(ticker: str) -> str:
    """Map a crypto ticker to a Binance USDT perp/cash symbol."""
    t = ticker.upper().replace("-", "")
    if t.endswith("USD"):
        t = t[:-3] + "USDT"
    if "USDT" not in t and t not in ("USDT",):
        t = t + "USDT"
    return t


# ---------------------------------------------------------------------------
# 5. On-chain: Binance funding rate (free) + Glassnode (optional key)
# ---------------------------------------------------------------------------

def funding_rate(symbol: str = "BTCUSDT") -> float | None:
    """Latest Binance perp funding rate (free, no key) or None."""
    url = f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={urllib.parse.quote(symbol)}&limit=1"
    req = urllib.request.Request(url, headers={"User-Agent": "alpha-stack/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8"))
        if data:
            return float(data[0].get("fundingRate", 0.0))
    except Exception:
        return None
    return None


def glassnode_exchange_inflow(api_key: str, asset: str = "BTC") -> dict | None:
    """Glassnode exchange inflow (requires a Glassnode API key). None if no key.

    Wired per the extensions doc; returns None when no key is configured so the
    dashboard degrades gracefully rather than 401-ing.
    """
    if not api_key:
        return None
    url = "https://api.glassnode.com/v1/metrics/transfers/exchange_inflow_sum"
    params = urllib.parse.urlencode({"a": asset, "api_key": api_key, "i": "24h"})
    req = urllib.request.Request(f"{url}?{params}", headers={"User-Agent": "alpha-stack/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 4. Backtest metrics + paper-P&L over logged run decisions
# ---------------------------------------------------------------------------

def sharpe(returns: pd.Series, risk_free: float = 0.0) -> float:
    """Annualised Sharpe ratio of a return series (daily, 252)."""
    if returns is None or returns.empty or returns.std() == 0:
        return 0.0
    return float((returns.mean() - risk_free) / returns.std() * math.sqrt(252))


def max_drawdown(equity_curve: pd.Series) -> float:
    """Max drawdown as a negative fraction (e.g. -0.12 = -12%)."""
    if equity_curve is None or equity_curve.empty:
        return 0.0
    peak = equity_curve.cummax()
    dd = (equity_curve - peak) / peak
    return float(dd.min())


def parse_decision_direction(decision: str | None) -> str:
    """Coarse direction from a TradingAgents final decision string."""
    if not decision:
        return "hold"
    text = decision.upper()
    # Strongest signals first.
    if any(k in text for k in ("SELL", "SHORT", "EXIT", "REDUCE", "UNDERWEIGHT")):
        return "sell"
    if any(k in text for k in ("BUY", "LONG", "ADD", "OVERWEIGHT", "ACCUMULATE")):
        return "buy"
    if "HOLD" in text or "NEUTRAL" in text or "WAIT" in text:
        return "hold"
    return "hold"


def paper_backtest(run_records: list[dict], horizon: int = 5, start_equity: float = 10000.0) -> dict:
    """Naive paper P&L over past run decisions.

    Each record: {date (ISO), tickers:[{ticker, decision}]}. For each, fetch the
    actual close `horizon` trading days forward; long positions earn the
    forward return, shorts earn its negation, holds earn 0. Equal-weight sizing
    across that run's directional calls. This is a paper simulation of logged
    decisions, NOT a walk-forward ML backtest (the doc's walk-forward scaffold
    requires a fitted strategy object, which this stack does not have).
    """
    equity = start_equity
    curve: list[dict] = []
    per_ticker: list[dict] = []
    daily_ret: list[float] = []

    for rec in run_records:
        date_str = rec.get("date")
        calls = rec.get("tickers", [])
        directional = [(c["ticker"], parse_decision_direction(c.get("decision"))) for c in calls]
        directional = [(t, d) for t, d in directional if d != "hold"]
        if not directional:
            continue
        # Forward return per directional call, measured from the run date.
        fwd_rets = []
        for ticker, direction in directional:
            s = close_series(ticker)
            if s is None or s.empty:
                continue
            try:
                asof = pd.Timestamp(date_str)
                # Snap to the nearest available trading day >= asof.
                future = s[s.index >= asof]
                if len(future) <= horizon:
                    continue
                r = float(future.iloc[horizon] / future.iloc[0] - 1.0)
            except Exception:
                continue
            signed = r if direction == "buy" else -r
            fwd_rets.append(signed)
            per_ticker.append({"ticker": ticker, "direction": direction, "fwd_return": signed})
        if not fwd_rets:
            continue
        period_ret = float(np.mean(fwd_rets))
        daily_ret.append(period_ret)
        equity *= (1.0 + period_ret)
        curve.append({"date": date_str, "equity": round(equity, 2)})

    if not daily_ret:
        return {"n": 0, "sharpe": 0.0, "max_drawdown": 0.0, "equity_curve": [], "per_ticker": []}

    rets = pd.Series(daily_ret)
    eq = pd.Series([start_equity] + [start_equity * (1 + x) for x in
                                    np.cumprod(1 + rets)])  # monotonic equity path
    return {
        "n": len(daily_ret),
        "sharpe": round(sharpe(rets), 3),
        "max_drawdown": round(max_drawdown(eq), 4),
        "equity_curve": curve,
        "per_ticker": per_ticker,
    }