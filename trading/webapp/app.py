#!/usr/bin/env python3
"""Alpha-stack dashboard backend.

A dependency-free (stdlib-only) local web server that fronts the
TradingAgents analysis pipeline plus the St. Louis Fed (FRED) macro feed.
It exposes a small JSON API consumed by ``webapp/index.html`` and runs a
background scheduler so the user can wake up to a fresh market report.

Run with::

    ./bin/python webapp/app.py

from the alpha-stack venv root (``/home/dominic/alpha-stack``).
"""

from __future__ import annotations

import copy
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths and config
# ---------------------------------------------------------------------------

# The venv root: parent of the webapp/ directory.
ROOT = Path(__file__).resolve().parent.parent
WEBAPP = ROOT / "webapp"
CONFIG_PATH = WEBAPP / "config.json"
INDEX_HTML = WEBAPP / "index.html"

# Default state written when none exists yet. The user edits portfolio and
# watchlist from the UI; settings/schedule are tuned there too.
DEFAULT_STATE = {
    "portfolio": [],
    "watchlist": [],
    "settings": {"model": "granite4.1:30b", "language": "English",
                 "account_mode": "simulated"},
    "schedule": {"enabled": False, "time": "06:00", "last_run": None},
}


def load_config() -> dict:
    """Load and validate the static config file (server-side knobs)."""
    with CONFIG_PATH.open("r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    cfg.setdefault("port", 8765)
    cfg.setdefault("host", "127.0.0.1")
    cfg.setdefault("fred_api_key", "")
    cfg.setdefault("fred_series", [])
    cfg.setdefault("ollama_url", "http://localhost:11434")
    cfg.setdefault("default_model", "granite4.1:30b")
    cfg.setdefault("tradingagents_path", str(ROOT / "tradingagents"))
    cfg.setdefault("results_dir", str(Path.home() / ".tradingagents" / "logs"))
    cfg.setdefault("state_file", str(Path.home() / ".alpha-stack" / "state.json"))
    # Seed the default model into the default state's settings the first time.
    DEFAULT_STATE["settings"]["model"] = cfg["default_model"]
    return cfg


CONFIG = load_config()
STATE_PATH = Path(CONFIG["state_file"]).expanduser()
RUNS_LOG = STATE_PATH.parent / "runs.jsonl"
# In-flight run progress (per-ticker statuses + run identity). Present only
# while a run is unfinished; its existence after a restart = resumable run.
RUN_PROGRESS_PATH = STATE_PATH.parent / "run_progress.json"


# ---------------------------------------------------------------------------
# State persistence (portfolio + watchlist + settings + schedule)
# ---------------------------------------------------------------------------

_STATE_LOCK = threading.Lock()


def _default_state() -> dict:
    return copy.deepcopy(DEFAULT_STATE)


def load_state() -> dict:
    """Read state from disk, returning a normalized default if absent/corrupt."""
    if not STATE_PATH.exists():
        return _default_state()
    try:
        with STATE_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return _default_state()
    # Normalize so the UI always sees every expected key.
    base = _default_state()
    for key in ("portfolio", "watchlist", "settings", "schedule"):
        if isinstance(data.get(key), dict):
            base[key] = {**base[key], **data[key]}
        elif isinstance(data.get(key), list):
            base[key] = data[key]
    return base


def save_state(state: dict) -> dict:
    """Persist state atomically under the lock; return the saved state."""
    with _STATE_LOCK:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE_PATH.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, STATE_PATH)
    return state


# ---------------------------------------------------------------------------
# Run status (the one in-flight TradingAgents run, if any)
# ---------------------------------------------------------------------------

# RLock (re-entrant): start_run() calls snapshot_status() while already
# holding this lock; a plain Lock would self-deadlock there and stall every
# later /api/status call waiting on it.
_RUN_LOCK = threading.RLock()
RUN_STATUS: dict = {
    "running": False,
    "started": None,
    "current_ticker": None,
    "tickers": [],
    "last_run": None,
    "run_id": None,
    "trade_date": None,     # fixed per run so a resume matches its checkpoints
    "trigger": None,        # "manual" | "schedule"
    "resumable": False,     # an unfinished run is on disk and not running
}

# Set by POST /api/run/stop; checked between graph nodes and between tickers.
_RUN_STOP = threading.Event()


class RunStopped(Exception):
    """Raised inside a ticker's graph stream when a stop was requested."""


def _persist_run() -> None:
    """Atomically write the in-flight run's progress (see RUN_PROGRESS_PATH)."""
    with _RUN_LOCK:
        record = {
            "run_id": RUN_STATUS["run_id"],
            "started": RUN_STATUS["started"],
            "trade_date": RUN_STATUS["trade_date"],
            "trigger": RUN_STATUS["trigger"],
            "tickers": [dict(t) for t in RUN_STATUS["tickers"]],
        }
    try:
        RUN_PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = RUN_PROGRESS_PATH.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, RUN_PROGRESS_PATH)
    except OSError as exc:
        print(f"[run] failed to persist run progress: {exc}", file=sys.stderr)


def _clear_run_progress() -> None:
    try:
        RUN_PROGRESS_PATH.unlink(missing_ok=True)
    except OSError as exc:
        print(f"[run] failed to clear run progress: {exc}", file=sys.stderr)

# Live activity feed for the in-flight ticker (agent statuses, message/tool
# stream, report sections as they populate). Mirrors the CLI's MessageBuffer so
# the dashboard can show what's happening instead of a binary "running" state.
_LIVE: dict = {
    "ticker": None,
    "current_agent": None,
    "agents": {},          # name -> pending | in_progress | completed
    "feed": [],            # rolling list of {ts, kind, agent, text, seq}
    "reports": {},         # section -> full content (rendered as Markdown)
    "seq": 0,              # monotonic feed event id (survives the window trim)
    "started": None,
}
_LIVE_FEED_MAX = 400

# Analyst key -> (agent name, report state key), in pipeline order.
_ANALYST_MAP = [
    ("market", "Market Analyst", "market_report"),
    ("social", "Sentiment Analyst", "sentiment_report"),
    ("news", "News Analyst", "news_report"),
    ("fundamentals", "Fundamentals Analyst", "fundamentals_report"),
]


def _live_event(kind: str, agent: str, text: str) -> None:
    """Append one event to the live feed (thread-safe, capped).

    Entry COUNT is capped at _LIVE_FEED_MAX; entry TEXT is stored whole — the
    dashboard renders feed entries as Markdown, and any character slice cuts
    mid-table/mid-word, which is exactly what made analyst summaries look
    broken. Tool-call args are already pre-shrunk by the caller. Each event
    carries a monotonic ``seq`` so the client can spot new events even after
    the served window starts sliding (feed[-160:]).
    """
    with _RUN_LOCK:
        feed = _LIVE["feed"]
        _LIVE["seq"] += 1
        feed.append({
            "ts": datetime.utcnow().isoformat() + "Z",
            "kind": kind,
            "agent": agent,
            "text": text or "",
            "seq": _LIVE["seq"],
        })
        if len(feed) > _LIVE_FEED_MAX:
            del feed[: len(feed) - _LIVE_FEED_MAX]


def _set_agent(name: str, status: str, current: bool = False) -> None:
    with _RUN_LOCK:
        if name in _LIVE["agents"]:
            _LIVE["agents"][name] = status
        if current:
            _LIVE["current_agent"] = name


