#!/usr/bin/env python3
# s29 — SEAT-role rows for the orch hand-off (merge stamps the seat's JSON
# prompt + the 75-tool universe over these). Since 8ddc077 the seat does NOT
# decompose multi-specialist projects itself — it hands the whole project to
# orch in ONE intent-only call. The orch tool is REQUEST-ONLY: the first call
# is gated (propose to the captain, end turn); after the captain replies
# wanting it, the second call spawns the background job. The result lands in
# the inbox on a later REPORT-BACK turn, reported outcome-first, 1-2 plain
# sentences. Also the routing boundaries: all-iris work goes to iris directly
# (never orch), long single-threaded builds go to atlas_background.
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, "_sys.txt")).read()  # placeholder — merge stamps the live prompt
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"

def user(ask):
    return {"role": "user", "content": ANCHOR + ask}

def acall(cid, name, args, content=None):
    return {"role": "assistant", "content": content,
            "tool_calls": [{"id": cid, "type": "function",
                            "function": {"name": name, "arguments": args}}]}

def tool(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": content}

def final(text):
    return {"role": "assistant", "content": text}

def dumps(rows):
    lines = []
    for msgs in rows:
        assert msgs[0]["role"] == "user"
        assert msgs[-1]["role"] == "assistant"
        for m in msgs:
            for tc in (m.get("tool_calls") or []):
                assert tc["function"]["name"] != "atlas", "seat delegates to atlas"
        lines.append(json.dumps({"messages": [{"role": "system", "content": SYS}] + msgs},
                                ensure_ascii=False))
    return "\n".join(lines) + "\n"

GATE = ("The orchestrator runs only when the user asks for it. Do not start it on your own — "
        "tell the user what you would hand it and why, and call this again only after they reply wanting it.")

def spawned(jid, urgent=False):
    u = " (urgent — its result will interrupt you when ready)" if urgent else ""
    return f"Orch {jid.split('-').pop()} started{u} — running. Result arrives in your inbox. Reply: running, result on the way. End your turn."

def reportback(jid, task, result):
    return (ANCHOR + "REPORT-BACK TURN — jobs below are FINISHED. Report each result.\n\n"
            f"[Inbox] 1 background job result completed:\n\n"
            f"- {jid} (orch, done) — task: \"{task}\"\n"
            "Result:\n" + result)

# ─── kind 1: the request-only gate, full dance in one row ───────────────────
# (ask → gated orch call → propose → captain approves → orch call → spawned → ack)
GATE_ROWS = [
    # (ask, orch task, proposal, approval, jid, ack)
    ("Build me a weather digest: a script that pulls tomorrow's forecast for Sheridan, a daily 7am run, and the digest emailed to me. Make it real, not a mockup.",
     "Build a weather digest: a script pulling tomorrow's forecast for Sheridan, OR (NWS API), a daily 07:00 America/Vancouver run, and the digest emailed to dom.doss@gmail.com. Real and tested, not a mockup.",
     "That's a multi-specialist chain — script, schedule, email, then an audit. I'd hand the whole thing to orch to run in the background: it decomposes, delegates each piece to vulkan and iris, verifies what comes back, and reports one result. Say the word.",
     "go ahead", "orch-qf3a",
     "Orch is on it — the whole chain runs in the background and the result lands here when it's done."),
    ("Quarterly report for Q3: crunch ~/Warden/reports/q3-sales.csv into totals per region, render the summary as a PDF with a table, and get it to the usual finance distro. Then have the whole pipeline audited.",
     "Produce the Q3 report: crunch ~/Warden/reports/q3-sales.csv into per-region totals, render a one-page PDF summary with the table, email it to the finance distribution list (subject 'Q3 report — totals by region'), then audit the whole pipeline for re-runnability next quarter.",
     "This one crosses four specialists — crunch, render, mail, audit. Rather than me steering each piece, orch can run the whole chain unsupervised and hand up one verified result. Want me to send it?",
     "yes do it", "orch-hb27",
     "Orch has the chain — result lands here when every piece is verified."),
    ("Set up snapshot rotation for my Projects folder: hourly snapshots kept for 24h, dailies kept 30 days, and make sure the new cron jobs don't open anything up security-wise.",
     "Set up snapshot rotation for /home/dominic/Projects: hourly snapshots kept 24h, dailies kept 30 days, logging to /var/log/rotate-projects.log; then a security scan of the script and its cron entries before anything is scheduled.",
     "Rotator build, a security pass, then scheduling — three specialists in sequence. Orch runs exactly that kind of chain end to end in the background. Send it?",
     "go", "orch-mt64",
     "Orch is running the rotation chain — security check happens before anything gets scheduled. Result lands here."),
    ("We get scanned invoices as PDFs in ~/Scan/invoices. Build the pipeline: a script that extracts vendor, date and total into invoices.csv, and when it runs each Friday have the CSV summary sent to my email.",
     "Build the invoice pipeline: parse the scanned PDFs in ~/Scan/invoices into invoices.csv (vendor, date, total) with working tests against the real scans, schedule the run every Friday 18:00 America/Vancouver, and email the row count and total summary to dom.doss@gmail.com.",
     "Parser with tests, a Friday schedule, a summary email — a build-and-wire chain. Orch can carry it unsupervised and only report at the end. Shall I hand it over?",
     "do it", "orch-ka55",
     "Orch is building the pipeline — I'll report here when the chain finishes."),
    ("The garage sensor posts JSON to :8123 now. Build a small dashboard: a poller that samples it every minute into a sqlite db and a page that graphs the last 24h. Then a 2am nightly that emails me anything anomalous.",
     "Build the garage dashboard: a poller sampling http://localhost:8123/json every 60s into sqlite (/opt/Warden/projects/garage-dash/sensor.db), a page graphing the last 24h, and a 02:00 nightly that emails anomalies (temp outside 0..45°C, door open >30min) to dom.doss@gmail.com when found.",
     "Poller, graph page, nightly anomaly pass, then schedules — that's a chain, not one job. Orch decomposes and verifies each piece in the background. Want it sent?",
     "go ahead with orch", "orch-mm93",
     "Orch has the dashboard chain — anomaly logic gets verified before anything is scheduled. Result lands here."),
    ("Migrate the old blog: export the posts from ~/old-blog, convert them to markdown, push them into the new Hugo site at ~/blog, fix any broken image links, and when it's all in place email me a summary of what moved.",
     "Migrate the blog: export posts from ~/old-blog, convert to markdown, load them into the Hugo site at ~/blog, fix broken image links, then email dom.doss@gmail.com a summary of what moved and what was repaired.",
     "Export, convert, repair, verify, mail — multi-step across files and specialists. That's orch's job, run whole in the background. Say go.",
     "go", "orch-r8kd",
     "Orch is on the migration — one verified result lands here at the end."),
    ("Onboard the new rental unit: create the lease folder from the template, set up the rent reminder for the 1st of every month, add the inspection dates to the calendar, and draft the welcome email to the new tenant.",
     "Onboard the new rental: create the lease folder from the template in ~/Warden/rentals, a rent reminder on the 1st of every month, inspection dates on the calendar, and a draft welcome email to the new tenant for review.",
     "Files, reminders, calendar, a draft email — several specialists, one outcome. I'd hand the whole onboarding to orch. Approve?",
     "yes", "orch-sc2e",
     "Orch is running the onboarding chain — the welcome email comes back as a draft for your review."),
    ("Deep-clean the media library: dedupe the photos in ~/Pictures, re-encode the oversized videos in ~/Videos, regenerate the thumbnails, and log what was removed or shrunk to ~/Warden/reports/media-cleanup.txt.",
     "Clean the media library: dedupe ~/Pictures, re-encode oversized videos in ~/Videos, regenerate thumbnails, and write what was removed or shrunk to ~/Warden/reports/media-cleanup.txt.",
     "Long mechanical chain over big files — dedupe, re-encode, thumbnails, report. Orch runs it end to end in the background and hands up the log. Send it?",
     "do it", "orch-ud31",
     "Orch is on the cleanup — the report lands here with the result."),
]

def gate_row(ask, task, proposal, approval, jid, ack):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "orch", {"task": task}),
        tool(c(), "orch", GATE),
        final(proposal),
        user(approval),
        acall(c(), "orch", {"task": task}),
        tool(c(), "orch", spawned(jid)),
        final(ack),
    ]

