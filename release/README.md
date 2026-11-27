# Warden v1 — release build

Linux only. macOS coming soon. Windows is not supported.

## Artifacts

Built from the current running tree (`dist` + `node_modules` + `public` +
`training` + the Android APK):

- `out/Warden-<ver>-x86_64.AppImage` — the host: backend, web dashboard, API,
  training loop. The Android app talks to this over your LAN/Tailscale.
- `out/Warden-<ver>-x86_64.tar.gz` — portable fallback for machines without FUSE
- `warden.apk` inside the payload (and `public/warden.apk`) — the Android app.
  This is the primary UI; sideload now, Play Store later.

The AppImage is app-focused: it starts the shared backend/webserver on
`127.0.0.1:3200`, serves the dashboard, and exposes the API the phone app uses.
If Warden is already listening on `:3200` the launcher reuses it and never
starts a second server.

## Build

```bash
./build.sh            # one app image
./build.sh app        # same
```

Requires `rsync`, `curl`, `node` (pinned into the image), and FUSE or the
extracted `appimagetool` (the script handles both). The newest APK is picked
automatically from `warden_app/build/.../app-release.apk`, `warden.apk`, or
`public/warden.apk`.

## First run

`AppRun` creates a writable overlay at `~/.local/share/warden/run`
(code/assets are symlinked from the read-only AppImage; `training/` is copied
so it can write), then runs `provision.sh --base` on first launch:

- **MARM** cloned from `https://github.com/Lyellr88/marm-memory` (git HEAD,
  `MARM_GIT_REF` to pin) + `marm-memory.service` + `warden.service.d/marm.conf`
- **MARM autoupdater** — `warden-autoupdate-marm.timer` (boot + daily):
  `update-marm.sh` pulls, reinstalls when HEAD moved, restarts MARM
- **Playwright** + chromium (headless browser; the real-Chrome bridge remains
  the primary path)
- **Chrome MCP** — `mcp-chrome-bridge` native host + staged extension

### Training pipeline

The training code and the backend Training API are in the image. Create the
(large) training venv once:

```bash
./Warden-*-x86_64.AppImage --appimage-extract
./squashfs-root/usr/share/warden/provision.sh --training

# or on the very first launch:
WARDEN_PROVISION_TRAINING=1 ./Warden-*-x86_64.AppImage
```

## Layout

```
AppDir-dashboard/AppRun                    launcher
AppDir-dashboard/usr/bin/node              pinned Node runtime
AppDir-dashboard/usr/share/warden/         payload + provisioning scripts
AppDir-dashboard/usr/share/warden/warden.apk
```

## License

Sold as a binary. The current `LICENSE.md` is Personal-Use, Non-Commercial and
must be replaced with the commercial EULA + baked-in license check before
distribution.
