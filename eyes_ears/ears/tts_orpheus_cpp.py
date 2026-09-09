"""Orpheus-TTS via orpheus_cpp — the GGUF (llama.cpp) backend, not vLLM.

The 3B speech model is a Q4_K_M GGUF served by llama-cpp-python, fully
offloaded to the GPU (n_gpu_layers=-1). Only the LLM runs on the GPU; the SNAC
audio decoder is a tiny ONNX model and stays on CPU — so a 16 GB card uses
~2-3 GB, leaving room for the LLM models (Ollama lives on GPU1 on the desktop
box; the launcher pins this engine to GPU0 via CUDA_VISIBLE_DEVICES=0).

GPU selection: device="cpu" forces CPU (slow — only for boxes with no GPU).
device="cuda" (the default) or None uses the GPU; "cuda:N" additionally
exports CUDA_VISIBLE_DEVICES=N before llama_cpp loads (only if the env var is
not already set — the environment always wins). device="both" (or "cuda:both"
/ "all") leaves ALL CUDA devices visible so llama.cpp layer-splits the model
across every card (split_mode=LAYER is llama-cpp-python's default): each GPU
holds ~half the weights and decode shares the memory-bandwidth load. On a 3B
model that is bandwidth-bound, expect ~1.4-1.8x, never 2x — per-layer PCIe
sync eats the rest.

speed is accepted for API parity with KokoroTTS but not applied — orpheus_cpp
has no speed control. lang_code accepts the kokoro-style codes ("a", "b") or
ISO codes; anything unrecognized maps to English (the package's own default
is Spanish, so we always pass an explicit language).
"""

import io
import os
from pathlib import Path
from typing import Optional

from .tts import BaseTTS


class OrpheusCppTTS(BaseTTS):
    SAMPLES_RATE_NOTE = "orpheus_cpp emits 24 kHz mono int16"
    SAMPLE_RATE = 24000

    # Voices in the English GGUF used by orpheus_cpp. The stale settings.yaml
    # mentioned "julia" — that name does not exist here.
    VOICES = frozenset({"tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"})
    DEFAULT_VOICE = "zoe"

    LANGS = frozenset({"en", "es", "fr", "de", "it", "hi", "zh", "ko"})

    def __init__(
        self,
        voice: Optional[str] = None,
        speed: float = 1.0,
        lang_code: Optional[str] = None,
        device: Optional[str] = None,
    ):
        self.voice = voice if voice in self.VOICES else self.DEFAULT_VOICE
        self.speed = speed
        self.lang = lang_code if lang_code in self.LANGS else "en"
        self.device = device or "cuda"
        self._model = None

        self._on_cpu = self.device == "cpu"
        # "both"/"all"/"cuda:both" → leave every CUDA device visible and let
        # llama.cpp layer-split across them (see module docstring).
        self._multi_gpu = self.device in ("all", "both", "cuda:all", "cuda:both")
        self._n_gpu_layers = 0 if self._on_cpu else -1
        if (
            not self._on_cpu
            and not self._multi_gpu
            and ":" in self.device
            and "CUDA_VISIBLE_DEVICES" not in os.environ
        ):
            os.environ["CUDA_VISIBLE_DEVICES"] = self.device.split(":", 1)[1]

    def _get_model(self):
        if self._model is None:
            try:
                from orpheus_cpp import OrpheusCpp
            except ImportError as e:
                raise RuntimeError(
                    "orpheus_cpp not installed. Needs a CUDA build of "
                    "llama-cpp-python, e.g.: pip install llama-cpp-python "
                    "--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124"
                ) from e

            # orpheus_cpp hardcodes n_ctx=0 ("take the model's training
            # context"). This GGUF's n_ctx_train is 131 072, so llama.cpp
            # tries to allocate a ~9 GB KV cache and cudaMalloc OOMs on the
            # 16 GB Quadros. TTS turns are a sentence or two — 4096 tokens of
            # context is generous. OrpheusCpp imports Llama lazily inside
            # __init__, so patching the module attribute here takes effect.
            import llama_cpp

            if not getattr(llama_cpp.Llama, "_eyes_ears_ctx_clamped", False):
                _real_llama = llama_cpp.Llama

                def _llama_clamped_ctx(*args, **kwargs):
                    if kwargs.get("n_ctx", 1) == 0:
                        kwargs["n_ctx"] = 4096
                    return _real_llama(*args, **kwargs)

                _llama_clamped_ctx._eyes_ears_ctx_clamped = True
                llama_cpp.Llama = _llama_clamped_ctx

            self._model = OrpheusCpp(
                n_gpu_layers=self._n_gpu_layers,
                n_threads=0,
                verbose=False,
                lang=self.lang,
            )
        return self._model

    def warmup(self) -> None:
        """Load the GGUF onto the GPU and run a short synthesis so the first
        user turn doesn't pay the model-load cost (main.py calls this at
        startup when present)."""
        model = self._get_model()
        model.tts("Ready.", {"voice_id": self.voice, "max_tokens": 64})

    def synthesize(self, text: str) -> bytes:
        """Full-buffer synthesis -> 24 kHz mono WAV bytes.

        Unlike kokoro this is not streaming: the whole utterance is generated
        before playback, so latency scales with reply length. Long replies
        take seconds even on a GPU.
        """
        if not text or not text.strip():
            return b""

        import numpy as np
        import soundfile as sf

        model = self._get_model()
        _, audio = model.tts(text, {"voice_id": self.voice})

        pcm = audio.reshape(-1).astype(np.float32) / 32768.0
        buffer = io.BytesIO()
        sf.write(buffer, pcm, self.SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return buffer.getvalue()
