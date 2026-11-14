"""Wake-word detector — spots a spoken wake word via a small local Whisper.

The wake word (default ``warden``) has no pre-trained low-power model in
openWakeWord, so instead of a dedicated KWS model this detector keeps a
rolling window of mic audio and — only while there is real speech energy —
transcribes it with a tiny English Whisper model and looks for the wake word
in the result. This reuses the same Whisper stack the app already uses for
STT and works for any word, no training required.

Interface mirrors the detector it replaces (constructor with mic params,
``start``/``stop``/``pause``/``resume``) so the voice app can swap it in
without touching the wake path downstream of the callback.

Callers pause the detector during conversation / TTS playback to avoid mic
contention and speaker feedback (see ``pause``/``resume``). While paused the
input device is fully released so the recorder can take the mic exclusively.
"""

from __future__ import annotations

import os
import re
import threading
import time
from collections import deque
from typing import Callable, Optional

import numpy as np

from ears.audio import _suppress_alsa


class WakeWordDetector:
    _FRAME_MS = 80
    _RATE = 16000

    # RMS (int16) below which the window is treated as silence and skipped,
    # so we don't burn CPU transcribing an empty room (and don't let Whisper
    # hallucinate a wake word out of noise).
    _MIN_RMS = 150.0

    def __init__(
        self,
        on_wake: Callable[[], None],
        can_fire: Optional[Callable[[], bool]] = None,
        wake_word: str = "warden",
        threshold: float = 0.5,          # retained for interface compat; unused
        cooldown: float = 2.0,           # quiet period after a successful wake
        refractory: float = 1.0,         # min seconds between wake callbacks
        sample_rate: int = _RATE,
        fallback_sample_rate: Optional[int] = 48000,
        input_device: Optional[int] = None,
        stt_model: str = "tiny.en",      # small/fast English Whisper for spotting
        window_seconds: float = 2.5,     # how much trailing audio to transcribe
        check_interval: float = 1.2,     # how often to run a spot check
    ):
        self.on_wake = on_wake
        self.can_fire = can_fire or (lambda: True)
        self.wake_word = str(wake_word or "warden").strip().lower()
        self.threshold = float(threshold)
        self.cooldown = float(cooldown)
        self.refractory = float(refractory)
        self.stt_model = stt_model or "tiny.en"
        self.window_seconds = float(window_seconds)
        self.check_interval = float(check_interval)

        self.sample_rate = self._RATE
        if int(sample_rate) != self._RATE:
            print(
                f"[wake] wake spotter uses {self._RATE} Hz; "
                f"ignoring sample_rate={sample_rate}"
            )
        self.fallback_sample_rate = fallback_sample_rate
        self.input_device = input_device

        self._active_rate = self.sample_rate
        self._frame_samples = int(self._active_rate * self._FRAME_MS / 1000)
        self._buffer: "deque[int]" = deque(
            maxlen=int(self._RATE * self.window_seconds)
        )
        self._wake_re = re.compile(r"\b" + re.escape(self.wake_word) + r"\b")

        self._stop = threading.Event()
        self._resume = threading.Event()
        self._resume.set()
        self._thread: Optional[threading.Thread] = None
        self._model = None  # loaded lazily on the worker thread

    # ----- lifecycle -----

    @property
    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="wake-word-detector", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._resume.set()

    def pause(self) -> None:
        """Release the mic so the recorder can use it (idempotent)."""
        self._resume.clear()

    def resume(self) -> None:
        self._resume.set()

    # ----- frame source -----

    def _open_stream(self):
        """Open the input source. Returns an opaque (handle, stream) pair or
        raises on failure. Tries 16 kHz first, then ``fallback_sample_rate``
        for nodes that reject 16 kHz on reopen. ``self._active_rate`` tracks
        whichever rate the stream actually opened at."""
        rates = [self.sample_rate]
        if (
            self.fallback_sample_rate
            and int(self.fallback_sample_rate) != self.sample_rate
        ):
            rates.append(int(self.fallback_sample_rate))

        last_err: Optional[Exception] = None
        for rate in rates:
            p = None
            try:
                with _suppress_alsa():
                    import pyaudio

                    p = pyaudio.PyAudio()
                    stream = p.open(
                        format=pyaudio.paInt16,
                        channels=1,
                        rate=rate,
                        input=True,
                        frames_per_buffer=int(rate * self._FRAME_MS / 1000),
                        input_device_index=self.input_device,
                    )
            except Exception as e:
                last_err = e
                if p is not None:
                    try:
                        p.terminate()
                    except Exception:
                        pass
                continue
            self._active_rate = rate
            self._frame_samples = int(rate * self._FRAME_MS / 1000)
            return p, stream
        raise last_err or RuntimeError("cannot open input stream")

    def _read_frame(self, stream) -> bytes:
        """Read one 80 ms frame at the active rate (int16 mono)."""
        return stream.read(self._frame_samples, exception_on_overflow=False)

    def _close(self, handle, stream) -> None:
        if stream is not None:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:
                pass
        if handle is not None:
            try:
                handle.terminate()
            except Exception:
                pass

    # ----- model + matching -----

    def _load_model(self):
        if self._model is None:
            import whisper

            print(
                f"[wake] loading Whisper {self.stt_model!r} for wake-word "
                f"spotting (CPU)"
            )
            self._model = whisper.load_model(self.stt_model, device="cpu")
        return self._model

    def _contains_wake_word(self, text: str) -> bool:
        return self._wake_re.search(text.lower()) is not None

    def _transcribe(self, samples: np.ndarray) -> str:
        """Transcribe a float32 mono 16 kHz window and return lowercase text."""
        try:
            model = self._load_model()
            result = model.transcribe(
                samples, language="en", fp16=False, temperature=0.0
            )
            return (result.get("text") or "").strip()
        except Exception as e:
            print(f"[wake] transcription failed: {type(e).__name__}: {e}")
            return ""

    # ----- worker -----

    def _run(self) -> None:
        try:
            import pyaudio  # noqa: F401
        except ImportError:
            print("[wake] pyaudio not installed; wake-word detection disabled")
            return

        fired_at = 0.0
        warned = False  # mic-open failures log once, not every retry
        last_check = 0.0
        handle = stream = None

        try:
            while not self._stop.is_set():
                # Honor pause by fully releasing the input device.
                if not self._resume.is_set():
                    self._close(handle, stream)
                    handle = stream = None
                    self._buffer.clear()
                    self._resume.wait(timeout=0.5)
                    continue

                if stream is None:
                    try:
                        handle, stream = self._open_stream()
                        warned = False
                    except Exception as e:
                        if not warned:
                            print(f"[wake] cannot open mic (will keep trying): {e}")
                            warned = True
                        time.sleep(1.0)
                        continue

                try:
                    data = self._read_frame(stream)
                except Exception:
                    self._close(handle, stream)
                    handle = stream = None
                    continue
                if not data:
                    # EOF on the stream — tear down and reconnect.
                    self._close(handle, stream)
                    handle = stream = None
                    continue

                samples = np.frombuffer(data, dtype=np.int16)
                if samples.size == 0:
                    continue
                if self._active_rate != self._RATE:
                    try:
                        import audioop

                        pcm, _ = audioop.ratecv(
                            data, 2, 1, self._active_rate, self._RATE, None
                        )
                        samples = np.frombuffer(pcm, dtype=np.int16)
                    except Exception:
                        continue

                # Accumulate the rolling window (resampled to 16 kHz).
                self._buffer.extend(int(s) for s in samples)

                now = time.monotonic()
                if now - last_check < self.check_interval:
                    continue
                last_check = now

                # Only run Whisper when there is audible speech energy.
                buf = np.asarray(list(self._buffer), dtype=np.float32)
                if buf.size < self._RATE * 0.5:  # need at least 0.5 s of audio
                    continue
                rms = float(np.sqrt(np.mean(buf * buf)))
                if rms < self._MIN_RMS:
                    continue
                if not self.can_fire():
                    continue

                # Normalize to float32 mono 16 kHz in [-1, 1] for Whisper.
                audio = (buf / 32768.0).astype(np.float32)
                text = self._transcribe(audio)
                if not text or not self._contains_wake_word(text):
                    continue

                # Cooldown/refractory: ignore re-detections of the same word.
                if now - fired_at < max(self.cooldown, self.refractory):
                    continue

                fired_at = now
                self._buffer.clear()  # don't re-fire on the same utterance
                print(f"[wake] wake word {self.wake_word!r} heard -> {text!r}")
                try:
                    self.on_wake()
                except Exception as e:
                    print(f"[wake] callback error: {e}")
        finally:
            self._close(handle, stream)
