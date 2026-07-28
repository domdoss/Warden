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
    ):
        self.on_button_press = on_button_press
        self.width = width
        self.height = height

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
                height=self.height,
                fullscreen=False,
                resizable=True,
                frameless=True,
                transparent=True,
                on_top=False,
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
        for snippet in pending:
            try:
                window.evaluate_js(snippet)
            except Exception:
                logger.exception("Failed to flush buffered JS: %s", snippet)

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
