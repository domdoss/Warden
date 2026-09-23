#!/usr/bin/env python3
"""Validate two DOCUMENTED calendar/session anomalies with the honest gate.

1. Overnight vs intraday decomposition (Cliff-Cooper-Gulen 2008, Kelly-Clark
   2011, Lou-Polk-Skouras 2019): most equity return accrues close->open while
   open->close is ~flat/negative.
2. Turn-of-month (Ariel 1987, Lakonishok-Smidt 1988) and the pre-holiday day
   (Ariel 1990).

PRE-REGISTERED (fixed before the first run; nothing below was tuned):

Data
- 10 engine tickers: cached Alpaca SIP 1-min bars (.alpha-stack/daytrade/alpaca/
  {T}.pkl, adjustment=all, read directly - daytrade.fetch_history slices to 365d).
  Session = 09:30 <= t < close, close 16:00 or 13:00 on NYSE early closes. The
  engine's EARLY_CLOSE set only covers 2026+, so the 2021-2025 early closes are
  listed here (EARLY_CLOSE_PRE) and verified against bar volume in the log.
  Day open = open of the first session bar (09:30 bar = first SIP print, not
  the official auction print); day close = close of the last session bar
  (the 15:59 bar). Sessions with < 30 bars are torn and skipped.
- SPY, QQQ: yfinance daily bars (auto_adjust=True so a dividend does not
  fake an overnight loss), 2000-01-01 .. last completed session, cached to
  .alpha-stack/research/daily/{T}.pkl. No Alpaca calls anywhere.
- Master trading calendar = the SPY yfinance dates (market-wide; a ticker's
  torn day never fakes a holiday). A pre-holiday day is a trading day whose
  next trading day is > 1 weekday later (any weekday closure, incl. unscheduled).
- Costs: daytrade.cost_per_fill = 2.0 bps/side, every trade is one round trip
  (4 bps). Direction = gross return > 0.

Cells per ticker (11 counted + 1 control):
  ON  long                 buy day-i close, sell day-i+1 open
  ON  long | prior ID up   same, fired only if day-i intraday return > 0
  ON  long | prior ID down same, fired only if day-i intraday return < 0
      (engine tickers: conditioner = day-i open -> close of the PENULTIMATE
       session bar, strictly before the entry print; yfinance tickers only
       have the daily close, so it is open->close = MOC approximation)
  ID  long / ID short      buy (sell) day-i open, exit day-i close
  ID  long|up, long|down, short|up, short|down
                           conditioned on day-(i-1) intraday return sign
  TOM long                 hold trading days -1..+3 (entry close of day -2,
                           exit close of the 3rd trading day of the new month)
  PREHOL long              hold the pre-holiday day (entry close of the prior
                           day, exit close of the pre-holiday day)
  CTRL C2C long            close->close every day: the drift control, reported
                           but NOT counted (a long cell that only matches this
                           is beta, not an anomaly)

Folds (prior-only by construction - no parameter is ever fitted)
- Daily cells (ON/ID/CTRL): horizon_validation folds, last 240 sessions in
  4x60; shifted folds -270..-30.
- Event cells (TOM/PREHOL fire ~12 and ~9 times a year, so 4x60 sessions
  cannot reach 30 trades): q = sessions//5, folds = last 4 blocks of q,
  shifted folds = same blocks moved back q//2.
- Gate (horizon_validation.gate, per ticker, NEVER pooled): dir >= 51% in
  EVERY fold (a silent fold fails), avg net > 0, >= 3/4 folds net-positive AND
  the oldest fold, >= 30 trades.

Stress (applied to every gate pass; survivor_stress / horizon --stress rules)
  A shifted folds (above) must PASS the gate.
  B jitter neighbours, each must hold (>= 20 trades, dir >= 51%, net > 0) on
    the shifted folds:
      ON unconditioned: entry 15:55 (close of bar -6), exit 09:30; and entry
        16:00, exit 09:35 (open of the 6th session bar).   [engine only]
      ID unconditioned: entry 09:35, exit 16:00; and 09:30 -> 15:55. [engine]
      Conditioned ON/ID: dead-band |conditioner| > 10 bps and > 25 bps (all
        tickers) + the same timing neighbours (engine tickers).
      TOM: windows -2..+3, -1..+2, -1..+4.
      PREHOL: open->close of the pre-holiday day; close(-1) -> close of the
        post-holiday day; close(-2) -> close of the pre-holiday day.
    yfinance tickers have no intraday timing -> unconditioned ON/ID there have
    NO jitter neighbours and are capped at SUSPECT (cannot be REAL).
  C calendar half-split of the FULL history: both halves hold.
  REAL = A & B & C; SUSPECT = A only; else LUCK.

Chance
- Sign-flip null (zero-drift): each cell's trades get i.i.d. random sides
  (exact per-trade long/short net), 500 draws, seed = crc32(ticker|cell).
  Per-cell null pass rate p; expected false passes = sum p over the counted
  cells, and the draw-wise total-pass distribution gives P(>= observed).
  This null has NO drift, so long-only cells can beat it on beta alone: read
  every long pass next to CTRL C2C.

Parallelism: tickers run in a Pool(3); results are collected with the
order-preserving map and emitted serially from the parent, and every random
draw is seeded per cell, so the log is identical to --workers 1.

CPU only, nothing written except the yfinance cache. JSON lines on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
import zlib
from datetime import date, time as dtime, timedelta
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import daytrade  # noqa: E402
import horizon_validation as hv  # noqa: E402  (gate/halves/fill: identical rules)

CACHE = Path("/opt/Warden/trading/.alpha-stack/daytrade/alpaca")
YF_CACHE = Path("/opt/Warden/trading/.alpha-stack/research/daily")
ENGINE = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
YF_TICKERS = ["SPY", "QQQ"]
YF_START = "2000-01-01"

EARLY_CLOSE_PRE = {
    "2021-11-26",
    "2022-11-25",
    "2023-07-03", "2023-11-24",
    "2024-07-03", "2024-11-29", "2024-12-24",
    "2025-07-03", "2025-11-28", "2025-12-24",
}
EARLY_CLOSE = EARLY_CLOSE_PRE | set(daytrade.EARLY_CLOSE)

COST = hv.COST
DEADBANDS = (0.0010, 0.0025)
N_NULL = 500
MIN_SESSION_BARS = 30

DAILY_FOLDS, DAILY_LABELS = hv.FOLD_OFFSETS, hv.FOLD_LABELS
DAILY_SHIFT, DAILY_SHIFT_LABELS = hv.SHIFTED_OFFSETS, hv.SHIFTED_LABELS


def emit(rec: dict) -> None:
    print(json.dumps(rec, default=str), flush=True)


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def yf_daily(t: str, last: date, fetch: bool = True) -> pd.DataFrame:
    """yfinance daily bars. Fetched ONCE (parent) and frozen: yfinance's
    adjusted history drifts by float noise on every download, so a refetch
    would break run-to-run reproducibility. Delete the pkl to refresh."""
    YF_CACHE.mkdir(parents=True, exist_ok=True)
    path = YF_CACHE / f"{t}.pkl"
    if path.exists() or not fetch:
        df = pd.read_pickle(path)
        return df[[d <= last for d in df.index.date]]
    import yfinance as yf
    df = yf.download(t, start=YF_START, end=(last + timedelta(days=1)).isoformat(),
                     auto_adjust=True, progress=False, interval="1d")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    df.to_pickle(path)
    return df[[d <= last for d in df.index.date]]


def load_engine(t: str, last: date) -> dict | None:
    """Per-session prices off the 1-min bars (early closes honoured)."""
    path = CACHE / f"{t}.pkl"
    if not path.exists():
        return None
    df = pd.read_pickle(path)
    idx = df.index
    dts = np.array(idx.date)
    tod = np.array(idx.hour * 60 + idx.minute)
    iso = np.array([d.isoformat() for d in dts])
    close_min = np.where(np.isin(iso, list(EARLY_CLOSE)), 13 * 60, 16 * 60)
    wk = np.array([d.weekday() < 5 for d in dts])
    keep = wk & (tod >= 9 * 60 + 30) & (tod < close_min) & (dts <= last)
    s = df[keep]
    sd = dts[keep]
    o, c, v = (s["Open"].to_numpy(float), s["Close"].to_numpy(float),
               s["Volume"].to_numpy(float))
    bounds = np.flatnonzero(np.r_[True, sd[1:] != sd[:-1], True])
    days, rec = [], {k: [] for k in ("o", "c", "o5", "c_m6", "c_pen", "c_m7", "nb")}
    for a, b in zip(bounds[:-1], bounds[1:]):
        n = b - a
        if n < MIN_SESSION_BARS:
            continue
        days.append(sd[a])
        rec["o"].append(o[a])
        rec["c"].append(c[b - 1])
        rec["o5"].append(o[a + 5])          # 09:35 bar open
        rec["c_m6"].append(c[b - 6])        # close of the 15:54 bar = 15:55
        rec["c_pen"].append(c[b - 2])       # close of the 15:58 bar = 15:59
        rec["c_m7"].append(c[b - 7])        # close of the 15:53 bar = 15:54
        rec["nb"].append(n)
    # early-close verification: share of 09:30-16:00 volume printed 13:00-16:00
    full = wk & (tod >= 9 * 60 + 30) & (tod < 16 * 60) & (dts <= last)
    late = full & (tod >= 13 * 60)
    fd, fv, lv = dts[full], df["Volume"].to_numpy(float)[full], df["Volume"].to_numpy(float)[late]
    tot = pd.Series(fv).groupby(fd).sum()
    lat = pd.Series(lv).groupby(dts[late]).sum().reindex(tot.index).fillna(0.0)
    share = (lat / tot.replace(0, np.nan)).dropna()
    ec_days = [d for d in share.index if d.isoformat() in EARLY_CLOSE]
    reg_med = float(share[[d.isoformat() not in EARLY_CLOSE for d in share.index]].median())
    unlisted = [str(d) for d in share.index
                if d.isoformat() not in EARLY_CLOSE and share[d] < 0.10]
    out = {k: np.asarray(v, float) for k, v in rec.items()}
    out["days"] = days
    out["check"] = {
        "early_close_late_volume_share": {str(d): round(float(share[d]), 3) for d in ec_days},
        "regular_day_median_late_share": round(reg_med, 3),
        "unlisted_days_late_share_lt10pct": unlisted}
    return out


def load_yf(df: pd.DataFrame) -> dict:
    days = list(df.index.date)
    o, c = df["Open"].to_numpy(float), df["Close"].to_numpy(float)
    return {"days": days, "o": o, "c": c, "o5": None, "c_m6": None, "c_pen": None, "c_m7": None,
            "nb": None, "check": {}}


# ---------------------------------------------------------------------------
# Cells
# ---------------------------------------------------------------------------

def counted_cells() -> list[dict]:
    out = [{"fam": "ON", "side": "long", "cond": None}]
    for cond in ("up", "down"):
        out.append({"fam": "ON", "side": "long", "cond": cond})
    for side in ("long", "short"):
        out.append({"fam": "ID", "side": side, "cond": None})
    for side in ("long", "short"):
        for cond in ("up", "down"):
            out.append({"fam": "ID", "side": side, "cond": cond})
    out.append({"fam": "TOM", "a": -1, "b": 3})
    out.append({"fam": "PREHOL", "var": "base"})
    return out


CONTROL = {"fam": "CTRL"}


def cell_name(s: dict) -> str:
    f = s["fam"]
    if f in ("ON", "ID"):
        n = f"{f} {s['side']}"
        if s.get("cond"):
            n += f" | prior ID {s['cond']}"
        if s.get("db"):
            n += f" db>{s['db'] * 1e4:.0f}bps"
        if s.get("timing"):
            n += f" [{s['timing']}]"
        return n
    if f == "TOM":
        return f"TOM {s['a']:+d}..{s['b']:+d}"
    if f == "PREHOL":
        return f"PREHOL {s['var']}"
    return "CTRL C2C long"


def is_event(s: dict) -> bool:
    return s["fam"] in ("TOM", "PREHOL")


def jitter(s: dict, intraday: bool) -> list[dict]:
    f = s["fam"]
    if f == "TOM":
        return [{"fam": "TOM", "a": -2, "b": 3}, {"fam": "TOM", "a": -1, "b": 2},
                {"fam": "TOM", "a": -1, "b": 4}]
    if f == "PREHOL":
        return [{"fam": "PREHOL", "var": v} for v in ("intraday", "thru-post", "two-day")]
    out = []
    if s.get("cond"):
        out += [dict(s, db=db) for db in DEADBANDS]
    if intraday:
        tims = ("in15:55", "out09:35") if f == "ON" else ("in09:35", "out15:55")
        out += [dict(s, timing=t) for t in tims]
    return out


def _trade(days, i, side, entry, exit_px):
    net, gross = hv.fill(side, float(entry), float(exit_px))
    return (days[i], side, net, gross)


def cell_trades(s: dict, P: dict, cal: dict) -> list:
    """(fold-date, side, net, gross) per fired trade; fold date = entry day."""
    days, o, c = P["days"], P["o"], P["c"]
    n, f, out = len(days), s["fam"], []
    if f == "CTRL":
        return [_trade(days, i, "long", c[i], c[i + 1]) for i in range(n - 1)]
    if f in ("ON", "ID"):
        tim = s.get("timing")
        ent = c if f == "ON" else o
        ext = o if f == "ON" else c
        if tim == "in15:55":
            ent = P["c_m6"]
        elif tim == "out09:35":
            ext = P["o5"]
        elif tim == "in09:35":
            ent = P["o5"]
        elif tim == "out15:55":
            ext = P["c_m6"]
        # ON conditioner ends strictly before the entry print
        cond_px = c if P["c_pen"] is None else (P["c_m7"] if tim == "in15:55" else P["c_pen"])
        idr = cond_px / o - 1.0                    # ON conditioner: same day i
        idr_prev = np.r_[np.nan, c[:-1] / o[:-1] - 1.0]   # ID conditioner: day i-1
        cv = idr if f == "ON" else idr_prev
        db = s.get("db", 0.0)
        for i in range(n):
            if f == "ON" and i + 1 >= n:
                break
            if s.get("cond"):
                x = cv[i]
                if np.isnan(x):
                    continue
                if s["cond"] == "up" and not x > db:
                    continue
                if s["cond"] == "down" and not x < -db:
                    continue
            if f == "ON":
                out.append(_trade(days, i, s["side"], ent[i], ext[i + 1]))
            else:
                out.append(_trade(days, i, s["side"], ent[i], ext[i]))
        return out
    # event cells on the master calendar
    pos = {d: k for k, d in enumerate(days)}
    M = cal["days"]
    if f == "TOM":
        for L in cal["month_last"]:
            ie, ix = L + s["a"], L + s["b"]    # day -1 = M[L]: entry close of day a-1
            if ie < 0 or ix >= len(M):
                continue
            de, dx = M[ie], M[ix]
            if de in pos and dx in pos:
                out.append(_trade(days, pos[de], "long", c[pos[de]], c[pos[dx]]))
        return out
    for j in cal["pre_hol"]:
        v = s["var"]
        if v == "base":
            ie, ix, e_open = j - 1, j, False
        elif v == "intraday":
            ie, ix, e_open = j, j, True
        elif v == "thru-post":
            ie, ix, e_open = j - 1, j + 1, False
        else:                                            # two-day
            ie, ix, e_open = j - 2, j, False
        if ie < 0 or ix >= len(M):
            continue
        de, dx = M[ie], M[ix]
        if de in pos and dx in pos:
            px = o[pos[de]] if e_open else c[pos[de]]
            out.append(_trade(days, pos[de], "long", px, c[pos[dx]]))
    return out


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

def build_calendar(master: list) -> dict:
    """TOM anchors (index of each month's last trading day, M[L] is day -1 so
    M[L+1] is day +1) and pre-holiday indices on the master calendar."""
    M = list(master)
    # day -1 = M[L]; day -k = M[L-k+1]; day +k = M[L+k]. Holding days a..b =
    # entry close of the day before day a (M[L+a]), exit close of day b (M[L+b]).
    month_last = [k for k in range(len(M) - 1) if M[k].month != M[k + 1].month]
    pre_hol = []
    for k in range(len(M) - 1):
        gap = np.busday_count(M[k], M[k + 1])         # weekdays in [M[k], M[k+1])
        if gap > 1:
            pre_hol.append(k)
    return {"days": M, "month_last": month_last, "pre_hol": pre_hol}


def event_folds(n: int) -> tuple:
    q = n // 5
    h = q // 2
    offs = [(-4 * q, -3 * q), (-3 * q, -2 * q), (-2 * q, -q), (-q, 0)]
    shf = [(a - h, b - h) for a, b in offs]
    return offs, [f"{a}..{b}" for a, b in offs], shf, [f"{a}..{b}" for a, b in shf]


# ---------------------------------------------------------------------------
# Null
# ---------------------------------------------------------------------------

def null_passes(t: str, name: str, trades: list, day_fold: dict, labels: list) -> np.ndarray:
    """Boolean[N_NULL]: gate pass under i.i.d. random sides (zero drift)."""
    rng = np.random.default_rng(zlib.crc32(f"{t}|{name}".encode()))
    lab_ix = {lab: k for k, lab in enumerate(labels)}
    rows = [(lab_ix[day_fold[d]], side, net, gross) for d, side, net, gross in trades
            if d in day_fold]
    if not rows:
        return np.zeros(N_NULL, bool)
    fk = np.array([r[0] for r in rows])
    # reconstruct exact long/short net+gross for each trade
    gl = np.array([r[3] if r[1] == "long" else -r[3] for r in rows])     # long gross bps
    ret = gl / 1e4
    nl = ((1 + ret) * (1 - COST) / (1 + COST) - 1) * 1e4
    ns = -((1 + ret) * (1 + COST) / (1 - COST) - 1) * 1e4
    flip = rng.random((N_NULL, len(rows))) < 0.5                         # True -> short
    g = np.where(flip, -gl, gl)
    net = np.where(flip, ns, nl)
    F = len(labels)
    ok = np.ones(N_NULL, bool)
    pos = np.zeros(N_NULL, int)
    tot_net = np.zeros(N_NULL)
    oldest_pos = None
    for k in range(F):
        m = fk == k
        nk = int(m.sum())
        if nk == 0:
            return np.zeros(N_NULL, bool)
        hits = (g[:, m] > 0).sum(1)
        fnet = net[:, m].sum(1)
        ok &= 100 * hits / nk >= 51.0
        pos += fnet > 0
        tot_net += fnet
        if k == 0:
            oldest_pos = fnet > 0
    return ok & (len(rows) >= hv.MIN_TRADES) & (tot_net > 0) & (pos >= 3) & oldest_pos


# ---------------------------------------------------------------------------
# Per ticker
# ---------------------------------------------------------------------------

def run_ticker(args: tuple) -> dict:
    t, src, master, last = args
    P = load_engine(t, last) if src == "alpaca-1min" else load_yf(yf_daily(t, last, fetch=False))
    recs = []
    if P is None:
        return {"ticker": t, "recs": [{"ticker": t, "error": "no cached bars"}],
                "summary": None}
    intraday = src == "alpaca-1min"
    days = P["days"]
    n = len(days)
    cal = build_calendar([d for d in master if days[0] <= d <= days[-1]])
    missing = sorted(set(cal["days"]) - set(days))
    extra = sorted(set(days) - set(cal["days"]))
    recs.append({"ticker": t, "source": src, "sessions": n, "first": str(days[0]),
                 "last": str(days[-1]), "master_days_missing": [str(d) for d in missing],
                 "days_not_in_master": [str(d) for d in extra],
                 "tom_events": len(cal["month_last"]), "prehol_events": len(cal["pre_hol"]),
                 **P["check"]})
    d_fold = hv.day_fold_map(days, DAILY_FOLDS, DAILY_LABELS)
    d_shift = hv.day_fold_map(days, DAILY_SHIFT, DAILY_SHIFT_LABELS)
    e_off, e_lab, e_shf, e_shl = event_folds(n)
    e_fold = hv.day_fold_map(days, e_off, e_lab)
    e_shift = hv.day_fold_map(days, e_shf, e_shl)

    def folds_for(s):
        return (e_fold, e_lab, e_shift, e_shl) if is_event(s) else \
            (d_fold, DAILY_LABELS, d_shift, DAILY_SHIFT_LABELS)

    # drift control (not counted)
    ctr = cell_trades(CONTROL, P, cal)
    g = hv.gate(ctr, d_fold, DAILY_LABELS)
    recs.append({"ticker": t, "cell": cell_name(CONTROL), "test": "control",
                 "trades": g["trades"], "dir_pct": g["dir_pct"],
                 "avg_net_bps": g["avg_net_bps"], "folds": g["folds"], "PASS": g["PASS"],
                 "halves": hv.halves(ctr, days)})
    ctrl_pass = g["PASS"]
    passes, verdicts, null_mat = [], {}, []
    for s in counted_cells():
        name = cell_name(s)
        fm, lab, sm, slab = folds_for(s)
        tr = cell_trades(s, P, cal)
        g = hv.gate(tr, fm, lab)
        nullp = null_passes(t, name, tr, fm, lab)
        null_mat.append(nullp)
        allnet = [x[2] for x in tr]
        recs.append({"ticker": t, "cell": name, "test": "gate", "folds_kind":
                     "event" if is_event(s) else "daily", "trades": g["trades"],
                     "dir_pct": g["dir_pct"], "avg_net_bps": g["avg_net_bps"],
                     "folds": g["folds"], "PASS": g["PASS"],
                     "null_pass_rate": round(float(nullp.mean()), 4),
                     "full_history": {"trades": len(tr),
                                      "avg_net_bps": round(float(np.mean(allnet)), 2) if tr else None,
                                      "avg_gross_bps": round(float(np.mean([x[3] for x in tr])), 2) if tr else None}})
        if not g["PASS"]:
            continue
        passes.append(name)
        g_s = hv.gate(tr, sm, slab)
        h = hv.halves(tr, days)
        recs.append({"ticker": t, "cell": name, "test": "A_shifted_folds", "gate": g_s})
        recs.append({"ticker": t, "cell": name, "test": "C_half_split", **h})
        js = jitter(s, intraday)
        jok, jg = bool(js), {}
        for j in js:
            jn = cell_name(j)
            jg[jn] = hv.gate(cell_trades(j, P, cal), sm, slab)
            recs.append({"ticker": t, "cell": name, "test": "B_jitter", "params": jn,
                         "gate": jg[jn]})
            jok = jok and hv.cell_ok(jg[jn])
        hok = hv.cell_ok(h["first_half"]) and hv.cell_ok(h["second_half"])
        v = "REAL" if (g_s["PASS"] and hok and jok) else \
            ("SUSPECT" if g_s["PASS"] else "LUCK")
        verdicts[name] = v
        recs.append({"ticker": t, "STRESS_VERDICT": True, "cell": name, "verdict": v,
                     "jitter_available": bool(js),
                     "evidence": (f"shifted: {hv.fmt_gate(g_s)}; halves: first "
                                  f"{hv.fmt_half(h['first_half'])}, second "
                                  f"{hv.fmt_half(h['second_half'])}; jitter "
                                  + (", ".join(f"{jn}: {hv.fmt_gate(x)}" for jn, x in jg.items())
                                     if jg else "N/A (no intraday bars) -> capped at SUSPECT"))})
    recs.append({"ticker": t, "FINAL": True, "sessions": n,
                 "cells_counted": len(counted_cells()), "gate_passes": passes,
                 "stress": verdicts,
                 "expected_null_passes": round(float(sum(x.mean() for x in null_mat)), 3),
                 "control_C2C_PASS": ctrl_pass})
    return {"ticker": t, "recs": recs, "passes": passes, "verdicts": verdicts,
            "null": np.vstack(null_mat)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    last = daytrade.last_session()
    spy = yf_daily("SPY", last)
    master = list(spy.index.date)
    emit({"validator": "calendar_validation", "protocol": {
        "cost_per_side_bps": round(COST * 1e4, 2), "round_trip_bps": round(2 * COST * 1e4, 2),
        "daily_folds": DAILY_LABELS, "daily_shifted": DAILY_SHIFT_LABELS,
        "event_folds": "last 4 blocks of q=sessions//5, shifted back q//2",
        "gate": ("dir >= 51% in EVERY fold, avg net > 0, >= 3/4 folds positive AND "
                 "oldest, >= 30 trades, no silent fold (horizon_validation.gate)"),
        "cells_counted": [cell_name(s) for s in counted_cells()],
        "control": cell_name(CONTROL), "null": f"sign-flip, {N_NULL} draws, crc32 seeds",
        "deadband_jitter_bps": [d * 1e4 for d in DEADBANDS],
        "early_close_pre2026": sorted(EARLY_CLOSE_PRE),
        "last_session": str(last), "workers": args.workers,
        "pooled_verdict": "never (per-ticker only)"}})
    jobs = []
    for t in ENGINE:
        jobs.append((t, "alpaca-1min", master, last))
    for t in YF_TICKERS:
        yf_daily(t, last)                     # fetch/cache once in the parent
        jobs.append((t, "yfinance-daily", master, last))
    if args.workers > 1:
        with Pool(args.workers) as pool:
            res = pool.map(run_ticker, jobs, chunksize=1)
    else:
        res = [run_ticker(j) for j in jobs]
    for r in res:
        for rec in r["recs"]:
            emit(rec)
    # chance: draw-wise total passes across every counted cell of every ticker
    ok = [r for r in res if "null" in r]
    null_tot = np.vstack([r["null"] for r in ok]).sum(0)
    obs = sum(len(r["passes"]) for r in ok)
    ncells = sum(r["null"].shape[0] for r in ok)
    tally = {}
    for r in ok:
        for v in r["verdicts"].values():
            tally[v] = tally.get(v, 0) + 1
    emit({"SUMMARY": True, "cells_counted": ncells, "gate_passes": obs,
          "expected_null_passes": round(float(null_tot.mean()), 2),
          "null_p95": float(np.percentile(null_tot, 95)),
          "P_null_ge_observed": round(float((null_tot >= obs).mean()), 4),
          "stress_tally": tally,
          "per_ticker": {r["ticker"]: {c: r["verdicts"][c] for c in r["passes"]}
                         for r in ok}})
    print("DONE calendar-validation", flush=True)


if __name__ == "__main__":
    main()
