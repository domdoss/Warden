#!/usr/bin/env python3
# s19 — tasks + calendar personal-organization rows (100 total, 25 per file)
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(HERE, "_sys.txt")).read()
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver)."

def user(text):
    return {"role": "user", "content": ANCHOR + "\n\n" + text}

def call(name, args, content=""):
    return {"role": "assistant", "content": content, "tool_calls": [
        {"type": "function", "function": {"name": name, "arguments": args}}]}

def calls(*pairs, content=""):
    return {"role": "assistant", "content": content, "tool_calls": [
        {"type": "function", "function": {"name": n, "arguments": a}} for n, a in pairs]}

def tool(name, content):
    return {"role": "tool", "name": name, "content": content}

def reply(text):
    return {"role": "assistant", "content": text}

def row(*msgs):
    return {"messages": [{"role": "system", "content": SYS}] + [user(m) if isinstance(m, str) else m for m in msgs]}

R = []

# ---------------- TASK CREATES (20) ----------------

R.append(row(
    "Add a task: call the roofer about the leak, high priority, due next Friday.",
    call("project", {"kind": "task", "action": "create", "title": "Call the roofer about the leak", "priority": "high", "due_date": "2026-09-25"}),
    tool("project", 'Task created: t-217 "Call the roofer about the leak" (due 2026-09-25, priority high)'),
    reply('Done — task t-217 "Call the roofer about the leak" is on your list, high priority, due 2026-09-25.')
))

R.append(row(
    "put book a plumber on my list plz",
    call("project", {"kind": "task", "action": "create", "title": "Book a plumber"}),
    tool("project", 'Task created: t-218 "Book a plumber" (Personal)'),
    reply('Added — t-218 "Book a plumber" is on the list.')
))

R.append(row(
    "Add a task: renew the passport. Due October 15th.",
    call("project", {"kind": "task", "action": "create", "title": "Renew passport", "due_date": "2026-10-15"}),
    tool("project", 'Task created: t-220 "Renew passport" (due 2026-10-15)'),
    reply('Task t-220 "Renew passport" created, due October 15th.')
))

R.append(row(
    "todo: cancel the newspaper subscription. been meaning to for weeks",
    call("project", {"kind": "task", "action": "create", "title": "Cancel the newspaper subscription"}),
    tool("project", 'Task created: t-219 "Cancel the newspaper subscription" (Personal)'),
    reply("On the list — t-219, cancel the newspaper subscription.")
))

R.append(row(
    "make tasks for the car stuff: new wiper blades, order new contacts, book the car service",
    calls(
        ("project", {"kind": "task", "action": "create", "title": "New wiper blades"}),
        ("project", {"kind": "task", "action": "create", "title": "Order new contacts"}),
        ("project", {"kind": "task", "action": "create", "title": "Book the car service"}),
    ),
    tool("project", 'Task created: t-242 "New wiper blades" (Personal)'),
    tool("project", 'Task created: t-229 "Order new contacts" (Personal)'),
    tool("project", 'Task created: t-230 "Book the car service" (Personal)'),
    reply("Three tasks created for the car stuff: t-242 wiper blades, t-229 contacts, t-230 car service.")
))

R.append(row(
    "I keep meaning to look at standing desks — Dana mentioned a couple of brands and I want to compare them against the IKEA one before I pull the trigger. can you add that as a task?",
    call("project", {"kind": "task", "action": "create", "title": "Research standing desks", "description": "Compare the brands Dana recommended against the IKEA option."}),
    tool("project", 'Task created: t-224 "Research standing desks" (Personal)'),
    reply('Added — t-224 "Research standing desks", with Dana\'s brands vs the IKEA one noted in the description.')
))

R.append(row(
    "the insurance claim is still sitting there from the accident in july and honestly it's keeping me up at night. get it on the list, and it's high priority",
    call("project", {"kind": "task", "action": "create", "title": "Chase the insurance claim", "priority": "high"}),
    tool("project", 'Task created: t-221 "Chase the insurance claim" (priority high)'),
    reply('Done — t-221 "Chase the insurance claim" is on the list at high priority. I hope it stops keeping you up.')
))

R.append(row(
    "Add a task: pick up the dry cleaning, due tomorrow.",
    call("project", {"kind": "task", "action": "create", "title": "Pick up dry cleaning", "due_date": "2026-09-19"}),
    tool("project", 'Task created: t-222 "Pick up dry cleaning" (due 2026-09-19)'),
    reply("Task t-222 created — pick up the dry cleaning, due tomorrow, the 19th.")
))

R.append(row(
    "todo: draft the letter to the HOA, due monday",
    call("project", {"kind": "task", "action": "create", "title": "Draft HOA letter", "due_date": "2026-09-21"}),
    tool("project", 'Task created: t-223 "Draft HOA letter" (due 2026-09-21)'),
    reply("Added — t-223 draft the HOA letter, due Monday the 21st.")
))

R.append(row(
    "read my q3 notes and make tasks for the open items",
    call("Read", {"file_path": "/home/dominic/Warden/q3-notes.md"}, content="Plan: read the notes → make a task per open item."),
    tool("Read", "Q3 notes — 2026-09-18\n\nClosed this quarter:\n- Vendor audit done\n- Onboarding docs updated\n\nOpen items:\n1. Book the Q3 retro with Dana (target: before Sept 26)\n2. Submit the expense report (~$310, needs the Portland trip receipts)\n3. Renew the business license (expires Oct 2)"),
    calls(
        ("project", {"kind": "task", "action": "create", "title": "Book the Q3 retro with Dana", "due_date": "2026-09-26"}),
        ("project", {"kind": "task", "action": "create", "title": "Submit the expense report", "description": "About $310, needs the Portland trip receipts."}),
        ("project", {"kind": "task", "action": "create", "title": "Renew the business license", "due_date": "2026-10-02"}),
    ),
    tool("project", 'Task created: t-233 "Book the Q3 retro with Dana" (due 2026-09-26)'),
    tool("project", 'Task created: t-234 "Submit the expense report" (Personal)'),
    tool("project", 'Task created: t-235 "Renew the business license" (due 2026-10-02)'),
    reply("Your notes had three open items, all created: t-233 book the Q3 retro with Dana (due Sept 26), t-234 submit the expense report, and t-235 renew the business license (due Oct 2).")
))

