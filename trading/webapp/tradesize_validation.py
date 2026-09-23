#!/usr/bin/env python3
"""Trade-size structure ("Next ideas" 4): does SIGNED LARGE-PRINT flow over
the last N minutes predict the next 30-min return? Same honest gate and
per-day walk-forward as ofi_validation.py (whose loading/gate/stress code
this reuses), on the flow files alpaca_flow.py has ALREADY written — this
script makes no API calls.

PRE-REGISTERED DEFINITIONS (fixed before any result was seen):
- Data: trades = the IEX print feed ({T}_iex_{day}.parquet, p/s only — no
  condition codes, no exchange id); quotes = SIP NBBO ({T}_sip_{day}.parquet).
  IEX is a small slice of consolidated volume; every result is "IEX-print
  flow", not whole-market flow.
- Signing: Lee-Ready. Each print is compared with the prevailing NBBO
  midpoint (last valid quote with ts strictly before the print; crossed or
  zero quotes are skipped, the last valid mid carries). Above mid = buy (+1),
  below = sell (-1); at the mid (or no quote yet) the tick rule decides
  (sign of the last non-zero price change); no history at all = 0.
- Large print: size s >= the Q=0.90 quantile of print sizes over ALL
  strictly-earlier backfilled sessions of that ticker (prior-only, per
  ticker). Small print = everything else.
- Per 1-min SIP bar [t, t+60s): signed large shares L_t, signed small
  shares S_t (a minute with no prints = 0 flow).
- Cells per ticker: large{5,15,30} = sum of L over the last N bars ending at
  bar t (the window closes at bar t's close, the forward return starts
  there); small{5,15,30} = the same over S — the CONTROL. The hypothesis is
  "large predicts, small does not". Bars with an incomplete N-window at the
  session open are not fired.
- Signal: +SIG when feature > NSD * sd, -SIG when < -NSD * sd, sd = prior
  days' feature sd (NSD=1.5, H=30, exactly ofi_validation's convention);
  exits/costs from daytrade.simulate (engine cost: 4 bps round trip).

Gate per ticker x cell (ofi_validation's, plus the ground-rules trade floor):
direction >= 51% every fired day-fold, pooled net > 0, >= 3/4 day-folds
positive incl. oldest, >= 30 trades, >= MIN_FOLDS fired days. A ticker with
fewer than 30 complete sessions gets VERDICT "INSUFFICIENT_DATA" whatever
its numbers ("gate_would_fire" carries them, information only).

--stress (ofi_validation's structure and REAL/SUSPECT/LUCK rule): A odd/even
shifted day-folds; B jitter nsd 1.3/1.7, horizon 25/35, AND the large-print
quantile 0.85/0.95 (the one definition parameter this family has); C
calendar half-split; >= 20 trades for a jitter/half cell to count. Only
GATE_FIRES cells, re-stressed only when their fired-fold count grew.
Separate log: logs/tradesize_stress.log.

Re-runnable: day rows already in logs/tradesize_validation.log are reused.

CLI:
    python tradesize_validation.py
    python tradesize_validation.py --stress [AAPL:large15 ...]
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
from ofi_validation import (TICKERS, H, SIG, NSD, MIN_PRIOR, MIN_FOLDS,  # noqa: E402
                            MIN_NS, JITTER_NSD, JITTER_H, prior_sd,
                            score_fold, stress_gate, cell_ok, _fmt)

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "logs" / "tradesize_validation.log"
STRESS_LOG = ROOT / "logs" / "tradesize_stress.log"
Q = 0.90
JITTER_Q = (0.85, 0.95)
WINDOWS = (5, 15, 30)
CELLS = [f"{k}{n}" for k in ("large", "small") for n in WINDOWS]
MIN_TRADES = 30
MIN_SESSIONS = 30


def _emit(row: dict, path: Path | None = None) -> None:
    path = path or LOG             # resolved at call time, not def time
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")


# ---------------------------------------------------------------- loading

def complete_days(t: str) -> list:
    """Sessions with BOTH flow files on disk. Writes are atomic
    (.tmp -> os.replace), so an existing .parquet is complete; .tmp files
    never match."""
    q = {p.name.split("_")[2][:8] for p in alpaca_flow.FLOW_DIR.glob(f"{t}_sip_*.parquet")}
    i = {p.name.split("_")[2][:8] for p in alpaca_flow.FLOW_DIR.glob(f"{t}_iex_*.parquet")}
    return sorted(pd.Timestamp(s).date() for s in q & i)


def lee_ready(ticker: str, day) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None:
    """(ts, price, size, sign) of one session's IEX prints, Lee-Ready signed
    against the prevailing SIP NBBO midpoint (tick rule at the mid)."""
    t = pd.read_parquet(alpaca_flow._path(ticker, "trades", day))
    if t.empty:
        return None
    t = t.sort_values("ts", kind="stable")
    ts, p, s = t["ts"].to_numpy(), t["p"].to_numpy(), t["s"].to_numpy()
    q = pd.read_parquet(alpaca_flow._path(ticker, "quotes", day))
    mid_at = np.full(len(ts), np.nan)
    if not q.empty:
        q = q.sort_values("ts", kind="stable")
        bp, ap = q["bp"].to_numpy(), q["ap"].to_numpy()
        valid = (bp > 0) & (ap > 0) & (ap >= bp)
        mid = pd.Series(np.where(valid, (bp + ap) / 2, np.nan)).ffill().to_numpy()
        k = np.searchsorted(q["ts"].to_numpy(), ts, "left") - 1   # strictly before
        ok = k >= 0
        mid_at[ok] = mid[k[ok]]
    with np.errstate(invalid="ignore"):
        sign = np.sign(p - mid_at)
    sign[np.isnan(sign)] = 0.0
    # Tick rule for prints at the mid / before any quote.
    d = np.concatenate([[0.0], np.sign(np.diff(p))])
    tick = pd.Series(d).replace(0, np.nan).ffill().fillna(0.0).to_numpy()
    sign = np.where(sign == 0, tick, sign)
    return ts, p, s, sign


def ticker_ctx(t: str) -> dict:
    """Bars + per-day signed prints (threshold-free, so every quantile and
    stress variant reuses them)."""
    df = daytrade.fetch_history(t)
    idx_days = np.array(df.index.date)
    bar_days = set(idx_days)
    days = [d for d in complete_days(t) if d in bar_days]
    bar_ns_all = df.index.as_unit("ns").asi8
    per_day = {}
    for d in days:
        lr = lee_ready(t, d)
        if lr is None:
            continue
        per_day[d] = (np.where(idx_days == d)[0], lr)
    return {"df": df, "idx_days": idx_days, "days": sorted(per_day),
            "per_day": per_day, "bar_ns": bar_ns_all}


def _rolling(x: np.ndarray, n: int) -> np.ndarray:
    cs = np.concatenate([[0.0], np.cumsum(x)])
    out = np.full(len(x), np.nan)
    if len(x) >= n:
        out[n - 1:] = cs[n:] - cs[:-n]
    return out


def day_cells(ctx: dict, d, thr: float) -> dict[str, np.ndarray]:
    """Every cell's per-bar feature for one day at large-print threshold thr."""
    sel, (ts, _p, s, sign) = ctx["per_day"][d]
    bar_ns = ctx["bar_ns"][sel]
    lo = np.searchsorted(ts, bar_ns, "left")
    hi = np.searchsorted(ts, bar_ns + MIN_NS, "left")
    big = s >= thr
    out = {}
    for kind, mask in (("large", big), ("small", ~big)):
        cs = np.concatenate([[0.0], np.cumsum(np.where(mask, sign * s, 0.0))])
        per_min = cs[hi] - cs[lo]
        for n in WINDOWS:
            out[f"{kind}{n}"] = _rolling(per_min, n)
    return out


