#!/usr/bin/env python3
"""Stress-test the intraday-structure survivors: perturbation + shifted window.

The rule-based hunt passed 11 of 134 cells under the honest gate; with 134
simultaneous cells, multiple-comparison luck is the null hypothesis (the
earlier pooled-net 7/120 ticker-folds that flipped sign on re-init were
exactly that). NO tuning here — survivors only get stressed, four ways:

A. Shifted folds: the same gate re-scored on 4 folds at different offsets
   (-112..-87, -87..-62, -62..-37, -37..-12 sessions) — different session
   groupings, same criteria (dir >= 51% all fired bars, net > 0 after the
   2 bps/side cost, >= 3/4 folds, oldest fold positive, >= 30 trades).
B. Parameter jitter: each survivor's neighboring cells (gap k=0.4/0.6;
   VWAP k=2.8/3.2 + exit-at-close; ORB ranges adjacent to the survivor;
   TOD bucket shifted +-15 min). A real effect degrades gracefully; luck
   collapses discontinuously.
C. Half-split: dir + net on the first vs second calendar half of the FULL
   stored history — the first half was never inside the selection window.
D. MU trade-count sensitivity: k=0.5 exactly vs the pooled {0.4, 0.5, 0.6}
   neighborhood (3x the trades; not independent — a day can fire up to 3x).

Verdict rules (mechanical, stated up front):
- REAL: shifted-fold gate PASS AND both halves dir >= 51% & net > 0 AND
  every immediate jitter neighbor dir >= 51% & net > 0 (>= 20 trades to
  count as holding; fewer is inconclusive and cannot confirm).
- LUCK: shifted-fold gate FAIL (dir < 51%, net <= 0, < 3/4 folds positive,
  or oldest fold negative).
- SUSPECT: shifted gate PASS but halves or jitter only partially hold.
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402
import intraday_structure_validation as base  # noqa: E402

SHIFTED_OFFSETS = [(-112, -87), (-87, -62), (-62, -37), (-37, -12)]
SHIFTED_LABELS = [f"{a}..{b}" for a, b in SHIFTED_OFFSETS]
TICKERS = ["MU", "V", "JPM", "KO", "MSFT", "TXN", "CVX"]  # family tickers first
MIN_CELL_TRADES = 20      # below this a jitter/half cell can neither confirm nor kill

GAP_KS = (0.4, 0.5, 0.6)             # MU: survivor 0.5, jitter 0.4/0.6, pool all 3
VWAP_KS = (2.8, 3.0, 3.2)            # survivor 3.0, jitter 2.8/3.2 (+ close-exit)
VWAP_SURVIVORS = ("MSFT", "TXN", "CVX")
VWAP_FAMILY = ("V", "JPM", "KO")     # never passed; family-coherence check only
ORB_RANGES = (5, 10, 15, 20, 25, 30, 35)
ORB_NEIGHBORS = {30: (15, 25, 35), 5: (10, 15)}
TOD_BUCKETS = {"0930-1030": (0, 60), "0930-1015": (0, 45), "0945-1045": (15, 75)}


def emit(rec: dict) -> None:
    print(json.dumps(rec), flush=True)


def day_fold_map(days: list, offsets: list, labels: list) -> dict:
    m = {}
    for (a, b), lab in zip(offsets, labels):
        fold_days = days[a:] if b == 0 else days[a:b]
        m.update({d: lab for d in fold_days})
    return m


def gate(trades: list, day_fold: dict, labels: list) -> dict:
    """base.gate generalized to arbitrary fold labels (shifted or original)."""
    folds: dict[str, list] = {lab: [] for lab in labels}
    for d, side, net, gross in trades:
        lab = day_fold.get(d)
        if lab:
            folds[lab].append((net, gross))
    rows, pos, hits, tot, net_sum = [], 0, 0, 0, 0.0
    for lab in labels:
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
    ok = (tot >= base.MIN_TRADES and 100 * hits / tot >= 51.0 and avg > 0
          and pos >= 3 and rows[0]["net_bps"] > 0)
    return {"folds": rows, "pos_folds": pos, "trades": tot,
            "dir_pct": round(100 * hits / tot, 1),
            "avg_net_bps": round(avg, 2), "PASS": bool(ok)}


def halves(trades: list, days: list) -> dict:
    """dir + avg net on the first/second calendar half of the full history."""
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
    """a cell counts as holding if it has enough trades to judge and holds."""
    return (g["trades"] >= MIN_CELL_TRADES and g["dir_pct"] is not None
            and g["dir_pct"] >= 51.0 and g["avg_net_bps"] is not None
            and g["avg_net_bps"] > 0)


def halves_ok(h: dict) -> bool:
    a, b = h["first_half"], h["second_half"]
    return cell_ok(a) and cell_ok(b)


def fmt_gate(g: dict) -> str:
    if not g["trades"]:
        return "no trades"
    return (f"dir {g['dir_pct']}%, avg net {g['avg_net_bps']} bps, "
            f"{g.get('pos_folds', '?')}/4 folds positive (oldest "
            f"{g['folds'][0]['net_bps']}), n={g['trades']}, PASS={g['PASS']}")


def fmt_half(h: dict) -> str:
    if not h["trades"]:
        return "no trades"
    return f"dir {h['dir_pct']}%, net {h['avg_net_bps']} bps, n={h['trades']}"


def vwap_close_trades(d, z: np.ndarray, c: np.ndarray, k: float) -> list:
    """Fade the first move beyond the +-k band and hold to the close (no
    VWAP-touch exit) — the exit-side neighbor of the survivor's cell."""
    for i in range(base.VWAP_WARM, len(c) - 1):
        if z[i] >= k:
            side, entry = "short", float(c[i])
            break
        if z[i] <= -k:
            side, entry = "long", float(c[i])
            break
    else:
        return []
    net, gross = base.fill(side, entry, float(c[-1]))
    return [(d, side, net, gross)]


