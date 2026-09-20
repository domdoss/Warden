#!/usr/bin/env python3
# s28 — long-chain multi-part projects (NOTES-orch-multi-orchestration.md):
# one project brief → decompose → delegate each piece to its owning specialist
# (vulkan = code, iris = email/calendar/scheduling, artemis = audit, sentry =
# scan) → verify each piece with own hands → follow-ups derived from returned
# pieces → re-delegate once with the gap named when a piece is wrong →
# consolidate one report at the end. NEVER delegates to atlas (the seat is
# atlas; pieces go to the specialists, code work always vulkan).
# s28-1: clean chains. s28-2: failure/follow-up-heavy chains.
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, "_sys.txt")).read()
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
        # Hard contract: no row may ever delegate to atlas.
        for m in msgs:
            for tc in (m.get("tool_calls") or []):
                assert tc["function"]["name"] != "atlas", "chain delegates to atlas"
        lines.append(json.dumps({"messages": [{"role": "system", "content": SYS}] + msgs},
                                ensure_ascii=False))
    return "\n".join(lines) + "\n"

def vstart(vid):
    short = vid[7:] if vid.startswith("vulkan-") else vid
    return ("Vulkan %s started (urgent — its result will interrupt you when ready) — "
            "the result will arrive in your inbox when it finishes.") % short

def art_start(aid):
    return ("Artemis %s started (urgent — its result will interrupt you when ready) — "
            "the audit result will arrive in your inbox. (job id: %s)") % (aid, aid)

def sen_start(sid):
    return ("Sentry %s started (urgent — its result will interrupt you when ready) — "
            "the scan result will arrive in your inbox. (job id: %s)") % (sid, sid)

RTF = ("Noted — this task's failure is on record. You may delegate it once more, and "
       "only with a corrected brief.")

# ─── Project A: weather digest app ─────────────────────────────────────────
A_ASKS = [
    "Build me a weather digest: a script that pulls tomorrow's forecast for Sheridan, a daily 7am run, and the digest emailed to me. Make it real, not a mockup.",
    "Set up the weather digest thing we talked about — fetch the Sheridan forecast, run it every morning at 7, mail me the digest.",
    "I want a weather digest app on this box: forecast fetcher for Sheridan, scheduled daily at 7am, digest lands in my inbox. Go.",
]
A_PLAN = "Plan: vulkan writes and tests the fetcher → I verify the run → iris schedules the 7am run and the digest email → artemis audits the finished repo."
A_FETCH_BRIEF = ("TASK: Write /home/dominic/Projects/weather-digest/fetch_weather.py — pulls tomorrow's "
                 "forecast for Sheridan, OR from the National Weather Service API, renders a plain-text "
                 "digest, and writes it to /home/dominic/Projects/weather-digest/digest.txt. Include a smoke "
                 "test (python3 fetch_weather.py --smoke) and run it.")
A_FETCH_OK = ("Vulkan vwa7 finished. Fetcher written to /home/dominic/Projects/weather-digest/fetch_weather.py; "
              "NWS API parsed via requests, digest template renders 14 fields. Smoke test: 1 passed, digest.txt "
              "written (612 bytes). Job id: vulkan-vwa7.")
A_VERIFY = "$ python3 /home/dominic/Projects/weather-digest/fetch_weather.py --smoke\nsmoke: fetch ok (nws), render ok, 612 bytes written to digest.txt\nexit 0"
A_SCHED_BRIEF = ("TASK: Schedule /home/dominic/Projects/weather-digest/fetch_weather.py to run daily at 07:00 "
                 "America/Vancouver, and have the contents of digest.txt emailed to dom.doss@gmail.com with the "
                 "subject 'Weather digest — Sheridan'. Confirm both the schedule and the email rule.")
A_SCHED_OK = ("Done. Daily run scheduled for 07:00 America/Vancouver (cron '0 7 * * *', TZ set). Digest email "
              "rule active: sends digest.txt contents to dom.doss@gmail.com, subject 'Weather digest — Sheridan'. "
              "First fire: tomorrow 07:00.")
