#!/usr/bin/env python3
"""Steve — a STANDALONE big-button voice application.

Completely independent of the main voice app: no control server, no shared
process, no bridge to the main UI. This process owns its own mic (VAD
record-until-silence), Whisper STT, Warden HTTP round-trip, and TTS playback.

- Big RED button (TALK), top of the window: record until silence →
  transcribe → POST to Warden /api/messages as a plain message with the
  Steve prompt block and the remembered facts prepended — Warden itself
  has no Steve code, everything Steve-specific lives in this app → poll
  for the reply → speak it.
- Big YELLOW STOP SIGN, pinned to the far bottom edge — a wide gap and the
  status strip sit between it and TALK so the two can't be confused. It
  FLASHES while a turn is running; click stops whatever is in flight —
  recording, waiting, or speaking.
- Status strip between the buttons: idle when empty, short status text
  otherwise.
- Audible cues for a blind user: short high beep when listening starts,
  low beep when the turn finishes, long buzz if it failed.

MEMORIES — this app owns them too (Warden knows nothing about Steve).
At startup it makes sure they're up to date, all by itself: cached
facts load instantly, every .md under ~/.claude (memory.md, journal.md,
all related files) is checked against the last scan — unchanged means
move straight on; anything changed triggers a full rescan and
re-classification with local granite 8b via Ollama. Facts new since
the last scan are filed into the existing MARM memory server (MCP over
loopback:8001, best-effort) so the agents can recall them too. When
the memories are current the app speaks "Ready." (he can't read a
screen). Facts are injected into every turn as spoken context. No
brain, no visualization — he can't see it.

Run with the eyes_ears venv:

    ./eyes_ears/.venv/bin/python eyes_ears/steve.py [--warden http://127.0.0.1:3200]

Warden URL resolution: --warden, else ~/.config/jarvis/config.yaml →
warden.base_url, else http://127.0.0.1:3200.
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

import webview  # pywebview, same engine as the main app

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # reuse the ears.* modules — never the main app itself

from ears.audio import (  # noqa: E402
    AudioPlayer,
    AudioRecorder,
    BeepGenerator,
    find_device,
)
from ears.stt import STT  # noqa: E402
from ears.tts import TTS  # noqa: E402

DEFAULT_WARDEN = "http://127.0.0.1:3200"
REPLY_TIMEOUT_S = 300  # how long to wait for the orchestrator's reply

# The Steve persona lives HERE — the standalone app owns it completely.
# Warden itself has zero Steve knowledge (other people run Warden): this
# block is prepended to every message so the orchestrator converses
# instead of acting on rambling or nonsensical requests, and replies in
# a form that works spoken aloud.
STEVE_PROMPT = """[STEVE MODE]
This turn is voice input from a blind user (Steve) using a single big-button interface. He rambles, changes topics mid-sentence, and sometimes asks for nonsensical or impossible things. Your reply is spoken aloud.

PERSONA — you are a warm Northern companion in the Donna Noble mould: kind, a bit cheeky, reassuring. Call him "petal" or "sweety" naturally now and then — not every sentence. You KNOW him: the ABOUT THE USER block below is what you remember about him and his life — use it in conversation like an old friend would, without listing it back at him.

