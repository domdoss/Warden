#!/usr/bin/env bash
# Build the Warden v1 AppImages from the CURRENT running tree.
#   ./build.sh             -> Warden (host: backend + web dashboard + API)
#   ./build.sh app         -> same
#
# The AppDir is a frozen copy of the working install (dist + node_modules +
# public + training code + the Android APK). Runtime state
# (data/, store/, logs/, groups/) and dev-only weight (trading/, .venvs,
# *.gguf) are excluded. First-run provisioning (MARM, Playwright, Chrome MCP,
# training venv) happens in provision.sh, not here.
set -euo pipefail

REL="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$REL/.." && pwd)"
OUT="$REL/out"
TOOLS="$REL/.tools"
UI="${1:-app}"
mkdir -p "$OUT" "$TOOLS"

if [ -d "$ROOT/.git" ]; then
  VER="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)"
else
  VER="dev"
fi
STAMP="$(date -u +%Y%m%dT%H%MZ)"

rsync_payload() {
  local app="$1"
  mkdir -p "$app"
  rsync -a \
    --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
    --exclude 'release' --exclude 'store' --exclude 'data' --exclude 'logs' \
    --exclude 'backups' --exclude 'out' --exclude 'tmp' --exclude 'trading' \
    --exclude 'imagegen/models' --exclude 'groups' --exclude 'groups-main-backup*' \
    --exclude 'home' --exclude 'Notes' --exclude 'plasma' --exclude 'clients' --exclude 'eyes_ears' \
    --exclude 'warden-android' --exclude 'warden_app' --exclude 'unsloth_compiled_cache' \
    --exclude '*.tar.gz' --exclude 'warden-fixes.zip' --exclude 'patch.zip' \
    --exclude 'heimdall-removal.zip' --exclude 'dockbox-single.zip' \
    --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
    --exclude 'training/.venv' --exclude 'training/*.gguf' \
    --exclude 'training/*.log' --exclude 'training/*-lora*' --exclude 'training/mentara' \
    --exclude 'training/atlasorch-run.log' --exclude 'training/.pytest_cache' \
    --exclude 'voice/.venv' --exclude '.dart_tool' --exclude '.gradle' \
    "$ROOT/" "$app/"
  # Built backend + production node_modules (native modules stay compiled).
  rsync -a "$ROOT/dist/" "$app/dist/"
  rsync -a "$ROOT/node_modules/" "$app/node_modules/"
  # Playwright is a release dependency (headless browser alongside the Chrome
  # bridge) even though the dev tree does not currently carry it.
  if [ ! -d "$app/node_modules/playwright" ]; then
    ( cd "$app" && npm install --no-save --no-package-lock --ignore-scripts playwright >/dev/null 2>&1 ) \
      || echo "  ! playwright install skipped"
  fi
  if [ -d "$ROOT/container/agent-runner/node_modules" ]; then
    rsync -a "$ROOT/container/agent-runner/node_modules/" "$app/container/agent-runner/node_modules/"
  fi
  cp -f "$REL/provision.sh" "$REL/update-marm.sh" "$REL/AppRun.common" "$REL/onboard.mjs" "$app/"
  cp -f "$REL"/warden-autoupdate-marm.* "$app/"
  chmod +x "$app/provision.sh" "$app/update-marm.sh"
  printf 'version=%s\nbuilt=%s\nui=%s\n' "$VER" "$STAMP" "$UI" > "$app/VERSION"
}

make_appdir() {
  local ui="$1"
  local appdir="$REL/AppDir-$ui"
  rm -rf "$appdir"
  mkdir -p "$appdir/usr/bin" "$appdir/usr/share/warden"
  rsync_payload "$appdir/usr/share/warden"
  # Pin the Node runtime so the native modules match the ABI they were built on.
  cp -f "$(command -v node)" "$appdir/usr/bin/node"
  cp -f "$REL/AppRun.$ui" "$appdir/AppRun"
  chmod +x "$appdir/AppRun"
  cp -f "$REL/warden-$ui.desktop" "$appdir/warden.desktop"
  cp -f "$ROOT/public/icons/icon-512.png" "$appdir/warden.png"
  chmod -R a+rX "$appdir"
  echo "  AppDir ready: $appdir"
}

ensure_appimagetool() {
  if [ ! -x "$TOOLS/appimagetool" ]; then
    echo "  downloading appimagetool…"
    curl -fsSL --retry 3 \
      "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" \
      -o "$TOOLS/appimagetool"
    chmod +x "$TOOLS/appimagetool"
  fi
  # FUSE is often unavailable; extract the tool and run its AppRun.
  if [ ! -d "$TOOLS/squashfs-root" ]; then
    ( cd "$TOOLS" && ./appimagetool --appimage-extract >/dev/null 2>&1 ) || true
  fi
}

package() {
  local ui="$1"
  local appdir="$REL/AppDir-$ui"
  local out="$OUT/Warden-$VER-x86_64.AppImage"
  ensure_appimagetool
  if [ -x "$TOOLS/squashfs-root/AppRun" ]; then
    ARCH=x86_64 "$TOOLS/squashfs-root/AppRun" "$appdir" "$out"
  else
    ARCH=x86_64 "$TOOLS/appimagetool" "$appdir" "$out"
  fi
  chmod +x "$out"
  echo "  built: $out ($(du -h "$out" | cut -f1))"
}

make_appdir dashboard
package dashboard

# Portable fallback for machines without FUSE.
tar -C "$REL/AppDir-dashboard" -czf "$OUT/Warden-$VER-x86_64.tar.gz" .
echo "  fallback: $OUT/Warden-$VER-x86_64.tar.gz"
