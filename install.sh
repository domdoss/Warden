#!/usr/bin/env bash
# Warden installer — single-user, host-native (no Docker).
#
# Deploys the project to /opt/warden, builds the Node backend, creates the
# voice + security Python venvs, and provisions a systemd --user service.
# Runtime data (notes, memory, uploads, groups) lives in $WORKSPACE_ROOT
# (~/warden), separate from the code so a reinstall preserves it.
#
# Target: Linux (Arch/KDE Plasma primary). Run from the project root:
#   ./install.sh
#
# Override the install/workspace locations:
#   WARDEN_INSTALL_DIR=/opt/warden WARDEN_WORKSPACE=$HOME/warden ./install.sh
set -e

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${WARDEN_INSTALL_DIR:-/opt/warden}"
WORKSPACE_ROOT="${WARDEN_WORKSPACE:-$HOME/warden}"

echo ""
echo "  Warden · Personal AI Assistant"
echo "  -------------------------------"
echo "  Install target:  $INSTALL_DIR"
echo "  Workspace root:  $WORKSPACE_ROOT"
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
command -v python3 >/dev/null || { echo "  python3 required (e.g. sudo pacman -S python)"; exit 1; }
python3 -m venv --help >/dev/null 2>&1 || { echo "  python3-venv required (e.g. sudo pacman -S python; on Debian/Ubuntu: python3-venv)"; exit 1; }

# System packages (chromium for the native browser tools, desktop control,
# PIM stack, Python audio/ML headers, rsync for the deploy). Arch only; on
# other distros install the equivalents by hand. Run this before the rsync
# check — install-deps.sh installs rsync.
if command -v pacman >/dev/null && [ -f "$SOURCE_DIR/install-deps.sh" ]; then
    read -r -p "  Install system packages via install-deps.sh (sudo pacman)? [Y/n] " R
    [ "$R" = "n" ] || [ "$R" = "N" ] || bash "$SOURCE_DIR/install-deps.sh"
fi
command -v rsync >/dev/null || { echo "  rsync required (e.g. sudo pacman -S rsync)"; exit 1; }
command -v chromium >/dev/null || command -v google-chrome >/dev/null || command -v google-chrome-stable >/dev/null \
    || echo "  ! No chromium/google-chrome found — browser tools won't work until one is installed."

# ── Deploy to $INSTALL_DIR ───────────────────────────────────────────
# Sync the working tree (including uncommitted dev changes) into the install
# dir. Preserve data that must survive a reinstall: the DB (store/), config
# (data/), logs, and the Python venvs (reused below). dist/ and node_modules/
# are rebuilt in place. If install.sh is already run from $INSTALL_DIR, the
# rsync is a no-op self-sync.
echo "  Installing Warden to $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR"
sudo chown "$USER:$(id -gn)" "$INSTALL_DIR"
if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.venv' \
    --exclude 'store' \
    --exclude 'data' \
    --exclude 'logs' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "$SOURCE_DIR/" "$INSTALL_DIR/"
fi
cd "$INSTALL_DIR"

# ── Build ────────────────────────────────────────────────────────────
# Harden the install: surface real errors instead of swallowing them.
# The old version piped npm through `tail`, which returns exit 0 even when
# npm fails — so a broken install marched on to a broken build and the user
# only saw the last line of 700+ tsc errors ("src missing"). pipefail makes
# a failed npm command fail the pipeline; dropping `tail` lets the real
# error stream to the console. `set -e` (set at top of script) then aborts.
set -o pipefail
# Dev/build deps (typescript, @types/node) are REQUIRED to compile — without
# them `tsc` is missing and every use of process/fs/Buffer is an error. The
# caller's shell may export NODE_ENV=production, which makes npm skip devDeps
# and break the build. Force development for the install and pass --include=dev
# explicitly so the build toolchain is always installed.
export NODE_ENV=development
NPM_INSTALL_FLAGS=(--include=dev --ignore-scripts --loglevel=warn)

