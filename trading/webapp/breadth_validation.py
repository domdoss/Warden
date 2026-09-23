#!/usr/bin/env python3
"""Validate CROSS-TICKER / BREADTH intraday signals (rule-based, no torch, CPU).

Every price-only single-ticker family is binned; the untested family is
cross-ticker / breadth, motivated by market-microstructure intuition that
index and sector leaders move before laggards within the day. Families and
parameter grids are PRE-REGISTERED before any run:

1. INDEX LEAD-LAG: SPY's 1-min return over the last k bars (k = 1, 5, 15),
   z-scored with mean/sd estimated from PRIOR sessions only, beyond +-thr
   fires a trade in an individual name (each of the 10 engine tickers is its
   own cell), direction = SPY's direction, hold 30 bars.
2. PEER LEAD-LAG: same rule with a peer leader: NVDA->MU, AAPL/MSFT leading
   each other, JPM->V, JPM->GEV.
3. BREADTH REGIME: per bar, the fraction of the 10 names above their running
   session VWAP; z-scored per minute-of-day against prior sessions only.
   3a standalone: on a breadth thrust (z > +thr) go long the strongest / the
      weakest session-return name; on a breadth failure (z < -thr) short the
      weakest / the strongest (variants "confirm" / "catchup"). Hold 30 bars.
   3b filter on the BINNED single-name momentum signal (r15 beyond +-1.5
      prior-only sd — the exact binned cell): momentum fires only when
      breadth confirms (long needs breadth >= f, short needs breadth <= 1-f;
      f = 0.6/0.7/0.8). The unfiltered momentum cell is logged as the
      reference the filter must rescue — a filter is only real if the
      COMBINATION passes the full gate.
4. CROSS-SECTIONAL REVERSION: per bar, rank the 10 names by session-return-
   so-far; fade the top name (short) when its spread over the group mean
   exceeds k prior-only std of that minute-of-day's top-spread (k = 2, 2.5,
   3); fade the bottom name (long) on the mirrored condition. Hold 30 bars.

Honest method (momentum_validation / intraday_structure_validation pattern):
- Data: daytrade.fetch_history 1-minute bars (a year of Alpaca SIP when
  configured), restricted to sessions on which ALL 11 tickers have >= 360
  bars. Bars are placed on a fixed 390-minute 09:30-15:59 grid; a missing
  minute forward-fills the last close with volume 0 (a no-trade minute, never
  future data).
- 4 non-overlapping 25-session folds (-100..-75, -75..-50, -50..-25, -25..0
  sessions). EVERY normalization (leader-move mean/sd, momentum sd, breadth
  mean/sd per minute-of-day, cross-sectional spread sd per minute-of-day) is
  computed only from sessions STRICTLY BEFORE the fold's first session.
  Thresholds are fixed a-priori grid values, never picked on scored data.
- One position per cell at a time (the next entry can only come after the
  30-bar hold completes). Entry at the signal bar's close, exit at the close
  exactly 30 bars later (strictly after the feature window), 2.0 bps/side
  (the engine's spread/2 + slippage) charged on both fills.
- PASS = direction >= 51% over ALL fired trades pooled across every fold AND
  avg net bps > 0 after costs AND net positive in >= 3 of 4 folds AND net
  positive on the oldest fold AND >= 30 trades. The unfiltered momentum
  baseline is reference-only (never counted as a family pass).

PRE-REGISTERED perturbation (--stress), run right here on every passing cell
so passes are graded REAL/LUCK immediately:
  A. Shifted folds: the same gate on 4 folds at different offsets
     (-112..-87, -87..-62, -62..-37, -37..-12 sessions), normalizations
     recomputed from each shifted fold's own priors.
  B. Parameter jitter on the shifted folds: z-threshold +-0.25 (and the other
     leader windows k for lead-lag cells), breadth-confirm f +-0.1, reversion
     k-std +-0.2. A real effect degrades gracefully; luck collapses.
  C. Calendar half-split: trades over the FULL stored history generated with
     an expanding prior-only normalization (each session normalized by stats
     from sessions strictly before it, >= 15 priors required), split at the
     calendar midpoint — the first half was never inside the selection
     window.
  Verdict rules (mechanical, stated up front):
  - REAL: shifted-fold gate PASS AND both halves dir >= 51% & net > 0 AND
    every immediate jitter neighbor holds (>= 20 trades to count as holding;
    fewer is inconclusive and cannot confirm).
  - LUCK: shifted-fold gate FAIL.
  - SUSPECT: shifted gate PASS but halves or jitter only partially hold.

Usage: breadth_validation.py [--stress]
Output: JSON lines on stdout (redirect to logs/breadth_validation.log).
"""
from __future__ import annotations