R.append(row(
    "there's a home maintenance list somewhere in my notes — find it and make a task for the gutter cleaning",
    call("Glob", {"pattern": "**/*maintenance*", "path": "/home/dominic/Warden"}, content="Plan: find the maintenance list → read it → task for the gutters."),
    tool("Glob", "1 match: /home/dominic/Warden/notes/home-maintenance.md"),
    call("Read", {"file_path": "/home/dominic/Warden/notes/home-maintenance.md"}),
    tool("Read", "Home maintenance\n\n- Clean the gutters (before the autumn rains — aim for October)\n- Furnace cleaning (annual, before winter)\n- Test sump pump (done Sept 2026)"),
    call("project", {"kind": "task", "action": "create", "title": "Clean the gutters", "description": "Before the autumn rains — the notes say aim for October.", "due_date": "2026-10-01"}),
    tool("project", 'Task created: t-246 "Clean the gutters" (due 2026-10-01)'),
    reply('Found the list in notes/home-maintenance.md. Created t-246 "Clean the gutters", due October 1st so it beats the autumn rains.')
))

R.append(row(
    "Add a task: order mom's birthday gift, due the 25th, medium priority.",
    call("project", {"kind": "task", "action": "create", "title": "Order mom's birthday gift", "priority": "medium", "due_date": "2026-09-25"}),
    tool("project", 'Task created: t-241 "Order mom\'s birthday gift" (due 2026-09-25, priority medium)'),
    reply("Task t-241 created — order mom's birthday gift, due the 25th, medium priority.")
))

R.append(row(
    "before winter I really need to get the furnace cleaned, like sometime this month. make it a thing",
    call("project", {"kind": "task", "action": "create", "title": "Schedule furnace cleaning", "due_date": "2026-09-30"}),
    tool("project", 'Task created: t-240 "Schedule furnace cleaning" (due 2026-09-30)'),
    reply("Made it a thing — t-240 schedule the furnace cleaning, due September 30th so it happens before winter.")
))

R.append(row(
    "Create a task: back up the laptop to the external drive.",
    call("project", {"kind": "task", "action": "create", "title": "Back up the laptop", "description": "Back up to the external drive."}),
    tool("project", 'Task created: t-226 "Back up the laptop" (Personal)'),
    reply("Task t-226 created — back up the laptop to the external drive.")
))

R.append(row(
    "add a task under the kitchen reno project: confirm the cabinet paint color with Mike",
    call("project", {"kind": "task", "action": "create", "title": "Confirm cabinet paint color with Mike", "project_id": "p-12"}),
    tool("project", 'Task created: t-227 "Confirm cabinet paint color with Mike" (project p-12)'),
    reply("Added under the kitchen reno project — t-227 confirm the cabinet paint color with Mike.")
))

R.append(row(
    "new task, water the plants this weekend",
    call("project", {"kind": "task", "action": "create", "title": "Water the plants", "due_date": "2026-09-20"}),
    tool("project", 'Task created: t-228 "Water the plants" (due 2026-09-20)'),
    reply("Created — t-228 water the plants, due Sunday the 20th.")
))

R.append(row(
    "Add a task: pay the property tax, due November 3rd, high priority.",
    call("project", {"kind": "task", "action": "create", "title": "Pay property tax", "priority": "high", "due_date": "2026-11-03"}),
    tool("project", 'Task created: t-225 "Pay property tax" (due 2026-11-03, priority high)'),
    reply("Task t-225 created — pay the property tax, high priority, due November 3rd.")
))

R.append(row(
    "before I forget: the mulch for the beds — eight bags of black cedar — and the hall lightbulbs are a whole thing. two tasks",
    calls(
        ("project", {"kind": "task", "action": "create", "title": "Order mulch", "notes": "8 bags of black cedar."}),
        ("project", {"kind": "task", "action": "create", "title": "Replace hallway lightbulbs"}),
    ),
    tool("project", 'Task created: t-231 "Order mulch" (Personal)'),
    tool("project", 'Task created: t-247 "Replace hallway lightbulbs" (Personal)'),
    reply('Two tasks: t-231 order the mulch — noted 8 bags of black cedar — and t-247 sort out the hallway lightbulbs.')
))

R.append(row(
    "make a task out of what we were just talking about, the driveway sealing quote",
    call("get_chat_history", {"limit": 6}, content="Plan: check what we just discussed → make the task."),
    tool("get_chat_history", "Recent turns:\nUser: Sealcote finally sent the driveway sealing quote — 840 bucks\nAssistant: Got it — $840 for the driveway sealing from Sealcote. Want me to hold it while you decide?\nUser: yeah let me sit on it"),
    call("project", {"kind": "task", "action": "create", "title": "Call Sealcote about the driveway sealing quote", "notes": "Quote received: $840."}),
    tool("project", 'Task created: t-232 "Call Sealcote about the driveway sealing quote" (Personal)'),
    reply('Created t-232 "Call Sealcote about the driveway sealing quote", with the $840 quote noted.')
))

R.append(row(
    "Make me a task: replace the smoke detector batteries — the hallway one and the one outside the bedrooms",
    call("project", {"kind": "task", "action": "create", "title": "Replace smoke detector batteries", "description": "The one in the hallway and the one outside the bedrooms."}),
    tool("project", 'Task created: t-248 "Replace smoke detector batteries" (Personal)'),
    reply("Task t-248 created — replace the smoke detector batteries in the hallway and outside the bedrooms.")
))

# ---------------- TASK MANAGEMENT (15) ----------------

TASKLIST_SHORT = (
    "t-217 | open | Call the roofer about the leak | due 2026-09-25 | high\n"
    "t-218 | open | Book a plumber | \n"
    "t-220 | open | Renew passport | due 2026-10-15\n"
    "t-221 | open | Chase the insurance claim | \n"
    "t-222 | open | Pick up dry cleaning | due 2026-09-19\n"
    "t-223 | open | Draft HOA letter | due 2026-09-21\n"
    "t-225 | open | Pay property tax | due 2026-11-03 | high"
)

R.append(row(
    "list my tasks",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    reply("You have 7 open tasks. The two high-priority ones are the roofer leak call (due the 25th) and property tax (due Nov 3); the rest run from dry cleaning tomorrow through the passport renewal in October.")
))

R.append(row(
    "what's even on my list rn",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    reply("Seven things open: roofer leak call (high, due the 25th), book a plumber, renew passport, chase the insurance claim, dry cleaning tomorrow, HOA letter Monday, and property tax (high, Nov 3).")
))