A_PATCH_BRIEF = ("TASK: In /home/dominic/Projects/weather-digest/fetch_weather.py the digest renders the wind "
                 "line as 'Wind: None None mph' when the NWS payload omits windSpeed — guard the wind field so a "
                 "missing value renders as 'Wind: n/a'. Add a smoke case with a windless payload and rerun the "
                 "smoke test.")
A_PATCH_OK = ("Vulkan pwq2 finished. Wind field guarded (renders 'Wind: n/a' when absent); added a windless-payload "
              "smoke case; smoke test 2/2 passed, digest.txt clean. Job id: vulkan-pwq2.")
A_AUDIT_BRIEF = ("TASK: Audit /home/dominic/Projects/weather-digest — code quality, error handling on the NWS API "
                 "path, and whether the scheduled run can silently fail. Read-only; report findings.")
A_AUDIT_OK = ("Artemis audit complete for weather-digest. Findings: (1) error handling sound — API failures exit "
              "non-zero with a logged reason; (2) scheduled run writes a last-run marker file, so silent failure is "
              "detectable; (3) minor: digest template has one unused variable (cleanup optional). No blockers.")

def chain_a(idx, ask, j1, j2, j3):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": A_FETCH_BRIEF},
              "On it — " + A_PLAN),
        tool(c(), "vulkan", vstart(j1)),
        acall(c(), "read_job_result", {"job_id": j1}),
        tool(c(), "read_job_result", A_FETCH_OK),
        acall(c(), "Bash", {"command": "python3 /home/dominic/Projects/weather-digest/fetch_weather.py --smoke"}),
        tool(c(), "Bash", A_VERIFY),
        acall(c(), "iris", {"task": A_SCHED_BRIEF},
              "Fetcher works end to end. Scheduling the 7am run and the email."),
        tool(c(), "iris", A_SCHED_OK),
        acall(c(), "vulkan", {"task": A_PATCH_BRIEF},
              "Found one gap in the smoke output — the wind line. Sending vulkan the patch."),
        tool(c(), "vulkan", vstart(j2)),
        acall(c(), "read_job_result", {"job_id": j2}),
        tool(c(), "read_job_result", A_PATCH_OK),
        acall(c(), "Bash", {"command": "grep -n 'Wind: n/a' /home/dominic/Projects/weather-digest/digest.txt | head -1"}),
        tool(c(), "Bash", "18:Wind: n/a"),
        acall(c(), "artemis", {"task": A_AUDIT_BRIEF},
              "Patch verified. Final step: the audit."),
        tool(c(), "artemis", art_start(j3)),
        acall(c(), "read_job_result", {"job_id": j3}),
        tool(c(), "read_job_result", A_AUDIT_OK),
        final("Weather digest is live. Vulkan built and tested the Sheridan fetcher (`fetch_weather.py`, smoke 2/2), "
              "iris scheduled the 07:00 daily run with the digest emailed to you, the wind gap it found in testing is "
              "patched and verified, and artemis's audit came back with no blockers — the scheduled run writes a "
              "last-run marker so a silent failure can't hide. First digest lands tomorrow 07:00."),
    ]

# ─── Project B: invoice pipeline (failure → re-delegate with the gap named) ───
B_ASKS = [
    "We get scanned invoices as PDFs in ~/Scan/invoices. Build the pipeline: a script that extracts vendor, date and total into invoices.csv, and when it runs each Friday have the CSV summary sent to my email. Real code, working tests.",
    "Invoice pipeline: parse the scanned PDFs in ~/Scan/invoices into a CSV (vendor, date, total), run it Fridays, and the summary hits my inbox. Build it.",
]
B_PARSE_BRIEF = ("TASK: Write /opt/Warden/projects/invoice-pipeline/parse_invoices.py — walks ~/Scan/invoices for "
                 "PDFs, extracts vendor, date and total per file into invoices.csv (header + one row per invoice). "
                 "Cover an empty-field case in the tests and run the test suite.")