def bucket_trades_fixed(sess: dict, days: list, a: int, b: int, side: str) -> list:
    """One trade per session over a fixed bar range [a, b) at a fixed side."""
    trades = []
    for d in days:
        s = sess[d]
        if len(s["Close"]) >= b:
            net, gross = base.fill(side, float(s["Close"][a]), float(s["Close"][b - 1]))
            trades.append((d, side, net, gross))
    return trades


def tod_walkforward(sess: dict, days: list, offsets: list, labels: list) -> tuple:
    """The original walk-forward, parameterized over fold offsets: bucket AND
    side chosen strictly from sessions before each fold."""
    rets = {d: base.bucket_rets(sess[d]["Close"]) for d in days}
    wf, chosen = [], {}
    for lab in labels:
        a, b = offsets[labels.index(lab)]
        fold_days = days[a:] if b == 0 else days[a:b]
        prior = [d for d in days if d < fold_days[0]]
        means = {nm: float(np.mean([rets[d][nm] for d in prior if nm in rets[d]]))
                 for nm, _, _ in base.BUCKETS}
        best = max(means, key=lambda nm: abs(means[nm]))
        side = "long" if means[best] > 0 else "short"
        chosen[lab] = {"bucket": best, "side": side,
                       "prior_mean_bps": round(means[best] * 1e4, 1)}
        aa, bb = next((x, y) for nm, x, y in base.BUCKETS if nm == best)
        wf += bucket_trades_fixed(sess, fold_days, aa, bb, side)
    return wf, chosen


def stress_mu_gap(sess: dict, days: list, orig_fold: dict, shift_fold: dict) -> dict:
    cells = {}
    for k in GAP_KS:
        tr = []
        for j in range(1, len(days)):
            tr += base.gap_trades(days[j], sess[days[j]], sess[days[j - 1]], k, "cont")
        cells[k] = tr
    pooled = sum((cells[k] for k in GAP_KS), [])
    cand = "MU gap-cont k=0.5"
    g_o = gate(cells[0.5], orig_fold, base.FOLD_LABELS)
    g_s = gate(cells[0.5], shift_fold, SHIFTED_LABELS)
    h = halves(cells[0.5], days)
    emit({"candidate": cand, "test": "reference_orig_folds", "gate": g_o})
    emit({"candidate": cand, "test": "A_shifted_folds", "gate": g_s})
    emit({"candidate": cand, "test": "C_half_split", **h})
    jg = {}
    for k in (0.4, 0.6):
        jg[k] = gate(cells[k], shift_fold, SHIFTED_LABELS)
        emit({"candidate": cand, "test": "B_jitter", "k_prior_range": k, "gate": jg[k]})
    g_p = gate(pooled, shift_fold, SHIFTED_LABELS)
    h_p = halves(pooled, days)
    emit({"candidate": cand, "test": "D_pooled_neighborhood",
          "note": "k=0.4+0.5+0.6 pooled; not independent (a day can fire up to 3x)",
          "gate": g_p, **h_p})
    jok = all(cell_ok(g) for g in jg.values())
    v = "REAL" if (g_s["PASS"] and halves_ok(h) and jok) else \
        ("SUSPECT" if g_s["PASS"] else "LUCK")
    return {"candidate": cand, "verdict": v,
            "evidence": (f"shifted: {fmt_gate(g_s)}; halves: first {fmt_half(h['first_half'])}, "
                         f"second {fmt_half(h['second_half'])}; jitter k=0.4: {fmt_gate(jg[0.4])}, "
                         f"k=0.6: {fmt_gate(jg[0.6])}; pooled(0.4/0.5/0.6): {fmt_gate(g_p)} "
                         f"(halves {fmt_half(h_p['first_half'])} / {fmt_half(h_p['second_half'])})")}


