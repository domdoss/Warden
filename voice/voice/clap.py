"""Double-clap wake detector (Iron Man style).

Monitors the default input device for two sharp amplitude transients (claps)
in quick succession and fires a callback. Runs in a background daemon thread
while Jarvis is idle. Callers pause it during conversation / TTS playback to
avoid mic contention and speaker feedback (see ``pause``/``resume``).
"""

from __future__ import annotations

import threading
import time
from typing import Callable, Optional

import numpy as np

from voice.audio import _suppress_alsa


class ClapDetector:
    _FRAME_MS = 20

    def __init__(
        self,
        on_double_clap: Callable[[], None],
        can_fire: Optional[Callable[[], bool]] = None,
        sample_rate: int = 16000,
        threshold: int = 9000,    # int16 peak amplitude that counts as a clap onset
        crest_factor: float = 4.0,  # min peak/RMS ratio — a clap is a sharp transient
        min_gap: float = 0.12,    # min seconds between the two claps
        max_gap: float = 0.8,     # max seconds between the two claps
        refractory: float = 0.15,  # ignore window right after a clap onset
        cooldown: float = 2.0,    # quiet period after a successful double-clap
        input_device: Optional[int] = None,
    ):
        self.on_double_clap = on_double_clap
        self.can_fire = can_fire or (lambda: True)
        self.sample_rate = sample_rate
        self.threshold = threshold
        self.crest_factor = crest_factor
        self.min_gap = min_gap
        self.max_gap = max_gap
        self.refractory = refractory
        self.cooldown = cooldown
        self.input_device = input_device

        self.samples_per_frame = int(sample_rate * self._FRAME_MS / 1000)
        self._stop = threading.Event()
        self._resume = threading.Event()
        self._resume.set()
        self._thread: Optional[threading.Thread] = None

    # ----- lifecycle -----

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="clap-detector", daemon=True
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

    # ----- worker -----

    def _open_stream(self):
        with _suppress_alsa():
            import pyaudio

            p = pyaudio.PyAudio()
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=self.sample_rate,
            input=True,
            frames_per_buffer=self.samples_per_frame,
            input_device_index=self.input_device,
        )
        return p, stream

    def _close(self, p, stream) -> None:
        if stream is not None:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:
                pass
        if p is not None:
            try:
                p.terminate()
            except Exception:
                pass

    def _run(self) -> None:
        try:
            import pyaudio  # noqa: F401
        except ImportError:
            print("[clap] pyaudio not installed; clap detection disabled")
            return

        last_clap = 0.0   # timestamp of the first clap of a potential pair
        last_onset = 0.0  # for refractory debounce
        fired_at = 0.0    # for cooldown
        in_loud = False
        p = stream = None

        try:
            while not self._stop.is_set():
                # Honor pause by fully releasing the input device.
                if not self._resume.is_set():
                    self._close(p, stream)
                    p = stream = None
                    self._resume.wait(timeout=0.5)
                    continue

                if stream is None:
                    try:
                        p, stream = self._open_stream()
                    except Exception as e:
                        print(f"[clap] cannot open mic: {e}")
                        time.sleep(1.0)
                        continue

                try:
                    data = stream.read(
                        self.samples_per_frame, exception_on_overflow=False
                    )
                except Exception:
                    self._close(p, stream)
                    p = stream = None
                    continue

                samples = np.frombuffer(data, dtype=np.int16)
                if samples.size == 0:
                    continue
                # AC-couple: remove the DC offset before measuring the transient
                # peak. Some mics (e.g. AMD ACP digital-mic arrays) carry a large
                # DC bias (~6000 on int16) — raw |peak| would sit at that bias and
                # the loudness latch below would never reset, so only the first
                # clap is ever seen. Subtracting the frame mean makes `peak`
                # reflect the actual sound. On a bias-free mic mean≈0, so this is
                # a no-op and existing thresholds still hold.
                centered = samples.astype(np.float32) - float(samples.mean())
                peak = int(np.abs(centered).max())
                # Crest factor (peak / RMS): a clap is impulsive so its peak
                # towers over the frame's RMS, while speech/music/steady noise
                # stay much flatter. Gating on this rejects loud-but-not-sharp
                # sounds that clear the raw amplitude threshold.
                rms = float(np.sqrt(np.mean(np.square(centered)))) or 1.0
                crest = peak / rms
                now = time.monotonic()

                # Rising-edge onset: loud AND sharp = one clap candidate.
                if peak >= self.threshold and crest >= self.crest_factor and not in_loud:
                    in_loud = True
                    if now - last_onset < self.refractory:
                        continue
                    last_onset = now

                    if now - fired_at < self.cooldown:
                        last_clap = 0.0
                        continue

                    if last_clap and self.min_gap <= (now - last_clap) <= self.max_gap:
                        last_clap = 0.0
                        if self.can_fire():
                            fired_at = now
                            try:
                                self.on_double_clap()
                            except Exception as e:
                                print(f"[clap] callback error: {e}")
                    else:
                        last_clap = now
                elif peak < self.threshold * 0.6:
                    in_loud = False

                # Drop a stale first clap that never got a partner.
                if last_clap and (now - last_clap) > self.max_gap:
                    last_clap = 0.0
        finally:
            self._close(p, stream)
