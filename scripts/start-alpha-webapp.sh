#!/usr/bin/env bash
# Start the alpha-stack webapp (trading/webapp — the stack's own UI on
# 127.0.0.1:8765) on every Warden (re)start.
#
#   1. If 8765 is already serving, nothing to do.
#   2. Kill any stale copy holding the port without serving (wedged), then
#      spawn a fresh one detached. All state lives on disk
#      (trading/.alpha-stack, trading/.tradingagents), so a restart loses
#      nothing.
#
# Called from warden.service ExecStartPost (see the alpha-webapp drop-in).
# Failure is reported, never fatal — the dashboard's Alpha Stack view also
# has the POST /api/alphastack/webapp/start route as a repair path while
# Warden keeps running.
WEBAPP_WAIT="${WEBAPP_WAIT:-5}"
ROOT=/opt/Warden/trading
PY="$ROOT/bin/python"
APP="$ROOT/webapp/app.py"
LOG="$ROOT/logs/webapp.log"

webapp_up() { curl -s -m 2 -o /dev/null http://127.0.0.1:8765/api/status; }

webapp_up && { echo "alpha webapp up: 8765 serving"; exit 0; }

# [.] bracket keeps this pattern from matching its own cmdline.
pkill -f 'webapp/app[.]py' 2>/dev/null

mkdir -p "$ROOT/logs"
nohup "$PY" "$APP" >>"$LOG" 2>&1 &

for _ in $(seq 1 "$WEBAPP_WAIT"); do
    webapp_up && { echo "alpha webapp started: 8765 serving"; exit 0; }
    sleep 1
done

echo "alpha webapp not serving on 8765 after ${WEBAPP_WAIT}s (see $LOG)" >&2
exit 1