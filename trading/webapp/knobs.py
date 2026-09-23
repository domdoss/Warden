"""Every day-trading knob: default, range, plain-English help. The engine's
defaults come from here and the dashboard's settings UI is generated from
``catalog()``.

Defaults are starting points chosen for defensible reasons (stated in each
help text), not tuned against test results.
"""

from __future__ import annotations

GROUPS = [
    {"id": "trade", "label": "What to trade",
     "help": "Which stocks the engine watches. By default your Alpha Stack portfolio and watchlist, plus any extras."},
    {"id": "signal", "label": "When to trade",
     "help": "How strong a signal must be before the engine acts on it, and whether it may short."},
    {"id": "align", "label": "Long-term alignment",
     "help": "How the day-trade engine treats the Alpha Stack's long-term stance on each ticker: the TradingAgents rating first, then the Liquid NN daily call, plus whether the long-term book holds it. The stance is always shown on each day-trade card; the setting here decides how far its say goes."},
    {"id": "exits", "label": "Getting out",
     "help": "Where each trade's automatic stop-loss and profit target sit, and end-of-day timing."},
    {"id": "risk", "label": "Risk limits",
     "help": "How much of the shared paper account a trade may use or lose."},
    {"id": "costs", "label": "Trading costs",
     "help": "What each trade is charged. Every replay and every live trade pays these; setting them too low makes results look better than reality."},
    {"id": "replay", "label": "Replay",
     "help": "Settings for replaying past sessions."},
]

TICKER_SUGGESTIONS = [
    {"value": "SPY", "label": "SPY", "help": "ETF tracking the S&P 500 — the most-traded stock product there is; tiny spreads."},
    {"value": "QQQ", "label": "QQQ", "help": "ETF tracking the Nasdaq-100 (big tech); very liquid, moves more than SPY."},
    {"value": "IWM", "label": "IWM", "help": "ETF tracking small US companies; more volatile than SPY."},
    {"value": "TSLA", "label": "TSLA", "help": "Tesla — one of the most volatile heavily-traded stocks."},
    {"value": "AMD", "label": "AMD", "help": "AMD — volatile, heavily traded chip stock."},
    {"value": "NVDA", "label": "NVDA", "help": "Nvidia — heavily traded, big intraday swings."},
    {"value": "META", "label": "META", "help": "Meta — liquid large-cap with sizeable daily moves."},
    {"value": "AMZN", "label": "AMZN", "help": "Amazon — liquid large-cap."},
    {"value": "COIN", "label": "COIN", "help": "Coinbase — very volatile; tracks crypto sentiment."},
    {"value": "PLTR", "label": "PLTR", "help": "Palantir — volatile, heavily traded."},
]

HORIZON_OPTIONS = [
    {"value": 5, "label": "5 min"}, {"value": 15, "label": "15 min"}, {"value": 30, "label": "30 min"},
    {"value": 60, "label": "60 min"}, {"value": 120, "label": "120 min"},
]

