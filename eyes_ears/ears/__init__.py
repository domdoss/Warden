"""Voice module for audio I/O."""

from .audio import AudioPlayer, AudioRecorder, BeepGenerator
from .stt import STT
from .tts import TTS

__all__ = ["AudioPlayer", "AudioRecorder", "BeepGenerator", "STT", "TTS"]
