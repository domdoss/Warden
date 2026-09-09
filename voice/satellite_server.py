#!/usr/bin/env python3
"""Voice satellite audio relay — the Pi's dumb ears + mouth.

A pure-PipeWire-CLI HTTP pipe so a desktop running the full voice client
(STT + TTS + Warden bridge + UI) can use this machine's mic and speaker over
the network. The Pi is intentionally dumb: it streams raw PCM from ``pw-record``
for the desktop to VAD/transcribe, and plays back WAVs the desktop sends via
``pw-play``. No STT, TTS, pyaudio, or webrtcvad lives here — only the PipeWire
CLI tools this unit already uses (see hardware/voice-button.py).

Mirrors the security satellite's ``security/core/server.py`` pattern
(ThreadingHTTPServer + BaseHTTPRequestHandler, silenced logging, configurable
bind host). Security owns port 8765; we default to 8766.

Endpoints:
    GET  /status   → {"ok": true}
    GET  /mic      → streams raw 16 kHz mono s16le PCM (application/octet-stream)
                    from ``pw-record`` until the client disconnects (which kills
                    the recorder) or POST /cancel fires.
    POST /play     (body = WAV bytes) → plays via ``pw-play`` to the default
                    sink; returns {"ok": true} when playback finishes.
    POST /cancel   → kills any in-flight pw-record / pw-play (barge-in).

Usage:
    python satellite_server.py
    python satellite_server.py --host 0.0.0.0 --port 8766
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

log = logging.getLogger("satellite.audio")

# Match the desktop recorder's VAD frame: 16 kHz mono s16le. 30 ms = 960 bytes.
MIC_RATE = 16000
MIC_CHANNELS = 1
MIC_FORMAT = "s16"


def _which(cmd: str) -> Optional[str]:
    from shutil import which
    return which(cmd)


class SatelliteAudioServer:
    """Owns the current pw-record / pw-play so /cancel can kill either."""

    def __init__(self, host: str = "0.0.0.0", port: int = 8766,
                 record_cmd: Optional[list[str]] = None,
                 play_cmd: Optional[list[str]] = None):
        self.host = host
        self.port = port
        self._lock = threading.Lock()
        self._rec_proc: Optional[subprocess.Popen] = None
        self._play_proc: Optional[subprocess.Popen] = None
        self._record_cmd = record_cmd  # override for testing
        self._play_cmd = play_cmd
        self._httpd: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    # ── command builders (PipeWire CLI) ──────────────────────────────────────
    def _mic_cmd(self) -> list[str]:
        if self._record_cmd is not None:
            return list(self._record_cmd)
        # pw-record writes raw PCM to stdout (`-`). The default WirePlumber
        # source (the dashboard-selected mic) is used automatically.
        return ["pw-record", "--rate", str(MIC_RATE), "--channels",
                str(MIC_CHANNELS), "--format", MIC_FORMAT, "-"]

    def _play_cmd_for(self, path: str) -> list[str]:
        if self._play_cmd is not None:
            return list(self._play_cmd) + [path]
        # pw-play plays a WAV through the default WirePlumber sink.
        return ["pw-play", path]

    # ── producers ────────────────────────────────────────────────────────────
    def stream_mic(self, write, is_cancelled) -> None:
        """Spawn pw-record and copy its stdout to ``write`` until cancel or the
        client disconnects. ``write`` should raise on a broken pipe."""
        proc = subprocess.Popen(
            self._mic_cmd(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        with self._lock:
            self._rec_proc = proc
        try:
            assert proc.stdout is not None
            while True:
                if is_cancelled():
                    break
                chunk = proc.stdout.read(4096)
                if not chunk:
                    break
                write(chunk)  # raises on client disconnect
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self._kill(proc)
            with self._lock:
                if self._rec_proc is proc:
                    self._rec_proc = None

    def play(self, wav_bytes: bytes) -> None:
        """Play a WAV via pw-play. Blocks until it finishes (or cancel)."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            tf.write(wav_bytes)
            path = tf.name
        try:
            proc = subprocess.Popen(
                self._play_cmd_for(path),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with self._lock:
                self._play_proc = proc
            proc.wait()
        finally:
            with self._lock:
                if self._play_proc is proc:
                    self._play_proc = None
            try:
                os.unlink(path)
            except OSError:
                pass

    def cancel(self) -> None:
        """Abort any in-flight record (mic stream) or play (barge-in)."""
        with self._lock:
            rec, play = self._rec_proc, self._play_proc
        self._kill(rec)
        self._kill(play)

    @staticmethod
    def _kill(proc: Optional[subprocess.Popen]) -> None:
        if proc is None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    # ── lifecycle ────────────────────────────────────────────────────────────
    def start(self) -> bool:
        server = self
        for tool in ("pw-record", "pw-play"):
            if _which(tool) is None:
                log.warning("%s not found on PATH — %s will fail", tool, tool)

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence default access logging
                pass

            def _send_json(self, status: int, payload: dict) -> None:
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/status":
                    self._send_json(200, {"ok": True})
                elif self.path == "/mic":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()

                    def write(chunk: bytes) -> None:
                        self.wfile.write(chunk)
                        self.wfile.flush()

                    def is_cancelled() -> bool:
                        # Stop if the client half-closes; pw-record output keeps
                        # us writing otherwise.
                        return False

                    try:
                        server.stream_mic(write, is_cancelled)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):
                if self.path == "/play":
                    length = int(self.headers.get("Content-Length", 0))
                    if length == 0:
                        self._send_json(400, {"ok": False, "error": "empty body"})
                        return
                    wav = self.rfile.read(length)
                    try:
                        server.play(wav)
                    except Exception as e:
                        log.warning("play failed: %s", e)
                        self._send_json(500, {"ok": False, "error": str(e)})
                        return
                    self._send_json(200, {"ok": True})
                elif self.path == "/cancel":
                    server.cancel()
                    self._send_json(200, {"ok": True})
                else:
                    self.send_response(404)
                    self.end_headers()

        try:
            self._httpd = ThreadingHTTPServer((self.host, self.port), Handler)
        except OSError as e:
            log.warning("could not bind %s:%d (%s)", self.host, self.port, e)
            return False
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        log.info("voice satellite audio server on http://%s:%d", self.host, self.port)
        return True

    def stop(self) -> None:
        self.cancel()
        if self._httpd is not None:
            try:
                self._httpd.shutdown()
                self._httpd.server_close()
            except Exception as e:
                log.warning("stop error: %s", e)
        self._httpd = None
        self._thread = None


def parse_args(argv: list[str] | None = None):
    p = argparse.ArgumentParser(description="Warden voice satellite audio relay")
    p.add_argument("--host", default="0.0.0.0", help="Bind host (default 0.0.0.0)")
    p.add_argument("--port", type=int, default=8766, help="Bind port (default 8766)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    args = parse_args(argv)
    server = SatelliteAudioServer(host=args.host, port=args.port)
    if not server.start():
        return 2

    stop_event = threading.Event()

    def _stop(*_):
        stop_event.set()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    try:
        stop_event.wait()
    finally:
        server.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())