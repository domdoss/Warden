#!/usr/bin/env python3
"""Validate the NVDA 15m-momentum gate pass across 4 EARLIER 60-session folds.

The classics run found 1 gate pass in 32 cells (NVDA momentum, newest fold).
Before wiring it in, check whether that pass is stable in time or the one
lucky cell of a 32-way comparison: score the same rule on four earlier,
non-overlapping 60-session windows. AAPL and SPY (near-misses) ride along
for comparison. No NN training — CPU only, nothing persisted.
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, "/opt/Warden/trading/webapp")
import numpy as np  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402

h, sig = 30, 8.0
cfg = {**knobs.defaults(), "start_equity": 25000.0}

for t in ("NVDA", "AAPL", "SPY"):
    df = daytrade.fetch_history(t)
    feats = daytrade.features(df)
    y = daytrade.forward_return(df, h) * 1e4
    days = sorted(set(df.index.date))
    days_arr = np.array(df.index.date)
    r15 = feats["r15"].values
    n = len(df)
    for k in range(1, 5):                       # fold k: sessions [-60k:-60(k-1)]
        fold = days[-60 * k:-60 * (k - 1)] if k > 1 else days[-60:]
        prior = days_arr < fold[0]               # sigma from earlier days only
        sd = float(np.nanstd(r15[prior])) or 1e-9
        p = np.full(n, np.nan)
        up, dn = 1.5 * sd, -1.5 * sd
        p[r15 > up] = sig
        p[r15 < dn] = -sig
        m = np.isin(days_arr, fold) & ~np.isnan(p) & ~np.isnan(y) & (y != 0)
        if not m.any():
            print(json.dumps({"ticker": t, "fold_offset": -60 * k, "error": "no signal bars"}),
                  flush=True)
            continue
        trades = daytrade.simulate(df, p, fold, t, cfg)
        edge = daytrade.edge_metrics(trades, len(fold), h)
        edge["direction_hit_pct"] = round(float((np.sign(p[m]) == np.sign(y[m])).mean() * 100), 1)
        edge["has_edge"] = daytrade.edge_ok(edge, cfg)
        print(json.dumps({"ticker": t, "fold_sessions": f"{-60*k}..{-60*(k-1)}",
                          "signal_bars": int(m.sum()),
                          "direction_hit_pct": edge["direction_hit_pct"],
                          "trades": edge["trades"], "avg_net_bps": edge["avg_net_bps"],
                          "win_rate_pct": edge["win_rate_pct"],
                          "GATE_FIRES": edge["has_edge"]}), flush=True)
print("DONE momentum-validation", flush=True)