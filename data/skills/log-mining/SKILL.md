---
name: log-mining
description: "Mine the logs for agent failures, sort the fine-tunable ones from the code defects, and write training pairs for the ones a fine-tune can fix."
---

## When to use

An audit of what the fleet got wrong: a wrong tool, a malformed call, a claimed action that never ran, an invented value. Also any ask to turn logged failures into training data.

## Where the evidence is

- `/opt/Warden/logs/warden.log` — live. `Executing tool:` lines carry the exact call; `✅`/`Error` lines carry the result.
- `journalctl --user -u warden.service` — same stream, survives rotation.
- `/opt/Warden/store/messages.db` read-only — what the user asked and what was said back.

Quote the real call. A pair built from a remembered failure teaches a failure that never happened.

## Sort each failure first

**Fine-tunable — the model chose badly while the tool worked:**
- Picked a tool that does not own the job, when the right one was in its list.
- Called the right tool with wrong, invented or future-dated arguments.
- Narrated an action ("I'll have X do it") and made no call.
- Emitted a tool call as prose or JSON in the reply text.
- Answered in the wrong shape — a table when one line was asked for, a field the result never contained.

**Code or config — the model had no way to succeed. Report these, no pairs:**
- The tool was absent from its list, or named something else.
- The tool ran and returned the wrong thing.
- A path, model or setting was wrong.
- The prompt and the tool list disagreed.

A pair teaching around a code defect trains the model to work around a bug that should be fixed.

## Writing the pairs

Write **several per failure** — one is an anecdote, a handful is a pattern:
1. The exact logged case, with the correct call in place of the wrong one.
2. Two or three near-variants: the same intent in different words, a different target value, the same shape one tool over.
3. Where the failure was picking between two tools, one pair for the sibling case so the boundary is learned from both sides.

Each pair:
- `messages` + `tools`, matching the seat's live schema.
- The system message byte-identical to what that seat actually sends — `System prompt: N chars — "..."` in the log names it, and `ORCH_SYSTEM` in `container/agent-runner/src/index.ts` holds it.
- Real tool names and real argument shapes, taken from the schema the seat is given.
- Values that exist: a real path, a real id, a timestamp at or before the moment of the call.
- The assistant turn is the call that should have happened, then the reply that result earns.

## What you may write

Two things, and only these: your findings, and the training data under `/opt/Warden/training/`. Every other file and setting stays as you found it.

## Where they go

- One JSON object per line, appended to the dataset for that seat under `/opt/Warden/training/`.
- Say how many pairs you added, which failure each came from, and the log timestamp.
- List the code-defect failures separately, with the line that proves each.
