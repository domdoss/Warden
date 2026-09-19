#!/usr/bin/env python3
# s25 — artemis: "what went wrong" (audit/second-opinion seat) + the dividing
# line between a cheap self-check (list_running_agents / agent_logs /
# read_job_result) and a real diagnosis handed to artemis. 25 rows, 1 file.
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, "_sys.txt")).read().rstrip()
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"

def user(ask):
    return {"role": "user", "content": ANCHOR + ask}

def asst(text):
    return {"role": "assistant", "content": text}

def call(name, args):
    return {"role": "assistant", "content": "",
            "tool_calls": [{"type": "function", "function": {"name": name, "arguments": args}}]}

def tool(name, content):
    return {"role": "tool", "name": name, "content": content}

def row(msgs):
    return {"messages": [{"role": "system", "content": SYS}] + msgs}

REPORT_BACK_TAIL = (
    "\n\nFor each result, run the CONFIRM step before anything else: compare it against what the user "
    "originally asked for — that ask is in your context.\n"
    "1. CONFIRMED — deliverable present and right. Media or window the user can already see or hear: "
    "stay silent. Else relay in one or two sentences.\n"
    "2. PROVEN-FAILED — the result itself shows the deliverable is wrong or missing (the path it claims "
    "to have written doesn't match the request, the answer contradicts the ask, the job errored or was "
    "aborted), OR the supervisor verdict above is FAILED. Call report_task_failure with the task and the "
    "reason, then re-delegate ONCE to the right specialist, naming the GAP — what was wanted versus what "
    "came back — never the fix. If the runner refuses the re-delegation, that refusal is final: tell the "
    "user plainly what failed and why, and stop.\n"
    "3. UNVERIFIABLE FROM TEXT — whether it worked depends on screen or system state you cannot see from "
    "this result and the result names a concrete outcome. Trust it and move on.\n"
    "CHAIN: if a result is one step of a larger request, take the next step yourself now — without waiting "
    "for the user. Stop only when the whole task is done or you are genuinely blocked. Do not paste raw "
    "output verbatim; speak the outcome.\n"
    "FORMAT: the reply is chat to the captain, not a report. One or two plain sentences per result, "
    "carrying the outcome itself. No headers, no bullets, no restating the ask or the job id, no verdict "
    "words, no next-steps offers."
)

def report_back(job_line, result_text):
    return ("REPORT-BACK TURN — jobs below are FINISHED. Report each result.\n\n"
            "[Inbox] 1 background job result completed:\n\n"
            "- %s\nResult:\n%s" % (job_line, result_text) + REPORT_BACK_TAIL)

rows = []

# 1. Classic — report never came back, direct voice.
rows.append(row([
    user("hey did the monday report ever come back? i never saw anything land and it's already after lunch"),
    call("artemis", {"task": "Find out why the Monday report never delivered a result — it was expected by midday and nothing has shown up in the inbox."}),
    tool("artemis", "Artemis a7f2 started — the audit result will arrive in your inbox. (job id: artemis-a7f2)"),
    asst("Artemis is digging through the logs — I'll bring you what it finds."),
]))

# 2. Classic — casual typo voice, "job just died didn't it".
rows.append(row([
    user("ok b honest lol did the backup job die again, its been almost an hour and nothin"),
    call("artemis", {"task": "Determine whether the backup job that was expected about an hour ago actually failed or is just still running — no outcome has appeared yet."}),
    tool("artemis", "Artemis k4tn started — the audit result will arrive in your inbox. (job id: artemis-k4tn)"),
    asst("Checking with artemis now — I'll tell you the moment it comes back."),
]))

# 3. Classic — rambling voice, "what happened to the thing I asked for this morning".
rows.append(row([
    user("so this morning around 9 i asked you to pull together that expense summary for the strata thing, and i just went to go look for it and there's nothing there, drafts folder's empty, nothing in my email either, what happened to it"),
    call("artemis", {"task": "Find out what happened to the strata expense summary requested around 9am this morning — it was expected in the drafts folder or by email and neither shows anything."}),
    tool("artemis", "Artemis 3bd8 started — the audit result will arrive in your inbox. (job id: artemis-3bd8)"),
    asst("Sending artemis after it now — I'll let you know what it turns up."),
]))

