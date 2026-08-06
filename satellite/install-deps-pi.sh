#!/usr/bin/env bash
set -e

# Warden system dependencies for Raspberry Pi OS (Debian, apt, ARM).
# Headless-minimal: Node, npm, native build toolchain, poppler (pdftotext),
# sqlite, tmux. Skips Chromium, desktop-control, and PIM stack — a Pi has no
# display, and those features silently no-op without them.
#
# Pair with install.sh, which calls this when apt is present and pacman isn't.

echo "Installing Warden system dependencies (Raspberry Pi OS / apt)..."

if ! command -v apt-get >/dev/null; then
  echo "This script targets apt-based systems (Raspberry Pi OS / Debian)." >&2
  exit 1
fi

# Refresh package metadata once.
sudo apt-get update

# Core toolchain: build-essential covers gcc/g++/make for better-sqlite3's
# native build (the base-devel equivalent); poppler-utils provides pdftotext;
# sqlite3 is the CLI; tmux matches the host install; curl pulls in NodeSource.
# network-manager (nmcli) drives the WiFi controls; bluez + bluetoothctl drive
# the Bluetooth controls; pipewire/wireplumber drive mic+speaker volume and
# output selection (a Bluetooth headset's A2DP+HFP needs PipeWire — bare ALSA
# can't route the headset mic cleanly).
sudo apt-get install -y --no-install-recommends \
  build-essential \
  git \
  poppler-utils \
  sqlite3 \
  tmux \
  curl \
  ca-certificates \
  network-manager \
  bluez \
  bluetooth \
  pipewire \
  pipewire-pulse \
  wireplumber \
  pipewire-audio-client-libraries \
  alsa-utils \
  python3-gpiozero \
  chromium

# Bluetooth stack: enable the system bluetooth daemon and put the user in the
# groups that let bluetoothctl / wpctl reach BlueZ and PipeWire without sudo.
# AutoEnable=true makes BlueZ power the adapter at boot — without it the
# controller stays DOWN and `bluetoothctl scan on` fails with NotReady.
sudo systemctl enable --now bluetooth 2>/dev/null || true
sudo sed -i 's/^#*AutoEnable=.*/AutoEnable=true/' /etc/bluetooth/main.conf 2>/dev/null || \
  { printf '\n[Policy]\nAutoEnable=true\n' | sudo tee -a /etc/bluetooth/main.conf >/dev/null; }
sudo systemctl restart bluetooth 2>/dev/null || true
sudo usermod -aG bluetooth,input,audio,netdev "$USER" 2>/dev/null || true

# PipeWire runs as a systemd --user service. Enable (don't start here — there's
# no user session yet during install); it starts at first login / when warden
# lingers, and the warden unit's ExecStartPre imports DBUS_SESSION_BUS_ADDRESS
# so wpctl/bluetoothctl spawned by Warden can talk to it.
systemctl --user enable pipewire pipewire-pulse wireplumber 2>/dev/null || true

# Graice boot-defaults oneshot: restores the saved WiFi/Bluetooth/audio at
# boot. Runs as a user service (needs linger, enabled below). Ordered after
# pipewire/wireplumber so the audio nodes exist when it sets wpctl defaults.
# WiFi itself sticks via the nmcli autoconnect flag the TUI sets on the
# profile; this service is the belt-and-suspenders reconnect + BT/audio restore.
if [ -f "$PWD/tui/graice-boot-defaults.service" ] && [ -f "$PWD/tui/boot-defaults.sh" ]; then
  mkdir -p "$HOME/.config/systemd/user"
  cp "$PWD/tui/graice-boot-defaults.service" "$HOME/.config/systemd/user/" 2>/dev/null || true
  cp "$PWD/tui/boot-defaults.sh" "$HOME/Graice/tui/boot-defaults.sh" 2>/dev/null || \
    { mkdir -p "$HOME/Graice/tui" && cp "$PWD/tui/boot-defaults.sh" "$HOME/Graice/tui/boot-defaults.sh" 2>/dev/null || true; }
  chmod +x "$HOME/Graice/tui/boot-defaults.sh" 2>/dev/null || true
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable graice-boot-defaults.service 2>/dev/null || true
fi

# Ollama — the orchestrator's LLM. Runs `ollama serve` on 127.0.0.1:11434; the
# orchestrator routes to it via the credential proxy's /ollama/* passthrough.
# Cloud models (the :cloud suffix) run on Ollama's servers, so the Pi stays
# low-RAM — it only proxies. The account is set up by copying the user's
# ~/.ollama keypair (see install.sh); the installer just needs the binary.
if ! command -v ollama >/dev/null; then
  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Node.js >= 20. Raspberry Pi OS ships an ancient Node in apt, so use the
# NodeSource deb for v20 (supports armhf/arm64). Skip if a suitable node is
# already present (e.g. installed manually or via nvm).
need_node=1
if command -v node >/dev/null; then
  if [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 20 ]; then
    need_node=0
  fi
fi
if [ "$need_node" = "1" ]; then
  echo "Installing Node.js 20 (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Enable linger so the systemd --user service keeps running with no login
# session (needed for scheduled tasks). Safe on Pi OS, which uses systemd.
sudo loginctl enable-linger "$USER" 2>/dev/null || true

echo ""
echo "Done. Node: $(node -v 2>/dev/null || echo 'not on PATH — open a new shell')."