"""Every day-trading knob: default, range, plain-English help, and whether
changing it retrains the models. The engine's defaults come from here and
the dashboard's settings UI is generated from ``catalog()``.

Defaults are starting points chosen for defensible reasons (stated in each
help text), not tuned against the test results.
"""

from __future__ import annotations

GROUPS = [
    {"id": "trade", "label": "What to trade",
     "help": "Which stocks the engine watches. By default your Alpha Stack portfolio and watchlist, plus any extras."},
    {"id": "signal", "label": "When to trade",
     "help": "How far ahead the model predicts, and how sure the evidence must be before it's allowed to trade."},
    {"id": "align", "label": "Long-term link",
     "help": "How tightly the long-term side (TradingAgents' Buy/Sell/Hold calls and the positions they hold) and the day trader work as one unit. Every link is its own switch: turn them all off and the two run independently, as before."},
    {"id": "exits", "label": "Getting out",
     "help": "Where each trade's automatic stop-loss and profit target sit, and end-of-day timing."},
    {"id": "risk", "label": "Risk limits",
     "help": "How much of the shared paper account a trade may use or lose."},
    {"id": "costs", "label": "Trading costs",
     "help": "What each trade is charged. Every test and every live trade pays these; setting them too low makes results look better than reality."},
    {"id": "model", "label": "Model",
     "help": "The shape of the neural network and what it sees. Changing these retrains every model."},
    {"id": "training", "label": "Training & testing",
     "help": "How the models learn and how they're scored on days they never saw. Changing these retrains every model."},
    {"id": "replay", "label": "Replay",
     "help": "Settings for replaying past sessions."},
]

