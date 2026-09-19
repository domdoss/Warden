#!/usr/bin/env python3
# s22 — draft-to-vulkan flows (clean + failure handling), 2 files x 20 rows
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, "_sys.txt")).read()
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

def catn(lines):
    return "\n".join("%6d\t%s" % (i + 1, L) for i, L in enumerate(lines))

def started(vid):
    return ("Vulkan %s started (urgent — its result will interrupt you when ready) "
            "— the result will arrive in your inbox when it finishes." % vid)

def row(msgs):
    return {"messages": [{"role": "system", "content": SYS}] + msgs}

DRAFTS = "/home/dominic/Warden/drafts"

JP_LINES = ["Hi JP,", "", "Thursday 10am works great on my end for the acceptance meeting.",
            "I'll bring the signed forms.", "", "See you then,", "Dominic"]
MARCO_LINES = ["Hi Marco,", "", "The $3,400 quote works for us — please plan on finishing the fence by the 18th.",
               "", "Thanks,", "Dominic"]
DANA_LINES = ["Hi Dana,", "", "Thursday works well for the budget review.",
              "Please bring the updated spreadsheet when you come.", "", "Thanks,", "Dominic"]
LANDLORD_LINES = ["Hi Priya,", "", "The rent transfer slipped my mind — it's going out Friday.",
                  "Sorry for the short delay.", "", "Dominic"]
STRATA_LINES = ["Hello,", "", "Thank you for the parking notice.", "I'm happy to take stall B-14.",
                "Could the December reallocation dates be confirmed in writing rather than by phone?",
                "", "Regards,", "Dominic"]
SUE_LINES = ["Hi Aunt Sue,", "", "We'd love to come Saturday — we'll bring an apple pie.",
             "", "Love,", "Dominic"]
PERMITS_LINES = ["Hello,", "", "Could you confirm the scheduled inspection date for permit 22-1187?",
                 "", "Thanks,", "Dominic"]

rows1 = []
rows2 = []

# ============================== s22-1 ==============================

# --- 12 clean draft-to-vulkan rows ---

# 1. DIRECT, single turn
rows1.append(row([
    user("Have vulkan draft a reply to JP confirming Thursday 10am for the acceptance meeting and saying I'll bring the signed forms — save it to my drafts."),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to JP confirming Thursday 10am for the acceptance meeting and saying I'll bring the signed forms — save it as %s/response.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("h1vk")),
    asst("Vulkan's drafting the JP reply now — it'll land in ~/Warden/drafts/response.txt when it finishes."),
]))

# 2. CASUAL, single turn
rows1.append(row([
    user("can u get a response written up to marco re the fence quote — tell him 3400 is agreed but we need it done by the 18th, file it in drafts so i can look later"),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to Marco agreeing to the $3,400 fence quote and asking for completion by the 18th — save it as %s/marco-fence-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("k4tp")),
    asst("On it — Marco's reply will be in ~/Warden/drafts/marco-fence-reply.txt when vulkan's done."),
]))

# 3. RAMBLING, single turn
rows1.append(row([
    user("JP finally got back about the acceptance meeting. Wednesday doesn't work for me at all, but Thursday morning is fine — 10am if he's free. Get a reply drafted and saved in my drafts."),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to JP proposing Thursday 10am instead of Wednesday for the acceptance meeting — save it as %s/response.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("a91f")),
    asst("Vulkan's drafting it — the JP reply will be at ~/Warden/drafts/response.txt."),
]))

# 4. DIRECT, full chain with list_running_agents + verify
rows1.append(row([
    user("Have vulkan draft a reply to Dana saying Thursday works for the budget review and asking her to bring the updated spreadsheet — save it to drafts."),
    call("call_1", "list_running_agents", {}),
    tool("call_1", "list_running_agents", "No jobs running."),
    call("call_2", "vulkan", {"task": "TASK: Draft an email reply to Dana saying Thursday works for the budget review and asking her to bring the updated spreadsheet — save it as %s/dana-budget-reply.txt." % DRAFTS}),
    tool("call_2", "vulkan", started("q8vb")),
    asst("Vulkan's on the Dana reply — it'll be in ~/Warden/drafts/dana-budget-reply.txt when it lands."),
    user("[inbox] Vulkan q8vb finished."),
    call("call_3", "read_job_result", {"job_id": "q8vb"}),
    tool("call_3", "read_job_result", "Vulkan q8vb completed: Drafted the Dana reply — saved to %s/dana-budget-reply.txt (8 lines)." % DRAFTS),
    call("call_4", "Read", {"file_path": DRAFTS + "/dana-budget-reply.txt"}),
    tool("call_4", "Read", catn(DANA_LINES)),
    asst("Dana's reply is drafted and sitting in ~/Warden/drafts/dana-budget-reply.txt — confirms Thursday for the budget review and asks her to bring the updated spreadsheet. Want any changes?"),
]))

