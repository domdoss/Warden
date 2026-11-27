#!/usr/bin/env bash
# Create a clean production Warden directory: the base app only, no dev tree,
# no runtime data, no addons, no models, no APK.
#   ./make-production-dir.sh [target]      default: ~/warden-production
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
PROD="${1:-$HOME/warden-production}"

if [ -e "$PROD" ] && [ ! -f "$PROD/.warden-production" ]; then
  echo "Refusing to overwrite $PROD (no .warden-production marker)." >&2
  exit 1
fi

# Preserve .git so the repo can live inside the production dir.
if [ -d "$PROD/.git" ]; then
  find "$PROD" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} + 2>/dev/null || true
else
  rm -rf "$PROD"
fi
mkdir -p "$PROD"

rsync -a \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
  --exclude 'release' --exclude 'store' --exclude 'data' --exclude 'logs' \
  --exclude 'backups' --exclude 'out' --exclude 'tmp' --exclude 'trading' \
  --exclude 'imagegen/models' --exclude 'groups' --exclude 'home' \
  --exclude 'Notes' --exclude 'plasma' --exclude 'clients' \
  --exclude 'warden-android' --exclude 'eyes_ears' \
  --exclude 'voice' --exclude 'images' \
  --exclude 'public/warden.apk' --exclude 'warden.apk' \
  --exclude '*.tar.gz' --exclude 'warden-fixes.zip' --exclude 'patch.zip' \
  --exclude 'heimdall-removal.zip' --exclude 'dockbox-single.zip' \
  --exclude '.venv' --exclude '.aider-venv' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude 'training/.venv' --exclude 'training/*.gguf' --exclude 'training/*.log' \
  --exclude 'training/*-lora*' --exclude 'training/mentara' \
  --exclude 'training/atlasorch-run.log' --exclude 'training/.pytest_cache' \
  --exclude 'training/loop/logs' --exclude 'training/loop/catalogs' \
  --exclude 'training/loop/flags' --exclude 'training/chatbot/logs' \
  --exclude 'unsloth_compiled_cache' --exclude '.dart_tool' --exclude '.gradle' \
  --exclude 'install.sh' --exclude 'install-macos.sh' --exclude 'run.sh' \
  --exclude 'docs' --exclude 'docker' --exclude 'tests' --exclude 'e2e-loop' \
  --exclude '.claude' --exclude '.github' --exclude '.dockerignore' \
  --exclude '/ARTEMIS_NOTES.md' --exclude '/CALENDAR_API_FIX.md' --exclude '/CLAUDE.md' \
  --exclude '/DOCKBOX.md' --exclude '/HA_AGENT_PLAN.md' --exclude '/HERMES_PLAN.md' \
  --exclude '/KONTACT_PLAN.md' --exclude '/MACOS_PORT_PLAN.md' --exclude '/MERCURY_MEMORY.md' \
  --exclude '/NOTES_PLAN.md' --exclude '/OPENCODE_RUNNER.md' --exclude '/PIM_TABS_PLAN.md' \
  --exclude '/ROUTING_PATH_FIX_NOTES.md' --exclude '/essay_latest.md' --exclude '/glm.md' \
  --exclude '/jarvis-audit-test.md' --exclude '/aionsystems-ad-copy-and-image-prompts.md' \
  --exclude '/next.md' --exclude '/MANIFEST.txt' --exclude '/dryfire_baseline.txt' \
  --exclude '/patch.patch' --exclude '/patch.zip' --exclude '/warden-fixes.zip' \
  --exclude '/mtree-*.mjs' --exclude '/marm-map-exporter.mjs' --exclude '/safe-copy.sh' \
  --exclude 'public/conn-deploy.zip' --exclude '*.zip' --exclude '*.db' --exclude 'store.db*' \
  --exclude 'telegram-inbox' --exclude 'tools' --exclude 'tsconfig.json' \
  --exclude 'work.md' --exclude 'to-do.md' --exclude 'voice.md' \
  --exclude 'WIDGET_PLAN.md' --exclude 'SECURITY_DESKTOP_FIXES.md' \
  --exclude '.opencode' --exclude '.pi-edits' --exclude '.venv314-broken' \
  --exclude 'public/index-old-root.html' --exclude 'public/index.html.bak' \
  --exclude 'scripts/start-alpha-webapp.sh' \
  --exclude 'training/orchatlas-parts' --exclude 'training/seat-tests' --exclude '*.jsonl' \
  --exclude 'README.md' \
  "$SRC/" "$PROD/"

