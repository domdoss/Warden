#!/usr/bin/env python3
"""Validate order-flow features (CKS OFI + trade-side imbalance) with the
same honest gate as momentum_validation.py — but per-day walk-forward.

Quote/trade history only spans the sessions alpaca_flow.py has backfilled,
so instead of the year-long 60-session folds the fold here is one session:
day d is scored only if its parameters (the feature's scale, sd) come from
earlier backfilled days, out-of-sample. This is a SHORTER-HISTORY
validation and every run says so in its first log line.

Features per 1-min bar (both intraday, aligned to the SIP bars the engine
trains on):
- ofi: Cont-Kukanov-Stoikov order-flow imbalance over the bar's NBBO
  updates — depth added when the bid ticks up/holds (size at the new bid)
  or the ask ticks down/holds, removed for the opposite moves; summed.
- tsi: trade-side imbalance — print volume signed by the tick rule
  (uptick/downtick, Lee-Ready style), summed over the bar as a share of
  the bar's traded volume (in [-1, 1]).

Gate per ticker x feature (the same shape as the other validations):
- direction >= 51% over all fired bars in EVERY fold (fold = one day),
- pooled net bps > 0 after the engine's per-side cost (spread/2 +
  slippage at entry and exit — daytrade.simulate applies it in fills),
- positive on >= 3/4 of the prior-only folds INCLUDING the oldest.
A full verdict needs >= MIN_FOLDS scored days; with fewer the verdict is
INSUFFICIENT_HISTORY and the early numbers stand as information only.

Rule-based, CPU only. Re-runnable: day rows already in the log are reused,
not recomputed. Output: JSON lines to logs/ofi_validation.log, one VERDICT
line per ticker x feature per run.

CLI:
    python ofi_validation.py            # score every backfilled day, verdicts
    python ofi_validation.py --stress   # pre-registered stress on GATE_FIRES cells
    python ofi_validation.py --stress AAPL:ofi NVDA:tsi   # ...on named cells

--stress writes to a SEPARATE log, logs/ofi_stress.log, so its parameter-
jittered rows can never pollute the base log's done-set. Pre-registered,
mechanical rules (survivor_stress.py's shape), stated up front:
- A. Shifted folds: the base gate re-scored on odd vs even sessions
  (chronological parity) — two disjoint session groupings.
- B. Parameter jitter: nsd 1.3/1.7 (z-threshold neighbors) and horizon
  25/35. There is NO smoothing window in this pipeline — OFI is the raw
  per-bar CKS sum and tsi the raw signed-volume share, so nsd and H are
  the only scale parameters to jitter.
- C. Calendar half-split: first vs second half of the scored history.
- A jitter/half cell holds when it has >= 20 trades AND pooled dir >= 51%
  AND pooled net > 0 (fewer trades = inconclusive: can neither confirm
  nor kill).
- REAL: A holds on both sides AND every jitter cell AND both halves hold.
  LUCK: A fails once judged. SUSPECT: everything else.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import alpaca_flow  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402

TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
H, SIG = 30, 8.0        # same horizon/signal convention as momentum_validation
NSD = 1.5              # prior-only sd multiple for the signal threshold
MIN_PRIOR = 3          # a day is scored only with >= 3 earlier backfilled days
MIN_FOLDS = 4          # full verdict needs at least 4 out-of-sample days
LOG = Path(__file__).resolve().parent.parent / "logs" / "ofi_validation.log"
STRESS_LOG = Path(__file__).resolve().parent.parent / "logs" / "ofi_stress.log"
MIN_NS = 60 * 10**9    # one bar, in epoch-ns
MIN_CELL_TRADES = 20   # survivor_stress rule: below this a jitter/half cell
                       # can neither confirm nor kill
JITTER_NSD = (1.3, 1.7)          # z-threshold neighbors of the surviving 1.5
JITTER_H = (25, 35)              # horizon neighbors of the surviving 30


def _emit(row: dict) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")


def _emit_stress(row: dict) -> None:
    STRESS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(STRESS_LOG, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")


def _window_sums(ts: np.ndarray, e: np.ndarray, starts: np.ndarray,
                 ends: np.ndarray) -> np.ndarray:
    """Sum of ``e`` (aligned to ``ts``) inside each [start, end) window."""
    lo = np.searchsorted(ts, starts, "left")
    hi = np.searchsorted(ts, ends, "left")
    cs = np.concatenate([[0.0], np.cumsum(e)])
    out = cs[hi] - cs[lo]
    out[hi == lo] = np.nan          # no updates in the window: feature absent
    return out


def day_features(ticker: str, day, bar_ns: np.ndarray,
                 open_px: float) -> dict[str, np.ndarray] | None:
    """OFI and trade imbalance for every bar of one session, or None when
    the session's quotes/trades are not backfilled."""
    qpath, tpath = alpaca_flow._path(ticker, "quotes", day), alpaca_flow._path(ticker, "trades", day)
    if not (qpath.exists() and tpath.exists()):
        return None
    out = {"ofi": np.full(len(bar_ns), np.nan), "tsi": np.full(len(bar_ns), np.nan)}
    ends = bar_ns + MIN_NS

    q = pd.read_parquet(qpath)
    if len(q) > 1:
        # CKS: depth added when the bid ticks up/holds or the ask ticks
        # down/holds; removed for the opposite ticks.
        bp, bs = q["bp"].to_numpy(), q["bs"].to_numpy()
        ap, aq = q["ap"].to_numpy(), q["as"].to_numpy()
        bid_e = np.where(bp[1:] > bp[:-1], bs[1:],
                         np.where(bp[1:] < bp[:-1], -bs[:-1], bs[1:] - bs[:-1]))
        ask_e = np.where(ap[1:] < ap[:-1], aq[1:],
                         np.where(ap[1:] > ap[:-1], -aq[:-1], -(aq[1:] - aq[:-1])))
        out["ofi"] = _window_sums(q["ts"].to_numpy()[1:], bid_e + ask_e, bar_ns, ends)

    t = pd.read_parquet(tpath)
    if len(t) > 0:
        # Tick rule: uptick buys, downtick sells; ties carry the last sign.
        p, s = t["p"].to_numpy(), t["s"].to_numpy()
        ts = t["ts"].to_numpy()
        if len(t) > 1:
            sign = np.sign(np.diff(p))
            sign = pd.Series(sign).replace(0, np.nan).ffill().fillna(1.0).to_numpy()
            signed = sign * s[1:]
        else:
            signed = np.array([])
        num = (_window_sums(ts[1:], signed, bar_ns, ends)
               if len(t) > 1 else np.full(len(bar_ns), np.nan))
        vol = (_window_sums(ts[1:], s[1:], bar_ns, ends)
               if len(t) > 1 else np.full(len(bar_ns), np.nan))
        # The first print's flow needs the prior tick, which the window sums
        # above start after — sign it against the session's opening bar.
        sign0 = float(np.sign(p[0] - open_px)) or 1.0
        i = np.searchsorted(bar_ns, ts[0], "right") - 1
        if 0 <= i < len(bar_ns) and ts[0] < bar_ns[i] + MIN_NS:
            num[i] = (0.0 if np.isnan(num[i]) else num[i]) + sign0 * s[0]
            vol[i] = (0.0 if np.isnan(vol[i]) else vol[i]) + s[0]
        with np.errstate(invalid="ignore", divide="ignore"):
            out["tsi"] = np.where(vol > 0, num / vol, np.nan)
    return out