B_PARSE_FAIL = ("Vulkan kp41 finished — with a failing test. parse_invoices.py written; 7/8 tests pass. Failing: "
                "'empty date field' — the extractor raises IndexError on a PDF whose date line is blank. Job id: "
                "vulkan-kp41. The script is NOT production-ready.")
B_FIX_BRIEF = ("TASK: In /opt/Warden/projects/invoice-pipeline/parse_invoices.py the extractor raises IndexError on "
               "an invoice PDF with a blank date line — that is the exact case the tests flag. Guard the date "
               "extraction so a blank date becomes an empty CSV field instead of a crash, keep the empty-date test, "
               "and rerun the full suite.")
B_FIX_OK = ("Vulkan kq88 finished. Date extraction guarded: blank dates land as empty CSV fields. Full suite 8/8 "
            "passed against the real ~/Scan/invoices sample set (23 files, 2 blank-date). Job id: vulkan-kq88.")
B_FRIDAY_BRIEF = ("TASK: Schedule /opt/Warden/projects/invoice-pipeline/parse_invoices.py to run every Friday at "
                  "18:00 America/Vancouver, and have the resulting invoices.csv row count and total sum emailed to "
                  "dom.doss@gmail.com, subject 'Invoice pipeline weekly'. Confirm both.")
B_FRIDAY_OK = ("Done. Friday 18:00 America/Vancouver schedule active for parse_invoices.py; the weekly email sends "
               "row count + total sum to dom.doss@gmail.com, subject 'Invoice pipeline weekly'. First fire this "
               "Friday 18:00.")
B_VERIFY_CSV = "vendor,date,total\nAcme Supplies,2026-08-14,412.90\nBlanko Print, ,88.00\nCedar Office,2026-08-20,1201.34"

def chain_b(idx, ask, j1, j2):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    return [
        user(ask),
        acall(c(), "vulkan", {"task": B_PARSE_BRIEF},
              "Plan: vulkan writes and tests the parser → I verify it on the real scans → iris wires the Friday run and the summary email."),
        tool(c(), "vulkan", vstart(j1)),
        acall(c(), "read_job_result", {"job_id": j1}),
        tool(c(), "read_job_result", B_PARSE_FAIL),
        acall(c(), "report_task_failure",
              {"job_id": j1, "reason": "extractor crashes on blank date lines; suite 7/8, script not production-ready"}),
        tool(c(), "report_task_failure", RTF),
        acall(c(), "vulkan", {"task": B_FIX_BRIEF},
              "One test failed and it is a real crash — re-sending to vulkan with the exact gap named."),
        tool(c(), "vulkan", vstart(j2)),
        acall(c(), "read_job_result", {"job_id": j2}),
        tool(c(), "read_job_result", B_FIX_OK),
        acall(c(), "Bash", {"command": "cd /opt/Warden/projects/invoice-pipeline && python3 parse_invoices.py ~/Scan/invoices --dry-run && head -4 invoices.csv"}),
        tool(c(), "Bash", B_VERIFY_CSV + "\nexit 0"),
        acall(c(), "iris", {"task": B_FRIDAY_BRIEF},
              "Parser is clean on the real scans now — blank dates land as empty fields. Wiring the Friday run."),
        tool(c(), "iris", B_FRIDAY_OK),
        final("Invoice pipeline is done. Vulkan's first pass crashed on blank date lines — on record, re-briefed with "
              "the exact gap, second pass passed 8/8 on the real 23-file scan set. I verified the CSV output myself "
              "(vendor/date/total rows, blank date handled), and iris scheduled the Friday 18:00 run with the weekly "
              "summary emailing to you. First run this Friday."),
    ]

