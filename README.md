# Prometheus

**Your own AI. On your own machine. Hybrid by design.**

Prometheus is a personal AI assistant that lives on your desktop. It runs local models through Ollama for fast, private tasks, and reaches out to cloud models for heavy lifting — all within a single conversation. It connects to your real browser, controls your desktop, manages your email and calendar, and talks to you through whatever channel you prefer.

---

## Architecture

### The Orchestrator

A single LLM — the **orchestrator** — runs the show. It receives your message, decides what needs to happen, and delegates work to a team of specialized sub-agents. The orchestrator itself is designed to be a small, fast model (local Ollama) that routes and supervises rather than executing directly.

```
You → Orchestrator (small, local) → Atlas (large, cloud) → result → Orchestrator → You
                                   → Iris (email/calendar)
                                   → Dexter (scheduling)
                                   → Byte (projects)
                                   → Artemis (audit)
                                   → The Council (deliberation)
```

The orchestrator never touches the internet directly. It doesn't browse, it doesn't search, it doesn't fetch URLs. It delegates. This separation means the orchestrator can run on a cheap local model while the internet-connected agents run on the most capable models available.

### Sub-Agents

Each sub-agent has its own system prompt, its own toolset, and its own model. They don't share context — the orchestrator composes a self-contained task string with everything the sub-agent needs.

| Agent | Model | Tools | Role |
|-------|-------|-------|------|
| **Atlas** | Cloud (large) | Shell, browser, files, web fetch, document conversion | Execution. Anything that touches the internet or runs commands. |
| **Iris** | Cloud | Email (IMAP/SMTP), calendar (CalDAV), contacts (CardDAV) | Personal information management. |
| **Dexter** | Cloud | Task scheduling, alarms, cron | Time-based automation. |
| **Byte** | Cloud | Projects, deliverables, blockers, financials, time tracking | Work management. |
| **Artemis** | Cloud | Read-only file access | Critical review. Audits conversations and decisions. |
| **The Council** | 3× Cloud | Read-only file access | Three independent seats (Skeptic, Pragmatist, Synthesist) deliberate in parallel on high-stakes decisions. |

### Async by Default

Atlas runs in the background. When the orchestrator delegates to Atlas, it gets a job ID back immediately and stays free to handle your next message. Results land in an **inbox** — the orchestrator drains it at turn end, digests what matters, and chains follow-up tasks. Urgent jobs can interrupt mid-turn. You're never stuck waiting for a long-running task to finish before you can keep talking.

### Persistent Runner

The agent-runner spawns as a persistent child process — no Docker, no containers, no cold starts between messages. It stays warm for hours (configurable `IDLE_TIMEOUT`), keeping MCP servers connected and skills loaded. Follow-up messages route over IPC in milliseconds.

---

## Prompt Engineering

This is the feature that makes Prometheus work. The system prompt isn't a paragraph of vibes — it's a carefully engineered control surface that has been iterated on extensively.

### Delegation Discipline

The orchestrator is trained to state **WHAT**, never **HOW**. It doesn't see the sub-agents' tools. It can't prescribe URLs, search queries, or step-by-step instructions. The system prompt explicitly forbids it:

> *"Atlas is the internet model. It runs on a larger, more capable model than you. Never tell Atlas how to use the internet — no URLs, no search queries, no 'go to X then click Y.' Give it the goal and the facts, and stop."*

This is reinforced at three layers: the orchestrator's system prompt, the Atlas tool description (what the orchestrator sees when deciding to call it), and Atlas's own system prompt (which tells it to ignore prescribed steps).

### Fabric Pattern Integration

Prometheus ships with 258 expert prompt patterns from the Fabric library. Every turn, the user's message is keyword-extracted and the top 5 most relevant patterns are injected into the system prompt by name and description. The orchestrator loads the full pattern on demand and bakes its framing into the Atlas task brief — giving the larger model the structure it needs without the orchestrator micromanaging the execution.

