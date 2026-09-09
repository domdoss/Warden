#!/usr/bin/env bash
# Full toolcall fine-tune run, end to end:
#   venv + deps  →  train (both RTX 5000s via torchrun)  →  pack to Ollama ("toolcall-ft")
#
# One LoRA on Granite 4.1:3b covering the single toolcall agent, iris (byte was
# merged in 2026-09-05; dexter before that). iris = email + digests +
# scheduling/calendar + work management, all single-shot (one tool call per
# request). Idempotent: re-running skips the venv, the dependency install, and
# the llama.cpp build when they're already done. Training always re-runs (it's
# the point); the adapter + merged model are overwritten.
#
# Knobs (env):
#   NPROC      number of GPUs for torchrun            (default: 2)
#   LLAMA_CPP  path to a built llama.cpp checkout      (default: ~/src/llama.cpp)
#   SKIP_DEPS  1 = skip the uv installs                (default: 0)
#   SKIP_PACK  1 = stop after training, don't pack     (default: 0)
#
# Usage:
#   ./run.sh
#   NPROC=2 ./run.sh
#   SKIP_PACK=1 ./run.sh    # train only
set -euo pipefail
cd "$(dirname "$0")"
WORK="$(pwd)"
VENV="$WORK/.venv"
NPROC="${NPROC:-2}"
SKIP_DEPS="${SKIP_DEPS:-0}"
SKIP_PACK="${SKIP_PACK:-0}"
LLAMA_CPP="${LLAMA_CPP:-$HOME/src/llama.cpp}"

phase() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }

# ---- GPU sanity ----------------------------------------------------------
if command -v nvidia-smi >/dev/null 2>&1; then
  ngpus=$(nvidia-smi --query-gpu=index --format=csv,noheader | wc -l)
  phase "GPUs detected: $ngpus (NPROC=$NPROC)"
  nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader
  if [ "$ngpus" -lt "$NPROC" ]; then
    echo "WARNING: only $ngpus GPU(s) found but NPROC=$NPROC — lowering NPROC." >&2
    NPROC="$ngpus"
  fi
else
  echo "WARNING: nvidia-smi not found — training will fail without CUDA." >&2
fi

# ---- 1. venv -------------------------------------------------------------
if [ ! -x "$VENV/bin/python" ]; then
  phase "creating Python 3.12 venv at $VENV (uv)"
  uv venv --python python3.12 "$VENV"
fi
PY="$VENV/bin/python"
UVPIP=(uv pip install --python "$PY")
# Give uv a generous fetch timeout for the big CUDA wheels over a slow link.
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-600}"
# Reduce CUDA fragmentation on the 16 GB cards (set before torch inits).
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# ---- 2. deps -------------------------------------------------------------
if [ "$SKIP_DEPS" != "1" ]; then
  phase "checking PyTorch + CUDA"
  if "$PY" -c "import torch,torch.cuda;assert torch.cuda.is_available()" 2>/dev/null; then
    echo "torch already OK: $("$PY" -c 'import torch;print(torch.__version__)')"
  else
    # Default PyPI torch = the CUDA build (depends on nvidia-*-cu12, fetched from
    # pypi.org). Driver 610.57.04 / CUDA 13.3 supports any cu12x; RTX 5000 is
    # Turing (compute 7.5). NOT using download.pytorch.org/whl/cu121: its nvidia
    # wheels pull from pypi.nvidia.com, which times out on this box. fp16 only
    # (Turing has no native bf16).
    "${UVPIP[@]}" torch
  fi
  phase "installing requirements (+ gguf/sentencepiece for the pack step)"
  "${UVPIP[@]}" -r requirements.txt
  "${UVPIP[@]}" gguf sentencepiece
else
  phase "SKIP_DEPS=1 — skipping uv installs"
fi