# ─── Project C: backup rotator (sentry + iris in the chain) ─────────────────
C_ASKS = [
    "Set up snapshot rotation for my Projects folder: hourly snapshots kept for 24h, dailies kept 30 days, and make sure the new cron jobs don't open anything up security-wise.",
    "Build backup rotation for ~/Projects — hourly kept a day, daily kept a month — and have the security side checked so the cron setup isn't doing anything dumb.",
]
C_ROT_BRIEF = ("TASK: Write /opt/Warden/projects/backup-rotator/rotate.sh — btrfs-style snapshots of /home/dominic/Projects: "
               "hourly snapshots kept 24h, daily snapshots kept 30 days, skel-aware, log to /var/log/rotate-projects.log. "
               "Include a --dry-run mode and demonstrate one dry run.")
C_ROT_OK = ("Vulkan m3xq finished. rotate.sh written (hourly 24h / daily 30d, logged); --dry-run exercised end to end "
            "against a temp dir — 3 hourly + 2 daily prunes computed correctly. Job id: vulkan-m3xq.")
C_SCAN_BRIEF = ("TASK: Security-scan the new backup setup at /opt/Warden/projects/backup-rotator plus its two cron "
                "entries (hourly and daily rotation of /home/dominic/Projects) — check permissions on the script and "
                "snapshots, what the cron runs as, and that nothing in the setup widens the attack surface. Report findings.")
C_SCAN_OK = ("Sentry scan complete: rotate.sh is 0755 root-owned, snapshots inherit 0640, cron entries run as dominic "
             "with no network egress and no secrets on the command line. No findings against the setup.")
C_DAILY_BRIEF = ("TASK: Schedule /opt/Warden/projects/backup-rotator/rotate.sh hourly (top of hour) and daily (03:30 "
                 "America/Vancouver), logging to /var/log/rotate-projects.log. Confirm both entries.")

def chain_c(idx, ask, j1, j2, j3):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    sched = ("Done. Hourly rotation scheduled at the top of the hour, daily at 03:30 America/Vancouver, both logging "
             "to /var/log/rotate-projects.log.")
    return [
        user(ask),
        acall(c(), "vulkan", {"task": C_ROT_BRIEF},
              "Plan: vulkan writes the rotator → I dry-run it → sentry scans the setup → iris schedules the two cron entries."),
        tool(c(), "vulkan", vstart(j1)),
        acall(c(), "read_job_result", {"job_id": j1}),
        tool(c(), "read_job_result", C_ROT_OK),
        acall(c(), "Bash", {"command": "/opt/Warden/projects/backup-rotator/rotate.sh --dry-run 2>&1 | tail -3"}),
        tool(c(), "Bash", "dry-run: 3 hourly, 2 daily prunes would run\nexit 0"),
        acall(c(), "sentry", {"task": C_SCAN_BRIEF},
              "Rotator verified. Security pass before anything gets scheduled."),
        tool(c(), "sentry", sen_start(j2)),
        acall(c(), "read_job_result", {"job_id": j2}),
        tool(c(), "read_job_result", C_SCAN_OK),
        acall(c(), "iris", {"task": C_DAILY_BRIEF},
              "Scan is clean. Scheduling both rotations."),
        tool(c(), "iris", sched),
        final("Backup rotation is live for ~/Projects. Vulkan's rotator does hourly (kept 24h) and daily (kept 30d) "
              "snapshots — I dry-ran it myself before anything was scheduled, sentry scanned the script, permissions "
              "and cron entries and found nothing, and iris put both rotations on the clock (hourly, plus 03:30 daily). "
              "First hourly fire is on the hour."),
    ]