### Dynamic Tool Selection

Not all 30+ tools go into every prompt. Keywords from the conversation are extracted and tools are ranked by relevance. Core routing tools (sub-agents, Read, Bash) are always included; everything else is surfaced only when relevant. This keeps the context window lean and the model focused.

### Defensive Loop Patterns

The tool loop has multiple circuit breakers to prevent common failure modes:
- **Intent-without-action detection** — if the model keeps saying "I'll do X" without actually calling tools, it gets nudged (capped at 2 nudges)
- **Circling detection** — consecutive useless rounds (no tool calls, no output) trigger a forced no-tools round to extract an answer
- **Degenerate output filter** — word-mash / garbled output from misconfigured models is detected and suppressed
- **Verifier sub-agent** — after effectful work (file writes, edits), a verifier pass confirms the changes

### Memory System

The orchestrator writes directly to `MEMORY.md`, `TODO.md`, and `HEARTBEAT.md` — no delegation needed. These files are loaded into context every turn. The heartbeat file is executed on schedule by the task scheduler, giving the agent persistent autonomous behavior.

### Context Compaction

Long conversations are compacted by a Mercury summarization layer. Older turns are condensed into memory notes, keeping the active context window focused on what matters.

---

## Hybrid Model Architecture

Prometheus is built for hybrid operation from the ground up. Different tasks need different models, and you shouldn't have to choose one and stick with it.

### How It Works

Every model selection in the dashboard is per-role:

| Role | Typical Model | Why |
|------|-------------|-----|
| **Orchestrator** | Local (granite, gemma) | Fast, cheap, always available. Only routes and supervises. |
| **Atlas** | Cloud (deepseek, kimi, glm) | Heavy lifting. Internet access, shell commands, complex reasoning. |
| **Iris/Dexter/Byte** | Cloud | Need reliability for structured tasks. |
| **Council seats** | Cloud (3 different models) | Diverse perspectives for deliberation. |
| **Sub-agent tools** | Configurable | Can use a different model for tool-calling sub-agents. |

### Local-First, Cloud-Fallback

The credential proxy (port 3001) handles all LLM routing. Containers never see real API keys. The proxy validates the per-container auth token, then forwards the Ollama-format request to `OLLAMA_URL` — local or cloud, same path. The agent-runner speaks Ollama's native HTTP API for everything.

> The repo also ships format-translation artifacts (`ollama-translate.ts`, `anthropic-translate.ts`) for anyone who wants to wire in Anthropic or OpenAI endpoints. They are not part of the default request path — by default everything is Ollama, local and cloud.

### Session Storage

All conversation history lives in a single SQLite store (`agent_sessions`), shared across every model. There are no per-vendor session directories. Switching models mid-conversation keeps the same history.

---

## Real Browser Automation

Prometheus connects to your actual Chrome via Playwright and the Chrome DevTools Protocol (port 9222). Your real profile — cookies, sessions, saved passwords, extensions — everything is intact.

The browser tools operate on **DOM accessibility snapshots**, not screenshots. Each element gets a `[ref=e12]` identifier. The agent clicks, types, and navigates by ref — fast, precise, and cheap. Screenshots exist only for visual verification of end states.

Chrome runs as a persistent process with its own watchdog. It survives agent restarts. Sign into Google once; the profile persists forever.

---

## Desktop Control

Prometheus controls your actual desktop — mouse movement, keystrokes, window management. Wayland via ydotool, X11 via xdotool. It discovers your display environment automatically, even when started from systemd with no `DISPLAY` set.

---

## Dashboard

A full PWA at `http://localhost:3200` with:

