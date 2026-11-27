#!/usr/bin/env bash
# Pull the latest MARM from git and reinstall if HEAD moved.
set -euo pipefail
WARDEN_HOME="${WARDEN_HOME:-$HOME/.local/share/warden}"
REPO="$WARDEN_HOME/marm"
REF="${MARM_GIT_REF:-MARM-main}"
mkdir -p "$WARDEN_HOME"
if [ ! -d "$REPO/.git" ]; then
  git clone --quiet --branch "$REF" https://github.com/Lyellr88/marm-memory "$REPO"
fi
before="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
git -C "$REPO" fetch --quiet origin "$REF"
git -C "$REPO" checkout --quiet "$REF"
git -C "$REPO" pull --ff-only --quiet || true
after="$(git -C "$REPO" rev-parse HEAD)"
if [ "$before" = "$after" ]; then
  echo "MARM already at ${after:0:12}"
  exit 0
fi
export PATH="$HOME/.local/bin:$PATH"
if command -v uv >/dev/null 2>&1; then
  PKG="$REPO"
  [ -f "$REPO/marm-mcp-server/pyproject.toml" ] && PKG="$REPO/marm-mcp-server"
  uv tool install --force "$PKG" >/dev/null 2>&1 || true
fi
if command -v marm-memory >/dev/null 2>&1; then
  systemctl --user restart marm-memory 2>/dev/null || true
fi
echo "MARM updated ${before:0:12} -> ${after:0:12}"
