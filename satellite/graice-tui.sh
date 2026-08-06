#!/usr/bin/env bash
# graice-tui.sh — dead-simple interactive settings for Graice.
# Uses bash `select` (no whiptail, no curl, no JSON). Runs system commands
# directly: nmcli, bluetoothctl, amixer/wpctl. Functional first, fancy later.
set +u

main() {
    while true; do
        clear
        echo "══════════════════════════════════════"
        echo "  Graice Settings"
        echo "══════════════════════════════════════"
        echo ""
        PS3="Choose (1-7): "
        select opt in "WiFi" "Bluetooth" "Speakers" "Microphone" "Mode" "Save as boot defaults" "Exit to shell"; do
            case $REPLY in
                1) wifi_menu; break ;;
                2) bt_menu; break ;;
                3) audio_menu sink "Speakers"; break ;;
                4) audio_menu source "Microphone"; break ;;
                5) mode_menu; break ;;
                6) save_defaults; break ;;
                7) clear; echo "Type 'exit' to return to the menu."; ${SHELL:-/bin/bash}; break ;;
            esac
        done
    done
}

# ── WiFi ──────────────────────────────────────────────────────────────
wifi_menu() {
    while true; do
        clear
        echo "── WiFi ──"
        echo "Connected: $(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep -v ':lo$' | cut -d: -f1 | head -1 || echo '(none)')"
        echo "Default at boot: ThePhone (open) — resets on reboot"
        echo ""
        PS3="WiFi > "
        select opt in "Scan and pick a network" "Enter SSID manually" "Back"; do
            case $REPLY in
                1) wifi_scan_pick; break ;;
                2) wifi_manual; break ;;
                3) return ;;
            esac
        done
    done
}

