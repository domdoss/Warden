#!/usr/bin/env bash
# Bring the Chrome MCP bridge (127.0.0.1:12306) back up on Warden (re)start.
#
# The host process is spawned BY Chrome via native messaging — Warden can
# never run it (no stdio pipe to Chrome = tools dead-end). What Warden can
# do is the sequence that fixed the 2026-09-21 outage:
#   1. If 12306 is already serving, nothing to do.
#   2. doctor --fix — re-registers the native host manifest, exec
#      permissions and node_path.txt. A partial npm install (postinstall
#      blocked by allowScripts) leaves these broken and the host dead.
#      No-op when healthy.
#   3. Kill any stale host — the extension auto-reconnects on port
#      disconnect and re-sends the START directive that binds 12306.
#
# Called from warden.service ExecStartPost. Failure is reported, never
# fatal — the browser is optional, never blocking (see CLAUDE.md).
BRIDGE_WAIT="${BRIDGE_WAIT:-30}"
DOCTOR=/home/dominic/.npm-global/bin/mcp-chrome-bridge

bridge_up() { ss -tln | grep -q '127.0.0.1:12306'; }

bridge_up && { echo "browser bridge up: 12306 listening"; exit 0; }

[ -x "$DOCTOR" ] && "$DOCTOR" doctor --fix >/dev/null 2>&1

# [m] bracket keeps this script's own cmdline from matching itself.
pkill -f '[m]cp-chrome-bridge/dist/(index|native-messaging-host)\.js' 2>/dev/null

for _ in $(seq 1 "$BRIDGE_WAIT"); do
    bridge_up && { echo "browser bridge restarted: 12306 listening"; exit 0; }
    sleep 1
done

echo "browser bridge not back on 12306 after ${BRIDGE_WAIT}s" >&2
exit 1