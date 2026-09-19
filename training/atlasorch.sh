#!/usr/bin/env bash
# Full ORCHATLAS fine-tune run, end to end:
#   venv check  →  seq-length measure  →  train (both RTX 5000s)  →  pack to Ollama ("orchatlas-ft")
#
# One LoRA on granite-4.2-8b for the MERGED orchestrator+atlas seat: the seat
# that talks to the captain, drives the machine with its own hands, and hands
# the rest to the crew (iris, vulkan, artemis, sentry, the Council). Data is
# training/orchatlas-sft.jsonl — the hand-written part files under
# orchatlas-parts/, merged (and validated) by merge_orchatlas_parts.mjs.
#
# This is the 8b sibling of run.sh (which trains the 3b toolcall model for
# iris). Kept separate on purpose: different base, different dataset, a much
# longer sequence, and its own Ollama model name — running one must never
# overwrite the other's adapter or merged output.
#
# Idempotent except for training itself: the adapter and merged model are
# overwritten on every run.
#
# Knobs (env):
#   NPROC        GPUs for torchrun                      (default: 2)
#   MAX_LEN      sequence cap; blank = measure the data (see below)
#   BATCH        per-device batch                       (default: 1)
#   GRAD_ACCUM   gradient accumulation steps            (default: 2)
#   EPOCHS       passes over the data                   (trainer default if unset)
#   REMERGE      1 = re-run the parts merge first       (default: 1)
#   SKIP_PACK    1 = stop after training                (default: 0)
#   UNLOAD_OLLAMA 0 = keep resident Ollama models       (default: 1)
#   LLAMA_CPP    path to a built llama.cpp checkout     (default: ~/src/llama.cpp)
#
# MAX_LEN matters more here than anywhere else in this directory. Every row
# carries the whole 57-tool schema block, so the SHORTEST row is already far
# past the trainer's 6144 default — and the trainer left-truncates, which would
# amputate the system prompt and the tool schemas from every single example
# while still reporting a clean run. Left unset, this script measures the real
# dataset with check_seqlen.py and rounds the max up to the next multiple of
# 256, so the cap can never silently clip a row.
#
# Usage:
#   ./atlasorch.sh
#   SKIP_PACK=1 ./atlasorch.sh          # train only
#   MAX_LEN=11904 ./atlasorch.sh        # skip the measuring pass
#   REMERGE=0 ./atlasorch.sh            # train the jsonl exactly as it stands
set -euo pipefail
cd "$(dirname "$0")"
WORK="$(pwd)"
VENV="$WORK/.venv"
NPROC="${NPROC:-2}"
BATCH="${BATCH:-1}"
GRAD_ACCUM="${GRAD_ACCUM:-2}"
REMERGE="${REMERGE:-1}"
SKIP_PACK="${SKIP_PACK:-0}"
UNLOAD_OLLAMA="${UNLOAD_OLLAMA:-1}"
LLAMA_CPP="${LLAMA_CPP:-$HOME/src/llama.cpp}"

BASE_MODEL="ibm-granite/granite-4.2-8b"
DATA="$WORK/orchatlas-sft.jsonl"
OUT="$WORK/orchatlas-lora"
MERGED="$WORK/orchatlas-lora-merged"
OLLAMA_NAME="orchatlas-ft"

phase() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }

PY="$VENV/bin/python"
if [ ! -x "$PY" ]; then
  echo "ERROR: no venv at $VENV — run ./run.sh once (it creates the venv and installs deps)." >&2
  exit 1
fi
# Reduce CUDA fragmentation on the 16 GB cards (set before torch inits).
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

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

# ---- 1. rebuild the dataset from the part files --------------------------
# The parts are the source of truth; the jsonl is build output. The merge
# hard-fails on a drifted system prompt, an unknown tool name, a missing time
# anchor or a duplicate row, so this doubles as the dataset's test suite.
if [ "$REMERGE" = "1" ]; then
  phase "merging orchatlas-parts → orchatlas-sft.jsonl"
  node "$WORK/merge_orchatlas_parts.mjs"
else
  phase "REMERGE=0 — training orchatlas-sft.jsonl as it stands"
fi
[ -s "$DATA" ] || { echo "ERROR: $DATA is missing or empty." >&2; exit 1; }
rows=$(wc -l < "$DATA")
tools=$("$PY" -c "import json,sys;print(len(json.loads(open('$DATA').readline())['tools']))")
echo "dataset: $rows rows, $tools tools/row"

# ---- 2. sequence length --------------------------------------------------
# A cap below the longest row silently truncates it (keep-last-N), which throws
# away the system prompt and the tool schemas — the two things this fine-tune
# exists to learn. Measure, then round up.
if [ -n "${MAX_LEN:-}" ]; then
  phase "MAX_LEN=$MAX_LEN (given — skipping the measuring pass)"