# ─── kind 2: the report-back turn (inbox result → outcome-first report) ─────
REPORTBACKS = [
    # (jid, task, orch result, seat report)
    ("orch-qf3a",
     "Build a weather digest: a script pulling tomorrow's forecast for Sheridan, OR (NWS API), a daily 07:00 America/Vancouver run, and the digest emailed to dom.doss@gmail.com. Real and tested, not a mockup.",
     "DONE — weather digest live.\n"
     "- Fetcher: vulkan wrote fetch_weather.py (NWS API, 14-field digest); smoke test 2/2 (one wind-field gap caught and patched on re-brief).\n"
     "- Schedule: iris confirmed the 07:00 daily run + digest email, first fire tomorrow.\n"
     "- Audit: artemis found no blockers; the run writes a last-run marker so silent failure can't hide.",
     "Weather digest is live — fetcher tested, one gap patched, 07:00 daily run and email confirmed, audit clean. First digest lands tomorrow at 7."),
    ("orch-hb27",
     "Produce the Q3 report: crunch ~/Warden/reports/q3-sales.csv into per-region totals, render a one-page PDF summary with the table, email it to the finance distribution list (subject 'Q3 report — totals by region'), then audit the whole pipeline for re-runnability next quarter.",
     "DONE — Q3 report out and audited.\n"
     "- Numbers: crunch.py totaled the CSV by region (grand total $412,884.19, checked against the source).\n"
     "- PDF: one page, rendered from the totals; sent to the finance distro.\n"
     "- Audit: pipeline re-runnable next quarter via one command (the PDF reads the JSON, not the CSV).",
     "Q3 report is sent — grand total $412,884.19 across 4 regions, PDF verified and mailed to finance, and the pipeline audits clean for a one-command re-run next quarter."),
    ("orch-mt64",
     "Set up snapshot rotation for /home/dominic/Projects: hourly snapshots kept 24h, dailies kept 30 days, logging to /var/log/rotate-projects.log; then a security scan of the script and its cron entries before anything is scheduled.",
     "DONE — backup rotation live.\n"
     "- Rotator: rotate.sh (hourly 24h / daily 30d), dry-run verified — 3 hourly + 2 daily prunes computed.\n"
     "- Security: sentry found nothing (0755 root-owned script, cron as dominic, no egress).\n"
     "- Schedule: hourly at the top of the hour + daily 03:30, both logging to /var/log/rotate-projects.log.",
     "Backup rotation is live for ~/Projects — hourly kept a day, dailies kept a month, security scan came back clean before anything was scheduled."),
    ("orch-ka55",
     "Build the invoice pipeline: parse the scanned PDFs in ~/Scan/invoices into invoices.csv (vendor, date, total) with working tests against the real scans, schedule the run every Friday 18:00 America/Vancouver, and email the row count and total summary to dom.doss@gmail.com.",
     "DONE — invoice pipeline live.\n"
     "- Parser: first pass failed one test (IndexError on blank dates); re-briefed, second pass 8/8 on the real 23-file set.\n"
     "- Verified: dry-run CSV clean, blank dates land as empty fields.\n"
     "- Schedule: Friday 18:00 runs + weekly summary email confirmed, first fire this Friday.",
     "Invoice pipeline is done — the parser's one crash-on-blank-dates bug was caught and fixed (8/8 tests on your real scans), Friday 18:00 run and summary email are confirmed."),
    ("orch-mm93",
     "Build the garage dashboard: a poller sampling http://localhost:8123/json every 60s into sqlite (/opt/Warden/projects/garage-dash/sensor.db), a page graphing the last 24h, and a 02:00 nightly that emails anomalies (temp outside 0..45°C, door open >30min) to dom.doss@gmail.com when found.",
     "DONE — garage dashboard live.\n"
     "- Poller + graph: 60s samples into sqlite, 24h graph page; live poll verified.\n"
     "- Follow-up: a timestamp-format mismatch between the two components was caught from vulkan's own note and fixed before scheduling.\n"
     "- Schedule: 60s loop, 02:00 nightly, anomaly email only when anomalies exist.",
     "Garage dashboard is live — polling every minute with a 24h graph, and the nightly 2am anomaly email is wired. A timestamp mismatch between the pieces got caught and fixed before anything was scheduled."),
    ("orch-r8kd",
     "Migrate the blog: export posts from ~/old-blog, convert to markdown, load them into the Hugo site at ~/blog, fix broken image links, and email dom.doss@gmail.com a summary of what moved and what was repaired.",
     "DONE — blog migrated.\n"
     "- 84 posts exported, converted, loaded into the Hugo site; build passes (0 errors, 2 warnings).\n"
     "- 11 broken image links repaired (9 re-pointed, 2 images restored from ~/old-blog/assets).\n"
     "- Summary emailed to dom.doss@gmail.com.",
     "Blog migration is done — 84 posts moved into the Hugo site with a clean build, 11 broken image links repaired, and the summary is in your inbox."),
    ("orch-sc2e",
     "Onboard the new rental: create the lease folder from the template in ~/Warden/rentals, a rent reminder on the 1st of every month, inspection dates on the calendar, and a draft welcome email to the new tenant for review.",
     "DONE — rental onboarded.\n"
     "- Lease folder created from the template (~/Warden/rentals/maple-st-204).\n"
     "- Rent reminder: 1st of every month. Inspections: 2026-10-15 and 2027-01-15 on the calendar.\n"
     "- Welcome email drafted (not sent) — attached for review.",
     "The rental is onboarded — lease folder from the template, rent reminder set for the 1st, both inspections on the calendar, and the welcome email is drafted for your review before anything sends."),
    ("orch-ud31",
     "Clean the media library: dedupe ~/Pictures, re-encode oversized videos in ~/Videos, regenerate thumbnails, and write what was removed or shrunk to ~/Warden/reports/media-cleanup.txt.",
     "DONE — media library cleaned.\n"
     "- 143 duplicate photos removed, 17 oversized videos re-encoded (62 GB freed).\n"
     "- Thumbnails regenerated for everything remaining.\n"
     "- Full log: ~/Warden/reports/media-cleanup.txt",
     "Media cleanup is done — 143 duplicate photos removed and 17 videos re-encoded, freeing 62 GB; the full log is at ~/Warden/reports/media-cleanup.txt."),
]

