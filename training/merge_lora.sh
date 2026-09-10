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

# Warden venv — torch is installed there.
PY="$HOME/.venv/bin/python"

echo "==> merging $ADAPTER into $BASE → $OUT (bf16, CPU is fine)"
"$PY" - "$BASE" "$ADAPTER" "$OUT" <<'EOF'
import sys
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

base_id, adapter_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
model = AutoModelForCausalLM.from_pretrained(base_id, dtype=torch.bfloat16, device_map="cpu", trust_remote_code=True)
model = PeftModel.from_pretrained(model, adapter_dir)
model = model.merge_and_unload()
model.save_pretrained(out_dir)
AutoTokenizer.from_pretrained(base_id, trust_remote_code=True).save_pretrained(out_dir)
print(f"[merge_lora] merged model saved → {out_dir}", flush=True)
EOF

echo "DONE: $OUT"
echo "Next: LLAMA_CPP=$HOME/src/llama.cpp ./pack_dexter.sh \"$OUT\" toolcall-ft"