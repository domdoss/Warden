---
name: media-playback
description: "Play, pause, skip, or stop media and change volume — play a song or video on YouTube with the youtube tool, and control any running player yourself."
---

## When to use

Any ask to play/pause/skip/stop media or change volume — "play X on youtube", "put on some chillstep", "pause the music", "skip the song", "turn it up".

## Playing something NEW — `youtube`, one call

You hold the browser and the `youtube` tool. One call finds the video, opens it in front of the user, and confirms playback from the `<video>` element.

- `youtube({action:'play', query:'<their words>'})` — or `url` when they gave a link.
- Vague ask ("put something on") → pick something reasonable yourself and play it, then say what you put on.
- The tool's result IS the verification. A successful play ends the turn; the user hears it.
- Speak up when it will not start, and say what failed.

## Already playing — one call

- YouTube tab: `youtube` with `pause`, `resume`, `next`, `seek`, `fullscreen`, `now_playing`, `search`.
- Any other player (Spotify, mpv, VLC, another tab): `media_control`.
- Speaker loudness → `audio_volume`; mic sensitivity → `mic_volume`.
- The tool's reply IS the confirmation. Answer in one line — title and position, e.g. "Playing: <title> (1:24 / 3:30)".

## Rules

- One song or video = one `youtube` call. A queue or playlist build is repeated `play`/`next` calls on the same tab.
- Each call reuses the open tab and replaces what was playing.
- Let a running media job run; start the next thing when the user asks for it.
