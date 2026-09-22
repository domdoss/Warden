#!/usr/bin/env bash
# Step 3 of the training loop: 1-epoch run of the standard orchatlas pipeline.
# Settings are exactly atlasorch.sh's own — only EPOCHS is pinned to 1.
set -uo pipefail
cd "$(dirname "$0")/.."
echo "[train] starting: EPOCHS=1 ./atlasorch.sh ($(date))"
EPOCHS=1 ./atlasorch.sh
rc=$?
echo "[train] atlasorch.sh exited rc=$rc"
[ $rc -eq 0 ] && echo "[train] DONE — set the model to orchatlas-ft in the dashboard manually"
exit $rc