def prior_sd(vals: list[np.ndarray]) -> float:
    pooled = np.concatenate(vals) if vals else np.array([])
    sd = float(np.nanstd(pooled)) if pooled.size else 0.0
    return sd if sd > 0 else 1e-9


def score_fold(y: np.ndarray, p: np.ndarray, m: np.ndarray) -> dict:
    """One day's out-of-sample direction over fired bars (net of the
    engine's per-side cost comes from daytrade.simulate's trades)."""
    fired = int(m.sum())
    return {"fired": fired,
            "hits": int((np.sign(p[m]) == np.sign(y[m])).sum()) if fired else 0,
            "direction_hit_pct": round(
                float((np.sign(p[m]) == np.sign(y[m])).mean() * 100), 1) if fired else None}


def done_rows() -> dict:
    """Day rows already in the log, keyed by (ticker, feature, day)."""
    out = {}
    if LOG.exists():
        for line in LOG.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if "day" in r and "feature" in r and "ticker" in r:
                out[(r["ticker"], r["feature"], r["day"])] = r
    return out


def ticker_ctx(t: str) -> dict:
    """Per-ticker frame + per-day flow features, computed once (they depend
    on neither the z-threshold nor the horizon, so stress reuses them)."""
    df = daytrade.fetch_history(t)
    idx_days = np.array(df.index.date)
    # Which sessions have flow data, in session order.
    days = sorted({d for d in idx_days if
                   alpaca_flow._path(t, "quotes", d).exists()
                   and alpaca_flow._path(t, "trades", d).exists()})
    # The bar index can sit at a coarser resolution than ns (pandas 3
    # pickles parse as us), so pin it to ns before aligning with the
    # parquet epoch-ns stamps.
    bar_ns_all = df.index.as_unit("ns").asi8
    per_day: dict = {}
    for d in days:
        sel = np.where(idx_days == d)[0]
        feats = day_features(t, d, bar_ns_all[sel], df["Open"].iloc[sel[0]])
        if feats is not None:
            per_day[d] = (sel, feats)
    return {"df": df, "idx_days": idx_days, "days": days, "per_day": per_day}