R.append(row(
    "mark the roofer one done",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    call("project", {"kind": "task", "action": "update", "id": "t-217", "status": "completed"}),
    tool("project", "Task t-217 updated (status=completed)."),
    reply('The roofer call was t-217 — marked done. Six open tasks left.')
))

R.append(row(
    "task t-224, the standing desk one — mark it done, I ordered one",
    call("project", {"kind": "task", "action": "update", "id": "t-224", "status": "completed"}),
    tool("project", "Task t-224 updated (status=completed)."),
    reply('Done — t-224 "Research standing desks" is checked off. Enjoy the new desk.')
))

R.append(row(
    "scratch the plumber task, mike's guy does plumbing too",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    call("project", {"kind": "task", "action": "delete", "id": "t-218"}),
    tool("project", "Task t-218 deleted."),
    reply('Deleted t-218 "Book a plumber" — Mike\'s guy can take that one.')
))

R.append(row(
    "bump the insurance claim task up to high priority",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    call("project", {"kind": "task", "action": "update", "id": "t-221", "priority": "high"}),
    tool("project", "Task t-221 updated (priority=high)."),
    reply('Found it — t-221 "Chase the insurance claim" is now high priority.')
))

R.append(row(
    "I never got to the dry cleaning. push it to monday",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    call("project", {"kind": "task", "action": "update", "id": "t-222", "due_date": "2026-09-21"}),
    tool("project", "Task t-222 updated (due_date=2026-09-21)."),
    reply("Moved it — the dry cleaning task t-222 now sits on Monday the 21st.")
))

R.append(row(
    "what's overdue on my list?",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", "t-217 | open | Call the roofer about the leak | due 2026-09-25 | high\n"
        "t-222 | open | Pick up dry cleaning | due 2026-09-19\n"
        "t-223 | open | Draft HOA letter | due 2026-09-21\n"
        "t-244 | open | Renew library card | due 2026-09-15\n"
        "t-249 | open | Return the drill to Steve | due 2026-09-11"),
    reply("Two overdue: renew the library card (t-244, due the 15th) and return Steve's drill (t-249, due the 11th). Nothing else is late.")
))

R.append(row(
    "delete task t-219, I already cancelled the paper",
    call("project", {"kind": "task", "action": "delete", "id": "t-219"}),
    tool("project", "Task t-219 deleted."),
    reply('Deleted t-219 "Cancel the newspaper subscription" — one less thing.')
))

R.append(row(
    "what tasks are under the kitchen reno project?",
    call("project", {"kind": "project", "action": "get", "id": "p-12"}),
    tool("project", 'Project p-12 "Kitchen reno" — status: active, due 2026-10-31\n'
        'Tasks:\n'
        't-227 | open | Confirm cabinet paint color with Mike\n'
        'Deliverables:\n'
        'd-34 | open | Cabinets installed | due 2026-10-10\n'
        'd-35 | open | Countertops templated | due 2026-10-03\n'
        'Blockers:\n'
        'b-10 | high | Countertop supplier two weeks late'),
    reply("One task under the kitchen reno: t-227 confirm the cabinet paint color with Mike. The project also has two open deliverables and one high-severity blocker — the countertop supplier running two weeks late.")
))

R.append(row(
    "cross off renew library card, I did it yesterday",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", "t-217 | open | Call the roofer about the leak | due 2026-09-25 | high\n"
        "t-244 | open | Renew library card | due 2026-09-15\n"
        "t-249 | open | Return the drill to Steve | due 2026-09-11"),
    call("project", {"kind": "task", "action": "update", "id": "t-244", "status": "completed"}),
    tool("project", "Task t-244 updated (status=completed)."),
    reply("Checked off — t-244 renew library card. Steve's drill is still outstanding, due the 11th.")
))

R.append(row(
    "change the passport task due date to the 20th",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    call("project", {"kind": "task", "action": "update", "id": "t-220", "due_date": "2026-09-20"}),
    tool("project", "Task t-220 updated (due_date=2026-09-20)."),
    reply("Done — the passport renewal t-220 is now due Saturday the 20th.")
))

R.append(row(
    "how many open tasks do I have right now?",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", TASKLIST_SHORT),
    reply("Seven open: two high (roofer leak, property tax), and five at normal priority — plumber, passport, insurance claim, dry cleaning, HOA letter.")
))

R.append(row(
    "reopen the mulch task, I still need it",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", "t-231 | completed | Order mulch | \n"
        "t-217 | open | Call the roofer about the leak | due 2026-09-25 | high\n"
        "t-228 | open | Water the plants | due 2026-09-20"),
    call("project", {"kind": "task", "action": "update", "id": "t-231", "status": "open"}),
    tool("project", "Task t-231 updated (status=open)."),
    reply("Reopened — t-231 order mulch is back on the list as open.")
))

R.append(row(
    "can you check off the roofer thing",
    call("project", {"kind": "task", "action": "list"}),
    tool("project", "t-217 | open | Call the roofer about the leak | due 2026-09-25 | high\n"
        "t-250 | open | Get gutter cleaning quote from roofer | \n"
        "t-228 | open | Water the plants | due 2026-09-20"),
    reply('You have two roofer tasks — t-217 "Call the roofer about the leak" and t-250 "Get gutter cleaning quote from roofer". Which one should I check off?')
))

# ---------------- PROJECTS (15) ----------------

R.append(row(
    "set up a project for the kitchen reno, due end of october",
    call("project", {"kind": "project", "action": "create", "name": "Kitchen reno", "description": "Full kitchen renovation with contractor Mike Renner.", "due_date": "2026-10-31"}),
    tool("project", 'Project created: p-12 "Kitchen reno" (due 2026-10-31).'),
    reply("Project p-12 \"Kitchen reno\" is set up, due October 31st, with Mike Renner noted as the contractor.")
))

R.append(row(
    "add a deliverable to the kitchen reno project: cabinets installed, due october 10th",
    call("project", {"kind": "deliverable", "action": "add", "project_id": "p-12", "name": "Cabinets installed", "due_date": "2026-10-10"}),
    tool("project", 'Deliverable added: d-34 "Cabinets installed" (project p-12, due 2026-10-10).'),
    reply('Deliverable d-34 "Cabinets installed" added to the kitchen reno, due October 10th.')
))

