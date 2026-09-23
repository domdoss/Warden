#!/usr/bin/env python3
"""Validate DOCUMENTED daily/weekly-horizon effects on the engine's 10 tickers.

Every intraday (30-min horizon) hypothesis family failed the honest gate; this
moves the hunt to the horizon where documented edges actually live (multi-day
momentum, short-term mean-reversion, 52-week-high proximity, vol-regime
conditioning), where the 4 bps round-trip cost is also proportionally smaller
against typical daily moves.

Data: the stored Alpaca SIP 1-min bar caches (.alpha-stack/daytrade/alpaca/
{TICKER}.pkl, adjustment=all, several tickers ~5 years deep). NOTE:
daytrade.fetch_history() slices its RETURN to the last 365 calendar days even
though the on-disk cache holds the full depth, so the cache is read directly
here. The session filter (daytrade._session_only: 09:30-16:00 ET, early
closes at 13:00) and the cost model (daytrade.cost_per_fill = 2.0 bps/side =
4 bps round trip) still come from the engine module. Daily aggregates are
rebuilt from the 1-min bars: Open = first session bar's open, Close = last
session bar's close; sessions with < 30 session bars are torn and skipped
(same rule as intraday_structure_validation.load). Only COMPLETED sessions
(daytrade.last_session mask) are used. Nothing is written back to the cache.

Signals (fixed a-priori cells, no tuning — 31 per ticker):
  MOM   momentum: 3/5/10/20-day close return -> trade that direction, hold
        1/5 days (entry next-day open, exit close of day+H). 8 cells.
  REV   mean-reversion: 5-day return z-scored against the prior 26
        non-overlapping weekly 5-day returns -> fade when |z| > 1.0/1.5/2.0,
        hold 1/3/5 days. 9 cells.
  MOMV  vol-regime momentum: 20-day realized vol (daily log returns, incl.
        the signal day) ranked against the prior 252 sessions of it
        (percentile, prior-only, >= 126 obs required) conditions momentum
        L=5/10/20 H=5: fire only in the low (<= 30th pct) or high
        (>= 70th pct) regime. 6 cells.
  REVV  same vol filter on reversion k=1.5/2.0, H=3. 4 cells.
  W52   52-week-high proximity (George-Hwang): distance of the close from
        the trailing 252-session close high; near (>= -5%) -> long, hold 5/20
        days (monthly-ish rebalance); deep (<= -20%) -> long or short,
        hold 5. 4 cells.

Honest protocol (momentum_validation.py / intraday_structure_validation.py
pattern, adapted to daily granularity):
- 4 non-overlapping 60-session folds over the LAST 240 sessions; every
  threshold is a fixed grid cell scored on all folds (no selection). All
  normalizations (z baseline, vol percentile, 52w window) use strictly prior
  data by construction; entry is strictly after the feature window (signal at
  day-i close, entry day-i+1 open, exit day-i+H close).
- Gate per ticker per cell (NEVER pooled across tickers): direction >= 51%
  in EVERY fold, avg net bps > 0 after 2.0 bps/side, net-positive in >= 3/4
  folds AND the oldest fold, >= 30 trades. A fold with zero fired days cannot
  verify direction -> PASS=False.
- Sanity: adjustment=all should mean no split discontinuities; any day with
  |close-to-close return| > 25% is reported as a possible stale-basis flag,
  never papered over. Short sessions (< 300 bars: early closes, torn days)
  are listed. Tickers with < 492 sessions (252 prior for the 52w window +
  240 scored) are skipped with the reason — their deep features cannot be
  built honestly yet.
- --stress (survivor_stress.py rules), pre-registered, applied to every gate
  pass: A. shifted folds (same gate at offsets -270..-30), B. parameter
  jitter (immediate neighbor cells — a real effect degrades gracefully, luck
  collapses), C. calendar half-split of the FULL history (with ~5 years the
  first half is far outside the selection window). REAL only if the shifted
  gate PASSes AND both halves hold (>= 20 trades, dir >= 51%, net > 0) AND
  every jitter neighbor holds; SUSPECT if the shifted gate alone PASSes;
  else LUCK.

CPU only, no torch, nothing persisted. Output: JSON lines (tee to
logs/horizon_validation.log from the launch command).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402

CACHE = Path("/opt/Warden/trading/.alpha-stack/daytrade/alpaca")
TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]

SCORED = 240                                      # scored sessions (last 4x60)
FOLD_OFFSETS = [(-240, -180), (-180, -120), (-120, -60), (-60, 0)]
FOLD_LABELS = [f"{a}..{b}" for a, b in FOLD_OFFSETS]
SHIFTED_OFFSETS = [(-270, -210), (-210, -150), (-150, -90), (-90, -30)]
SHIFTED_LABELS = [f"{a}..{b}" for a, b in SHIFTED_OFFSETS]

COST = daytrade.cost_per_fill(knobs.defaults())   # 2.0 bps per side
MIN_TRADES = 30        # gate floor: fewer fired days can't prove anything
MIN_CELL_TRADES = 20   # below this a stress cell can neither confirm nor kill
MIN_SESSIONS = 492     # 252 prior (52w window) + 240 scored
Z_WEEKS = 26           # weekly obs behind the reversion z baseline
VOL_WIN = 20           # days of daily log returns per realized-vol sample
VOL_PCT_WIN = 252      # prior vol samples ranked against
VOL_PCT_MIN = 126      # minimum prior samples for a percentile
LOW_VOL, HIGH_VOL = 0.30, 0.70
W52_WIN = 252          # sessions in the 52-week window
DISC_RET = 0.25        # |daily close-to-close return| flagged as discontinuity


def emit(rec: dict) -> None:
    print(json.dumps(rec, default=str), flush=True)


def fill(side: str, entry: float, exit_px: float) -> tuple[float, float]:
    """(net bps, gross bps) of one round trip, per-side cost on both fills."""
    s = 1.0 if side == "long" else -1.0
    fin = entry * (1 + COST) if s > 0 else entry * (1 - COST)
    fout = exit_px * (1 - COST) if s > 0 else exit_px * (1 + COST)
    return s * (fout / fin - 1) * 1e4, s * (exit_px / entry - 1) * 1e4


# ---------------------------------------------------------------------------
# Daily aggregates
# ---------------------------------------------------------------------------

def load_daily(t: str) -> dict | None:
    """Per-session open/close arrays from the full cached 1-min bars."""
    path = CACHE / f"{t}.pkl"
    if not path.exists():
        return None
    df = pd.read_pickle(path)
    df = daytrade._session_only(df)
    last = daytrade.last_session()
    df = df[np.array(df.index.date) <= last]
    if df.empty:
        return None
    g = df.groupby(np.array(df.index.date))
    o_all, c_all, s_all = g["Open"].first(), g["Close"].last(), g.size()
    keep = s_all.index[s_all >= 30]        # torn session -> no honest daily bar
    return {"days": list(keep),
            "o": o_all.loc[keep].to_numpy(float),
            "c": c_all.loc[keep].to_numpy(float),
            "nbars": s_all.loc[keep].to_numpy(int)}


class _RetDict(dict):
    """L-day close-return series, computed on demand for ANY integer lookback
    (jitter neighbors land on off-grid lookbacks like L=4) and memoized."""

    def __init__(self, c: np.ndarray):
        super().__init__()
        self.c = c

    def __missing__(self, L: int) -> np.ndarray:
        r = np.full(len(self.c), np.nan)
        r[L:] = self.c[L:] / self.c[:-L] - 1.0
        self[L] = r
        return r


def build_feats(c: np.ndarray) -> dict:
    """All prior-only features off the daily close series."""
    n = len(c)
    lr = np.full(n, np.nan)
    lr[1:] = np.log(c[1:] / c[:-1])
    ret = _RetDict(c)
    for L in (3, 5, 10, 20):                       # eager for the base grid
        ret[L]
    # 5-day return z vs the prior 26 non-overlapping weekly 5-day returns
    # (offset -10..-135: disjoint from the current 5-day window i-4..i).
    r5, z = ret[5], np.full(n, np.nan)
    for i in range(140, n):
        obs = r5[np.arange(i - 135, i - 9, 5)]
        sd = float(np.std(obs))
        if sd > 0:
            z[i] = (r5[i] - float(np.mean(obs))) / sd
    # 20-day realized vol (incl. day i) + prior-only percentile rank
    rv = np.full(n, np.nan)
    for i in range(VOL_WIN, n):
        rv[i] = float(np.std(lr[i - VOL_WIN + 1:i + 1]))
    vp = np.full(n, np.nan)
    for i in range(VOL_WIN + 1, n):
        obs = rv[max(0, i - VOL_PCT_WIN):i]
        obs = obs[~np.isnan(obs)]
        if len(obs) >= VOL_PCT_MIN:
            vp[i] = float((obs < rv[i]).mean())
    # distance from the trailing 252-session close high
    d52 = np.full(n, np.nan)
    for i in range(W52_WIN - 1, n):
        d52[i] = c[i] / float(np.max(c[i - W52_WIN + 1:i + 1])) - 1.0
    return {"ret": ret, "z": z, "vp": vp, "d52": d52}


# ---------------------------------------------------------------------------
# Signal cells (a-priori grid)
# ---------------------------------------------------------------------------

def cells() -> list[dict]:
    out = []
    for L in (3, 5, 10, 20):
        for H in (1, 5):
            out.append({"family": "momentum", "L": L, "H": H})
    for k in (1.0, 1.5, 2.0):
        for H in (1, 3, 5):
            out.append({"family": "reversion", "k": k, "H": H})
    for L in (5, 10, 20):
        for r in ("low", "high"):
            out.append({"family": "mom-vol", "L": L, "H": 5, "regime": r})
    for k in (1.5, 2.0):
        for r in ("low", "high"):
            out.append({"family": "rev-vol", "k": k, "H": 3, "regime": r})
    out += [{"family": "w52", "band": "near", "cut": -0.05, "side": "long", "H": 5},
            {"family": "w52", "band": "near", "cut": -0.05, "side": "long", "H": 20},
            {"family": "w52", "band": "deep", "cut": -0.20, "side": "long", "H": 5},
            {"family": "w52", "band": "deep", "cut": -0.20, "side": "short", "H": 5}]
    return out


def cell_name(s: dict) -> str:
    f = s["family"]
    if f == "momentum":
        return f"MOM L={s['L']} H={s['H']}"
    if f == "reversion":
        return f"REV k={s['k']} H={s['H']}"
    if f == "mom-vol":
        return f"MOMV L={s['L']} H={s['H']} {s['regime']}-vol"
    if f == "rev-vol":
        return f"REVV k={s['k']} H={s['H']} {s['regime']}-vol"
    return f"W52 {s['band']}{s['cut']:+.2f} {s['side']} H={s['H']}"


def jitter(s: dict) -> list[dict]:
    """Immediate neighbor cells, pre-registered (survivor_stress B)."""
    f = s["family"]
    if f == "momentum":
        return [{"family": "momentum", "L": max(2, s["L"] - 1), "H": s["H"]},
                {"family": "momentum", "L": s["L"] + 1, "H": s["H"]},
                {"family": "momentum", "L": s["L"], "H": 2 if s["H"] == 1 else s["H"] - 1}]
    if f == "reversion":
        return [{"family": "reversion", "k": s["k"] - 0.25, "H": s["H"]},
                {"family": "reversion", "k": s["k"] + 0.25, "H": s["H"]},
                {"family": "reversion", "k": s["k"], "H": 2 if s["H"] == 1 else s["H"] - 1}]
    if f == "mom-vol":
        return [{"family": "mom-vol", "L": max(2, s["L"] - 1), "H": s["H"], "regime": s["regime"]},
                {"family": "mom-vol", "L": s["L"] + 1, "H": s["H"], "regime": s["regime"]}]
    if f == "rev-vol":
        return [{"family": "rev-vol", "k": s["k"] - 0.25, "H": s["H"], "regime": s["regime"]},
                {"family": "rev-vol", "k": s["k"] + 0.25, "H": s["H"], "regime": s["regime"]}]
    cut = s["cut"] - 0.05 if s["band"] == "near" else s["cut"] + 0.05
    return [{"family": "w52", "band": s["band"], "cut": cut, "side": s["side"], "H": s["H"]},
            {"family": "w52", "band": s["band"], "cut": s["cut"], "side": s["side"],
             "H": 10 if s["H"] == 5 else 15}]


def cell_trades(s: dict, feats: dict, days: list, o: np.ndarray, c: np.ndarray) -> list:
    """One (fired_day, side, net_bps, gross_bps) per fired day i: signal at the
    close of day i, entry the next day's open, exit the close of day i+H."""
    f = s["family"]
    if f == "momentum" or f == "mom-vol":
        r = feats["ret"][s["L"]]
        fire = ~np.isnan(r) & (r != 0)
        sgn = np.sign(np.where(fire, r, 1.0))
    elif f == "reversion" or f == "rev-vol":
        z = feats["z"]
        fire = ~np.isnan(z) & (np.abs(z) > s["k"])
        sgn = -np.sign(np.where(fire, z, 1.0))
    else:                                            # w52
        d = feats["d52"]
        fire = ~np.isnan(d) & (d >= s["cut"] if s["band"] == "near" else d <= s["cut"])
        sgn = np.full(len(d), 1.0 if s["side"] == "long" else -1.0)
    if f in ("mom-vol", "rev-vol"):
        vp = feats["vp"]
        reg = (vp <= LOW_VOL) if s["regime"] == "low" else (vp >= HIGH_VOL)
        fire = fire & ~np.isnan(vp) & reg
    n, H, out = len(days), s["H"], []
    for i in np.nonzero(fire)[0]:
        j = i + H                                    # exit close of day i+H
        if j >= n:                                   # no completed exit yet
            continue
        side = "long" if sgn[i] > 0 else "short"
        net, gross = fill(side, float(o[i + 1]), float(c[j]))
        out.append((days[i], side, net, gross))
    return out


