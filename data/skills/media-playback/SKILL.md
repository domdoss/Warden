---
name: media-playback
description: "Play, pause, skip, or control media in one turn — find a song/video on YouTube or any site, open it in the Warden Chrome, and control playback."
---

## When to use

Any ask to play/pause/skip/stop media or change volume — "play X on youtube", "put on some chillstep", "pause the music", "skip the song", "turn it up".

## Playing something new (one turn)

1. Find the stream: `WebSearch` ("X site:youtube.com") or `browser_navigate` to the site's search-results URL.
2. `browser_navigate` straight to the watch URL — the snapshot it returns is your confirmation.
3. If it did not autoplay, start the element: `browser_evaluate` with `document.querySelector('video')?.play()` (or `'audio'`).
4. A successful navigate/evaluate IS playback confirmed — no screenshot, no re-checking.

## Already playing

- Pause/resume/next/previous/stop → `media_control` (any running player: a browser tab, Spotify, mpv, VLC).
- Speaker loudness → `audio_volume`; mic sensitivity → `mic_volume`.

## Rules

- One song or video = this skill, no delegation. A queue or playlist build is a flow — delegate that to atlas.
- Drive the `<video>`/`<audio>` element directly, never the site's UI buttons.
- Never poll a running media job or re-delegate to double-check a success.