wifi_scan_pick() {
    echo "Scanning for WiFi networks…"
    nmcli device wifi rescan 2>/dev/null
    sleep 4
    echo ""
    echo "Available networks:"
    echo ""
    # Build a numbered list
    mapfile -t networks < <(nmcli -t -f SSID,SIGNAL,SECURITY device wifi list 2>/dev/null | sort -t: -k2 -rn | head -20)
    if [ ${#networks[@]} -eq 0 ]; then
        echo "  No networks found. Is the WiFi radio on?"
        read -rp "  Press Enter to return…"
        return
    fi
    local i=1
    for n in "${networks[@]}"; do
        IFS=':' read -r ssid sig sec <<< "$n"
        printf "  %2d) %-30s %3s%%  %s\n" "$i" "${ssid:0:30}" "$sig" "$sec"
        ((i++))
    done
    echo ""
    read -rp "Pick a number (or Enter to cancel): " pick
    if [ -n "$pick" ] && [ "$pick" -ge 1 ] 2>/dev/null && [ "$pick" -le ${#networks[@]} ]; then
        IFS=':' read -r ssid sig sec <<< "${networks[$((pick-1))]}"
        wifi_connect "$ssid" "$sec"
    fi
}

wifi_manual() {
    read -rp "SSID: " ssid
    [ -z "$ssid" ] && return
    read -rsp "Password (Enter for none): " pass
    echo
    wifi_connect "$ssid" "" "$pass"
}

wifi_connect() {
    local ssid="$1" sec="$2" pass="${3:-}"
    echo "Connecting to $ssid…"
    if [ -n "$pass" ]; then
        nmcli device wifi connect "$ssid" password "$pass" 2>&1
    else
        nmcli device wifi connect "$ssid" 2>&1
    fi
    echo ""
    read -rp "Press Enter to continue…"
}

# ── Bluetooth ─────────────────────────────────────────────────────────
bt_menu() {
    while true; do
        clear
        echo "── Bluetooth ──"
        echo ""
        PS3="Bluetooth > "
        select opt in "Scan and connect" "Back"; do
            case $REPLY in
                1) bt_scan_and_pick; break ;;
                2) return ;;
            esac
        done
    done
}

bt_scan_and_pick() {
    echo "Scanning for Bluetooth devices (10s)…"
    bluetoothctl --timeout 10 scan on 2>/dev/null
    clear
    echo "── Bluetooth Devices ──"
    echo ""
    mapfile -t devices < <(bluetoothctl devices 2>/dev/null)
    if [ ${#devices[@]} -eq 0 ]; then
        echo "  No devices found."
        read -rp "  Press Enter to return…"
        return
    fi
    local i=1
    for d in "${devices[@]}"; do
        local mac="${d#Device }"
        mac="${mac%% *}"
        local name="${d#Device ??\:??\:??\:??\:??\:?? }"
        local connected=""
        bluetoothctl info "$mac" 2>/dev/null | grep -q "Connected: yes" && connected=" [CONNECTED]"
        printf "  %2d) %-20s %s%s\n" "$i" "${name:0:20}" "$mac" "$connected"
        ((i++))
    done
    echo ""
    read -rp "Pick a number to connect/disconnect (Enter to cancel): " pick
    if [ -n "$pick" ] && [ "$pick" -ge 1 ] 2>/dev/null && [ "$pick" -le ${#devices[@]} ]; then
        local d="${devices[$((pick-1))]}"
        local mac="${d#Device }"; mac="${mac%% *}"
        if bluetoothctl info "$mac" 2>/dev/null | grep -q "Connected: yes"; then
            echo "Disconnecting $mac…"
            bluetoothctl disconnect "$mac" 2>/dev/null
        else
            echo "Connecting $mac…"
            bluetoothctl connect "$mac" 2>/dev/null
        fi
        read -rp "Press Enter to continue…"
    fi
}

# ── Audio (speakers / microphone) ─────────────────────────────────────
audio_menu() {
    local kind="$1" title="$2"
    local target vol_label mixer
    if [ "$kind" = "source" ]; then
        target="@DEFAULT_AUDIO_SOURCE@"
        vol_label="sourceVolume"
        mixer="Capture"
    else
        target="@DEFAULT_AUDIO_SINK@"
        vol_label="sinkVolume"
        mixer="Master"
    fi

    while true; do
        clear
        echo "── $title ──"
        # Show current volume
        local vol=0 muted="no"
        if command -v wpctl >/dev/null 2>&1; then
            local out; out=$(wpctl get-volume "$target" 2>/dev/null)
            vol=$(echo "$out" | grep -oP '[\d.]+' | head -1)
            vol=$(awk "BEGIN { printf \"%d\", ($vol * 100) }" 2>/dev/null || echo 0)
            echo "$out" | grep -q "MUTED" && muted="yes"
        elif command -v amixer >/dev/null 2>&1; then
            local out; out=$(amixer -M sget "$mixer" 2>/dev/null)
            vol=$(echo "$out" | grep -oP '\[\d+%\]' | head -1 | tr -d '[]%')
            echo "$out" | grep -q '\[off\]' && muted="yes"
        fi
        echo "Volume: ${vol}%  Muted: ${muted}"
        echo ""
        PS3="$title > "
        select opt in "+10%" "-10%" "Set volume" "Toggle mute" "Select device" "Back"; do
            case $REPLY in
                1) set_vol "$target" "$mixer" "$((vol+10))"; break ;;
                2) set_vol "$target" "$mixer" "$((vol-10))"; break ;;
                3) read -rp "Volume (0-100): " v; set_vol "$target" "$mixer" "$v"; break ;;
                4) toggle_mute "$target" "$mixer" "$muted"; break ;;
                5) select_device "$kind" "$title"; break ;;
                6) return ;;
            esac
        done
    done
}

set_vol() {
    local target="$1" mixer="$2" val="$3"
    [ -z "$val" ] && return
    val=$(( val < 0 ? 0 : val > 100 ? 100 : val ))
    if command -v wpctl >/dev/null 2>&1; then
        wpctl set-volume "$target" "${val}%" 2>/dev/null
    elif command -v amixer >/dev/null 2>&1; then
        amixer -M sset "$mixer" "${val}%" 2>/dev/null
    fi
}

