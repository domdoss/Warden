#!/usr/bin/env python3
"""Generate s27-1.jsonl — internal machinery: atlas_background, sentry,
api_request/list_api_keys, attach_file, clear_context, fabric_pattern,
mcp__marm__marm_log_entry.

Reads _sys.txt programmatically (byte-exact, trailing whitespace stripped)
per the row-writer contract; never hardcodes the system prompt text.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "_sys.txt"), "r", encoding="utf-8") as f:
    SYSTEM = f.read().rstrip()

ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver)."


def u(text):
    return {"role": "user", "content": f"{ANCHOR}\n\n{text}"}


def a(text=""):
    return {"role": "assistant", "content": text}


def call(name, arguments):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"type": "function", "function": {"name": name, "arguments": arguments}}
    ]}


def tool(name, content):
    return {"role": "tool", "name": name, "content": content}


def row(*msgs):
    return {"messages": [{"role": "system", "content": SYSTEM}, *msgs]}


REPORT_BACK_TAIL = (
    "\n\nFor each result, run the CONFIRM step before anything else: compare it "
    "against what the user originally asked for — that ask is in your context.\n"
    "1. CONFIRMED — deliverable present and right. Media or window the user can "
    "already see or hear: stay silent. Else relay in one or two sentences.\n"
    "2. PROVEN-FAILED — the result itself shows the deliverable is wrong or "
    "missing (the path it claims to have written doesn't match the request, the "
    "answer contradicts the ask, the job errored or was aborted), OR the "
    "supervisor verdict above is FAILED. Call report_task_failure with the task "
    "and the reason, then re-delegate ONCE to the right specialist, naming the "
    "GAP — what was wanted versus what came back — never the fix. If the runner "
    "refuses the re-delegation, that refusal is final: tell the user plainly "
    "what failed and why, and stop.\n"
    "3. UNVERIFIABLE FROM TEXT — whether it worked depends on screen or system "
    "state you cannot see from this result and the result names a concrete "
    "outcome. Trust it and move on.\n"
    "CHAIN: if a result is one step of a larger request, take the next step "
    "yourself now — without waiting for the user. Stop only when the whole task "
    "is done or you are genuinely blocked. Do not paste raw output verbatim; "
    "speak the outcome.\n"
    "FORMAT: the reply is chat to the captain, not a report. One or two plain "
    "sentences per result, carrying the outcome itself. No headers, no bullets, "
    "no restating the ask or the job id, no verdict words, no next-steps offers."
)


def report_back(job_id, agent, task, result_text):
    body = (
        "REPORT-BACK TURN — jobs below are FINISHED. Report each result.\n\n"
        "[Inbox] 1 background job result completed:\n\n"
        f"- {job_id} ({agent}, done) — task: \"{task}\"\n"
        f"Result:\n{result_text}"
    ) + REPORT_BACK_TAIL
    return u(body)


rows = []

# ---------------------------------------------------------------- atlas_background (7)

# A1 — long multi-tab browse gather -> hand off
rows.append(row(
    u("can you go through all the tabs I've got open and grab the checkout "
      "prices for that couch across the different stores, I want to compare "
      "them later"),
    call("atlas_background", {
        "task": "Open each of dominic's currently open browser tabs for the "
                "couch he's shopping, capture the price and store name from "
                "each one, and save the comparison as "
                "/home/dominic/Warden/groups/dominic/couch-prices.md."
    }),
    tool("atlas_background", "Atlas k91c started — running. Result arrives "
         "in your inbox. Reply: running, result on the way. End your turn."),
    a("Running that couch price comparison in the background — I'll let you "
      "know when it's ready."),
))

# A2 — big file conversion sweep -> hand off
rows.append(row(
    u("hey, in ~/Warden/receipts there's like 40 jpg photos of receipts from "
      "the move, can you get those all converted into one pdf for the "
      "accountant"),
    call("atlas_background", {
        "task": "Convert every jpg receipt photo in /home/dominic/Warden/"
                "receipts into a single merged PDF for the accountant, saved "
                "as /home/dominic/Warden/receipts/move-receipts.pdf."
    }),
    tool("atlas_background", "Atlas 7q2f started — running. Result arrives "
         "in your inbox. Reply: running, result on the way. End your turn."),
    a("That's running in the background — I'll tell you when the merged PDF "
      "for the accountant is ready."),
))

# A3 — short ask, do it yourself (Read)
rows.append(row(
    u("what's on my todo list right now"),
    call("Read", {"file_path": "/home/dominic/Warden/groups/dominic/todo.md"}),
    tool("Read", "     1\tCall the dentist\n     2\tRenew car insurance\n"
         "     3\tBook flights for December"),
    a("Your list has calling the dentist, renewing car insurance, and "
      "booking December flights."),
))

# A4 — short ask, do it yourself (browser_evaluate)
rows.append(row(
    u("what does the title bar say on the tab I've got open right now"),
    call("browser_evaluate", {"js": "document.title"}),
    tool("browser_evaluate", "\"5 Signs Your Sourdough Starter Is Ready — "
         "King Arthur Baking\""),
    a("That tab's titled '5 Signs Your Sourdough Starter Is Ready — King "
      "Arthur Baking.'"),
))

# A5 — duplicate dispatch
rows.append(row(
    u("can you go through my open tabs and grab those couch prices into a "
      "file"),
    call("atlas_background", {
        "task": "Open each of dominic's currently open browser tabs for the "
                "couch he's shopping, capture the price and store name from "
                "each one, and save the comparison as "
                "/home/dominic/Warden/groups/dominic/couch-prices.md."
    }),
    tool("atlas_background", "Atlas is already running this exact task as "
         "atlas-k91c — its result will arrive in your inbox. Do not dispatch "
         "it again."),
    a("That's already running from a minute ago — the couch comparison will "
      "land in your inbox, no need to start it twice."),
))

# A6 — queued
rows.append(row(
    u("also can you convert those wedding photos in ~/Warden/photos/wedding "
      "to a merged pdf while you're at it"),
    call("atlas_background", {
        "task": "Convert every photo in /home/dominic/Warden/photos/wedding "
                "into a single merged PDF, saved as /home/dominic/Warden/"
                "photos/wedding/wedding-photos.pdf."
    }),
    tool("atlas_background", "Accepted and QUEUED — atlas-3bd8 is still "
         "working on the same file(s), so this one starts when that "
         "finishes. It has no job id of its own yet. Its result will arrive "
         "in your inbox. Do not re-dispatch it, and do not treat "
         "atlas-3bd8's result as this task's result."),
    a("Queued behind the job already touching those files — it'll start the "
      "moment that one finishes and land in your inbox."),
))

# A7 — dispatch, then landed via the real report-back inbox turn
rows.append(row(
    u("can you go through all my open tabs and grab the checkout prices for "
      "that couch, I want to compare stores"),
    call("atlas_background", {
        "task": "Open each of dominic's currently open browser tabs for the "
                "couch he's shopping, capture the price and store name from "
                "each one, and save the comparison as "
                "/home/dominic/Warden/groups/dominic/couch-prices.md."
    }),
    tool("atlas_background", "Atlas k91c started — running. Result arrives "
         "in your inbox. Reply: running, result on the way. End your turn."),
    a("Running that couch price comparison in the background — I'll let you "
      "know when it's ready."),
    report_back(
        "atlas-k91c", "atlas",
        "grab couch prices across dominic's open tabs into couch-prices.md",
        "Checked the three tabs: Article had the sofa at $1,899, West Elm at "
        "$2,150, and Wayfair at $1,749 with free shipping. Saved the "
        "comparison to /home/dominic/Warden/groups/dominic/couch-prices.md.",
    ),
    a("Wayfair has your couch cheapest at $1,749 with free shipping, versus "
      "$1,899 at Article and $2,150 at West Elm — the comparison's saved to "
      "couch-prices.md."),
))

# ---------------------------------------------------------------- sentry (4)

rows.append(row(
    u("can you scan the pc, i keep getting weird popups"),
    call("sentry", {"task": "peek scan of the machine — dominic is seeing "
         "unexplained popups", "urgent": False}),
    tool("sentry", "Sentry b48e started — running. Result arrives in your "
         "inbox. Reply: running, result on the way. End your turn."),
    a("Kicking off a peek scan now — I'll let you know what turns up."),
))

rows.append(row(
    u("whats listening on this box right now"),
    call("sentry", {"task": "peek scan of the machine — list open listening "
         "ports and services", "urgent": False}),
    tool("sentry", "Sentry c91a started — running. Result arrives in your "
         "inbox. Reply: running, result on the way. End your turn."),
    a("Running a peek scan for open ports and services — I'll report back "
      "when it lands."),
))

rows.append(row(
    u("can you do a deep scan tonight, want to make sure nothing sketchy is "
      "running"),
    call("sentry", {"task": "deep scan of the machine — autostart, crontab, "
         "user units, shell rc files, process audit", "urgent": False}),
    tool("sentry", "Sentry 4f7d started — running. Result arrives in your "
         "inbox. Reply: running, result on the way. End your turn."),
    a("Deep scan's running now, covering autostart, crontab and processes — "
      "I'll tell you what it finds."),
))

rows.append(row(
    u("can you do a deep scan, want to make sure nothing sketchy is running"),
    call("sentry", {"task": "deep scan of the machine — autostart, crontab, "
         "user units, shell rc files, process audit", "urgent": False}),
    tool("sentry", "Sentry 4f7d started — running. Result arrives in your "
         "inbox. Reply: running, result on the way. End your turn."),
    a("Deep scan's running now — I'll tell you what it finds."),
    report_back(
        "sentry-4f7d", "sentry",
        "deep scan of the machine — autostart, crontab, user units, shell rc "
        "files, process audit",
        "Deep scan complete: found an unexpected listener on port 5901 "
        "(VNC) run by process x11vnc that isn't tied to any known service — "
        "nothing dominic set up. Autostart entries, crontab, and shell rc "
        "files came back clean otherwise.",
    ),
    a("The deep scan turned up something — port 5901's got a VNC listener "
      "(x11vnc) running that you didn't set up; everything else, autostart "
      "and crontab included, came back clean."),
))

# ---------------------------------------------------------------- api_request / list_api_keys (5)

rows.append(row(
    u("hey can you post that summary to my dashboard thing — 'Q3 review: "
      "revenue up 12%, churn down 2%, roadmap on track for Q4 launch.'"),
    call("list_api_keys", {}),
    tool("list_api_keys", "Configured API keys:\n- Warden (internal, no key "
         "needed) (key_type: \"warden\") — http://localhost:3200\n- "
         "OpenWeather (key_type: \"openweather\") — "
         "https://api.openweathermap.org"),
    call("api_request", {
        "key_type": "warden", "method": "POST", "path": "/api/summaries",
        "body": "{\"text\":\"Q3 review: revenue up 12%, churn down 2%, "
                "roadmap on track for Q4 launch.\"}",
        "description": "file the Q3 summary",
    }),
    tool("api_request", "{\"ok\":true,\"id\":412}"),
    a("Filed — that Q3 summary is posted to your dashboard now."),
))

rows.append(row(
    u("can you use my weather key and tell me if its gonna rain in vancouver "
      "tomorrow"),
    call("list_api_keys", {}),
    tool("list_api_keys", "Configured API keys:\n- Warden (internal, no key "
         "needed) (key_type: \"warden\") — http://localhost:3200\n- "
         "OpenWeather (key_type: \"openweather\") — "
         "https://api.openweathermap.org"),
    call("api_request", {
        "key_type": "openweather", "method": "GET",
        "path": "/data/2.5/forecast?q=Vancouver&units=metric",
        "description": "tomorrow's forecast for Vancouver",
    }),
    tool("api_request", "{\"list\":[{\"dt_txt\":\"2026-09-19 12:00:00\","
         "\"weather\":[{\"main\":\"Rain\",\"description\":\"light rain\"}],"
         "\"main\":{\"temp\":14.2}}]}"),
    a("Looks like rain tomorrow in Vancouver, light rain around 14°C."),
))

rows.append(row(
    u("what's my warden dashboard currently set to for the digest time"),
    call("api_request", {
        "key_type": "warden", "method": "GET", "path": "/api/settings",
        "description": "check the digest schedule setting",
    }),
    tool("api_request", "{\"digest_time\":\"07:30\","
         "\"timezone\":\"America/Vancouver\",\"dark_mode\":true}"),
    a("Your digest is set to fire at 7:30 AM, timezone America/Vancouver."),
))

rows.append(row(
    u("can you push this to my notion, i think i set up a key for it"),
    call("list_api_keys", {}),
    tool("list_api_keys", "No API keys configured. The user can add keys in "
         "the Keys tab of their dashboard."),
    a("No API keys are set up yet — you'd add a Notion one from the Keys tab "
      "of your dashboard."),
))

rows.append(row(
    u("grab tomorrow's weather with the weather key again"),
    call("api_request", {
        "key_type": "openweather", "method": "GET",
        "path": "/data/2.5/forecast?q=Vancouver&units=metric",
        "description": "tomorrow's forecast for Vancouver",
    }),
    tool("api_request", "Error: 401 Unauthorized — the stored openweather "
         "key was rejected."),
    a("The OpenWeather key on file got rejected with a 401 — it'll need to "
      "be updated before I can pull that forecast."),
))

# ---------------------------------------------------------------- attach_file (2)

rows.append(row(
    u("can you send me that couch price file you made earlier so I can check "
      "it on my phone"),
    call("Bash", {"command": "ls /home/dominic/Warden/groups/dominic/"
         "couch-prices.md"}),
    tool("Bash", "/home/dominic/Warden/groups/dominic/couch-prices.md"),
    call("attach_file", {"path": "/home/dominic/Warden/groups/dominic/"
         "couch-prices.md"}),
    tool("attach_file", "File attached: /home/dominic/Warden/groups/"
         "dominic/couch-prices.md"),
    a("Attached — the couch price comparison's right there."),
))

rows.append(row(
    u("grab me the wedding photos pdf you merged, I need to email it"),
    call("attach_file", {"path": "/home/dominic/Warden/photos/wedding/"
         "wedding-photos.pdf"}),
    tool("attach_file", "Error: file not found at /home/dominic/Warden/"
         "photos/wedding/wedding-photos.pdf"),
    call("Glob", {"pattern": "/home/dominic/Warden/photos/wedding/**/*.pdf"}),
    tool("Glob", "/home/dominic/Warden/photos/wedding/"
         "wedding-photos-merged.pdf"),
    call("attach_file", {"path": "/home/dominic/Warden/photos/wedding/"
         "wedding-photos-merged.pdf"}),
    tool("attach_file", "File attached: /home/dominic/Warden/photos/"
         "wedding/wedding-photos-merged.pdf"),
    a("Found it under a slightly different name — the wedding photos PDF is "
      "attached."),
))

# ---------------------------------------------------------------- clear_context (2)

rows.append(row(
    u("ok forget everything we've talked about, i want to start totally "
      "fresh"),
    call("clear_context", {"reason": "starting fresh at the user's "
         "request"}),
    tool("clear_context", "Context cleared: starting fresh at the user's "
         "request. Continuing with fresh conversation."),
    a("Done — clean slate."),
))

rows.append(row(
    u("anyway, new topic — is anything still running in the background "
      "right now"),
    call("list_running_agents", {}),
    tool("list_running_agents", "No background jobs currently running."),
    a("Nothing's running in the background right now."),
))

# ---------------------------------------------------------------- fabric_pattern (2)

rows.append(row(
    u("can you summarize this for me — 'The board meeting ran long: Q3 "
      "revenue beat forecast by 8%, but the ops team flagged a staffing "
      "shortfall in the warehouse that's already delaying two shipments. "
      "Legal raised a contract renewal that needs signing by Friday. No "
      "decisions were made on the new hire budget.'"),
    call("fabric_pattern", {
        "name": "summarize",
        "input": "The board meeting ran long: Q3 revenue beat forecast by "
                 "8%, but the ops team flagged a staffing shortfall in the "
                 "warehouse that's already delaying two shipments. Legal "
                 "raised a contract renewal that needs signing by Friday. "
                 "No decisions were made on the new hire budget.",
    }),
    tool("fabric_pattern", "[Fabric pattern: summarize]\n\nQ3 revenue beat "
         "forecast by 8%. A warehouse staffing shortfall is delaying two "
         "shipments. A contract renewal needs signing by Friday. The new "
         "hire budget decision was deferred."),
    a("Revenue beat forecast by 8%, but a staffing shortfall is already "
      "delaying two shipments, there's a contract renewal that needs "
      "signing by Friday, and the new hire budget got punted."),
))

rows.append(row(
    u("can you pull the wisdom out of this article i saved — "
      "/home/dominic/Warden/groups/dominic/sourdough-article.txt"),
    call("Read", {"file_path": "/home/dominic/Warden/groups/dominic/"
         "sourdough-article.txt"}),
    tool("Read", "     1\tSourdough starters need consistent feeding...\n"
         "     2\t...three-day proofing at cool temps improves flavor..."),
    call("fabric_pattern", {
        "name": "extract_wisdon",
        "input": "Sourdough starters need consistent feeding... three-day "
                 "proofing at cool temps improves flavor...",
    }),
    tool("fabric_pattern", "Error: pattern \"extract_wisdon\" not found. Did "
         "you mean: extract_wisdom, extract_wisdom_dm?"),
    call("fabric_pattern", {
        "name": "extract_wisdom",
        "input": "Sourdough starters need consistent feeding... three-day "
                 "proofing at cool temps improves flavor...",
    }),
    tool("fabric_pattern", "[Fabric pattern: extract_wisdom]\n\nConsistent "
         "feeding keeps a starter viable; a slow three-day cold proof "
         "develops noticeably better flavor than a same-day rise."),
    a("Main takeaway: keep the starter fed consistently, and a slow "
      "three-day cold proof gives noticeably better flavor than rising it "
      "same-day."),
))

# ---------------------------------------------------------------- mcp__marm__marm_log_entry (3)

rows.append(row(
    u("found it — the monday report job dies because of a stale 5-minute "
      "timeout in the ollama call, not a memory issue. make a note of that "
      "so we don't chase memory again"),
    call("mcp__marm__marm_log_entry", {
        "entry": "The Monday report job fails because of a stale 5-minute "
                 "Ollama call timeout, not a memory issue.",
    }),
    tool("mcp__marm__marm_log_entry", "{\"status\": \"success\", "
         "\"message\": \"\\ud83d\\udcdd Log entry added: "
         "2026-09-18-monday-report-timeout\", \"entry_id\": 413, "
         "\"memory_id\": 1188}"),
    a("Logged — the Monday report failures are the stale 5-minute Ollama "
      "timeout, not memory."),
))

rows.append(row(
    u("quick one — do you remember what port the warden dashboard runs on"),
    call("mcp__marm__marm_smart_recall", {"query": "warden dashboard port"}),
    tool("mcp__marm__marm_smart_recall", "Warden's dashboard is served on "
         "port 3200 by warden.service (user unit)."),
    a("Port 3200 — warden.service serves the dashboard there."),
))

rows.append(row(
    u("alright, final answer — we're keeping the desktop as the single "
      "machine, no more pi setup, decided"),
    call("mcp__marm__marm_log_entry", {
        "entry": "Dominic decided to keep the desktop as the single machine "
                 "going forward; no more Pi setup.",
    }),
    tool("mcp__marm__marm_log_entry", "{\"status\": \"success\", "
         "\"message\": \"\\ud83d\\udcdd Log entry added: "
         "2026-09-18-single-machine-decision\", \"entry_id\": 414, "
         "\"memory_id\": 1189}"),
    a("Noted — desktop-only going forward, no more Pi setup."),
))

# ---------------------------------------------------------------- write

OUT = os.path.join(HERE, "s27-1.jsonl")
with open(OUT, "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False))
        f.write("\n")

print(f"wrote {len(rows)} rows to {OUT}")
