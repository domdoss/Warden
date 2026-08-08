#!/usr/bin/env bash
# run.sh — launch the Jarvis voice app with Kokoro TTS (GPU via ROCm).
#
# Kokoro is a small (82M) TTS model that runs on the AMD Radeon VII via
# PyTorch ROCm. The PyTorch ROCm wheel bundles rocBLAS without gfx906 kernels;
# ROCBLAS_TENSILE_LIBPATH points to the system rocBLAS which has full gfx906
# support. Triton (NVIDIA-only) must NOT be installed — it segfaults on AMD.
#
# Any extra args are forwarded to main.py (e.g. --remote <pi-ip> for satellite).
set -euo pipefail

# Always run from the voice/ directory this script lives in.
cd "$(dirname "$0")"

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

# The Pi is the satellite (mic + speaker relay, satellite_server.py on :8766).
REMOTE_IP="${ORPHEUS_REMOTE:-192.168.0.171}"

# Persist Kokoro as the TTS engine.
VOICE="${KOKORO_VOICE:-af_bella}" python - <<'PY'
from core.config import Config
c = Config()
c.set("voice.tts_engine", "kokoro")
c.set("voice.tts_voice", __import__("os").environ["VOICE"])
c.save()
print(f"[run.sh] tts_engine=kokoro voice={__import__('os').environ['VOICE']}")
PY

echo "[run.sh] launching Jarvis voice — Kokoro on GPU, satellite audio at $REMOTE_IP."
exec python main.py --remote "$REMOTE_IP" "$@"