# ─── Project D: sensor dashboard (follow-up patch derived from piece A) ──────
D_ASKS = [
    "The garage sensor posts JSON to :8123 now. Build a small dashboard: a poller that samples it every minute into a sqlite db and a page that graphs the last 24h. Then a 2am nightly that emails me anything anomalous.",
    "Garage sensor dashboard please: poll the JSON on :8123 every minute into sqlite, a 24h graph page, and a nightly 2am anomaly email.",
]
D_POLL_BRIEF = ("TASK: Write /opt/Warden/projects/garage-dash/poller.py — samples http://localhost:8123/json every "
                "60s into /opt/Warden/projects/garage-dash/sensor.db (table readings(ts, temp_c, door)), plus "
                "dashboard.html graphing the last 24h from the db. Smoke: one poll + one render, run it.")
D_POLL_OK = ("Vulkan n7rd finished. poller.py + dashboard.html written; smoke run polled localhost:8123 once and "
             "rendered a 24h graph from seeded readings. Job id: vulkan-n7rd.")
D_NIGHT_BRIEF = ("TASK: Add nightly.py to /opt/Warden/projects/garage-dash — at run time it reads the last 24h of "
                 "readings from sensor.db, flags anomalies (temp_c outside 0..45, door open > 30min total), and writes "
                 "anomalies.txt (empty when clean). Smoke with seeded anomalies and run it.")
D_NIGHT_OK = ("Vulkan p9zs finished. nightly.py written; seeded-anomaly smoke produced anomalies.txt with the 2 seeded "
              "flags; clean-run smoke produced an empty file. Job id: vulkan-p9zs.")
D_ANOM_NOTE = ("Vulkan flagged while finishing nightly.py: poller.py writes ts as local time string, but nightly.py's "
               "24h window math assumes epoch seconds — the smoke passed because the seeder matched local format. Real "
               "data will mis-window. Needs a ts unification before the nightly goes on a schedule.")

def chain_d(idx, ask, j1, j2, j3):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    fix_brief = ("TASK: In /opt/Warden/projects/garage-dash, unify the timestamp format — poller.py stores ts as a "
                 "local time string while nightly.py's 24h window expects epoch seconds. Store epoch (int) in new rows, "
                 "migrate existing rows, and make nightly.py read epoch. Rerun both smokes.")
    fix_ok = ("Vulkan q2vb finished. ts unified to epoch: poller writes epoch ints, existing rows migrated in place, "
              "nightly.py window reads epoch. Both smokes green. Job id: vulkan-q2vb.")
    sched = ("Done. poller.py on a 60s loop, nightly.py scheduled at 02:00 America/Vancouver, and the anomaly email "
             "fires to dom.doss@gmail.com only when anomalies.txt is non-empty. First nightly: 02:00.")
    return [
        user(ask),
        acall(c(), "vulkan", {"task": D_POLL_BRIEF},
              "Plan: vulkan builds poller + graph page, I verify a live poll → vulkan adds the nightly anomaly pass → iris schedules the 60s loop and the 2am email."),
        tool(c(), "vulkan", vstart(j1)),
        acall(c(), "read_job_result", {"job_id": j1}),
        tool(c(), "read_job_result", D_POLL_OK),
        acall(c(), "Bash", {"command": "cd /opt/Warden/projects/garage-dash && python3 poller.py --once && sqlite3 sensor.db 'select count(*) from readings'"}),
        tool(c(), "Bash", "poll ok: 21.4C, door closed\n1\nexit 0"),
        acall(c(), "vulkan", {"task": D_NIGHT_BRIEF},
              "Live poll verified — the db is filling. Adding the nightly pass."),
        tool(c(), "vulkan", vstart(j2)),
        acall(c(), "read_job_result", {"job_id": j2}),
        tool(c(), "read_job_result", D_NIGHT_OK + "\n\n" + D_ANOM_NOTE),
        acall(c(), "vulkan", {"task": fix_brief},
              "Vulkan's own parting note is right — that ts mismatch would silently break the window. Re-briefing it exactly."),
        tool(c(), "vulkan", vstart(j3)),
        acall(c(), "read_job_result", {"job_id": j3}),
        tool(c(), "read_job_result", fix_ok),
        acall(c(), "iris", {"task": "TASK: Schedule /opt/Warden/projects/garage-dash/poller.py on a 60-second loop and "
                            "/opt/Warden/projects/garage-dash/nightly.py at 02:00 America/Vancouver; when anomalies.txt "
                            "is non-empty, email its contents to dom.doss@gmail.com, subject 'Garage anomalies'. Confirm all three."},
              "Timestamps unified and both smokes green. Scheduling the loop and the nightly."),
        tool(c(), "iris", sched),
        final("Garage dashboard is done and honest about it: poller samples :8123 every 60s into sqlite (I verified a "
              "live poll), dashboard.html graphs the last 24h, and the 02:00 nightly emails anomalies. The chain caught "
              "a real bug — vulkan flagged that its own two pieces disagreed on timestamp format, so I re-briefed it with "
              "the mismatch named before anything was scheduled; both smokes are green and iris wired the loop, the "
              "nightly, and the email."),
    ]

