# Internal-machinery ground truth (for orchatlas row writers, 2026-09-18b)

Every string below is copied from the live runner / live MCP server. Tool
RESULTS in rows must use these shapes — never invent a result text, and never
invent a field a real result does not carry. Job ids are 4 chars of base36
(`a7f2`, `k91c`, `3bd8`), delegate job ids are `<agent>-<short>`.

## Delegating an audit — `artemis`

Call: `{"task": "<prose brief: the outcome + the facts it cannot guess>", "urgent": false}`
(`urgent` optional; omit it unless the user is waiting on the answer right now.)

Result, verbatim shape:

```
Artemis a7f2 started — the audit result will arrive in your inbox. (job id: artemis-a7f2)
```

With `urgent: true`:

```
Artemis a7f2 started (urgent — its result will interrupt you when ready) — the audit result will arrive in your inbox. (job id: artemis-a7f2)
```

Artemis reads `/opt/Warden/store/messages.db` read-only, `/opt/Warden/logs/warden.log`
and `warden.error.log`, plus Read/Grep/Glob. It NEVER changes anything. Its
audit text starts with `What was asked: <the ask in its own words>` and then the
findings, most important first.

Reach for artemis when the question is *why Warden did what it did*: a job that
stalled, a report that never came back, a task that says finished but is not, a
second opinion before something final, "did you get that right?".

DO NOT delegate what you can read yourself in one call: a running job's progress
is `list_running_agents`, what a job actually did is `agent_logs`, a finished
job's full output is `read_job_result`. Artemis is for diagnosis across the logs
and the database, not for a status line.

## The Council — `council`, `council_status`

Call: `{"task": "<the question, fully self-contained>", "max_rounds": 4}`
The seats see NO chat history — every fact the question needs goes in `task`.
`max_rounds` is optional (default 4, capped 15).

Convene result, verbatim:

```
The Council is now deliberating in the background on this question. Reply with ONE short line saying the Council has it, then end your turn — do not answer the question yourself and do not promise a summary. The final verdict will be delivered to the user automatically when The Council completes (a few minutes — they argue up to 15 rounds before converging). If the user asks about its progress in the meantime, call council_status.
```

Already running:

```
The Council is already deliberating on: "<first 150 chars of the other task>" (round 2 of 4). Only one deliberation runs at a time — use council_status to check its progress, or wait for its verdict before convening a new one.
```

Missing task: `Error: task is required`

`council_status` takes no arguments. Mid-deliberation, no round finished yet:

```
**The Council — question:** <task>

**Status:** Still deliberating — round 1 of 4 in progress, 47s elapsed.

(no completed rounds yet — the seats are still writing their first answers)
```

With completed rounds (each round block is `### Round N` then the three seats):

```
**The Council — question:** <task>

**Status:** Still deliberating — round 2 of 4 in progress, 118s elapsed.

### Round 1

**Skeptic:**
<2-5 lines>

**Pragmatist:**
<2-5 lines>

**Synthesist:**
<2-5 lines>
```

Finished:

```
**The Council — question:** <task>

**Status:** Finished after 214s (3 round(s)) — consensus reached. The verdict was already delivered to the user; full trace saved to /home/dominic/Warden/council-verdicts/should-we-move-the-db-1758224701.md.
```

Never convened this session (either tool):

```
No Council has been convened this session — nothing to report.
```

Use the Council for a costly, hard-to-reverse call where one answer is not
enough. Not for facts, not for anything you can check yourself, and not as a
way to avoid doing the work.

## Background copy of yourself — `atlas_background`

Call: `{"task": "<the outcome + the facts it cannot guess>", "urgent": false}`

Result:

```
Atlas k91c started — running. Result arrives in your inbox. Reply: running, result on the way. End your turn.
```

Duplicate / queued variants:

```
Atlas is already running this exact task as atlas-k91c — its result will arrive in your inbox. Do not dispatch it again.
Atlas 3bd8 is already running this task (started 62s ago). Result arrives when it finishes. Reply: still working. End your turn. To change it, stop_agent("atlas-3bd8") first.
Accepted and QUEUED — atlas-3bd8 is still working on the same file(s), so this one starts when that finishes. It has no job id of its own yet. Its result will arrive in your inbox. Do not re-dispatch it, and do not treat atlas-3bd8's result as this task's result.
```

## Security scan — `sentry`

Call: `{"task": "peek scan of the machine", "urgent": false}` (the task names the
mode: peek = network + services, deep = adds autostart, crontab, user units,
shell rc files, process audit).

Result:

```
Sentry b48e started — running. Result arrives in your inbox. Reply: running, result on the way. End your turn.
```

## Job supervision — verbatim result shapes

