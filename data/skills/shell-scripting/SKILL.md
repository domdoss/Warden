---
name: shell-scripting
description: "Write robust bash/zsh scripts and one-liners — quoting, error handling, arguments, pipes, exit codes, shebang/exec bits, logging, cron-able scripts. Use whenever a task needs a script written, a command pipeline built, or an existing script fixed."
---

## Write it right
- Start `#!/usr/bin/env bash` and `set -euo pipefail` (stop on error, stop on unset var, stop on pipe failure). Store in the workspace, then `chmod +x script.sh`.
- Arguments: `"$1"`, `"$2"` — ALWAYS double-quoted. Names/paths with spaces are the default failure mode; `"$var"` everywhere, `"${var}"` inside strings. `${var:-default}` for optional args; `if [[ $# -lt 1 ]]; then echo "usage: $0 <arg>" >&2; exit 1; fi` guard at the top.
- Command substitution `$(cmd)` in double quotes too: `"$(date +%F)"`.
- Prefer an explicit loop variable: `for f in *.txt; do ... done` (no word-splitting worries on globs); `while IFS= read -r line` for line-by-line input.

## Error handling and exit codes
- Check what matters: `cmd || { echo "failed" >&2; exit 1; }`. Exit codes propagate from the last command — make the last command the one that matters (`exit $?` explicitly when needed).
- Diagnostics to STDERR, results to STDOUT (`>&2` for the former) so pipelines and cron capture stay clean.
- Run the script as `bash -n script.sh` (syntax check) and `bash -x script.sh` (trace) when debugging — read the trace, fix the line it shows.

## One-liners and pipelines
- Build pipelines step by step: run each stage alone, confirm its output shape, then chain. When a pipeline misbehaves, test from the failing stage backwards (`... | head` into the next stage).
- `xargs -r -n1` for per-file commands (`... | xargs -r -n1 sha256sum`); a `for` loop when the per-item body needs several commands.

## Making it last
- Logging into a run: `echo "$(date -Is) $*" >> "$LOG"` lines at start and end.
- Scripts scheduled via cron or a systemd timer print something on every run — silence hides failures.
- Idempotent re-runs: check the end state first (`[[ -e $dest ]] && skip`) so a second run never duplicates work.

## Rules
- Test the script on a real sample before calling it done — run it, quote the actual output.
- Read an existing script fully before editing it (Edit tool), matching its quoting and style.
- Deliverable scripts live in `/home/dominic/Warden/` (documents) unless the task says otherwise; say the path + how to run in the reply.