echo "  Installing npm dependencies..."
if [ -f package-lock.json ]; then
  npm ci "${NPM_INSTALL_FLAGS[@]}" \
    || { echo "  ! npm ci failed (lockfile may be out of sync with this npm version); retrying with npm install..."; \
         npm install "${NPM_INSTALL_FLAGS[@]}"; }
else
  npm install "${NPM_INSTALL_FLAGS[@]}"
fi

echo "  Installing agent-runner dependencies..."
( cd container/agent-runner && if [ -f package-lock.json ]; then
    npm ci "${NPM_INSTALL_FLAGS[@]}" \
      || { echo "  ! agent-runner npm ci failed; retrying with npm install..."; \
           npm install "${NPM_INSTALL_FLAGS[@]}"; }
  else
    npm install "${NPM_INSTALL_FLAGS[@]}"
  fi )

echo "  Building..."
npm run build

# ── Config ───────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/data/env" "$INSTALL_DIR/logs" "$INSTALL_DIR/store" \
         "$WORKSPACE_ROOT" "$WORKSPACE_ROOT/groups/main"

ENV_FILE="$INSTALL_DIR/data/env/env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<'ENVEOF'
# Warden configuration. Uncomment and fill what you use.
ASSISTANT_NAME=Warden
TZ=UTC

# Dashboard admin password (required for dashboard login).
ADMIN_PASSWORD=warden

# LLM access — set ONE of these, or run Ollama locally (default URL below).
#ANTHROPIC_API_KEY=
#CLAUDE_CODE_OAUTH_TOKEN=
#OLLAMA_URL=http://127.0.0.1:11434

# Local model settings (used when OLLAMA_URL is set).
#OLLAMA_CHAT_MODEL=llama3.2:latest
#LOCAL_ASSISTANT_NAME=Kimi
#DEFAULT_MODEL_MODE=

# Agent workspace (files the agent works in). Set by the systemd unit; this
# line is a fallback for manual `node dist/index.js` runs.
#WORKSPACE_ROOT=~/warden

# Dashboard port (default 3200).
#STATUS_PORT=3200

# Agent idle timeout in ms (default 1 hour).
#IDLE_TIMEOUT=3600000

# Channels (optional — dashboard works without any)
#TELEGRAM_BOT_TOKEN=
#SLACK_BOT_TOKEN=
#SLACK_TEAM_ID=

# PIM hub (Radicale CalDAV/CardDAV). Uncomment if you use calendar/contacts.
#RADICALE_URL=http://127.0.0.1:5232
#RADICALE_USER=
#RADICALE_PASS=
#RADICALE_CAL_COLLECTION=warden-calendar
#RADICALE_CARD_COLLECTION=warden-contacts

# Browser tools (defaults shown)
#BROWSER_CDP_PORT=9222
#BROWSER_BIN=
#BROWSER_HEADLESS=
ENVEOF
    echo "  Wrote config template to $ENV_FILE — edit it to add your keys."
fi
# Record the resolved workspace root so manual (non-systemd) launches use it.
grep -q "^WORKSPACE_ROOT=" "$ENV_FILE" 2>/dev/null || echo "WORKSPACE_ROOT=$WORKSPACE_ROOT" >> "$ENV_FILE"

# ── Voice + security config templates ───────────────────────────────
# Copy example configs if the real ones don't exist yet.
if [ ! -f "$INSTALL_DIR/voice/config/settings.yaml" ] && [ -f "$INSTALL_DIR/voice/config/settings.example.yaml" ]; then
    cp "$INSTALL_DIR/voice/config/settings.example.yaml" "$INSTALL_DIR/voice/config/settings.yaml"
    echo "  Wrote voice config template — edit $INSTALL_DIR/voice/config/settings.yaml"
