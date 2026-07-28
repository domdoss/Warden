#!/usr/bin/env bash
# Run Warden desktop + Jarvis voice client together.
# The voice client gives Jarvis ears (mic/Whisper) and mouth (Kokoro TTS).
# The Warden server gives Jarvis the brain; the security camera gives it eyes.
#
# Usage:
#   ./run.sh              # start server + voice + security
#   ./run.sh --no-server  # start only the voice client + security
#   ./run.sh --no-voice   # start only the Warden server + security
#   ./run.sh --no-security # start server + voice only
set -euo pipefail

NO_SERVER=false
NO_VOICE=false
NO_SECURITY=false
for arg in "$@"; do
  case "$arg" in
    --no-server) NO_SERVER=true ;;
    --no-voice) NO_VOICE=true ;;
    --no-security) NO_SECURITY=true ;;
  esac
done

cd "$(dirname "$0")"

SERVER_PID=""
VOICE_PID=""
SECURITY_PID=""

cleanup() {
  echo "[run] shutting down..."
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$VOICE_PID" ] && kill -0 "$VOICE_PID" 2>/dev/null; then
    kill -TERM "$VOICE_PID" 2>/dev/null || true
  fi
  if [ -n "$SECURITY_PID" ] && kill -0 "$SECURITY_PID" 2>/dev/null; then
    kill -TERM "$SECURITY_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# ── Warden server ───────────────────────────────────────────────────────────
if [ "$NO_SERVER" = false ]; then
  if systemctl --user is-active warden >/dev/null 2>&1; then
    echo "[run] Warden systemd service already running"
  else
    echo "[run] starting Warden server..."
    if [ ! -d node_modules ]; then
      echo "[run] node_modules missing — run npm install first"
      exit 2
    fi
    if [ ! -f dist/index.js ]; then
      echo "[run] dist/index.js missing — running npm run build"
      npm run build
    fi
    node dist/index.js &
    SERVER_PID=$!
    for _ in $(seq 1 30); do
      if curl -fsS http://127.0.0.1:3200/api/status >/dev/null 2>&1; then
        echo "[run] Warden server ready"
        break
      fi
      sleep 1
    done
  fi
fi

# ── Jarvis voice client ─────────────────────────────────────────────────────
if [ "$NO_VOICE" = false ]; then
  echo "[run] starting Jarvis voice client..."
  cd voice
  ./.venv/bin/python main.py &
  VOICE_PID=$!
  cd ..
fi

# ── Security camera / awareness ─────────────────────────────────────────────
if [ "$NO_SECURITY" = false ]; then
  echo "[run] starting security camera..."
  cd security
  ./.venv/bin/python main.py &
  SECURITY_PID=$!
  cd ..
fi

# ── Wait for children ───────────────────────────────────────────────────────
PIDS=()
[ -n "$SERVER_PID" ] && PIDS+=("$SERVER_PID")
[ -n "$VOICE_PID" ] && PIDS+=("$VOICE_PID")
[ -n "$SECURITY_PID" ] && PIDS+=("$SECURITY_PID")

if [ ${#PIDS[@]} -gt 0 ]; then
  wait -n "${PIDS[@]}"
fi