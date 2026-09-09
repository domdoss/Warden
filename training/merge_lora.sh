#!/usr/bin/env bash
# Merge the shipped LoRA adapter into the HF base model — no training.
# For a fresh PC that pulled the repo: the adapter (toolcall-lora/) is in
# git, the merged model is NOT (6.4 GB, ignored). This rebuilds it:
#
#   base (ibm-granite/granite-4.1-3b) + toolcall-lora/ → toolcall-lora-merged/
#
# then pack as usual:
#   export LLAMA_CPP=~/src/llama.cpp
#   ./pack_dexter.sh "$WORK/toolcall-lora-merged" toolcall-ft
#
#   ./merge_lora.sh [ADAPTER] [OUT] [BASE]
set -euo pipefail
WORK="$(cd "$(dirname "$0")" && pwd)"
ADAPTER="${1:-$WORK/toolcall-lora}"
OUT="${2:-$WORK/toolcall-lora-merged}"
BASE="${3:-ibm-granite/granite-4.1-3b}"

if [ ! -f "$ADAPTER/adapter_model.safetensors" ]; then
  echo "ERROR: adapter not found at $ADAPTER" >&2
  exit 1
fi

# venv with torch/transformers/peft — reuse training/.venv if present.
PY="${VENV_PY:-$WORK/.venv/bin/python}"
if [ ! -x "$PY" ]; then
  echo "==> no training venv — creating a CPU-only one at $WORK/.venv-merge (uv)"
  PY="$WORK/.venv-merge/bin/python"
  if [ ! -x "$PY" ]; then
    uv venv --python python3.12 "$WORK/.venv-merge"
    uv pip install --python "$PY" \
      --index-url https://download.pytorch.org/whl/cpu torch \
      --index-url https://pypi.org/simple "transformers>=4.53,<5" "peft>=0.10" accelerate
  fi
fi

echo "==> merging $ADAPTER into $BASE → $OUT (fp32, CPU is fine)"
"$PY" - "$BASE" "$ADAPTER" "$OUT" <<'EOF'
import sys
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

base_id, adapter_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
model = AutoModelForCausalLM.from_pretrained(base_id, dtype=torch.float32, trust_remote_code=True)
model = PeftModel.from_pretrained(model, adapter_dir)
model = model.merge_and_unload()
model.save_pretrained(out_dir)
AutoTokenizer.from_pretrained(base_id, trust_remote_code=True).save_pretrained(out_dir)
print(f"[merge_lora] merged model saved → {out_dir}", flush=True)
EOF

echo "DONE: $OUT"
echo "Next: LLAMA_CPP=$HOME/src/llama.cpp ./pack_dexter.sh \"$OUT\" toolcall-ft"