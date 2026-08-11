---
name: update-warden
description: Pull the Warden git repo (https://github.com/domdoss/Warden) and update this install in place — fetch, merge origin/main, rebuild, restart the service.
when_to_use: User wants to update Warden to the latest from the repo. Phrases like "update warden", "pull the latest", "upgrade warden", "bring in upstream changes".
example_prompt: Update Warden to the latest
---

# Update Warden

Pull the latest from the Warden repo and update this install: fetch, merge `origin/main`, rebuild, restart the service.

## Phase 1: Preflight

- `git status --porcelain` — if non-empty, tell the user to commit or stash, then stop.
- `git remote -v` — confirm `origin` is the Warden repo (https://github.com/domdoss/Warden). If `origin` is missing or points elsewhere, ask before proceeding; do not silently reconfigure it.
- `git fetch origin --prune`

## Phase 2: Detect updates

- `git rev-parse --abbrev-ref HEAD` (current branch, usually `main`)
- `git log --oneline HEAD..origin/main` — new commits available.

If empty: tell the user this install is up to date with `origin/main` and stop.

If non-empty: show the count and a short log (cap ~20 lines).

## Phase 3: Confirm

Use AskUserQuestion: offer "Update now (merge origin/main, build, restart)" vs "Skip". Default to Update.

## Phase 4: Apply

1. `git merge origin/main --no-edit`
2. If clean, continue. If conflicts:
   - `git status` to find conflicted files.
   - For each: open it, resolve only conflict markers, preserve intentional local customizations, `git add`, then `git commit --no-edit`.
   - If a conflict can't be resolved cleanly: `git merge --abort`, tell the user to resolve manually, stop.

## Phase 5: Build, gate, restart

1. `npm run build` — capture the exit code.
2. **Gate — never restart unless the build succeeded (exit 0).**
   - If the build **failed** (nonzero exit): **do NOT restart.** Show the full
     compiler error output to the user. Only attempt a fix for issues clearly
     caused by the merge (missing imports, type mismatches); rerun
     `npm run build` and re-apply this gate. Do not refactor unrelated code. If
     the cause is unclear, stop and ask — leave the merged tree in place; the
     service keeps running the previous `dist/` until a build succeeds.
   - If the build **succeeded (exit 0)**: continue to step 3.
3. Restart the service: `systemctl --user restart warden`
4. Verify: `systemctl --user is-active warden` must print `active`. If it does
   not, show `journalctl --user -u warden -n 40 --no-pager` and stop.

## Phase 6: Summary

- New HEAD: `git rev-parse --short HEAD`
- Commits merged (count)
- Any conflicts resolved (files)
- Build result (succeeded / failed-and-stopped)
- `systemctl --user is-active warden` result.

---

# Operating principles
- Never proceed with a dirty working tree.
- `origin` IS the Warden repo (https://github.com/domdoss/Warden). Use it directly — there is no separate `upstream`.
- Use git-native operations. Only touch files with actual conflict markers.
- Keep token usage low: rely on `git` commands; only open files with real conflicts.