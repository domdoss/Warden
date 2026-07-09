#!/usr/bin/env bash
# Prometheus installer — single-user, host-native (no Docker).
# Target: Linux (Arch/KDE Plasma primary). Run from the project root.
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PROJECT_DIR/data/env/env"
cd "$PROJECT_DIR"

echo ""
echo "  Prometheus · Personal AI Assistant"
echo "  -------------------------------"
echo ""
echo "  WARNING: this runs an autonomous agent with the same access as your"
echo "  user account — files, shell, browser, desktop. No sandbox, no"
echo "  permission prompts. Use a dedicated machine or VM, not a daily driver."
echo ""
read -r -p "  Type I UNDERSTAND to continue: " ACK
[ "$ACK" = "I UNDERSTAND" ] || { echo "  Aborted."; exit 1; }

# ── Pre-flight ───────────────────────────────────────────────────────
command -v node >/dev/null || { echo "  Node.js >= 20 required: https://nodejs.org"; exit 1; }
[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 20 ] || { echo "  Node.js >= 20 required (found $(node -v))"; exit 1; }

# System packages (chromium for the native browser tools, desktop control,
# PIM stack). Arch only; on other distros install the equivalents by hand.
if command -v pacman >/dev/null && [ -f "$PROJECT_DIR/install-deps.sh" ]; then
    read -r -p "  Install system packages via install-deps.sh (sudo pacman)? [Y/n] " R
    [ "$R" = "n" ] || [ "$R" = "N" ] || bash "$PROJECT_DIR/install-deps.sh"
fi
command -v chromium >/dev/null || command -v google-chrome >/dev/null || command -v google-chrome-stable >/dev/null \
    || echo "  ! No chromium/google-chrome found — browser tools won't work until one is installed."

# ── Build ────────────────────────────────────────────────────────────
echo "  Installing npm dependencies..."
if [ -f package-lock.json ]; then npm ci --loglevel=warn 2>&1 | tail -2; else npm install --loglevel=warn 2>&1 | tail -2; fi
( cd container/agent-runner && if [ -f package-lock.json ]; then npm ci --loglevel=warn 2>&1 | tail -1; else npm install --loglevel=warn 2>&1 | tail -1; fi )
echo "  Building..."
npm run build 2>&1 | tail -1

# ── Config ───────────────────────────────────────────────────────────
mkdir -p "$PROJECT_DIR/data/env" "$PROJECT_DIR/logs" "$PROJECT_DIR/store" "$PROJECT_DIR/groups/main"

if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<'ENVEOF'
# Prometheus configuration. Uncomment and fill what you use.
ASSISTANT_NAME=Prometheus
TZ=UTC

# LLM access — set ONE of these, or run Ollama locally (default URL below).
#ANTHROPIC_API_KEY=
#CLAUDE_CODE_OAUTH_TOKEN=
#OLLAMA_URL=http://127.0.0.1:11434

# Agent workspace (files the agent works in)
#WORKSPACE_ROOT=~/Documents/Prometheus

# Channels (optional — dashboard works without any)
#TELEGRAM_BOT_TOKEN=
#SLACK_BOT_TOKEN=
#SLACK_TEAM_ID=

# Browser tools (defaults shown)
#BROWSER_CDP_PORT=9222
#BROWSER_BIN=
#BROWSER_HEADLESS=
ENVEOF
    echo "  Wrote config template to data/env/env — edit it to add your keys."
fi

echo "  Initializing database..."
node --input-type=module -e "import { initDatabase } from './dist/db.js'; initDatabase(); console.log('  Database ready');"

# ── Services (systemd user units) ────────────────────────────────────
mkdir -p ~/.config/systemd/user

# Radicale PIM hub (calendar/contacts/todos) — only if installed.
if command -v radicale >/dev/null; then
    mkdir -p ~/.config/radicale ~/.local/share/radicale/collections
    if [ ! -f ~/.config/radicale/config ]; then
        printf '[server]\nhosts = 127.0.0.1:5232\n\n[auth]\ntype = none\n\n[rights]\ntype = authenticated\n\n[storage]\nfilesystem_folder = ~/.local/share/radicale/collections\n' > ~/.config/radicale/config
    fi
    cat > ~/.config/systemd/user/radicale.service <<'RADEOF'
[Unit]
Description=Radicale CalDAV/CardDAV server (Prometheus PIM hub)
After=network.target

[Service]
ExecStart=/usr/bin/radicale
Restart=on-failure

[Install]
WantedBy=default.target
RADEOF
    systemctl --user daemon-reload
    systemctl --user enable --now radicale 2>/dev/null || true
    echo "  Radicale PIM hub running on 127.0.0.1:5232"
fi

NODE_BIN="$(command -v node)"
cat > ~/.config/systemd/user/prometheus.service <<EOF
[Unit]
Description=Prometheus Personal AI Assistant
After=network.target graphical-session.target radicale.service
Wants=radicale.service
PartOf=graphical-session.target

[Service]
Type=simple
ExecStartPre=-/bin/sh -c 'systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE XDG_CURRENT_DESKTOP 2>/dev/null || true'
ExecStart=${NODE_BIN} ${PROJECT_DIR}/dist/index.js
WorkingDirectory=${PROJECT_DIR}
Restart=always
RestartSec=5
StandardOutput=append:${PROJECT_DIR}/logs/prometheus.log
StandardError=append:${PROJECT_DIR}/logs/prometheus.error.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now prometheus 2>/dev/null || true
loginctl enable-linger "$USER" 2>/dev/null || true

echo ""
echo "  Done. Dashboard: http://localhost:3200"
echo "  Config:  $ENV_FILE  (add your LLM key/token if you skipped it)"
echo "  Logs:    $PROJECT_DIR/logs/prometheus.log"
echo ""