R.append(row(
    "so the countertop supplier just called and they're two weeks late on the slab. that's... not great. add it as a blocker on the kitchen reno, high severity",
    call("project", {"kind": "blocker", "action": "add", "project_id": "p-12", "description": "Countertop supplier two weeks late on the slab", "severity": "high"}),
    tool("project", 'Blocker added: b-10 "Countertop supplier two weeks late on the slab" (project p-12, severity high).'),
    reply("Logged as a high-severity blocker on the kitchen reno — b-10, the countertop supplier running two weeks late.")
))

R.append(row(
    "the windows blocker on the kitchen reno is resolved, take it off",
    call("project", {"kind": "project", "action": "get", "id": "p-12"}, content="Plan: check the project's blockers → delete the windows one."),
    tool("project", 'Project p-12 "Kitchen reno" — status: active, due 2026-10-31\n'
        'Blockers:\n'
        'b-9 | medium | Window supplier delivery slot unconfirmed\n'
        'b-10 | high | Countertop supplier two weeks late'),
    call("project", {"kind": "blocker", "action": "delete", "id": "b-9"}),
    tool("project", "Blocker b-9 deleted."),
    reply('Removed — the windows blocker b-9 is off the kitchen reno. The countertop delay (b-10) is still on there.')
))

R.append(row(
    "what's the status of the kitchen reno project?",
    call("project", {"kind": "project", "action": "get", "id": "p-12"}),
    tool("project", 'Project p-12 "Kitchen reno" — status: active, due 2026-10-31\n'
        'Tasks:\n'
        't-227 | open | Confirm cabinet paint color with Mike\n'
        'Deliverables:\n'
        'd-34 | open | Cabinets installed | due 2026-10-10\n'
        'd-35 | open | Countertops templated | due 2026-10-03\n'
        'Blockers:\n'
        'b-10 | high | Countertop supplier two weeks late'),
    reply("The kitchen reno is active, due October 31st. Both deliverables are still open — countertops templated Oct 3, cabinets installed Oct 10 — one open task (paint color with Mike), and one high blocker: the countertop supplier is two weeks late, which puts the Oct 3 templating at risk.")
))

R.append(row(
    "add a priority to the kitchen reno: pick the countertop slab before the cabinet order goes in, because the cabinet order is blocked on it",
    call("project", {"kind": "priority", "action": "add", "project_id": "p-12", "item": "Pick countertop slab before placing the cabinet order", "impact": "Cabinet order cannot be placed until the slab is picked"}),
    tool("project", "Priority item added: pr-4 (project p-12)."),
    reply("Added as priority pr-4 on the kitchen reno — pick the slab first, since the cabinet order is blocked on it.")
))

R.append(row(
    "update the kitchen reno financials — budget's 25k all in, we're at 14,200 spent so far",
    call("project", {"kind": "financials", "action": "update", "project_id": "p-12", "budget": "25000", "spent": "14200"}),
    tool("project", "Financials updated for project p-12 (budget 25000, spent 14200)."),
    reply("Financials updated — budget $25,000 with $14,200 spent, so you've got $10,800 of headroom on the kitchen reno.")
))

R.append(row(
    "check off the demo deliverable on the kitchen reno, the wall's down",
    call("project", {"kind": "project", "action": "get", "id": "p-12"}, content="Plan: look up the deliverable id → toggle it."),
    tool("project", 'Project p-12 "Kitchen reno" — status: active, due 2026-10-31\n'
        'Deliverables:\n'
        'd-36 | open | Demo done | due 2026-09-24\n'
        'd-34 | open | Cabinets installed | due 2026-10-10\n'
        'd-35 | open | Countertops templated | due 2026-10-03'),
    call("project", {"kind": "deliverable", "action": "toggle", "id": "d-36"}),
    tool("project", "Deliverable d-36 toggled (done=true)."),
    reply('Marked — d-36 "Demo done" is checked off on the kitchen reno.')
))

R.append(row(
    "list my projects",
    call("project", {"kind": "project", "action": "list"}),
    tool("project", "p-12 | active | Kitchen reno | due 2026-10-31\n"
        "p-13 | active | Holiday travel planning | due 2026-12-01\n"
        "p-10 | completed | Bathroom reno | due 2026-08-30\n"
        "p-11 | archived | Garage sale | "),
    reply("Four projects: kitchen reno (active, due Oct 31), holiday travel planning (active, due Dec 1), bathroom reno (completed), and garage sale (archived).")
))

R.append(row(
    "archive the garage sale project, it's over and done",
    call("project", {"kind": "project", "action": "list"}, content="Plan: find the garage sale project id → archive it."),
    tool("project", "p-12 | active | Kitchen reno | due 2026-10-31\n"
        "p-13 | active | Holiday travel planning | due 2026-12-01\n"
        "p-11 | active | Garage sale | "),
    call("project", {"kind": "project", "action": "archive", "id": "p-11"}),
    tool("project", 'Project p-11 "Garage sale" archived.'),
    reply('Archived — the garage sale project p-11 is out of the active list.')
))

R.append(row(
    "mark the bathroom reno project complete, we passed inspection",
    call("project", {"kind": "project", "action": "list"}, content="Plan: find the bathroom reno id → mark it complete."),
    tool("project", "p-12 | active | Kitchen reno | due 2026-10-31\n"
        "p-10 | active | Bathroom reno | due 2026-08-30\n"
        "p-11 | archived | Garage sale | "),
    call("project", {"kind": "project", "action": "complete", "id": "p-10"}),
    tool("project", 'Project p-10 "Bathroom reno" marked complete.'),
    reply('The bathroom reno p-10 is marked complete — congrats on passing inspection.')
))

R.append(row(
    "new project: holiday travel planning, due december 1st",
    call("project", {"kind": "project", "action": "create", "name": "Holiday travel planning", "due_date": "2026-12-01"}),
    tool("project", 'Project created: p-13 "Holiday travel planning" (due 2026-12-01).'),
    reply("Project p-13 \"Holiday travel planning\" created, due December 1st.")
))

R.append(row(
    "add a blocker to holiday travel: the passport renewal might not come back in time, medium severity",
    call("project", {"kind": "blocker", "action": "add", "project_id": "p-13", "description": "Passport renewal may not return in time for travel", "severity": "medium"}),
    tool("project", 'Blocker added: b-11 "Passport renewal may not return in time for travel" (project p-13, severity medium).'),
    reply("Added — b-11 on holiday travel planning, medium severity: the passport renewal timing.")
))

