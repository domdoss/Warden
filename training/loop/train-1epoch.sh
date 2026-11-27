#!/usr/bin/env bash
# Step 3 of the training loop: 1-epoch run of the standard orchatlas pipeline.
# Settings are exactly atlasorch.sh's own — only EPOCHS is pinned to 1.
#
# The 8b trainer at ~17.9k ctx runs within ~300 MiB of the 16 GB card limit,
# so this step also parks the alpha-stack webapp for the duration (its Liquid
# NN holds ~300 MiB on GPU 0 — the 2026-10-10 run OOMed by less than that)
# and starts it again afterwards. Interrupted trading runs auto-resume, so
# parking it mid-day is safe.
set -uo pipefail
cd "$(dirname "$0")/.."
WEBAPP_START="$PWD/../scripts/start-alpha-webapp.sh"

WEBAPP_PARKED=0
if pgrep -f 'webapp/app[.]py' >/dev/null 2>&1; then
  echo "[train] parking alpha-stack webapp (frees its GPU memory for the trainer)"
  pkill -f 'webapp/app[.]py' 2>/dev/null
  for _ in $(seq 1 10); do pgrep -f 'webapp/app[.]py' >/dev/null 2>&1 || break; sleep 0.5; done
  WEBAPP_PARKED=1
fi
restore_webapp() {
  if [ "$WEBAPP_PARKED" = 1 ]; then
    echo "[train] restarting alpha-stack webapp"
    "$WEBAPP_START" >/dev/null 2>&1 || echo "[train] WARNING: webapp restart failed — use the Alpha Stack view's start route"
  fi
}
trap restore_webapp EXIT

echo "[train] starting: EPOCHS=1 ./atlasorch.sh ($(date))"
EPOCHS=1 ./atlasorch.sh
rc=$?
echo "[train] atlasorch.sh exited rc=$rc"
if [ $rc -eq 0 ]; then
  echo "[train] DONE — switching the seat (Atlas model) to orchatlas-ft"
  if curl -s -X POST http://127.0.0.1:3200/api/settings \
      -H 'content-type: application/json' \
      -d '{"atlasModel":"orchatlas-ft"}'; then
    echo "[train] seat switched to orchatlas-ft — the system will use the fine-tuned model on the next turn"
  else
    echo "[train] WARNING: auto-switch failed — set the Atlas model to orchatlas-ft manually in Settings"
  fi
fi
exit $rc