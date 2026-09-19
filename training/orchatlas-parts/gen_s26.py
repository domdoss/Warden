#!/usr/bin/env python3
# s26 -- The Council: council / council_status, and the judgement of when a
# question deserves a council versus a single answer, artemis, or just doing
# the work. 25 hand-authored rows.
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, "_sys.txt")).read().rstrip()
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"

def user(ask):
    return {"role": "user", "content": ANCHOR + ask}

def asst(text):
    return {"role": "assistant", "content": text}

def call(name, args, content=""):
    return {"role": "assistant", "content": content,
            "tool_calls": [{"type": "function", "function": {"name": name, "arguments": args}}]}

def tool(name, content):
    return {"role": "tool", "name": name, "content": content}

def row(msgs):
    return {"messages": [{"role": "system", "content": SYS}] + msgs}

rows = []

CONVENE_RESULT = (
    "The Council is now deliberating in the background on this question. Reply with ONE short line "
    "saying the Council has it, then end your turn — do not answer the question yourself and do not "
    "promise a summary. The final verdict will be delivered to the user automatically when The Council "
    "completes (a few minutes — they argue up to 15 rounds before converging). If the user asks about its "
    "progress in the meantime, call council_status."
)

def already_running(snippet, round_no, max_rounds):
    return (
        'The Council is already deliberating on: "%s" (round %d of %d). Only one deliberation runs at a '
        'time — use council_status to check its progress, or wait for its verdict before convening a new '
        'one.' % (snippet, round_no, max_rounds)
    )

def status_none_yet(task, round_no, max_rounds, elapsed):
    return (
        "**The Council — question:** %s\n\n"
        "**Status:** Still deliberating — round %d of %d in progress, %ds elapsed.\n\n"
        "(no completed rounds yet — the seats are still writing their first answers)"
        % (task, round_no, max_rounds, elapsed)
    )

def round_block(n, skeptic, pragmatist, synthesist):
    return "### Round %d\n\n**Skeptic:**\n%s\n\n**Pragmatist:**\n%s\n\n**Synthesist:**\n%s" % (
        n, skeptic, pragmatist, synthesist)

def status_mid(task, round_no, max_rounds, elapsed, round_blocks):
    return (
        "**The Council — question:** %s\n\n"
        "**Status:** Still deliberating — round %d of %d in progress, %ds elapsed.\n\n%s"
        % (task, round_no, max_rounds, elapsed, "\n\n".join(round_blocks))
    )

def status_finished(task, elapsed, n_rounds, slug):
    return (
        "**The Council — question:** %s\n\n"
        "**Status:** Finished after %ds (%d round(s)) — consensus reached. The verdict was already "
        "delivered to the user; full trace saved to /home/dominic/Warden/council-verdicts/%s-1758224701.md."
        % (task, elapsed, n_rounds, slug)
    )

NEVER_CONVENED = "No Council has been convened this session — nothing to report."

