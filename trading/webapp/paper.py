"""Paper-trading broker for the alpha stack — STOCKS ONLY.

Executes TradingAgents' Portfolio Manager decisions on a fake-money account
(~/.alpha-stack/paper.json) exactly as the decision states them — sizing,
stop-loss, take-profit and time horizon come from the decision text itself,
extracted by a small local Ollama model with a regex fallback. No imposed
rules beyond honest defaults (flagged in ``sizing_note``) when the decision
is silent on a field. Crypto tickers are skipped entirely.

Every trade fills at the next session open after its decision (a pre-market
decision fills at that morning's open; one made mid-session fills at the
next day's open) — never at a price that predates the decision.

This module never imports ``app`` (app imports this one); it loads
``config.json`` itself and reuses ``signals`` for price data. Callable both
from the dashboard process (broker loop, run hook, HTTP handlers).

Options suggestions (spreads etc.) cannot be simulated — they are recorded
verbatim in ``options_note`` and only the equity component executes.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import urllib.request
from datetime import datetime, time as dt_time
from pathlib import Path

import pandas as pd

import signals

# ---------------------------------------------------------------------------
# Paths and config (own copy — no app import, which would be circular)
# ---------------------------------------------------------------------------

WEBAPP = Path(__file__).resolve().parent
CONFIG_PATH = WEBAPP / "config.json"

with CONFIG_PATH.open("r", encoding="utf-8") as fh:
    CONFIG = json.load(fh)

PAPER_PATH = Path(CONFIG.get("paper_state_file", "~/.alpha-stack/paper.json")).expanduser()
ACCURACY_PATH = Path(CONFIG.get("accuracy_file", "~/.alpha-stack/accuracy.jsonl")).expanduser()
OLLAMA_URL = str(CONFIG.get("ollama_url", "http://localhost:11434")).rstrip("/")
EXTRACT_MODEL = str(CONFIG.get("paper_extract_model", "granite4.1:8b"))
START_EQUITY = float(CONFIG.get("paper_start_equity", 100000.0))

CRYPTO_TICKERS = {"BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "MATIC"}

_ACTIONS = {"buy", "sell", "hold", "close", "trim"}
# Default horizon for scoring a decision that stated none (10 trading days).
_DEFAULT_HORIZON_TRADING_DAYS = 10
# Default allocation when a decision is directional but states no size.
_DEFAULT_SIZE_PCT = 5.0

_PAPER_LOCK = threading.Lock()
# Serializes read-modify-write cycles on the ledger (broker thread, dashboard
# requests, run-finish hook) so two writers can't drop each other's changes.
_PASS_LOCK = threading.Lock()


def _default_paper() -> dict:
    return {
        "cash": START_EQUITY,
        "start_equity": START_EQUITY,
        "positions": [],
        "pending_trades": [],   # stock trades awaiting their session-open fill
        "trades": [],
        "equity_history": [],
        "pending_scores": [],   # decisions awaiting their horizon to be scored
        "executed_runs": [],
        "created": datetime.utcnow().isoformat() + "Z",
    }


def load_paper() -> dict:
    """Read the paper account, seeded fresh if absent/corrupt."""
    if not PAPER_PATH.exists():
        return _default_paper()
    try:
        with PAPER_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return _default_paper()
    base = _default_paper()
    for key, value in data.items():
        if key in base or key in ("created",):
            base[key] = value
    return base


def save_paper(paper: dict) -> dict:
    """Persist the paper account atomically under the lock."""
    with _PAPER_LOCK:
        PAPER_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = PAPER_PATH.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(paper, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, PAPER_PATH)
    return paper


def reset() -> dict:
    """Wipe the account back to its starting state."""
    return save_paper(_default_paper())


# ---------------------------------------------------------------------------
# Price data (daily OHLC; close series reused from signals)
# ---------------------------------------------------------------------------

_OHLC_CACHE: dict[str, pd.DataFrame] = {}
_OHLC_TS: dict[str, float] = {}
_OHLC_TTL = 600.0


def _yf_symbol(ticker: str) -> str:
    if ticker.upper() in CRYPTO_TICKERS and "-" not in ticker:
        return ticker.upper() + "-USD"
    return ticker


def daily_ohlc(ticker: str) -> pd.DataFrame:
    """Daily OHLC bars for ``ticker`` (yfinance, auto-adjusted), cached."""
    import time

    now = time.time()
    if ticker in _OHLC_CACHE and (now - _OHLC_TS.get(ticker, 0.0)) < _OHLC_TTL:
        return _OHLC_CACHE[ticker]
    import yfinance as yf

    try:
        df = yf.download(_yf_symbol(ticker), period="1y", interval="1d",
                         progress=False, auto_adjust=True)
    except Exception:
        df = pd.DataFrame()
    if df is None or df.empty:
        return pd.DataFrame()
    # yfinance returns a MultiIndex frame on single tickers; flatten to plain columns.
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Open", "High", "Low", "Close"]].dropna()
    _OHLC_CACHE[ticker] = df
    _OHLC_TS[ticker] = now
    return df


def is_crypto(ticker: str) -> bool:
    return ticker.upper() in CRYPTO_TICKERS or ("-" in ticker.upper() and "USD" in ticker.upper())


def last_close(ticker: str) -> float | None:
    """Last daily close via the shared signals cache (works for crypto too)."""
    s = signals.close_series(ticker)
    if s is None or s.empty:
        return None
    return float(s.iloc[-1])


def _naive_index(index) -> pd.DatetimeIndex:
    """Index as tz-naive normalized timestamps so date comparisons always work
    (yfinance returns tz-aware indexes for crypto, tz-naive for stocks)."""
    idx = pd.DatetimeIndex(index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    return idx.normalize()


def _naive_ts(value) -> pd.Timestamp:
    ts = pd.Timestamp(value)
    if ts.tz is not None:
        ts = ts.tz_localize(None)
    return ts.normalize()


# ---------------------------------------------------------------------------
# Trade-intent extraction (LLM primary, regex fallback)
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = (
    "You extract a trade instruction from a trading-decision report. "
    "Output ONLY a JSON object, no prose, with exactly these keys: "
    '"action": one of "buy", "sell", "hold", "close", "trim" (trim = reduce an '
    'existing position); '
    '"size_pct": number, the percent of the portfolio to allocate to this trade '
    "(for trim: the percent of the existing position to reduce); null if not stated; "
    '"entry_price": number or null (the stated entry/limit price); '
    '"stop_loss": number or null; '
    '"take_profit": number or null; '
    '"horizon_days": integer, the holding horizon converted to calendar days '
    "(use the maximum of any stated range; weeks x7, months x30); null if not stated; "
    '"options_note": string, any options/spread suggestion quoted verbatim, else null; '
    '"notes": one-sentence summary of the trade plan, else null.'
)


def _extract_with_llm(decision: str) -> dict | None:
    """Ask the local extract model for structured intent; None on any failure."""
    payload = {
        "model": EXTRACT_MODEL,
        "messages": [
            {"role": "system", "content": _EXTRACT_SYSTEM},
            {"role": "user", "content": decision[:6000]},
        ],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
    }
    try:
        req = urllib.request.Request(
            OLLAMA_URL + "/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "alpha-stack/1.0"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
            out = json.loads(resp.read().decode("utf-8"))
        intent = json.loads(out["message"]["content"])
    except Exception:
        return None
    if not isinstance(intent, dict) or str(intent.get("action", "")).lower() not in _ACTIONS:
        return None
    return _validate_intent(intent, source="llm")


def _validate_intent(raw: dict, source: str) -> dict:
    """Coerce/validate an extracted intent dict; bad fields become None."""
    def num(v):
        try:
            v = float(str(v).replace(",", "").replace("$", ""))
            return v if v > 0 and math.isfinite(v) else None
        except (TypeError, ValueError):
            return None

    action = str(raw.get("action", "")).lower().strip()
    if action not in _ACTIONS:
        return {}
    intent = {
        "action": action,
        "size_pct": num(raw.get("size_pct")),
        "entry_price": num(raw.get("entry_price")),
        "stop_loss": num(raw.get("stop_loss")),
        "take_profit": num(raw.get("take_profit")),
        "horizon_days": None,
        "options_note": None,
        "notes": raw.get("notes") or None,
        "extractor": source,
    }
    try:
        hd = int(float(raw.get("horizon_days") or 0))
        intent["horizon_days"] = hd if 1 <= hd <= 365 else None
    except (TypeError, ValueError):
        pass
    if intent["size_pct"] is not None and not (0 < intent["size_pct"] <= 50):
        intent["size_pct"] = None
    note = raw.get("options_note")
    if isinstance(note, str) and note.strip():
        intent["options_note"] = note.strip()[:500]
    return intent


def _extract_with_regex(decision: str) -> dict:
    """Fallback extraction from the consistent decision markdown format."""
    text = decision.replace("‑", "-").replace("–", "-").replace("—", "-")

    m = re.search(r"\*{0,2}Rating\*{0,2}\s*[:\-]?\s*\**\s*(\w+)", text, re.IGNORECASE)
    action = "hold"
    if m:
        word = m.group(1).lower()
        if any(k in word for k in ("sell", "short", "reduce", "trim")):
            action = "trim" if "reduce" in word or "trim" in word else "sell"
        elif any(k in word for k in ("buy", "long", "accum")):
            action = "buy"
    intent: dict = {"action": action, "extractor": "regex"}

    for key, pattern in {
        "size_pct": r"~?\s*(\d+(?:\.\d+)?)\s*%?\s*(?:%|percent)?\s*(?:of\s*the|of)\s*(?:the\s+)?portfolio",
        "stop_loss": r"stop[\s-]*loss(?:\s+(?:at|of))?\s*~?\$?\s*([\d,]+(?:\.\d+)?)",
        "take_profit": r"(?:take[\s-]*profit|target(?:\s+price)?)\s*(?:at|of)?\s*~?\$?\s*([\d,]+(?:\.\d+)?)",
        "entry_price": r"(?:entry|enter(?:ing)?\s+at|at)\s*~?\$\s*([\d,]+(?:\.\d+)?)",
    }.items():
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            try:
                intent[key] = float(m.group(1).replace(",", ""))
            except ValueError:
                pass

    m = re.search(
        r"Time\s*Horizon\**\s*[:\-]?\s*(\d+)\s*(?:-\s*(\d+)\s*)?(week|month|day)",
        text, re.IGNORECASE)
    if m:
        lo = int(m.group(1))
        hi = int(m.group(2) or m.group(1))
        unit = m.group(3).lower()
        mult = {"week": 7, "month": 30, "day": 1}[unit]
        intent["horizon_days"] = max(lo, hi) * mult

    opt_bits = re.findall(r"[^\n.]*\b(?:put|call|spread)s?\b[^\n.]*", text, re.IGNORECASE)
    if opt_bits:
        intent["options_note"] = " ".join(b.strip() for b in opt_bits[:2])[:500]

    return _validate_intent(intent, source="regex")


def extract_intent(decision: str | None, ticker: str = "") -> dict:
    """Structured trade intent for one decision; never raises."""
    if not decision:
        return {"action": "hold", "extractor": "none"}
    try:
        intent = _extract_with_llm(decision)
    except Exception:
        intent = None
    if not intent:
        intent = _extract_with_regex(decision)
    # Honest defaults, flagged, when the decision was silent.
    if intent.get("action") in ("buy", "sell") and not intent.get("size_pct"):
        intent["size_pct"] = _DEFAULT_SIZE_PCT
        intent["sizing_note"] = f"decision stated no size; defaulted to {_DEFAULT_SIZE_PCT}% of equity"
    else:
        intent.setdefault("sizing_note", None)
    return intent


# ---------------------------------------------------------------------------
# Account math
# ---------------------------------------------------------------------------

def _position_mark(pos: dict) -> float | None:
    """Last-close mark for an open position (None if price data unavailable)."""
    px = last_close(pos["ticker"])
    if px is None:
        return None
    return px


def _equity(paper: dict) -> float:
    """Cash + market value of open positions (last close as the mark)."""
    total = paper["cash"]
    for pos in paper["positions"]:
        mark = _position_mark(pos)
        if mark is None:
            mark = pos["entry_price"]  # stale data: fall back to entry
        total += pos["qty"] * mark
    return total


def _append_trade(paper: dict, ticker: str, qty: float, price: float,
                  reason: str, decision_ref: str | None, run_id: str | None,
                  decided_at: str | None = None, pnl: float | None = None) -> None:
    paper["trades"].append({
        "ts": datetime.utcnow().isoformat() + "Z",
        "ticker": ticker,
        "qty": round(qty, 4),
        "price": round(price, 4),
        "reason": reason,
        "pnl": pnl,
        "decision_ref": decision_ref,
        "run_id": run_id,
        "decided_at": decided_at,
    })


def _classify_levels(qty: float, price: float, stop, target):
    """Assign stated price levels to stop/target by which side of the entry
    they sit on — decisions phrase both loosely. For a long, adverse is below
    entry and favorable above; for a short, the reverse. A mislabeled level
    (e.g. a short whose stated 'stop' sits below entry) is reclassified, so
    it can only fill if the market actually trades there."""
    def adverse(lvl):    return (lvl < price) if qty > 0 else (lvl > price)
    def favorable(lvl):  return (lvl > price) if qty > 0 else (lvl < price)
    levels = [l for l in (stop, target) if l is not None]
    stops = [l for l in levels if adverse(l)]
    targets = [l for l in levels if favorable(l)]
    return (stops[0] if stops else None, targets[0] if targets else None)


def _open_position(paper: dict, ticker: str, qty: float, price: float,
                   intent: dict, decision_ref: str, run_id: str,
                   decided_at: str, fill_date: str) -> dict:
    """Book a filled open: longs debit cash, shorts credit proceeds."""
    if qty > 0:
        paper["cash"] -= qty * price
    else:
        paper["cash"] += abs(qty) * price
    stop, target = _classify_levels(qty, price, intent.get("stop_loss"),
                                    intent.get("take_profit"))
    pos = {
        "ticker": ticker,
        "qty": round(qty, 4),
        "side": "long" if qty > 0 else "short",
        "entry_price": round(price, 4),
        "stop_loss": stop,
        "take_profit": target,
        "horizon_days": intent.get("horizon_days"),
        "sizing_note": intent.get("sizing_note"),
        "options_note": intent.get("options_note"),
        "opened_at": fill_date,
        "decided_at": decided_at,
        "decision_ref": decision_ref,
        "run_id": run_id,
        "last_check": fill_date,
    }
    paper["positions"].append(pos)
    _append_trade(paper, ticker, qty, price, "open", decision_ref, run_id, decided_at)
    return pos


def _close_position(paper: dict, pos: dict, price: float, reason: str) -> float:
    """Fully close a position at ``price``; returns realized P&L."""
    if pos["qty"] > 0:
        paper["cash"] += pos["qty"] * price
        pnl = (price - pos["entry_price"]) * pos["qty"]
    else:
        paper["cash"] -= abs(pos["qty"]) * price
        pnl = (pos["entry_price"] - price) * abs(pos["qty"])
    paper["positions"] = [p for p in paper["positions"] if p is not pos]
    _append_trade(paper, pos["ticker"], -pos["qty"], price, reason,
                  pos.get("decision_ref"), pos.get("run_id"),
                  pos.get("decided_at"), round(pnl, 2))
    return pnl


def _find_position(paper: dict, ticker: str) -> dict | None:
    for pos in paper["positions"]:
        if pos["ticker"] == ticker:
            return pos
    return None


# ---------------------------------------------------------------------------
# Executing a run's decisions on the paper account
# ---------------------------------------------------------------------------

def _book_intent(paper: dict, ticker: str, intent: dict, decision_ref: str,
                 run_id: str, decided_at: str) -> dict:
    """Turn one extracted intent into bookings.

    Stocks only: every trade queues for the next session open (a decision is
    made pre-market by a scheduled run), sized at fill time.
    """
    existing = _find_position(paper, ticker)
    action = intent["action"]
    result: dict = {"ticker": ticker, "action": action, "status": "no_trade"}

    def pend(qty, **extra) -> dict:
        pending = {"ticker": ticker, "qty": qty, "intent": intent,
                   "decision_ref": decision_ref, "run_id": run_id,
                   "decided_at": decided_at, **extra}
        paper["pending_trades"].append(pending)
        return pending

    # close / trim operate on an existing position only.
    if action == "close":
        if not existing:
            return result
        pend(-existing["qty"], close_existing=True)
        result.update({"status": "pending_open"})
        return result

    if action == "trim":
        if not existing:
            return result
        pct = (intent.get("size_pct") or 50.0) / 100.0
        cut = abs(existing["qty"]) * pct                  # magnitude to reduce
        signed = cut if existing["qty"] < 0 else -cut      # trade toward flat
        pend(signed, partial_close=True)
        result.update({"status": "pending_open"})
        return result

    if action == "hold":
        return result

    # buy / sell. A sell against an existing long (or buy against a short)
    # means closing it, per the recommendation.
    if action == "sell" and existing and existing["qty"] > 0:
        return _book_intent(paper, ticker, {**intent, "action": "close"},
                            decision_ref, run_id, decided_at)
    if action == "buy" and existing and existing["qty"] < 0:
        return _book_intent(paper, ticker, {**intent, "action": "close"},
                            decision_ref, run_id, decided_at)

    # Queue the open; qty is sized from the stated % of equity once the
    # session-open fill price is known, and cash is checked at fill.
    pend(None, sized_at_fill=True)
    result.update({"status": "pending_open",
                   "side": "long" if action == "buy" else "short"})
    return result


def execute_run_decisions(record: dict) -> list[dict]:
    """Execute one runs.jsonl record's decisions on the paper account.

    Idempotent per run_id (scheduled runs, manual runs and the finish hook
    may all call). Also seeds the accuracy scorecard with every completed
    decision.
    """
    run_id = record.get("run_id") or ""
    with _PASS_LOCK:
        paper = load_paper()
        if run_id and run_id in paper["executed_runs"]:
            return []
        executed: list[dict] = []
        # Prefer the run START for the decision timestamp: a multi-ticker run
        # finishes after the session opens, but its decisions are pre-open orders
        # formed from the prior day's data (the fill logic keys off this).
        decided_at = record.get("started") or record.get("finished") or datetime.utcnow().isoformat()
        for t in record.get("tickers", []):
            if t.get("status") != "done" or not t.get("decision"):
                continue
            ticker = t["ticker"]
            if is_crypto(ticker):
                executed.append({"ticker": ticker, "action": "skip",
                                 "status": "skipped"})
                continue
            decision_ref = f"{run_id}:{ticker}"
            intent = extract_intent(t["decision"], ticker)
            try:
                booked = _book_intent(paper, ticker, intent, decision_ref, run_id, decided_at)
            except Exception as exc:
                booked = {"ticker": ticker, "action": intent["action"],
                          "status": "error", "note": str(exc)}
            booked["extracted"] = {k: intent.get(k) for k in
                                   ("action", "size_pct", "entry_price", "stop_loss",
                                    "take_profit", "horizon_days", "extractor")}
            executed.append(booked)
            paper["pending_scores"].append({
                "decision_ref": decision_ref,
                "run_id": run_id,
                "ticker": ticker,
                "date": str(decided_at)[:10],
                "direction": intent["action"] if intent["action"] in ("buy", "sell") else "hold",
                "horizon_days": intent.get("horizon_days"),
                "scored": False,
            })
        if run_id:
            paper["executed_runs"].append(run_id)
        save_paper(paper)
    return executed


# ---------------------------------------------------------------------------
# Manual trades (dashboard form) — same fill/monitor semantics as decisions
# ---------------------------------------------------------------------------

def manual_trade(ticker: str, action: str, size_pct=None, stop_loss=None,
                 take_profit=None, horizon_days=None, note=None) -> dict:
    """Book a user-entered trade on the paper account.

    Same semantics as a decision: stocks queue for the next session open
    (an order placed mid-session fills at the next open) and are then
    monitored — stop, target, horizon — by every daily pass like any
    model-recommended trade. Manual trades are not scored into the
    accuracy log (that measures the model's calls, not the user's).
    """
    ticker = str(ticker or "").strip().upper()
    action = str(action or "").strip().lower()
    if action not in ("buy", "sell", "close", "trim"):
        return {"error": "action must be buy, sell, close or trim"}
    if not ticker:
        return {"error": "ticker required"}
    if is_crypto(ticker):
        return {"error": f"{ticker} is a crypto ticker"}
    if daily_ohlc(ticker).empty:
        return {"error": f"no price data for {ticker}"}
    intent = _validate_intent({"action": action, "size_pct": size_pct,
                               "stop_loss": stop_loss, "take_profit": take_profit,
                               "horizon_days": horizon_days, "notes": note},
                              source="manual")
    if not intent:
        return {"error": "invalid parameters"}
    if intent["action"] in ("buy", "sell") and not intent.get("size_pct"):
        intent["size_pct"] = _DEFAULT_SIZE_PCT
        intent["sizing_note"] = f"no size set; defaulted to {_DEFAULT_SIZE_PCT}% of equity"
    with _PASS_LOCK:
        paper = load_paper()
        now = datetime.utcnow().isoformat() + "Z"
        run_id = "manual-" + now[:19].replace(":", "").replace("-", "")
        try:
            booked = _book_intent(paper, ticker, intent, f"{run_id}:{ticker}",
                                  run_id, now)
        except Exception as exc:
            return {"error": str(exc)}
        save_paper(paper)
    return booked


# ---------------------------------------------------------------------------
# Intraday (day-trading) side of the same account
# ---------------------------------------------------------------------------
# One paper account, two ways to use it: positions held for weeks/months
# (TradingAgents decisions, above) and intraday round trips from the
# day-trading engine (daytrade.py). Intraday positions live in the engine's
# own book while open — they never enter paper["positions"], which is keyed
# one-per-ticker for the long-term holdings — and each closed round trip
# posts its net-of-cost P&L into this account's cash and trade log, tagged
# "intraday". The accuracy scorecard scores decisions, not trades, so it
# keeps measuring only the long-term calls.

def account_snapshot() -> dict:
    """Cash + equity of the shared account (long-term positions at last close)."""
    paper = load_paper()
    return {"cash": float(paper["cash"]), "equity": float(_equity(paper)),
            "start_equity": float(paper["start_equity"])}


def post_intraday_close(trade: dict, strategy: str = "intraday",
                        reason: str | None = None, ref: str | None = None) -> bool:
    """Book one closed round trip (a day trade, or a shadow forward-test
    trade tagged ``shadow:<signal>``) into the shared account. ``ref`` makes
    the post idempotent: a trade whose ref is already booked is refused, so a
    crash between posting and marking the caller's ledger can't double-post.
    Returns False when refused as a duplicate."""
    pnl = float(trade["pnl"])
    with _PASS_LOCK:
        paper = load_paper()
        if ref is not None and any(t.get("decision_ref") == ref for t in paper["trades"]):
            return False
        paper["cash"] += pnl
        paper["trades"].append({
            "ts": datetime.utcnow().isoformat() + "Z",
            "ticker": trade["ticker"],
            "qty": trade["qty"] if trade["side"] == "long" else -trade["qty"],
            "price": trade["exit"],
            "entry_price": trade["entry"],
            "reason": reason or f"intraday {trade['side']}: {trade.get('exit_reason', 'closed')}",
            "pnl": round(pnl, 2),
            "strategy": strategy,
            "opened_at": trade.get("opened_at"),
            "closed_at": trade.get("closed_at"),
            "decision_ref": ref, "run_id": None, "decided_at": None,
        })
        save_paper(paper)
    return True


# ---------------------------------------------------------------------------
# Pending-fill resolution + daily housekeeping
# ---------------------------------------------------------------------------

def _fill_pending(paper: dict, pending: dict, price: float, fill_date: str) -> None:
    """Apply a pending stock trade at its session-open fill price."""
    ticker = pending["ticker"]
    qty = pending.get("qty")
    intent = pending.get("intent") or {}

    if pending.get("close_existing"):
        pos = _find_position(paper, ticker)
        if pos:
            _close_position(paper, pos, price, "decision_close")
        return

    if pending.get("partial_close"):
        pos = _find_position(paper, ticker)
        if not pos or not qty:
            return
        cut = abs(qty)
        if pos["qty"] > 0:
            paper["cash"] += cut * price
            pnl = (price - pos["entry_price"]) * cut
        else:
            paper["cash"] -= cut * price
            pnl = (pos["entry_price"] - price) * cut
        pos["qty"] = round(pos["qty"] + qty, 4)
        if abs(pos["qty"]) < 1e-6:
            paper["positions"] = [p for p in paper["positions"] if p is not pos]
        _append_trade(paper, ticker, qty, price, "decision_trim",
                      pending.get("decision_ref"), pending.get("run_id"),
                      pending.get("decided_at"), round(pnl, 2))
        return

    # Opening trade: size from the stated % of equity if not pre-sized, and
    # honor the sign (sell = short) from the extracted action.
    if pending.get("sized_at_fill") or not qty:
        size_pct = (intent.get("size_pct") or _DEFAULT_SIZE_PCT)
        value = _equity(paper) * size_pct / 100.0
        qty = (value / price) if price > 0 else 0.0
    qty = float(qty)
    if intent.get("action") == "sell":
        qty = -qty
    if qty > 0 and qty * price > paper["cash"]:
        qty = paper["cash"] / price if price > 0 else 0.0
    if abs(qty * price) < 1.0:
        return
    _open_position(paper, ticker, qty, price, intent,
                   pending.get("decision_ref") or "", pending.get("run_id") or "",
                   pending.get("decided_at") or "", fill_date)


def resolve_pending(paper: dict) -> int:
    """Fill any pending stock trades whose session open has happened.

    A pre-market decision (before ~14:30 UTC / 9:30 ET) fills at that same
    day's open; a decision made during or after the session fills at the next
    session's open — never at a price that predates the decision.
    """
    still: list[dict] = []
    filled = 0
    for pending in paper.get("pending_trades", []):
        ohlc = daily_ohlc(pending["ticker"])
        if ohlc.empty:
            still.append(pending)
            continue
        raw = pd.Timestamp(pending.get("decided_at") or datetime.utcnow())
        if raw.tz is not None:
            raw = raw.tz_localize(None)
        decide_date = raw.normalize()
        idx = _naive_index(ohlc.index)
        if raw.time() >= dt_time(14, 30):
            mask = idx > decide_date      # intraday decision -> next open
        else:
            mask = idx >= decide_date     # pre-market decision -> same-day open
        if not mask.any():
            still.append(pending)
            continue
        fill_bar = ohlc[mask].iloc[0]
        _fill_pending(paper, pending, float(fill_bar["Open"]),
                      idx[mask][0].date().isoformat())
        filled += 1
    paper["pending_trades"] = still
    return filled


def _check_stops_and_horizons(paper: dict) -> list[str]:
    """Catch-up stop/target/horizon checks over bars since each position's
    last check. Returns human-readable events."""
    events: list[str] = []
    for pos in list(paper["positions"]):
        ohlc = daily_ohlc(pos["ticker"])
        if ohlc.empty:
            continue
        last_check = _naive_ts(pos.get("last_check") or pos["opened_at"])
        idx = _naive_index(ohlc.index)
        sel = idx > last_check
        sub = ohlc[sel]
        sub_idx = idx[sel]
        closed = False
        for i in range(len(sub)):
            bar = sub.iloc[i]
            bar_date = sub_idx[i]
            if not closed and pos.get("stop_loss") is not None:
                stop = float(pos["stop_loss"])
                if pos["qty"] > 0 and float(bar["Low"]) <= stop:
                    pnl = _close_position(paper, pos, stop, "stop")
                    events.append(f"{pos['ticker']} stop hit {stop:.2f} on {bar_date.date()} (pnl {pnl:+.2f})")
                    closed = True
                elif pos["qty"] < 0 and float(bar["High"]) >= stop:
                    pnl = _close_position(paper, pos, stop, "stop")
                    events.append(f"{pos['ticker']} stop hit {stop:.2f} on {bar_date.date()} (pnl {pnl:+.2f})")
                    closed = True
            if not closed and pos.get("take_profit") is not None:
                tp = float(pos["take_profit"])
                if pos["qty"] > 0 and float(bar["High"]) >= tp:
                    pnl = _close_position(paper, pos, tp, "target")
                    events.append(f"{pos['ticker']} target hit {tp:.2f} on {bar_date.date()} (pnl {pnl:+.2f})")
                    closed = True
                elif pos["qty"] < 0 and float(bar["Low"]) <= tp:
                    pnl = _close_position(paper, pos, tp, "target")
                    events.append(f"{pos['ticker']} target hit {tp:.2f} on {bar_date.date()} (pnl {pnl:+.2f})")
                    closed = True
            if closed:
                break
            if not closed and pos.get("horizon_days"):
                opened = _naive_ts(pos["opened_at"])
                if (bar_date - opened).days >= int(pos["horizon_days"]):
                    px = float(bar["Close"])
                    pnl = _close_position(paper, pos, px, "horizon")
                    events.append(f"{pos['ticker']} horizon expired on {bar_date.date()} (pnl {pnl:+.2f})")
                    closed = True
                    break
        if not closed:
            if len(sub):
                pos["last_check"] = sub_idx[-1].date().isoformat()
    return events


def _score_matured(paper: dict) -> int:
    """Score decisions past their horizon into accuracy.jsonl; returns count."""
    scored = 0
    today = pd.Timestamp(datetime.utcnow().date())
    for ps in paper.get("pending_scores", []):
        if ps.get("scored"):
            continue
        horizon_td = _DEFAULT_HORIZON_TRADING_DAYS
        if ps.get("horizon_days"):
            horizon_td = max(1, round(int(ps["horizon_days"]) * 5 / 7))
        s = signals.close_series(ps["ticker"])
        if s is None or s.empty:
            continue
        asof = _naive_ts(ps["date"])
        idx = _naive_index(s.index)
        future = s[idx >= asof]
        if len(future) <= horizon_td:
            continue  # not matured yet
        fwd = float(future.iloc[horizon_td] / future.iloc[0] - 1.0)
        direction = ps.get("direction", "hold")
        hit = (direction == "buy" and fwd > 0) or (direction == "sell" and fwd < 0)
        ref = ps["decision_ref"]
        realized = sum(t.get("pnl") or 0.0 for t in paper["trades"]
                       if t.get("decision_ref") == ref)
        stopped = any(t.get("reason") == "stop" and t.get("decision_ref") == ref
                      for t in paper["trades"])
        record = {
            "scored_at": datetime.utcnow().isoformat() + "Z",
            "decided_at": ps["date"],
            "ticker": ps["ticker"],
            "direction": direction,
            "horizon_trading_days": horizon_td,
            "fwd_return": round(fwd, 6),
            "hit": bool(hit),
            "realized_pnl": round(realized, 2),
            "stopped_out": bool(stopped),
            "run_id": ps.get("run_id"),
            "decision_ref": ref,
        }
        try:
            ACCURACY_PATH.parent.mkdir(parents=True, exist_ok=True)
            with ACCURACY_PATH.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            continue
        ps["scored"] = True
        scored += 1
    return scored


def daily_pass() -> dict:
    """The housekeeping pass: fills, stops, horizons, marks, scoring."""
    with _PASS_LOCK:
        paper = load_paper()
        filled = resolve_pending(paper)
        events = _check_stops_and_horizons(paper)
        today = datetime.utcnow().date().isoformat()
        equity = _equity(paper)
        # One equity point per day (replace if the pass runs twice).
        paper["equity_history"] = [e for e in paper["equity_history"] if e["date"] != today]
        paper["equity_history"].append({"date": today, "equity": round(equity, 2),
                                         "cash": round(paper["cash"], 2)})
        scored = _score_matured(paper)
        save_paper(paper)
    return {"filled": filled, "events": events, "scored": scored,
            "equity": round(equity, 2), "cash": round(paper["cash"], 2)}


# ---------------------------------------------------------------------------
# Views for the dashboard / runner
# ---------------------------------------------------------------------------

def scorecard() -> dict:
    """Aggregate accuracy.jsonl into hit-rate stats."""
    records: list[dict] = []
    if ACCURACY_PATH.exists():
        try:
            for line in ACCURACY_PATH.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    records.append(json.loads(line))
        except (OSError, json.JSONDecodeError):
            records = []
    directional = [r for r in records if r.get("direction") in ("buy", "sell")]
    hits = sum(1 for r in directional if r.get("hit"))
    by_ticker: dict[str, dict] = {}
    by_direction: dict[str, dict] = {}
    for r in directional:
        for bucket, key in ((by_ticker, r["ticker"]), (by_direction, r["direction"])):
            slot = bucket.setdefault(key, {"n": 0, "hits": 0, "fwd_sum": 0.0, "pnl_sum": 0.0})
            slot["n"] += 1
            slot["hits"] += 1 if r.get("hit") else 0
            slot["fwd_sum"] += r.get("fwd_return") or 0.0
            slot["pnl_sum"] += r.get("realized_pnl") or 0.0
    for bucket in (by_ticker, by_direction):
        for slot in bucket.values():
            slot["avg_fwd"] = round(slot["fwd_sum"] / slot["n"], 6)
            slot["hit_rate"] = round(slot["hits"] / slot["n"], 4) if slot["n"] else 0.0
            del slot["fwd_sum"]
    return {
        "n": len(directional),
        "hits": hits,
        "hit_rate": round(hits / len(directional), 4) if directional else None,
        "avg_fwd_return": (round(sum(r.get("fwd_return") or 0.0 for r in directional)
                                 / len(directional), 6) if directional else None),
        "by_ticker": by_ticker,
        "by_direction": by_direction,
        "records": records[-50:],
    }


def paper_overview() -> dict:
    """Everything the Paper Account panel needs in one call."""
    paper = None
    events: list[str] = []
    try:
        with _PASS_LOCK:
            paper = load_paper()
            resolve_pending(paper)  # keep fills moving even without the broker loop
            events = _check_stops_and_horizons(paper)  # keep stops/targets current too
            save_paper(paper)
    except Exception:
        paper = load_paper()
    positions = []
    for pos in paper["positions"]:
        mark = _position_mark(pos)
        if mark is None:
            mark = pos["entry_price"]
        value = pos["qty"] * mark
        entry_value = pos["qty"] * pos["entry_price"]
        pnl = value - entry_value
        positions.append({
            **{k: pos.get(k) for k in ("ticker", "qty", "side", "entry_price",
                                       "stop_loss", "take_profit", "horizon_days",
                                       "sizing_note", "options_note", "opened_at",
                                       "decision_ref")},
            "mark_price": round(mark, 4),
            "market_value": round(value, 2),
            "unrealized_pnl": round(pnl, 2),
            "unrealized_pct": round(pnl / abs(entry_value), 6) if entry_value else None,
        })
    equity = paper["cash"] + sum(p["market_value"] for p in positions)
    hist = paper.get("equity_history", [])
    curve = pd.Series([e["equity"] for e in hist], dtype=float) if hist else pd.Series(dtype=float)
    returns = curve.pct_change().dropna() if len(curve) > 1 else pd.Series(dtype=float)
    return {
        "cash": round(paper["cash"], 2),
        "equity": round(equity, 2),
        "start_equity": paper["start_equity"],
        "total_pnl": round(equity - paper["start_equity"], 2),
        "return_pct": round(equity / paper["start_equity"] - 1.0, 6)
                      if paper.get("start_equity") else None,
        "sharpe": round(signals.sharpe(returns), 3) if len(returns) > 1 else None,
        "max_drawdown": round(signals.max_drawdown(curve), 4) if len(curve) > 1 else None,
        "positions": positions,
        "pending_trades": paper.get("pending_trades", []),
        "trades": paper.get("trades", [])[-100:],
        "equity_history": hist,
        "events": events,
        "created": paper.get("created"),
    }