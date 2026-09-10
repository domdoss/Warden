---
name: ingest
description: "Add a file or document to long-term memory (MARM) so it can be recalled later. Use when the user asks to remember, memorize, ingest, or 'add to memory' a file, document, note, or PDF."
---

## When to use

The user asks to put a file into long-term memory: "add this file to memory", "remember this document", "ingest X", "keep this for later reference". The goal is that `marm_smart_recall` can find the file's contents in future sessions.

## Steps

1. Get the file's full content:
   - Small text file → read it yourself with `Read`.
   - Large file, PDF, or anything needing conversion → delegate to **atlas**: "read the file at <path> and return its complete text content".
   - The brief must carry the absolute file path; if the user named it vaguely, ask once for the exact path.
2. Log the content into MARM with `mcp__marm__marm_log_entry`:
   - First call opens the topic: `Topic: ingest <file name>` as the entry — that call is JUST the topic line, nothing else.
   - Then one call per section with the entry format `<file name> — <section title>: <content>`. Keep each entry under ~8,000 characters; split long documents across several entries rather than truncating.
   - A leading `Topic:` or `Session:` line switches MARM's active session — never let a content entry start with either word (prefix every content entry with the file name as above, which makes this impossible).
   - Preserve the substance verbatim (facts, numbers, steps, quotes) — do not summarize away detail. The user asked for the file in memory, not a summary of it.
3. Confirm to the user in one line: what was ingested, under which topic, and that it is now recallable ("ask me about it anytime").

## Notes

- Never log secrets, credentials, or API keys even if the file contains them — skip those parts and say so.
- If the MARM tool calls fail, tell the user plainly (memory server unreachable) instead of pretending the file was ingested.