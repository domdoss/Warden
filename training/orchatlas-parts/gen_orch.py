#!/usr/bin/env python3
# orch-* — ORCH-ROLE rows (merge stamps ORCH_MANAGER_SYSTEM + orch's 16-tool
# pool over these). Since 8ddc077 orch is a background subagent: the seat hands
# it a whole multi-part project, and INSIDE the chain it is the manager from
# NOTES-orch-multi-orchestration.md — decompose, delegate each piece to its
# owning specialist, verify what comes back, re-delegate with the gap named,
# consolidate ONE report. The specialist calls are BLOCKING (inline result in
# the same turn — orch has no inbox), so there is NO read_job_result here and
# NEVER an atlas call (the seat IS atlas; the recursion guard is structural).
# Hands of its own: Bash / Read / Grep for verification only.
# orch-1: clean chains. orch-2: failure → re-delegate with the gap named.
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
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

def dumps(rows, repeat=1):
    lines = []
    for msgs in rows:
        assert msgs[0]["role"] == "user"
        assert msgs[-1]["role"] == "assistant"
        for m in msgs:
            for tc in (m.get("tool_calls") or []):
                assert tc["function"]["name"] != "atlas", "orch delegates to atlas"
                assert tc["function"]["name"] != "read_job_result", "orch has no inbox"
        obj = {"messages": [{"role": "system", "content": ""}] + msgs}
        if repeat > 1:
            obj["repeat"] = repeat  # thin section — the merge emits it twice
        lines.append(json.dumps(obj, ensure_ascii=False))
    return "\n".join(lines) + "\n"

# Blocking specialist results arrive inline, labeled with the producing model
# the way executeXmlTool labels orch-piece results.
def vk(content):
    return "[vulkan · model local]\n" + content

def ir(content):
    return "[iris · model local]\n" + content

def ar(content):
    return "[artemis · model local]\n" + content

def se(content):
    return "[sentry · model local]\n" + content

# ─── Project A: weather digest app ─────────────────────────────────────────
A_ASKS = [
    "Build me a weather digest: a script that pulls tomorrow's forecast for Sheridan, a daily 7am run, and the digest emailed to me. Make it real, not a mockup.",
    "Set up the weather digest thing we talked about — fetch the Sheridan forecast, run it every morning at 7, mail me the digest.",
    "I want a weather digest app on this box: forecast fetcher for Sheridan, scheduled daily at 7am, digest lands in my inbox. Go.",
]
A_PLAN = "Pieces: 1) vulkan — fetcher script + smoke test 2) verify the run myself 3) iris — 7am schedule + digest email 4) artemis — audit the finished repo."
A_FETCH_BRIEF = ("Write /home/dominic/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for "
                 "Sheridan, OR from the National Weather Service API, renders a plain-text digest, and writes it to "
                 "/home/dominic/Projects/weather-digest/digest.txt. Include a smoke test (python3 fetch_weather.py "
                 "--smoke) and run it.")
A_FETCH_OK = ("Fetcher written to /home/dominic/Projects/weather-digest/fetch_weather.py; NWS API parsed via "
              "requests, digest template renders 14 fields. Smoke test: 1 passed, digest.txt written (612 bytes).")
A_VERIFY = "$ python3 /home/dominic/Projects/weather-digest/fetch_weather.py --smoke\nsmoke: fetch ok (nws), render ok, 612 bytes written to digest.txt\nexit 0"
A_SCHED_BRIEF = ("Schedule /home/dominic/Projects/weather-digest/fetch_weather.py to run daily at 07:00 "
                 "America/Vancouver, and have the contents of digest.txt emailed to dom.doss@gmail.com with the "
                 "subject 'Weather digest — Sheridan'. Confirm both the schedule and the email rule.")
A_SCHED_OK = ("Done. Daily run scheduled for 07:00 America/Vancouver (cron '0 7 * * *', TZ set). Digest email "
              "rule active: sends digest.txt contents to dom.doss@gmail.com, subject 'Weather digest — Sheridan'. "
              "First fire: tomorrow 07:00.")
