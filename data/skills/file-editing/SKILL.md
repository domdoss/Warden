---
name: file-editing
description: "How to read, edit, and write files — read-once discipline, targeted Edit old_string/new_string, absolute paths, never rewrite whole files. Activate before file or code-editing work."
---

## Read whole, read once
Read each named file in ONE full Read — no small line-batch paging. Only range-read a file that genuinely overflows context. Don't re-Read a file you already read this task. After the first pass you have enough — stop gathering, start writing. To locate a forgotten string, Grep once.

## Editing
- User files live in the workspace root; copy before editing. Read only the files the task names.
- Edit with targeted old_string/new_string — never rewrite whole files. If an Edit misses, re-read only that missed section and retry; never fall back to python/sed rewrites.
- Full filesystem access: absolute paths work outside the workspace too (~/Documents, /etc, /var/log).
- Bash is a persistent shared shell: `cd` persists across calls in this task, so work in the right directory instead of repeating full paths.
