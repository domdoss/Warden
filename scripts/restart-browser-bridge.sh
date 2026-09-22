#!/usr/bin/env bash
# Restart the Chrome MCP bridge (127.0.0.1:12306) on every Warden (re)start,
# so one `systemctl --user restart warden.service` cycles the whole stack.
#
# The host process is spawned BY Chrome via native messaging — Warden can
# never run it (no stdio pipe to Chrome = tools dead-end). What Warden can
# do is the sequence that fixed the 2026-09-21 outage:
#   1. doctor --fix — re-registers the native host manifest, exec
#      permissions and node_path.txt. A partial npm install (postinstall
#      blocked by allowScripts) leaves these broken and the host dead.
#      No-op when healthy.
#   2. Kill the running host — the extension auto-reconnects on port
#      disconnect and re-sends the START directive that binds 12306.
#
# Called from warden.service ExecStartPost. Failure is reported, never
# fatal — the browser is optional, never blocking (see CLAUDE.md).
BRIDGE_WAIT="${BRIDGE_WAIT:-30}"
DOCTOR=/home/dominic/.npm-global/bin/mcp-chrome-bridge

bridge_up() { ss -tln | grep -q '127.0.0.1:12306'; }

[ -x "$DOCTOR" ] && "$DOCTOR" doctor --fix >/dev/null 2>&1

# [m] bracket keeps this script's own cmdline from matching itself.
pkill -f '[m]cp-chrome-bridge/dist/(index|native-messaging-host)\.js' 2>/dev/null
# Let the old listener drop, so the check below sees the respawned host.
for _ in $(seq 1 5); do bridge_up || break; sleep 1; done

for _ in $(seq 1 "$BRIDGE_WAIT"); do
    bridge_up && { echo "browser bridge restarted: 12306 listening"; exit 0; }
    sleep 1
done

echo "browser bridge not back on 12306 after ${BRIDGE_WAIT}s" >&2
exit 1