# ---- 3. free Ollama VRAM, then train -------------------------------------
# A resident Ollama model (e.g. a 27b) hogs ~10 GB per card and starves the
# 3B LoRA training (needs ~12 GB). Unload every resident model right before
# training so the GPUs are clear; Ollama stays up and reloads on demand later.
# Set UNLOAD_OLLAMA=0 to skip (e.g. if you already freed VRAM manually).
UNLOAD_OLLAMA="${UNLOAD_OLLAMA:-1}"
if [ "$UNLOAD_OLLAMA" = "1" ] && command -v ollama >/dev/null 2>&1; then
  phase "unloading resident Ollama models (free VRAM for training)"
  loaded="$(curl -s http://localhost:11434/api/ps 2>/dev/null | python3 -c 'import sys,json;print("\n".join(m["name"] for m in json.load(sys.stdin).get("models",[])))' 2>/dev/null || true)"
  if [ -n "$loaded" ]; then
    echo "$loaded" | while read -r m; do
      [ -n "$m" ] && { echo "  ollama stop $m"; ollama stop "$m" >/dev/null 2>&1 || true; }
    done
    sleep 2
  else
    echo "  (no models resident)"
  fi
  nvidia-smi --query-gpu=index,memory.used,memory.free --format=csv,noheader
fi

phase "training LoRA across $NPROC GPU(s)"
if [ "$NPROC" -gt 1 ]; then
  "$VENV/bin/torchrun" --nproc_per_node="$NPROC" train_dexter_lora.py
else
  "$PY" train_dexter_lora.py
fi

# ---- 4. pack to Ollama ---------------------------------------------------
if [ "$SKIP_PACK" = "1" ]; then
  phase "SKIP_PACK=1 — stopping after training"
  echo "Merged model at: $WORK/toolcall-lora-merged"
  echo "Pack later: LLAMA_CPP=$LLAMA_CPP ./pack_dexter.sh \"\$WORK/toolcall-lora-merged\" toolcall-ft"
  exit 0
fi

# llama.cpp: clone + build the quantizer with CMake (the Makefile was removed;
# convert_hf_to_gguf.py is pure Python and needs no build). CPU build is enough.
if [ ! -x "$LLAMA_CPP/llama-quantize" ] || [ ! -f "$LLAMA_CPP/convert_hf_to_gguf.py" ]; then
  phase "building llama.cpp at $LLAMA_CPP (one-time, CMake)"
  if [ ! -d "$LLAMA_CPP" ]; then
    git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_CPP"
  fi
  cmake -S "$LLAMA_CPP" -B "$LLAMA_CPP/build" \
    -DGGML_CUDA=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_SERVER=OFF
  cmake --build "$LLAMA_CPP/build" --config Release -j"$(nproc)" --target llama-quantize
  # expose at repo root so pack_dexter.sh ($LLAMA_CPP/llama-quantize) finds it
  ln -sf "$LLAMA_CPP/build/bin/llama-quantize" "$LLAMA_CPP/llama-quantize"
fi
export LLAMA_CPP

phase "packing → Ollama model toolcall-ft"
./pack_dexter.sh "$WORK/toolcall-lora-merged" toolcall-ft

# ---- done ----------------------------------------------------------------
phase "DONE"
cat <<EOF
Next: route the shared Toolcall model to the fine-tune and test.
  1. Dashboard model settings → set the Toolcall model to "toolcall-ft"
     (the single toolcall agent iris; model is dashboard-selected, not env —
     see memory feedback-models-not-in-env).
  2. Test the hard calls (or just run: node dryfire.mjs):
       scheduling:  "every day at 10:30am"    -> cron  30 10 * * *
                    "in 2 minutes"          -> once  PT2M
                    "remind me" (no content) -> asks back, no tool call
       work mgmt:   "add 'fix the bug' to my list" -> create_work_task project_id="personal"
                    "mark Warden as Blocked (proj-…)" -> update_project, one call
       digests run on their own background jobs (never post_summary through iris).
EOF