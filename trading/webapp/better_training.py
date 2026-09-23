#!/usr/bin/env python3
"""Better training: does more data + the new bar fields buy an honest edge?

Controlled PER-TICKER comparison on the engine's 10 tickers, three arms on
the SAME four prior-only 25-session folds (-100..-75, -75..-50, -50..-25,
-25..0 — the same folds the pooled validator used):

  baseline — the engine's 12 features, CfC-32 (the known control: ~50%
             direction, negative net bps)
  newfeats — 12 + 3 new features from the real bar fields now in the Alpaca
             cache (vwap_dist_real, trade_count_z, avg_trade_size_z),
             same CfC-32, same torch seed (0, fixed before net creation)
  gbm      — the same 15 features, HistGradientBoostingRegressor on 60-bar
             window summaries (last/mean/std/min/max per feature), CPU

Every fold is scored by a model trained ONLY on strictly-earlier sessions —
all of them in the year of history (that is the "all available data" part) —
through the real engine path: daytrade.fit / daytrade.predict (byte-for-byte
the engine's trainer) and daytrade.simulate (trade gate forced on, its fake
$10M book with the absolute-USD knobs zeroed inside simulate itself), with
direction_hit_pct measured over ALL scored fold bars and has_edge from the
real edge_ok.

daytrade.features is patched ONLY inside this process so the engine's own
fit/predict can see the 3 new columns; the live engine path in daytrade.py
is untouched and nothing is persisted to the live model store.

Rows append as JSON lines to logs/better_training.log; a crashed run resumes
where it left off (rows already in the log are skipped). A per-ticker
summary and an overall summary line are appended at the end, and the full
result set is dumped to logs/better_training.json.

Usage:
  better_training.py                       # full run, 10 tickers x 3 arms
  better_training.py --tickers AAPL --folds-limit 1   # smoke test
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402
import alpaca_data  # noqa: E402

LOG_PATH = Path("/opt/Warden/trading/logs/better_training.log")
JSON_PATH = Path("/opt/Warden/trading/logs/better_training.json")
TICKERS = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO"]
FOLD_LEN = 25          # 4 prior-only folds of 25 sessions, same as the validators
N_FOLDS = 4
ARMS = ("baseline", "newfeats", "gbm")
NEW_FEATS = ["vwap_dist_real", "trade_count_z", "avg_trade_size_z"]

# ---------------------------------------------------------------------------
# The 3 new features — every one is causal (bars at or before bar i only).
# ---------------------------------------------------------------------------

_features_orig = daytrade.features          # the live engine's features(), kept
_FEAT_CACHE: dict[int, tuple[pd.DataFrame, pd.DataFrame]] = {}


def features_new(df: pd.DataFrame) -> pd.DataFrame:
    """The engine's 12 features + 3 from the real bar fields (VWAP, TradeCount).

    - vwap_dist_real: Close/VWAP - 1, session-z-scored against the session's
      own history-so-far (expanding mean/std within the day — causal; the
      first 30 bars of a session are a warm-up and score 0)
    - trade_count_z: log1p(TradeCount), z-scored vs a rolling 60 bars
    - avg_trade_size_z: log(Volume/TradeCount), z-scored vs rolling 60 bars
    """
    f = _features_orig(df)
    day = pd.Series(df.index.date, index=df.index)
    close, vol = df["Close"], df["Volume"]

    vd = close / df["VWAP"] - 1.0
    g = vd.groupby(day)
    vd_mu = g.transform(lambda s: s.expanding().mean())
    vd_sd = g.transform(lambda s: s.expanding().std())
    z = (vd - vd_mu) / vd_sd.replace(0, np.nan)
    f["vwap_dist_real"] = z.mask(g.cumcount() < 30, 0.0)

    ltc = np.log1p(df["TradeCount"])
    f["trade_count_z"] = (ltc - ltc.rolling(60).mean()) / ltc.rolling(60).std()

    n = df["TradeCount"].replace(0, np.nan)
    ats = np.log(vol / n)
    f["avg_trade_size_z"] = (ats - ats.rolling(60).mean()) / ats.rolling(60).std()

    return f.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def features_cached(df: pd.DataFrame) -> pd.DataFrame:
    """daytrade.features replacement: the 15-column frame, memoized per df
    (fit and predict both call features() — the cache keeps 120 fold tasks
    from recomputing it 3x each)."""
    hit = _FEAT_CACHE.get(id(df))
    if hit is not None and hit[0] is df:
        return hit[1]
    out = features_new(df)
    _FEAT_CACHE[id(df)] = (df, out)
    return out


# Patched ONLY in this process; daytrade.py on disk is untouched.
daytrade.features = features_cached


# ---------------------------------------------------------------------------
# Folds — the same 4 prior-only 25-session folds the other validators use.
# ---------------------------------------------------------------------------

def fold_plan(df: pd.DataFrame) -> list[tuple[str, list]]:
    days = sorted(set(df.index.date))
    test = days[-N_FOLDS * FOLD_LEN:]
    folds = np.array_split(np.array(test, dtype=object), N_FOLDS)
    labels = [f"-{N_FOLDS * FOLD_LEN - k * FOLD_LEN}..-{N_FOLDS * FOLD_LEN - (k + 1) * FOLD_LEN}"
              for k in range(N_FOLDS)]
    labels[-1] = labels[-1].replace("..-0", "..0")
    return [(labels[k], list(folds[k])) for k in range(N_FOLDS)]


# ---------------------------------------------------------------------------
# Arms
# ---------------------------------------------------------------------------

def arm_cfc(ticker: str, arm: str, fold: list, prior: list, df: pd.DataFrame,
            cfg: dict) -> tuple[np.ndarray, int]:
    """Arms 'baseline' (12 features) and 'newfeats' (15): the engine's own
    fit/predict, seed 0 fixed inside fit BEFORE net creation, so the two
    arms differ only by the feature list."""
    dev = daytrade._device_slots().get()
    try:
        pack = daytrade.fit(df, prior, cfg, device=dev)
        preds = daytrade.predict(pack, df)
        n_train = int(np.isin(np.array(df.index.date), prior).sum())
    finally:
        daytrade._device_slots().put(dev)
    return preds, n_train


def window_summary(X: np.ndarray) -> np.ndarray:
    """Flatten each (look_back, n_feats) window into a fixed vector:
    last / mean / std / min / max per feature (5 x n_feats columns)."""
    parts = [X[:, -1, :], X.mean(axis=1), X.std(axis=1), X.min(axis=1), X.max(axis=1)]
    return np.concatenate(parts, axis=1).astype(np.float32)


def arm_gbm(ticker: str, arm: str, fold: list, prior: list, df: pd.DataFrame,
            cfg: dict) -> tuple[np.ndarray, int]:
    """Arm 'gbm': HistGradientBoostingRegressor per fold on window summaries
    of the same 15 z-scored features. Standardisation stats (mu/sd) come from
    the fold's strictly-earlier fit sessions only, mirroring daytrade.fit;
    the engine's val sessions are held out and early stopping uses a random
    10% slice of the remaining TRAINING rows (never the scored fold)."""
    from sklearn.ensemble import HistGradientBoostingRegressor

    h, lb = int(cfg["horizon_min"]), int(cfg["look_back"])
    feats = daytrade.features(df)[cfg["features"]].values.astype(np.float64)
    y = daytrade.forward_return(df, h)
    days = np.array(df.index.date)
    n_val = max(2, int(round(len(prior) * cfg["val_share_pct"] / 100)))
    fit_days, _val_days = set(prior[:-n_val]), set(prior[-n_val:])
    in_fit = np.isin(days, list(fit_days))          # strictly-earlier rows only
    mu = feats[in_fit].mean(0)
    sd = feats[in_fit].std(0)
    sd = np.where(sd == 0, 1.0, sd)
    z = np.clip((feats - mu) / sd, -6, 6)
    X = daytrade._windows(z, lb)
    F = window_summary(X)
    end = np.arange(lb - 1, len(z))
    y_end = y[end]
    days_end = days[end]
    tr = ~np.isnan(y_end) & np.isin(days_end, list(fit_days))
    gbm = HistGradientBoostingRegressor(
        max_iter=500, learning_rate=0.05, min_samples_leaf=50,
        l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
        n_iter_no_change=10, random_state=0)
    gbm.fit(F[tr], y_end[tr])
    preds = np.full(len(df), np.nan)
    preds[end] = gbm.predict(F) * 1e4               # log return -> bps
    return preds, int(tr.sum())


# ---------------------------------------------------------------------------
# Scoring — the honest gate, exactly as the engine measures it.
# ---------------------------------------------------------------------------

def score_fold(ticker: str, arm: str, label: str, fold: list, preds: np.ndarray,
               df: pd.DataFrame, cfg: dict, fit_seconds: float, n_train: int,
               n_prior: int) -> dict:
    h = int(cfg["horizon_min"])
    y = daytrade.forward_return(df, h) * 1e4
    days_arr = np.array(df.index.date)
    trades = daytrade.simulate(df, preds, fold, ticker, cfg)
    edge = daytrade.edge_metrics(trades, len(fold), h)
    m = np.isin(days_arr, fold) & ~np.isnan(preds) & ~np.isnan(y) & (y != 0)
    hits = int((np.sign(preds[m]) == np.sign(y[m])).sum()) if m.any() else 0
    tot = int(m.sum())
    edge["direction_hit_pct"] = round(hits / tot * 100, 1) if tot else None
    dir_pct = edge["direction_hit_pct"]
    fold_pass = bool(dir_pct is not None and dir_pct >= cfg["min_direction_pct"]
                     and (edge["avg_net_bps"] or 0) > 0)
    return {"event": "fold", "ticker": ticker, "arm": arm, "fold": label,
            "direction_hit_pct": dir_pct, "dir_hits": hits, "dir_bars": tot,
            "trades": edge["trades"], "avg_net_bps": edge["avg_net_bps"],
            "total_net_bps": edge["total_net_bps"],
            "win_rate_pct": edge["win_rate_pct"],
            "GATE_FIRES": daytrade.edge_ok(edge, cfg),
            "fold_pass": fold_pass, "train_bars": n_train,
            "prior_sessions": n_prior, "fit_seconds": round(fit_seconds, 1)}


def log_line(obj: dict, lock: threading.Lock) -> None:
    with lock:
        with LOG_PATH.open("a") as fh:
            fh.write(json.dumps(obj) + "\n")


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def done_keys() -> set:
    keys = set()
    if LOG_PATH.exists():
        for line in LOG_PATH.read_text().splitlines():
            if not line.startswith("{"):
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("event") == "fold":
                keys.add((r["ticker"], r["arm"], r["fold"]))
    return keys


def main() -> None:
    ap = argparse.ArgumentParser(description="per-ticker better-training comparison")
    ap.add_argument("--tickers", nargs="*", default=TICKERS)
    ap.add_argument("--arms", nargs="*", default=list(ARMS), choices=ARMS)
    ap.add_argument("--folds-limit", type=int, default=N_FOLDS,
                    help="run only the first N folds (smoke testing)")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    if not alpaca_data.available():
        sys.exit("no Alpaca credentials — the new fields only exist in the SIP cache")
    cfg = {**knobs.defaults()}                      # the engine's default gate
    feat_cfg = {
        "baseline": {"features": list(cfg["features"])},
        "newfeats": {"features": list(cfg["features"]) + NEW_FEATS},
        "gbm": {"features": list(cfg["features"]) + NEW_FEATS},
    }
    workers = max(1, min(args.workers, len(args.tickers) * len(args.arms)))
    daytrade.set_train_workers(6)

    log_line({"event": "run_start", "tickers": args.tickers, "arms": args.arms,
              "folds_limit": args.folds_limit, "workers": workers,
              "gate": {k: cfg[k] for k in ("min_direction_pct", "min_edge_bps",
                                           "min_edge_trades", "horizon_min",
                                           "spread_bps", "slippage_bps")},
              "at": time.strftime("%Y-%m-%dT%H:%M:%S")}, threading.Lock())

    # Per ticker: history (session-only, with VWAP + TradeCount) + folds.
    per: dict[str, dict] = {}
    for t in args.tickers:
        df = daytrade.fetch_history(t)
        missing = {"VWAP", "TradeCount"} - set(df.columns)
        if df.empty or missing:
            sys.exit(f"{t}: history missing columns {sorted(missing)} — refetch the cache")
        folds = fold_plan(df)[:args.folds_limit]
        per[t] = {"df": df, "folds": folds,
                  "days": sorted(set(df.index.date))}
        print(f"loaded {t}: {len(df)} bars, {len(per[t]['days'])} sessions, "
              f"folds {[lbl for lbl, _ in folds]}", flush=True)

    done = done_keys()
    tasks = []
    for t in args.tickers:
        df, days = per[t]["df"], per[t]["days"]
        for label, fold in per[t]["folds"]:
            prior = [d for d in days if d < fold[0]]      # ALL earlier sessions
            for arm in args.arms:
                if (t, arm, label) in done:
                    continue
                tasks.append((t, arm, label, fold, prior))

    def one(task):
        t, arm, label, fold, prior = task
        t0 = time.time()
        acfg = {**cfg, **feat_cfg[arm]}
        df = df_holder[t]
        if arm == "gbm":
            preds, n_train = arm_gbm(t, arm, fold, prior, df, acfg)
        else:
            preds, n_train = arm_cfc(t, arm, fold, prior, df, acfg)
        return score_fold(t, arm, label, fold, preds, df, cfg,
                          time.time() - t0, n_train, len(prior))

    df_holder = {t: per[t]["df"] for t in args.tickers}
    rows: list[dict] = []
    lock = threading.Lock()
    if tasks:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(one, task) for task in tasks]
            for fut in as_completed(futs):
                row = fut.result()
                rows.append(row)
                log_line(row, lock)
                print(json.dumps(row), flush=True)

    # ---- summaries (all fold rows in the log for THIS ticker set + arms) ----
    hist_rows = [r for r in read_fold_rows()
                 if r["ticker"] in args.tickers and r["arm"] in args.arms]
    summaries = []
    for t in args.tickers:
        for arm in args.arms:
            rs = sorted([r for r in hist_rows if r["ticker"] == t and r["arm"] == arm],
                        key=lambda r: r["fold"])
            if not rs:
                continue
            n_pass = sum(1 for r in rs if r["fold_pass"])
            oldest = rs[0]["fold_pass"]
            trades = sum(r["trades"] for r in rs)
            total_bps = sum(r["total_net_bps"] for r in rs)
            hits, bars = sum(r["dir_hits"] for r in rs), sum(r["dir_bars"] for r in rs)
            pooled_dir = round(hits / bars * 100, 1) if bars else None
            pooled_edge = {"trades": trades,
                           "avg_net_bps": round(total_bps / trades, 2) if trades else 0.0,
                           "direction_hit_pct": pooled_dir}
            summaries.append({"event": "ticker_summary", "ticker": t, "arm": arm,
                              "folds": len(rs), "folds_pass": n_pass,
                              "oldest_fold_pass": oldest,
                              "PASS": bool(n_pass >= max(3, len(rs) - 1) and oldest),
                              "pooled_direction_hit_pct": pooled_dir,
                              "pooled_trades": trades,
                              "pooled_avg_net_bps": pooled_edge["avg_net_bps"],
                              "GATE_FIRES_POOLED": daytrade.edge_ok(pooled_edge, cfg),
                              "per_fold": {r["fold"]: {"dir": r["direction_hit_pct"],
                                                       "net_bps": r["avg_net_bps"],
                                                       "trades": r["trades"],
                                                       "fold_pass": r["fold_pass"]}
                                           for r in rs}})
    overall = {"event": "overall_summary", "arm_pass_counts": {}, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    for arm in args.arms:
        ss = [s for s in summaries if s["arm"] == arm]
        overall["arm_pass_counts"][arm] = sum(1 for s in ss if s["PASS"])
        d = [s["pooled_direction_hit_pct"] for s in ss if s["pooled_direction_hit_pct"] is not None]
        n = [s["pooled_avg_net_bps"] for s in ss if s["pooled_trades"]]
        overall[arm] = {"tickers": len(ss), "PASS": sum(1 for s in ss if s["PASS"]),
                        "mean_pooled_direction_pct": round(float(np.mean(d)), 1) if d else None,
                        "mean_pooled_net_bps": round(float(np.mean(n)), 2) if n else None}
    for s in summaries:
        log_line(s, lock)
        print(json.dumps(s), flush=True)
    log_line(overall, lock)
    print(json.dumps(overall), flush=True)
    JSON_PATH.write_text(json.dumps({"folds": hist_rows, "summaries": summaries,
                                     "overall": overall}, indent=1))
    print(f"DONE better-training — log: {LOG_PATH}", flush=True)


def read_fold_rows() -> list[dict]:
    rows = []
    if LOG_PATH.exists():
        for line in LOG_PATH.read_text().splitlines():
            if line.startswith("{"):
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if r.get("event") == "fold":
                    rows.append(r)
    return rows


if __name__ == "__main__":
    main()