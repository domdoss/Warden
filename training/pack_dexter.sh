#!/usr/bin/env bash
# Pack the fine-tuned toolcall model for Ollama:
#   merged HF model → GGUF (f16) → quantized (Q4_K_M) → Ollama model (default
#   "dexter-ft"; run.sh passes "toolcall-ft" — the single merged-iris model).
#
# Reuses the EXACT TEMPLATE + PARAMETER block from the stock granite4.1:3b so
# the fine-tune renders tool calls the same way Ollama already parses. Requires
# a built llama.cpp (convert_hf_to_gguf.py + llama-quantize).
#
#   export LLAMA_CPP=~/src/llama.cpp   # path to a built llama.cpp checkout
#   ./pack_dexter.sh
set -euo pipefail

MERGED="${1:-$(dirname "$0")/dexter-lora-merged}"
NAME="${2:-dexter-ft}"
LLAMA_CPP="${LLAMA_CPP:-$HOME/src/llama.cpp}"
WORK="$(dirname "$0")"
# convert_hf_to_gguf.py imports torch/transformers/numpy/gguf — use the venv
# python, not system python3 (which is 3.14 here, no torch).
PY="${VENV_PY:-$WORK/.venv/bin/python}"
[ -x "$PY" ] || PY="python3"
F16="$WORK/$NAME.f16.gguf"
Q4="$WORK/$NAME.q4_k_m.gguf"
MODFILE="$WORK/Modelfile.$NAME"

if [ ! -d "$MERGED" ]; then
  echo "ERROR: merged model not found at $MERGED — run train_dexter_lora.py first." >&2
  exit 1
fi
if [ ! -f "$LLAMA_CPP/convert_hf_to_gguf.py" ] || [ ! -x "$LLAMA_CPP/llama-quantize" ]; then
  echo "ERROR: llama.cpp not found/built at LLAMA_CPP=$LLAMA_CPP" >&2
  echo "  git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && make" >&2
  echo "  then: export LLAMA_CPP=/path/to/llama.cpp && ./pack_dexter.sh" >&2
  exit 1
fi

echo "==> converting HF → GGUF (f16)"
"$PY" "$LLAMA_CPP/convert_hf_to_gguf.py" "$MERGED" --outtype f16 --outfile "$F16"

echo "==> quantizing → Q4_K_M (matches stock granite4.1:3b)"
"$LLAMA_CPP/llama-quantize" "$F16" "$Q4" Q4_K_M

echo "==> building Modelfile from stock granite4.1:3b (reusing TEMPLATE + PARAMETERs)"
# Take the stock modelfile and swap only the FROM line to point at the new GGUF.
# The TEMPLATE block is the Granite tool-call template Ollama already parses.
ollama show granite4.1:3b --modelfile \
  | sed -E "s|^FROM .*|FROM $Q4|" > "$MODFILE"

echo "==> ollama create $NAME"
ollama create "$NAME" -f "$MODFILE"

echo
echo "Done. Route the shared Toolcall model to it:"
echo "  - In the dashboard model settings, set the Toolcall model to '$NAME'"
echo "    (iris is the single toolcall agent; byte/dexter were absorbed into it)."
echo "Then test the hard calls (or just run: node dryfire.mjs):"
echo "  iris 'every day at 10:30am' → cron '30 10 * * *'"
echo "  iris 'add fix the bug to my list' → create_work_task project_id=personal"