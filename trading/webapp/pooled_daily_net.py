#!/usr/bin/env python3
"""Pooled DAILY-horizon CfC liquid net across ~106 US stocks (engine 10 + the
reversion_replication universe's single names). A DIFFERENT question from the
binned 1-minute CfC nets: daily bars, H = 1/3/5 day holds.

PRE-REGISTERED (written before any result; emitted as the first log line):

Hypothesis: one CfC (ncps.torch) trained on pooled, scale-free, a-priori daily
features predicts the next-H-day return out of sample with enough edge to beat
2 bps/side.

Data: yfinance auto_adjust daily CSVs in .alpha-stack/research/daily/{T}.csv
(written by reversion_replication.py, start 2021-09-01). Read-only reuse;
a missing file is downloaded in the same format (atomic, never overwrites).
Completed sessions only (daytrade.last_session). Calendar = SPY's dates.

Features (per ticker-day, all known at the close of day i): log returns over
1/5/20/60 sessions, 20-day realized vol, distance from the 252-session close
high and low, volume z-score (log volume vs the PRIOR 20 sessions), the
ticker's sector ETF 1-day log return, SPY 1-day log return, day-of-week
one-hot. Continuous features standardized with training-span statistics
only (clip +-5). Sequence = last 60 sessions.

Target: log(close[i+H] / open[i+1]) / (vol20_i * sqrt(H)), clipped +-4 —
the tradeable return (signal at close i, entry next open, exit close i+H,
exactly horizon_validation.cell_trades' convention).

Model: CfC(15 -> 32 units, default mode) -> Linear(1). Adam 1e-3, batch 512,
MSE, grad clip 1.0, <= 40 epochs, early stop patience 5 on an in-span
holdout = the LAST 60 signal days of the training span (purged by H on both
sides: train labels end before holdout signals start, holdout labels end
before the test fold starts). One net per H. Seeds 0/1/2.

Walk-forward windows (session offsets from the last completed session):
  base     -240..-180, -180..-120, -120..-60, -60..0   (horizon_validation's)
  shifted  -270..-210, -210..-150, -150..-90, -90..-30 (stress A)
  extended -720..-600, -600..-480, -480..-360, -360..-240 (stress C only)
Each window's model is trained on ALL tickers' samples strictly before the
window (expanding).

Trading rule per ticker-day: fire when |pred| > the 80th percentile of |pred|
on that model's holdout; side = sign(pred); hold H; 2 bps/side
(daytrade.cost_per_fill). Every fired day is a trade (horizon_validation
convention; overlapping holds are allowed and counted).

Per-ticker honest gate: horizon_validation.gate (dir >= 51% in EVERY fold,
avg net > 0, >= 3/4 folds net-positive incl. the oldest, >= 30 trades).
Stress on each gate pass: A shifted-window gate PASS; B jitter on the shifted
windows = threshold pct 75 and 85, hold H-1 and H+1 (H=1 -> 2 only), each
must hold (>= 20 trades, dir >= 51%, net > 0); C half-split of the extended
OOS record -720..0 (first -720..-360, second -360..0), both halves must hold.
REAL = A and B and C; SUSPECT = A only; else LUCK. A ticker x H counts as
REAL only if REAL on ALL 3 seeds (sign flips across seeds = noise).

Cross-sectional long-short portfolio (per H, per seed): each signal day,
long the top decile of pred, short the bottom decile, hold H, 2 bps/side per
leg; cohort return = mean net bps over its legs (per $ of gross). Gate at
cohort level: % cohorts gross > 0 >= 51% in every fold, avg net > 0,
>= 3/4 folds positive incl. oldest, >= 30 cohorts. Stress: A shifted
windows, B jitter (top/bottom 5% and 20%, hold H-1/H+1), C half-split.

Baselines on the same folds/tickers: REV k=1.0 H (horizon_validation's cell,
per ticker), buy-and-hold (always long, hold H, per ticker), and for the
portfolio: cross-sectional 5-day reversion deciles and equal-weight long.
Null for per-ticker pass counts: random direction on the same fired days
(100 draws).

VERDICT RULE: hypothesis SUPPORTED only if the portfolio is REAL on all 3
seeds for some H, or at least one ticker x H is REAL on all 3 seeds AND the
mean per-seed gate-pass rate exceeds 2x the random-direction null rate.
Otherwise BINNED.

Usage: bin/python webapp/pooled_daily_net.py [--stage all|data|train|eval]
Resumable: finished jobs are .npz files under
.alpha-stack/research/pooled_daily_net/ and are skipped on relaunch.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from datetime import timedelta
from multiprocessing import get_context
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = Path("/opt/Warden/trading")
DAILY = ROOT / ".alpha-stack/research/daily"
OUT = ROOT / ".alpha-stack/research/pooled_daily_net"
PANEL = OUT / "panel.npz"
RESULT_JSON = ROOT / "logs/pooled_daily_net.json"
START = "2021-09-01"          # same as reversion_replication (shared cache)

ENGINE = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
SECTOR = {
    # engine
    "AAPL": "XLK", "MSFT": "XLK", "NVDA": "XLK", "MU": "XLK", "TXN": "XLK",
    "V": "XLF", "JPM": "XLF", "GEV": "XLI", "CVX": "XLE", "KO": "XLP",
    # reversion_replication single names
    "GOOGL": "XLC", "AMZN": "XLY", "META": "XLC", "AVGO": "XLK", "TSLA": "XLY",
    "ORCL": "XLK", "CRM": "XLK", "ADBE": "XLK", "AMD": "XLK", "CSCO": "XLK",
    "ACN": "XLK", "IBM": "XLK", "INTU": "XLK", "QCOM": "XLK", "AMAT": "XLK",
    "NOW": "XLK", "LRCX": "XLK", "KLAC": "XLK", "ADI": "XLK", "PANW": "XLK",
    "ANET": "XLK", "INTC": "XLK",
    "NFLX": "XLC", "DIS": "XLC", "CMCSA": "XLC", "T": "XLC", "VZ": "XLC", "TMUS": "XLC",
    "BRK-B": "XLF", "MA": "XLF", "BAC": "XLF", "WFC": "XLF", "GS": "XLF", "MS": "XLF",
    "C": "XLF", "AXP": "XLF", "SCHW": "XLF", "BLK": "XLF", "SPGI": "XLF", "PGR": "XLF",
    "CB": "XLF",
    "LLY": "XLV", "UNH": "XLV", "JNJ": "XLV", "ABBV": "XLV", "MRK": "XLV", "PFE": "XLV",
    "TMO": "XLV", "ABT": "XLV", "DHR": "XLV", "AMGN": "XLV", "ISRG": "XLV", "GILD": "XLV",
    "BMY": "XLV", "VRTX": "XLV", "MDT": "XLV", "SYK": "XLV",
    "HD": "XLY", "MCD": "XLY", "NKE": "XLY", "LOW": "XLY", "SBUX": "XLY", "BKNG": "XLY",
    "TJX": "XLY",
    "PG": "XLP", "PEP": "XLP", "COST": "XLP", "WMT": "XLP", "PM": "XLP", "MO": "XLP",
    "MDLZ": "XLP", "CL": "XLP",
    "XOM": "XLE", "COP": "XLE", "EOG": "XLE", "SLB": "XLE", "OXY": "XLE",
    "CAT": "XLI", "DE": "XLI", "HON": "XLI", "UNP": "XLI", "UPS": "XLI", "BA": "XLI",
    "RTX": "XLI", "LMT": "XLI", "GE": "XLI", "ETN": "XLI",
    "LIN": "XLB", "SHW": "XLB", "FCX": "XLB", "NEM": "XLB",
    "NEE": "XLU", "DUK": "XLU", "SO": "XLU",
    "PLD": "XLRE", "AMT": "XLRE",
}
STOCKS = list(SECTOR)
ETFS = ["SPY"] + sorted(set(SECTOR.values()))

SEQ = 60
HS = (1, 3, 5)
SEEDS = (0, 1, 2)
UNITS = 32
BATCH = 512
MAX_EPOCHS = 40
PATIENCE = 5
HOLDOUT = 60
THR_PCT = 80
JITTER_PCT = (75, 85)
N_CONT = 10                    # continuous features (standardized); + 5 dow
FEATS = ["r1", "r5", "r20", "r60", "vol20", "d52h", "d52l", "volz", "sec_r1",
         "spy_r1", "mon", "tue", "wed", "thu", "fri"]

BASE = [(-240, -180), (-180, -120), (-120, -60), (-60, 0)]
SHIFTED = [(-270, -210), (-210, -150), (-150, -90), (-90, -30)]
EXTENDED = [(-720, -600), (-600, -480), (-480, -360), (-360, -240)]
WINDOWS = BASE + SHIFTED + EXTENDED
WORKERS_PER_GPU = 2


def emit(rec: dict) -> None:
    print(json.dumps(rec, default=str), flush=True)


def wkey(w: tuple) -> str:
    return f"{w[0]}..{w[1]}"


# ---------------------------------------------------------------------------
# Data (CPU pool)
# ---------------------------------------------------------------------------

def _load_csv(t: str) -> tuple[str, pd.DataFrame | None, str]:
    """Read the shared cache; download ONLY if the file is missing (never
    overwrite another agent's file). Returns (ticker, df, source)."""
    import daytrade
    last = daytrade.last_session()
    path = DAILY / f"{t}.csv"
    src = "cache"
    if not path.exists():
        import yfinance as yf
        h = yf.Ticker(t).history(start=START, end=str(last + timedelta(days=1)),
                                 auto_adjust=True, actions=False)
        if h is None or h.empty:
            return t, None, "download-empty"
        h.index = pd.to_datetime([d.date() for d in h.index])
        df = h[["Open", "High", "Low", "Close", "Volume"]]
        tmp = path.with_suffix(".csv.pdn.tmp")
        df.to_csv(tmp)
        if path.exists():                      # someone wrote it meanwhile
            tmp.unlink()
        else:
            os.replace(tmp, path)
        src = "downloaded"
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    df = df[np.array(df.index.date) <= last]
    df = df.dropna(subset=["Open", "Close"])
    df = df[(df["Open"] > 0) & (df["Close"] > 0)]
    return t, (df if not df.empty else None), src


def build_panel() -> dict:
    DAILY.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    with get_context("fork").Pool(8) as pool:
        loaded = pool.map(_load_csv, STOCKS + ETFS)
    frames = {t: df for t, df, _ in loaded if df is not None}
    emit({"stage": "data", "files": {s: sum(1 for _, d, x in loaded if x == s and d is not None)
                                     for s in ("cache", "downloaded")},
          "missing": [t for t, d, _ in loaded if d is None]})
    cal = frames["SPY"].index
    T = len(cal)
    etf_r1 = {e: np.log(frames[e]["Close"]).diff().reindex(cal).to_numpy()
              for e in ETFS if e in frames}
    stocks = [t for t in STOCKS if t in frames]
    N, F = len(stocks), len(FEATS)
    X = np.full((N, T, F), np.nan, np.float32)
    O = np.full((N, T), np.nan)
    C = np.full((N, T), np.nan)
    dow = np.zeros((T, 5), np.float32)
    dow[np.arange(T), cal.dayofweek.to_numpy().clip(0, 4)] = 1.0
    for n, t in enumerate(stocks):
        df = frames[t]
        c, v = df["Close"], df["Volume"].astype(float)
        lc = np.log(c)
        lr = lc.diff()
        lv = np.log(v + 1.0)
        pm, ps = lv.shift(1).rolling(20).mean(), lv.shift(1).rolling(20).std()
        f = pd.DataFrame({
            "r1": lr, "r5": lc - lc.shift(5), "r20": lc - lc.shift(20),
            "r60": lc - lc.shift(60), "vol20": lr.rolling(20).std(),
            "d52h": c / c.rolling(252).max() - 1.0,
            "d52l": c / c.rolling(252).min() - 1.0,
            "volz": (lv - pm) / ps.replace(0, np.nan)}).reindex(cal)
        X[n, :, :8] = f.to_numpy(np.float32)
        X[n, :, 8] = etf_r1[SECTOR[t]]
        X[n, :, 9] = etf_r1["SPY"]
        X[n, :, 10:] = dow
        O[n] = df["Open"].reindex(cal).to_numpy()
        C[n] = df["Close"].reindex(cal).to_numpy()
    X[~np.isfinite(X)] = np.nan
    np.savez(PANEL, X=X, O=O, C=C, days=np.array([str(d.date()) for d in cal]),
             stocks=np.array(stocks))
    emit({"stage": "data", "tickers": N, "sessions": T, "first": str(cal[0].date()),
          "last": str(cal[-1].date()), "features": FEATS,
          "engine_present": [t for t in ENGINE if t in stocks]})
    return load_panel()


def load_panel() -> dict:
    z = np.load(PANEL, allow_pickle=False)
    return {k: z[k] for k in z.files}


def labels(O: np.ndarray, C: np.ndarray, H: int) -> np.ndarray:
    """Tradeable log return: entry open i+1, exit close i+H."""
    N, T = O.shape
    y = np.full((N, T), np.nan)
    y[:, :T - H] = np.log(C[:, H:] / O[:, 1:T - H + 1])
    return y


def window_ok(X: np.ndarray) -> np.ndarray:
    """ok[n, i] = the SEQ-row window ending at i is fully finite."""
    row = np.isfinite(X).all(axis=2).astype(np.int32)
    cs = np.concatenate([np.zeros((row.shape[0], 1), np.int32), np.cumsum(row, 1)], 1)
    ok = np.zeros(row.shape, bool)
    ok[:, SEQ - 1:] = (cs[:, SEQ:] - cs[:, :-SEQ]) == SEQ
    return ok


# ---------------------------------------------------------------------------
# Training (GPU workers)
# ---------------------------------------------------------------------------

def job_path(w: tuple, H: int, seed: int) -> Path:
    return OUT / f"pred_{w[0]}_{w[1]}_H{H}_s{seed}.npz"


def train_one(P: dict, w: tuple, H: int, seed: int, dev: str) -> dict:
    import torch
    from ncps.torch import CfC

    X, O, C = P["X"], P["O"], P["C"]
    N, T, F = X.shape
    s, e = T + w[0], T + w[1]                  # test signal days [s, e)
    y = labels(O, C, H)
    vol = X[:, :, 4].astype(float)
    yt = np.clip(y / (vol * np.sqrt(H)), -4, 4)
    ok = window_ok(X)
    lab_ok = ok & np.isfinite(yt)
    v0 = s - H - HOLDOUT                        # first holdout signal day
    ii = np.arange(T)[None, :].repeat(N, 0)
    tr = lab_ok & (ii + H < v0)                 # train labels end before holdout
    va = lab_ok & (ii >= v0) & (ii + H < s)     # holdout labels end before test
    te = ok & (ii >= s) & (ii < e)
    # training-span standardization (rows up to the last train signal day)
    last_tr = int(np.nonzero(tr.any(0))[0].max())
    rows = X[:, :last_tr + 1, :N_CONT].reshape(-1, N_CONT)
    mu, sd = np.nanmean(rows, 0), np.nanstd(rows, 0)
    Xs = X.copy()
    Xs[:, :, :N_CONT] = np.clip((X[:, :, :N_CONT] - mu) / sd, -5, 5)
    Xs = np.nan_to_num(Xs, nan=0.0)             # only used inside ok windows

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    Xg = torch.tensor(Xs, dtype=torch.float32, device=dev)
    Yg = torch.tensor(np.nan_to_num(yt), dtype=torch.float32, device=dev)
    offs = torch.arange(-SEQ + 1, 1, device=dev)

    def idx(mask):
        n, i = np.nonzero(mask)
        return (torch.tensor(n, device=dev), torch.tensor(i, device=dev))

    tr_i, va_i, te_i = idx(tr), idx(va), idx(te)

    class Net(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.rnn = CfC(F, UNITS, return_sequences=False, batch_first=True)
            self.head = torch.nn.Linear(UNITS, 1)

        def forward(self, x):
            h, _ = self.rnn(x)
            return self.head(h).squeeze(-1)

    net = Net().to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)

    def gather(n, i):
        return Xg[n[:, None], i[:, None] + offs]

    def predict(ix):
        net.eval()
        out = []
        with torch.no_grad():
            for b in range(0, len(ix[0]), 4096):
                n, i = ix[0][b:b + 4096], ix[1][b:b + 4096]
                out.append(net(gather(n, i)))
        net.train()
        return torch.cat(out) if out else torch.zeros(0, device=dev)

    best, best_state, bad, ep_run = float("inf"), None, 0, 0
    t0 = time.time()
    ntr = len(tr_i[0])
    for ep in range(MAX_EPOCHS):
        perm = torch.tensor(rng.permutation(ntr), device=dev)
        for b in range(0, ntr, BATCH):
            p = perm[b:b + BATCH]
            n, i = tr_i[0][p], tr_i[1][p]
            loss = torch.nn.functional.mse_loss(net(gather(n, i)), Yg[n, i])
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
        vl = float(torch.nn.functional.mse_loss(predict(va_i), Yg[va_i[0], va_i[1]]))
        ep_run = ep + 1
        if vl < best - 1e-5:
            best, bad = vl, 0
            best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
        else:
            bad += 1
            if bad >= PATIENCE:
                break
    net.load_state_dict(best_state)
    pv = predict(va_i).cpu().numpy()
    pt = predict(te_i).cpu().numpy()
    pred = np.full((N, e - s), np.nan, np.float32)
    pred[te_i[0].cpu().numpy(), te_i[1].cpu().numpy() - s] = pt
    thr = {str(q): float(np.percentile(np.abs(pv), q)) for q in (THR_PCT,) + JITTER_PCT}
    yv = yt[va]
    rec = {"window": wkey(w), "H": H, "seed": seed, "device": dev,
           "n_train": int(ntr), "n_holdout": int(len(pv)), "n_test": int(len(pt)),
           "epochs": ep_run, "best_holdout_mse": round(best, 5),
           "holdout_ic_pearson": round(float(np.corrcoef(pv, yv)[0, 1]), 4),
           "thr": thr, "secs": round(time.time() - t0, 1)}
    path = job_path(w, H, seed)
    tmp = path.with_name(path.stem + ".tmp.npz")
    np.savez(tmp, pred=pred, s=s, e=e, meta=json.dumps(rec))
    os.replace(tmp, path)
    return rec


def _worker(dev: str, q) -> None:
    P = load_panel()
    while True:
        try:
            job = q.get(timeout=1)
        except Exception:
            return
        if job is None:
            return
        w, H, seed = job
        if job_path(w, H, seed).exists():
            continue
        try:
            emit({"job_done": train_one(P, w, H, seed, dev)})
        except Exception as ex:                  # report, never silently drop
            emit({"job_error": {"window": wkey(w), "H": H, "seed": seed,
                                "device": dev, "error": repr(ex)}})


def gpu_sampler(stop: threading.Event) -> None:
    peak = {}
    while not stop.wait(60):
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=index,memory.used,utilization.gpu",
                 "--format=csv,noheader,nounits"], capture_output=True, text=True,
                timeout=10).stdout.strip().splitlines()
            rows = [dict(zip(("gpu", "mem_mib", "util_pct"),
                             map(int, r.split(", ")))) for r in out]
            for r in rows:
                pk = peak.setdefault(r["gpu"], {"mem_mib": 0, "util_pct": 0})
                pk["mem_mib"] = max(pk["mem_mib"], r["mem_mib"])
                pk["util_pct"] = max(pk["util_pct"], r["util_pct"])
            emit({"gpu_sample": rows, "peak": peak})
        except Exception as ex:
            emit({"gpu_sample_error": repr(ex)})


