#!/usr/bin/env python3
"""Pattern-recognition signal hunt: k-NN window matching + years-of-history GBM.

Part A (k-NN window matching, the literal pattern recognizer): per ticker, the
last 60 bars of the 12 baseline daytrade features (z-scored per session by
EXPANDING per-session stats — every statistic is over the session's bars so
far, never a later bar) form a per-window, per-feature standardized matrix;
the k nearest PRIOR windows (euclidean — after per-window standardization
every flattened row has norm sqrt(60*F), so nearest = largest dot product)
predict the forward 30-min return; trade when |mean neighbor label| exceeds
a threshold picked strictly on earlier sessions. A query in session p only
sees windows from sessions <= p-6 (own session + prior 5 excluded —
autocorrelation guard). Neighbor labels are the forward 30-min return AFTER
the neighbor window's last bar, so the similarity search never touches the
query's own future.

Part B (does years of history help?): the better_training GBM feature set
(12 baseline + vwap_dist_real + trade_count_z + avg_trade_size_z, flattened
last-60-bar window, engine-style z-scaling whose mu/sd come from the ARM's
training sessions only), HistGradientBoostingRegressor, trained per fold on
(i) 1 calendar year of prior sessions vs (ii) ALL prior sessions back to the
cache depth — same folds, same gate. The GBM firing bar is the engine's own
cost bar (round-trip bps x edge_mult), a literal, never tuned on a fold.

Honest method (momentum_validation / intraday_structure_validation protocol):
- 4 prior-only folds over the last 100 completed sessions (-100..-75,
  -75..-50, -50..-25, -25..0). The k-NN threshold is the quantile of |signal|
  over the 25 sessions immediately BEFORE the fold — strictly earlier data.
- Direction hit = sign(prediction) vs sign(forward 30-min return) over ALL
  fired bars. Net bps comes from daytrade.simulate with the engine's real
  per-side cost (2.0 bps/side; simulate itself zeroes the USD knobs).
- PASS = dir >= 51% over all fired bars AND avg net bps > 0 AND positive in
  >= 3 of 4 folds AND positive on the oldest fold AND >= 30 trades.
- Per-ticker verdicts only; nothing is pooled across tickers.

--stress runs the pre-registered stress pass: shifted folds (-90..-65,
-65..-40, -40..-15, -15..0), k neighbors jittered around each pre-registered
k (40/50/60, 160/200/250, 400/500/600), threshold quantile 0.70/0.90.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import timedelta

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402
import alpaca_data  # noqa: E402
from numpy.lib.stride_tricks import sliding_window_view  # noqa: E402

TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
H = 30                    # forward horizon (minutes)
WINDOW = 60               # pattern window (bars)
FOLD_OFFSETS = [(-100, -75), (-75, -50), (-50, -25), (-25, 0)]
STRESS_FOLD_OFFSETS = [(-90, -65), (-65, -40), (-40, -15), (-15, 0)]
KS = (50, 200, 500)
KS_STRESS = (40, 50, 60, 160, 200, 250, 400, 500, 600)
Q = 0.80
QS_STRESS = (0.70, 0.80, 0.90)
GUARD = 6                 # neighbor sessions: query session position - 6
MIN_TRADES = 30
DIR_MIN = 51.0

CFG = {**knobs.defaults(), "start_equity": 25000.0, "horizon_min": H}
FIRE_BPS = daytrade.round_trip_bps(CFG) * CFG["edge_mult"]

FOLD_LABELS = [f"{a}..{b}" for a, b in FOLD_OFFSETS]
STRESS_FOLD_LABELS = [f"{a}..{b}" for a, b in STRESS_FOLD_OFFSETS]


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

CACHE_DIR = None          # --cache-dir; default alpaca_data.CACHE_DIR


def load(t: str) -> pd.DataFrame:
    """Session-only 1m bars for ``t``, capped at the last completed session.
    Reads the disk cache directly (no API refetch): a concurrent deep-history
    pull owns the wire, and the scored folds are >= 25 sessions old."""
    path = (CACHE_DIR or alpaca_data.CACHE_DIR) / f"{t}.pkl"
    df = pd.read_pickle(path) if path.exists() else daytrade.fetch_history(t)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df[~df.index.duplicated(keep="last")].sort_index().astype(float)
    return daytrade._session_only(df[np.array(df.index.date) <= daytrade.last_session()])


def fwd_bps(df: pd.DataFrame) -> np.ndarray:
    return daytrade.forward_return(df, H) * 1e4


# ---------------------------------------------------------------------------
# Gate (intraday_structure_validation's honest PASS rule, per ticker)
# ---------------------------------------------------------------------------

def gate(fold_rows: list[dict]) -> dict:
    tot = sum(r["trades"] for r in fold_rows)
    hits = sum(r["dir_hits"] for r in fold_rows)
    fired = sum(r["fired"] for r in fold_rows)
    net_sum = sum(r["net_bps"] for r in fold_rows)
    rows = [{"fold": r["fold"], "trades": r["trades"], "fired": r["fired"],
             "dir_pct": round(100 * r["dir_hits"] / r["fired"], 1) if r["fired"] else None,
             "net_bps": round(r["net_bps"], 1)} for r in fold_rows]
    if not tot or not fired:
        return {"folds": rows, "trades": tot, "dir_pct": None,
                "avg_net_bps": None, "PASS": False}
    avg = net_sum / tot
    ok = (tot >= MIN_TRADES and 100 * hits / fired >= DIR_MIN and avg > 0
          and sum(1 for r in fold_rows if r["net_bps"] > 0) >= 3
          and fold_rows[0]["net_bps"] > 0)
    return {"folds": rows, "trades": tot, "dir_pct": round(100 * hits / fired, 1),
            "avg_net_bps": round(avg, 2), "total_net_bps": round(net_sum, 1),
            "PASS": bool(ok)}


# ---------------------------------------------------------------------------
# Part A: k-NN window matching
# ---------------------------------------------------------------------------

def session_causal_z(F: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> np.ndarray:
    """Per-session EXPANDING z-score: mean/sd of the session's bars SO FAR.
    A feature constant inside the session (sd ~ 0) is 0 — no within-session
    information, and the per-window standardization would guard it anyway."""
    z = np.zeros_like(F)
    for a, b in zip(starts, ends):
        f = F[a:b]
        k = np.arange(1, len(f) + 1)[:, None]
        c = np.cumsum(f, axis=0)
        c2 = np.cumsum(f * f, axis=0)
        mu = c / k
        sd = np.sqrt(np.maximum(c2 / k - mu * mu, 0.0))
        small = sd < 1e-9
        z[a:b] = np.where(small, 0.0, (f - mu) / np.where(small, 1.0, sd))
    return z


def knn_windows(df: pd.DataFrame, starts: np.ndarray, ends: np.ndarray) -> dict:
    """Within-session 60-bar windows, per-window standardized. Rows are time-
    ordered; row r has session position win["sess"][r], ends at df bar
    win["eb"][r] (the query bar itself, window inclusive), and label
    win["y"][r] = forward 30-min return AFTER that bar (NaN if the session
    ends within 30 bars)."""
    F = daytrade.features(df)[daytrade.FEATS].to_numpy(dtype=np.float64)
    z = session_causal_z(F, starts, ends)
    y = fwd_bps(df)
    X, sess, eb, lab = [], [], [], []
    for p, (a, b) in enumerate(zip(starts, ends)):
        g = z[a:b]
        if len(g) < WINDOW:
            continue
        W = sliding_window_view(g, (WINDOW, g.shape[1]))[:, 0]     # (nW, 60, F)
        mu = W.mean(axis=1, keepdims=True)
        sd = W.std(axis=1, keepdims=True)
        X.append(((W - mu) / np.where(sd < 1e-8, 1.0, sd))
                 .reshape(len(W), -1).astype(np.float32))
        sess.append(np.full(len(W), p))
        e = np.arange(a + WINDOW - 1, b)
        eb.append(e)
        lab.append(y[e])
    if not X:
        return {}
    return {"X": np.concatenate(X), "sess": np.concatenate(sess).astype(np.int32),
            "eb": np.concatenate(eb), "y": np.concatenate(lab)}


TOPK_MARGIN = 64          # float32 candidate slack before the exact re-rank
DEVICE = "cpu"            # --device; "cuda:N" moves only the candidate search


def _cand_cpu(Q: np.ndarray, P: np.ndarray, valid: np.ndarray, kc: int) -> np.ndarray:
    """Row-wise kc largest float32 dot products of Q against P (unordered),
    P rows with ``valid`` False masked to -inf (their label is unusable)."""
    B = len(Q)
    bi = np.full((B, kc), -1, dtype=np.int64)
    bv = np.full((B, kc), -np.inf, dtype=np.float32)
    for lo in range(0, len(P), 120_000):
        hi = min(lo + 120_000, len(P))
        G = Q @ P[lo:hi].T                                        # (B, m)
        if not valid[lo:hi].all():
            G[:, ~valid[lo:hi]] = -np.inf
        kk = min(kc, hi - lo)
        idx = np.argpartition(-G, kk - 1, axis=1)[:, :kk]
        val = np.take_along_axis(G, idx, 1)
        ci = np.concatenate([bi, idx + lo], axis=1)
        cv = np.concatenate([bv, val], axis=1)
        sel = np.argpartition(-cv, kc - 1, axis=1)[:, :kc]
        bi, bv = (np.take_along_axis(ci, sel, 1),
                  np.take_along_axis(cv, sel, 1))
    bi[~np.isfinite(bv)] = -1
    return bi


_GPU_CACHE: dict = {}


def _cand_cuda(Q: np.ndarray, P: np.ndarray, valid: np.ndarray, kc: int) -> np.ndarray:
    """_cand_cpu on a CUDA device (same float32 dot, same -inf mask). The
    full window matrix is uploaded once per process and sliced by prefix."""
    import torch
    full = P.base if P.base is not None else P
    key = (full.__array_interface__["data"][0], full.shape, DEVICE)
    if _GPU_CACHE.get("key") != key:
        _GPU_CACHE.clear()
        _GPU_CACHE["key"] = key
        _GPU_CACHE["X"] = torch.from_numpy(np.ascontiguousarray(full)).to(DEVICE)
    Pt = _GPU_CACHE["X"][:len(P)]
    Qt = torch.from_numpy(np.ascontiguousarray(Q)).to(DEVICE)
    vt = torch.from_numpy(valid).to(DEVICE)
    G = Qt @ Pt.T
    G.masked_fill_(~vt[None, :], float("-inf"))
    kk = min(kc, len(P))
    v, i = torch.topk(G, kk, dim=1, sorted=False)
    i = i.cpu().numpy().astype(np.int64)
    i[~np.isfinite(v.cpu().numpy())] = -1
    del G, Qt, vt
    return i


def _exact_cuda(Q: np.ndarray, ci: np.ndarray) -> np.ndarray:
    """Float64 dots of each query with its candidate rows, on the GPU
    (the same exact products the CPU path computes with einsum)."""
    import torch
    X = _GPU_CACHE["X"]
    idx = torch.from_numpy(np.maximum(ci, 0)).to(DEVICE)
    Q64 = torch.from_numpy(np.ascontiguousarray(Q)).to(DEVICE).double()
    out = torch.empty(ci.shape, dtype=torch.float64, device=DEVICE)
    for lo in range(0, len(Q), 64):
        Pc = X[idx[lo:lo + 64]].double()                          # (b, kc, D)
        out[lo:lo + 64] = torch.bmm(Pc, Q64[lo:lo + 64, :, None])[:, :, 0]
    return out.cpu().numpy()


def topk_dot(Q: np.ndarray, P: np.ndarray, valid: np.ndarray, kmax: int):
    """Row-wise kmax LARGEST dot products of Q against P, SORTED nearest
    first (column j = the (j+1)-th nearest neighbor, so the cumulative mean
    over the first k columns is literally the k nearest). Two stages:
    a float32 candidate search (kmax + TOPK_MARGIN, CPU or CUDA — the only
    device-dependent step) and an exact float64 re-rank of the candidates
    with a deterministic tie-break (higher dot, then earlier row), computed
    on the same device. Both devices therefore return the same neighbors
    whenever the true top-kmax sits inside the float32 candidate set (CPU
    vs CUDA parity is checked on real data before trusting shards)."""
    kc = min(kmax + TOPK_MARGIN, len(P))
    if DEVICE.startswith("cuda"):
        ci = _cand_cuda(Q, P, valid, kc)
        ok = ci >= 0
        cv = _exact_cuda(Q, ci)
    else:
        ci = _cand_cpu(Q, P, valid, kc)
        ok = ci >= 0
        cv = np.empty(ci.shape)
        Q64 = Q.astype(np.float64)
        for lo in range(0, len(Q), 16):                           # ~50 MB chunks
            Pc = P[np.maximum(ci[lo:lo + 16], 0)].astype(np.float64)
            cv[lo:lo + 16] = np.einsum("bkd,bd->bk", Pc, Q64[lo:lo + 16])
    cv[~ok] = -np.inf
    B = len(Q)
    bi = np.full((B, kmax), -1, dtype=np.int64)
    bv = np.full((B, kmax), -np.inf)
    for r in range(B):
        o = np.lexsort((ci[r], -cv[r]))[:kmax]                   # dot desc, row asc
        n = len(o)
        bi[r, :n], bv[r, :n] = ci[r, o], cv[r, o]
    bi[~np.isfinite(bv)] = -1
    return bi, bv


def knn_signals(win: dict, q_pos: list[int], kmax: int) -> dict:
    """Signals for every window of the sessions at positions ``q_pos``:
    {pos: (win rows, signals (n_rows, kmax))} — the mean label of the k
    nearest neighbors, one column per k = 1..kmax (cumulative means)."""
    X, sess, y = win["X"], win["sess"], win["y"]
    out = {}
    for p in q_pos:
        lo, hi = np.searchsorted(sess, p, side="left"), np.searchsorted(sess, p, side="right")
        if hi <= lo or p - GUARD < 0:
            continue
        pool_hi = int(np.searchsorted(sess, p - GUARD, side="right"))
        pv = win["y"][:pool_hi]
        nvalid = int((~np.isnan(pv)).sum())
        rows = np.arange(lo, hi)
        if nvalid < 1:                      # no labeled history at all
            out[p] = (rows, np.full((len(rows), kmax), np.nan))
            continue
        bi, bv = topk_dot(X[rows], X[:pool_hi], ~np.isnan(pv), kmax)
        lab = np.where((bi >= 0) & np.isfinite(bv), y[np.maximum(bi, 0)], np.nan)
        cs = np.nancumsum(lab, axis=1)
        cnt = np.cumsum(np.isfinite(lab), axis=1)
        sig = cs / np.maximum(cnt, 1)
        sig[cnt < 1] = np.nan
        out[p] = (rows, sig)
    return out


def knn_part(t: str, df: pd.DataFrame, days: list, starts: np.ndarray,
             ends: np.ndarray, fold_offsets: list, ks: tuple,
             quantiles: tuple, labels: list) -> None:
    ndays = len(days)
    t0 = time.time()
    win = knn_windows(df, starts, ends)
    if not win:
        emit({"ticker": t, "signal": "knn", "error": "no windows"})
        return
    kcol = {k: i for i, k in enumerate(range(1, max(ks) + 1))}
    cells = {(k, q): [] for k in ks for q in quantiles}
    for fi, (oa, ob) in enumerate(fold_offsets):
        fold_pos = list(range(ndays + oa, ndays)) if ob == 0 else list(range(ndays + oa, ndays + ob))
        # The 25 sessions STRICTLY before the fold's first session
        # (positions p < fold_pos[0] are strictly earlier — the mask rule:
        # rows before the fold's first day never include the scored fold).
        block_pos = [p for p in range(ndays) if p < fold_pos[0]][-25:]
        sigs = knn_signals(win, fold_pos, max(ks))
        blk = knn_signals(win, block_pos, max(ks))
        for k in ks:
            v = np.concatenate([blk[p][1][:, kcol[k]] for p in block_pos
                                if p in blk]) if blk else np.array([])
            v = v[np.isfinite(v)]
            for q in quantiles:
                thr = float(np.quantile(np.abs(v), q)) if len(v) else np.nan
                p_arr = np.full(len(df), np.nan)
                hits = fired = 0
                for pos in fold_pos:
                    if pos not in sigs:
                        continue
                    rows, S = sigs[pos]
                    s = S[:, kcol[k]]
                    m = np.isfinite(s) & np.isfinite(thr) & (np.abs(s) > thr)
                    if m.any():
                        p_arr[win["eb"][rows[m]]] = s[m]
                    lab = win["y"][rows]
                    fm = m & np.isfinite(lab) & (lab != 0)
                    hits += int((np.sign(s[fm]) == np.sign(lab[fm])).sum())
                    fired += int(fm.sum())
                fold_days = [days[p] for p in fold_pos]
                trades = daytrade.simulate(df, p_arr, fold_days, t, CFG) if fired else []
                cells[(k, q)].append({"fold": labels[fi], "trades": len(trades),
                                      "net_bps": sum(x["net_bps"] for x in trades),
                                      "dir_hits": hits, "fired": fired,
                                      "thr_bps": round(thr, 2) if np.isfinite(thr) else None})
    for (k, q), fold_rows in cells.items():
        if not fold_rows:
            continue
        emit({"ticker": t, "signal": "knn", "k": k, "thr_q": q,
              "cost_bps_side": round(daytrade.cost_per_fill(CFG) * 1e4, 1),
              "thr_bps": fold_rows[0]["thr_bps"], **gate(fold_rows)})
    emit({"ticker": t, "signal": "knn", "note": "windows built",
          "windows": int(len(win["X"])), "seconds": round(time.time() - t0, 1)})


# ---------------------------------------------------------------------------
# Part B: GBM, 1 year vs all prior history
# ---------------------------------------------------------------------------

def gbm_features(df: pd.DataFrame) -> np.ndarray:
    """12 baseline + vwap_dist_real + trade_count_z + avg_trade_size_z, all
    causal (expanding within the day / rolling over past bars only)."""
    c, v = df["Close"], df["Volume"]
    day = pd.Series(df.index.date, index=df.index)
    tc = df["TradeCount"].clip(lower=1)
    evwap = (df["VWAP"] * v).groupby(day).cumsum() / v.groupby(day).cumsum().replace(0, np.nan)
    lt = np.log1p(tc)
    ats = np.log(v / tc)
    f = pd.DataFrame(index=df.index)
    f["vwap_dist_real"] = c / evwap - 1
    f["trade_count_z"] = (lt - lt.rolling(60).mean()) / lt.rolling(60).std()
    f["avg_trade_size_z"] = (ats - ats.rolling(60).mean()) / ats.rolling(60).std()
    out = pd.concat([daytrade.features(df)[daytrade.FEATS], f], axis=1)
    return out.replace([np.inf, -np.inf], np.nan).fillna(0.0).to_numpy(dtype=np.float32)


def gbm_part(t: str, df: pd.DataFrame, days: list, days_arr: np.ndarray,
             arms: list[str], fold_offsets: list, labels: list) -> None:
    from sklearn.ensemble import HistGradientBoostingRegressor
    F = gbm_features(df)
    y = fwd_bps(df)
    n = len(df)
    ends = np.arange(WINDOW - 1, n)                      # window end bars
    end_day = days_arr[ends]
    nW = len(ends)
    ndays = len(days)
    for arm in arms:
        t0 = time.time()
        cells = {arm: []}
        for fi, (oa, ob) in enumerate(fold_offsets):
            fold_pos = list(range(ndays + oa, ndays)) if ob == 0 else list(range(ndays + oa, ndays + ob))
            fold_start = days[fold_pos[0]]
            # Training rows = strictly earlier sessions only. The mask
            # `days_arr < fold_start` selects days strictly before the fold's
            # first day, so it NEVER includes the scored fold; the 1y arm only
            # narrows that same strictly-prior set to the last 365 days.
            prior_mask = days_arr < fold_start
            since = fold_start - timedelta(days=365)
            tmask = prior_mask & (days_arr > since) if arm == "1y" else prior_mask
            mu = F[tmask].mean(axis=0)
            sd = F[tmask].std(axis=0)
            sd = np.where(sd == 0, 1.0, sd)
            z = np.clip((F - mu) / sd, -6, 6).astype(np.float32)
            # Window rows are gathered only for the rows used, straight into
            # float64 — the exact cast sklearn applies to a float32 X anyway —
            # so no full float32 copy + float64 copy sit in memory at once.
            Wv = sliding_window_view(z, (WINDOW, z.shape[1]))[:, 0]   # (nW, 60, F) view
            tr = (end_day < fold_start) & ~np.isnan(y[ends])
            if arm == "1y":
                tr &= end_day > since
            fl = np.isin(end_day, [days[p] for p in fold_pos])
            model = HistGradientBoostingRegressor(max_iter=100, learning_rate=0.1,
                                                  max_leaf_nodes=31, random_state=0)
            Xtr = np.empty((int(tr.sum()), Wv.shape[1] * Wv.shape[2]), dtype=np.float64)
            tri = np.flatnonzero(tr)
            for lo in range(0, len(tri), 50_000):
                ri = tri[lo:lo + 50_000]
                Xtr[lo:lo + len(ri)] = Wv[ri].reshape(len(ri), -1)
            model.fit(Xtr, y[ends][tr])
            del Xtr
            X = Wv[fl].reshape(int(fl.sum()), -1).astype(np.float64)
            pred = model.predict(X).astype(np.float64)
            p_arr = np.full(n, np.nan)
            fe = ends[fl]
            p_arr[fe] = pred
            m = np.isfinite(pred) & (np.abs(pred) > FIRE_BPS)
            yf = y[fe]
            fm = m & np.isfinite(yf) & (yf != 0)
            hits = int((np.sign(pred[fm]) == np.sign(yf[fm])).sum())
            trades = daytrade.simulate(df, p_arr, [days[p] for p in fold_pos], t, CFG) if fm.any() else []
            cells[arm].append({"fold": labels[fi], "trades": len(trades),
                               "net_bps": sum(x["net_bps"] for x in trades),
                               "dir_hits": hits, "fired": int(fm.sum()),
                               "train_sessions": len(set(days_arr[tmask])),
                               "train_rows": int(tr.sum())})
            del X, z, Wv
        if cells[arm]:
            g = gate(cells[arm])
            emit({"ticker": t, "signal": "gbm", "arm": arm,
                  "fire_bps": round(FIRE_BPS, 1),
                  "train_sessions": [r["train_sessions"] for r in cells[arm]],
                  "train_rows": [r["train_rows"] for r in cells[arm]],
                  "cost_bps_side": round(daytrade.cost_per_fill(CFG) * 1e4, 1),
                  **g, "seconds": round(time.time() - t0, 1)})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def done_cells(paths: list[str], stress: bool) -> set:
    """(ticker, arm) pairs already fully reported in earlier logs of the SAME
    mode. knn counts as done only on its closing "windows built" note (it is
    emitted after every k x q cell); a gbm arm is one line. The header line's
    "stress" flag scopes each log's rows to its mode."""
    done = set()
    for path in paths:
        try:
            lines = open(path).read().splitlines()
        except OSError:
            continue
        mode = None
        for ln in lines:
            try:
                r = json.loads(ln)
            except ValueError:
                continue
            if not isinstance(r, dict):
                continue
            if "stress" in r and "ks" in r:
                mode = bool(r["stress"])
                continue
            if mode is not stress or "ticker" not in r:
                continue
            if r.get("signal") == "knn" and r.get("note") == "windows built":
                done.add((r["ticker"], "knn"))
            elif r.get("signal") == "gbm" and "PASS" in r:
                done.add((r["ticker"], "gbm" + r["arm"]))
    return done


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default=",".join(TICKERS))
    ap.add_argument("--arms", default="knn,gbm1y,gbmall",
                    help="comma list: knn,gbm1y,gbmall")
    ap.add_argument("--stress", action="store_true")
    ap.add_argument("--cache-dir", default=None,
                    help="read {T}.pkl from this directory (a frozen snapshot) "
                         "instead of the live cache that other jobs rewrite")
    ap.add_argument("--expect-sessions", type=int, default=None,
                    help="abort unless the loaded history has at least this many "
                         "sessions (a truncated cache must fail loudly)")
    ap.add_argument("--device", default="cpu",
                    help="k-NN candidate search device: cpu or cuda:N")
    ap.add_argument("--skip-log", action="append", default=[],
                    help="log file(s) of earlier runs (same --stress mode); a "
                         "ticker x arm already reported there is skipped. "
                         "Scheduling only: every arm is computed independently, "
                         "so skipping one never changes another's numbers.")
    args = ap.parse_args()
    arms = {a.strip() for a in args.arms.split(",") if a.strip()}
    stress = args.stress
    global DEVICE, CACHE_DIR
    DEVICE = args.device
    if args.cache_dir:
        from pathlib import Path
        CACHE_DIR = Path(args.cache_dir)
    done = done_cells(args.skip_log, stress)
    ks = KS_STRESS if stress else KS
    quantiles = QS_STRESS if stress else (Q,)
    fold_offsets = STRESS_FOLD_OFFSETS if stress else FOLD_OFFSETS
    labels = STRESS_FOLD_LABELS if stress else FOLD_LABELS
    emit({"cost_per_side_bps": round(daytrade.cost_per_fill(CFG) * 1e4, 2),
          "round_trip_bps": daytrade.round_trip_bps(CFG),
          "horizon_min": H, "window_bars": WINDOW, "guard_sessions": GUARD,
          "ks": list(ks), "thr_quantiles": list(quantiles),
          "folds": labels, "stress": stress, "min_trades": MIN_TRADES,
          "dir_min_pct": DIR_MIN})
    passed = []
    for t in [x.strip().upper() for x in args.tickers.split(",") if x.strip()]:
        t_arms = {a for a in arms if (t, a) not in done}
        if not t_arms:
            emit({"ticker": t, "note": "skipped: every requested arm already in --skip-log"})
            continue
        df = load(t)
        if df.empty:
            emit({"ticker": t, "error": "no bars"})
            continue
        days_arr = np.array(df.index.date)
        days = sorted(set(days_arr))
        if args.expect_sessions is not None and len(days) < args.expect_sessions:
            emit({"ticker": t, "error": f"history depth {len(days)} sessions "
                  f"({days[0]}..{days[-1]}) < expected {args.expect_sessions}"})
            sys.exit(3)
        if len(days) < 107:
            emit({"ticker": t, "error": f"only {len(days)} sessions"})
            continue
        starts = np.array([np.searchsorted(days_arr, d) for d in days])
        ends = np.append(starts[1:], len(df))
        emit({"ticker": t, "sessions": len(days), "bars": int(len(df)),
              "history_from": days[0].isoformat(), "history_to": days[-1].isoformat()})
        if "knn" in t_arms:
            knn_part(t, df, days, starts, ends, fold_offsets, ks, quantiles, labels)
        gbm_arms = [a for a in ("gbm1y", "gbmall") if a in t_arms]
        if gbm_arms:
            gbm_part(t, df, days, days_arr,
                     ["1y" if a == "gbm1y" else "all" for a in gbm_arms],
                     fold_offsets, labels)
        del df
    mode = "STRESS " if stress else ""
    print(f"VERDICT {mode}pattern-recognition: per-ticker cells above; PASS = "
          f"dir>={DIR_MIN}% over all fired bars, net>0 after "
          f"{round(daytrade.cost_per_fill(CFG) * 1e4, 1)} bps/side, >=3/4 folds, "
          f"oldest fold, >={MIN_TRADES} trades, per ticker only.", flush=True)
    print("DONE pattern-recognition-validation", flush=True)


if __name__ == "__main__":
    main()