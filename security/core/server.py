"""Tiny HTTP server exposing the webcam to Warden while the security app owns it.

Two processes can't open /dev/video0 at once. The security app holds the
camera (for the cheap detector + GUI); this server lets Warden's
`webcam_capture` tool pull the latest frame over HTTP instead of fighting for
the device. That's what makes on-demand "look at the camera and describe"
work during the demo.

  GET /frame    → the latest captured JPEG (image/jpeg)
  GET /status   → {"state": ..., "armed": ..., "last_alert_ts": ...}
  POST /known/save → {"label": "..."} save the current frame's face embedding.
  POST /alert/open, /alert/close — Heimdall spawns/closes an alert.
  POST /arm, /disarm — arm/disarm the system (the guard's chat command).

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

log = logging.getLogger("security.server")


class FrameServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self._frame: bytes = b""
        self._state: str = "IDLE"
        self._armed: bool = True
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
        # Called when Warden POSTs /arm or /disarm — the guard's chat command
        # to arm/disarm the whole system (disarmed = no flagging to Warden).
        self.on_arm = None
        self.on_disarm = None
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

    def set_armed(self, armed: bool) -> None:
        with self._lock:
            self._armed = armed

    def is_armed(self) -> bool:
        with self._lock:
            return self._armed

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

    def request_arm(self) -> bool:
        """The guard armed the system from chat → enable flagging."""
        if self.on_arm is None:
            return False
        try:
            self.on_arm()
            return True
        except Exception as e:
            log.warning("arm handler error: %s", e)
            return False

    def request_disarm(self) -> bool:
        """The guard disarmed the system from chat → stop flagging."""
        if self.on_disarm is None:
            return False
        try:
            self.on_disarm()
            return True
        except Exception as e:
            log.warning("disarm handler error: %s", e)
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
                elif self.path == "/status":
                    with server._lock:
                        body = json.dumps({
                            "state": server._state,
                            "armed": server._armed,
                            "last_alert_ts": server._last_alert_ts,
                        })
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
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
                # Guard's chat command: arm the system (enable flagging).
                elif self.path == "/arm":
                    ok = server.request_arm()
                    body = json.dumps({"ok": ok, "armed": server._armed, "state": server._state})
                    self.send_response(200 if ok else 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
                # Guard's chat command: disarm the system (stop flagging).
                elif self.path == "/disarm":
                    ok = server.request_disarm()
                    body = json.dumps({"ok": ok, "armed": server._armed, "state": server._state})
                    self.send_response(200 if ok else 503)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body.encode())
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