# ---------------------------------------------------------------------------
# Gate, halves, stress (survivor_stress.py rules at daily granularity)
# ---------------------------------------------------------------------------

def day_fold_map(days: list, offsets: list, labels: list) -> dict:
    m = {}
    for (a, b), lab in zip(offsets, labels):
        fold_days = days[a:] if b == 0 else days[a:b]
        m.update({d: lab for d in fold_days})
    return m


def gate(trades: list, day_fold: dict, labels: list) -> dict:
    """Honest gate at daily granularity: dir >= 51% in EVERY fold, avg net > 0,
    >= 3/4 folds net-positive AND the oldest fold, >= 30 trades."""
    folds: dict[str, list] = {lab: [] for lab in labels}
    for d, side, net, gross in trades:
        lab = day_fold.get(d)
        if lab:
            folds[lab].append((net, gross))
    rows, pos, hits, tot, net_sum, dir_all = [], 0, 0, 0, 0.0, True
    for lab in labels:
        f = folds[lab]
        n = len(f)
        if n == 0:
            dir_all = False                          # silent fold: can't verify
        fh = sum(1 for _, g in f if g > 0)
        fnet = sum(net for net, _ in f)
        if n and 100 * fh / n < 51.0:
            dir_all = False
        rows.append({"fold": lab, "trades": n,
                     "dir_pct": round(100 * fh / n, 1) if n else None,
                     "net_bps": round(fnet, 1)})
        pos += fnet > 0
        hits += fh
        tot += n
        net_sum += fnet
    if not tot:
        return {"folds": rows, "trades": 0, "dir_pct": None,
                "avg_net_bps": None, "PASS": False}
    avg = net_sum / tot
    ok = (tot >= MIN_TRADES and dir_all and avg > 0
          and pos >= 3 and rows[0]["net_bps"] > 0)
    return {"folds": rows, "pos_folds": pos, "trades": tot,
            "dir_pct": round(100 * hits / tot, 1),
            "avg_net_bps": round(avg, 2), "total_net_bps": round(net_sum, 1),
            "PASS": bool(ok)}


