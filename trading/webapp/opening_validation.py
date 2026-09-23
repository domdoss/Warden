#!/usr/bin/env python3
"""Opening prints ("Next ideas" 3): does first-5/15-min signed flow, or the
opening print vs the prior close, predict the REST-OF-MORNING return?
Reads only flow files alpaca_flow.py has already written + stored SIP bars;
no API calls. Signing = tradesize_validation.lee_ready (Lee-Ready vs the
prevailing SIP NBBO mid, tick rule at the mid).

PRE-REGISTERED DEFINITIONS (fixed before any result was seen):
- Opening print: the Open of the stored SIP 09:30 1-min bar. The IEX trade
  feed on disk does NOT contain the primary-exchange opening cross (and has
  no condition codes), so the SIP bar open is the auction-print proxy.
  Prior close: Close of the prior session's last stored bar.
- Features per session (one trade per session per cell):
    flow5  = Lee-Ready signed IEX volume / total IEX volume, 09:30-09:35
    flow15 = the same over 09:30-09:45
    gap    = 1e4 * ln(open print / prior close)
- Cells (direction fixed a priori):
    flow5     long if flow5 > +NSD*sd, short if < -NSD*sd  (continuation)
    flow15    the same on flow15
    gap_cont  trade WITH the gap;  gap_fade  trade AGAINST the gap
    gapflow15 trade with the gap only when flow15 has the gap's sign
              (flow confirms the open) — the interaction cell
  gap_cont/gap_fade on bars alone overlap intraday_structure_validation's
  gap tests; they are here as the reference for the flow cells, restricted
  to the same flow sessions.
- sd = ROBUST scale of the feature over strictly-earlier flow sessions
  (1.4826 * MAD, >= MIN_PRIOR sessions). Changed from plain std during the
  synthetic pipeline test, BEFORE any real-data verdict existed: one AAPL
  earnings gap (2026-07-31, -914 bps) inflated the std so the gap cells fired
  on 4/37 sessions. NSD = 0.5 (one trade/session: 1.5 would fire ~13% of ~100 sessions,
  below the 30-trade floor).
- Entry: close of the feature window's last bar (gap cells: 09:30 bar
  close; flow5: 09:34 bar close; flow15/gapflow15: 09:44 bar close).
  Exit: close of the 11:59 bar ("rest of morning" = until 12:00 ET).
  Net = direction * ln-return - 4.0 bps round trip (2.0 bps/side).

Gate per ticker x cell: scored sessions in 4 chronological folds; direction
>= 51% over the fired sessions of EVERY fold incl. the oldest, pooled net > 0,
>= 3/4 folds with positive avg net incl. the oldest, >= 30 trades. With
< 30 complete flow sessions the VERDICT is INSUFFICIENT_DATA whatever the
numbers ("gate_would_fire" carries them, information only).

--stress (ofi_validation's structure and REAL/SUSPECT/LUCK rule): A odd/even
sessions, each re-gated on its own 4 folds (judged when all 4 folds fired);
B jitter NSD 0.3/0.7 and exit 11:30/12:30; C calendar half-split; a
jitter/half cell holds with >= 20 trades AND dir >= 51% AND net > 0.
Separate log: logs/opening_stress.log.

Re-runnable: session rows already in logs/opening_validation.log are reused.

CLI:
    python opening_validation.py
    python opening_validation.py --stress [MU:flow15 ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")
import numpy as np  # noqa: E402
import daytrade  # noqa: E402
from ofi_validation import TICKERS, MIN_PRIOR  # noqa: E402
from tradesize_validation import complete_days, lee_ready  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "logs" / "opening_validation.log"
STRESS_LOG = ROOT / "logs" / "opening_stress.log"
NSD = 0.5
JITTER_NSD = (0.3, 0.7)
EXIT = "11:59"
JITTER_EXIT = ("11:29", "12:29")
COST_RT = 4.0
CELLS = ["flow5", "flow15", "gap_cont", "gap_fade", "gapflow15"]
ENTRY = {"flow5": "09:34", "flow15": "09:44", "gap_cont": "09:30",
         "gap_fade": "09:30", "gapflow15": "09:44"}
MIN_TRADES, MIN_SESSIONS, MIN_CELL_TRADES, NFOLDS = 30, 30, 20, 4


def _emit(row: dict, path: Path | None = None) -> None:
    path = path or LOG             # resolved at call time, not def time
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")


def _read(path: Path) -> list[dict]:
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out


def sessions(t: str) -> list[dict]:
    """Per flow session: features + close prices at every entry/exit bar."""
    df = daytrade.fetch_history(t)
    idx_days = np.array(df.index.date)
    hhmm = df.index.strftime("%H:%M")
    all_days = sorted(set(idx_days))
    out = []
    for d in complete_days(t):
        if d not in set(all_days) or all_days.index(d) == 0:
            continue
        sel = np.where(idx_days == d)[0]
        if hhmm[sel[0]] != "09:30":
            continue
        prev = np.where(idx_days == all_days[all_days.index(d) - 1])[0]
        closes = {hhmm[i]: float(df["Close"].iloc[i]) for i in sel}
        lr = lee_ready(t, d)
        if lr is None:
            continue
        ts, _p, s, sign = lr
        t0 = df.index[sel[0]].as_unit("ns").value
        row = {"day": d.isoformat(), "closes": closes,
               "gap": 1e4 * np.log(df["Open"].iloc[sel[0]] / df["Close"].iloc[prev[-1]])}
        for name, mins in (("flow5", 5), ("flow15", 15)):
            m = ts < t0 + mins * 60 * 10**9
            vol = s[m].sum()
            row[name] = float((sign[m] * s[m]).sum() / vol) if vol > 0 else np.nan
        out.append(row)
    return out


def score(sess: list[dict], t: str, cell: str, nsd: float, exit_hm: str) -> list[dict]:
    """One out-of-sample row per session: sd from strictly earlier sessions."""
    feat = "gap" if cell.startswith("gap") else cell
    rows = []
    for j, s in enumerate(sess):
        prior = np.array([x[feat] for x in sess[:j]], dtype=float)
        prior = prior[~np.isnan(prior)]
        if len(prior) < MIN_PRIOR:
            continue
        sd = float(1.4826 * np.median(np.abs(prior - np.median(prior)))) or 1e-9
        v = s[feat]
        side = 0
        if not np.isnan(v) and abs(v) > nsd * sd:
            side = int(np.sign(v))
            if cell == "gap_fade":
                side = -side
            if cell == "gapflow15" and not (np.sign(s["flow15"]) == np.sign(v)):
                side = 0
        e, x = s["closes"].get(ENTRY[cell]), s["closes"].get(exit_hm)
        r = {"ticker": t, "feature": cell, "day": s["day"], "value": round(float(v), 4)
             if not np.isnan(v) else None, "sd": round(sd, 4), "fired": 0}
        if side and e and x:
            ret = 1e4 * np.log(x / e)
            r.update({"fired": 1, "side": side, "ret_bps": round(float(ret), 2),
                      "hit": int(np.sign(ret) == side),
                      "net_bps": round(float(side * ret - COST_RT), 2)})
        rows.append(r)
    return rows


def gate(rows: list[dict], judged_needs_all_folds: bool = False) -> dict:
    """4 chronological folds over the scored sessions; the honest gate."""
    rows = sorted(rows, key=lambda r: r["day"])
    fired = [r for r in rows if r["fired"]]
    g = {"sessions_scored": len(rows), "trades": len(fired)}
    if not fired:
        return {**g, "PASS": False, "judged": False}
    folds = [f for f in np.array_split(np.arange(len(rows)), NFOLDS)]
    fs = []
    for f in folds:
        fr = [rows[i] for i in f if rows[i]["fired"]]
        fs.append({"n": len(fr),
                   "dir": round(100.0 * sum(r["hit"] for r in fr) / len(fr), 1) if fr else None,
                   "net": round(float(np.mean([r["net_bps"] for r in fr])), 2) if fr else None})
    fired_folds = [f for f in fs if f["n"]]
    positives = sum(1 for f in fired_folds if f["net"] > 0)
    g.update({"dir_pct": round(100.0 * sum(r["hit"] for r in fired) / len(fired), 1),
              "avg_net_bps": round(float(np.mean([r["net_bps"] for r in fired])), 2),
              "folds": fs, "positive_folds": f"{positives}/{NFOLDS}",
              "every_fold_51pct": all(f["dir"] is not None and f["dir"] >= 51.0 for f in fs),
              "oldest_positive": bool(fs[0]["n"] and fs[0]["net"] > 0),
              "judged": len(fired_folds) == NFOLDS})
    g["PASS"] = bool(g["judged"] and g["every_fold_51pct"] and g["avg_net_bps"] > 0
                     and positives >= 3 and g["oldest_positive"]
                     and (judged_needs_all_folds or len(fired) >= MIN_TRADES))
    return g


def cell_ok(rows: list[dict]) -> tuple[bool, dict]:
    fired = [r for r in rows if r["fired"]]
    g = {"trades": len(fired)}
    if len(fired) < MIN_CELL_TRADES:
        return False, {**g, "inconclusive": True}
    g["dir_pct"] = round(100.0 * sum(r["hit"] for r in fired) / len(fired), 1)
    g["avg_net_bps"] = round(float(np.mean([r["net_bps"] for r in fired])), 2)
    return bool(g["dir_pct"] >= 51.0 and g["avg_net_bps"] > 0), g


def _fmt(g: dict) -> str:
    if g.get("inconclusive") or not g.get("trades"):
        return f"inconclusive (trades={g.get('trades', 0)})"
    return f"dir {g.get('dir_pct')}%, net {g.get('avg_net_bps')} bps, n={g['trades']}"


def run() -> None:
    done = {(r["ticker"], r["feature"], r["day"]) for r in _read(LOG) if "day" in r}
    _emit({"meta": f"opening prints: cells {CELLS}, NSD {NSD}, exit {EXIT} close, "
                   f"{COST_RT} bps round trip; opening print = SIP 09:30 bar open "
                   "(IEX feed has no opening cross); 4 chronological folds; "
                   f"<{MIN_SESSIONS} complete sessions => INSUFFICIENT_DATA"})
    for t in TICKERS:
        sess = sessions(t)
        n = len(sess)
        for cell in CELLS:
            for r in score(sess, t, cell, NSD, EXIT):
                if (t, cell, r["day"]) not in done:
                    _emit(r)
            rows = [r for r in _read(LOG) if r.get("ticker") == t
                    and r.get("feature") == cell and "day" in r]
            rows = list({r["day"]: r for r in rows}.values())
            g = gate(rows)
            v = ("INSUFFICIENT_DATA" if n < MIN_SESSIONS else
                 "GATE_FIRES" if g["PASS"] else "FAIL")
            _emit({"ticker": t, "feature": cell, "sessions": n,
                   **{k: v2 for k, v2 in g.items() if k != "PASS"},
                   "gate_would_fire": g["PASS"], "VERDICT": v})


def passing_cells() -> list[tuple[str, str]]:
    latest = {(r["ticker"], r["feature"]): r for r in _read(LOG) if "VERDICT" in r}
    done = {(r["ticker"], r["feature"], r.get("trades")) for r in _read(STRESS_LOG) if r.get("FINAL")}
    return [(t, f) for (t, f), r in sorted(latest.items())
            if r["VERDICT"] == "GATE_FIRES" and (t, f, r.get("trades")) not in done]


def stress(cells: list[tuple[str, str]] | None) -> None:
    if cells is None:
        cells = passing_cells()
    em = lambda r: _emit(r, STRESS_LOG)  # noqa: E731
    em({"stress": "opening pre-registered stress",
        "tests": "A odd/even sessions (each re-gated on 4 folds); B jitter NSD "
                 "0.3/0.7 + exit 11:30/12:30; C calendar half-split",
        "min_cell_trades_for_judgment": MIN_CELL_TRADES,
        "verdict_rule": "REAL=A both sides + all jitter + both halves hold; "
                        "LUCK=A fails once judged; SUSPECT=else",
        "cells": [f"{t}:{f}" for t, f in cells]})
    if not cells:
        em({"note": "no GATE_FIRES cells to stress"})
    for t, cell in cells:
        sess = sessions(t)
        base = score(sess, t, cell, NSD, EXIT)
        n_tr = sum(r["fired"] for r in base)
        g_odd = gate(base[0::2], True)
        g_even = gate(base[1::2], True)
        em({"ticker": t, "feature": cell, "test": "A_shifted_odd", "gate": g_odd})
        em({"ticker": t, "feature": cell, "test": "A_shifted_even", "gate": g_even})
        jitter = {}
        for name, (nsd, ex) in ([(f"nsd={x}", (x, EXIT)) for x in JITTER_NSD]
                                + [(f"exit={x}", (NSD, x)) for x in JITTER_EXIT]):
            ok, g = cell_ok(score(sess, t, cell, nsd, ex))
            jitter[name] = (ok, g)
            em({"ticker": t, "feature": cell, "test": "B_jitter", "params": name,
                "holds": ok, **g})
        mid = base[len(base) // 2]["day"]
        halves = {}
        for name, keep in (("first_half", lambda d: d < mid),
                           ("second_half", lambda d: d >= mid)):
            ok, g = cell_ok([r for r in base if keep(r["day"])])
            halves[name] = (ok, g)
            em({"ticker": t, "feature": cell, "test": "C_half_split", "half": name,
                "holds": ok, **g})
        a_pass = g_odd["PASS"] and g_even["PASS"]
        a_fail = ((g_odd["judged"] and not g_odd["PASS"])
                  or (g_even["judged"] and not g_even["PASS"]))
        v = ("LUCK" if a_fail else
             "REAL" if (a_pass and all(o for o, _ in jitter.values())
                        and all(o for o, _ in halves.values())) else "SUSPECT")
        em({"FINAL": True, "ticker": t, "feature": cell, "trades": n_tr, "verdict": v,
            "evidence": (f"shifted odd: {_fmt(g_odd)}; even: {_fmt(g_even)}; halves: "
                         f"first {_fmt(halves['first_half'][1])}, second "
                         f"{_fmt(halves['second_half'][1])}; jitter "
                         + ", ".join(f"{nm}: {_fmt(g)}" for nm, (_, g) in jitter.items()))})
    print("DONE opening-stress", flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--stress":
        cells = None
        if len(sys.argv) > 2:
            cells = [(a.upper(), b.lower()) for a, b in (s.split(":") for s in sys.argv[2:])]
        stress(cells)
    else:
        run()
        print("DONE opening-validation", flush=True)