```
list_running_agents (none)  → "No background jobs currently running."
list_running_agents (one)   → "Running background jobs (1):\n- k91c (job id: atlas-k91c): 252s elapsed, 18 tool call(s), last action 12s ago: Write(/home/dominic/Warden/groups/dominic/report.md) | task: \"rebuild the weekly report\""
stop_agent                  → "Stop signal sent to atlas-k91c. It will return its partial result on the next iteration check."
stop_agent (unknown id)     → "Error: no running job with id \"atlas-zzzz\". Call list_running_agents for the current list."
nudge_agent                 → "Steering message queued for atlas-k91c. It will see this on its next turn: \"<your message>\". The job keeps running. (Orchestrator nudge #1; the runner never auto-stops on a nudge count — call stop_agent yourself when you decide the job is not recovering.)"
agent_logs                  → "Step-by-step activity (3 call(s)):\n[1] +0s Read(/opt/Warden/src/db.ts) → 412 lines\n[2] +7s Grep(migrateToDesktopSchema) → 3 matches\n[3] +21s Write(/home/dominic/Warden/groups/dominic/report.md) → wrote 2.1 KB"
read_job_result (no id)     → "Stored job results:\n- artemis-a7f2 (artemis, finished 34s ago) task: \"audit the stalled report job\" → result preview: What was asked: why the Monday report job never reported back. 1. atlas-3bd8 exited at 11:52..."
read_job_result (id)        → "artemis-a7f2 (artemis, done) — task: \"audit the stalled report job\"\n\n<the full audit text>"
read_job_result (unknown)   → "No stored result for \"atlas-zzzz\". Results live for this runner session only — use read_job_result with no arguments to list what is available."
report_task_failure         → "Noted — this task\'s failure is on record. You may delegate it once more, and only with a corrected approach that addresses the reason: <reason>"
```

## MCP servers — `install_mcp_server`, `uninstall_mcp_server`

Call: `{"name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/dominic/Warden"]}`
(`env` only when the server needs a variable, e.g. `{"GITHUB_TOKEN": "..."}` —
never invent a real token; the user supplies it, and if it is missing you ask
for it instead of guessing.)

Result for BOTH install and uninstall (verbatim, `<tool>` is the tool name):

```
{"ok":true,"message":"install_mcp_server request emitted to parent. The change takes effect next turn. Do NOT stop and ask the user what to do next — continue routing their original request. If they asked for a task (open a URL, play a video, edit a file, etc.), delegate to atlas NOW. The MCP install is a side effect, not a stopping point."}
```

```
{"ok":true,"message":"uninstall_mcp_server request emitted to parent. The change takes effect next turn. Do NOT stop and ask the user what to do next — continue routing their original request. If they asked for a task (open a URL, play a video, edit a file, etc.), delegate to atlas NOW. The MCP install is a side effect, not a stopping point."}
```

The truths a row must respect:

- The config file is `data/mcp-servers.json`; the parent writes it. The server's
  tools do NOT exist this turn — they arrive as a skill on the NEXT turn. Say
  that plainly; never call a tool the install just registered.
- "delegate to atlas NOW" in that result is stale text from the two-seat era —
  atlas IS this seat. Do the rest of the user's ask with your own tools; never
  stop and ask what to do next.
- An MCP server's tools run inside the sub-agents, not in this chat seat.
  `activate_skill` on an MCP skill from here is refused:
  `Error: the "github" tools run inside a sub-agent, not here. Use your own tools for this, or hand it to the specialist that owns it (iris for email and scheduling, vulkan for code).`
- If the user names a server you cannot place (no command, no package), ask for
  the command instead of inventing one.

## Skills — `list_skills`, `activate_skill`, `deactivate_skill`, `create_skill`

`list_skills` takes no arguments and returns the index:

```
You have access to these skills. Call activate_skill(name) to load a skill's tools into your context for this turn.

- core: Always-on meta tools (activate/deactivate/list skills, install MCP, create skill) and basic file ops (read/write/list).
- marm: MCP server marm (marm-memory http)
- filesystem: MCP server filesystem (npx -y @modelcontextprotocol/server-filesystem /home/dominic/Warden)
- weekly-report: Rebuild the Monday report from the week's task rows and mail it to the captain.
```

`activate_skill` on a user skill:

```
Activated skill "weekly-report" — 0 tool(s) now visible: (none)

--- SKILL INSTRUCTIONS for "weekly-report" (operator-authored — follow these now) ---

<the SKILL.md body>
```

Errors:

```
Error: no skill named "gihub". Call list_skills to see available skills.
Error: "vulkan" is a sub-agent, not a skill. Call the `vulkan` delegate tool directly with a {task} argument — no activation needed.
```

`deactivate_skill` → `Deactivated skill "weekly-report". Its tools are no longer in your context.`

`create_skill` packages a workflow the user just finished with you. Prefer the
structured fields (`when_to_use`, `parameters`, `steps`, `example_prompt`) over
a prose `instructions` blob. Result:

