---
name: audit-skill-57702-2
description: "audit test skill #2"
---

## When to use

when the user asks to run audit test #2

## Parameters

- **input_path** — the input file path (example: `/tmp/input.txt`)
- **output_path** — the output file path (example: `/tmp/output.txt`)

## Steps

1.  [tool: `Read` — `{{input_path}}`]
2.  [tool: `Write` — `{{output_path}}`]
3.  [tool: `Bash` — `ls .`]

## Example prompt

> run audit test #2 with /tmp/in.txt and /tmp/out.txt

## Notes

This is audit test #2.

