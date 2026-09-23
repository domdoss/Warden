#!/usr/bin/env python3
"""Post-earnings announcement drift (PEAD) on ~100 liquid US large caps.

Hypothesis (documented: Ball-Brown 1968, Bernard-Thomas 1989, Chan-Jegadeesh-
Lakonishok 1996): after an earnings announcement, prices keep drifting for
days-to-weeks in the direction of the surprise / announcement-day reaction.

DATA (no Alpaca calls — a backfill owns that quota)
- yfinance daily OHLC (auto_adjust=True: split+dividend adjusted), cached per
  ticker under .alpha-stack/research/pead/px_{T}.pkl, plus SPY for a market-
  excess diagnostic. yfinance earnings dates (timestamp in America/New_York,
  EPS estimate, reported EPS, surprise %) cached as earn_{T}.pkl. The cache
  is reused on every run; `--fetch` only downloads files that are missing.
- For the 10 engine tickers the yfinance daily returns are cross-checked
  against daily bars rebuilt from the stored Alpaca 1-min cache
  (.alpha-stack/daytrade/alpaca/{T}.pkl, read directly) — a parity check,
  never a data source for the trades.

EVENT TIMING (the "reaction day" = first session that can react)
- announcement time < 09:30 ET  -> BMO: reaction = first session ON/AFTER date
- announcement time >= 16:00 ET -> AMC: reaction = first session AFTER date
- 09:30 <= time < 16:00         -> intraday: reaction = first session on/after
  date (flagged; counted in the log)
- Duplicate yfinance rows for one quarter (two timestamps < 20 days apart)
  keep the row that has a reported EPS, else the earliest.
- Events whose reaction day is before 2021-01-01, or whose H-day exit is not
  yet in the data, are dropped. Timing is verified mechanically (is the
  reaction day the largest |close-to-close| move of days r-1, r, r+1?) and
  by hand on a printed sample.

PRE-REGISTERED CELLS (fixed before any result was looked at; 18 cells)
  signal S in
    CC   sign of the reaction-day close-to-close return  c[r]/c[r-1]-1
    OC   sign of the reaction-day open-to-close return   c[r]/o[r]-1
    SURP sign of yfinance EPS surprise %  (0 / missing -> no trade)
  threshold in
    all  trade every event with a nonzero signal
    terc long if score >= prior 66.7th pct, short if <= prior 33.3rd pct,
         where score = reaction / (60-day prior daily vol) for CC/OC (size
         relative to the stock's own noise) and surprise % for SURP; the
         percentiles are computed over universe events with reaction day
         STRICTLY BEFORE this event's reaction day (min 150 prior events,
         else no trade) — prior-only, no look-ahead.
  hold H in 5 / 10 / 20 trading days.
  Entry = OPEN of r+1 (never the reaction day itself), exit = CLOSE of r+H.
  Cost 2.0 bps/side (daytrade.cost_per_fill) -> 4 bps round trip.

EVALUATION — the project's honest gate
  gate: direction (gross > 0) >= 51% in EVERY fold, avg net bps > 0,
        net-positive in >= 3/4 folds AND the oldest fold, >= 30 trades.
  Folds are time-ordered: 4 quartiles of the event list ordered by reaction
  date. Rules are fixed (no fitting), so "prior-only" is satisfied by the
  prior-only percentile thresholds.
  POOLED (primary for PEAD, which is inherently cross-sectional): all
    tickers' trades in one book, folds = quartiles of the UNIVERSE event
    dates. 18 pooled verdicts.
  PER-TICKER (project preference, reported but structurally handicapped):
    folds = quartiles of that ticker's own events. ~5 years = ~22 events per
    ticker < the 30-trade floor, so a per-ticker PASS is impossible by
    construction; the log reports it anyway plus the breadth (how many
    tickers are net-positive per cell) as the cross-sectional read.
  STRESS (survivor_stress.py rules, pre-registered, applied to every gate
  pass, pooled or per-ticker):
    A shifted folds: same gate on 4 quartiles of the events with the newest
      1/8 dropped (older-shifted, like horizon_validation's -270..-30).
    B jitter: H 5->4,6 / 10->8,12 / 20->15,25; tercile q 0.667 -> 0.60 and
      0.73 (lower 0.40 / 0.27). One parameter at a time, each scored on the
      shifted folds; holds if >= 20 trades, dir >= 51%, net > 0.
    C calendar half-split at the median event date: both halves >= 20
      trades, dir >= 51%, net > 0.
    REAL = A PASS and C holds and every B neighbor holds; SUSPECT = A PASS
    only; else LUCK.
  DIAGNOSTICS (never gate inputs): long vs short side, SPY-excess return
  (sign-adjusted, same entry/exit window), month-clustered t-stat of net
  (earnings-season trades are not independent).

Determinism: no randomness anywhere; cells are evaluated in a multiprocessing
pool (--procs, default 3) whose results are collected with Pool.map (input
order), so output is identical to --procs 1. `--check-serial` runs both and
asserts equality of the result JSON.

Usage (from /opt/Warden/trading):
  ./bin/python webapp/pead_validation.py --fetch          # fill the cache
  ./bin/python webapp/pead_validation.py > logs/pead_validation.log
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import sys
import time
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402

RES = Path("/opt/Warden/trading/.alpha-stack/research/pead")
ALP = Path("/opt/Warden/trading/.alpha-stack/daytrade/alpaca")
ENGINE = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
OTHERS = [
    "AMZN", "GOOGL", "META", "TSLA", "AVGO", "LLY", "UNH", "XOM", "MA", "PG",
    "JNJ", "HD", "COST", "ABBV", "MRK", "PEP", "ADBE", "CRM", "NFLX", "AMD",
    "ORCL", "CSCO", "INTC", "QCOM", "TMO", "ACN", "MCD", "WMT", "DIS", "ABT",
    "DHR", "NKE", "PM", "LIN", "NEE", "BAC", "WFC", "C", "GS", "MS",
    "AXP", "BLK", "SCHW", "UPS", "CAT", "DE", "HON", "GE", "RTX", "LMT",
    "BA", "MMM", "IBM", "INTU", "AMGN", "GILD", "BMY", "PFE", "MDT", "ISRG",
    "SBUX", "LOW", "TGT", "T", "VZ", "CMCSA", "TMUS", "CL", "MO", "MDLZ",
    "COP", "SLB", "EOG", "USB", "PNC", "BK", "SPGI", "MCO", "PYPL", "AMAT",
    "LRCX", "KLAC", "ADI", "NOW", "UBER", "BKNG", "CVS", "CI", "ELV", "DUK",
]
UNIVERSE = ENGINE + OTHERS
PX_START = "2020-06-01"
EVENT_START = date(2021, 1, 1)

COST = daytrade.cost_per_fill(knobs.defaults())   # 2.0 bps per side
MIN_TRADES = 30
MIN_CELL_TRADES = 20
MIN_PRIOR_EVENTS = 150
VOL_WIN = 60
Q_HI, Q_LO = 2 / 3, 1 / 3
HS = (5, 10, 20)
H_JIT = {5: (4, 6), 10: (8, 12), 20: (15, 25)}
Q_JIT = ((0.60, 0.40), (0.73, 0.27))
MAX_H = 25


def emit(rec: dict) -> None:
    print(json.dumps(rec, default=str), flush=True)


# ---------------------------------------------------------------------------
# Fetch / cache (yfinance only)
# ---------------------------------------------------------------------------

def fetch(tickers: list[str]) -> None:
    import yfinance as yf
    RES.mkdir(parents=True, exist_ok=True)
    for t in tickers + ["SPY"]:
        pp, ep = RES / f"px_{t}.pkl", RES / f"earn_{t}.pkl"
        if not pp.exists():
            df = yf.Ticker(t).history(start=PX_START, auto_adjust=True,
                                      actions=False)
            if df is None or df.empty:
                print(f"[fetch] {t}: no prices", file=sys.stderr)
            else:
                df.to_pickle(pp)
            time.sleep(0.5)
        if t != "SPY" and not ep.exists():
            try:
                e = yf.Ticker(t).get_earnings_dates(limit=40)
            except Exception as ex:  # report, never paper over
                print(f"[fetch] {t}: earnings error {ex}", file=sys.stderr)
                e = None
            if e is None or e.empty:
                print(f"[fetch] {t}: no earnings dates", file=sys.stderr)
            else:
                e.to_pickle(ep)
            time.sleep(0.5)
        print(f"[fetch] {t} ok", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def load_px(t: str, last: date) -> pd.DataFrame | None:
    p = RES / f"px_{t}.pkl"
    if not p.exists():
        return None
    df = pd.read_pickle(p)
    df.index = pd.Index([ts.date() for ts in df.index])
    df = df[df.index <= last]
    df = df[(df["Open"] > 0) & (df["Close"] > 0)]
    return df[["Open", "Close"]].astype(float)


def load_earn(t: str) -> list[dict]:
    p = RES / f"earn_{t}.pkl"
    if not p.exists():
        return []
    e = pd.read_pickle(p)
    rows = []
    for ts, r in e.iterrows():
        ts = pd.Timestamp(ts)
        ts = ts.tz_convert("America/New_York") if ts.tzinfo else \
            ts.tz_localize("America/New_York")
        surp = r.get("Surprise(%)")
        rep = r.get("Reported EPS")
        rows.append({"ts": ts, "surp": None if pd.isna(surp) else float(surp),
                     "has_rep": not pd.isna(rep)})
    rows.sort(key=lambda x: x["ts"])
    out: list[dict] = []
    for r in rows:                       # de-duplicate one quarter's rows
        if out and (r["ts"] - out[-1]["ts"]).days < 20:
            if r["has_rep"] and not out[-1]["has_rep"]:
                out[-1] = r
            continue
        out.append(r)
    return out


def build_events(last: date) -> tuple[list[dict], dict, dict]:
    spy = load_px("SPY", last)
    spy_o = spy["Open"].to_dict()
    spy_c = spy["Close"].to_dict()
    events, stats = [], {"timing": {"BMO": 0, "AMC": 0, "intraday": 0},
                         "no_px": [], "no_earn": [], "timing_check": [0, 0]}
    samples = []
    for t in UNIVERSE:
        px = load_px(t, last)
        er = load_earn(t)
        if px is None or len(px) < VOL_WIN + 5:
            stats["no_px"].append(t)
            continue
        if not er:
            stats["no_earn"].append(t)
            continue
        days = list(px.index)
        o, c = px["Open"].to_numpy(), px["Close"].to_numpy()
        lr = np.full(len(c), np.nan)
        lr[1:] = np.log(c[1:] / c[:-1])
        dix = pd.Index(days)
        for r_ in er:
            ts = r_["ts"]
            d = ts.date()
            hm = ts.hour * 60 + ts.minute
            if hm < 9 * 60 + 30:
                kind, r = "BMO", int(dix.searchsorted(d, side="left"))
            elif hm >= 16 * 60:
                kind, r = "AMC", int(dix.searchsorted(d, side="right"))
            else:
                kind, r = "intraday", int(dix.searchsorted(d, side="left"))
            if r >= len(days) or r < VOL_WIN + 1:
                continue
            if days[r] < EVENT_START:
                continue
            if (days[r] - d).days > 5:        # gap in data, not a reaction day
                continue
            if r + 1 >= len(days):            # can't even enter yet
                continue
            stats["timing"][kind] += 1
            vol = float(np.std(lr[r - VOL_WIN:r]))
            cc = c[r] / c[r - 1] - 1
            oc = c[r] / o[r] - 1
            ev = {"t": t, "ann": str(ts), "kind": kind, "rday": days[r],
                  "cc": cc, "oc": oc, "vol": vol,
                  "z_cc": cc / vol if vol > 0 else np.nan,
                  "z_oc": oc / vol if vol > 0 else np.nan,
                  "surp": r_["surp"], "entry_day": days[r + 1],
                  "legs": {}}
            if r + 1 < len(c) - 0 and r - 1 >= 1:
                prev_ = abs(c[r - 1] / c[r - 2] - 1)
                next_ = abs(c[r + 1] / c[r] - 1)
                stats["timing_check"][1] += 1
                stats["timing_check"][0] += int(abs(cc) >= max(prev_, next_))
            for H in sorted(set(HS) | {h for v in H_JIT.values() for h in v}):
                if r + H < len(c):
                    e_, x_ = o[r + 1], c[r + H]
                    so, sc = spy_o.get(days[r + 1]), spy_c.get(days[r + H])
                    ev["legs"][H] = (e_, x_, days[r + H],
                                     (sc / so - 1) if so and sc else np.nan)
            events.append(ev)
            if t in ("AAPL", "NVDA", "JPM", "KO", "CVX") and len(samples) < 60:
                samples.append({"t": t, "ann": str(ts), "kind": kind,
                                "rday": days[r],
                                "ret_r-1": round(100 * (c[r - 1] / c[r - 2] - 1), 2),
                                "ret_r": round(100 * cc, 2),
                                "ret_r+1": round(100 * (c[r + 1] / c[r] - 1), 2)})
    events.sort(key=lambda e: (e["rday"], e["t"]))
    return events, stats, samples


def add_thresholds(events: list[dict]) -> None:
    """Prior-only universe percentiles of each score (strictly earlier rday)."""
    qs = sorted({Q_HI, Q_LO} | {q for pair in Q_JIT for q in pair})
    for key in ("z_cc", "z_oc", "surp"):
        vals = np.array([np.nan if e[key] is None else e[key] for e in events],
                        dtype=float)
        rdays = [e["rday"] for e in events]
        i = 0
        while i < len(events):
            j = i
            while j < len(events) and rdays[j] == rdays[i]:
                j += 1
            prior = vals[:i]
            prior = prior[~np.isnan(prior)]
            th = ({q: float(np.quantile(prior, q)) for q in qs}
                  if len(prior) >= MIN_PRIOR_EVENTS else None)
            for k in range(i, j):
                events[k].setdefault("th", {})[key] = th
            i = j


# ---------------------------------------------------------------------------
# Cells, trades, gate
# ---------------------------------------------------------------------------

SIG_KEY = {"CC": "z_cc", "OC": "z_oc", "SURP": "surp"}


def cells() -> list[dict]:
    return [{"sig": s, "thr": th, "H": H}
            for s in ("CC", "OC", "SURP") for th in ("all", "terc") for H in HS]


def cell_name(s: dict) -> str:
    base = f"{s['sig']} {s['thr']} H={s['H']}"
    if s["thr"] == "terc" and s.get("q", Q_HI) != Q_HI:
        base += f" q={s['q']:.2f}"
    return base


def jitter(s: dict) -> list[dict]:
    out = [dict(s, H=h) for h in H_JIT[s["H"]]]
    if s["thr"] == "terc":
        out += [dict(s, q=qh, qlo=ql) for qh, ql in Q_JIT]
    return out


def side_of(ev: dict, s: dict) -> int:
    key = SIG_KEY[s["sig"]]
    v = ev[key]
    if v is None or not np.isfinite(v) or v == 0:
        return 0
    if s["thr"] == "all":
        return 1 if v > 0 else -1
    th = ev["th"][key]
    if th is None:
        return 0
    qh, ql = s.get("q", Q_HI), s.get("qlo", Q_LO)
    if v >= th[qh]:
        return 1
    if v <= th[ql]:
        return -1
    return 0


def fill(side: int, entry: float, exit_px: float) -> tuple[float, float]:
    fin = entry * (1 + COST) if side > 0 else entry * (1 - COST)
    fout = exit_px * (1 - COST) if side > 0 else exit_px * (1 + COST)
    return side * (fout / fin - 1) * 1e4, side * (exit_px / entry - 1) * 1e4


def cell_trades(s: dict, evs: list[dict]) -> list[tuple]:
    """(rday, ticker, side, net, gross, spy_excess_bps, exit_day)"""
    out = []
    for ev in evs:
        leg = ev["legs"].get(s["H"])
        if leg is None:
            continue
        sd = side_of(ev, s)
        if not sd:
            continue
        e_, x_, xday, spy = leg
        net, gross = fill(sd, e_, x_)
        exc = sd * ((x_ / e_ - 1) - spy) * 1e4 if np.isfinite(spy) else np.nan
        out.append((ev["rday"], ev["t"], sd, net, gross, exc, xday))
    return out


def quartile_bounds(rdays: list) -> list:
    """3 cut dates splitting the event list (by reaction date) into 4 folds."""
    n = len(rdays)
    return [rdays[(n * k) // 4] for k in (1, 2, 3)]


def fold_of(d, cuts: list, lo=None, hi=None) -> int | None:
    if (lo is not None and d < lo) or (hi is not None and d >= hi):
        return None
    return sum(d >= x for x in cuts)


def gate(trades: list, cuts: list, lo=None, hi=None) -> dict:
    folds = [[] for _ in range(4)]
    for tr in trades:
        k = fold_of(tr[0], cuts, lo, hi)
        if k is not None:
            folds[k].append(tr)
    rows, pos, hits, tot, net_sum, dir_all = [], 0, 0, 0, 0.0, True
    for f in folds:
        n = len(f)
        if n == 0:
            dir_all = False
        fh = sum(1 for tr in f if tr[4] > 0)
        fnet = sum(tr[3] for tr in f)
        if n and 100 * fh / n < 51.0:
            dir_all = False
        rows.append({"trades": n,
                     "dir_pct": round(100 * fh / n, 1) if n else None,
                     "avg_net_bps": round(fnet / n, 1) if n else None,
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
            "avg_net_bps": round(avg, 2), "PASS": bool(ok)}


def summ(trades: list) -> dict:
    n = len(trades)
    if not n:
        return {"trades": 0, "dir_pct": None, "avg_net_bps": None}
    return {"trades": n,
            "dir_pct": round(100 * sum(1 for t in trades if t[4] > 0) / n, 1),
            "avg_net_bps": round(sum(t[3] for t in trades) / n, 2)}


def cell_ok(g: dict) -> bool:
    return (g.get("trades", 0) >= MIN_CELL_TRADES
            and g.get("dir_pct") is not None and g["dir_pct"] >= 51.0
            and g.get("avg_net_bps") is not None and g["avg_net_bps"] > 0)


def diagnostics(trades: list) -> dict:
    lng = [t for t in trades if t[2] > 0]
    sht = [t for t in trades if t[2] < 0]
    exc = np.array([t[5] for t in trades], dtype=float)
    exc = exc[np.isfinite(exc)]
    months: dict[str, list] = {}
    for t in trades:
        months.setdefault(f"{t[0].year}-{t[0].month:02d}", []).append(t[3])
    mm = np.array([np.mean(v) for _, v in sorted(months.items())])
    tstat = (float(mm.mean() / (mm.std(ddof=1) / np.sqrt(len(mm))))
             if len(mm) > 2 and mm.std(ddof=1) > 0 else None)
    return {"long": summ(lng), "short": summ(sht),
            "spy_excess_gross_bps": round(float(exc.mean()), 2) if len(exc) else None,
            "spy_excess_dir_pct": round(100 * float((exc > 0).mean()), 1) if len(exc) else None,
            "months": len(mm),
            "month_clustered_t_net": round(tstat, 2) if tstat is not None else None}


def beta_control(events: list[dict]) -> list[dict]:
    """POST-HOC CONTROL (added after the first run showed SURP-all is ~86%
    long; NOT a gate input, NOT a cell): does the surprise sign add anything
    over blindly going long after every announcement? Same entry/exit/costs.
    Also the long-view SPY-excess by surprise sign and prior-only tercile."""
    fr = scope_frame(events)
    out = []
    for H in HS:
        lng = []
        for e in events:
            leg = e["legs"].get(H)
            if not leg:
                continue
            net, gross = fill(1, leg[0], leg[1])
            exc = ((leg[1] / leg[0] - 1) - leg[3]) * 1e4
            lng.append(((e["rday"], e["t"], 1, net, gross, exc, leg[2]), e))
        g = gate([t for t, _ in lng], fr["cuts"])

        def m(sel):
            xs = [t for t, e in lng if sel(e)]
            return {"n": len(xs),
                    "long_net_bps": round(float(np.mean([x[3] for x in xs])), 1) if xs else None,
                    "long_spy_excess_bps": round(float(np.nanmean([x[5] for x in xs])), 1) if xs else None}
        th = lambda e: e["th"]["surp"]
        out.append({"H": H, "long_every_event_gate": {
                        k: g.get(k) for k in ("trades", "dir_pct", "avg_net_bps",
                                              "pos_folds", "PASS")},
                    "all": m(lambda e: True),
                    "beat": m(lambda e: e["surp"] is not None and e["surp"] > 0),
                    "miss": m(lambda e: e["surp"] is not None and e["surp"] < 0),
                    "surp_top_tercile": m(lambda e: th(e) is not None and e["surp"] is not None and e["surp"] >= th(e)[Q_HI]),
                    "surp_bottom_tercile": m(lambda e: th(e) is not None and e["surp"] is not None and e["surp"] <= th(e)[Q_LO])})
    return out


# ---------------------------------------------------------------------------
# Scope evaluation (runs in the pool)
# ---------------------------------------------------------------------------

_G: dict = {}


def _init(events: list[dict]) -> None:
    _G["events"] = events


def scope_frame(evs: list[dict]) -> dict:
    rd = [e["rday"] for e in evs]
    cuts = quartile_bounds(rd)
    n = len(rd)
    keep = rd[: n - n // 8]                       # newest 1/8 dropped
    s_cuts = quartile_bounds(keep)
    s_hi = rd[n - n // 8] if n // 8 else None
    mid = rd[n // 2]
    return {"cuts": cuts, "s_cuts": s_cuts, "s_hi": s_hi, "mid": mid,
            "span": [str(rd[0]), str(rd[-1])], "n_events": n}


def eval_job(job: tuple) -> dict:
    scope, spec = job
    evs = _G["events"] if scope == "POOLED" else \
        [e for e in _G["events"] if e["t"] == scope]
    if len(evs) < 8:
        return {"scope": scope, "cell": cell_name(spec), "skipped": len(evs)}
    fr = scope_frame(evs)
    tr = cell_trades(spec, evs)
    g = gate(tr, fr["cuts"])
    rec = {"scope": scope, "cell": cell_name(spec), "gate": g}
    if scope == "POOLED":
        rec["diag"] = diagnostics(tr)
    if g["PASS"]:
        g_s = gate(tr, fr["s_cuts"], hi=fr["s_hi"])
        h1 = summ([t for t in tr if t[0] < fr["mid"]])
        h2 = summ([t for t in tr if t[0] >= fr["mid"]])
        jg = {}
        for js in jitter(spec):
            jg[cell_name(js)] = gate(cell_trades(js, evs), fr["s_cuts"],
                                     hi=fr["s_hi"])
        jok = all(cell_ok(v) for v in jg.values())
        hok = cell_ok(h1) and cell_ok(h2)
        v = "REAL" if (g_s["PASS"] and hok and jok) else \
            ("SUSPECT" if g_s["PASS"] else "LUCK")
        rec["stress"] = {"A_shifted": g_s, "C_first_half": h1,
                         "C_second_half": h2, "B_jitter": jg, "verdict": v}
    return rec


def evaluate(events: list[dict], procs: int) -> list[dict]:
    scopes = ["POOLED"] + UNIVERSE
    jobs = [(sc, s) for sc in scopes for s in cells()]
    if procs <= 1:
        _init(events)
        return [eval_job(j) for j in jobs]
    ctx = mp.get_context("fork")
    with ctx.Pool(procs, initializer=_init, initargs=(events,)) as pool:
        return pool.map(eval_job, jobs, chunksize=8)


# ---------------------------------------------------------------------------
# Parity check vs the Alpaca 1-min cache (engine tickers)
# ---------------------------------------------------------------------------

def parity(last: date) -> list[dict]:
    out = []
    for t in ENGINE:
        p = ALP / f"{t}.pkl"
        px = load_px(t, last)
        if not p.exists() or px is None:
            continue
        df = daytrade._session_only(pd.read_pickle(p))
        g = df.groupby(np.array(df.index.date))
        sz = g.size()
        c1 = g["Close"].last()[sz >= 300]
        a = c1.pct_change().dropna()
        b = px["Close"].pct_change().dropna()
        j = a.index.intersection(b.index)
        if len(j) < 20:
            out.append({"ticker": t, "overlap_days": len(j)})
            continue
        d = (a.loc[j] - b.loc[j]).abs() * 1e4
        out.append({"ticker": t, "overlap_days": len(j),
                    "ret_corr": round(float(np.corrcoef(a.loc[j], b.loc[j])[0, 1]), 5),
                    "median_absdiff_bps": round(float(d.median()), 2),
                    "p99_absdiff_bps": round(float(d.quantile(0.99)), 1)})
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--procs", type=int, default=3)
    ap.add_argument("--check-serial", action="store_true")
    ap.add_argument("--asof", default=None, help="YYYY-MM-DD last session")
    a = ap.parse_args()
    if a.fetch:
        fetch(UNIVERSE)
        return
    last = date.fromisoformat(a.asof) if a.asof else daytrade.last_session()
    t0 = time.time()
    events, stats, samples = build_events(last)
    add_thresholds(events)
    emit({"run": "pead_validation", "asof_last_session": last,
          "started": datetime.now().isoformat(timespec="seconds"),
          "universe": len(UNIVERSE), "cells": len(cells()),
          "cost_bps_per_side": COST * 1e4, "events": len(events),
          "tickers_with_events": len({e["t"] for e in events}),
          "event_span": [events[0]["rday"], events[-1]["rday"]],
          "timing_counts": stats["timing"],
          "timing_check_reaction_is_max_abs_move_of_r-1_r_r+1":
              f"{stats['timing_check'][0]}/{stats['timing_check'][1]}",
          "no_px": stats["no_px"], "no_earn": stats["no_earn"],
          "surprise_available": sum(e["surp"] is not None for e in events)})
    per_t = {}
    for e in events:
        per_t[e["t"]] = per_t.get(e["t"], 0) + 1
    emit({"events_per_ticker": per_t})
    for s in samples:
        emit({"timing_sample": s})
    emit({"parity_yf_vs_alpaca_1min": parity(last)})

    res = evaluate(events, a.procs)
    if a.check_serial:
        ser = evaluate(events, 1)
        h1 = hashlib.sha256(json.dumps(res, default=str).encode()).hexdigest()
        h2 = hashlib.sha256(json.dumps(ser, default=str).encode()).hexdigest()
        emit({"determinism_check": {"procs": a.procs, "pool_sha": h1,
                                    "serial_sha": h2, "identical": h1 == h2}})
        assert h1 == h2, "pool and serial results differ"

    pooled = [r for r in res if r["scope"] == "POOLED"]
    for r in pooled:
        emit(r)
    for rec in beta_control(events):
        emit({"POSTHOC_beta_control": rec})
    # per-ticker: full records for gate passes only; breadth summary per cell
    pt = [r for r in res if r["scope"] != "POOLED" and "gate" in r]
    for r in pt:
        if r["gate"]["PASS"]:
            emit(r)
    for s in cells():
        name = cell_name(s)
        rs = [r for r in pt if r["cell"] == name and r["gate"]["trades"]]
        npos = sum(1 for r in rs if r["gate"]["avg_net_bps"] > 0)
        ndir = sum(1 for r in rs if r["gate"]["dir_pct"] >= 51.0)
        emit({"per_ticker_breadth": name, "tickers": len(rs),
              "net_positive": npos, "dir_ge_51": ndir,
              "gate_pass": sum(1 for r in rs if r["gate"]["PASS"]),
              "median_trades": float(np.median([r["gate"]["trades"] for r in rs]))
              if rs else 0,
              "engine": {r["scope"]: [r["gate"]["trades"], r["gate"]["dir_pct"],
                                      r["gate"]["avg_net_bps"]]
                         for r in rs if r["scope"] in ENGINE}})
    pv = {r["cell"]: (r.get("stress", {}).get("verdict") or
                      ("PASS" if r["gate"]["PASS"] else "fail"))
          for r in pooled}
    tv = {f"{r['scope']} {r['cell']}": r.get("stress", {}).get("verdict", "PASS")
          for r in pt if r["gate"]["PASS"]}
    emit({"SUMMARY": {"pooled_gate_pass": sum(r["gate"]["PASS"] for r in pooled),
                      "pooled_cells": len(pooled), "pooled_verdicts": pv,
                      "per_ticker_gate_pass": len(tv), "per_ticker_passes": tv,
                      "elapsed_s": round(time.time() - t0, 1)}})
    emit({"DONE": True})


if __name__ == "__main__":
    main()