else
  phase "measuring sequence lengths on the $BASE_MODEL tokenizer"
  seqline="$("$PY" check_seqlen.py "$DATA" "$BASE_MODEL" 2>/dev/null | tail -1)"
  echo "$seqline"
  measured="$(printf '%s' "$seqline" | sed -nE 's/.*max=([0-9]+).*/\1/p')"
  if [ -z "$measured" ]; then
    echo "ERROR: could not read a max= length from check_seqlen.py — pass MAX_LEN=<n> explicitly." >&2
    exit 1
  fi
  MAX_LEN=$(( (measured + 255) / 256 * 256 ))
  echo "longest row $measured tokens → --max-len $MAX_LEN (next multiple of 256)"
fi
if [ "$MAX_LEN" -gt 12288 ]; then
  echo "NOTE: $MAX_LEN is a long sequence for 16 GB cards. If it OOMs, the lever is" >&2
  echo "      the dataset (fewer tool schemas per row), not a lower cap — a lower cap" >&2
  echo "      truncates the prompt instead of failing loudly." >&2
fi

# ---- 3. free Ollama VRAM -------------------------------------------------
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

# ---- 4. train ------------------------------------------------------------
TRAIN_ARGS=(
  --model "$BASE_MODEL"
  --data "$DATA"
  --out "$OUT"
  --merged-out "$MERGED"
  --max-len "$MAX_LEN"
  --batch "$BATCH"
  --grad-accum "$GRAD_ACCUM"
)
[ -n "${EPOCHS:-}" ] && TRAIN_ARGS+=(--epochs "$EPOCHS")

phase "training orchatlas LoRA across $NPROC GPU(s) (max-len $MAX_LEN, batch $BATCH × accum $GRAD_ACCUM)"
if [ "$NPROC" -gt 1 ]; then
  "$VENV/bin/torchrun" --nproc_per_node="$NPROC" train_iris_lora.py "${TRAIN_ARGS[@]}"
else
  "$PY" train_iris_lora.py "${TRAIN_ARGS[@]}"
fi

# ---- 5. pack to Ollama ---------------------------------------------------
if [ "$SKIP_PACK" = "1" ]; then
  phase "SKIP_PACK=1 — stopping after training"
  echo "Merged model at: $MERGED"
  echo "Pack later: LLAMA_CPP=$LLAMA_CPP ./pack_iris.sh \"$MERGED\" $OLLAMA_NAME"
  exit 0
fi

if [ ! -x "$LLAMA_CPP/llama-quantize" ] || [ ! -f "$LLAMA_CPP/convert_hf_to_gguf.py" ]; then
  phase "building llama.cpp at $LLAMA_CPP (one-time, CMake)"
  if [ ! -d "$LLAMA_CPP" ]; then
    git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_CPP"
  fi
  cmake -S "$LLAMA_CPP" -B "$LLAMA_CPP/build" \
    -DGGML_CUDA=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_SERVER=OFF
  cmake --build "$LLAMA_CPP/build" --config Release -j"$(nproc)" --target llama-quantize
  ln -sf "$LLAMA_CPP/build/bin/llama-quantize" "$LLAMA_CPP/llama-quantize"
fi
export LLAMA_CPP

# The Modelfile donor must be the SAME base this LoRA was trained on — granite
# 4.2 **8b**. It donates the TEMPLATE + PARAMETER block Ollama parses tool calls
# with; borrowing another size's block is how a packed model starts emitting
# tool calls the runner cannot read. Pulled on demand if it is not local.
BASE_TEMPLATE_MODEL="${BASE_TEMPLATE_MODEL:-granite4.2:8b}"
if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$BASE_TEMPLATE_MODEL"; then
  phase "pulling $BASE_TEMPLATE_MODEL (Modelfile donor — must match the trained base)"
  ollama pull "$BASE_TEMPLATE_MODEL"
fi

phase "packing → Ollama model $OLLAMA_NAME"
./pack_iris.sh "$MERGED" "$OLLAMA_NAME" "$BASE_TEMPLATE_MODEL"

# ---- done ----------------------------------------------------------------
phase "DONE"
cat <<EOF
Next: point the merged seat at the fine-tune and try it.
  1. Dashboard model settings → set the Warden (orchestrator) model to
     "$OLLAMA_NAME". In Few mode the chat runs directly on the Atlas model, so
     set that row too if you are testing Few. Models are dashboard-selected in
     memory, never env — see memory feedback-models-not-in-env.
  2. Watch the first few turns in /opt/Warden/logs/warden.log: the things this
     dataset trains that stock granite does not know are the internal ones —
     artemis for "what went wrong", the Council for a hard call, MCP installs
     landing as a skill NEXT turn, and the prefixed mcp__marm__ tool names.
EOF