import argparse
import json
import sys

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402
import intraday_structure_validation as base  # noqa: E402  (fill() + cost only)

NAMES = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
INDEX = "SPY"
ALL_TICKERS = NAMES + [INDEX]
PAIRS = [("NVDA", "MU"), ("AAPL", "MSFT"), ("MSFT", "AAPL"), ("JPM", "V"), ("JPM", "GEV")]

K_BARS = (1, 5, 15)          # leader look-back windows (bars)
Z_THR = (1.5, 2.0, 2.5)      # leader / breadth z thresholds
MOM_Z = 1.5                  # the binned momentum cell's own threshold (prior-only sd)
CONFIRM_F = (0.6, 0.7, 0.8)  # breadth-confirm fractions for the momentum filter
XSEC_K = (2.0, 2.5, 3.0)     # cross-sectional reversion k-std grid
HORIZON = 30                 # hold: exit at the close exactly 30 bars after entry
WARM = 15                    # no signal before the 15th bar of a session
GRID = 390                   # 09:30..15:59 minute grid
LAST_ENTRY = GRID - 1 - HORIZON
MIN_TRADES = 30              # gate floor: fewer fired trades can't prove anything
MIN_CELL_TRADES = 20         # below this a jitter/half cell can neither confirm nor kill
PRIOR_MIN = 15               # expanding scheme needs at least this many prior sessions
MIN_SESS_BARS = 360          # a session counts only if every ticker traded >= this many minutes

FOLD_OFFSETS = [(-100, -75), (-75, -50), (-50, -25), (-25, 0)]
SHIFTED_OFFSETS = [(-112, -87), (-87, -62), (-62, -37), (-37, -12)]

# Session grid, filled by build_grid(): rows are sessions, 10 name columns +
# SPY; bars on the fixed 390-minute grid (missing minutes forward-filled).
SESS: list = []
C: np.ndarray = np.zeros(0)     # close  [S, T, 390]
R: np.ndarray = np.zeros(0)     # session return so far (vs the first grid close)
B: np.ndarray = np.zeros(0)     # breadth: fraction of the 10 names above session VWAP
TOP: np.ndarray = np.zeros(0)   # top name's spread over the group mean session return
BOT: np.ndarray = np.zeros(0)   # group-mean minus the bottom name's session return
RK: dict = {}                   # k -> leader log-return over the last k bars [S, T, 390]


def emit(rec: dict) -> None:
    print(json.dumps(rec), flush=True)


# ---------------------------------------------------------------------------
# Data: the aligned cross-ticker grid
# ---------------------------------------------------------------------------