def halves(trades: list, days: list) -> dict:
    """dir + avg net on the first/second calendar half of the FULL history."""
    mid = days[len(days) // 2]
    out = {}
    for name, sel in (("first_half", lambda d: d < mid),
                      ("second_half", lambda d: d >= mid)):
        f = [(net, gross) for d, _, net, gross in trades if sel(d)]
        n = len(f)
        out[name] = {"trades": n,
                     "dir_pct": round(100 * sum(1 for _, g in f if g > 0) / n, 1) if n else None,
                     "avg_net_bps": round(sum(net for net, _ in f) / n, 2) if n else None}
    return out


def cell_ok(g: dict) -> bool:
    """A stress cell counts as holding if it has enough trades to judge and
    holds (dir >= 51%, net > 0). Fewer than MIN_CELL_TRADES is inconclusive
    and cannot confirm."""
    return (g.get("trades", 0) >= MIN_CELL_TRADES
            and g.get("dir_pct") is not None and g["dir_pct"] >= 51.0
            and g.get("avg_net_bps") is not None and g["avg_net_bps"] > 0)


def fmt_gate(g: dict) -> str:
    if not g.get("trades"):
        return "no trades"
    return (f"dir {g['dir_pct']}%, avg net {g['avg_net_bps']} bps, "
            f"{g.get('pos_folds', '?')}/4 folds positive (oldest "
            f"{g['folds'][0]['net_bps']}), n={g['trades']}, PASS={g['PASS']}")


def fmt_half(h: dict) -> str:
    if not h["trades"]:
        return "no trades"
    return f"dir {h['dir_pct']}%, net {h['avg_net_bps']} bps, n={h['trades']}"


def stress_cell(t: str, spec: dict, feats: dict, days: list, o: np.ndarray,
                c: np.ndarray, shift_fold: dict) -> dict:
    name = cell_name(spec)
    trades = cell_trades(spec, feats, days, o, c)
    g_s = gate(trades, shift_fold, SHIFTED_LABELS)
    h = halves(trades, days)
    emit({"ticker": t, "cell": name, "test": "A_shifted_folds", "gate": g_s})
    emit({"ticker": t, "cell": name, "test": "C_half_split", **h})
    jok, jg = True, {}
    for js in jitter(spec):
        jn = cell_name(js)
        jg[jn] = gate(cell_trades(js, feats, days, o, c), shift_fold, SHIFTED_LABELS)
        emit({"ticker": t, "cell": name, "test": "B_jitter", "params": jn,
              "gate": jg[jn]})
        jok = jok and cell_ok(jg[jn])
    hok = cell_ok(h["first_half"]) and cell_ok(h["second_half"])
    v = "REAL" if (g_s["PASS"] and hok and jok) else \
        ("SUSPECT" if g_s["PASS"] else "LUCK")
    return {"cell": name, "verdict": v,
            "evidence": (f"shifted: {fmt_gate(g_s)}; halves: first "
                         f"{fmt_half(h['first_half'])}, second {fmt_half(h['second_half'])}; "
                         "jitter " + ", ".join(f"{jn}: {fmt_gate(g)}"
                                               for jn, g in jg.items()))}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_ticker(t: str, do_stress: bool) -> dict | None:
    daily = load_daily(t)
    if daily is None:
        emit({"ticker": t, "error": "no cached bars"})
        return None
    days, o, c, nbars = daily["days"], daily["o"], daily["c"], daily["nbars"]
    n = len(days)
    if n < MIN_SESSIONS:
        emit({"ticker": t, "error":
              f"insufficient depth: {n} sessions < {MIN_SESSIONS} "
              f"(252 prior for the 52w window + {SCORED} scored) — extend the "
              "cache and rerun"})
        return {"ticker": t, "verdict": f"SKIPPED (only {n} sessions)"}
    rets = np.abs(c[1:] / c[:-1] - 1.0)
    disc = [str(days[i + 1]) for i in np.nonzero(rets > DISC_RET)[0]]
    short = [(str(d), int(b)) for d, b in zip(days, nbars) if b < 300]
    emit({"ticker": t, "sessions": n, "first": str(days[0]), "last": str(days[-1]),
          "max_abs_daily_ret_pct": round(float(np.nanmax(rets)) * 100, 2),
          "short_sessions_lt300bars": short,
          "discontinuity_flags_gt25pct": disc,
          "note": ("stale-basis/split discontinuity reported, not papered over"
                   if disc else "none")})
    feats = build_feats(c)
    fold = day_fold_map(days, FOLD_OFFSETS, FOLD_LABELS)
    shift_fold = day_fold_map(days, SHIFTED_OFFSETS, SHIFTED_LABELS)
    passes, verdicts = [], []
    for spec in cells():
        trades = cell_trades(spec, feats, days, o, c)
        g = gate(trades, fold, FOLD_LABELS)
        emit({"ticker": t, "cell": cell_name(spec), "family": spec["family"],
              "params": {k: v for k, v in spec.items() if k != "family"},
              "test": "gate", "trades": g["trades"], "dir_pct": g["dir_pct"],
              "avg_net_bps": g["avg_net_bps"], "folds": g["folds"],
              "PASS": g["PASS"]})
        if g["PASS"]:
            passes.append(cell_name(spec))
            if do_stress:
                v = stress_cell(t, spec, feats, days, o, c, shift_fold)
                verdicts.append(v)
                emit({"ticker": t, "STRESS_VERDICT": True, "cell": v["cell"],
                      "verdict": v["verdict"], "evidence": v["evidence"]})
    if not passes:
        summary = "no cell passed the gate"
    else:
        summary = "; ".join(
            f"{v['cell']}={v['verdict']}" if verdicts else p
            for p, v in _pair(passes, verdicts))
    emit({"ticker": t, "FINAL": True, "sessions": n, "cells_tested": len(cells()),
          "gate_passes": passes,
          "stress": ({v["cell"]: v["verdict"] for v in verdicts} if verdicts
                     else "not run (--stress off)" if passes else {}),
          "verdict": summary})
    return {"ticker": t, "verdict": summary}


def _pair(passes: list, verdicts: list) -> list:
    out = []
    for p in passes:
        v = next((x for x in verdicts if x["cell"] == p), None)
        out.append((p, v))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stress", action="store_true",
                    help="run the pre-registered stress battery on gate passes")
    ap.add_argument("--tickers", default=",".join(TICKERS),
                    help="comma list (default: the 10 engine tickers)")
    args = ap.parse_args()
    tickers = [x.strip().upper() for x in args.tickers.split(",") if x.strip()]
    emit({"validator": "horizon_validation", "protocol": {
        "horizon": "daily/weekly (entry next-day open, exit close of day+H)",
        "cost_per_side_bps": round(COST * 1e4, 2),
        "round_trip_bps": daytrade.round_trip_bps(knobs.defaults()),
        "folds": FOLD_LABELS, "shifted_folds": SHIFTED_LABELS,
        "gate": ("dir >= 51% in EVERY fold, avg net bps > 0, >= 3/4 folds "
                 "positive AND oldest fold, >= 30 trades, no silent fold"),
        "cells_per_ticker": len(cells()), "pooled_verdict": "never (per-ticker only)",
        "stress": bool(args.stress), "min_sessions": MIN_SESSIONS}})
    per_ticker = {}
    for t in tickers:
        r = run_ticker(t, args.stress)
        if r:
            per_ticker[t] = r["verdict"]
    emit({"SUMMARY": True, "per_ticker": per_ticker})
    print("DONE horizon-validation", flush=True)


if __name__ == "__main__":
    main()