```
{"ok":true,"message":"Skill created at /home/dominic/Warden/data/skills/weekly-report/SKILL.md. It will appear in the skill index next turn.","path":"/home/dominic/Warden/data/skills/weekly-report/SKILL.md"}
```

Failure:

```
{"ok":false,"error":"name must be alphanumeric with dashes (1-64 chars)"}
```

## APIs — `list_api_keys`, `api_request`

`list_api_keys` takes no arguments:

```
Configured API keys:
- Warden (internal, no key needed) (key_type: "warden") — http://localhost:3200
- OpenWeather (key_type: "openweather") — https://api.openweathermap.org
```

None configured:

```
No API keys configured. The user can add keys in the Keys tab of their dashboard.
```

`api_request` call: `{"key_type": "warden", "method": "POST", "path": "/api/summaries", "body": "{\"text\":\"...\"}", "description": "file the digest"}`
`key_type: "warden"` is Warden's own API on localhost:3200 and needs no key.
Result is the API's response body (JSON text), or an error line:

```
{"ok":true,"id":412}
Error: 401 Unauthorized — the stored openweather key was rejected.
```

## Memory — `mcp__marm__marm_smart_recall`, `mcp__marm__marm_log_entry`

Both names carry the `mcp__marm__` prefix. The bare `marm_smart_recall` is an
"Unknown tool" error — that is a real 2026-09-18 failure, five calls in a row.

`marm_log_entry` call: `{"entry": "Warden's dashboard is served on port 3200 by warden.service (user unit)."}`
Result:

```
{"status": "success", "message": "📝 Log entry added: 2026-09-18-warden-dashboard-port", "entry_id": 412, "memory_id": 1187}
```

Log a durable fact you established — a confirmed path, a root cause, a decision
the user made. Not chatter, not a task status.

## Chat / context / fabric

```
attach_file {"path": "/home/dominic/Warden/groups/dominic/report.pdf"} → "File attached: /home/dominic/Warden/groups/dominic/report.pdf"
attach_file (missing)                                                 → "Error: file not found at /home/dominic/Warden/nope.pdf"
clear_context {"reason": "starting fresh on the invoice work"}         → "Context cleared: starting fresh on the invoice work. Continuing with fresh conversation."
fabric_pattern {"name": "summarize", "input": "<text>"}               → "[Fabric pattern: summarize]\n\n<the pattern output>"
fabric_pattern (typo name)                                            → "Error: pattern \"summarise\" not found. Did you mean: summarize, summarize_debate?"
```

## Inbox delivery — a finished background job coming back

A landed job arrives as a USER-role turn (it carries the time anchor first) in
the REAL digest shape. Use this block verbatim, filling in the job:

```
Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).

REPORT-BACK TURN — jobs below are FINISHED. Report each result.

[Inbox] 1 background job result completed:

- artemis-a7f2 (artemis, done) — task: "audit why the Monday report job never reported back"
Result:
What was asked: why the Monday report job never came back.
1. atlas-3bd8 exited at 11:52 with no result written — warden.log shows a 300s Ollama abort mid-Write, so the job died before its report line.
2. The scheduled_tasks row still reads running; nothing retried it.

For each result, run the CONFIRM step before anything else: compare it against what the user originally asked for — that ask is in your context.
1. CONFIRMED — deliverable present and right. Media or window the user can already see or hear: stay silent. Else relay in one or two sentences.
2. PROVEN-FAILED — the result itself shows the deliverable is wrong or missing (the path it claims to have written doesn't match the request, the answer contradicts the ask, the job errored or was aborted), OR the supervisor verdict above is FAILED. Call report_task_failure with the task and the reason, then re-delegate ONCE to the right specialist, naming the GAP — what was wanted versus what came back — never the fix. If the runner refuses the re-delegation, that refusal is final: tell the user plainly what failed and why, and stop.
3. UNVERIFIABLE FROM TEXT — whether it worked depends on screen or system state you cannot see from this result and the result names a concrete outcome. Trust it and move on.
CHAIN: if a result is one step of a larger request, take the next step yourself now — without waiting for the user. Stop only when the whole task is done or you are genuinely blocked. Do not paste raw output verbatim; speak the outcome.
FORMAT: the reply is chat to the captain, not a report. One or two plain sentences per result, carrying the outcome itself. No headers, no bullets, no restating the ask or the job id, no verdict words, no next-steps offers.
```

Shorter variants already used elsewhere in this dataset (`[inbox] Vulkan q8vb
finished.` followed by the result text) are fine for a second or third inbox row
in a file — vary them, but the full block above must be the common case.

Your reply to an inbox turn is one or two plain sentences carrying the outcome —
never the digest block, never a header, never a list unless the user asked for
one.
