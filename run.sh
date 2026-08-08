#!/usr/bin/env bash
# Run the Warden audio + video server (the laptop side).
#
# This machine is only the audio (Jarvis voice/hologram) and video (security
# camera) server — the Warden brain runs on another machine, whose IP the
# launcher asks for (it is never baked in here). Audio and video can run
# together or separately, and on different devices (use --audio-only on one
# box and --video-only on another).
#
# Audio I/O (mic + speaker) is chosen independently per side, and each side is
# either LOCAL (this machine) or REMOTE (a satellite relay, e.g. the Pi's
# :8766, satellite/satellite_server.py). Default is fully local; opt in to the
# satellite per side. STT/TTS/UI always run here; only the raw audio for a
# remote side is piped through the relay.
#
# Usage:
#   ./run.sh                                        # launcher: Warden IP, mic/speaker, audio/video/both
#   ./run.sh --local                                # skip launcher: local mic + local speaker + video
#   ./run.sh --remote                               # both mic+speaker via the default satellite
#   ./run.sh --remote <sat-ip>                      # both mic+speaker via <sat-ip>
#   ./run.sh --mic <sat-ip> --speaker local         # remote mic, local speaker
#   ./run.sh --mic local --speaker <sat-ip>         # local mic, remote speaker
#   ./run.sh --mic <sat-ip> --speaker <sat-ip> --warden <warden-ip>
#   ./run.sh --audio-only --remote <sat-ip>
#   ./run.sh --video-only
set -euo pipefail

WARDEN_IP=""
SATELLITE_IP="192.168.0.171"
MIC="local"          # "local" or a satellite IP (remote mic)
SPEAKER="local"      # "local" or a satellite IP (remote speaker)
START_AUDIO=true
START_VIDEO=true
LAUNCH=true

# Normalize a --mic/--speaker value to either "local" or a concrete IP.
#   local | ''        -> local
#   remote            -> $2 (the default satellite IP)
#   remote:<ip> | <ip>-> that IP
normalize_side() {
  case "$1" in
    local|"") echo "local" ;;
    remote)   echo "$2" ;;
    remote:*) echo "${1#remote:}" ;;
    *)        echo "$1" ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    # Both sides remote. Optional IP (anything not starting with '-'); bare
    # --remote uses the default $SATELLITE_IP.
    --remote)
      if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then SATELLITE_IP="$2"; shift; fi
      MIC="$SATELLITE_IP"; SPEAKER="$SATELLITE_IP"; LAUNCH=false; shift ;;
    --remote=*)
      SATELLITE_IP="${1#--remote=}"; MIC="$SATELLITE_IP"; SPEAKER="$SATELLITE_IP"; LAUNCH=false; shift ;;
    --mic)
      MIC="$(normalize_side "${2:-remote}" "$SATELLITE_IP")"; LAUNCH=false; shift; [ $# -gt 0 ] && shift ;;
    --mic=*)
      MIC="$(normalize_side "${1#--mic=}" "$SATELLITE_IP")"; LAUNCH=false; shift ;;
    --speaker)
      SPEAKER="$(normalize_side "${2:-remote}" "$SATELLITE_IP")"; LAUNCH=false; shift; [ $# -gt 0 ] && shift ;;
    --speaker=*)
      SPEAKER="$(normalize_side "${1#--speaker=}" "$SATELLITE_IP")"; LAUNCH=false; shift ;;
    --local)
      MIC="local"; SPEAKER="local"; LAUNCH=false; shift ;;
    --warden)
      WARDEN_IP="${2:-}"; shift; [ $# -gt 0 ] && shift ;;
    --warden=*)
      WARDEN_IP="${1#--warden=}"; shift ;;
    --audio-only)
      START_AUDIO=true; START_VIDEO=false; LAUNCH=false; shift ;;
    --video-only)
      START_AUDIO=false; START_VIDEO=true; LAUNCH=false; shift ;;
    --no-audio)
      START_AUDIO=false; LAUNCH=false; shift ;;
    --no-video)
      START_VIDEO=false; LAUNCH=false; shift ;;
    *)
      echo "[run] unknown arg: $1" >&2; shift ;;
  esac
done

cd "$(dirname "$0")"

