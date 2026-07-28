"""Text-to-Speech using Kokoro (high quality, fast, offline)."""

import io
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import torch

try:
    import intel_extension_for_pytorch as _ipex  # noqa: F401
except ImportError:
    pass
_HAS_XPU = hasattr(torch, "xpu") and torch.xpu.is_available()

try:
    import torch_directml  # type: ignore
    _DML_DEV = torch_directml.device() if torch_directml.is_available() else None
except Exception:
    _DML_DEV = None


def _pick_device():
    """Best available device for Kokoro inference. Same priority as STT:
    Intel XPU → DirectML (any DX12 GPU) → CUDA → CPU. Returns either a
    string or a torch.device (DirectML)."""
    if _HAS_XPU:
        return "xpu"
    if _DML_DEV is not None:
        return _DML_DEV
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class TTS:
    """Text-to-Speech handler using Kokoro."""

    def __init__(
        self,
        voice: str = "af_heart",
        speed: float = 1.0,
        lang_code: str = "a",
        device: Optional[str] = None,
    ):
        self.voice = voice
        self.speed = speed
        self.lang_code = lang_code
        self.device = device or _pick_device()
        self._pipeline = None

    def _get_pipeline(self):
        """Lazy load Kokoro pipeline."""
        if self._pipeline is None:
            try:
                from kokoro import KPipeline

                try:
                    self._pipeline = KPipeline(
                        lang_code=self.lang_code, device=self.device
                    )
                except TypeError:
                    self._pipeline = KPipeline(lang_code=self.lang_code)
            except ImportError:
                raise RuntimeError(
                    "Kokoro not installed. Install with: pip install kokoro soundfile"
                )
        return self._pipeline

    def synthesize(self, text: str) -> bytes:
        """Synthesize text to speech audio bytes (WAV format)."""
        try:
            pipeline = self._get_pipeline()

            if not text or not text.strip():
                return b""

            generator = pipeline(
                text=text,
                voice=self.voice,
                speed=self.speed,
                split_pattern=r"\n+",
            )

            audio_segments = []
            for _, _, audio in generator:
                audio_segments.append(audio)

            if not audio_segments:
                return b""

            combined = np.concatenate(audio_segments)

            buffer = io.BytesIO()
            sf.write(buffer, combined, 24000, format="WAV")
            return buffer.getvalue()

        except Exception as e:
            import traceback
            print(f"TTS error: {type(e).__name__}: {e}")
            traceback.print_exc()
            return b""

    def save(self, text: str, filepath: Path) -> None:
        """Synthesize and save to file."""
        audio = self.synthesize(text)
        Path(filepath).write_bytes(audio)

    def speak(self, text: str) -> None:
        """Speak text immediately (blocking)."""
        try:
            from voice.audio import AudioPlayer

            audio = self.synthesize(text)
            if audio:
                player = AudioPlayer()
                player.play_bytes(audio)
        except Exception as e:
            print(f"TTS speak error: {e}")