fi
if [ ! -f "$INSTALL_DIR/security/config/settings.yaml" ] && [ -f "$INSTALL_DIR/security/config/settings.example.yaml" ]; then
    cp "$INSTALL_DIR/security/config/settings.example.yaml" "$INSTALL_DIR/security/config/settings.yaml"
    echo "  Wrote security config template — edit $INSTALL_DIR/security/config/settings.yaml"
fi

echo "  Initializing database..."
node --input-type=module -e "import { initDatabase } from './dist/db.js'; initDatabase(); console.log('  Database ready');"

# ── Voice + security Python apps ─────────────────────────────────────
# The Node backend (above) is the brain; the voice + security venvs are the
# ears/eyes. Each gets its own venv under $INSTALL_DIR. Best-effort: a failure
# warns but doesn't tear down the backend already installed.
install_venv() {  # $1 = app dir, $2 = requirements file
  local dir="$1" req="$2" name venv
  name="$(basename "$dir")"
  venv="$dir/.venv"
  if [ ! -x "$venv/bin/python" ]; then
    echo "  [$name] creating venv..."
    if ! python3 -m venv "$venv"; then
      echo "  ! [$name] venv creation failed (check disk space and permissions); skipping."
      return 1
    fi
  fi
  "$venv/bin/python" -m pip install --upgrade pip setuptools wheel >/dev/null 2>&1 || true
  echo "  [$name] installing requirements ($(basename "$req"))..."
  if "$venv/bin/pip" install -r "$req"; then
    echo "  [$name] OK"
  else
    echo "  ! [$name] some requirements failed — $name may be incomplete."
    return 1
  fi
}

PY_FAIL=0
install_venv "$INSTALL_DIR/voice" "$INSTALL_DIR/voice/requirements.txt" || PY_FAIL=1

# Optional GPU TTS engines (vLLM "orpheus") — CUDA-only, not used on the AMD
# box (which runs kokoro / orpheus_cpp). Best-effort; never fatal.
if [ -f "$INSTALL_DIR/voice/requirements-tts-optional.txt" ]; then
  echo "  [voice] optional GPU TTS engines (best-effort)..."
  "$INSTALL_DIR/voice/.venv/bin/pip" install -r "$INSTALL_DIR/voice/requirements-tts-optional.txt" \
    2>/dev/null && echo "  [voice] optional TTS engines OK" \
    || echo "  ! optional TTS engines skipped (install manually for the vLLM 'orpheus' engine)"
fi

install_venv "$INSTALL_DIR/security" "$INSTALL_DIR/security/requirements.txt" || PY_FAIL=1

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
Description=Radicale CalDAV/CardDAV server (Warden PIM hub)
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
cat > ~/.config/systemd/user/warden.service <<EOF
[Unit]
Description=Warden Personal AI Assistant
After=network.target graphical-session.target radicale.service
Wants=radicale.service
PartOf=graphical-session.target

[Service]
Type=simple
Environment=WORKSPACE_ROOT=${WORKSPACE_ROOT}
ExecStartPre=-/bin/sh -c 'systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE XDG_CURRENT_DESKTOP 2>/dev/null || true'
ExecStart=${NODE_BIN} ${INSTALL_DIR}/dist/index.js
WorkingDirectory=${INSTALL_DIR}
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/logs/warden.log
StandardError=append:${INSTALL_DIR}/logs/warden.error.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now warden 2>/dev/null || true
loginctl enable-linger "$USER" 2>/dev/null || true

echo ""
echo "  Done. Installed to $INSTALL_DIR"
echo "  Dashboard: http://localhost:3200"
echo "  Config:    $ENV_FILE  (add your LLM key/token if you skipped it)"
echo "  Workspace: $WORKSPACE_ROOT  (notes/memory/uploads/groups)"
echo "  Logs:      $INSTALL_DIR/logs/warden.log"
[ "$PY_FAIL" = "1" ] && echo "  ! One or more Python apps failed to install fully — see warnings above."
echo "  Voice/security entrypoint: $INSTALL_DIR/run.sh"
echo ""