def train_all() -> None:
    import torch
    ngpu = torch.cuda.device_count()
    jobs = [(w, H, s) for w in WINDOWS for H in HS for s in SEEDS
            if not job_path(w, H, s).exists()]
    emit({"stage": "train", "gpus": ngpu, "workers": ngpu * WORKERS_PER_GPU,
          "jobs_pending": len(jobs), "jobs_total": len(WINDOWS) * len(HS) * len(SEEDS)})
    if not jobs:
        return
    ctx = get_context("spawn")
    q = ctx.Queue()
    for j in jobs:
        q.put(j)
    devs = [f"cuda:{g}" for g in range(ngpu) for _ in range(WORKERS_PER_GPU)] or ["cpu"]
    for _ in devs:
        q.put(None)
    stop = threading.Event()
    th = threading.Thread(target=gpu_sampler, args=(stop,), daemon=True)
    th.start()
    t0 = time.time()
    procs = [ctx.Process(target=_worker, args=(d, q)) for d in devs]
    for p in procs:
        p.start()
    for p in procs:
        p.join()
    stop.set()
    emit({"stage": "train", "wall_secs": round(time.time() - t0, 1),
          "done": sum(job_path(w, H, s).exists() for w in WINDOWS for H in HS for s in SEEDS)})


# ---------------------------------------------------------------------------
# Evaluation (CPU)
# ---------------------------------------------------------------------------