def build_grid() -> None:
    frames = {}
    for t in ALL_TICKERS:
        df = daytrade.fetch_history(t)
        frames[t] = df[np.array(df.index.date) <= daytrade.last_session()]
    # Sessions every ticker traded enough minutes on (torn sessions drop out).
    counts = {t: {} for t in ALL_TICKERS}
    for t, df in frames.items():
        dts = np.array(df.index.date)
        for d in set(dts.tolist()):
            counts[t][d] = int((dts == d).sum())
    common = sorted(set.intersection(*[set(counts[t]) for t in ALL_TICKERS]))
    global SESS
    SESS = [d for d in common
            if all(counts[t].get(d, 0) >= MIN_SESS_BARS for t in ALL_TICKERS)]
    n = len(SESS)
    pos = {d: j for j, d in enumerate(SESS)}
    global C, R, B, TOP, BOT, RK
    C = np.full((n, len(ALL_TICKERS), GRID), np.nan)
    H = np.full_like(C, np.nan)
    L = np.full_like(C, np.nan)
    V = np.full_like(C, np.nan)
    for t_i, t in enumerate(ALL_TICKERS):
        df = frames[t]
        dts = np.array(df.index.date)
        df = df[np.isin(dts, np.array(SESS, dtype=object))]
        rows = np.array([pos[d] for d in df.index.date])
        mins = np.array(df.index.hour * 60 + df.index.minute) - 570
        C[rows, t_i, mins] = df["Close"].to_numpy()
        H[rows, t_i, mins] = df["High"].to_numpy()
        L[rows, t_i, mins] = df["Low"].to_numpy()
        V[rows, t_i, mins] = df["Volume"].to_numpy()
    # Forward-fill missing minutes: a no-trade minute carries the last close
    # (past-only), volume 0 — never information from later bars.
    for s in range(n):
        for t_i in range(len(ALL_TICKERS)):
            for A in (C, H, L):
                A[s, t_i] = pd.Series(A[s, t_i]).ffill().bfill().to_numpy()
    V = np.nan_to_num(V)
    logc = np.log(C)
    # Leader k-bar log returns (NaN before a full window; feature at bar i
    # uses only bars <= i).
    RK = {}
    for k in K_BARS + (15,):
        if k in RK:
            continue
        r = np.full_like(C, np.nan)
        r[:, :, k:] = logc[:, :, k:] - logc[:, :, :GRID - k]
        RK[k] = r
    # Running session VWAP (past-only cumsum within each session).
    tp = (H + L + C) / 3.0
    num = np.cumsum(tp * V, axis=2)
    den = np.maximum(np.cumsum(V, axis=2), 1e-9)
    vwap = num / den
    B = (C[:, :len(NAMES), :] > vwap[:, :len(NAMES), :]).mean(axis=1)
    # Session return so far, and the cross-sectional extremes of it.
    R = C / C[:, :, :1] - 1.0
    rn = R[:, :len(NAMES), :]
    TOP = rn.max(axis=1) - rn.mean(axis=1)
    BOT = rn.mean(axis=1) - rn.min(axis=1)
    emit({"grid": "sessions common to all 11 tickers", "sessions": n,
          "first": str(SESS[0]), "last": str(SESS[-1]),
          "bars_per_session": GRID,
          "note": "missing minutes forward-fill the last close, volume 0"})


# ---------------------------------------------------------------------------
# Folds
# ---------------------------------------------------------------------------

def make_folds(offsets: list) -> tuple:
    """(specs, labels, row->label map). Prior rows are the sessions STRICTLY
    BEFORE the fold's first row — every normalization uses only those."""
    n = len(SESS)
    specs, labels, row_fold = [], [], {}
    for a, b in offsets:
        lo = n + a
        hi = n + b if b <= 0 else b
        rows = list(range(lo, hi))
        prior = list(range(0, lo))          # strictly earlier sessions only
        specs.append((rows, prior))
        lab = f"{a}..{b}"
        labels.append(lab)
        for r in rows:
            row_fold[r] = lab
    return specs, labels, row_fold


def expanding_specs() -> list:
    """One fold per session over the FULL history; each session's priors are
    all sessions strictly before it (>= PRIOR_MIN required). Used only by the
    pre-registered calendar half-split stress test."""
    return [([j], list(range(0, j))) for j in range(PRIOR_MIN, len(SESS))]


# ---------------------------------------------------------------------------
# Trade mechanics
# ---------------------------------------------------------------------------

