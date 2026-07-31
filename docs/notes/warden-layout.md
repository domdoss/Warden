# Warden layout

The Jarvis/Warden project lives at **/home/user/Projects/Warden** (moved from `/home/user/dockbox` on 2026-07-30 — "dockbox" was the old name).

- Systemd user service: **`warden.service`** (was `dockbox.service`). Start/stop/restart: `systemctl --user {start,stop,restart} warden`.
- Logs: `logs/warden.log` + `logs/warden.error.log` (renamed from `dockbox.*`).
- Build: `npm run build` (host + agent-runner) or `npm run build:agent-runner` (agent-runner only). Deploy: `systemctl --user restart warden`.
- `WORKSPACE_ROOT=~/Projects/Warden` (in `data/env/env`).
- The Atlas + Artemis sub-agent prompts reference `/home/user/Projects/Warden`, `store/messages.db`, and `logs/warden.log` — these are CORRECT (they were ahead of the old dockbox path), so don't "fix" them back to dockbox.

dockbox was a rename attempt that was reverted; Warden is the current naming. The Atlas/Artemis prompts already used Warden paths, which is why audits/self-edits silently referenced a then-non-existent `/home/user/Projects/Warden` until the repo was moved back there on 2026-07-30.