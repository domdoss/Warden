#!/usr/bin/env bash
# eyes_ears/run.sh — ONE interactive, role-flexible entrypoint for both apps.
#
# Roles are NOT bound to machines. This script can run any of them on THIS
# machine, and asks for the IPs/URLs of the OTHER roles (the Warden server,
# the satellite) so nothing is hardcoded:
#
#   - Eyes  (Oculus detector): owns the webcam, runs RF-DETR + motion, serves
#           frames on :8765, POSTs AWARENESS to the Warden server. Background
#           awareness (describe + comment) runs here when eyes start.
#   - Ears  (voice + UI): STT/TTS + the hologram UI + Warden chat bridge. Audio
#           I/O is local by default; --remote uses the satellite relay.
#   - Satellite: a dumb mic/speaker relay (../satellite/satellite_server.py,
#           :8766). Stdlib-only — no venv, no GPU.
#
#   ./run.sh                       # interactive menu
#   ./run.sh --eyes                # eyes only (Oculus detector)
#   ./run.sh --ears                # ears only (voice + UI), local audio
#   ./run.sh --ears --remote       # ears, mic+speaker on the satellite
#   ./run.sh --both                # eyes (background) + ears (foreground)
#   ./run.sh --satellite           # this machine is the audio relay
#   ./run.sh --configure           # set warden.base_url / satellite.host / ...
#   ./run.sh --tts kokoro --tts-device cpu --ears   # quick engine/device switch
#                                    (persisted to config; --tts takes
#                                     kokoro|orpheus_cpp|orpheus, --tts-device
#                                     takes cpu|cuda for kokoro, or
#                                     both|cuda:0|cuda:1|cpu for orpheus_cpp)
#
# Any other args forward to the app (e.g. --camera 1, --no-window, --mic local).
set -euo pipefail

cd "$(dirname "$0")"

# ── --satellite: run the dumb audio relay on THIS machine ────────────────────
# Stdlib-only (pw-record/pw-play): short-circuit before the venv so it runs on
# a bare machine with no eyes_ears/.venv.
for a in "$@"; do
  if [ "$a" = "--satellite" ]; then SATELLITE_MODE=1; fi
done
if [ "${SATELLITE_MODE:-0}" = 1 ]; then
  SAT_BIN="$PWD/../satellite/satellite_server.py"
  if [ ! -f "$SAT_BIN" ]; then
    echo "[run.sh] satellite relay not found at $SAT_BIN" >&2
    exit 1
  fi
  fwd=()
  for a in "$@"; do [ "$a" != "--satellite" ] && fwd+=("$a"); done
  echo "[run.sh] satellite audio relay mode — pw-record/pw-play on :8766"
  exec python3 "$SAT_BIN" "${fwd[@]}"
fi

# ── venv (shared by eyes + ears) ─────────────────────────────────────────────
VENV=".venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "[run.sh] venv not found at $VENV/bin/python" >&2
  echo "[run.sh] create it:  python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$VENV/bin/activate"

# CUDA 12 runtime for the orpheus_cpp TTS engine. Its llama-cpp-python cu124
# wheel does not bundle libcudart/libcublas — they come from the nvidia-*-cu12
# pip packages inside the venv. Prepend (not append) so the system's CUDA 13
# in /opt/cuda can never satisfy the .so.12 sonames. Silent no-op when those
# packages aren't installed (e.g. kokoro-only install).
EE_SITE_PKGS="$(python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])' 2>/dev/null || true)"
if [ -n "$EE_SITE_PKGS" ]; then
  for d in "$EE_SITE_PKGS/nvidia/cuda_runtime/lib" "$EE_SITE_PKGS/nvidia/cublas/lib"; do
    if [ -d "$d" ]; then
      LD_LIBRARY_PATH="$d${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    fi
  done
  export LD_LIBRARY_PATH
fi
unset EE_SITE_PKGS d

# Qt WebEngine (Chromium) flags for the ears UI (pywebview). --no-sandbox +
# --password-store=basic skip slow kwallet/keyring probes; --allow-file-access-
# from-files lets the combined panels host share its JS bridge with file:// iframes.
export QTWEBENGINE_CHROMIUM_FLAGS="${QTWEBENGINE_CHROMIUM_FLAGS:---no-sandbox --password-store=basic --allow-file-access-from-files}"