- **Chat** — the main conversation interface
- **Projects** — deliverables, blockers, financials, time tracking
- **Files** — browse, upload, download, rename, delete
- **Vault** — PII-scrubbed file storage with restore
- **API Keys** — manage provider keys (Twilio, Slack, SendGrid, etc.)
- **Scheduled Tasks** — cron/interval/once automation
- **Heartbeat** — persistent agent instructions executed on schedule
- **Alarms** — reminders with sound and desktop notification
- **Actions** — one-touch prompt buttons
- **SMS** — Twilio send/receive
- **Talk** — voice transcription
- **Email** — IMAP inbox with send
- **Calendar** — CalDAV via Radicale, synced with KDE Kontact
- **Accounts** — connected channels and OAuth
- **Skills & MCP** — hot-pluggable capability management
- **Agent Activity** — live verbose status of what the agent is doing
- **Process Logs** — live log tail

---

## MCP Ecosystem

Model Context Protocol servers give agents real capabilities:

| Server | Capability |
|--------|-----------|
| **Filesystem** | Read, write, edit, search, manage files |
| **Fetch** | Retrieve web content |
| **Shell** | Execute commands in a live PTY |
| **Memory** | Persistent knowledge graph |
| **SQLite** | Query and manage databases |
| **Time** | Timezone-aware scheduling |
| **Plasma** | KDE Plasma D-Bus (notifications, clipboard, windows) |

MCP servers are configured in `data/mcp-servers.json` and can be toggled from the dashboard. Add new capabilities without touching core code.

---

## Channels

One conversation, many doors. All channels merge into a single chat:

- **Web Dashboard** — the PWA at port 3200
- **Telegram** — bot via grammy
- **WhatsApp** — via Baileys (no third-party API)
- **Slack** — bot integration

Message from WhatsApp, continue on Telegram, check the dashboard — same context, same memory.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ with TypeScript |
| Database | SQLite via better-sqlite3 |
| Browser | Playwright (playwright-core) over CDP |
| LLM | Ollama (local + cloud) |
| LLM Routing | Credential proxy with format translation for cloud endpoints |
| Messaging | grammy (Telegram), Baileys (WhatsApp), Slack SDK |
| Email | IMAP via imapflow, SMTP via nodemailer |
| Calendar/Contacts | CalDAV/CardDAV via Radicale, synced with KDE Kontact |
| Voice | Whisper (STT), Kokoro (TTS) |
| Logging | Pino |
| Process | Single Node.js process, agent-runner as persistent child |

All LLM communication is raw HTTP fetch to Ollama. No vendor SDKs. You control the model.

---

## Quick Start

```bash
git clone <your-repo-url> prometheus
cd prometheus
bash install.sh
```

The installer handles dependencies, TypeScript build, directory setup, and systemd service registration. Requires Node.js 20+ and Ollama.

```bash
# Service control (Linux)
systemctl --user start prometheus
systemctl --user kill prometheus   # fast stop
systemctl --user start prometheus  # restart

# Dashboard
open http://localhost:3200
```

---

## Configuration

All settings live in `data/env/env`:

```bash
ASSISTANT_NAME=Prometheus
TZ=America/Vancouver
IDLE_TIMEOUT=14400000          # 4h warm-runner window
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=glm-5.2:cloud
TELEGRAM_BOT_TOKEN=            # from @BotFather
```

Model selection is per-role via the dashboard — orchestrator, Atlas, sub-agents, and council seats can all use different models.

---

## Why Prometheus?

Most AI assistants live in the cloud. They see what you type, not what you see. They run on someone else's hardware, with someone else's model, under someone else's terms.

Prometheus runs on your machine. It uses your browser, your desktop, your files, your email. It works with local models through Ollama, so your data never leaves your hardware unless you choose to send it. And when you need more power, it reaches out to cloud models — all within the same conversation, with the same memory.

It's not a demo. It's a real assistant with browser automation, desktop control, voice, email, calendar, multi-channel messaging, a plugin ecosystem, an agent architecture that can reason about your work and audit its own decisions, and a prompt engineering surface that has been battle-tested across hundreds of hours of real use.

Prometheus stole fire from the gods. This one runs on your laptop.

---

## License

MIT
