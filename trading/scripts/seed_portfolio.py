#!/opt/Warden/trading/bin/python
"""Seed the paper-trading account with a realistic historical portfolio.

For every ticker in the state portfolio, picks an entry date at random in
the past two years, sizes a long position (whole shares, varying weights)
so the total cost basis lands on ~$50k, and leaves ~$50k cash — $100k
total to trade with. Entries at random past dates mean some positions are
up and some are down at today's mark; the seeder re-rolls until at least
3 winners and 3 losers are present.

The seeded positions carry no stops/targets/horizons, so the daily
housekeeping pass tracks but never touches them (paper.py's catch-up only
acts on non-None levels). Holdings are mirrored into state.json so the
Portfolio tab, union_tickers and the correlation heat all agree with the
ledger. A daily_pass() at the end exercises the plumbing.

Usage:
    trading/bin/python scripts/seed_portfolio.py [--seed N] [--force]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent      # trading/
WEBAPP = ROOT / "webapp"
sys.path.insert(0, str(WEBAPP))

import paper    # noqa: E402
import signals  # noqa: E402

STATE_PATH = Path(json.loads((WEBAPP / "config.json").read_text())["state_file"])
TOTAL_EQUITY = paper.START_EQUITY          # 100k
DEPLOYED = TOTAL_EQUITY / 2                # ~50k cost basis, ~50k cash
MIN_WINNERS = 3
MIN_LOSERS = 3
# Marked value must stay near DEPLOYED so total equity stays near
# TOTAL_EQUITY — otherwise one lucky 2-year-old entry (MU bought at $124,
# now $1000+) turns the "100k to work with" into 140k.
VALUE_DRIFT = 0.15
ENTRY_WINDOW_DAYS = 730
ENTRY_BUFFER_DAYS = 14                     # no entries in the last two weeks
MAX_ATTEMPTS = 60


def load_state() -> dict:
    return json.loads(STATE_PATH.read_text())


def save_state(state: dict) -> None:
    tmp = STATE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, ensure_ascii=False)
    tmp.replace(STATE_PATH)


def close_series_2y(ticker: str) -> pd.Series:
    s = signals.close_series(ticker, "2y")
    if s is None or s.empty:
        raise SystemExit(f"no price data for {ticker} — aborting, nothing written")
    return s


def pick_positions(rng: random.Random, tickers: list[str],
                   series: dict[str, pd.Series]) -> list[dict]:
    """Roll entries+weights until the budget fits and the mix is up/down."""
    today = pd.Timestamp(datetime.utcnow().date())
    for _ in range(MAX_ATTEMPTS):
        entries: dict[str, tuple[pd.Timestamp, float]] = {}
        ok = True
        for t in tickers:
            s = series[t]
            idx = pd.DatetimeIndex(s.index)
            if idx.tz is not None:
                idx = idx.tz_localize(None)
            lo = max(idx[0], today - timedelta(days=ENTRY_WINDOW_DAYS))
            hi = today - timedelta(days=ENTRY_BUFFER_DAYS)
            cand = idx[(idx >= lo) & (idx <= hi)]
            if len(cand) == 0:
                print(f"skipping {t}: no bars in the 2y entry window", file=sys.stderr)
                ok = False
                break
            date = cand[rng.randrange(len(cand))]
            entries[t] = (date.normalize(), float(s.loc[date]))

        if not ok:
            # Re-roll without the data-less ticker rather than dying mid-attempt.
            continue

        # Varying weights, scaled so whole-share costs total ~DEPLOYED.
        weights = {t: rng.uniform(2500.0, 9500.0) for t in entries}
        scale = DEPLOYED / sum(weights.values())
        picks = []
        for t, (date, px) in entries.items():
            qty = max(1, int(weights[t] * scale / px))
            picks.append({"ticker": t, "date": date, "entry": px, "qty": qty})

        # Top up the undershoot (floor()) one share at a time, cheapest
        # price first, until within one share of the budget.
        spent = sum(p["qty"] * p["entry"] for p in picks)
        for p in sorted(picks, key=lambda p: p["entry"]):
            while DEPLOYED - spent >= p["entry"]:
                p["qty"] += 1
                spent += p["entry"]
        if DEPLOYED - spent > max(p["entry"] for p in picks):
            continue  # couldn't get close (huge share price); re-roll

        winners = sum(1 for p in picks if series[p["ticker"]].iloc[-1] > p["entry"])
        losers = len(picks) - winners
        marked = sum(p["qty"] * float(series[p["ticker"]].iloc[-1]) for p in picks)
        if (winners >= MIN_WINNERS and losers >= MIN_LOSERS
                and abs(marked - DEPLOYED) <= VALUE_DRIFT * DEPLOYED):
            return picks

    raise SystemExit(f"could not build a mixed, value-stable portfolio in "
                     f"{MAX_ATTEMPTS} attempts")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None,
                    help="RNG seed for a reproducible portfolio")
    ap.add_argument("--force", action="store_true",
                    help="overwrite an already-seeded account")
    args = ap.parse_args()

    state = load_state()
    tickers = [e["ticker"] for e in state.get("portfolio", []) if e.get("ticker")]
    if not tickers:
        raise SystemExit("state.json has no portfolio tickers to seed")

    existing = paper.load_paper()
    if existing["positions"] and not args.force:
        raise SystemExit("paper account already has positions — rerun with --force to overwrite")

    rng = random.Random(args.seed)
    series = {t: close_series_2y(t) for t in tickers}
    picks = pick_positions(rng, tickers, series)

    today_iso = datetime.utcnow().date().isoformat()
    ledger = paper._default_paper()
    total_cost = 0.0
    for p in picks:
        opened = p["date"].date().isoformat()
        ref = f"seed:{p['ticker']}:{opened}"
        ledger["positions"].append({
            "ticker": p["ticker"],
            "qty": round(p["qty"], 4),
            "side": "long",
            "entry_price": round(p["entry"], 4),
            "stop_loss": None,
            "take_profit": None,
            "horizon_days": None,
            "sizing_note": "seeded",
            "opened_at": opened,
            "decided_at": None,
            "decision_ref": ref,
            "run_id": None,
            "last_check": today_iso,
        })
        ledger["trades"].append({
            "ts": f"{opened}T14:00:00Z",
            "ticker": p["ticker"],
            "qty": round(p["qty"], 4),
            "price": round(p["entry"], 4),
            "reason": "seed",
            "pnl": None,
            "decision_ref": ref,
            "run_id": None,
            "decided_at": None,
        })
        total_cost += p["qty"] * p["entry"]

    ledger["cash"] = round(TOTAL_EQUITY - total_cost, 2)
    ledger["created"] = existing.get("created") or ledger["created"]
    equity = ledger["cash"] + sum(
        p["qty"] * float(series[p["ticker"]].iloc[-1]) for p in picks)
    ledger["equity_history"] = [{"date": today_iso, "equity": round(equity, 2),
                                 "cash": ledger["cash"]}]
    paper.save_paper(ledger)

    # Mirror the holdings into state.json so the Portfolio tab, run tickers
    # and correlation heat agree with the ledger. Also fix a stale default
    # (granite4.1:30b is not installed) so the next run can actually load.
    by_ticker = {p["ticker"]: p for p in picks}
    for entry in state.get("portfolio", []):
        p = by_ticker.get(entry.get("ticker"))
        if p:
            entry["qty"] = p["qty"]
            entry["entry_price"] = round(p["entry"], 4)
    state.setdefault("settings", {})["model"] = "granite4.2:30b"
    save_state(state)

    print(f"{'ticker':<7}{'entered':<12}{'qty':>6}{'entry':>10}{'now':>10}{'pnl':>10}")
    for p in picks:
        now = float(series[p["ticker"]].iloc[-1])
        pnl = (now - p["entry"]) * p["qty"]
        print(f"{p['ticker']:<7}{p['date'].date().isoformat():<12}{p['qty']:>6}"
              f"{p['entry']:>10.2f}{now:>10.2f}{pnl:>+10.2f}")
    print(f"\ncost basis: ${total_cost:,.2f}   cash: ${ledger['cash']:,.2f}   "
          f"equity now: ${equity:,.2f}")

    # Exercise the plumbing: fills, stop/horizon catch-up, marks, scoring.
    summary = paper.daily_pass()
    print(f"daily_pass ok: {summary['filled']} fill(s), {len(summary['events'])} event(s), "
          f"equity ${summary['equity']:,.2f}, cash ${summary['cash']:,.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())