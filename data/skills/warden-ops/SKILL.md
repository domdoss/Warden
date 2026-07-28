---
name: warden-ops
description: "Operational triage and maintenance for the Warden service: check systemd status, tail logs, inspect SQLite DBs in data/, list/restart containers, and run common warden-ctl actions. Use whenever the user asks about Warden health, why something isn't responding, or wants to restart/check the service."
tools: ["Bash","Read","Grep","Glob"]
---

# warden-ops — Warden service triage skill

This skill helps operate the Warden personal-assistant service at `/home/user/warden`.

## Layout (memorize)
- Orchestrator entrypoint: `/home/user/warden/container/index.js` (Node.js, runs as `warden.service`)
- Control TUI: `/home/user/warden/warden-ctl`
- Data dir: `/home/user/warden/data/` (SQLite DBs, env, mcp-servers.json, skills/, pii-vault/)
- Docs: `/home/user/warden/WARDEN.md`, `BUILD.md`, `AUDIT-*.md`, `CHANGES-*.md`
- Service name: `warden.service`  (systemd, user-managed via `warden-ctl`)

## Standard triage playbook
Run these in order when the user says "is warden up?", "check warden", "why didn't it respond", etc.

1. **Service status**
   `systemctl status warden.service --no-pager -l | head -30`
   - If `inactive`/`failed`: offer `sudo systemctl start warden.service` (or `warden-ctl` → start).
   - If `active`: note uptime and PID.

2. **Recent logs** (last 50 lines, look for crashes/OOM/LLM errors)
   `journalctl -u warden.service -n 50 --no-pager | tail -50`
   Also check app logs if present: `ls -la /home/user/warden/data/logs/ 2>/dev/null`

3. **DB sanity** — every DB in `data/` should be non-corrupt:
   `for db in /home/user/warden/data/*.db /home/user/warden/data/*.sqlite*; do [ -f "$db" ] && echo "== $db ==" && sqlite3 "$db" "PRAGMA integrity_check;" 2>&1 | head -3; done`
   - Empty (0-byte) DBs are expected for some shards — note but don't alarm.

4. **Container/runtime check** (Warden uses child_process agent-runner, not Docker for the free tier, but docker MCP may be configured):
   `docker ps 2>&1 | head -5` only if relevant.

5. **Port check** — status-server on :3200:
   `curl -sS -m 3 http://localhost:3200/ -o /dev/null -w "status=%{http_code}\n" 2>&1`

## Common fixes
- **Won't start**: `journalctl -u warden.service -n 80 --no-pager | grep -iE 'error|EADDR|EACCES|Cannot find'` → usually a missing env var in `data/env/env` or a port conflict.
- **LLM errors**: confirm `OLLAMA_URL` / `OLLAMA_MODEL` in `data/env/env`; `curl -sS $OLLAMA_URL/api/tags | head`.
- **MCP server won't load**: check `data/mcp-servers.json` is valid JSON (`python3 -c "import json;json.load(open('data/mcp-servers.json'))"`) and that the listed command exists (`which npx uvx`).

## Rules
- NEVER run `sudo systemctl restart warden.service` without telling the user first and confirming.
- NEVER delete or overwrite any DB under `data/` — read-only inspection only.
- Prefer `warden-ctl` for user-facing actions when available; fall back to systemctl only for quick status.
- Report findings as a short structured summary: Service / Logs / DBs / Ports / Recommendation.
