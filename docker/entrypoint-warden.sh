#!/usr/bin/env bash
set -euo pipefail

# Default bind port.
export STATUS_PORT="${STATUS_PORT:-3200}"

# Mirror configurable role URLs into the runtime environment so the code's
# env-fallback path picks them up until the consolidated settings store lands.
[ -n "${WARDEN_URL:-}" ] && export DOCKBOX_BASE_URL="$WARDEN_URL"
[ -n "${OLLAMA_URL:-}" ] && export OLLAMA_URL="$OLLAMA_URL"
if [ -n "${VIDEO_URL:-}" ]; then
  # Current code expects just the host (it appends :8765 itself).
  host=$(printf '%s' "$VIDEO_URL" | sed -E 's#^https?://##; s#:.*##; s#/.*##')
  export WARDEN_SECURITY_SATELLITE_IP="$host"
fi
[ -n "${WHISPER_URL:-}" ] && export WHISPER_URL="$WHISPER_URL"

# Ensure runtime directories exist.
mkdir -p /app/data /app/store /app/groups /app/logs /app/uploads /app/tmp

cd /app
exec "$@"