# 4. Cheap check — still running, list_running_agents, no artemis.
rows.append(row([
    user("is the weekly report job still chugging along or did it stall out"),
    call("list_running_agents", {}),
    tool("list_running_agents", "Running background jobs (1):\n- k91c (job id: atlas-k91c): 252s elapsed, 18 tool call(s), last action 12s ago: Write(/home/dominic/Warden/groups/dominic/report.md) | task: \"rebuild the weekly report\""),
    asst("Still going — about four minutes in, and it just wrote to report.md, so it's making real progress."),
]))

# 5. Cheap check — what did it actually do, agent_logs, no artemis.
rows.append(row([
    user("curious what atlas actually did on that db migration task before it wrapped up"),
    call("agent_logs", {"job_id": "atlas-k91c"}),
    tool("agent_logs", "Step-by-step activity (3 call(s)):\n[1] +0s Read(/opt/Warden/src/db.ts) → 412 lines\n[2] +7s Grep(migrateToDesktopSchema) → 3 matches\n[3] +21s Write(/home/dominic/Warden/groups/dominic/report.md) → wrote 2.1 KB"),
    asst("It read through db.ts, grepped for migrateToDesktopSchema, then wrote the report — three clean steps, nothing hung."),
]))

# 6. Cheap check — full text of a finished job, read_job_result, no artemis.
rows.append(row([
    user("can you just show me exactly what vulkan wrote for that finished drafting job"),
    call("read_job_result", {"job_id": "vulkan-q8vb"}),
    tool("read_job_result", "vulkan-q8vb (vulkan, done) — task: \"draft a reply to Dana about the budget review\"\n\nHi Dana,\n\nThursday works well for the budget review. Please bring the updated spreadsheet when you come.\n\nThanks,\nDominic"),
    asst("Here's what it wrote — confirms Thursday for the budget review and asks Dana to bring the updated spreadsheet."),
]))

# 7. Escalation — cheap checks come back empty, so it becomes a diagnosis for artemis.
rows.append(row([
    user("did the deploy script atlas-9f2a ever finish? i don't see it running and there's nothing to show for it"),
    call("list_running_agents", {}),
    tool("list_running_agents", "No background jobs currently running."),
    call("read_job_result", {"job_id": "atlas-9f2a"}),
    tool("read_job_result", "No stored result for \"atlas-9f2a\". Results live for this runner session only — use read_job_result with no arguments to list what is available."),
    call("artemis", {"task": "Find out what happened to the deploy script atlas-9f2a — it is not currently running and has no stored result, so its outcome needs to come from the logs directly."}),
    tool("artemis", "Artemis t7bn started — the audit result will arrive in your inbox. (job id: artemis-t7bn)"),
    asst("Nothing running and nothing saved for it, so I've sent artemis to dig through the logs for what actually happened."),
]))

# 8. Second opinion — "check yourself" before sending, thing to audit named inline.
rows.append(row([
    user("before i send this can you make sure you got the reply to jp right"),
    call("artemis", {"task": "Audit the JP meeting-confirmation reply saved at /home/dominic/Warden/drafts/response.txt against the original request — confirm it actually confirms Thursday 10am and mentions bringing the signed forms."}),
    tool("artemis", "Artemis x2wq started — the audit result will arrive in your inbox. (job id: artemis-x2wq)"),
    asst("Sending it to artemis for a second look before you send it — I'll confirm as soon as it's back."),
]))

# 9. Second opinion — "am I missing something", different domain (invoice).
rows.append(row([
    user("hold on before this invoice goes out, am i missing something obvious here"),
    call("artemis", {"task": "Check the invoice draft at /home/dominic/Warden/groups/dominic/invoice-22-1187.txt against what was actually agreed with the client for anything missing or wrong before it goes out."}),
    tool("artemis", "Artemis p9fd started — the audit result will arrive in your inbox. (job id: artemis-p9fd)"),
    asst("Having artemis run through it now — I'll flag anything before you send it."),
]))