def load_preds(T: int, N: int, windows: list, H: int, seed: int, pct: int):
    """Stitch window predictions into full [N, T] pred + per-day threshold."""
    pred = np.full((N, T), np.nan)
    thr = np.full(T, np.nan)
    metas = []
    for w in windows:
        z = np.load(job_path(w, H, seed))
        s, e = int(z["s"]), int(z["e"])
        meta = json.loads(str(z["meta"]))
        pred[:, s:e] = z["pred"]
        thr[s:e] = meta["thr"][str(pct)]
        metas.append(meta)
    return pred, thr, metas


def trades_for(n: int, fire: np.ndarray, side: np.ndarray, O, C, days, H: int) -> list:
    import horizon_validation as hv
    T = O.shape[1]
    out = []
    for i in np.nonzero(fire)[0]:
        j = i + H
        if j >= T or not (np.isfinite(O[n, i + 1]) and np.isfinite(C[n, j])):
            continue
        sd = "long" if side[i] > 0 else "short"
        net, gross = hv.fill(sd, float(O[n, i + 1]), float(C[n, j]))
        out.append((days[i], sd, net, gross))
    return out


def fold_map(days, windows):
    import horizon_validation as hv
    T = len(days)
    labs = [wkey(w) for w in windows]
    return hv.day_fold_map(days, list(windows), labs), labs


