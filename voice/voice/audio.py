"""Audio utilities for recording and playback."""

import audioop
import contextlib
import io
import os
import sys
import threading
import wave
from pathlib import Path
from typing import Callable, Optional


@contextlib.contextmanager
def _suppress_alsa():
    """Redirect stderr to /dev/null temporarily to hide ALSA messages."""
    stderr_fd = sys.stderr.fileno() if hasattr(sys.stderr, "fileno") else None
    if stderr_fd is None:
        yield
        return
    saved = os.dup(stderr_fd)
    devnull = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(devnull, stderr_fd)
        yield
    finally:
        os.dup2(saved, stderr_fd)
        os.close(devnull)
        os.close(saved)

import numpy as np
import webrtcvad


def find_device(kind: str = "input", preferred=("pipewire", "pulse")):
    """Return the pyaudio device index for a preferred backend by name.

    On PipeWire/PulseAudio systems the pyaudio "default" device can fail to
    capture/play Bluetooth (HFP) streams while the dedicated "pipewire"/"pulse"
    devices work. Resolve by name (not a fixed index — indices vary per machine
    and boot). Returns None when no preferred device is found (use the default).

    kind: "input" or "output".
    """
    try:
        with _suppress_alsa():
            import pyaudio

            p = pyaudio.PyAudio()
    except Exception:
        return None
    try:
        ch_key = "maxInputChannels" if kind == "input" else "maxOutputChannels"
        for name in preferred:
            for i in range(p.get_device_count()):
                d = p.get_device_info_by_index(i)
                if d.get(ch_key, 0) > 0 and d.get("name", "").lower() == name:
                    return i
        return None
    except Exception:
        return None
    finally:
        try:
            p.terminate()
        except Exception:
            pass


class AudioRecorder:
    """Voice-activated recorder using webrtcvad.

    Processes 30ms frames through Google's VAD. Starts collecting audio
    when voice is detected, stops after a sustained silence.
    Cancellable mid-recording via cancel().
    """

    # webrtcvad requires one of these sample rates and frame durations
    _VALID_RATES = (8000, 16000, 32000, 48000)
    _FRAME_MS = 30  # 10, 20, or 30 ms

    def __init__(
        self,
        sample_rate: int = 16000,
        channels: int = 1,
        silence_timeout: float = 1.0,
        max_duration: float = 60.0,
        no_speech_timeout: float = 15.0,
        aggressiveness: int = 2,
        speech_confirm_ms: int = 180,
        input_device_index: Optional[int] = None,
        **_legacy,
    ):
        if sample_rate not in self._VALID_RATES:
            raise ValueError(f"sample_rate must be one of {self._VALID_RATES}")
        if channels != 1:
            raise ValueError("webrtcvad requires mono audio")

        self.sample_rate = sample_rate
        self.channels = channels
        self.silence_timeout = silence_timeout
        self.max_duration = max_duration
        self.no_speech_timeout = no_speech_timeout
        self.aggressiveness = aggressiveness
        self.speech_confirm_ms = speech_confirm_ms
        self.input_device_index = input_device_index

        # 30ms frame at 16kHz mono 16-bit = 480 samples = 960 bytes
        self.samples_per_frame = int(sample_rate * self._FRAME_MS / 1000)
        self.bytes_per_frame = self.samples_per_frame * 2
        self.frame_sec = self._FRAME_MS / 1000.0

        self.vad = webrtcvad.Vad(aggressiveness)
        self._cancel_event = threading.Event()

    def cancel(self) -> None:
        self._cancel_event.set()

    def record_until_silence(self) -> bytes:
        try:
            with _suppress_alsa():
                import pyaudio
        except ImportError:
            raise RuntimeError("pyaudio not installed")

        self._cancel_event.clear()

        with _suppress_alsa():
            p = pyaudio.PyAudio()
        stream = p.open(
            format=pyaudio.paInt16,
            channels=self.channels,
            rate=self.sample_rate,
            input=True,
            frames_per_buffer=self.samples_per_frame,
            input_device_index=self.input_device_index,
        )

        frames = []
        speaking = False
        voiced_streak_ms = 0
        silence_ms = 0
        wait_ms = 0
        speaking_ms = 0
        confirm_needed_ms = self.speech_confirm_ms
        silence_timeout_ms = int(self.silence_timeout * 1000)
        no_speech_timeout_ms = int(self.no_speech_timeout * 1000)
        max_duration_ms = int(self.max_duration * 1000)

        try:
            while True:
                if self._cancel_event.is_set():
                    print("[rec] cancelled")
                    return b""

                frame = stream.read(self.samples_per_frame, exception_on_overflow=False)
                if len(frame) != self.bytes_per_frame:
                    continue

                is_speech = self.vad.is_speech(frame, self.sample_rate)

                if not speaking:
                    if is_speech:
                        voiced_streak_ms += self._FRAME_MS
                        frames.append(frame)
                        if voiced_streak_ms >= confirm_needed_ms:
                            speaking = True
                            silence_ms = 0
                            print("[rec] speech detected")
                    else:
                        voiced_streak_ms = 0
                        frames.clear()

                    wait_ms += self._FRAME_MS
                    if wait_ms >= no_speech_timeout_ms:
                        print(f"[rec] no speech within {self.no_speech_timeout}s")
                        return b""
                else:
                    frames.append(frame)
                    speaking_ms += self._FRAME_MS

                    if is_speech:
                        silence_ms = 0
                    else:
                        silence_ms += self._FRAME_MS
                        if silence_ms >= silence_timeout_ms:
                            break

                    if speaking_ms >= max_duration_ms:
                        print("[rec] hit max_duration")
                        break
        finally:
            stream.stop_stream()
            stream.close()
            p.terminate()

        if not speaking or not frames:
            return b""

        return self._frames_to_wav(frames)

    def _frames_to_wav(self, frames) -> bytes:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            wf.writeframes(b"".join(frames))
        return buffer.getvalue()

    def save_to_file(self, wav_data: bytes, filepath: Path) -> None:
        filepath.write_bytes(wav_data)