# ── TUI presentation (ANSI — strictly cosmetic, no behavior change) ──────────
if [ -t 1 ]; then
  R=$'\033[0m' D=$'\033[2m'
  CY=$'\033[36m' MG=$'\033[35m' GR=$'\033[32m' YL=$'\033[33m' RD=$'\033[31m' BL=$'\033[34m' WH=$'\033[97m'
  BCY=$'\033[1;36m' BMG=$'\033[1;35m' BGR=$'\033[1;32m' BYL=$'\033[1;33m' BRD=$'\033[1;31m' BWH=$'\033[1;97m'
else
  R='' D='' CY='' MG='' GR='' YL='' RD='' BL='' WH='' BCY='' BMG='' BGR='' BYL='' BRD='' BWH=''
fi
COLS=$(tput cols 2>/dev/null || echo 80)
rule() { local w="${COLS:-80}" ch="${1:-─}"; printf "%${w}s\n" "" | sed "s/ /${ch}/g"; }

# ── configure: write config/settings.yaml interactively ─────────────────────
do_configure() {
  python -c "$(cat <<'PY'
from core.config import Config
c = Config()

R="\033[0m"; B="\033[1m"; D="\033[2m"; CY="\033[36m"; MG="\033[35m"; GR="\033[32m"; YL="\033[33m"
def hdr(t): print(f"{MG}{B}{t}{R}")

def ask(label, cur, default=""):
    cur = "" if cur is None else str(cur)
    s = input(f"  {label} [{cur}]: ").strip()
    return s if s else (cur or default)

print(f"{CY}{B}[configure] eyes_ears config{R} — press Enter to keep the current {D}[value]{R}.")
print()
hdr("Warden server (the Node brain; whichever machine runs it):")
c.set("warden.base_url", ask("warden.base_url", c.get("warden.base_url")))
c.set("warden.owner_jid", ask("warden.owner_jid", c.get("warden.owner_jid"), "owner@local"))
print()
hdr("Frame server (Eyes binds here so the Warden server can pull frames):")
c.set("frame_server.host", ask("frame_server.host", c.get("frame_server.host"), "0.0.0.0"))
c.set("frame_server.port", int(ask("frame_server.port", c.get("frame_server.port"), 8765) or 8765))
print()
hdr("Satellite (remote audio relay; whichever machine runs it):")
c.set("satellite.host", ask("satellite.host", c.get("satellite.host")))
c.set("satellite.port", int(ask("satellite.port", c.get("satellite.port"), 8766) or 8766))
ptt = ask("satellite.push_to_talk (true/false)", c.get("satellite.push_to_talk"), "true").lower()
c.set("satellite.push_to_talk", ptt in ("true", "1", "yes", "y"))
print()
hdr("Ears voice:")
eng = ask("voice.tts_engine (kokoro|orpheus_cpp|orpheus)", c.get("voice.tts_engine"), "kokoro")
c.set("voice.tts_engine", eng)
voice_default = "af_heart" if eng == "kokoro" else "zoe"
c.set("voice.tts_voice", ask("voice.tts_voice", c.get("voice.tts_voice"), voice_default))
if eng == "kokoro":
    # Kokoro is tiny (82M); either is fine. cuda frees the CPU, cpu leaves the
    # GPU alone for other models. cpu also sidesteps STT/TTS GPU contention.
    c.set("voice.tts_device", ask("voice.tts_device (cpu|cuda)", c.get("voice.tts_device"), "cpu"))
else:
    # orpheus_cpp: cuda:N pins one card; "both" layer-splits across all NVIDIA
    # cards; cpu is a last resort (very slow). vLLM "orpheus" is CUDA-only.
    c.set("voice.tts_device", ask("voice.tts_device (both|cuda:0|cuda:1|cpu)", c.get("voice.tts_device"), "both"))
print()
hdr("Oculus background awareness (describe + comment on motion when eyes run):")
ba = ask("oculus.background_awareness (true/false)", c.get("oculus.background_awareness"), "true").lower()
c.set("oculus.background_awareness", ba in ("true", "1", "yes", "y"))

c.save()
print()
print(f"{GR}{B}[configure] saved to{R} {c.user_path}")
PY
  )"
  exit 0
}

