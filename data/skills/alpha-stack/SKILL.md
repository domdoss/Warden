---
name: alpha-stack
description: "Read the Alpha Stack trading system: paper-trading account (positions, P&L, equity, trades), portfolio holdings, watchlist, analysis runs and reports, backtest + accuracy scorecard. Use when the user asks about the trading/paper account, portfolio, tickers, runs, signals, or what Alpha Stack decided. Default read-only; only place a manual trade or reset the account when the user explicitly asks."
tools: ["Bash", "Read"]
---

# alpha-stack — how Warden reads the trading system

Alpha Stack lives on this machine at `/opt/Warden/trading/`. The webapp
(stdlib HTTP server, `127.0.0.1:8765`) is the canonical read surface; the
JSON files under `trading/.alpha-stack/` are the ground truth underneath it.

## First move: is the webapp up?

```bash
curl -s -m 3 http://127.0.0.1:8765/api/status
```

- Responds → use the API (tables below). Parse with `node -e` or `python3 -m json.tool` — no pretty-printer install.
- No response → the webapp is down (Warden auto-starts it only when the dashboard's Alpha Stack view is opened). Read the JSON files directly (section "Ground truth") — they are complete; do NOT start the server yourself unless the user asked.

## API (default surface, all GET unless noted)

| Endpoint | Returns |
|---|---|
| `/api/status` | service status snapshot |
| `/api/paper` | paper account: cash, equity, positions (ticker/side/qty/entry/mark/stop), pending trades, full trade log, equity history |
| `/api/accuracy` | scorecard — how past analysis calls performed vs. outcomes |
| `/api/state` | `settings` (incl. `settings.model` fast/crawl selection), `schedule`, `portfolio` (holdings with qty + entry_price), `watchlist` |
| `/api/signals` | current computed signals per ticker |
| `/api/backtest` | backtest result |
| `/api/fred` | macro/FRED indicators |
| `/api/reports` | list of analysis reports |
| `/api/report?id=<id>` | one full report (the analysis narrative a run produced) |

Write endpoints — ONLY when the user explicitly asks, and say what you're about to do first:
- `POST /api/paper/trade` with `{"ticker","action","size_pct",...}` — books a manual trade in the paper account.
- `POST /api/paper/reset` — wipes the paper account back to the start state. Never infer this from a request to "start over" in an unrelated context.
- `POST /api/run` — triggers an analysis run on the CURRENT `settings.model` (fast 8b / crawl 30b toggle lives in the webapp). Confirm the model with the user if it matters to cost/latency.

## Ground truth (use when the webapp is down, or for a deep dig)

`/opt/Warden/trading/.alpha-stack/`:
- `paper.json` — the ledger: `cash`, `start_equity` ($100k), `positions`, `pending_trades`, `trades`, `equity_history`, plus `pending_scores`/`executed_runs`. Positions carry `stop_loss`/`take_profit`/`horizon_days` (may be null = no stop — e.g. seeded positions).
- `state.json` — `portfolio[]` mirrors the ledger positions (qty + entry_price) for the UI; `watchlist[]`; `settings.model` (`granite4.2:8b` = fast / `granite4.2:30b` = crawl); `schedule`.
- `runs.jsonl` — one JSON line per analysis run (append-only). Read with `tail -n`, parse lines individually.

Read these files with the Read tool or `jq`/node/python — never write to them directly; all writes go through the API above.

## Rules

- This is a **paper/simulated** account unless the account mode says otherwise — state which mode is in effect when you report numbers (the `Simulated/Live` toggle; reflect it in your phrasing).
- Report money as dollars with the sign shown by the data (P&L is signed in the API); don't derive your own P&L from prices unless the user wants a what-if.
- Don't infer "trade X now" — the runs + scorecard drive decisions; if the user asks for advice, ground it in `/api/signals`, `/api/backtest`, and the latest report, and name which you used.
- If `/api/status` is down AND the JSON files are missing, the stack was never initialized on this machine — say so plainly instead of hunting.
