---
name: text-processing
description: "Slice, transform, and extract from text on the command line — jq for JSON, sed for substitution, awk for columns, grep for finding, sort/uniq for counting, structured extraction from logs. Use whenever a task means reshaping text or pulling fields out of files, logs, or API output."
---

## JSON (jq)
- Pretty-read: `jq . file.json`. One field: `jq '.status' file.json`. Nested: `jq '.data.items[0].name'`.
- Arrays: `jq '.items | length'`; `jq '.items[] | select(.price > 100)'`; map: `jq '[.items[] | {name, price}]'`.
- API/HTTP output: `curl -s <url> | jq '.field'` — never eyeball raw JSON when a field will do.
- Keys survey on an unknown blob: `jq 'keys'`, and `jq -r '.[]'` to walk values.
- `-r` for raw strings (no quotes), `-c` for compact one-per-line (pairs with `grep`).

## Substitution (sed)
- Replace in a file: `sed -i 's/old/new/g' file` (`-i` edits in place; drop it to preview first).
- Delete matching lines: `sed -i '/pattern/d' file`. Keep only a line range: `sed -n '10,20p' file`.
- Delimiters: `s|/path/old|/path/new|` when the text itself contains slashes.

## Columns and counting (awk, sort, uniq)
- Field logic: `awk '{print $2, $4}' file` (whitespace-split); `awk -F, '$3 > 100 {print $1}'` for delimited.
- Frequency counts: `... | sort | uniq -c | sort -rh | head` — the canonical "top N things" pipeline.
- Sum a column: `awk '{sum += $2} END {print sum}'`.
- Line ranges by pattern: `awk '/start/,/end/' file`.

## Finding (grep)
- Recursive with context: `grep -rn 'pattern' dir` (add `-C 3` for surrounding lines, `-i` case-insensitive, `-l` filenames only).
- Invert: `grep -v 'pattern'`. Regex sets: `grep -E 'a|b'`.
- Log scanning: `grep -c ERROR log` for a count, `tail -n 5000 log | grep -E 'ERROR|WARN'` for the recent slice.

## Rules
- Preview transformations (no `-i`, or head the output) before committing an in-place edit; for files in the repo use the Edit tool instead of sed.
- Quote the pipeline's actual output in the reply — counts, matched lines, changed-line count.
- Escaping is the usual failure: single-quote the sed/awk program, and when the data contains the delimiter, switch delimiters rather than piling backslashes.