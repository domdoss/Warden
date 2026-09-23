#!/usr/bin/env python3
"""Validate volume-imbalance / order-flow proxy signals on the engine's bars.

Published motivation (Sirignano-Cont "Universal features", Kolm's order-flow
imbalance work): price-only features carry almost no direction; signed volume
is the directional driver. Without tick data we test the standard bar-level
proxies on the same stored 1-min Alpaca bars the engine trains on:

  buy_frac = (close - low) / (high - low)     share of a bar's volume bought
  delta    = volume * (2*buy_frac - 1)        signed volume per bar

Signals (rule-based, CPU only — no NN training, nothing persisted; the pooled
walk-forward run owns the GPU):

  imb5/15/30   rolling W-bar imbalance sum(delta)/sum(volume), traded when its
               prior-only z-score passes ±1.5, direction = sign of z
  imbco15      the same at W=15 with the coarser close-vs-open classification,
               to check the range-position proxy is not doing all the work
  shock15/30   imbalance SHOCK: W-bar imbalance minus its own rolling 60-bar
               mean, traded when that deviation's prior-only z passes ±2
  cdelta60     cumulative-delta trend: the 60-bar change of the session's
               cumulative signed volume over the 60-bar volume sum — the same
               series as a 60-bar imbalance, kept under its own label because
               the cumulative-delta framing is the published signal
  decay15      EWMA of delta (halflife 15 bars) over EWMA of volume, prior-only
               z ±1.5 — the decay variant of the cumulative-delta trend

Honest pattern (copied from momentum_validation.py): four non-overlapping
25-session folds over the last 100 sessions (-100..-75 ... -25..0); every
threshold normalisation (mean/std of the base series) is computed ONLY from
days before the fold. Each fold is scored through the engine's real
simulate() — the live exits and the same cost model the gate uses
(2 bps spread + 1 bps/side slippage). GATE_FIRES is the engine's edge_ok;
with 25-session folds it is usually False on the 50-trade floor alone, so
the verdict uses the cross-fold criteria instead:

PASS = direction >= 51% on ALL scored bars in EVERY fold (momentum died on
exactly this — 54% on the newest fold, 47% on an older one), net bps > 0
after costs in >= 3 of 4 folds AND overall.
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, "/opt/Warden/trading/webapp")
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402

TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
h, sig = 30, 8.0                    # same ±8 bps signal convention as classics
fold_len, n_folds = 25, 4           # last 100 sessions, non-overlapping
Z_THR, SHOCK_THR = 1.5, 2.0
SIGNALS = [("imb5", Z_THR), ("imb15", Z_THR), ("imb30", Z_THR), ("imbco15", Z_THR),
           ("shock15", SHOCK_THR), ("shock30", SHOCK_THR), ("cdelta60", Z_THR),
           ("decay15", Z_THR)]
cfg = {**knobs.defaults(), "start_equity": 25000.0}


def day_rolling_sum(x: np.ndarray, days_arr: np.ndarray, w: int) -> np.ndarray:
    """Sum of the last w bars within the same session — NaN where the session
    has seen fewer than w bars or any window value is NaN, so nothing ever
    mixes yesterday into today."""
    n = len(x)
    out = np.full(n, np.nan)
    if n < w:
        return out
    cs = np.concatenate([[0.0], np.cumsum(np.nan_to_num(x))])
    cn = np.concatenate([[0], np.cumsum(~np.isnan(x))])
    new_day = np.r_[True, days_arr[1:] != days_arr[:-1]]
    day_start = np.flatnonzero(new_day)[np.cumsum(new_day) - 1]
    idx = np.arange(n)
    ok = (idx - w + 1 >= day_start) & (cn[idx + 1] - cn[idx - w + 1] == w)
    out[ok] = cs[idx[ok] + 1] - cs[idx[ok] - w + 1]
    return out


def signal_series(df: pd.DataFrame) -> dict[str, np.ndarray]:
    """Causal per-bar base series for every signal (no fold data used)."""
    days_arr = np.array(df.index.date)
    o, hi, lo, c, v = (df[k].values for k in ("Open", "High", "Low", "Close", "Volume"))
    rng = hi - lo
    buy_frac = np.where(rng > 0, (c - lo) / np.where(rng > 0, rng, 1.0), 0.5)
    delta = v * (2 * buy_frac - 1)
    delta_co = v * np.sign(c - o)
    s: dict[str, np.ndarray] = {}
    for w in (5, 15, 30, 60):
        num = day_rolling_sum(delta, days_arr, w)
        den = day_rolling_sum(v, days_arr, w)
        s["cdelta60" if w == 60 else f"imb{w}"] = np.where(den > 0, num / den, np.nan)
    den15 = day_rolling_sum(v, days_arr, 15)
    s["imbco15"] = np.where(den15 > 0, day_rolling_sum(delta_co, days_arr, 15) / den15, np.nan)
    for w in (15, 30):
        mean60 = day_rolling_sum(s[f"imb{w}"], days_arr, 60) / 60.0
        s[f"shock{w}"] = s[f"imb{w}"] - mean60
    ewd = pd.Series(delta, index=df.index).ewm(halflife=15, adjust=False).mean()
    ewv = pd.Series(v, index=df.index).ewm(halflife=15, adjust=False).mean()
    s["decay15"] = (ewd / ewv).values
    return s


def folds_of(days: list) -> list[tuple[list, str]]:
    """The last n_folds * fold_len sessions in n_folds non-overlapping folds."""
    out = []
    for k in range(n_folds):
        a = -fold_len * (n_folds - k)
        b = -fold_len * (n_folds - k - 1)
        out.append((days[a:b] if b else days[a:], f"{a}..{b or 0}"))
    return out


def main() -> None:
    min_dir = float(cfg["min_direction_pct"])
    summary: dict[str, bool] = {}
    for t in TICKERS:
        df = daytrade.fetch_history(t)
        days = sorted(set(df.index.date))
        if df.empty or len(days) < fold_len * n_folds + 25:
            print(json.dumps({"ticker": t, "error": "insufficient history",
                              "sessions": len(days)}), flush=True)
            continue
        print(f"loaded {t}: {len(days)} sessions, {len(df)} bars", flush=True)
        y = daytrade.forward_return(df, h) * 1e4
        days_arr = np.array(df.index.date)
        series = signal_series(df)
        n = len(df)
        acc = {name: {"fold_rows": [], "trades": [],
                      "dir_hits": 0, "dir_bars": 0} for name, _ in SIGNALS}
        for fold, label in folds_of(days):
            prior = days_arr < fold[0]
            in_fold = np.isin(days_arr, fold)
            for name, thr in SIGNALS:
                x = series[name]
                mu = float(np.nanmean(x[prior]))
                sd = float(np.nanstd(x[prior])) or 1e-9
                z = (x - mu) / sd
                p = np.full(n, np.nan)
                fire = np.isfinite(z) & (np.abs(z) >= thr)
                p[fire] = np.sign(z[fire]) * sig
                m = in_fold & ~np.isnan(p) & ~np.isnan(y) & (y != 0)
                row = {"ticker": t, "signal": name, "fold": label,
                       "signal_bars": int(m.sum())}
                if not m.any():
                    row["error"] = "no signal bars"
                else:
                    dir_hit = float((np.sign(p[m]) == np.sign(y[m])).mean() * 100)
                    trades = daytrade.simulate(df, p, fold, t, cfg)
                    edge = daytrade.edge_metrics(trades, len(fold), h)
                    edge["direction_hit_pct"] = round(dir_hit, 1)
                    row.update({"direction_hit_pct": edge["direction_hit_pct"],
                                "trades": edge["trades"], "avg_net_bps": edge["avg_net_bps"],
                                "win_rate_pct": edge["win_rate_pct"],
                                "GATE_FIRES": daytrade.edge_ok(edge, cfg)})
                    acc[name]["trades"] += trades
                    acc[name]["dir_hits"] += int((np.sign(p[m]) == np.sign(y[m])).sum())
                    acc[name]["dir_bars"] += int(m.sum())
                acc[name]["fold_rows"].append(row)
                print(json.dumps(row), flush=True)
        verdict = []
        for name, _ in SIGNALS:
            a = acc[name]
            rows = a["fold_rows"]
            dirs = [r.get("direction_hit_pct") for r in rows]
            nets = [r.get("avg_net_bps", 0.0) for r in rows]
            ov_dir = round(a["dir_hits"] / a["dir_bars"] * 100, 1) if a["dir_bars"] else None
            ov_edge = daytrade.edge_metrics(a["trades"], fold_len * n_folds, h)
            ov_edge["direction_hit_pct"] = ov_dir
            ov_net = ov_edge["avg_net_bps"]
            print(json.dumps({"ticker": t, "signal": name, "fold": "overall",
                              "direction_hit_pct": ov_dir,
                              "trades": ov_edge["trades"], "avg_net_bps": ov_net,
                              "win_rate_pct": ov_edge["win_rate_pct"],
                              "GATE_FIRES": daytrade.edge_ok(ov_edge, cfg)}), flush=True)
            dir_ok = (len(dirs) == n_folds
                      and all(d is not None and d >= min_dir for d in dirs))
            net_pos = sum(1 for nb in nets if (nb or 0.0) > 0)
            passed = dir_ok and net_pos >= 3 and (ov_net or 0.0) > 0
            summary[f"{t}:{name}"] = passed
            verdict.append(
                f"{name}={'PASS' if passed else 'FAIL'}"
                f"(dir {sum(d is not None and d >= min_dir for d in dirs)}/{n_folds},"
                f"net+ {net_pos}/{n_folds},ov {ov_net:+.2f}bps)")
        print(f"VERDICT {t}: " + " ".join(verdict), flush=True)
    passes = sorted(k for k, v in summary.items() if v)
    print(f"VERDICT SUMMARY: {len(passes)}/{len(summary)} signal-ticker cells passed"
          + (f"; passing: {', '.join(passes)}" if passes else ""), flush=True)
    print("DONE volume-imbalance-validation", flush=True)


if __name__ == "__main__":
    main()