def _greedy(fired: np.ndarray) -> list:
    """Non-overlapping entries: the next entry can only come after the
    30-bar hold completes (exit and re-entry can share the exit bar)."""
    fired = fired[(fired >= WARM) & (fired <= LAST_ENTRY)]
    out, cur = [], 0
    for i in fired:
        if i >= cur:
            out.append(int(i))
            cur = i + HORIZON
    return out


def _trade(s: int, t: int, i: int, side: str) -> tuple:
    """Entry at the signal bar's close, exit at the close exactly HORIZON
    bars later (strictly after the feature window), 2 bps/side both fills."""
    entry = float(C[s, t, i])
    exit_px = float(C[s, t, i + HORIZON])
    net, gross = base.fill(side, entry, exit_px)
    return (s, side, net, gross)


def gate(trades: list, row_fold: dict, labels: list) -> dict:
    """Score one cell: per-fold breakdown + the honest PASS verdict."""
    folds = {lab: [] for lab in labels}
    for s, _side, net, gross in trades:
        lab = row_fold.get(s)
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
    ok = (tot >= MIN_TRADES and 100 * hits / tot >= 51.0 and avg > 0
          and pos >= 3 and rows[0]["net_bps"] > 0)
    return {"folds": rows, "pos_folds": pos, "trades": tot,
            "dir_pct": round(100 * hits / tot, 1),
            "avg_net_bps": round(avg, 2), "PASS": bool(ok)}


# ---------------------------------------------------------------------------
# Signal generators (each takes fold specs; normalization strictly prior-only)
# ---------------------------------------------------------------------------

def leadlag_trades(lead_idx: int, name_idx: int, k: int, thr: float, specs: list) -> list:
    """Leader's last-k-bar move, z-scored from prior sessions only, beyond
    +-thr -> trade the name in the leader's direction, hold 30 bars."""
    rk = RK[k][:, lead_idx]
    out = []
    for rows, prior in specs:
        vals = rk[prior]                      # strictly earlier sessions only
        sd = float(np.nanstd(vals))
        if not sd > 0:
            continue
        z = (rk - float(np.nanmean(vals))) / sd
        for s in rows:
            zrow = z[s]
            fired = np.flatnonzero((zrow > thr) | (zrow < -thr))
            for i in _greedy(fired):
                out.append(_trade(s, name_idx, i, "long" if zrow[i] > 0 else "short"))
    return out


def breadth_trades(variant: str, thr: float, specs: list) -> list:
    """Breadth z per minute-of-day (prior sessions only): thrust -> long the
    strongest ("confirm") or the weakest ("catchup") session-return name;
    failure -> short the weakest / the strongest. Hold 30 bars."""
    out = []
    for rows, prior in specs:
        p = np.asarray(prior)
        if len(p) < PRIOR_MIN:
            continue
        mB = np.nanmean(B[p], axis=0)          # strictly earlier sessions only
        sB = np.nanstd(B[p], axis=0)
        ok = sB > 0
        for s in rows:
            z = np.where(ok, (B[s] - mB) / np.where(ok, sB, 1.0), 0.0)
            fired = np.flatnonzero((z > thr) | (z < -thr))
            for i in _greedy(fired):
                rets = R[s, :len(NAMES), i]
                top, bot = int(np.argmax(rets)), int(np.argmin(rets))
                if variant == "confirm":
                    t, side = (top, "long") if z[i] > 0 else (bot, "short")
                else:  # catchup: laggards follow the thrust; leaders revert on failure
                    t, side = (bot, "long") if z[i] > 0 else (top, "short")
                out.append(_trade(s, t, i, side))
    return out


