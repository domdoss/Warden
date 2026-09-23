#!/usr/bin/env python3
"""Run tradesize_validation + opening_validation as flow sessions land.

ofi_driver.py's shape: every 10 minutes count complete backfilled sessions
(quotes AND trades on disk) per engine ticker and
- run both validators (each followed by its --stress auto-pass) once the
  best per-ticker count has grown by >= 10 since the last pass (the first
  pass is the manual one at launch time: best_last starts at the count
  when the driver starts);
- exit once the alpaca_flow process is gone and one final pass is done.
Both validators are idempotent (day rows already in their logs are
skipped). No API calls, no retries: a non-zero exit is logged as a fact.
Log: logs/flow_structure_driver.log.

Launch:
    cd /opt/Warden/trading && nohup ./bin/python webapp/flow_structure_driver.py \
        >> logs/flow_structure_driver_stdout.log 2>&1 &
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import alpaca_flow  # noqa: E402
from ofi_driver import complete_counts, backfill_alive  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
HERE = Path(__file__).resolve().parent
SCRIPTS = [str(HERE / "tradesize_validation.py"), str(HERE / "opening_validation.py")]
DRIVER_LOG = ROOT / "logs" / "flow_structure_driver.log"
POLL_S = 600
GROW = 10


def _log(msg: str) -> None:
    DRIVER_LOG.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(alpaca_flow.ET).strftime("%Y-%m-%d %H:%M:%S")
    with open(DRIVER_LOG, "a", encoding="utf-8") as fh:
        fh.write(f"{stamp} {msg}\n")


def run_pass() -> None:
    for s in SCRIPTS:
        name = Path(s).stem
        p = subprocess.run([PY, s], cwd=ROOT)
        _log(f"{name} exit={p.returncode}")
        q = subprocess.run([PY, s, "--stress"], cwd=ROOT)
        _log(f"{name} --stress exit={q.returncode}")


def main() -> None:
    counts = complete_counts()
    best_last = max(counts.values()) if counts else 0
    _log(f"driver start pid={os.getpid()} grow={GROW} poll_s={POLL_S} "
         f"counts at start {counts}")
    while True:
        counts = complete_counts()
        best = max(counts.values()) if counts else 0
        if best >= best_last + GROW:
            _log(f"counts {counts} best={best} (last ran at {best_last})")
            run_pass()
            best_last = best
        if not backfill_alive():
            _log(f"backfill process gone — final pass, counts {complete_counts()}")
            run_pass()
            _log("driver done")
            return
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