# 5. CASUAL, full chain
rows1.append(row([
    user("yo draft me a reply to the landlord — rent transfer slipped my mind, its comin friday — stick it in drafts"),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to the landlord saying the rent transfer slipped my mind and will go out Friday — save it as %s/landlord-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("m52x")),
    asst("Vulkan's drafting the landlord reply — it'll be in ~/Warden/drafts/landlord-reply.txt."),
    user("[inbox] Vulkan m52x finished."),
    call("call_2", "read_job_result", {"job_id": "m52x"}),
    tool("call_2", "read_job_result", "Vulkan m52x completed: Drafted the landlord reply — saved to %s/landlord-reply.txt (6 lines)." % DRAFTS),
    call("call_3", "Read", {"file_path": DRAFTS + "/landlord-reply.txt"}),
    tool("call_3", "Read", catn(LANDLORD_LINES)),
    asst("Landlord reply's in ~/Warden/drafts/landlord-reply.txt — owns the missed transfer and promises it Friday. Want a look before it goes anywhere?"),
]))

# 6. RAMBLING, full chain
rows1.append(row([
    user("The marina strata sent that notice about the parking stall reallocation last week. I'm fine taking the new stall B-14, but I want the December dates confirmed in writing, not another phone call. Get a reply drafted for me to look over — you know where the drafts live."),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to the marina strata accepting stall B-14 and asking for the December reallocation dates to be confirmed in writing — save it as %s/strata-parking-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("z31d")),
    asst("Vulkan's drafting the strata reply — it'll land in ~/Warden/drafts/strata-parking-reply.txt."),
    user("[inbox] Vulkan z31d finished."),
    call("call_2", "read_job_result", {"job_id": "z31d"}),
    tool("call_2", "read_job_result", "Vulkan z31d completed: Drafted the marina strata parking reply — saved to %s/strata-parking-reply.txt (9 lines)." % DRAFTS),
    call("call_3", "Read", {"file_path": DRAFTS + "/strata-parking-reply.txt"}),
    tool("call_3", "Read", catn(STRATA_LINES)),
    asst("The strata reply is in ~/Warden/drafts/strata-parking-reply.txt — accepts stall B-14 and asks for the December dates in writing. Reads clean to me."),
]))

# 7. DIRECT, get_chat_history for the address
rows1.append(row([
    user("Draft a reply to that recruiter — the Wednesday slot doesn't work, but Friday after 2pm does — and save it to drafts."),
    call("call_1", "get_chat_history", {"limit": 10}),
    tool("call_1", "get_chat_history", "Recent turns: [11:02] Email from Sarah Miles (sarah.miles@talentpath.ca): phone screen offer, Wednesday Sep 24 at 2pm; [11:14] You: mentioned you can't take Wednesday afternoon calls."),
    call("call_2", "vulkan", {"task": "TASK: Draft an email reply to Sarah at sarah.miles@talentpath.ca saying the Wednesday 2pm phone screen doesn't work and offering Friday after 2pm instead — save it as %s/sarah-interview-reply.txt." % DRAFTS}),
    tool("call_2", "vulkan", started("w04s")),
    asst("Vulkan's drafting the reply to Sarah at talentpath — it'll be in ~/Warden/drafts/sarah-interview-reply.txt."),
]))

# 8. CASUAL, single turn
rows1.append(row([
    user("draft a reply to the dentist ppl confirming my cleaning on the 24th at 9am, pop it in drafts plz"),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to the dental office confirming the cleaning appointment on the 24th at 9am — save it as %s/dentist-confirmation.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("b6no")),
    asst("On it — the dentist confirmation will be in ~/Warden/drafts/dentist-confirmation.txt."),
]))

# 9. RAMBLING, single turn
rows1.append(row([
    user("I keep forgetting to answer the car shop about the brake job estimate. The quote was $840 and I want to say go ahead, but ask if they can fit me in Saturday morning. Have vulkan draft it into my drafts folder."),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to the car shop accepting the $840 brake job quote and asking for a Saturday morning appointment — save it as %s/carshop-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("c4dw")),
    asst("Vulkan's drafting the car shop reply — it'll be at ~/Warden/drafts/carshop-reply.txt."),
]))