def thresholds(ctx: dict, q: float) -> dict:
    """Prior-only large-print cutoff per day: quantile q of all print
    sizes on strictly earlier backfilled sessions."""
    out, pool = {}, []
    for d in ctx["days"]:
        if pool:
            out[d] = float(np.quantile(np.concatenate(pool), q))
        pool.append(ctx["per_day"][d][1][2])
    return out


def features_at(ctx: dict, q: float) -> dict:
    """{day: (thr, large_vol_share, cells)} for days that have a prior cutoff."""
    key = ("feats", q)
    if key not in ctx:
        res = {}
        for d, thr in thresholds(ctx, q).items():
            s = ctx["per_day"][d][1][2]
            res[d] = (thr, float(s[s >= thr].sum() / s.sum()) if s.sum() else None,
                      day_cells(ctx, d, thr))
        ctx[key] = res
    return ctx[key]


# ---------------------------------------------------------------- scoring

def score_days(ctx: dict, t: str, cell: str, nsd: float, h: int, q: float,
               cfg: dict) -> list[dict]:
    """Out-of-sample day rows: day d's cutoff and feature sd come only from
    strictly earlier backfilled days."""
    df, idx_days = ctx["df"], ctx["idx_days"]
    y = daytrade.forward_return(df, h) * 1e4
    feats = features_at(ctx, q)
    fdays = sorted(feats)
    rows = []
    for j, d in enumerate(fdays):
        prior = [feats[k][2][cell] for k in fdays[:j]]
        if len(prior) < MIN_PRIOR:
            continue
        sel = ctx["per_day"][d][0]
        thr, lshare, cells = feats[d]
        sd = prior_sd(prior)
        v = cells[cell]
        p = np.full(len(df), np.nan)
        with np.errstate(invalid="ignore"):
            p[sel[v > nsd * sd]] = SIG
            p[sel[v < -nsd * sd]] = -SIG
        m = (idx_days == d) & ~np.isnan(p) & ~np.isnan(y) & (y != 0)
        trades = daytrade.simulate(df, p, [d], t, cfg)
        edge = daytrade.edge_metrics(trades, 1, h)
        row = score_fold(y, p, m)
        row.update({"ticker": t, "feature": cell, "day": d.isoformat(),
                    "size_cutoff": thr, "large_vol_share": round(lshare, 3) if lshare else None,
                    "sd": round(sd, 2), "trades": edge["trades"],
                    "avg_net_bps": edge["avg_net_bps"],
                    "total_net_bps": edge["total_net_bps"]})
        rows.append(row)
    return rows


