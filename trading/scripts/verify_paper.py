#!/opt/Warden/trading/bin/python
"""One-shot verification of the paper-trading pipeline.

Replays the most recent completed run from .alpha-stack/runs.jsonl through
the paper broker, runs the daily housekeeping pass, prints the resulting
account state, checks idempotency, then resets the account to a clean
$100k start (the replayed decision is stale test data).

⚠ The reset at the end WIPES positions, trades and history — do not run
this after seeding the portfolio (scripts/seed_portfolio.py) unless you
mean to start over.

Usage:
    trading/bin/python scripts/verify_paper.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

WEBAPP = Path(__file__).resolve().parent.parent / "webapp"
sys.path.insert(0, str(WEBAPP))

import paper  # noqa: E402


def main() -> int:
    runs_log = paper.ACCURACY_PATH.parent / "runs.jsonl"
    with runs_log.open("r", encoding="utf-8") as fh:
        recs = [json.loads(line) for line in fh if line.strip()]
    done = [r for r in recs if any(t.get("status") == "done" for t in r.get("tickers", []))]
    if not done:
        print("no completed run in runs.jsonl to replay")
        return 1
    record = done[-1]
    print(f"replaying run {record['run_id']}")

    executed = paper.execute_run_decisions(record)
    print("\n=== booked from decision ===")
    print(json.dumps(executed, indent=2))

    summary = paper.daily_pass()
    print("\n=== daily pass ===")
    print(json.dumps(summary, indent=2))

    p = paper.load_paper()
    print("\n=== positions ===")
    print(json.dumps(p["positions"], indent=2))
    print("\n=== trades ===")
    print(json.dumps(p["trades"], indent=2))
    print("\ncash:", round(p["cash"], 2))

    again = paper.execute_run_decisions(record)
    print("re-execute same run (idempotency) ->", again)

    overview = paper.paper_overview()
    print("\n=== overview (what /api/paper returns) ===")
    print(json.dumps({k: overview[k] for k in
                      ("cash", "equity", "start_equity", "total_pnl",
                       "return_pct", "positions", "pending_trades")},
                     indent=2, default=str)[:1500])

    print("\naccuracy scorecard (empty until horizons mature):")
    print(json.dumps(paper.scorecard(), indent=2)[:400])

    # Leave a clean account for the first real nightly run.
    paper.reset()
    print("\naccount reset to a clean $", paper.START_EQUITY, " start")
    return 0


if __name__ == "__main__":
    sys.exit(main())