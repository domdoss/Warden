---
name: alpha-stack
description: "Operate the Alpha Stack trading system: paper-trading account (positions, P&L, equity, trades), portfolio, watchlist, TradingAgents analysis runs (start, stop, resume, discard) and reports, Liquid NN next-day forecasts, signals, backtest + accuracy scorecard. Use when the user asks about stocks, tickers, the trading/paper account, portfolio, runs, forecasts, or what Alpha Stack decided. Default read-only; place a trade, reset the account, or start/stop/discard a run only when the user asks."
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
- No response → the webapp is down. It runs inside `warden.service` (started on every Warden start by `scripts/start-alpha-webapp.sh`), so down means it crashed; `POST http://127.0.0.1:3200/api/alphastack/webapp/start` brings it back when the user asks. Meanwhile read the JSON files directly (section "Ground truth") — they are complete.

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
| `/api/liquid` | today's cached Liquid NN forecast per portfolio/watchlist ticker (`{"forecasts":[…]}`; `pending:true` = not trained today). Never trains. |
| `/api/liquid?ticker=<T>` | one ticker's forecast; trains first if not trained today (~20s). Add `&force=1` to retrain. |

`/api/status` during a run: `running`, `current_ticker`, `tickers[]` (each `status`: `pending` / `running` / `done` / `error` / `interrupted`), `stopping`, `resumable`, `run_id`, `trade_date`, `trigger` (`manual` / `schedule`).

Write endpoints — ONLY when the user explicitly asks, and say what you're about to do first:
- `POST /api/paper/trade` with `{"ticker","action","size_pct",...}` — books a manual trade in the paper account.
- `POST /api/paper/reset` — wipes the paper account back to the start state. Never infer this from a request to "start over" in an unrelated context.
- `POST /api/run` — triggers an analysis run on the CURRENT `settings.model` (fast 8b / crawl 30b toggle lives in the webapp). Confirm the model with the user if it matters to cost/latency. A new run replaces any resumable one.
- `POST /api/run/stop` — stops after the current agent step; the run stays resumable.
- `POST /api/run/resume` — continues an interrupted run (when `resumable` is true): finished tickers are skipped, the cut-off ticker continues from its last completed agent step.
- `POST /api/run/discard` — drops the resumable run; its partial decisions are never logged or traded. Reports already written stay.

All three return 409 with an `error` when not applicable (nothing running / nothing to resume) — report that text as the answer.

## Run lifecycle

- A run goes ticker by ticker over portfolio ∪ watchlist; each ticker runs the TradingAgents analyst → researcher → trader → risk → portfolio chain and writes one report.
- Restarting Warden restarts the webapp too. An interrupted **scheduled** run from today auto-resumes on startup; any other interrupted run waits for `POST /api/run/resume`.
- Paper trades from a run are placed only when the run completes.

## Liquid NN forecast — what it is and how to present it

A per-ticker liquid time-constant network (ncps CfC, 32 units) trained on 5 years of daily prices: input is the last 10 days of 28 technical indicators (scale-free), output is next-day return → `predicted_close`. Trained on the oldest 80%, scored on the newest ~year. Each run also passes the forecast to the TradingAgents analysts as one input line.

Each `/api/liquid` forecast carries `call: {action: "BUY"|"SELL"|"NO SIGNAL", reason}` — BUY/SELL only when `eval.beats_naive` is true AND the predicted move clears the round-trip cost — and `ta_rating: {rating, report_id, date}`, the newest TradingAgents rating for that ticker. Lead with `call` and its `reason`; the paper account trades the TradingAgents rating, so name that as the actionable call. Tickers without today's forecast are trained in the background one at a time (`trainer: {training, queued}`; tiles show `pending` or `refreshing`). Code: `trading/webapp/liquid.py`; upstream repo (Apache-2.0) at `trading/LiquidNN`.

## Day trading (intraday, PAPER ONLY)

A separate intraday engine (`trading/webapp/daytrade.py`) with its own simulated account — no broker, no real orders. Per ticker, a liquid NN (CfC) reads the last 30 one-minute bars (Yahoo 1m, regular session) and predicts the return over the next `horizon_min` minutes (default 15). Each ticker's edge comes from a walk-forward backtest (3 folds, each trained only on earlier sessions) that trades the exact live rules and charges spread + slippage on every fill (`cost_bps` = round trip).