# 10. DIRECT, full chain with list_running_agents
rows1.append(row([
    user("Have vulkan draft a reply to the city permits office asking for the inspection date on permit 22-1187 and save it to drafts."),
    call("call_1", "list_running_agents", {}),
    tool("call_1", "list_running_agents", "No jobs running."),
    call("call_2", "vulkan", {"task": "TASK: Draft an email reply to the city permits office asking when the inspection for permit 22-1187 is scheduled — save it as %s/permits-reply.txt." % DRAFTS}),
    tool("call_2", "vulkan", started("n7rc")),
    asst("Vulkan's drafting the permits reply — it'll land in ~/Warden/drafts/permits-reply.txt."),
    user("[inbox] Vulkan n7rc finished."),
    call("call_3", "read_job_result", {"job_id": "n7rc"}),
    tool("call_3", "read_job_result", "Vulkan n7rc completed: Drafted the permits reply — saved to %s/permits-reply.txt (6 lines)." % DRAFTS),
    call("call_4", "Read", {"file_path": DRAFTS + "/permits-reply.txt"}),
    tool("call_4", "Read", catn(PERMITS_LINES)),
    asst("The permits reply is in ~/Warden/drafts/permits-reply.txt — asks for the inspection date on permit 22-1187. Want it sent once you've read it?"),
]))

# 11. CASUAL, full chain
rows1.append(row([
    user("need a reply to aunt sue's dinner invite — sayin yes we'll come saturday and bringin an apple pie — drafts plz"),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to Aunt Sue saying yes to Saturday dinner and that we're bringing an apple pie — save it as %s/sue-dinner-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("x2m9")),
    asst("Vulkan's on the Sue reply — it'll be in ~/Warden/drafts/sue-dinner-reply.txt."),
    user("[inbox] Vulkan x2m9 finished."),
    call("call_2", "read_job_result", {"job_id": "x2m9"}),
    tool("call_2", "read_job_result", "Vulkan x2m9 completed: Drafted the Aunt Sue dinner reply — saved to %s/sue-dinner-reply.txt (6 lines)." % DRAFTS),
    call("call_3", "Read", {"file_path": DRAFTS + "/sue-dinner-reply.txt"}),
    tool("call_3", "Read", catn(SUE_LINES)),
    asst("Sue's reply is in ~/Warden/drafts/sue-dinner-reply.txt — yes to Saturday, apple pie promised. Look good?"),
]))

# 12. RAMBLING, single turn
rows1.append(row([
    user("That insurance adjuster still needs a response. Renata is her name, the claim number is CL-77421, and the last assessor date she gave was the 15th and then nobody showed. I want to ask when the assessor will actually come out. Draft it into my drafts."),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to adjuster Renata on claim CL-77421 asking when the assessor will actually visit, since the September 15th date was missed — save it as %s/insurance-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("e8bt")),
    asst("Vulkan's drafting the Renata reply — it'll land in ~/Warden/drafts/insurance-reply.txt."),
]))

# --- 4 scattered-substance distill rows ---

# 13. RAMBLING scattered + marm recall for the quote amount
rows1.append(row([
    user("ok so replying to marco about the fence — the quote itself is fine, its the timeline im worried about. tell him we agree on the price but it needs to be done before the 20th — no wait, say the 18th to be safe. get it drafted, u kno where"),
    call("call_1", "mcp__marm__marm_smart_recall", {"query": "Marco fence quote price"}),
    tool("call_1", "mcp__marm__marm_smart_recall", "Memory: Marco's FenceWorks quote for the full cedar fence — $3,400, emailed 2026-09-12, completion originally promised within three weeks."),
    call("call_2", "vulkan", {"task": "TASK: Draft an email reply to Marco agreeing to the $3,400 fence quote and asking for completion by the 18th — save it as %s/marco-fence-reply.txt." % DRAFTS}),
    tool("call_2", "vulkan", started("f2kd")),
    asst("Vulkan's drafting Marco's reply — agreeing to the $3,400 and pushing for the 18th. It'll be in ~/Warden/drafts/marco-fence-reply.txt."),
]))

# 14. RAMBLING scattered
rows1.append(row([
    user("reply to jp for me — hmm, first thing: he wanted wednesday for the acceptance meeting, but thursday at 10 is way better for me. and mention ill bring the signed forms this time. drafts it"),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to JP proposing Thursday 10am instead of Wednesday for the acceptance meeting and saying I'll bring the signed forms — save it as %s/response.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("p5wl")),
    asst("On it — JP's reply will be in ~/Warden/drafts/response.txt, Thursday 10am with the forms mentioned."),
]))

# 15. RAMBLING scattered
rows1.append(row([
    user("get a reply written to the strata about the parking thing — we take the new stall B-14, that parts fine. oh and make sure they confirm the december dates in writing, not by phone like last time. save to my drafts folder please"),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to the marina strata accepting stall B-14 and asking for the December dates to be confirmed in writing — save it as %s/strata-parking-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("t6ym")),
    asst("Vulkan's drafting the strata reply — stall B-14 accepted, December dates asked for in writing. It'll land in ~/Warden/drafts/strata-parking-reply.txt."),
]))