R.append(row(
    "what's the kitchen reno budget looking like?",
    call("project", {"kind": "project", "action": "get", "id": "p-12"}),
    tool("project", 'Project p-12 "Kitchen reno" — status: active, due 2026-10-31\n'
        'Financials: budget 25000, spent 14200, revenue 0\n'
        'Deliverables:\n'
        'd-34 | open | Cabinets installed | due 2026-10-10\n'
        'd-35 | open | Countertops templated | due 2026-10-03'),
    reply("Budget is $25,000 with $14,200 spent — $10,800 left, and the big remaining costs are the cabinets and the countertop install.")
))

R.append(row(
    "add two deliverables to the kitchen reno: demo done by sept 24th, and countertops templated by october 3rd",
    calls(
        ("project", {"kind": "deliverable", "action": "add", "project_id": "p-12", "name": "Demo done", "due_date": "2026-09-24"}),
        ("project", {"kind": "deliverable", "action": "add", "project_id": "p-12", "name": "Countertops templated", "due_date": "2026-10-03"}),
    ),
    tool("project", 'Deliverable added: d-36 "Demo done" (project p-12, due 2026-09-24).'),
    tool("project", 'Deliverable added: d-35 "Countertops templated" (project p-12, due 2026-10-03).'),
    reply("Both added to the kitchen reno: d-36 demo done by September 24th, d-35 countertops templated by October 3rd.")
))

# ---------------- CALENDAR EVENTS (20) ----------------

R.append(row(
    "put my haircut on the calendar, thursday at 3, 45 minutes",
    call("iris", {"task": 'TASK: Add a calendar event titled "Haircut" on 2026-09-24 at 15:00 for 45 minutes.'}),
    tool("iris", 'OK — event "Haircut" added on 2026-09-24 at 15:00.'),
    reply('Haircut is on the calendar — Thursday the 24th at 3:00 PM, 45 minutes.')
))

R.append(row(
    "add my dentist appointment tuesday at 10:30",
    call("iris", {"task": 'TASK: Add a calendar event titled "Dentist appointment" on 2026-09-22 at 10:30 for 45 minutes.'}),
    tool("iris", 'OK — event "Dentist appointment" added on 2026-09-22 at 10:30.'),
    reply("Dentist appointment added — Tuesday the 22nd at 10:30.")
))

R.append(row(
    "the dentist confirmation finally came in — it's tuesday the 22nd at 10:30. get it on my calendar, it's a cleaning so probably an hour",
    call("iris", {"task": 'TASK: Add a calendar event titled "Dentist appointment (cleaning)" on 2026-09-22 at 10:30 for 60 minutes.'}),
    tool("iris", 'OK — event "Dentist appointment (cleaning)" added on 2026-09-22 at 10:30.'),
    reply('On the calendar — dentist cleaning Tuesday the 22nd at 10:30, blocked for the hour.')
))

R.append(row(
    "put the permit meeting on my calendar, tuesday the 22nd at 2pm, an hour",
    call("iris", {"task": 'TASK: Add a calendar event titled "Permit meeting" on 2026-09-22 at 14:00 for 60 minutes.'}),
    tool("iris", 'OK — event "Permit meeting" added on 2026-09-22 at 14:00.'),
    reply("Permit meeting is booked — Tuesday the 22nd at 2:00 PM for an hour.")
))

R.append(row(
    "what's on my calendar today?",
    call("iris", {"task": "TASK: List my calendar events for today, 2026-09-18."}),
    tool("iris", "OK — 2 events today, 2026-09-18: 13:00 Team standup (30 min); 16:00 Call with Mike Renner (30 min)."),
    reply("Two things today: team standup at 1:00 PM, and a call with Mike Renner at 4:00.")
))

R.append(row(
    "what does next week look like on the calendar",
    call("iris", {"task": "TASK: List my calendar events for the week of 2026-09-21."}),
    tool("iris", 'OK — 4 events on your calendar for the week of 2026-09-21: Mon 09:00 Layla\'s school orientation; Tue 10:30 Dentist appointment; Tue 14:00 Permit meeting; Thu 10:00 Q3 budget review.'),
    reply("Next week has four things: Layla's orientation Monday 9:00, dentist Tuesday 10:30, permit meeting Tuesday 2:00, and the Q3 budget review Thursday 10:00. Wednesday and Friday are clear.")
))

R.append(row(
    "list my calendar events for the week of 2026-09-21",
    call("iris", {"task": "TASK: List my calendar events for the week of 2026-09-21."}),
    tool("iris", 'OK — 4 events on your calendar for the week of 2026-09-21: Mon 09:00 Layla\'s school orientation; Tue 10:30 Dentist appointment; Tue 14:00 Permit meeting; Thu 10:00 Q3 budget review.'),
    reply("The week of the 21st: Mon 9:00 Layla's school orientation, Tue 10:30 dentist, Tue 14:00 permit meeting, Thu 10:00 Q3 budget review — four events total.")
))

R.append(row(
    "move the Q3 budget review with dana from saturday 2pm to thursday the 24th at 10",
    call("iris", {"task": 'TASK: Move the "Q3 budget review" event from 2026-09-19 14:00 to 2026-09-24 10:00.'}),
    tool("iris", 'OK — event "Q3 budget review" moved to 2026-09-24 at 10:00.'),
    reply("Moved — the Q3 budget review now sits Thursday the 24th at 10:00 AM.")
))

R.append(row(
    "can you push my dentist thing back half an hour? the tuesday one",
    call("iris", {"task": 'TASK: Move the "Dentist appointment" event from 2026-09-22 10:30 to 2026-09-22 11:00.'}),
    tool("iris", 'OK — event "Dentist appointment" moved to 2026-09-22 at 11:00.'),
    reply("Pushed — the dentist appointment is now Tuesday at 11:00 instead of 10:30.")
))

R.append(row(
    "cancel the haircut, I found a place that takes walk-ins",
    call("iris", {"task": 'TASK: Cancel the "Haircut" event on 2026-09-24 at 15:00.'}),
    tool("iris", 'OK — event "Haircut" on 2026-09-24 at 15:00 cancelled.'),
    reply("Cancelled — Thursday's 3:00 haircut is off the calendar.")
))

R.append(row(
    "scratch the dentist appointment, I rescheduled with the office directly",
    call("iris", {"task": 'TASK: Cancel the "Dentist appointment" event on 2026-09-22 at 10:30.'}),
    tool("iris", 'OK — event "Dentist appointment" on 2026-09-22 at 10:30 cancelled.'),
    reply("Done — the Tuesday 10:30 dentist appointment is off the calendar.")
))

