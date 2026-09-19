---
name: disk-usage
description: "Find what's eating disk space and clean it safely — du breakdowns, df state, largest files/dirs, log rotation, cache cleanup, safe-delete rules for this host. Use for 'disk full / how much space / what's taking up / clean up' questions and tasks."
---

## Read the state
- Filesystem level: `df -h` (percent used per mount). The root concern is the `/` line.
- Where the space is, top-down: `du -h --max-depth=1 /path 2>/dev/null | sort -rh | head -20` — drill into the biggest dir, repeat. `/` first, then the winners.
- Biggest single files: `find / -xdev -type f -size +500M -exec du -h {} + 2>/dev/null | sort -rh | head -20` (drop sudo paths you can't read; the `2>/dev/null` keeps it sane).
- A directory by modification: `du -h --time --max-depth=1 <dir> | sort -rh | head` when "old stuff" is the question.

## Usual suspects on this host (check before anything exotic)
- Warden logs: `/opt/Warden/logs/` — `ls -lhS` and tail-truncate the giants (`truncate -s 100M <file>` keeps the head instead of deleting a live-written log).
- Package cache: `du -sh /var/cache/pacman/pkg/`; clean with `paccache -rk2` (keeps last 2 versions) or `pacman -Sc`.
- User caches: `~/.cache/` (`du -h --max-depth=1 ~/.cache | sort -rh | head`) — browsers and build tools dominate; safe to delete contents, apps rebuild.
- Build artifacts / node_modules in old projects: `find /home/dominic -name node_modules -type d -prune -exec du -sh {} + 2>/dev/null | sort -rh | head`.
- Journal: `journalctl --disk-usage`; cap with `journalctl --vacuum-size=200M`.
- Trash: `du -sh ~/.local/share/Trash` and empty it when it's the winner.

## Rules
- Report the BEFORE and AFTER `df -h /` numbers in the reply — a cleanup answer is the delta, plus what was freed and where.
- Delete only what you can name and justify: caches, old logs, package cache, trash. When unsure what a big dir is, `ls` it and say what you see before touching it.
- Never clean a live-written log by `rm` — truncate or rotate, or the process keeps writing to the deleted inode.
- Truncate/delete only what the task or the "usual suspects" list covers; a big personal directory found in passing gets REPORTED, not freed.