toggle_mute() {
    local target="$1" mixer="$2" muted="$3"
    if command -v wpctl >/dev/null 2>&1; then
        if [ "$muted" = "yes" ]; then
            wpctl set-mute "$target" 0 2>/dev/null
        else
            wpctl set-mute "$target" 1 2>/dev/null
        fi
    elif command -v amixer >/dev/null 2>&1; then
        if [ "$muted" = "yes" ]; then
            amixer -M sset "$mixer" unmute 2>/dev/null
        else
            amixer -M sset "$mixer" mute 2>/dev/null
        fi
    fi
}

# ── Device selection ──────────────────────────────────────────────────
select_device() {
    local kind="$1" title="$2"
    local section label
    if [ "$kind" = "source" ]; then
        section="Sources:"; label="input"
        # Bluetooth HFP mics appear under Filters:, not Sources: — scan through.
        stop_re="^(Streams|Devices|Endpoints|Audio|Video|Route):"
    else
        section="Sinks:"; label="output"
        stop_re="^(Sinks|Sources|Filters|Streams|Devices|Endpoints|Audio|Video|Route):"
    fi
    clear
    echo "── Select $title Device ──"
    echo ""
    if ! command -v wpctl >/dev/null 2>&1; then
        echo "  wpctl not available (PipeWire not running)."
        read -rp "  Press Enter to return…"
        return
    fi
    # Parse wpctl status for the section
    local in_section=0
    local devices=()
    local ids=()
    local defaults=()
    local status; status=$(wpctl status 2>/dev/null)
    while IFS= read -r line; do
        if [ "$in_section" = "1" ]; then
            # wpctl draws a tree with │ ├ └ ─ box chars; strip them so the
            # regex (which only knows [[:space:]]) can match device lines.
            local clean="${line//[│├└─]/ }"
            local stripped="${clean#"${clean%%[![:space:]]*}"}"
            # Stop at the next section header (sibling or top-level).
            [[ "$stripped" =~ $stop_re ]] && break
            # Match device lines: optional *, id, name — trailing [vol: ...] or
            # [Audio/Source] etc. is optional (bluetooth nodes often lack [vol:]).
            if [[ "$clean" =~ ^[[:space:]]*(\*)?[[:space:]]*([0-9]+)\.\ (.+) ]]; then
                local is_default="${BASH_REMATCH[1]}"
                local id="${BASH_REMATCH[2]}"
                local name="${BASH_REMATCH[3]}"
                name="${name%%\[*}"              # drop trailing [vol: ...] / [Audio/Source]
                name="${name%"${name##*[! ]}"}"  # trim trailing space
                local mark=" "
                [ -n "$is_default" ] && mark="*"
                devices+=("$id" "$name" "$mark")
            fi
        fi
        [[ "$line" == *"$section"* ]] && in_section=1
    done <<< "$status"
    if [ ${#devices[@]} -eq 0 ]; then
        echo "  No $label devices found."
        read -rp "  Press Enter to return…"
        return
    fi
    local i=1
    for ((j=0; j<${#devices[@]}; j+=3)); do
        printf "  %2d) %s %-30s (id %s)\n" "$i" "${devices[$((j+2))]}" "${devices[$((j+1))]:0:30}" "${devices[$j]}"
        ((i++))
    done
    echo ""
    read -rp "Pick a number to set as default $label (* = current, Enter to cancel): " pick
    if [ -n "$pick" ] && [ "$pick" -ge 1 ] 2>/dev/null && [ "$pick" -le $((i-1)) ]; then
        local idx=$(((pick-1)*3))
        local id="${devices[$idx]}"
        wpctl set-default "$id" 2>/dev/null && echo "Default $label set to id $id" || echo "Failed to set default"
        read -rp "Press Enter to continue…"
    fi
}

# ── Mode (standalone / satellite) ─────────────────────────────────────
MODE_FILE="$HOME/.graice-mode"

mode_read() {
    # Populate globals MODE, WARDEN_URL, AUDIO_SERVER_URL, SATELLITE_URL
    MODE=""; WARDEN_URL=""; AUDIO_SERVER_URL=""; SATELLITE_URL=""
    [ -f "$MODE_FILE" ] || return
    local k v
    while IFS='=' read -r k v; do
        case "$k" in
            MODE)             MODE="$v" ;;
            WARDEN_URL)       WARDEN_URL="$v" ;;
            AUDIO_SERVER_URL) AUDIO_SERVER_URL="$v" ;;
            SATELLITE_URL)    SATELLITE_URL="$v" ;;
        esac
    done < "$MODE_FILE"
}

mode_write() {
    # Rewrite ~/.graice-mode from current globals.
    # The Pi is EITHER the Warden (standalone) OR a dumb mic/speaker (satellite):
    #   - WARDEN_URL       = the Warden. Standalone → localhost:3200 (this Pi
    #                        runs it). Satellite → unused by the button, kept as
    #                        localhost:3200. Never a remote address.
    #   - AUDIO_SERVER_URL = the ONLY remote IP the Pi ever needs. Satellite mode
    #                        only — the laptop running the voice client (hologram
    #                        control server, :8767, POST /press). Empty until set.
    #   - SATELLITE_URL    = this Pi's OWN audio relay (:8766), always localhost.
    {
        echo "MODE=${MODE:-standalone}"
        echo "WARDEN_URL=${WARDEN_URL:-http://localhost:3200}"
        echo "AUDIO_SERVER_URL=${AUDIO_SERVER_URL}"
        echo "SATELLITE_URL=${SATELLITE_URL:-http://localhost:8766}"
    } > "$MODE_FILE"
    echo "Wrote $MODE_FILE"
}

prompt_audio_server() {
    # Ask for the laptop/audio-server IP; build the full :8767 URL into AUDIO_SERVER_URL.
    local ip
    read -rp "Audio server IP (laptop running the voice client) [192.168.0.159]: " ip
    ip="${ip:-192.168.0.159}"
    AUDIO_SERVER_URL="http://${ip}:8767"
}

mode_menu() {
    while true; do
        mode_read
        clear
        echo "── Mode ──"
        echo "Three modes:"
        echo "  standalone — Pi IS the Warden (records here, hits localhost:3200)"
        echo "  satellite  — Pi is a dumb mic/speaker (button → laptop audio server)"
        echo "  both       — Pi runs the Warden AND is the mic/speaker (button → laptop,"
        echo "               laptop does STT/TTS and talks to the Pi's Warden)"
        echo ""
        echo "Current mode:   ${MODE:-(not set)}"
        if [ "$MODE" = "satellite" ] || [ "$MODE" = "both" ]; then
            echo "Audio server:   ${AUDIO_SERVER_URL:-(not set — set this!)}"
        fi
        if [ "$MODE" = "standalone" ] || [ "$MODE" = "both" ]; then
            echo "Warden (local): ${WARDEN_URL:-http://localhost:3200}"
        fi
        echo "This Pi relay:  ${SATELLITE_URL:-http://localhost:8766}"
        echo ""
        PS3="Mode > "
        select opt in \
            "Standalone — this Pi IS the Warden (button records here, hits localhost:3200)" \
            "Satellite  — this Pi is a dumb mic/speaker (button triggers the audio server)" \
            "Both       — Pi runs the Warden AND is the mic/speaker (button → laptop)" \
            "Edit audio server IP (satellite/both — the laptop running the voice client, :8767)" \
            "Start roles on this Pi (Warden / Satellite relay / Button)" \
            "Back"; do
            case $REPLY in
                1) MODE="standalone"; WARDEN_URL="http://localhost:3200"; SATELLITE_URL="http://localhost:8766"; mode_write; read -rp "Press Enter to continue…"; break ;;
                2) MODE="satellite"; SATELLITE_URL="http://localhost:8766"; prompt_audio_server; mode_write; read -rp "Press Enter to continue…"; break ;;
                3) MODE="both"; WARDEN_URL="http://localhost:3200"; SATELLITE_URL="http://localhost:8766"; prompt_audio_server; mode_write; read -rp "Press Enter to continue…"; break ;;
                4) prompt_audio_server; mode_write; read -rp "Press Enter to continue…"; break ;;
                5) mode_start; break ;;
                6) return ;;
            esac
        done
    done
}

