#!/usr/bin/env bash
# Warden (warden) — macOS installer. Run from the unzipped repo root:
#   cd warden && bash install-macos.sh
# Installs system deps (Homebrew), builds, and loads
# both services as launchd LaunchAgents (auto-start on login, keep-alive).
set -euo pipefail

BOLD='\033[1m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
die()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This script is for macOS. Use install.sh on Linux."
[ -f package.json ] || die "Run from the repo root (package.json not found)."
REPO="$(pwd)"

echo -e "\n${BOLD}Warden macOS install${NC}\n"

# ── Model choice for MARM (and Alpha Stack if trading/ is present) ───────
# Any Ollama tag — local (granite4.2:30b) or cloud (kimi-k3:cloud). Feeds
# MARM's concept-graph topic model (LaunchAgent env below) and, on boxes
# that carry the trading stack, the alpha-stack analysis default.
read -r -p "  Ops model — heavy tools/integrations (Alpha Stack + MARM today, more later). Any Ollama tag, local or :cloud [granite4.2:30b]: " WARDEN_OPS_MODEL
WARDEN_OPS_MODEL="${WARDEN_OPS_MODEL:-granite4.2:30b}"

# ── 1. Xcode Command Line Tools (node-pty compiles native code) ─────────
if ! xcode-select -p >/dev/null 2>&1; then
  warn "Xcode Command Line Tools missing — triggering install (GUI prompt)."
  xcode-select --install || true
  die "Re-run this script after the Command Line Tools finish installing."
fi
ok "Xcode Command Line Tools"

# ── 2. Homebrew ─────────────────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew missing — installing (you may be prompted for your password)."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon default prefix
  [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
fi
BREW_PREFIX="$(brew --prefix)"
ok "Homebrew at $BREW_PREFIX"

# ── 3. System packages ──────────────────────────────────────────────────
# node: runtime. tmux: shared terminal sessions. sqlite: DB debugging.
# poppler: PDF text extraction. cliclick: mouse/keyboard control (replaces
# ydotool/xdotool). terminal-notifier: notifications (osascript fallback
# always works).
brew install node tmux sqlite poppler cliclick terminal-notifier pipx uv >/dev/null
pipx ensurepath >/dev/null 2>&1 || true
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node >= 20 required (found $(node -v))."
ok "node $(node -v), tmux, sqlite, poppler, cliclick, terminal-notifier"

# ── 4. npm deps + build ─────────────────────────────────────────────────
# Errors stay visible — a fully muted npm ci once hid a broken build behind
# the health check at the end.
set -o pipefail
export NODE_ENV=development  # devDeps (typescript) are required to compile
echo "  → npm ci (this takes a while)..."
npm ci --include=dev --loglevel=warn \
  || { warn "npm ci failed (lockfile drift) — retrying with npm install"; npm install --include=dev --loglevel=warn; }
npm run build
ok "Dependencies installed, TypeScript built"

# ── 5. Env file ─────────────────────────────────────────────────────────
mkdir -p data/env
if [ ! -f data/env/env ]; then
  cat > data/env/env <<EOF
# Warden config — fill in and re-run: launchctl kickstart -k gui/$(id -u)/com.warden.warden
CLAUDE_CODE_OAUTH_TOKEN=
TELEGRAM_BOT_TOKEN=
ASSISTANT_NAME=Warden
TZ=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
WORKSPACE_ROOT=$HOME/Documents/Warden
AGENT_TIMEOUT=1800000
IDLE_TIMEOUT=1800000
OLLAMA_URL=http://127.0.0.1:11434
STATUS_PORT=3200
BIND_HOST=0.0.0.0
DESKTOP_CONTROL_ENABLED=true
EOF
  warn "Created data/env/env — add your API token (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY) before first use."
else
  ok "data/env/env already present (brought over from the old box?)"
fi
mkdir -p "$HOME/Documents/Warden"

# ── 7. Warden LaunchAgent ───────────────────────────────────────────────
NODE_BIN="$(command -v node)"
cat > "$HOME/Library/LaunchAgents/com.warden.warden.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.warden.warden</string>
  <key>ProgramArguments</key><array>
    <string>${NODE_BIN}</string>
    <string>dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict>
    <!-- launchd does NOT inherit shell PATH; without this, tmux/
         ollama are invisible to spawned children. -->
    <key>PATH</key><string>${BREW_PREFIX}/bin:${BREW_PREFIX}/sbin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>${REPO}/logs/warden.log</string>
  <key>StandardErrorPath</key><string>${REPO}/logs/warden.error.log</string>
</dict></plist>
EOF
mkdir -p logs
launchctl bootout "gui/$(id -u)/com.warden.warden" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.warden.warden.plist" 2>/dev/null \
  || launchctl load -w "$HOME/Library/LaunchAgents/com.warden.warden.plist"
sleep 4

# ── 8. Health check ─────────────────────────────────────────────────────
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3200/api/health | grep -q 200; then
  ok "Warden is up — dashboard: http://localhost:3200"
else
  warn "Service loaded but health check failed — check logs/warden.error.log"
  warn "Most common cause: missing API token in data/env/env. After fixing:"
  warn "  launchctl kickstart -k gui/$(id -u)/com.warden.warden"
fi

echo -e "
${BOLD}Done. Notes:${NC}
  • Restart:  launchctl kickstart -k gui/$(id -u)/com.warden.warden
  • Stop:     launchctl bootout gui/$(id -u)/com.warden.warden
  • Grant ${BOLD}Accessibility${NC} + ${BOLD}Screen Recording${NC} to '${NODE_BIN}' in
    System Settings → Privacy & Security (needed for desktop control/screenshots).
  • Desktop-control + native notifications need the code changes in
    MACOS_PORT_PLAN.md (Tasks 2 & 4) — hand that file to Warden to apply.
  • MARM memory server: LaunchAgent com.warden.marm (127.0.0.1:8001), data in
    ~/.marm/. Opt out before install with INSTALL_MARM=0; remove after with
    launchctl bootout gui/$(id -u)/com.warden.marm + delete the plist.
  • Ollama (local models): install from ollama.com if you use local models.
"