Calls per ticker: `BUY NOW` / `SELL NOW` (short, or exit a long) / `HOLD` / `STAND ASIDE`. A ticker whose out-of-sample edge net of costs is not positive is always `STAND ASIDE` ("no edge"), whatever the model predicts.

| Endpoint | Purpose |
|---|---|
| `GET /api/daytrade/status` | market clock (`market.open`, `next_open`), `engine` (`mode` live/replay/off), `config`, `account` (equity, `pnl_today`, `kill_switch`), `positions[]`, plus `tickers[]` |
| `GET /api/daytrade/signals` | `{asof, tickers:[{ticker, call, reason, confidence, entry, stop, target, pred_return_bps, horizon_min, last_price, bar_time, bar_age_s, edge, model_state}]}` |
| `GET /api/daytrade/trades` | `trades[]` fills (open/close), `round_trips[]`, `replay_trades[]` |
| `GET /api/daytrade/stream` | live SSE feed of the same snapshot |
| `GET/POST /api/daytrade/config` | tickers (empty = portfolio ∪ watchlist), horizon, `cost_bps`, risk limits, `auto_execute` |
| `POST /api/daytrade/start` / `stop` | engine on/off (`{"mode":"replay"}` on start = replay) |
| `POST /api/daytrade/replay` | `{tickers?, speed?, date?, auto?, ignore_edge?}` — reruns a past session through the live rules |
| `POST /api/daytrade/trade` | `{ticker, action: buy|sell|close}` — a manual paper fill at the live price (market hours only) |
| `POST /api/daytrade/reset` | wipes the intraday paper account |

Presenting it:
- Lead with the call and its `reason`, then the edge line: `edge.net_bps_per_trade` over `edge.trades` out-of-sample trades, `edge.win_rate_pct`, against `edge.cost_bps`. When the call is `STAND ASIDE` for no edge, say plainly that the model hasn't shown an edge net of costs on that ticker.
- Quote `bar_age_s` with any price — Yahoo's minute bars can lag the tape.
- State that it is a paper account on every P&L number.
- Engine on/off, config changes, manual trades, replay and reset happen only when the user asks; state what you are about to do first.
- `ignore_edge` replays are research only (what the model would have done without the gate) — label their results that way.

## Ground truth (use when the webapp is down, or for a deep dig)

`/opt/Warden/trading/.alpha-stack/`:
- `paper.json` — the ledger: `cash`, `start_equity` ($100k), `positions`, `pending_trades`, `trades`, `equity_history`, plus `pending_scores`/`executed_runs`. Positions carry `stop_loss`/`take_profit`/`horizon_days` (may be null = no stop — e.g. seeded positions).
- `state.json` — `portfolio[]` mirrors the ledger positions (qty + entry_price) for the UI; `watchlist[]`; `settings.model` (`granite4.2:8b` = fast / `granite4.2:30b` = crawl); `schedule`.
- `runs.jsonl` — one JSON line per analysis run (append-only). Read with `tail -n`, parse lines individually.
- `run_progress.json` — exists only while a run is unfinished (the resume point).
- `liquid/<TICKER>.json` — the day's cached Liquid NN forecast.
- Webapp log: `/opt/Warden/trading/logs/webapp.log`.

Read these files with the Read tool or `jq`/node/python — never write to them directly; all writes go through the API above.

## Rules

- This is a **paper/simulated** account unless the account mode says otherwise — state which mode is in effect when you report numbers (the `Simulated/Live` toggle; reflect it in your phrasing).
- Report money as dollars with the sign shown by the data (P&L is signed in the API); don't derive your own P&L from prices unless the user wants a what-if.
- Don't infer "trade X now" — the runs + scorecard drive decisions; if the user asks for advice, ground it in `/api/signals`, `/api/backtest`, and the latest report, and name which you used.
- If `/api/status` is down AND the JSON files are missing, the stack was never initialized on this machine — say so plainly instead of hunting.