def stress_vwap(t: str, sess: dict, days: list, orig_fold: dict, shift_fold: dict,
                family_ev: dict) -> dict:
    zc = {}
    for d in days:
        s = sess[d]
        if len(s["Close"]) >= base.VWAP_WARM + 2:
            dev, z = base.vwap_state(s)
            zc[d] = (dev, z, s["Close"])
    cells = {k: sum((base.vwap_trades(d, dev, z, c, k)
                    for d, (dev, z, c) in zc.items()), [])
             for k in VWAP_KS}
    close_exit = sum((vwap_close_trades(d, z, c, 3.0)
                      for d, (dev, z, c) in zc.items()), [])
    if t in VWAP_FAMILY:
        g_o = gate(cells[3.0], orig_fold, base.FOLD_LABELS)
        g_s = gate(cells[3.0], shift_fold, SHIFTED_LABELS)
        emit({"candidate": "VWAP k=3.0 family (never-passed tickers)",
              "test": "family", "ticker": t, "gate_orig": g_o, "gate_shifted": g_s})
        family_ev[t] = (f"{t} dir {g_o['dir_pct']}% net {g_o['avg_net_bps']} bps "
                        f"(shifted: dir {g_s['dir_pct']}% net {g_s['avg_net_bps']} bps)")
        return {}
    cand = f"{t} VWAP-reversion k=3.0"
    g_o = gate(cells[3.0], orig_fold, base.FOLD_LABELS)
    g_s = gate(cells[3.0], shift_fold, SHIFTED_LABELS)
    h = halves(cells[3.0], days)
    emit({"candidate": cand, "test": "reference_orig_folds", "gate": g_o})
    emit({"candidate": cand, "test": "A_shifted_folds", "gate": g_s})
    emit({"candidate": cand, "test": "C_half_split", **h})
    jg = {"k=2.8": gate(cells[2.8], shift_fold, SHIFTED_LABELS),
          "k=3.2": gate(cells[3.2], shift_fold, SHIFTED_LABELS),
          "exit=close@k=3.0": gate(close_exit, shift_fold, SHIFTED_LABELS)}
    for name, g in jg.items():
        emit({"candidate": cand, "test": "B_jitter", "params": name, "gate": g})
    jok = all(cell_ok(g) for g in jg.values())
    hok = halves_ok(h)
    v = "REAL" if (g_s["PASS"] and hok and jok) else \
        ("SUSPECT" if g_s["PASS"] else "LUCK")
    fam = "; ".join(family_ev.get(x, "?") for x in VWAP_FAMILY)
    return {"candidate": cand, "verdict": v,
            "evidence": (f"shifted: {fmt_gate(g_s)}; halves: first {fmt_half(h['first_half'])}, "
                         f"second {fmt_half(h['second_half'])}; jitter " +
                         ", ".join(f"{nm}: {fmt_gate(g)}" for nm, g in jg.items()) +
                         f"; family k=3.0 (never passed): {fam} — fade trades run dir>50% "
                         "everywhere, so family direction alone does not confirm")}


def stress_orb(t: str, n_surv: int, sess: dict, days: list,
               orig_fold: dict, shift_fold: dict) -> dict:
    cells = {n: [] for n in ORB_RANGES}
    for d in days:
        s = sess[d]
        for n in ORB_RANGES:
            cells[n] += base.orb_trades(d, s, n)
    cand = f"{t} ORB{n_surv}"
    g_o = gate(cells[n_surv], orig_fold, base.FOLD_LABELS)
    g_s = gate(cells[n_surv], shift_fold, SHIFTED_LABELS)
    h = halves(cells[n_surv], days)
    emit({"candidate": cand, "test": "reference_orig_folds", "gate": g_o})
    emit({"candidate": cand, "test": "A_shifted_folds", "gate": g_s})
    emit({"candidate": cand, "test": "C_half_split", **h})
    jg = {}
    for n in ORB_RANGES:
        if n == n_surv:
            continue
        jg[n] = gate(cells[n], shift_fold, SHIFTED_LABELS)
        emit({"candidate": cand, "test": "B_jitter", "range_min": n, "gate": jg[n]})
    nb = {n: jg[n] for n in ORB_NEIGHBORS[n_surv]}
    jok = all(cell_ok(g) for g in nb.values())
    v = "REAL" if (g_s["PASS"] and halves_ok(h) and jok) else \
        ("SUSPECT" if g_s["PASS"] else "LUCK")
    return {"candidate": cand, "verdict": v,
            "evidence": (f"shifted: {fmt_gate(g_s)}; halves: first {fmt_half(h['first_half'])}, "
                         f"second {fmt_half(h['second_half'])}; immediate neighbors " +
                         ", ".join(f"ORB{n}: {fmt_gate(g)}" for n, g in nb.items()))}