# The Chrome MCP extension zip is excluded by the generic *.zip rule, but the
# provisioner needs it.
[ -f "$SRC/chrome-mcp-server-1.0.0.zip" ] && cp -f "$SRC/chrome-mcp-server-1.0.0.zip" "$PROD/"

# Compiled backend + runtime dependencies.
rsync -a "$SRC/dist/" "$PROD/dist/"
rsync -a "$SRC/node_modules/" "$PROD/node_modules/"
if [ -d "$SRC/container/agent-runner/node_modules" ]; then
  rsync -a "$SRC/container/agent-runner/node_modules/" "$PROD/container/agent-runner/node_modules/"
fi

# Provisioning + MARM autoupdater (same scripts the AppImage ships).
cp -f "$SRC/release/provision.sh" "$SRC/release/update-marm.sh" "$SRC/release/onboard.mjs" "$PROD/"
cp -f "$SRC/release"/warden-autoupdate-marm.* "$PROD/"
chmod +x "$PROD/provision.sh" "$PROD/update-marm.sh"

cat > "$PROD/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export WARDEN_INSTALL_DIR="$PWD"
export APP="$PWD"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/Warden}"
if [ ! -f data/.onboarded ]; then exec node onboard.mjs; fi
mkdir -p "$WORKSPACE_ROOT/groups/main"
exec node dist/index.js
EOF

cat > "$PROD/provision-local.sh" <<'EOF'
#!/usr/bin/env bash
# Provision this production directory in place (MARM, Playwright, Chrome MCP).
#   ./provision-local.sh --base
#   ./provision-local.sh --training
set -euo pipefail
cd "$(dirname "$0")"
APP="$PWD" RUN="$PWD" WARDEN_RUN_DIR="$PWD" bash "$PWD/provision.sh" "$@"
EOF
chmod +x "$PROD/start.sh" "$PROD/provision-local.sh"

mkdir -p "$PROD/data/env"
cat > "$PROD/data/env/env.example" <<'EOF'
ASSISTANT_NAME=Warden
TZ=America/Vancouver
OLLAMA_URL=http://127.0.0.1:11434
WORKSPACE_ROOT=~/Warden
EOF

cat > "$PROD/PRODUCTION.md" <<'EOF'
# Warden — clean production directory

Base app only. No dev tree, no chat DB/sessions/logs/groups, no addons,
no image models, no APK.

## Run

    ./start.sh

Requires Node 20+ and Ollama. Runtime data is created in this directory
(`store/`, `data/`, `logs/`) and in `WORKSPACE_ROOT` (`~/Warden`).

## Provision

    ./provision-local.sh --base       # MARM (git), Playwright, Chrome MCP
    ./provision-local.sh --training   # training venv
    ./update-marm.sh                  # pull latest MARM from git

Chromium/Playwright browsers land in `~/.local/share/warden/ms-playwright`.
Local image generation needs the imagegen models installed separately
(`imagegen/models` is intentionally excluded).

## Not included

- Alpha Stack (`trading/`)
- Android automation / APK
- eyes_ears voice UI
- Saved data, logs, sessions, groups, backups, image models

Linux only.
EOF

cat > "$PROD/README.md" <<'EOF'
# Warden

A local-first AI assistant for Linux. One seat that answers and does the work
itself — browser, desktop, shell, files, web — with local models through Ollama
and cloud models only when you choose.

## First run

    ./start.sh

The first launch opens a setup page in your browser: pick the home folder,
point at Ollama, optionally add Telegram/Tailscale, and Warden installs MARM,
Playwright and the Chrome MCP bridge. No keys or data are bundled.

## What is here

    dist/           compiled backend
    public/         dashboard
    training/       self-training pipeline (code only)
    imagegen/       local image generation script (models separate)
    scripts/        maintenance helpers
    start.sh        launcher (first run = setup)
    provision-local.sh   install MARM / browser / training venv

Addons (Alpha Stack, Android control, the mobile APK) are separate.

Linux only.
EOF

date -u +%FT%TZ > "$PROD/.warden-production"
echo "Production dir: $PROD"
du -sh "$PROD"
