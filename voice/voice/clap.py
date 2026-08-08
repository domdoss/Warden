"""Double-clap wake detector (Iron Man style).

Monitors an input device for two sharp amplitude transients (claps)
in quick succession and fires a callback. Runs in a background daemon
thread while Jarvis is idle. Callers pause it during conversation / TTS
playback to avoid mic contention and speaker feedback (see
``pause``/``resume``).

Two frame sources share the same transient-detection logic:

  * ``ClapDetector`` — the local mic via PyAudio (the laptop hologram).
  * ``SatelliteClapDetector`` — the Pi's HTTP ``/mic`` PCM stream, used
    when the voice app runs in satellite mode so a double-clap into the
    Pi's mic still wakes the desktop loop. It opens its own long-lived
    ``/mic`` connection and releases it on ``pause()`` so the recorder
    can take the mic exclusively during a turn (the same release pattern
    as the local detector). It never calls ``/cancel`` — closing the
    response is enough to tear down the Pi's ``pw-record``.
"""

from __future__ import annotations

import threading
import time
import urllib.request
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

    # ----- frame source (overridable) -----

    def _open_stream(self):
        """Open the input source. Returns an opaque (handle, stream) pair
        or raises on failure. ``handle`` is anything the closer needs."""
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

    def _read_frame(self, stream) -> bytes:
        """Read one frame (samples_per_frame int16 samples → samples_per_frame*2
        bytes). Raises on error; an empty/short read is allowed."""
        return stream.read(self.samples_per_frame, exception_on_overflow=False)

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

    # ----- worker -----

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
        handle = stream = None

        try:
            while not self._stop.is_set():
                # Honor pause by fully releasing the input device.
                if not self._resume.is_set():
                    self._close(handle, stream)
                    handle = stream = None
                    self._resume.wait(timeout=0.5)
                    continue

                if stream is None:
                    try:
                        handle, stream = self._open_stream()
                    except Exception as e:
                        print(f"[clap] cannot open mic: {e}")
                        time.sleep(1.0)
                        continue

                try:
                    data = self._read_frame(stream)
                except Exception:
                    self._close(handle, stream)
                    handle = stream = None
                    continue
                if not data:
                    # EOF on a network stream — tear down and reconnect.
                    self._close(handle, stream)
                    handle = stream = None
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
            self._close(handle, stream)


class SatelliteClapDetector(ClapDetector):
    """Double-clap detector that reads from the Pi's ``/mic`` PCM stream
    (16 kHz mono s16le, AU-framed) instead of a local PyAudio device.

    The stream is long-lived while idle and released on ``pause()`` so the
    satellite recorder can take the mic for a turn — the same release
    pattern as the local detector's PyAudio open/close. Closing the HTTP
    response is enough to tear down the Pi's ``pw-record`` (the server's
    ``write()`` raises BrokenPipe and kills the process); we deliberately
    do NOT call ``/cancel`` here, since that would kill whichever
    ``pw-record`` the server currently tracks — possibly the recorder's.
    """

    # The Pi always streams 16 kHz mono s16le (see satellite_server.py).
    _SAT_RATE = 16000

    # pw-record writes an AU container: 4-byte magic then a 20-byte header
    # whose first uint32 (after magic) is the total header length in bytes.
    _AU_MAGIC_BE = b"\x2e\x73\x6e\x64"   # ".snd"
    _AU_MAGIC_LE = b"\x64\x6e\x73\x2e"

    def __init__(
        self,
        host: str,
        port: int,
        on_double_clap: Callable[[], None],
        can_fire: Optional[Callable[[], bool]] = None,
        threshold: int = 9000,
        crest_factor: float = 4.0,
        min_gap: float = 0.12,
        max_gap: float = 0.8,
        refractory: float = 0.15,
        cooldown: float = 2.0,
    ):
        super().__init__(
            on_double_clap=on_double_clap,
            can_fire=can_fire,
            sample_rate=self._SAT_RATE,
            threshold=threshold,
            crest_factor=crest_factor,
            min_gap=min_gap,
            max_gap=max_gap,
            refractory=refractory,
            cooldown=cooldown,
        )
        self._base = f"http://{host}:{port}"
        self._timeout = 3600.0  # long-lived idle stream; reopen on timeout

    def _read_exact(self, resp, n: int) -> bytes:
        """Read exactly n bytes from the streaming response; b"" on EOF."""
        out = b""
        while len(out) < n:
            if self._stop.is_set():
                return b""
            chunk = resp.read(n - len(out))
            if not chunk:
                return b""
            out += chunk
        return out

    def _strip_au_header(self, resp) -> None:
        """Consume the AU header pw-record writes so the read cursor sits at
        the first PCM byte. If the stream isn't AU (already raw PCM), there's
        no rewind — treat the whole stream as raw PCM."""
        magic = self._read_exact(resp, 4)
        if magic not in (self._AU_MAGIC_BE, self._AU_MAGIC_LE):
            return
        rest = self._read_exact(resp, 20)
        if len(rest) < 20:
            return
        import struct
        be = magic == self._AU_MAGIC_BE
        data_offset = struct.unpack(">I" if be else "<I", rest[0:4])[0]
        # data_offset is the total header length (incl. the 4 magic bytes).
        # We've already read 24; skip any extra header bytes.
        extra = max(0, data_offset - 24)
        if extra:
            self._read_exact(resp, extra)

    def _open_stream(self):
        req = urllib.request.Request(self._base + "/mic", method="GET")
        resp = urllib.request.urlopen(req, timeout=self._timeout)
        self._strip_au_header(resp)
        # handle == stream == resp: the closer just closes the response.
        return resp, resp

    def _read_frame(self, stream) -> bytes:
        # One frame = samples_per_frame int16 samples = samples_per_frame*2 bytes.
        n = self.samples_per_frame * 2
        data = self._read_exact(stream, n)
        if len(data) < n:
            return b""  # EOF → caller closes & reopens
        return data

    def _close(self, handle, stream) -> None:
        # handle and stream are the same urllib response.
        if stream is not None:
            try:
                stream.close()
            except Exception:
                pass