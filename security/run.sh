#!/usr/bin/env bash
# Run Warden Security Mode with the bundled venv.
# Any args are forwarded to main.py (e.g. --camera 1, --no-voice, --no-window).
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo ">>> .venv missing — creating it and installing requirements"
  python3 -m venv .venv
  . .venv/bin/activate
  pip install -r requirements.txt
else
  . .venv/bin/activate
fi

if [ ! -f config/settings.yaml ]; then
  echo ">>> no config/settings.yaml — using bundled defaults (copy settings.example.yaml to customize)"
fi

exec python main.py "$@"