#!/usr/bin/env bash
set -euo pipefail

export WARDEN_URL="${WARDEN_URL:-http://127.0.0.1:3200}"
export OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
export FRAME_SERVER_HOST="${FRAME_SERVER_HOST:-0.0.0.0}"
export FRAME_SERVER_PORT="${FRAME_SERVER_PORT:-8765}"
export CAMERA_INDEX="${CAMERA_INDEX:-0}"

cfg=/app/security/config/settings.yaml
mkdir -p "$(dirname "$cfg")"

cat > "$cfg" <<EOF
camera:
  index: ${CAMERA_INDEX}
  width: 640
  height: 480
  fps: 3

model:
  variant: keypoint
  size: small
  threshold: 0.5

motion:
  blur: 21
  pixel_threshold: 25
  min_area: 800

awareness:
  enabled: true
  cooldown_seconds: 30
  presence_debounce: 6
  absence_debounce: 9
  motion_min_area: 1500
  motion_movement_px: 80
  camera_moved_threshold: 16
  camera_moved_history: 5
  object_min_confidence: 0.2
  covered_std: 6
  covered_frames: 3
  empty_threshold_seconds: 60

recognition:
  method: insightface
  device: cuda
  match_threshold: 0.42
  min_face_size: 60
  overlay_interval_seconds: 0.5

caption:
  enabled: false
  ollama_url: ${OLLAMA_URL}
  model: gemma3:4b
  timeout_seconds: 60

warden:
  base_url: ${WARDEN_URL}
  owner_jid: owner@local

frame_server:
  host: ${FRAME_SERVER_HOST}
  port: ${FRAME_SERVER_PORT}

logging:
  level: INFO
EOF

cd /app/security
if [ $# -gt 0 ]; then
  exec "$@"
else
  exec python3 main.py --config "$cfg"
fi
