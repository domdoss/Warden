import json

with open("/opt/Warden/training/orchatlas-parts/_sys.txt", encoding="utf-8") as f:
    SYS = f.read()

ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver.)\n\n"


def U(ask):
    return {"role": "user", "content": ANCHOR + ask}


def A(text=None, calls=None):
    m = {"role": "assistant", "content": text}
    if calls:
        m["tool_calls"] = calls
    return m


def C(cid, name, args):
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": args}}


def T(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": content}


def LOST(job):
    return ('No stored result for "%s". Results live for this runner session only — use '
            'read_job_result with the id the job reported when it started. If the runner '
            'restarted, results from before the restart are gone.') % job


def VSTART(vid):
    return ("Atlas %s started (urgent — its result will interrupt you when ready) — the "
            "result will arrive in your inbox when it finishes.") % vid


RTF = ("Noted — this task's failure is on record. You may delegate it once more, and "
       "only with a corrected brief.")

NO_RUNNING = "No running agents."


def running(aid, task, it, total, started):
    return "Running: %s (%s, iteration %d/%d, started %s)." % (aid, task, it, total, started)


# --- vulkan briefs -------------------------------------------------------
PERMIT_BRIEF = ("Fix the permit-parser in /opt/Warden so it no longer crashes on empty "
                "date fields. Reproduce the empty-date crash first, then apply the fix and "
                "run the parser tests.")
LEASE_BRIEF = ("Fix the lease-calculator in /opt/Warden so proration rounds correctly on "
               "partial months and 31-day months. Cover the partial-month case in a test "
               "and run the calculator tests.")
SYNC_BRIEF = ("Fix sync-script in /opt/Warden so it retries on HTTP 429 instead of "
              "exiting. Cover the 429 retry in a test and run the script's tests.")


# =====================================================================
# SECTION 18-1 — lost job results
# =====================================================================
R1 = []

# 1. direct, lost -> re-dispatch once
R1.append([
    U("Whatever happened to that permit-parser fix vulkan was running this morning?"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-f3a9"})]),
    T("call_1", "read_job_result", LOST("vulkan-f3a9")),
    A(calls=[C("call_2", "vulkan", {"task": PERMIT_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck9")),
    A("That result was lost when the service restarted — results only live for the runner's session. I've re-sent the parser fix to vulkan; I'll report when it lands."),
])

# 2. direct, lost -> ask user
R1.append([
    U("Did the weekly digest job finish before the restart?"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-dg01"})]),
    T("call_1", "read_job_result", LOST("vulkan-dg01")),
    A("It's gone with the restart — stored results die with the runner session. Want me to run it again?"),
])

# 3. casual, list first -> nothing -> lost result
R1.append([
    U("so is that lease calc thing done or what"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", NO_RUNNING),
    A(calls=[C("call_2", "read_job_result", {"job_id": "vulkan-lm04"})]),
    T("call_2", "read_job_result", LOST("vulkan-lm04")),
    A("Nothing's running now, and the old result went with the restart. I can send vulkan the lease-calculator fix again if you still want it."),
])

# 4. rambling, lost -> re-dispatch once
R1.append([
    U("I never heard back on the sync-script fix you started around eleven. Did it get anywhere? I kind of need it working before the two o'clock run."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-s9k2"})]),
    T("call_1", "read_job_result", LOST("vulkan-s9k2")),
    A(calls=[C("call_2", "vulkan", {"task": SYNC_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck11")),
    A("No — the result was lost in the restart, so I can't tell you how far it got. I've re-dispatched the sync-script fix with the same brief; I'll report as soon as it lands."),
])

# 5. direct, lost -> re-dispatch once
R1.append([
    U("Pull the result of the sync-script job for me."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-s9k2"})]),
    T("call_1", "read_job_result", LOST("vulkan-s9k2")),
    A(calls=[C("call_2", "vulkan", {"task": SYNC_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck12")),
    A("Gone — the restart wiped stored results for anything from before it. I've re-sent the sync-script fix to vulkan and I'll report when it's done."),
])

# 6. casual, lost -> ask user
R1.append([
    U("hey did vulkan ever finish that parser thing"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-f3a9"})]),
    T("call_1", "read_job_result", LOST("vulkan-f3a9")),
    A("No way to tell — the result died with the service restart. Want me to run the parser fix again?"),
])

# 7. rambling, re-run pointless -> honest miss, offer only
R1.append([
    U("Did that morning report job get done? I don't need it redone if it's lost — the numbers change anyway — just tell me if you have it somewhere."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-r7c2"})]),
    T("call_1", "read_job_result", LOST("vulkan-r7c2")),
    A("I don't have it — the restart took the stored result with it. A re-run would use fresh numbers anyway, so nothing lost; say the word if you want a new one."),
])

# 8. direct, list only -> honest nothing
R1.append([
    U("What's running right now?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", NO_RUNNING),
    A("Nothing is running now."),
])

# 9. rambling, list only -> honest nothing
R1.append([
    U("You had a couple of jobs going before lunch I think — the parser fix and something on the lease calculator. I restarted the box for updates, sorry about that. What survived?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", NO_RUNNING),
    A("Nothing survived — no agents running now, and stored results don't carry across a restart either. If either fix still matters, I'll re-send it fresh."),
])

# 10. direct, lost -> re-dispatch once
R1.append([
    U("Get me the output of the vulkan job from this morning."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-f3a9"})]),
    T("call_1", "read_job_result", LOST("vulkan-f3a9")),
    A(calls=[C("call_2", "vulkan", {"task": PERMIT_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck14")),
    A("That output is gone — the runner restarted and results from before it are lost. I've re-sent the permit-parser fix to vulkan; the result will land in my inbox when it finishes."),
])

# 11. casual, lost -> re-dispatch once
R1.append([
    U("that sync script fix... did it land before everything restarted?"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-s9k2"})]),
    T("call_1", "read_job_result", LOST("vulkan-s9k2")),
    A(calls=[C("call_2", "vulkan", {"task": SYNC_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck15")),
    A("It didn't — the result went with the restart. I've re-dispatched the sync-script fix; I'll tell you the moment it lands."),
])

# 12. direct, list only -> honest, offer
R1.append([
    U("Whatever happened to that parser job?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", NO_RUNNING),
    A("Nothing's running now, and results from before the restart are gone. Want me to send the parser fix to vulkan again?"),
])

# 13. rambling, lost -> re-dispatch once with gap named
R1.append([
    U("The permit-parser was crashing on empty dates, remember? vulkan was on it before lunch and I never saw the result. I still need that fix in before end of day."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-f3a9"})]),
    T("call_1", "read_job_result", LOST("vulkan-f3a9")),
    A(calls=[C("call_2", "vulkan", {"task": PERMIT_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck16")),
    A("The result was lost when the service restarted, so I can't tell you if it fixed anything. I've re-sent the fix with the empty-date crash named in the brief; I'll report when it lands."),
])

# 14. casual, lost -> re-dispatch once
R1.append([
    U("uh the thing from earlier, the calc job, is it done"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-lm04"})]),
    T("call_1", "read_job_result", LOST("vulkan-lm04")),
    A(calls=[C("call_2", "vulkan", {"task": LEASE_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck17")),
    A("No — that result was lost with the restart. I've re-sent the lease-calculator fix to vulkan and I'll report when it lands."),
])

# 15. direct, lost -> ask user
R1.append([
    U("Did the digest job from this morning produce anything I can read?"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-dg01"})]),
    T("call_1", "read_job_result", LOST("vulkan-dg01")),
    A("Nothing readable — the restart wiped the stored result. Want me to generate the digest again?"),
])

# 16. rambling, list -> nothing -> lost -> ask
R1.append([
    U("I know you were having vulkan write up that lease-terms summary for me — I had to reboot mid-morning and now I can't find it anywhere. Is it still around?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", NO_RUNNING),
    A(calls=[C("call_2", "read_job_result", {"job_id": "vulkan-sum3"})]),
    T("call_2", "read_job_result", LOST("vulkan-sum3")),
    A("It's not around — nothing's running and the stored result died with the reboot. Want me to have it written up again?"),
])

# 17. direct, lost -> re-dispatch once
R1.append([
    U("Re-send that lease-calculator job — I never saw the result."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-lm04"})]),
    T("call_1", "read_job_result", LOST("vulkan-lm04")),
    A(calls=[C("call_2", "vulkan", {"task": LEASE_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck18")),
    A("The result was lost with the restart, so there was nothing to show you. It's re-sent to vulkan now — I'll report when it lands."),
])

# 18. casual, lost -> re-dispatch once
R1.append([
    U("warden restarted and ate my jobs didnt it lol. is the parser fix result anywhere"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-f3a9"})]),
    T("call_1", "read_job_result", LOST("vulkan-f3a9")),
    A(calls=[C("call_2", "vulkan", {"task": PERMIT_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck19")),
    A("It did, yes — that result went with the restart. I've re-sent the parser fix to vulkan; I'll report when it's done."),
])

# 19. direct, list only -> honest, offer
R1.append([
    U("Whatever happened to that sync-script job from this morning?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", NO_RUNNING),
    A("Nothing is running now and the morning result is gone with the restart. I can re-send the sync-script fix if you still need it."),
])

# 20. rambling, lost -> ask user
R1.append([
    U("I asked you ages ago to have vulkan look at the lease-calculator bug and I genuinely can't remember if you ever told me the outcome. Do we know if it worked?"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-lm04"})]),
    T("call_1", "read_job_result", LOST("vulkan-lm04")),
    A("We don't, I'm afraid — the result was lost when the service restarted, so there's no way to know how it went. Want me to send the calculator fix to vulkan again?"),
])


# =====================================================================
# SECTION 18-2 — no re-issuing a just-answered call
# =====================================================================
R2 = []

INBOX3 = ("Inbox: 3 new. 1) Dana Whitfield — 'Budget thread recap' "
          "(dana.whitfield@rennercontracting.com, 10:42). 2) UPS — 'Your delivery is "
          "scheduled for tomorrow' (noreply@ups.com, 09:15). 3) Renner Contracting — "
          "'Invoice #4471' (billing@rennercontracting.com, yesterday 17:58).")
INBOX3_LATER = ("Inbox: 3 new. 1) Dana Whitfield — 'Budget thread recap' "
                "(dana.whitfield@rennercontracting.com, 10:42). 2) UPS — 'Your delivery "
                "is scheduled for tomorrow' (noreply@ups.com, 09:15). 3) Renner "
                "Contracting — 'Invoice #4471' (billing@rennercontracting.com, just "
                "arrived 12:03).")

# 1. direct, one call, answer carries the data
R2.append([
    U("Any new email?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: List all new email in the inbox."})]),
    T("call_1", "iris", INBOX3),
    A("Three new: Dana Whitfield on the budget thread, a UPS delivery notice for tomorrow, and Renner Contracting's invoice 4471."),
])

# 2. are-you-sure -> answer from hand, no re-call
R2.append([
    U("Any new email this morning?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: List all new email in the inbox."})]),
    T("call_1", "iris", INBOX3),
    A("Three — Dana's budget recap, UPS's delivery notice, and Renner's invoice 4471."),
    U("are you sure thats everything? double check"),
    A("Yes — iris listed exactly those three, and nothing has come in since."),
])

# 3. genuinely stale NOW check -> one fresh call only
R2.append([
    U("How many unread am I sitting on?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: Count unread email in the inbox."})]),
    T("call_1", "iris", "Unread: 2 — Dana Whitfield 'Budget thread recap', UPS 'Your delivery is scheduled for tomorrow'."),
    A("Two unread — Dana's budget recap and the UPS delivery notice."),
    U("ok my phone says 3 now. check again"),
    A(calls=[C("call_2", "iris", {"task": "TASK: Count unread email in the inbox."})]),
    T("call_2", "iris", "Unread: 3 — Dana Whitfield 'Budget thread recap', UPS 'Your delivery is scheduled for tomorrow', Renner Contracting 'Invoice #4471' (just arrived 12:03)."),
    A("Your phone's right — Renner's invoice 4471 just landed, so it's three unread now."),
])

# 4. vulkan already owns the outcome -> wait
R2.append([
    U("Can you get the permit-parser fixed? It's still throwing on empty dates."),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-a1b2", "fix-permit-parser", 4, 200, "11:58")),
    A("vulkan is already on that fix — iteration 4 of 200, running since 11:58. I'll report the moment it lands."),
])

# 5. duplicate dispatch attempt -> wait, don't dispatch
R2.append([
    U("start a job on the parser bug will you? the empty dates crash is still happening"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-a1b2", "fix-permit-parser", 6, 200, "11:58")),
    A("Already covered — vulkan's parser job is at iteration 6 on that exact crash. I'll let you know when it finishes."),
])

# 6. status from one call
R2.append([
    U("what's the lease calculator fix doing these days"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-ld77", "fix-lease-calculator", 12, 200, "11:58")),
    A("Still running — vulkan is on the lease-calculator fix at iteration 12."),
])

# 7. NOW status after time passed -> one fresh call is fine
R2.append([
    U("is the lease calculator job done yet? its been a while"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-ld77", "fix-lease-calculator", 51, 200, "11:58")),
    A("Not yet — still going at iteration 51 of 200, so it's progressing rather than stuck."),
])

# 8. chat history, one call, answer carries the data
R2.append([
    U("what did I ask you about earlier today?"),
    A(calls=[C("call_1", "get_chat_history", {"limit": 10})]),
    T("call_1", "get_chat_history", "Recent turns: (12:01) you asked for an inbox check — 3 new: Dana Whitfield, UPS, Renner Contracting. (11:58) you had vulkan fix the permit-parser — job running. (11:40) you confirmed the 3pm dentist reminder."),
    A("Three things so far: the inbox check — three new emails, the permit-parser fix now with vulkan, and your 3pm dentist reminder."),
])

# 9. marm match -> answer -> follow-up answered from hand
R2.append([
    U("Do we have anything in memory about the Pine Lake cabin trip?"),
    A(calls=[C("call_1", "mcp__marm__marm_smart_recall", {"query": "Pine Lake cabin trip"})]),
    T("call_1", "mcp__marm__marm_smart_recall",
      "1. (2026-07-12) Cabin trip — booked Pine Lake cabin for Sept 12–14, gate code 4471, key pickup from the lockbox on the north wall. 2. (2026-08-02) Pine Lake — it rained all weekend last time, bring the tarp."),
    A("Yes — Pine Lake cabin, September 12 to 14, gate code 4471, key in the north-wall lockbox. And it rained all weekend last time, so the tarp's worth packing."),
    U("wait which weekend was it? you sure about the dates?"),
    A("September 12 to 14 — that's straight from the saved memory, along with the gate code."),
])

# 10. result in hand -> exact-wording ask answered from the stored result
R2.append([
    U("what did the sync-script job end up saying?"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-s9k2"})]),
    T("call_1", "read_job_result",
      "Job vulkan-s9k2 finished: 'Fixed sync-script to retry on HTTP 429 with a 5-second backoff. src/sync-script.ts lines 40–52 changed. 12/12 tests pass.'"),
    A("It finished — sync-script now retries on 429 with a five-second backoff, lines 40 to 52 changed, and all 12 tests pass."),
    U("read it again, I want the exact wording"),
    A("Straight from the stored result: 'Fixed sync-script to retry on HTTP 429 with a 5-second backoff. src/sync-script.ts lines 40–52 changed. 12/12 tests pass.' That's the whole of it."),
])

# 11. contradiction answered in one call, no follow-up calls
R2.append([
    U("anything from the bank in the inbox?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: List email received today from Meridian Bank."})]),
    T("call_1", "iris", "No mail from Meridian Bank today. Latest received: Dana Whitfield — 'Budget thread recap' (10:42)."),
    A("Nothing from the bank — the latest in is Dana's budget thread."),
])

# 12. reminder confirm, one call
R2.append([
    U("is my dentist reminder still set for 3?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: Confirm whether the 3pm dentist reminder exists today."})]),
    T("call_1", "iris", "Reminder confirmed: 'Dentist — 3:00 PM today', scheduled 15:00, active."),
    A("Yes — 'Dentist, 3pm today' is set and active."),
])

# 13. positive? -> answered from hand
R2.append([
    U("is the dentist reminder set?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: Confirm whether the 3pm dentist reminder exists today."})]),
    T("call_1", "iris", "Reminder confirmed: 'Dentist — 3:00 PM today', scheduled 15:00, active."),
    A("Set — the dentist reminder fires at 3 today."),
    U("you positive? I thought I deleted it"),
    A("Positive — iris still shows it active for 15:00 today. A deleted reminder wouldn't show up in her list."),
])

# 14. send, one call, confirm from result
R2.append([
    U("reply to Dana saying the budget numbers look right"),
    A(calls=[C("call_1", "iris", {"task": "TASK: Reply to Dana Whitfield on the budget thread saying the budget numbers look right."})]),
    T("call_1", "iris", "Reply sent to dana.whitfield@rennercontracting.com at 12:07 on thread 'Budget thread recap'."),
    A("Sent — Dana has your reply that the budget numbers look right."),
])

# 15. running list -> follow-up answered from hand
R2.append([
    U("is anything running right now?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-a1b2", "fix-permit-parser", 9, 200, "11:58")),
    A("Just the one — vulkan's permit-parser fix, at iteration 9."),
    U("just that one? nothing on the calculator?"),
    A("Just that one, yes — the parser fix is the only job running; there's nothing on the calculator."),
])

# 16. marm match -> sure-from-hand
R2.append([
    U("what was the wifi fix we did on the desktop again? check memory"),
    A(calls=[C("call_1", "mcp__marm__marm_smart_recall", {"query": "desktop wifi fix"})]),
    T("call_1", "mcp__marm__marm_smart_recall",
      "1. (2026-09-08) Desktop wifi drops — fixed by switching from iwd+networkd to NetworkManager; 2.4GHz preferred by choice. 2. (2026-09-08) Don't fight the Plasma applet with nmcli."),
    A("We switched the desktop from iwd and networkd to NetworkManager — the drops stopped, and 2.4GHz is preferred on purpose. Also noted not to fight the Plasma applet with nmcli."),
    U("sure about that? thought it was the router"),
    A("It was the local setup, not the router — the saved memory says the drops stopped once NetworkManager took over."),
])

# 17. single answer -> follow-up answered from hand
R2.append([
    U("did Renner send that invoice yet?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: Check whether an invoice email from Renner Contracting has arrived."})]),
    T("call_1", "iris", "Yes — Renner Contracting 'Invoice #4471' (billing@rennercontracting.com), received yesterday 17:58, unread."),
    A("Yes — invoice 4471 from Renner's billing address came in yesterday evening and is still unread."),
    U("and thats the only thing from them?"),
    A("Only one from Renner — invoice 4471, nothing else from them in the inbox."),
])

# 18. no new mail -> answer and stop
R2.append([
    U("any mail?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: List all new email in the inbox."})]),
    T("call_1", "iris", "Inbox: no new mail. Last received: Renner Contracting — 'Invoice #4471' (yesterday 17:58)."),
    A("Nothing new — the last thing in was Renner's invoice yesterday evening."),
])

# 19. no mail -> genuinely stale NOW re-check -> one fresh call, new data
R2.append([
    U("any mail?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: List all new email in the inbox."})]),
    T("call_1", "iris", "Inbox: no new mail. Last received: Renner Contracting — 'Invoice #4471' (yesterday 17:58)."),
    A("Nothing new — last in was Renner's invoice yesterday evening."),
    U("huh, I was expecting something from UPS. check again now"),
    A(calls=[C("call_2", "iris", {"task": "TASK: List all new email in the inbox."})]),
    T("call_2", "iris", "Inbox: 1 new — UPS 'Your delivery is scheduled for tomorrow' (noreply@ups.com, just arrived 12:04)."),
    A("There it is now — a UPS notice just arrived: your delivery is scheduled for tomorrow."),
])

# 20. different outcome while another job runs -> dispatch normally
R2.append([
    U("while the parser thing runs, can you start on the lease calculator bug? the proration is wrong on partial months"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-a1b2", "fix-permit-parser", 4, 200, "11:58")),
    A(calls=[C("call_2", "vulkan", {"task": LEASE_BRIEF})]),
    T("call_2", "vulkan", VSTART("vck21")),
    A("The parser fix keeps running untouched — that's a different bug, so I've started vulkan on the lease-calculator proration. I'll report when each lands."),
])


# =====================================================================
# SECTION 18-3 — honest misses and failure fidelity
# =====================================================================
R3 = []

# 1. empty marm recall -> no invention
R3.append([
    U("Do we have anything in memory about that bike route I liked in Lisbon?"),
    A(calls=[C("call_1", "mcp__marm__marm_smart_recall", {"query": "Lisbon bike route"})]),
    T("call_1", "mcp__marm__marm_smart_recall", "No memories matched."),
    A("Memory has nothing on that route, and I'm not going to guess it. If you find it, tell me and I'll remember it for next time."),
])

# 2. empty marm recall -> real file lookup succeeds
R3.append([
    U("Where did I put the signed lease? Check memory."),
    A(calls=[C("call_1", "mcp__marm__marm_smart_recall", {"query": "signed lease location"})]),
    T("call_1", "mcp__marm__marm_smart_recall", "No memories matched."),
    A("Nothing in memory on it — checking the workspace directly.",
      calls=[C("call_2", "Glob", {"pattern": "**/*lease*", "path": "/home/dominic/Warden"})]),
    T("call_2", "Glob", "Found: /home/dominic/Warden/documents/lease-signed.pdf"),
    A("Memory was blank, but the file's there: ~/Warden/documents/lease-signed.pdf."),
])

# 3. glob miss -> say not found, don't re-search
R3.append([
    U("is the demo recording anywhere? the asciinema cast file"),
    A(calls=[C("call_1", "Glob", {"pattern": "**/*.cast", "path": "/home/dominic/Warden"})]),
    T("call_1", "Glob", "No files found."),
    A("Not there — no .cast files anywhere under ~/Warden. As far as I can tell the recording was never saved."),
])

# 4. failed job -> report_task_failure + one re-brief naming the gap
R3.append([
    U("The parser job failed, didn't it? I saw an error flash by."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-a1b2"})]),
    T("call_1", "read_job_result",
      "Job vulkan-a1b2 FAILED: src/parsers/permit.ts(88): Property 'date' does not exist on type 'PermitInput'. Compile error — no fix was written."),
    A(calls=[C("call_2", "report_task_failure",
               {"task": "fix-permit-parser",
                "reason": "compile error: property 'date' does not exist on type PermitInput at src/parsers/permit.ts line 88"})]),
    T("call_2", "report_task_failure", RTF),
    A(calls=[C("call_3", "vulkan",
               {"task": "Fix the permit-parser compile failure first: PermitInput has no 'date' field — check the type at src/parsers/permit.ts line 88 and fix the field access. Then finish the empty-date crash fix and run the parser tests."})]),
    T("call_3", "vulkan", VSTART("vck22")),
    A("It did — a compile error: the parser references a 'date' field PermitInput doesn't have. That's on record, and vulkan has one corrected re-brief naming exactly that; I'll report when it lands."),
])

# 5. failed job (tests) -> report + one re-brief
R3.append([
    U("so did the lease calculator fix work out?"),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-ld77"})]),
    T("call_1", "read_job_result",
      "Job vulkan-ld77 FAILED: 3 of 12 tests failed — proration rounds wrong on 31-day months, off-by-one at month boundaries. No fix committed."),
    A(calls=[C("call_2", "report_task_failure",
               {"task": "fix-lease-calculator",
                "reason": "3 of 12 proration tests fail: rounding is wrong on 31-day months with an off-by-one at month boundaries"})]),
    T("call_2", "report_task_failure", RTF),
    A(calls=[C("call_3", "vulkan",
               {"task": "Fix the lease-calculator proration failures: rounding is wrong on 31-day months and off by one at month boundaries — 3 of 12 tests fail. Fix the boundary rounding and make all 12 tests pass."})]),
    T("call_3", "vulkan", VSTART("vck23")),
    A("No — three of its twelve tests failed, all on 31-day-month rounding with an off-by-one at boundaries. That's logged, and vulkan has one re-brief naming the boundary bug; I'll report when it lands."),
])

# 6. refuse a second re-brief
R3.append([
    U("It failed again. Just fire vulkan at it a third time, same brief."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-ld77"})]),
    T("call_1", "read_job_result",
      "Job vulkan-ld77 FAILED (second run): 3 of 12 tests still fail — same 31-day-month rounding, off-by-one at boundaries. The re-brief did not change the outcome."),
    A("I won't — the same brief has now failed twice on the same rounding bug, and re-sending it unchanged would just repeat the failure. Let me re-brief it with the failing test cases attached, or I take a look at the rounding myself."),
])

# 7. tool result contradicts user assumption -> say so plainly
R3.append([
    U("The Meridian bank email came in this morning, right? Forward it to Dana."),
    A(calls=[C("call_1", "iris", {"task": "TASK: List email received today from Meridian Bank."})]),
    T("call_1", "iris", "No mail from Meridian Bank today. Latest received: Dana Whitfield — 'Budget thread recap' (10:42)."),
    A("Nothing from the bank — today's only email is Dana's budget thread. There's nothing to forward; want me to send her something else?"),
])

# 8. grep miss -> say not found, don't grep twice
R3.append([
    U("Grep the Warden source for 'permitParser' — I think the registry lives in db.ts."),
    A(calls=[C("call_1", "Grep", {"pattern": "permitParser", "path": "/opt/Warden/src"})]),
    T("call_1", "Grep", "No matches found."),
    A("No matches anywhere in src — 'permitParser' doesn't exist in the source, so the registry must live under a different name."),
])

# 9. whatever-happened-to -> honest from what list_running_agents shows
R3.append([
    U("Whatever happened to that digest job from this morning?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-a1b2", "fix-permit-parser", 4, 200, "11:58")),
    A("Nothing running for the digest — the only live job is the parser fix, so the digest ended at some point and I have no stored result saying how."),
])

# 10. read contradicts user's recollection
R3.append([
    U("Check config.yaml — did I ever get around to adding the second email account?"),
    A(calls=[C("call_1", "Read", {"file_path": "/home/dominic/.config/jarvis/config.yaml"})]),
    T("call_1", "Read",
      "dockbox:\n  base_url: http://localhost:3200\nemail:\n  account: dominic@fastmail.com\n  check_interval: 10m"),
    A("No — only the one account is in there. The second never got added."),
])

# 11. empty marm recall on a person -> no invention
R3.append([
    U("What do you know about my landlord? Is anything in memory?"),
    A(calls=[C("call_1", "mcp__marm__marm_smart_recall", {"query": "landlord"})]),
    T("call_1", "mcp__marm__marm_smart_recall", "No memories matched."),
    A("Memory has nothing on your landlord, and I'd rather not guess. Give me the details and I'll remember them."),
])

# 12. history can't reach yesterday -> honest miss
R3.append([
    U("What did we decide about the fence repair yesterday?"),
    A(calls=[C("call_1", "get_chat_history", {"limit": 30})]),
    T("call_1", "get_chat_history",
      "Recent turns: (today 12:01) inbox check; (11:58) permit-parser dispatch to vulkan; (11:40) dentist reminder confirmed. No turns from yesterday available."),
    A("I can't say — the history I can reach only covers today, and the fence repair isn't in it."),
])

# 13. result contradicts the user's failed assumption
R3.append([
    U("That sync job failed, right? Just checking before I restart it."),
    A(calls=[C("call_1", "read_job_result", {"job_id": "vulkan-s9k2"})]),
    T("call_1", "read_job_result",
      "Job vulkan-s9k2 finished: 'Fixed sync-script to retry on HTTP 429 with a 5-second backoff. 12/12 tests pass.'"),
    A("Actually it succeeded — the fix is in and all twelve tests pass. No restart needed."),
])

# 14. iris finds nothing to cancel -> say so plainly
R3.append([
    U("Cancel my dentist appointment tomorrow, please."),
    A(calls=[C("call_1", "iris", {"task": "TASK: Cancel tomorrow's dentist appointment."})]),
    T("call_1", "iris", "No dentist appointment tomorrow. Calendar shows: Dentist — today 15:00 (reminder only), Plumbing quote — tomorrow 10:00."),
    A("There's no dentist appointment tomorrow — the dentist entry is today's 3pm reminder, and tomorrow has the plumbing quote at 10. Nothing to cancel."),
])

# 15. stuck job -> stop and report from the result
R3.append([
    U("That sync-script job has been stuck for an hour — kill it, we'll redo it later."),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-s9k2", "sync-script-fix", 47, 200, "10:58")[:-1] + ", no progress since 11:15."),
    A(calls=[C("call_2", "stop_agent", {"agent_id": "vulkan-s9k2"})]),
    T("call_2", "stop_agent", "Stopped vulkan-s9k2."),
    A("Stopped — it had sat at iteration 47 with no progress since 11:15. Say the word when you want it redone."),
])

# 16. grep finds something contradicting the user's 'never'
R3.append([
    U("I never left a num_ctx override in the Warden config, did I? Don't touch anything, just look."),
    A(calls=[C("call_1", "Grep", {"pattern": "num_ctx", "path": "/opt/Warden"})]),
    T("call_1", "Grep",
      "src/ollama-servers.ts:214:  const numCtx = env.NUM_CTX ?? 16384;\ntraining/README.md:62:  num_ctx (context window) — see check_seqlen.py"),
    A("There are num_ctx references, but they're in the source code — ollama-servers.ts reads NUM_CTX from the environment. Nothing in a config of yours, and I haven't touched anything."),
])

# 17. empty search result is an answer
R3.append([
    U("Can you find the email with the floor plan attached, from a couple weeks ago?"),
    A(calls=[C("call_1", "iris", {"task": "TASK: Find an email with a floor plan attachment from the last two weeks."})]),
    T("call_1", "iris", "No matching email found. Closest: Renner Contracting — 'Invoice #4471' (yesterday 17:58), Dana Whitfield — 'Budget thread recap' (today 10:42)."),
    A("iris found nothing with a floor plan — the closest matches are Renner's invoice and Dana's budget thread. It's not in the mailbox."),
])

# 18. marm partial match -> name what's missing
R3.append([
    U("Memory should have the contractor's license number from last year."),
    A(calls=[C("call_1", "mcp__marm__marm_smart_recall", {"query": "contractor license number"})]),
    T("call_1", "mcp__marm__marm_smart_recall",
      "1. (2025-06-14) Renner Contracting — contact Dana Whitfield, dana.whitfield@rennercontracting.com, 555-014-9987. 2. (2025-06-20) Fence quote — $2,400 from Renner Contracting."),
    A("Memory has Dana's contact at Renner and the $2,400 fence quote, but no license number — that never got saved. Want me to ask her for it?"),
])

# 19. is-it-one-of-the-running-ones -> honest from the list
R3.append([
    U("Whatever happened to that sync-script job I asked about before lunch? Is it one of the running ones?"),
    A(calls=[C("call_1", "list_running_agents", {})]),
    T("call_1", "list_running_agents", running("vulkan-a1b2", "fix-permit-parser", 4, 200, "11:58")),
    A("It's not — the only running job is the parser fix. The sync-script job isn't live, and I have no stored result to say how it ended."),
])

# 20. count contradicts user assumption -> say so plainly
R3.append([
    U("I should have four unread by now, right? Renner's invoice and the Dana thread at the very least."),
    A(calls=[C("call_1", "iris", {"task": "TASK: Count unread email and list the senders."})]),
    T("call_1", "iris", "Unread: 2 — Renner Contracting 'Invoice #4471', Dana Whitfield 'Budget thread recap'. UPS notice was read at 11:52."),
    A("Two, not four — the unread ones are Renner's invoice and Dana's budget thread. The UPS notice was already read at 11:52."),
])


# =====================================================================
def dumps(rows):
    lines = []
    for msgs in rows:
        assert msgs[0]["role"] == "user"
        assert msgs[-1]["role"] == "assistant"
        lines.append(json.dumps(
            {"messages": [{"role": "system", "content": SYS}] + msgs},
            ensure_ascii=False))
    return "\n".join(lines) + "\n"


assert len(R1) == 20 and len(R2) == 20 and len(R3) == 20, (len(R1), len(R2), len(R3))
for name, rows in [("s18-1.jsonl", R1), ("s18-2.jsonl", R2), ("s18-3.jsonl", R3)]:
    with open("/opt/Warden/training/orchatlas-parts/" + name, "w", encoding="utf-8") as f:
        f.write(dumps(rows))
    print(name, len(rows), "rows written")