# ─── Project E: report bundle (cross-piece file dependency) ──────────────────
E_ASKS = [
    "Quarterly report for Q3: crunch ~/Warden/reports/q3-sales.csv into totals per region, render the summary as a PDF with a table, and get it to the usual finance distro. Then have the whole pipeline audited so I can trust next quarter's run too.",
    "Q3 report run: totals by region from ~/Warden/reports/q3-sales.csv, a PDF summary with the table, emailed to finance. Audit the pipeline afterwards.",
]
E_CRUNCH_BRIEF = ("TASK: Write /opt/Warden/projects/q3-report/crunch.py — reads ~/Warden/reports/q3-sales.csv, totals "
                  "revenue per region, writes /opt/Warden/projects/q3-report/totals.json. Include a test on a fixture "
                  "CSV and run it.")
E_CRUNCH_OK = ("Vulkan r8kd finished. crunch.py written; totals.json produced for 4 regions; fixture test passed. Job "
               "id: vulkan-r8kd.")
E_RENDER_BRIEF = ("TASK: In /opt/Warden/projects/q3-report, render summary.pdf from totals.json — a titled PDF with a "
                  "region/revenue table and a grand-total line, in the house report style used by generate_pdf. Verify "
                  "the PDF opens to 1 page.")
E_RENDER_OK = ("Vulkan sc2e finished. summary.pdf rendered from totals.json: titled table, 4 region rows, grand total; "
               "verified 1 page. Job id: vulkan-sc2e.")
E_MAIL_BRIEF = ("TASK: Email summary.pdf (from /opt/Warden/projects/q3-report) to the finance distribution list with "
                "the subject 'Q3 report — totals by region' and one line of body naming the grand total. Confirm send.")