def ok_cell(g: dict) -> bool:
    import horizon_validation as hv
    return hv.cell_ok(g)


def half_stats(trades: list, lo_day, mid_day) -> dict:
    out = {}
    for name, sel in (("first_half", lambda d: lo_day <= d < mid_day),
                      ("second_half", lambda d: d >= mid_day)):
        f = [(net, g) for d, _, net, g in trades if sel(d)]
        n = len(f)
        out[name] = {"trades": n,
                     "dir_pct": round(100 * sum(g > 0 for _, g in f) / n, 1) if n else None,
                     "avg_net_bps": round(sum(x for x, _ in f) / n, 2) if n else None}
    return out


def ticker_eval(P: dict, H: int, seed: int, cache: dict) -> dict:
    """Per-ticker gate on base windows + stress on gate passes."""
    import horizon_validation as hv
    X, O, C = P["X"], P["O"], P["C"]
    stocks = list(P["stocks"])
    days = list(P["days"])
    N, T = O.shape
    fm_b, lab_b = fold_map(days, BASE)
    fm_s, lab_s = fold_map(days, SHIFTED)
    lo_day, mid_day = days[T - 720], days[T - 360]

    def preds(windows, pct):
        k = (tuple(windows), H, seed, pct)
        if k not in cache:
            cache[k] = load_preds(T, N, windows, H, seed, pct)[:2]
        return cache[k]

    pb, tb = preds(BASE, THR_PCT)
    ps, ts = preds(SHIFTED, THR_PCT)
    pe, te_ = preds(EXTENDED + BASE, THR_PCT)
    res = {}
    for n, t in enumerate(stocks):
        fire = np.isfinite(pb[n]) & (np.abs(pb[n]) > tb)
        tr = trades_for(n, fire, np.sign(pb[n]), O, C, days, H)
        g = hv.gate(tr, fm_b, lab_b)
        r = {"gate": g}
        if g["PASS"]:
            fs = np.isfinite(ps[n]) & (np.abs(ps[n]) > ts)
            gs = hv.gate(trades_for(n, fs, np.sign(ps[n]), O, C, days, H), fm_s, lab_s)
            jit = {}
            for q in JITTER_PCT:
                pq, tq = preds(SHIFTED, q)
                fq = np.isfinite(pq[n]) & (np.abs(pq[n]) > tq)
                jit[f"thr_p{q}"] = hv.gate(trades_for(n, fq, np.sign(pq[n]), O, C, days, H),
                                           fm_s, lab_s)
            for h2 in ([2] if H == 1 else [H - 1, H + 1]):
                jit[f"hold_{h2}"] = hv.gate(trades_for(n, fs, np.sign(ps[n]), O, C, days, h2),
                                            fm_s, lab_s)
            fe = np.isfinite(pe[n]) & (np.abs(pe[n]) > te_)
            hs = half_stats(trades_for(n, fe, np.sign(pe[n]), O, C, days, H), lo_day, mid_day)
            jok = all(ok_cell(x) for x in jit.values())
            hok = ok_cell(hs["first_half"]) and ok_cell(hs["second_half"])
            v = "REAL" if (gs["PASS"] and jok and hok) else ("SUSPECT" if gs["PASS"] else "LUCK")
            r.update({"shifted": gs, "jitter": jit, "halves": hs, "verdict": v})
        res[t] = r
    return res


