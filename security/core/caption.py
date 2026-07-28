"""Ollama-based scene caption for security awareness events.

The laptop/satellite runs a local Ollama vision model (default gemma3:4b) and
captions/answers questions about the latest frame on demand. This avoids the
heavy HuggingFace/transformers dependency and Python 3.14 wheel build issues.
"""

from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger("security.caption")

DEFAULT_MODEL = "gemma3:4b"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"


class Captioner:
    """Call Ollama to caption or answer questions about frames on demand."""

    def __init__(self, cfg: Optional[dict] = None):
        self.cfg = cfg or {}
        cap_cfg = self.cfg.get("caption", {})
        self.enabled = bool(cap_cfg.get("enabled", True))
        self.model = str(cap_cfg.get("model", DEFAULT_MODEL))
        self.ollama_url = str(cap_cfg.get("ollama_url", DEFAULT_OLLAMA_URL)).rstrip("/")
        self.timeout = float(cap_cfg.get("timeout_seconds", 60))
        self._warned = False

    def _encode_frame(self, frame_bgr: np.ndarray) -> Optional[str]:
        """Encode a BGR frame as a base64 JPEG string for Ollama vision."""
        try:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            ok, buf = cv2.imencode(".jpg", rgb)
            if not ok or buf is None:
                return None
            return base64.b64encode(buf.tobytes()).decode("utf-8")
        except Exception as e:
            log.warning("Frame encoding failed: %s", e)
            return None

    def _ask(self, frame_bgr: np.ndarray, prompt: str) -> Optional[str]:
        """Send one vision prompt to Ollama and return the text response."""
        b64 = self._encode_frame(frame_bgr)
        if b64 is None:
            return None

        url = f"{self.ollama_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": [b64],
                }
            ],
            "stream": False,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf-8")
                parsed = json.loads(body)
                message = parsed.get("message", {})
                text = message.get("content") if isinstance(message, dict) else None
                if text:
                    text = text.strip()
                return text
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:200]
            if not self._warned:
                log.warning("Ollama caption HTTP %s: %s", e.code, body)
                self._warned = True
        except Exception as e:
            if not self._warned:
                log.warning("Ollama caption failed: %s", e)
                self._warned = True
        return None

    def caption(self, frame_bgr: np.ndarray) -> Optional[str]:
        """Return a short caption for the frame."""
        if not self.enabled or frame_bgr is None or frame_bgr.size == 0:
            return None
        text = self._ask(frame_bgr, "Describe this scene in one short sentence.")
        if text:
            log.info("Ollama caption: %s", text)
        return text

    def query(self, frame_bgr: np.ndarray, question: str) -> Optional[str]:
        """Ask a specific question about the frame."""
        if not self.enabled or frame_bgr is None or frame_bgr.size == 0 or not question:
            return None
        text = self._ask(frame_bgr, question)
        if text:
            log.info("Ollama query (%s): %s", question, text)
        return text


# Module-level singleton.
_caption_singleton: Optional[Captioner] = None


def _get_singleton(cfg: Optional[dict] = None) -> Captioner:
    global _caption_singleton
    if _caption_singleton is None:
        _caption_singleton = Captioner(cfg)
    return _caption_singleton


def caption(frame_bgr: np.ndarray, cfg: Optional[dict] = None) -> Optional[str]:
    return _get_singleton(cfg).caption(frame_bgr)
