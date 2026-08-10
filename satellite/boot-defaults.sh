#!/usr/bin/env bash
# Applied at boot (systemd oneshot). Reads ~/.warden-boot-defaults written by
# the Warden TUI "Save as boot defaults". Restores: WiFi SSID, Bluetooth device,
# and the default audio sink/source — found by NAME so node-id changes across
# reconnects don't matter. Parses the file (does not source it) so values with
# spaces are safe.
set +u

FILE="$HOME/.warden-boot-defaults"
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
# Restore the default sink/source the user picked in the TUI, looked up by NAME
# (wpctl node ids shift across reboots + BT reconnects, so re-resolve by name
# each boot). AUDIO_SINK_NAME / AUDIO_SOURCE_NAME are the display names from
# `wpctl status` written by the TUI's "Save as boot defaults". Fall back to the
# Bluetooth device name / bluez_input for an older save that only has BT keys,
# so a previously-saved BT pick still restores.
SINK_NAME=$(getval AUDIO_SINK_NAME)
SRC_NAME=$(getval AUDIO_SOURCE_NAME)
[ -z "$SINK_NAME" ] && SINK_NAME="${BT_NAME:-bluez}"
[ -z "$SRC_NAME" ] && SRC_NAME="bluez_input"
audio_id() {
    # $1 = sink|source, $2 = name -> print the current wpctl node id, or nothing.
    local kind="$1" want="$2" block
    [ -z "$want" ] && return
    local status; status=$(wpctl status 2>/dev/null | sed 's/[│├└─]/ /g')
    if [ "$kind" = "sink" ]; then
        block=$(printf '%s\n' "$status" | sed -n '/Sinks:/,/Sources:/p')
    else
        # Sources: through Streams: (BT HFP mics live under Filters: in between).
        block=$(printf '%s\n' "$status" | sed -n '/Sources:/,/Streams:/p')
    fi
    printf '%s\n' "$block" | grep -F "$want" | grep -oP '^\s*\*?\s*\d+\.' | grep -oP '\d+' | head -1
}
if command -v wpctl >/dev/null 2>&1 && { [ -n "$SINK_NAME" ] || [ -n "$SRC_NAME" ]; }; then
    SINK=""; SRC=""
    for i in $(seq 1 30); do
        [ -z "$SINK" ] && [ -n "$SINK_NAME" ] && SINK=$(audio_id sink "$SINK_NAME")
        [ -z "$SRC" ]  && [ -n "$SRC_NAME" ]  && SRC=$(audio_id source "$SRC_NAME")
        { [ -z "$SINK_NAME" ] || [ -n "$SINK" ]; } && { [ -z "$SRC_NAME" ] || [ -n "$SRC" ]; } && break
        sleep 1
    done
    [ -n "$SINK" ] && wpctl set-default "$SINK" 2>/dev/null && echo "Boot: default sink -> $SINK ($SINK_NAME)"
    [ -n "$SRC" ]  && wpctl set-default "$SRC"  2>/dev/null && echo "Boot: default source -> $SRC ($SRC_NAME)"
fi

# ── Mode (standalone / satellite) ─────────────────────────────────────
# Non-fatal: if ~/.warden-mode exists, echo the last mode and optionally
# relaunch the roles that were running. || true so a missing file or a
# failed launch never blocks boot.
MODE_FILE="$HOME/.warden-mode"
if [ -f "$MODE_FILE" ]; then
    MODE_NOW=$(grep ^MODE= "$MODE_FILE" 2>/dev/null | cut -d= -f2-)
    echo "Boot: restoring last mode: ${MODE_NOW:-?}" || true
    # Roles launch with repo-root-relative paths (node dist/index.js,
    # voice/satellite_server.py, hardware/voice-button.py), so cd to the repo
    # root first — systemd runs this oneshot from $HOME, not /opt/warden, and
    # the relative paths wouldn't resolve otherwise. Derive the root from this
    # script's own location (satellite/boot-defaults.sh → parent).
    REPO_ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." 2>/dev/null && pwd || echo "$HOME")
    cd "$REPO_ROOT" 2>/dev/null || true
    case "$MODE_NOW" in
        standalone)
            read -rp "Start Warden + Satellite + button now? [y/N] " yn < /dev/tty 2>/dev/null || yn=""
            if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
                nohup node dist/index.js > "$HOME/.warden-warden.log" 2>&1 &
                nohup python3 voice/satellite_server.py > "$HOME/.warden-satellite.log" 2>&1 &
                nohup python3 hardware/voice-button.py > "$HOME/.warden-button.log" 2>&1 &
            fi
            ;;
        satellite)
            read -rp "Start Satellite + button now? [y/N] " yn < /dev/tty 2>/dev/null || yn=""
            if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
                nohup python3 voice/satellite_server.py > "$HOME/.warden-satellite.log" 2>&1 &
                nohup python3 hardware/voice-button.py > "$HOME/.warden-button.log" 2>&1 &
            fi
            ;;
        both)
            read -rp "Start Warden + Satellite + button now? [y/N] " yn < /dev/tty 2>/dev/null || yn=""
            if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
                nohup node dist/index.js > "$HOME/.warden-warden.log" 2>&1 &
                nohup python3 voice/satellite_server.py > "$HOME/.warden-satellite.log" 2>&1 &
                nohup python3 hardware/voice-button.py > "$HOME/.warden-button.log" 2>&1 &
            fi
            ;;
    esac || true
fi

exit 0