def _reset_live(ticker: str, selected_analysts: tuple[str, ...]) -> None:
    """Initialise the live view for a new ticker's streaming run."""
    agents: list[str] = []
    for key, name, _r in _ANALYST_MAP:
        if key in selected_analysts:
            agents.append(name)
    agents += ["Bull Researcher", "Bear Researcher", "Research Manager",
               "Trader", "Aggressive Analyst", "Conservative Analyst",
               "Neutral Analyst", "Portfolio Manager"]
    with _RUN_LOCK:
        _LIVE["ticker"] = ticker
        _LIVE["current_agent"] = None
        _LIVE["agents"] = {a: "pending" for a in agents}
        _LIVE["feed"] = []
        _LIVE["reports"] = {}
        _LIVE["seq"] = 0
        _LIVE["started"] = datetime.utcnow().isoformat() + "Z"


def _snapshot_live() -> dict:
    """JSON-safe copy of the live view (feed trimmed to the recent window)."""
    with _RUN_LOCK:
        return {
            "ticker": _LIVE["ticker"],
            "current_agent": _LIVE["current_agent"],
            "agents": dict(_LIVE["agents"]),
            "feed": list(_LIVE["feed"][-160:]),
            "reports": dict(_LIVE["reports"]),
            "started": _LIVE["started"],
        }


def snapshot_status() -> dict:
    """Return a shallow copy of RUN_STATUS (plus the live view) for JSON."""
    with _RUN_LOCK:
        return {
            "running": RUN_STATUS["running"],
            "started": RUN_STATUS["started"],
            "current_ticker": RUN_STATUS["current_ticker"],
            "tickers": [dict(t) for t in RUN_STATUS["tickers"]],
            "last_run": RUN_STATUS["last_run"],
            "run_id": RUN_STATUS["run_id"],
            "trade_date": RUN_STATUS["trade_date"],
            "trigger": RUN_STATUS["trigger"],
            "resumable": RUN_STATUS["resumable"],
            "stopping": RUN_STATUS["running"] and _RUN_STOP.is_set(),
            "live": _snapshot_live(),
        }


# ---------------------------------------------------------------------------
# Ticker helpers
# ---------------------------------------------------------------------------

# A small allow-list of common crypto tickers; anything else is treated as a
# stock. The portfolio/watchlist `type` field takes precedence over this.
CRYPTO_TICKERS = {
    "BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "MATIC",
    "LTC", "BCH", "UNI", "ATOM", "NEAR", "ARB", "OP", "ETC", "SHIB", "PEPE",
}


def resolve_asset_type(ticker: str, state: dict) -> str:
    """Pick the TradingAgents asset_type ('crypto' or 'stock') for a ticker."""
    for bucket in ("portfolio", "watchlist"):
        for entry in state.get(bucket, []):
            if str(entry.get("ticker", "")).upper() == ticker.upper():
                if entry.get("type") in ("crypto", "stock"):
                    return entry["type"]
    return "crypto" if ticker.upper() in CRYPTO_TICKERS else "stock"


def union_tickers(state: dict) -> list[str]:
    """Portfolio tickers first, then watchlist tickers, de-duplicated."""
    seen: set[str] = set()
    out: list[str] = []
    for bucket in ("portfolio", "watchlist"):
        for entry in state.get(bucket, []):
            t = str(entry.get("ticker", "")).strip().upper()
            if t and t not in seen:
                seen.add(t)
                out.append(t)
    return out


# ---------------------------------------------------------------------------
# FRED (St. Louis Fed) macro feed
# ---------------------------------------------------------------------------

_FRED_LOCK = threading.Lock()
_FRED_CACHE: dict | None = None
_FRED_CACHE_TS = 0.0
_FRED_TTL = 1800.0  # 30 minutes


def _fred_series(series_id: str, api_key: str) -> dict | None:
    """Fetch the two most recent observations for one FRED series."""
    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={urllib.parse.quote(series_id)}"
        f"&api_key={urllib.parse.quote(api_key)}"
        "&file_type=json&sort_order=desc&limit=2"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "alpha-stack/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310 (trusted endpoint)
        payload = json.loads(resp.read().decode("utf-8"))
    obs = payload.get("observations", [])
    # FRED emits "." for missing values; convert to float or skip.
    parsed = []
    for o in obs:
        raw = o.get("value")
        if raw is None or raw == ".":
            continue
        try:
            parsed.append({"date": o.get("date"), "value": float(raw)})
        except (TypeError, ValueError):
            continue
    if not parsed:
        return None
    latest = parsed[0]
    prev = parsed[1]["value"] if len(parsed) > 1 else None
    value = latest["value"]
    change = (value - prev) if prev is not None else None
    change_pct = (change / prev * 100.0) if (prev not in (None, 0)) else None
    return {
        "date": latest["date"],
        "value": value,
        "prev": prev,
        "change": change,
        "change_pct": change_pct,
    }


def fetch_fred() -> dict:
    """Return the curated macro strip, cached for _FRED_TTL seconds."""
    global _FRED_CACHE, _FRED_CACHE_TS
    with _FRED_LOCK:
        now = time.time()
        if _FRED_CACHE is not None and (now - _FRED_CACHE_TS) < _FRED_TTL:
            return _FRED_CACHE

    api_key = CONFIG["fred_api_key"]
    series_cfg = CONFIG["fred_series"]

    # Fetch all series concurrently — FRED answers each in well under a second
    # but rate-limits/hiccups on individual calls, so a sequential loop can
    # push the whole strip past the UI's 30s timeout. Parallel fetch keeps the
    # total near the slowest single call.
    def _fetch_one(s):
        sid = s["id"]
        try:
            data = _fred_series(sid, api_key)
        except Exception as exc:  # network/parse failure for one series is non-fatal
            print(f"[fred] {sid} failed: {exc}", file=sys.stderr)
            return None
        if data is None or data["value"] is None:
            return None
        return {
            "id": sid,
            "name": s.get("name", sid),
            "unit": s.get("unit", ""),
            "value": data["value"],
            "prev": data["prev"],
            "change": data["change"],
            "change_pct": data["change_pct"],
            "date": data["date"],
        }

    with ThreadPoolExecutor(max_workers=len(series_cfg) or 1) as pool:
        results = list(pool.map(_fetch_one, series_cfg))
    out = [r for r in results if r is not None]
    result = {"updated": datetime.utcnow().isoformat() + "Z", "series": out}
    with _FRED_LOCK:
        _FRED_CACHE = result
        _FRED_CACHE_TS = time.time()
    return result


# ---------------------------------------------------------------------------
# Ollama model listing
# ---------------------------------------------------------------------------

