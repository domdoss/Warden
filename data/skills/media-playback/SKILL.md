---
name: media-playback
description: "Play, pause, skip, or stop media and change volume — control a running player yourself, and route a new song/video on YouTube or any site to atlas."
---

## When to use

Any ask to play/pause/skip/stop media or change volume — "play X on youtube", "put on some chillstep", "pause the music", "skip the song", "turn it up".

## Already playing — yours, one call

- Pause/resume/next/previous/stop → `media_control` (any running player: a browser tab, Spotify, mpv, VLC).
- Speaker loudness → `audio_volume`; mic sensitivity → `mic_volume`.
- The tool's reply IS the confirmation. Never screenshot to check.

## Playing something NEW — delegate to atlas

You have no browser and no web tools: finding a song or video and opening it is atlas's `youtube` tool (one call: it finds the video, opens it in front of the user, and confirms playback from the player itself).

- Delegate with what to play in the user's own words: "play a chillstep mix on youtube", "play <title> by <artist> on youtube".
- Vague ask ("put something on") → pick something reasonable yourself and name it in the brief. Don't ask what they'd like.
- Say what you put on when the job reports back; don't re-delegate to double-check it.

## Rules

- One song or video = one delegation. A queue or playlist build is a flow — still atlas, one brief.
- Never poll a running media job, and never stop one to start another.
