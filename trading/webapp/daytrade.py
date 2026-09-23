"""Intraday (day-trading) engine for the alpha stack — PAPER ONLY.

Nothing here talks to a broker. Every order is booked against a simulated
intraday account kept in ``.alpha-stack/daytrade/state.json``.

Pieces:
- Data: yfinance 1-minute bars (regular session only). Yahoo serves 1m bars
  for the last 30 days, at most ~8 days per request, so history is fetched in
  7-day chunks (~20 sessions). Bar age is measured, never assumed.
- Signals: there is no predictive model. The signal is the ticker's own move
  over the horizon window (close now vs close ``horizon_min`` minutes ago,
  in bps) — computed here, on the bars, in live and replay alike.
- Decision: purely knob-driven — the move clears the entry bar
  (round-trip cost × edge_mult) and then stops/targets/timing/alignment
  rules apply. A future auto bot can still feed its own predictions through
  ``_evaluate(pred=…)`` to override the move-based signal.
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
KNOBS_VERSION = 3
KEEP_ON_UPGRADE = ("tickers", "extra_tickers", "auto_execute")


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
    if df.empty:
        return df
    keep = np.zeros(len(df), dtype=bool)
    days = df.index.date
    for d in sorted(set(days)):
        b = session_bounds(d)
        if not b:
            continue
        m = (days == d) & (df.index >= b[0]) & (df.index < b[1])
        keep |= m
    return df[keep]


def fetch_history(ticker: str) -> pd.DataFrame:
    """Training history of 1m bars: a year of Alpaca SIP bars when an Alpaca
    key is configured, else ~20 sessions from Yahoo (cached per day)."""
    import alpaca_data
    if alpaca_data.available():
        return _session_only(alpaca_data.history(ticker, ALPACA_HISTORY_DAYS))
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



def atr_px(df: pd.DataFrame) -> pd.Series:
    c, h, l = df["Close"], df["High"], df["Low"]
    prev = c.shift(1)
    tr = pd.concat([h - l, (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / 14, adjust=False).mean()


# ---------------------------------------------------------------------------
# Paper book + the one decision rule (live, replay and backtest all use it)
# ---------------------------------------------------------------------------

def cost_per_fill(cfg: dict) -> float:
    return (cfg["spread_bps"] / 2 + cfg["slippage_bps"]) / 1e4


def round_trip_bps(cfg: dict) -> float:
    return cfg["spread_bps"] + 2 * cfg["slippage_bps"]


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
        self.positions: dict[str, dict] = d.get("positions", {})
        self.trades: list[dict] = d.get("trades", [])
        self.fills: list[dict] = d.get("fills", [])

    def to_dict(self) -> dict:
        return {"start_equity": self.start_equity, "realized_total": self.realized_total,
                "day": self.day, "day_start_equity": self.day_start_equity,
                "realized_today": self.realized_today, "killed_day": self.killed_day,
                "banked_day": self.banked_day,
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
            self.day = d
            self.day_start_equity = self.equity(marks)
            self.realized_today = 0.0

    def open(self, ticker: str, side: str, mid: float, when: datetime, stop: float, target: float,
             exit_by: datetime, reason: str, cfg: dict, marks: dict[str, float]) -> dict | None:
        if ticker in self.positions or len(self.positions) >= cfg["max_positions"]:
            return None
        if self.killed_day == self.day or self.banked_day == self.day:
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
    hold.
    """
    mode = cfg.get("lt_align") or "off"
    if not stance or mode == "off":
        return None, ""
    d = stance.get("direction")
    if d == "bullish":
        return "short", stance.get("reason") or "the long-term stack is bullish"
    if d == "bearish":
        return "long", stance.get("reason") or "the long-term stack is bearish"
    if d == "hold" and mode == "with_stance_hold":
        return "both", stance.get("reason") or "the long-term stack says hold"
    return None, ""


def move_bps(done: pd.DataFrame, horizon_min: int) -> float | None:
    """The signal: the ticker's own move over the horizon window, in bps —
    close now vs close ``horizon_min`` minutes ago. The knobs then decide
    when that move is big enough to trade."""
    h = int(horizon_min)
    if len(done) < h + 1:
        return None
    now, then = float(done["Close"].iloc[-1]), float(done["Close"].iloc[-1 - h])
    if not then > 0:
        return None
    return (now / then - 1) * 1e4