- Reply conversationally and briefly, in plain short sentences. No lists, no markdown, no emoji — the reply goes through text-to-speech.
- Do NOT act on vague or rambling requests: no tasks, projects, reminders, jobs, messages, or file changes unless the request is explicit and unambiguous.
- Nonsensical or impossible requests: respond gently and briefly; do not attempt to fulfill them.
- If the intent is unclear, ask ONE short clarifying question instead of acting.
- Small talk and stories are fine — engage naturally."""

# ---------- Steve's own memories (scanned from ~/.claude, local 8b) ----------
OLLAMA_URL = "http://127.0.0.1:11434"
MEM_MODEL = "granite4.1:8b"
CLAUDE_DIR = os.path.expanduser("~/.claude")
MEM_CACHE = os.path.expanduser("~/.local/state/steve/memory.json")
MARM_URL = os.environ.get("MARM_URL", "http://127.0.0.1:8001/mcp")
MEM_MAX_FILES = 300            # .md files per scan
MEM_MAX_FILE_BYTES = 200_000   # skip huge files
MEM_LINES_PER_FILE = 6         # body lines sampled per file (frontmatter desc first)
MEM_LINE_TRUNC = 200
MEM_BATCH_CHARS = 9_000        # classifier batch size
MEM_FACTS_MAX = 400
MEM_FACTS_PROMPT_MAX = 60      # injected into a turn

MEM_SYSTEM = (
    "Role: you extract lasting facts about the user from their personal memory files.\n\n"
    "Input: lines from memory files.\n\n"
    "Rules:\n"
    "- A fact: people, family, routines, accounts, health, preferences, projects, environment\n"
    "- One short sentence per fact, plain text\n"
    "- Keep a fact only if it stays true over months\n"
    "Output: the facts."
)
# Plan-narrative the 8b keeps and a memory is not (verified against its
# dry-run output: "will be built", "wants Mercury to run", "will rely on").
FUTURE_RE = re.compile(
    r"\b(will\s+(?:be|use|rely|run|go|move|launch|land)|plans?\s+to|planning\s+to|going\s+to|wants?\s+to)\b",
    re.I,
)
MEM_FORMAT = {
    "type": "object",
    "properties": {"facts": {"type": "array", "items": {"type": "string"}}},
    "required": ["facts"],
}


def _ollama_chat(body: dict, timeout: int = 180) -> dict:
    req = urllib.request.Request(
        OLLAMA_URL + "/api/chat", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode() or "{}")


def scan_claude_lines() -> list[str]:
    """Every .md under ~/.claude — memory.md, journal.md, CLAUDE.md, all of
    it — one 'path: line' per interesting line, bounded."""
    files: list[str] = []
    for root, dirs, names in os.walk(CLAUDE_DIR):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        for n in names:
            if n.endswith(".md"):
                files.append(os.path.join(root, n))
    lines: list[str] = []
    for p in sorted(files)[:MEM_MAX_FILES]:
        try:
            if os.path.getsize(p) > MEM_MAX_FILE_BYTES:
                continue
            with open(p, encoding="utf-8", errors="replace") as f:
                md = f.read()
        except OSError:
            continue
        rel = os.path.relpath(p, CLAUDE_DIR)
        desc = (re.search(r'^description:\s*"?(.+?)"?\s*$', md, re.M) or [None, ""])[1].strip()
        out = [f"{rel}: {desc}"] if desc else []
        body = re.sub(r"^---[\s\S]*?---", "", md)
        for raw in body.splitlines():
            t = raw.strip().lstrip("-*# ").strip()
            if not t or len(t) < 12:
                continue
            out.append(f"{rel}: {t[:MEM_LINE_TRUNC]}")
            if len(out) > MEM_LINES_PER_FILE:
                break
        lines.extend(out)
    return lines


def classify_lines(lines: list[str]) -> list[str]:
    """Durable facts via local granite 8b, batched under the model's context."""
    facts: list[str] = []
    batch: list[str] = []
    chars = 0
    for ln in lines:
        if len(batch) >= 80 or chars + len(ln) > MEM_BATCH_CHARS:
            facts.extend(_classify_chunk(batch))
            batch, chars = [], 0
        batch.append(ln)
        chars += len(ln)
    if batch:
        facts.extend(_classify_chunk(batch))
    # Dedup by normalized wording, and drop plan-narrative — the 8b keeps
    # future-tense chatter ("will be built", "wants to run") that a memory
    # is not. The 30b pipeline spends a model-judge pass on this; the .claude
    # source is clean enough that a mechanical filter does the job.
    seen: set[str] = set()
    out: list[str] = []
    for f in facts:
        f = f.strip()[:300]
        key = re.sub(r"[^a-z0-9]+", " ", f.lower()).strip()
        if not key or key in seen:
            continue
        if FUTURE_RE.search(f):
            continue
        seen.add(key)
        out.append(f)
        if len(out) >= MEM_FACTS_MAX:
            break
    return out