def null_pass_rate(P: dict, H: int, seed: int, cache: dict, draws: int = 100) -> float:
    """Random direction on the model's own fired days (base windows)."""
    import horizon_validation as hv
    O, C = P["O"], P["C"]
    stocks, days = list(P["stocks"]), list(P["days"])
    N, T = O.shape
    fm, labs = fold_map(days, BASE)
    pb, tb = cache[(tuple(BASE), H, seed, THR_PCT)]
    rng = np.random.default_rng(1000 + seed)
    passes = tot = 0
    for n in range(N):
        fire = np.isfinite(pb[n]) & (np.abs(pb[n]) > tb)
        longs = trades_for(n, fire, np.ones(T), O, C, days, H)
        if not longs:
            continue
        shorts = trades_for(n, fire, -np.ones(T), O, C, days, H)   # same days
        for _ in range(draws):
            flip = rng.random(len(longs)) < 0.5
            tr = [s_ if f else l_ for l_, s_, f in zip(longs, shorts, flip)]
            passes += hv.gate(tr, fm, labs)["PASS"]
            tot += 1
    return passes / tot if tot else float("nan")


def baseline_tickers(P: dict, H: int) -> dict:
    """REV k=1.0 H (horizon_validation cell on the yfinance closes) and
    buy-and-hold (always long, hold H) through the same gate."""
    import horizon_validation as hv
    O, C = P["O"], P["C"]
    stocks, days = list(P["stocks"]), list(P["days"])
    N, T = O.shape
    fm, labs = fold_map(days, BASE)
    out = {"REV k=1.0": {}, "buy-hold": {}}
    for n, t in enumerate(stocks):
        m = np.isfinite(C[n]) & np.isfinite(O[n])
        idx = np.nonzero(m)[0]
        d_t = [days[i] for i in idx]
        o_t, c_t = O[n, idx], C[n, idx]
        feats = hv.build_feats(c_t)
        tr = hv.cell_trades({"family": "reversion", "k": 1.0, "H": H}, feats, d_t, o_t, c_t)
        fm_t = hv.day_fold_map(d_t, list(BASE), labs) if len(d_t) >= 240 else {}
        out["REV k=1.0"][t] = hv.gate(tr, fm_t, labs)
        fire = np.zeros(T, bool)
        fire[T - 240:] = True
        out["buy-hold"][t] = hv.gate(trades_for(n, fire, np.ones(T), O, C, days, H), fm, labs)
    return out


