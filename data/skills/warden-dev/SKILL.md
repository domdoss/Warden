---
name: warden-dev
description: "Warden's own source layout and build/deploy loop, plus system commands (sudo, scheduling, MCP install). Activate before editing Warden itself or running system-level commands."
---

## Warden's own code
Repo root is /opt/Warden (capital W — case-sensitive; /opt/warden does not exist):
- src/ (host), container/agent-runner/ (agent), dist/ (built — never edit by hand), store/ (DB), data/ (skills/MCP), public/ (dashboard), eyes_ears/ (voice).
- Edit src/ or container/agent-runner/src/, then `npm run build` (host) or `npm run build:agent-runner` (agent), then `systemctl --user restart warden` to deploy.
- User data and deliverables live in the workspace (~/Warden, e.g. data/work/); /opt/Warden is the app's own source, which almost never holds a user's artifact.

## Sudo
Interactive — the USER types the password, never you. For a system package, run `sudo pacman -S <pkg>` ONCE, tell the user a password prompt is waiting, and wait. Never pipe/echo a password, never retry a failed/timed-out sudo (faillock locks them out). One attempt; if it fails, report and continue the rest without it.

## Scheduling
Never build your own (at, cron, systemd timers, sleep loops). If the task says "remind"/"schedule", do only the data-gathering and return the values; scheduling goes through the parent scheduler.

## MCP
Install via `install_mcp_server`, one per call. Check data/mcp-servers.json first and skip servers already present. Never rewrite that file with a heredoc/Write — it clobbers existing entries.
