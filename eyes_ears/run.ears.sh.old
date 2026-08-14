#!/usr/bin/env bash
# run.sh — the Jarvis voice entrypoint.
#
# The voice app (STT + TTS + UI + Warden bridge) always runs locally; only the
# audio I/O can be local or remote, and mic/speaker can be chosen independently:
#
#   ./run.sh                                            # fully local (default)
#   ./run.sh --remote                                   # mic+speaker on the default Pi
#   ./run.sh --remote 192.168.0.171                     # mic+speaker on a given Pi
#   ./run.sh --mic remote:192.168.0.171 --speaker local # Pi mic, desk speaker
#   ./run.sh --mic local --speaker remote:192.168.0.171# desk mic, Pi speaker
#
# The Pi (the "satellite") runs the dumb audio relay (satellite/satellite_server.py),
# a pure PipeWire-CLI HTTP pipe. Launch that relay on the Pi itself with:
#
#   ./run.sh --satellite            # (optional --host/--port forwarded)
#
# TTS engine/voice are env-driven (defaults: kokoro / af_bella):
#
#   TTS_ENGINE=orpheus_cpp KOKORO_VOICE=zoe ./run.sh ...
#
# Any other args are forwarded to main.py (e.g. --control-port).
set -euo pipefail

# Always run from the voice/ directory this script lives in.
cd "$(dirname "$0")"

# ── --satellite: run the dumb audio relay on THIS machine ────────────────────
# The relay is stdlib-only (pw-record/pw-play): no venv, no GPU env. Short-circuit
# before the voice-client setup so it runs on a bare Pi with no voice/.venv.
for a in "$@"; do
  if [ "$a" = "--satellite" ]; then SATELLITE_MODE=1; fi
done
if [ "${SATELLITE_MODE:-0}" = 1 ]; then
  SAT_BIN="$PWD/../satellite/satellite_server.py"
  if [ ! -f "$SAT_BIN" ]; then
    echo "[run.sh] satellite relay not found at $SAT_BIN" >&2
    exit 1
  fi
  # Forward everything except --satellite (e.g. --host 0.0.0.0 --port 8766).
  fwd=()
  for a in "$@"; do [ "$a" != "--satellite" ] && fwd+=("$a"); done
  echo "[run.sh] satellite audio relay mode — pw-record/pw-play on :8766"
  exec python3 "$SAT_BIN" "${fwd[@]}"
fi

# ── voice client mode ─────────────────────────────────────────────────────────
VENV=".venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "[run.sh] voice venv not found at $VENV/bin/python" >&2
  echo "[run.sh] create it first (see voice/requirements)" >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$VENV/bin/activate"

# Point PyTorch's bundled rocBLAS at the system library for gfx906 kernels.
export ROCBLAS_TENSILE_LIBPATH="${ROCBLAS_TENSILE_LIBPATH:-/opt/rocm/lib/rocblas/library}"
# Persist compiled GPU kernels so startup is fast after the first run.
export MIOPEN_CACHE_DIR="${MIOPEN_CACHE_DIR:-$HOME/.cache/miopen}"
export MIOPEN_FIND_MODE="${MIOPEN_FIND_MODE:-1}"  # 1 = use cache, don't re-benchmark

# Qt WebEngine (Chromium) startup flags. The cold load was dominated by
# per-window renderer-process init: --password-store=basic skips the slow
# kwallet/gnome-keyring D-Bus probe, --no-sandbox skips sandbox setup, and
# --allow-file-access-from-files lets the combined panels.html host share
# the pywebview JS bridge with its file:// iframes (same-origin). The panels
# are also collapsed into one window in jarvis_window.py, so there are 2
# renderer processes total instead of 5.
export QTWEBENGINE_CHROMIUM_FLAGS="${QTWEBENGINE_CHROMIUM_FLAGS:---no-sandbox --password-store=basic --allow-file-access-from-files}"

# Default satellite (Pi) IP for bare --remote / --mic remote / --speaker remote.
# Override with ORPHEUS_REMOTE or by passing an explicit host on the flag.
export SATELLITE_IP="${ORPHEUS_REMOTE:-192.168.0.171}"

# Persist the TTS engine + voice from env (defaults: kokoro / af_heart) so the
# in-process TTS picks them up at launch.
TTS_ENGINE="${TTS_ENGINE:-kokoro}"
VOICE="${KOKORO_VOICE:-af_heart}" python - <<'PY'
import os
from core.config import Config
c = Config()
c.set("voice.tts_engine", os.environ["TTS_ENGINE"])
c.set("voice.tts_voice", os.environ["VOICE"])
c.save()
print(f"[run.sh] tts_engine={os.environ['TTS_ENGINE']} voice={os.environ['VOICE']}")
PY

# If the caller gave no audio-mode flag, default to fully local (desk mic +
# desk speaker). Otherwise forward the flags untouched; main.py resolves bare
# --remote / --mic remote / --speaker remote against $SATELLITE_IP.
has_audio=0
for a in "$@"; do
  case "$a" in --mic|--speaker|--remote) has_audio=1 ;; esac
done

if [ "$has_audio" -eq 0 ]; then
  echo "[run.sh] launching Jarvis voice — local mic + local speaker (Kokoro on GPU)."
  exec python main.py --mic local --speaker local "$@"
fi

echo "[run.sh] launching Jarvis voice — audio flags: $* (Kokoro on GPU)."
exec python main.py "$@"