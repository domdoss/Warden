#!/usr/bin/env bash
set -euo pipefail

export DOCKBOX_BASE_URL="${WARDEN_URL:-http://127.0.0.1:3200}"
export SATELLITE_URL="${SATELLITE_URL:-http://127.0.0.1:8766}"

REMOTE_ARG=""
if [ -n "${SATELLITE_URL:-}" ]; then
  # main.py --remote expects a bare host/IP, not a full URL.
  sat_host=$(printf '%s' "$SATELLITE_URL" | sed -E 's#^https?://##; s#:.*##; s#/.*##')
  REMOTE_ARG="--remote $sat_host"
fi

cd /app/voice

if [ $# -gt 0 ]; then
  exec "$@"
else
  exec python3 main.py $REMOTE_ARG
fi
