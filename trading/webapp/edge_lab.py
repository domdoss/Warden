#!/usr/bin/env python3
"""Edge lab: isolated experiments from NO_EDGE_REPORT.md.

Usage:
  edge_lab.py economics   — SPY/QQQ at h60/h120 with realistic ETF costs,
                            full walk-forward edge per trial (never persisted).
  edge_lab.py objective   — sign-objective vs MSE ablation on the newest
                            honest fold (MSFT/AAPL/MU/KO), never persisted.

Everything runs through the same honest fit/predict/simulate path the engine
uses; nothing is saved to the live model store.
"""
from __future__ import annotations

import json
import sys
import time

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import daytrade  # noqa: E402
import knobs  # noqa: E402

LOGS = "/opt/Warden/trading/logs"


def economics() -> None:
    """Experiment 3: change the economics — ETFs, longer horizon, real costs."""
    through = daytrade.last_session()
    slots = daytrade._device_slots()
    dev = slots.get()
    out = []
    try:
        for t in ("SPY", "QQQ"):
            for h in (60, 120):
                cfg = {**knobs.defaults(), "horizon_min": h,
                       "spread_bps": 1.0, "slippage_bps": 0.25}   # ~1.5 bps round trip
                t0 = time.time()
                m = daytrade._train_ticker_on(t, through, cfg, lambda *a, **k: None,
                                              f"edgelab-{t}-{h}", None, None, dev, persist=False)
                row = {"ticker": t, "horizon": h, "edge": m["meta"]["edge"],
                       "train_seconds": round(time.time() - t0, 1)}
                out.append(row)
                print(json.dumps(row), flush=True)
    finally:
        slots.put(dev)
    with open(f"{LOGS}/edge_lab_economics.json", "w") as f:
        json.dump(out, f, indent=1)
    print("DONE economics", flush=True)


def objective() -> None:
    """Experiment 1: train the sign (what decide() trades) instead of magnitude."""
    h = 30
    thr = 4.0                      # the 4 bps trade threshold from the report
    fold_n = 25                     # newest 25 sessions, scored by a prior-only model
    dev = daytrade._device_slots().get()
    out = []
    try:
        for t in ("MSFT", "AAPL", "MU", "KO"):
            df = daytrade.fetch_history(t)
            days = sorted(set(df.index.date))
            fold = days[-fold_n:]
            prior = [d for d in days if d < fold[0]]
            for obj in ("mse", "sign"):
                cfg = {**knobs.defaults(), "objective": obj}
                pack = daytrade.fit(df, prior, cfg, device=dev)
                preds = daytrade.predict(pack, df)
                y = daytrade.forward_return(df, h) * 1e4
                m = (np.isin(np.array(df.index.date), fold) & ~np.isnan(preds)
                     & ~np.isnan(y) & (y != 0))
                p, yy = preds[m], y[m]
                tr = np.abs(p) > thr
                row = {"ticker": t, "objective": obj,
                       "ic": round(float(np.corrcoef(p, yy)[0, 1]), 4),
                       "hit_all": round(float((np.sign(p) == np.sign(yy)).mean() * 100), 1),
                       "hit_traded": round(float((np.sign(p[tr]) == np.sign(yy[tr])).mean() * 100), 1),
                       "e_sign_y_traded_bps": round(float(np.mean(np.sign(p[tr]) * yy[tr])), 2),
                       "pct_bars_traded": round(float(tr.mean() * 100), 1)}
                trades = daytrade.simulate(df, preds, fold, t, cfg)
                nets = [tr_["net_bps"] for tr_ in trades]
                row["simulate_net_bps"] = round(float(np.mean(nets)), 2) if nets else None
                row["simulate_trades"] = len(nets)
                out.append(row)
                print(json.dumps(row), flush=True)
    finally:
        daytrade._device_slots().put(dev)
    with open(f"{LOGS}/edge_lab_objective.json", "w") as f:
        json.dump(out, f, indent=1)
    print("DONE objective", flush=True)


