#!/usr/bin/env python3
"""Jarvis — Dockbox thin-client entry point.

Architecture:
- Main thread: pywebview UI (Jarvis HTML window) + tkinter companion windows.
- Background thread: single asyncio event loop.
- DockboxBridge owns the HTTP/SSE connection to the server.
- Local Whisper transcribes voice; transcribed text is sent to /api/messages.
- Agent reply chunks arrive via SSE and are spoken by Kokoro TTS.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import functools
import logging
import os
import signal
import sys
import threading
import time
import warnings
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
from voice.clap import ClapDetector
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


class JarvisApp:
    def __init__(self):
        self.config = Config()
        self.bridge = DockboxBridge(config=self.config)

        voice_cfg = self.config.voice
        audio_cfg = self.config.audio
        # Resolve audio devices. pyaudio's "default" device can't capture/play
        # Bluetooth (HFP) on PipeWire — the "pipewire"/"pulse" devices can. Honor
        # an explicit config index, else auto-detect by backend name.
        in_dev = audio_cfg.get("input_device")
        if in_dev is None:
            in_dev = find_device("input")
        out_dev = audio_cfg.get("playback_device")
        if out_dev is None:
            out_dev = find_device("output")
        self._input_device = in_dev
        print(f"[jarvis] audio devices — input={in_dev} output={out_dev}")
        self.audio_recorder = AudioRecorder(
            sample_rate=voice_cfg.get("sample_rate", 16000),
            channels=voice_cfg.get("channels", 1),
            silence_timeout=voice_cfg.get("silence_timeout", 1.0),
            max_duration=voice_cfg.get("max_recording_seconds", 60.0),
            input_device_index=in_dev,
        )
        self.audio_player = AudioPlayer(output_device=out_dev)
        self.beep_generator = BeepGenerator(
            sample_rate=voice_cfg.get("sample_rate", 16000)
        )
        self.stt = STT(model=voice_cfg.get("whisper_model", "base"))
        self.tts = TTS(voice="bm_george", speed=1.2, lang_code="b")

        self.window: Optional[JarvisWindow] = None
        self.clap_detector: Optional[ClapDetector] = None

        self.running = False
        self._conversation_active = False
        self._stop_requested = False
        self._is_speaking = False
        # When Jarvis last finished speaking. The clap detector ignores claps
        # for _SPEAK_COOLDOWN seconds after, so Jarvis's own voice/echo (or a
        # trailing word) can't wake it and start a self-triggered loop.
        self._last_spoke_at = 0.0
        self._record_task: Optional[asyncio.Task] = None
        self._send_task: Optional[asyncio.Task] = None

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
        return await asyncio.get_running_loop().run_in_executor(
            None, self.audio_recorder.record_until_silence
        )

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

            user_ended = self._user_ended(text)
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
            if self._is_speaking:
                self.audio_player.cancel()
                while not self._tts_queue.empty():
                    try:
                        self._tts_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                try:
                    await self.bridge.stop()
                except Exception:
                    pass
                self._turn_done.set()
                return
            if self._send_task is not None and not self._send_task.done():
                self._send_task.cancel()
                await self.bridge.stop()
                return
            self._stop_requested = True
            self.audio_recorder.cancel()
            try:
                await self.bridge.stop()
            except Exception:
                pass
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
            self._update_ui_state("idle")
            self._resume_clap()

    # ----- TTS pipeline (consumes SSE chunks) -----

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
        """Drains chunks from _tts_queue, batches into sentences, speaks them."""
        buffer: list[str] = []
        reply: list[str] = []  # whole turn's reply, for sign-off detection
        while self.running:
            try:
                chunk = await self._tts_queue.get()
            except asyncio.CancelledError:
                return
            if chunk is None:
                # Turn end: flush whatever's left
                if buffer:
                    text = self._join_chunks(buffer).strip()
                    buffer.clear()
                    if text:
                        await self._speak(text)
                # If Jarvis bid the user farewell, end the conversation.
                self._end_conversation = self._is_signoff(self._join_chunks(reply))
                reply.clear()
                self._update_ui_state("idle")
                self._turn_done.set()
                continue

            reply.append(chunk)
            buffer.append(chunk)
            joined = self._join_chunks(buffer)
            # Speak when we have at least one sentence boundary
            for sep in (".", "!", "?", "\n"):
                if sep in joined:
                    head, _, tail = joined.rpartition(sep)
                    head = head + sep
                    buffer.clear()
                    if tail.strip():
                        buffer.append(tail)
                    if head.strip():
                        await self._speak(head)
                    break

    @staticmethod
    def _strip_markdown(text: str) -> str:
        """Reduce markdown to plain prose so the TTS voices words, not symbols
        (e.g. it shouldn't read '**', '#', backticks, bullets, or link URLs)."""
        import re
        text = re.sub(r"```[\s\S]*?```", " ", text)             # fenced code blocks
        text = re.sub(r"`([^`]*)`", r"\1", text)                # inline code
        text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links/images -> label
        text = re.sub(r"^\s*>+\s?", "", text, flags=re.MULTILINE)        # blockquotes
        text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)  # headers
        text = re.sub(r"^\s*([-*+]|\d+\.)\s+", "", text, flags=re.MULTILINE)  # bullets/numbers
        text = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)         # bold
        text = re.sub(r"(\*|_)(.*?)\1", r"\2", text)            # italic
        # Strip emoji/pictographs/dingbats — the TTS otherwise reads their
        # Unicode names aloud ('✅' -> "white heavy check mark", '🔒' …).
        text = _EMOJI_RE.sub("", text)
        text = re.sub(r"[ \t]+", " ", text)
        return text.strip()

    async def _speak(self, text: str) -> None:
        try:
            import re
            text = re.sub(r"\[\s*DONE\s*\]", "", text, flags=re.IGNORECASE)
            text = self._strip_markdown(text)
            if not text:
                return
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
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self._handle_interaction(), self.loop)

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
        try:
            await self._speak(self.GREETING)
        except Exception:
            pass
        await self._handle_interaction()

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
                    self._on_button_press()
            except Exception:
                pass
        listener = keyboard.Listener(on_press=on_press)
        listener.daemon = True
        listener.start()

    def _setup_clap_detector(self):
        voice_cfg = self.config.voice
        if not voice_cfg.get("clap_enabled", True):
            return
        self.clap_detector = ClapDetector(
            on_double_clap=self._on_clap,
            # Don't wake mid-conversation, while Jarvis is speaking, or in the
            # brief tail after speech — otherwise Jarvis's own voice/echo can
            # self-trigger a new prompt and loop.
            can_fire=lambda: not (
                self._conversation_active
                or self._is_speaking
                or (time.monotonic() - self._last_spoke_at) < self._SPEAK_COOLDOWN
            ),
            sample_rate=voice_cfg.get("sample_rate", 16000),
            threshold=int(voice_cfg.get("clap_threshold", 9000)),
            crest_factor=float(voice_cfg.get("clap_crest", 4.0)),
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
        try:
            await self._speak("Assistant online.")
        except Exception:
            pass

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

        ui_cfg = self.config.ui
        self.window = JarvisWindow(
            on_button_press=self._on_button_press,
            width=ui_cfg.get("window_width", 480),
            height=ui_cfg.get("window_height", 480),
        )

        asyncio.run_coroutine_threadsafe(self._bootstrap_async(), self.loop)

        self.window.run()
        self._shutdown()

    def _shutdown(self):
        print("Shutting down…")
        self.running = False
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
    JarvisApp().run()


if __name__ == "__main__":
    main()
