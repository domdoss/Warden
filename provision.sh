#!/usr/bin/env bash
# First-run provisioning for the Warden AppImage.
#   provision.sh --base       MARM (git) + autoupdater + Playwright + Chrome MCP
#   provision.sh --training   training venv (PyTorch/unslooth; several GB)
#   provision.sh --all        everything
#
# Idempotent. All writable state lives under $WARDEN_HOME (~/.local/share/warden);
# the AppImage mount itself is read-only.
set -euo pipefail

APP="${APP:-$(cd "$(dirname "$0")" && pwd)}"
WARDEN_HOME="${WARDEN_HOME:-$HOME/.local/share/warden}"
RUN="${WARDEN_RUN_DIR:-$WARDEN_HOME/run}"
MODE="${1:---base}"
say() { printf '  %s\n' "$*"; }
mkdir -p "$WARDEN_HOME" "$RUN"

install_marm() {
  local repo="$WARDEN_HOME/marm" ref="${MARM_GIT_REF:-MARM-main}" bin=""
  if [ ! -d "$repo/.git" ]; then
    say "cloning MARM ($ref)…"
    git clone --quiet --branch "$ref" https://github.com/Lyellr88/marm-memory "$repo"
  else
    git -C "$repo" fetch --quiet origin "$ref"
    git -C "$repo" checkout --quiet "$ref"
    git -C "$repo" pull --ff-only --quiet || true
  fi
  export PATH="$HOME/.local/bin:$PATH"
  if command -v uv >/dev/null 2>&1; then
    pkg="$repo"
    [ -f "$repo/marm-mcp-server/pyproject.toml" ] && pkg="$repo/marm-mcp-server"
    uv tool install --force "$pkg" >/dev/null 2>&1 || true
  fi
  if ! command -v marm-memory >/dev/null 2>&1 && command -v pipx >/dev/null 2>&1; then
    pipx install --force "$repo" >/dev/null 2>&1 || true
  fi
  if command -v marm-memory >/dev/null 2>&1; then
    bin="$(command -v marm-memory)"
    mkdir -p ~/.config/systemd/user ~/.config/systemd/user/marm-memory.service.d ~/.config/systemd/user/warden.service.d
    cat > ~/.config/systemd/user/marm-memory.service <<EOF
[Unit]
Description=MARM memory server (MCP over HTTP, 127.0.0.1:8001)
Before=warden.service
After=network.target

[Service]
ExecStart=$bin http --profile trusted
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    printf '[Service]\nEnvironment=MARM_TOPIC_MODEL=%s\n' "${MARM_TOPIC_MODEL:-granite4.2:30b}" \
      > ~/.config/systemd/user/marm-memory.service.d/topic-model.conf
    printf '[Unit]\nWants=marm-memory.service\nAfter=marm-memory.service\n' \
      > ~/.config/systemd/user/warden.service.d/marm.conf
    node "$APP/scripts/register-marm.mjs" "$bin" >/dev/null 2>&1 || true
    systemctl --user daemon-reload 2>/dev/null || true
    systemctl --user enable --now marm-memory 2>/dev/null || true
    say "MARM $(git -C "$repo" rev-parse --short HEAD) installed from git"
  else
    say "! MARM install failed (uv/pipx missing) — Warden runs without it"
  fi
}

install_marm_autoupdate() {
  mkdir -p ~/.config/systemd/user "$WARDEN_HOME"
  cp -f "$APP/update-marm.sh" "$WARDEN_HOME/update-marm.sh"
  chmod +x "$WARDEN_HOME/update-marm.sh"
  cp -f "$APP/warden-autoupdate-marm.service" ~/.config/systemd/user/
  cp -f "$APP/warden-autoupdate-marm.timer" ~/.config/systemd/user/
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable --now warden-autoupdate-marm.timer 2>/dev/null || true
  say "MARM autoupdater enabled (daily + boot)"
}

install_playwright() {
  export PLAYWRIGHT_BROWSERS_PATH="$WARDEN_HOME/ms-playwright"
  if [ -x "$RUN/node_modules/.bin/playwright" ]; then
    "$RUN/node_modules/.bin/playwright" install chromium >/dev/null 2>&1 \
      && say "Playwright chromium ready" \
      || say "! Playwright chromium install failed"
  elif [ -x "$APP/node_modules/.bin/playwright" ]; then
    "$APP/node_modules/.bin/playwright" install chromium >/dev/null 2>&1 \
      && say "Playwright chromium ready" \
      || say "! Playwright chromium install failed"
  else
    say "Playwright module not bundled — skipping (Chrome bridge still works)"
  fi
}

install_chrome_mcp() {
  if ! command -v mcp-chrome-bridge >/dev/null 2>&1; then
    npm install -g mcp-chrome-bridge >/dev/null 2>&1 \
      && say "mcp-chrome-bridge installed" \
      || say "! mcp-chrome-bridge install failed"
  fi
  mkdir -p "$WARDEN_HOME/chrome-mcp-server"
  if [ -f "$APP/chrome-mcp-server-1.0.0.zip" ]; then
    unzip -oq "$APP/chrome-mcp-server-1.0.0.zip" -d "$WARDEN_HOME/chrome-mcp-server" || true
  fi
  say "Chrome MCP: load unpacked from $WARDEN_HOME/chrome-mcp-server at chrome://extensions (one time)"
}

install_training() {
  [ -d "$RUN/training" ] || cp -a "$APP/training" "$RUN/training"
  local t="$RUN/training"
  if [ ! -x "$t/.venv/bin/python" ]; then
    say "creating training venv (large; this takes a while)…"
    python3 -m venv "$t/.venv"
    "$t/.venv/bin/pip" install -q --upgrade pip
    "$t/.venv/bin/pip" install -q -r "$t/requirements.txt" \
      || say "! training deps failed — open the Training view and retry"
  fi
  say "training pipeline ready at $t"
}

MARM_ON="${WARDEN_PROVISION_MARM:-1}"
BROWSER_ON="${WARDEN_PROVISION_BROWSER:-1}"
base() {
  if [ "$MARM_ON" = "1" ]; then install_marm; install_marm_autoupdate; fi
  if [ "$BROWSER_ON" = "1" ]; then install_playwright; install_chrome_mcp; fi
}
case "$MODE" in
  --training) install_training ;;
  --all) base; [ "${WARDEN_PROVISION_TRAINING:-0}" = "1" ] && install_training || true ;;
  *) base; [ "${WARDEN_PROVISION_TRAINING:-0}" = "1" ] && install_training || true ;;
esac

mkdir -p "$HOME/.config/warden"
date -u +%FT%TZ > "$HOME/.config/warden/provisioned"
say "provisioning complete: $MODE"
