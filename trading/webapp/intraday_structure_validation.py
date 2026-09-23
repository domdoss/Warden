#!/usr/bin/env python3
"""Validate rule-based intraday TIME/STRUCTURE + LEVEL/STRUCTURE signals.

The liquid CfC net was honestly validated to have no edge; this hunts for any
RULE-BASED intraday signal that survives the same strict gate. Families (no
torch, CPU only, 1-minute Alpaca bars, the 10 engine tickers):

1. ORB: break of the first 5/15/30-min session range, stop at the far side of
   the range, exit at the session close. First break only, one trade a day.
2. Overnight gap: gap (first open vs prior close) measured in units of the
   prior day's range; beyond a threshold, trade continuation or fade, hold to
   the close.
3. VWAP deviation reversion: running session VWAP, running std of the
   deviation; fade moves beyond +-k std bands (k = 2, 2.5, 3), exit on a VWAP
   touch or the close.
4. Prior-day structure: ORB-15 conditioned on NR7 / WR7 (the prior day's range
   narrowest / widest of the last 7) — does day-type predict breakout success?
   Tested per ticker and pooled across all 10 (the flag fires ~1 day in 7).
5. Time-of-day seasonality: mean signed return per time bucket (descriptive
   profile), plus a walk-forward test trading the best bucket, where BOTH the
   bucket and its side are chosen only from sessions strictly before the fold.

Honest method (momentum_validation.py pattern):
- 4 non-overlapping 25-session folds (offsets -100..-75, -75..-50, -50..-25,
  -25..0) of the last 100 completed sessions. Every threshold is a fixed a
  priori grid cell scored on all folds independently (no selection); the one
  selected parameter (the time-of-day bucket) is chosen strictly from data
  before its fold.
- Direction hit is the sign of the trade's gross (pre-cost) result, measured
  over EVERY fired bar, in every fold. Net bps charges the engine's actual
  per-side cost (spread/2 + slippage) on both fills.
- PASS = direction >= 51% over all fired bars AND avg net bps > 0 AND positive
  in >= 3 of 4 folds AND positive on the oldest fold AND >= 30 trades.
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402

TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
FOLD_OFFSETS = [(-100, -75), (-75, -50), (-50, -25), (-25, 0)]
FOLD_LABELS = [f"{a}..{b}" for a, b in FOLD_OFFSETS]
BUCKETS = [("first15", 0, 15), ("0930-1030", 0, 60), ("1030-1200", 60, 150),
           ("1200-1330", 150, 240), ("1330-1500", 240, 330), ("1500-1600", 330, 390)]
ORB_RANGES = (5, 15, 30)
GAP_KS = (0.25, 0.5)
GAP_MODES = ("cont", "fade")
VWAP_KS = (2.0, 2.5, 3.0)
VWAP_WARM = 15          # bars of session needed before a std band is meaningful
MIN_TRADES = 30         # gate floor: fewer fired bars can't prove anything

CFG = knobs.defaults()
COST = daytrade.cost_per_fill(CFG)   # per-side fraction of price (spread/2 + slippage)


def fill(side: str, entry: float, exit_px: float) -> tuple[float, float]:
    """(net bps, gross bps) of one round trip, per-side cost on both fills."""
    s = 1.0 if side == "long" else -1.0
    fin = entry * (1 + COST) if s > 0 else entry * (1 - COST)
    fout = exit_px * (1 - COST) if s > 0 else exit_px * (1 + COST)
    return s * (fout / fin - 1) * 1e4, s * (exit_px / entry - 1) * 1e4


def gate(trades: list, day_fold: dict) -> dict:
    """Score one signal cell: per-fold breakdown + the honest PASS verdict."""
    folds: dict[str, list] = {lab: [] for lab in FOLD_LABELS}
    for d, side, net, gross in trades:
        lab = day_fold.get(d)
        if lab:
            folds[lab].append((net, gross))
    rows, pos, hits, tot, net_sum = [], 0, 0, 0, 0.0
    for lab in FOLD_LABELS:
        f = folds[lab]
        n = len(f)
        fh = sum(1 for _, g in f if g > 0)
        fnet = sum(net for net, _ in f)
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
    ok = (tot >= MIN_TRADES and 100 * hits / tot >= 51.0 and avg > 0
          and pos >= 3 and rows[0]["net_bps"] > 0)
    return {"folds": rows, "trades": tot, "dir_pct": round(100 * hits / tot, 1),
            "avg_net_bps": round(avg, 2), "total_net_bps": round(net_sum, 1),
            "PASS": bool(ok)}


def load(t: str) -> dict:
    """Per-session OHLCV arrays for one ticker, completed sessions only."""
    df = daytrade.fetch_history(t)
    df = df[np.array(df.index.date) <= daytrade.last_session()]
    sess = {}
    for d, g in df.groupby(np.array(df.index.date)):
        if len(g) < 30:            # torn session
            continue
        sess[d] = {k: g[k].to_numpy() for k in ("Open", "High", "Low", "Close", "Volume")}
    return sess


def orb_trades(d, s: dict, n_rng: int) -> list:
    """First break of the first n_rng bars' range; stop at the far side,
    exit at the stop or the session close."""
    h, l, c = s["High"], s["Low"], s["Close"]
    n = len(c)
    if n < n_rng + 2:
        return []
    hi, lo = float(h[:n_rng].max()), float(l[:n_rng].min())
    for i in range(n_rng, n - 1):              # need a bar after the entry
        if c[i] > hi:
            side, stop = "long", lo
            break
        if c[i] < lo:
            side, stop = "short", hi
            break
    else:
        return []
    entry, j = float(c[i]), i + 1
    beyond = np.flatnonzero(l[j:] <= stop) if side == "long" else np.flatnonzero(h[j:] >= stop)
    exit_px = stop if len(beyond) else float(c[-1])
    net, gross = fill(side, entry, exit_px)
    return [(d, side, net, gross)]


def gap_trades(d, s: dict, prev: dict, k: float, mode: str) -> list:
    """Gap beyond k prior-day-ranges at the open; continuation or fade, hold
    to the close (entry at the first bar's close)."""
    prev_close, prev_rng = float(prev["Close"][-1]), float(prev["High"].max() - prev["Low"].min())
    if prev_rng <= 0:
        return []
    gu = (float(s["Open"][0]) - prev_close) / prev_rng
    if abs(gu) <= k:
        return []
    up = gu > 0
    side = ("long" if up else "short") if mode == "cont" else ("short" if up else "long")
    net, gross = fill(side, float(s["Close"][0]), float(s["Close"][-1]))
    return [(d, side, net, gross)]


def vwap_state(s: dict) -> tuple[np.ndarray, np.ndarray]:
    """(deviation from running session VWAP, z-score of that deviation)."""
    h, l, c, v = s["High"], s["Low"], s["Close"], s["Volume"]
    tp = (h + l + c) / 3.0
    vwap = np.cumsum(tp * v) / np.maximum(np.cumsum(v), 1e-9)
    dev = c / vwap - 1.0
    n = np.arange(1, len(c) + 1)
    mean = np.cumsum(dev) / n
    var = np.cumsum(dev ** 2) / n - mean ** 2
    sd = np.sqrt(np.clip(var, 0.0, None))
    z = np.divide(dev, sd, out=np.zeros_like(dev), where=sd > 0)
    return dev, z


def vwap_trades(d, dev: np.ndarray, z: np.ndarray, c: np.ndarray, k: float) -> list:
    """Fade a move beyond the +-k std band; exit on the VWAP touch or close."""
    trades = []
    side = entry = None
    for i in range(VWAP_WARM, len(c)):
        if side is None:
            if i >= len(c) - 1:
                break
            if z[i] >= k:
                side, entry = "short", float(c[i])
            elif z[i] <= -k:
                side, entry = "long", float(c[i])
        elif (side == "long" and dev[i] >= 0) or (side == "short" and dev[i] <= 0):
            net, gross = fill(side, entry, float(c[i]))
            trades.append((d, side, net, gross))
            side = entry = None
    if side is not None:
        net, gross = fill(side, entry, float(c[-1]))
        trades.append((d, side, net, gross))
    return trades


def bucket_rets(c: np.ndarray) -> dict:
    """Per-bucket log return of one session: close of the bucket's last bar
    over the close of the bar at the bucket's start."""
    lc = np.log(c)
    return {name: float(lc[b - 1] - lc[a]) for name, a, b in BUCKETS if len(c) >= b}


def bucket_trade(d, s: dict, name: str, side: str) -> tuple:
    a, b = next((a, b) for nm, a, b in BUCKETS if nm == name)
    net, gross = fill(side, float(s["Close"][a]), float(s["Close"][b - 1]))
    return (d, side, net, gross)


def main() -> None:
    print(json.dumps({"cost_per_side_bps": round(COST * 1e4, 2),
                      "round_trip_bps": daytrade.round_trip_bps(CFG),
                      "min_trades": MIN_TRADES,
                      "folds": FOLD_LABELS}), flush=True)
    pooled: dict[str, list] = {"ORB15": [], "ORB15_NR7": [], "ORB15_WR7": [], "TOD": []}
    all_day_fold: dict = {}
    passed = []
    for t in TICKERS:
        sess = load(t)
        days = sorted(sess)
        if len(days) < 107:
            print(json.dumps({"ticker": t, "error": f"only {len(days)} sessions"}), flush=True)
            continue
        day_fold = {}
        for (a, b), lab in zip(FOLD_OFFSETS, FOLD_LABELS):
            fold_days = days[a:] if b == 0 else days[a:b]
            day_fold.update({d: lab for d in fold_days})
        all_day_fold.update(day_fold)

        # -- prior-day structure flags: NR7/WR7 from strictly prior sessions --
        rng = {d: float(sess[d]["High"].max() - sess[d]["Low"].min()) for d in days}
        nr7, wr7 = set(), set()
        for j in range(7, len(days)):
            win = [rng[days[j - i]] for i in range(1, 8)]   # the 7 days before today
            if rng[days[j - 1]] <= min(win):
                nr7.add(days[j])
            if rng[days[j - 1]] >= max(win):
                wr7.add(days[j])

        orb = {n: [] for n in ORB_RANGES}
        gap = {(m, k): [] for m in GAP_MODES for k in GAP_KS}
        vwap = {k: [] for k in VWAP_KS}
        tod_rets = {d: bucket_rets(sess[d]["Close"]) for d in days}
        tod_wf = []
        tod_chosen = {}
        for j, d in enumerate(days):
            s = sess[d]
            for n in ORB_RANGES:
                orb[n] += orb_trades(d, s, n)
            if j:
                for m in GAP_MODES:
                    for k in GAP_KS:
                        gap[(m, k)] += gap_trades(d, s, sess[days[j - 1]], k, m)
            if len(s["Close"]) >= VWAP_WARM + 2:
                dev, z = vwap_state(s)
                for k in VWAP_KS:
                    vwap[k] += vwap_trades(d, dev, z, s["Close"], k)

        # -- time-of-day walk-forward: bucket AND side chosen strictly before --
        for lab in FOLD_LABELS:
            a, b = FOLD_OFFSETS[FOLD_LABELS.index(lab)]
            fold_days = days[a:] if b == 0 else days[a:b]
            prior = [d for d in days if d < fold_days[0]]
            means = {nm: float(np.mean([tod_rets[d][nm] for d in prior if nm in tod_rets[d]]))
                     for nm, _, _ in BUCKETS}
            best = max(means, key=lambda nm: abs(means[nm]))
            side = "long" if means[best] > 0 else "short"
            tod_chosen[lab] = {"bucket": best, "side": side,
                               "prior_mean_bps": round(means[best] * 1e4, 1)}
            for d in fold_days:
                if best in tod_rets[d]:
                    tod_wf.append(bucket_trade(d, sess[d], best, side))

        # -- log the per-ticker cells ----------------------------------------
        for n in ORB_RANGES:
            r = {"ticker": t, "signal": "ORB", "params": {"range_min": n},
                 **gate(orb[n], day_fold)}
            print(json.dumps(r), flush=True)
            if r["PASS"]:
                passed.append(f"{t} ORB{n}")
        for m in GAP_MODES:
            for k in GAP_KS:
                r = {"ticker": t, "signal": f"gap-{m}", "params": {"k_prior_range": k},
                     **gate(gap[(m, k)], day_fold)}
                print(json.dumps(r), flush=True)
                if r["PASS"]:
                    passed.append(f"{t} gap-{m} k={k}")
        for k in VWAP_KS:
            r = {"ticker": t, "signal": "VWAP-reversion", "params": {"k_std": k},
                 **gate(vwap[k], day_fold)}
            print(json.dumps(r), flush=True)
            if r["PASS"]:
                passed.append(f"{t} VWAP k={k}")
        for cond, flag in (("NR7", nr7), ("WR7", wr7)):
            tr = [x for x in orb[15] if x[0] in flag]
            r = {"ticker": t, "signal": "ORB15-conditioned", "params": {"day_type": cond},
                 **gate(tr, day_fold)}
            print(json.dumps(r), flush=True)
            pooled[f"ORB15_{cond}"] += tr
        prof = {nm: round(float(np.mean([tod_rets[d][nm] for d in days if nm in tod_rets[d]])) * 1e4, 1)
                for nm, _, _ in BUCKETS}
        print(json.dumps({"ticker": t, "signal": "TOD-profile",
                          "bucket_mean_bps": prof,
                          "note": "descriptive full-sample, not a gate"}), flush=True)
        r = {"ticker": t, "signal": "TOD-walkforward", "params": {"chosen": tod_chosen},
             **gate(tod_wf, day_fold)}
        print(json.dumps(r), flush=True)
        if r["PASS"]:
            passed.append(f"{t} TOD-walkforward")
        pooled["ORB15"] += orb[15]
        pooled["TOD"] += tod_wf

    # -- pooled cells: the conditioning flags and the bucket pick fire too
    #    rarely per ticker for a per-ticker gate, so also gate them pooled.
    #    Folds are session-based, so all tickers share the day->fold labels. --
    pooled["ORB15_NR7"] = [x for x in pooled["ORB15_NR7"] if x[0] in all_day_fold]
    pooled["ORB15_WR7"] = [x for x in pooled["ORB15_WR7"] if x[0] in all_day_fold]
    for name, label in (("ORB15", "ORB15-baseline"), ("ORB15_NR7", "ORB15-conditioned NR7"),
                        ("ORB15_WR7", "ORB15-conditioned WR7"), ("TOD", "TOD-walkforward")):
        r = {"ticker": "ALL", "signal": label, **gate(pooled[name], all_day_fold)}
        print(json.dumps(r), flush=True)
        if r["PASS"]:
            passed.append(f"pooled {label}")

    if passed:
        print(f"VERDICT intraday-structure: {len(passed)} cell(s) passed the honest gate "
              f"(dir>=51% all fired bars, net>0 after {round(COST * 1e4, 1)} bps/side, "
              f">=3/4 folds, oldest fold, >={MIN_TRADES} trades): {'; '.join(passed)}", flush=True)
    else:
        print("VERDICT intraday-structure: NO cell passed the honest gate (dir>=51% all "
              "fired bars, net>0 after per-side costs, >=3/4 folds, oldest fold, "
              f">={MIN_TRADES} trades) — no rule-based time/level structure edge found.", flush=True)
    print("DONE intraday-structure-validation", flush=True)


if __name__ == "__main__":
    main()