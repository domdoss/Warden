<div align="center">

# 🔥 Warden

### Your own AI. On your own machine. Hybrid by design.

[![Node](https://img.shields.io/badge/node-20%2B-5FA04E?logo=node.js&logoColor=white)](#%EF%B8%8F-quick-start)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#-tech-stack)
[![Ollama](https://img.shields.io/badge/LLM-Ollama%20local%20%2B%20cloud-black)](#-hybrid-model-architecture)
[![SQLite](https://img.shields.io/badge/data-SQLite-003B57?logo=sqlite&logoColor=white)](#-tech-stack)
[![License](https://img.shields.io/badge/license-MIT-green)](#-license)

**[🛡️ Warning](#%EF%B8%8F-warning--read-this-before-you-run-anything-%EF%B8%8F)** ·
**[⚙️ Architecture](#%EF%B8%8F-architecture)** ·
**[🧠 Prompt Engineering](#-prompt-engineering)** ·
**[☁️ Hybrid Models](#-hybrid-model-architecture)** ·
**[📊 Dashboard](#-dashboard)** ·
**[🧩 MCP](#-mcp-ecosystem)** ·
**[🗣️ Voice](#%EF%B8%8F-voice-assistant)** ·
**[🛰️ Satellite](#-satellite-pi-audio-relay)** ·
**[🛡️ Security Mode](#-security-mode)** ·
**[🚀 Quick Start](#%EF%B8%8F-quick-start)**

</div>

---

# ⚠️ WARNING — READ THIS BEFORE YOU RUN ANYTHING ⚠️

## This is insane software. It is probably not safe to run.

Warden is an AI agent with **the same access as your user account**. It executes shell commands, moves your mouse and types on your keyboard, drives your real browser with your real logged-in sessions and saved passwords, reads and sends your email, and can **edit and restart its own source code**. There is no sandbox and no container. A model mistake, a prompt injection from a web page it visits, or an email it reads can do anything you can do at a terminal.

![Safety warning modal shown on first dashboard launch](docs/screenshots/warning.png)

This is the warning the dashboard shows on first launch. It is not a joke and it is not boilerplate. Do not run Warden on a machine you care about unless you have read the code, understood the risks, and accepted that you are handing a language model the keys to your computer.

Now that *that's* out of the way — I'm currently running it on my laptop and my desktop, just rawdogging the system, and it has been solid. `sudo` prompts pop up graphically (polkit catches them), and in practice it doesn't stray out of its workspace unless it's actively searching for files or the like. Is this stupid in theory? Yes, absolutely. Does it work in practice? So far, yes — for now. Just back things up from time to time, in case.

---

## What is it?

Warden is a personal AI assistant that lives on your desktop. It runs local models through Ollama for fast, private tasks, and reaches out to cloud models for heavy lifting — all within a single conversation. It connects to your real browser, controls your desktop, manages your email and calendar, and talks to you through whatever channel you prefer.

---

## Architecture

### The Orchestrator

A single LLM — the **orchestrator** — runs the show. It's the only thing you talk to, and it's deliberately *small*: a 12B Gemma 4 model (`gemma4:latest`) running locally on Ollama. It doesn't write your reports, doesn't browse the web, doesn't run shell commands. It reads your message, works out what you actually want, hands a clean brief to the right specialist, and then **babysits** that specialist until the job is done — cutting loose the ones that go sideways and re-briefing the ones that fail. A 12B model supervising a frontier model, and it doesn't fuck up.

```
You → Orchestrator (small, local) → Atlas (large, cloud) → result → Orchestrator → You
                                   → Iris (email/calendar)
                                   → Dexter (scheduling)
                                   → Byte (projects)
                                   → Artemis (audit)
                                   → The Council (deliberation)
```

> 💡 **The orchestrator never touches the internet directly.** It doesn't browse, search, or fetch URLs. It delegates. That separation lets the orchestrator stay small and local while the internet-connected agents run on the biggest models available.

#### A 12B model is enough — that's the whole point

This is the counterintuitive part: the orchestrator is the cheapest model in the stack, and that's by design. Its job isn't generation, it's **classification and composition**. Every turn it answers a small set of questions: *what does the user want, which specialist owns it, what does that specialist need to know to start cold, and is anything I'm currently babysitting going sideways?* None of that needs a frontier model. A 12B Gemma 4 nails it — locally, in well under a second per turn, on hardware you already own — so the thing you talk to most carries no per-turn cloud cost.

The expensive generation lives one layer down, in the specialists. Atlas and Artemis default to a large cloud model; the three Council seats each run their own model. The orchestrator stays out of that. It states **what** needs to happen and stops — it never prescribes **how** (no URLs, no search queries, no "go to X then click Y"), because it can't even see the specialists' tools. That discipline is exactly what lets a 12B model supervise a frontier one without getting in the way: it can't micromanage what it can't see, so it doesn't try.

#### Babysitting the sub-agents

Delegation is not fire-and-forget. When the orchestrator hands work to Atlas, Atlas runs **in the background** — the orchestrator gets a job ID back immediately and stays free to handle your next message. While those jobs run, the orchestrator supervises them on a fixed **30-second monitor tick**. On every tick it checks up on each running job — reads the synthetic status line (elapsed time, tool-call count, what the job last did and how many seconds ago) and decides whether the work is **on track**, **veering off / doing the wrong thing**, or **stuck and looping**. On track, it leaves the job alone; veering or stuck, it calls `stop_agent` and re-delegates with a corrected brief. When a job **finishes**, the result lands in an **inbox**.

Crucially, that supervision runs **silently**. The tick's prose ("Atlas is on track…") is canned filler — it doesn't go to your chat. Progress lives in the dashboard instead: the real status line each job emits on every tool call streams into a **grouped, collapsible Live Activity panel** (one summary line when collapsed, the recent history when expanded), so you watch what's actually happening without a parade of chat bubbles. The chat only carries **completed-task reports** (and interventions) — you ask once, the orchestrator drives the whole chain end to end, and you hear from it when there's something finished to tell you.

The inbox is the backbone of the async model. Finished jobs drop their full output there, and at the end of each turn the orchestrator drains it, digests what actually matters in its own voice, and chains any follow-up work the results call for — so a multi-step ask (plan → council → revise) runs end to end without you having to say "and?" or "continue" between steps. If a job **failed**, the failure routes back to the orchestrator automatically — it reads the full output, works out what went wrong, and re-delegates with a reworked brief (a different approach, a corrected URL, a missing detail — whatever the output showed was broken). You only hear about a failure if it can't be recovered; after the same task has failed the same way twice, the orchestrator stops retrying and tells you instead. Urgent results can even **interrupt a turn mid-flight**, so a finished job you're waiting on never sits behind whatever else happens to be running.

The net effect: you ask once, and the orchestrator owns the outcome — prompting the specialists, supervising them, cutting off the ones that drift, and correcting course until the job is done or it's genuinely stuck.

#### One conversation, one voice

You have one conversation, with one assistant. Atlas, Iris, Dexter, and the rest never see your messages and never speak to you — the orchestrator is the only voice in the chat. It works out what you actually need, composes a self-contained brief for the right specialist, and reports back in its own words when the work is done.

![The orchestrator rewrites casual requests into clean task briefs before delegating](docs/screenshots/fabric.webp)

Your raw message never reaches a specialist. *"hey can you set the volume to like fifty percent"* goes in; *"Set the system volume to 50 percent"* is what gets delegated. Every request is rewritten into a precise, self-contained brief — typos, slang, and missing context resolved — so the executing model starts from a clean statement of the goal instead of guessing at your phrasing.

### Sub-Agents

Each sub-agent has its own system prompt, its own toolset, and its own model. They don't share context — the orchestrator composes a self-contained task string with everything the sub-agent needs.

| Agent | Model | Tools | Role |
|-------|-------|-------|------|
| **Atlas** | Local or cloud | Shell, browser (DOM control), desktop, files, web search/fetch, documents | Execution — anything that touches the internet or runs commands. |
| **Iris** | Local or cloud (local recommended) | Email, calendar, contacts, todos | Personal information management. |
| **Dexter** | Local or cloud (local recommended) | create / list / pause / resume / cancel / update scheduled tasks (cron, interval, once) | Scheduling — builds perfect schedule entries and never executes them. |
| **Byte** | Local or cloud (local recommended) | Projects, deliverables, blockers, work tasks, time tracking | Work management. |
| **Artemis** | Local or cloud | Read-only file access | Critical review — audits conversations and decisions. |
| **The Council** | 3×, local or cloud | Read-only file access | Three independent seats (Skeptic, Pragmatist, Synthesist) deliberate in parallel on high-stakes decisions. |
| **Sentry** | Local (light, vision-optional) | `awareness_log`, `security_log`, `send_message`, `alert_security`, `open_security_alert`, `dismiss_security_flag`, `webcam_capture`, arm/disarm | Single background security & situational-awareness agent. Receives structured JSON AWARENESS events from the laptop camera, applies the editable `security/sentry.md` rules, and decides per event: alert (send a captioned frame + open the red alert), greet (friendly arrival), or stay silent. Also owns arming/disarming and the security log. **AWARENESS events route directly to `/api/awareness`, never through the chat message path.** |

> 🎛️ **Every agent's model is picked in the dashboard** — local Ollama or cloud, your call. Local and cloud run through the [same Ollama pipeline](#-hybrid-model-architecture), so switching an agent between them needs no code or infrastructure change. Iris, Dexter, and Byte are light, structured-task agents — run them on a local model (granite is plenty) and save cloud spend for Atlas and the Council.

### ⏰ Scheduling — Dexter

**Dexter is the scheduling agent. Its entire job is to create and manage schedule entries — it never executes them.**

The orchestrator owns the intent; Dexter owns the timing. When something needs to happen later, the orchestrator gives Dexter a **prompt** (what to run) and a **when** (the timing intent). Dexter's sole job is to translate that into one flawless schedule entry and hand it to the scheduler. Nothing more.

**What Dexter does:**
- Picks the right `schedule_type` — `cron` (recurring at specific times), `interval` (every N ms), or `once` (a single future timestamp) — and writes the `schedule_value` in its exact format.
- Does the time arithmetic in your **local timezone**, walking the offset digit by digit and verifying computed-time minus now equals the requested interval before committing.
- Stores the prompt verbatim — at fire time that prompt is injected into the running chat as a message from "Scheduler", and the **orchestrator runs it** like any other message, with full context and all its tools. Dexter set up the schedule; the orchestrator does the work.
- Manages the lifecycle of existing entries — list, pause, resume, cancel, update.

**What Dexter does not do:**
- It does not execute the scheduled task. Ever. It writes the entry and stops.
- It does not gather data or do research — if a scheduled prompt needs facts (a price, a status, a number), the orchestrator delegates that to Atlas first and hands Dexter the result to bake into the prompt.
- It does not diagnose why a task did or didn't fire — that's Artemis's job. Dexter only touches the entry if it needs fixing or recreating.
- It does not own todos, calendar events, or contacts — those are Iris. A *todo* is a list item; a *reminder that fires at a time* is Dexter.

**Model:** basic structured output — a small local model (granite) is plenty. The reliability lives in the prompt and the format validation, not in a big model.

The schedule-value format is where scheduling breaks in every system that has one, so Dexter is built to be obsessive about it: it validates the cron expression, rejects malformed intervals and timestamps, refuses timezone suffixes on `once`, and double-checks its own offset math. The point is that the entry is correct the first time, every time, on a model that costs nothing to run.

### Persistent Runner

> 🔥 **The agent-runner is a persistent child process** — no Docker, no containers, no cold starts between messages. It stays warm for hours (configurable `IDLE_TIMEOUT`), keeping MCP servers connected and skills loaded. Follow-up messages route over IPC in milliseconds.

---

## 🧠 Prompt Engineering

> **This is the feature that makes Warden work.** The system prompt isn't a paragraph of vibes — it's a carefully engineered control surface that has been iterated on extensively.

### 🎯 Delegation Discipline

The orchestrator is trained to state **WHAT**, never **HOW**. It doesn't see the sub-agents' tools. It can't prescribe URLs, search queries, or step-by-step instructions. The system prompt explicitly forbids it:

> *"Atlas is the internet model. It runs on a larger, more capable model than you. Never tell Atlas how to use the internet — no URLs, no search queries, no 'go to X then click Y.' Give it the goal and the facts, and stop."*

This is reinforced at three layers: the orchestrator's system prompt, the Atlas tool description (what the orchestrator sees when deciding to call it), and Atlas's own system prompt (which tells it to ignore prescribed steps).

### 🧵 Fabric Pattern Integration

Warden ships with 258 expert prompt patterns from the Fabric library. Every turn, the user's message is keyword-extracted and the top 5 most relevant patterns are injected into the system prompt by name and description. The orchestrator loads the full pattern on demand and bakes its framing into the Atlas task brief — giving the larger model the structure it needs without the orchestrator micromanaging the execution.

### 🎲 Dynamic Tool Selection

Warden is built to host many tools at once — the core set plus anything you add via skills and MCP servers — so the tool surface had to scale without bloating every prompt. Not all 30+ tools go into every turn. Keywords from the conversation are extracted and tools are ranked by relevance; the core routing tools (sub-agents, Read, Bash) are always included, and everything else is surfaced only when relevant. This keeps the context window lean, the model focused, and the system futureproof — add a new tool and it's available without rethinking the prompt.

![Skills & MCP panel: dozens of toggled capabilities](docs/screenshots/skills.png)

### 🛡️ Defensive Loop Patterns

The tool loop has multiple circuit breakers to prevent common failure modes:
- **Intent-without-action detection** — if the model keeps saying "I'll do X" without actually calling tools, it gets nudged (capped at 2 nudges)
- **Circling detection** — consecutive useless rounds (no tool calls, no output) trigger a forced no-tools round to extract an answer
- **Degenerate output filter** — word-mash / garbled output from misconfigured models is detected and suppressed
- **Verifier sub-agent** — after effectful work (file writes, edits), a verifier pass confirms the changes

### 📝 Memory System

The orchestrator writes directly to `MEMORY.md`, `TODO.md`, and `HEARTBEAT.md` — no delegation needed. These files are loaded into context every turn.

### 💓 Heartbeat

`HEARTBEAT.md` holds standing instructions the agent executes on schedule via the task scheduler — no prompt from you required. Edit it from the dashboard's Heartbeat panel (or let the agent edit it itself) and the instructions run automatically, giving the agent persistent autonomous behavior between conversations.

![Heartbeat panel: scheduled instructions the AI executes automatically](docs/screenshots/heartbeat.png)

### 🗜️ Context Compaction

Long conversations are compacted by a Mercury summarization layer. Older turns are condensed into memory notes, keeping the active context window focused on what matters.

### ✏️ Self-Editing

The agent can modify its own source. A built-in `self-edit` skill constrains edits to `src/` and `container/agent-runner/src/`, runs `npm run build`, gates on a successful compile, tells you what's changing, then restarts the service with `systemctl --user restart warden`. It refuses to touch `dist/`, configs, or the systemd unit, and never restarts on a failed build — so the agent can ship its own fixes without you opening a terminal.

---

## ☁️ Hybrid Model Architecture

Warden is built for hybrid operation from the ground up. Different tasks need different models, and you shouldn't have to choose one and stick with it.

### ⚙️ How It Works

Every model selection in the dashboard is per-role:

| Role | Typical Model | Why |
|------|-------------|-----|
| **Orchestrator** | Local (gemma, granite) | Fast, cheap, always available. Only routes and supervises. |
| **Atlas** | Cloud (deepseek, glm) | Heavy lifting — internet access, shell, browser, complex reasoning. |
| **Iris / Dexter / Byte** | Local (recommended) | Light, structured tasks. Run them local; save cloud for Atlas and the Council. |
| **Council seats** | Cloud (3 different models) | Diverse perspectives for deliberation. |
| **Sub-agent tools** | Configurable | Tool-calling sub-agents can use a different model. |

All of this is configured from the dashboard's Settings panel — assistant name, model per role, Ollama URL, and automation settings:

![Settings panel: assistant name, model configuration per role, Ollama URL, and automation settings](docs/screenshots/settings.png)

### 🔄 One Pipeline, Local or Cloud

There is no separate infrastructure for cloud models. Ollama serves both local models (on your machine) and cloud models (remote Ollama-compatible endpoints) through the same HTTP API — so every agent can be flipped between local and cloud from the dashboard with no code or infrastructure change. You're just picking a model id. The agent-runner talks to Ollama directly — no proxy in the path by default.

### 🧭 Model Routing

The agent-runner speaks Ollama's native HTTP API and talks to Ollama directly — local models at `localhost:11434`, cloud models at their Ollama-compatible endpoint, model picked per role in the dashboard. No proxy in the path. The agent doesn't know or care whether the model is local or cloud; same format, same tools, same conversation.

**Optional — piping in Claude:** `src/credential-proxy.ts` (port 3001) is in the codebase but **not wired in by default**. It exists for one case: routing to Anthropic's Claude. It translates Ollama-native requests ↔ Anthropic format and injects the Claude API key so the agent-runner never sees it. If you want Claude, wire the proxy in and point the agent-runner at it; otherwise everything stays on native Ollama.

### 💾 Session Isolation

Local and cloud models use separate session directories (`.ollama/` vs `.claude/`) to prevent context contamination. Switching models mid-conversation doesn't lose history.

---

## 🌐 Real Browser Automation

Warden connects to your actual Chrome via Playwright and the Chrome DevTools Protocol (port 9222). Your real profile — cookies, sessions, saved passwords, extensions — everything is intact.

The browser tools operate on **DOM accessibility snapshots**, not screenshots. Each element gets a `[ref=e12]` identifier. The agent clicks, types, and navigates by ref — fast, precise, and cheap. Screenshots exist only for visual verification of end states.

Chrome runs as a persistent process with its own watchdog. It survives agent restarts. Sign into Google once; the profile persists forever.

---

## 🖱️ Desktop Control

Warden controls your actual desktop — mouse movement, keystrokes, window management. Wayland via ydotool, X11 via xdotool. It discovers your display environment automatically, even when started from systemd with no `DISPLAY` set.

---

## 📊 Dashboard

A full PWA at `http://localhost:3200`. It includes:

| | | |
|---|---|---|
| 💬 **Chat** | Main conversation interface | 🗂️ **Projects** | Deliverables, blockers, financials |
| 📁 **Files** | Browse, upload, download, manage | 🔒 **Vault** | PII-scrubbed file storage |
| 🔑 **API Keys** | Provider credentials | ⏰ **Scheduled Tasks** | Cron/interval/once automation |
| 💓 **Heartbeat** | Standing instructions on schedule | ⏰ **Alarms** | Reminders with sound + desktop notify |
| ⚡ **Actions** | One-touch prompt buttons | 📱 **SMS** | Twilio send/receive |
| 🎤 **Talk** | Voice transcription | ✉️ **Email** | IMAP inbox + send |
| 📅 **Calendar** | CalDAV synced with Kontact | 📝 **Notes** | Obsidian-style markdown vault |
| 🧩 **Skills & MCP** | Hot-pluggable capabilities | 📈 **Agent Activity** | Live verbose status + collapsible progress panel |
| 📜 **Process Logs** | Live log tail ||

### ⚡ Quick Actions

One-touch prompt buttons for the things you do all the time — setup, review, write, research. Press a button instead of typing the same prompt again; each action fires a pre-written prompt into the conversation.

![Quick Actions panel: one-touch prompts for setup, review, write, and research](docs/screenshots/actions.png)

### 📖 Built-In Help

An agent system is only as good as the requests you give it, so Warden teaches you how to use it. On first launch the dashboard opens a **How to Use Warden** guide that leads with the one thing new users need to hear — *this is not a chatbot* — then walks the whole system: the agent roster and what each specialist actually does, how to convene the Council on a decision, how to delegate to Atlas (including parallel delegations in a single turn), the skills system, and what kinds of asks work best.

![How to Use Warden modal: the agent roster and what each specialist does](docs/screenshots/help.png)

![How to Use Warden modal: convening the Council, delegating to Atlas, and the skills system](docs/screenshots/help2.png)

Behind the modal sits a full help site with in-depth pages. The flagship, *not-a-chatbot*, puts chatbot-style asks and agent-style asks side by side — "tell me about microservices" gets you conversation; "read `src/auth.ts` and tell me if there's a timing-safe comparison missing" gets you tools run, files read, verdicts returned — then distills the principles that make requests land: be specific about the target, parallelize independent asks, read `BLOCKED` messages instead of retrying blindly, and watch the verbose bar to see what Warden is doing right now.

![Help page "This is not a chatbot": chatbot-style vs agent-style asks and the five principles](docs/screenshots/help3.png)

### 📝 Notes

An Obsidian-inspired markdown vault backed by the real filesystem — no database, just `.md` files you can also edit by hand or sync with anything. The vault root is `~/Documents/Notes`; the corpus (tags, backlinks, `[[link]]` resolution, search) is indexed only from that subtree, so it stays focused on your actual notes instead of pulling in the tens of thousands of unrelated markdown files (READMEs, skill docs, etc.) scattered across the rest of your home directory.

- **`[[wiki-links]]`** — link notes by title; the corpus resolves them across the vault.
- **Backlinks** — every note shows what links *into* it.
- **Tags** — `#tag` lines feed a tag sidebar with counts.
- **Folders** — browse subfolders; create notes in the current folder.
- **Search** — full-text over titles and bodies, scoped to the vault.
- **Ignore** — hide individual files or whole folders from the corpus without deleting them.

Files are plain markdown on disk; the dashboard is just a viewer/editor over them.

---

## 🧩 MCP Ecosystem

Model Context Protocol servers give agents real capabilities without touching core code:

![MCP server panel: filesystem, fetch, shell, memory, SQLite, time, plasma, and more](docs/screenshots/mcp.png)

| Server | Capability |
|--------|-----------|
| **Filesystem** | Read, write, edit, search, manage files |
| **Fetch** | Retrieve web content |
| **Shell** | Execute commands in a live PTY |
| **Memory** | Persistent knowledge graph |
| **SQLite** | Query and manage databases |
| **Time** | Timezone-aware scheduling |
| **Plasma** | KDE Plasma D-Bus (notifications, clipboard, windows) |

MCP servers are configured in `data/mcp-servers.json` and can be toggled from the dashboard.

---

## 📡 Channels

One conversation, many doors. All channels merge into a single chat:

| Channel | How |
|---------|-----|
| 🌐 **Web Dashboard** | PWA at `http://localhost:3200` |
| ✈️ **Telegram** | Bot via grammy |
| 💚 **WhatsApp** | Baileys (no third-party API) |
| 💜 **Slack** | Bot integration |

Message from WhatsApp, continue on Telegram, check the dashboard — same context, same memory.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ with TypeScript |
| Database | SQLite via better-sqlite3 |
| Browser | Playwright (playwright-core) over CDP, driving your real Chrome — DOM interaction (navigate, click, type, read, screenshot, evaluate JS) |
| Desktop | xdotool + spectacle — coordinate input, screenshots |
| Terminal | Live PTY shell (tmux `warden-shell`) |
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

## 🚀 Quick Start

### What you need

Warden is an autonomous AI that runs on your own hardware. It can operate fully locally, fully in the cloud, or mixed. The minimal setup is a single Linux machine with a local Ollama instance.

| Component | Minimum | Recommended |
|---|---|---|
| OS | Linux (kernel 5+) | Arch Linux or Ubuntu LTS |
| Node.js | 20+ | 22 LTS |
| RAM | 8 GB | 16 GB+ (local models + browser tools) |
| GPU | Optional | NVIDIA GPU for local vision / TTS / security models |
| Browser | Chromium/Chrome | System Chromium for Playwright CDP tools |
| Microphone/speaker | Optional | USB or Bluetooth headset for voice |
| Webcam | Optional | For security / vision features |

### Step 1 — Get the repo

```bash
git clone <your-repo-url> warden
cd warden
```

All commands below assume you are inside the project root.

### Step 2 — Install system dependencies

On Arch Linux (the primary target):

```bash
bash install-deps.sh
```

This installs Node.js, npm, git, build tools, Chromium, poppler, tmux, sqlite, Radicale, KDE PIM integration, and desktop-control utilities (`xdotool`, `ydotool`, `wtype`, `grim`, clipboard tools, etc.). It also enables `loginctl linger` so user systemd services keep running after logout.

On other distros, install the equivalents manually. The key binaries Warden expects are:

- `node` and `npm`
- `chromium` or `google-chrome-stable`
- `poppler` (for `pdftotext`)
- `tmux`, `sqlite3`
- `xdotool`, `ydotool`, `wtype`, `grim`, `wl-clipboard`, `xclip`, `scrot`
- `radicale`, `akonadi`, `kdepim-runtime`, `kontact` (for calendar/contacts; optional)

macOS users can try `bash install-macos.sh` as a best-effort alternative. Some Linux-only tools will not be available.

### Step 3 — Run the installer

```bash
bash install.sh
```

`install.sh` is interactive and does the following:

1. Shows a safety warning and asks you to type `I UNDERSTAND` before continuing.
2. Verifies Node.js >= 20.
3. Offers to run `install-deps.sh` if it detects `pacman`.
4. Installs npm dependencies for the server and the agent-runner.
5. Compiles TypeScript with `npm run build`.
6. Creates runtime directories: `data/`, `store/`, `groups/`, `logs/`.
7. Initializes the SQLite database.
8. Writes a starter `data/env/env` config file if one does not exist.
9. Registers and starts a systemd user service: `~/.config/systemd/user/warden.service`.
10. Enables user linger so the service survives logout.

After it finishes, the dashboard is available at `http://localhost:3200`.

### Step 4 — Configure

Open `data/env/env` and set at least the assistant identity and Ollama endpoint:

```bash
ASSISTANT_NAME=Warden
ADMIN_PASSWORD=change-me-please
TZ=America/Vancouver
OLLAMA_URL=http://127.0.0.1:11434
```

If you want cloud models, set the appropriate keys later from the dashboard or env file. Channels (Telegram, Slack, WhatsApp) are optional — the dashboard works without them.

Restart the service after editing:

```bash
systemctl --user restart warden
```

### Step 5 — Verify

```bash
# Service status
systemctl --user status warden

# API health
curl -fsS http://localhost:3200/api/status

# Dashboard
open http://localhost:3200
```

Log in with the `ADMIN_PASSWORD` you set.

### Day-to-day control

```bash
# Start / stop / restart
systemctl --user start warden
systemctl --user kill warden     # fast stop
systemctl --user restart warden

# View logs
journalctl --user -u warden -f
tail -f logs/warden.log
```

### Running without systemd

For development or one-off tests, use `run.sh` from the project root:

```bash
./run.sh              # server + voice client + security camera
./run.sh --no-voice   # server + security camera only
./run.sh --no-security # server + voice client only
./run.sh --no-server  # voice client + security camera only
./run.sh --remote <satellite-host>  # use a Pi satellite for mic/speaker
```

`run.sh` is useful on a workstation where you want the full stack in one terminal. For a permanent install, prefer the systemd service.

---

## 🌐 Multi-Machine / Bare-Metal Role Configuration

Warden is split into roles that can run on different machines on the same LAN. By default everything assumes `localhost`, but you can point each role at another host by editing the right config.

| Role | What to set | Where |
|------|-------------|-------|
| **Warden** (brain/dashboard) | `WARDEN_URL` or `dockbox.base_url` | `data/env/env` for server; `voice/config/settings.yaml` for the voice client |
| **Video** (security detector) | Warden URL it POSTs awareness to | `security/config/settings.yaml` under `warden.base_url` |
| **Audio** (hologram) | Warden URL + Satellite URL | `voice/config/settings.yaml` under `dockbox.base_url`; `--remote <satellite-ip>` on launch |
| **Ollama** | `OLLAMA_URL` | `data/env/env` |
| **Satellite** (Pi audio relay) | Audio server IP | Pi TUI (`graice-tui.sh`) |

### Example: split across three machines

- **Warden** on a small box at `http://<warden-host>:3200`
- **Ollama** on a GPU box at `http://<ollama-host>:11434`
- **Video** on a laptop with a webcam
- **Audio** on the same laptop, using a Pi Satellite at `<satellite-host>`

Set on the **Warden host** (`data/env/env`):

```bash
OLLAMA_URL=http://<ollama-host>:11434
```

Set on the **Video host** (`security/config/settings.yaml`):

```yaml
warden:
  base_url: http://<warden-host>:3200
```

Set on the **Audio host** (`voice/config/settings.yaml`):

```yaml
dockbox:
  base_url: http://<warden-host>:3200
```

Then start Audio pointed at the Satellite:

```bash
./run.sh --remote <satellite-host>
```

On the Pi, run the Satellite relay (`satellite_server.py`) and set the audio server IP in `graice-tui.sh` to the laptop running Audio.

The dashboard has a **Servers** / **Satellite IP** field that sets where Warden pulls the security frame from. After the distributed-roles refactor, all of these URLs will live in one settings store and be editable from the dashboard itself.

---

## 🗣️ Voice Assistant

`voice/` is a voice-first desktop companion that turns Warden into a talk-to-it assistant. Press a button (or a global hotkey), speak, and the reply is spoken back. Speech-to-text (Whisper) and text-to-speech (Kokoro) run locally on your machine — your voice never leaves it. All reasoning, tools, and memory stay on the Warden server; the app is just ears, eyes, and a mouth.

- 🎤 Local STT (Whisper) + TTS (Kokoro) — your voice never leaves the machine.
- 👻 Hologram UI that reflects state (idle / listening / thinking / speaking).
- 📸 Vision: capture a photo, describe a scene, read text (OCR), find objects.
- ⌛ Timer: "take a break for 10 minutes".
- 🔗 Talks to your existing Warden session — no new login.

### Install the voice client

1. Create a Python virtual environment:

```bash
cd voice
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Copy the example config and edit it:

```bash
cp config/settings.example.yaml config/settings.yaml
```

Set at least:

```yaml
dockbox:
  base_url: http://localhost:3200

voice:
  sample_rate: 48000
  whisper_model: base
  tts_engine: kokoro
  tts_voice: am_michael
```

3. Run it:

```bash
python main.py
```

### Common flags

```bash
python main.py --remote <satellite-host>   # use a Pi/headless box for mic + speaker
```

### Troubleshooting audio

- If you see `Invalid sample rate`, try `48000` instead of `16000` in `settings.yaml`.
- Bluetooth HFP headsets often need the `pipewire` or `pulse` backend devices. Set explicit `audio.input_device` / `audio.playback_device` indices if auto-detection fails.
- The clap detector has its own sample rate (`clap_sample_rate`). Keep it at `48000` unless you know the mic supports the chosen rate.

See `voice/README.md` for more.

---

## 🛰️ Satellite (Pi audio relay)

`satellite/` is the Raspberry Pi side of the voice system — the ears and mouth that live on a dedicated Pi (or any small headless box). The Pi is **either** the Warden brain **or** a dumb mic/speaker (or both at once); the hologram UI (`voice/`) runs on your laptop. When the Pi is a mic/speaker it's a **dumb pipe**: it streams raw microphone audio to the hologram and plays back the TTS the Warden returns. No STT, no TTS, no model inference happens on the Pi in that role — transcription runs on the Warden side, so a Pi Zero is plenty.

### Pi files

| File | What it is |
|------|------------|
| `satellite_server.py` | HTTP audio relay (`:8766`). `GET /mic` streams 16 kHz PCM from the default mic; `POST /play` accepts a WAV body and plays it on the default speaker; `POST /cancel` stops playback (barge-in). |
| `voice-button.py` | GPIO hold-to-talk button (gpiozero, BCM pin 17 to GND). |
| `graice-tui.sh` | On-device settings menu: WiFi, Bluetooth, speaker/mic volume, mode selection, and start/stop. |
| `boot-defaults.sh` + `graice-boot-defaults.service` | Restores saved WiFi, Bluetooth, and default audio sink/source at boot. |
| `install-deps-pi.sh` | apt-based installer for Raspberry Pi OS. |

### Install on the Pi

1. Flash Raspberry Pi OS Lite or Desktop.
2. Clone or copy the repo.
3. Install system dependencies:

```bash
bash satellite/install-deps-pi.sh
```

4. If the Pi is also the Warden brain, run the main installer too:

```bash
bash install.sh
```

5. Configure the Pi from the TUI:

```bash
bash satellite/graice-tui.sh
```

Pick a **mode** and, if using the Pi as a satellite, set the **audio server IP** to the laptop running the voice client.

### Modes

| Mode | What the Pi runs | Button behaviour |
|---|---|---|
| **standalone** | Warden + button | Records here, sends to local Warden. |
| **satellite** | Audio relay + button | Streams mic to the laptop; laptop does STT/TTS. |
| **both** | Warden + audio relay + button | Same as satellite, but talks back to the Pi's own Warden. |

### Run the relay manually

```bash
cd satellite
python3 satellite_server.py
```

The relay binds `:8766` by default.

---

## 🛡️ Security Mode

`security/` is a webcam awareness system. The camera machine runs the cheap RF-DETR detector and sends only structured JSON events to the Warden service. One background agent handles the rest.

### Features

- 📷 **RF-DETR Keypoint** watches the webcam and builds a compact JSON situation each frame.
- 🔔 **AWARENESS events** are POSTed to `/api/awareness` only when something changes.
- 🛡️ **Sentry** receives the JSON, applies editable `security/sentry.md` rules, and decides: alert, greet, or stay silent.
- 🎛️ Sentry model and camera host are set from the dashboard.
- 🗄️ `store/security.db` logs every event and assessment.

### Install

1. Create a Python virtual environment:

```bash
cd security
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Copy and edit the config:

```bash
cp config/settings.example.yaml config/settings.yaml
```

Set at least:

```yaml
warden:
  base_url: http://localhost:3200

camera:
  index: 0
```

Use `camera.stream_url` instead of `index` if you want an ESP32-CAM or other HTTP/MJPEG stream.

3. Run it:

```bash
python main.py
```

Or start it via `run.sh` from the project root:

```bash
./run.sh --no-voice --no-server
```

### Dashboard setup

Open the dashboard, go to **Settings**, and set the **Video server** / **Satellite IP** to the host running `security/main.py`. Warden will pull frames from `http://<host>:8765/frame`.

See `security/README.md` for tuning, arming/disarming, and the Sentry rules.

---

## ⚙️ Configuration

### Environment file

The main config file is `data/env/env`. It is created by `install.sh` if it doesn't exist. Key variables:

```bash
# Identity
ASSISTANT_NAME=Warden
LOCAL_ASSISTANT_NAME=Kimi

# Server
STATUS_PORT=3200               # dashboard / API port
ADMIN_PASSWORD=warden          # dashboard login
TZ=America/Vancouver

# Ollama / models
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=llama3.2:latest
DEFAULT_MODEL_MODE=            # "local", "hybrid", or empty (Ollama only)
IDLE_TIMEOUT=14400000          # how long the warm agent-runner stays alive

# Optional channels
TELEGRAM_BOT_TOKEN=            # from @BotFather
SLACK_BOT_TOKEN=               # xoxb-...
SLACK_TEAM_ID=                 # T...

# Browser / desktop
BROWSER_BIN=/usr/bin/chromium
BROWSER_HEADLESS=false
```

Changes to `data/env/env` take effect on the next service restart:

```bash
systemctl --user restart warden
```

### Dashboard settings

Most runtime behavior is controlled from the dashboard at `http://localhost:3200`:

- **Models** — per-agent model selection: orchestrator, Atlas, Hephaestus, Sentry, council seats, etc.
- **Servers** — Ollama URL, Whisper URL, video server / Satellite IP, and (after the distributed-roles refactor) Audio/Warden/Video role URLs.
- **Heartbeat** — scheduled standing instructions.
- **Skills & MCP** — toggle capabilities and external tools.

Dashboard settings are stored in the router state and take effect immediately — no restart needed.

### Voice config

`voice/config/settings.yaml` holds STT/TTS parameters, audio devices, the Warden server URL (`dockbox.base_url`), and the Satellite port. Copy from `voice/config/settings.example.yaml` or run `python voice/setup.py` to generate it. This file is gitignored.

### Security config

`security/config/settings.yaml` controls the camera, detector model, awareness cooldown, face-ID settings, and the Warden URL the detector POSTs events to. Copy from `security/config/settings.example.yaml`.

---

## 🤔 Why Warden?

Most AI assistants live in the cloud. They see what you type, not what you see. They run on someone else's hardware, with someone else's model, under someone else's terms.

Warden runs on **your** machine. It uses **your** browser, **your** desktop, **your** files, **your** email. It works with local models through Ollama, so your data never leaves your hardware unless you choose to send it. And when you need more power, it reaches out to cloud models — all within the same conversation, with the same memory.

It is not a demo. It is a real assistant with browser automation, desktop control, voice, email, calendar, multi-channel messaging, a plugin ecosystem, an agent architecture that can reason about your work and audit its own decisions, and a prompt engineering surface that has been battle-tested across hundreds of hours of real use.

Warden stole fire from the gods. This one runs on your laptop.

---

## 📜 License

MIT — see [`LICENSE`](LICENSE) for the full text.