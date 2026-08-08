"""Text-to-Speech dispatch layer.

Supports two engines:
- "kokoro"  (default) — fast, small, runs on CPU/iGPU/DirectML/CUDA. Good default
  for laptops with limited VRAM.
- "orpheus" — higher-quality LLM-based TTS via Orpheus-TTS + vLLM. Requires a
  CUDA GPU with enough VRAM (the 3B model does not fit in ~4 GB).

The public API is unchanged:
    TTS(engine="kokoro", voice="am_michael", speed=1.0).synthesize(text) -> bytes
"""

import io
import os
import wave
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional


class BaseTTS(ABC):
    """Common TTS interface."""

    @abstractmethod
    def synthesize(self, text: str) -> bytes:
        """Return mono WAV audio bytes (or b\"\" on error)."""

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


class KokoroTTS(BaseTTS):
    """Text-to-Speech handler using Kokoro."""

    # Kokoro emits 24 kHz mono audio.
    SAMPLE_RATE = 24000

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
        self.device = device or self._pick_device()
        self._pipeline = None

    @staticmethod
    def _pick_device():
        """Kokoro-82M is tiny — GPU kernel-launch overhead makes it slower
        than CPU on AMD ROCm. Always use CPU."""
        return "cpu"

        # -- original device selection (kept for reference) --
        # try:
        #     import torch
        # except ImportError:
        #     return "cpu"
        # try:
        #     import intel_extension_for_pytorch  # noqa: F401
        # except ImportError:
        #     pass
        # if hasattr(torch, "xpu") and torch.xpu.is_available():
        #     return "xpu"
        # try:
        #     import torch_directml  # type: ignore
        #     if torch_directml.is_available():
        #         return torch_directml.device()
        # except Exception:
        #     pass
        # if torch.cuda.is_available():
        #     os.environ.setdefault("ROCBLAS_TENSILE_LIBPATH", "/opt/rocm/lib/rocblas/library")
        #     os.environ.setdefault("MIOPEN_CACHE_DIR", os.path.expanduser("~/.cache/miopen"))
        #     os.environ.setdefault("MIOPEN_FIND_MODE", "1")
        #     return "cuda"
        # return "cpu"

    def _get_pipeline(self):
        """Lazy load Kokoro pipeline."""
        if self._pipeline is None:
            try:
                from kokoro import KPipeline
            except ImportError as e:
                raise RuntimeError(
                    "Kokoro not installed. Install with: pip install kokoro soundfile"
                ) from e

            try:
                self._pipeline = KPipeline(
                    lang_code=self.lang_code, device=self.device
                )
            except TypeError:
                self._pipeline = KPipeline(lang_code=self.lang_code)
        return self._pipeline

    def warmup(self) -> None:
        """Load the pipeline and run a short synthesis so the model is hot.
        Call once at startup — subsequent synthesize() calls skip the load cost."""
        pipeline = self._get_pipeline()
        # Run a tiny utterance to warm GPU kernels / JIT / CPU cache
        for _ in pipeline("Warmup.", voice=self.voice, speed=self.speed,
                          split_pattern=r"\n+"):
            pass

    def synthesize(self, text: str) -> bytes:
        """Synthesize text to speech audio bytes (WAV format)."""
        try:
            import numpy as np
            import soundfile as sf

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
            sf.write(buffer, combined, self.SAMPLE_RATE, format="WAV")
            return buffer.getvalue()

        except Exception as e:
            import traceback
            print(f"TTS error: {type(e).__name__}: {e}")
            traceback.print_exc()
            return b""


class OrpheusTTS(BaseTTS):
    """Text-to-Speech handler using Orpheus-TTS (LLM-based, GPU-hungry)."""

    # Orpheus prod model — English, ~3B param decoder, served by vLLM.
    DEFAULT_MODEL = "canopylabs/orpheus-tts-0.1-finetune-prod"
    # Orpheus emits raw 16-bit mono PCM at 24 kHz.
    SAMPLE_RATE = 24000

    def __init__(
        self,
        voice: str = "zoe",
        speed: float = 1.0,
        lang_code: Optional[str] = None,
        device: Optional[str] = None,
    ):
        self.voice = voice
        self.speed = speed
        # lang_code and device are accepted for API compatibility but are not
        # used by the current Orpheus package.
        self.lang_code = lang_code
        self.device = device
        self._model: Optional["OrpheusModel"] = None  # type: ignore[name-defined]

    def _get_model(self):
        """Lazy load Orpheus-TTS model."""
        if self._model is None:
            try:
                from orpheus_tts import OrpheusModel
            except ImportError as e:
                raise RuntimeError(
                    "Orpheus-TTS not installed. Install with: pip install orpheus-speech vllm"
                ) from e

            self._model = OrpheusModel(
                model_name=self.DEFAULT_MODEL,
            )
        return self._model

    def synthesize(self, text: str) -> bytes:
        """Synthesize text to speech audio bytes (WAV format, 24 kHz mono 16-bit)."""
        try:
            if not text or not text.strip():
                return b""

            model = self._get_model()
            syn_tokens = model.generate_speech(
                prompt=text,
                voice=self.voice,
                repetition_penalty=1.1,
            )

            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(self.SAMPLE_RATE)
                for audio_chunk in syn_tokens:
                    if audio_chunk:
                        wf.writeframes(audio_chunk)
            return buffer.getvalue()

        except Exception as e:
            import traceback
            print(f"TTS error: {type(e).__name__}: {e}")
            traceback.print_exc()
            return b""


class TTS(BaseTTS):
    """Unified TTS entry point.

    engine: "kokoro" or "orpheus". Defaults to Kokoro so the app works out of
    the box on modest hardware.
    """

    def __init__(
        self,
        engine: str = "kokoro",
        voice: Optional[str] = None,
        speed: float = 1.0,
        lang_code: Optional[str] = None,
        device: Optional[str] = None,
    ):
        self.engine_name = (engine or "kokoro").lower().strip()

        if self.engine_name == "orpheus":
            self._impl = OrpheusTTS(
                voice=voice or "zoe",
                speed=speed,
                lang_code=lang_code,
                device=device,
            )
        elif self.engine_name == "kokoro":
            self._impl = KokoroTTS(
                voice=voice or "am_michael",
                speed=speed,
                lang_code=lang_code or "a",
                device=device,
            )
        elif self.engine_name == "orpheus_cpp":
            # llama.cpp/GGUF backend (orpheus-cpp) — ROCm-friendly, unlike the
            # vLLM "orpheus" engine above. See voice/tts_orpheus_cpp.py.
            from .tts_orpheus_cpp import OrpheusCppTTS

            self._impl = OrpheusCppTTS(voice=voice, speed=speed,
                                       lang_code=lang_code, device=device)
        else:
            raise ValueError(f"Unsupported tts_engine: {engine!r}")

    @property
    def voice(self) -> str:
        return self._impl.voice

    @property
    def speed(self) -> float:
        return self._impl.speed

    def synthesize(self, text: str) -> bytes:
        return self._impl.synthesize(text)

    def save(self, text: str, filepath: Path) -> None:
        self._impl.save(text, filepath)

    def speak(self, text: str) -> None:
        self._impl.speak(text)
