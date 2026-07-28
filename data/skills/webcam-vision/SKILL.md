---
name: webcam-vision
description: "Answers 'what do you see / who's in the room' by combining a webcam photo with Sentry's structured awareness data (recognized names, person count, occupancy/absence duration) for an accurate description."
---

## When to use

When the user asks what is visible through the webcam, who is in the room, or for a visual description of their current environment — and you want the answer to be accurate (names, counts, how long someone's been there), not just what the photo shows.

## Steps

1.  [tool: `awareness_status` — `{}`] — get Sentry's latest AWARENESS data: the most recent event (arrival/departure/...), recognized person (`is_known` + `label` from InsightFace), `person_count`, and how long the room's been occupied or empty.
2.  [tool: `webcam_capture` — `{}`] — capture a frame from the webcam into your vision context.
3.  Look at the frame and combine it with the awareness data: name known people by their `label`, mention the `person_count` and how long the room's been occupied/empty, and describe what you actually see. Answer in one or two accurate spoken sentences.

## Example prompt

> who's in my room right now?
> use the webcam and tell me what you see

## Notes

- The photo alone can't identify people or measure durations — that's what `awareness_status` adds. Use both.
- `awareness_status` is read-only and fast; call it first so you know what to look for in the photo.
- If `awareness_status` returns "(none yet)", the camera hasn't seen an event recently — fall back to describing only what the photo shows.