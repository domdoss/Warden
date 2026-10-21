#!/usr/bin/env bash
# Custom chatbot, step 2: LoRA on the chosen granite base → Ollama model.
#
#   training/chatbot/train.sh <slug>
#
# Trains bots/<slug>/pairs.jsonl with train_hf.py (plain transformers + peft, one
# GPU), packs the merged model with pack_iris.sh, then bakes persona.txt in as
# the Modelfile SYSTEM prompt so the served model sees the exact system turn it
# was trained on.
#
# Knobs (env): NPROC (GPUs, default 1 — two-GPU NCCL hangs on this box without NCCL_P2P_DISABLE=1), EPOCHS (default 3), LLAMA_CPP.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
TRAINING="$(cd .. && pwd)"
SLUG="${1:-}"
BOT="$HERE/bots/$SLUG"
[ -n "$SLUG" ] && [ -f "$BOT/intake.json" ] || { echo "[bot-train] no bot \"$SLUG\"" >&2; exit 1; }
[ -s "$BOT/pairs.jsonl" ] || { echo "[bot-train] $BOT/pairs.jsonl is empty — generate pairs first" >&2; exit 1; }
[ -s "$BOT/persona.txt" ] || { echo "[bot-train] $BOT/persona.txt missing — generate pairs first" >&2; exit 1; }

KEY="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('base','3b'))" "$BOT/intake.json")"
HF_ID="$(python3 -c "import json,sys;print(json.load(open('bases.json'))[sys.argv[1]]['hf'])" "$KEY")"
DONOR="$(python3 -c "import json,sys;print(json.load(open('bases.json'))[sys.argv[1]]['ollama'])" "$KEY")"
NAME="$SLUG-bot"
EPOCHS="${EPOCHS:-3}"
NPROC="${NPROC:-1}"
VENV="$TRAINING/.venv"
export LLAMA_CPP="${LLAMA_CPP:-$HOME/src/llama.cpp}"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

phase() { printf '\n=== %s ===\n' "$*"; }
phase "bot $SLUG: $(wc -l < "$BOT/pairs.jsonl") pairs on $HF_ID → ollama $NAME ($(date))"

if command -v nvidia-smi >/dev/null 2>&1; then
  ngpus=$(nvidia-smi --query-gpu=index --format=csv,noheader | wc -l)
  if [ "$ngpus" -lt "$NPROC" ]; then NPROC="$ngpus"; fi
fi

phase "unloading resident Ollama models (free VRAM for training)"
curl -s http://localhost:11434/api/ps 2>/dev/null \
  | python3 -c 'import sys,json;print("\n".join(m["name"] for m in json.load(sys.stdin).get("models",[])))' 2>/dev/null \
  | while read -r m; do [ -n "$m" ] && { echo "  ollama stop $m"; ollama stop "$m" >/dev/null 2>&1; }; done || true
sleep 2

# Training data = this bot's persona pairs + the shared formatting set (base-format/*.jsonl:
# Markdown answers and mermaid charts from retrieved documents), with the bot's persona stamped
# into each shared row's system turn.
# The persona is the advanced system prompt when one was generated, else persona.txt (basic, from the
# intake). It is stamped into EVERY row, the bot's own pairs included, so a newer prompt applies
# without regenerating pairs.
PERSONA_FILE="$BOT/persona.txt"
[ -s "$BOT/system-prompt.txt" ] && PERSONA_FILE="$BOT/system-prompt.txt"
echo "[bot-train] persona: $(basename "$PERSONA_FILE")"
python3 - "$PERSONA_FILE" "$HERE/base-format" "$BOT/pairs.jsonl" "$BOT/train.jsonl" <<'PY'
import glob, json, os, sys
persona = open(sys.argv[1]).read().strip()
rows = []
for l in open(sys.argv[3]):
    if l.strip():
        r = json.loads(l)
        r["messages"][0]["content"] = persona
        rows.append(json.dumps(r) + "\n")
base = 0
for f in sorted(glob.glob(os.path.join(sys.argv[2], "*.jsonl"))):
    for l in open(f):
        if not l.strip():
            continue
        r = json.loads(l)
        r["messages"][0]["content"] = persona
        rows.append(json.dumps(r) + "\n")
        base += 1
open(sys.argv[4], "w").writelines(rows)
print(f"[bot-train] {len(rows) - base} persona pairs + {base} formatting rows → {sys.argv[4]}")
PY

TRAIN_ARGS=(
  --model "$HF_ID"
  --data "$BOT/train.jsonl"
  --out "$BOT/lora"
  --merged-out "$BOT/merged"
  --epochs "$EPOCHS"
)
# Plain HF + peft (train_hf.py), DDP across NPROC GPUs. NOT train_iris_lora.py:
# unsloth's Granite patch yields NaN logits on granite-4.2-3b here.
phase "training LoRA on $HF_ID across $NPROC GPU(s), $EPOCHS epochs"
cd "$HERE"
if [ "$NPROC" -gt 1 ]; then
  "$VENV/bin/torchrun" --nproc_per_node="$NPROC" train_hf.py "${TRAIN_ARGS[@]}"
else
  "$VENV/bin/python" train_hf.py "${TRAIN_ARGS[@]}"
fi
cd "$TRAINING"

if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$DONOR"; then
  phase "pulling $DONOR (chat-template donor — must match the trained base)"
  ollama pull "$DONOR"
fi

phase "packing → Ollama model $NAME"
./pack_iris.sh "$BOT/merged" "$NAME" "$DONOR"

phase "baking the persona in as the SYSTEM prompt"
MODFILE="$TRAINING/Modelfile.$NAME"
{ printf '\nSYSTEM """'; sed 's/"""/"/g' "$PERSONA_FILE"; printf '"""\n'; } >> "$MODFILE"
ollama create "$NAME" -f "$MODFILE"
# ollama keeps its own copy of the weights; the f16 intermediate is dead weight.
rm -f "$TRAINING/$NAME.f16.gguf"

python3 - "$BOT/trained.json" "$NAME" "$KEY" "$(wc -l < "$BOT/pairs.jsonl")" <<'PY'
import json, sys, datetime
json.dump({"model": sys.argv[2], "base": sys.argv[3], "pairs": int(sys.argv[4]),
           "trained_at": datetime.datetime.now().astimezone().isoformat()}, open(sys.argv[1], "w"), indent=2)
PY
phase "DONE — chat with it: ollama run $NAME"
