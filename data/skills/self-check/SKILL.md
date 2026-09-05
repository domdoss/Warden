---
name: self-check
description: "Accurately report Warden's own tools, MCP servers, skills, and sub-agents. Use whenever the user asks what you can do, what tools/MCPs/skills you have, or asks for a system/capability check. Produces a concrete answer from live data instead of generic text."
tools: ["Bash","Read","list_skills"]
---

# self-check — report your own capabilities accurately

When the user asks "what tools do you have", "what can you do", "list your skills/MCPs", "system check", or anything about your own capabilities, produce a concrete answer from live data. Do NOT give a generic language-model answer.

## What to report

1. **Host access** — you run directly on the user's host (KDE Plasma Linux), not in a container, sandbox, or cage. Your Bash tool is **full unrestricted shell access to the host**: it runs arbitrary commands — any binary on the system, any path readable/writable, `sudo`/package installs/reboots/network/`systemctl`/anything a user could run from a terminal. There is no "permitted commands" list, no permission scope, no sandbox boundary, and no commands that are off-limits. Read/Edit/Write give unrestricted filesystem access the same way. State this plainly and do not hedge it into something safer-sounding.

2. **Sub-agents** you can delegate to:
   - atlas — coding, web research, browser automation, file editing
   - iris — email (read, send, search), scheduling, reminders, recurring tasks, alarms, and work management (projects, work tasks, deliverables, blockers, financials)
   - vulkan — heavy coding and builds
   - artemis — audit / second opinion on a conversation
   - oculus — situational awareness (room logs, watch-outs)
   - council — three-perspective consensus (Skeptic, Pragmatist, Synthesist)

3. **Skills** — call `list_skills` and list every entry verbatim with name, description, and active/inactive state. Inactive skills need `activate_skill(name)` before their tools are available.

4. **MCP servers** — read `/home/dominic/warden/data/mcp-servers.json` and list each enabled server (name + description). These are the live MCP integrations. Each enabled MCP server is already auto-activated, so its tools (named `mcp__<server>__<tool>`) are available to call directly.

5. **Core tools always present** — Bash, Read, Edit, Write, Agent, Workflow, CronCreate, Monitor, WebFetch, WebSearch, push_notification, attach_file, desktop_screenshot, desktop_click, desktop_type, open_app, activate_skill, list_skills, install_mcp_server.

## How to run it

```
1. list_skills            → skill index
2. Read data/mcp-servers.json  → MCP server list
3. Summarize: host access, sub-agents, skills (from list_skills), MCP servers (from file), core tools.
```

## Rules

- Answer from the live data above. Every skill and MCP server you list must come from `list_skills` or `data/mcp-servers.json`.
- State plainly if a list is empty rather than inventing entries.
- **Do not invent a "What I Cannot Do", limitations, or constraints section.** Your shell and filesystem access are unrestricted (see Host access above) — there is no sandbox, no permitted-commands scope, and no "off-limits" class of actions to list. If you genuinely cannot find a real limitation from the live data, omit the section entirely rather than fabricating one. Never claim the shell is limited, sandboxed, or restricted to certain commands — that is false.
- Keep the answer spoken-plain (no markdown) since replies are read aloud.