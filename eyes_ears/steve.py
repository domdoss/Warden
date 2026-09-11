#!/usr/bin/env python3
"""Steve — a STANDALONE big-button voice application.

Completely independent of the main voice app: no control server, no shared
process, no bridge to the main UI. This process owns its own mic (VAD
record-until-silence), Whisper STT, Warden HTTP round-trip, and TTS playback.

- Big RED button (TALK), top of the window: record until silence →
  transcribe → POST to Warden /api/messages tagged idea="steve" (the
  Steve-mode prompt block) → poll for the reply → speak it.
- Big YELLOW STOP SIGN, pinned to the far bottom edge — a wide gap and the
  status strip sit between it and TALK so the two can't be confused. It
  FLASHES while a turn is running; click stops whatever is in flight —
  recording, waiting, or speaking.
- Status strip between the buttons: idle when empty, short status text
  otherwise.
- Audible cues for a blind user: short high beep when listening starts,
  low beep when the turn finishes, long buzz if it failed.

Run with the eyes_ears venv:

    ./eyes_ears/.venv/bin/python eyes_ears/steve.py [--warden http://127.0.0.1:3200]

Warden URL resolution: --warden, else ~/.config/jarvis/config.yaml →
warden.base_url, else http://127.0.0.1:3200.
"""
import argparse
import json
import os
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

    # ----- Warden HTTP (urllib — no main-app client) -----
    def _http(self, method: str, path: str, body: dict | None = None, timeout: int = 10):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.warden + path, data=data, method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode() or "{}")

    def _send(self, text: str) -> int:
        """POST a Steve-tagged message; returns the stored message id."""
        resp = self._http("POST", "/api/messages", {"text": text, "idea": "steve"})
        return int(resp.get("id") or 0)

    def _await_reply(self, my_id: int) -> str | None:
        """Poll history for the first bot message after ours."""
        deadline = time.time() + REPLY_TIMEOUT_S
        while time.time() < deadline and not self._stop.is_set():
            try:
                resp = self._http("GET", "/api/messages?limit=30", timeout=5)
                msgs = resp.get("messages", [])
                for m in msgs:
                    if int(m.get("id") or 0) > my_id and m.get("is_bot_message"):
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
        try:
            self._http("GET", "/api/messages?limit=1", timeout=3)
            ok = True
        except Exception:
            ok = False
        return json.dumps({"ok": ok, "busy": busy})


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