# ── arg parsing ──────────────────────────────────────────────────────────────
# Pre-scan the run.sh-owned flags that take a value (the main loop below only
# sees valueless flags and forwards everything else to the app). --tts and
# --tts-device persist to config/settings.yaml, then are consumed (not
# forwarded — ears.main doesn't know them).
TTS_ENGINE=""
TTS_DEVICE=""
TTS_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --tts)        TTS_ENGINE="${2:-}"; shift 2 ;;
    --tts=*)      TTS_ENGINE="${1#--tts=}"; shift ;;
    --tts-device) TTS_DEVICE="${2:-}"; shift 2 ;;
    --tts-device=*) TTS_DEVICE="${1#--tts-device=}"; shift ;;
    *)            TTS_ARGS+=("$1"); shift ;;
  esac
done
set -- ${TTS_ARGS[@]+"${TTS_ARGS[@]}"}

MODE=""
HAS_AUDIO=0
BG_AWARENESS=""  # "" = use config; "1" = force on; "0" = force off
FWD=()
for a in "$@"; do
  case "$a" in
    --eyes)    MODE="eyes" ;;
    --ears)    MODE="ears" ;;
    --both)    MODE="both" ;;
    --ui-only) MODE="ui" ;;
    --satellite) ;;  # handled above
    --configure) MODE="configure" ;;
    --background-awareness)    BG_AWARENESS="1" ;;
    --no-background-awareness) BG_AWARENESS="0" ;;
    --mic|--speaker|--remote) HAS_AUDIO=1; FWD+=("$a") ;;
    *) FWD+=("$a") ;;
  esac
done

# Apply the background-awareness override (config + env for the eyes app).
if [ -n "$BG_AWARENESS" ]; then
  python -c "from core.config import Config; c=Config(); c.set('oculus.background_awareness', $BG_AWARENESS=='1'); c.save()" 2>/dev/null || true
fi
export OCULUS_BACKGROUND_AWARENESS="$BG_AWARENESS"

# Persist --tts/--tts-device overrides to config/settings.yaml before launch so
# both apps see them. Also keeps the voice sensible when switching engine
# families (kokoro voices like af_heart don't exist in Orpheus and vice versa).
if [ -n "$TTS_ENGINE" ] || [ -n "$TTS_DEVICE" ]; then
  python - "$TTS_ENGINE" "$TTS_DEVICE" <<'PY'
import sys
from core.config import Config
c = Config()
eng, dev = sys.argv[1], sys.argv[2]
KOKORO = {"af_heart", "am_michael", "bm_george", "af_bella"}
ORPHEUS = {"tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"}
if eng:
    c.set("voice.tts_engine", eng)
    cur = c.get("voice.tts_voice")
    if eng == "kokoro" and (not cur or cur in ORPHEUS):
        c.set("voice.tts_voice", "af_heart")
    elif eng != "kokoro" and (not cur or cur in KOKORO):
        c.set("voice.tts_voice", "zoe")
if dev:
    c.set("voice.tts_device", dev)
c.save()
print(f"[run.sh] tts: engine={c.get('voice.tts_engine')} voice={c.get('voice.tts_voice')} device={c.get('voice.tts_device')}")
PY
fi

# ── interactive menu (no mode arg) ───────────────────────────────────────────
if [ -z "$MODE" ] && [ $# -eq 0 ]; then
  clear
  printf '%s' "$BCY"
  cat <<'BAN'
█████  █   █  █████   ████     ██      █████    ██   ████    ████
█       █ █   █      █        █  █     █       █  █  █   █  █
█████    █    █████   ███     █  █     █████  █████  ████    ███
█        █    █          █     ███     █      █  █   █ █        █
█████    █    █████  ████        █     █████  █  █   █  █   ████
BAN
  printf '%s\n\n' "$R"
  printf '  %swhat does THIS machine run?%s\n\n' "$BMG" "$R"
  rule
  printf '  %s1%s) %sEyes%s      %sOculus detector + frame server, background awareness%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '  %s2%s) %sEars%s      %svoice + UI, local mic + speaker%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '  %s3%s) %sBoth%s      %seyes in background, ears in foreground%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '  %s4%s) %sSatellite%s  %sthis machine is the audio relay on :8766%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '  %s5%s) %sUI only%s   %shologram + panels + text chat, no audio routing%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '  %s6%s) %sConfigure%s  %sset warden.base_url / satellite.host / oculus toggle%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '  %s7%s) %sQuit%s\n' "$BYL" "$R" "$BWH" "$R"
  rule
  read -r -p "$(printf '%s▶ %s' "$BGR" "$R")" choice
  case "$choice" in
    1) MODE="eyes" ;;
    2) MODE="ears" ;;
    3) MODE="both" ;;
    4) MODE="satellite" ;;
    5) MODE="ui" ;;
    6) MODE="configure" ;;
    7) exit 0 ;;
    *) printf '%s[run.sh] invalid choice%s\n' "$BRD" "$R"; exit 1 ;;
  esac
