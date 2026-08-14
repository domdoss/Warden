# Dockbox Voice — Website Copy

## Name

Dockbox Voice

## One-liner

A desktop companion that turns your Dockbox into a voice assistant. Press a button, talk, listen — your Dockbox agent replies out loud.

## Short pitch

Dockbox Voice is a lightweight desktop app that gives you a push-to-talk (or hotkey) interface to your Dockbox. Speak naturally; it transcribes locally, sends the text to your Dockbox agent, and speaks the reply back. All intelligence lives on your Dockbox server — the app is just ears, eyes, and a mouth. A minimal hologram UI shows whether it's listening, thinking, or speaking.

## Features

- Push-to-talk or global hotkey (F9). One press starts a conversation; press again to interrupt.
- Local voice processing. Speech recognition (Whisper) and voice synthesis (Kokoro by default; Orpheus-TTS optional) run on your machine — your voice never leaves it.
- Server-side brain. All agent reasoning, tools, memory, and integrations happen on your Dockbox.
- Hologram UI. Fullscreen animated visual that reflects the assistant's state (idle / listening / thinking / speaking) and pulses with the spoken reply.
- Frameless + transparent window — sits on a second monitor or small display as a dedicated assistant surface.
- Uses your existing email-verified Dockbox session. No new login.

## Requirements

- OS: Linux, macOS, or Windows (Windows needs Microsoft WebView2, which ships with Win10/11).
- Python 3.10 or newer.
- A microphone, speakers, and a modern laptop-class machine.
- An existing Dockbox account.

## Install

1. Clone the repo.
2. Run the one-time setup wizard:
   ```
   uv run setup.py
   ```
3. Follow the prompts:
   - Confirm the Dockbox base URL (defaults to `https://dockbox.dev`).
   - Open the auth URL it prints in a browser where you're already signed in to Dockbox. Paste the token it returns.
   - Enter your Dockbox username + password.
   - Pick your default group (e.g. your own chat).
4. Launch:
   ```
   uv run main.py
   ```

## Usage

- Press the button in the hologram window, or press **F9** anywhere on your system.
- Speak. A beep marks the start; stop talking and another beep marks the end.
- The hologram turns orange while the agent thinks, then cyan while it speaks the reply.
- Press again at any time to interrupt.

## Settings

Config lives in `config/settings.yaml`. The setup wizard writes it for you. You can edit:

- Dockbox base URL
- Default group (which chat your voice turns land in)
- Agent model / tools model / vision model
- TTS engine and voice (default `kokoro` / `am_michael`)
- Audio input/output devices

Re-run individual setup steps:

```
uv run setup.py --login     # re-authenticate
uv run setup.py --group     # change default chat
```

## Privacy

- Audio is transcribed on your device and discarded.
- Only the transcribed text and the spoken reply leave the machine.
- Auth uses your existing Dockbox session — no new credentials.

## Suggested page structure

1. Hero — one-liner + "Download / View on GitHub" button.
2. What it is — the short pitch.
3. Features — the feature bullets.
4. Screenshots/video — the hologram window in idle / listening / thinking / speaking states.
5. Install — the 4-step install block.
6. Requirements — the requirements block.
7. Privacy — the privacy block.

Add "Voice" to any client list on the site (web / mobile / voice).
