---
name: log-mining
description: "Mine the logs for agent failures, sort the fine-tunable ones from the code defects, and flag the fine-tunable ones as training errors for the training loop."
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

## Flag each fine-tunable failure

One `flag_training_error` call per fine-tunable failure you confirm:
- `failure_class` — the class from the sort above.
- `log_excerpt` — the verbatim lines: the user ask, the `Executing tool:` call, its result line.
- `log_timestamp` — the timestamp on the failed call's line.
- `what_went_wrong` — the model's choice, in one to three sentences.
- `correct_behavior` — the call and reply the turn should have made, with real tool names and real argument shapes.
- `role` — `orch` when the failure was in delegation or routing, `seat` otherwise.

The training loop's modify step turns every pending flag into corrective training rows — the flag is the whole hand-off.

## What you may write

Your findings, and your `flag_training_error` flags. Every file and setting stays as you found it.

## The report

- How many failures you flagged, with each flag id, its class and the log timestamp.
- The code-defect failures listed separately, with the line that proves each.