def momentum_trades(name_idx: int, confirm: float | None, specs: list) -> list:
    """The binned momentum cell (r15 beyond +-1.5 prior-only sd, hold 30),
    optionally gated by breadth confirmation (confirm=None is the baseline)."""
    r15 = RK[15][:, name_idx]
    out = []
    for rows, prior in specs:
        vals = r15[prior]                      # strictly earlier sessions only
        sd = float(np.nanstd(vals))
        if not sd > 0:
            continue
        z = (r15 - float(np.nanmean(vals))) / sd
        for s in rows:
            zrow = z[s]
            fired = np.flatnonzero((zrow > MOM_Z) | (zrow < -MOM_Z))
            for i in _greedy(fired):
                long = zrow[i] > 0
                if confirm is not None:
                    if long and B[s, i] < confirm:
                        continue
                    if not long and B[s, i] > 1.0 - confirm:
                        continue
                out.append(_trade(s, name_idx, i, "long" if long else "short"))
    return out


def xsec_trades(kstd: float, specs: list) -> list:
    """Fade the top name (short) when its spread over the group mean exceeds
    kstd prior-only std of that minute-of-day's top-spread; mirrored for the
    bottom name (long). Hold 30 bars."""
    out = []
    for rows, prior in specs:
        p = np.asarray(prior)
        if len(p) < PRIOR_MIN:
            continue
        mT, sT = np.nanmean(TOP[p], axis=0), np.nanstd(TOP[p], axis=0)
        mBt, sBt = np.nanmean(BOT[p], axis=0), np.nanstd(BOT[p], axis=0)
        okT, okB = sT > 0, sBt > 0
        for s in rows:
            zt = np.where(okT, (TOP[s] - mT) / np.where(okT, sT, 1.0), 0.0)
            zb = np.where(okB, (BOT[s] - mBt) / np.where(okB, sBt, 1.0), 0.0)
            fire_top, fire_bot = zt > kstd, zb > kstd
            fired = np.flatnonzero(fire_top | fire_bot)
            for i in _greedy(fired):
                rets = R[s, :len(NAMES), i]
                if fire_top[i]:
                    out.append(_trade(s, int(np.argmax(rets)), i, "short"))
                elif fire_bot[i]:
                    out.append(_trade(s, int(np.argmin(rets)), i, "long"))
    return out


def gen(cell: dict, specs: list) -> list:
    fam = cell["family"]
    if fam == "index":
        return leadlag_trades(len(NAMES), cell["name_idx"], cell["k"], cell["thr"], specs)
    if fam == "peer":
        return leadlag_trades(cell["lead_idx"], cell["name_idx"], cell["k"], cell["thr"], specs)
    if fam == "breadth":
        return breadth_trades(cell["variant"], cell["thr"], specs)
    if fam == "momfilter":
        return momentum_trades(cell["name_idx"], cell["confirm"], specs)
    if fam == "mombase":
        return momentum_trades(cell["name_idx"], None, specs)
    if fam == "xsec":
        return xsec_trades(cell["kstd"], specs)
    raise ValueError(fam)


# ---------------------------------------------------------------------------
# Cells
# ---------------------------------------------------------------------------

def all_cells() -> list:
    out = []
    for nt, name in enumerate(NAMES):
        for k in K_BARS:
            for thr in Z_THR:
                out.append({"family": "index", "name_idx": nt, "k": k, "thr": thr})
    for lead, lag in PAIRS:
        for k in K_BARS:
            for thr in Z_THR:
                out.append({"family": "peer", "lead": lead, "lag": lag,
                            "lead_idx": NAMES.index(lead), "name_idx": NAMES.index(lag),
                            "k": k, "thr": thr})
    for variant in ("confirm", "catchup"):
        for thr in Z_THR:
            out.append({"family": "breadth", "variant": variant, "thr": thr})
    for nt, name in enumerate(NAMES):
        out.append({"family": "mombase", "name": name, "name_idx": nt})
        for f in CONFIRM_F:
            out.append({"family": "momfilter", "name": name, "name_idx": nt, "confirm": f})
    for kstd in XSEC_K:
        out.append({"family": "xsec", "kstd": kstd})
    return out


