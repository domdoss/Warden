---
name: audit-skill-57702-5
description: "audit test skill #5"
---

## When to use

when the user asks to run audit test #5

## Parameters

- **input_path** — the input file path (example: `/tmp/input.txt`)
- **output_path** — the output file path (example: `/tmp/output.txt`)

## Steps

1. read input [tool: `Read` — `{{input_path}}`]
2. write output [tool: `Write` — `{{output_path}}`]
3. list output dir [tool: `Bash` — `ls .`]

## Example prompt

> run audit test #5 with /tmp/in.txt and /tmp/out.txt

## Notes

This is audit test #5.

