---
name: room-status-check
description: "Ask Sentry for a live room status report and answer from that report."
---

## When to use

Use when the user asks who's in the room, what's in the room, what's happening in the room, or whether anyone is in the room.

## Steps

1. Call `sentry_query` with the user's question.
2. Answer from Sentry's report in one sentence.
