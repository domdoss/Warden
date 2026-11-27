#!/usr/bin/env bash
# Convenience wrapper: the real installer lives inside the package directory.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/warden-dashboard/install.sh" "$@"