mode_start() {
    mode_read
    echo ""
    echo "Mode is ${MODE:-(not set)} — this sets the BUTTON's behaviour:"
    echo "  standalone → button records here & hits the local Warden (${WARDEN_URL:-http://localhost:3200})"
    echo "  satellite  → button pokes the audio server (${AUDIO_SERVER_URL:-(not set)})"
    echo "Pick which roles THIS Pi runs:"
    echo "  standalone → start Warden + Button (this Pi is the brain)"
    echo "  satellite  → start Satellite relay + Button (this Pi is just mic/speaker)"
    echo "  both       → start Warden + Satellite relay + Button"
    echo ""
    read -rp "Start Warden (node dist/index.js)? [y/N] " yn
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
        nohup node dist/index.js > "$HOME/.graice-warden.log" 2>&1 &
        echo "Warden started, PID $!"
    fi
    read -rp "Start Satellite mic/speaker (python3 voice/satellite_server.py)? [y/N] " yn
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
        nohup python3 voice/satellite_server.py > "$HOME/.graice-satellite.log" 2>&1 &
        echo "Satellite started, PID $!"
    fi
    read -rp "Start button (python3 hardware/voice-button.py)? [y/N] " yn
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
        nohup python3 hardware/voice-button.py > "$HOME/.graice-button.log" 2>&1 &
        echo "Button started, PID $!"
    fi
    echo ""
    read -rp "Press Enter to continue…"
}

