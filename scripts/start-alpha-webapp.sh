#!/usr/bin/env bash
# Start the alpha-stack webapp (trading/webapp — the stack's own UI on
# 127.0.0.1:8765, TradingAgents runs, Liquid NN) on every Warden (re)start.
#
# The webapp is part of warden.service: spawned from ExecStartPost it lives
# in Warden's cgroup, so stopping/restarting Warden takes it down with
# everything else. Any copy started outside Warden (a terminal) is killed
# first so the one serving 8765 is always Warden's. An interrupted run stays
# resumable — progress and TradingAgents checkpoints live on disk.
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

# [.] bracket keeps this pattern from matching its own cmdline.
pkill -f 'webapp/app[.]py' 2>/dev/null
for _ in $(seq 1 10); do pgrep -f 'webapp/app[.]py' >/dev/null || break; sleep 0.5; done

mkdir -p "$ROOT/logs"
nohup "$PY" "$APP" >>"$LOG" 2>&1 &

for _ in $(seq 1 "$WEBAPP_WAIT"); do
    webapp_up && { echo "alpha webapp started: 8765 serving"; exit 0; }
    sleep 1
done

echo "alpha webapp not serving on 8765 after ${WEBAPP_WAIT}s (see $LOG)" >&2
exit 1