def cell_name(c: dict) -> str:
    f = c["family"]
    if f == "index":
        return f"index SPY->{NAMES[c['name_idx']]} k={c['k']} z={c['thr']}"
    if f == "peer":
        return f"peer {c['lead']}->{c['lag']} k={c['k']} z={c['thr']}"
    if f == "breadth":
        return f"breadth-{c['variant']} z={c['thr']}"
    if f == "momfilter":
        return f"mom+breadth {c['name']} f={c['confirm']}"
    if f == "mombase":
        return f"mom-base {c['name']}"
    if f == "xsec":
        return f"xsec-revert k={c['kstd']}"
    raise ValueError(f)


def cell_params(c: dict) -> dict:
    f = c["family"]
    if f in ("index", "peer"):
        return {"k_bars": c["k"], "z_thr": c["thr"]}
    if f == "breadth":
        return {"variant": c["variant"], "z_thr": c["thr"]}
    if f == "momfilter":
        return {"confirm_f": c["confirm"], "mom_z": MOM_Z}
    if f == "mombase":
        return {"mom_z": MOM_Z}
    if f == "xsec":
        return {"k_std": c["kstd"]}
    raise ValueError(f)


# ---------------------------------------------------------------------------
# Pre-registered stress (perturbation) for passing cells
# ---------------------------------------------------------------------------

def jitter_cells(cell: dict) -> list:
    """Immediate parameter neighbors of a passing cell (fixed a priori)."""
    f = cell["family"]
    if f in ("index", "peer"):
        out = [{**cell, "thr": round(cell["thr"] + d, 2)} for d in (-0.25, 0.25)]
        out += [{**cell, "k": k} for k in K_BARS if k != cell["k"]]
        return out
    if f == "breadth":
        return [{**cell, "thr": round(cell["thr"] + d, 2)} for d in (-0.25, 0.25)]
    if f == "momfilter":
        return [{**cell, "confirm": round(cell["confirm"] + d, 2)} for d in (-0.1, 0.1)]
    if f == "xsec":
        return [{**cell, "kstd": round(cell["kstd"] + d, 2)} for d in (-0.2, 0.2)]
    return []


def cell_ok(g: dict) -> bool:
    """A sub-cell counts as holding if it has enough trades to judge and holds."""
    return (g["trades"] >= MIN_CELL_TRADES and g["dir_pct"] is not None
            and g["dir_pct"] >= 51.0 and g["avg_net_bps"] is not None
            and g["avg_net_bps"] > 0)


def halves(trades: list) -> dict:
    """dir + avg net on the first vs second calendar half of the FULL history."""
    mid = len(SESS) // 2
    out = {}
    for name, sel in (("first_half", lambda s: s < mid),
                      ("second_half", lambda s: s >= mid)):
        f = [(net, gross) for s, _side, net, gross in trades if sel(s)]
        n = len(f)
        out[name] = {"trades": n,
                     "dir_pct": round(100 * sum(1 for _, g in f if g > 0) / n, 1) if n else None,
                     "avg_net_bps": round(sum(net for net, _ in f) / n, 2) if n else None}
    return out


def halves_ok(h: dict) -> bool:
    return cell_ok(h["first_half"]) and cell_ok(h["second_half"])


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


def stress_cell(cell: dict, shift: tuple) -> dict:
    """Pre-registered A/B/C perturbation of one passing cell -> REAL/LUCK/SUSPECT."""
    specs_s, labels_s, row_fold_s = shift
    cand = cell_name(cell)
    g_s = gate(gen(cell, specs_s), row_fold_s, labels_s)
    emit({"candidate": cand, "test": "A_shifted_folds", "gate": g_s})
    h = halves(gen(cell, expanding_specs()))
    emit({"candidate": cand, "test": "C_half_split_expanding_prior", **h})
    jg = []
    for jc in jitter_cells(cell):
        g = gate(gen(jc, specs_s), row_fold_s, labels_s)
        emit({"candidate": cand, "test": "B_jitter", "params": cell_params(jc),
              "jitter": jitter_name(jc), "gate": g})
        jg.append((jitter_name(jc), g))
    jok = all(cell_ok(g) for _, g in jg)
    hok = halves_ok(h)
    v = "REAL" if (g_s["PASS"] and hok and jok) else ("SUSPECT" if g_s["PASS"] else "LUCK")
    return {"candidate": cand, "verdict": v,
            "evidence": (f"shifted: {fmt_gate(g_s)}; halves: first "
                         f"{fmt_half(h['first_half'])}, second {fmt_half(h['second_half'])}; "
                         "jitter " + ", ".join(f"{nm}: {fmt_gate(g)}" for nm, g in jg))}