def portfolio(P: dict, score: np.ndarray, H: int, frac: float, lo: int, hi: int) -> dict:
    """Daily top/bottom `frac` of `score` (signal days [lo,hi)); cohort net =
    mean net bps over all legs (per $ gross). Returns per-day cohort stats."""
    import horizon_validation as hv
    O, C = P["O"], P["C"]
    days = list(P["days"])
    N, T = O.shape
    rows = []
    for i in range(lo, min(hi, T - H)):
        s = score[:, i]
        ok = np.isfinite(s) & np.isfinite(O[:, i + 1]) & np.isfinite(C[:, i + H])
        k = int(np.floor(ok.sum() * frac))
        if k < 1:
            continue
        idx = np.nonzero(ok)[0]
        order = idx[np.argsort(s[idx])]
        legs = [("short", n) for n in order[:k]] + [("long", n) for n in order[-k:]]
        nets, gros = [], []
        for sd, n in legs:
            a, b = hv.fill(sd, float(O[n, i + 1]), float(C[n, i + H]))
            nets.append(a)
            gros.append(b)
        rows.append((days[i], "cohort", float(np.mean(nets)), float(np.mean(gros))))
    return rows


def ew_long(P: dict, H: int, lo: int, hi: int) -> list:
    import horizon_validation as hv
    O, C = P["O"], P["C"]
    days = list(P["days"])
    N, T = O.shape
    rows = []
    for i in range(lo, min(hi, T - H)):
        ok = np.isfinite(O[:, i + 1]) & np.isfinite(C[:, i + H])
        f = [hv.fill("long", float(O[n, i + 1]), float(C[n, i + H])) for n in np.nonzero(ok)[0]]
        rows.append((days[i], "cohort", float(np.mean([x for x, _ in f])),
                     float(np.mean([g for _, g in f]))))
    return rows


