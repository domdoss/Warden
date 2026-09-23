#!/usr/bin/env python3
"""Shadow forward test — post-close evidence collection for the intraday
signal candidates. NO orders, NO engine state changes: pure ledger appends.

The intraday-structure hunt (intraday_structure_validation.py + survivor_stress.py)
concluded NO candidate is REAL yet; MU gap-continuation k=0.5 is the closest
(SUSPECT: in-sample edge concentrated in the recent half, so it needs forward
out-of-sample evidence). This logger collects exactly that: once per session,
AFTER the close, it computes each tracked signal's hypothetical trade for the
day from the same stored Alpaca 1-minute bars and charges the same per-side
cost, appending one row per signal per session to a growing JSON-lines ledger.

Tracked signals (definitions imported from the validator, never re-derived):
- MU gap-cont k=0.5 (the semi-plausible candidate) plus jitter cells k=0.4/0.6
- MU gap-cont pooled {0.4, 0.5, 0.6} as one signal (a day can fire up to 3x)
- CVX VWAP-reversion k=3.0 (a session can produce multiple round trips)
- TXN ORB5
- KO fixed cell long 09:30-10:30 (fires every session by construction)
- cross-sectional reversion k=3.0 (breadth_validation.py's xsec cell: all 10
  engine names on the validator's aligned 390-minute grid; priors are every
  grid session strictly before the scored one, the validator's expanding
  scheme)

Daily-horizon signals (horizon_validation.py cells, hypothetical only — never
wired into the engine). Registry: DAILY_SIGNALS below — one line per signal.
- GEV REV k=1.0 H=3 (graded REAL), NVDA REV k=1.0 H=5 (SUSPECT),
  V REV k=1.0 H=3 (SUSPECT).
The validator's own load_daily / build_feats / cell_trades / fill define the
signal (signal at the close of day i, entry at the open of day i+1, exit at
the close of day i+H, 2 bps/side). Each fired day is its own position, as in
the validator (overlapping positions are allowed). Ledger rows carry
"horizon": "daily" and a "kind":
- "signal": one per (signal, session) — fired or not; a fired one is the
  ENTRY row (entry at the next session's open, not yet known at 16:20).
- "exit": one per fired day, written by whichever run first sees day i+H
  complete, with the realised net bps; "entry_origin" is the origin of its
  signal row. Open positions are just signal rows without an exit row, so
  they survive across timer runs.

Honesty contract:
- Idempotent: a (signal, date) done-set read from the ledger means restarts and
  re-runs never double-count a session.
- A session is scored only when its bars are complete (first and last minute of
  the session present in the data); torn data writes nothing, leaves the
  session undone, and a later run picks it up. No retry logic — just the facts.
- The px-capturing re-implementations of the validator's trade loops are
  cross-checked against the validator's own functions on every scored session;
  any divergence aborts the run rather than logging a differing trade.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402
import intraday_structure_validation as base  # noqa: E402
import breadth_validation as breadth  # noqa: E402  (xsec cell + aligned grid)
import horizon_validation as hv  # noqa: E402  (daily-horizon cells)
import pandas as pd  # noqa: E402
import paper  # noqa: E402  (shared Alpha Stack paper account — fake money)

LEDGER = Path("/opt/Warden/trading/.alpha-stack/daytrade/shadow_forward.jsonl")
TICKERS = ["MU", "CVX", "TXN", "KO"]
GAP_KS = (0.4, 0.5, 0.6)
VWAP_K = 3.0
ORB_N = 5
KO_CELL = (0, 60)        # bars [a, b): entry = close of bar 0, exit = close of bar 59
XSEC_K = 3.0             # cross-sectional reversion k-std (breadth xsec cell)
EDGE_BARS = 90           # seconds into/out of the session a bar may sit and still count

# Daily-horizon signals: (ticker, horizon_validation cell spec, stress grade).
# HOOK — add a further daily signal with ONE line here (any hv.cells()-shaped
# spec works: reversion / momentum / mom-vol / rev-vol / w52).
DAILY_SIGNALS = [
    ("GEV", {"family": "reversion", "k": 1.0, "H": 3}, "REAL"),
    ("NVDA", {"family": "reversion", "k": 1.0, "H": 5}, "SUSPECT"),
    ("V", {"family": "reversion", "k": 1.0, "H": 3}, "SUSPECT"),
]

# Paper-account posting (fake money). Only FORWARD trades post: intraday rows
# the timer wrote (origin "scheduled"), daily exits whose ENTRY row the timer
# wrote (entry_origin "scheduled"), and only for sessions on/after
# FORWARD_START — the timer's pre-existing "scheduled" rows for 09-16/09-17
# were gap backfills inside the in-sample window, not forward trades.
SHADOW_NOTIONAL_PCT = 10.0      # notional per trade = this % of equity at entry
FORWARD_START = "2026-09-23"    # first session after paper posting was wired

CFG = knobs.defaults()
COST_BPS = round(daytrade.cost_per_fill(CFG) * 1e4, 2)


# ---------------------------------------------------------------------------
# Session plumbing
# ---------------------------------------------------------------------------

def last_sessions(n: int) -> list[date]:
    """The last n completed sessions, oldest first."""
    days: list[date] = []
    d = daytrade.last_session()
    while len(days) < n:
        days.append(d)
        d -= timedelta(days=1)
        while daytrade.session_bounds(d) is None:
            d -= timedelta(days=1)
    return list(reversed(days))


def load_sessions(t: str) -> dict:
    """Complete per-session OHLCV arrays for one ticker. Torn sessions (first
    or last minute of the session missing from the data) are excluded — they
    are never scored, so no wrong close is ever logged."""
    df = daytrade.fetch_history(t)
    sess = {}
    for d, g in df.groupby(np.array(df.index.date)):
        b = daytrade.session_bounds(d)
        if not b:
            continue
        idx = g.index
        if idx[0] > b[0] + timedelta(seconds=EDGE_BARS):
            continue
        if idx[-1] < b[1] - timedelta(seconds=EDGE_BARS):
            continue
        sess[d] = {k: g[k].to_numpy() for k in ("Open", "High", "Low", "Close", "Volume")}
    return sess


# ---------------------------------------------------------------------------
# Signal evaluation (px-capturing mirrors of the validator's loops)
# ---------------------------------------------------------------------------

def gap_row(d: date, s: dict, prev: dict, k: float) -> dict:
    """MU gap-continuation cell: gap beyond k prior-day ranges at the open,
    trade continuation, entry at the first bar's close, hold to the close."""
    prev_close = float(prev["Close"][-1])
    prev_rng = float(prev["High"].max() - prev["Low"].min())
    if prev_rng <= 0:
        return {"date": d.isoformat(), "signal": f"MU gap-cont k={k}",
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": "prior session range is zero"}
    gu = (float(s["Open"][0]) - prev_close) / prev_rng
    if abs(gu) <= k:
        return {"date": d.isoformat(), "signal": f"MU gap-cont k={k}",
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": f"gap {gu:+.2f}x prior range, <= k={k}"}
    side = "long" if gu > 0 else "short"
    entry, exit_px = float(s["Close"][0]), float(s["Close"][-1])
    net, gross = base.fill(side, entry, exit_px)
    ref = base.gap_trades(d, s, prev, k, "cont")
    if not ref or ref[0][1] != side or abs(ref[0][2] - net) > 1e-9 or abs(ref[0][3] - gross) > 1e-9:
        raise RuntimeError(f"gap cell k={k} diverged from the validator on {d}")
    return {"date": d.isoformat(), "signal": f"MU gap-cont k={k}",
            "side": side, "entry_px": round(entry, 4), "exit_px": round(exit_px, 4),
            "gross_bps": round(gross, 2), "net_bps": round(net, 2), "fired": True,
            "reason": f"gap {gu:+.2f}x prior range > k={k}"}


def gap_pooled_row(d: date, s: dict, prev: dict, single: dict) -> dict:
    """MU gap-cont pooled {0.4, 0.5, 0.6} as one signal. The fill (side, entry,
    exit) is identical for every k that fires — only the threshold differs —
    so one row carries the session's trade with n_trades = how many k fired
    and bps summed over those (the survivor_stress.py D-pool convention)."""
    ks = [k for k in GAP_KS if single[k]["fired"]]
    name = "MU gap-cont pooled k={0.4,0.5,0.6}"
    if not ks:
        return {"date": d.isoformat(), "signal": name,
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": single[GAP_KS[0]]["reason"] + " (no k in {0.4,0.5,0.6} fired)"}
    one = single[ks[0]]
    return {"date": d.isoformat(), "signal": name,
            "side": one["side"], "entry_px": one["entry_px"], "exit_px": one["exit_px"],
            "gross_bps": round(one["gross_bps"] * len(ks), 2),
            "net_bps": round(one["net_bps"] * len(ks), 2), "fired": True,
            "n_trades": len(ks),
            "reason": f"fired for k={','.join(str(k) for k in ks)} "
                      f"({one['reason']}; {len(ks)}x multiplicity)"}


def vwap_row(d: date, s: dict) -> dict:
    """CVX VWAP-reversion k=3.0: fade moves beyond the +-3 std VWAP band, exit
    on a VWAP touch or the close. A session can produce several round trips;
    one row carries the first entry / last exit and bps summed over the
    session's trades, with each trade in the reason."""
    if len(s["Close"]) < base.VWAP_WARM + 2:
        return {"date": d.isoformat(), "signal": f"CVX VWAP-reversion k={VWAP_K}",
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": "session too short for a std band"}
    dev, z = base.vwap_state(s)
    c = s["Close"]
    trades = []
    side = entry = None
    for i in range(base.VWAP_WARM, len(c)):
        if side is None:
            if i >= len(c) - 1:
                break
            if z[i] >= VWAP_K:
                side, entry = "short", float(c[i])
            elif z[i] <= -VWAP_K:
                side, entry = "long", float(c[i])
        elif (side == "long" and dev[i] >= 0) or (side == "short" and dev[i] <= 0):
            trades.append((side, entry, float(c[i])))
            side = entry = None
    if side is not None:
        trades.append((side, entry, float(c[-1])))
    ref = base.vwap_trades(d, dev, z, c, VWAP_K)
    if len(ref) != len(trades):
        raise RuntimeError(f"VWAP k={VWAP_K} trade count diverged from the validator on {d}")
    detail = []
    gross_sum = net_sum = 0.0
    for (_, rside, rnet, rgross), (side, entry, exit_px) in zip(ref, trades):
        net, gross = base.fill(side, entry, exit_px)
        if rside != side or abs(rnet - net) > 1e-9 or abs(rgross - gross) > 1e-9:
            raise RuntimeError(f"VWAP k={VWAP_K} diverged from the validator on {d}")
        detail.append(f"{side} {net:+.1f}bps")
        gross_sum += gross
        net_sum += net
    name = f"CVX VWAP-reversion k={VWAP_K}"
    if not trades:
        return {"date": d.isoformat(), "signal": name,
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": "price never left the +-3 std VWAP band"}
    return {"date": d.isoformat(), "signal": name,
            "side": trades[0][0], "entry_px": round(trades[0][1], 4),
            "exit_px": round(trades[-1][2], 4),
            "gross_bps": round(gross_sum, 2), "net_bps": round(net_sum, 2),
            "fired": True, "n_trades": len(trades),
            "reason": f"{len(trades)} round trip(s): " + "; ".join(detail)}


def orb_row(d: date, s: dict) -> dict:
    """TXN ORB5: first break of the first 5 bars' range, stop at the far side
    of the range, exit at the stop or the session close."""
    h, l, c = s["High"], s["Low"], s["Close"]
    n = len(c)
    name = f"TXN ORB{ORB_N}"
    if n < ORB_N + 2:
        return {"date": d.isoformat(), "signal": name,
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": "session too short for a 5-bar opening range"}
    hi, lo = float(h[:ORB_N].max()), float(l[:ORB_N].min())
    for i in range(ORB_N, n - 1):
        if c[i] > hi:
            side, stop = "long", lo
            break
        if c[i] < lo:
            side, stop = "short", hi
            break
    else:
        return {"date": d.isoformat(), "signal": name,
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": "no break of the 5-bar opening range"}
    entry, j = float(c[i]), i + 1
    beyond = np.flatnonzero(l[j:] <= stop) if side == "long" else np.flatnonzero(h[j:] >= stop)
    exit_px = stop if len(beyond) else float(c[-1])
    net, gross = base.fill(side, entry, exit_px)
    ref = base.orb_trades(d, s, ORB_N)
    if not ref or ref[0][1] != side or abs(ref[0][2] - net) > 1e-9 or abs(ref[0][3] - gross) > 1e-9:
        raise RuntimeError(f"ORB{ORB_N} diverged from the validator on {d}")
    how = "stopped at the far side of the range" if len(beyond) else "held to the close"
    return {"date": d.isoformat(), "signal": name,
            "side": side, "entry_px": round(entry, 4), "exit_px": round(exit_px, 4),
            "gross_bps": round(gross, 2), "net_bps": round(net, 2), "fired": True,
            "reason": f"{'up' if side == 'long' else 'down'}-break of the 5-bar OR, {how}"}


def ko_row(d: date, s: dict) -> dict:
    """KO fixed cell: long 09:30-10:30 every session, entry at the first bar's
    close, exit at the 10:29 bar's close."""
    a, b = KO_CELL
    name = "KO long 0930-1030"
    if len(s["Close"]) < b:
        return {"date": d.isoformat(), "signal": name,
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": "session shorter than the 09:30-10:30 cell"}
    entry, exit_px = float(s["Close"][a]), float(s["Close"][b - 1])
    net, gross = base.fill("long", entry, exit_px)
    return {"date": d.isoformat(), "signal": name,
            "side": "long", "entry_px": round(entry, 4), "exit_px": round(exit_px, 4),
            "gross_bps": round(gross, 2), "net_bps": round(net, 2), "fired": True,
            "reason": "fixed cell: long every session by construction"}


_XSEC_GRID: dict | None = None   # breadth validator grid, built once per run


def xsec_grid() -> dict:
    """The breadth validator's aligned session grid (its own build_grid: bars
    on the fixed 390-minute 09:30-15:59 grid, a missing minute forward-fills
    the last close with volume 0; a session is in the grid only when every
    name traded enough minutes). Maps each grid session date to its row."""
    global _XSEC_GRID
    if _XSEC_GRID is None:
        breadth.build_grid()
        _XSEC_GRID = {d: j for j, d in enumerate(breadth.SESS)}
    return _XSEC_GRID


def xsec_row(d: date) -> dict | None:
    """Cross-sectional reversion k=3.0 — breadth_validation.py's xsec cell,
    mirrored with px capture: each bar, rank the 10 engine names by
    session-return-so-far; short the top name when its spread over the group
    mean exceeds k prior-only std of that minute-of-day's top-spread, long
    the bottom name on the mirrored condition. Entry at the signal bar's
    close, exit at the close exactly 30 bars later. Priors are every grid
    session strictly before d (the validator's expanding scheme, >= 15
    required). Returns None when d is not in the validator's grid — a torn
    session writes nothing and stays undone, like the single-ticker cells."""
    name = f"xsec-revert k={XSEC_K}"
    j = xsec_grid().get(d)
    if j is None:
        return None
    priors = list(range(0, j))
    if len(priors) < breadth.PRIOR_MIN:
        return {"date": d.isoformat(), "signal": name,
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": f"fewer than {breadth.PRIOR_MIN} prior sessions in stored history"}
    p = np.asarray(priors)
    mT, sT = np.nanmean(breadth.TOP[p], axis=0), np.nanstd(breadth.TOP[p], axis=0)
    mBt, sBt = np.nanmean(breadth.BOT[p], axis=0), np.nanstd(breadth.BOT[p], axis=0)
    okT, okB = sT > 0, sBt > 0
    zt = np.where(okT, (breadth.TOP[j] - mT) / np.where(okT, sT, 1.0), 0.0)
    zb = np.where(okB, (breadth.BOT[j] - mBt) / np.where(okB, sBt, 1.0), 0.0)
    fire_top, fire_bot = zt > XSEC_K, zb > XSEC_K
    fired = np.flatnonzero(fire_top | fire_bot)
    fired = fired[(fired >= breadth.WARM) & (fired <= breadth.LAST_ENTRY)]
    trades, cur = [], 0
    for i in fired:
        if i < cur:
            continue
        rets = breadth.R[j, :len(breadth.NAMES), i]
        if fire_top[i]:
            t_i, side = int(np.argmax(rets)), "short"
        else:
            t_i, side = int(np.argmin(rets)), "long"
        entry = float(breadth.C[j, t_i, i])
        exit_px = float(breadth.C[j, t_i, i + breadth.HORIZON])
        net, gross = base.fill(side, entry, exit_px)
        trades.append((side, breadth.NAMES[t_i], int(i), entry, exit_px, net, gross))
        cur = i + breadth.HORIZON
    ref = breadth.xsec_trades(XSEC_K, [([j], priors)])
    if len(ref) != len(trades):
        raise RuntimeError(f"xsec-revert k={XSEC_K} trade count diverged from the validator on {d}")
    for (_, rside, rnet, rgross), tr in zip(ref, trades):
        if rside != tr[0] or abs(rnet - tr[5]) > 1e-9 or abs(rgross - tr[6]) > 1e-9:
            raise RuntimeError(f"xsec-revert k={XSEC_K} diverged from the validator on {d}")
    if not trades:
        return {"date": d.isoformat(), "signal": name,
                "side": None, "entry_px": None, "exit_px": None,
                "gross_bps": None, "net_bps": None, "fired": False,
                "reason": f"top/bottom spread never left the +-{XSEC_K} prior-std band "
                          f"(bars {breadth.WARM}..{breadth.LAST_ENTRY})"}
    detail = []
    gross_sum = net_sum = 0.0
    for side, tkr, i, _entry, _exit_px, net, gross in trades:
        m = 570 + i
        detail.append(f"{side} {tkr} {m // 60:02d}:{m % 60:02d} {net:+.1f}bps")
        gross_sum += gross
        net_sum += net
    return {"date": d.isoformat(), "signal": name,
            "side": trades[0][0], "entry_px": round(trades[0][3], 4),
            "exit_px": round(trades[-1][4], 4),
            "gross_bps": round(gross_sum, 2), "net_bps": round(net_sum, 2),
            "fired": True, "n_trades": len(trades), "ticker": trades[0][1],
            "reason": f"{len(trades)} fade(s): " + "; ".join(detail)}


# ---------------------------------------------------------------------------
# Daily-horizon signals (horizon_validation.py cells)
# ---------------------------------------------------------------------------

def daily_name(t: str, spec: dict) -> str:
    return f"{t} {hv.cell_name(spec)}"


def daily_complete(t: str, dates: set) -> dict:
    """{date: bool} — the session's first and last minute are present in the
    stored bars (the EDGE_BARS rule the intraday rows use). hv.load_daily only
    drops sessions with < 30 bars, so a partially fetched LATEST session would
    otherwise feed a wrong close into the z-score or an exit."""
    if not dates:
        return {}
    df = pd.read_pickle(hv.CACHE / f"{t}.pkl")
    df = df[np.array(df.index.date) >= min(dates)]
    df = daytrade._session_only(df)
    out = {}
    for d in dates:
        b = daytrade.session_bounds(d)
        idx = df.index[np.array(df.index.date) == d]
        out[d] = bool(b and len(idx)
                      and idx[0] <= b[0] + timedelta(seconds=EDGE_BARS)
                      and idx[-1] >= b[1] - timedelta(seconds=EDGE_BARS))
    return out


def next_sessions(d: date, h: int) -> tuple[date, date]:
    """(next session after d, the h-th session after d) on the exchange
    calendar — the planned entry open / exit close for a fire on day d."""
    out, x = [], d
    while len(out) < h:
        x += timedelta(days=1)
        if daytrade.session_bounds(x) is not None:
            out.append(x)
    return out[0], out[-1]


def daily_rows(days: list, ledger: list, origin: str, done: set) -> list[dict]:
    """New daily-horizon ledger rows: a "signal" row per (signal, session in
    the window) and an "exit" row for every open position (fired signal row
    without an exit, from ANY earlier run) whose day i+H is now complete."""
    rows: list[dict] = []
    by_ticker: dict[str, list] = {}
    for t, spec, grade in DAILY_SIGNALS:
        by_ticker.setdefault(t, []).append((spec, grade))
    for t, specs in by_ticker.items():
        daily = hv.load_daily(t)
        if daily is None:
            print(json.dumps({"ticker": t, "skipped": "no cached bars"}), flush=True)
            continue
        dd, o, c = daily["days"], daily["o"], daily["c"]
        n, idx = len(dd), {d: i for i, d in enumerate(dd)}
        feats = hv.build_feats(c)
        # open positions for this ticker's signals (earlier runs + this one)
        opens = {}
        names = {daily_name(t, s) for s, _ in specs}
        exited = {(r["signal"], r["fire_date"]) for r in ledger
                  if r.get("kind") == "exit" and r["signal"] in names}
        need = set(days)
        max_h = max(s["H"] for s, _ in specs)
        for d in days:                    # window fires may close within the window
            if d in idx:
                need.update(dd[idx[d]:idx[d] + max_h + 1])
        for r in ledger:
            if (r.get("kind") == "signal" and r["fired"] and r["signal"] in names
                    and (r["signal"], r["date"]) not in exited):
                opens[(r["signal"], r["date"])] = r
        for (_, fd), r in opens.items():
            i = idx.get(date.fromisoformat(fd))
            if i is not None:
                need.update(dd[i:i + r["H"] + 1])
        complete = daily_complete(t, need)
        for spec, grade in specs:
            name, H = daily_name(t, spec), spec["H"]
            # fired days per the validator's own cell_trades; the price arrays
            # are padded past the last session so fires whose exit is still in
            # the future come back too (with NaN bps, only the side is used).
            pad = np.full(H + 1, np.nan)
            fires = {fd: side for fd, side, _, _ in hv.cell_trades(
                spec, feats, dd + [None] * (H + 1),
                np.concatenate([o, pad]), np.concatenate([c, pad]))}
            real = {fd: (side, net, gross) for fd, side, net, gross in
                    hv.cell_trades(spec, feats, dd, o, c)}
            for d in days:
                if (name, d.isoformat(), "signal") in done:
                    continue
                if d not in idx or not complete.get(d):
                    continue                     # torn/missing: stays undone
                i = idx[d]
                zi = float(feats["z"][i]) if not np.isnan(feats["z"][i]) else None
                zs = f"5-day return z={zi:+.2f}" if zi is not None else "z undefined"
                ent, ext = next_sessions(d, H)
                row = {"date": d.isoformat(), "signal": name, "horizon": "daily",
                       "kind": "signal", "grade": grade, "H": H,
                       "z": round(zi, 3) if zi is not None else None,
                       "close": round(float(c[i]), 4),
                       "entry_px": None, "exit_px": None,
                       "gross_bps": None, "net_bps": None}
                if d in fires:
                    row.update({"fired": True, "side": fires[d],
                                "planned_entry": f"{ent.isoformat()} open",
                                "planned_exit": f"{ext.isoformat()} close",
                                "reason": f"ENTRY: {zs}, |z| > k -> {fires[d]} "
                                          f"(fade), hold {H} sessions"})
                    opens[(name, d.isoformat())] = {**row, "origin": origin}
                else:
                    row.update({"fired": False, "side": None,
                                "reason": f"{zs}, not beyond the cell threshold"})
                rows.append(row)
            for (sname, fd), r in sorted(opens.items()):
                if sname != name or (name, fd, "exit") in done:
                    continue
                fdd = date.fromisoformat(fd)
                i = idx.get(fdd)
                if i is None:
                    raise RuntimeError(f"{name}: open position fired {fd} is no longer "
                                       "a session in the validator's daily series")
                j = i + H
                if j >= n or not all(complete.get(x) for x in (dd[i], dd[i + 1], dd[j])):
                    continue                     # exit not yet complete: stays open
                side = r["side"]
                entry, exit_px = float(o[i + 1]), float(c[j])
                net, gross = hv.fill(side, entry, exit_px)
                ref = real.get(fdd)
                if (ref is None or ref[0] != side or abs(ref[1] - net) > 1e-9
                        or abs(ref[2] - gross) > 1e-9):
                    raise RuntimeError(f"{name} fired {fd} diverged from the validator")
                rows.append({"date": dd[j].isoformat(), "signal": name,
                             "horizon": "daily", "kind": "exit", "grade": grade,
                             "H": H, "fire_date": fd,
                             "entry_date": dd[i + 1].isoformat(), "side": side,
                             "entry_px": round(entry, 4), "exit_px": round(exit_px, 4),
                             "gross_bps": round(gross, 2), "net_bps": round(net, 2),
                             "fired": True, "entry_origin": r.get("origin", "?"),
                             "equity_at_entry": r.get("equity_at_signal"),
                             "reason": f"EXIT: {side} {dd[i + 1]} open -> {dd[j]} close "
                                       f"({H} sessions), net {net:+.1f} bps"})
    return rows


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------

def read_ledger(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def session_rows(d: date, sess: dict) -> list[dict]:
    """All signal rows for one session date, in tracker order."""
    rows: list[dict] = []
    mu = sess.get("MU", {})
    if d in mu:
        prev_days = [x for x in mu if x < d]
        if prev_days:
            single = {k: gap_row(d, mu[d], mu[max(prev_days)], k) for k in GAP_KS}
            rows += [single[k] for k in GAP_KS]
            rows.append(gap_pooled_row(d, mu[d], mu[max(prev_days)], single))
        else:
            for k in GAP_KS:
                rows.append({"date": d.isoformat(), "signal": f"MU gap-cont k={k}",
                             "side": None, "entry_px": None, "exit_px": None,
                             "gross_bps": None, "net_bps": None, "fired": False,
                             "reason": "no prior session in stored history"})
            rows.append({"date": d.isoformat(),
                         "signal": "MU gap-cont pooled k={0.4,0.5,0.6}",
                         "side": None, "entry_px": None, "exit_px": None,
                         "gross_bps": None, "net_bps": None, "fired": False,
                         "reason": "no prior session in stored history"})
    if d in sess.get("CVX", {}):
        rows.append(vwap_row(d, sess["CVX"][d]))
    if d in sess.get("TXN", {}):
        rows.append(orb_row(d, sess["TXN"][d]))
    if d in sess.get("KO", {}):
        rows.append(ko_row(d, sess["KO"][d]))
    xrow = xsec_row(d)
    if xrow is not None:
        rows.append(xrow)
    return rows


def row_key(r: dict) -> tuple:
    """Done-set key. Intraday rows: (signal, date, None) — unchanged meaning.
    Daily signal rows: (signal, date, "signal"); daily exit rows are keyed by
    the position they close: (signal, fire_date, "exit")."""
    if r.get("kind") == "exit":
        return (r["signal"], r["fire_date"], "exit")
    return (r["signal"], r["date"], r.get("kind"))


def backfill(n: int, origin: str, path: Path, daily_only: bool = False,
             cache_only: bool = False) -> None:
    days = last_sessions(n)
    ledger = read_ledger(path)
    done = {row_key(r) for r in ledger}
    written = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    refreshed: set[str] = set()
    with path.open("a", encoding="utf-8") as f:
        if not daily_only:
            written += intraday_backfill(days, origin, f, done)
            refreshed |= set(TICKERS) | set(breadth.NAMES)
        # Same data source as the intraday rows: daytrade.fetch_history
        # (alpaca_data.history) extends each ticker's stored 1-min cache to the
        # SIP cut-off; horizon_validation.load_daily then reads the full-depth
        # cache. --cache-only skips the extension (no API calls at all).
        if not cache_only:
            for t in sorted({t for t, _, _ in DAILY_SIGNALS} - refreshed):
                daytrade.fetch_history(t)
        for r in daily_rows(days, ledger, origin, done):
            key = row_key(r)
            if key in done:
                continue
            r["cost_bps_per_side"] = COST_BPS
            r["origin"] = origin
            if r.get("kind") == "signal" and r["fired"] and origin == "scheduled":
                r["equity_at_signal"] = _equity_or_none()
            f.write(json.dumps(r) + "\n")
            f.flush()
            done.add(key)
            written += 1
            print(json.dumps(r), flush=True)
    post_pending(path)
    print(f"backfill n={n} sessions ({days[0]}..{days[-1]}): wrote {written} row(s)"
          f"{' [daily only]' if daily_only else ''}"
          f"{' [cache only, no API]' if cache_only else ''}, ledger {path}", flush=True)


def intraday_backfill(days: list, origin: str, f, done: set) -> int:
    sess = {t: load_sessions(t) for t in TICKERS}
    written = 0
    for d in days:
        rows = session_rows(d, sess)
        if not rows:
            print(json.dumps({"date": d.isoformat(),
                              "skipped": "no complete session data for any tracked ticker"}),
                  flush=True)
            continue
        for r in rows:
            key = row_key(r)
            if key in done:
                continue
            r["cost_bps_per_side"] = COST_BPS
            r["origin"] = origin
            f.write(json.dumps(r) + "\n")
            f.flush()
            done.add(key)
            written += 1
            print(json.dumps(r), flush=True)
    return written


# ---------------------------------------------------------------------------
# Paper-account posting (forward trades only, exactly once)
# ---------------------------------------------------------------------------

def _equity_or_none() -> float | None:
    try:
        return round(float(paper.account_snapshot()["equity"]), 2)
    except Exception as e:  # noqa: BLE001 — logged; exit falls back to equity at post
        print(json.dumps({"paper_equity_unavailable": repr(e)}), flush=True)
        return None


def postable(r: dict) -> bool:
    """A FORWARD closed trade: see SHADOW_NOTIONAL_PCT / FORWARD_START."""
    if not r.get("fired") or r.get("net_bps") is None or r.get("entry_px") is None:
        return False
    if r.get("horizon") == "daily":
        return (r.get("kind") == "exit" and r.get("entry_origin") == "scheduled"
                and r["fire_date"] >= FORWARD_START)
    return r.get("origin") == "scheduled" and r["date"] >= FORWARD_START


def _ticker(r: dict) -> str:
    if r.get("ticker"):
        return r["ticker"]
    if r["signal"].startswith("xsec"):           # "1 fade(s): long TXN 10:15 ..."
        return r["reason"].split(": ", 1)[1].split()[1]
    return r["signal"].split()[0]


def _rewrite(path: Path, rows: list[dict]) -> None:
    tmp = path.with_suffix(f".tmp{os.getpid()}")
    tmp.write_text("".join(json.dumps(x) + "\n" for x in rows), encoding="utf-8")
    os.replace(tmp, path)


def post_pending(path: Path) -> int:
    """Post every forward trade not yet posted into the paper account, then
    flag its ledger row posted (qty, pnl, ref). The paper trade carries a
    unique ref (decision_ref) and paper refuses a ref it already holds, so
    even a crash between the post and the flag cannot double-post. A failed
    post is logged and the row stays unposted — the next run posts it."""
    rows = read_ledger(path)
    posted = 0
    for r in rows:
        if r.get("posted") or not postable(r):
            continue
        name = r["signal"]
        key = r["fire_date"] if r.get("kind") == "exit" else r["date"]
        ref = f"shadow:{name}:{key}"
        try:
            eq = r.get("equity_at_entry") or paper.account_snapshot()["equity"]
            entry, net = float(r["entry_px"]), float(r["net_bps"])
            qty = math.floor(eq * SHADOW_NOTIONAL_PCT / 100.0 / entry)
            pnl = qty * entry * net / 1e4
            opened = r.get("entry_date", r["date"])
            trade = {"ticker": _ticker(r), "side": r["side"], "qty": qty,
                     "entry": entry, "exit": float(r["exit_px"]), "pnl": pnl,
                     "opened_at": opened, "closed_at": r["date"]}
            reason = (f"shadow forward-test [{name}] {r['side']} "
                      f"{opened} -> {r['date']}: net {net:+.2f} bps after "
                      f"{r.get('cost_bps_per_side', COST_BPS)} bps/side"
                      + (f" ({r['n_trades']} round trips)" if r.get("n_trades", 1) > 1 else ""))
            new = paper.post_intraday_close(trade, strategy=f"shadow:{name}",
                                            reason=reason, ref=ref)
        except Exception as e:  # noqa: BLE001 — log it, row stays unposted
            print(json.dumps({"paper_post_failed": ref, "error": repr(e)}), flush=True)
            continue
        r.update({"posted": True, "posted_ref": ref, "qty": qty,
                  "pnl": round(pnl, 2), "equity_at_entry": round(float(eq), 2)})
        _rewrite(path, rows)
        posted += 1
        print(json.dumps({"paper_posted": ref, "qty": qty, "pnl": round(pnl, 2),
                          "already_in_account": new is False}), flush=True)
    return posted


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

SIGNAL_ORDER = ([f"MU gap-cont k={k}" for k in GAP_KS]
                + ["MU gap-cont pooled k={0.4,0.5,0.6}",
                   f"CVX VWAP-reversion k={VWAP_K}", f"TXN ORB{ORB_N}",
                   "KO long 0930-1030", f"xsec-revert k={XSEC_K}"])


def _trade_stats(trades: list[dict]) -> dict:
    n = len(trades)
    net = sum(r["net_bps"] for r in trades)
    return {"trades": n,
            "dir_pct": round(100 * sum(1 for r in trades if r["gross_bps"] > 0) / n, 1) if n else None,
            "avg_net_bps_per_trade": round(net / n, 2) if n else None,
            "total_net_bps": round(net, 1)}


def report(path: Path) -> None:
    rows = read_ledger(path)
    print(json.dumps({"ledger": str(path), "rows": len(rows),
                      "cost_bps_per_side": COST_BPS,
                      "round_trip_bps": daytrade.round_trip_bps(CFG)}), flush=True)
    if not rows:
        print("forward ledger is empty — nothing to report yet", flush=True)
        return
    gate_txt = ("(dir >= 51% over all fired {unit}, avg net > 0 after "
                f"{COST_BPS} bps/side, positive in >= 3/4 folds AND the oldest fold, >= 30 trades). ")
    intra = [r for r in rows if r.get("horizon") != "daily"]
    daily = [r for r in rows if r.get("horizon") == "daily"]

    print("=== INTRADAY signals ===", flush=True)
    for name in SIGNAL_ORDER:
        rs = [r for r in intra if r["signal"] == name]
        if not rs:
            continue
        fired = [r for r in rs if r["fired"]]
        n_tr = sum(r.get("n_trades", 1) for r in fired)
        hits = sum(1 for r in fired if r["gross_bps"] > 0)
        net_sum = sum(r["net_bps"] for r in fired)
        rec = {"signal": name, "sessions_logged": len(rs), "fired_sessions": len(fired),
               "trades": n_tr,
               "dir_pct": round(100 * hits / len(fired), 1) if fired else None,
               "avg_net_bps_per_trade": round(net_sum / n_tr, 2) if n_tr else None,
               "total_net_bps": round(net_sum, 1),
               "paper_posted": sum(1 for r in rs if r.get("posted")),
               "paper_pnl_usd": round(sum(r.get("pnl", 0) for r in rs if r.get("posted")), 2),
               "first": min(r["date"] for r in rs), "last": max(r["date"] for r in rs)}
        print(json.dumps(rec), flush=True)
    if intra:
        dates = sorted({r["date"] for r in intra})
        origins: dict[str, int] = {}
        for r in intra:
            origins[r.get("origin", "?")] = origins.get(r.get("origin", "?"), 0) + 1
        print(json.dumps({"sessions": dates[0] + ".." + dates[-1],
                          "origins": origins}), flush=True)
    print("NOTE: REAL requires the same honest gate applied to FORWARD ledger data only "
          + gate_txt.format(unit="bars") +
          "Rows logged before the scheduled timer started (origin=manual) overlap the hunt's "
          "in-sample window and are NOT forward evidence — judge each signal on its "
          "origin=scheduled rows.", flush=True)

    print("=== DAILY-HORIZON signals (hypothetical, never wired) ===", flush=True)
    for t, spec, grade in DAILY_SIGNALS:
        name = daily_name(t, spec)
        sig = [r for r in daily if r["signal"] == name and r.get("kind") == "signal"]
        ex = [r for r in daily if r["signal"] == name and r.get("kind") == "exit"]
        if not sig and not ex:
            continue
        entries = [r for r in sig if r["fired"]]
        closed = {r["fire_date"] for r in ex}
        opens = [r["date"] + " " + r["side"] for r in entries if r["date"] not in closed]
        origins = {}
        for r in sig:
            origins[r.get("origin", "?")] = origins.get(r.get("origin", "?"), 0) + 1
        rec = {"signal": name, "grade_in_sample": grade, "hold_sessions": spec["H"],
               "sessions_logged": len(sig), "entries": len(entries),
               "open_positions": opens,
               "closed_all": _trade_stats(ex),
               "closed_forward_scheduled": _trade_stats(
                   [r for r in ex if r.get("entry_origin") == "scheduled"]),
               "signal_row_origins": origins,
               "paper_posted": sum(1 for r in ex if r.get("posted")),
               "paper_pnl_usd": round(sum(r.get("pnl", 0) for r in ex if r.get("posted")), 2),
               "first": min(r["date"] for r in sig) if sig else None,
               "last": max(r["date"] for r in sig) if sig else None}
        print(json.dumps(rec), flush=True)
    print("NOTE: REAL requires the same honest gate applied to FORWARD ledger data only "
          + gate_txt.format(unit="trades") +
          "A daily trade counts as forward evidence only when its ENTRY row came from the "
          "scheduled timer (entry_origin=scheduled, the closed_forward_scheduled block); "
          "origin=manual seed rows overlap the horizon validator's in-sample window and are "
          "NOT forward evidence. At ~1 fire/week per signal the >= 30-trade floor is months "
          "away — do not read the early rows as a verdict.", flush=True)
    print("DONE shadow-forward-report", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--backfill", type=int, default=1, metavar="N",
                    help="evaluate the last N completed sessions not yet in the ledger "
                         "(default: 1, i.e. the most recent close)")
    ap.add_argument("--report", action="store_true",
                    help="print per-signal totals over the forward ledger (no writes)")
    ap.add_argument("--origin", default="manual", metavar="STR",
                    help='ledger row tag: "manual" (default) or "scheduled"')
    ap.add_argument("--ledger", default=str(LEDGER), metavar="PATH",
                    help="ledger path (default: " + str(LEDGER) + ")")
    ap.add_argument("--daily-only", action="store_true",
                    help="evaluate only the DAILY_SIGNALS (skip the intraday cells)")
    ap.add_argument("--cache-only", action="store_true",
                    help="no Alpaca calls: read the stored bar caches as they are "
                         "(requires --daily-only; the intraday cells always extend the cache)")
    a = ap.parse_args()
    if a.cache_only and not a.daily_only:
        ap.error("--cache-only requires --daily-only")
    path = Path(a.ledger)
    if a.report:
        report(path)
        return
    backfill(a.backfill, a.origin, path, a.daily_only, a.cache_only)
    print("DONE shadow-forward", flush=True)


if __name__ == "__main__":
    main()