def stress_ko_tod(sess: dict, days: list, orig_fold: dict, shift_fold: dict) -> dict:
    cand = "KO TOD-walkforward (long 09:30-10:30)"
    wf_o, ch_o = tod_walkforward(sess, days, base.FOLD_OFFSETS, base.FOLD_LABELS)
    wf_s, ch_s = tod_walkforward(sess, days, SHIFTED_OFFSETS, SHIFTED_LABELS)
    fixed = {nm: bucket_trades_fixed(sess, days, a, b, "long")
             for nm, (a, b) in TOD_BUCKETS.items()}
    g_wf_o = gate(wf_o, orig_fold, base.FOLD_LABELS)
    g_wf_s = gate(wf_s, shift_fold, SHIFTED_LABELS)
    g_fix_s = gate(fixed["0930-1030"], shift_fold, SHIFTED_LABELS)
    h = halves(fixed["0930-1030"], days)
    emit({"candidate": cand, "test": "reference_orig_folds",
          "chosen": ch_o, "gate": g_wf_o})
    emit({"candidate": cand, "test": "A_shifted_folds_walkforward",
          "chosen": ch_s, "gate": g_wf_s})
    emit({"candidate": cand, "test": "A_shifted_folds_fixed_cell",
          "note": "the materialized cell: long 09:30-10:30 every session",
          "gate": g_fix_s})
    emit({"candidate": cand, "test": "C_half_split", **h})
    jg = {}
    for nm in ("0930-1015", "0945-1045"):
        jg[nm] = gate(fixed[nm], shift_fold, SHIFTED_LABELS)
        emit({"candidate": cand, "test": "B_jitter", "bucket": nm, "gate": jg[nm]})
    both = g_wf_s["PASS"] and g_fix_s["PASS"]
    one = g_wf_s["PASS"] or g_fix_s["PASS"]
    jok = all(cell_ok(g) for g in jg.values())
    if both and halves_ok(h) and jok:
        v = "REAL"
    elif both:
        v = "SUSPECT"
    elif one:
        v = "SUSPECT"
    else:
        v = "LUCK"
    return {"candidate": cand, "verdict": v,
            "evidence": (f"walk-forward on shifted folds: {fmt_gate(g_wf_s)} "
                         f"(chosen {json.dumps(ch_s)}); fixed cell on shifted folds: "
                         f"{fmt_gate(g_fix_s)}; halves: first {fmt_half(h['first_half'])}, "
                         f"second {fmt_half(h['second_half'])}; jitter " +
                         ", ".join(f"{nm}: {fmt_gate(g)}" for nm, g in jg.items()))}


def main() -> None:
    emit({"stress": "survivor stress (perturbation + shifted window)",
          "cost_per_side_bps": round(base.COST * 1e4, 2),
          "round_trip_bps": daytrade.round_trip_bps(knobs.defaults()),
          "shifted_folds": SHIFTED_LABELS,
          "min_trades": base.MIN_TRADES,
          "min_cell_trades_for_judgment": MIN_CELL_TRADES})
    verdicts, family_ev = [], {}
    for t in TICKERS:
        sess = base.load(t)
        days = sorted(sess)
        if len(days) < 112:
            emit({"ticker": t, "error": f"only {len(days)} sessions"})
            continue
        orig_fold = day_fold_map(days, base.FOLD_OFFSETS, base.FOLD_LABELS)
        shift_fold = day_fold_map(days, SHIFTED_OFFSETS, SHIFTED_LABELS)
        emit({"ticker": t, "sessions": len(days)})
        if t == "MU":
            verdicts.append(stress_mu_gap(sess, days, orig_fold, shift_fold))
        if t in VWAP_SURVIVORS:
            verdicts.append(stress_vwap(t, sess, days, orig_fold, shift_fold, family_ev))
            verdicts.append(stress_orb(t, 30 if t == "MSFT" else 5, sess, days,
                                       orig_fold, shift_fold))
        elif t in VWAP_FAMILY:
            stress_vwap(t, sess, days, orig_fold, shift_fold, family_ev)
        if t == "KO":
            verdicts.append(stress_ko_tod(sess, days, orig_fold, shift_fold))
    for v in verdicts:
        emit({"FINAL": True, **v})
    emit({"VERDICT": "; ".join(f"{v['candidate']}={v['verdict']}" for v in verdicts)})
    print("DONE survivor-stress", flush=True)


if __name__ == "__main__":
    main()