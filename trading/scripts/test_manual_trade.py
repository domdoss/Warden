"""One-shot test for the manual paper-trade button (paper.manual_trade + wiring).

Books trades, checks validation and that manual trades never touch the
accuracy scorecard, prints the account, then resets to a clean $100k.
Run:   ~/alpha-stack/bin/python ~/alpha-stack/scripts/test_manual_trade.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "webapp"))
import paper  # noqa: E402

fails = []


def check(label, cond):
    print(("PASS  " if cond else "FAIL  ") + label)
    if not cond:
        fails.append(label)


# --- validation ---
r = paper.manual_trade("", "buy")
check("empty ticker rejected", "error" in r)
r = paper.manual_trade("MSFT", "yolo")
check("bad action rejected", "error" in r)
r = paper.manual_trade("BTC", "buy")
check("crypto rejected", "error" in r)
r = paper.manual_trade("ZZZZZZ", "buy")
check("no-data ticker rejected", "error" in r)

# --- a fully-parameterized manual buy ---
r = paper.manual_trade("MSFT", "buy", size_pct=8, stop_loss=380,
                       take_profit=520, horizon_days=56, note="manual test")
check("buy booked pending_open", r.get("status") == "pending_open")
p = paper.load_paper()
pt = p["pending_trades"][-1]
check("pending trade carries the stated parameters",
      pt["ticker"] == "MSFT"
      and pt["intent"]["size_pct"] == 8
      and pt["intent"]["stop_loss"] == 380
      and pt["intent"]["take_profit"] == 520
      and pt["intent"]["horizon_days"] == 56
      and pt["run_id"].startswith("manual-"))
check("manual trade not seeded into accuracy scoring",
      not any(s["ticker"] == "MSFT" for s in p["pending_scores"]))

# --- close/trim need a position ---
r = paper.manual_trade("MSFT", "close")
check("close with no position -> no_trade", r.get("status") == "no_trade")
r = paper.manual_trade("MSFT", "trim")
check("trim with no position -> no_trade", r.get("status") == "no_trade")

# --- default sizing when size omitted ---
r = paper.manual_trade("NVDA", "sell", stop_loss=200)
check("sell booked with default size",
      r.get("status") == "pending_open"
      and paper.load_paper()["pending_trades"][-1]["intent"]["size_pct"] == paper._DEFAULT_SIZE_PCT)

# --- overview (fill/stop pass) runs and reports ---
ov = paper.paper_overview()
check("overview sees the pending trades", len(ov["pending_trades"]) == 2)
print("  events:", ov["events"] or "none")
print("  pending:", ", ".join(t["ticker"] + " " + t["intent"]["action"]
                              for t in ov["pending_trades"]))

# --- clean up: the account was empty before this test ---
paper.reset()
p = paper.load_paper()
check("reset -> clean 100k",
      p["cash"] == 100000 and not p["positions"] and not p["pending_trades"])

print("\n" + ("ALL PASS" if not fails else f"FAILURES: {fails}"))