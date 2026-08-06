#!/usr/bin/env bash
# Applied at boot (systemd oneshot). Reads ~/.graice-boot-defaults written by
# the Graice TUI "Save as boot defaults". Restores: WiFi SSID, Bluetooth device,
# and the default audio sink/source — found by NAME so node-id changes across
# reconnects don't matter. Parses the file (does not source it) so values with
# spaces are safe.
set +u

FILE="$HOME/.graice-boot-defaults"
[ -f "$FILE" ] || exit 0
getval() { grep -m1 "^$1=" "$FILE" 2>/dev/null | cut -d= -f2-; }
WIFI_SSID=$(getval WIFI_SSID)
WIFI_PASSWORD=$(getval WIFI_PASSWORD)
BT_DEVICE=$(getval BT_DEVICE)
BT_NAME=$(getval BT_NAME)

# ── WiFi ──────────────────────────────────────────────────────────────
if [ -n "$WIFI_SSID" ] && [ "$WIFI_SSID" != "Wired connection 1" ]; then
    echo "Boot: connecting to saved WiFi $WIFI_SSID"
    nmcli device wifi connect "$WIFI_SSID" ${WIFI_PASSWORD:+password "$WIFI_PASSWORD"} 2>/dev/null || true
fi

# ── Bluetooth ─────────────────────────────────────────────────────────
# Wait for bluetoothd to be reachable, then connect the saved (paired+trusted)
# device. The bond persists in /var/lib/bluetooth; this just re-establishes the
# link so PipeWire recreates the audio nodes.
if [ -n "$BT_DEVICE" ]; then
    echo "Boot: connecting to saved Bluetooth $BT_DEVICE"
    for i in $(seq 1 20); do bluetoothctl show >/dev/null 2>&1 && break; sleep 0.5; done
    bluetoothctl connect "$BT_DEVICE" 2>/dev/null || true
fi

# ── Audio defaults ────────────────────────────────────────────────────
# The bluetooth HFP source appears under "Filters:" as bluez_input.*, and the
# sink appears under "Sinks:" named after the device. Poll up to ~30s for them
# to materialize after the BT connect, then set as default by their current ids.
if command -v wpctl >/dev/null 2>&1; then
    SINK=""; SRC=""
    for i in $(seq 1 30); do
        [ -z "$SINK" ] && SINK=$(wpctl status 2>/dev/null | sed 's/[│├└─]/ /g' \
            | sed -n '/Sinks:/,/Sources:/p' \
            | grep -P "${BT_NAME:-bluez}" | grep -oP '^\s*\d+' | tr -d ' ' | head -1)
        [ -z "$SRC" ] && SRC=$(wpctl status 2>/dev/null | sed 's/[│├└─]/ /g' \
            | grep -P 'bluez_input' | grep -oP '^\s*\d+' | tr -d ' ' | head -1)
        [ -n "$SINK" ] && [ -n "$SRC" ] && break
        sleep 1
    done
    [ -n "$SINK" ] && wpctl set-default "$SINK" 2>/dev/null && echo "Boot: default sink -> $SINK (${BT_NAME:-?})"
    [ -n "$SRC" ]  && wpctl set-default "$SRC"  2>/dev/null && echo "Boot: default source -> $SRC (bluez_input)"
fi

# ── Mode (standalone / satellite) ─────────────────────────────────────
# Non-fatal: if ~/.graice-mode exists, echo the last mode and optionally
# relaunch the roles that were running. || true so a missing file or a
# failed launch never blocks boot.
MODE_FILE="$HOME/.graice-mode"
if [ -f "$MODE_FILE" ]; then
    MODE_NOW=$(grep ^MODE= "$MODE_FILE" 2>/dev/null | cut -d= -f2-)
    echo "Boot: restoring last mode: ${MODE_NOW:-?}" || true
    case "$MODE_NOW" in
        standalone)
            read -rp "Start Warden + Satellite + button now? [y/N] " yn < /dev/tty 2>/dev/null || yn=""
            if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
                nohup node dist/index.js > "$HOME/.graice-warden.log" 2>&1 &
                nohup python3 voice/satellite_server.py > "$HOME/.graice-satellite.log" 2>&1 &
                nohup python3 hardware/voice-button.py > "$HOME/.graice-button.log" 2>&1 &
            fi
            ;;
        satellite)
            read -rp "Start Satellite + button now? [y/N] " yn < /dev/tty 2>/dev/null || yn=""
            if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
                nohup python3 voice/satellite_server.py > "$HOME/.graice-satellite.log" 2>&1 &
                nohup python3 hardware/voice-button.py > "$HOME/.graice-button.log" 2>&1 &
            fi
            ;;
    esac || true
fi

exit 0