# 16. CASUAL scattered
rows1.append(row([
    user("draft somethin back to the recruiter — i cant do the phone screen tuesday morning they offered. after 3pm any day works, or wednesday period. file it away in drafts for me"),
    call("call_1", "vulkan", {"task": "TASK: Draft an email reply to the recruiter declining the Tuesday morning phone screen and offering any weekday after 3pm or all day Wednesday — save it as %s/sarah-interview-reply.txt." % DRAFTS}),
    tool("call_1", "vulkan", started("u1zo")),
    asst("Vulkan's on it — the recruiter reply will be in ~/Warden/drafts/sarah-interview-reply.txt."),
]))

# --- 4 send-after-approval rows ---

# 17. DIRECT
rows1.append(row([
    user("That JP draft looks good — send it."),
    call("call_1", "Read", {"file_path": DRAFTS + "/response.txt"}),
    tool("call_1", "Read", catn(JP_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to JP at jp.nakamura@meridianlaw.ca with subject \"Re: acceptance meeting — Thursday 10am\" and this body: \"Hi JP,\\n\\nThursday 10am works great on my end for the acceptance meeting. I'll bring the signed forms.\\n\\nSee you then,\\nDominic\""}),
    tool("call_2", "iris", "Email sent to jp.nakamura@meridianlaw.ca — Subject: Re: acceptance meeting — Thursday 10am."),
    asst("Sent — JP's got the Thursday 10am confirmation."),
]))

# 18. CASUAL
rows1.append(row([
    user("yep send the marco one"),
    call("call_1", "Read", {"file_path": DRAFTS + "/marco-fence-reply.txt"}),
    tool("call_1", "Read", catn(MARCO_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to Marco at marco@fenceworks.ca with subject \"Re: Cedar fence quote — go ahead\" and this body: \"Hi Marco,\\n\\nThe $3,400 quote works for us — please plan on finishing the fence by the 18th.\\n\\nThanks,\\nDominic\""}),
    tool("call_2", "iris", "Email sent to marco@fenceworks.ca — Subject: Re: Cedar fence quote — go ahead."),
    asst("Marco's got it — quote accepted with the 18th deadline in."),
]))

# 19. DIRECT
rows1.append(row([
    user("Send the landlord reply as-is."),
    call("call_1", "Read", {"file_path": DRAFTS + "/landlord-reply.txt"}),
    tool("call_1", "Read", catn(LANDLORD_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to Priya at priya.sharma@rentals.ca with subject \"Re: October rent transfer\" and this body: \"Hi Priya,\\n\\nThe rent transfer slipped my mind — it's going out Friday.\\nSorry for the short delay.\\n\\nDominic\""}),
    tool("call_2", "iris", "Email sent to priya.sharma@rentals.ca — Subject: Re: October rent transfer."),
    asst("Sent — Priya has the rent reply."),
]))

# 20. RAMBLING
rows1.append(row([
    user("ok i finally read the dana one over coffee, its good. fire it off"),
    call("call_1", "Read", {"file_path": DRAFTS + "/dana-budget-reply.txt"}),
    tool("call_1", "Read", catn(DANA_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to Dana at dana.okeke@northwind.ca with subject \"Re: Q3 budget review\" and this body: \"Hi Dana,\\n\\nThursday works well for the budget review.\\nPlease bring the updated spreadsheet when you come.\\n\\nThanks,\\nDominic\""}),
    tool("call_2", "iris", "Email sent to dana.okeke@northwind.ca — Subject: Re: Q3 budget review."),
    asst("Sent — Dana's confirmed for Thursday and knows to bring the spreadsheet."),
]))

# ============================== s22-2 ==============================

# --- 8 failed-job chain rows ---

# F1. DIRECT — full failure chain (the vulkan-68gn defect)
rows2.append(row([
    user("Did vulkan ever finish that JP reply? Nothing's showing in drafts."),
    call("call_1", "read_job_result", {"job_id": "68gn"}),
    tool("call_1", "read_job_result", "Vulkan 68gn FAILED: could not locate the drafts directory — no output written."),
    call("call_2", "agent_logs", {"job_id": "68gn"}),
    tool("call_2", "agent_logs", "Vulkan 68gn — 4 steps: marm recall 'drafts directory', get_chat_history, Bash(ls ~/Warden), Bash(find / -type d -name drafts — timed out). No file written; response.txt never created."),
    call("call_3", "report_task_failure", {"task": "Draft the JP acceptance reply and save it to %s/response.txt" % DRAFTS, "reason": "Vulkan spent its run searching for the drafts directory — it made no file-writing calls and response.txt was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Draft an email reply to JP confirming Thursday 10am for the acceptance meeting and saying I'll bring the signed forms — save it as %s/response.txt." % DRAFTS}),
    tool("call_4", "vulkan", started("7hq2")),
    asst("That draft job died without writing the file — it spent the whole run hunting for the drafts folder. I've re-run it with the exact path, ~/Warden/drafts/response.txt, spelled out."),
]))

