#!/usr/bin/env python3
"""Jarvis — Dockbox thin-client entry point.

Architecture:
- Main thread: pywebview UI (Jarvis HTML window) + tkinter companion windows.
- Background thread: single asyncio event loop.
- DockboxBridge owns the HTTP/SSE connection to the server.
- Local Whisper transcribes voice; transcribed text is sent to /api/messages.
- Agent reply chunks arrive via SSE and are spoken by Orpheus-TTS.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import functools
import json
import logging
import os
import signal
import sys
import threading
import time
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

# When packaged (PyInstaller --windowed), there is no console and any accidental
# write to stdout/stderr on Windows can raise. Library warnings/debug logs are
# pure noise for end users — but we still want a record when the app crashes
# silently. Redirect stdout+stderr to a log file under %APPDATA%\Jarvis so the
# user (and us) can see what went wrong. In source / dev mode (not frozen) we
# leave output intact.
if getattr(sys, "frozen", False):
    try:
        _appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
        _log_dir = os.path.join(_appdata, "Jarvis")
        os.makedirs(_log_dir, exist_ok=True)
        _log_path = os.path.join(_log_dir, "jarvis.log")
        _log_fh = open(_log_path, "a", encoding="utf-8", buffering=1)
        sys.stdout = _log_fh
        sys.stderr = _log_fh
        import datetime as _dt
        print(f"\n=== Jarvis start {_dt.datetime.now().isoformat()} ===")
    except Exception:
        pass
    warnings.filterwarnings("ignore")
    os.environ.setdefault("PYTHONWARNINGS", "ignore")
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    logging.disable(logging.CRITICAL)

from core.assistant import DockboxBridge
from core.config import Config
from core.session_store import SessionStore
from ui.jarvis_window import JarvisWindow
from voice.audio import AudioPlayer, AudioRecorder, BeepGenerator, find_device
from voice.capture import capture
from voice.clap import ClapDetector, SatelliteClapDetector
from voice.satellite import SatelliteAudioPlayer, SatelliteAudioRecorder
from voice.stt import STT
from voice.tts import TTS

import re as _re

# Emoji, dingbats, pictographs, symbols and their ZWJ/variation-selector glue.
# Stripped before TTS so the voice doesn't read emoji names aloud.
_EMOJI_RE = _re.compile(
    "["
    "\U0001F300-\U0001FAFF"   # symbols & pictographs (incl. supplemental, ext-A)
    "\U0001F1E6-\U0001F1FF"   # regional indicators (flags)
    "\U00002600-\U000027BF"   # misc symbols + dingbats (incl. ✅ ❌ ⚠)
    "\U00002190-\U000021FF"   # arrows
    "\U00002B00-\U00002BFF"   # misc symbols & arrows
    "\U0000FE00-\U0000FE0F"   # variation selectors
    "\U0000200D"              # zero-width joiner
    "\U000024C2\U00002122\U00002139\U00003030\U0000303D"
    "]+",
    flags=_re.UNICODE,
)


class ControlServer:
    """Tiny HTTP listener so a remote Pi button can trigger a Jarvis turn.

    Mirrors satellite/satellite_server.py's ThreadingHTTPServer skeleton (silenced
    logging, configurable bind). Binds 0.0.0.0 on a port distinct from the
    satellite's 8766 (default 8767). All endpoint handlers are thread-safe: they
    either read atomic-ish flags or schedule work onto the main asyncio loop via
    ``asyncio.run_coroutine_threadsafe`` — no pywebview/UI code is called from
    the HTTP thread.

    Endpoints:
        POST /press   → trigger a turn. Calls ``app._on_button_press()`` which
                        schedules ``_handle_interaction`` on the main loop. That
                        handler already implements barge-in: if Jarvis is
                        mid-conversation, the press interrupts (stops playback,
                        aborts in-flight request/recording) and starts a new
                        turn — exactly like clicking the on-screen button or
                        pressing F9.
        POST /cancel  → stop any in-flight recording/playback (external
                        barge-in). Calls recorder/player.cancel() directly
                        (thread-safe) and schedules a bridge stop + turn abort
                        on the main loop.
        GET  /status  → {"ok": true, "remote": <bool>, "busy": <bool>}
    """

    def __init__(self, app: "JarvisApp", host: str = "0.0.0.0", port: int = 8767):
        self.app = app
        self.host = host
        self.port = port
        self._httpd: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> bool:
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence default access logging
                pass

            def _send_json(self, status: int, payload: dict) -> None:
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/status":
                    app = server.app
                    busy = bool(app._conversation_active or app._is_speaking)
                    self._send_json(200, {
                        "ok": True,
                        "remote": app._is_satellite,
                        "mic": "remote" if app._mic_host else "local",
                        "speaker": "remote" if app._speaker_host else "local",
                        "busy": busy,
                    })
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):
                if self.path == "/press":
                    server.app._on_button_press()
                    self._send_json(200, {"ok": True})
                elif self.path == "/release":
                    server.app._on_button_release()
                    self._send_json(200, {"ok": True})
                elif self.path == "/cancel":
                    server.app._external_cancel()
                    self._send_json(200, {"ok": True})
                else:
                    self.send_response(404)
                    self.end_headers()

        try:
            self._httpd = ThreadingHTTPServer((self.host, self.port), Handler)
        except OSError as e:
            print(f"[jarvis] control server could not bind {self.host}:{self.port} ({e})")
            return False
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        print(f"[jarvis] control server on http://{self.host}:{self.port}")
        return True

    def stop(self) -> None:
        if self._httpd is not None:
            try:
                self._httpd.shutdown()
                self._httpd.server_close()
            except Exception:
                pass
        self._httpd = None
        self._thread = None


class JarvisApp:
    def __init__(self, mic_host: Optional[str] = None,
                 speaker_host: Optional[str] = None,
                 control_port: int = 8767):
        self.config = Config()
        self.bridge = DockboxBridge(config=self.config)
        self._control_port = control_port

        # Mic and speaker are chosen independently. Each is either local (None)
        # or a remote Pi running the dumb audio relay
        # (satellite/satellite_server.py, started via run.sh --satellite). The
        # app always does STT/TTS/UI locally; only the audio I/O for that side
        # is piped to/from the remote unit. Recorder, clap detector, and
        # push-to-talk follow the MIC choice (they're all mic-side); the player
        # follows the SPEAKER choice.
        self._mic_host = mic_host
        self._speaker_host = speaker_host
        # Back-compat: "remote" = any side remote (used by /status), and the
        # panel's _get_satellite_host reads _satellite_host (set below to the
        # live remote host for display).
        self._is_satellite = bool(mic_host or speaker_host)
        self._satellite_host = None
        self._satellite_port = None

        voice_cfg = self.config.voice
        audio_cfg = self.config.audio
        sat_cfg = self.config.get("satellite", {}) or {}
        sat_port = int(sat_cfg.get("port", 8766))

        # ── mic side ───────────────────────────────────────────────────────
        self._input_device = None
        self._sat_mic_host = None
        self._sat_mic_port = None
        if mic_host:
            print(f"[jarvis] remote mic via {mic_host}:{sat_port}")
            self._sat_mic_host = mic_host
            self._sat_mic_port = sat_port
            self._satellite_host = mic_host
            self._satellite_port = sat_port
            self.audio_recorder = SatelliteAudioRecorder(
                host=mic_host, port=sat_port,
                silence_timeout=voice_cfg.get("silence_timeout", 1.0),
                max_duration=voice_cfg.get("max_recording_seconds", 60.0),
                aggressiveness=voice_cfg.get("vad_aggressiveness", 2),
            )
            # Push-to-talk on the Pi: hold the button to record the whole hold
            # (no VAD), release to send — one turn per press, no auto-listen
            # loop. false = VAD auto-stop (for a buttonless remote mic). Only the
            # mic side decides this (the Pi has a button); the local mic always
            # uses VAD + clap + the listen loop.
            self._push_to_talk = bool(sat_cfg.get("push_to_talk", True))
        else:
            # Resolve audio devices. pyaudio's "default" device can't capture/play
            # Bluetooth (HFP) on PipeWire — the "pipewire"/"pulse" devices can. Honor
            # an explicit config index, else auto-detect by backend name.
            in_dev = audio_cfg.get("input_device")
            if in_dev is None:
                in_dev = find_device("input")
            self._input_device = in_dev
            print(f"[jarvis] local mic device={in_dev}")
            self.audio_recorder = AudioRecorder(
                sample_rate=voice_cfg.get("sample_rate", 48000),
                channels=voice_cfg.get("channels", 1),
                silence_timeout=voice_cfg.get("silence_timeout", 1.0),
                max_duration=voice_cfg.get("max_recording_seconds", 60.0),
                aggressiveness=voice_cfg.get("vad_aggressiveness", 2),
                input_device_index=in_dev,
            )
            self._push_to_talk = False

        # ── speaker side ───────────────────────────────────────────────────
        self._sat_speaker_host = None
        self._sat_speaker_port = None
        if speaker_host:
            print(f"[jarvis] remote speaker via {speaker_host}:{sat_port}")
            self._sat_speaker_host = speaker_host
            self._sat_speaker_port = sat_port
            # If the mic is local, expose the speaker's host for the panel.
            if self._satellite_host is None:
                self._satellite_host = speaker_host
                self._satellite_port = sat_port
            self.audio_player = SatelliteAudioPlayer(host=speaker_host, port=sat_port)
        else:
            out_dev = audio_cfg.get("playback_device")
            if out_dev is None:
                out_dev = find_device("output")
            print(f"[jarvis] local speaker device={out_dev}")
            self.audio_player = AudioPlayer(
                output_device=out_dev,
                sample_rate=voice_cfg.get("sample_rate", 48000),
            )

        # Beeps follow the speaker (they're user feedback, heard where the
        # audio plays). Routed via self.audio_player.play_bytes, so mixed modes
        # Just Work.
        self.beep_generator = BeepGenerator(
            sample_rate=voice_cfg.get("sample_rate", 48000)
        )
        # STT is CPU-bound by default. On the Radeon VII (ROCm), torch's HIP
        # backend exposes itself as torch.cuda.*, so STT._pick_device() would
        # otherwise grab the GPU — and loading Whisper on the same GPU that
        # Kokoro TTS already occupies segfaults the process. Whisper "small" on
        # CPU is fast enough for short utterances and keeps the GPU free for TTS.
        # Override with voice.stt_device: "cuda" if you want GPU STT back.
        self.stt = STT(
            model=voice_cfg.get("whisper_model", "base"),
            device=voice_cfg.get("stt_device", "cpu"),
        )
        self.tts = TTS(
            engine=voice_cfg.get("tts_engine", "kokoro"),
            voice=voice_cfg.get("tts_voice", None),
            speed=float(voice_cfg.get("tts_speed", 1.0)),
            device=voice_cfg.get("tts_device", None),
        )
        # Warm the TTS model now so the first user turn doesn't pay load cost.
        if hasattr(self.tts._impl, "warmup"):
            self.tts._impl.warmup()

        self.window: Optional[JarvisWindow] = None
        self.clap_detector: Optional[ClapDetector] = None
        # True while a clap-initiated interaction is running in push-to-talk
        # mode. Push-to-talk normally records on hold (no VAD, button release
        # ends the turn), but a clap wake has no button to release — so a
        # clap-initiated turn uses VAD recording + the auto-listen loop, just
        # like the local hologram. Cleared when the interaction ends.
        self._clap_turn = False

        self.running = False
        self._conversation_active = False
        self._stop_requested = False
        self._is_speaking = False
        # Serializes all _speak() calls so the app never POSTs two WAVs to the
        # Pi at once. Without this, the bootstrap "Assistant online." _speak and
        # the chat _tts_worker _speak run as independent coroutines and can hit
        # the Pi's /play concurrently — and the Pi's satellite_server has no
        # play mutex, so two pw-play overlap = "3 people talking over each
        # other / cut up" garble. One play at a time = clean (like the desktop
        # pw-play test). Barge-in still cancels: _external_cancel POSTs /cancel
        # to the Pi, which kills the in-flight pw-play and releases the lock.
        self._speak_lock = asyncio.Lock()
        # When Jarvis last finished speaking. The clap detector ignores claps
        # for _SPEAK_COOLDOWN seconds after, so Jarvis's own voice/echo (or a
        # trailing word) can't wake it and start a self-triggered loop.
        self._last_spoke_at = 0.0
        self._record_task: Optional[asyncio.Task] = None
        self._send_task: Optional[asyncio.Task] = None
        # Push-to-talk (satellite only): the in-flight hold-turn task, tracked so a
        # barge-in press can abort it and start a fresh recording cleanly.
        self._hold_turn_task: Optional[asyncio.Task] = None

        # TTS pipeline: SSE chunks accumulate here; a worker speaks them in order.
        self._tts_queue: "asyncio.Queue[Optional[str]]" = asyncio.Queue()
        self._tts_worker: Optional[asyncio.Task] = None
        # Signalled when the server's SSE turn_end has been consumed and the final
        # TTS buffer has finished speaking. _single_turn awaits this before looping.
        self._turn_done: asyncio.Event = asyncio.Event()
        self._turn_done.set()
        # Set at turn end when Jarvis's reply was a farewell/sign-off, so the
        # conversation loop stops after speaking it.
        self._end_conversation: bool = False

        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._loop_thread: Optional[threading.Thread] = None
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        self._control_server: Optional[ControlServer] = None

    # ----- audio helpers (run blocking I/O in executor) -----

    def _play_beep(self, beep_func):
        try:
            self.audio_player.play_bytes(beep_func())
        except Exception:
            pass

    async def _play_beep_async(self, beep_func):
        await asyncio.get_running_loop().run_in_executor(None, self._play_beep, beep_func)

    async def _play_audio_async(self, audio_bytes: bytes):
        if not audio_bytes:
            return
        await asyncio.get_running_loop().run_in_executor(
            None,
            functools.partial(
                self.audio_player.play_bytes, audio_bytes, on_level=self._on_audio_level
            ),
        )

    def _on_audio_level(self, level: float) -> None:
        if self.window is not None:
            try:
                self.window.set_audio_level(level)
            except Exception:
                pass

    async def _wait_until_quiet(self) -> None:
        """Block until Jarvis has nothing left to output, so the mic never
        opens while he's still speaking and records himself.

        Holds until: not mid-utterance, no TTS chunks still queued (covers the
        gap between a reply being enqueued and the worker starting to speak it),
        and the post-speech echo cooldown has elapsed.
        """
        while True:
            if self._is_speaking or not self._tts_queue.empty():
                await asyncio.sleep(0.05)
                continue
            cooldown = self._SPEAK_COOLDOWN - (time.monotonic() - self._last_spoke_at)
            if cooldown > 0:
                await asyncio.sleep(cooldown)
                continue
            return

    async def _record_audio_async(self) -> bytes:
        if self._push_to_talk and not self._clap_turn:
            # Hold-to-record (satellite/Pi): record the whole hold until the
            # button is released; no VAD. Falls back to VAD if the recorder
            # somehow lacks record_held (it shouldn't in satellite mode).
            # A clap-initiated turn (self._clap_turn) has no button to release,
            # so it falls through to VAD recording below.
            fn = getattr(self.audio_recorder, "record_held", None)
            if fn is None:
                fn = self.audio_recorder.record_until_silence
        else:
            fn = self.audio_recorder.record_until_silence
        return await asyncio.get_running_loop().run_in_executor(None, fn)

    async def _transcribe_async(self, audio_data: bytes) -> str:
        return await asyncio.get_running_loop().run_in_executor(
            None, self.stt.transcribe, audio_data
        )

    async def _synthesize_async(self, text: str) -> bytes:
        return await asyncio.get_running_loop().run_in_executor(
            None, self.tts.synthesize, text
        )

    @staticmethod
    def _is_signoff(reply: str) -> bool:
        """True when Jarvis's reply bids the user farewell, so the conversation
        loop can stop. Matched on Jarvis's own (clean, grammatical) output —
        not the user's noisy transcription."""
        t = reply.lower()
        cues = (
            "goodbye", "good bye", "bye for now", "farewell",
            "take care", "good night", "goodnight",
            "have a great", "have a good", "have a wonderful", "have a nice",
            "talk to you later", "talk to you soon", "talk soon",
            "see you later", "see you soon", "see you next", "until next time",
            "feel free to reach out", "reach out whenever", "reach out if you",
            "i'm here if you", "im here if you", "here if you need",
            "here whenever you need", "anything else later", "need anything later",
            "signing off", "rest well", "enjoy the rest of your",
        )
        return any(c in t for c in cues)

    @staticmethod
    def _user_ended(text: str) -> bool:
        """True when the user clearly signals they're done ("that's it for now",
        "that's all", "goodbye"). Jarvis doesn't always reply with a farewell to
        these, so catch the user's own close directly. Word-boundary matched on
        a punctuation-stripped copy so "that's it." or "okay, that's it" still
        hit."""
        import re
        cleaned = re.sub(r"[^a-z']+", " ", text.lower().replace("’", "'")).strip()
        # Bare single-word commands only count as the whole utterance, so
        # "stop" ends the chat but "stop the timer" doesn't.
        if cleaned in ("stop", "exit", "goodbye", "bye"):
            return True
        padded = f" {cleaned} "
        phrases = (
            "that's it", "thats it", "that's all", "thats all",
            "that'll be all", "that will be all", "that is all",
            "i'm done", "im done", "we're done", "we are done", "all done",
            "nothing else", "no thanks", "no thank you",
            "good night", "goodnight",
            "i'm good", "im good", "we're good",
            "that's everything", "thats everything",
        )
        return any(f" {p} " in padded for p in phrases)

    # ----- vision intent -----
    # Screen-capture phrases (the monitor) vs camera phrases (the room/webcam).
    _SCREEN_PHRASES = (
        "what's on my screen", "what is on my screen", "what's on the screen",
        "what's on screen", "look at my screen", "look at the screen",
        "describe my screen", "take a screenshot",
    )
    _CAMERA_PHRASES = (
        "what do you see", "what can you see", "describe the room",
        "describe what you see", "look at this", "what am i looking at",
        "can you see",
    )

    @classmethod
    def _vision_source(cls, text: str) -> Optional[str]:
        """'screen', 'webcam', or None. An explicit 'screen' mention wins;
        otherwise general "what do you see" routes to the webcam."""
        lowered = text.lower()
        if any(p in lowered for p in cls._SCREEN_PHRASES):
            return "screen"
        if any(p in lowered for p in cls._CAMERA_PHRASES):
            return "webcam"
        return None

    # ----- conversation turn -----

    async def _single_turn(self) -> bool:
        try:
            # Keep the mic closed until Jarvis is done outputting audio (still
            # speaking, or a reply queued but not yet spoken) and the echo tail
            # has died, so the recorder can't capture his own voice and keep the
            # loop self-feeding. The clap detector honors the same cooldown via
            # _last_spoke_at, but it's paused mid-conversation, so the
            # in-conversation recorder has to apply this itself.
            if not self._push_to_talk or self._clap_turn:
                await self._wait_until_quiet()
            self._update_ui_state("listening")
            await self._play_beep_async(self.beep_generator.start_beep)

            audio_data = await self._record_audio_async()
            if self._stop_requested or not audio_data:
                return False

            await self._play_beep_async(self.beep_generator.stop_beep)
            self._update_ui_state("processing")

            text = await self._transcribe_async(audio_data)
            if not text:
                return False
            print(f"User said: {text}")

            # A barge-in press may have landed while we were transcribing; bail
            # before sending so the interrupted turn doesn't fire its utterance.
            if self._stop_requested:
                self._turn_done.set()
                return False

            user_ended = self._user_ended(text)
            if user_ended:
                print("[jarvis] user ended conversation; not sending to server")
                await self._play_beep_async(self.beep_generator.stop_beep)
                return False

            self._turn_done.clear()
            self._end_conversation = False
            vision_source = self._vision_source(text)
            if vision_source is not None:
                self._update_ui_state("processing")
                image = await asyncio.get_running_loop().run_in_executor(
                    None, capture, vision_source
                )
                if image:
                    print(f"[jarvis] vision request ({vision_source}) — sending image")
                    self._send_task = asyncio.create_task(
                        self.bridge.send_image(
                            image, caption=text, sender_name="Jarvis",
                            ext="jpg" if vision_source == "webcam" else "png",
                        )
                    )
                else:
                    print(f"[jarvis] {vision_source} capture failed; sending text only")
                    self._send_task = asyncio.create_task(self.bridge.send_text(text, sender_name="Jarvis"))
            else:
                self._send_task = asyncio.create_task(self.bridge.send_text(text, sender_name="Jarvis"))
            try:
                await self._send_task
            except asyncio.CancelledError:
                self._turn_done.set()
                self._update_ui_state("idle")
                return not self._stop_requested
            finally:
                self._send_task = None

            # SSE will push the reply; the TTS worker will speak it.
            self._update_ui_state("processing")
            try:
                await self._turn_done.wait()
            except asyncio.CancelledError:
                self._turn_done.set()
                return not self._stop_requested
            if self._end_conversation or user_ended:
                return False
            return not self._stop_requested
        except Exception as e:
            print(f"Turn error: {e}")
            await self._play_beep_async(self.beep_generator.error_beep)
            self._update_ui_state("error")
            self.window.after(2000, lambda: self._update_ui_state("idle"))
            return False

    async def _handle_interaction(self):
        if self._conversation_active:
            # Any click during an active conversation is a hard interrupt: stop
            # playback, abort any in-flight request/recording, and force the turn
            # to end so the UI never gets stuck on yellow/processing.
            self._stop_requested = True
            self.audio_recorder.cancel()
            try:
                await self.bridge.stop()
            except Exception:
                pass

            if self._send_task is not None and not self._send_task.done():
                self._send_task.cancel()
                try:
                    await self._send_task
                except asyncio.CancelledError:
                    pass
            self._send_task = None

            self.audio_player.cancel()
            while not self._tts_queue.empty():
                try:
                    self._tts_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            self._turn_done.set()

            # Drain any pending synthesis work so the worker doesn't keep us in
            # a speaking/processing state after the click.
            if self._tts_worker is not None and not self._tts_worker.done():
                self._tts_queue.put_nowait(None)
            self._is_speaking = False
            return

        self._conversation_active = True
        self._stop_requested = False
        self._pause_clap()
        try:
            while not self._stop_requested:
                keep_going = await self._single_turn()
                if not keep_going:
                    break
        finally:
            self._conversation_active = False
            self._stop_requested = False
            self._clap_turn = False
            self._update_ui_state("idle")
            self._resume_clap()

    async def _hold_turn(self, prev_task: Optional[asyncio.Task]) -> None:
        """Push-to-talk turn (satellite/Pi only): exactly one turn per button
        press, no auto-listen loop afterward. The user holds the Pi button to
        record (no VAD — record_held captures the whole hold) and releases to
        send; press again for the next turn.

        Barge-in: if a previous turn is still in flight when the button is
        pressed again, abort it (stop playback + cancel its recording/send),
        let it unwind, then start a fresh recording so the held button records
        the user's new utterance immediately."""
        if prev_task is not None and not prev_task.done():
            print("[jarvis] push-to-talk barge-in: aborting in-flight turn")
            self._stop_requested = True
            self._abort_in_flight()
            try:
                await asyncio.wait_for(asyncio.shield(prev_task), timeout=1.0)
            except Exception:
                try:
                    prev_task.cancel()
                except Exception:
                    pass
        self._conversation_active = True
        self._stop_requested = False
        self._pause_clap()
        try:
            await self._single_turn()
        finally:
            self._conversation_active = False
            self._stop_requested = False
            self._update_ui_state("idle")
            self._resume_clap()

    def _abort_in_flight(self) -> None:
        """Synchronous teardown of whatever an in-flight turn is doing, so a
        barge-in press can start clean. Mirror of _handle_interaction's
        interrupt branch, but callable mid-turn from _hold_turn."""
        try:
            self.audio_recorder.cancel()
        except Exception:
            pass
        try:
            asyncio.get_running_loop().create_task(self.bridge.stop())
        except Exception:
            pass
        if self._send_task is not None and not self._send_task.done():
            self._send_task.cancel()
        self._send_task = None
        try:
            self.audio_player.cancel()
        except Exception:
            pass
        while not self._tts_queue.empty():
            try:
                self._tts_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._turn_done.set()
        if self._tts_worker is not None and not self._tts_worker.done():
            try:
                self._tts_queue.put_nowait(None)
            except Exception:
                pass
        self._is_speaking = False


    def _enqueue_chunk(self, chunk: str) -> None:
        if not self.loop:
            return
        self.loop.call_soon_threadsafe(self._tts_queue.put_nowait, chunk)

    def _on_turn_end(self) -> None:
        if not self.loop:
            return
        self.loop.call_soon_threadsafe(self._tts_queue.put_nowait, None)

    @staticmethod
    def _join_chunks(chunks: list[str]) -> str:
        """Join chunks with spaces, then clean up common spacing issues."""
        if not chunks:
            return ""
        import re
        text = " ".join(chunks)
        # Remove space before punctuation
        text = re.sub(r" (?=[.,;:!?)\]}])", "", text)
        # Fix contractions:  word + apostrophe + short suffix
        text = re.sub(r"(\w) ' (ll|re|ve|s|d|t|m)\b", r"\1'\2", text, flags=re.IGNORECASE)
        return text

    async def _tts_loop(self) -> None:
        """Drains chunks from _tts_queue and speaks the reply — but ONLY after
        the orchestrator's stream is fully received, not on the fly.

        Orpheus runs on the same GPU as the orchestrator (gemma4 on the Radeon
        VII). If we synthesize each sentence as it streams in, Orpheus and the
        LLM run concurrently and contend for VRAM/compute, which garbles the
        audio (the greeting is clean because no LLM is generating then; live
        replies aren't). So we buffer the whole turn, and once the turn-end
        sentinel arrives — meaning the LLM is done and the GPU is free — we
        split it into sentences and speak them sequentially. This trades a
        little first-audio latency for clean synthesis.
        """
        reply: list[str] = []  # whole turn's reply
        while self.running:
            try:
                chunk = await self._tts_queue.get()
            except asyncio.CancelledError:
                return
            if chunk is None:
                # Turn end: the orchestrator is done. Now synthesize + speak.
                full = self._join_chunks(reply).strip()
                reply.clear()
                self._end_conversation = self._is_signoff(full)
                if full:
                    await self._speak(full)
                self._update_ui_state("idle")
                self._turn_done.set()
                continue
            reply.append(chunk)

    @staticmethod
    def _split_sentences(text: str) -> list[str]:
        """Split prose into speakable sentences on . ! ? and newlines, keeping
        the delimiter attached (Orpheus voices punctuation better with it)."""
        import re
        parts = re.split(r"(?<=[.!?])\s+|(?<=\n)", text)
        return [p.strip() for p in parts if p.strip()]

    @staticmethod
    def _strip_markdown(text: str) -> str:
        """Reduce markdown to plain prose so the TTS voices words, not symbols
        (e.g. it shouldn't read '**', '#', backticks, bullets, or link URLs)."""
        import re
        text = re.sub(r"```[\s\S]*?```", " ", text)             # fenced code blocks
        text = re.sub(r"`([^`]*)`", r"\1", text)                # inline code
        # Remove markdown links/images entirely (label + URL) so TTS doesn't read
        # "image" or raw URLs for attachments like ![image](...).
        text = re.sub(r"!?\[[^\]]*\]\([^)]*\)", "", text)
        text = re.sub(r"^\s*>+\s?", "", text, flags=re.MULTILINE)        # blockquotes
        text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)  # headers
        text = re.sub(r"^\s*([-*+]|\d+\.)\s+", "", text, flags=re.MULTILINE)  # bullets/numbers
        text = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)         # bold
        text = re.sub(r"(\*|_)(.*?)\1", r"\2", text)            # italic
        # Strip emoji/pictographs/dingbats — the TTS otherwise reads their
        # Unicode names aloud ('✅' -> "white heavy check mark", '🔒' …).
        text = _EMOJI_RE.sub("", text)
        # Strip any remaining bracketed attachments/placeholders like [image], [file], [audio].
        text = re.sub(r"\[.*?\]", "", text)
        text = re.sub(r"[ \t]+", " ", text)
        return text.strip()

    async def _speak(self, text: str) -> None:
        try:
            import re
            text = re.sub(r"\[\s*DONE\s*\]", "", text, flags=re.IGNORECASE)
            text = self._strip_markdown(text)
            if not text:
                return
            async with self._speak_lock:
                audio = await self._synthesize_async(text)
                if not audio:
                    return
                self._is_speaking = True
                try:
                    await self._play_audio_async(audio)
                finally:
                    self._is_speaking = False
                    self._last_spoke_at = time.monotonic()
                    self._on_audio_level(0.0)
        except Exception as e:
            print(f"TTS error: {e}")

    # ----- UI -----

    def _update_ui_state(self, state: str):
        if self.window is None:
            return
        try:
            if state == "listening":
                self.window.set_listening_state(True)
            elif state == "processing":
                self.window.set_processing_state(True)
            elif state == "speaking":
                self.window.set_speaking_state(True)
            elif state == "error":
                self.window.set_error_state(True)
            else:
                self.window.set_listening_state(False)
                self.window.set_processing_state(False)
                self.window.set_speaking_state(False)
                self.window.set_error_state(False)
        except Exception:
            pass

    def _on_button_press(self):
        if not (self.loop and self.loop.is_running()):
            return
        if self._push_to_talk:
            # Satellite/Pi push-to-talk: schedule a single held turn on the loop
            # thread. _start_hold_turn tracks the task so a barge-in press can
            # abort the in-flight turn first. (Called from the HTTP control
            # server thread, hence call_soon_threadsafe.)
            self.loop.call_soon_threadsafe(self._start_hold_turn)
        else:
            asyncio.run_coroutine_threadsafe(self._handle_interaction(), self.loop)

    def _on_hologram_click(self):
        """Hologram click (pywebview JS bridge). A click is a clean toggle:
        start a VAD turn when idle, hard-stop everything when a turn is active.

        The on-screen hologram is a momentary click — no hold, no release — so
        it always uses the VAD interaction model (record-until-silence), NOT the
        push-to-talk hold path used by the physical Pi button (/press + /release,
        which records the whole hold and re-records on a barge-in press). The
        push-to-talk barge-in re-recording was why a second click "prompted anew"
        instead of stopping. _clap_turn forces VAD recording even in
        satellite/push-to-talk mode, exactly like a clap wake; the interrupt
        branch in _handle_interaction handles the stop-on-second-click."""
        if not (self.loop and self.loop.is_running()):
            return
        self._clap_turn = True  # force VAD recording in satellite/push-to-talk mode
        asyncio.run_coroutine_threadsafe(self._hologram_interaction(), self.loop)

    def _on_chat_send(self, text: str) -> str:
        """Send a text message to Jarvis and return the reply. Called from the
        Direct Line chat panel via pywebview's JS bridge (sync → async bridge)."""
        if not (self.loop and self.loop.is_running()):
            return "[Jarvis offline]"
        if not text or not text.strip():
            return ""
        future = asyncio.run_coroutine_threadsafe(
            self._chat_turn(text), self.loop
        )
        try:
            return future.result(timeout=60)
        except concurrent.futures.TimeoutError:
            return "[response timed out]"
        except Exception as e:
            return f"[error: {e}]"

    async def _chat_turn(self, text: str) -> str:
        """Send a text message through the bridge and collect the text reply
        (no TTS, no audio — just the text response for the chat panel)."""
        chunks: list[str] = []
        got_content = asyncio.Event()

        def on_chunk(chunk: str) -> None:
            chunks.append(chunk)
            got_content.set()

        # Wire temporary handlers. on_chunk/on_turn_end are *methods* that set
        # the bridge's internal _on_chunk/_on_turn_end — assigning to them as
        # attributes replaces the method and never updates the callback the SSE
        # loop actually calls. Call them, and save/restore _on_chunk directly.
        orig_chunk = self.bridge._on_chunk
        self.bridge.on_chunk(on_chunk)
        # Keep original on_turn_end so voice TTS still works — we only
        # care about on_chunk for collecting the text reply.

        try:
            await self.bridge.send_text(text, sender_name="Jarvis")
            # Wait for content (chat_complete event), not the premature
            # on_turn_end from _finish_turn which fires before the real reply.
            try:
                await asyncio.wait_for(got_content.wait(), timeout=55)
            except asyncio.TimeoutError:
                pass
            return self._join_chunks(chunks) if chunks else "[no response]"
        finally:
            self.bridge.on_chunk(orig_chunk)

    def _start_hold_turn(self) -> None:
        """Runs on the event loop thread (scheduled by _on_button_press).
        Captures the previous in-flight hold turn (if any) so _hold_turn can
        abort it before starting a fresh recording on barge-in."""
        prev = self._hold_turn_task
        self._hold_turn_task = asyncio.create_task(self._hold_turn(prev))

    def _on_button_release(self):
        """Satellite/Pi push-to-talk release: stop the held recording and let
        the turn proceed to transcribe/send/speak. No-op outside push-to-talk
        mode (the local hologram ignores /release). Called from the HTTP
        control server thread; recorder.stop() is thread-safe (sets an event
        and closes the stream response under a lock)."""
        if not self._push_to_talk:
            return
        try:
            self.audio_recorder.stop()
        except Exception as e:
            print(f"[jarvis] button release stop failed: {e}")

    # ----- Warden URL settings (in-app field + --set-warden-url) -----

    def _get_warden_url(self) -> str:
        return self.config.dockbox.get("base_url", "") or ""

    def _save_warden_url(self, url: str) -> None:
        """Persist dockbox.base_url and apply it to the live bridge client.

        The SSE stream is a long-lived connection to the old URL; updating
        base_url in-place affects new requests (send_text/send_image) but the
        existing SSE task stays on the old server. A restart is the clean way
        to fully rebind — we print a hint. This mirrors what `single.py` writes
        but without the health check.
        """
        url = (url or "").strip()
        self.config.set("dockbox.base_url", url)
        self.config.save()
        try:
            self.bridge.client.base_url = url.rstrip("/")
        except Exception as e:
            print(f"[jarvis] apply warden url to bridge failed: {e}")
        print(f"[jarvis] saved dockbox.base_url={url} (restart Jarvis to rebind the SSE stream)")

    # ----- Satellite host settings (in-app field; mirrors --remote) -----

    def _get_satellite_host(self) -> str:
        """Show the effective satellite host: the live one if running remote,
        else the persisted satellite.host (may be "" = standalone)."""
        live = getattr(self, "_satellite_host", None) or ""
        saved = (self.config.get("satellite", {}) or {}).get("host", "") or ""
        return live or saved

    def _save_satellite_host(self, host: str) -> None:
        """Persist satellite.host so the next launch uses it as --remote.

        The recorder/player are built at startup from the host, so a change
        takes effect on restart (same caveat as the Warden URL SSE rebind).
        Clearing the field returns to standalone (local mic/speaker) on next
        launch.
        """
        host = (host or "").strip()
        self.config.set("satellite.host", host)
        self.config.save()
        if host:
            print(f"[jarvis] saved satellite.host={host} (restart Jarvis to use the remote mic/speaker)")
        else:
            print("[jarvis] cleared satellite.host (restart Jarvis for standalone/local audio)")

    def _external_cancel(self):
        """Thread-safe barge-in from the control server (POST /cancel).

        recorder/player.cancel() are safe to call from any thread (they use
        locks internally); the bridge stop + turn-bookkeeping is scheduled on
        the main loop to avoid racing the asyncio pipeline.
        """
        try:
            self.audio_recorder.cancel()
        except Exception:
            pass
        try:
            self.audio_player.cancel()
        except Exception:
            pass
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self._cancel_async(), self.loop)

    async def _cancel_async(self):
        self._stop_requested = True
        try:
            await self.bridge.stop()
        except Exception:
            pass
        if self._send_task is not None and not self._send_task.done():
            self._send_task.cancel()
            try:
                await self._send_task
            except asyncio.CancelledError:
                pass
        self._send_task = None
        while not self._tts_queue.empty():
            try:
                self._tts_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._turn_done.set()

    # ----- clap wake -----

    GREETING = "Hello. I'm ready to get to work."
    # Seconds the clap detector stays deaf after Jarvis stops speaking.
    _SPEAK_COOLDOWN = 1.5

    def _pause_clap(self) -> None:
        if self.clap_detector is not None:
            self.clap_detector.pause()

    def _resume_clap(self) -> None:
        if self.clap_detector is not None:
            self.clap_detector.resume()

    def _on_clap(self) -> None:
        """Clap-detector callback (fires on the detector's background thread)."""
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self._clap_wake(), self.loop)

    async def _clap_wake(self) -> None:
        if self._conversation_active:
            return
        self._pause_clap()
        # A clap wake has no button release to end a hold recording, so force
        # VAD recording (record_until_silence) for every turn of the
        # conversation this kicks off. The auto-listen loop then runs until the
        # user says the end phrase ("that's all for now") — same continuous
        # behavior as the local hologram. _handle_interaction clears _clap_turn
        # in its finally.
        self._clap_turn = True
        # A clap wake uses VAD recording (no button release), and the recorder's
        # silence_timeout comes from config (~0.6s) — a natural speech pause
        # ends the turn immediately and cuts the user off. Loosen it for the
        # whole clap-initiated conversation so the user can pause between
        # sentences, then restore the original value when the loop ends.
        saved_silence_timeout = getattr(self.audio_recorder, "silence_timeout", None)
        try:
            try:
                await self._speak(self.GREETING)
            except Exception:
                pass
            if saved_silence_timeout is not None:
                self.audio_recorder.silence_timeout = 2.5
            await self._handle_interaction()
        finally:
            if saved_silence_timeout is not None:
                self.audio_recorder.silence_timeout = saved_silence_timeout

    async def _hologram_interaction(self) -> None:
        """Run a click-initiated interaction through the VAD toggle path.

        _handle_interaction is the toggle: if a turn is already active its
        interrupt branch stops playback/recording/in-flight request and
        returns (the second click); if idle its start branch runs the
        record-until-silence auto-listen loop (the first click). Loosen the
        VAD silence timeout for the whole click-initiated conversation so a
        natural pause between sentences doesn't cut the user off (satellite
        silence_timeout is ~0.6s) — same trick _clap_wake uses. Restored when
        the loop ends."""
        saved_silence_timeout = getattr(self.audio_recorder, "silence_timeout", None)
        try:
            if saved_silence_timeout is not None:
                self.audio_recorder.silence_timeout = 2.5
            await self._handle_interaction()
        finally:
            if saved_silence_timeout is not None:
                self.audio_recorder.silence_timeout = saved_silence_timeout

    # ----- async loop -----

    def _start_async_loop(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.set_default_executor(self._executor)
        self.running = True
        while self.running:
            try:
                self.loop.run_until_complete(asyncio.sleep(0.1))
            except Exception:
                break

    def _signal_handler(self, signum, frame):
        print("\nShutting down…")
        self.running = False
        if self.loop:
            self.loop.call_soon_threadsafe(self.loop.stop)
        if self.window:
            self.window.close()
        # Qt's event loop swallows SystemExit from sys.exit(). Restore the
        # default handler and re-send the signal so the process dies.
        signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)

    def _setup_global_hotkey(self):
        try:
            from pynput import keyboard
        except ImportError:
            return
        def on_press(key):
            try:
                if key == keyboard.Key.f9:
                    self._on_hologram_click()
            except Exception:
                pass
        listener = keyboard.Listener(on_press=on_press)
        listener.daemon = True
        listener.start()

    def _setup_clap_detector(self):
        voice_cfg = self.config.voice
        if not voice_cfg.get("clap_enabled", True):
            return
        threshold = int(voice_cfg.get("clap_threshold", 9000))
        crest = float(voice_cfg.get("clap_crest", 4.0))
        # Don't wake mid-conversation, while Jarvis is speaking, or in the
        # brief tail after speech — otherwise Jarvis's own voice/echo can
        # self-trigger a new prompt and loop.
        can_fire = lambda: not (
            self._conversation_active
            or self._is_speaking
            or (time.monotonic() - self._last_spoke_at) < self._SPEAK_COOLDOWN
        )
        if self._mic_host:
            # Remote mic: clap into the Pi's mic over its /mic PCM stream
            # instead of a local device. The detector holds its own /mic
            # connection and releases it on pause() so the recorder can take
            # the mic exclusively during a turn (same release pattern as the
            # local detector's PyAudio open/close). Clap follows the MIC: if
            # the mic is remote, clap listens remotely regardless of speaker.
            self.clap_detector = SatelliteClapDetector(
                host=self._sat_mic_host,
                port=self._sat_mic_port,
                on_double_clap=self._on_clap,
                can_fire=can_fire,
                threshold=threshold,
                crest_factor=crest,
            )
            self.clap_detector.start()
            print(f"[jarvis] clap detection on — double-clap to wake "
                  f"(satellite mic {self._sat_mic_host}:{self._sat_mic_port})")
            return
        self.clap_detector = ClapDetector(
            on_double_clap=self._on_clap,
            can_fire=can_fire,
            sample_rate=int(voice_cfg.get("clap_sample_rate", 48000)),
            threshold=threshold,
            crest_factor=crest,
            input_device=self._input_device,
        )
        self.clap_detector.start()
        print("[jarvis] clap detection on — double-clap to wake")

    # ----- bootstrap -----

    def _ensure_configured(self) -> bool:
        # No-auth single-server mode: a base_url is all that's required. There's
        # no login (no session/user_id) and no default group/jid by design, so
        # we only warn instead of blocking the boot.
        if not self.config.dockbox.get("base_url"):
            print("[jarvis] no server configured. Run `python single.py` first.")
            return False
        if not self.bridge.active_jid:
            print("[jarvis] no default group set — sending messages will need a jid.")
        return True

    async def _bootstrap_async(self):
        self.bridge.on_chunk(self._enqueue_chunk)
        self.bridge.on_turn_end(self._on_turn_end)
        self.bridge.start_stream()
        self._tts_worker = asyncio.create_task(self._tts_loop())
        # No try/except: if the bootstrap speak fails, _speak prints the TTS
        # error (and a raised exception surfaces via the run_coroutine_threadsafe
        # future). The old silent swallow hid a Kokoro no-segments failure — the
        # line just vanished with no error printed.
        await self._speak("Assistant online.")

    def run(self):
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        if not self._ensure_configured():
            return

        self._loop_thread = threading.Thread(target=self._start_async_loop, daemon=True)
        self._loop_thread.start()
        while self.loop is None:
            threading.Event().wait(0.01)

        self._setup_global_hotkey()
        self._setup_clap_detector()

        # Control server: lets a remote Pi button trigger a turn over HTTP.
        # Distinct from the satellite audio relay (port 8766); default 8767.
        self._control_server = ControlServer(self, port=self._control_port)
        self._control_server.start()

        ui_cfg = self.config.ui
        widgets_cfg = self.config.widgets
        feed_height = 0  # widgets live in their own window, not a feed band
        widget_config = {
            "feed_height": feed_height,
            "refresh_minutes": int(widgets_cfg.get("refresh_minutes", 60)),
            "enabled": widgets_cfg.get("enabled", ["weather", "email", "task", "notes"]),
            "warden_url": self._get_warden_url(),
            "notes_folder": (self.config.notes or {}).get("default_folder", "Inbox"),
        }
        self.window = JarvisWindow(
            on_button_press=self._on_button_press,
            on_hologram_click=self._on_hologram_click,
            width=ui_cfg.get("window_width", 480),
            height=ui_cfg.get("window_height", 480),
            feed_height=feed_height,
            widget_config=widget_config,
            on_get_warden_url=self._get_warden_url,
            on_save_warden_url=self._save_warden_url,
            on_get_satellite_host=self._get_satellite_host,
            on_save_satellite_host=self._save_satellite_host,
            on_chat_send=self._on_chat_send,
        )

        asyncio.run_coroutine_threadsafe(self._bootstrap_async(), self.loop)

        self.window.run()
        self._shutdown()

    def _shutdown(self):
        print("Shutting down…")
        self.running = False
        if self._control_server is not None:
            self._control_server.stop()
        if self.clap_detector is not None:
            self.clap_detector.stop()
        try:
            self.audio_recorder.cancel()
        except Exception:
            pass
        try:
            self.audio_player.cancel()
        except Exception:
            pass
        if self.loop:
            future = asyncio.run_coroutine_threadsafe(self.bridge.aclose(), self.loop)
            try:
                future.result(timeout=3)
            except Exception:
                pass
            self.loop.call_soon_threadsafe(self.loop.stop)