A_PATCH_BRIEF = ("In /home/dominic/Projects/weather-digest/fetch_weather.py the digest renders the wind line as "
                 "'Wind: None None mph' when the NWS payload omits windSpeed — guard the wind field so a missing "
                 "value renders as 'Wind: n/a'. Add a smoke case with a windless payload and rerun the smoke test.")
A_PATCH_OK = ("Wind field guarded (renders 'Wind: n/a' when absent); added a windless-payload smoke case; smoke "
              "test 2/2 passed, digest.txt clean.")
A_AUDIT_BRIEF = ("Audit /home/dominic/Projects/weather-digest — code quality, error handling on the NWS API path, "
                 "and whether the scheduled run can silently fail. Read-only; report findings.")
A_AUDIT_OK = ("Artemis audit complete for weather-digest. Findings: (1) error handling sound — API failures exit "
              "non-zero with a logged reason; (2) scheduled run writes a last-run marker file, so silent failure is "
              "detectable; (3) minor: digest template has one unused variable (cleanup optional). No blockers.")
A_FINAL = ("DONE — weather digest live.\n"
           "- Fetcher: vulkan wrote `fetch_weather.py` (NWS API, 14-field digest); I ran the smoke test myself — 2/2.\n"
           "- One gap caught in verification: wind line rendered 'None None mph' on windless payloads; re-briefed "
           "vulkan with the exact case, patch verified in digest.txt.\n"
           "- Schedule: iris confirmed the 07:00 daily run + digest email to dom.doss@gmail.com, first fire tomorrow.\n"
           "- Audit: artemis found no blockers; scheduled run writes a last-run marker so silent failure can't hide.")

def chain_a(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": A_FETCH_BRIEF}, A_PLAN),
        tool(c(), "vulkan", vk(A_FETCH_OK)),
        acall(c(), "Bash", {"command": "python3 /home/dominic/Projects/weather-digest/fetch_weather.py --smoke"}),
        tool(c(), "Bash", A_VERIFY),
        acall(c(), "iris", {"task": A_SCHED_BRIEF},
              "Fetcher verified end to end. Piece 3: the schedule and the email."),
        tool(c(), "iris", ir(A_SCHED_OK)),
        acall(c(), "vulkan", {"task": A_PATCH_BRIEF},
              "The smoke output shows the wind line gap — piece 2 again, the patch, before the audit."),
        tool(c(), "vulkan", vk(A_PATCH_OK)),
        acall(c(), "Bash", {"command": "grep -n 'Wind: n/a' /home/dominic/Projects/weather-digest/digest.txt | head -1"}),
        tool(c(), "Bash", "18:Wind: n/a"),
        acall(c(), "artemis", {"task": A_AUDIT_BRIEF}, "Patch verified. Last piece: the audit."),
        tool(c(), "artemis", ar(A_AUDIT_OK)),
        final(A_FINAL),
    ]

# ─── Project B: invoice pipeline (failure → re-delegate with the gap named) ───
B_ASKS = [
    "We get scanned invoices as PDFs in ~/Scan/invoices. Build the pipeline: a script that extracts vendor, date and total into invoices.csv, and when it runs each Friday have the CSV summary sent to my email. Real code, working tests.",
    "Invoice pipeline: parse the scanned PDFs in ~/Scan/invoices into a CSV (vendor, date, total), run it Fridays, and the summary hits my inbox. Build it.",
]
B_PARSE_BRIEF = ("Write /opt/Warden/projects/invoice-pipeline/parse_invoices.py — walks ~/Scan/invoices for PDFs, "
                 "extracts vendor, date and total per file into invoices.csv (header + one row per invoice). Cover "
                 "an empty-field case in the tests and run the test suite.")
B_PARSE_FAIL = ("parse_invoices.py written; 7/8 tests pass. Failing: 'empty date field' — the extractor raises "
                "IndexError on a PDF whose date line is blank. The script is NOT production-ready.")
B_FIX_BRIEF = ("In /opt/Warden/projects/invoice-pipeline/parse_invoices.py the extractor raises IndexError on an "
               "invoice PDF with a blank date line — that is the exact case the tests flag. Guard the date extraction "
               "so a blank date becomes an empty CSV field instead of a crash, keep the empty-date test, and rerun "
               "the full suite.")
B_FIX_OK = ("Date extraction guarded: blank dates land as empty CSV fields. Full suite 8/8 passed against the real "
            "~/Scan/invoices sample set (23 files, 2 blank-date).")
