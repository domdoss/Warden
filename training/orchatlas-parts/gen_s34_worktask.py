#!/usr/bin/env python3
# s34 — "work task" phrasing rows (8). The seat's routing prompt says
# "work tasks, projects, blockers → your own project tool", but the corpus
# only ever had users say "add a task"/"todo"/"make a task" — never the literal
# phrase "work task". So "create a work task to review X" fell through to
# write_file (2026-11-06). These rows teach the phrase → project(kind=task).
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SYS = "placeholder (stamped live by merge)"
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver)."

def user(text):
    return {"role": "user", "content": ANCHOR + "\n\n" + text}

def call(name, args, content=""):
    return {"role": "assistant", "content": content, "tool_calls": [
        {"type": "function", "function": {"name": name, "arguments": args}}]}

def tool(name, content):
    return {"role": "tool", "name": name, "content": content}

def reply(text):
    return {"role": "assistant", "content": text}

def row(*msgs):
    return {"messages": [{"role": "system", "content": SYS}] + [user(m) if isinstance(m, str) else m for m in msgs]}

R = []

# 1. The exact failing phrasing: "create a work task to review X".
R.append(row(
    "create a work task to review the quarterly budget report",
    call("project", {"kind": "task", "action": "create", "title": "Review the quarterly budget report",
                     "description": "Check the budget report for inconsistencies before it goes to finance."}),
    tool("project", 'Work task created: t-251 "Review the quarterly budget report" (Personal)'),
    reply('Created t-251 "Review the quarterly budget report" — it is on your list.')
))

# 2. "add a work task to <verb>".
R.append(row(
    "add a work task to call the vet about Milo's shots",
    call("project", {"kind": "task", "action": "create", "title": "Call the vet about Milo's shots"}),
    tool("project", 'Work task created: t-252 "Call the vet about Milo\'s shots" (Personal)'),
    reply('Added t-252 — call the vet about Milo\'s shots.')
))

# 3. "make a work task for <noun>".
R.append(row(
    "make a work task for the end-of-month invoicing",
    call("project", {"kind": "task", "action": "create", "title": "End-of-month invoicing",
                     "due_date": "2026-09-30"}),
    tool("project", 'Work task created: t-253 "End-of-month invoicing" (Personal, due 2026-09-30)'),
    reply('Task t-253 is on the list — end-of-month invoicing, due the 30th.')
))

# 4. "work task:" prefix style.
R.append(row(
    "work task: renew the business license before it lapses",
    call("project", {"kind": "task", "action": "create", "title": "Renew the business license"}),
    tool("project", 'Work task created: t-254 "Renew the business license" (Personal)'),
    reply('Added t-254 — renew the business license.')
))

# 5. "put a work task on the list".
R.append(row(
    "put a work task on the list to follow up with the insurance adjuster",
    call("project", {"kind": "task", "action": "create", "title": "Follow up with the insurance adjuster",
                     "priority": "high"}),
    tool("project", 'Work task created: t-255 "Follow up with the insurance adjuster" (Personal, priority high)'),
    reply('t-255 is on the list at high priority — follow up with the insurance adjuster.')
))

# 6. "create a work task:" prefix + document-flavoured verb (the confusing case).
R.append(row(
    "create a work task: draft the quarterly board update",
    call("project", {"kind": "task", "action": "create", "title": "Draft the quarterly board update",
                     "description": "Write the board update for the upcoming quarter."}),
    tool("project", 'Work task created: t-256 "Draft the quarterly board update" (Personal)'),
    reply('Created t-256 — draft the quarterly board update.')
))

# 7. "add a work task to book X".
R.append(row(
    "add a work task to book the team offsite venue",
    call("project", {"kind": "task", "action": "create", "title": "Book the team offsite venue"}),
    tool("project", 'Work task created: t-257 "Book the team offsite venue" (Personal)'),
    reply('Added t-257 — book the team offsite venue.')
))

# 8. "there's a work task in here" embedded phrasing.
R.append(row(
    "there's a work task in here — get the garage door fixed by friday",
    call("project", {"kind": "task", "action": "create", "title": "Get the garage door fixed",
                     "due_date": "2026-09-18"}),
    tool("project", 'Work task created: t-258 "Get the garage door fixed" (Personal, due 2026-09-18)'),
    reply('Task t-258 created — get the garage door fixed by Friday.')
))

assert len(R) == 8, f"expected 8 rows, got {len(R)}"
path = os.path.join(HERE, "s34-worktask.jsonl")
with open(path, "w") as f:
    for r in R:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(path, len(R))