def _classify_chunk(chunk: list[str]) -> list[str]:
    try:
        data = _ollama_chat({
            "model": MEM_MODEL, "stream": False, "format": MEM_FORMAT,
            "messages": [
                {"role": "system", "content": MEM_SYSTEM},
                {"role": "user", "content": "Lines:\n" + "\n".join(chunk)},
            ],
            "options": {"temperature": 0},
        })
        content = (data.get("message") or {}).get("content") or ""
        s, e = content.find("{"), content.rfind("}")
        if s == -1 or e <= s:
            return []
        return [str(f) for f in (json.loads(content[s:e + 1]).get("facts") or []) if str(f).strip()]
    except Exception as e:
        print(f"[steve] memory classify failed: {e}", file=sys.stderr)
        return []


def load_cached_facts() -> tuple[list[str], float]:
    try:
        with open(MEM_CACHE, encoding="utf-8") as f:
            d = json.load(f)
        return [str(x) for x in (d.get("facts") or [])], float(d.get("ts") or 0)
    except Exception:
        return [], 0.0


def save_cached_facts(facts: list[str]) -> None:
    os.makedirs(os.path.dirname(MEM_CACHE), exist_ok=True)
    with open(MEM_CACHE, "w", encoding="utf-8") as f:
        json.dump({"facts": facts, "ts": time.time()}, f)


def _marm_rpc(session, body, timeout=10):
    """One MCP-over-HTTP call against MARM (same protocol Warden's memory
    writeback uses). Returns (parsed-json-or-None, session-id)."""
    req = urllib.request.Request(
        MARM_URL, data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **({"mcp-session-id": session} if session else {}),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        new_session = resp.headers.get("mcp-session-id")
        ctype = resp.headers.get("content-type") or ""
        text = resp.read().decode()
    if "text/event-stream" in ctype:
        for line in text.splitlines():
            if line.startswith("data:"):
                text = line[5:].strip()
                break
    s = text.find("{")
    if s == -1:
        return None, new_session
    return json.loads(text[s:text.rfind("}") + 1]), new_session


def marm_log_entries(entries: list[str]) -> bool:
    """File facts into the existing MARM memory server — the same durable
    store Warden's own classifier writes to, so the agents can recall them.
    Best-effort: MARM down just logs, the app is unaffected."""
    if not entries:
        return True
    session = None
    try:
        init, session = _marm_rpc(None, {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26", "capabilities": {},
                "clientInfo": {"name": "steve-app", "version": "1.0.0"},
            },
        })
        if init is None:
            raise RuntimeError("MARM initialize failed (not running?)")
        _marm_rpc(session, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        for e in entries:
            r, _ = _marm_rpc(session, {
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "marm_log_entry", "arguments": {"entry": e}},
            })
            if not r or not r.get("result"):
                raise RuntimeError("marm_log_entry returned no result")
        return True
    except Exception as e:
        print(f"[steve] MARM filing failed: {e}", file=sys.stderr)
        return False


def claude_files_changed_since(ts: float) -> bool:
    """Did any .md under ~/.claude change since the last scan? Cheap —
    mtimes only, no reading. The whole startup freshness check."""
    if not os.path.isdir(CLAUDE_DIR):
        return False
    for root, dirs, names in os.walk(CLAUDE_DIR):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        for n in names:
            if not n.endswith(".md"):
                continue
            try:
                if os.path.getmtime(os.path.join(root, n)) > ts:
                    return True
            except OSError:
                pass
    return False