def rb_row(jid, task, result, report):
    return [
        {"role": "user", "content": reportback(jid, task, result)},
        final(report),
    ]

# ─── kind 3: routing boundaries ─────────────────────────────────────────────
# All-iris work (email/calendar/reminders/tasks) goes to iris DIRECTLY — never
# orch, never decomposition. One call per intent.
IRIS_ROWS = [
    ("Set up the quarterly reviews: calendar blocks for the first Monday of each month at 10am, a reminder the Friday before at 3pm, and an email to the team lead confirming the series.",
     "Set up quarterly review series: calendar blocks on the first Monday of each month at 10:00 America/Vancouver (skip statutory holidays), a reminder the preceding Friday at 15:00, and an email to the team lead (team-lead@sheridancorp.example) confirming the series dates. Current local time is the anchor.",
     "Done. Calendar: 12 first-Monday 10:00 blocks created (2 moved off statutory holidays to the Tuesday). Reminders: 15:00 the preceding Friday before each. Email: sent to team-lead@sheridancorp.example with the 12 confirmed dates.",
     "Quarterly reviews are set — first-Monday 10am blocks with Friday-3pm reminders ahead of each (two moved off stat holidays), and the confirmation email is out to the team lead."),
    ("Remind me to renew the domain next March 2nd, and email me the registrar's renewal checklist now.",
     "Create a reminder for 2027-03-02 (domain renewal) and email dom.doss@gmail.com the registrar's renewal checklist from the last registrar message. Current local time is the anchor.",
     "Done. Reminder: 2027-03-02 09:00 (domain renewal). Email: registrar's renewal checklist (7 items, from their February message) sent to dom.doss@gmail.com.",
     "Domain renewal reminder is set for March 2, and the registrar's renewal checklist is in your inbox."),
]