R.append(row(
    "ok so the school emailed about layla's orientation — sorry, it's monday the 21st, 9 in the morning, an hour long. I will absolutely forget this. calendar it",
    call("iris", {"task": 'TASK: Add a calendar event titled "Layla\'s school orientation" on 2026-09-21 at 09:00 for 60 minutes.'}),
    tool("iris", 'OK — event "Layla\'s school orientation" added on 2026-09-21 at 09:00.'),
    reply("Calendared — Layla's orientation Monday the 21st at 9:00 AM, an hour. You won't forget it.")
))

R.append(row(
    "book a deep work block tomorrow morning at 9, 90 minutes, for the HOA letter",
    call("iris", {"task": 'TASK: Add a calendar event titled "Deep work: HOA letter" on 2026-09-19 at 09:00 for 90 minutes.'}),
    tool("iris", 'OK — event "Deep work: HOA letter" added on 2026-09-19 at 09:00.'),
    reply("Booked — 90 minutes for the HOA letter tomorrow morning at 9:00.")
))

R.append(row(
    "put the dinner with the hendersons on the calendar",
    reply("Happy to — what day and time is the dinner, and roughly how long? I'll get it on the calendar.")
))

R.append(row(
    "can you move my permit meeting later in the day?",
    reply("Sure — the permit meeting is Tuesday the 22nd at 2:00 PM. What time should I move it to?")
))

R.append(row(
    "block out saturday morning, 8 to 11, for the yard work",
    call("iris", {"task": 'TASK: Add a calendar event titled "Yard work" on 2026-09-20 at 08:00 for 180 minutes.'}),
    tool("iris", 'OK — event "Yard work" added on 2026-09-20 at 08:00.'),
    reply("Blocked — yard work Saturday morning, 8:00 to 11:00.")
))

R.append(row(
    "when's the permit meeting again?",
    call("iris", {"task": "TASK: List my calendar events for the week of 2026-09-21."}),
    tool("iris", 'OK — 4 events on your calendar for the week of 2026-09-21: Mon 09:00 Layla\'s school orientation; Tue 10:30 Dentist appointment; Tue 14:00 Permit meeting; Thu 10:00 Q3 budget review.'),
    reply("The permit meeting is Tuesday the 22nd at 2:00 PM.")
))

R.append(row(
    "set up a call with the accountant — tuesday afternoon, 1pm, half an hour",
    call("iris", {"task": 'TASK: Add a calendar event titled "Call with accountant" on 2026-09-22 at 13:00 for 30 minutes.'}),
    tool("iris", 'OK — event "Call with accountant" added on 2026-09-22 at 13:00.'),
    reply("Set up — a half-hour call with the accountant Tuesday at 1:00 PM.")
))

R.append(row(
    "add the family video call, sunday the 20th at 5pm",
    call("iris", {"task": 'TASK: Add a calendar event titled "Family video call" on 2026-09-20 at 17:00 for 60 minutes.'}),
    tool("iris", 'OK — event "Family video call" added on 2026-09-20 at 17:00.'),
    reply("Added — family video call Sunday the 20th at 5:00 PM.")
))

R.append(row(
    "am I free thursday the 24th at 10?",
    call("iris", {"task": "TASK: List my calendar events for the week of 2026-09-21."}),
    tool("iris", 'OK — 4 events on your calendar for the week of 2026-09-21: Mon 09:00 Layla\'s school orientation; Tue 10:30 Dentist appointment; Tue 14:00 Permit meeting; Thu 10:00 Q3 budget review.'),
    reply("No — the Q3 budget review is Thursday the 24th at 10:00. Earlier Thursday morning or the afternoon is free, though.")
))

# ---------------- REMINDERS (15) ----------------

R.append(row(
    "remind me to take the bread out of the oven in 40 minutes",
    call("iris", {"task": 'TASK: Set a reminder titled "Take the bread out of the oven" for 2026-09-18 at 12:45.'}),
    tool("iris", 'OK — reminder "Take the bread out of the oven" set for 12:45.'),
    reply("Set — I'll ping you at 12:45 to take the bread out.")
))

R.append(row(
    "remind me in half an hour to flip the laundry to the dryer",
    call("iris", {"task": 'TASK: Set a reminder titled "Flip the laundry to the dryer" for 2026-09-18 at 12:35.'}),
    tool("iris", 'OK — reminder "Flip the laundry to the dryer" set for 12:35.'),
    reply("Reminder set for 12:35 — laundry to the dryer.")
))

R.append(row(
    "remind me every morning at 8 to take my vitamins",
    call("iris", {"task": 'TASK: Set a daily reminder titled "Take vitamins" every day at 08:00.'}),
    tool("iris", 'OK — daily reminder "Take vitamins" set for 08:00 every day.'),
    reply("Done — a daily vitamins reminder every morning at 8:00.")
))

R.append(row(
    "remind me an hour before the permit meeting tuesday",
    call("iris", {"task": 'TASK: Set a reminder titled "Permit meeting in one hour" for 2026-09-22 at 13:00.'}),
    tool("iris", 'OK — reminder "Permit meeting in one hour" set for 13:00.'),
    reply("Set — I'll nudge you at 1:00 PM Tuesday, an hour before the 2:00 permit meeting.")
))

R.append(row(
    "remind me tomorrow morning to take the recycling out",
    call("iris", {"task": 'TASK: Set a reminder titled "Take the recycling out" for 2026-09-19 at 08:00.'}),
    tool("iris", 'OK — reminder "Take the recycling out" set for 08:00.'),
    reply("Set for tomorrow morning at 8:00 — recycling out.")
))

R.append(row(
    "remind me at 3pm to call the roofer",
    call("iris", {"task": 'TASK: Set a reminder titled "Call the roofer" for 2026-09-18 at 15:00.'}),
    tool("iris", 'OK — reminder "Call the roofer" set for 15:00.'),
    reply("Got it — reminder at 3:00 PM today to call the roofer.")
))

R.append(row(
    "the sourdough starter... I keep forgetting to feed the thing. remind me tonight at 9",
    call("iris", {"task": 'TASK: Set a reminder titled "Feed the sourdough starter" for 2026-09-18 at 21:00.'}),
    tool("iris", 'OK — reminder "Feed the sourdough starter" set for 21:00.'),
    reply("Set — 9:00 tonight, feed the starter. The culture thanks you.")
))