def decide(pred_bps: float, pos: dict | None, cfg: dict, price: float,
           atr: float, now: datetime, close_dt: datetime,
           lt_stance: dict | None = None) -> dict:
    thr = round_trip_bps(cfg) * cfg["edge_mult"]
    h = cfg["horizon_min"]
    sigma = max(atr * math.sqrt(h), price * 1e-4)
    blocked, why = align_gate(cfg, lt_stance)
    base = {"pred_bps": None if pred_bps is None or math.isnan(pred_bps) else round(pred_bps, 2),
            "threshold_bps": round(thr, 2), "entry": None, "stop": None, "target": None}
    if pred_bps is None or math.isnan(pred_bps):
        return {**base, "call": "HOLD", "action": "none",
                "reason": f"no signal yet — not enough price history to read the {h}-min move"}
    if pos:
        against = (pos["side"] == "long" and pred_bps < -thr) or (pos["side"] == "short" and pred_bps > thr)
        if against:
            call = "SELL NOW" if pos["side"] == "long" else "BUY NOW"
            return {**base, "call": call, "action": "exit",
                    "reason": f"exit {pos['side']}: the {h}-min move is now {pred_bps:+.1f} bps, against the position"}
        return {**base, "call": "HOLD", "action": "none",
                "reason": f"in a {pos['side']} position; stop {pos['stop']}, target {pos['target']}, time exit {pos['exit_by'][11:16]}"}
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
                    "reason": f"up {pred_bps:+.1f} bps over the last {h} min — long entry held back by long-term alignment: {why}"}
        return {**base, "call": "BUY NOW", "action": "buy", "entry": round(price, 4),
                "stop": round(price - cfg["stop_sigma"] * sigma, 4),
                "target": round(price + cfg["target_sigma"] * sigma, 4),
                "reason": f"up {pred_bps:+.1f} bps over the last {h} min — beyond the {thr:.1f} bps cost bar"}
    if pred_bps < -thr and cfg["allow_short"]:
        if blocked == "short":
            return {**base, "call": "HOLD", "action": "none",
                    "reason": f"down {pred_bps:+.1f} bps over the last {h} min — short entry held back by long-term alignment: {why}"}
        return {**base, "call": "SELL NOW", "action": "sell", "entry": round(price, 4),
                "stop": round(price + cfg["stop_sigma"] * sigma, 4),
                "target": round(price - cfg["target_sigma"] * sigma, 4),
                "reason": f"down {pred_bps:+.1f} bps over the last {h} min — short, beyond the {thr:.1f} bps cost bar"}
    if pred_bps < -thr:
        return {**base, "call": "HOLD", "action": "none",
                "reason": f"bearish ({pred_bps:+.1f} bps over the last {h} min) but shorting is off"}
    return {**base, "call": "HOLD", "action": "none",
            "reason": f"{pred_bps:+.1f} bps over the last {h} min is inside the ±{thr:.1f} bps cost band — wait"}


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