# 10. Full chain — ask, artemis, PROVEN-FAILED landing (full REPORT-BACK block), corrected re-delegation to vulkan naming the gap.
rows.append(row([
    user("why did the monday report job never report back"),
    call("artemis", {"task": "Find out why the Monday report job never reported back — it was expected earlier and nothing arrived."}),
    tool("artemis", "Artemis z4jk started — the audit result will arrive in your inbox. (job id: artemis-z4jk)"),
    asst("Artemis is on it — I'll bring you what it finds."),
    user(report_back(
        "artemis-z4jk (artemis, done) — task: \"find out why the Monday report job never reported back\"",
        "What was asked: why the Monday report job never came back.\n"
        "1. atlas-h4mp exited at 08:41 with no result written — warden.log shows a stale 5-minute Ollama abort mid-Write, so the job died before it could report.\n"
        "2. The scheduled_tasks row for the Monday report still reads running; nothing retried it."
    )),
    call("report_task_failure", {"task": "rebuild the Monday report", "reason": "atlas exited mid-write on a stale Ollama timeout before writing any result, and the scheduled task never retried"}),
    tool("report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected approach that addresses the reason: atlas exited mid-write on a stale Ollama timeout before writing any result, and the scheduled task never retried"),
    call("vulkan", {"task": "TASK: The Monday report generation is dying partway through because a stale timeout aborts the write before it finishes — make the job survive a long write instead of getting cut off mid-way."}),
    tool("vulkan", "Vulkan e5cv started — the result will arrive in your inbox when it finishes."),
    asst("Found it — the report job was getting cut off by a stale timeout before it could finish writing, and nothing ever retried it. I've sent vulkan a corrected brief so it doesn't die mid-write again."),
]))

# 11. Full chain — ask, artemis, short inbox nudge + read_job_result, concrete one-line defect fixed directly with Edit.
rows.append(row([
    user("why did the weekly digest skill never fire this week"),
    call("artemis", {"task": "Find out why the weekly-report skill never ran automatically this week even though it's supposed to be on a schedule."}),
    tool("artemis", "Artemis w8lm started — the audit result will arrive in your inbox. (job id: artemis-w8lm)"),
    asst("Artemis is checking why it didn't fire — I'll have an answer shortly."),
    user("[inbox] Artemis w8lm finished."),
    call("read_job_result", {"job_id": "artemis-w8lm"}),
    tool("read_job_result", "artemis-w8lm (artemis, done) — task: \"find out why the weekly-report skill never ran automatically this week\"\n\nWhat was asked: why the weekly-report skill never fired this week.\n1. The skill's SKILL.md at /home/dominic/Warden/data/skills/weekly-report/SKILL.md has its schedule field set to \"0 9 * * one\" — not a valid cron field, so the scheduler silently skipped it.\n2. No error was logged because the parse failure happens before the scheduler ever queues the run."),
    call("Edit", {"file_path": "/home/dominic/Warden/data/skills/weekly-report/SKILL.md", "old_string": "0 9 * * one", "new_string": "0 9 * * 1"}),
    tool("Edit", "Applied 1 edit to /home/dominic/Warden/data/skills/weekly-report/SKILL.md"),
    asst("Found it — the schedule field had an invalid cron value, so it never queued a run. Fixed the field directly; it'll fire on schedule now."),
]))

# 12. Full chain — ask, artemis, short inbox landing, finding is "nothing wrong".
rows.append(row([
    user("did the overnight backup actually work? feels like it finished too fast"),
    call("artemis", {"task": "Confirm whether last night's backup job actually completed correctly and wasn't just cut short — the runtime looked suspiciously quick."}),
    tool("artemis", "Artemis n2ub started — the audit result will arrive in your inbox. (job id: artemis-n2ub)"),
    asst("Having artemis confirm — I'll tell you as soon as it's back."),
    user("[inbox] Artemis n2ub finished."),
    call("read_job_result", {"job_id": "artemis-n2ub"}),
    tool("read_job_result", "artemis-n2ub (artemis, done) — task: \"confirm whether last night's backup job completed correctly\"\n\nWhat was asked: whether the overnight backup actually completed correctly.\n1. The backup finished in 38s, which matches its historical average — nothing was skipped.\n2. All expected files are present in the destination directory with current timestamps."),
    asst("It's fine — 38 seconds is right in line with how long that backup normally takes, and everything landed where it should."),
]))

