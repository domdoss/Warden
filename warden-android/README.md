# Warden Android app

A thin, install-and-go Android app for **the Warden dashboard** — not the Dockbox
Voice client in `eyes_ears/`.

- Opens `http://127.0.0.1:17800/` in a full-screen WebView.
- `17800` is a localhost proxy served by an **in-process Tailscale node** (`tsnet`,
  built as `app/libs/tailscale.aar`) that dials the Warden host
  `<tailnet-ip>:3200` over the tailnet.
- No separate Tailscale app, no system VPN: tsnet runs in userspace inside the
  app process and enrolls once with the bundled auth key, then keeps its node
  identity in the app's private storage.
- If the tunnel cannot come up, the app says so on screen and falls back to
  `/` (works when the Tailscale app is
  installed on the phone).

## Layout

| path | what |
|---|---|
| `app/src/main/java/com/warden/app/MainActivity.java` | WebView + tunnel startup + file chooser |
| `app/src/main/AndroidManifest.xml` | INTERNET, cleartext, launcher |
| `app/libs/tailscale.aar` | gomobile build of `tsnetproxy` (arm64 + armeabi-v7a) |
| `tsnetproxy/proxy.go` | Go source: tailnet node + localhost→peer TCP proxy |

## Build

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
export ANDROID_HOME=$HOME/Android/Sdk
cd /opt/Warden/warden-android
./gradlew assembleRelease     # -> app/build/outputs/apk/release/app-release.apk
```

Signed with the debug keystore so it installs directly (`adb install -r …`).

## Rebuild the embedded Tailscale AAR

Only needed when `tsnetproxy/proxy.go` changes:

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_NDK_HOME=$HOME/Android/Sdk/ndk/28.2.13676358
cd /opt/Warden/warden-android/tsnetproxy
gomobile bind -target=android/arm64,android/arm -androidapi 26 \
  -o ../app/libs/tailscale.aar .
```

## Config baked into the build

`MainActivity.java` (top of the class):

- `AUTH_KEY` — Tailscale auth key, used once at enrollment
- `NODE_HOSTNAME` — `warden-phone` (appears in the tailnet admin console)
- `PROXY_PORT` — 17800
- `PEER_IP` / `PEER_PORT` — `<tailnet-ip>:3200` (Warden on <host>)

After the first launch, disable key expiry for the `warden-phone` node in the
Tailscale admin console so it never has to re-enroll.
