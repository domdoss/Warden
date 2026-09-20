---
name: youtube
description: "Play, search, or control a YouTube video — one call to the youtube tool; it drives the default browser provider itself (never browser_* tools, never playerctl)."
---

## When to use

Any ask to play/search/skip YouTube — "play X on youtube", "put on some lofi", "skip this song", "next track", "search youtube for X".

## Playing something NEW — `youtube`, one call

- "play X" / "put on X" → IMMEDIATELY [tool: `youtube` — `{action:'play', query:'<their words>'}`] — or `url` when they gave a link/id. That one call IS the play: it picks the video, opens it, and starts the audio.
- NEVER ask which video they want. NEVER run `search` first and wait for a pick. YOU choose the video and commit — a play instruction means play now.
- Vague ask ("put something on") → same thing: pick something reasonable and play it, then say what you put on.
- `search` is ONLY when they explicitly asked to search/browse ("search youtube for X") — never as a step toward playing.
- The tool's result IS the verification — no screenshots, no re-checking, no browser_* calls around it.
- If it returns an error, say what failed — never fall back to `browser_navigate`/`browser_evaluate` (those tools are retired) and never install playerctl.

## Already playing — one call

- [tool: `youtube`] with `pause`, `resume`, `next`, `seek`, `fullscreen`, `now_playing`, or `search`.
- Each call reuses the open YouTube tab and replaces what was playing.

## Rules

- One video = one `youtube` call, no delegation. A playlist/queue build is a flow — delegate that to atlas.
- `media_control` is ONLY for a desktop player exposed over MPRIS (Spotify, mpv, VLC) — never for YouTube.