# 13. Urgent — user waiting right now, submission deadline.
rows.append(row([
    user("i need to submit this application in like 5 minutes, is the resume upload job still going or did it choke??"),
    call("artemis", {"task": "Find out immediately whether the resume-upload automation for this job application actually finished or failed — the user needs to submit within minutes.", "urgent": True}),
    tool("artemis", "Artemis y7ds started (urgent — its result will interrupt you when ready) — the audit result will arrive in your inbox. (job id: artemis-y7ds)"),
    asst("Artemis is checking right now, flagged urgent — it'll interrupt me the second it's back."),
]))

# 14. Urgent — client on the phone waiting.
rows.append(row([
    user("client's on the phone right now asking if the invoice went out, did it or not"),
    call("artemis", {"task": "Find out immediately whether the invoice email for permit 22-1187 actually sent — the client is on the phone waiting on the answer right now.", "urgent": True}),
    tool("artemis", "Artemis c9hx started (urgent — its result will interrupt you when ready) — the audit result will arrive in your inbox. (job id: artemis-c9hx)"),
    asst("Checking now, urgent — I'll interrupt you the moment artemis has the answer."),
]))

# 15. Full audit text requested by job id — read_job_result, substance relayed briefly, not the dump.
rows.append(row([
    user("read me the whole thing artemis said on the printer driver issue, job id artemis-v3ok, i want everything not just a summary"),
    call("read_job_result", {"job_id": "artemis-v3ok"}),
    tool("read_job_result", "artemis-v3ok (artemis, done) — task: \"find out why the printer driver install keeps failing\"\n\nWhat was asked: why the printer driver install keeps failing.\n1. The install script requires sudo, and the interactive password prompt for it was left unanswered for four days.\n2. Nothing else stalled — the moment the prompt is answered, the rest of the install completes in under 10 seconds."),
    asst("It's not much — the install's been sitting on a sudo password prompt for four days, nothing else stalled. Answer that prompt and it finishes in under ten seconds."),
]))

# 16. Full chain — atlas job, PROVEN-FAILED (wrong file+path), report_task_failure, corrected re-delegation naming the gap.
rows.append(row([
    user("generate the september invoice pdf for permit 22-1187 and save it in my invoices folder"),
    call("atlas_background", {"task": "Generate the September invoice PDF for permit 22-1187 and save it to /home/dominic/Warden/groups/dominic/invoices/."}),
    tool("atlas_background", "Atlas d4wz started — running. Result arrives in your inbox. Reply: running, result on the way. End your turn."),
    asst("Running now — I'll let you know when the invoice PDF is ready."),
    user(report_back(
        "atlas-d4wz (atlas, done) — task: \"generate the September invoice PDF for permit 22-1187\"",
        "Wrote the September invoice to /home/dominic/Warden/groups/dominic/report.md — couldn't find an existing invoice template, so used the weekly report format instead."
    )),
    call("report_task_failure", {"task": "generate the September invoice PDF for permit 22-1187", "reason": "it wrote a markdown report to report.md instead of a PDF invoice, and saved it to the wrong location entirely"}),
    tool("report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected approach that addresses the reason: it wrote a markdown report to report.md instead of a PDF invoice, and saved it to the wrong location entirely"),
    call("atlas_background", {"task": "Generate the September invoice for permit 22-1187 as an actual PDF file, saved to /home/dominic/Warden/groups/dominic/invoices/ — the last attempt produced a markdown report in the wrong folder instead of a PDF invoice."}),
    tool("atlas_background", "Atlas s5be started — running. Result arrives in your inbox. Reply: running, result on the way. End your turn."),
    asst("That one went sideways — it wrote a markdown report to the wrong folder instead of an actual PDF invoice. Sent it back with the gap called out, running again now."),
]))