def jitter_name(c: dict) -> str:
    f = c["family"]
    if f in ("index", "peer", "breadth"):
        return f"z={c['thr']}" + (f" k={c['k']}" if f in ("index", "peer") else "")
    if f == "momfilter":
        return f"f={c['confirm']}"
    if f == "xsec":
        return f"k={c['kstd']}"
    return "?"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Cross-ticker/breadth intraday signal hunt")
    ap.add_argument("--stress", action="store_true",
                    help="perturb every passing cell (shifted folds + jitter "
                         "+ calendar half-split) and grade it REAL/LUCK/SUSPECT")
    args = ap.parse_args()

    emit({"hunt": "cross-ticker / breadth (rule-based, no torch, CPU)",
          "cost_per_side_bps": round(base.COST * 1e4, 2),
          "round_trip_bps": daytrade.round_trip_bps(knobs.defaults()),
          "horizon_bars": HORIZON, "warmup_bars": WARM, "min_trades": MIN_TRADES,
          "folds": [f"{a}..{b}" for a, b in FOLD_OFFSETS],
          "gate": "dir>=51% pooled over ALL fired trades, avg net>0 after cost, "
                  "net>0 in >=3/4 folds AND oldest fold, >=30 trades",
          "stress": ("pre-registered: shifted folds + parameter jitter + calendar "
                     "half-split on every passing cell" if args.stress else "off"),
          "min_cell_trades_for_judgment": MIN_CELL_TRADES})
    build_grid()
    specs, labels, row_fold = make_folds(FOLD_OFFSETS)
    if len(SESS) < 113:
        emit({"error": f"only {len(SESS)} common sessions — need >= 113"})
        print("DONE breadth-validation", flush=True)
        return

    passed, base_ref = [], []
    for cell in all_cells():
        g = gate(gen(cell, specs), row_fold, labels)
        rec = {"cell": cell_name(cell), "params": cell_params(cell), **g}
        if cell["family"] == "mombase":
            rec["reference_only"] = True
            emit(rec)
            base_ref.append((cell_name(cell), g))
            continue
        emit(rec)
        if g["PASS"]:
            passed.append(cell)
    emit({"PASS_cells": [cell_name(c) for c in passed],
          "reference_momentum_baselines": {n: {"trades": g["trades"],
                                              "dir_pct": g["dir_pct"],
                                              "avg_net_bps": g["avg_net_bps"],
                                              "PASS": g["PASS"]} for n, g in base_ref}})

    finals = []
    if args.stress:
        shift = make_folds(SHIFTED_OFFSETS)
        for cell in passed:
            v = stress_cell(cell, shift)
            emit({"FINAL": True, **v})
            finals.append(v)
    if passed:
        if args.stress:
            emit({"VERDICT": "; ".join(f"{v['candidate']}={v['verdict']}" for v in finals)})
        else:
            emit({"VERDICT": f"{len(passed)} cell(s) passed the honest gate; "
                             "run with --stress to grade them REAL/LUCK"})
    else:
        emit({"VERDICT": "NO cell passed the honest gate — no cross-ticker/breadth "
                         "edge survives dir>=51% + net>0 + >=3/4 folds + oldest fold "
                         "+ >=30 trades"})
    print("DONE breadth-validation", flush=True)


if __name__ == "__main__":
    main()