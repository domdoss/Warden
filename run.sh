#!/usr/bin/env bash
# Run the Warden audio + video server (the laptop side).
#
# This machine is only the audio (Jarvis voice/hologram) and video (security
# camera) server — the Warden brain runs on another machine, whose IP the
# launcher asks for (it is never baked in here). Audio and video can run
# together or separately, and on different devices (use --audio-only on one
# box and --video-only on another).
#
# The voice client streams mic/speaker through the satellite — a remote
# mic/speaker relay (e.g. the Pi's :8766, satellite/satellite_server.py) — and
# sends text to the Warden. The transcription (Whisper) server runs alongside
# the audio server, not here in this script.
#
# Usage:
#   ./run.sh                              # launcher: Warden IP, Satellite IP, audio/video/both
#   ./run.sh --remote <sat-ip>            # skip launcher: audio via satellite + video
#   ./run.sh --remote <sat-ip> --warden <warden-ip>
#   ./run.sh --audio-only --remote <sat-ip>
#   ./run.sh --video-only
set -euo pipefail

WARDEN_IP=""
SATELLITE_IP="192.168.0.171"
START_AUDIO=true
START_VIDEO=true
LAUNCH=true

while [ $# -gt 0 ]; do
  case "$1" in
    --remote) SATELLITE_IP="${2:-$SATELLITE_IP}"; LAUNCH=false; shift; [ $# -gt 0 ] && shift ;;
    --remote=*) SATELLITE_IP="${1#--remote=}"; LAUNCH=false; shift ;;
    --warden) WARDEN_IP="${2:-}"; shift; [ $# -gt 0 ] && shift ;;
    --warden=*) WARDEN_IP="${1#--warden=}"; shift ;;
    --audio-only) START_AUDIO=true; START_VIDEO=false; LAUNCH=false; shift ;;
    --video-only) START_AUDIO=false; START_VIDEO=true; LAUNCH=false; shift ;;
    --no-audio) START_AUDIO=false; LAUNCH=false; shift ;;
    --no-video) START_VIDEO=false; LAUNCH=false; shift ;;
    *) echo "[run] unknown arg: $1" >&2; shift ;;
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
  read -rp "Satellite IP (remote mic/speaker) [${SATELLITE_IP}]: " _s
  SATELLITE_IP="${_s:-$SATELLITE_IP}"
  START_AUDIO=true
  START_VIDEO=true
  read -rp "Start: (1) Audio + Video  (2) Audio only  (3) Video only  (q) Quit [1]: " _c
  case "$_c" in
    2) START_VIDEO=false ;;
    3) START_AUDIO=false ;;
    q|Q) echo "[run] bye."; exit 0 ;;
    *) ;;
  esac
  echo
fi

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
# Streams mic/speaker through the satellite relay and talks to the Warden.
# --set-warden-url persists the Warden URL to voice/config/settings.yaml and
# exits, so run it first (only when a Warden IP was given), then launch the UI
# with --remote <satellite>.
if [ "$START_AUDIO" = true ]; then
  echo "[run] starting Jarvis voice client (audio via satellite ${SATELLITE_IP})..."
  cd voice
  if [ -n "$WARDEN_IP" ]; then
    echo "[run] setting Warden URL → http://${WARDEN_IP}:3200"
    ./.venv/bin/python main.py --set-warden-url "http://${WARDEN_IP}:3200"
  fi
  ./.venv/bin/python main.py --remote "$SATELLITE_IP" &
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