def cross() -> None:
    """Experiment 4: do market-context features add signal? Ridge gate first —
    base features alone vs base + SPY/QQQ context, same honest fold."""
    import pandas as pd

    h, thr, fold_n = 30, 4.0, 25
    ctx_cols = ["r1", "r5", "r15", "vwap_dist", "range_pos", "vol_z"]
    spy_c = daytrade.features(daytrade.fetch_history("SPY"))[ctx_cols].add_prefix("spy_")
    qqq_c = daytrade.features(daytrade.fetch_history("QQQ"))[["r5", "r15"]].add_prefix("qqq_")
    out = []
    for t in ("MSFT", "AAPL", "NVDA", "MU", "KO", "GEV"):
        df = daytrade.fetch_history(t)
        base = daytrade.features(df)
        ctx = pd.concat([spy_c.reindex(df.index).ffill(),
                         qqq_c.reindex(df.index).ffill()], axis=1)
        y = daytrade.forward_return(df, h) * 1e4
        days = sorted(set(df.index.date))
        fold = days[-fold_n:]
        prior = [d for d in days if d < fold[0]]
        days_arr = np.array(df.index.date)
        ok = ~np.isnan(y)
        tr = ok & np.isin(days_arr, prior)
        va = ok & np.isin(days_arr, prior[-max(2, len(prior) * 15 // 100):])
        te = ok & np.isin(days_arr, fold)
        if not (tr.any() and va.any() and te.any()):
            continue
        for name, X in (("base", base), ("base+ctx", pd.concat([base, ctx], axis=1))):
            Xv = X.values.astype(np.float64)
            mu, sd = Xv[tr].mean(0), Xv[tr].std(0)
            sd = np.where(sd == 0, 1.0, sd)
            z = np.nan_to_num(np.clip((Xv - mu) / sd, -6, 6))
            best, w_best = np.inf, None
            for lam in (1.0, 10.0, 100.0, 1000.0):
                A, ytr = z[tr], y[tr]
                w = np.linalg.solve(A.T @ A + lam * np.eye(A.shape[1]), A.T @ ytr)
                vl = float(np.mean((z[va] @ w - y[va]) ** 2))
                if vl < best:
                    best, w_best = vl, w
            p_te = z[te] @ w_best
            trd = np.abs(p_te) > thr
            row = {"ticker": t, "set": name,
                   "ic": round(float(np.corrcoef(p_te, y[te])[0, 1]), 4),
                   "hit_traded": round(float((np.sign(p_te[trd]) == np.sign(y[te][trd])).mean() * 100), 1) if trd.any() else None,
                   "e_sign_y_traded_bps": round(float(np.mean(np.sign(p_te[trd]) * y[te][trd])), 2) if trd.any() else None,
                   "bars_traded": int(trd.sum())}
            preds = np.full(len(df), np.nan)
            preds[np.where(te)[0]] = p_te
            cfg = {**knobs.defaults(), "start_equity": 25000.0}
            trades = daytrade.simulate(df, preds, fold, t, cfg)
            nets = [x["net_bps"] for x in trades]
            row["simulate_net_bps"] = round(float(np.mean(nets)), 2) if nets else None
            row["simulate_trades"] = len(nets)
            out.append(row)
            print(json.dumps(row), flush=True)
    with open(f"{LOGS}/edge_lab_cross.json", "w") as f:
        json.dump(out, f, indent=1)
    print("DONE cross", flush=True)


def pool() -> None:
    """Experiment 5: ONE model trained on many tickers (pooling) vs one model
    per ticker, scored on the same honest fold. Per-ticker standardisation and
    label scaling, pooled training windows, never persisted."""
    import torch

    h, thr, fold_n = 30, 4.0, 25
    tickers = ["AAPL", "MSFT", "NVDA", "AMD", "MU", "TSLA", "META", "AMZN", "GOOGL", "NFLX",
               "INTC", "QCOM", "AVGO", "TXN", "SMCI", "PLTR", "COIN", "MSTR", "SOFI", "PYPL",
               "JPM", "BAC", "GS", "MS", "C", "V", "MA", "XOM", "CVX", "KO"]
    cfg = {**knobs.defaults()}
    cols = list(cfg["features"])
    look_back, units = int(cfg["look_back"]), int(cfg["hidden_units"])
    batch, epochs, patience = int(cfg["batch_size"]), int(cfg["max_epochs"]), int(cfg["patience"])
    scfg = {**knobs.defaults(), "start_equity": 25000.0}
    out = []
    dev = None
    try:
        per = {}
        for t in tickers:
            df = daytrade.fetch_history(t)
            feats = daytrade.features(df)[cols].values.astype(np.float64)
            y = daytrade.forward_return(df, h)
            days = np.array(df.index.date)
            all_days = sorted(set(days))
            fold = all_days[-fold_n:]
            prior = [d for d in all_days if d < fold[0]]
            n_val = max(2, int(round(len(prior) * cfg["val_share_pct"] / 100)))
            fit_days, val_days = set(prior[:-n_val]), set(prior[-n_val:])
            in_fit = np.isin(days, list(fit_days))
            mu = feats[in_fit].mean(0)
            sd = feats[in_fit].std(0)
            sd = np.where(sd == 0, 1.0, sd)
            z = np.clip((feats - mu) / sd, -6, 6)
            X = daytrade._windows(z, look_back)
            end = np.arange(look_back - 1, len(z))
            y_end = y[end]
            ok = ~np.isnan(y_end)
            tr = ok & np.isin(days[end], list(fit_days))
            va = ok & np.isin(days[end], list(val_days))
            te = ok & np.isin(days[end], fold)
            y_sd = float(np.nanstd(y_end[tr])) or 1e-3
            per[t] = {"df": df, "X": X, "y_end": y_end, "end": end, "tr": tr, "va": va,
                      "te": te, "y_sd": y_sd, "fold": fold, "prior": prior,
                      "y_bars": y, "days_bars": days}
            print(f"loaded {t}: {tr.sum()} train / {va.sum()} val / {te.sum()} test windows", flush=True)

        def metrics(p, yy, prefix, extra=None):
            trd = np.abs(p) > thr
            row = {**extra} if extra else {}
            row.update({"set": prefix,
                        "ic": round(float(np.corrcoef(p, yy)[0, 1]), 4),
                        "hit_traded": round(float((np.sign(p[trd]) == np.sign(yy[trd])).mean() * 100), 1) if trd.any() else None,
                        "e_sign_y_traded_bps": round(float(np.mean(np.sign(p[trd]) * yy[trd])), 2) if trd.any() else None,
                        "bars_traded": int(trd.sum())})
            return row, trd

        # ---- baseline: one model per ticker (the live approach) ----------------
        # Six fit threads across all GPU slots: the net is tiny, so one fit at a
        # time leaves the GPU idle between steps — overlapping six fills it.
        # Completed rows are checkpointed, so a crashed run resumes where it left off.
        import threading
        from concurrent.futures import ThreadPoolExecutor, as_completed
        from pathlib import Path

        daytrade.set_train_workers(6)
        part_path = Path(f"{LOGS}/edge_lab_pool_partial.json")
        done: dict = {}
        if part_path.exists():
            try:
                done = {r["ticker"]: r for r in json.loads(part_path.read_text())
                        if r.get("set") == "per-ticker"}
            except Exception:
                done = {}
        for t in tickers:
            if t in done:
                out.append(done[t])
                print(json.dumps(done[t]), flush=True)

        def baseline(t):
            d = per[t]
            dev = daytrade._device_slots().get()
            try:
                pack = daytrade.fit(d["df"], d["prior"], cfg, device=dev)
                preds = daytrade.predict(pack, d["df"])
                m = np.isin(d["days_bars"], d["fold"]) & ~np.isnan(preds) & ~np.isnan(d["y_bars"]) & (d["y_bars"] != 0)
                row, _ = metrics(preds[m], d["y_bars"][m] * 1e4, "per-ticker", {"ticker": t})
                trades = daytrade.simulate(d["df"], preds, d["fold"], t, scfg)
                nets = [x["net_bps"] for x in trades]
                row["simulate_net_bps"] = round(float(np.mean(nets)), 2) if nets else None
                row["simulate_trades"] = len(nets)
                return row
            finally:
                daytrade._device_slots().put(dev)

        lock = threading.Lock()
        todo = [t for t in tickers if t not in done]
        with ThreadPoolExecutor(max_workers=6) as ex:
            for f in as_completed([ex.submit(baseline, t) for t in todo]):
                row = f.result()
                with lock:
                    done[row["ticker"]] = row
                    out.append(row)
                    part_path.write_text(json.dumps(list(done.values())))
                print(json.dumps(row), flush=True)

        # ---- pooled: one shared net over every ticker's training windows --------
        xs_tr = np.concatenate([per[t]["X"][per[t]["tr"]] for t in tickers])
        ys_tr = np.concatenate([(per[t]["y_end"][per[t]["tr"]] / per[t]["y_sd"]) for t in tickers])
        xs_va = np.concatenate([per[t]["X"][per[t]["va"]] for t in tickers])
        ys_va = np.concatenate([(per[t]["y_end"][per[t]["va"]] / per[t]["y_sd"]) for t in tickers])
        cap = 2_500_000
        if len(xs_tr) > cap:                       # keep CPU/GPU memory sane
            keep = np.random.default_rng(0).choice(len(xs_tr), cap, replace=False)
            xs_tr, ys_tr = xs_tr[keep], ys_tr[keep]
        xt = torch.from_numpy(xs_tr)
        yt = torch.from_numpy(ys_tr.astype(np.float32))[:, None]
        xv = torch.from_numpy(xs_va)
        yv = torch.from_numpy(ys_va.astype(np.float32))[:, None]
        print(f"pooled train windows: {len(xt)} (capped at {cap}), val {len(xv)}", flush=True)
        dev = daytrade._device_slots().get()
        pbatch = 32768                # big steps keep the GPU busy (net is tiny)
        torch.manual_seed(0)
        net = daytrade._net_class(len(cols), units)().to(dev)
        ckpt = Path(f"{LOGS}/edge_lab_pool_net.pt")
        if ckpt.exists():
            net.load_state_dict(torch.load(ckpt, map_location=dev))
            net.eval()
            print("pooled net: loaded from checkpoint", flush=True)
        else:
            opt = torch.optim.Adam(net.parameters(), lr=float(cfg["learning_rate"]),
                                   weight_decay=float(cfg["weight_decay"]))
            loss_fn = torch.nn.MSELoss()
            best, best_state, bad = float("inf"), None, 0
            for ep in range(epochs):
                net.train()
                perm = torch.randperm(len(xt))
                for i in range(0, len(xt), pbatch):
                    idx = perm[i:i + pbatch]
                    opt.zero_grad()
                    loss = loss_fn(net(xt[idx].to(dev)), yt[idx].to(dev))
                    loss.backward()
                    opt.step()
                net.eval()
                with torch.no_grad():
                    vl = 0.0
                    for i in range(0, len(xv), 4096):
                        vl += float(loss_fn(net(xv[i:i + 4096].to(dev)), yv[i:i + 4096].to(dev))) * len(xv[i:i + 4096])
                    vl /= len(xv)
                if vl < best - 1e-5:
                    best, bad = vl, 0
                    best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
                else:
                    bad += 1
                    if bad >= patience:
                        break
            if best_state is not None:
                net.load_state_dict(best_state)
            net.eval()
            torch.save(net.state_dict(), ckpt)
            print(f"pooled net trained ({epochs} max epochs, val loss {best:.5f}) — checkpointed", flush=True)

        for t in tickers:
            d = per[t]
            with torch.no_grad():
                ps = []
                for i in range(0, len(d["X"]), 4096):
                    xb = torch.from_numpy(d["X"][i:i + 4096]).to(dev)
                    ps.append(net(xb).cpu().numpy()[:, 0])
            p_end = np.concatenate(ps) * d["y_sd"] * 1e4
            te_pos = np.where(d["te"])[0]
            p_te, yy = p_end[te_pos], d["y_end"][te_pos]
            row, _ = metrics(p_te, yy, "pooled", {"ticker": t})
            preds = np.full(len(d["df"]), np.nan)
            preds[d["end"][te_pos]] = p_te
            trades = daytrade.simulate(d["df"], preds, d["fold"], t, scfg)
            nets = [x["net_bps"] for x in trades]
            row["simulate_net_bps"] = round(float(np.mean(nets)), 2) if nets else None
            row["simulate_trades"] = len(nets)
            out.append(row)
            print(json.dumps(row), flush=True)
    finally:
        if dev:
            daytrade._device_slots().put(dev)
    with open(f"{LOGS}/edge_lab_pool.json", "w") as f:
        json.dump(out, f, indent=1)
    print("DONE pool", flush=True)

def classics() -> None:
    """Experiment 6: classic intraday strategies on real bars vs the honest
    gate — the rules real day traders use, no neural net, no synthetic data.
    Each strategy expresses 'expects a move beyond the cost bar' as ±8 bps;
    the normal exits (stop/target/time) and costs apply as usual."""
    h, fold_n = 30, 60                    # 60 sessions: classic rules trade ~1/day
    cfg = {**knobs.defaults(), "start_equity": 25000.0}
    sig = 8.0
    out = []
    for t in ("AAPL", "MSFT", "NVDA", "MU", "SPY", "KO", "JPM", "CVX"):
        df = daytrade.fetch_history(t)
        if df.empty:
            continue
        feats = daytrade.features(df)
        y = daytrade.forward_return(df, h) * 1e4
        days = sorted(set(df.index.date))
        fold = days[-fold_n:]
        days_arr = np.array(df.index.date)
        prior = days_arr < fold[0]
        sd = {c: float(np.nanstd(feats[c].values[prior])) or 1e-9
              for c in ("vwap_dist", "r15", "gap")}
        close = df["Close"].values
        hi, lo = df["High"].values, df["Low"].values
        n = len(df)
        preds = {k: np.full(n, np.nan) for k in
                 ("ORB 30m breakout", "VWAP reversion", "15m momentum", "gap fade")}
        # per-day state: opening range and how many bars seen today
        cur_day, hi30, lo30, seen = None, -np.inf, np.inf, 0
        for i in range(n):
            d = days_arr[i]
            if d != cur_day:
                cur_day, hi30, lo30, seen = d, -np.inf, np.inf, 0
            if seen < 30:                      # build the opening range
                hi30, lo30 = max(hi30, hi[i]), min(lo30, lo[i])
                seen += 1
                continue
            if close[i] > hi30:
                preds["ORB 30m breakout"][i] = sig
            elif close[i] < lo30:
                preds["ORB 30m breakout"][i] = -sig
            vd = feats["vwap_dist"].values[i]
            if vd < -1.5 * sd["vwap_dist"]:
                preds["VWAP reversion"][i] = sig
            elif vd > 1.5 * sd["vwap_dist"]:
                preds["VWAP reversion"][i] = -sig
            r15 = feats["r15"].values[i]
            if r15 > 1.5 * sd["r15"]:
                preds["15m momentum"][i] = sig
            elif r15 < -1.5 * sd["r15"]:
                preds["15m momentum"][i] = -sig
            g = feats["gap"].values[i]
            if g > 1.5 * sd["gap"]:
                preds["gap fade"][i] = -sig
            elif g < -1.5 * sd["gap"]:
                preds["gap fade"][i] = sig
        for name, p in preds.items():
            m = np.isin(days_arr, fold) & ~np.isnan(p) & ~np.isnan(y) & (y != 0)
            if not m.any():
                continue
            trades = daytrade.simulate(df, p, fold, t, cfg)
            edge = daytrade.edge_metrics(trades, len(fold), h)
            edge["direction_hit_pct"] = round(float((np.sign(p[m]) == np.sign(y[m])).mean() * 100), 1)
            edge["has_edge"] = daytrade.edge_ok(edge, cfg)
            row = {"ticker": t, "strategy": name, "signal_bars": int(m.sum()),
                   "direction_hit_pct": edge["direction_hit_pct"],
                   "trades": edge["trades"], "avg_net_bps": edge["avg_net_bps"],
                   "win_rate_pct": edge["win_rate_pct"], "GATE_FIRES": edge["has_edge"]}
            out.append(row)
            print(json.dumps(row), flush=True)
    with open(f"{LOGS}/edge_lab_classics.json", "w") as f:
        json.dump(out, f, indent=1)
    print("DONE classics", flush=True)


def usd_exits() -> None:
    """Experiment 7: do the account-dollar exits (trail_profit_usd) make the
    no-edge models profitable?  The user's replays say yes, but replay models
    are trained THROUGH the replayed day (in-sample).  Here every test block is
    scored by a model trained only on earlier sessions, trading the exact live
    rules + saved config twice: dollar exits off (the gate's view) vs on
    (trail $100 on a realistic ~$107k book)."""
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed

    saved = {}
    try:
        with open("/opt/Warden/trading/.alpha-stack/daytrade/state.json") as f:
            saved = json.load(f).get("config", {})
    except OSError:
        pass
    base_cfg = {**knobs.defaults(), **{k: v for k, v in saved.items()
                                       if k in knobs.defaults()}}
    take_cfg = {**base_cfg, "start_equity": 107255.0,   # the live book's equity
                "take_profit_usd": 100.0, "trail_profit_usd": 0.0,
                "daily_take_usd": 0.0, "max_daily_loss_usd": 0.0}
    trail_cfg = {**base_cfg, "start_equity": 107255.0,
                 "take_profit_usd": 0.0, "trail_profit_usd": 100.0,
                 "daily_take_usd": 0.0, "max_daily_loss_usd": 0.0}
    tickers = ["AAPL", "MSFT", "NVDA", "MU", "TXN", "V", "JPM", "GEV", "CVX", "KO", "SPY"]
    n_blocks, block_n = 4, 15            # 60 test sessions, walk-forward

    def simulate_usd(df, preds, days, t, cfg):
        scfg = {**cfg, "max_positions": 1}
        book = daytrade.Book(scfg, {"start_equity": float(cfg["start_equity"])})
        atr = daytrade.atr_px(df).values
        idx_days = np.array(df.index.date)
        o, h, l, c = (df[k].values for k in ("Open", "High", "Low", "Close"))
        force = {"force_edge": True}
        for d in days:
            b = daytrade.session_bounds(d)
            if not b:
                continue
            for i in np.where(idx_days == d)[0]:
                bt = df.index[i].to_pydatetime()
                bar = {"open": o[i], "high": h[i], "low": l[i], "close": c[i]}
                book.roll_day(d.isoformat(), {t: c[i]})
                daytrade.on_bar(book, t, bt, bar, preds[i], atr[i], force, scfg,
                                True, b[1], {t: c[i]})
            if t in book.positions:
                j = np.where(idx_days == d)[0][-1]
                book.close(t, c[j], df.index[j].to_pydatetime(), "session end", scfg)
        return book.trades

    def one(t):
        dev = daytrade._device_slots().get()
        try:
            df = daytrade.fetch_history(t)
            days = sorted(set(df.index.date))
            test = days[-(n_blocks * block_n):]
            rows = []
            for k in range(n_blocks):
                block = test[k * block_n:(k + 1) * block_n]
                prior = [d for d in days if d < block[0]]
                pack = daytrade.fit(df, prior, base_cfg, device=dev)
                preds = daytrade.predict(pack, df)
                tb = daytrade.simulate(df, preds, block, t, base_cfg)
                tk = simulate_usd(df, preds, block, t, take_cfg)
                tr = simulate_usd(df, preds, block, t, trail_cfg)
                rows.append({
                    "ticker": t, "block": f"{-60 + k * 15}..{-45 + k * 15}",
                    "base_trades": len(tb), "base_net_bps": round(float(np.mean([x["net_bps"] for x in tb])), 2) if tb else None,
                    "take_trades": len(tk), "take_net_bps": round(float(np.mean([x["net_bps"] for x in tk])), 2) if tk else None,
                    "take_pnl": round(sum(x["pnl"] for x in tk), 2),
                    "trail_trades": len(tr), "trail_net_bps": round(float(np.mean([x["net_bps"] for x in tr])), 2) if tr else None,
                    "trail_pnl": round(sum(x["pnl"] for x in tr), 2),
                })
            return rows
        finally:
            daytrade._device_slots().put(dev)

    daytrade.set_train_workers(6)
    out = []
    lock = threading.Lock()
    with ThreadPoolExecutor(max_workers=6) as ex:
        for f in as_completed([ex.submit(one, t) for t in tickers]):
            rows = f.result()
            with lock:
                out.extend(rows)
            for r in rows:
                print(json.dumps(r), flush=True)
    with open(f"{LOGS}/edge_lab_usd_exits.json", "w") as f:
        json.dump(out, f, indent=1)
    for arm, nb, pl in (("base", "base_net_bps", None), ("take100", "take_net_bps", "take_pnl"),
                        ("trail100", "trail_net_bps", "trail_pnl")):
        bbs = [r[nb] for r in out if r.get(nb) is not None]
        pls = sum(r[pl] for r in out) if pl else 0.0
        print(f"{arm}: avg {np.mean(bbs):.2f} bps/trade over {len(bbs)} blocks"
              + (f", total ${pls:.2f}" if pl else ""), flush=True)
    print("DONE usd-exits", flush=True)


def pool_validate() -> None:
    """Experiment 8: does the pooled net's newest-fold promise hold across
    earlier folds?  Same pooling recipe as pool() (one shared net, per-ticker
    standardisation + y_sd scaling), four non-overlapping 25-session folds,
    each net trained ONLY on days before its fold.  GATE_FIRES is the engine's
    real gate (edge_ok, direction measured over ALL scored fold bars)."""
    import torch
    from pathlib import Path

    h, thr, fold_len = 30, 4.0, 25
    tickers = ["AAPL", "MSFT", "NVDA", "AMD", "MU", "TSLA", "META", "AMZN", "GOOGL", "NFLX",
               "INTC", "QCOM", "AVGO", "TXN", "SMCI", "PLTR", "COIN", "MSTR", "SOFI", "PYPL",
               "JPM", "BAC", "GS", "MS", "C", "V", "MA", "XOM", "CVX", "KO"]
    cfg = {**knobs.defaults()}
    cols = list(cfg["features"])
    look_back, units = int(cfg["look_back"]), int(cfg["hidden_units"])
    epochs, patience = int(cfg["max_epochs"]), int(cfg["patience"])
    scfg = {**knobs.defaults(), "start_equity": 25000.0}
    out_path = Path(f"{LOGS}/edge_lab_pool_validate.json")
    out = []
    if out_path.exists():
        try:
            out = json.loads(out_path.read_text())
        except Exception:
            out = {}
    done = {(r["ticker"], r["fold"]) for r in out}
    ckpt_dir = Path(f"{LOGS}/pool_validate")
    ckpt_dir.mkdir(exist_ok=True)
    dev = None
    try:
        per = {}
        for t in tickers:
            df = daytrade.fetch_history(t)
            per[t] = {"df": df,
                      "feats": daytrade.features(df)[cols].values.astype(np.float64),
                      "y": daytrade.forward_return(df, h),
                      "days": np.array(df.index.date),
                      "all_days": sorted(set(df.index.date))}
            print(f"loaded {t}", flush=True)
        for k in range(4):
            label = f"{-fold_len*(k+1)}..{-fold_len*k}" if k else f"-{fold_len}..0"
            ckpt = ckpt_dir / f"net_{label}.pt"
            foldinfo = {}
            for t in tickers:
                d = per[t]
                fold = (d["all_days"][-fold_len*(k+1):-fold_len*k] if k
                        else d["all_days"][-fold_len:])
                prior = [x for x in d["all_days"] if x < fold[0]]
                n_val = max(2, int(round(len(prior) * cfg["val_share_pct"] / 100)))
                fit_days, val_days = set(prior[:-n_val]), set(prior[-n_val:])
                in_fit = np.isin(d["days"], list(fit_days))
                mu = d["feats"][in_fit].mean(0)
                sd = np.where(d["feats"][in_fit].std(0) == 0, 1.0, d["feats"][in_fit].std(0))
                z = np.clip((d["feats"] - mu) / sd, -6, 6)
                X = daytrade._windows(z, look_back)
                end = np.arange(look_back - 1, len(z))
                y_end = d["y"][end]
                ok = ~np.isnan(y_end)
                days_end = d["days"][end]
                tr = ok & np.isin(days_end, list(fit_days))
                va = ok & np.isin(days_end, list(val_days))
                te = ok & np.isin(days_end, fold)
                foldinfo[t] = {"fold": fold, "X": X, "y_end": y_end, "end": end,
                              "tr": tr, "va": va, "te": te,
                              "y_sd": float(np.nanstd(y_end[tr])) or 1e-3}
            dev = daytrade._device_slots().get()
            net = daytrade._net_class(len(cols), units)().to(dev)
            if ckpt.exists():
                net.load_state_dict(torch.load(ckpt, map_location=dev))
                net.eval()
                print(f"fold {label}: loaded net checkpoint", flush=True)
            else:
                xs_tr = np.concatenate([foldinfo[t]["X"][foldinfo[t]["tr"]] for t in tickers])
                ys_tr = np.concatenate([(foldinfo[t]["y_end"][foldinfo[t]["tr"]] / foldinfo[t]["y_sd"])
                                        for t in tickers])
                xs_va = np.concatenate([foldinfo[t]["X"][foldinfo[t]["va"]] for t in tickers])
                ys_va = np.concatenate([(foldinfo[t]["y_end"][foldinfo[t]["va"]] / foldinfo[t]["y_sd"])
                                        for t in tickers])
                cap = 2_500_000
                if len(xs_tr) > cap:
                    keep = np.random.default_rng(0).choice(len(xs_tr), cap, replace=False)
                    xs_tr, ys_tr = xs_tr[keep], ys_tr[keep]
                xt = torch.from_numpy(xs_tr)
                yt = torch.from_numpy(ys_tr.astype(np.float32))[:, None]
                xv = torch.from_numpy(xs_va)
                yv = torch.from_numpy(ys_va.astype(np.float32))[:, None]
                print(f"fold {label}: {len(xt)} pooled train windows (cap {cap}), val {len(xv)}", flush=True)
                torch.manual_seed(0)
                opt = torch.optim.Adam(net.parameters(), lr=float(cfg["learning_rate"]),
                                       weight_decay=float(cfg["weight_decay"]))
                loss_fn = torch.nn.MSELoss()
                best, best_state, bad = float("inf"), None, 0
                pbatch = 32768
                for ep in range(epochs):
                    net.train()
                    perm = torch.randperm(len(xt))
                    for i in range(0, len(xt), pbatch):
                        idx = perm[i:i + pbatch]
                        opt.zero_grad()
                        loss = loss_fn(net(xt[idx].to(dev)), yt[idx].to(dev))
                        loss.backward()
                        opt.step()
                    net.eval()
                    with torch.no_grad():
                        vl = 0.0
                        for i in range(0, len(xv), 4096):
                            vl += float(loss_fn(net(xv[i:i + 4096].to(dev)), yv[i:i + 4096].to(dev))) * len(xv[i:i + 4096])
                        vl /= len(xv)
                    if vl < best - 1e-5:
                        best, bad = vl, 0
                        best_state = {kk: v.detach().clone() for kk, v in net.state_dict().items()}
                    else:
                        bad += 1
                        if bad >= patience:
                            break
                if best_state is not None:
                    net.load_state_dict(best_state)
                net.eval()
                torch.save(net.state_dict(), ckpt)
                print(f"fold {label}: trained, val loss {best:.5f}", flush=True)
            for t in tickers:
                if (t, label) in done:
                    continue
                fi, d = foldinfo[t], per[t]
                with torch.no_grad():
                    ps = []
                    for i in range(0, len(fi["X"]), 4096):
                        xb = torch.from_numpy(fi["X"][i:i + 4096]).to(dev)
                        ps.append(net(xb).cpu().numpy()[:, 0])
                p_end = np.concatenate(ps) * fi["y_sd"] * 1e4
                te_pos = np.where(fi["te"])[0]
                p_te, yy = p_end[te_pos], fi["y_end"][te_pos] * 1e4
                trd = np.abs(p_te) > thr
                d_all = round(float((np.sign(p_te) == np.sign(yy)).mean() * 100), 1)
                preds = np.full(len(d["df"]), np.nan)
                preds[fi["end"][te_pos]] = p_te
                trades = daytrade.simulate(d["df"], preds, fi["fold"], t, scfg)
                nets = [x["net_bps"] for x in trades]
                edge = daytrade.edge_metrics(trades, len(fi["fold"]), h)
                edge["direction_hit_pct"] = d_all
                row = {"ticker": t, "fold": label,
                       "direction_all_bars": d_all,
                       "hit_traded": round(float((np.sign(p_te[trd]) == np.sign(yy[trd])).mean() * 100), 1) if trd.any() else None,
                       "bars_traded": int(trd.sum()),
                       "trades": edge["trades"], "net_bps": edge["avg_net_bps"],
                       "GATE_FIRES": daytrade.edge_ok(edge, cfg)}
                out.append(row)
                out_path.write_text(json.dumps(out, indent=1))
                print(json.dumps(row), flush=True)
    finally:
        if dev:
            daytrade._device_slots().put(dev)
    print("DONE pool-validate", flush=True)


if __name__ == "__main__":
    {"economics": economics, "objective": objective, "cross": cross, "pool": pool,
     "classics": classics, "usd_exits": usd_exits,
     "pool_validate": pool_validate}[sys.argv[1]]()