def score_days(ctx: dict, t: str, feat: str, nsd: float, h: int,
               cfg: dict) -> list[dict]:
    """Every out-of-sample day row for one ticker x feature at (nsd, h):
    day d is scored only with the feature scale (sd) from strictly earlier
    backfilled days."""
    df, idx_days = ctx["df"], ctx["idx_days"]
    y = daytrade.forward_return(df, h) * 1e4
    rows = []
    for d in ctx["days"]:                  # chronological: params from < d
        prior = [v[1][feat] for k, v in ctx["per_day"].items() if k < d]
        if len(prior) < MIN_PRIOR or d not in ctx["per_day"]:
            continue
        sel, feats = ctx["per_day"][d]
        sd = prior_sd(prior)
        p = np.full(len(df), np.nan)
        v = feats[feat]
        p[sel[v > nsd * sd]] = SIG
        p[sel[v < -nsd * sd]] = -SIG
        m = (idx_days == d) & ~np.isnan(p) & ~np.isnan(y) & (y != 0)
        trades = daytrade.simulate(df, p, [d], t, cfg)
        edge = daytrade.edge_metrics(trades, 1, h)
        row = score_fold(y, p, m)
        row.update({"ticker": t, "feature": feat, "day": d.isoformat(),
                    "sd": round(sd, 4), "trades": edge["trades"],
                    "avg_net_bps": edge["avg_net_bps"],
                    "total_net_bps": edge["total_net_bps"]})
        rows.append(row)
    return rows


def run() -> None:
    cfg = {**knobs.defaults(), "start_equity": 25000.0}
    done = done_rows()
    _emit({"meta": "per-day walk-forward over backfilled quote/trade history "
                   f"only — SHORTER-HISTORY validation (gate: direction>=51% "
                   "every day-fold, pooled net>0, >=3/4 day-folds positive "
                   "incl. oldest)"})
    for t in TICKERS:
        ctx = ticker_ctx(t)
        if len(ctx["days"]) < MIN_PRIOR + 1:
            _emit({"ticker": t, "error": "fewer than MIN_PRIOR+1 backfilled sessions",
                   "backfilled": len(ctx["days"])})
            continue
        for feat in ("ofi", "tsi"):
            for row in score_days(ctx, t, feat, NSD, H, cfg):
                key = (row["ticker"], row["feature"], row["day"])
                if key in done:
                    continue                # re-run: already scored that day
                _emit(row)
            _emit(verdict(t, feat))


