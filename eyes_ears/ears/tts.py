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
            from ears.audio import AudioPlayer

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
        """Best available device for Kokoro inference. CUDA (NVIDIA) when
        available, else Intel XPU / DirectML, else CPU. Kokoro-82M is small,
        but on a CUDA GPU it still beats CPU and frees the CPU for the
        orchestrator — so prefer the GPU. (The old "always CPU" was a
        workaround for AMD ROCm, where Kokoro's kernel-launch overhead made
        the GPU slower and loading it alongside Whisper could segfault;
        neither applies to NVIDIA CUDA.)"""
        try:
            import torch
        except ImportError:
            return "cpu"
        if torch.cuda.is_available():
            return "cuda"
        try:
            import intel_extension_for_pytorch  # noqa: F401
        except ImportError:
            pass
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            return "xpu"
        try:
            import torch_directml  # type: ignore
            if torch_directml.is_available():
                return torch_directml.device()
        except Exception:
            pass
        return "cpu"

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
        """Synthesize text to speech audio bytes (WAV format).

        Errors are NOT swallowed — a synthesis failure (missing dep, empty
        model output, etc.) raises so the caller (_speak) prints it and the
        real cause can be addressed. The previous `except: return b""` silently
        dropped audio and hid the failure (the bootstrap "Assistant online."
        line would vanish with no error printed).
        """
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
            raise RuntimeError(
                f"Kokoro produced no audio segments for text: {text!r}"
            )

        combined = np.concatenate(audio_segments)
        buffer = io.BytesIO()
        sf.write(buffer, combined, self.SAMPLE_RATE, format="WAV")
        return buffer.getvalue()


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
        """Synthesize text to speech audio bytes (WAV format, 24 kHz mono 16-bit).

        Errors raise instead of being swallowed (see KokoroTTS.synthesize).
        """
        if not text or not text.strip():
            return b""

        model = self._get_model()
        syn_tokens = model.generate_speech(
            prompt=text,
            voice=self.voice,
            repetition_penalty=1.1,
        )

        buffer = io.BytesIO()
        frames_written = 0
        with wave.open(buffer, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.SAMPLE_RATE)
            for audio_chunk in syn_tokens:
                if audio_chunk:
                    wf.writeframes(audio_chunk)
                    frames_written += len(audio_chunk)
        if frames_written == 0:
            raise RuntimeError(
                f"Orpheus produced no audio for text: {text!r}"
            )
        return buffer.getvalue()


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
                voice=voice or "af_heart",
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
