"""Voice module for audio I/O."""

# Lazy re-exports (PEP 562). The submodules have heavy, optional dependency
# surfaces — stt.py needs torch+whisper, audio.py needs webrtcvad — and
# eagerly importing them here meant `from ears.tts import TTS` (kokoro/
# orpheus_cpp path) required torch for no reason. Attribute access imports on
# demand, keeping `from ears import STT` working while letting TTS-only and
# eyes-side consumers import just what they use.

import importlib
from typing import Any

__all__ = ["AudioPlayer", "AudioRecorder", "BeepGenerator", "STT", "TTS"]

_EXPORTS = {
    "AudioPlayer": "ears.audio",
    "AudioRecorder": "ears.audio",
    "BeepGenerator": "ears.audio",
    "STT": "ears.stt",
    "TTS": "ears.tts",
}


def __getattr__(name: str) -> Any:
    modname = _EXPORTS.get(name)
    if modname is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    val = getattr(importlib.import_module(modname), name)
    globals()[name] = val
    return val
