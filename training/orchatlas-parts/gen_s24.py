#!/usr/bin/env python3
# s24 — MCP servers and skills: install/uninstall_mcp_server, list_skills,
# activate_skill, deactivate_skill, create_skill. 25 hand-authored rows.
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, "_sys.txt")).read().rstrip()
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"

def user(ask):
    return {"role": "user", "content": ANCHOR + ask}

def asst(text):
    return {"role": "assistant", "content": text}

def call(cid, name, args, content=None):
    m = {"role": "assistant", "tool_calls": [{"id": cid, "type": "function",
        "function": {"name": name, "arguments": args}}]}
    if content is not None:
        m["content"] = content
    return m

def tool(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": content}

def row(msgs):
    return {"messages": [{"role": "system", "content": SYS}] + msgs}

def install_result(server_name):
    return ('{"ok":true,"message":"install_mcp_server request emitted to parent. '
            'The change takes effect next turn. Do NOT stop and ask the user what to do '
            'next — continue routing their original request. If they asked for a task '
            '(open a URL, play a video, edit a file, etc.), delegate to atlas NOW. The '
            'MCP install is a side effect, not a stopping point."}')

def uninstall_result(server_name):
    return ('{"ok":true,"message":"uninstall_mcp_server request emitted to parent. '
            'The change takes effect next turn. Do NOT stop and ask the user what to do '
            'next — continue routing their original request. If they asked for a task '
            '(open a URL, play a video, edit a file, etc.), delegate to atlas NOW. The '
            'MCP install is a side effect, not a stopping point."}')

def mcp_refusal(skill_name):
    return ('Error: the "%s" tools run inside a sub-agent, not here. Use your own tools '
            'for this, or hand it to the specialist that owns it (iris for email and '
            'scheduling, vulkan for code).' % skill_name)

def vulkan_started(vid):
    return ("Vulkan %s started (urgent — its result will interrupt you when ready) "
            "— the result will arrive in your inbox when it finishes." % vid)

LIST_SKILLS_BASE = ('You have access to these skills. Call activate_skill(name) to load '
    'a skill\'s tools into your context for this turn.\n\n'
    '- core: Always-on meta tools (activate/deactivate/list skills, install MCP, create skill) and basic file ops (read/write/list).\n'
    '- marm: MCP server marm (marm-memory http)\n'
    '- filesystem: MCP server filesystem (npx -y @modelcontextprotocol/server-filesystem /home/dominic/Warden)\n'
    '- weekly-report: Rebuild the Monday report from the week\'s task rows and mail it to the captain.')

LIST_SKILLS_WITH_MEMORY = ('You have access to these skills. Call activate_skill(name) to load '
    'a skill\'s tools into your context for this turn.\n\n'
    '- core: Always-on meta tools (activate/deactivate/list skills, install MCP, create skill) and basic file ops (read/write/list).\n'
    '- marm: MCP server marm (marm-memory http)\n'
    '- filesystem: MCP server filesystem (npx -y @modelcontextprotocol/server-filesystem /home/dominic/Warden)\n'
    '- memory: MCP server memory (npx -y @modelcontextprotocol/server-memory)\n'
    '- weekly-report: Rebuild the Monday report from the week\'s task rows and mail it to the captain.')

WEEKLY_REPORT_SKILLMD = (
    'Activated skill "weekly-report" — 0 tool(s) now visible: (none)\n\n'
    '--- SKILL INSTRUCTIONS for "weekly-report" (operator-authored — follow these now) ---\n\n'
    '1. Read /home/dominic/Warden/data/tasks/week.json for the week\'s completed and pending task rows.\n'
    '2. Summarize what closed and what is still open.\n'
    '3. Hand the summary to iris to mail to dom.doss@gmail.com, subject "Weekly report".'
)

rows = []

# ---- 1-3: plain installs, one command call, terse reply, no follow-up question ----

# 1. filesystem, DIRECT
rows.append(row([
    user("Add the filesystem mcp server so the crew can read my Warden folder."),
    call("call_1", "install_mcp_server", {"name": "filesystem", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/dominic/Warden"]}),
    tool("call_1", "install_mcp_server", install_result("filesystem")),
    asst("Filesystem server's registered — its tools land as a skill next turn, so the crew can read your Warden folder from then on."),
]))

# 2. sqlite, CASUAL
rows.append(row([
    user("install the sqlite mcp so you guys can poke at messages.db"),
    call("call_1", "install_mcp_server", {"name": "sqlite", "command": "uvx",
        "args": ["mcp-server-sqlite", "--db-path", "/opt/Warden/store/messages.db"]}),
    tool("call_1", "install_mcp_server", install_result("sqlite")),
    asst("Sqlite server's in — it'll show up as a skill next turn so the crew can query messages.db."),
]))

# 3. puppeteer, RAMBLING
rows.append(row([
    user("so I want you to be able to actually click around web pages for me, not just fetch text — can you hook up the puppeteer one, whatever that setup takes"),
    call("call_1", "install_mcp_server", {"name": "puppeteer", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"]}),
    tool("call_1", "install_mcp_server", install_result("puppeteer")),
    asst("Puppeteer's registered — its browser-control tools arrive as a skill next turn."),
]))

# ---- 4-5: install + do the rest of the ask with own hands, same turn ----

# 4. memory install + list Warden folder, DIRECT
rows.append(row([
    user("Install the memory mcp server, and while you're at it tell me what's in my Warden folder."),
    call("call_1", "install_mcp_server", {"name": "memory", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"]}),
    tool("call_1", "install_mcp_server", install_result("memory")),
    call("call_2", "Bash", {"command": "ls -1 /home/dominic/Warden"}),
    tool("call_2", "Bash", "council-verdicts\ndata\ndrafts\ngroups"),
    asst("Memory server's registered, tools arrive next turn. Your Warden folder has council-verdicts, data, drafts and groups in it."),
]))

# 5. time install + read top of warden.log, CASUAL
rows.append(row([
    user("hook up that time mcp thing so timezones stop being a mess, oh and can you check whats at the top of warden.log rn"),
    call("call_1", "install_mcp_server", {"name": "time", "command": "uvx",
        "args": ["mcp-server-time"]}),
    tool("call_1", "install_mcp_server", install_result("time")),
    call("call_2", "Bash", {"command": "head -n 5 /opt/Warden/logs/warden.log"}),
    tool("call_2", "Bash", "[2026-09-18T11:58:02] INFO orchestrator: heartbeat ok\n[2026-09-18T11:58:32] INFO chat: message received (dominic)\n[2026-09-18T11:59:02] INFO orchestrator: heartbeat ok"),
    asst("Time server's registered, ready next turn. Top of warden.log right now is just heartbeat and chat-received lines — nothing alarming."),
]))

# ---- 6-7: server needs a secret — ask, never invent ----

# 6. github, DIRECT, ends at the ask, no tool call
rows.append(row([
    user("Set up the github mcp server for me."),
    asst("I can wire that up, but the github server needs a personal access token — what token do you want it registered with?"),
]))

# 7. brave-search, CASUAL, list_skills check first, then the ask
rows.append(row([
    user("add the brave search mcp so you can look stuff up during outages"),
    call("call_1", "list_skills", {}),
    tool("call_1", "list_skills", LIST_SKILLS_BASE),
    asst("Not installed yet, and brave search needs an API key to run — what's the BRAVE_API_KEY you want it set up with? I'll register it once I have that."),
]))

# ---- 8-9: vague ask — clarify, don't guess the command ----

# 8. notion, DIRECT
rows.append(row([
    user("can you add that notion thing"),
    asst("Which Notion integration — I need the actual server command or package (and any token it needs) before I can register it."),
]))

# 9. weather, RAMBLING
rows.append(row([
    user("add something for the weather would ya, so you always kinda know whats going on outside without me having to ask every time"),
    asst("Do you want an MCP weather server wired in, or just an OpenWeather API key added under Keys — and if it's the server, what's the package or command for it?"),
]))

# ---- 10-11: uninstall flows ----

# 10. puppeteer, DIRECT
rows.append(row([
    user("Drop the puppeteer server, it keeps hanging."),
    call("call_1", "uninstall_mcp_server", {"name": "puppeteer"}),
    tool("call_1", "uninstall_mcp_server", uninstall_result("puppeteer")),
    asst("Puppeteer's out — takes effect next turn."),
]))

# 11. sqlite, CASUAL
rows.append(row([
    user("yeah go ahead and pull the sqlite mcp, not using it for anything"),
    call("call_1", "uninstall_mcp_server", {"name": "sqlite"}),
    tool("call_1", "uninstall_mcp_server", uninstall_result("sqlite")),
    asst("Sqlite server's gone — takes effect next turn."),
]))

# ---- 12-14: list_skills, several phrasings, short spoken answer ----

# 12. DIRECT
rows.append(row([
    user("what skills do you have"),
    call("call_1", "list_skills", {}),
    tool("call_1", "list_skills", LIST_SKILLS_BASE),
    asst("You've got the always-on core tools, marm for memory, a filesystem server for your Warden folder, and a weekly-report skill for the Monday rebuild."),
]))

# 13. CASUAL
rows.append(row([
    user("whats installed"),
    call("call_1", "list_skills", {}),
    tool("call_1", "list_skills", LIST_SKILLS_BASE),
    asst("Core tools, marm memory, the filesystem server, and your weekly-report skill — that's the full list right now."),
]))

# 14. RAMBLING
rows.append(row([
    user("do you have anything for my calendar, like something separate that keeps track of it"),
    call("call_1", "list_skills", {}),
    tool("call_1", "list_skills", LIST_SKILLS_BASE),
    asst("No calendar skill in that list — core, marm, filesystem and weekly-report is all that's installed. Calendar already runs through iris, no separate skill needed."),
]))

# ---- 15: activate_skill on a user skill, follow the returned instructions ----

rows.append(row([
    user("run the weekly report skill"),
    call("call_1", "activate_skill", {"name": "weekly-report"}),
    tool("call_1", "activate_skill", WEEKLY_REPORT_SKILLMD),
    call("call_2", "Read", {"file_path": "/home/dominic/Warden/data/tasks/week.json"}),
    tool("call_2", "Read", '{"closed": ["invoice chase", "fence quote reply", "permit follow-up"], "open": ["budget review prep", "landlord reply"]}'),
    call("call_3", "iris", {"task": "TASK: Email dom.doss@gmail.com subject \"Weekly report\" with body: 3 tasks closed (invoice chase, fence quote reply, permit follow-up), 2 still open (budget review prep, landlord reply)."}),
    tool("call_3", "iris", "Email sent to dom.doss@gmail.com — Subject: Weekly report."),
    asst("Weekly report's out — mailed to your inbox with 3 tasks closed and 2 still open."),
]))

# ---- 16-17: activate_skill on an MCP skill — refused, recover correctly ----

# 16. github, CASUAL — recover by handing to vulkan
rows.append(row([
    user("check my github notifications using that github skill you got"),
    call("call_1", "activate_skill", {"name": "github"}),
    tool("call_1", "activate_skill", mcp_refusal("github")),
    call("call_2", "vulkan", {"task": "TASK: Check my GitHub notifications using the installed github MCP server and report anything that needs my attention."}),
    tool("call_2", "vulkan", vulkan_started("h3qk")),
    asst("Github tools run through vulkan, not this skill directly — it's checking your notifications now and I'll report when it lands."),
]))

# 17. filesystem, DIRECT — recover with own tools, no specialist needed
rows.append(row([
    user("Use the filesystem skill to list what's in my Warden folder."),
    call("call_1", "activate_skill", {"name": "filesystem"}),
    tool("call_1", "activate_skill", mcp_refusal("filesystem")),
    call("call_2", "Bash", {"command": "ls -1 /home/dominic/Warden"}),
    tool("call_2", "Bash", "council-verdicts\ndata\ndrafts\ngroups"),
    asst("That skill's tools live in a sub-agent, not here, but I didn't need it — your Warden folder has council-verdicts, data, drafts and groups in it."),
]))

# ---- 18: activate_skill on a sub-agent name — call the delegate directly ----

rows.append(row([
    user("hey can you activate the vulkan skill or whatever and get it to tidy up my drafts folder, theres like ten stale files in there"),
    call("call_1", "activate_skill", {"name": "vulkan"}),
    tool("call_1", "activate_skill", 'Error: "vulkan" is a sub-agent, not a skill. Call the `vulkan` delegate tool directly with a {task} argument — no activation needed.'),
    call("call_2", "vulkan", {"task": "TASK: Clean up stale files in /home/dominic/Warden/drafts — remove anything clearly outdated and report what was removed."}),
    tool("call_2", "vulkan", vulkan_started("d4pk")),
    asst("Vulkan's not a skill, just a call — it's tidying the drafts folder now and I'll report back when it lands."),
]))

# ---- 19: typo'd skill name — error, list_skills, correct name, activate ----

rows.append(row([
    user("activate the wekly-report skill for me"),
    call("call_1", "activate_skill", {"name": "wekly-report"}),
    tool("call_1", "activate_skill", 'Error: no skill named "wekly-report". Call list_skills to see available skills.'),
    call("call_2", "list_skills", {}),
    tool("call_2", "list_skills", LIST_SKILLS_BASE),
    call("call_3", "activate_skill", {"name": "weekly-report"}),
    tool("call_3", "activate_skill", WEEKLY_REPORT_SKILLMD),
    asst("Right skill's 'weekly-report', not 'wekly-report' — it's activated now and ready to run the Monday rebuild."),
]))

# ---- 20: create_skill packaging a workflow just finished ----

rows.append(row([
    user("That invoice chase worked great — save it as a thing I can ask for every month."),
    call("call_1", "create_skill", {
        "name": "invoice-chase",
        "description": "Chase an overdue invoice by emailing the client a follow-up.",
        "when_to_use": "When an invoice is more than 7 days overdue and needs a follow-up email sent.",
        "steps": [
            {"tool": "mcp__marm__marm_smart_recall", "key_args": {"query": "overdue invoice <client>"}},
            {"tool": "iris", "key_args": {"task": "TASK: Email <client> a follow-up on invoice <number>, due <date>."}},
        ],
        "example_prompt": "Chase the overdue invoice for <client>.",
    }),
    tool("call_1", "create_skill", '{"ok":true,"message":"Skill created at /home/dominic/Warden/data/skills/invoice-chase/SKILL.md. It will appear in the skill index next turn.","path":"/home/dominic/Warden/data/skills/invoice-chase/SKILL.md"}'),
    asst("Saved as 'invoice-chase' — you can ask for it by name from now on and it'll run the same steps."),
]))

# ---- 21: create_skill rejected (bad name) — fix and call once more ----

rows.append(row([
    user("ok that thing where you sniff out overdue invoices and mail me a heads up before i chase them myself... save that too, call it 'Invoice Watch!!' or whatever"),
    call("call_1", "create_skill", {
        "name": "Invoice Watch!!",
        "description": "Flag overdue invoices and email the captain a heads-up before chasing.",
        "when_to_use": "When an invoice crosses its due date and the captain wants a heads-up before any chase email goes out.",
        "steps": [
            {"tool": "mcp__marm__marm_smart_recall", "key_args": {"query": "overdue invoice <client>"}},
            {"tool": "iris", "key_args": {"task": "TASK: Email dom.doss@gmail.com a heads-up that invoice <number> for <client> is overdue."}},
        ],
        "example_prompt": "Give me a heads-up on any overdue invoices.",
    }),
    tool("call_1", "create_skill", '{"ok":false,"error":"name must be alphanumeric with dashes (1-64 chars)"}'),
    call("call_2", "create_skill", {
        "name": "invoice-watch",
        "description": "Flag overdue invoices and email the captain a heads-up before chasing.",
        "when_to_use": "When an invoice crosses its due date and the captain wants a heads-up before any chase email goes out.",
        "steps": [
            {"tool": "mcp__marm__marm_smart_recall", "key_args": {"query": "overdue invoice <client>"}},
            {"tool": "iris", "key_args": {"task": "TASK: Email dom.doss@gmail.com a heads-up that invoice <number> for <client> is overdue."}},
        ],
        "example_prompt": "Give me a heads-up on any overdue invoices.",
    }),
    tool("call_2", "create_skill", '{"ok":true,"message":"Skill created at /home/dominic/Warden/data/skills/invoice-watch/SKILL.md. It will appear in the skill index next turn.","path":"/home/dominic/Warden/data/skills/invoice-watch/SKILL.md"}'),
    asst("'Invoice Watch!!' wasn't a valid name, so I saved it as 'invoice-watch' instead — same workflow, ready to call by that name."),
]))

# ---- 22: deactivate_skill ----

rows.append(row([
    user("turn off the weekly-report skill, don't need it active right now"),
    call("call_1", "deactivate_skill", {"name": "weekly-report"}),
    tool("call_1", "deactivate_skill", 'Deactivated skill "weekly-report". Its tools are no longer in your context.'),
    asst("Weekly-report's deactivated — off until you ask for it again."),
]))

# ---- 23-24: install on one turn, second user turn later shows the next-turn truth ----

# 23. memory install, then later list_skills shows it, DIRECT
rows.append(row([
    user("Install the memory mcp server so nothing important gets lost between chats."),
    call("call_1", "install_mcp_server", {"name": "memory", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"]}),
    tool("call_1", "install_mcp_server", install_result("memory")),
    asst("Memory server's registered — its tools arrive as a skill next turn."),
    user("what all do you have hooked up now"),
    call("call_2", "list_skills", {}),
    tool("call_2", "list_skills", LIST_SKILLS_WITH_MEMORY),
    asst("You've got core, marm, filesystem, memory and the weekly-report skill hooked up now — memory showed up right after last turn's install."),
]))

# 24. git install, then later delegate to vulkan to use it, CASUAL
rows.append(row([
    user("hook up the git mcp so you all can look at repo history without me pasting logs"),
    call("call_1", "install_mcp_server", {"name": "git", "command": "uvx",
        "args": ["mcp-server-git", "--repository", "/opt/Warden"]}),
    tool("call_1", "install_mcp_server", install_result("git")),
    asst("Git server's registered — ready as a skill next turn."),
    user("cool, have vulkan check the last 5 commits with that git thing and tell me what changed"),
    call("call_2", "vulkan", {"task": "TASK: Use the git MCP server to review the last 5 commits in /opt/Warden and summarize what changed."}),
    tool("call_2", "vulkan", vulkan_started("r5jg")),
    asst("Vulkan's pulling the last 5 commits through the git server now — I'll report the summary when it lands."),
]))

# ---- 25: plain install, RAMBLING ----

rows.append(row([
    user("y'know, i keep hearing about that thing that makes you reason through stuff step by step before answering the hard questions — can you get that hooked up"),
    call("call_1", "install_mcp_server", {"name": "sequential-thinking", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]}),
    tool("call_1", "install_mcp_server", install_result("sequential-thinking")),
    asst("Sequential-thinking server's registered — its tools land as a skill next turn."),
]))

assert len(rows) == 25, len(rows)
out = os.path.join(BASE, "s24-1.jsonl")
with open(out, "w") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print("wrote", out, len(rows), "rows")