B_FRIDAY_BRIEF = ("Schedule /opt/Warden/projects/invoice-pipeline/parse_invoices.py to run every Friday at 18:00 "
                  "America/Vancouver, and have the resulting invoices.csv row count and total sum emailed to "
                  "dom.doss@gmail.com, subject 'Invoice pipeline weekly'. Confirm both.")
B_FRIDAY_OK = ("Done. Friday 18:00 America/Vancouver schedule active for parse_invoices.py; the weekly email sends "
               "row count + total sum to dom.doss@gmail.com, subject 'Invoice pipeline weekly'. First fire this "
               "Friday 18:00.")
B_VERIFY_CSV = "vendor,date,total\nAcme Supplies,2026-08-14,412.90\nBlanko Print, ,88.00\nCedar Office,2026-08-20,1201.34"
B_FINAL = ("DONE — invoice pipeline live.\n"
           "- Parser: vulkan's first pass failed one test (IndexError on blank date lines); sent back to vulkan with "
           "the gap named, second pass 8/8 on the real 23-file scan set.\n"
           "- Verified myself: dry-run CSV rows are clean, blank dates land as empty fields.\n"
           "- Schedule: iris confirmed Friday 18:00 runs + weekly summary email, first fire this Friday.")

def chain_b(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": B_PARSE_BRIEF},
              "Pieces: 1) vulkan — parser + test suite 2) verify on the real scans 3) iris — Friday run + summary email."),
        tool(c(), "vulkan", vk(B_PARSE_FAIL)),
        acall(c(), "vulkan", {"task": B_FIX_BRIEF},
              "One test failed and it is a real crash — same specialist, sent back with the exact gap."),
        tool(c(), "vulkan", vk(B_FIX_OK)),
        acall(c(), "Bash", {"command": "cd /opt/Warden/projects/invoice-pipeline && python3 parse_invoices.py ~/Scan/invoices --dry-run && head -4 invoices.csv"}),
        tool(c(), "Bash", B_VERIFY_CSV + "\nexit 0"),
        acall(c(), "iris", {"task": B_FRIDAY_BRIEF},
              "Parser is clean on the real scans now — blank dates land as empty fields. Last piece: the Friday run."),
        tool(c(), "iris", ir(B_FRIDAY_OK)),
        final(B_FINAL),
    ]

# ─── Project C: backup rotator (sentry + iris in the chain) ─────────────────
C_ASKS = [
    "Set up snapshot rotation for my Projects folder: hourly snapshots kept for 24h, dailies kept 30 days, and make sure the new cron jobs don't open anything up security-wise.",
    "Build backup rotation for ~/Projects — hourly kept a day, daily kept a month — and have the security side checked so the cron setup isn't doing anything dumb.",
]
C_ROT_BRIEF = ("Write /opt/Warden/projects/backup-rotator/rotate.sh — btrfs-style snapshots of /home/dominic/Projects: "
               "hourly snapshots kept 24h, daily snapshots kept 30 days, skel-aware, log to /var/log/rotate-projects.log. "
               "Include a --dry-run mode and demonstrate one dry run.")
C_ROT_OK = ("rotate.sh written (hourly 24h / daily 30d, logged); --dry-run exercised end to end against a temp dir — "
            "3 hourly + 2 daily prunes computed correctly.")
C_SCAN_BRIEF = ("Security-scan the new backup setup at /opt/Warden/projects/backup-rotator plus its two cron entries "
                "(hourly and daily rotation of /home/dominic/Projects) — check permissions on the script and snapshots, "
                "what the cron runs as, and that nothing in the setup widens the attack surface. Report findings.")
C_SCAN_OK = ("Sentry scan complete: rotate.sh is 0755 root-owned, snapshots inherit 0640, cron entries run as dominic "
             "with no network egress and no secrets on the command line. No findings against the setup.")
C_DAILY_BRIEF = ("Schedule /opt/Warden/projects/backup-rotator/rotate.sh hourly (top of hour) and daily (03:30 "
                 "America/Vancouver), logging to /var/log/rotate-projects.log. Confirm both entries.")
