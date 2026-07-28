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

## Phase 5: Validate + restart

- `npm run build`
- If build fails: show the error; only fix issues clearly caused by the merge (missing imports, type mismatches). Do not refactor unrelated code. If unclear, ask.
- Restart the service: `systemctl --user restart warden`

## Phase 6: Summary

- New HEAD: `git rev-parse --short HEAD`
- Commits merged (count)
- Any conflicts resolved (files)
- Confirm the service restarted.

---

# Operating principles
- Never proceed with a dirty working tree.
- `origin` IS the Warden repo (https://github.com/domdoss/Warden). Use it directly — there is no separate `upstream`.
- Use git-native operations. Only touch files with actual conflict markers.
- Keep token usage low: rely on `git` commands; only open files with real conflicts.