---
name: youtube
description: "Play, search, or skip a YouTube video in the Warden Chrome — find the watch URL, start the <video> element, and skip/pause with the browser (never playerctl)."
---

## When to use

Any ask to play/search/skip YouTube — "play X on youtube", "put on some lofi", "skip this song", "next track", "search youtube for X".

## Steps

1. [tool: `WebSearch` — `"<query> site:youtube.com"`] or [tool: `WebFetch`] to find the watch URL — or go straight to the search-results URL for a direct query.
2. [tool: `browser_navigate` — `"https://www.youtube.com/watch?v=<id>"`] — returns the page TITLE + URL, NOT a snapshot.
3. To pick from search results: [tool: `browser_evaluate`] ONE call that maps title + link from the result elements. Never snapshot → click → snapshot loops.
4. If it did not autoplay: [tool: `browser_evaluate` — `document.querySelector('video')?.play()`].
5. A successful navigate/evaluate IS playback confirmed — no screenshot, no re-checking.

## Skip / pause / next / previous (already playing)

- Next: [tool: `browser_press_key` — `"Shift+n"`] (focus the player first), or click the on-page next button, or evaluate the video element. NOT `media_control`.
- Pause/resume: [tool: `browser_press_key` — `" "`] or [tool: `browser_evaluate` — `document.querySelector('video')?.pause()` / `.play()`].
- `media_control` is ONLY for a desktop player already exposed over MPRIS (Spotify, mpv, VLC) — never for YouTube, and NEVER install playerctl or any package for this.

## Notes

- Never re-navigate to the same URL. If a selector returns empty, `browser_wait_for` a beat, then try a different selector or `browser_snapshot` refs.
- Drive the `<video>`/`<audio>` element directly, not the site's UI buttons.
- One video = this skill, no delegation. A playlist build or queue is a flow — delegate that to atlas.