# 17. Angry/rambling #1 — same failure twice, reply stays short, no apology loop, artemis dispatched.
rows.append(row([
    user("this is the SECOND time the printer thing has failed on me, i dont get it, i asked for this yesterday too and it still doesnt work, what is going on"),
    call("artemis", {"task": "Find out why the printer driver install has failed twice now — once yesterday and again today — and what's actually blocking it."}),
    tool("artemis", "Artemis l0ta started — the audit result will arrive in your inbox. (job id: artemis-l0ta)"),
    asst("Sending artemis to find the actual blocker — I'll have a real answer once it's back."),
]))

# 18. Angry/rambling #2 — landed finding, factual reply, defect fixed directly (Bash delete of the duplicate row).
rows.append(row([
    user("the reminder went off twice again this morning, you said this was fixed last week, im so done with this"),
    call("artemis", {"task": "Find out why the reminder fired twice this morning even though it was supposed to be fixed last week."}),
    tool("artemis", "Artemis b2nf started — the audit result will arrive in your inbox. (job id: artemis-b2nf)"),
    asst("Artemis is checking exactly what happened this time — I'll bring you the real cause."),
    user("[inbox] Artemis b2nf finished."),
    call("read_job_result", {"job_id": "artemis-b2nf"}),
    tool("read_job_result", "artemis-b2nf (artemis, done) — task: \"find out why the reminder fired twice this morning\"\n\nWhat was asked: why the reminder fired twice this morning.\n1. Two separate scheduled_tasks rows exist for the same reminder — last week's fix edited one row's schedule, but a leftover duplicate row (id 487) from before the fix was never removed.\n2. Both rows fired independently this morning, which is why it went off twice."),
    call("Bash", {"command": "sqlite3 /opt/Warden/store/messages.db \"DELETE FROM scheduled_tasks WHERE id=487\""}),
    tool("Bash", ""),
    asst("There were two scheduled rows for the same reminder — last week's fix only touched one, and a leftover duplicate, row 487, fired too. I've deleted that duplicate row directly."),
]))

# 19. Database side — a task row that still says running.
rows.append(row([
    user("check the database — is that data cleanup task actually still running or did it just get stuck showing running"),
    call("artemis", {"task": "Determine whether the data-cleanup task is genuinely still active or just stuck showing status running in /opt/Warden/store/messages.db's user_work_tasks table — it's been flagged running for several hours with no matching active process."}),
    tool("artemis", "Artemis g6ip started — the audit result will arrive in your inbox. (job id: artemis-g6ip)"),
    asst("Sending artemis to check the actual state against the database — I'll let you know what it finds."),
]))

# 20. Database side — a scheduled task that never fired.
rows.append(row([
    user("did the dentist reminder ever actually fire? i never got anything and it was supposed to go off yesterday"),
    call("artemis", {"task": "Find out why the dentist reminder scheduled for yesterday never fired — check its row in /opt/Warden/store/messages.db's scheduled_tasks table for what actually happened to it."}),
    tool("artemis", "Artemis f1qm started — the audit result will arrive in your inbox. (job id: artemis-f1qm)"),
    asst("Checking the scheduled task's actual record now — I'll tell you what artemis finds."),
]))

# 21. Cheap check only — agent_logs resolves it fully, no artemis needed.
rows.append(row([
    user("did vulkan actually push that fix or just say it did"),
    call("agent_logs", {"job_id": "vulkan-j8ru"}),
    tool("agent_logs", "Step-by-step activity (4 call(s)):\n[1] +0s Read(/opt/Warden/src/db.ts) → 118 lines\n[2] +9s Edit(/opt/Warden/src/db.ts) → applied 1 change\n[3] +15s Bash(npx tsc) → exit 0\n[4] +52s Bash(git push origin main) → pushed 1 commit"),
    asst("It actually did the work — edited db.ts, built clean, and pushed the commit, not just a claim."),
]))