def memory_startup_check(set_state, set_note, on_ready) -> None:
    """Boot sequence, all by itself: cached facts load instantly; if the
    memory files changed since the last scan, rescan and re-classify; then
    the app announces it's ready (spoken — the user is blind)."""
    facts, ts = load_cached_facts()
    if facts:
        set_state(facts)
    try:
        if not facts or claude_files_changed_since(ts):
            set_note("Updating memories…")
            lines = scan_claude_lines()
            if lines:
                fresh = classify_lines(lines)
                if fresh:
                    prev = set(facts)
                    save_cached_facts(fresh)
                    set_state(fresh)
                    print(f"[steve] memory scan: {len(lines)} lines -> {len(fresh)} facts", file=sys.stderr)
                    # New-since-last-scan facts go into MARM — the durable
                    # store the agents recall from — not just the local cache.
                    new = [f for f in fresh if f not in prev]
                    if marm_log_entries(
                        ["Topic: steve memory"]
                        + [f"steve memory — {f}" for f in new]
                    ):
                        print(f"[steve] filed {len(new)} new facts into MARM", file=sys.stderr)
    except Exception as e:
        print(f"[steve] memory scan failed: {e}", file=sys.stderr)
    finally:
        set_note("")
        on_ready()


def warden_url_from_config() -> str:
    """Config file is optional; only the URL key is read (PyYAML not assumed)."""
    path = os.path.expanduser("~/.config/jarvis/config.yaml")
    try:
        with open(path) as f:
            text = f.read()
    except OSError:
        return ""
    # Minimal scalar scan — no yaml dependency required.
    section = ""
    for line in text.splitlines():
        line = line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if not line.startswith((" ", "\t")) and line.endswith(":"):
            section = line[:-1].strip()
        elif line.startswith((" ", "\t")) and section == "warden":
            key, _, val = line.strip().partition(":")
            if key.strip() == "base_url":
                return val.strip().strip("\"'")
    return ""