def verdict(t: str, feat: str) -> dict:
    """The honest gate over this run's + prior runs' day rows."""
    rows = [r for r in done_rows().values() if r["ticker"] == t and r["feature"] == feat]
    rows.sort(key=lambda r: r["day"])
    fired = [r for r in rows if r.get("fired")]
    if not fired:
        return {"ticker": t, "feature": feat, "folds": len(rows),
                "VERDICT": "INSUFFICIENT_HISTORY", "why": "no day-fold fired"}
    fired_all = sum(r["fired"] for r in fired)
    hits_all = sum(r["hits"] for r in fired)
    trades_all = sum(r["trades"] for r in fired)
    net_all = sum(r["total_net_bps"] for r in fired)
    pooled_dir = round(hits_all / fired_all * 100, 1)
    pooled_net = round(net_all / trades_all, 2) if trades_all else 0.0
    every51 = all(r["direction_hit_pct"] >= 51.0 for r in fired)
    positives = sum(1 for r in fired if r["avg_net_bps"] > 0)
    oldest_pos = fired[0]["avg_net_bps"] > 0
    need_pos = max(1, int(-(-3 * len(fired) // 4)))       # ceil(3/4 n)
    full = len(fired) >= MIN_FOLDS
    ok = full and every51 and pooled_net > 0 and positives >= need_pos and oldest_pos
    return {"ticker": t, "feature": feat, "folds": len(rows),
            "folds_fired": len(fired), "fired_bars": fired_all,
            "pooled_direction_pct": pooled_dir, "pooled_avg_net_bps": pooled_net,
            "positive_folds": f"{positives}/{len(fired)}",
            "oldest_fold_positive": oldest_pos, "every_fold_51pct": every51,
            "VERDICT": "GATE_FIRES" if ok else
                       ("INSUFFICIENT_HISTORY" if not full else "FAIL")}


def stress_gate(rows: list[dict]) -> dict:
    """The base gate re-scored over an arbitrary subset of day rows (a
    shifted window): pooled direction >= 51%, pooled net > 0 after costs,
    >= 3/4 of day-folds positive including the oldest, and enough fired
    days (>= MIN_FOLDS) to judge at all."""
    fired = [r for r in rows if r.get("fired")]
    g = {"fired_days": len(fired), "judged": len(fired) >= MIN_FOLDS}
    if not fired:
        g["PASS"] = False
        return g
    bars = sum(r["fired"] for r in fired)
    hits = sum(r["hits"] for r in fired)
    trades = sum(r["trades"] for r in fired)
    net = sum(r["total_net_bps"] for r in fired)
    positives = sum(1 for r in fired if r["avg_net_bps"] > 0)
    need_pos = max(1, -(-3 * len(fired) // 4))           # ceil(3/4 n)
    g.update({"fired_bars": bars, "trades": trades,
              "dir_pct": round(100.0 * hits / bars, 1) if bars else None,
              "avg_net_bps": round(net / trades, 2) if trades else None,
              "positive_days": f"{positives}/{len(fired)}",
              "oldest_positive": fired[0]["avg_net_bps"] > 0})
    g["PASS"] = bool(g["judged"] and g["dir_pct"] is not None and g["dir_pct"] >= 51.0
                    and g["avg_net_bps"] is not None and g["avg_net_bps"] > 0
                    and positives >= need_pos and g["oldest_positive"])
    return g


def cell_ok(rows: list[dict]) -> tuple[bool, dict]:
    """survivor_stress's mechanical cell rule: >= MIN_CELL_TRADES trades AND
    pooled dir >= 51% AND pooled net > 0. Fewer trades = inconclusive
    (can neither confirm nor kill)."""
    fired = [r for r in rows if r.get("fired")]
    bars = sum(r["fired"] for r in fired)
    hits = sum(r["hits"] for r in fired)
    trades = sum(r["trades"] for r in fired)
    net = sum(r["total_net_bps"] for r in fired)
    g = {"fired_days": len(fired), "fired_bars": bars, "trades": trades,
         "dir_pct": round(100.0 * hits / bars, 1) if bars else None,
         "avg_net_bps": round(net / trades, 2) if trades else None}
    if trades < MIN_CELL_TRADES or not bars:
        g["inconclusive"] = True
        return False, g
    return bool(g["dir_pct"] >= 51.0 and g["avg_net_bps"] > 0), g


def passing_cells() -> list[tuple[str, str]]:
    """(ticker, feature) cells whose LATEST base verdict is GATE_FIRES and
    with no FINAL stress row at the same fired-fold count — a cell that
    keeps passing as history grows gets re-stressed, one that already
    passed at this size does not."""
    latest: dict = {}
    if LOG.exists():
        for line in LOG.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if "VERDICT" in r and "ticker" in r and "feature" in r:
                latest[(r["ticker"], r["feature"])] = r
    done: set = set()
    if STRESS_LOG.exists():
        for line in STRESS_LOG.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("FINAL"):
                done.add((r["ticker"], r["feature"], r.get("folds_fired")))
    return [(t, f) for (t, f), r in sorted(latest.items())
            if r["VERDICT"] == "GATE_FIRES"
            and (t, f, r.get("folds_fired")) not in done]


def _fmt(g: dict) -> str:
    if g.get("inconclusive") or not g.get("fired_days"):
        return f"inconclusive (trades={g.get('trades', 0)})"
    return (f"dir {g.get('dir_pct')}%, net {g.get('avg_net_bps')} bps, "
            f"{g.get('positive_days', '?')} days positive, n={g['trades']}")


def stress(cells: list[tuple[str, str]] | None) -> None:
    """Pre-registered stress on passing cells (named cells stress
    regardless of their base verdict — explicit is explicit)."""
    cfg = {**knobs.defaults(), "start_equity": 25000.0}
    if cells is None:
        cells = passing_cells()
    _emit_stress({"stress": "ofi pre-registered stress",
                  "tests": "A odd/even shifted folds; B jitter nsd 1.3/1.7 + "
                           "horizon 25/35 (no smoothing window exists — OFI/tsi "
                           "are raw per-bar sums, nsd+H are the only scale "
                           "params); C calendar half-split",
                  "min_cell_trades_for_judgment": MIN_CELL_TRADES,
                  "verdict_rule": "REAL=A both sides + all jitter + both halves "
                                  "hold; LUCK=A fails once judged; SUSPECT=else",
                  "cells": [f"{t}:{f}" for t, f in cells]})
    if not cells:
        _emit_stress({"note": "no GATE_FIRES cells to stress"})
    for t, feat in cells:
        ctx = ticker_ctx(t)
        base = score_days(ctx, t, feat, NSD, H, cfg)
        fired = [r for r in base if r.get("fired")]
        if not fired:
            _emit_stress({"ticker": t, "feature": feat,
                          "error": "no fired day-folds at base params"})
            continue
        # A: shifted fold windows — odd vs even sessions, chronological.
        g_odd, g_even = stress_gate(fired[0::2]), stress_gate(fired[1::2])
        _emit_stress({"ticker": t, "feature": feat, "test": "A_shifted_odd",
                      "gate": g_odd})
        _emit_stress({"ticker": t, "feature": feat, "test": "A_shifted_even",
                      "gate": g_even})
        # B: parameter jitter (features reused from ctx; horizon variants
        # re-derive y and re-simulate exits).
        jitter = {}
        for nsd in JITTER_NSD:
            ok, g = cell_ok(score_days(ctx, t, feat, nsd, H, cfg))
            jitter[f"nsd={nsd}"] = (ok, g)
            _emit_stress({"ticker": t, "feature": feat, "test": "B_jitter",
                          "params": f"nsd={nsd}", "holds": ok, **g})
        for h in JITTER_H:
            ok, g = cell_ok(score_days(ctx, t, feat, NSD, h, cfg))
            jitter[f"h={h}"] = (ok, g)
            _emit_stress({"ticker": t, "feature": feat, "test": "B_jitter",
                          "params": f"h={h}", "holds": ok, **g})
        # C: calendar half-split of the scored history.
        days_sorted = sorted(r["day"] for r in fired)
        mid = days_sorted[len(days_sorted) // 2]
        halves = {}
        for name, keep in (("first_half", lambda d: d < mid),
                           ("second_half", lambda d: d >= mid)):
            ok, g = cell_ok([r for r in fired if keep(r["day"])])
            halves[name] = (ok, g)
            _emit_stress({"ticker": t, "feature": feat, "test": "C_half_split",
                          "half": name, "holds": ok, **g})
        a_pass = g_odd["PASS"] and g_even["PASS"]
        a_fail = ((g_odd["judged"] and not g_odd["PASS"])
                  or (g_even["judged"] and not g_even["PASS"]))
        b_ok = all(ok for ok, _ in jitter.values())
        c_ok = all(ok for ok, _ in halves.values())
        verdict_v = ("LUCK" if a_fail else
                     "REAL" if (a_pass and b_ok and c_ok) else "SUSPECT")
        _emit_stress({"FINAL": True, "ticker": t, "feature": feat,
                      "folds_fired": len(fired), "verdict": verdict_v,
                      "evidence": (f"shifted odd: {_fmt(g_odd)}; "
                                   f"even: {_fmt(g_even)}; halves: "
                                   f"first {_fmt(halves['first_half'][1])}, "
                                   f"second {_fmt(halves['second_half'][1])}; "
                                   "jitter " + ", ".join(
                                       f"{nm}: {_fmt(g)}" for nm, (_, g)
                                       in jitter.items()))})
    print("DONE ofi-stress", flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--stress":
        cells = None
        if len(sys.argv) > 2:
            cells = [(a.upper(), b.lower())
                     for a, b in (s.split(":") for s in sys.argv[2:])]
        stress(cells)
    else:
        run()
        print("DONE ofi-validation", flush=True)