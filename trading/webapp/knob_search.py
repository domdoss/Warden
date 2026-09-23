#!/usr/bin/env python3
"""Eternal day-trade knob search, driven by local Granite.

Each trial: Granite (ollama) reads the trial history and proposes one knob
configuration; the script validates it against the knob catalog, trains a
throwaway model per ticker (``persist=False`` — nothing is written to the
live model store, the trial lives and dies in memory), and scores it with
the same honest walk-forward edge test the live engine is gated on. Results
append to a JSONL file and feed the next proposal. Forever.

Run:     /opt/Warden/trading/bin/python /opt/Warden/trading/webapp/knob_search.py
Stop:    touch /opt/Warden/trading/webapp/knob_search.stop   (checked between trials)
Resume:  rm the stop file and rerun — history is read back from the JSONL.
Verify:  .../knob_search.py --propose-only   (one Granite proposal, no training)
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import daytrade  # noqa: E402  (importing it creates the inert Engine; nothing runs until told)
import knobs  # noqa: E402

OLLAMA_CHAT = "http://localhost:11434/api/chat"
PROPOSER = "granite4.2:8b"
TICKERS = ["SPY", "NVDA", "GEV"]  # diverse trio: index ETF, big chip, mover
HISTORY = "/opt/Warden/trading/logs/knob_search.jsonl"
STOP_FILE = os.path.join(HERE, "knob_search.stop")
PID_FILE = os.path.join(HERE, "knob_search.pid")
PROMPT_TRIALS = 20          # recent trials shown to Granite
MAX_PROPOSE_TRIES = 3       # then a random config keeps the loop moving

# Knobs Granite may search. The scoring protocol is held fixed (test period,
# folds, costs, risk sizing) so scores stay comparable across trials.
SEARCH_SPACE = {
    "horizon_min":    "minutes ahead the model predicts and trades: one of 5, 15, 30, 60, 120",
    "look_back":      "recent 1-minute bars fed to the network: 10 to 240",
    "hidden_units":   "network size in liquid neurons: one of 8, 16, 32, 64, 128",
    "features":       "inputs the model sees, a subset of: " + ", ".join(o["value"] for o in knobs.FEATURE_OPTIONS),
    "train_window":   "history to learn from: one of week, month, year",
    "max_epochs":     "most passes over the data: 5 to 200",
    "patience":       "passes without improvement before stopping early: 1 to 30",
    "batch_size":     "samples per training step: one of 256, 512, 1024, 2048, 4096, 8192, 16384, 32768",
    "learning_rate":  "training step size: 0.0001 to 0.03",
    "weight_decay":   "pull toward simpler fits: 0.0 to 0.01",
    "allow_short":    "true to trade drops as well as rises",
    "edge_mult":      "times the round-trip cost a prediction must promise before trading: 0.5 to 5",
    "stop_sigma":     "stop-loss distance in typical moves: 0.25 to 5",
    "target_sigma":   "profit-target distance in typical moves: 0.25 to 10",
    "be_trigger":     "stop moves to entry once this many stop-distances in profit: 0 (off) to 3",
    "trail_sigma":    "stop trails this many stop-distances behind the best price: 0 (off) to 5",
    "daily_take_usd":  "dollars: once the day is up this much, flatten and stop for the day: 0 (off) to 10000",
    "max_daily_loss_usd": "dollars: once the day is down this much, flatten and stop for the day: 0 (off) to 10000",
    "recoup_risk_mult": "fraction of normal risk used from midday while the day is down: 0.1 to 1 (1 = off)",
}

SYSTEM_PROMPT = """ROLE: You are the research driver of a day-trading model search.
CAPABILITIES: You see the searchable knobs with their ranges, the best configuration found so far, and the results of recent trials.
GUIDELINES:
- Read the recent trials, then propose the configuration that best advances the search.
- Balance exploring new areas of the knob space with refining around the best result so far.
- Every value stays inside its stated range.
- Include every knob you want to set; knobs you leave out keep the current best values.
- A good result is a high average net profit per trade in basis points with a healthy number of trades; a result with very few trades is weak evidence.
FORMAT: Reply with one JSON object. Its keys are knob names with your chosen values, plus a "reason" key holding one short sentence explaining the choice."""


# --------------------------------------------------------------------------
# Granite proposals
# --------------------------------------------------------------------------

def ask_granite(system: str, user: str) -> dict:
    body = {"model": PROPOSER,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "stream": False, "format": "json",
            "options": {"temperature": 0.8, "num_predict": 800}}
    req = urllib.request.Request(OLLAMA_CHAT, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        content = json.loads(r.read()).get("message", {}).get("content", "")
    if not content.strip():
        raise RuntimeError("empty response from the model")
    return json.loads(content)


def compact(r: dict) -> dict:
    """One history row as Granite sees it: config, score, trades (or the error)."""
    if r.get("error"):
        return {"n": r["n"], "config": r["config"], "error": r["error"]}
    return {"n": r["n"], "config": r["config"], "score": r["score"], "trades": r["trades_total"]}


def build_user_prompt(rows: list[dict], best: dict | None, feedback: str) -> str:
    lines = ["KNOBS YOU MAY SET (name: meaning):"]
    for k, desc in SEARCH_SPACE.items():
        lines.append(f"- {k}: {desc}")
    if best:
        lines.append("\nCURRENT BEST (score = average net basis points per trade across "
                     + ", ".join(TICKERS) + "; costs are included; higher is better):")
        lines.append(json.dumps({"config": best["config"], "score": best["score"],
                                 "trades": best["trades_total"]}))
    recent = [compact(r) for r in rows[-PROMPT_TRIALS:]]
    if recent:
        lines.append("\nRECENT TRIALS (oldest first):")
        lines.append(json.dumps(recent))
    if feedback:
        lines.append("\n" + feedback)
    lines.append("\nPropose the next configuration.")
    return "\n".join(lines)


def validate(proposal: dict, base: dict) -> tuple[dict, list[str]]:
    """Coerce a proposal onto the base config; collect any range complaints."""
    cfg = dict(base)
    complaints = []
    for k, v in (proposal.items() if isinstance(proposal, dict) else []):
        if k not in SEARCH_SPACE:
            continue  # "reason" and anything unsearchable are ignored
        try:
            cfg[k] = knobs.coerce(k, v)
        except (ValueError, KeyError) as exc:
            complaints.append(str(exc))
    return cfg, complaints


def random_config() -> dict:
    """A uniformly random point in the search space (fallback so the loop never stalls)."""
    out = {}
    for k in SEARCH_SPACE:
        kdef = knobs.BY_KEY[k]
        t = kdef["type"]
        if t == "bool":
            v = random.random() < 0.8
        elif t == "select":
            v = random.choice(kdef["options"])["value"]
        elif t == "multiselect":
            opts = [o["value"] for o in kdef["options"]]
            v = random.sample(opts, random.randint(3, len(opts)))
        else:
            n_steps = int((kdef["max"] - kdef["min"]) / kdef["step"]) + 1
            v = kdef["min"] + kdef["step"] * random.randrange(n_steps)
        out[k] = knobs.coerce(k, v)
    return out


# --------------------------------------------------------------------------
# Trials
# --------------------------------------------------------------------------

def run_trial(cfg: dict) -> tuple[dict, dict]:
    """Train throwaway models and score them. Returns (per-ticker edges, seconds)."""
    through = daytrade.last_session()
    slots = daytrade._device_slots()
    dev = slots.get()
    edges, secs = {}, {}
    try:
        for t in TICKERS:
            m = daytrade._train_ticker_on(t, through, cfg, lambda *a, **k: None,
                                          f"knobsearch-{t}", None, None, dev, persist=False)
            edges[t] = m["meta"]["edge"]
            secs[t] = m["meta"].get("train_seconds")
    finally:
        slots.put(dev)
    return edges, secs


def cfg_fingerprint(cfg: dict) -> str:
    return json.dumps({k: cfg[k] for k in sorted(SEARCH_SPACE)}, sort_keys=True)


def main() -> None:
    propose_only = "--propose-only" in sys.argv
    if os.path.exists(PID_FILE):
        try:
            pid = int(open(PID_FILE).read().strip())
        except ValueError:
            pid = 0
        if pid and pid != os.getpid() and os.path.exists(f"/proc/{pid}"):
            sys.exit(f"knob_search already running as pid {pid} — remove {PID_FILE} if that is stale")
    open(PID_FILE, "w").write(str(os.getpid()))

    rows: list[dict] = []
    if os.path.exists(HISTORY):
        for line in open(HISTORY, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    seen = {cfg_fingerprint({**knobs.defaults(), **r["config"]})
            for r in rows if not r.get("error") and r.get("config")}
    best = max((r for r in rows if r.get("score") is not None), key=lambda r: r["score"], default=None)
    n = len(rows)

    if propose_only:
        try:
            proposal = ask_granite(SYSTEM_PROMPT, build_user_prompt(rows, best, ""))
        except Exception as exc:
            print(f"proposal failed: {exc}")
            return
        cfg, complaints = validate(proposal, knobs.defaults())
        print("proposal:", json.dumps(proposal, indent=2))
        print("effective search knobs:", json.dumps({k: cfg[k] for k in SEARCH_SPACE}, indent=2))
        if complaints:
            print("range complaints:", complaints)
        return

    while not os.path.exists(STOP_FILE):
        n += 1
        base = knobs.defaults()
        if best:
            base = {**base, **best["config"]}
        # -- propose: up to MAX_PROPOSE_TRIES, then a random fallback ----------
        source, reason, cfg = "random", "fallback: random point in the search space", None
        feedback = ""
        for _ in range(MAX_PROPOSE_TRIES):
            try:
                proposal = ask_granite(SYSTEM_PROMPT, build_user_prompt(rows, best, feedback))
            except Exception as exc:
                feedback = f"Your proposal could not be read ({exc.__class__.__name__}); reply with one JSON object."
                continue
            cfg, complaints = validate(proposal, base)
            reason = str(proposal.get("reason", ""))[:200] if isinstance(proposal, dict) else ""
            if complaints:
                feedback = "Some values were outside their ranges: " + "; ".join(complaints) + ". Choose again."
                cfg = None
                continue
            if cfg_fingerprint(cfg) in seen:
                feedback = "That exact configuration was already tried; choose clearly different values."
                cfg = None
                continue
            source = "granite"
            break
        if cfg is None:
            cfg = {**base, **random_config()}
            cfg = {**base, **{k: cfg[k] for k in SEARCH_SPACE}}

        search_cfg = {k: cfg[k] for k in SEARCH_SPACE}
        row = {"n": n, "ts": datetime.now(timezone.utc).isoformat(),
               "source": source, "reason": reason, "config": search_cfg}
        t0 = time.time()
        try:
            edges, secs = run_trial(cfg)
            row["per_ticker"] = {t: {m: e.get(m) for m in ("avg_net_bps", "avg_gross_bps", "trades",
                                                            "win_rate_pct", "direction_hit_pct")}
                                 for t, e in edges.items()}
            nets = [e.get("avg_net_bps") or 0.0 for e in edges.values()]
            row["score"] = round(sum(nets) / len(nets), 2)
            row["trades_total"] = sum(e.get("trades") or 0 for e in edges.values())
            row["train_seconds"] = round(sum(s or 0 for s in secs.values()), 1)
            per = " ".join(f"{t} {row['per_ticker'][t]['avg_net_bps']:+.1f}" for t in TICKERS)
            print(f"[{row['ts'][11:19]}] trial {n} ({source}) | score {row['score']:+.2f} bps "
                  f"| trades {row['trades_total']} | {per} | {secs_total_label(secs)}s "
                  f"| horizon={cfg['horizon_min']} window={cfg['train_window']} "
                  f"| {reason}", flush=True)
            if best is None or row["score"] > best["score"]:
                best = row
                print(f"    *** new best: trial {n} ***", flush=True)
        except Exception as exc:  # a failed trial is data too — Granite sees it next round
            row["error"] = f"{exc.__class__.__name__}: {exc}"
            print(f"[{row['ts'][11:19]}] trial {n} ({source}) | ERROR {row['error']}", flush=True)
        row["wall_seconds"] = round(time.time() - t0, 1)
        seen.add(cfg_fingerprint(cfg))
        rows.append(row)
        os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
        with open(HISTORY, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
    print(f"stop file present after {n} trials — exiting", flush=True)


def secs_total_label(secs: dict) -> str:
    return str(int(sum(s or 0 for s in secs.values())))


if __name__ == "__main__":
    main()