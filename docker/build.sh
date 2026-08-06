#!/usr/bin/env bash
# Build Warden Docker images from the current git checkout.
# Usage:
#   cd docker
#   ./build.sh [ref]
#
# ref defaults to HEAD. If you pass a ref, it is exported into a temp directory
# first so the build context is exactly that point in history.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="${1:-HEAD}"

cd "$PROJECT_ROOT"

if [ "$REF" = "HEAD" ]; then
  BUILD_DIR="$PROJECT_ROOT"
else
  BUILD_DIR="$(mktemp -d)"
  cleanup() { rm -rf "$BUILD_DIR"; }
  trap cleanup EXIT
  echo "[build] exporting $REF into $BUILD_DIR..."
  git archive "$REF" | tar -x -C "$BUILD_DIR"
fi

TAG="$(git rev-parse --short "$REF")"

cd "$BUILD_DIR"

echo "[build] building warden:$TAG..."
docker build -t "warden:$TAG" -t warden:latest -f docker/Dockerfile.warden .

echo "[build] building video:$TAG..."
docker build -t "video:$TAG" -t video:latest -f docker/Dockerfile.video .

echo "[build] building audio:$TAG..."
docker build -t "audio:$TAG" -t audio:latest -f docker/Dockerfile.audio .

echo ""
echo "[build] done. images:"
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(warden|video|audio):' | sort