def fetch_ollama_models() -> list[str]:
    """List installed ollama model names via the local tags endpoint."""
    url = CONFIG["ollama_url"].rstrip("/") + "/api/tags"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "alpha-stack/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
            payload = json.loads(resp.read().decode("utf-8"))
        return [m.get("name", "") for m in payload.get("models", []) if m.get("name")]
    except Exception as exc:
        print(f"[ollama] model list failed: {exc}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------
# TradingAgents runner
# ---------------------------------------------------------------------------

# Captured the first time we import tradingagents so subsequent runs can apply
# env overrides to a pristine base config each time.
_BASE_DEFAULTS = None


def _get_base_defaults():
    """Lazily import tradingagents.default_config and cache its pure defaults."""
    global _BASE_DEFAULTS
    if _BASE_DEFAULTS is not None:
        return _BASE_DEFAULTS
    ta_path = CONFIG["tradingagents_path"]
    if ta_path and ta_path not in sys.path:
        sys.path.insert(0, ta_path)
    from tradingagents.default_config import (  # noqa: WPS433 (lazy import by design)
        DEFAULT_CONFIG,
        _apply_env_overrides,
    )
    _BASE_DEFAULTS = copy.deepcopy(DEFAULT_CONFIG)
    # Stash the override helper alongside so we don't re-import later.
    _get_base_defaults.apply = _apply_env_overrides  # type: ignore[attr-defined]
    return _BASE_DEFAULTS


def _ticker_entry(name: str) -> dict:
    return {"ticker": name, "status": "pending", "decision": None, "report_id": None}


def _classify_msg(message) -> tuple[str, str]:
    """Compact LangChain message -> (display_type, content_text)."""
    try:
        from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
    except Exception:  # langchain_core always present with tradingagents, but be safe
        return ("System", str(getattr(message, "content", "") or ""))
    content = getattr(message, "content", None)
    text = content if isinstance(content, str) else str(content or "")
    if isinstance(message, HumanMessage):
        return ("User", text)
    if isinstance(message, ToolMessage):
        return ("Data", text)
    if isinstance(message, AIMessage):
        return ("Agent", text)
    return ("System", text)


def _process_chunk(chunk: dict, selected_analysts: tuple[str, ...]) -> None:
    """Fold one streamed graph chunk into the live view (agents + feed + reports).

    A compact version of the CLI's MessageBuffer update logic: analyst statuses
    from report-section presence, the research/trading/risk transitions from the
    debate-state fields, and a rolling message/tool feed.
    """
    # --- messages + tool calls ---
    for message in chunk.get("messages", []) or []:
        mtype, text = _classify_msg(message)
        if text and text.strip() and text.strip() != "Continue":
            _live_event("message", mtype, text)
        tool_calls = getattr(message, "tool_calls", None) or []
        for tc in tool_calls:
            try:
                if isinstance(tc, dict):
                    name, args = tc.get("name", "tool"), tc.get("args", {})
                else:
                    name, args = tc.name, tc.args
                preview = str(args)
                if len(preview) > 160:
                    preview = preview[:160] + "…"
                _live_event("tool", "Tool", f"{name}({preview})")
            except Exception:
                _live_event("tool", "Tool", str(tc))

    # --- analyst statuses from report sections (in pipeline order) ---
    active = False
    for key, name, report_key in _ANALYST_MAP:
        if key not in selected_analysts:
            continue
        if chunk.get(report_key):
            _set_agent(name, "completed")
            with _RUN_LOCK:
                _LIVE["reports"][name] = chunk[report_key]
        elif not active and _LIVE["agents"].get(name) != "completed":
            _set_agent(name, "in_progress", current=True)
            active = True

    # --- research team (investment debate) ---
    # NOTE: stream_mode is "values", so every chunk after the debate starts
    # carries the full investment_debate_state. Bull/Bear must be marked
    # "completed" once the Research Manager rules (judge present) — otherwise
    # they read "processing" for the rest of the run (through Risk/Portfolio)
    # and the Research section looks stuck even though the graph has moved on.
    debate = chunk.get("investment_debate_state")
    if debate:
        bull = (debate.get("bull_history") or "").strip()
        bear = (debate.get("bear_history") or "").strip()
        judge = (debate.get("judge_decision") or "").strip()
        if judge:
            _set_agent("Bull Researcher", "completed")
            _set_agent("Bear Researcher", "completed")
            _set_agent("Research Manager", "completed", current=True)
            if bull:
                _LIVE["reports"]["Bull Researcher"] = bull
            if bear:
                _LIVE["reports"]["Bear Researcher"] = bear
            _LIVE["reports"]["Research Manager"] = judge
            _set_agent("Trader", "in_progress", current=True)
        else:
            if bull:
                _set_agent("Bull Researcher", "in_progress", current=True)
                _LIVE["reports"]["Bull Researcher"] = bull
            if bear:
                _set_agent("Bear Researcher", "in_progress", current=True)
                _LIVE["reports"]["Bear Researcher"] = bear

    # --- trading team ---
    if chunk.get("trader_investment_plan"):
        _set_agent("Trader", "completed", current=True)
        _LIVE["reports"]["Trader"] = chunk["trader_investment_plan"]
        _set_agent("Aggressive Analyst", "in_progress", current=True)

    # --- risk management + portfolio manager ---
    risk = chunk.get("risk_debate_state")
    if risk:
        for hist_key, agent in (("aggressive_history", "Aggressive Analyst"),
                                ("conservative_history", "Conservative Analyst"),
                                ("neutral_history", "Neutral Analyst")):
            h = (risk.get(hist_key) or "").strip()
            if h:
                _set_agent(agent, "in_progress", current=not (risk.get("judge_decision") or "").strip())
                _LIVE["reports"][agent] = h
        judge = (risk.get("judge_decision") or "").strip()
        if judge:
            _set_agent("Aggressive Analyst", "completed")
            _set_agent("Conservative Analyst", "completed")
            _set_agent("Neutral Analyst", "completed")
            _set_agent("Portfolio Manager", "completed", current=True)
            _LIVE["reports"]["Portfolio Manager"] = judge


def _run_for_ticker(ticker: str, state: dict, quant_context: str = "",
                    trade_date: str | None = None, resume: bool = False) -> tuple[str, str]:
    """Run TradingAgents for one ticker; return (report_id, decision_text).

    ``quant_context`` is appended to the instrument identity string every
    analyst/researcher/manager reads, so regime + correlation context reach the
    agents' prompts without monkey-patching the CLI. Raises on any failure so
    the caller can mark the ticker errored; raises RunStopped on a stop request.

    The graph runs under TradingAgents' per-ticker SqliteSaver checkpointer
    (keyed on ticker + ``trade_date`` + graph shape), so every node's output is
    saved as it completes. ``resume=True`` continues an interrupted ticker from
    its last completed node; otherwise any leftover checkpoint for the same
    key is dropped first so a fresh run really starts fresh.
    """
    asset_type = resolve_asset_type(ticker, state)
    settings = state.get("settings", {})
    model = settings.get("model") or CONFIG["default_model"]
    language = settings.get("language") or "English"

    # Apply the TradingAgents env overrides the programmatic API honors.
    os.environ["TRADINGAGENTS_LLM_PROVIDER"] = "ollama"
    os.environ["TRADINGAGENTS_LLM_BACKEND_URL"] = CONFIG["ollama_url"].rstrip("/") + "/v1"
    os.environ["TRADINGAGENTS_DEEP_THINK_LLM"] = model
    os.environ["TRADINGAGENTS_QUICK_THINK_LLM"] = model
    os.environ["TRADINGAGENTS_OUTPUT_LANGUAGE"] = language

    base = _get_base_defaults()
    cfg = _get_base_defaults.apply(dict(base))  # type: ignore[attr-defined]
    cfg["results_dir"] = CONFIG["results_dir"]
    cfg["checkpoint_enabled"] = True

    from tradingagents.graph.trading_graph import (  # noqa: WPS433
        TradingAgentsGraph,
    )

    # Subclass to inject quant context (regime + portfolio heat) into the
    # instrument-identity string that all agents read via instrument_context.
    class _QuantGraph(TradingAgentsGraph):
        def resolve_instrument_context(self, ticker_, asset_type_="stock"):  # noqa: D401
            base_ctx = super().resolve_instrument_context(ticker_, asset_type_)
            if quant_context:
                return f"{base_ctx} | Quant context: {quant_context}"
            return base_ctx

    graph = _QuantGraph(
        selected_analysts=("market", "social", "news", "fundamentals"),
        config=cfg,
    )
    selected = ("market", "social", "news", "fundamentals")
    trade_date = trade_date or datetime.now().strftime("%Y-%m-%d")

    # Stream the graph ourselves (like the CLI) so we get a live view: each
    # chunk updates agent statuses + the message/tool feed, and we merge the
    # per-node deltas into a final state for reporting. This replaces the
    # black-box graph.propagate() so the dashboard can show what's happening.
    _reset_live(ticker, selected)
    _live_event("system", "System", f"Starting analysis for {ticker} ({asset_type}) on {trade_date}")
    try:
        graph._resolve_pending_entries(ticker)
    except Exception:
        pass

    instrument_context = graph.resolve_instrument_context(ticker, asset_type)
    init_state = graph.propagator.create_initial_state(
        ticker, trade_date, asset_type=asset_type, instrument_context=instrument_context,
    )
    args = graph.propagator.get_graph_args()

    if not resume:
        graph.clear_checkpoint_on_success(ticker, trade_date, asset_type)
    final_state: dict = {}
    tid = graph.begin_checkpoint(ticker, trade_date, asset_type)
    try:
        args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = tid
        if graph._resuming:
            _live_event("system", "System", f"Resuming {ticker} from its last completed step")
        for chunk in graph.graph.stream(graph.checkpoint_input(init_state), **args):
            try:
                _process_chunk(chunk, selected)
            except Exception as exc:  # live-view errors must never abort the run
                print(f"[run] live-process error: {exc}", file=sys.stderr)
            final_state.update(chunk)
            if _RUN_STOP.is_set():
                # This node's output is already checkpointed; resume picks up here.
                _live_event("system", "System", f"Stopped {ticker} — resumable")
                raise RunStopped(ticker)
        graph.clear_checkpoint_on_success(ticker, trade_date, asset_type)
    finally:
        graph.end_checkpoint()

    # Run finished: every agent is now either completed or (for agents whose
    # status the chunks don't explicitly close — e.g. a researcher left
    # "in_progress") still showing as in-progress. Flip pending AND in_progress
    # to completed and clear current_agent so the dashboard doesn't keep
    # showing "processing" on Research after the run is done.
    with _RUN_LOCK:
        for name in _LIVE["agents"]:
            if _LIVE["agents"][name] in ("pending", "in_progress"):
                _LIVE["agents"][name] = "completed"
        _LIVE["current_agent"] = None
    _live_event("system", "System", f"Finished analysis for {ticker}")

    # Memory-log parity with propagate() (best-effort; reports don't depend on it).
    try:
        graph._log_state(trade_date, final_state)
        graph.memory_log.store_decision(
            ticker=ticker, trade_date=trade_date,
            final_trade_decision=final_state.get("final_trade_decision", ""),
        )
    except Exception:
        pass

    report_path = graph.save_reports(final_state, ticker)
    report_dir = Path(report_path).parent
    report_id = report_dir.name

    decision = None
    decision_file = report_dir / "5_portfolio" / "decision.md"
    if decision_file.exists():
        decision = decision_file.read_text(encoding="utf-8")
    if not decision:
        risk = final_state.get("risk_debate_state") or {}
        decision = risk.get("judge_decision") or final_state.get("final_trade_decision")
    return report_id, (decision or "")


def _run_worker(run_id: str, tickers: list[str]) -> None:
    """Background thread body: iterate tickers, update RUN_STATUS as it goes."""
    # Mark every ticker errored if the heavy machinery won't import.
    try:
        _get_base_defaults()
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[run] import/setup failed: {exc}\n{tb}", file=sys.stderr)
        with _RUN_LOCK:
            for entry in RUN_STATUS["tickers"]:
                if entry["status"] == "pending":
                    entry["status"] = "error"
                    entry["decision"] = f"setup error: {exc}"
            RUN_STATUS["running"] = False
            RUN_STATUS["current_ticker"] = None
        _finish_run(run_id)
        _clear_run_progress()
        return

    state = load_state()

    # Portfolio correlation heat is run-level (same across tickers); compute once.
    # Regime is per-ticker. Both feed the agents via instrument_context.
    quant_contexts: dict[str, str] = {}
    try:
        import signals  # local module; yfinance/numpy/pandas already in venv
        held = [h["ticker"] for h in state.get("portfolio", [])]
        if held:
            heat, _used = signals.portfolio_heat(held)
        else:
            heat = 0.0
        for entry in RUN_STATUS["tickers"]:
            t = entry["ticker"]
            regime = signals.regime_for_ticker(t)
            ctx = f"market regime: {regime}; portfolio correlation heat: {heat:.2f}"
            if heat > 0.8:
                ctx += " (HIGH — reduce correlated exposure before adding)"
            quant_contexts[t] = ctx
    except Exception as exc:
        print(f"[run] quant-context compute failed: {exc}", file=sys.stderr)

    stopped = False
    for entry in RUN_STATUS["tickers"]:
        # A resumed run skips tickers that already completed in this run.
        if entry["status"] == "done":
            continue
        if _RUN_STOP.is_set():
            stopped = True
            break
        ticker = entry["ticker"]
        # Only a ticker cut off mid-graph has a checkpoint worth continuing;
        # pending/errored tickers start fresh.
        resume = entry["status"] == "interrupted"
        with _RUN_LOCK:
            RUN_STATUS["current_ticker"] = ticker
            entry["status"] = "running"
        _persist_run()
        ctx = quant_contexts.get(ticker, "")
        # Liquid-NN next-day forecast (trains at most once a day, ~20s on GPU);
        # fail-open so a torch/ncps problem never costs the ticker its report.
        try:
            import liquid
            line = liquid.context_line(ticker)
            if line:
                ctx = f"{ctx}; {line}" if ctx else line
        except Exception as exc:
            print(f"[run] {ticker} liquid-NN forecast failed: {exc}", file=sys.stderr)
        # Day-trade engine context (banked/cut today, measured intraday edge) —
        # fail-open like the forecast: the ticker's report never depends on it.
        try:
            import daytrade
            line = daytrade.ENGINE.context_line(ticker)
            if line:
                ctx = f"{ctx}; {line}" if ctx else line
        except Exception as exc:
            print(f"[run] {ticker} day-trade context failed: {exc}", file=sys.stderr)
        # Long-term link: the open paper position, pending order and this
        # ticker's previous call (empty when "TradingAgents sees positions" is off).
        try:
            import paper
            line = paper.position_context(ticker, latest_ta_ratings().get(ticker))
            if line:
                ctx = f"{ctx}; {line}" if ctx else line
        except Exception as exc:
            print(f"[run] {ticker} position context failed: {exc}", file=sys.stderr)
        try:
            report_id, decision = _run_for_ticker(
                ticker, state, ctx, trade_date=RUN_STATUS["trade_date"], resume=resume,
            )
            with _RUN_LOCK:
                entry["status"] = "done"
                entry["decision"] = decision
                entry["report_id"] = report_id
        except RunStopped:
            with _RUN_LOCK:
                entry["status"] = "interrupted"
            stopped = True
            break
        except Exception as exc:
            print(f"[run] {ticker} failed: {exc}\n{traceback.format_exc()}", file=sys.stderr)
            with _RUN_LOCK:
                entry["status"] = "error"
                entry["decision"] = f"error: {exc}"
        _persist_run()

    with _RUN_LOCK:
        RUN_STATUS["running"] = False
        RUN_STATUS["current_ticker"] = None
        RUN_STATUS["resumable"] = stopped
    if stopped:
        # Unfinished: keep the progress file; the run is logged and its
        # decisions executed only once it completes (resume) — see _finish_run.
        _persist_run()
        print(f"[run] {run_id} stopped — resumable", file=sys.stderr)
        return
    _finish_run(run_id)
    _clear_run_progress()


def _finish_run(run_id: str) -> None:
    """Update state.schedule.last_run and append to the runs log."""
    status = snapshot_status()
    finished = datetime.utcnow().isoformat() + "Z"
    state = load_state()
    state.setdefault("schedule", {})["last_run"] = finished
    save_state(state)
    with _RUN_LOCK:
        RUN_STATUS["last_run"] = finished

    try:
        RUNS_LOG.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "run_id": run_id,
            "started": status["started"],
            "finished": finished,
            "tickers": [
                {"ticker": t["ticker"], "status": t["status"],
                 "decision": t["decision"], "report_id": t["report_id"]}
                for t in status["tickers"]
            ],
        }
        with RUNS_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as exc:  # logging is best-effort
        print(f"[run] failed to write runs log: {exc}", file=sys.stderr)

    # Execute the run's decisions on the active account. "simulated" is the
    # paper ledger (idempotent per run_id — safe for scheduled and manual
    # runs alike); "live" has no broker connected, so decisions log only.
    mode = (state.get("settings") or {}).get("account_mode", "simulated")
    if mode == "simulated":
        try:
            import paper
            executed = paper.execute_run_decisions(record)
            for e in executed:
                print(f"[paper] {e.get('ticker')}: {e.get('action')} -> {e.get('status')}", file=sys.stderr)
        except Exception as exc:  # paper trading must never break a run
            print(f"[paper] execute failed: {exc}\n{traceback.format_exc()}", file=sys.stderr)
    else:
        print(f"[paper] account mode '{mode}': no broker connected — decisions logged, not executed",
              file=sys.stderr)


