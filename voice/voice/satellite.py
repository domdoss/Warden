"""Satellite audio backend — network mic/speaker via the Pi relay.

Drop-in replacements for the methods of ``AudioRecorder``/``AudioPlayer`` that
``main.py`` actually calls, so the turn loop is unchanged in satellite mode:

    SatelliteAudioRecorder.record_until_silence() -> bytes   # WAV
    SatelliteAudioRecorder.cancel()
    SatelliteAudioPlayer.play_bytes(bytes, on_level=None)
    SatelliteAudioPlayer.cancel()

The Pi is a dumb pipe (see satellite/satellite_server.py): it streams raw 16 kHz
mono s16le PCM from ``pw-record`` and plays back WAVs via ``pw-play``. VAD
runs on the desktop (where webrtcvad is available), reading 30 ms frames from
the streamed PCM — same VAD logic as ``voice.audio.AudioRecorder``.

All control I/O is HTTP (stdlib ``urllib``). No new dependencies.
"""

from __future__ import annotations

import audioop
import io
import threading
import urllib.error
import urllib.parse
import urllib.request
import wave
from typing import Callable, Optional


class _SatClient:
    def __init__(self, host: str, port: int, timeout: float = 90.0):
        self.base = f"http://{host}:{port}"
        self._timeout = timeout

    def _url(self, path: str, query: Optional[dict] = None) -> str:
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(
                {k: v for k, v in query.items() if v is not None})
        return url

    def get_response(self, path: str, query: Optional[dict] = None,
                     timeout: Optional[float] = None):
        """Return an open streaming HTTPResponse (caller closes it)."""
        req = urllib.request.Request(self._url(path, query), method="GET")
        return urllib.request.urlopen(req, timeout=timeout or self._timeout)

    def post_bytes(self, path: str, body: bytes, query: Optional[dict] = None,
                   headers: Optional[dict] = None,
                   timeout: Optional[float] = None) -> tuple[int, bytes]:
        h = dict(headers or {})
        if body is not None and "Content-Type" not in h:
            h["Content-Type"] = "application/octet-stream"
        req = urllib.request.Request(self._url(path, query), data=body,
                                     headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=timeout or self._timeout) as r:
            return r.status, r.read()

    def post(self, path: str, query: Optional[dict] = None,
             timeout: Optional[float] = None) -> int:
        req = urllib.request.Request(self._url(path, query), data=b"",
                                     method="POST")
        with urllib.request.urlopen(req, timeout=timeout or self._timeout) as r:
            r.read()
            return r.status


class SatelliteAudioRecorder:
    """Mic on the Pi. ``record_until_silence()`` opens the Pi's raw-PCM stream
    and runs webrtcvad locally to delimit speech, then returns a 16 kHz WAV.
    ``cancel()`` closes the stream and tells the Pi to kill pw-record."""

    # webrtcvad requires one of these rates and frame durations.
    _FRAME_MS = 30
    _SAMPLE_RATE = 16000  # the Pi streams at 16 kHz

    def __init__(self, host: str, port: int, silence_timeout: float = 0.6,
                 max_duration: float = 30.0, no_speech_timeout: float = 15.0,
                 aggressiveness: int = 2, speech_confirm_ms: int = 180,
                 **_ignored):
        import webrtcvad
        self._client = _SatClient(host, port)
        self.silence_timeout = silence_timeout
        self.max_duration = max_duration
        self.no_speech_timeout = no_speech_timeout
        self.aggressiveness = aggressiveness
        self.speech_confirm_ms = speech_confirm_ms
        self._vad = webrtcvad.Vad(aggressiveness)
        self._bytes_per_frame = int(self._SAMPLE_RATE * self._FRAME_MS / 1000) * 2
        self._cancel_event = threading.Event()
        self._response = None
        self._lock = threading.Lock()

    def cancel(self) -> None:
        self._cancel_event.set()
        with self._lock:
            resp = self._response
        if resp is not None:
            try:
                resp.close()
            except Exception:
                pass
        try:
            self._client.post("/cancel", timeout=5.0)
        except Exception as e:
            print(f"[satellite] cancel failed: {e}")

    def _read_exact(self, resp, n: int) -> bytes:
        """Read exactly n bytes from the streaming response; b"" on EOF."""
        out = b""
        while len(out) < n:
            if self._cancel_event.is_set():
                return b""
            chunk = resp.read(n - len(out))
            if not chunk:
                return b""
            out += chunk
        return out

    # pw-record writes an AU file to stdout: a 24-byte header (magic ".snd")
    # then raw 16-bit PCM. Strip it so VAD sees aligned 30 ms frames. We accept
    # both byte orders (pw-record emits a little-endian magic on PipeWire).
    _AU_MAGIC_BE = b"\x2e\x73\x6e\x64"   # ".snd"
    _AU_MAGIC_LE = b"\x64\x6e\x73\x2e"

    def _strip_au_header(self, resp) -> None:
        """Consume the AU header from the stream so the read cursor sits at the
        first PCM byte. If the stream isn't AU (already raw PCM), rewinding is
        impossible, so this only handles the AU case — the Pi always emits AU."""
        magic = self._read_exact(resp, 4)
        if magic not in (self._AU_MAGIC_BE, self._AU_MAGIC_LE):
            return  # not AU; nothing we can rewind — treat stream as raw PCM
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

    def record_until_silence(self) -> bytes:
        self._cancel_event.clear()
        try:
            resp = self._client.get_response(
                "/mic", timeout=max(30.0, self.max_duration) + 10.0)
        except Exception as e:
            print(f"[satellite] mic stream failed: {e}")
            return b""
        with self._lock:
            self._response = resp

        frames: list[bytes] = []
        speaking = False
        voiced_streak_ms = 0
        silence_ms = 0
        wait_ms = 0
        speaking_ms = 0
        frame_ms = self._FRAME_MS
        confirm_needed_ms = self.speech_confirm_ms
        silence_timeout_ms = int(self.silence_timeout * 1000)
        no_speech_timeout_ms = int(self.no_speech_timeout * 1000)
        max_duration_ms = int(self.max_duration * 1000)

        try:
            self._strip_au_header(resp)
            while True:
                if self._cancel_event.is_set():
                    print("[sat-rec] cancelled")
                    return b""
                frame = self._read_exact(resp, self._bytes_per_frame)
                if not frame or len(frame) != self._bytes_per_frame:
                    if self._cancel_event.is_set():
                        return b""
                    print("[sat-rec] mic stream ended")
                    break

                try:
                    is_speech = self._vad.is_speech(frame, self._SAMPLE_RATE)
                except Exception:
                    is_speech = False

                if not speaking:
                    if is_speech:
                        voiced_streak_ms += frame_ms
                        frames.append(frame)
                        if voiced_streak_ms >= confirm_needed_ms:
                            speaking = True
                            silence_ms = 0
                            print("[sat-rec] speech detected")
                    else:
                        voiced_streak_ms = 0
                        frames.clear()
                    wait_ms += frame_ms
                    if wait_ms >= no_speech_timeout_ms:
                        print(f"[sat-rec] no speech within {self.no_speech_timeout}s")
                        return b""
                else:
                    frames.append(frame)
                    speaking_ms += frame_ms
                    if is_speech:
                        silence_ms = 0
                    else:
                        silence_ms += frame_ms
                        if silence_ms >= silence_timeout_ms:
                            break
                    if speaking_ms >= max_duration_ms:
                        print("[sat-rec] hit max_duration")
                        break
        finally:
            try:
                resp.close()
            except Exception:
                pass
            with self._lock:
                if self._response is resp:
                    self._response = None

        if not speaking or not frames:
            return b""
        return self._frames_to_wav(frames)

    def _frames_to_wav(self, frames: list[bytes]) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self._SAMPLE_RATE)
            wf.writeframes(b"".join(frames))
        return buf.getvalue()


