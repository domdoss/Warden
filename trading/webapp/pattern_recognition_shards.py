#!/usr/bin/env python3
"""Parallel scheduler for pattern_recognition_validation.py — scheduling only.

One subprocess per (ticker, arm), each appending to its own
logs/pattern_recognition_<T>_<arm>.log and passing that same log as
--skip-log, so a relaunch after a crash resumes: finished shards exit at
once, nothing is double-counted. The validator's parameters are untouched.

k-NN shards run their candidate search on the GPUs (round-robin); GBM
shards are CPU (OpenMP threads capped per process). A new shard starts only
while fewer than --max-procs run AND the running shards' measured peak
RSS (EST_GB) fits --mem-budget-gb — memory, not cores, is the limit here.

  nohup ./bin/python webapp/pattern_recognition_shards.py \
      --tickers MSFT,MU,TXN,V,JPM,GEV,CVX,KO \
      --cache-dir .alpha-stack/daytrade/alpaca_deep_20260922 \
      >> logs/pattern_recognition_shards.log 2>&1 &
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/opt/Warden/trading")
PY = str(ROOT / "bin" / "python")
SCRIPT = str(ROOT / "webapp" / "pattern_recognition_validation.py")


# Minimum deep-history depth (a truncated 1-year cache has ~251 sessions).
# 2021-09-01..2026-09-22 is 1268-1269 regular sessions depending on the
# ticker (V/KO: 1268); GEV since its 2024-04 spin-off = 621.
EXPECT = {"GEV": 615}
EXPECT_DEFAULT = 1260
# Measured peak RSS on MSFT 5y (logs/pr_parity): gbmall 8.0 GB, knn 3.1 GB;
# gbm1y is bounded by the same full-length window view, smaller train matrix.
EST_GB = {"gbmall": 8.5, "gbm1y": 4.0, "knn": 3.5}


def mem_avail_gb() -> float:
    for ln in open("/proc/meminfo"):
        if ln.startswith("MemAvailable:"):
            return int(ln.split()[1]) / 1024 / 1024
    return 0.0


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", required=True)
    ap.add_argument("--arms", default="knn,gbm1y,gbmall")
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--gpus", default="cuda:0,cuda:1")
    ap.add_argument("--max-procs", type=int, default=20)
    ap.add_argument("--mem-budget-gb", type=float, default=14.0,
                    help="sum of EST_GB over running shards stays under this")
    ap.add_argument("--gbm-threads", type=int, default=2)
    ap.add_argument("--stress", action="store_true")
    ap.add_argument("--exclude", default="",
                    help="T:arm pairs already running elsewhere, e.g. MSFT:gbmall")
    args = ap.parse_args()
    gpus = [g for g in args.gpus.split(",") if g]
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    # gbmall first (longest), then gbm1y, then knn: the long poles start early.
    order = {"gbmall": 0, "gbm1y": 1, "knn": 2}
    queue = sorted(((t, a) for t in tickers for a in arms), key=lambda x: order[x[1]])
    excl = {tuple(x.strip().upper().split(":")) for x in args.exclude.split(",") if x.strip()}
    queue = [(t, a) for t, a in queue if (t, a.upper()) not in excl]
    running: dict = {}
    gi = 0
    sfx = "_stress" if args.stress else ""
    while queue or running:
        for key, (p, t0) in list(running.items()):
            rc = p.poll()
            if rc is not None:
                log(f"END {key[0]} {key[1]} rc={rc} wall_s={time.time() - t0:.0f}")
                del running[key]
        while queue and len(running) < args.max_procs:
            used = sum(EST_GB[k[1]] for k in running)
            pick = next((q for q in queue if used + EST_GB[q[1]] <= args.mem_budget_gb), None)
            if pick is None:
                # Nothing fits right now. If no queued shard can EVER fit the
                # budget (even with nothing running), that is a launch error,
                # not a wait state — die loudly instead of sleeping forever.
                # (2026-09-22: a --mem-budget-gb 8 rerun could never fit the
                # 8.5 GB gbmall cell and wedged silently for hours.)
                if not running and all(EST_GB[q[1]] > args.mem_budget_gb for q in queue):
                    log(f"FATAL no queued shard fits --mem-budget-gb {args.mem_budget_gb}: {queue}")
                    sys.exit(1)
                break
            queue.remove(pick)
            t, a = pick
            lp = ROOT / "logs" / f"pattern_recognition_{t}_{a}{sfx}.log"
            cmd = [PY, SCRIPT, "--tickers", t, "--arms", a, "--cache-dir", args.cache_dir,
                   "--skip-log", str(lp),
                   "--expect-sessions", str(EXPECT.get(t, EXPECT_DEFAULT))] + (["--stress"] if args.stress else [])
            env = dict(os.environ)
            if a == "knn":
                cmd += ["--device", gpus[gi % len(gpus)]] if gpus else []
                gi += 1
                env["OMP_NUM_THREADS"] = env["OPENBLAS_NUM_THREADS"] = env["MKL_NUM_THREADS"] = "2"
            else:
                n = str(args.gbm_threads)
                env["OMP_NUM_THREADS"] = env["OPENBLAS_NUM_THREADS"] = env["MKL_NUM_THREADS"] = n
            fh = open(lp, "a")
            p = subprocess.Popen(cmd, cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT, env=env)
            running[(t, a)] = (p, time.time())
            log(f"START {t} {a} pid={p.pid} {' '.join(cmd[-2:]) if a == 'knn' else ''} "
                f"mem_avail_gb={mem_avail_gb():.1f}")
            time.sleep(2)
        time.sleep(15)
    log("DONE pattern-recognition-shards")


if __name__ == "__main__":
    sys.exit(main())
