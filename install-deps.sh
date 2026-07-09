#!/usr/bin/env bash
set -e

echo "Installing Prometheus system dependencies..."

# Core toolchain
sudo pacman -S --needed --noconfirm \
  nodejs npm \
  git \
  base-devel \
  poppler \
  tmux \
  sqlite

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
