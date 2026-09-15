#!/usr/bin/env bash
# Steve — the standalone big-button voice app. Launched at login by
# ~/.config/autostart/warden-ears.desktop (this replaces the old full
# eyes_ears stack autostart).
set -euo pipefail
cd "$(dirname "$0")"

VENV=".venv"
PY=""
if [ -x "$VENV/bin/python" ]; then
  PY="$VENV/bin/python"
elif [ -x "$HOME/.venv/bin/python" ]; then
  # .venv missing or a dead symlink (git may ship it pointing at
  # ../voice/.venv, which machines without the old ears stack don't
  # have). Fall back to the shared voice-stack venv that setup-venv.sh
  # builds from anyway — never crash-loop the login app over a symlink.
  echo "[run-steve.sh] .venv unusable — falling back to ~/.venv" >&2
  PY="$HOME/.venv/bin/python"
else
  echo "[run-steve.sh] no usable venv — run ./setup-venv.sh first" >&2
  exit 1
fi

# Same Qt WebEngine flags run.sh set for the old ears UI — pywebview's
# window needs them (sandbox/kwallet probes stall headless-ish autostart).
export QTWEBENGINE_CHROMIUM_FLAGS="${QTWEBENGINE_CHROMIUM_FLAGS:---no-sandbox --password-store=basic --allow-file-access-from-files}"
export PYTHONUNBUFFERED=1

exec "$PY" steve.py "$@"