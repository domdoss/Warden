# Warden in Docker (Arch Linux base)

Containerizes the **host orchestrator + agent-runner** — one `archlinux:base`
image that builds both with `npm run build` and runs `node dist/index.js`,
exactly what `warden.service` does on the desktop.

## Build & run

```sh
# from the repo root — context is the repo root, so .dockerignore applies
docker compose -f docker/docker-compose.yml up -d --build

# or plain docker:
docker build -f docker/Dockerfile -t warden:latest .
docker run -d --name warden -p 3200:3200 \
  --add-host=host.docker.internal:host-gateway \
  -v warden-workspace:/data -v warden-store:/app/store -v warden-data:/app/data \
  warden:latest
```

Dashboard: `http://localhost:3200/`. Health: the image has a `HEALTHCHECK`
that curls the dashboard root.

## Volumes

| Volume | Mount | What lives there |
| --- | --- | --- |
| `warden-workspace` | `/data` | `WORKSPACE_ROOT` — groups/, uploads, attachments, MEMORY.md/JOURNAL.md, and the cwd of every spawned agent-runner child. Drop an `mcp-servers.json` in here; the runner reads its MCP config from the workspace. |
| `warden-store` | `/app/store` | `messages.db` (SQLite) — cwd-relative, same path the systemd unit uses. |
| `warden-data` | `/app/data` | The env file `data/env/env` (read AND rewritten by the host at runtime). Populate it on first boot if you have host settings to carry over. |

Migrating from the desktop install: seed each volume before first start, e.g.
`docker run --rm -v warden-store:/to -v /opt/Warden/store:/from:ro alpine cp /from/messages.db /to/messages.db`
(same pattern for `/data` ← `~/Warden` and `/app/data` ← `data/`).

## What's in the container vs. on the host

**In:** orchestrator (`src/` → `dist/`), agent-runner
(`container/agent-runner/` → `dist/agent-runner/`, spawned as a child of the
host process), dashboard static (`public/`), the three writable volumes.

**Out (still host-side):**

- **Ollama** — models are huge and GPU-bound; the container reaches the host
  daemon at `OLLAMA_URL=http://host.docker.internal:11434` via the
  `host-gateway` mapping in compose. Alternative: `network_mode: host` and the
  default `127.0.0.1:11434` works untouched (drop `ports:` too, then).
- **MARM memory service** (`marm-memory.service`, port 8001) — same gateway
  pattern (`http://host.docker.internal:8001`); a containerized companion is a
  candidate next step.
- **Chrome** — the host watchdog launches a headed Wayland Chrome window the
  agent-runner drives over CDP (port 9222). A container has no Wayland
  session; browser features need either the host Chrome reachable at
  `host.docker.internal:9222` or a Chromium sidecar with its own tradeoffs.
- **Voice UI / eyes_ears** — desktop-native pywebview/Qt apps; out of scope.

## Image notes

- `archlinux:base` + `pacman -Sy nodejs npm base-devel python curl` —
  `base-devel`/`python` exist for `node-pty`, which compiles from source;
  `better-sqlite3` and `sharp` ship prebuilt binaries.
- One `npm ci` at the root covers everything: the agent-runner's declared
  package.json deps are unused at runtime — its actual imports resolve from
  the root `node_modules` (verified against the live tree).
- Runs as an unprivileged `warden` user, matching the systemd --user service
  it replaces.
- Build context is the repo root; `.dockerignore` (repo root) keeps the
  archives, backups, node_modules, store, and venvs out of the image.