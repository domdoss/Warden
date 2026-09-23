#!/usr/bin/env python3
"""Run ofi_validation as flow sessions land; stress GATE_FIRES cells.

Launched under nohup alongside the alpaca_flow backfill. Every 10 minutes
it counts complete backfilled sessions (quotes AND trades on disk) per
engine ticker and:
- runs ofi_validation.py once SOME ticker has >= 30 complete sessions
  (don't wait for all 10), then again each time the best per-ticker
  count grows by >= 10 — ofi_validation itself is idempotent (day-rows
  already in logs/ofi_validation.log are skipped, only new days are
  scored);
- runs `ofi_validation.py --stress` after each validation pass (auto
  mode: only GATE_FIRES cells not already stressed at their current
  fired-fold count are re-stressed — a cell that keeps passing as
  history grows gets re-stressed, one already graded at this size does
  not);
- exits once the alpaca_flow process is gone and a final validation +
  stress pass has completed.

No retries and no masking: a dead backfill or a non-zero validation exit
is logged as a fact and the driver ends where its rules say it ends.
Log: logs/ofi_driver.log.
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

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
OFI = str(Path(__file__).resolve().parent / "ofi_validation.py")
DRIVER_LOG = ROOT / "logs" / "ofi_driver.log"
POLL_S = 600
MIN_SESSIONS = 30
GROW = 10


def _log(msg: str) -> None:
    DRIVER_LOG.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(alpaca_flow.ET).strftime("%Y-%m-%d %H:%M:%S")
    with open(DRIVER_LOG, "a", encoding="utf-8") as fh:
        fh.write(f"{stamp} {msg}\n")


def complete_counts() -> dict:
    """Complete sessions on disk per engine ticker (quotes + trades)."""
    out = {}
    for t in alpaca_flow.ENGINE_TICKERS:
        q = {p.name.split("_")[2][:8]
             for p in alpaca_flow.FLOW_DIR.glob(f"{t}_sip_*.parquet")}
        i = {p.name.split("_")[2][:8]
             for p in alpaca_flow.FLOW_DIR.glob(f"{t}_iex_*.parquet")}
        out[t] = len(q & i)
    return out


def backfill_alive() -> bool:
    return subprocess.run(["pgrep", "-f", "alpaca_flow.py"],
                          capture_output=True).returncode == 0


def run_pass() -> None:
    _log("validation start")
    p = subprocess.run([PY, OFI], cwd=ROOT)
    _log(f"validation exit={p.returncode}")
    _log("stress pass start")
    s = subprocess.run([PY, OFI, "--stress"], cwd=ROOT)
    _log(f"stress pass exit={s.returncode}")


def main() -> None:
    _log(f"driver start pid={os.getpid()} min_sessions={MIN_SESSIONS} "
         f"grow={GROW} poll_s={POLL_S}")
    best_last = 0
    while True:
        counts = complete_counts()
        best = max(counts.values()) if counts else 0
        if best >= MIN_SESSIONS and best >= best_last + GROW:
            _log(f"counts {counts} best={best} (last ran at {best_last})")
            run_pass()
            best_last = best
        if not backfill_alive():
            _log("backfill process gone — final pass")
            run_pass()
            _log("driver done")
            return
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()