def start_run(tickers: list[str] | None = None, trigger: str = "manual") -> tuple[bool, dict]:
    """Kick off a run if none is in flight. Returns (accepted, payload).

    A new run replaces any resumable one (its progress file is overwritten).
    """
    state = load_state()
    if not tickers:
        tickers = union_tickers(state)

    with _RUN_LOCK:
        if RUN_STATUS["running"]:
            return False, {"ok": False, "error": "already running", "status": snapshot_status()}
        run_id = datetime.utcnow().isoformat() + "Z"
        _RUN_STOP.clear()
        RUN_STATUS.update({
            "running": True,
            "started": run_id,
            "current_ticker": None,
            "tickers": [_ticker_entry(t) for t in tickers],
            "last_run": RUN_STATUS.get("last_run"),
            "run_id": run_id,
            "trade_date": datetime.now().strftime("%Y-%m-%d"),
            "trigger": trigger,
            "resumable": False,
        })
        status = snapshot_status()

    if not tickers:
        # Nothing to analyze; finish immediately with an empty run.
        with _RUN_LOCK:
            RUN_STATUS["running"] = False
        _clear_run_progress()
        return True, {"ok": True, "run_id": run_id, "tickers": [], "note": "no tickers"}

    _persist_run()
    thread = threading.Thread(
        target=_run_worker, args=(run_id, tickers), daemon=True, name="ta-run",
    )
    thread.start()
    return True, {"ok": True, "run_id": run_id, "tickers": tickers}