# ── Launcher (only when no role flags and stdin is a TTY) ────────────────────
# The Warden URL is NEVER baked in — the Warden runs on another machine, so it
# must be entered here (or passed via --warden). Empty = keep whatever the
# client already has in its settings.yaml.
if [ "$LAUNCH" = true ] && [ -t 0 ]; then
  echo
  echo "=== Warden audio + video server launcher ==="
  read -rp "Warden IP (leave empty to keep current): " _w
  WARDEN_IP="$_w"

  read -rp "Satellite IP (default for remote mic/speaker) [${SATELLITE_IP}]: " _s
  SATELLITE_IP="${_s:-$SATELLITE_IP}"

  echo "Mic source:"
  read -rp "  (1) local  (2) remote [${SATELLITE_IP}] : " _m
  case "$_m" in
    2) read -rp "  Mic IP [${SATELLITE_IP}]: " _mi; MIC="${_mi:-$SATELLITE_IP}" ;;
    *) MIC="local" ;;
  esac

  echo "Speaker source:"
  read -rp "  (1) local  (2) remote [${SATELLITE_IP}] : " _p
  case "$_p" in
    2) read -rp "  Speaker IP [${SATELLITE_IP}]: " _pi; SPEAKER="${_pi:-$SATELLITE_IP}" ;;
    *) SPEAKER="local" ;;
  esac

  read -rp "Start: (1) Audio + Video  (2) Audio only  (3) Video only  (q) Quit [1]: " _c
  case "$_c" in
    2) START_VIDEO=false ;;
    3) START_AUDIO=false ;;
    q|Q) echo "[run] bye."; exit 0 ;;
    *) ;;
  esac
  echo
fi

# Format a side as a main.py --mic/--speaker value: "local" or "remote:<ip>".
side_arg() { [ "$1" = local ] && echo "local" || echo "remote:$1"; }

VOICE_PID=""
SECURITY_PID=""

cleanup() {
  echo "[run] shutting down..."
  if [ -n "$VOICE_PID" ] && kill -0 "$VOICE_PID" 2>/dev/null; then
    kill -TERM "$VOICE_PID" 2>/dev/null || true
  fi
  if [ -n "$SECURITY_PID" ] && kill -0 "$SECURITY_PID" 2>/dev/null; then
    kill -TERM "$SECURITY_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# ── Jarvis voice client (audio server) ───────────────────────────────────────
# STT/TTS/UI run here; mic/speaker are local or piped through the satellite
# relay per --mic/--speaker. --set-warden-url persists the Warden URL to
# voice/config/settings.yaml and exits, so run it first (only when a Warden IP
# was given), then launch the UI with the resolved audio flags.
if [ "$START_AUDIO" = true ]; then
  echo "[run] starting Jarvis voice client — mic=${MIC} speaker=${SPEAKER}..."
  cd voice
  if [ -n "$WARDEN_IP" ]; then
    echo "[run] setting Warden URL → http://${WARDEN_IP}:3200"
    ./.venv/bin/python main.py --set-warden-url "http://${WARDEN_IP}:3200"
  fi
  AUDIO_ARGS=(--mic "$(side_arg "$MIC")" --speaker "$(side_arg "$SPEAKER")")
  ./.venv/bin/python main.py "${AUDIO_ARGS[@]}" &
  VOICE_PID=$!
  cd ..
fi

# ── Security camera (video server) ───────────────────────────────────────────
if [ "$START_VIDEO" = true ]; then
  echo "[run] starting security camera..."
  cd security
  if [ -n "$WARDEN_IP" ]; then
    echo "[run] Warden URL → http://${WARDEN_IP}:3200"
    ./.venv/bin/python main.py --warden-url "http://${WARDEN_IP}:3200" &
  else
    ./.venv/bin/python main.py &
  fi
  SECURITY_PID=$!
  cd ..
fi

# ── Wait for children ───────────────────────────────────────────────────────
PIDS=()
[ -n "$VOICE_PID" ] && PIDS+=("$VOICE_PID")
[ -n "$SECURITY_PID" ] && PIDS+=("$SECURITY_PID")

if [ ${#PIDS[@]} -gt 0 ]; then
  wait -n "${PIDS[@]}"
fi