KNOBS = [
    # -- what to trade ------------------------------------------------------
    {"key": "extra_tickers", "group": "trade", "label": "Extra tickers", "type": "tickers", "default": [],
     "options": TICKER_SUGGESTIONS,
     "help": "Stocks to watch on top of your portfolio and watchlist. Volatile, heavily traded names (index ETFs, TSLA, AMD) move the most; steady ones like KO rarely move enough to beat costs."},
    {"key": "tickers", "group": "trade", "label": "Only these tickers (override)", "type": "tickers", "default": [],
     "options": [], "advanced": True,
     "help": "If set, the engine watches exactly these and ignores the portfolio, watchlist and extras. Leave empty normally."},

    # -- when to trade ------------------------------------------------------
    {"key": "horizon_min", "group": "signal", "label": "Trade horizon", "type": "select", "default": 30,
     "options": HORIZON_OPTIONS, "unit": "min",
     "help": "How long a trade is held at most: its stop/target are sized on the typical move over this window and a manual trade is time-exited after it. 30 min is the starting point."},
    {"key": "edge_mult", "group": "signal", "label": "Signal strength needed", "type": "float", "default": 1.0,
     "min": 0.5, "max": 5.0, "step": 0.1, "unit": "× cost",
     "help": "A signal must be bigger than this many times the round-trip cost before the engine acts on it. 1 = the predicted move must at least pay for the trade. Higher = fewer, more confident trades."},
    {"key": "allow_short", "group": "signal", "label": "Allow short selling", "type": "bool", "default": True,
     "help": "Shorting = betting a price will fall (sell first, buy back later). On means the engine can profit from drops as well as rises."},
    {"key": "auto_execute", "group": "signal", "label": "Auto-trade the signals", "type": "bool", "default": False,
     "help": "When on, BUY NOW / SELL NOW calls are traded automatically in the paper account. Off = signals only; you decide."},

    # -- long-term alignment ---------------------------------------------------
    {"key": "lt_align", "group": "align", "label": "Trade with the long-term stance", "type": "select",
     "default": "off",
     "options": [
        {"value": "off", "label": "Off — show the stance only",
         "help": "The stance appears on each day-trade card for context; signals and trades are untouched."},
        {"value": "with_stance", "label": "Only with the stance",
         "help": "Long entries only on names the long-term stack is bullish on, short entries only on names it is bearish on. A signal against the stance is held instead of traded."},
        {"value": "with_stance_hold", "label": "Only with the stance; hold = stand aside",
         "help": "The same, plus names whose stance is hold or neutral are stood aside — no day trades on them while the stance says hold."},
     ],
     "help": "The stance comes from the TradingAgents rating first, then the Liquid NN daily call. Default off: the engine trades purely on its signals and the knobs, and the stance is shown for context only."},

    # -- exits ----------------------------------------------------------------
    {"key": "stop_sigma", "group": "exits", "label": "Stop-loss distance", "type": "float", "default": 1.0,
     "min": 0.25, "max": 5.0, "step": 0.25, "unit": "× typical move",
     "help": "How far against you the price can go before the trade is cut, measured in the stock's typical move over the horizon. Smaller = cut losses sooner but get stopped out by normal noise more often."},
    {"key": "target_sigma", "group": "exits", "label": "Profit-target distance", "type": "float", "default": 1.5,
     "min": 0.25, "max": 10.0, "step": 0.25, "unit": "× typical move",
     "help": "How far in your favour before profit is taken, in the same units. 1.5 against a 1.0 stop = aiming to win 1.5 for every 1 risked."},
    {"key": "take_profit_usd", "group": "exits", "label": "Take the money at", "type": "float",
     "default": 0.0, "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$ up in a trade",
     "help": "Once a single open trade is up this many dollars (unrealized), it is closed immediately — a hard cap. The trailing version below usually fits better: it rides winners past the cap and only sells when the gain comes back down. 0 = off."},
    {"key": "trail_profit_usd", "group": "exits", "label": "Sell when it falls back under", "type": "float",
     "default": 100.0, "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$ up in a trade",
     "help": "Once a trade has been up this many dollars, it is sold as soon as its unrealized gain drops back below this — winners ride as high as they want, and the gain is taken on the way down instead of round-tripping back to nothing. 0 = off."},
    {"key": "be_trigger", "group": "exits", "label": "Breakeven move trigger", "type": "float",
     "default": 0.0, "min": 0.0, "max": 3.0, "step": 0.25, "unit": "× stop distance",
     "help": "Once a trade is this many stop-distances in profit, its stop moves to the entry price — a winner can then no longer end a loser. 0 = off."},
    {"key": "trail_sigma", "group": "exits", "label": "Trailing stop distance", "type": "float", "default": 0.0,
     "min": 0.0, "max": 5.0, "step": 0.25, "unit": "× stop distance",
     "help": "Once set, the stop ratchets this many stop-distances behind the best price the trade has reached, locking in give-back as it moves your way. It only ever tightens, never loosens. 0 = off."},
    {"key": "last_entry_min", "group": "exits", "label": "No new trades in the last", "type": "int", "default": 35,
     "min": 0, "max": 180, "step": 5, "unit": "min",
     "help": "Stops opening trades this close to the 4:00 PM ET close. Should be at least the horizon so a trade has time to play out."},
    {"key": "flatten_min", "group": "exits", "label": "Close everything in the last", "type": "int", "default": 5,
     "min": 1, "max": 60, "step": 1, "unit": "min",
     "help": "Every day trade is closed this many minutes before the close, so nothing is held overnight."},

    # -- risk -----------------------------------------------------------------
    {"key": "risk_per_trade_pct", "group": "risk", "label": "Risk per trade", "type": "float", "default": 0.5,
     "min": 0.05, "max": 5.0, "step": 0.05, "unit": "% of account",
     "help": "How much of the account a single trade can lose if it hits its stop. Trade size is worked out from this. 0.5% means a stopped-out trade on $100k loses about $500."},
    {"key": "max_position_pct", "group": "risk", "label": "Max size of one trade", "type": "float", "default": 20.0,
     "min": 1.0, "max": 100.0, "step": 1.0, "unit": "% of account",
     "help": "Cap on one trade's total value, whatever the risk maths says. Keeps a single stock from dominating the account."},
    {"key": "max_positions", "group": "risk", "label": "Max trades open at once", "type": "int", "default": 3,
     "min": 1, "max": 20, "step": 1,
     "help": "How many day trades can be open at the same time."},
    {"key": "max_daily_loss_pct", "group": "risk", "label": "Daily loss limit", "type": "float", "default": 1.0,
     "min": 0.1, "max": 10.0, "step": 0.1, "unit": "% of account",
     "help": "If day trades lose this much in a day, everything is closed and no new trades open until tomorrow. The account also holds long-term positions, so this is kept tight."},
    {"key": "max_daily_loss_usd", "group": "risk", "label": "Daily loss cutoff", "type": "float", "default": 100.0,
     "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$",
     "help": "Once the day's day trades are down this many dollars, everything is closed and nothing new opens until tomorrow — a bad day ends at a known cost. 0 = off."},
    {"key": "daily_take_usd", "group": "risk", "label": "Daily profit lock", "type": "float", "default": 300.0,
     "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$",
     "help": "Once the day's day trades are up this many dollars, every open position is closed and nothing new opens until tomorrow — a strong morning stays a strong day instead of being given back in the afternoon. 0 = off."},
    {"key": "recoup_risk_mult", "group": "risk", "label": "Afternoon risk after a down morning", "type": "float",
     "default": 0.5, "min": 0.1, "max": 1.0, "step": 0.05, "unit": "× normal risk",
     "help": "From midday on, while the day is down, each new trade risks this fraction of the normal amount — trading smaller to win it back safely. 1 = always normal risk."},

    # -- costs ----------------------------------------------------------------
    {"key": "spread_bps", "group": "costs", "label": "Bid/ask spread", "type": "float", "default": 2.0,
     "min": 0.0, "max": 50.0, "step": 0.5, "unit": "bps",
     "help": "The gap between the price you can buy at and the price you can sell at. You pay half of it on each side of a trade. About 1–3 bps for big, busy stocks; more for small ones."},
    {"key": "slippage_bps", "group": "costs", "label": "Slippage per side", "type": "float", "default": 1.0,
     "min": 0.0, "max": 50.0, "step": 0.5, "unit": "bps",
     "help": "Extra cost from the price moving between deciding and filling. Charged on entry and exit."},

    # -- replay -----------------------------------------------------------------
    {"key": "replay_speed", "group": "replay", "label": "Default replay speed", "type": "float", "default": 10.0,
     "min": 0.5, "max": 120.0, "step": 0.5, "unit": "× real time",
     "help": "Simulated minutes per real second when replaying a past session."},
]

BY_KEY = {k["key"]: k for k in KNOBS}


def defaults() -> dict:
    return {k["key"]: (list(k["default"]) if isinstance(k["default"], list) else k["default"]) for k in KNOBS}


def catalog(values: dict) -> dict:
    return {"groups": GROUPS, "knobs": KNOBS, "values": {k: values.get(k) for k in BY_KEY}}


def coerce(key: str, value):
    """Validate and convert one knob value. Raises ValueError with a message
    that names the knob."""
    k = BY_KEY[key]
    t = k["type"]
    if t == "bool":
        return value if isinstance(value, bool) else str(value).lower() in ("1", "true", "yes", "on")
    if t == "tickers":
        items = value if isinstance(value, list) else str(value).replace(",", " ").split()
        return list(dict.fromkeys(str(x).strip().upper() for x in items if str(x).strip()))
    if t == "select":
        for o in k["options"]:
            if str(o["value"]) == str(value):
                return o["value"]
        raise ValueError(f"{key}: must be one of {', '.join(str(o['value']) for o in k['options'])}")
    try:
        v = int(value) if t == "int" else float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key}: must be a number")
    if not k["min"] <= v <= k["max"]:
        raise ValueError(f"{key}: must be between {k['min']} and {k['max']}")
    return v