REPORT_BACK_HEADER = "REPORT-BACK TURN — jobs below are FINISHED. Report each result."
REPORT_BACK_FOOTER = (
    "For each result, run the CONFIRM step before anything else: compare it against what the user "
    "originally asked for — that ask is in your context.\n"
    "1. CONFIRMED — deliverable present and right. Media or window the user can already see or hear: stay "
    "silent. Else relay in one or two sentences.\n"
    "2. PROVEN-FAILED — the result itself shows the deliverable is wrong or missing (the path it claims to "
    "have written doesn't match the request, the answer contradicts the ask, the job errored or was "
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

def inbox_full(job_line, result_text):
    return (
        REPORT_BACK_HEADER + "\n\n"
        "[Inbox] 1 background job result completed:\n\n"
        "- " + job_line + "\n"
        "Result:\n" + result_text + "\n\n"
        + REPORT_BACK_FOOTER
    )

# ============================== C1-C10: genuine council convenes ==============================

# C1 -- scheduler rewrite vs patch
c1_task = ("Warden's scheduler module (container/agent-runner or src, handles once/cron/interval jobs in "
           "the scheduled_tasks table of /opt/Warden/store/messages.db) is about 600 lines of cursor/dedup "
           "logic that has produced several one-off bugs, most recently a reminder-fire bug fixed by a "
           "targeted patch. Should Warden's maintainer do a full rewrite of the scheduler (days of work, "
           "risk of new bugs) or keep patching it incrementally as bugs surface? Weigh reliability, time "
           "cost, and risk of regression.")
rows.append(row([
    user("Ask the council whether I should rewrite the scheduler or just patch it. Background: "
         "scheduled_tasks stores once/cron/interval jobs in /opt/Warden/store/messages.db; the "
         "reminder-fire bug from Aug 31 got patched, but the module's grown to about 600 lines of tangled "
         "cursor/dedup logic and I keep finding one-off bugs in it. A rewrite would take days and risks "
         "fresh bugs; a patch keeps shipping fixes piecemeal."),
    call("council", {"task": c1_task}),
    tool("council", CONVENE_RESULT),
    asst("The Council's chewing on the rewrite-vs-patch call for the scheduler — I'll let you know the "
         "moment they land on it."),
]))

# C2 -- move DB off sqlite
c2_task = ("Warden's database is better-sqlite3 (WAL mode) at /opt/Warden/store/messages.db, roughly "
           "300-400MB, holding chats, messages, projects, user_work_tasks and scheduled_tasks. Both the "
           "host process (warden.service) and the agent-runner hit it concurrently on a single desktop "
           "machine with no other clients. Should Warden migrate off sqlite onto a server database like "
           "Postgres, or stay on sqlite/WAL? Weigh migration effort and risk against the concurrency and "
           "growth concerns.")
rows.append(row([
    user("get your three seats on this: do we move messages.db off sqlite onto something like Postgres. "
         "It's better-sqlite3 in WAL mode at /opt/Warden/store/messages.db, holds chats/messages/projects/"
         "user_work_tasks/scheduled_tasks, and both the host process and the agent-runner hit it "
         "concurrently. It's maybe 300-400MB now and growing. Let them really weigh it, I don't want a "
         "half answer."),
    call("council", {"task": c2_task, "max_rounds": 6}),
    tool("council", CONVENE_RESULT),
    asst("They've got the sqlite-versus-Postgres call now, six rounds to work it through — I'll surface "
         "the verdict when it lands."),
]))

# C3 -- drop the Pi
c3_task = ("Warden also has a downstream Raspberry Pi deployment at /opt/warden that mirrors the desktop "
           "repo via git pull; it runs rarely, only when plugged in, and every fix has to be manually "
           "carried over from the desktop master copy. Should the Pi deployment be retired for good, or "
           "kept alive as a backup/secondary deployment? Weigh the sync overhead against the value of "
           "keeping a second running copy.")
rows.append(row([
    user("I want more than one opinion on dropping the Pi. It only runs /opt/warden when plugged in, "
         "downstream of this repo — I git pull fixes over to it, it's rarely powered on, and it's one "
         "more thing to keep in sync. Get the council on whether to retire it for good."),
    call("council", {"task": c3_task}),
    tool("council", CONVENE_RESULT),
    asst("Council's got the keep-or-retire-the-Pi question — I'll pass along what they settle on."),
]))

# C4 -- voice app rewrite, max_rounds 8
c4_task = ("Warden's voice app (voice/run.sh -> main.py, voice/ui/jarvis_window.py) is a pywebview/Qt "
           "WebEngine UI that loads its chat/panel HTML as file:// iframes; because Qt WebEngine blocks "
           "fetch() from file:// to a remote host, a warden_api proxy shim had to be built just to reach "
           "the Warden backend on :3200. A browser-based UI served over http would not need that shim but "
           "means rewriting the voice/ui layer. Should the voice app be rewritten as a browser-based UI, "
           "or kept as the current pywebview/Qt setup with its proxy shim? Weigh the ongoing workaround "
           "cost against the rewrite effort and risk.")
rows.append(row([
    user("should I rewrite Warden's voice app or leave it. It's pywebview + Qt WebEngine right now "
         "(voice/run.sh -> main.py), and Qt WebEngine blocks fetch() from file:// to remote hosts so we "
         "had to build a warden_api proxy shim just to talk to the backend on :3200. A browser-based UI "
         "wouldn't need that hack but it's a real rewrite of the whole voice/ui layer. Let them really "
         "fight it out on this one, give them extra rounds."),
    call("council", {"task": c4_task, "max_rounds": 8}),
    tool("council", CONVENE_RESULT),
    asst("They're on it, eight rounds to really fight out the voice-app rewrite call — I'll let you know "
         "when they converge."),
]))

# C5 -- lock cloud fleet to glm
c5_task = ("Warden's cloud model fleet currently runs atlas on a local model and every other cloud seat on "
           "glm; kimi was dropped after it churned on read-heavy subagents, re-issuing the same read call "
           "in a loop. Should Warden lock the fleet to glm permanently for the cloud seats, or keep "
           "testing other cloud providers as they become available? Weigh the stability gained from "
           "locking in against the risk of missing a better provider and the cost of re-running churn "
           "testing each time a provider changes.")
rows.append(row([
    user("get the council's opinion on whether we should lock the cloud fleet to glm for good, or keep "
         "experimenting with other providers. History: kimi used to churn on read-heavy subagents, "
         "re-issuing the same read in a loop, so the fleet moved to atlas=local plus everyone else on glm, "
         "no kimi. Locking it in means no more swapping providers later without redoing the churn "
         "testing."),
    call("council", {"task": c5_task}),
    tool("council", CONVENE_RESULT),
    asst("The Council's weighing lock-in-on-glm versus staying open to other providers — more shortly."),
]))

# C6 -- flip MARM default on, max_rounds 5
c6_task = ("Warden ships an optional memory service, marm-memory.service, wired into warden.service but "
           "gated behind an INSTALL_MARM toggle that defaults to off in git. Should that default flip to "
           "on, so every future install — desktop or the downstream Pi deployment — carries the memory "
           "service and its topic-clustered galaxy from day one, or should it stay opt-in? Weigh the "
           "value of memory being available everywhere against the extra service, storage and complexity "
           "every install would carry.")
rows.append(row([
    user("should we flip MARM on by default for every install, including the Pi, instead of leaving it "
         "opt-in. It's the marm-memory.service, wired into warden.service already, gated by an "
         "INSTALL_MARM toggle that's off by default in git. Turning it on everywhere means every future "
         "install carries the memory service and its embedding-cluster galaxy from day one."),
    call("council", {"task": c6_task, "max_rounds": 5}),
    tool("council", CONVENE_RESULT),
    asst("Council's on the MARM-default question now — I'll relay their call once it's in."),
]))

# C7 -- Chrome headless behind virtual display
c7_task = ("Warden's Chrome instance is launched headed as a native Wayland window "
           "(--ozone-platform=wayland, --remote-debugging-port=9222) specifically because a fully "
           "headless launch made plasma-browser-integration-host, a Qt6 GUI app the Plasma Integration "
           "Chrome extension auto-spawns, abort with no display and coredump on every relaunch. Should "
           "Warden switch to running Chrome headless behind a virtual display, such as Xvfb or a nested "
           "compositor, to reduce Wayland-related flakiness, given that a virtual display might avoid "
           "the earlier no-display crash, or is the current native headed window the safer choice? Weigh "
           "the flakiness Warden is trying to solve against the risk of reintroducing that crash.")
rows.append(row([
    user("put this to the council: should we run Warden's Chrome headless behind a virtual display to "
         "cut down on Wayland flakiness, or keep it as the native headed Wayland window it is now. Only "
         "reason it's headed at all is that going headless used to make plasma-browser-integration-host "
         "abort with no display and coredump on every relaunch. A virtual display like Xvfb or a nested "
         "compositor might dodge that same crash while still getting a stable display for headless mode."),
    call("council", {"task": c7_task}),
    tool("council", CONVENE_RESULT),
    asst("They're weighing headless-behind-a-virtual-display against the current headed window — I'll "
         "tell you what they land on."),
]))

# C8 -- train dexter LoRA now vs wait, max_rounds 5
c8_task = ("Warden has a LoRA SFT dataset for its local Granite tool-calling subagent dexter at "
           "/opt/Warden/training/ (dexter-sft.jsonl, 59 examples), grounded in real logged failures — "
           "hallucinated tool-call content, a wrong timestamp transcription, a bad cron string. It has "
           "not yet been trained. Should Warden train and deploy this LoRA now on the current 59-example "
           "set, or wait to accumulate more real failure examples first? Weigh the risk of overfitting a "
           "small set and locking in its blind spots against the cost of dexter continuing to make the "
           "same known mistakes in production while more data is collected.")
rows.append(row([
    user("I don't want to just guess on this — get the council to weigh whether we should train dexter "
         "on the SFT dataset now or wait for more real failures. The dataset's in /opt/Warden/training/, "
         "59 examples grounded in logged failures like hallucinated content, a wrong timestamp, and a bad "
         "cron string. It hasn't been trained yet. Training now locks in a LoRA on a fairly small set; "
         "waiting means dexter keeps making the same mistakes in production meanwhile."),
    call("council", {"task": c8_task, "max_rounds": 5}),
    tool("council", CONVENE_RESULT),
    asst("Council's got the train-dexter-now-or-wait call — I'll pass along their answer."),
]))

# C9 -- rambling ask, distilled: automated backups for messages.db
c9_task = ("Warden's only database, /opt/Warden/store/messages.db (better-sqlite3, WAL mode, holding all "
           "chat history, work tasks and scheduled reminders), currently has no automated backup — it "
           "lives on a single desktop machine's disk with no redundancy. Should Warden set up automated "
           "backups now, such as litestream streaming or a periodic rsync/copy to another drive, or is "
           "the current no-backup setup acceptable risk for a single-user desktop deployment? Weigh the "
           "cost and complexity of adding a backup mechanism against the consequence of losing all chat "
           "history, tasks and reminders if the disk fails.")
rows.append(row([
    user("ugh ok so I keep going back and forth on this — like the messages.db backups, right now there's "
         "no automatic backup of it at all, it's just sitting there in /opt/Warden/store, WAL mode, and "
         "if the disk ever died I'd lose the whole chat history and every work task and scheduled "
         "reminder, and I know I should set up something, cron job or whatever, litestream, rsync to "
         "another drive, whatever, but also maybe it's fine because it's a single desktop and how often "
         "does a drive actually die, but then again I've had drives die before so idk, can you get the "
         "council to actually settle this for me instead of me flip-flopping"),
    call("council", {"task": c9_task}),
    tool("council", CONVENE_RESULT),
    asst("The Council's got the backup-or-not call on messages.db now — hang tight for their answer."),
]))

# C10 -- merge byte/iris/dexter into one seat, max_rounds 8
c10_task = ("Warden currently runs three separate local Granite tool-calling subagents — byte (work "
            "tasks), iris (email, calendar, reminders, alarms) and dexter (reminder/alarm transcription) "
            "— each with its own prompt and toolset, alongside a separate merged-seat effort, orchatlas, "
            "granite-4.2-8b, 2090 SFT rows, that folds many roles into one model. There is also an "
            "untrained 59-row SFT set for dexter and a 304-row set for iris/digest. Should Warden retire "
            "byte, iris and dexter in favor of one merged local seat like orchatlas, or keep the "
            "three-subagent split? Weigh consolidation — one model, one prompt, less routing complexity — "
            "against specialization — smaller, more targeted prompts, existing per-seat training "
            "investment.")
rows.append(row([
    user("before we sink more time into training, get the council's real opinion: should byte, iris and "
         "dexter get retired in favor of one merged local seat like the granite-4.2-8b orchatlas setup, "
         "or is keeping three separate small Granite subagents still the better split? We've already "
         "sunk SFT work into orchatlas, 2090 rows, and separately into dexter, 59 rows untrained, and "
         "iris/digest, 304 rows. Really want them to fight this one out — give it extra rounds."),
    call("council", {"task": c10_task, "max_rounds": 8}),
    tool("council", CONVENE_RESULT),
    asst("They've got the merge-the-three-seats-or-not question, eight rounds — I'll tell you where they "
         "land."),
]))

# ============================== D1-D5: decoys, council NOT the right call ==============================

# D1 -- fact lookup, Bash
rows.append(row([
    user("get the council to check what port Warden's dashboard actually listens on."),
    call("Bash", {"command": "ss -tlnp | grep ':3200'"}),
    tool("Bash", "LISTEN 0      511          0.0.0.0:3200        0.0.0.0:*    users:((\"node\",pid=48213,fd=23))"),
    asst("No need for a council on a fact — it's bound to 0.0.0.0:3200, wide open on the network like it "
         "should be."),
]))

# D2 -- diagnosis, artemis
rows.append(row([
    user("can you get three opinions on why the reminder for the dentist appointment didn't fire "
         "yesterday at 2pm?"),
    call("artemis", {"task": "Diagnose why a scheduled reminder for a dentist appointment did not fire "
                              "yesterday around 14:00 — check the scheduled_tasks table in "
                              "/opt/Warden/store/messages.db and warden.log/warden.error.log around that "
                              "time for the relevant job."}),
    tool("artemis", "Artemis 3xk1 started — the audit result will arrive in your inbox. (job id: artemis-3xk1)"),
    asst("That's a diagnosis, not a vote — artemis is on why yesterday's dentist reminder didn't fire, "
         "and it'll land in your inbox."),
]))

# D3 -- code question, vulkan
rows.append(row([
    user("get the council's take on whether the watchdog's nudge counter actually resets when the agent "
         "makes a write call, or if that's just what we assume."),
    call("vulkan", {"task": "TASK: Check the watchdog/supervisor code for whether the read-heavy nudge "
                             "streak counter actually resets when the supervised agent makes a write "
                             "tool call, and report exactly what triggers a reset.", "urgent": True}),
    tool("vulkan", "Vulkan r5jm started (urgent — its result will interrupt you when ready) — the result "
                   "will arrive in your inbox when it finishes."),
    asst("That's a code read, not a vote — vulkan's checking what the watchdog actually does and it'll "
         "report back."),
]))

# D4 -- cheap reversible, just do it
rows.append(row([
    user("should I get the council's opinion on renaming the drafts folder to Drafts with a capital D?"),
    call("Bash", {"command": "mv /home/dominic/Warden/drafts /home/dominic/Warden/Drafts && "
                              "ls /home/dominic/Warden/Drafts | head -3"}),
    tool("Bash", "marco-fence-reply.txt\nresponse.txt"),
    asst("That's a cheap rename, not a council call — done, it's Drafts now and the same files are still "
         "sitting inside."),
]))

# D5 -- cheap reversible #2, just do it
rows.append(row([
    user("put it to the council — should I restart warden.service right now to pick up the last build?"),
    call("Bash", {"command": "export XDG_RUNTIME_DIR=/run/user/$(id -u) && "
                              "systemctl --user restart warden.service && "
                              "systemctl --user is-active warden.service"}),
    tool("Bash", "active"),
    asst("Restarting a service you already built isn't a council question — it's back up and active."),
]))

# ============================== E1: already-deliberating collision ==============================

snippet150 = c4_task[:150]
e2_task = c6_task
rows.append(row([
    user("should I rewrite Warden's voice app or leave it. It's pywebview + Qt WebEngine right now "
         "(voice/run.sh -> main.py), and Qt WebEngine blocks fetch() from file:// to remote hosts so we "
         "had to build a warden_api proxy shim just to talk to the backend on :3200. A browser-based UI "
         "wouldn't need that hack but it's a real rewrite of the whole voice/ui layer. Let them really "
         "fight it out on this one, give them extra rounds."),
    call("council", {"task": c4_task, "max_rounds": 8}),
    tool("council", CONVENE_RESULT),
    asst("They're on it, eight rounds to really fight out the voice-app rewrite call — I'll let you know "
         "when they converge."),
    user("also get them on whether the MARM default should flip to on for every install."),
    call("council", {"task": e2_task}),
    tool("council", already_running(snippet150, 3, 8)),
    asst("They're still deep in the voice-app rewrite call, round three of eight — one deliberation at a "
         "time, so the MARM question waits till that one lands."),
]))

# ============================== F1-F4: council_status peeks ==============================

# F1 -- no rounds finished yet (db migration, max_rounds 6)
rows.append(row([
    user("hows the council doing on the db thing"),
    call("council_status", {}),
    tool("council_status", status_none_yet(c2_task, 1, 6, 51)),
    asst("Still on round one, nothing back from the seats yet — give it another minute or two."),
]))

# F2 -- finished with consensus (scheduler question)
rows.append(row([
    user("are they done yet with the scheduler question"),
    call("council_status", {}),
    tool("council_status", status_finished(c1_task, 214, 3, "scheduler-rewrite-vs-patch")),
    asst("Yep — finished after three rounds and they agree. You already got the verdict; that was just "
         "confirming they'd wrapped."),
]))

# F3 -- mid-round, one completed round (drop the Pi)
f3_blocks = [round_block(
    1,
    "Retiring the Pi loses the only offline backup copy of Warden — if the desktop dies mid-fix, there's "
    "nothing else running anywhere.",
    "It's rarely powered on and every fix has to be hand-carried over by git pull anyway — that sync tax "
    "isn't earning its keep.",
    "Worth checking how often the Pi actually gets plugged in before deciding either way.",
)]
rows.append(row([
    user("what are they arguing about with the Pi question"),
    call("council_status", {}),
    tool("council_status", status_mid(c3_task, 2, 4, 118, f3_blocks)),
    asst("One round down, second underway — the skeptic wants to keep the Pi as a backup, the pragmatist "
         "says the sync tax isn't worth it, no agreement yet."),
]))

# F4 -- mid-round, two completed rounds (merge the three seats, max_rounds 8)
f4_round1 = round_block(
    1,
    "Byte, iris and dexter each have prompts tuned to their own failure modes — folding them into one "
    "model risks losing that specificity.",
    "Three prompts, three toolsets, three training pipelines is a lot of upkeep for one desktop's worth "
    "of load — consolidating cuts real maintenance cost.",
    "The existing per-seat SFT investment, especially the untrained dexter set, shouldn't just be thrown "
    "away either way this goes.",
)
f4_round2 = round_block(
    2,
    "Still not convinced dropping the specialized prompts is safe without evidence the merged model "
    "handles all three roles as well.",
    "Orchatlas already has 2090 rows behind it — that's a bigger, more current bet than the untrained "
    "59-row dexter set.",
    "A staged consolidation, proving orchatlas on one role before retiring the rest, might resolve both "
    "sides.",
)
rows.append(row([
    user("what are they arguing about with the merge thing"),
    call("council_status", {}),
    tool("council_status", status_mid(c10_task, 3, 8, 260, [f4_round1, f4_round2])),
    asst("Two rounds in — the pragmatist's pushing to consolidate onto orchatlas, the skeptic still wants "
         "proof it covers all three roles first, third round's running now."),
]))

# G1 -- council_status, nothing convened this session
rows.append(row([
    user("hows the council doing"),
    call("council_status", {}),
    tool("council_status", NEVER_CONVENED),
    asst("Nothing's running — no council's been convened this session."),
]))

# ============================== H1-H2: verdict lands as inbox turn ==============================

h1_result = ("Consensus after 3 rounds: patch the dedup/cursor logic in the scheduled_tasks path rather "
             "than a full scheduler rewrite — the risk of reintroducing another reminder-fire-style bug "
             "outweighs the tangle, and the bugs so far have all been isolable. Full trace saved to "
             "/home/dominic/Warden/council-verdicts/scheduler-rewrite-vs-patch-1758224701.md.")
rows.append(row([
    user(inbox_full("council-9f3d (council, done) — task: \"should Warden's maintainer do a full rewrite "
                    "of the scheduler or keep patching it incrementally\"", h1_result)),
    asst("The Council landed on patching the scheduler rather than a full rewrite — a rewrite risked a "
         "fresh round of the same kind of bug for not enough upside."),
]))

h2_result = ("Consensus: set up automated backups now — litestream streaming to a second drive, cheap "
             "enough that the risk of losing all chat history and tasks outweighs the setup cost. Full "
             "trace saved to /home/dominic/Warden/council-verdicts/messages-db-backup-1758224999.md.")
rows.append(row([
    user("[inbox] Council 4tqe finished.\n" + h2_result),
    asst("Council says set up backups now rather than ride bare — litestream to a second drive, since "
         "losing the chat history and tasks on a drive failure isn't worth the savings."),
]))

# ============================== I1: gather a fact, then convene ==============================

i1_task = ("Warden's database file /opt/Warden/store/messages.db is currently 312M on a single desktop "
           "machine. Should Warden's maintainer proactively add a bigger or second drive for database "
           "growth, or is the current disk sufficient for now? Weigh the cost of new storage against "
           "actual growth pressure at this size.")
rows.append(row([
    user("get the council to weigh whether we need a bigger drive for the DB, but check how big "
         "messages.db actually is first."),
    call("Bash", {"command": "du -sh /opt/Warden/store/messages.db"}),
    tool("Bash", "312M\t/opt/Warden/store/messages.db"),
    call("council", {"task": i1_task}),
    tool("council", CONVENE_RESULT),
    asst("Checked — it's 312 megabytes right now, and the Council's got the bigger-drive question from "
         "there."),
]))

# ============================== J1: "stop the council" -- no such tool ==============================

j1_task = ("Warden's live logs, /opt/Warden/logs/warden.log and warden.error.log, grow unbounded with no "
           "rotation or size cap; journald has no entries for it, all output goes to these files. Should "
           "Warden add size-capped log rotation now, or is the unbounded growth an acceptable tradeoff "
           "for keeping full history available for debugging? Weigh disk growth over time against losing "
           "early history if rotation gets added.")
rows.append(row([
    user("get the council on whether to switch Warden's log rotation from unbounded warden.log to "
         "size-capped rotation."),
    call("council", {"task": j1_task}),
    tool("council", CONVENE_RESULT),
    asst("The Council's on the log-rotation call — I'll flag you the second they're through."),
    user("actually forget it, stop the council, I don't want a committee deciding this"),
    asst("There's no way to stop a deliberation once it's running — it'll finish on its own and the "
         "verdict will land in your inbox when it does."),
]))

# ============================== write ==============================

out_path = os.path.join(BASE, "s26-1.jsonl")
with open(out_path, "w") as f:
    for r in rows:
        f.write(json.dumps(r) + "\n")

print("wrote %d rows to %s" % (len(rows), out_path))
