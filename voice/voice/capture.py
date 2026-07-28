"""Image capture for vision requests.

``capture(source)`` returns raw image bytes (PNG/JPEG) or ``None``. The Dockbox
server resizes images itself, so we send the original capture untouched.

Two sources:
  - "screen"  : a desktop screenshot (works today; Wayland/X11 aware).
  - "webcam"  : a frame from a USB camera (stub until a camera is added to the
                dockbox box). Same interface, so the caller never changes.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import List, Optional


def _run(cmd: List[str], outfile: str) -> bool:
    try:
        subprocess.run(
            cmd,
            check=True,
            timeout=15,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return os.path.exists(outfile) and os.path.getsize(outfile) > 0
    except Exception:
        return False


def capture_screen() -> Optional[bytes]:
    """Grab the full screen. Tries Wayland (grim), KDE (spectacle), X11 (import)."""
    fd, path = tempfile.mkstemp(suffix=".png", prefix="jarvis-shot-")
    os.close(fd)
    try:
        attempts: List[List[str]] = []
        if shutil.which("grim"):
            attempts.append(["grim", path])
        if shutil.which("spectacle"):
            attempts.append(["spectacle", "-b", "-n", "-f", "-o", path])
        if shutil.which("import"):  # ImageMagick (X11 / XWayland)
            attempts.append(["import", "-window", "root", path])
        if shutil.which("gnome-screenshot"):
            attempts.append(["gnome-screenshot", "-f", path])

        for cmd in attempts:
            if _run(cmd, path):
                with open(path, "rb") as fh:
                    return fh.read()
        print(
            "[capture] no working screenshot tool "
            "(install one of: grim, spectacle, imagemagick, gnome-screenshot)"
        )
        return None
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def capture_webcam(device: str = "/dev/video0") -> Optional[bytes]:
    """Grab a single frame from a USB webcam. Returns None if no camera/ffmpeg.

    Stubbed for when a camera is added to the dockbox box.
    """
    if not os.path.exists(device):
        print(f"[capture] no webcam at {device}")
        return None
    if not shutil.which("ffmpeg"):
        print("[capture] ffmpeg not installed; cannot capture webcam")
        return None
    fd, path = tempfile.mkstemp(suffix=".jpg", prefix="jarvis-cam-")
    os.close(fd)
    try:
        cmd = ["ffmpeg", "-y", "-f", "v4l2", "-i", device, "-frames:v", "1", path]
        if _run(cmd, path):
            with open(path, "rb") as fh:
                return fh.read()
        return None
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def capture(source: str = "screen") -> Optional[bytes]:
    if source == "webcam":
        return capture_webcam()
    return capture_screen()