def resume_run() -> tuple[int, dict]:
    """Continue the resumable run: same run_id + trade_date, completed tickers
    skipped, the interrupted ticker continued from its checkpoint."""
    with _RUN_LOCK:
        if RUN_STATUS["running"]:
            return 409, {"ok": False, "error": "already running"}
        if not RUN_STATUS["resumable"]:
            return 409, {"ok": False, "error": "no resumable run"}
        _RUN_STOP.clear()
        RUN_STATUS["running"] = True
        RUN_STATUS["resumable"] = False
        run_id = RUN_STATUS["run_id"]
        remaining = [t["ticker"] for t in RUN_STATUS["tickers"] if t["status"] != "done"]
    _persist_run()
    threading.Thread(
        target=_run_worker, args=(run_id, remaining), daemon=True, name="ta-run",
    ).start()
    return 202, {"ok": True, "run_id": run_id, "tickers": remaining}


def stop_run() -> tuple[int, dict]:
    """Request a stop; the worker halts after the current graph node, keeping
    everything done so far resumable."""
    with _RUN_LOCK:
        if not RUN_STATUS["running"]:
            return 409, {"ok": False, "error": "not running"}
        _RUN_STOP.set()
    return 202, {"ok": True, "stopping": True}


def discard_run() -> tuple[int, dict]:
    """Drop the resumable run. Reports already written stay on disk; the run
    is not logged and its decisions are not executed on the paper account."""
    with _RUN_LOCK:
        if RUN_STATUS["running"]:
            return 409, {"ok": False, "error": "already running"}
        if not RUN_STATUS["resumable"]:
            return 409, {"ok": False, "error": "no resumable run"}
        RUN_STATUS["resumable"] = False
    _clear_run_progress()
    return 200, {"ok": True}


def restore_run() -> None:
    """On startup, reload an unfinished run from RUN_PROGRESS_PATH.

    A scheduled run from today auto-resumes — the scheduler already stamped
    last_run when it fired, so nothing else would ever finish the morning
    report. Anything else (manual runs, older runs) is left resumable for the
    user to resume or discard from the dashboard.
    """
    if not RUN_PROGRESS_PATH.exists():
        return
    try:
        record = json.loads(RUN_PROGRESS_PATH.read_text(encoding="utf-8"))
        tickers = [dict(t) for t in record["tickers"]]
        run_id = record["run_id"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"[run] unreadable run progress, discarding: {exc}", file=sys.stderr)
        _clear_run_progress()
        return
    for t in tickers:
        if t.get("status") == "running":   # cut off mid-graph by the restart
            t["status"] = "interrupted"
    if all(t.get("status") == "done" for t in tickers):
        # Crashed between the last ticker and cleanup — finish it properly.
        with _RUN_LOCK:
            RUN_STATUS.update({"started": record.get("started"), "tickers": tickers,
                               "run_id": run_id, "trade_date": record.get("trade_date"),
                               "trigger": record.get("trigger")})
        _finish_run(run_id)
        _clear_run_progress()
        return
    with _RUN_LOCK:
        RUN_STATUS.update({
            "running": False,
            "started": record.get("started") or run_id,
            "current_ticker": None,
            "tickers": tickers,
            "run_id": run_id,
            "trade_date": record.get("trade_date"),
            "trigger": record.get("trigger"),
            "resumable": True,
        })
    _persist_run()
    done = sum(1 for t in tickers if t.get("status") == "done")
    print(f"[run] restored unfinished run {run_id} ({done}/{len(tickers)} done)", file=sys.stderr)
    if record.get("trigger") == "schedule" and record.get("trade_date") == datetime.now().strftime("%Y-%m-%d"):
        print("[run] auto-resuming today's scheduled run", file=sys.stderr)
        resume_run()


# ---------------------------------------------------------------------------
# Reports on disk
# ---------------------------------------------------------------------------

def _parse_report_dir(name: str) -> tuple[str | None, str | None]:
    """Split ``<TICKER>_<YYYYMMDD_HHMMSS>`` into (ticker, iso timestamp)."""
    # Ticker may itself contain dots/dashes/underscores; the stamp is always
    # the trailing "<8 digits>_<6 digits>".
    m = re.match(r"^(.+)_(\d{8}_\d{6})$", name)
    if not m:
        return (name or None), None
    ticker, stamp = m.group(1), m.group(2)
    try:
        iso = datetime.strptime(stamp, "%Y%m%d_%H%M%S").isoformat()
    except ValueError:
        return ticker, None
    return ticker, iso


