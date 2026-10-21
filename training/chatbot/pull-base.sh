#!/usr/bin/env bash
# Custom chatbot: download a granite base into the Hugging Face cache
# (~/.cache/huggingface/hub, or $HF_HOME/hub) so train.sh can load it offline,
# and pull the matching Ollama model that donates the chat template at pack time.
#
#   training/chatbot/pull-base.sh 3b|8b
set -euo pipefail
cd "$(dirname "$0")"
KEY="${1:-}"
HF_ID="$(python3 -c "import json,sys;print(json.load(open('bases.json'))[sys.argv[1]]['hf'])" "$KEY" 2>/dev/null)" \
  || { echo "[pull] unknown base \"$KEY\" (expected a key from bases.json)" >&2; exit 1; }
DONOR="$(python3 -c "import json,sys;print(json.load(open('bases.json'))[sys.argv[1]]['ollama'])" "$KEY")"
HF="../.venv/bin/hf"
[ -x "$HF" ] || { echo "[pull] $HF missing — run training/run.sh once to create the training venv" >&2; exit 1; }

echo "[pull] $HF_ID → Hugging Face cache ($(date))"
"$HF" download "$HF_ID"
echo "[pull] $HF_ID cached"

if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$DONOR"; then
  echo "[pull] ollama pull $DONOR (chat-template donor for packing)"
  ollama pull "$DONOR"
fi
echo "[pull] DONE — $KEY base ready"
