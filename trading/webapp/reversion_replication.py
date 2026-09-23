#!/usr/bin/env python3
"""Out-of-sample REPLICATION of horizon_validation's 5-day reversion (REV) cells.

Why: horizon_validation.py graded GEV REV k=1.0 H=3 REAL (plus NVDA/V SUSPECT),
but those were selected from 10 tickers x 31 cells. This script asks whether
the SAME a-priori REV cells hold on a pre-registered universe of ~100 liquid
US names that were never looked at (none of the 10 engine tickers).

PRE-REGISTRATION (fixed before any result was seen, 2026-09-22):
- Universe: UNIVERSE below (large S&P 500 names across sectors + index/sector
  ETFs), minus the 10 engine tickers. Names with < hv.MIN_SESSIONS (492)
  sessions are skipped with the reason (same depth rule as horizon_validation).
- Cells: ONLY the 9 REV cells of horizon_validation (k=1.0/1.5/2.0 x H=1/3/5).
- Signal / cost / folds / gate / stress: imported unchanged from
  horizon_validation (build_feats z = 5-day return vs the prior 26
  non-overlapping weekly 5-day returns; fade when |z| > k; signal at day-i
  close, entry day-i+1 OPEN, exit day-i+H CLOSE; 2.0 bps/side; last 240
  sessions in 4x60 folds; dir >= 51% every fold, avg net > 0, >= 3/4 folds
  positive AND oldest, >= 30 trades; --stress = shifted folds -270..-30,
  jitter k +/-0.25 and H-1, calendar half-split; REAL/SUSPECT/LUCK).
- Data: yfinance daily bars, auto_adjust=True (split+dividend adjusted OPEN
  and CLOSE — horizon_validation's Alpaca cache is adjustment=all, i.e. the
  same adjustment). horizon_validation rebuilds daily bars from 1-min SIP bars
  (open = first 09:30 bar open, close = last session bar close); yfinance uses
  the official consolidated open/close prints. Construction replicated:
  open-entry / close-exit, close-to-close z. The source difference is measured
  by --parity (engine tickers re-run on yfinance vs the logged Alpaca result).
  Start 2021-09-01 (the Alpaca cache depth), only completed sessions
  (<= daytrade.last_session()).
- Key statistics: per-cell pass fraction vs an empirical null (same fired
  days, random trade direction, NULL_DRAWS draws per ticker-cell, seed 0);
  cross-ticker distribution of per-ticker avg net bps (gate window AND full
  5-year history) with t-stat + ticker bootstrap CI + a date-block bootstrap
  of the equal-weight daily portfolio (cross-sectional correlation); vol
  terciles; long vs short leg.

Makes NO Alpaca API calls. Downloads are cached under
.alpha-stack/research/daily/{T}.csv. CPU only.

Usage (from /opt/Warden/trading):
  ./bin/python webapp/reversion_replication.py --parity
  ./bin/python webapp/reversion_replication.py --stress > logs/reversion_replication.log 2>&1
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import horizon_validation as hv  # noqa: E402
import daytrade  # noqa: E402

DAILY = Path("/opt/Warden/trading/.alpha-stack/research/daily")
START = "2021-09-01"
ENGINE = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]

# ---- PRE-REGISTERED UNIVERSE (do not edit after results) --------------------
UNIVERSE = [
    # tech / semis
    "GOOGL", "AMZN", "META", "AVGO", "TSLA", "ORCL", "CRM", "ADBE", "AMD", "CSCO",
    "ACN", "IBM", "INTU", "QCOM", "AMAT", "NOW", "LRCX", "KLAC", "ADI", "PANW",
    "ANET", "INTC",
    # communication
    "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS",
    # financials
    "BRK-B", "MA", "BAC", "WFC", "GS", "MS", "C", "AXP", "SCHW", "BLK", "SPGI",
    "PGR", "CB",
    # health care
    "LLY", "UNH", "JNJ", "ABBV", "MRK", "PFE", "TMO", "ABT", "DHR", "AMGN",
    "ISRG", "GILD", "BMY", "VRTX", "MDT", "SYK",
    # consumer discretionary
    "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TJX",
    # staples
    "PG", "PEP", "COST", "WMT", "PM", "MO", "MDLZ", "CL",
    # energy
    "XOM", "COP", "EOG", "SLB", "OXY",
    # industrials
    "CAT", "DE", "HON", "UNP", "UPS", "BA", "RTX", "LMT", "GE", "ETN",
    # materials / utilities / real estate
    "LIN", "SHW", "FCX", "NEM", "NEE", "DUK", "SO", "PLD", "AMT",
    # index + sector ETFs
    "SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV", "XLI", "XLY",
    "XLP", "XLU", "XLB", "XLRE", "XLC", "SMH",
]
assert not set(UNIVERSE) & set(ENGINE), "universe must exclude the engine tickers"
assert len(set(UNIVERSE)) == len(UNIVERSE)

REV_CELLS = [{"family": "reversion", "k": k, "H": H}
             for k in (1.0, 1.5, 2.0) for H in (1, 3, 5)]
NULL_DRAWS = 200
BOOT = 10000
BLOCK = 20            # sessions per block in the date-block bootstrap

# Logged GEV REV k=1.0 H=3 (logs/horizon_validation.log line 284) — parity target
GEV_LOGGED = {"trades": 91, "dir_pct": 62.6, "avg_net_bps": 125.69,
              "fold_net": [2261.5, 2897.7, 4714.5, 1564.3],
              "fold_trades": [21, 22, 30, 18]}

_print_emit = hv.emit
emit = hv.emit


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def load_yf(t: str, fetch: bool = True) -> dict | None:
    """Adjusted daily open/close from yfinance, cached as CSV; completed sessions only."""
    DAILY.mkdir(parents=True, exist_ok=True)
    path = DAILY / f"{t}.csv"
    last = daytrade.last_session()
    df = None
    if path.exists():
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        # stale -> refetch whole; but a cache written in the last 12h is reused even
        # if Yahoo had not yet published the latest session (polite: no refetch loop)
        import time
        recent = time.time() - path.stat().st_mtime < 12 * 3600
        if df.empty or (df.index[-1].date() < last and not recent):
            df = None
    if df is None:
        if not fetch:
            return None
        import yfinance as yf
        h = yf.Ticker(t).history(start=START, end=str(last + timedelta(days=1)),
                                 auto_adjust=True, actions=False)
        if h is None or h.empty:
            return None
        h.index = pd.to_datetime([d.date() for d in h.index])
        df = h[["Open", "High", "Low", "Close", "Volume"]]
        df.to_csv(path)
    df = df[np.array(df.index.date) <= last]
    df = df.dropna(subset=["Open", "Close"])
    df = df[(df["Open"] > 0) & (df["Close"] > 0)]
    if df.empty:
        return None
    return {"days": list(df.index.date), "o": df["Open"].to_numpy(float),
            "c": df["Close"].to_numpy(float)}


# ---------------------------------------------------------------------------
# Per-ticker evaluation
# ---------------------------------------------------------------------------

def both_sides(trades: list, o: np.ndarray, c: np.ndarray, days: list, H: int) -> list:
    """For the null: (day, net_if_long, gross_if_long, net_if_short, gross_if_short)."""
    idx = {d: i for i, d in enumerate(days)}
    out = []
    for d, _, _, _ in trades:
        i = idx[d]
        nl, gl = hv.fill("long", float(o[i + 1]), float(c[i + H]))
        ns, gs = hv.fill("short", float(o[i + 1]), float(c[i + H]))
        out.append((d, nl, gl, ns, gs))
    return out


def null_pass_rate(bs: list, fold: dict, rng: np.random.Generator) -> float:
    if not bs:
        return 0.0
    passes = 0
    for _ in range(NULL_DRAWS):
        flips = rng.random(len(bs)) < 0.5
        tr = [(d, "x", ns, gs) if f else (d, "x", nl, gl)
              for (d, nl, gl, ns, gs), f in zip(bs, flips)]
        passes += hv.gate(tr, fold, hv.FOLD_LABELS)["PASS"]
    return passes / NULL_DRAWS


def summarize(trades: list) -> dict:
    if not trades:
        return {"trades": 0}
    net = np.array([x[2] for x in trades])
    gross = np.array([x[3] for x in trades])
    lg = np.array([x[1] == "long" for x in trades])
    return {"trades": len(trades), "dir_pct": round(100 * float((gross > 0).mean()), 1),
            "avg_net_bps": round(float(net.mean()), 2),
            "long_n": int(lg.sum()),
            "long_avg_net": round(float(net[lg].mean()), 2) if lg.any() else None,
            "short_n": int((~lg).sum()),
            "short_avg_net": round(float(net[~lg].mean()), 2) if (~lg).any() else None}


def _worker(job: tuple) -> tuple:
    """Pool entry: evaluate one ticker, capturing every emitted record (including
    hv.stress_cell's) so the parent prints them in universe order. The null RNG is
    seeded per ticker (seed [0, universe index]) -> identical to a serial run."""
    idx, t, do_stress, do_null = job
    recs: list = []
    global emit
    emit = recs.append
    hv.emit = recs.append
    try:
        daily = load_yf(t, fetch=False)
        if daily is None:
            recs.append({"ticker": t, "error": "no data"})
            return recs, None
        rng = np.random.default_rng([0, idx]) if do_null else None
        return recs, run_ticker(t, daily, do_stress, rng, "yfinance")
    except Exception as e:                                     # noqa: BLE001
        recs.append({"ticker": t, "error": f"{e!r}"})
        return recs, None


def run_ticker(t: str, daily: dict, do_stress: bool, rng, source: str) -> dict | None:
    days, o, c = daily["days"], daily["o"], daily["c"]
    n = len(days)
    if n < hv.MIN_SESSIONS:
        emit({"ticker": t, "source": source, "error":
              f"insufficient depth: {n} sessions < {hv.MIN_SESSIONS}"})
        return None
    rets = np.abs(c[1:] / c[:-1] - 1.0)
    disc = [str(days[i + 1]) for i in np.nonzero(rets > hv.DISC_RET)[0]]
    lr = np.diff(np.log(c))
    vol_full = float(np.std(lr) * np.sqrt(252))
    vol_scored = float(np.std(lr[-hv.SCORED:]) * np.sqrt(252))
    emit({"ticker": t, "source": source, "sessions": n, "first": str(days[0]),
          "last": str(days[-1]), "ann_vol_full": round(vol_full, 3),
          "ann_vol_scored": round(vol_scored, 3),
          "discontinuity_flags_gt25pct": disc})
    feats = hv.build_feats(c)
    fold = hv.day_fold_map(days, hv.FOLD_OFFSETS, hv.FOLD_LABELS)
    shift_fold = hv.day_fold_map(days, hv.SHIFTED_OFFSETS, hv.SHIFTED_LABELS)
    res = {"ticker": t, "sessions": n, "vol": vol_full, "vol_scored": vol_scored,
           "cells": {}}
    for spec in REV_CELLS:
        name = hv.cell_name(spec)
        trades = hv.cell_trades(spec, feats, days, o, c)
        g = hv.gate(trades, fold, hv.FOLD_LABELS)
        full = summarize(trades)
        halves = hv.halves(trades, days)
        null = (null_pass_rate(both_sides(trades, o, c, days, spec["H"]), fold, rng)
                if rng is not None else None)
        rec = {"ticker": t, "source": source, "cell": name, "test": "gate",
               "trades": g["trades"], "dir_pct": g["dir_pct"],
               "avg_net_bps": g["avg_net_bps"], "folds": g["folds"],
               "PASS": g["PASS"], "full_history": full, "halves": halves,
               "null_pass_rate": null}
        verdict = None
        if g["PASS"] and do_stress:
            v = hv.stress_cell(t, spec, feats, days, o, c, shift_fold)
            verdict = v["verdict"]
            emit({"ticker": t, "STRESS_VERDICT": True, "cell": name,
                  "verdict": verdict, "evidence": v["evidence"]})
        rec["verdict"] = verdict
        emit(rec)
        res["cells"][name] = {"gate": g, "full": full, "halves": halves,
                              "null": null, "verdict": verdict,
                              "daily_net": [(tr[0], tr[2]) for tr in trades]}
    return res


# ---------------------------------------------------------------------------
# Parity
# ---------------------------------------------------------------------------

def parity() -> None:
    # 1) exact: GEV from the same Alpaca pkl cache through horizon_validation's code
    d = hv.load_daily("GEV")
    feats = hv.build_feats(d["c"])
    fold = hv.day_fold_map(d["days"], hv.FOLD_OFFSETS, hv.FOLD_LABELS)
    spec = {"family": "reversion", "k": 1.0, "H": 3}
    g = hv.gate(hv.cell_trades(spec, feats, d["days"], d["o"], d["c"]), fold, hv.FOLD_LABELS)
    got = {"trades": g["trades"], "dir_pct": g["dir_pct"], "avg_net_bps": g["avg_net_bps"],
           "fold_net": [f["net_bps"] for f in g["folds"]],
           "fold_trades": [f["trades"] for f in g["folds"]]}
    emit({"PARITY": "alpaca_cache_GEV_REV_k1.0_H3", "sessions": len(d["days"]),
          "last": str(d["days"][-1]), "logged": GEV_LOGGED, "recomputed": got,
          "MATCH": got == GEV_LOGGED})
    # 2) data-source: the 10 engine tickers' REV cells on yfinance vs the logged Alpaca run
    logged = {}
    for line in open("/opt/Warden/trading/logs/horizon_validation.log"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("test") == "gate" and r.get("family") == "reversion":
            logged[(r["ticker"], r["cell"])] = r
    agree = tot = 0
    for t in ENGINE:
        y = load_yf(t)
        if y is None or len(y["days"]) < hv.MIN_SESSIONS:
            emit({"PARITY": "yfinance_vs_alpaca", "ticker": t,
                  "note": f"skipped ({0 if y is None else len(y['days'])} sessions)"})
            continue
        f2 = hv.build_feats(y["c"])
        fm = hv.day_fold_map(y["days"], hv.FOLD_OFFSETS, hv.FOLD_LABELS)
        for s in REV_CELLS:
            nm = hv.cell_name(s)
            gy = hv.gate(hv.cell_trades(s, f2, y["days"], y["o"], y["c"]), fm, hv.FOLD_LABELS)
            la = logged.get((t, nm))
            if la is None:
                continue
            tot += 1
            agree += la["PASS"] == gy["PASS"]
            emit({"PARITY": "yfinance_vs_alpaca", "ticker": t, "cell": nm,
                  "alpaca": {"trades": la["trades"], "dir_pct": la["dir_pct"],
                             "avg_net_bps": la["avg_net_bps"], "PASS": la["PASS"]},
                  "yfinance": {"trades": gy["trades"], "dir_pct": gy["dir_pct"],
                               "avg_net_bps": gy["avg_net_bps"], "PASS": gy["PASS"]}})
    emit({"PARITY_SUMMARY": True, "pass_flag_agreement": f"{agree}/{tot}"})


# ---------------------------------------------------------------------------
# Aggregate statistics
# ---------------------------------------------------------------------------

def tstat(x: np.ndarray) -> float:
    return float(x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))) if len(x) > 1 else float("nan")


def boot_ci(x: np.ndarray, rng) -> list:
    m = rng.choice(x, size=(BOOT, len(x)), replace=True).mean(axis=1)
    return [round(float(np.percentile(m, 2.5)), 2), round(float(np.percentile(m, 97.5)), 2)]


def block_boot(series: np.ndarray, rng) -> dict:
    """Moving-block bootstrap of the mean of a daily series (handles serial overlap
    of H-day holds and cross-sectional correlation already averaged in)."""
    n = len(series)
    nb = int(np.ceil(n / BLOCK))
    starts = rng.integers(0, n - BLOCK + 1, size=(BOOT, nb))
    idx = (starts[:, :, None] + np.arange(BLOCK)[None, None, :]).reshape(BOOT, -1)[:, :n]
    m = series[idx].mean(axis=1)
    return {"mean": round(float(series.mean()), 2),
            "ci95": [round(float(np.percentile(m, 2.5)), 2),
                     round(float(np.percentile(m, 97.5)), 2)],
            "p_le_0": round(float((m <= 0).mean()), 4), "n_days": n}


def aggregate(results: list, rng) -> None:
    for spec in REV_CELLS:
        nm = hv.cell_name(spec)
        rows = [r for r in results if nm in r["cells"]]
        cs = [r["cells"][nm] for r in rows]
        npass = sum(c["gate"]["PASS"] for c in cs)
        null = np.array([c["null"] for c in cs if c["null"] is not None])
        verdicts = {v: sum(c["verdict"] == v for c in cs) for v in ("REAL", "SUSPECT", "LUCK")}
        gate_net = np.array([c["gate"]["avg_net_bps"] for c in cs
                             if c["gate"]["avg_net_bps"] is not None])
        full_net = np.array([c["full"]["avg_net_bps"] for c in cs if c["full"]["trades"]])
        dirs = np.array([c["full"]["dir_pct"] for c in cs if c["full"]["trades"]])
        h1 = np.array([c["halves"]["first_half"]["avg_net_bps"] for c in cs
                       if c["halves"]["first_half"]["trades"]])
        h2 = np.array([c["halves"]["second_half"]["avg_net_bps"] for c in cs
                       if c["halves"]["second_half"]["trades"]])
        lng = np.array([c["full"]["long_avg_net"] for c in cs
                        if c["full"].get("long_avg_net") is not None])
        sht = np.array([c["full"]["short_avg_net"] for c in cs
                        if c["full"].get("short_avg_net") is not None])
        # equal-weight daily portfolio over fired trades (by signal day)
        byday: dict = {}
        for c in cs:
            for d, net in c["daily_net"]:
                byday.setdefault(d, []).append(net)
        ds = sorted(byday)
        port = np.array([np.mean(byday[d]) for d in ds])
        # vol terciles (full-history annualized vol)
        vols = np.array([r["vol"] for r in rows if r["cells"][nm]["full"]["trades"]])
        q1, q2 = np.percentile(vols, [100 / 3, 200 / 3])
        terc = {}
        for lab, sel in (("low", vols <= q1), ("mid", (vols > q1) & (vols <= q2)),
                         ("high", vols > q2)):
            x = full_net[sel]
            pr = [c["gate"]["PASS"] for r, c in zip(rows, cs)
                  if c["full"]["trades"]]
            pr = np.array(pr)[sel]
            terc[lab] = {"n": int(sel.sum()), "vol_range": [round(float(vols[sel].min()), 3),
                                                            round(float(vols[sel].max()), 3)],
                         "mean_full_net_bps": round(float(x.mean()), 2),
                         "t": round(tstat(x), 2), "pass": int(pr.sum())}
        emit({"AGG": True, "cell": nm, "tickers": len(cs), "gate_passes": npass,
              "pass_frac": round(npass / len(cs), 3),
              "null_expected_pass_frac": round(float(null.mean()), 3) if len(null) else None,
              "stress_verdicts": verdicts,
              "gate_window_net": {"mean": round(float(gate_net.mean()), 2),
                                  "median": round(float(np.median(gate_net)), 2),
                                  "t": round(tstat(gate_net), 2),
                                  "boot_ci95": boot_ci(gate_net, rng),
                                  "frac_pos": round(float((gate_net > 0).mean()), 3)},
              "full_history_net": {"mean": round(float(full_net.mean()), 2),
                                   "median": round(float(np.median(full_net)), 2),
                                   "t": round(tstat(full_net), 2),
                                   "boot_ci95": boot_ci(full_net, rng),
                                   "frac_pos": round(float((full_net > 0).mean()), 3)},
              "full_history_dir_mean": round(float(dirs.mean()), 2),
              "halves_mean_net": {"first": round(float(h1.mean()), 2),
                                  "first_t": round(tstat(h1), 2),
                                  "second": round(float(h2.mean()), 2),
                                  "second_t": round(tstat(h2), 2)},
              "legs_mean_net": {"long": round(float(lng.mean()), 2), "long_t": round(tstat(lng), 2),
                                "short": round(float(sht.mean()), 2), "short_t": round(tstat(sht), 2)},
              "ew_portfolio_block_boot": block_boot(port, rng),
              "vol_corr_full_net": round(float(np.corrcoef(vols, full_net)[0, 1]), 3),
              "vol_terciles": terc})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def drift_diagnostic() -> None:
    """POST-HOC (added after the pre-registered run showed the long leg carrying
    the cross-ticker mean): de-drift every trade. Each trade's gross return is
    reduced by sign x mu_H, where mu_H = the ticker's unconditional mean gross
    return of the same holding shape (open i+1 -> close i+H) over its full
    history. What remains is the fade's timing information, not the 2021-26
    equity drift that any long-tilted rule collects."""
    rng = np.random.default_rng(1)
    for spec in REV_CELLS:
        nm, H = hv.cell_name(spec), spec["H"]
        per_t, byday = [], {}
        for t in UNIVERSE:
            y = load_yf(t, fetch=False)
            if y is None or len(y["days"]) < hv.MIN_SESSIONS:
                continue
            days, o, c = y["days"], y["o"], y["c"]
            n = len(days)
            mu = float(np.mean(c[H:n] / o[1:n - H + 1] - 1.0)) * 1e4   # bps
            trades = hv.cell_trades(spec, hv.build_feats(c), days, o, c)
            if not trades:
                continue
            adj = [net - (1.0 if side == "long" else -1.0) * mu
                   for _, side, net, _ in trades]
            per_t.append(float(np.mean(adj)))
            for (d, *_), a in zip(trades, adj):
                byday.setdefault(d, []).append(a)
        x = np.array(per_t)
        port = np.array([np.mean(byday[d]) for d in sorted(byday)])
        emit({"DRIFT_DIAG": True, "cell": nm, "tickers": len(x),
              "dedrifted_full_net": {"mean": round(float(x.mean()), 2),
                                     "median": round(float(np.median(x)), 2),
                                     "t": round(tstat(x), 2),
                                     "boot_ci95": boot_ci(x, rng),
                                     "frac_pos": round(float((x > 0).mean()), 3)},
              "ew_portfolio_block_boot": block_boot(port, rng)})


def main() -> None:
    global emit
    ap = argparse.ArgumentParser()
    ap.add_argument("--parity", action="store_true", help="parity checks only")
    ap.add_argument("--stress", action="store_true")
    ap.add_argument("--no-null", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--drift-diagnostic", action="store_true",
                    help="POST-HOC: de-drifted cross-ticker stats (not pre-registered)")
    args = ap.parse_args()
    if args.drift_diagnostic:
        drift_diagnostic()
        print("DONE reversion-replication drift-diagnostic", flush=True)
        return
    if args.parity:
        parity()
        print("DONE reversion-replication parity", flush=True)
        return
    emit({"validator": "reversion_replication", "universe": UNIVERSE,
          "n_universe": len(UNIVERSE), "cells": [hv.cell_name(s) for s in REV_CELLS],
          "source": "yfinance auto_adjust daily, start " + START,
          "cost_per_side_bps": round(hv.COST * 1e4, 2), "folds": hv.FOLD_LABELS,
          "shifted_folds": hv.SHIFTED_LABELS, "min_sessions": hv.MIN_SESSIONS,
          "null": f"random direction on the same fired days, {NULL_DRAWS} draws, seed 0",
          "stress": bool(args.stress)})
    # 1) downloads: serial + polite (cached; a fresh cache is never refetched)
    import time
    for t in UNIVERSE:
        fresh = (DAILY / f"{t}.csv").exists()
        try:
            load_yf(t)
        except Exception as e:                                 # noqa: BLE001
            emit({"ticker": t, "error": f"download failed: {e!r}"})
        if not fresh:
            time.sleep(1.0)
    # 2) per-ticker evaluation in a process pool; output re-emitted in universe order
    from multiprocessing import get_context
    jobs = [(i, t, args.stress, not args.no_null) for i, t in enumerate(UNIVERSE)]
    if args.workers > 1:
        with get_context("fork").Pool(args.workers) as pool:
            outs = pool.map(_worker, jobs, chunksize=1)
    else:
        outs = [_worker(j) for j in jobs]
    emit = hv.emit = _print_emit
    results = []
    for recs, r in outs:
        for rec in recs:
            emit(rec)
        if r:
            results.append(r)
    emit({"TESTED": len(results), "skipped": len(UNIVERSE) - len(results)})
    aggregate(results, np.random.default_rng(1))
    per = {r["ticker"]: {nm: c["verdict"] for nm, c in r["cells"].items() if c["gate"]["PASS"]}
           for r in results}
    emit({"SUMMARY": True, "per_ticker_passes": {k: v for k, v in per.items() if v}})
    print("DONE reversion-replication", flush=True)


if __name__ == "__main__":
    main()