_RATING_RES = [
    re.compile(r"\*\*\s*(?:Rating|Recommendation|Action|Final Decision)\s*\*\*\s*:?\s*\**\s*([A-Za-z]+)", re.I),
    re.compile(r"FINAL TRANSACTION PROPOSAL:\s*\**\s*([A-Za-z]+)", re.I),
    re.compile(r"^\s*(?:Rating|Recommendation|Action)\s*:\s*\**\s*([A-Za-z]+)", re.I | re.M),
]
_RATINGS = {"buy": "Buy", "overweight": "Overweight", "hold": "Hold", "underweight": "Underweight", "sell": "Sell"}


def extract_rating(text: str | None) -> str | None:
    """Same rule as the page's extractRating(): the report's stated call."""
    for rx in _RATING_RES:
        m = rx.search(text or "")
        if m:
            return _RATINGS.get(m.group(1).lower())
    return None


def latest_ta_ratings() -> dict[str, dict]:
    """Newest TradingAgents rating per ticker — the call the paper account trades."""
    out: dict[str, dict] = {}
    for r in list_reports():                # newest first
        t = (r.get("ticker") or "").upper()
        if not t or t in out:
            continue
        rating = extract_rating(r.get("decision"))
        if rating:
            out[t] = {"rating": rating, "report_id": r["id"], "date": (r.get("timestamp") or "")[:10]}
    return out


def long_term_stances(tickers: list[str]) -> dict[str, dict]:
    """Each ticker's long-term stance, for the day-trade engine's alignment
    card: the TradingAgents rating (the call the paper account trades) first,
    then the Liquid NN daily call, plus whether the long-term book holds it."""
    ratings = latest_ta_ratings()
    held: dict[str, float] = {}
    entry_px: dict[str, float] = {}
    orders: dict[str, str] = {}
    try:
        import paper
        pp = paper.load_paper()
        for p in pp.get("positions", []):
            try:
                qty = float(p.get("qty") or 0)
            except (TypeError, ValueError):
                qty = 0.0
            if qty:
                held[str(p.get("ticker", "")).upper()] = qty
                entry_px[str(p.get("ticker", "")).upper()] = float(p.get("entry_price") or 0)
        for o in pp.get("pending_trades", []):
            orders[str(o.get("ticker", "")).upper()] = (o.get("intent") or {}).get("action") or "order"
    except Exception as exc:  # holdings are context; a read failure is non-fatal
        print(f"[stance] holdings unavailable: {exc}", file=sys.stderr)
    import liquid
    cost_bps = 4.0
    try:
        import daytrade
        cost_bps = daytrade.round_trip_bps(daytrade.ENGINE.cfg)
    except Exception:
        pass
    out: dict[str, dict] = {}
    for t in tickers:
        t = str(t).strip().upper()
        if not t:
            continue
        r = ratings.get(t) or {}
        f = liquid.today_cached(t) or liquid.cached(t) or {}
        lc = liquid_call(f, cost_bps)
        rating = r.get("rating")
        direction = reason = None
        if rating in ("Buy", "Overweight"):
            direction, reason = "bullish", f"TradingAgents {rating} ({r.get('date') or 'latest report'})"
        elif rating in ("Sell", "Underweight"):
            direction, reason = "bearish", f"TradingAgents {rating} ({r.get('date') or 'latest report'})"
        elif rating == "Hold":
            direction, reason = "hold", f"TradingAgents Hold ({r.get('date') or 'latest report'})"
        elif lc.get("action") in ("BUY", "SELL"):
            direction = "bullish" if lc["action"] == "BUY" else "bearish"
            pct = f.get("predicted_change_pct")
            reason = (f"Liquid NN {lc['action']} ({pct:+.2f}% next close)"
                      if isinstance(pct, (int, float)) else f"Liquid NN {lc['action']}")
        elif f and "error" not in f and not f.get("pending"):
            # A real forecast that adds up to NO SIGNAL = a known, neutral view.
            direction, reason = "hold", "Liquid NN: no signal today"
        out[t] = {"direction": direction, "reason": reason,
                  "ta_rating": rating, "ta_date": r.get("date"),
                  "liquid_call": lc.get("action"), "liquid_pct": f.get("predicted_change_pct"),
                  "held_qty": held.get(t, 0.0), "entry_price": entry_px.get(t),
                  "pending_order": orders.get(t)}
    return out


def liquid_call(f: dict, cost_bps: float) -> dict:
    """BUY/SELL when the predicted move clears the round-trip cost; else
    NO SIGNAL. (The naive-baseline test no longer gates the call — the
    prediction is used as-is, like the day-trade engine's AI mode.)"""
    if f.get("pending") or f.get("error"):
        return {"action": "NO SIGNAL", "reason": "no forecast yet" if f.get("pending") else "forecast failed"}
    pct = f.get("predicted_change_pct") or 0.0
    if abs(pct) * 100 <= cost_bps:
        return {"action": "NO SIGNAL",
                "reason": f"predicted move {pct:+.2f}% is inside the {cost_bps / 100:.2f}% round-trip cost"}
    return {"action": "BUY" if pct > 0 else "SELL",
            "reason": f"predicts {pct:+.2f}% tomorrow"}


def list_reports(limit: int = 100) -> list[dict]:
    """Scan the results reports directory newest-first."""
    reports_root = Path(CONFIG["results_dir"]).expanduser() / "reports"
    if not reports_root.exists():
        return []
    out = []
    for d in reports_root.iterdir():
        if not d.is_dir():
            continue
        ticker, ts = _parse_report_dir(d.name)
        if not ticker:
            continue
        complete = d / "complete_report.md"
        if not complete.exists():
            continue
        decision = None
        dec_file = d / "5_portfolio" / "decision.md"
        if dec_file.exists():
            try:
                decision = dec_file.read_text(encoding="utf-8")
            except OSError:
                decision = None
        out.append({
            "id": d.name,
            "ticker": ticker,
            "timestamp": ts,
            "decision": decision,
            "path": str(complete),
        })
    out.sort(key=lambda r: (r["timestamp"] or ""), reverse=True)
    return out[:limit]


def read_report(report_id: str) -> dict | None:
    """Return the markdown + decision for a report directory name."""
    report_dir = (Path(CONFIG["results_dir"]).expanduser() / "reports" / report_id)
    complete = report_dir / "complete_report.md"
    if not complete.exists():
        return None
    ticker, ts = _parse_report_dir(report_id)
    decision = None
    dec_file = report_dir / "5_portfolio" / "decision.md"
    if dec_file.exists():
        try:
            decision = dec_file.read_text(encoding="utf-8")
        except OSError:
            pass
    return {
        "id": report_id,
        "ticker": ticker,
        "timestamp": ts,
        "markdown": complete.read_text(encoding="utf-8"),
        "decision": decision,
    }


# ---------------------------------------------------------------------------
# Quant signals + backtest (extensions 1-5)
# ---------------------------------------------------------------------------

_SIGNALS_LOCK = threading.Lock()
_SIGNALS_CACHE: dict | None = None
_SIGNALS_CACHE_TS = 0.0
_SIGNALS_TTL = 300.0  # 5 minutes


