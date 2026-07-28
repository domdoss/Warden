"""Speech-to-Text using local Whisper."""

import io
import os
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import torch
import whisper

# PyTorch 2.5+ from the XPU wheel index has Intel Extension for PyTorch
# merged in, so torch.xpu is available without a separate IPEX import.
# Older builds need IPEX as a side-effect import to register the device;
# try it for back-compat but never make it required.
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
    """Best available device for inference.

    Priority: Intel XPU (iGPU/Arc, native PyTorch) → DirectML (any DX12
    GPU on Windows: AMD Radeon incl. Ryzen iGPU, Intel iGPU, NVIDIA) →
    CUDA (kept as a no-op on Windows builds where CUDA wheels are not
    installed) → CPU. Returns either a string ("xpu"/"cuda"/"cpu") or a
    torch.device (DirectML).
    """
    if _HAS_XPU:
        return "xpu"
    if _DML_DEV is not None:
        return _DML_DEV
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class STT:
    """Speech-to-Text handler using local Whisper."""

    def __init__(
        self,
        model: str = "base",
        language: Optional[str] = None,
        device: Optional[str] = None,
    ):
        self.model_name = model
        self.language = language
        self.device = device or _pick_device()
        self._model = None

    def _load_model(self):
        if self._model is None:
            print(f"[stt] loading Whisper '{self.model_name}' on device={self.device}")
            self._model = whisper.load_model(self.model_name, device=self.device)
        return self._model

    def transcribe(self, audio_data: bytes, language: Optional[str] = None) -> str:
        """Transcribe audio bytes to text using local Whisper.

        Decodes WAV bytes via soundfile and feeds a numpy float32 mono 16kHz
        array straight to Whisper — avoids shelling out to ffmpeg (which isn't
        on PATH on a fresh Windows install).
        """
        if not audio_data:
            print("[stt] transcribe called with empty audio_data")
            return ""
        try:
            model = self._load_model()
            audio, sr = sf.read(io.BytesIO(audio_data), dtype="float32", always_2d=False)
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if sr != 16000:
                # Whisper expects 16kHz; resample with a simple linear
                # interpolation so we don't pull in scipy just for this.
                ratio = 16000 / float(sr)
                new_len = int(round(len(audio) * ratio))
                audio = np.interp(
                    np.linspace(0.0, len(audio), new_len, endpoint=False),
                    np.arange(len(audio)),
                    audio,
                ).astype(np.float32)
            result = model.transcribe(audio, language=language or self.language)
            text = result["text"].strip()
            print(f"[stt] transcribed {len(audio_data)} bytes -> {text!r}")
            return text
        except Exception as e:
            print(f"[stt] transcription failed: {type(e).__name__}: {e}")
            return ""

    def transcribe_file(self, filepath: Path) -> str:
        """Transcribe audio file to text using local Whisper."""
        try:
            model = self._load_model()
            result = model.transcribe(
                str(filepath), language=self.language
            )
            return result["text"].strip()
        except Exception:
            return ""