# 22. Cheap check only — read_job_result answers it, user satisfied, no artemis.
rows.append(row([
    user("what did that finished digest job end up saying, just the short version"),
    call("read_job_result", {"job_id": "atlas-u6ox"}),
    tool("read_job_result", "atlas-u6ox (atlas, done) — task: \"summarize this week's completed tasks into the daily digest\"\n\nSummarized 14 completed tasks across 3 projects; digest saved to /home/dominic/Warden/groups/dominic/digest-2026-09-18.md (620 words)."),
    asst("Fourteen tasks across three projects, all wrapped into today's digest file — nothing flagged as incomplete."),
]))

# 23. Full chain — artemis lands a data-value defect (not code), corrected one-liner handed to iris, who owns reminders.
rows.append(row([
    user("why didn't the trash-day reminder go off this week"),
    call("artemis", {"task": "Find out why the trash-day reminder didn't go off this week even though it's set to recur."}),
    tool("artemis", "Artemis r6ty started — the audit result will arrive in your inbox. (job id: artemis-r6ty)"),
    asst("Artemis is checking the reminder's actual record — I'll have an answer shortly."),
    user(report_back(
        "artemis-r6ty (artemis, done) — task: \"find out why the trash-day reminder didn't go off this week\"",
        "What was asked: why the trash-day reminder didn't fire this week.\n"
        "1. The recurring reminder's row has a valid weekly schedule, but its interval field is set to every 14 days instead of every 7, so the database shows it correctly skipped this week.\n"
        "2. Nothing is broken mechanically; the recurrence interval itself is just wrong."
    )),
    call("iris", {"task": "TASK: Fix the trash-day reminder's recurrence interval — it's set to fire every 14 days instead of every 7, which is why it skipped this week."}),
    tool("iris", "OK — updated the trash-day reminder to repeat every 7 days instead of 14."),
    asst("It wasn't broken, just set to repeat every 14 days instead of 7, so it skipped this week. Fixed the interval directly."),
]))

# 24. Short inbox variant — landed finding is a real edge case, not "nothing wrong" boilerplate, relayed in one line.
rows.append(row([
    user("can you get artemis to check why the youtube caption download script keeps timing out"),
    call("artemis", {"task": "Find out why the YouTube caption download script keeps timing out."}),
    tool("artemis", "Artemis h1vk started — the audit result will arrive in your inbox. (job id: artemis-h1vk)"),
    asst("On it — artemis is checking why it keeps timing out."),
    user("[inbox] Artemis h1vk finished."),
    call("read_job_result", {"job_id": "artemis-h1vk"}),
    tool("read_job_result", "artemis-h1vk (artemis, done) — task: \"find out why the YouTube caption download script keeps timing out\"\n\nWhat was asked: why the caption download keeps timing out.\n1. The script waits on a network call with no timeout of its own, and it's hanging on one specific video whose captions were disabled by the uploader — there's nothing to download, so the wait never resolves.\n2. Every other video the script has tried worked fine within seconds."),
    asst("It's just that one video — captions are disabled on it, so the script waits forever for something that isn't there. Every other video downloads fine."),
]))

# 25. Sanity check before something final — closing out a work task.
rows.append(row([
    user("before i close out this task in the tracker, make sure it actually finished — the fence-repair one"),
    call("artemis", {"task": "Confirm whether the fence-repair work task, marked ready to close in /opt/Warden/store/messages.db's user_work_tasks table, actually has its deliverable finished before it gets closed out."}),
    tool("artemis", "Artemis z9tm started — the audit result will arrive in your inbox. (job id: artemis-z9tm)"),
    asst("Having artemis confirm it's actually done before you close it out — I'll tell you as soon as it's back."),
]))

assert len(rows) == 25, len(rows)

out_path = os.path.join(BASE, "s25-1.jsonl")
with open(out_path, "w") as f:
    for r in rows:
        f.write(json.dumps(r) + "\n")

print("wrote %d rows to %s" % (len(rows), out_path))
