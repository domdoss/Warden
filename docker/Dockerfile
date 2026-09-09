# Warden host orchestrator + agent-runner on Arch Linux.
# What's containerized: the Node orchestrator (src/ → dist/) and the
# agent-runner (container/agent-runner → dist/agent-runner), dashboard static
# (public/), and the SQLite store. What is NOT: Ollama and the MARM memory
# service stay on the host (the container reaches them over
# host.docker.internal — see docker/README.md), and Chrome / the voice UI
# remain host-side processes.
FROM archlinux:base

# nodejs+npm to run and build; base-devel+python for the native module
# toolchain (node-pty compiles from source; better-sqlite3 and sharp ship
# prebuilds); curl for the HEALTHCHECK; git is not needed at runtime.
RUN pacman -Sy --noconfirm nodejs npm base-devel python curl \
    && pacman -Scc --noconfirm

# Warden normally runs as a plain user (systemd --user service), not root.
RUN useradd --create-home --user-group warden

WORKDIR /app

# Install root deps first for layer caching. The agent-runner's own
# package.json deps are unused at runtime — its real imports all resolve
# from the root node_modules (verified on the live box), so one npm ci here
# covers both the host build and the spawned agent-runner.
COPY package.json package-lock.json ./
RUN npm ci

# Sources needed for `npm run build` (tsc + build:agent-runner), plus the
# dashboard static dir the status server serves from ./public.
COPY tsconfig.json ./
COPY src ./src
COPY container ./container
COPY public ./public

RUN npm run build

# Runtime-writable locations, owned by the unprivileged user so the named
# volumes inherit the right ownership on first use.
#   /app/store  — SQLite DB (messages.db),  cwd-relative, must persist
#   /app/data   — the env file (data/env/env) read by src/env.ts
#   /data       — WORKSPACE_ROOT (groups/, uploads, MEMORY.md, agent cwd)
RUN mkdir -p /app/store /app/data /data \
    && chown -R warden:warden /app/store /app/data /data
VOLUME ["/app/store", "/app/data", "/data"]

USER warden
ENV NODE_ENV=production \
    WORKSPACE_ROOT=/data \
    OLLAMA_URL=http://host.docker.internal:11434

EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD curl -sf http://localhost:3200/ || exit 1

CMD ["node", "dist/index.js"]