def main():
    import argparse

    # Default satellite (Pi) IP for bare --remote / --mic remote / --speaker
    # remote. run.sh exports SATELLITE_IP; fall back to the usual Pi address.
    default_ip = os.environ.get("SATELLITE_IP", "192.168.0.171")

    def _parse_side(val: Optional[str]) -> Optional[str]:
        """Resolve a --mic/--speaker value to a remote host, or None for local.

        Accepts: 'local' (→ None), 'remote' (→ default_ip),
        'remote:<host>' (→ host), or a bare host (→ remote at that host)."""
        if val is None:
            return None  # not specified → leave to the caller's fallback logic
        v = val.strip()
        if v == "local":
            return None
        if v == "remote":
            return default_ip
        if v.startswith("remote:"):
            return v[len("remote:"):].strip() or default_ip
        return v  # bare host/ip → remote

    p = argparse.ArgumentParser(description="Jarvis — Dockbox thin voice client")
    p.add_argument("--mic", metavar="local|remote|remote:HOST", default=None,
                   help="Mic source: 'local' (this machine) or 'remote[:HOST]' "
                        "(a Pi running the dumb audio relay, "
                        "satellite/satellite_server.py). The recorder, clap "
                        "detector, and push-to-talk follow the mic choice.")
    p.add_argument("--speaker", metavar="local|remote|remote:HOST", default=None,
                   help="Speaker sink: 'local' (this machine) or 'remote[:HOST]' "
                        "(a Pi running the dumb audio relay). Independent of --mic.")
    p.add_argument("--remote", metavar="HOST", nargs="?", const=default_ip,
                   default=None,
                   help="Shorthand for --mic remote:HOST --speaker remote:HOST. "
                        "With no HOST, uses the default satellite IP "
                        f"({default_ip}).")
    p.add_argument("--control-port", type=int, default=8767,
                   help="Port for the remote-button control HTTP server "
                        "(POST /press, /cancel; GET /status). Default 8767. "
                        "Distinct from the satellite audio relay's 8766.")
    p.add_argument("--set-warden-url", metavar="URL", default=None,
                   help="Write dockbox.base_url to the user config and exit, "
                        "without launching the UI. e.g. --set-warden-url "
                        "http://10.0.0.47:3200. Scriptable alternative to the "
                        "in-app settings field.")
    args = p.parse_args()

    if args.set_warden_url is not None:
        cfg = Config()
        cfg.set("dockbox.base_url", args.set_warden_url)
        cfg.save()
        print(f"[jarvis] saved dockbox.base_url={args.set_warden_url} → {cfg.config_path}")
        return

    mic_host = _parse_side(args.mic)
    speaker_host = _parse_side(args.speaker)
    # --remote is a shorthand that sets BOTH sides remote — but only for sides
    # the caller didn't set explicitly, so `--remote x --mic local` keeps the
    # mic local and only makes the speaker remote.
    if args.remote is not None:
        rhost = args.remote or default_ip
        if args.mic is None:
            mic_host = rhost
        if args.speaker is None:
            speaker_host = rhost

    # Back-compat: when launched directly (python main.py) with NO audio flag
    # at all, fall back to a persisted satellite.host for both sides — mirrors
    # the old single-flag behavior and keeps the in-app settings panel working.
    # run.sh always passes explicit --mic/--speaker, so this never triggers
    # from run.sh.
    if args.mic is None and args.speaker is None and args.remote is None:
        saved = (Config().get("satellite", {}) or {}).get("host") or None
        if saved:
            mic_host = saved
            speaker_host = saved

    JarvisApp(mic_host=mic_host, speaker_host=speaker_host,
              control_port=args.control_port).run()


if __name__ == "__main__":
    main()