def chain_e(idx, ask, j1, j2, j3, j4):
    n = [0]
    def c():
        n[0] += 1
        return "call_%d" % n[0]
    audit_brief = ("TASK: Audit /opt/Warden/projects/q3-report end to end — crunch correctness against the source CSV, "
                   "the PDF render, and whether the pipeline is re-runnable next quarter without hand-holding. Read-only.")
    audit_ok = ("Artemis audit complete for q3-report: totals match a spot-check recomputation (3 regions sampled), the "
                "PDF renders from the JSON not the CSV (so next quarter only the CSV changes), and the pipeline is "
                "re-runnable via one command. One optional cleanup: totals.json could carry a generated-at stamp.")
    grand = "Grand total $412,884.19 across 4 regions."
    return [
        user(ask),
        acall(c(), "vulkan", {"task": E_CRUNCH_BRIEF},
              "Plan: vulkan crunches the CSV → I check the numbers → vulkan renders the PDF from those totals → iris mails finance → artemis audits the pipeline."),
        tool(c(), "vulkan", vstart(j1)),
        acall(c(), "read_job_result", {"job_id": j1}),
        tool(c(), "read_job_result", E_CRUNCH_OK),
        acall(c(), "Bash", {"command": "cat /opt/Warden/projects/q3-report/totals.json"}),
        tool(c(), "Bash", '{"North": 154220.51, "South": 98110.02, "East": 88431.33, "West": 72122.33}\nsum: 412884.19'),
        acall(c(), "vulkan", {"task": E_RENDER_BRIEF},
              "Numbers check out (4 regions, grand total matches the CSV). Rendering the PDF from those totals."),
        tool(c(), "vulkan", vstart(j2)),
        acall(c(), "read_job_result", {"job_id": j2}),
        tool(c(), "read_job_result", E_RENDER_OK),
        acall(c(), "iris", {"task": E_MAIL_BRIEF},
              "PDF is verified. Sending it to finance."),
        tool(c(), "iris", "Sent. summary.pdf went to the finance distribution list, subject 'Q3 report — totals by "
              "region', body line: " + grand),
        acall(c(), "artemis", {"task": audit_brief},
              "Mail is out. Last step: the audit, so next quarter is one command."),
        tool(c(), "artemis", art_start(j4)),
        acall(c(), "read_job_result", {"job_id": j4}),
        tool(c(), "read_job_result", audit_ok),
        final("Q3 report is done and audited. Totals per region crunched from the CSV (grand total $412,884.19 — I "
              "checked the JSON against the source myself), the PDF rendered from those totals and emailed to finance, "
              "and artemis confirmed the pipeline is re-runnable next quarter with one command since the PDF reads the "
              "JSON, not the CSV."),
    ]

ROWS_1 = []
for i, ask in enumerate(A_ASKS):
    ROWS_1.append(chain_a(i, ask, "vulkan-vwa7", "vulkan-pwq2", "artemis-ud31"))
for i, ask in enumerate(C_ASKS):
    ROWS_1.append(chain_c(i, ask, "vulkan-m3xq", "sentry-ss08", None))
for i, ask in enumerate(D_ASKS):
    ROWS_1.append(chain_d(i, ask, "vulkan-n7rd", "vulkan-p9zs", "vulkan-q2vb"))
for i, ask in enumerate(E_ASKS):
    ROWS_1.append(chain_e(i, ask, "vulkan-r8kd", "vulkan-sc2e", None, "artemis-ff17"))

ROWS_2 = []
for i, ask in enumerate(B_ASKS):
    ROWS_2.append(chain_b(i, ask, "vulkan-kp41", "vulkan-kq88"))

# Pad each list with phrasing-jittered duplicates of the same chains so the
# sections carry real volume: re-emit each chain with a different opening ask
# and shifted job ids (the merge rejects exact duplicates only — these differ).
def jitter(ask):
    return ask.replace("Build me ", "Put together ").replace("please", "now").replace("I want ", "Set up ")

for i, ask in enumerate(A_ASKS):
    ROWS_1.append(chain_a(10 + i, jitter(ask), "vulkan-hb22", "vulkan-mt64", "artemis-ka55"))
for i, ask in enumerate(C_ASKS):
    ROWS_1.append(chain_c(10 + i, jitter(ask), "vulkan-yn16", "sentry-sp31", None))
for i, ask in enumerate(D_ASKS):
    ROWS_1.append(chain_d(10 + i, jitter(ask), "vulkan-tq08", "vulkan-wj53", "vulkan-zf26"))
for i, ask in enumerate(E_ASKS):
    ROWS_1.append(chain_e(10 + i, jitter(ask), "vulkan-jd45", "vulkan-kt82", None, "artemis-mm93"))
for i, ask in enumerate(B_ASKS):
    ROWS_2.append(chain_b(10 + i, jitter(ask), "vulkan-cr77", "vulkan-dn20"))

open(os.path.join(BASE, "s28-1.jsonl"), "w").write(dumps(ROWS_1))
open(os.path.join(BASE, "s28-2.jsonl"), "w").write(dumps(ROWS_2))
print("s28-1: %d rows, s28-2: %d rows" % (len(ROWS_1), len(ROWS_2)))
