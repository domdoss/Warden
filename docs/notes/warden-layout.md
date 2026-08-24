# Warden layout (updated 2026-08-24)

The Warden project lives at **/opt/Warden** (remote: `github.com/domdoss/Warden`). Commit and push from here. Single desktop only — `dominic` on archlinux. There is **no Pi / no remote backend**; the old two-box desktop+Pi setup was retired 2026-08-21. Any surviving `Pi` / `graice` / `192.168.0.171` references in code or docs are stale.

- **Systemd user service** `warden.service` (enabled). `ExecStart=/usr/bin/node /opt/Warden/dist/index.js`, `WorkingDirectory=/opt/Warden`, `Environment=WORKSPACE_ROOT=/home/dominic/Warden`. Manage with `export XDG_RUNTIME_DIR=/run/user/$(id -u)` then `systemctl --user {is-active,status,restart} warden.service`.
- **Logs are in journald**, NOT `logs/warden.log` (that file is stale; so is `logs/warden.error.log`). Use `journalctl --user -u warden.service`.
- **Dashboard/API** on port 3200, bound `0.0.0.0`. Chat ingestion is `POST /api/messages` (NOT `/api/chat`); `/api/chat/stop` requires `{jid, advance_cursor:true}`.
- **DB**: `/opt/Warden/store/messages.db` (better-sqlite3, WAL). `WORKSPACE_ROOT=/home/dominic/Warden`; `GROUPS_DIR` = `WORKSPACE_ROOT/groups`, so uploads/heartbeat/attachments live under `~/Warden/groups`.
- **Build**: host `src/*`→`dist/*` via `npx tsc`; agent-runner `container/agent-runner/src/*`→`dist/agent-runner/*` via `npm run build:agent-runner`. `dist/` is built output, gitignored, never edited by hand. Deploy: `export XDG_RUNTIME_DIR=/run/user/$(id -u) && systemctl --user restart warden.service`. Verify the build exits 0 before restarting.
- Edit `.ts` **source** only (`src/` for the host, `container/agent-runner/src/` for the agent). Never edit `dist/` by hand.

History: the repo was previously at `/home/dominic/Projects/Warden` (and before that a `dockbox` rename that was reverted); it now lives at `/opt/Warden`.