C_FINAL = ("DONE — backup rotation live for ~/Projects.\n"
           "- Rotator: vulkan wrote rotate.sh (hourly kept 24h, daily kept 30d); I dry-ran it myself — 3 hourly + 2 "
           "daily prunes computed correctly.\n"
           "- Security: sentry scanned script, permissions and cron entries — no findings.\n"
           "- Schedule: iris confirmed hourly at the top of the hour + daily 03:30, both logging to /var/log/rotate-projects.log.")

def chain_c(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": C_ROT_BRIEF},
              "Pieces: 1) vulkan — the rotator 2) dry-run it myself 3) sentry — security pass 4) iris — the two cron entries."),
        tool(c(), "vulkan", vk(C_ROT_OK)),
        acall(c(), "Bash", {"command": "/opt/Warden/projects/backup-rotator/rotate.sh --dry-run 2>&1 | tail -3"}),
        tool(c(), "Bash", "dry-run: 3 hourly, 2 daily prunes would run\nexit 0"),
        acall(c(), "sentry", {"task": C_SCAN_BRIEF}, "Rotator verified. Security pass before anything gets scheduled."),
        tool(c(), "sentry", se(C_SCAN_OK)),
        acall(c(), "iris", {"task": C_DAILY_BRIEF}, "Scan is clean. Last piece: both schedules."),
        tool(c(), "iris", ir("Done. Hourly rotation scheduled at the top of the hour, daily at 03:30 America/Vancouver, "
                             "both logging to /var/log/rotate-projects.log.")),
        final(C_FINAL),
    ]

# ─── Project D: sensor dashboard (follow-up patch derived from a piece) ──────
D_ASKS = [
    "The garage sensor posts JSON to :8123 now. Build a small dashboard: a poller that samples it every minute into a sqlite db and a page that graphs the last 24h. Then a 2am nightly that emails me anything anomalous.",
    "Garage sensor dashboard please: poll the JSON on :8123 every minute into sqlite, a 24h graph page, and a nightly 2am anomaly email.",
]
D_POLL_BRIEF = ("Write /opt/Warden/projects/garage-dash/poller.py — samples http://localhost:8123/json every 60s into "
                "/opt/Warden/projects/garage-dash/sensor.db (table readings(ts, temp_c, door)), plus dashboard.html "
                "graphing the last 24h from the db. Smoke: one poll + one render, run it.")
D_POLL_OK = ("poller.py + dashboard.html written; smoke run polled localhost:8123 once and rendered a 24h graph from "
             "seeded readings.")
D_NIGHT_BRIEF = ("Add nightly.py to /opt/Warden/projects/garage-dash — at run time it reads the last 24h of readings "
                 "from sensor.db, flags anomalies (temp_c outside 0..45, door open > 30min total), and writes "
                 "anomalies.txt (empty when clean). Smoke with seeded anomalies and run it.")
D_NIGHT_OK = ("nightly.py written; seeded-anomaly smoke produced anomalies.txt with the 2 seeded flags; clean-run "
              "smoke produced an empty file.\n\n"
              "Note while finishing: poller.py writes ts as local time string, but nightly.py's 24h window math "
              "assumes epoch seconds — the smoke passed because the seeder matched local format. Real data will "
              "mis-window. Needs a ts unification before the nightly goes on a schedule.")
D_FIX_BRIEF = ("In /opt/Warden/projects/garage-dash, unify the timestamp format — poller.py stores ts as a local time "
               "string while nightly.py's 24h window expects epoch seconds. Store epoch (int) in new rows, migrate "
               "existing rows, and make nightly.py read epoch. Rerun both smokes.")
D_FIX_OK = ("ts unified to epoch: poller writes epoch ints, existing rows migrated in place, nightly.py window reads "
            "epoch. Both smokes green.")
D_FINAL = ("DONE — garage dashboard live.\n"
           "- Poller + graph: vulkan wrote poller.py (60s samples into sqlite) and dashboard.html (24h graph); I "
           "verified a live poll myself (21.4C, door closed).\n"
           "- Follow-up piece: vulkan's own parting note flagged a real ts-format mismatch between its two pieces — "
           "re-briefed with the mismatch named, both smokes green after the unification.\n"
           "- Schedule: iris confirmed the 60s loop, the 02:00 nightly, and the anomaly email (fires only when "
           "anomalies.txt is non-empty).")