fi

case "$MODE" in
  configure) do_configure ;;
  satellite)
    SAT_BIN="$PWD/../satellite/satellite_server.py"
    [ -f "$SAT_BIN" ] || { echo "[run.sh] satellite relay not found at $SAT_BIN" >&2; exit 1; }
    echo "[run.sh] satellite audio relay mode — pw-record/pw-play on :8766"
    exec python3 "$SAT_BIN" "${FWD[@]}"
    ;;
esac

# ── audio source (ears) ─────────────────────────────────────────────────────
# No silent default. When no explicit --mic/--speaker/--remote is given, the
# user chooses Local or Satellite. Satellite requires a configured
# satellite.host — no fallback, no hardcoded IP; if it isn't set, refuse and
# point at --configure rather than guessing.
prompt_audio_source() {
  printf '\n  %sAudio source%s\n\n' "$BMG" "$R"
  printf '  %s1%s) %sLocal%s      %sthis machine'\''s mic + speaker%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '  %s2%s) %sSatellite%s  %sremote Pi relay — needs satellite.host configured%s\n' "$BYL" "$R" "$BWH" "$R" "$D" "$R"
  printf '\n'
  read -r -p "$(printf '%s▶ %s' "$BGR" "$R")" ac
  case "$ac" in
    1) AUDIO_ARGS=(--mic local --speaker local) ;;
    2)
      sat="$(python -c 'from core.config import Config; print(Config().get("satellite.host") or "")' 2>/dev/null || echo '')"
      if [ -z "$sat" ]; then
        printf '%s[run.sh] satellite.host is not configured. Run '\''./run.sh --configure'\'' (Satellite → host) first, then pick Satellite.%s\n' "$BRD" "$R" >&2
        exit 1
      fi
      AUDIO_ARGS=(--remote "$sat")
      ;;
    *) printf '%s[run.sh] invalid choice%s\n' "$BRD" "$R"; exit 1 ;;
  esac
}

# ── launch ───────────────────────────────────────────────────────────────────
launch_eyes() {
  printf '%s▶ launching Eyes%s %sOculus detector%s — %s%s%s\n' "$BCY" "$R" "$BWH" "$R" "$D" "${FWD[*]:-no extra args}" "$R"
  exec python -m eyes.main "${FWD[@]}"
}

launch_ears() {
  if [ "$HAS_AUDIO" -eq 0 ]; then prompt_audio_source; else AUDIO_ARGS=(); fi
  printf '%s▶ launching Ears%s %svoice + UI%s — %s%s%s\n' "$BCY" "$R" "$BWH" "$R" "$D" "${AUDIO_ARGS[*]:-explicit flags}" "$R"
  exec python -m ears.main "${AUDIO_ARGS[@]}" "${FWD[@]}"
}

launch_ui() {
  printf '%s▶ launching UI only%s %shologram + panels + text chat, no audio%s\n' "$BCY" "$R" "$D" "$R"
  exec python -m ears.main --ui-only "${FWD[@]}"
}

case "$MODE" in
  eyes) launch_eyes ;;
  ears) launch_ears ;;
  ui) launch_ui ;;
  both)
    printf '%s▶ launching Both%s — %sEyes%s (background) + %sEars%s (foreground).%s\n' "$BCY" "$R" "$D" "$BWH" "$R" "$BWH" "$R"
    python -m eyes.main "${FWD[@]}" &
    EYES_PID=$!
    trap 'kill $EYES_PID 2>/dev/null || true' EXIT INT TERM
    if [ "$HAS_AUDIO" -eq 0 ]; then prompt_audio_source; else AUDIO_ARGS=(); fi
    python -m ears.main "${AUDIO_ARGS[@]}" "${FWD[@]}"
    ;;
  *) printf '%s[run.sh] unknown mode: %s%s\n' "$BRD" "$MODE" "$R" >&2; exit 1 ;;
esac