#!/usr/bin/env bash
#
# Install (or upgrade) the Warden Dashboard Plasma 6 applet.
#
# Usage:
#   ./install.sh                    # install, or upgrade if already installed
#
# The applet is a QML-only KPackage (no cmake, no compilation), so this is the
# whole build step. plasmashell is deliberately NOT restarted: a restart would
# take the running desktop (and any Widget in use) down. The widget is picked
# up on next login, or immediately via "Add Widgets…".
#
# Upgrade variant after editing the sources by hand:
#   kpackagetool6 -t Plasma/Applet -u "$(dirname "$0")/warden-dashboard"
# Uninstall:
#   kpackagetool6 -t Plasma/Applet -r com.warden.dashboard

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Works whether this script sits next to warden-dashboard/ (../install.sh) or
# inside the package directory itself (warden-dashboard/install.sh).
if [[ -d "$HERE/warden-dashboard" ]]; then
    PKG_DIR="$HERE/warden-dashboard"
else
    PKG_DIR="$HERE"
fi

PLUGIN_ID="com.warden.dashboard"
PKG_TYPE="Plasma/Applet"

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "error: kpackagetool6 not found — install the 'kpackage' package first" >&2
    exit 1
fi

if kpackagetool6 -t "$PKG_TYPE" -l 2>/dev/null | grep -qx "$PLUGIN_ID"; then
    echo "==> $PLUGIN_ID is already installed — upgrading from $PKG_DIR"
    kpackagetool6 -t "$PKG_TYPE" -u "$PKG_DIR"
else
    echo "==> Installing $PLUGIN_ID from $PKG_DIR"
    kpackagetool6 -t "$PKG_TYPE" -i "$PKG_DIR"
fi

echo "==> Rebuilding the KDE service cache"
kbuildsycoca6

cat <<'EOF'

Done. plasmashell was NOT restarted.

To place the widget on a virtual desktop / activity:
  1. Right-click the desktop  ->  "Enter Edit Mode".
  2. In the toolbar (or the panel that opens on the left) click "Add Widgets…".
  3. Search for "Warden Dashboard".
  4. Drag it onto the desktop or activity you want. To target another virtual
     desktop, drag the widget to the screen edge and hover until the desktop
     switches. Then drag its edges/corners to resize it to fill the screen.

The widget shows "Warden offline — retrying…" with a Retry button while
http://127.0.0.1:3200/api/health is unreachable, and the dashboard itself
once the backend is up. The URL and poll interval are configurable via the
widget's context menu -> "Configure Warden Dashboard…".

If "Warden Dashboard" does not appear in the widget list, run
`kbuildsycoca6` again or log out and back in.
EOF
