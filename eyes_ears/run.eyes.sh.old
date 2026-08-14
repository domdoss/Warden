#!/usr/bin/env bash
# Run Warden Security Mode.
# Any args are forwarded to main.py (e.g. --camera 1, --stream URL, --no-window).
set -euo pipefail

cd "$(dirname "$0")"

source ".venv/bin/activate"

if [ ! -f config/settings.yaml ]; then
  echo "&>&> no config/settings.yaml — using bundled defaults (copy settings.example.yaml to customize)"
fi

exec python main.py "$@"