class SteveApp:
    """One worker thread per turn; STOP cancels at any stage."""

    def __init__(self, warden_url: str) -> None:
        in_dev = find_device("input")
        self.recorder = AudioRecorder(
            sample_rate=48000,
            channels=1,
            silence_timeout=1.0,
            max_duration=60.0,
            aggressiveness=2,
            input_device_index=in_dev,
        )
        self.player = AudioPlayer(
            output_device=find_device("output"),
            sample_rate=48000,
        )
        # Same device split as the main app: Whisper on CPU keeps the GPU free
        # for TTS (loading both on one GPU segfaults — see ears/main.py).
        self.stt = STT(model="base", device="cpu")
        self.stt.warmup()  # load Whisper now, not during the first turn
        self.tts = TTS(engine="kokoro")
        warm = getattr(self.tts._impl, "warmup", None)
        if warm:
            warm()
        # Blind user: the beeps ARE the feedback. High = go, low = done,
        # long buzz = something failed.
        self.beeps = BeepGenerator(sample_rate=48000)
        self.player.play_bytes(self.beeps.start_beep())  # "online" cue

        self.warden = warden_url.rstrip("/")
        self._lock = threading.Lock()
        self._worker = None  # live turn thread, None when idle
        self._stop = threading.Event()
        # Steve's remembered facts (scanned from ~/.claude, classified by the
        # local 8b) — injected into every turn as spoken context.
        self._facts: list[str] = []
        self._note = ""  # status-strip text while the startup scan runs
        threading.Thread(
            target=memory_startup_check,
            args=(self._set_facts, self._set_note, self._announce_ready),
            daemon=True,
        ).start()

    def _set_facts(self, facts: list[str]) -> None:
        with self._lock:
            self._facts = facts

    def _set_note(self, note: str) -> None:
        with self._lock:
            self._note = note

    def _announce_ready(self) -> None:
        """Memories current — the app tells him so, out loud."""
        try:
            audio = self.tts.synthesize("Ready, petal.")
            if audio:
                self.player.play_bytes(audio)
                return
        except Exception:
            pass
        try:
            self.player.play_bytes(self.beeps.stop_beep())
        except Exception:
            pass

    # ----- Warden HTTP (urllib — no main-app client) -----
    def _http(self, method: str, path: str, body: dict | None = None, timeout: int = 10):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.warden + path, data=data, method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode() or "{}")

    def _send(self, text: str) -> str:
        """POST the turn as a plain owner message — the prompt block and the
        remembered facts ride in the message text, so Warden needs no Steve
        handling. Returns the stored message id (an opaque string)."""
        parts = [STEVE_PROMPT]
        with self._lock:
            facts = list(self._facts)
        if facts:
            parts.append(
                "ABOUT THE USER — what you remember about him:\n"
                + "\n".join("- " + f for f in facts[-MEM_FACTS_PROMPT_MAX:])
            )
        parts.append("He says: " + text)
        resp = self._http("POST", "/api/messages", {"text": "\n\n".join(parts)})
        return str(resp.get("id") or "")

    def _await_reply(self, my_id: str) -> str | None:
        """Poll history for the first bot message after ours — found by id
        position in the returned list, so any id format works."""
        deadline = time.time() + REPLY_TIMEOUT_S
        while time.time() < deadline and not self._stop.is_set():
            try:
                resp = self._http("GET", "/api/messages?limit=30", timeout=5)
                msgs = resp.get("messages", [])
                start = -1
                for i, m in enumerate(msgs):
                    if str(m.get("id")) == my_id:
                        start = i
                        break
                if start >= 0:
                    for m in msgs[start + 1:]:
                        if m.get("is_bot_message"):
                            return str(m.get("content") or "").strip() or None
            except (urllib.error.URLError, OSError, ValueError):
                pass  # transient — keep polling
            time.sleep(2)
        return None

    # ----- Turn worker -----
    def _turn(self) -> None:
        failed = False
        try:
            self.player.play_bytes(self.beeps.start_beep())
            wav = self.recorder.record_until_silence()
            if self._stop.is_set() or not wav:
                return
            text = (self.stt.transcribe(wav) or "").strip()
            if self._stop.is_set() or not text:
                return
            my_id = self._send(text)
            if self._stop.is_set():
                return
            reply = self._await_reply(my_id)
            if self._stop.is_set():
                return
            if reply:
                audio = self.tts.synthesize(reply)
                if audio and not self._stop.is_set():
                    self.player.play_bytes(audio)
            else:
                failed = True  # asked, but no answer came back
        except Exception as e:
            failed = True
            print(f"[steve] turn failed: {e}", file=sys.stderr)
        finally:
            try:
                if failed and not self._stop.is_set():
                    self.player.play_bytes(self.beeps.error_beep())
                elif not self._stop.is_set():
                    self.player.play_bytes(self.beeps.stop_beep())
            except Exception:
                pass
            with self._lock:
                self._worker = None

    # ----- pywebview JS bridge -----
    def talk(self) -> str:
        with self._lock:
            if self._worker is not None:
                return json.dumps({"ok": True, "busy": True})
            self._stop.clear()
            self._worker = threading.Thread(target=self._turn, daemon=True)
            self._worker.start()
        return json.dumps({"ok": True, "busy": True})

    def stop(self) -> str:
        self._stop.set()
        try:
            self.recorder.cancel()
        except Exception:
            pass
        try:
            self.player.cancel()
        except Exception:
            pass
        return json.dumps({"ok": True})

    def status(self) -> str:
        busy = self._worker is not None and self._worker.is_alive()
        with self._lock:
            note = self._note
        try:
            self._http("GET", "/api/messages?limit=1", timeout=3)
            ok = True
        except Exception:
            ok = False
        return json.dumps({"ok": ok, "busy": busy, "note": note})


def main() -> None:
    ap = argparse.ArgumentParser(description="Steve — standalone big-button voice app")
    ap.add_argument("--warden", default="", help="Warden base URL (default: config warden.base_url)")
    args = ap.parse_args()

    url = args.warden or warden_url_from_config() or DEFAULT_WARDEN

    app = SteveApp(url)
    webview.create_window(
        "Steve",
        os.path.join(HERE, "ui", "ptt.html"),
        js_api=app,
        width=420, height=760,
        resizable=True,
        background_color="#050508",
    )
    webview.start()


if __name__ == "__main__":
    main()