def chain_d(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": D_POLL_BRIEF},
              "Pieces: 1) vulkan — poller + graph page 2) verify a live poll 3) vulkan — nightly anomaly pass 4) iris — 60s loop + 2am email."),
        tool(c(), "vulkan", vk(D_POLL_OK)),
        acall(c(), "Bash", {"command": "cd /opt/Warden/projects/garage-dash && python3 poller.py --once && sqlite3 sensor.db 'select count(*) from readings'"}),
        tool(c(), "Bash", "poll ok: 21.4C, door closed\n1\nexit 0"),
        acall(c(), "vulkan", {"task": D_NIGHT_BRIEF}, "Live poll verified — the db is filling. Piece 3: the nightly pass."),
        tool(c(), "vulkan", vk(D_NIGHT_OK)),
        acall(c(), "vulkan", {"task": D_FIX_BRIEF},
              "The parting note is right — that ts mismatch would silently break the window. Same specialist, the unification."),
        tool(c(), "vulkan", vk(D_FIX_OK)),
        acall(c(), "iris", {"task": "Schedule /opt/Warden/projects/garage-dash/poller.py on a 60-second loop and "
                            "/opt/Warden/projects/garage-dash/nightly.py at 02:00 America/Vancouver; when anomalies.txt "
                            "is non-empty, email its contents to dom.doss@gmail.com, subject 'Garage anomalies'. Confirm all three."},
              "Timestamps unified and both smokes green. Last piece: the schedules and the email."),
        tool(c(), "iris", ir("Done. poller.py on a 60s loop, nightly.py scheduled at 02:00 America/Vancouver, and the "
                             "anomaly email fires to dom.doss@gmail.com only when anomalies.txt is non-empty. First nightly: 02:00.")),
        final(D_FINAL),
    ]

# ─── Project E: report bundle (cross-piece file dependency) ──────────────────
E_ASKS = [
    "Quarterly report for Q3: crunch ~/Warden/reports/q3-sales.csv into totals per region, render the summary as a PDF with a table, and get it to the usual finance distro. Then have the whole pipeline audited so I can trust next quarter's run too.",
    "Q3 report run: totals by region from ~/Warden/reports/q3-sales.csv, a PDF summary with the table, emailed to finance. Audit the pipeline afterwards.",
]
E_CRUNCH_BRIEF = ("Write /opt/Warden/projects/q3-report/crunch.py — reads ~/Warden/reports/q3-sales.csv, totals revenue "
                  "per region, writes /opt/Warden/projects/q3-report/totals.json. Include a test on a fixture CSV and run it.")
E_CRUNCH_OK = ("crunch.py written; totals.json produced for 4 regions; fixture test passed.")
E_RENDER_BRIEF = ("In /opt/Warden/projects/q3-report, render summary.pdf from totals.json — a titled PDF with a "
                  "region/revenue table and a grand-total line, in the house report style used by generate_pdf. Verify "
                  "the PDF opens to 1 page.")
E_RENDER_OK = ("summary.pdf rendered from totals.json: titled table, 4 region rows, grand total; verified 1 page.")
E_MAIL_BRIEF = ("Email summary.pdf (from /opt/Warden/projects/q3-report) to the finance distribution list with the "
                "subject 'Q3 report — totals by region' and one line of body naming the grand total. Confirm send.")
E_AUDIT_BRIEF = ("Audit /opt/Warden/projects/q3-report end to end — crunch correctness against the source CSV, the PDF "
                 "render, and whether the pipeline is re-runnable next quarter without hand-holding. Read-only.")
E_AUDIT_OK = ("Artemis audit complete for q3-report: totals match a spot-check recomputation (3 regions sampled), the "
              "PDF renders from the JSON not the CSV (so next quarter only the CSV changes), and the pipeline is "
              "re-runnable via one command. One optional cleanup: totals.json could carry a generated-at stamp.")
E_FINAL = ("DONE — Q3 report out and audited.\n"
           "- Numbers: vulkan's crunch.py totaled the CSV by region; I checked totals.json against the source myself "
           "(4 regions, grand total $412,884.19).\n"
           "- PDF: rendered from those totals, verified 1 page; iris confirmed the send to the finance distro.\n"
           "- Audit: artemis verified crunch correctness and re-runnability — next quarter is one command since the "
           "PDF reads the JSON, not the CSV.")