# ── Save as boot defaults ─────────────────────────────────────────────
save_defaults() {
    clear
    echo "── Save as Boot Defaults ──"
    echo ""
    local file="$HOME/.graice-boot-defaults"
    # WiFi
    local ssid; ssid=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep -v ':lo$' | head -1 | cut -d: -f1)
    if [ -n "$ssid" ]; then
        echo "WIFI_SSID=$ssid" > "$file"
        # Mark this connection autoconnect at boot with high priority so
        # NetworkManager reconnects to it natively on startup — independent
        # of the boot-defaults oneshot, which can fire too late (or never,
        # on a headless Pi) and runs nmcli from a user session that polkit
        # may deny. The profile persists in /etc/NetworkManager/system-connections.
        nmcli connection modify "$ssid" autoconnect yes connection.autoconnect-priority 100 2>/dev/null || true
    else
        echo "# no wifi connected" > "$file"
    fi
    # Bluetooth
    local bt bt_name
    bt=$(bluetoothctl devices 2>/dev/null | while read -r _ mac _; do bluetoothctl info "$mac" 2>/dev/null | grep -q "Connected: yes" && echo "$mac" && break; done)
    if [ -n "$bt" ]; then
        bt_name=$(bluetoothctl info "$bt" 2>/dev/null | awk -F': ' '/Name:/{print $2; exit}')
        echo "BT_DEVICE=$bt" >> "$file"
        [ -n "$bt_name" ] && echo "BT_NAME=$bt_name" >> "$file"
    fi
    # Audio
    if command -v wpctl >/dev/null 2>&1; then
        local sink; sink=$(wpctl status 2>/dev/null | sed 's/[│├└─]/ /g' | grep -A20 "Sinks:" | grep '^\s*\*' | grep -oP '\d+\.' | head -1 | tr -d '.')
        local src; src=$(wpctl status 2>/dev/null | sed 's/[│├└─]/ /g' | grep -A20 "Sources:" | grep '^\s*\*' | grep -oP '\d+\.' | head -1 | tr -d '.')
        [ -n "$sink" ] && echo "AUDIO_SINK=$sink" >> "$file"
        [ -n "$src" ] && echo "AUDIO_SOURCE=$src" >> "$file"
    fi
    echo ""
    echo "Saved to $file:"
    cat "$file"
    echo ""
    read -rp "Press Enter to continue…"
}

main