R.append(row(
    "remind me friday evening to book the anniversary restaurant",
    call("iris", {"task": 'TASK: Set a reminder titled "Book the anniversary restaurant" for 2026-09-18 at 18:00.'}),
    tool("iris", 'OK — reminder "Book the anniversary restaurant" set for 18:00.'),
    reply("Since it's already Friday, I set it for this evening at 6:00 — book the anniversary restaurant.")
))

R.append(row(
    "set a reminder to pay the credit card bill on the 25th",
    reply("Sure — what time on the 25th should it fire? Morning, or after work?")
))

R.append(row(
    "remind me monday at 7:30am about the car service dropoff",
    call("iris", {"task": 'TASK: Set a reminder titled "Car service dropoff" for 2026-09-21 at 07:30.'}),
    tool("iris", 'OK — reminder "Car service dropoff" set for 07:30.'),
    reply("Set — Monday the 21st at 7:30 AM, car service dropoff.")
))

R.append(row(
    "remind me to water the plants every sunday morning",
    call("iris", {"task": 'TASK: Set a weekly reminder titled "Water the plants" every Sunday at 08:00.'}),
    tool("iris", 'OK — weekly reminder "Water the plants" set for Sunday 08:00.'),
    reply("Done — a weekly reminder to water the plants, Sunday mornings at 8:00.")
))

R.append(row(
    "reminder: check the oven again in 15",
    call("iris", {"task": 'TASK: Set a reminder titled "Check the oven" for 2026-09-18 at 12:20.'}),
    tool("iris", 'OK — reminder "Check the oven" set for 12:20.'),
    reply("Set — oven check at 12:20.")
))

R.append(row(
    "remind me thursday morning to confirm mike's crew is coming",
    call("iris", {"task": 'TASK: Set a reminder titled "Confirm Mike\'s crew is coming" for 2026-09-24 at 08:00.'}),
    tool("iris", 'OK — reminder "Confirm Mike\'s crew is coming" set for 08:00.'),
    reply("Set — Thursday morning at 8:00, confirm Mike's crew.")
))

R.append(row(
    "kill the vitamins reminder, I'm just going to leave the bottle on the counter",
    call("iris", {"task": 'TASK: Cancel the daily reminder titled "Take vitamins".'}),
    tool("iris", 'OK — daily reminder "Take vitamins" cancelled.'),
    reply("Killed — the vitamins reminder is gone. The counter trick works.")
))

R.append(row(
    "remind me two days before the property tax due date — that's november 3rd",
    call("iris", {"task": 'TASK: Set a reminder titled "Property tax due in two days" for 2026-11-01 at 09:00.'}),
    tool("iris", 'OK — reminder "Property tax due in two days" set for 09:00.'),
    reply("Set for November 1st at 9:00 AM — two days before the tax deadline.")
))

# ---------------- ALARMS (5) ----------------

R.append(row(
    "set an alarm for 7 tomorrow morning",
    call("iris", {"task": "TASK: Set an alarm for 07:00 tomorrow, 2026-09-19, titled \"Wake up\"."}),
    tool("iris", "OK — alarm set for 07:00 2026-09-19."),
    reply("Alarm set — 7:00 tomorrow morning.")
))

R.append(row(
    "wake me up at 6:15 monday",
    call("iris", {"task": "TASK: Set an alarm for 06:15 on 2026-09-21, titled \"Wake up\"."}),
    tool("iris", "OK — alarm set for 06:15 2026-09-21."),
    reply("Done — a 6:15 AM alarm for Monday morning.")
))

R.append(row(
    "nap time. alarm in 45 minutes",
    call("iris", {"task": "TASK: Set an alarm for 12:50 today, 2026-09-18, titled \"Nap over\"."}),
    tool("iris", "OK — alarm set for 12:50 2026-09-18."),
    reply("Enjoy the nap — alarm at 12:50.")
))

R.append(row(
    "set a 5:30pm alarm so I start dinner",
    call("iris", {"task": "TASK: Set an alarm for 17:30 today, 2026-09-18, titled \"Start dinner\"."}),
    tool("iris", "OK — alarm set for 17:30 2026-09-18."),
    reply("Alarm set for 5:30 PM — dinner time.")
))

R.append(row(
    "cancel the 6:15 monday alarm, I don't need the early start after all",
    call("iris", {"task": "TASK: Cancel the alarm set for 06:15 on 2026-09-21."}),
    tool("iris", "OK — alarm for 06:15 on 2026-09-21 cancelled."),
    reply("Cancelled — Monday's 6:15 alarm is gone. Sleep in.")
))

# ---------------- COMBINED (10) ----------------

R.append(row(
    "add a task to call the roofer about the leak, and remind me at 3pm to actually do it",
    calls(
        ("project", {"kind": "task", "action": "create", "title": "Call the roofer about the leak", "priority": "high"}),
        ("iris", {"task": 'TASK: Set a reminder titled "Call the roofer" for 2026-09-18 at 15:00.'}),
    ),
    tool("project", 'Task created: t-217 "Call the roofer about the leak" (priority high)'),
    tool("iris", 'OK — reminder "Call the roofer" set for 15:00.'),
    reply('Task t-217 created, and a 3:00 PM reminder will nudge you to actually make the call.')
))

R.append(row(
    "put the permit meeting on the calendar tuesday at 2, and make a task to gather the paperwork before then",
    calls(
        ("iris", {"task": 'TASK: Add a calendar event titled "Permit meeting" on 2026-09-22 at 14:00 for 60 minutes.'}),
        ("project", {"kind": "task", "action": "create", "title": "Gather permit paperwork", "due_date": "2026-09-22"}),
    ),
    tool("iris", 'OK — event "Permit meeting" added on 2026-09-22 at 14:00.'),
    tool("project", 'Task created: t-236 "Gather permit paperwork" (due 2026-09-22)'),
    reply("Both done — permit meeting on the calendar Tuesday at 2:00, and task t-236 to gather the paperwork, due the same day.")
))

R.append(row(
    "what's on my plate this week?",
    calls(
        ("project", {"kind": "task", "action": "list"}),
        ("iris", {"task": "TASK: List my calendar events for the week of 2026-09-18."}),
    ),
    tool("project", TASKLIST_SHORT),
    tool("iris", "OK — 3 events on your calendar for the week of 2026-09-18: Fri 13:00 Team standup; Fri 16:00 Call with Mike Renner; Sat 09:00 Deep work: HOA letter."),
    reply("This week: 7 open tasks — the big ones are the roofer call (high, due the 25th), dry cleaning tomorrow, and the HOA letter due Monday — plus three calendar items: standup today at 1:00, Mike Renner call at 4:00, and your HOA deep work block tomorrow at 9.")
))