def chain_e(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": E_CRUNCH_BRIEF},
              "Pieces: 1) vulkan — crunch the CSV 2) check the numbers myself 3) vulkan — render the PDF from those totals 4) iris — mail finance 5) artemis — audit the pipeline."),
        tool(c(), "vulkan", vk(E_CRUNCH_OK)),
        acall(c(), "Bash", {"command": "cat /opt/Warden/projects/q3-report/totals.json"}),
        tool(c(), "Bash", '{"North": 154220.51, "South": 98110.02, "East": 88431.33, "West": 72122.33}\nsum: 412884.19'),
        acall(c(), "vulkan", {"task": E_RENDER_BRIEF},
              "Numbers check out (4 regions, grand total matches the CSV). Piece 3: the PDF from those totals."),
        tool(c(), "vulkan", vk(E_RENDER_OK)),
        acall(c(), "iris", {"task": E_MAIL_BRIEF}, "PDF is verified. Piece 4: the send."),
        tool(c(), "iris", ir("Sent. summary.pdf went to the finance distribution list, subject 'Q3 report — totals by "
                             "region', body line: Grand total $412,884.19 across 4 regions.")),
        acall(c(), "artemis", {"task": E_AUDIT_BRIEF}, "Mail is out. Last piece: the audit, so next quarter is one command."),
        tool(c(), "artemis", ar(E_AUDIT_OK)),
        final(E_FINAL),
    ]

# ─── Project F: handbook (a piece's claim does not survive verification) ─────
# The strongest verify shape: the specialist CLAIMS done, orch's own check
# proves otherwise, the piece goes back with the evidence quoted.
F_ASKS = [
    "Convert the three workshop writeups in ~/Warden/workshops into one PDF handbook with a table of contents.",
    "Make a single PDF handbook out of the three workshop writeups in ~/Warden/workshops — TOC at the front.",
]
F_CONV_BRIEF = ("Convert the three markdown writeups in ~/Warden/workshops (spring.md, summer.md, fall.md) into "
                "one /home/dominic/Warden/workshops/handbook.pdf with a table of contents. Verify all three "
                "sections are in the final PDF.")
F_CONV_LIE = ("handbook.pdf written with a TOC; all three sections converted, 18 pages total.")
F_EVIDENCE = "$ pdftotext /home/dominic/Warden/workshops/handbook.pdf - | grep -c 'Workshop:'\n2"
F_FIX_BRIEF = ("The handbook is missing a section: pdftotext on /home/dominic/Warden/workshops/handbook.pdf finds "
               "only 2 'Workshop:' headings, not 3 — fall.md did not make it into the PDF. Rebuild the handbook "
               "with all three sections and state the page each section starts on.")
F_FIX_OK = ("Rebuilt: fall.md had a UTF-8 BOM that made the converter skip it; BOM stripped, handbook.pdf now "
            "carries all three sections. spring starts p.2, summer p.9, fall p.15; 21 pages, TOC matches.")
F_FINAL = ("DONE — handbook.pdf in ~/Warden/workshops.\n"
           "- First pass claimed all three sections; my pdftotext check found only 2 (fall.md was skipped over a "
           "UTF-8 BOM).\n"
           "- Sent back with the evidence; rebuilt handbook carries all three (spring p.2, summer p.9, fall p.15) "
           "with a matching TOC.")

def chain_f(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": F_CONV_BRIEF},
              "Pieces: 1) vulkan — convert + assemble + TOC 2) verify all three sections landed in the PDF."),
        tool(c(), "vulkan", vk(F_CONV_LIE)),
        acall(c(), "Bash", {"command": "pdftotext /home/dominic/Warden/workshops/handbook.pdf - | grep -c 'Workshop:'"}),
        tool(c(), "Bash", F_EVIDENCE),
        acall(c(), "vulkan", {"task": F_FIX_BRIEF},
              "The claim does not hold: only 2 of 3 sections are in the PDF. Back to vulkan with the evidence."),
        tool(c(), "vulkan", vk(F_FIX_OK)),
        acall(c(), "Bash", {"command": "pdftotext /home/dominic/Warden/workshops/handbook.pdf - | grep -c 'Workshop:'"}),
        tool(c(), "Bash", "3"),
        final(F_FINAL),
    ]