def port_eval(P: dict, score_b, score_s, score_e, H: int, jitter: bool = True) -> dict:
    import horizon_validation as hv
    days = list(P["days"])
    T = len(days)
    fm_b, lab_b = fold_map(days, BASE)
    fm_s, lab_s = fold_map(days, SHIFTED)
    g = hv.gate(portfolio(P, score_b, H, 0.10, T - 240, T), fm_b, lab_b)
    r = {"gate": g}
    gs = hv.gate(portfolio(P, score_s, H, 0.10, T - 270, T - 30), fm_s, lab_s)
    hs = half_stats(portfolio(P, score_e, H, 0.10, T - 720, T), days[T - 720], days[T - 360])
    jit = {}
    if jitter:
        for fr in (0.05, 0.20):
            jit[f"frac_{fr}"] = hv.gate(portfolio(P, score_s, H, fr, T - 270, T - 30), fm_s, lab_s)
        for h2 in ([2] if H == 1 else [H - 1, H + 1]):
            jit[f"hold_{h2}"] = hv.gate(portfolio(P, score_s, h2, 0.10, T - 270, T - 30),
                                        fm_s, lab_s)
    jok = all(ok_cell(x) for x in jit.values())
    hok = ok_cell(hs["first_half"]) and ok_cell(hs["second_half"])
    r.update({"shifted": gs, "halves": hs, "jitter": jit,
              "verdict": ("REAL" if (g["PASS"] and gs["PASS"] and jok and hok)
                          else "SUSPECT" if (g["PASS"] and gs["PASS"])
                          else "LUCK" if g["PASS"] else "FAIL")})
    return r


def daily_ic(P: dict, pred: np.ndarray, H: int, lo: int, hi: int) -> float:
    y = labels(P["O"], P["C"], H)
    ics = []
    for i in range(lo, hi):
        ok = np.isfinite(pred[:, i]) & np.isfinite(y[:, i])
        if ok.sum() >= 20:
            a = pd.Series(pred[ok, i]).rank().to_numpy()
            b = pd.Series(y[ok, i]).rank().to_numpy()
            ics.append(np.corrcoef(a, b)[0, 1])
    return float(np.mean(ics)) if ics else float("nan")


def fmt(g: dict) -> str:
    if not g.get("trades"):
        return "no trades"
    return (f"dir {g['dir_pct']}% avg {g['avg_net_bps']} bps n={g['trades']} "
            f"folds+ {g.get('pos_folds')}/4 PASS={g['PASS']}")


