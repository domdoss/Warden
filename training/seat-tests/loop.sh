#!/usr/bin/env bash
# seat-tests/loop.sh — one loop turn: test → triage → pool → (gated) retrain.
#
#   ./loop.sh                     # both layers, orchatlas-ft
#   LAYER=A ./loop.sh             # selection only (GPU-free — safe during a retrain)
#   MODEL=granite4.2:8b ./loop.sh # run the model layer against a different model
#
# The retrain itself is deliberately NOT auto-kicked here — the gate is manual.
# When a batch is ready and approved, run the retrain yourself:
#   cd .. && EPOCHS=1 ./atlasorch.sh      # (or full ./atlasorch.sh)
# then re-run this loop to re-test the new model.

set -uo pipefail
cd "$(dirname "$0")"

echo "=== [1/2] test ==="
node run.mjs "$@" || true          # exits 1 on failures; triage handles them

echo
echo "=== [2/2] triage + pool ==="
node pool.mjs

echo
echo "=== gate ==="
if [ -f results/triage.md ]; then
  cat results/triage.md
fi

echo
echo "→ To retrain the pooled batch (after review):  cd .. && EPOCHS=1 ./atlasorch.sh"
echo "→ To re-test the new model:                    ./loop.sh"