def iris_row(ask, task, iris_result, report):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "iris", {"task": task}),
        tool(c(), "iris", iris_result),
        final(report),
    ]

# Long SINGLE-threaded work (minutes of browsing / one long build, no
# multi-specialist chain) → atlas_background, not orch.
BG_ROWS = [
    ("Scrape the full parts catalog from the supplier's site and save it as a spreadsheet — it's a few hundred pages of browsing.",
     "Scrape the full parts catalog from https://parts.sheridansupply.example (all category pages, a few hundred) into ~/Warden/reports/parts-catalog.xlsx with part number, description, price, and stock columns.",
     "Atlas bg42 started — running. Result arrives in your inbox. Reply: running, result on the way. End your turn.",
     "Catalog scrape is running in the background — a few hundred pages, so it'll take a bit; the spreadsheet lands here when it's done."),
    ("Generate the full 40-page annual report PDF from the markdown drafts in ~/Warden/reports/annual — it takes a while to render.",
     "Generate the annual report PDF from the markdown drafts in ~/Warden/reports/annual/ (40 pages, table of contents, house report style) and save it to ~/Warden/reports/annual-2026.pdf.",
     "Atlas dn20 started — running. Result arrives in your inbox. Reply: running, result on the way. End your turn.",
     "Annual report render is running in the background — the finished PDF lands here."),
]

def bg_row(ask, task, start, ack):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "atlas_background", {"task": task}),
        tool(c(), "atlas_background", start),
        final(ack),
    ]

ROWS = []
for g in GATE_ROWS:
    ROWS.append(gate_row(*g))
for (jid, task, result, report) in REPORTBACKS:
    ROWS.append(rb_row(jid, task, result, report))
for r in IRIS_ROWS:
    ROWS.append(iris_row(*r))
for r in BG_ROWS:
    ROWS.append(bg_row(*r))

open(os.path.join(BASE, "s29-1.jsonl"), "w").write(dumps(ROWS))
print("s29-1: %d rows" % len(ROWS))