class SatelliteAudioPlayer:
    """Speaker on the Pi. ``play_bytes()`` POSTs the WAV; ``on_level`` is driven
    from the WAV's own RMS envelope on a timer so the hologram still pulses
    even though the audio plays remotely."""

    def __init__(self, host: str, port: int, **_ignored):
        self._client = _SatClient(host, port)
        self._cancel_event = threading.Event()
        self._level_thread: Optional[threading.Thread] = None

    def cancel(self) -> None:
        self._cancel_event.set()
        try:
            self._client.post("/cancel", timeout=5.0)
        except Exception as e:
            print(f"[satellite] cancel failed: {e}")

    def play_bytes(self, audio_bytes: bytes,
                   on_level: Optional[Callable[[float], None]] = None) -> None:
        if not audio_bytes:
            return
        self._cancel_event.clear()

        if on_level is not None:
            self._level_thread = threading.Thread(
                target=self._drive_levels, args=(audio_bytes, on_level),
                daemon=True,
            )
            self._level_thread.start()

        try:
            self._client.post_bytes("/play", body=audio_bytes,
                                    headers={"Content-Type": "audio/wav"},
                                    timeout=60.0)
        except Exception as e:
            print(f"[satellite] play failed: {e}")
        finally:
            self._cancel_event.set()
            if self._level_thread is not None:
                self._level_thread.join(timeout=1.0)
                self._level_thread = None
            if on_level is not None:
                try:
                    on_level(0.0)
                except Exception:
                    pass

    def _drive_levels(self, audio_bytes: bytes,
                      on_level: Callable[[float], None]) -> None:
        """Replay the WAV's RMS envelope at ~30Hz so the hologram pulses in sync
        with the remote playback. Stops on cancel or when the envelope ends."""
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
                sampwidth = wf.getsampwidth()
                channels = wf.getnchannels()
                rate = wf.getframerate()
        except Exception:
            return
        if sampwidth != 2:
            return
        chunk_frames = max(1, int(rate * 0.03))  # 30ms
        frame_bytes = chunk_frames * sampwidth * channels
        period = chunk_frames / rate
        try:
            remaining = audio_bytes[44:]  # skip the 44-byte canonical header
        except Exception:
            return
        while remaining and not self._cancel_event.is_set():
            chunk = remaining[:frame_bytes]
            remaining = remaining[frame_bytes:]
            if len(chunk) < frame_bytes:
                break
            try:
                rms = audioop.rms(chunk, sampwidth)
            except Exception:
                rms = 0
            level = min(2.0, rms / 8000.0)
            try:
                on_level(level)
            except Exception:
                pass
            self._cancel_event.wait(period)
        try:
            on_level(0.0)
        except Exception:
            pass