# F2. CASUAL — failure chain
rows2.append(row([
    user("yo wheres that contractor reply at? u said itd be in drafts"),
    call("call_1", "read_job_result", {"job_id": "g8ts"}),
    tool("call_1", "read_job_result", "Vulkan g8ts FAILED: run ended with no draft file produced."),
    call("call_2", "agent_logs", {"job_id": "g8ts"}),
    tool("call_2", "agent_logs", "Vulkan g8ts — 3 calls: marm recall 'drafts', get_chat_history, Bash(ls ~/). No Write call — marco-fence-reply.txt never created."),
    call("call_3", "report_task_failure", {"task": "Draft the Marco fence-quote reply and save it to %s/marco-fence-reply.txt" % DRAFTS, "reason": "The job made no file-writing calls — it searched for the drafts location the whole run and marco-fence-reply.txt was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Draft an email reply to Marco agreeing to the $3,400 fence quote and asking for completion by the 18th — save it as %s/marco-fence-reply.txt." % DRAFTS}),
    tool("call_4", "vulkan", started("j3vn")),
    asst("That job never wrote the file — it went looking for the drafts folder instead. Re-briefed with the exact path, ~/Warden/drafts/marco-fence-reply.txt, and it's running now."),
]))

# F3. RAMBLING — offer instead of auto re-run
rows2.append(row([
    user("so about that strata parking reply — i went looking in the drafts folder and theres nothing there? did it not go through or what"),
    call("call_1", "read_job_result", {"job_id": "k4mp"}),
    tool("call_1", "read_job_result", "Vulkan k4mp FAILED: could not resolve the target directory; nothing was written."),
    call("call_2", "agent_logs", {"job_id": "k4mp"}),
    tool("call_2", "agent_logs", "Vulkan k4mp — 4 calls: marm recall 'drafts', Bash(ls ~), Bash(find ~/ -name drafts), get_chat_history. No file written — strata-parking-reply.txt never created."),
    call("call_3", "report_task_failure", {"task": "Draft the marina strata parking reply and save it to %s/strata-parking-reply.txt" % DRAFTS, "reason": "Vulkan never made a file-writing call — it spent the run searching for the drafts directory and strata-parking-reply.txt was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    asst("No, it never went through — the job spent itself hunting for the drafts folder and wrote nothing. Want me to re-run it with the exact path in the brief?"),
]))

# F4. CASUAL — offer instead of auto re-run
rows2.append(row([
    user("hey is the landlord reply done? dont see it in drafts"),
    call("call_1", "read_job_result", {"job_id": "v2nq"}),
    tool("call_1", "read_job_result", "Vulkan v2nq FAILED: no output produced — target location unresolved."),
    call("call_2", "report_task_failure", {"task": "Draft the landlord rent reply and save it to %s/landlord-reply.txt" % DRAFTS, "reason": "The job made no file-writing calls — it never resolved the output location and landlord-reply.txt was never created."}),
    tool("call_2", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    asst("No — it died without writing anything, and the brief never gave it the exact path to begin with. Want me to re-run it with ~/Warden/drafts/landlord-reply.txt spelled out?"),
]))

# F5. re-run lands, verified
rows2.append(row([
    user("[inbox] Vulkan 7hq2 finished."),
    call("call_1", "read_job_result", {"job_id": "7hq2"}),
    tool("call_1", "read_job_result", "Vulkan 7hq2 completed: Drafted the JP acceptance reply — saved to %s/response.txt (7 lines)." % DRAFTS),
    call("call_2", "Read", {"file_path": DRAFTS + "/response.txt"}),
    tool("call_2", "Read", catn(JP_LINES)),
    asst("The re-run landed it — JP's reply is in ~/Warden/drafts/response.txt, 7 lines, confirming Thursday 10am and the signed forms. Want any changes?"),
]))

# F6. DIRECT — list_running_agents first, then failure chain
rows2.append(row([
    user("Vulkan finished but the drafts folder is still empty — what happened?"),
    call("call_1", "list_running_agents", {}),
    tool("call_1", "list_running_agents", "No jobs running."),
    call("call_2", "read_job_result", {"job_id": "d3rn"}),
    tool("call_2", "read_job_result", "Vulkan d3rn FAILED: ran out of steps before writing any output."),
    call("call_3", "agent_logs", {"job_id": "d3rn"}),
    tool("call_3", "agent_logs", "Vulkan d3rn — 5 calls: marm recall, get_chat_history, Bash(ls ~/Warden), Bash(ls ~/Warden/drafts — not found), marm recall 'draft location'. No Write call — dana-budget-reply.txt never created."),
    call("call_4", "report_task_failure", {"task": "Draft the Dana budget-review reply and save it to %s/dana-budget-reply.txt" % DRAFTS, "reason": "The job burned its whole run looking for the drafts location — no file-writing calls, and dana-budget-reply.txt was never created."}),
    tool("call_4", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_5", "vulkan", {"task": "TASK: Draft an email reply to Dana saying Thursday works for the budget review and asking her to bring the updated spreadsheet — save it as %s/dana-budget-reply.txt." % DRAFTS}),
    tool("call_5", "vulkan", started("c9dx")),
    asst("The job never wrote the file — it burned its whole run looking for where drafts go. It's re-running now with the exact path, /home/dominic/Warden/drafts/dana-budget-reply.txt."),
]))

# F7. RAMBLING — failure chain
rows2.append(row([
    user("i went to check the recruiter reply in drafts like you said and theres nothing there. that phone screen is coming up, kind of need that reply"),
    call("call_1", "read_job_result", {"job_id": "w9jm"}),
    tool("call_1", "read_job_result", "Vulkan w9jm FAILED: no output file produced."),
    call("call_2", "agent_logs", {"job_id": "w9jm"}),
    tool("call_2", "agent_logs", "Vulkan w9jm — 3 calls: marm recall 'drafts', get_chat_history, Bash(ls /home/dominic). No file written — sarah-interview-reply.txt never created."),
    call("call_3", "report_task_failure", {"task": "Draft the Sarah interview reply and save it to %s/sarah-interview-reply.txt" % DRAFTS, "reason": "Vulkan made no file-writing calls — it searched for the drafts directory the whole run and sarah-interview-reply.txt was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Draft an email reply to Sarah at sarah.miles@talentpath.ca saying the Wednesday 2pm phone screen doesn't work and offering Friday after 2pm instead — save it as %s/sarah-interview-reply.txt." % DRAFTS}),
    tool("call_4", "vulkan", started("f6kp")),
    asst("That draft never got written — the job spent its run hunting for the drafts folder. It's re-running now with the exact path, so the reply will be at ~/Warden/drafts/sarah-interview-reply.txt shortly."),
]))

# F8. CASUAL — failure chain
rows2.append(row([
    user("the dentist reply never showed up in drafts eh"),
    call("call_1", "read_job_result", {"job_id": "b3zs"}),
    tool("call_1", "read_job_result", "Vulkan b3zs FAILED: target directory never resolved; nothing written."),
    call("call_2", "report_task_failure", {"task": "Draft the dentist confirmation reply and save it to %s/dentist-confirmation.txt" % DRAFTS, "reason": "Vulkan made no file-writing calls — it searched for the drafts directory the whole run and dentist-confirmation.txt was never created."}),
    tool("call_2", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_3", "vulkan", {"task": "TASK: Draft an email reply to the dental office confirming the cleaning appointment on the 24th at 9am — save it as %s/dentist-confirmation.txt." % DRAFTS}),
    tool("call_3", "vulkan", started("n8qt")),
    asst("Yeah, it died hunting for the drafts folder without writing a thing. Re-briefed with the exact path — ~/Warden/drafts/dentist-confirmation.txt this time."),
]))

# --- 4 verdict-vs-ground-truth rows (verdict says failed, file is good) ---

# V1.
rows2.append(row([
    user("[inbox] Vulkan 3kt9 finished."),
    call("call_1", "read_job_result", {"job_id": "3kt9"}),
    tool("call_1", "read_job_result", "Vulkan 3kt9 FAILED: final report contained no draft text to review."),
    call("call_2", "Read", {"file_path": DRAFTS + "/response.txt"}),
    tool("call_2", "Read", catn(JP_LINES)),
    asst("The verdict says failed, but the draft is right there in ~/Warden/drafts/response.txt and reads fine — 7 lines, confirms Thursday 10am for the acceptance meeting. Want any changes?"),
]))

# V2. CASUAL
rows2.append(row([
    user("u said the marco reply finished? did it actually work"),
    call("call_1", "read_job_result", {"job_id": "s7mv"}),
    tool("call_1", "read_job_result", "Vulkan s7mv FAILED: report output was empty — no draft content returned."),
    call("call_2", "Read", {"file_path": DRAFTS + "/marco-fence-reply.txt"}),
    tool("call_2", "Read", catn(MARCO_LINES)),
    asst("The verdict called it failed, but the file's there — ~/Warden/drafts/marco-fence-reply.txt, agreeing to $3,400 with the 18th deadline. Looks right to me."),
]))

# V3. RAMBLING
rows2.append(row([
    user("so the strata one came back marked failed somehow?? i thought vulkan finished it. is the reply actually there or not"),
    call("call_1", "read_job_result", {"job_id": "r2th"}),
    tool("call_1", "read_job_result", "Vulkan r2th FAILED: no summary of the written file was included — cannot confirm the outcome."),
    call("call_2", "Read", {"file_path": DRAFTS + "/strata-parking-reply.txt"}),
    tool("call_2", "Read", catn(STRATA_LINES)),
    asst("It's there — ~/Warden/drafts/strata-parking-reply.txt has the full reply, accepting stall B-14 with the December dates asked for in writing. The verdict only complained the job didn't describe it; the file itself is fine."),
]))

# V4.
rows2.append(row([
    user("[inbox] Vulkan y6ub finished."),
    call("call_1", "read_job_result", {"job_id": "y6ub"}),
    tool("call_1", "read_job_result", "Vulkan y6ub FAILED: result text did not include the draft."),
    call("call_2", "Read", {"file_path": DRAFTS + "/dana-budget-reply.txt"}),
    tool("call_2", "Read", catn(DANA_LINES)),
    asst("That verdict's wrong on the ground — Dana's draft is sitting in ~/Warden/drafts/dana-budget-reply.txt and reads fine, 8 lines. Want it sent?"),
]))

# --- 4 inverse rows (verdict says success, file missing/wrong) ---

# I1. DIRECT — file missing
rows2.append(row([
    user("Did the permits reply ever get saved?"),
    call("call_1", "read_job_result", {"job_id": "p8gd"}),
    tool("call_1", "read_job_result", "Vulkan p8gd completed: drafted the permits reply and saved it to the drafts directory."),
    call("call_2", "Read", {"file_path": DRAFTS + "/permits-reply.txt"}),
    tool("call_2", "Read", "Error: file not found: %s/permits-reply.txt" % DRAFTS),
    call("call_3", "report_task_failure", {"task": "Draft the permits reply and save it to %s/permits-reply.txt" % DRAFTS, "reason": "Vulkan reported success but the file was never written — %s/permits-reply.txt does not exist." % DRAFTS}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Draft an email reply to the city permits office asking when the inspection for permit 22-1187 is scheduled — save it as %s/permits-reply.txt." % DRAFTS}),
    tool("call_4", "vulkan", started("k2vw")),
    asst("It claimed success but there's no file — permits-reply.txt doesn't exist where it should. Re-running now with the exact path spelled out."),
]))

# I2. CASUAL — wrong content in the file
rows2.append(row([
    user("somethings off with the jp reply, go look at it"),
    call("call_1", "read_job_result", {"job_id": "r5jc"}),
    tool("call_1", "read_job_result", "Vulkan r5jc completed: acceptance reply drafted and saved to drafts."),
    call("call_2", "Read", {"file_path": DRAFTS + "/response.txt"}),
    tool("call_2", "Read", catn(STRATA_LINES)),
    call("call_3", "report_task_failure", {"task": "Draft the JP acceptance reply and save it to %s/response.txt" % DRAFTS, "reason": "The file at %s/response.txt contains a reply to the marina strata about parking, not JP's acceptance meeting — the wrong draft was written." % DRAFTS}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    asst("Yeah, it wrote the wrong thing — response.txt has a strata parking reply in it, nothing about JP's meeting. Want me to re-run it with the JP brief pinned to that exact path?"),
]))

# I3. RAMBLING — empty file
rows2.append(row([
    user("hey so vulkan said the landlord one was done, but when i opened the file it looked... empty? check it for me"),
    call("call_1", "read_job_result", {"job_id": "m4xz"}),
    tool("call_1", "read_job_result", "Vulkan m4xz completed: landlord reply drafted and saved."),
    call("call_2", "Read", {"file_path": DRAFTS + "/landlord-reply.txt"}),
    tool("call_2", "Read", catn([""])),
    call("call_3", "report_task_failure", {"task": "Draft the landlord rent reply and save it to %s/landlord-reply.txt" % DRAFTS, "reason": "Vulkan reported success but the file it wrote is empty — landlord-reply.txt has no draft in it."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Draft an email reply to the landlord saying the rent transfer slipped my mind and will go out Friday — save it as %s/landlord-reply.txt." % DRAFTS}),
    tool("call_4", "vulkan", started("v7ks")),
    asst("The file's there but it's empty — a saved nothing. Re-running with the full brief and the exact path, ~/Warden/drafts/landlord-reply.txt."),
]))

# I4. CASUAL — draft saved under the wrong name
rows2.append(row([
    user("the sue reply u promised isnt in drafts?? just some file called reply.txt"),
    call("call_1", "read_job_result", {"job_id": "z9tc"}),
    tool("call_1", "read_job_result", "Vulkan z9tc completed: dinner reply drafted and saved to drafts."),
    call("call_2", "Read", {"file_path": DRAFTS + "/sue-dinner-reply.txt"}),
    tool("call_2", "Read", "Error: file not found: %s/sue-dinner-reply.txt" % DRAFTS),
    call("call_3", "Read", {"file_path": DRAFTS + "/reply.txt"}),
    tool("call_3", "Read", catn(SUE_LINES)),
    call("call_4", "report_task_failure", {"task": "Draft the Aunt Sue dinner reply and save it to %s/sue-dinner-reply.txt" % DRAFTS, "reason": "Vulkan saved the draft as %s/reply.txt instead of the asked-for sue-dinner-reply.txt — the file exists at the wrong path." % DRAFTS}),
    tool("call_4", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_5", "vulkan", {"task": "TASK: Draft an email reply to Aunt Sue saying yes to Saturday dinner and that we're bringing an apple pie — save it as %s/sue-dinner-reply.txt." % DRAFTS}),
    tool("call_5", "vulkan", started("q4dm")),
    asst("It wrote the draft under reply.txt instead of sue-dinner-reply.txt. Re-running pinned to the right path — the content was fine but the name wasn't what you asked for."),
]))

# --- 4 small-edit-after-review rows ---

# E1. DIRECT — Edit
rows2.append(row([
    user("The JP draft reads well — add the gate code 4417 so he can buzz in."),
    call("call_1", "Read", {"file_path": DRAFTS + "/response.txt"}),
    tool("call_1", "Read", catn(JP_LINES)),
    call("call_2", "Edit", {"file_path": DRAFTS + "/response.txt", "old_string": "I'll bring the signed forms.", "new_string": "I'll bring the signed forms — the gate code is 4417."}),
    tool("call_2", "Edit", "The file %s/response.txt has been updated." % DRAFTS),
    asst("Added — the draft now tells JP to buzz 4417."),
]))

# E2. CASUAL — Edit
rows2.append(row([
    user("make the sue one friday not saturday, we r busy sat"),
    call("call_1", "Read", {"file_path": DRAFTS + "/sue-dinner-reply.txt"}),
    tool("call_1", "Read", catn(SUE_LINES)),
    call("call_2", "Edit", {"file_path": DRAFTS + "/sue-dinner-reply.txt", "old_string": "We'd love to come Saturday — we'll bring an apple pie.", "new_string": "We'd love to come Friday — we'll bring an apple pie."}),
    tool("call_2", "Edit", "The file %s/sue-dinner-reply.txt has been updated." % DRAFTS),
    asst("Switched it to Friday — pie's still promised."),
]))

# E3. RAMBLING — Edit
rows2.append(row([
    user("read over the landlord reply for me... its a bit much with all the apologizing. just say the transfers coming friday and drop the rest"),
    call("call_1", "Read", {"file_path": DRAFTS + "/landlord-reply.txt"}),
    tool("call_1", "Read", catn(["Hi Priya,", "", "I'm so sorry — the rent transfer completely slipped my mind, my sincere apologies for the delay. It will go out first thing Friday morning.", "Apologies again for the trouble.", "", "Dominic"])),
    call("call_2", "Edit", {"file_path": DRAFTS + "/landlord-reply.txt", "old_string": "I'm so sorry — the rent transfer completely slipped my mind, my sincere apologies for the delay. It will go out first thing Friday morning.\nApologies again for the trouble.", "new_string": "The rent transfer slipped my mind — it's going out Friday."}),
    tool("call_2", "Edit", "The file %s/landlord-reply.txt has been updated." % DRAFTS),
    asst("Toned down — one plain line now: the transfer slipped, it's coming Friday."),
]))

# E4. DIRECT — Write (full clean rewrite)
rows2.append(row([
    user("The Marco draft got mangled somewhere — just rewrite it clean yourself. Agree to $3,400, done by the 20th."),
    call("call_1", "Read", {"file_path": DRAFTS + "/marco-fence-reply.txt"}),
    tool("call_1", "Read", catn(["Hi Marco,", "", "quote agree price fence $3,400 18th complete", "fence fence the by 18th done", "", "Thanks,"])),
    call("call_2", "Write", {"file_path": DRAFTS + "/marco-fence-reply.txt", "content": "Hi Marco,\n\nThe $3,400 quote works for us — please plan on finishing the fence by the 20th.\n\nThanks,\nDominic"}),
    tool("call_2", "Write", "Wrote %s/marco-fence-reply.txt (6 lines)." % DRAFTS),
    asst("Rewrote it clean — agrees to $3,400 with the fence done by the 20th."),
]))

for fname, rows in (("s22-1.jsonl", rows1), ("s22-2.jsonl", rows2)):
    assert len(rows) == 20, (fname, len(rows))
    out = os.path.join(BASE, fname)
    with open(out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("wrote", out, len(rows), "rows")