FEATURE_OPTIONS = [
    {"value": "r1", "label": "1-min return", "help": "How much the price moved in the last minute."},
    {"value": "r5", "label": "5-min return", "help": "Price move over the last 5 minutes."},
    {"value": "r15", "label": "15-min return", "help": "Price move over the last 15 minutes."},
    {"value": "vwap_dist", "label": "Distance from VWAP", "help": "How far the price is from the day's volume-weighted average price, a level many traders watch."},
    {"value": "open_ret", "label": "Move since open", "help": "How far the price has moved since the day's first trade."},
    {"value": "range_pos", "label": "Position in day's range", "help": "Whether the price sits near the day's high or low so far."},
    {"value": "rsi", "label": "RSI", "help": "A 0–100 score of recent up-moves vs down-moves; high = 'overbought', low = 'oversold'."},
    {"value": "atr", "label": "Volatility (ATR)", "help": "How much the price typically swings per minute right now."},
    {"value": "vol_z", "label": "Volume surge", "help": "Whether trading volume is unusually high or low versus the last hour."},
    {"value": "tod_sin", "label": "Time of day (a)", "help": "Where in the trading day we are (open and close behave differently). Pair with (b)."},
    {"value": "tod_cos", "label": "Time of day (b)", "help": "Second half of the time-of-day encoding. Pair with (a)."},
    {"value": "gap", "label": "Overnight gap", "help": "How far today opened from yesterday's close."},
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
     "options": TICKER_SUGGESTIONS, "retrain": False,
     "help": "Stocks to watch on top of your portfolio and watchlist. Volatile, heavily traded names (index ETFs, TSLA, AMD) give a model the most to work with; steady ones like KO rarely move enough to beat costs."},
    {"key": "tickers", "group": "trade", "label": "Only these tickers (override)", "type": "tickers", "default": [],
     "options": [], "retrain": False, "advanced": True,
     "help": "If set, the engine watches exactly these and ignores the portfolio, watchlist and extras. Leave empty normally."},

    # -- when to trade ------------------------------------------------------
    {"key": "signal_source", "group": "signal", "label": "Signal source", "type": "select", "default": "neural", "retrain": False,
     "options": [
        {"value": "neural", "label": "Neural net",
         "help": "Each ticker's trained liquid neural net predicts the move over the horizon. Its calls only trade on tickers that passed the edge test (or in a research replay with the edge gate off)."},
        {"value": "move", "label": "Plain move (knobs only)",
         "help": "No model: the signal is the ticker's own move over the horizon window (close now vs close horizon minutes ago). The knobs alone decide when that move is a trade."},
     ],
     "help": "Where BUY/SELL calls come from. The neural net needs trained models (Train models); the plain move needs nothing and trades on the knobs alone."},
    {"key": "trade_mode", "group": "signal", "label": "Trading mode", "type": "select", "default": "ai", "retrain": False,
     "options": [
        {"value": "ai", "label": "AI mode",
         "help": "The neural net's BUY/SELL calls trade on every ticker; the knobs size and exit them."},
        {"value": "edge", "label": "Edge mode",
         "help": "Only tickers whose walk-forward test proved an after-cost edge trade; the rest stand aside."},
     ],
     "help": "AI mode trades the net's calls everywhere. Edge mode only trades tickers that passed the edge test. The edge badge on each card shows that test in both modes."},
    {"key": "horizon_min", "group": "signal", "label": "Prediction horizon", "type": "select", "default": 30,
     "options": HORIZON_OPTIONS, "unit": "min", "retrain": True,
     "help": "How far ahead each prediction looks, and how long a trade is held at most. Short horizons are mostly noise and the fixed cost per trade eats small moves; longer ones give bigger moves per trade. 30 min is the starting point."},
    {"key": "min_edge_bps", "group": "signal", "label": "Required edge per trade", "type": "float", "default": 1.0,
     "min": 0.0, "max": 20.0, "step": 0.5, "unit": "bps", "retrain": False,
     "help": "The minimum average profit per trade, after costs, that a ticker's test must show before it may trade. 1 bps = 0.01%. A small margin above zero, so a result that's barely positive by luck doesn't pass."},
    {"key": "min_edge_trades", "group": "signal", "label": "Minimum test trades", "type": "int", "default": 50,
     "min": 10, "max": 1000, "step": 10, "retrain": False,
     "help": "How many simulated trades the test needs before its result counts. Fewer trades = more luck. 50 is a floor; more is better."},
    {"key": "min_direction_pct", "group": "signal", "label": "Minimum direction accuracy", "type": "float",
     "default": 51.0, "min": 50.0, "max": 90.0, "step": 0.5, "unit": "%", "retrain": False,
     "help": "The ticker's out-of-sample test must also call the next move's direction right at least this often before it may trade. 51% means measurably better than a coin flip; anything at or below 50% is guessing, whatever its simulated profit says."},
    {"key": "edge_mult", "group": "signal", "label": "Signal strength needed", "type": "float", "default": 1.0,
     "min": 0.5, "max": 5.0, "step": 0.1, "unit": "× cost", "retrain": False,
     "help": "A prediction must be bigger than this many times the round-trip cost before the engine acts on it. 1 = the predicted move must at least pay for the trade. Higher = fewer, more confident trades."},
    {"key": "allow_short", "group": "signal", "label": "Allow short selling", "type": "bool", "default": True, "retrain": False,
     "help": "Shorting = betting a price will fall (sell first, buy back later). On means the engine can profit from drops as well as rises."},
    {"key": "auto_execute", "group": "signal", "label": "Auto-trade the signals", "type": "bool", "default": False, "retrain": False,
     "help": "When on, BUY NOW / SELL NOW calls are traded automatically in the paper account. Off = signals only; you decide."},

    # -- long-term alignment ---------------------------------------------------
    {"key": "lt_memory", "group": "align", "label": "TradingAgents sees positions and its last call", "type": "bool",
     "default": True, "retrain": False,
     "help": "Each analysis is told the open paper position (size, entry, P&L), any pending order, and its own previous call with the price move since — so it decides what to DO with the position rather than starting fresh. Off: every run analyses from scratch."},
    {"key": "lt_target", "group": "align", "label": "Buy/Sell sets a target position", "type": "bool",
     "default": True, "retrain": False,
     "help": "On: a Buy or Sell is the position it should hold at its stated size — already long and it says Buy again → top up or trim to that size; long and it says Sell → close and go short. Off: a Buy opens a new position and a Sell against a long just closes it."},
    {"key": "lt_execution", "group": "align", "label": "Who places long-term orders", "type": "select",
     "default": "day_trader", "retrain": False,
     "options": [
        {"value": "day_trader", "label": "Day trader times it",
         "help": "While the day-trade engine runs live, it fills each long-term order during the session when its own call agrees with the order's direction, or at market at the deadline below. If the engine isn't running, orders fill at the open as usual."},
        {"value": "open", "label": "At the next open",
         "help": "Orders fill at the next session's opening price, independent of the day trader."},
     ],
     "help": "How TradingAgents' decisions become paper positions."},
    {"key": "lt_fill_deadline_min", "group": "align", "label": "Fill long-term orders by", "type": "int",
     "default": 30, "min": 5, "max": 360, "step": 5, "unit": "min before the close", "retrain": False,
     "help": "If the day trader hasn't found a good moment by this many minutes before the 4:00 PM ET close, it fills the order at market so nothing goes unfilled. 30 = 3:30 PM ET."},
    {"key": "lt_align", "group": "align", "label": "Day trades and the long-term call", "type": "select",
     "default": "follow", "retrain": False,
     "options": [
        {"value": "follow", "label": "Follow the call",
         "help": "Buy/bullish → the day trader only takes long trades; Sell/bearish → only shorts. What it does on Hold is the setting below."},
        {"value": "off", "label": "Independent",
         "help": "The call is shown on each card for context; day trades ignore it."},
        {"value": "with_stance", "label": "Only with the call (Hold = free)",
         "help": "Longs only on bullish names, shorts only on bearish ones; Hold names trade either way."},
        {"value": "with_stance_hold", "label": "Only with the call (Hold = stand aside)",
         "help": "The same, and no day trades on Hold names."},
     ],
     "help": "The call is the TradingAgents rating first, then the Liquid NN daily call."},
    {"key": "lt_hold", "group": "align", "label": "On a Hold call", "type": "select",
     "default": "both", "retrain": False,
     "options": [
        {"value": "both", "label": "Trade both ways",
         "help": "Hold = no long-term view, so the day trader trades that ticker long or short on its own calls."},
        {"value": "aside", "label": "Stand aside",
         "help": "No day trades on that ticker until the call changes."},
     ],
     "help": "Used when day trades follow the call."},

    # -- exits ----------------------------------------------------------------
    {"key": "stop_sigma", "group": "exits", "label": "Stop-loss distance", "type": "float", "default": 1.0,
     "min": 0.25, "max": 5.0, "step": 0.25, "unit": "× typical move", "retrain": False,
     "help": "How far against you the price can go before the trade is cut, measured in the stock's typical move over the horizon. Smaller = cut losses sooner but get stopped out by normal noise more often."},
    {"key": "target_sigma", "group": "exits", "label": "Profit-target distance", "type": "float", "default": 1.5,
     "min": 0.25, "max": 10.0, "step": 0.25, "unit": "× typical move", "retrain": False,
     "help": "How far in your favour before profit is taken, in the same units. 1.5 against a 1.0 stop = aiming to win 1.5 for every 1 risked."},
    {"key": "take_profit_usd", "group": "exits", "label": "Take the money at", "type": "float",
     "default": 0.0, "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$ up in a trade", "retrain": False,
     "help": "Once a single open trade is up this many dollars (unrealized), it is closed immediately — a hard cap. The trailing version below usually fits better: it rides winners past the cap and only sells when the gain comes back down. This is an account-dollar rule: it runs in live and replay, not in the out-of-sample edge tests. 0 = off."},
    {"key": "trail_profit_usd", "group": "exits", "label": "Sell when it falls back under", "type": "float",
     "default": 100.0, "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$ up in a trade", "retrain": False,
     "help": "Once a trade has been up this many dollars, it is sold as soon as its unrealized gain drops back below this — winners ride as high as they want, and the gain is taken on the way down instead of round-tripping back to nothing. An account-dollar rule: live and replay only, never in the edge tests. 0 = off."},
    {"key": "be_trigger", "group": "exits", "label": "Breakeven move trigger", "type": "float", "default": 0.0,
     "min": 0.0, "max": 3.0, "step": 0.25, "unit": "× stop distance", "retrain": False,
     "help": "Once a trade is this many stop-distances in profit, its stop moves to the entry price — a winner can then no longer end a loser. 0 = off."},
    {"key": "trail_sigma", "group": "exits", "label": "Trailing stop distance", "type": "float", "default": 0.0,
     "min": 0.0, "max": 5.0, "step": 0.25, "unit": "× stop distance", "retrain": False,
     "help": "Once set, the stop ratchets this many stop-distances behind the best price the trade has reached, locking in give-back as it moves your way. It only ever tightens, never loosens. 0 = off."},
    {"key": "last_entry_min", "group": "exits", "label": "No new trades in the last", "type": "int", "default": 35,
     "min": 0, "max": 180, "step": 5, "unit": "min", "retrain": False,
     "help": "Stops opening trades this close to the 4:00 PM ET close. Should be at least the horizon so a trade has time to play out."},
    {"key": "flatten_min", "group": "exits", "label": "Close everything in the last", "type": "int", "default": 5,
     "min": 1, "max": 60, "step": 1, "unit": "min", "retrain": False,
     "help": "Every day trade is closed this many minutes before the close, so nothing is held overnight."},

    # -- risk -----------------------------------------------------------------
    {"key": "risk_per_trade_pct", "group": "risk", "label": "Risk per trade", "type": "float", "default": 0.5,
     "min": 0.05, "max": 5.0, "step": 0.05, "unit": "% of account", "retrain": False,
     "help": "How much of the account a single trade can lose if it hits its stop. Trade size is worked out from this. 0.5% means a stopped-out trade on $100k loses about $500."},
    {"key": "max_position_pct", "group": "risk", "label": "Max size of one trade", "type": "float", "default": 20.0,
     "min": 1.0, "max": 100.0, "step": 1.0, "unit": "% of account", "retrain": False,
     "help": "Cap on one trade's total value, whatever the risk maths says. Keeps a single stock from dominating the account."},
    {"key": "max_positions", "group": "risk", "label": "Max trades open at once", "type": "int", "default": 3,
     "min": 1, "max": 20, "step": 1, "retrain": False,
     "help": "How many day trades can be open at the same time."},
    {"key": "max_daily_loss_pct", "group": "risk", "label": "Daily loss limit", "type": "float", "default": 1.0,
     "min": 0.1, "max": 10.0, "step": 0.1, "unit": "% of account", "retrain": False,
     "help": "If day trades lose this much in a day, everything is closed and no new trades open until tomorrow. The account also holds long-term positions, so this is kept tight."},
    {"key": "max_daily_loss_usd", "group": "risk", "label": "Daily loss cutoff", "type": "float", "default": 100.0,
     "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$", "retrain": False,
     "help": "Once the day's day trades are down this many dollars, everything is closed and nothing new opens until tomorrow — a bad day ends at a known cost. 0 = off."},
    {"key": "daily_take_usd", "group": "risk", "label": "Daily profit lock", "type": "float", "default": 300.0,
     "min": 0.0, "max": 10000.0, "step": 10.0, "unit": "$", "retrain": False,
     "help": "Once the day's day trades are up this many dollars, every open position is closed and nothing new opens until tomorrow — a strong morning stays a strong day instead of being given back in the afternoon. 0 = off."},
    {"key": "recoup_risk_mult", "group": "risk", "label": "Afternoon risk after a down morning", "type": "float",
     "default": 0.5, "min": 0.1, "max": 1.0, "step": 0.05, "unit": "× normal risk", "retrain": False,
     "help": "From midday on, while the day is down, each new trade risks this fraction of the normal amount — trading smaller to win it back safely. 1 = always normal risk."},
    {"key": "max_weekly_loss_pct", "group": "risk", "label": "Weekly loss limit", "type": "float",
     "default": 3.0, "min": 0.1, "max": 50.0, "step": 0.1, "unit": "% of account", "retrain": False,
     "help": "If day trades lose this much of the account over one week (Monday's open to now), everything is closed and no new trades open until next week. Catches a string of moderate daily losses that each stay under the daily limit. The account also holds long-term positions, so keep it smallish."},
    {"key": "max_weekly_loss_usd", "group": "risk", "label": "Weekly loss cutoff", "type": "float",
     "default": 0.0, "min": 0.0, "max": 50000.0, "step": 10.0, "unit": "$", "retrain": False,
     "help": "Once the week's day trades are down this many dollars below Monday's open, everything is closed and nothing new opens until next week. 0 = off."},
    {"key": "max_consecutive_loss_days", "group": "risk", "label": "Losing days in a row", "type": "int",
     "default": 0, "min": 0, "max": 5, "step": 1, "retrain": False,
     "help": "After this many losing days in a row, the engine stands aside for the rest of the week instead of chasing a bad streak. The count resets each week. 0 = off."},

    # -- costs ----------------------------------------------------------------
    {"key": "spread_bps", "group": "costs", "label": "Bid/ask spread", "type": "float", "default": 2.0,
     "min": 0.0, "max": 50.0, "step": 0.5, "unit": "bps", "retrain": False,
     "help": "The gap between the price you can buy at and the price you can sell at. You pay half of it on each side of a trade. About 1–3 bps for big, busy stocks; more for small ones."},
    {"key": "slippage_bps", "group": "costs", "label": "Slippage per side", "type": "float", "default": 1.0,
     "min": 0.0, "max": 50.0, "step": 0.5, "unit": "bps", "retrain": False,
     "help": "Extra cost from the price moving between deciding and filling. Charged on entry and exit."},

    # -- model ----------------------------------------------------------------
    {"key": "features", "group": "model", "label": "Inputs the model sees", "type": "multiselect",
     "default": [o["value"] for o in FEATURE_OPTIONS], "options": FEATURE_OPTIONS, "retrain": True,
     "help": "Each input is a number computed from recent 1-minute bars. Fewer inputs = simpler model, less chance of learning noise."},
    {"key": "look_back", "group": "model", "label": "Minutes of history per prediction", "type": "int", "default": 60,
     "min": 10, "max": 240, "step": 5, "unit": "bars", "retrain": True,
     "help": "How many recent 1-minute bars the network reads to make each prediction. 60 = the last hour."},
    {"key": "hidden_units", "group": "model", "label": "Network size", "type": "select", "default": 32,
     "options": [{"value": v, "label": str(v)} for v in (8, 16, 32, 64, 128)], "unit": "neurons", "retrain": True,
     "help": "Number of liquid neurons. Bigger can learn more complex patterns but also memorises noise more easily; with one stock's data, small is safer."},

    # -- training & testing -------------------------------------------------
    {"key": "objective", "group": "training", "label": "What the model learns", "type": "select",
     "default": "mse",
     "options": [{"value": "mse", "label": "size of the move (MSE)"},
                 {"value": "sign", "label": "direction of the move (sign)"}],
     "retrain": True, "advanced": True,
     "help": "MSE trains the model to predict how big the next move is; sign trains it directly on which way the move goes — which is what trading acts on. Testing showed no clear winner across tickers, so this stays a knob rather than a new default."},
    {"key": "train_window", "group": "training", "label": "History to train on", "type": "select", "default": "year",
     "options": [{"value": "week", "label": "last week"}, {"value": "month", "label": "last month"},
                 {"value": "year", "label": "last year"}, {"value": "2years", "label": "last 2 years"},
                 {"value": "all", "label": "all history (up to 5 years)"}], "retrain": True,
     "help": "How much 1-minute history each model learns from. More history = more evidence, slower training and more RAM (all history is ~5× a year). Tickers without a deep cache use what they have."},
    {"key": "train_workers", "group": "training", "label": "Tickers trained at once", "type": "int", "default": 4,
     "min": 1, "max": 6, "step": 1, "retrain": False,
     "help": "Parallel training threads, spread across the GPUs. More = faster until the GPUs are saturated."},
    {"key": "max_epochs", "group": "training", "label": "Max passes over the data", "type": "int", "default": 40,
     "min": 5, "max": 200, "step": 5, "retrain": True, "advanced": True,
     "help": "An epoch is one full pass over the training data. Training usually stops earlier (see early stopping)."},
    {"key": "patience", "group": "training", "label": "Early-stopping patience", "type": "int", "default": 5,
     "min": 1, "max": 30, "step": 1, "retrain": True, "advanced": True,
     "help": "Stop training after this many passes with no improvement on held-back days. Stops the model from memorising the training data."},
    {"key": "batch_size", "group": "training", "label": "Batch size", "type": "select", "default": 8192,
     "options": [{"value": v, "label": str(v)} for v in (256, 512, 1024, 2048, 4096, 8192, 16384, 32768)], "retrain": True, "advanced": True,
     "help": "Samples per training step. Bigger keeps the GPU busier; very big can train worse."},
    {"key": "learning_rate", "group": "training", "label": "Learning rate", "type": "float", "default": 0.005,
     "min": 0.0001, "max": 0.03, "step": 0.0005, "retrain": True, "advanced": True,
     "help": "Step size of each weight update. Too high = unstable; too low = slow. 0.005 suits batch 8192."},
    {"key": "weight_decay", "group": "training", "label": "Weight decay", "type": "float", "default": 0.0001,
     "min": 0.0, "max": 0.01, "step": 0.0001, "retrain": True, "advanced": True,
     "help": "Gently pulls weights toward zero, discouraging over-complicated fits."},
    {"key": "val_share_pct", "group": "training", "label": "Early-stopping holdout", "type": "float", "default": 15.0,
     "min": 5.0, "max": 40.0, "step": 1.0, "unit": "% of training days", "retrain": True, "advanced": True,
     "help": "The newest part of each training period is held back to decide when to stop training."},
    {"key": "test_share_pct", "group": "training", "label": "Test period", "type": "float", "default": 30.0,
     "min": 10.0, "max": 50.0, "step": 5.0, "unit": "% of sessions", "retrain": True,
     "help": "The newest sessions used to score the model on days it never trained on. Bigger = more trustworthy score, less training data."},
    {"key": "test_folds", "group": "training", "label": "Test rounds", "type": "int", "default": 3,
     "min": 1, "max": 6, "step": 1, "retrain": True,
     "help": "The test period is split into this many rounds, each scored by a model trained only on days before it (walk-forward). More rounds = more realistic, more training time."},

    # -- replay -----------------------------------------------------------------
    {"key": "replay_speed", "group": "replay", "label": "Default replay speed", "type": "float", "default": 10.0,
     "min": 0.5, "max": 120.0, "step": 0.5, "unit": "× real time", "retrain": False,
     "help": "Simulated minutes per real second when replaying a past session."},
]

BY_KEY = {k["key"]: k for k in KNOBS}
RETRAIN_KEYS = {k["key"] for k in KNOBS if k["retrain"]}


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
    if t == "multiselect":
        allowed = [o["value"] for o in k["options"]]
        items = [v for v in (value if isinstance(value, list) else [value]) if v in allowed]
        if not items:
            raise ValueError(f"{key}: choose at least one")
        return [v for v in allowed if v in items]
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