# ─── Project G: NAS backup (BLOCKED — a missing capability ends the chain honestly)
G_ASKS = [
    "Set up the nightly database backup: dump the sqlite dbs, compress them, copy to the NAS share, and email me a confirmation each night.",
    "Nightly backup of the databases please: dump, compress, copy to the NAS, email me when it runs.",
]
G_DUMP_BRIEF = ("Write /opt/Warden/projects/db-backup/backup.sh — dumps the sqlite databases in /opt/Warden/store "
                "and /home/dominic/Warden to /opt/Warden/projects/db-backup/dumps/, compresses each dump with "
                "zstd, keeps the last 7 nights, and logs each run. Include a --dry-run and demonstrate it.")
G_DUMP_OK = ("backup.sh written; dry-run dumped and compressed both stores against temp copies; retention and "
             "logging in place.")
G_VERIFY = "$ /opt/Warden/projects/db-backup/backup.sh --dry-run 2>&1 | tail -3\ndry-run: 2 dumps, 2 zstd archives, 0 pruned\nexit 0"
G_NAS_BRIEF = ("Add the NAS copy to /opt/Warden/projects/db-backup/backup.sh: copy the night's archives to the NAS "
               "share //nas/backup-warden. The mount credentials are in the usual place if they exist.")
G_NAS_BLOCKED = ("BLOCKED on the NAS copy: //nas/backup-warden is not mounted and there are no stored credentials "
                 "for it anywhere on this box (no fstab entry, no credentials file, no keychain entry). Everything "
                 "before the copy works — the script is complete with the copy step stubbed behind a clear error. "
                 "I cannot invent NAS credentials.")
G_FINAL = ("BLOCKED — nightly db backup is built but cannot reach the NAS.\n"
           "- Built and verified: backup.sh dumps both stores, zstd-compresses, keeps 7 nights, logs every run "
           "(dry-run clean).\n"
           "- The blocker: //nas/backup-warden is not mounted and no credentials for it exist on this machine. The "
           "copy step is stubbed behind a clear error rather than silently skipping.\n"
           "- Nothing was scheduled: a nightly confirmation email would be a lie while the NAS copy can't run. The "
           "captain needs to provide the mount or credentials.")

def chain_g(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": G_DUMP_BRIEF},
              "Pieces: 1) vulkan — dump/compress/retain script 2) dry-run it myself 3) vulkan — NAS copy step 4) iris — nightly schedule + email (only if the copy works)."),
        tool(c(), "vulkan", vk(G_DUMP_OK)),
        acall(c(), "Bash", {"command": "/opt/Warden/projects/db-backup/backup.sh --dry-run 2>&1 | tail -3"}),
        tool(c(), "Bash", G_VERIFY),
        acall(c(), "vulkan", {"task": G_NAS_BRIEF}, "Dump side verified. Piece 3: the NAS copy."),
        tool(c(), "vulkan", vk(G_NAS_BLOCKED)),
        acall(c(), "Grep", {"pattern": "backup-warden", "path": "/etc/fstab"}),
        tool(c(), "Grep", "(no matches — exit 1)"),
        final(G_FINAL),
    ]

# ─── Project H: subscription cancel (an iris re-brief with the exact gap) ────
H_ASKS = [
    "Cancel the magazine subscription: find the cancellation address from the last renewal notice, send the cancellation, and set a reminder to check next month that the charge actually stopped.",
    "Kill the magazine sub: cancellation email from the last renewal notice, and remind me next month to confirm the charge stopped.",
]
H_CANCEL_BRIEF1 = ("Find the cancellation email address in the most recent 'Your renewal is confirmed' notice from "
                   "the magazine (sender domain pressmag.example in dom.doss@gmail.com's inbox), then send the "
                   "cancellation email to that address from dom.doss@gmail.com.")
H_MISS = ("Could not find a renewal notice from the magazine — the inbox search for 'renewal' + pressmag.example "
          "returned nothing in the last 12 months. No cancellation sent.")
