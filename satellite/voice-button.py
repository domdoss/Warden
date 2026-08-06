#!/usr/bin/env python3
"""Graice GPIO voice button — hold-to-talk, with barge-in.

Hold the button (BCM 17, physical pin 11, to GND pin 9) to record from the default mic; release to send.
Graice transcribes via Groq Whisper, the orchestrator answers, and the reply is
spoken out loud via Groq TTS (Celeste-PlayAI, female American) to the default speaker.

BARGE-IN (set in stone): pressing the button while Graice is talking IMMEDIATELY
stops the playback and starts listening to the user. Every time. This works because
on_press kills the aplay process and bumps a generation counter; any speak still in
flight sees a stale generation and aborts before it can play.

Pins and wiring are documented in HARDWARE.md.
"""
import os
import sys
import re
import time
import json
import math
import struct
import wave
import shutil
import subprocess
import tempfile
import urllib.request
import urllib.parse
import threading
from datetime import datetime, timedelta, timezone

JID = "owner@local"
SENDER = "User"

# ── Mode / endpoint selection ────────────────────────────────────────────────
# Reads ~/.graice-mode (KEY=VALUE, written by the Pi TUI) so the same button
# script works in three roles:
#   MODE=standalone  → record on the Pi, POST WAV to Warden, Groq TTS on the Pi,
#                      play on the Pi. BASE = WARDEN_URL (localhost:3200).
#   MODE=satellite   → the Pi is a dumb remote mic/speaker (satellite_server.py
#                      is running separately to expose /mic /play /cancel). The
#                      button does NO local recording/TTS — it just POSTs /press
#                      to the Audio server (the hologram voice client on the
#                      laptop), which records via the Pi's satellite /mic, talks
#                      to Warden, runs TTS, and plays via the Pi's satellite /play.
#   MODE=both        → like satellite for the BUTTON (POSTs /press to the audio
#                      server — no local recording/TTS), but the Pi ALSO runs the
#                      Warden at localhost:3200. The laptop's audio server does
#                      STT/TTS and talks back to the Pi's Warden.
#
# Press scheme in satellite mode: press-only toggle. Each press POSTs /press to
# AUDIO_SERVER_URL; the audio server's /press handler triggers a turn with
# barge-in semantics (a press while it's speaking/processing interrupts and
# starts a new turn, exactly like clicking its on-screen button). Release is a
# no-op — the audio server's VAD (record_until_silence) stops each turn's
# recording naturally. /cancel is also exposed on the audio server for an
# explicit external barge-in if ever needed.
_MODE_DEFAULTS = {
    "MODE": "standalone",
    "WARDEN_URL": "http://localhost:3200",
    "AUDIO_SERVER_URL": "",
    "SATELLITE_URL": "",
}


def load_mode():
    """Read ~/.graice-mode (KEY=VALUE); fall back to standalone defaults."""
    cfg = dict(_MODE_DEFAULTS)
    path = os.path.expanduser("~/.graice-mode")
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    except Exception:
        pass
    return cfg


_MODE = load_mode()
MODE = _MODE.get("MODE", "standalone")
WARDEN_URL = _MODE.get("WARDEN_URL", "http://localhost:3200")
AUDIO_SERVER_URL = _MODE.get("AUDIO_SERVER_URL", "")
SATELLITE_URL = _MODE.get("SATELLITE_URL", "")

# Standalone mode keeps today's behaviour verbatim, just pointing BASE at the
# configured Warden URL. In satellite mode BASE is unused (no local send/TTS).
BASE = WARDEN_URL

BUTTON_PINS = [17, 12, 13]   # onboard ReSpeaker user button (BCM 17) + external button on Grove digital port (BCM 12 or 13)
RECORD_RATE = 16000
RECORD_FMT = "S16_LE"
RECORD_CHANS = 1
POLL_INTERVAL = 1.0

GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech"
TTS_MODEL = "canopylabs/orpheus-v1-english"
TTS_VOICE = "hannah"   # warm, expressive, engaging — female American
TTS_FORMAT = "wav"

DEVNULL = subprocess.DEVNULL


def default_source_id():
    """WirePlumber default source node id — the mic the dashboard selected — or None."""
    try:
        out = subprocess.run(["wpctl", "status"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    idx = out.find("Sources:")
    if idx < 0:
        return None
    # wpctl draws a tree with │ ├ └ ─ box chars; strip them so the regex can match.
    tree = str.maketrans({c: " " for c in "│├└─"})
    section = out[idx + len("Sources:"):]
    for raw in section.splitlines():
        clean = raw.translate(tree)
        stripped = clean.strip()
        # Stop at the next section header — but NOT Filters:, because bluetooth
        # HFP mics live under Filters:, not Sources:.
        if re.match(r"^(Streams|Devices|Endpoints|Audio|Video|Route):", stripped):
            break
        m = re.match(r"^\s*(\*)?\s*(\d+)\.\s+(.+)", clean)
        if m and m.group(1) == "*":
            return int(m.group(2))
    return None


def recording_cmd(path):
    """Capture from the dashboard-selected mic. Prefer pw-record targeting the
    WirePlumber default source (resolved each call so a dashboard change applies
    on the next press); fall back to arecord -D default if pw-record is absent."""
    if shutil.which("pw-record"):
        cmd = ["pw-record", "--rate", str(RECORD_RATE), "--channels", str(RECORD_CHANS), "--format", "s16"]
        sid = default_source_id()
        if sid is not None:
            cmd += ["--target", str(sid)]
        cmd.append(path)
        return cmd
    return ["arecord", "-D", "default", "-f", RECORD_FMT, "-r", str(RECORD_RATE),
            "-c", str(RECORD_CHANS), "-q", path]


def playback_cmd(path):
    """Play a WAV through the dashboard-selected speaker. Prefer pw-play (respects
    the WirePlumber default sink set via the dashboard); fall back to aplay."""
    if shutil.which("pw-play"):
        return ["pw-play", path]
    return ["aplay", "-q", path]


# Audible feedback tones (synthesized at startup, played via pw-play).
BEEP_FREQ = 880    # higher tone — "now listening"
BEEP_MS = 120
BOOP_FREQ = 330    # lower tone — "stopped listening"
BOOP_MS = 200
TONE_VOL = 0.4


def make_tone(freq, duration_ms, vol=TONE_VOL):
    """Synthesize a short sine beep with 10ms fades into a temp WAV. No deps."""
    rate = RECORD_RATE
    n = int(rate * duration_ms / 1000)
    fade = max(1, int(rate * 0.01))
    frames = bytearray()
    for i in range(n):
        env = 1.0
        if i < fade:
            env = i / fade
        elif i > n - fade:
            env = max(0.0, (n - i) / fade)
        s = int(vol * env * math.sin(2 * math.pi * freq * (i / rate)) * 32767)
        frames += struct.pack('<h', s)
    path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path


def load_groq_key() -> str:
    k = os.environ.get("GROQ_API_KEY")
    if k:
        return k.strip()
    here = os.path.dirname(os.path.abspath(__file__))
    envf = os.path.join(os.path.dirname(here), "data", "env", "env")
    try:
        with open(envf) as f:
            for line in f:
                line = line.strip()
                if line.startswith("GROQ_API_KEY="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


GROQ_KEY = load_groq_key()


def log(msg):
    """Timestamped line to stderr (→ voice-button.log)."""
    sys.stderr.write("%s %s\n" % (datetime.now().strftime("%H:%M:%S"), msg))

# Imperative verbs the orchestrator uses to brief sub-agents (e.g. "Find the
# first headline on espn.com"). These are internal delegation instructions, not
# user-facing replies, so they should NOT be read out loud. User-facing replies
# start with "I", "Right now", "Here", "Yes", etc. — not in this set.
DELEGATION_VERBS = {
    "find", "search", "read", "get", "check", "look", "summarize", "summarise",
    "write", "compare", "list", "fetch", "browse", "visit", "open", "use", "run",
    "compute", "calculate", "translate", "analyze", "analyse", "review", "audit",
    "inspect", "monitor", "watch", "send", "create", "update", "delete",
    "schedule", "plan", "draft", "generate", "identify", "determine", "pull",
    "query", "call", "invoke", "execute", "navigate", "click", "screenshot",
    "extract", "scrape", "organize", "organise", "tell", "ask", "verify", "test",
}


def is_delegation_brief(text):
    """True if this looks like an internal task brief to a sub-agent rather than
    a reply to the user. Heuristic: first word is an imperative verb."""
    t = text.strip()
    if not t:
        return False
    first = t.split(None, 1)[0].lower().strip(".,!?;:")
    return first in DELEGATION_VERBS


class VoiceLoop:
    def __init__(self, button, beep_path, boop_path, mode=MODE, audio_server_url=AUDIO_SERVER_URL):
        self.button = button
        self.beep_path = beep_path
        self.boop_path = boop_path
        self.mode = mode
        self.audio_server_url = audio_server_url
        self.lock = threading.Lock()
        self.rec_proc = None
        self.rec_path = None
        self.play_proc = None
        self.gen = 0          # bumped on every press; stale speaks self-cancel

    # ── playback control ───────────────────────────────────────────────
    def stop_playback(self):
        """Kill TTS audio right now. Safe to call when nothing is playing."""
        with self.lock:
            p = self.play_proc
            self.play_proc = None
        if not p:
            return
        for fn in (p.terminate, p.kill):
            try:
                fn()
                p.wait(timeout=1)
                break
            except Exception:
                continue

    # ── recording ─────────────────────────────────────────────────────
    def _kill_recording(self):
        with self.lock:
            proc = self.rec_proc
            path = self.rec_path
            self.rec_proc = None
            self.rec_path = None
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        if path and os.path.exists(path):
            try:
                os.unlink(path)
            except Exception:
                pass

    def start_recording(self):
        self._kill_recording()  # never two recordings at once
        rec = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        rec.close()
        proc = subprocess.Popen(recording_cmd(rec.name), stdout=DEVNULL, stderr=DEVNULL)
        with self.lock:
            self.rec_proc = proc
            self.rec_path = rec.name

    def stop_recording(self):
        with self.lock:
            proc = self.rec_proc
            path = self.rec_path
            self.rec_proc = None
            self.rec_path = None
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        return path

    # ── network ─────────────────────────────────────────────────────────
    def send_voice(self, path):
        with open(path, "rb") as f:
            data = f.read()
        url = BASE + "/api/voice?" + urllib.parse.urlencode({"jid": JID, "sender_name": SENDER})
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "audio/wav"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    def speak_replies(self, since_ts, my_gen):
        """Speak every user-facing bot reply that arrives after since_ts.

        No timeouts and no quiet-period — just keep polling /api/messages and
        speak each new bot message as it arrives. Internal delegation briefs to
        sub-agents (imperatives like "Find the headline on espn.com") are skipped
        so the user only hears real replies. Stops on barge-in (a new press).
        """
        url = BASE + "/api/messages?" + urllib.parse.urlencode({"jid": JID, "since": since_ts, "limit": "20"})
        last_spoken_ts = since_ts
        while True:
            with self.lock:
                if self.gen != my_gen:
                    log("speak_replies: barge-in, stopping")
                    return
            try:
                with urllib.request.urlopen(url, timeout=10) as r:
                    msgs = json.loads(r.read()).get("messages", [])
            except Exception:
                msgs = []
            for m in msgs:
                ts = m.get("timestamp", "")
                if m.get("is_bot_message") and ts > last_spoken_ts:
                    content = m.get("content", "")
                    last_spoken_ts = ts
                    if not content:
                        continue
                    if is_delegation_brief(content):
                        log("speak_replies: skip delegation: %r" % content[:60])
                        continue
                    self.speak(content, my_gen)
            time.sleep(POLL_INTERVAL)

    def speak(self, text, my_gen):
        if not text:
            log("speak: skipped (empty text)")
            return
        log("speak: gen=%d text=%r" % (my_gen, text[:60]))
        audio = None
        if GROQ_KEY:
            audio = self._fetch_groq_tts(text, my_gen)
        if audio:
            log("speak: fetched %d bytes" % len(audio))
            self._play_wav_bytes(audio, my_gen, "groq")
        else:
            log("speak: no Groq audio — falling back to espeak-ng")
            self._speak_espeak(text, my_gen)

    def _fetch_groq_tts(self, text, my_gen):
        body = json.dumps({
            "model": TTS_MODEL, "voice": TTS_VOICE, "input": text, "response_format": TTS_FORMAT,
        }).encode()
        headers = {
            "Authorization": "Bearer " + GROQ_KEY,
            "Content-Type": "application/json",
            # Groq's TTS endpoint is behind Cloudflare, which 403s the default
            # "Python-urllib" User-Agent (Cloudflare error 1010). Send a real UA.
            "User-Agent": "curl/8.4.0",
        }
        for attempt in range(5):
            with self.lock:
                if self.gen != my_gen:
                    log("speak: aborted (barge-in) before fetch")
                    return None
            try:
                req = urllib.request.Request(GROQ_TTS_URL, data=body, headers=headers)
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 4:
                    wait = 5 * (attempt + 1)  # 5, 10, 15, 20s backoff
                    log("speak: TTS 429 rate-limited, retry %d in %ds" % (attempt + 1, wait))
                    time.sleep(wait)
                    continue
                sys.stderr.write("TTS fetch failed: %s\n" % e)
                return None
            except Exception as e:
                sys.stderr.write("TTS fetch failed: %s\n" % e)
                return None
        return None

    def _play_wav_bytes(self, audio, my_gen, source):
        with self.lock:
            if self.gen != my_gen:
                log("speak: aborted (barge-in) gen now=%d" % self.gen)
                return
        out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        out.write(audio)
        out.close()
        with self.lock:
            if self.gen != my_gen:
                self._unlink(out.name)
                return
        log("speak: playing %s" % source)
        proc = subprocess.Popen(playback_cmd(out.name), stdout=DEVNULL, stderr=DEVNULL)
        with self.lock:
            self.play_proc = proc
        proc.wait()
        with self.lock:
            self.play_proc = None
        self._unlink(out.name)
        log("speak: done")

    def _speak_espeak(self, text, my_gen):
        """Fallback TTS when Groq is unavailable/rate-limited. Local, instant, no limits."""
        if not shutil.which("espeak-ng"):
            log("speak: espeak-ng not installed — nothing to speak")
            return
        with self.lock:
            if self.gen != my_gen:
                return
        out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        out.close()
        try:
            subprocess.run(["espeak-ng", "-w", out.name, text],
                           stdout=DEVNULL, stderr=DEVNULL, timeout=30)
        except Exception as e:
            log("speak: espeak-ng failed: %s" % e)
            self._unlink(out.name)
            return
        with self.lock:
            if self.gen != my_gen:
                self._unlink(out.name)
                return
        log("speak: playing espeak-ng")
        proc = subprocess.Popen(playback_cmd(out.name), stdout=DEVNULL, stderr=DEVNULL)
        with self.lock:
            self.play_proc = proc
        proc.wait()
        with self.lock:
            self.play_proc = None
        self._unlink(out.name)
        log("speak: espeak done")

    def _unlink(self, path):
        try:
            os.unlink(path)
        except Exception:
            pass

    def _play_tone(self, path):
        """Play a feedback tone. Runs in a thread so GPIO callbacks stay fast."""
        try:
            subprocess.Popen(playback_cmd(path), stdout=DEVNULL, stderr=DEVNULL).wait()
        except Exception:
            pass

    # ── satellite trigger (no local recording/TTS — just poke the audio server) ──
    def _satellite_press(self):
        """POST /press to the audio server so it takes a turn. The audio server
        handles barge-in internally (a press while it's speaking/processing
        interrupts and starts a new turn). Runs in a thread so GPIO callbacks
        stay fast."""
        url = self.audio_server_url.rstrip("/") + "/press"
        try:
            req = urllib.request.Request(url, data=b"", method="POST")
            urllib.request.urlopen(req, timeout=5).read()
            log("satellite press → %s ok" % url)
        except Exception as e:
            log("satellite press failed: %s" % e)

    # ── callbacks (must return fast; slow work goes to a thread) ─────────
    def on_press(self):
        if self.mode in ("satellite", "both"):
            # No local recording/TTS — just tell the audio server to take a turn.
            # The audio server handles barge-in (interrupt + new turn) internally.
            threading.Thread(target=self._satellite_press, daemon=True).start()
            return
        # BARGE-IN: stop any talking, bump generation so stale speaks abort, record.
        with self.lock:
            self.gen += 1
            g = self.gen
        log("press gen=%d" % g)
        self.stop_playback()
        self.start_recording()
        threading.Thread(target=self._play_tone, args=(self.beep_path,), daemon=True).start()

    def on_release(self):
        if self.mode in ("satellite", "both"):
            # Toggle scheme: release is a no-op. The audio server's VAD
            # (record_until_silence) stops each turn's recording naturally.
            return
        with self.lock:
            g = self.gen
        log("release gen=%d" % g)
        path = self.stop_recording()
        if not path or not os.path.exists(path):
            return
        threading.Thread(target=self._play_tone, args=(self.boop_path,), daemon=True).start()
        with self.lock:
            my_gen = self.gen
        since = (datetime.now(timezone.utc) - timedelta(seconds=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        threading.Thread(target=self._process, args=(path, since, my_gen), daemon=True).start()

    def _process(self, path, since, my_gen):
        try:
            self.send_voice(path)
            self.speak_replies(since, my_gen)
        except Exception as e:
            sys.stderr.write("voice loop error: %s\n" % e)
        finally:
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except Exception:
                    pass


def main():
    try:
        from gpiozero import Button
    except Exception as e:
        sys.stderr.write("gpiozero unavailable: %s\n" % e)
        sys.exit(1)
    buttons = [Button(p, pull_up=True) for p in BUTTON_PINS]
    beep_path = make_tone(BEEP_FREQ, BEEP_MS)
    boop_path = make_tone(BOOP_FREQ, BOOP_MS)
    loop = VoiceLoop(buttons[0], beep_path, boop_path, mode=MODE, audio_server_url=AUDIO_SERVER_URL)
    if MODE in ("satellite", "both"):
        log("Graice voice button ready (BCM %s) — %s mode, audio server=%s. Press triggers a turn." % (", ".join(str(p) for p in BUTTON_PINS), MODE.upper(), AUDIO_SERVER_URL or "(unset)"))
    else:
        log("Graice voice button ready (BCM %s) — STANDALONE mode, warden=%s. Hold to talk; press again to interrupt." % (", ".join(str(p) for p in BUTTON_PINS), WARDEN_URL))
    # Level-based push-to-talk: read the pin level directly and record while it
    # is pressed, stop when released. Immune to edge bounce — a transient glitch
    # is ignored unless the level is stable for two consecutive reads (~50ms).
    # Either button works — "pressed" is the OR of all buttons.
    was_pressed = False
    stable = 0
    while True:
        pressed = any(b.is_pressed for b in buttons)
        if pressed == was_pressed:
            stable = 0
        else:
            stable += 1
            if stable >= 2:
                was_pressed = pressed
                stable = 0
                if pressed:
                    loop.on_press()
                else:
                    loop.on_release()
        time.sleep(0.025)


if __name__ == "__main__":
    main()