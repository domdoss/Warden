#!/usr/bin/env bash
# Provision this production directory in place (MARM, Playwright, Chrome MCP).
#   ./provision-local.sh --base
#   ./provision-local.sh --training
set -euo pipefail
cd "$(dirname "$0")"
APP="$PWD" RUN="$PWD" WARDEN_RUN_DIR="$PWD" bash "$PWD/provision.sh" "$@"
