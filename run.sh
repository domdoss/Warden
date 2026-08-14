#!/usr/bin/env bash
# Repo-root launcher — delegates to the merged eyes_ears/run.sh.
#
# security/ + voice/ were merged into eyes_ears/ (eyes/ + ears/), so the single
# interactive launcher now lives at eyes_ears/run.sh. This keeps `./run.sh` from
# the repo root working (forwards all args) without duplicating the launcher.
set -euo pipefail
exec "$(dirname "$0")/eyes_ears/run.sh" "$@"