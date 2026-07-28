"""Optional Moondream scene caption for security awareness events.

Moondream is a tiny open-source vision-language model (Apache 2.0). It runs
locally on CPU and can describe a frame in one short sentence. If the model or
transformers are not installed, the captioner gracefully returns None and the
security feed falls back to structured data only.
"""

from __future__ import annotations

import logging
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger("security.caption")

DEFAULT_MODEL = "vikhyatk/moondream2"
DEFAULT_REVISION = "2025-06-21"


class Captioner:
    """Lazy-load Moondream and caption/answer questions about frames on demand."""

    def __init__(self, cfg: Optional[dict] = None):
        self.cfg = cfg or {}
        cap_cfg = self.cfg.get("caption", {})
        self.enabled = bool(cap_cfg.get("enabled", True))
        self.model_name = str(cap_cfg.get("model", DEFAULT_MODEL))
        self.revision = str(cap_cfg.get("revision", DEFAULT_REVISION))
        self.device = str(cap_cfg.get("device", "cuda")).lower()
        self._model = None
        self._warned = False

    def _pil(self, frame_bgr: np.ndarray):
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        from PIL import Image
        return Image.fromarray(rgb)

    def caption(self, frame_bgr: np.ndarray) -> Optional[str]:
        """Return a short caption, or None if disabled / missing deps / no GPU."""
        if not self.enabled or frame_bgr is None or frame_bgr.size == 0:
            return None
        try:
            model = self._load()
            if model is None:
                return None
            image = self._pil(frame_bgr)
            result = model.caption(image, length="short")
            caption = result.get("caption") if isinstance(result, dict) else str(result)
            if caption:
                log.info("Moondream caption: %s", caption)
            return caption
        except Exception as e:
            if not self._warned:
                log.warning("Moondream caption failed: %s", e)
                self._warned = True
            return None

    def query(self, frame_bgr: np.ndarray, question: str) -> Optional[str]:
        """Ask Moondream a specific question about the frame. Returns answer text."""
        if not self.enabled or frame_bgr is None or frame_bgr.size == 0 or not question:
            return None
        try:
            model = self._load()
            if model is None:
                return None
            image = self._pil(frame_bgr)
            result = model.query(image, question)
            answer = result.get("answer") if isinstance(result, dict) else str(result)
            if answer:
                log.info("Moondream query (%s): %s", question, answer)
            return answer
        except Exception as e:
            if not self._warned:
                log.warning("Moondream query failed: %s", e)
                self._warned = True
            return None

    def _load(self):
        if self._model is not None:
            return self._model
        try:
            from transformers import AutoModelForCausalLM
        except Exception as e:
            if not self._warned:
                log.warning("transformers not installed; Moondream caption unavailable: %s", e)
                self._warned = True
            return None

        try:
            device_map = {"": self.device} if self.device != "cpu" else "auto"
            self._model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                revision=self.revision,
                trust_remote_code=True,
                device_map=device_map,
            )
            log.info("Moondream loaded (%s on %s)", self.model_name, self.device)
            return self._model
        except Exception as e:
            if not self._warned:
                log.warning("Failed to load Moondream %s: %s", self.model_name, e)
                self._warned = True
            return None


# Module-level singleton.
_caption_singleton: Optional[Captioner] = None


def _get_singleton(cfg: Optional[dict] = None) -> Captioner:
    global _caption_singleton
    if _caption_singleton is None:
        _caption_singleton = Captioner(cfg)
    return _caption_singleton


def caption(frame_bgr: np.ndarray, cfg: Optional[dict] = None) -> Optional[str]:
    return _get_singleton(cfg).caption(frame_bgr)