def _read(path: Path) -> list[dict]:
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out


def done_rows() -> dict:
    return {(r["ticker"], r["feature"], r["day"]): r for r in _read(LOG)
            if "day" in r and "feature" in r and "ticker" in r}


def verdict(t: str, cell: str, sessions: int) -> dict:
    rows = sorted((r for r in done_rows().values()
                   if r["ticker"] == t and r["feature"] == cell), key=lambda r: r["day"])
    fired = [r for r in rows if r.get("fired")]
    base = {"ticker": t, "feature": cell, "sessions": sessions, "folds": len(rows)}
    if not fired:
        return {**base, "folds_fired": 0,
                "VERDICT": "INSUFFICIENT_DATA" if sessions < MIN_SESSIONS else "FAIL",
                "why": "no day-fold fired"}
    bars = sum(r["fired"] for r in fired)
    hits = sum(r["hits"] for r in fired)
    trades = sum(r["trades"] for r in fired)
    net = sum(r["total_net_bps"] for r in fired)
    every51 = all(r["direction_hit_pct"] >= 51.0 for r in fired)
    positives = sum(1 for r in fired if r["avg_net_bps"] > 0)
    oldest = fired[0]["avg_net_bps"] > 0
    pooled_net = round(net / trades, 2) if trades else 0.0
    ok = (len(fired) >= MIN_FOLDS and every51 and pooled_net > 0 and trades >= MIN_TRADES
          and positives >= -(-3 * len(fired) // 4) and oldest)
    v = ("INSUFFICIENT_DATA" if sessions < MIN_SESSIONS else
         "GATE_FIRES" if ok else "FAIL")
    return {**base, "folds_fired": len(fired), "fired_bars": bars, "trades": trades,
            "pooled_direction_pct": round(100.0 * hits / bars, 1),
            "pooled_avg_net_bps": pooled_net,
            "positive_folds": f"{positives}/{len(fired)}",
            "oldest_fold_positive": oldest, "every_fold_51pct": every51,
            "gate_would_fire": ok, "VERDICT": v}


def run() -> None:
    cfg = {**knobs.defaults(), "start_equity": 25000.0}
    done = done_rows()
    _emit({"meta": "trade-size structure: Lee-Ready-signed IEX prints, large = "
                   f"size >= prior-only q{Q} per ticker; cells {CELLS}; per-day "
                   "walk-forward over backfilled flow only; gate = dir>=51% every "
                   "day-fold, pooled net>0, >=3/4 positive incl oldest, >=30 trades; "
                   f"<{MIN_SESSIONS} complete sessions => INSUFFICIENT_DATA"})
    for t in TICKERS:
        ctx = ticker_ctx(t)
        n = len(ctx["days"])
        if n < MIN_PRIOR + 2:
            _emit({"ticker": t, "sessions": n, "VERDICT": "INSUFFICIENT_DATA",
                   "why": f"insufficient data ({n} sessions): need >= {MIN_PRIOR + 2} "
                          "to score one day (1 for the size cutoff + MIN_PRIOR for sd)"})
            continue
        for cell in CELLS:
            for row in score_days(ctx, t, cell, NSD, H, Q, cfg):
                if (row["ticker"], row["feature"], row["day"]) not in done:
                    _emit(row)
            _emit(verdict(t, cell, n))


# ---------------------------------------------------------------- stress

def passing_cells() -> list[tuple[str, str]]:
    latest = {(r["ticker"], r["feature"]): r for r in _read(LOG) if "VERDICT" in r and "feature" in r}
    done = {(r["ticker"], r["feature"], r.get("folds_fired"))
            for r in _read(STRESS_LOG) if r.get("FINAL")}
    return [(t, f) for (t, f), r in sorted(latest.items())
            if r["VERDICT"] == "GATE_FIRES" and (t, f, r.get("folds_fired")) not in done]


def stress(cells: list[tuple[str, str]] | None) -> None:
    cfg = {**knobs.defaults(), "start_equity": 25000.0}
    if cells is None:
        cells = passing_cells()
    em = lambda r: _emit(r, STRESS_LOG)  # noqa: E731
    em({"stress": "tradesize pre-registered stress",
        "tests": "A odd/even shifted folds; B jitter nsd 1.3/1.7, horizon 25/35, "
                 "large-print quantile 0.85/0.95; C calendar half-split",
        "min_cell_trades_for_judgment": 20,
        "verdict_rule": "REAL=A both sides + all jitter + both halves hold; "
                        "LUCK=A fails once judged; SUSPECT=else",
        "cells": [f"{t}:{f}" for t, f in cells]})
    if not cells:
        em({"note": "no GATE_FIRES cells to stress"})
    for t, cell in cells:
        ctx = ticker_ctx(t)
        fired = [r for r in score_days(ctx, t, cell, NSD, H, Q, cfg) if r.get("fired")]
        if not fired:
            em({"ticker": t, "feature": cell, "error": "no fired day-folds at base params"})
            continue
        g_odd, g_even = stress_gate(fired[0::2]), stress_gate(fired[1::2])
        em({"ticker": t, "feature": cell, "test": "A_shifted_odd", "gate": g_odd})
        em({"ticker": t, "feature": cell, "test": "A_shifted_even", "gate": g_even})
        jitter = {}
        for name, kw in ([(f"nsd={x}", {"nsd": x}) for x in JITTER_NSD]
                         + [(f"h={x}", {"h": x}) for x in JITTER_H]
                         + [(f"q={x}", {"q": x}) for x in JITTER_Q]):
            a = {"nsd": NSD, "h": H, "q": Q, **kw}
            ok, g = cell_ok(score_days(ctx, t, cell, a["nsd"], a["h"], a["q"], cfg))
            jitter[name] = (ok, g)
            em({"ticker": t, "feature": cell, "test": "B_jitter", "params": name,
                "holds": ok, **g})
        days_sorted = sorted(r["day"] for r in fired)
        mid = days_sorted[len(days_sorted) // 2]
        halves = {}
        for name, keep in (("first_half", lambda d: d < mid),
                           ("second_half", lambda d: d >= mid)):
            ok, g = cell_ok([r for r in fired if keep(r["day"])])
            halves[name] = (ok, g)
            em({"ticker": t, "feature": cell, "test": "C_half_split", "half": name,
                "holds": ok, **g})
        a_pass = g_odd["PASS"] and g_even["PASS"]
        a_fail = ((g_odd["judged"] and not g_odd["PASS"])
                  or (g_even["judged"] and not g_even["PASS"]))
        v = ("LUCK" if a_fail else
             "REAL" if (a_pass and all(o for o, _ in jitter.values())
                        and all(o for o, _ in halves.values())) else "SUSPECT")
        em({"FINAL": True, "ticker": t, "feature": cell, "folds_fired": len(fired),
            "verdict": v,
            "evidence": (f"shifted odd: {_fmt(g_odd)}; even: {_fmt(g_even)}; halves: "
                         f"first {_fmt(halves['first_half'][1])}, second "
                         f"{_fmt(halves['second_half'][1])}; jitter "
                         + ", ".join(f"{nm}: {_fmt(g)}" for nm, (_, g) in jitter.items()))})
    print("DONE tradesize-stress", flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--stress":
        cells = None
        if len(sys.argv) > 2:
            cells = [(a.upper(), b.lower()) for a, b in (s.split(":") for s in sys.argv[2:])]
        stress(cells)
    else:
        run()
        print("DONE tradesize-validation", flush=True)