def evaluate() -> None:
    P = load_panel()
    stocks, days = list(P["stocks"]), list(P["days"])
    N, T = P["O"].shape
    cache: dict = {}
    summary = {"per_H": {}}
    for H in HS:
        hsum = {"seeds": {}}
        base_preds = []
        for seed in SEEDS:
            res = ticker_eval(P, H, seed, cache)
            pb, _ = cache[(tuple(BASE), H, seed, THR_PCT)]
            ps, _ = cache[(tuple(SHIFTED), H, seed, THR_PCT)]
            pe, _ = cache[(tuple(EXTENDED + BASE), H, seed, THR_PCT)]
            base_preds.append(pb)
            for t, r in res.items():
                if r["gate"]["PASS"] or t in ENGINE:
                    emit({"H": H, "seed": seed, "ticker": t, "gate": r["gate"],
                          **({k: r[k] for k in ("shifted", "jitter", "halves", "verdict")}
                             if "verdict" in r else {})})
            passes = [t for t, r in res.items() if r["gate"]["PASS"]]
            verdicts = {t: res[t]["verdict"] for t in passes}
            # pooled fired-trade stats over base windows (all tickers)
            allg = [r["gate"] for r in res.values() if r["gate"]["trades"]]
            ntr = sum(g["trades"] for g in allg)
            pooled_net = sum(g["total_net_bps"] for g in allg) / ntr if ntr else None
            pooled_dir = sum(g["dir_pct"] * g["trades"] for g in allg) / ntr if ntr else None
            fold_net = []
            for k in range(4):
                fn = sum(g["folds"][k]["net_bps"] for g in allg)
                fc = sum(g["folds"][k]["trades"] for g in allg)
                fold_net.append(round(fn / fc, 2) if fc else None)
            ics = [round(daily_ic(P, pb, H, T + a, T + b), 4) for a, b in BASE]
            port = port_eval(P, pb, ps, pe, H)
            nullr = null_pass_rate(P, H, seed, cache, draws=100)
            metas = load_preds(T, N, BASE, H, seed, THR_PCT)[2]
            srec = {"H": H, "seed": seed, "tickers": N,
                    "gate_passes": len(passes), "pass_rate": round(len(passes) / N, 4),
                    "null_pass_rate": round(nullr, 4),
                    "engine_passes": [t for t in passes if t in ENGINE],
                    "verdicts": verdicts,
                    "real": sorted(t for t, v in verdicts.items() if v == "REAL"),
                    "pooled_trades": ntr, "pooled_dir_pct": round(pooled_dir, 2) if ntr else None,
                    "pooled_avg_net_bps": round(pooled_net, 2) if ntr else None,
                    "pooled_fold_avg_net_bps": fold_net,
                    "ic_by_fold": ics,
                    "holdout_ic": [m["holdout_ic_pearson"] for m in metas],
                    "epochs": [m["epochs"] for m in metas],
                    "portfolio": port}
            emit({"SEED_SUMMARY": True, **srec})
            hsum["seeds"][seed] = srec
        # seed agreement
        m = np.isfinite(base_preds[0]) & np.isfinite(base_preds[1]) & np.isfinite(base_preds[2])
        cors = [round(float(np.corrcoef(base_preds[a][m], base_preds[b][m])[0, 1]), 3)
                for a, b in ((0, 1), (0, 2), (1, 2))]
        sign_agree = float(np.mean((np.sign(base_preds[0][m]) == np.sign(base_preds[1][m]))
                                   & (np.sign(base_preds[1][m]) == np.sign(base_preds[2][m]))))
        real_all = sorted(set.intersection(*[set(hsum["seeds"][s]["real"]) for s in SEEDS]))
        pass_all = sorted(set.intersection(
            *[set(hsum["seeds"][s]["verdicts"]) for s in SEEDS]))
        # seed-mean ensemble portfolio (secondary, not in the verdict rule)
        ens = [np.nanmean([cache[(tuple(wl), H, s, THR_PCT)][0] for s in SEEDS], 0)
               for wl in (BASE, SHIFTED, EXTENDED + BASE)]
        ens_port = port_eval(P, *ens, H, jitter=False)
        # baselines
        bl = baseline_tickers(P, H)
        bl_sum = {k: {"gate_passes": sorted(t for t, g in v.items() if g["PASS"]),
                      "engine": {t: fmt(v[t]) for t in ENGINE if t in v},
                      "pooled_avg_net_bps": round(
                          sum(g.get("total_net_bps", 0) or 0 for g in v.values())
                          / max(1, sum(g["trades"] for g in v.values())), 2)}
                  for k, v in bl.items()}
        r5 = P["X"][:, :, 1].astype(float)
        xrev = port_eval(P, -r5, -r5, -r5, H, jitter=False)
        fm_b, lab_b = fold_map(days, BASE)
        import horizon_validation as hv
        ewl = hv.gate(ew_long(P, H, T - 240, T), fm_b, lab_b)
        hsum.update({"seed_pred_corr": cors, "seed_sign_agree_all3": round(sign_agree, 3),
                     "real_all_seeds": real_all, "gate_pass_all_seeds": pass_all,
                     "ensemble_portfolio": ens_port, "baselines_ticker": bl_sum,
                     "baseline_xsec_rev5_portfolio": xrev, "baseline_ew_long": ewl})
        emit({"H_SUMMARY": True, "H": H, **{k: v for k, v in hsum.items() if k != "seeds"}})
        summary["per_H"][H] = hsum
    # verdict rule
    supported = []
    for H in HS:
        hs = summary["per_H"][H]
        if all(hs["seeds"][s]["portfolio"]["verdict"] == "REAL" for s in SEEDS):
            supported.append(f"H={H} portfolio REAL on 3/3 seeds")
        mean_rate = np.mean([hs["seeds"][s]["pass_rate"] for s in SEEDS])
        mean_null = np.mean([hs["seeds"][s]["null_pass_rate"] for s in SEEDS])
        if hs["real_all_seeds"] and mean_rate > 2 * mean_null:
            supported.append(f"H={H} tickers REAL on 3/3 seeds {hs['real_all_seeds']} "
                             f"(pass rate {mean_rate:.3f} vs null {mean_null:.3f})")
    summary["VERDICT"] = ("SUPPORTED: " + "; ".join(supported)) if supported else "BINNED"
    emit({"VERDICT": summary["VERDICT"]})
    RESULT_JSON.write_text(json.dumps(summary, default=str, indent=1))
    print("DONE pooled-daily-net", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all", choices=["all", "data", "train", "eval"])
    args = ap.parse_args()
    emit({"validator": "pooled_daily_net", "preregistered": __doc__.split("Usage:")[0].strip()})
    if args.stage in ("all", "data"):
        build_panel()
    if args.stage in ("all", "train"):
        train_all()
    if args.stage in ("all", "eval"):
        evaluate()


if __name__ == "__main__":
    main()