class AudioPlayer:
    """Plays audio files or bytes. Cancellable mid-playback."""

    def __init__(self, output_device: int = None):
        self.output_device = output_device
        self._cancel_event = threading.Event()

    def cancel(self) -> None:
        self._cancel_event.set()

    def play_bytes(
        self,
        audio_bytes: bytes,
        on_level: Optional[Callable[[float], None]] = None,
    ) -> None:
        try:
            with _suppress_alsa():
                import pyaudio
        except ImportError:
            raise RuntimeError("pyaudio not installed")

        def _emit(level: float) -> None:
            if on_level is None:
                return
            try:
                on_level(level)
            except Exception:
                pass

        self._cancel_event.clear()
        buffer = io.BytesIO(audio_bytes)
        try:
            with wave.open(buffer, "rb") as wf:
                sampwidth = wf.getsampwidth()
                with _suppress_alsa():
                    p = pyaudio.PyAudio()
                stream = p.open(
                    format=p.get_format_from_width(sampwidth),
                    channels=wf.getnchannels(),
                    rate=wf.getframerate(),
                    output=True,
                    output_device_index=self.output_device,
                )

                data = wf.readframes(1024)
                while data:
                    if self._cancel_event.is_set():
                        break
                    stream.write(data)
                    if sampwidth == 2:
                        rms = audioop.rms(data, 2)
                        level = rms / 8000.0
                        if level > 2.0:
                            level = 2.0
                        _emit(level)
                    data = wf.readframes(1024)

                stream.stop_stream()
                stream.close()
                p.terminate()
        finally:
            _emit(0.0)

    def play_file(self, filepath: Path) -> None:
        data = Path(filepath).read_bytes()
        self.play_bytes(data)


class BeepGenerator:
    """Generates simple beep sounds for feedback."""

    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate

    def generate_beep(
        self,
        frequency: float = 880.0,
        duration: float = 0.1,
        volume: float = 0.5,
        fade: bool = False,
    ) -> bytes:
        n = int(self.sample_rate * duration)
        t = np.linspace(0, duration, n, False)
        tone = np.sin(frequency * t * 2 * np.pi)
        if fade:
            # Quarter-sine attack + decay envelope: gentle onset, no click.
            ramp = max(1, int(n * 0.25))
            env = np.ones(n)
            env[:ramp] = np.sin(np.linspace(0, np.pi / 2, ramp))
            env[-ramp:] = np.sin(np.linspace(np.pi / 2, 0, ramp))
            tone = tone * env
        audio = tone * volume
        audio = (audio * 32767).astype(np.int16)

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            wf.writeframes(audio.tobytes())

        return buffer.getvalue()

    def start_beep(self) -> bytes:
        return self.generate_beep(523, 0.08, 0.12, fade=True)

    def stop_beep(self) -> bytes:
        return self.generate_beep(392, 0.08, 0.12, fade=True)

    def error_beep(self) -> bytes:
        return self.generate_beep(220, 0.3, 0.5)