def fetch_signals() -> dict:
    """Regime per ticker + portfolio correlation heat + crypto OFI/funding.

    Computed over the union of portfolio + watchlist tickers; cached briefly so
    the dashboard isn't re-fetching a year of prices on every refresh.
    """
    global _SIGNALS_CACHE, _SIGNALS_CACHE_TS
    with _SIGNALS_LOCK:
        if _SIGNALS_CACHE is not None and (time.time() - _SIGNALS_CACHE_TS) < _SIGNALS_TTL:
            return _SIGNALS_CACHE

    import signals
    state = load_state()
    tickers = union_tickers(state)
    held = [h["ticker"] for h in state.get("portfolio", [])]

    # Regime + (crypto only) OFI/funding, fetched concurrently — yfinance and the
    # exchange endpoints are each fast but sequential would stack up.
    def _one(t: str) -> dict:
        entry = {"ticker": t, "regime": signals.regime_for_ticker(t)}
        if resolve_asset_type(t, state) == "crypto":
            sym = signals._binance_symbol(t)
            entry["ofi"] = signals.ofi_snapshot(sym)
            entry["funding_rate"] = signals.funding_rate(sym)
        return entry

    with ThreadPoolExecutor(max_workers=len(tickers) or 1) as pool:
        per_ticker = list(pool.map(_one, tickers))

    heat, heat_used = signals.portfolio_heat(held) if len(held) >= 2 else (0.0, [])

    warnings = []
    if heat > 0.8:
        warnings.append(f"Portfolio correlation heat {heat:.2f} > 0.8 — reduce correlated exposure.")
    for e in per_ticker:
        if e.get("regime") == "high_volatility":
            warnings.append(f"{e['ticker']} in high-volatility regime — size down.")
        if e.get("funding_rate") is not None and abs(e["funding_rate"]) > 0.0005:
            warnings.append(f"{e['ticker']} funding rate {e['funding_rate']*100:.3f}% — crowded.")

    result = {
        "updated": datetime.utcnow().isoformat() + "Z",
        "regimes": per_ticker,
        "heat": round(heat, 3),
        "heat_tickers": heat_used,
        "warnings": warnings,
    }
    with _SIGNALS_LOCK:
        _SIGNALS_CACHE = result
        _SIGNALS_CACHE_TS = time.time()
    return result


def run_backtest(horizon: int = 5) -> dict:
    """Paper P&L over logged run decisions (extensions doc #4, honest version)."""
    import signals
    records: list[dict] = []
    if RUNS_LOG.exists():
        try:
            for line in RUNS_LOG.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                date = (rec.get("started") or rec.get("finished") or "")
                # Trim to the date portion for clean indexing against price series.
                date = date[:10] if date else ""
                done = [t for t in rec.get("tickers", []) if t.get("status") == "done" and t.get("decision")]
                if date and done:
                    records.append({"date": date, "tickers": done})
        except Exception as exc:
            print(f"[backtest] failed to read runs log: {exc}", file=sys.stderr)
    return signals.paper_backtest(records, horizon=horizon)


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

_SCHED_STOP = threading.Event()


def _scheduler_loop() -> None:
    """Fire one run per day at the configured local HH:MM."""
    while not _SCHED_STOP.is_set():
        try:
            state = load_state()
            sched = state.get("schedule", {})
            if sched.get("enabled"):
                target = str(sched.get("time", "")).strip()
                now = datetime.now()
                now_hhmm = now.strftime("%H:%M")
                today = now.strftime("%Y-%m-%d")
                last = sched.get("last_run")
                last_date = last[:10] if isinstance(last, str) else None
                if target == now_hhmm and last_date != today:
                    # Mark last_run today immediately to avoid double-firing
                    # within the same minute on a slow 20s poll.
                    state["schedule"]["last_run"] = now.isoformat()
                    save_state(state)
                    tickers = union_tickers(state)
                    print(f"[sched] firing scheduled run for {tickers}", file=sys.stderr)
                    start_run(tickers, trigger="schedule")
        except Exception as exc:  # never let the scheduler die
            print(f"[sched] error: {exc}", file=sys.stderr)
        _SCHED_STOP.wait(20.0)


