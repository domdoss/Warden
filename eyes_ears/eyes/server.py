"""Tiny HTTP server exposing the webcam to Warden while the oculus app owns it.

Two processes can't open /dev/video0 at once. The oculus app holds the
camera (for the cheap detector + GUI); this server lets Warden's
`webcam_capture` tool pull the latest frame over HTTP instead of fighting for
the device. That's what makes on-demand "look at the camera and describe"
work during the demo.

  GET /frame    → the latest captured JPEG (image/jpeg)
  GET /status   → {"state": ..., "eyes_open": ..., "last_alert_ts": ...}
  POST /known/save → {"label": "..."} save the current frame's face embedding.
  POST /alert/open, /alert/close — Heimdall spawns/closes an alert.
  POST /open, /close — open/close the eyes (the guard's chat command).

`set_frame()` is called by the main loop on every capture; `set_state()` on
state changes. Both are thread-safe.
"""

from __future__ import annotations

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional

import numpy as np

from eyes.log_store import (
    security_log as log_security,
    awareness_log as log_awareness,
    host_events as log_host_events,
    clear as log_clear,
)

log = logging.getLogger("oculus.server")


class FrameServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self._frame: bytes = b""
        self._state: str = "IDLE"
        self._eyes_open: bool = True
        self._last_alert_ts: str = ""
        self._lock = threading.Lock()
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        # Called when Warden POSTs /alert/close — the main loop registers this
        # to re-arm the detector (end the open alert).
        self.on_alert_close = None
        # Called when Warden POSTs /alert/open — Heimdall declared the flagged
        # detection abnormal; the main loop opens the alert (red button).
        self.on_alert_open = None
        # Called when Warden POSTs /open or /close — the guard's chat command
        # to open/close the eyes (eyes closed = no flagging to Warden).
        self.on_open = None
        self.on_close = None
        # Called for POST /known/save. Receives the latest BGR frame and a label;
        # returns a dict {ok, label?, error?}.
        self.on_known_save: Optional[Callable[[np.ndarray, str], dict[str, Any]]] = None

    # ── producers (main loop) ────────────────────────────────────────────────
    def set_frame(self, jpeg_bytes: bytes) -> None:
        with self._lock:
            self._frame = jpeg_bytes

    def set_state(self, state: str, last_alert_ts: str | None = None) -> None:
        with self._lock:
            self._state = state
            if last_alert_ts is not None:
                self._last_alert_ts = last_alert_ts

    def set_eyes_open(self, eyes_open: bool) -> None:
        with self._lock:
            self._eyes_open = eyes_open

    def is_eyes_open(self) -> bool:
        with self._lock:
            return self._eyes_open

    def request_close(self) -> bool:
        """Warden closed the alert. Returns True if a handler re-armed."""
        if self.on_alert_close is None:
            return False
        try:
            self.on_alert_close()
            return True
        except Exception as e:
            log.warning("alert close handler error: %s", e)
            return False

    def request_open(self) -> bool:
        """Heimdall declared the flagged detection abnormal → open the alert."""
        if self.on_alert_open is None:
            return False
        try:
            self.on_alert_open()
            return True
        except Exception as e:
            log.warning("alert open handler error: %s", e)
            return False

    def request_eyes_open(self) -> bool:
        """The guard opened the eyes from chat → enable flagging."""
        if self.on_open is None:
            return False
        try:
            self.on_open()
            return True
        except Exception as e:
            log.warning("eyes-open handler error: %s", e)
            return False

    def request_eyes_close(self) -> bool:
        """The guard closed the eyes from chat → stop flagging."""
        if self.on_close is None:
            return False
        try:
            self.on_close()
            return True
        except Exception as e:
            log.warning("eyes-close handler error: %s", e)
            return False

    def request_known_save(self, label: str) -> dict[str, Any]:
        """Save the latest frame's face as a known person on the laptop."""
        if self.on_known_save is None:
            return {"ok": False, "error": "known-save handler not registered"}
        if not label:
            return {"ok": False, "error": "missing label"}
        with self._lock:
            frame_bytes = self._frame
        if not frame_bytes:
            return {"ok": False, "error": "no frame yet"}
        try:
            import cv2
            arr = np.frombuffer(frame_bytes, dtype=np.uint8)
            frame_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame_bgr is None:
                return {"ok": False, "error": "could not decode frame"}
            return self.on_known_save(frame_bgr, label)
        except Exception as e:
            log.warning("known-save handler error: %s", e)
            return {"ok": False, "error": str(e)}

    def capture_screenshot(self) -> tuple[bytes, str]:
        """Capture the laptop display as a PNG. Mirrors src/desktop-control.ts:
        KDE Plasma Wayland has no wlr-screencopy so `grim` fails there — use
        Spectacle (KWin's privileged path). Other Wayland compositors use
        `grim`; X11 uses `scrot`. Raises on any failure — no local fallback,
        the frame server is the one way Warden pulls a screenshot from the
        laptop."""
        import os
        import subprocess
        import tempfile

        session = os.environ.get("XDG_SESSION_TYPE", "").lower()
        desktop = os.environ.get("XDG_CURRENT_DESKTOP", "")
        is_kde = desktop.lower().startswith("kde") or os.environ.get("KDE_FULL_SESSION") == "true"

        if session == "wayland" and is_kde:
            fd, tmp = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            try:
                subprocess.run(
                    ["spectacle", "-b", "-n", "-f", "-o", tmp],
                    check=True, capture_output=True, timeout=15,
                )
                with open(tmp, "rb") as f:
                    return f.read(), "image/png"
            finally:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
        if session == "wayland":
            res = subprocess.run(["grim", "-"], check=True, capture_output=True, timeout=15)
            return res.stdout, "image/png"
        if session == "x11":
            res = subprocess.run(["scrot", "-"], check=True, capture_output=True, timeout=15)
            return res.stdout, "image/png"
        raise RuntimeError(
            f"capture_screenshot: unknown session type {session!r} "
            "(expected wayland or x11 in the graphical session env)"
        )

    # ── lifecycle ────────────────────────────────────────────────────────────
    def start(self) -> bool:
        server = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence default access logging
                pass
            def _read_json(self):
                length = int(self.headers.get("Content-Length", 0))
                if length == 0:
                    return {}
                try:
                    data = self.rfile.read(length).decode("utf-8")
                    return json.loads(data) if data else {}
                except Exception:
                    return {}

            def do_GET(self):
                if self.path == "/frame":
                    with server._lock:
                        frame = server._frame
                    if not frame:
                        self.send_response(503)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(b'{"error":"no frame yet"}')
                        return
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(frame)
                elif self.path == "/screenshot":
                    # Warden (on the Pi) pulls a screenshot of the laptop
                    # display here — the Pi is headless, so the capture must
                    # run on the laptop that owns the screen. Returns PNG.
                    try:
                        png, ctype = server.capture_screenshot()
                    except Exception as e:  # noqa: BLE001
                        log.warning("screenshot capture failed: %s", e)
                        self.send_response(503)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({"error": str(e)}).encode())
                        return
                    if not png:
                        self.send_response(503)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(b'{"error":"empty screenshot"}')
                        return
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(png)
                elif self.path == "/status":
                    with server._lock:
                        body = json.dumps({
                            "state": server._state,
                            "eyes_open": server._eyes_open,
                            "last_alert_ts": server._last_alert_ts,
                        })
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
                elif self.path.startswith("/log/host-events"):
                    # Recent host AWARENESS event rows (assessment IS NULL),
                    # newest insertion first. Queried by Warden (on the Pi).
                    from urllib.parse import urlparse, parse_qs
                    q = parse_qs(urlparse(self.path).query)
                    limit = int(q.get("limit", ["50"])[0] or 50)
                    rows = log_host_events(limit)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"rows": rows}).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):
                # Sentry registers a known person; the laptop computes the face
                # embedding on CPU from the current frame.
                if self.path == "/known/save":
                    req = self._read_json()
                    label = req.get("label") if isinstance(req, dict) else None
                    result = server.request_known_save(label)
                    self.send_response(200 if result.get("ok") else 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                # Warden closes the open alert → the detector re-arms. This is
                # called by the orchestrator's close_security_alert callback
                # (Heimdall's NORMAL verdict, or the guard's STAND DOWN).
                elif self.path == "/alert/close":
                    ok = server.request_close()
                    body = json.dumps({"ok": ok, "state": server._state})
                    self.send_response(200 if ok else 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
                # Heimdall declared the flagged detection ABNORMAL → open the
                # alert (red button). Called by the open_security_alert callback.
                elif self.path == "/alert/open":
                    ok = server.request_open()
                    body = json.dumps({"ok": ok, "state": server._state})
                    self.send_response(200 if ok else 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
                # Guard's chat command: open the eyes (enable flagging).
                elif self.path == "/open":
                    ok = server.request_eyes_open()
                    body = json.dumps({"ok": ok, "eyes_open": server._eyes_open, "state": server._state})
                    self.send_response(200 if ok else 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
                # Guard's chat command: close the eyes (stop flagging).
                elif self.path == "/close":
                    ok = server.request_eyes_close()
                    body = json.dumps({"ok": ok, "eyes_open": server._eyes_open, "state": server._state})
                    self.send_response(200 if ok else 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
                elif self.path == "/log/security":
                    # Oculus conditions log (record/query/stats). Warden on the
                    # Pi POSTs here instead of writing a local sqlite.
                    req = self._read_json()
                    result = log_security(req)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                elif self.path == "/log/awareness":
                    # Oculus awareness log (record / record_host_event / query /
                    # stats). Warden on the Pi POSTs here.
                    req = self._read_json()
                    result = log_awareness(req)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_DELETE(self):
                # Clear all Oculus logs (both tables). Dashboard "Clear logs"
                # button → Pi /api/oculus/logs → here.
                if self.path == "/log":
                    result = log_clear()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                else:
                    self.send_response(404)
                    self.end_headers()

        try:
            self._httpd = ThreadingHTTPServer((self.host, self.port), Handler)
        except OSError as e:
            log.warning("could not bind %s:%d (%s) — Warden will fall back to ffmpeg",
                        self.host, self.port, e)
            return False
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        log.info("frame server on http://%s:%d/frame", self.host, self.port)
        return True

    def stop(self) -> None:
        if self._httpd is not None:
            try:
                self._httpd.shutdown()
                self._httpd.server_close()
            except Exception as e:
                log.warning("frame server stop error: %s", e)
        self._httpd = None
        self._thread = None
