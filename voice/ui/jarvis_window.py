"""Jarvis pywebview window wrapper.

Hosts the Jarvis HTML UI inside a pywebview window and exposes the same
public interface as ``BigRedButtonWindow`` so ``main.py`` can swap it in
with minimal churn.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Callable, List, Optional, Tuple

# Qt/Chromium WebGL flags. Goal: hardware-accelerated D3D11 ANGLE on real
# Windows machines (Intel iGPU, AMD Radeon, NVIDIA — anything DX11+), with
# automatic fall-through to SwiftShader (software) if the GPU is blocklisted
# or unavailable (e.g. inside a VM with no GPU passthrough).
#
# We deliberately do NOT pin --use-angle=swiftshader here — that forces
# software rendering even on capable GPUs and tanks the jarvis to <5fps.
# --enable-unsafe-swiftshader lets Chromium choose SwiftShader as a fallback
# when no usable GPU is present. --ignore-gpu-blocklist stops Chromium
# refusing on integrated graphics it considers old.
#
# In a VM the jarvis will still be slow because it's CPU-rendered; that's a
# property of the VM, not these flags. On production hardware it should be
# smooth.
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS",
    " ".join([
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--enable-webgl",
        "--enable-accelerated-2d-canvas",
    ]),
)

try:
    import webview  # type: ignore
except ImportError as exc:  # pragma: no cover - import-time guard
    raise RuntimeError(
        "pywebview is not installed. Install it with `pip install pywebview`."
    ) from exc


logger = logging.getLogger(__name__)


class _JsApi:
    """JS API exposed to the HTML page via pywebview's js_api bridge.

    Methods on this object become callable from JavaScript as
    ``window.pywebview.api.<method>()``.
    """

    def __init__(self, owner: "JarvisWindow"):
        self._owner = owner

    def button_press(self) -> None:
        """Called by the HTML when the big button (or F11/Space/Enter) fires."""
        try:
            if self._owner.on_button_press is not None:
                self._owner.on_button_press()
        except Exception:
            logger.exception("on_button_press callback raised")

    def toggle_fullscreen(self) -> None:
        self._owner.toggle_fullscreen()

    def enter_fullscreen(self) -> None:
        self._owner.enter_fullscreen()

    def exit_fullscreen(self) -> None:
        self._owner.exit_fullscreen()

    def get_warden_url(self) -> str:
        """Return the current dockbox.base_url (or "" if unset), for the
        in-app settings field."""
        try:
            if self._owner.on_get_warden_url is not None:
                return self._owner.on_get_warden_url() or ""
        except Exception:
            logger.exception("on_get_warden_url callback raised")
        return ""

    def save_warden_url(self, url: str) -> None:
        """Persist a new dockbox.base_url and apply it to the live bridge."""
        try:
            if self._owner.on_save_warden_url is not None:
                self._owner.on_save_warden_url(url or "")
        except Exception:
            logger.exception("on_save_warden_url callback raised")

    def get_satellite_host(self) -> str:
        """Return the current satellite host (or "" = standalone/local audio),
        for the in-app settings field."""
        try:
            if self._owner.on_get_satellite_host is not None:
                return self._owner.on_get_satellite_host() or ""
        except Exception:
            logger.exception("on_get_satellite_host callback raised")
        return ""

    def save_satellite_host(self, host: str) -> None:
        """Persist a new satellite.host (takes effect on next launch)."""
        try:
            if self._owner.on_save_satellite_host is not None:
                self._owner.on_save_satellite_host(host or "")
        except Exception:
            logger.exception("on_save_satellite_host callback raised")

    def get_widget_config(self) -> str:
        """Return the widget companion config as a JSON string so the page can
        lay out the feed band and start the heartbeat fetch loop."""
        return json.dumps(self._owner._widget_config)

    def warden_api(self, path: str, method: str = "GET", body: str = "") -> str:
        """Proxy an HTTP request to the Warden API. Returns JSON string or '' on error.
        Panels use this instead of fetch() because Qt WebEngine blocks fetch()
        from file:// URLs to remote hosts."""
        try:
            import urllib.request
            url = (self._owner._widget_config.get("warden_url", "") or "").rstrip("/") + path
            if not url.startswith("http"):
                return ""
            data = body.encode() if body else None
            req = urllib.request.Request(url, data=data, method=method)
            req.add_header("Content-Type", "application/json")
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=8) as resp:
                return resp.read().decode()
        except Exception:
            logger.exception("warden_api proxy failed")
            return ""

    def chat_send(self, text: str) -> str:
        """Send a text message to Jarvis. Returns the reply string (or "")."""
        try:
            if self._owner.on_chat_send is not None:
                return self._owner.on_chat_send(text) or ""
        except Exception:
            logger.exception("chat_send failed")
            return ""

    def warden_upload(self, dir_path: str, filename: str, data_b64: str) -> str:
        """Upload a file to the Warden shared workspace on the Pi.

        Panels can't fetch() binary to the Pi from file://, so the iframe
        reads the dropped file as base64 and hands it here. We decode and
        POST the raw bytes to /api/files/upload?path=<dir> with an
        x-filename header (the contract the web dashboard's drag-drop uses).
        Returns JSON {ok, path} or {ok:false, error} as a string.
        """
        import base64, urllib.request
        try:
            base = (self._owner._widget_config.get("warden_url", "") or "").rstrip("/")
            if not base.startswith("http"):
                return '{"ok":false,"error":"warden_url not set"}'
            # Scope uploads under the owner group's uploads/ folder by default.
            rel = (dir_path or "owner/uploads").lstrip("/")
            url = base + "/api/files/upload?path=" + urllib.request.quote(rel, safe="")
            data = base64.b64decode(data_b64) if data_b64 else b""
            req = urllib.request.Request(url, data=data, method="POST")
            req.add_header("x-filename", urllib.request.quote(filename or "upload", safe=""))
            req.add_header("Content-Type", "application/octet-stream")
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp.read()
            return json.dumps({"ok": True, "path": rel + "/" + (filename or "upload")})
        except Exception as e:
            logger.exception("warden_upload failed")
            return json.dumps({"ok": False, "error": str(e)})

    def set_hologram_visible(self, visible: bool) -> str:
        """Show or hide the hologram window from the dashboard settings.

        With the Pi deployed, the hologram is optional — the dashboard can
        toggle it off. Returns JSON {ok:true} so the caller can await it.
        """
        try:
            self._owner.set_hologram_visible(bool(visible))
            return json.dumps({"ok": True})
        except Exception as e:
            logger.exception("set_hologram_visible failed")
            return json.dumps({"ok": False, "error": str(e)})

    def http_get(self, url: str) -> str:
        """GET an external https URL and return the body string.

        The ambient strip's weather widget needs open-meteo, but a file://
        iframe can't fetch() cross-origin https in Qt WebEngine (CORS /
        mixed-content). Python urllib has no such wall, so the iframe hands
        the URL here. Locked to an allowlist (open-meteo) for safety. On
        failure returns a JSON {ok:false,error} string instead of raising.
        """
        import urllib.request, urllib.parse
        try:
            p = urllib.parse.urlparse(url or "")
            allowed = ("api.open-meteo.com", "geocoding-api.open-meteo.com")
            if p.scheme != "https" or p.hostname not in allowed:
                return json.dumps({"ok": False, "error": "host not allowed"})
            req = urllib.request.Request(url, headers={"User-Agent": "Warden/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as e:
            logger.exception("http_get failed")
            return json.dumps({"ok": False, "error": str(e)})

    def local_stats(self) -> str:
        """Live CPU/RAM/GPU/VRAM for THIS machine (the desktop running the
        voice UI), as JSON for the dashboard's Local monitor.

        CPU/RAM come from /proc (no third-party deps — the voice venv has no
        psutil). GPU/VRAM come from rocm-smi (AMD Radeon VII on gfx906); on a
        machine without rocm-smi the gpu/vram fields stay null and the
        frontend dims those bars. CPU uses a delta between successive
        /proc/stat reads stored on this instance, so the first call returns
        cpu=null and real values arrive on the second poll onward.
        """
        import subprocess
        out = {"cpu": None, "ram": None, "gpu": None, "vram": None, "gpuName": None}
        # ── CPU (delta vs previous /proc/stat sample) ──
        try:
            with open("/proc/stat") as f:
                parts = [int(x) for x in f.readline().split()[1:]]
            idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
            total = sum(parts)
            prev = getattr(self, "_prev_cpu", None)
            if prev is not None:
                dt = total - prev[1]
                if dt > 0:
                    out["cpu"] = max(0, min(100, round((1 - (idle - prev[0]) / dt) * 100)))
            self._prev_cpu = (idle, total)
        except Exception:
            logger.debug("local_stats cpu failed", exc_info=True)
        # ── RAM (/proc/meminfo) ──
        try:
            mi = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    k, v = line.split(":", 1)
                    mi[k] = int(v.strip().split()[0]) * 1024  # bytes
            total = mi.get("MemTotal", 0)
            avail = mi.get("MemAvailable", mi.get("MemFree", 0))
            if total > 0:
                out["ram"] = max(0, min(100, round((1 - avail / total) * 100)))
        except Exception:
            logger.debug("local_stats ram failed", exc_info=True)
        # ── GPU + VRAM (rocm-smi, AMD) ──
        try:
            rocm = "/opt/rocm/bin/rocm-smi"
            cmd = rocm if __import__("os").path.exists(rocm) else "rocm-smi"
            r = subprocess.run([cmd, "--showuse", "--showmeminfo", "vram", "--json"],
                               capture_output=True, text=True, timeout=5)
            if r.returncode == 0 and r.stdout:
                d = json.loads(r.stdout)
                card = d.get("card0") or next(iter(d.values()), {}) or {}
                use = card.get("GPU use (%)")
                if isinstance(use, str) and use.strip():
                    out["gpu"] = max(0, min(100, int(round(float(use)))))
                vtot = card.get("VRAM Total Memory (B)")
                vused = card.get("VRAM Total Used Memory (B)")
                if isinstance(vtot, str) and isinstance(vused, str):
                    t, u = int(vtot), int(vused)
                    if t > 0:
                        out["vram"] = max(0, min(100, round(u / t * 100)))
                out["gpuName"] = "AMD Radeon VII"
        except Exception:
            logger.debug("local_stats gpu failed", exc_info=True)
        return json.dumps(out)


class JarvisWindow:
    """pywebview-backed window hosting Jarvis's HTML UI.

    Public interface mirrors ``BigRedButtonWindow``. All state setters are
    threadsafe and become no-ops if the window hasn't finished loading yet
    (calls made before readiness are buffered and flushed once the
    ``pywebview_ready`` event fires; if the window is never created they
    are silently dropped).
    """

    def __init__(
        self,
        on_button_press: Callable[[], None],
        width: int = 480,
        height: int = 480,
        feed_height: int = 280,
        widget_config: Optional[dict] = None,
        on_get_warden_url: Optional[Callable[[], str]] = None,
        on_save_warden_url: Optional[Callable[[str], None]] = None,
        on_get_satellite_host: Optional[Callable[[], str]] = None,
        on_save_satellite_host: Optional[Callable[[str], None]] = None,
        on_chat_send: Optional[Callable[[str], str]] = None,
    ):
        self.on_button_press = on_button_press
        self.on_get_warden_url = on_get_warden_url
        self.on_save_warden_url = on_save_warden_url
        self.on_get_satellite_host = on_get_satellite_host
        self.on_save_satellite_host = on_save_satellite_host
        self.on_chat_send = on_chat_send
        self.width = width
        self.height = height
        # Height of the widget companion feed band below the hologram. The
        # window is grown by this amount so the hologram keeps its size on top
        # and the tiles fill the bottom band. 0 = no feed (hologram only).
        self.feed_height = feed_height
        self._widget_config = widget_config or {}

        # Resolve the HTML file path next to this module.
        html_path = Path(__file__).resolve().parent / "jarvis.html"
        if not html_path.exists():
            raise RuntimeError(
                f"jarvis.html not found at expected path: {html_path}"
            )
        self._html_path = html_path
        self._html_url = html_path.as_uri()

        # Track the most-recently-requested state. When multiple state
        # setters are called with True, the latest wins.
        self._current_state: str = "idle"

        # Fullscreen tracking — pywebview exposes toggle_fullscreen() but no
        # direct query for current mode, so we track it ourselves.
        self._is_fullscreen: bool = False

        # Lock protects the ready flag, the buffer, and the window handle.
        self._lock = threading.Lock()
        self._ready_event = threading.Event()
        self._window: Optional["webview.Window"] = None
        # Pending JS snippets to evaluate once the window is ready.
        self._pending_js: List[str] = []

        self._js_api = _JsApi(self)
        self._closed = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def run(self) -> None:
        """Block on pywebview's main event loop. Must be called on the main thread."""
        with self._lock:
            if self._closed:
                return
            self._window = webview.create_window(
                title="Jarvis",
                url=self._html_url,
                js_api=self._js_api,
                width=self.width,
                height=self.height + self.feed_height,
                fullscreen=False,
                resizable=True,
                frameless=True,
                transparent=True,
                on_top=True,
                background_color="#000000",
            )
            # Subscribe to the ready event so we know when evaluate_js is safe.
            try:
                self._window.events.loaded += self._on_loaded
            except Exception:
                # Older pywebview versions surface readiness differently; fall
                # back to marking ready immediately after start.
                logger.warning(
                    "pywebview window.events.loaded not available; "
                    "evaluate_js calls may race the page load."
                )

        # Tell the page how tall the feed band is so the hologram keeps the top
        # region and the tiles fill the bottom. Buffered until the page loads.
        if self.feed_height > 0:
            self._eval_js(
                f"document.documentElement.style.setProperty("
                f"'--feed-height','{int(self.feed_height)}px');"
            )

        # ── Iron Man companion panels (one combined window) ────────────
        # The panels (Digest, Direct Line, Agents, Ops, Upload) live as
        # iframes inside a single panels.html window. Collapsing what were
        # four separate Qt WebEngine windows into one cuts the cold-start
        # renderer-process cost that dominated the ~3min load time.
        widget_dir = Path(__file__).resolve().parent
        self._widget_windows = []

        panels_path = widget_dir / "panels.html"
        if panels_path.exists():
            w = webview.create_window(
                title="Warden Dashboard",
                url=panels_path.as_uri(),
                js_api=self._js_api,
                width=420 + 14 + 400 + 14 + 340 + 14 + 320 + 14 + 300 + 28,  # 5 frames + 4 gaps + side padding (Systems moved into the ambient strip)
                height=540 + 28 + 224,  # row (frame + side padding) + ambient OLED strip
                fullscreen=False, resizable=True, frameless=True,
                transparent=True, on_top=False, background_color="#000000",
            )
            try:
                w.move(self.width + 20, 80)
            except Exception:
                logger.debug("window.move() not available", exc_info=True)
            self._widget_windows.append(w)

        # webview.start() blocks until the window is closed. It MUST run on
        # the main thread since it drives platform GUI APIs.
        try:
            webview.start(debug=False, gui="qt")
        finally:
            with self._lock:
                self._closed = True
                self._ready_event.clear()

    def close(self) -> None:
        """Destroy the window. Safe before ``run()`` and after close."""
        with self._lock:
            window = self._window
            self._closed = True
        if window is None:
            return
        try:
            window.destroy()
        except Exception:
            # pywebview can raise if the window is already gone.
            logger.debug("JarvisWindow.close: window.destroy() raised", exc_info=True)

    def set_hologram_visible(self, visible: bool) -> None:
        """Show or hide the hologram window. The Pi setup makes the
        hologram optional, so the dashboard settings can toggle it off."""
        with self._lock:
            window = self._window
        if window is None:
            return
        try:
            if visible:
                window.show()
            else:
                window.hide()
        except Exception:
            logger.debug("set_hologram_visible failed", exc_info=True)

    def after(self, ms: int, callback: Callable[[], None]) -> None:
        """Schedule ``callback`` after ``ms`` milliseconds. Threadsafe.

        Implemented via ``threading.Timer``. The callback is invoked on the
        timer thread; callers that need to touch the UI should route through
        the state setters, which dispatch to the UI thread internally.
        """
        if ms <= 0:
            # Still run on a separate thread to avoid blocking the caller.
            timer = threading.Timer(0, self._safe_call, args=(callback,))
        else:
            timer = threading.Timer(ms / 1000.0, self._safe_call, args=(callback,))
        timer.daemon = True
        timer.start()

    @staticmethod
    def _safe_call(callback: Callable[[], None]) -> None:
        try:
            callback()
        except Exception:
            logger.exception("JarvisWindow.after callback raised")

    # ------------------------------------------------------------------
    # JS bridge helpers
    # ------------------------------------------------------------------
    def _on_loaded(self) -> None:
        """pywebview fires this when the page finishes loading."""
        with self._lock:
            self._ready_event.set()
            pending, self._pending_js = self._pending_js, []
            window = self._window
        if window is None:
            return
        # Center the hologram on the primary screen and keep it raised above
        # the companion panels. on_top=True (set at creation) holds it above
        # other windows; centering here uses the Qt app, which is alive by the
        # time the page has loaded.
        self._center_on_screen(window)
        for snippet in pending:
            try:
                window.evaluate_js(snippet)
            except Exception:
                logger.exception("Failed to flush buffered JS: %s", snippet)

    def _center_on_screen(self, window: "webview.Window") -> None:
        """Center a pywebview window on the primary screen's available geometry."""
        try:
            try:
                from PyQt6.QtGui import QGuiApplication
            except Exception:
                from PySide6.QtGui import QGuiApplication  # type: ignore
            app = QGuiApplication.instance()
            if app is None:
                return
            screen = app.primaryScreen()
            if screen is None:
                return
            geo = screen.availableGeometry()
            w = self.width
            h = self.height + self.feed_height
            x = geo.x() + max(0, (geo.width() - w) // 2)
            y = geo.y() + max(0, (geo.height() - h) // 2)
            window.move(x, y)
            try:
                window.resize(w, h)
            except Exception:
                pass
        except Exception:
            logger.debug("hologram centering failed", exc_info=True)

    def _eval_js(self, snippet: str) -> None:
        """Evaluate ``snippet`` on the page, buffering if not yet ready.

        No-op once the window has closed.
        """
        with self._lock:
            if self._closed:
                return
            if not self._ready_event.is_set() or self._window is None:
                self._pending_js.append(snippet)
                return
            window = self._window
        try:
            window.evaluate_js(snippet)
        except Exception as e:
            # The page's `jarvis` JS object is defined after THREE.js init. If
            # WebGL fails, the init script aborts and `jarvis` is never bound,
            # so every subsequent state/audio update raises ReferenceError.
            # Log once, then stay quiet to avoid a traceback per audio tick.
            if not getattr(self, "_eval_js_warned", False):
                logger.warning(
                    "evaluate_js failed (%s). Further failures suppressed. "
                    "Likely cause: WebGL context failed to initialise, so the "
                    "page-side `jarvis` object was never defined.",
                    e,
                )
                self._eval_js_warned = True

    # ------------------------------------------------------------------
    # State setters (threadsafe; latest-True wins)
    # ------------------------------------------------------------------
    def _apply_state(self, state: str, active: bool) -> None:
        """Update the tracked state: set to ``state`` if active else 'idle'."""
        if active:
            self._current_state = state
        else:
            # Only revert to idle if this state is the one currently showing.
            if self._current_state == state:
                self._current_state = "idle"
        self._eval_js(f"jarvis.setState({json.dumps(self._current_state)});")

    def set_listening_state(self, listening: bool) -> None:
        self._apply_state("listening", listening)

    def set_processing_state(self, processing: bool) -> None:
        self._apply_state("processing", processing)

    def set_speaking_state(self, speaking: bool) -> None:
        self._apply_state("speaking", speaking)

    def set_error_state(self, error: bool) -> None:
        self._apply_state("error", error)

    def set_audio_level(self, level: float) -> None:
        try:
            lvl = float(level)
        except (TypeError, ValueError):
            return
        # Clamp to the documented 0..2 range.
        if lvl < 0.0:
            lvl = 0.0
        elif lvl > 2.0:
            lvl = 2.0
        self._eval_js(f"jarvis.setAudioLevel({lvl});")

    # ------------------------------------------------------------------
    # Timer widget
    # ------------------------------------------------------------------
    def set_timer(self, timer_id: str, label: str, seconds_remaining: int) -> None:
        payload = json.dumps(
            {
                "id": str(timer_id),
                "label": str(label),
                "seconds_remaining": int(seconds_remaining),
            }
        )
        self._eval_js(f"jarvis.setTimer({payload});")

    def clear_timer(self, timer_id: str) -> None:
        self._eval_js(f"jarvis.clearTimer({json.dumps(str(timer_id))});")

    # ------------------------------------------------------------------
    # Mini-holograms (Phase 4 stubs)
    # ------------------------------------------------------------------
    def add_mini_hologram(self, task_id: str, label: str) -> None:
        payload = json.dumps({"id": str(task_id), "label": str(label)})
        self._eval_js(f"jarvis.addMiniHologram({payload});")

    def remove_mini_hologram(self, task_id: str, status: str = "success") -> None:
        self._eval_js(
            f"jarvis.removeMiniHologram({json.dumps(str(task_id))}, {json.dumps(str(status))});"
        )

    # ------------------------------------------------------------------
    # Fullscreen
    # ------------------------------------------------------------------
    def enter_fullscreen(self) -> None:
        with self._lock:
            window = self._window
            already = self._is_fullscreen
        if window is None or already:
            self._is_fullscreen = True
            return
        try:
            window.toggle_fullscreen()
            self._is_fullscreen = True
        except Exception:
            logger.exception("enter_fullscreen failed")

    def exit_fullscreen(self) -> None:
        with self._lock:
            window = self._window
            already_off = not self._is_fullscreen
        if window is None or already_off:
            self._is_fullscreen = False
            return
        try:
            window.toggle_fullscreen()
            self._is_fullscreen = False
        except Exception:
            logger.exception("exit_fullscreen failed")

    def toggle_fullscreen(self) -> None:
        with self._lock:
            window = self._window
        if window is None:
            return
        try:
            window.toggle_fullscreen()
            self._is_fullscreen = not self._is_fullscreen
        except Exception:
            logger.exception("toggle_fullscreen failed")

    # ------------------------------------------------------------------
    # Window management
    # ------------------------------------------------------------------
    def minimize(self) -> None:
        """Minimize the window to taskbar."""
        with self._lock:
            window = self._window
        if window is None:
            return
        try:
            if hasattr(window, 'minimize'):
                window.minimize()
            else:
                # Fallback: use xdotool or qdbus for KDE
                import subprocess
                subprocess.run(
                    ["xdotool", "search", "--name", "Jarvis", "windowminimize"],
                    capture_output=True, timeout=5
                )
        except Exception:
            logger.exception("minimize failed")

    def restore(self) -> None:
        """Restore / show the window."""
        with self._lock:
            window = self._window
        if window is None:
            return
        try:
            if hasattr(window, 'restore'):
                window.restore()
            elif hasattr(window, 'show'):
                window.show()
            else:
                import subprocess
                subprocess.run(
                    ["xdotool", "search", "--name", "Jarvis", "windowactivate"],
                    capture_output=True, timeout=5
                )
        except Exception:
            logger.exception("restore failed")
