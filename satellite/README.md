# 🛰️ Graice Satellite (Pi audio relay)

The Raspberry Pi side of the Graice voice system. The Pi is **either** the
Warden brain **or** a dumb mic/speaker — or both at once (see Modes). When it's
the mic/speaker it's a **dumb pipe**: it streams raw microphone audio to the
hologram client (`voice/`) and plays back the TTS the Warden returns. No STT,
TTS, or model inference runs on the Pi in that role — transcription happens on
the Warden side (local Whisper by default, Groq API fallback). A Pi Zero is
enough for the mic/speaker role; running the Warden too needs a Pi 4+.

## Files

| File | Role |
|------|------|
| `satellite_server.py` | HTTP audio relay on `:8766`. `GET /mic` → 16 kHz PCM stream from the default mic. `POST /play` (WAV body) → play on the default speaker. `POST /cancel` → stop playback (barge-in). |
| `voice-button.py` | gpiozero hold-to-talk button. **Standalone**: records here and hits the local Warden. **Satellite/both**: POSTs `/press` to the hologram control server (`:8767`) so the laptop does STT/TTS through the Pi's mic/speaker. Reads `~/.graice-mode`. |
| `graice-tui.sh` | On-device `select` menu: WiFi, Bluetooth, speaker/mic volume + device pick, Mode (standalone/satellite/both), audio server IP (the laptop, `:8767`), and start/stop Warden/Satellite/Button. |
| `boot-defaults.sh` | systemd oneshot: restores saved WiFi SSID, Bluetooth device, default audio sink/source at boot from `~/.graice-boot-defaults`. |
| `graice-boot-defaults.service` | the systemd unit for the above. |
| `install-deps-pi.sh` | apt installer for Raspberry Pi OS (Node toolchain, poppler, sqlite, tmux, NetworkManager, BlueZ, PipeWire, gpiozero). |

## Button wiring

Hold-to-talk: hold the button to record, release to send.

- **BCM 17** (physical pin 11) → button → **GND** (physical pin 9).
- Internal pull-up is used; just wire the button between those two pins.

## Modes (`~/.graice-mode`)

A 4-line KEY=VALUE file read by both `voice-button.py` and `graice-tui.sh`:

```
MODE=both                    # standalone | satellite | both
WARDEN_URL=http://localhost:3200             # standalone/both: this Pi's Warden. satellite: unused.
AUDIO_SERVER_URL=http://192.168.0.159:8767   # satellite/both: the laptop's hologram control server (:8767)
SATELLITE_URL=http://localhost:8766          # this Pi's own relay (:8766)
```

The Pi is **either** the Warden **or** a dumb mic/speaker — or both at once:

- **standalone** — the Pi IS the Warden. The button records on the Pi and POSTs
  the audio to the local Warden (`WARDEN_URL` = `localhost:3200`). The Pi does
  its own STT/TTS round-trip. No remote IP needed.
- **satellite** — the Pi is a dumb mic/speaker. The button POSTs `/press` to
  `AUDIO_SERVER_URL` (the hologram's control server on the laptop, `:8767`). The
  hologram then records via this Pi's `GET /mic`, sends text to a Warden running
  *elsewhere*, and plays the reply back through this Pi's `POST /play`.
  `WARDEN_URL` is unused.
- **both** — the Pi runs the Warden **and** the mic/speaker relay. The button
  POSTs `/press` to `AUDIO_SERVER_URL` (the laptop, `:8767`) just like
  satellite; the laptop does STT/TTS and sends the text to the Pi's own Warden
  (`localhost:3200`, reached from the laptop as the Pi's IP).

The **only remote IP the Pi ever needs** is `AUDIO_SERVER_URL` (the laptop
running the voice client). `WARDEN_URL` is always `localhost:3200` (standalone
or both) or unused (satellite) — never a remote address. Set the audio server
IP from the TUI's *Edit audio server IP* option.

Which roles the Pi *runs* (Warden / Satellite relay / Button) is picked
separately in the TUI's "Start roles" prompt — the mode only sets the button's
behaviour.

## URL flow (satellite / both mode)

```
button press ──POST /press──▶ hologram control server (laptop :8767)
hologram ──GET /mic──▶ Pi :8766 (streams PCM) ──▶ hologram STT
hologram ──text──▶ Warden :3200 ──▶ Ollama ──reply──▶ hologram TTS
hologram ──POST /play (WAV)──▶ Pi :8766 (speaker)
```

In **both** mode the Warden (`:3200`) is on this same Pi; in **satellite** mode
it runs on a different machine. The flow is identical otherwise.

## Deploy

These scripts assume the Pi repo-root layout (`dist/`, `voice/`, `hardware/`,
`tui/`). On the Pi, sync this repo to the repo root and run from there:

```bash
bash satellite/install-deps-pi.sh          # one-time: system deps
bash satellite/graice-tui.sh               # configure WiFi/BT/audio/mode + start roles
```

The TUI's "Start roles" prompt starts each component with paths relative to the
repo root (`node dist/index.js`, `voice/satellite_server.py`,
`hardware/voice-button.py`), so launch it from the repo root. To run the boot
defaults restore, install the service:

```bash
mkdir -p ~/.config/systemd/user
cp satellite/graice-boot-defaults.service ~/.config/systemd/user/
systemctl --user enable --now graice-boot-defaults
```

The boot-defaults `ExecStart` path is `/home/graice/Graice/tui/boot-defaults.sh`
by default — adjust it to where `boot-defaults.sh` lives on your Pi.