def on_bar(book: Book, ticker: str, bar_time: datetime, bar: dict, pred_bps: float, atr: float,
           cfg: dict, auto: bool, close_dt: datetime, marks: dict[str, float],
           lt_stance: dict | None = None) -> tuple[dict, list]:
    """Process one completed 1m bar: exits first, then the decision, then (auto) execution.
    ``lt_stance`` is the Alpha Stack's long-term stance for this ticker."""
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
    pos = book.positions.get(ticker)
    sig = decide(pred_bps, pos, cfg, bar["close"], atr, now, close_dt, lt_stance=lt_stance)
    if auto:
        if sig["action"] == "exit" and pos:
            t = book.close(ticker, bar["close"], now, "signal flipped", cfg)
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
# Engine (singleton): state, live loop, replay, stream
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
        threading.Thread(target=self._idle_pass, name="daytrade-idle-eval", daemon=True).start()
        self.thread = threading.Thread(target=self._run, name="daytrade-engine", daemon=True)
        self.thread.start()
        if self.engine_on:
            log("engine was on before restart — resuming live mode with open positions")
            self.start()

    def start(self) -> dict:
        with self.lock:
            self.engine_on = True
            self._save()
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

    def _idle_pass(self) -> None:
        """After a restart, put a price and a card on every ticker even while
        the engine is off (after-hours display)."""
        for t in self.tickers():
            self._idle_eval(t)

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
                  marks: dict, live: bool, pred: float | None = None,
                  book: Book | None = None, auto: bool | None = None) -> None:
        """Process one completed bar: exits and risk locks first, then the
        decision on the signal. The signal is the ticker's move over the
        horizon window (``move_bps``), computed from these bars — unless a
        caller feeds ``pred`` (a future auto bot can override it)."""
        book = book or self.book
        row = done.iloc[-1]
        bar = {"open": float(row["Open"]), "high": float(row["High"]), "low": float(row["Low"]),
               "close": float(row["Close"])}
        if pred is None:
            pred = move_bps(done, self.cfg["horizon_min"])
        a = float(atr_px(done.tail(200)).iloc[-1])
        sig, events = on_bar(book, t, bar_time, bar, pred, a, self.cfg,
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
                           "spark": spark}

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
        Unknown keys (e.g. from a config saved by an older version) are
        skipped, so stale saved settings never break an update."""
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
        self.cfg = new
        self._save()
        self._bump()
        return 200, {"ok": True, "config": self.cfg}

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
            iso = monday.isocalendar()
            self.replay_req = {"tickers": tickers, "speed": max(0.5, min(speed, 120.0)),
                               "auto": bool(body.get("auto", True)),
                               "week": f"{iso[0]}-W{iso[1]:02d}", "sessions": [d.isoformat() for d in sessions]}
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
        """Replay one week, session by session, then score the week. Bars run
        through the same ``_evaluate`` path as live, so the move-based signal
        fires and the knobs produce real trades to score."""
        sessions = [date.fromisoformat(d) for d in req["sessions"]]
        tickers = req["tickers"]
        self.mode = "replay"
        first_b = session_bounds(sessions[0])
        rep = {"session": req["week"], "week": req["week"], "sessions": req["sessions"],
               "tickers": tickers, "speed": req["speed"], "auto": req["auto"],
               "phase": "loading",
               "progress": 0.0, "clock": first_b[0].isoformat(), "done": False, "summary": None,
               "trades": []}
        self.replay = rep
        saved = (self.signals, self.events)
        self.signals, self.events = {}, []
        self._bump()
        data = {}
        for t in tickers:
            if self.replay_stop:
                break
            try:
                df = fetch_history(t)
                df = df[np.array(df.index.date) <= sessions[-1]]
                data[t] = df
            except Exception as exc:
                log(f"replay {t}: {exc}")
            self._bump()
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
                                   book=book, auto=req["auto"])
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
            # The week is the unit that's scored; days are shown for context.
            "per_day": [{"date": d, "trades": len([x for x in book.trades if x["closed_at"][:10] == d]),
                         "pnl": round(sum(x["pnl"] for x in book.trades if x["closed_at"][:10] == d), 2)}
                        for d in req["sessions"]],
            "stopped_early": self.replay_stop,
            "per_ticker": {t: {"trades": len([x for x in book.trades if x["ticker"] == t]),
                               "pnl": round(sum(x["pnl"] for x in book.trades if x["ticker"] == t), 2),
                               "net_bps": round(sum(x["net_bps"] for x in book.trades if x["ticker"] == t), 1)}
                           for t in data},
        }
        rep["trades"] = book.trades[-100:]
        rep["phase"] = "done"
        rep["done"] = True
        self._replay_book = None
        self.signals, self.events = saved
        self.mode = "off"
        log(f"replay {req['week']}: {rep['summary']}")
        self._bump()

    # -- snapshot ---------------------------------------------------------
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
                    "ticker": t, "call": "HOLD", "action": "none", "pred_bps": None,
                    "entry": None, "stop": None, "target": None,
                    "reason": "waiting for the first bars — the signal is the ticker's own move over the horizon window"})
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
                sig["horizon_min"] = self.cfg["horizon_min"]
                sig["changed_at"] = self.changed_at.get(t)
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
                                  "clock": rep["clock"],
                                  "tickers": len(rep["tickers"])} if replaying and rep else None),
                      "last_tick": self.last_tick}
            config = {**self.cfg, "cost_bps": round_trip_bps(self.cfg)}
            return {
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
        realized day P&L, open day positions and each watched ticker's call
        — the intraday half of the shared paper account."""
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
                pos = book.positions.get(t)
                p = None
                if pos:
                    m = marks.get(t, pos["entry_mid"])
                    sgn = 1 if pos["side"] == "long" else -1
                    p = {"side": pos["side"], "qty": pos["qty"],
                         "unrealized": round((m - pos["entry"]) * pos["qty"] * sgn, 2)}
                per.append({"ticker": t,
                             "call": (self.signals.get(t) or {}).get("call"),
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
                },
                "banked": banked,
                "killed": killed,
                "lock_reason": lock_reason,
                "tickers": per,
            }

    def context_line(self, ticker: str) -> str:
        """One factual line about the engine for the TradingAgents quant
        context: its state today (the engine trades the ticker's own move
        over the horizon window, knob-gated — no predictive model)."""
        with self.lock:
            book = self.book
            day = book.day
            bits = []
            if day and book.banked_day == day:
                bits.append("the day-trade engine is banked for today (daily profit lock reached)")
            elif day and book.killed_day == day:
                bits.append("the day-trade engine is cut for the day (daily loss cutoff reached)")
            elif self.engine_on:
                bits.append("the day-trade engine is running today")
            else:
                bits.append("the day-trade engine is off")
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