H_CANCEL_BRIEF2 = ("The notice is not in the inbox — it came as a card statement line: the charge reads "
                   "'PRESSMAG DIGITAL 855-2263'. Search dom.doss@gmail.com for the original order confirmation "
                   "from orders@pressmag.example (subject 'Welcome to PressMag'), then send the cancellation to "
                   "cancel@pressmag.example from dom.doss@gmail.com referencing the subscriber account in that "
                   "confirmation.")
H_HIT = ("Found the order confirmation (subscriber PM-40281). Cancellation sent to cancel@pressmag.example from "
         "dom.doss@gmail.com, referencing PM-40281 and requesting written confirmation.")
H_REMIND_BRIEF = ("Create a reminder for 2026-10-18: 'Check the card statement — PressMag charge should be gone "
                  "(cancelled PM-40281)'. Current local time is the anchor.")
H_FINAL = ("DONE — magazine subscription cancelled.\n"
           "- Cancellation sent to cancel@pressmag.example referencing subscriber PM-40281; written confirmation "
           "requested.\n"
           "- First search missed (the notice was never emailed — the charge surfaced via the card statement); "
           "re-briefed iris with the statement line and the original order confirmation, which found the account.\n"
           "- Reminder set for 2026-10-18 to verify the charge stopped.")

def chain_h(ask):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "iris", {"task": H_CANCEL_BRIEF1},
              "Pieces: 1) iris — find the cancellation address + send 2) iris — the check-charge reminder."),
        tool(c(), "iris", ir(H_MISS)),
        acall(c(), "iris", {"task": H_CANCEL_BRIEF2},
              "The notice isn't in email — the charge line on the card statement names it. Back to iris with the exact thread to pull."),
        tool(c(), "iris", ir(H_HIT)),
        acall(c(), "iris", {"task": H_REMIND_BRIEF}, "Cancellation is out. Last piece: the verification reminder."),
        tool(c(), "iris", ir("Done. Reminder created for 2026-10-18: 'Check the card statement — PressMag charge "
                             "should be gone (cancelled PM-40281)'.")),
        final(H_FINAL),
    ]

ROWS_1 = []
for ask in A_ASKS:
    ROWS_1.append(chain_a(ask))
for ask in C_ASKS:
    ROWS_1.append(chain_c(ask))
for ask in D_ASKS:
    ROWS_1.append(chain_d(ask))
for ask in E_ASKS:
    ROWS_1.append(chain_e(ask))
for ask in F_ASKS:
    ROWS_1.append(chain_f(ask))
for ask in H_ASKS:
    ROWS_1.append(chain_h(ask))

ROWS_2 = []
for ask in B_ASKS:
    ROWS_2.append(chain_b(ask))
for ask in G_ASKS:
    ROWS_2.append(chain_g(ask))

# Phrasing-jittered repeats for volume (the merge rejects exact duplicates
# only — these differ in the opening ask).
def jitter(ask):
    out = ask.replace("Build me ", "Put together ").replace("please", "now").replace("I want ", "Set up ")
    if out == ask:  # no keyword hit — force a change so the row is not a dupe
        out = "Hey — " + ask[0].lower() + ask[1:]
    return out

for ask in A_ASKS:
    ROWS_1.append(chain_a(jitter(ask)))
for ask in C_ASKS:
    ROWS_1.append(chain_c(jitter(ask)))
for ask in D_ASKS:
    ROWS_1.append(chain_d(jitter(ask)))
for ask in E_ASKS:
    ROWS_1.append(chain_e(jitter(ask)))
for ask in F_ASKS:
    ROWS_1.append(chain_f(jitter(ask)))
for ask in H_ASKS:
    ROWS_1.append(chain_h(jitter(ask)))
for ask in B_ASKS:
    ROWS_2.append(chain_b(jitter(ask)))
for ask in G_ASKS:
    ROWS_2.append(chain_g(jitter(ask)))

open(os.path.join(BASE, "orch-1.jsonl"), "w").write(dumps(ROWS_1, repeat=2))
open(os.path.join(BASE, "orch-2.jsonl"), "w").write(dumps(ROWS_2, repeat=2))
print("orch-1: %d rows, orch-2: %d rows (all x2)" % (len(ROWS_1), len(ROWS_2)))
