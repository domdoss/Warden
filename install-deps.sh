#!/usr/bin/env bash
set -e

echo "Installing Warden system dependencies..."

# Core toolchain. base-devel (gcc/make) + python are needed by node-gyp to build
# native npm addons (better-sqlite3, node-pty, sharp, @napi-rs/canvas).
sudo pacman -S --needed --noconfirm \
  nodejs npm \
  git \
  base-devel \
  poppler \
  tmux \
  sqlite \
  libvips \
  cairo pango libjpeg-turbo giflib librsvg

# Browser for the agent's native browser_* DOM tools. playwright-core
# attaches to it over CDP and downloads no browser of its own, so a system
# Chromium (or google-chrome from the AUR) must exist.
sudo pacman -S --needed --noconfirm chromium

# Desktop control tools (KDE Plasma target, but the Wayland and X11 tools
# cover fallback compositors too).
sudo pacman -S --needed --noconfirm \
  qt6-tools \
  libnotify \
  xdg-utils \
  ydotool \
  wtype \
  grim \
  wl-clipboard \
  xdotool \
  wmctrl \
  scrot \
  xclip

# PIM hub — Kontact integration. Radicale is the local CalDAV/CardDAV
# server (single source of truth for calendar/contacts/todos); install.sh
# provisions a user systemd service for it only when the binary is present,
# so it must be installed here or the Kontact features silently no-op.
# kdepim-runtime ships the Akonadi DAV groupware resource that Kontact uses
# to mount Radicale's collections; kontact is the shell (harmless if already
# installed, --needed skips it).
sudo pacman -S --needed --noconfirm \
  radicale \
  akonadi \
  kdepim-runtime \
  kontact

# Python (voice + security apps) and the native headers/libraries their pip
# packages build or run against: portaudio for pyaudio, ffmpeg for
# openai-whisper, pipewire for the satellite relay's pw-record/pw-play (and
# the desktop audio path), espeak-ng for kokoro's phonemizer, rsync for the
# installer's deploy step. opencv + cmake let opencv-python use the system
# lib instead of building from source (security app). qt6-wayland is needed
# for pywebview[qt] to render on Wayland (KDE Plasma target). The venvs
# themselves are created by install.sh.
sudo pacman -S --needed --noconfirm \
  python \
  python-pip \
  python-setuptools \
  portaudio \
  ffmpeg \
  pipewire \
  espeak-ng \
  rsync \
  opencv \
  cmake \
  qt6-wayland

# Enable linger so the systemd --user service keeps running when no login
# session is active (needed for scheduled tasks etc.)
sudo loginctl enable-linger "$USER"

# ydotool needs a running daemon and access to /dev/uinput. The system
# service ships with the ydotool package; enable it and add the user to the
# input group so ydotool commands work without sudo.
if systemctl list-unit-files ydotool.service >/dev/null 2>&1; then
  sudo systemctl enable --now ydotool.service || true
fi
sudo usermod -aG input "$USER" || true

echo ""
echo "Done. Log out and back in for input group membership to take effect."