R.append(row(
    "read my kitchen reno notes, make tasks for whatever's still open, and get the countertop templating on the calendar for october 3rd at 10",
    call("Read", {"file_path": "/home/dominic/Warden/notes/kitchen-reno.md"}, content="Plan: read the notes → tasks for the open items → templating event on the calendar."),
    tool("Read", "Kitchen reno notes\nContractor: Mike Renner (crew usually on site Tue/Thu)\nDone: demo planning, appliance picks shortlisted\nStill open:\n- Confirm cabinet paint color with Mike (he needs it before ordering doors)\n- Final appliance order (fridge + range, hold until slab date confirmed)\n- Countertop templating — supplier said early October"),
    calls(
        ("project", {"kind": "task", "action": "create", "title": "Confirm cabinet paint color with Mike", "project_id": "p-12"}),
        ("project", {"kind": "task", "action": "create", "title": "Place final appliance order", "notes": "Fridge + range. Hold until the countertop slab date is confirmed.", "project_id": "p-12"}),
        ("iris", {"task": 'TASK: Add a calendar event titled "Countertop templating" on 2026-10-03 at 10:00 for 60 minutes.'}),
    ),
    tool("project", 'Task created: t-227 "Confirm cabinet paint color with Mike" (project p-12)'),
    tool("project", 'Task created: t-238 "Place final appliance order" (project p-12)'),
    tool("iris", 'OK — event "Countertop templating" added on 2026-10-03 at 10:00.'),
    reply("From the notes: t-227 confirm the cabinet paint color with Mike, and t-238 place the final appliance order (holding until the slab date is confirmed), both under the kitchen reno. Countertop templating is on the calendar for October 3rd at 10:00.")
))

R.append(row(
    "add the plumber booking as a task — mike's guy — and set the dentist for tuesday at 10:30",
    calls(
        ("project", {"kind": "task", "action": "create", "title": "Book the plumber (Mike's contact)", "notes": "Mike Renner's plumbing contact."}),
        ("iris", {"task": 'TASK: Add a calendar event titled "Dentist appointment" on 2026-09-22 at 10:30 for 45 minutes.'}),
    ),
    tool("project", "Task created: t-251 \"Book the plumber (Mike's contact)\" (Personal)"),
    tool("iris", 'OK — event "Dentist appointment" added on 2026-09-22 at 10:30.'),
    reply("Task t-251 to book Mike's plumber is on the list, and the dentist is calendared Tuesday at 10:30.")
))

R.append(row(
    "remind me an hour before the Q3 budget review — it's tomorrow at 2 — and make a task to prep the numbers tonight",
    calls(
        ("iris", {"task": 'TASK: Set a reminder titled "Q3 budget review in one hour" for 2026-09-19 at 13:00.'}),
        ("project", {"kind": "task", "action": "create", "title": "Prep Q3 budget numbers", "due_date": "2026-09-18"}),
    ),
    tool("iris", 'OK — reminder "Q3 budget review in one hour" set for 13:00.'),
    tool("project", 'Task created: t-237 "Prep Q3 budget numbers" (due 2026-09-18)'),
    reply("Reminder set for 1:00 tomorrow, an hour before the 2:00 review, and task t-237 to prep the numbers is due tonight.")
))

R.append(row(
    "todo: buy paint samples for the kitchen, and add a deliverable to the kitchen reno — final paint color decided, by october 5th",
    calls(
        ("project", {"kind": "task", "action": "create", "title": "Buy paint samples for the kitchen", "project_id": "p-12"}),
        ("project", {"kind": "deliverable", "action": "add", "project_id": "p-12", "name": "Final paint color decided", "due_date": "2026-10-05"}),
    ),
    tool("project", 'Task created: t-239 "Buy paint samples for the kitchen" (project p-12)'),
    tool("project", 'Deliverable added: d-37 "Final paint color decided" (project p-12, due 2026-10-05).'),
    reply("Both on the kitchen reno — task t-239 to buy the paint samples, and deliverable d-37, final paint color decided, due October 5th.")
))

R.append(row(
    "mark the roofer task done, and set a reminder next friday to leave him a review",
    call("project", {"kind": "task", "action": "list"}, content="Plan: find the roofer task id → mark done → set the review reminder."),
    tool("project", TASKLIST_SHORT),
    calls(
        ("project", {"kind": "task", "action": "update", "id": "t-217", "status": "completed"}),
        ("iris", {"task": 'TASK: Set a reminder titled "Leave the roofer a review" for 2026-09-25 at 12:00.'}),
    ),
    tool("project", "Task t-217 updated (status=completed)."),
    tool("iris", 'OK — reminder "Leave the roofer a review" set for 12:00.'),
    reply("Roofer task t-217 marked done, and I'll remind you next Friday at noon to leave the review.")
))

R.append(row(
    "cancel the 3pm roofer reminder, I already called him",
    call("iris", {"task": 'TASK: Cancel the reminder titled "Call the roofer" set for 2026-09-18 at 15:00.'}),
    tool("iris", 'OK — reminder "Call the roofer" for 2026-09-18 15:00 cancelled.'),
    reply("Cancelled — the 3:00 PM roofer reminder is gone.")
))

R.append(row(
    "add a task to renew the passport, and remind me about it two weeks out",
    calls(
        ("project", {"kind": "task", "action": "create", "title": "Renew passport"}),
        ("iris", {"task": 'TASK: Set a reminder titled "Passport renewal — get on it" for 2026-10-02 at 09:00.'}),
    ),
    tool("project", 'Task created: t-220 "Renew passport" (Personal)'),
    tool("iris", 'OK — reminder "Passport renewal — get on it" set for 09:00.'),
    reply("Task t-220 created, and a reminder fires October 2nd at 9:00 — two weeks from today, I set it for the morning.")
))

# ---------------- write out ----------------
assert len(R) == 100, f"expected 100 rows, got {len(R)}"
for i in range(4):
    chunk = R[i*25:(i+1)*25]
    path = os.path.join(HERE, f"s19-{i+1}.jsonl")
    with open(path, "w") as f:
        for r in chunk:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(path, len(chunk))