def _broker_loop() -> None:
    """Keep the simulated account current while the dashboard runs: resolve
    pending fills after each session open, check stops/targets/horizons, mark
    equity and score matured decisions. Idempotent and quiet when nothing
    has changed (one equity point per day by design)."""
    import paper
    while not _SCHED_STOP.is_set():
        try:
            summary = paper.daily_pass()
            if summary["filled"] or summary["events"] or summary["scored"]:
                print(f"[paper] pass: {summary['filled']} fill(s), "
                      f"{summary['scored']} scored, {summary['events']}",
                      file=sys.stderr)
        except Exception as exc:  # never let the broker loop die
            print(f"[paper] pass failed: {exc}", file=sys.stderr)
        _SCHED_STOP.wait(600.0)


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    """Tiny JSON API + static index.html handler."""

    server_version = "alpha-stack/1.0"

    # Silence the default noisy request logging; keep one concise line.
    def log_message(self, fmt, *args):  # noqa: A003 - matching stdlib signature
        print(f"[http] {self.address_string()} {fmt % args}", file=sys.stderr)

    # -- helpers ----------------------------------------------------------
    def _send(self, status: int, body, content_type: str = "application/json"):
        if isinstance(body, (dict, list)):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, bytes):
            data = body
        else:
            data = str(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status: int, payload):
        self._send(status, payload, "application/json")

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        return self.rfile.read(length)

    # -- routing ----------------------------------------------------------
    def do_GET(self):  # noqa: N802 - stdlib signature
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            return self._serve_index()
        if path == "/api/state":
            return self._send_json(200, load_state())
        if path == "/api/models":
            return self._send_json(200, {"models": fetch_ollama_models()})
        if path == "/api/fred":
            return self._send_json(200, fetch_fred())
        if path == "/api/signals":
            return self._send_json(200, fetch_signals())
        if path == "/api/backtest":
            return self._send_json(200, run_backtest())
        if path == "/api/liquid":
            return self._get_liquid(query)
        if path.startswith("/api/daytrade/"):
            return self._get_daytrade(path)
        if path == "/api/paper":
            import paper
            return self._send_json(200, paper.paper_overview())
        if path == "/api/accuracy":
            import paper
            return self._send_json(200, paper.scorecard())
        if path == "/api/status":
            return self._send_json(200, snapshot_status())
        if path == "/api/reports":
            return self._send_json(200, {"reports": list_reports()})
        if path == "/api/report":
            report_id = (query.get("id") or [None])[0]
            if not report_id:
                return self._send_json(400, {"error": "missing id"})
            rep = read_report(report_id)
            if rep is None:
                return self._send_json(404, {"error": "not found"})
            return self._send_json(200, rep)
        return self._send_json(404, {"error": "not found"})

    def _get_liquid(self, query: dict):
        """?ticker=X -> forecast (trains if not yet trained today, ~20s);
        no ticker -> today's cached forecasts for portfolio + watchlist."""
        import liquid
        ticker = (query.get("ticker") or [""])[0].strip()
        if ticker:
            force = (query.get("force") or ["0"])[0] in ("1", "true")
            try:
                return self._send_json(200, liquid.forecast(ticker, force=force))
            except Exception as exc:
                print(f"[liquid] {ticker} failed: {exc}\n{traceback.format_exc()}", file=sys.stderr)
                return self._send_json(500, {"ticker": ticker.upper(), "error": str(exc)})
        # Never trains inline: tickers without today's result are handed to the
        # single background trainer, and shown as pending (no result yet) or
        # with yesterday's result flagged ``refreshing``.
        out, stale = [], []
        for t in union_tickers(load_state()):
            fresh = liquid.today_cached(t)
            if fresh:
                out.append(fresh)
                continue
            stale.append(t)
            old = liquid.cached(t)
            out.append({**old, "refreshing": True} if old and "error" not in old
                       else {"ticker": t.upper(), "pending": True})
        if stale:
            liquid.enqueue(stale)
        import daytrade
        cost_bps = daytrade.round_trip_bps(daytrade.ENGINE.cfg)
        ratings = latest_ta_ratings()
        for f in out:
            f["call"] = liquid_call(f, cost_bps)
            f["ta_rating"] = ratings.get(f["ticker"])
        return self._send_json(200, {"forecasts": out, "trainer": liquid.queue_state(),
                                     "cost_bps": cost_bps})

    # -- day trading (paper only) ---------------------------------------
    def _get_daytrade(self, path: str):
        import daytrade
        eng = daytrade.ENGINE
        # Training is started explicitly (Train models button, or the live
        # engine's start) — a year of minute bars per ticker is GPU-minutes.
        if path == "/api/daytrade/status":
            return self._send_json(200, eng.snapshot())
        if path == "/api/daytrade/overview":
            return self._send_json(200, eng.longterm_payload())
        if path == "/api/daytrade/models/sets":
            return self._send_json(200, eng.list_model_sets())
        if path == "/api/daytrade/knobs":
            return self._send_json(200, eng.knob_catalog())
        if path == "/api/daytrade/signals":
            return self._send_json(200, eng.signals_payload())
        if path == "/api/daytrade/trades":
            return self._send_json(200, eng.trades())
        if path == "/api/daytrade/config":
            return self._send_json(200, {**eng.cfg, "cost_bps": daytrade.round_trip_bps(eng.cfg)})
        if path == "/api/daytrade/stream":
            return self._daytrade_stream(eng)
        return self._send_json(404, {"error": "not found"})

    def _daytrade_stream(self, eng):
        """Server-sent events: one ``snapshot`` event per engine update, a
        keep-alive comment every 15s. Runs on this request's own handler
        thread and returns when the client goes away — no extra threads."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        seq = -1
        try:
            while True:
                cur = eng.wait_seq(seq, 15.0)
                if cur == seq:
                    self.wfile.write(b": keep-alive\n\n")
                else:
                    seq = cur
                    data = json.dumps(eng.stream_payload(), ensure_ascii=False, default=str)
                    self.wfile.write(b"event: snapshot\ndata: " + data.encode("utf-8") + b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return

    def _post_daytrade(self, path: str):
        import daytrade
        eng = daytrade.ENGINE
        try:
            body = json.loads(self._read_body().decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._send_json(400, {"ok": False, "error": "invalid JSON"})
        if not isinstance(body, dict):
            return self._send_json(400, {"ok": False, "error": "body must be a JSON object"})
        if path == "/api/daytrade/start":
            if body.get("mode") == "replay":
                return self._send_json(*eng.start_replay(body))
            return self._send_json(200, eng.start())
        if path == "/api/daytrade/stop":
            return self._send_json(200, eng.stop())
        if path == "/api/daytrade/replay":
            return self._send_json(*eng.start_replay(body))
        if path == "/api/daytrade/replay/stop":
            return self._send_json(*eng.stop_replay())
        if path == "/api/daytrade/config":
            return self._send_json(*eng.set_config(body))
        if path == "/api/daytrade/reset":
            return self._send_json(200, eng.reset())
        if path == "/api/daytrade/train/stop":
            return self._send_json(*eng.stop_training())
        if path == "/api/daytrade/train/clear":
            return self._send_json(*eng.clear_models())
        if path == "/api/daytrade/train":
            return self._send_json(*eng.train_all())
        if path == "/api/daytrade/models/save":
            return self._send_json(*eng.save_model_set(body.get("name", ""), body.get("note", "")))
        if path == "/api/daytrade/models/load":
            return self._send_json(*eng.load_model_set(body.get("name", ""), body.get("with_settings", True) is not False))
        if path == "/api/daytrade/models/delete":
            return self._send_json(*eng.delete_model_set(body.get("name", "")))
        if path == "/api/daytrade/config/reset":
            return self._send_json(*eng.reset_config(body.get("group")))
        if path == "/api/daytrade/trade":
            return self._send_json(*eng.manual(str(body.get("ticker", "")), str(body.get("action", ""))))
        return self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):  # noqa: N802 - stdlib signature
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/daytrade/"):
            return self._post_daytrade(path)

        if path == "/api/state":
            return self._post_state()
        if path == "/api/run":
            return self._post_run()
        if path == "/api/run/resume":
            return self._send_json(*resume_run())
        if path == "/api/run/stop":
            return self._send_json(*stop_run())
        if path == "/api/run/discard":
            return self._send_json(*discard_run())
        if path == "/api/paper/reset":
            import paper
            paper.reset()
            return self._send_json(200, {"ok": True, **paper.paper_overview()})
        if path == "/api/paper/trade":
            import paper
            try:
                body = json.loads(self._read_body().decode("utf-8") or "{}")
            except json.JSONDecodeError:
                return self._send_json(400, {"error": "invalid JSON"})
            booked = paper.manual_trade(
                ticker=body.get("ticker", ""),
                action=body.get("action", ""),
                size_pct=body.get("size_pct"),
                stop_loss=body.get("stop_loss"),
                take_profit=body.get("take_profit"),
                horizon_days=body.get("horizon_days"),
                note=body.get("note"),
            )
            if "error" in booked:
                return self._send_json(400, booked)
            return self._send_json(200, {"ok": True, **booked})
        return self._send_json(404, {"error": "not found"})

    # -- route handlers ---------------------------------------------------
    def _serve_index(self):
        if not INDEX_HTML.exists():
            return self._send_json(404, {"error": "index.html missing"})
        data = INDEX_HTML.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _post_state(self):
        try:
            body = json.loads(self._read_body().decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._send_json(400, {"error": "invalid JSON"})
        # Light validation: coerce known keys into the right shapes.
        # Merge onto the LOADED state — building from _default_state() here
        # wiped portfolio/watchlist/schedule whenever a POST updated only
        # one key (2026-09-23: a settings-only POST emptied the portfolio).
        state = load_state()
        for key in ("portfolio", "watchlist"):
            if isinstance(body.get(key), list):
                state[key] = body[key]
        if isinstance(body.get("settings"), dict):
            state["settings"] = {**state["settings"], **body["settings"]}
        if isinstance(body.get("schedule"), dict):
            state["schedule"] = {**state["schedule"], **body["schedule"]}
        save_state(state)
        self._send_json(200, {"ok": True, "state": state})

    def _post_run(self):
        try:
            body = json.loads(self._read_body().decode("utf-8") or "{}")
        except json.JSONDecodeError:
            body = {}
        tickers = body.get("tickers") if isinstance(body, dict) else None
        accepted, payload = start_run(tickers)
        self._send_json(202 if accepted else 409, payload)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    # Make sure the state file's parent exists for a clean first start.
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    restore_run()

    sched_thread =threading.Thread(target=_scheduler_loop, daemon=True, name="scheduler")
    sched_thread.start()
    broker_thread = threading.Thread(target=_broker_loop, daemon=True, name="paper-broker")
    broker_thread.start()
    import daytrade
    daytrade.set_stance_provider(long_term_stances)
    daytrade.ENGINE.boot(lambda: union_tickers(load_state()))

    host, port = CONFIG["host"], CONFIG["port"]
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Alpha-stack dashboard on http://{host}:{port}", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", file=sys.stderr)
    finally:
        _SCHED_STOP.set()
        httpd.server_close()


if __name__ == "__main__":
    main()
