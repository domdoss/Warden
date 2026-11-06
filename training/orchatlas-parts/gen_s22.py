#!/usr/bin/env python3
# s22 — email reply drafting (seat composes + write_file, then iris sends) +
# delegation failure handling. 2 files x 20 rows.
#
# 2026-11-06 rewrite: drafting an email reply is text composition the seat does
# itself with write_file, NOT a vulkan background job (vulkan owns code). Only
# the SEND goes to iris. The failure/verdict rows (s22-2) keep their
# general delegation-failure structure but no longer misroute drafting.
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

def write_draft(cid, path, lines):
    content = "\n".join(lines)
    return [call(cid, "write_file", {"path": path, "content": content}),
            tool(cid, "write_file", "The file %s was written (%d lines)." % (path, len(lines)))]

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
SARAH_LINES = ["Hi Sarah,", "", "Thanks for the phone screen offer. Wednesday 2pm doesn't work —",
               "would Friday after 2pm suit you instead?", "", "Best,", "Dominic"]
DENTIST_LINES = ["Hello,", "", "Just confirming my cleaning on the 24th at 9am.", "", "Thanks,", "Dominic"]
CARSHOP_LINES = ["Hi,", "", "Go ahead with the $840 brake job — can you fit me in Saturday morning?",
                 "", "Thanks,", "Dominic"]
RENATA_LINES = ["Hi Renata,", "", "Re claim CL-77421 — the assessor was due on the 15th but nobody came.",
                "When will the assessor actually visit?", "", "Thanks,", "Dominic"]

rows1 = []
rows2 = []

# ============================== s22-1 ==============================

# --- 12 clean draft rows (seat composes + write_file) ---

# 1. DIRECT, single turn
rows1.append(row([
    user("Draft a reply to JP confirming Thursday 10am for the acceptance meeting and saying I'll bring the signed forms — save it to my drafts."),
    *write_draft("call_1", DRAFTS + "/response.txt", JP_LINES),
    asst("Done — the JP reply is in ~/Warden/drafts/response.txt, confirming Thursday 10am and the signed forms."),
]))

# 2. CASUAL, single turn
rows1.append(row([
    user("can u get a response written up to marco re the fence quote — tell him 3400 is agreed but we need it done by the 18th, file it in drafts so i can look later"),
    *write_draft("call_1", DRAFTS + "/marco-fence-reply.txt", MARCO_LINES),
    asst("On it — Marco's reply is saved to ~/Warden/drafts/marco-fence-reply.txt, agreeing to $3,400 with the 18th deadline."),
]))

# 3. RAMBLING, single turn
rows1.append(row([
    user("JP finally got back about the acceptance meeting. Wednesday doesn't work for me at all, but Thursday morning is fine — 10am if he's free. Get a reply drafted and saved in my drafts."),
    *write_draft("call_1", DRAFTS + "/response.txt", JP_LINES),
    asst("Drafted — ~/Warden/drafts/response.txt proposes Thursday 10am for the acceptance meeting."),
]))

# 4. DIRECT, verify after write
rows1.append(row([
    user("Draft a reply to Dana saying Thursday works for the budget review and asking her to bring the updated spreadsheet — save it to drafts."),
    *write_draft("call_1", DRAFTS + "/dana-budget-reply.txt", DANA_LINES),
    call("call_2", "read_file", {"path": DRAFTS + "/dana-budget-reply.txt"}),
    tool("call_2", "read_file", catn(DANA_LINES)),
    asst("Dana's reply is drafted and sitting in ~/Warden/drafts/dana-budget-reply.txt — confirms Thursday and asks her to bring the updated spreadsheet. Want any changes?"),
]))

# 5. CASUAL, verify after write
rows1.append(row([
    user("yo draft me a reply to the landlord — rent transfer slipped my mind, its comin friday — stick it in drafts"),
    *write_draft("call_1", DRAFTS + "/landlord-reply.txt", LANDLORD_LINES),
    call("call_2", "read_file", {"path": DRAFTS + "/landlord-reply.txt"}),
    tool("call_2", "read_file", catn(LANDLORD_LINES)),
    asst("Landlord reply's in ~/Warden/drafts/landlord-reply.txt — owns the missed transfer and promises it Friday. Want a look before it goes anywhere?"),
]))

# 6. RAMBLING, verify after write
rows1.append(row([
    user("The marina strata sent that notice about the parking stall reallocation last week. I'm fine taking the new stall B-14, but I want the December dates confirmed in writing, not another phone call. Get a reply drafted for me to look over — you know where the drafts live."),
    *write_draft("call_1", DRAFTS + "/strata-parking-reply.txt", STRATA_LINES),
    call("call_2", "read_file", {"path": DRAFTS + "/strata-parking-reply.txt"}),
    tool("call_2", "read_file", catn(STRATA_LINES)),
    asst("The strata reply is in ~/Warden/drafts/strata-parking-reply.txt — accepts stall B-14 and asks for the December dates in writing."),
]))

# 7. DIRECT, get_chat_history for the address first
rows1.append(row([
    user("Draft a reply to that recruiter — the Wednesday slot doesn't work, but Friday after 2pm does — and save it to drafts."),
    *write_draft("call_1", DRAFTS + "/sarah-interview-reply.txt", SARAH_LINES),
    asst("Drafted the reply to Sarah at talentpath — it's in ~/Warden/drafts/sarah-interview-reply.txt, offering Friday after 2pm instead."),
]))

# 8. CASUAL, single turn
rows1.append(row([
    user("draft a reply to the dentist ppl confirming my cleaning on the 24th at 9am, pop it in drafts plz"),
    *write_draft("call_1", DRAFTS + "/dentist-confirmation.txt", DENTIST_LINES),
    asst("On it — the dentist confirmation is in ~/Warden/drafts/dentist-confirmation.txt."),
]))

# 9. RAMBLING, single turn
rows1.append(row([
    user("I keep forgetting to answer the car shop about the brake job estimate. The quote was $840 and I want to say go ahead, but ask if they can fit me in Saturday morning. Draft it into my drafts folder."),
    *write_draft("call_1", DRAFTS + "/carshop-reply.txt", CARSHOP_LINES),
    asst("Drafted — ~/Warden/drafts/carshop-reply.txt accepts the $840 quote and asks about Saturday morning."),
]))

# 10. DIRECT, verify after write
rows1.append(row([
    user("Draft a reply to the city permits office asking for the inspection date on permit 22-1187 and save it to drafts."),
    *write_draft("call_1", DRAFTS + "/permits-reply.txt", PERMITS_LINES),
    call("call_2", "read_file", {"path": DRAFTS + "/permits-reply.txt"}),
    tool("call_2", "read_file", catn(PERMITS_LINES)),
    asst("The permits reply is in ~/Warden/drafts/permits-reply.txt — asks for the inspection date on permit 22-1187. Want it sent once you've read it?"),
]))

# 11. CASUAL, verify after write
rows1.append(row([
    user("need a reply to aunt sue's dinner invite — sayin yes we'll come saturday and bringin an apple pie — drafts plz"),
    *write_draft("call_1", DRAFTS + "/sue-dinner-reply.txt", SUE_LINES),
    call("call_2", "read_file", {"path": DRAFTS + "/sue-dinner-reply.txt"}),
    tool("call_2", "read_file", catn(SUE_LINES)),
    asst("Sue's reply is in ~/Warden/drafts/sue-dinner-reply.txt — yes to Saturday, apple pie promised. Look good?"),
]))

# 12. RAMBLING, single turn
rows1.append(row([
    user("That insurance adjuster still needs a response. Renata is her name, the claim number is CL-77421, and the last assessor date she gave was the 15th and then nobody showed. I want to ask when the assessor will actually come out. Draft it into my drafts."),
    *write_draft("call_1", DRAFTS + "/insurance-reply.txt", RENATA_LINES),
    asst("Drafted — ~/Warden/drafts/insurance-reply.txt asks Renata when the assessor will actually come out, since the 15th was missed."),
]))

# --- 4 scattered-substance distill rows ---

# 13. RAMBLING scattered + marm recall for the quote amount
rows1.append(row([
    user("ok so replying to marco about the fence — the quote itself is fine, its the timeline im worried about. tell him we agree on the price but it needs to be done before the 20th — no wait, say the 18th to be safe. get it drafted, u kno where"),
    call("call_1", "mcp__marm__marm_smart_recall", {"query": "Marco fence quote price", "search_all": True, "include_logs": True}),
    tool("call_1", "mcp__marm__marm_smart_recall", "Memory: Marco's FenceWorks quote for the full cedar fence — $3,400, emailed 2026-09-12, completion originally promised within three weeks."),
    *write_draft("call_2", DRAFTS + "/marco-fence-reply.txt", MARCO_LINES),
    asst("Drafted Marco's reply — agreeing to $3,400 and holding the 18th. It's in ~/Warden/drafts/marco-fence-reply.txt."),
]))

# 14. RAMBLING scattered
rows1.append(row([
    user("reply to jp for me — hmm, first thing: he wanted wednesday for the acceptance meeting, but thursday at 10 is way better for me. and mention ill bring the signed forms this time. drafts it"),
    *write_draft("call_1", DRAFTS + "/response.txt", JP_LINES),
    asst("Drafted — ~/Warden/drafts/response.txt, Thursday 10am with the forms mentioned."),
]))

# 15. RAMBLING scattered
rows1.append(row([
    user("get a reply written to the strata about the parking thing — we take the new stall B-14, that parts fine. oh and make sure they confirm the december dates in writing, not by phone like last time. save to my drafts folder please"),
    *write_draft("call_1", DRAFTS + "/strata-parking-reply.txt", STRATA_LINES),
    asst("Drafted the strata reply — stall B-14 accepted, December dates asked for in writing. It's in ~/Warden/drafts/strata-parking-reply.txt."),
]))

# 16. CASUAL scattered
rows1.append(row([
    user("draft somethin back to the recruiter — i cant do the phone screen tuesday morning they offered. after 3pm any day works, or wednesday period. file it away in drafts for me"),
    *write_draft("call_1", DRAFTS + "/sarah-interview-reply.txt", SARAH_LINES),
    asst("Drafted — ~/Warden/drafts/sarah-interview-reply.txt offers Friday after 2pm instead of Wednesday."),
]))

# --- 4 send-after-approval rows ---

# 17. DIRECT
rows1.append(row([
    user("That JP draft looks good — send it."),
    call("call_1", "read_file", {"path": DRAFTS + "/response.txt"}),
    tool("call_1", "read_file", catn(JP_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to JP at jp.nakamura@meridianlaw.ca with subject \"Re: acceptance meeting — Thursday 10am\" and this body: \"Hi JP,\\n\\nThursday 10am works great on my end for the acceptance meeting. I'll bring the signed forms.\\n\\nSee you then,\\nDominic\""}),
    tool("call_2", "iris", "Email sent to jp.nakamura@meridianlaw.ca — Subject: Re: acceptance meeting — Thursday 10am."),
    asst("Sent — JP's got the Thursday 10am confirmation."),
]))

# 18. CASUAL
rows1.append(row([
    user("yep send the marco one"),
    call("call_1", "read_file", {"path": DRAFTS + "/marco-fence-reply.txt"}),
    tool("call_1", "read_file", catn(MARCO_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to Marco at marco@fenceworks.ca with subject \"Re: Cedar fence quote — go ahead\" and this body: \"Hi Marco,\\n\\nThe $3,400 quote works for us — please plan on finishing the fence by the 18th.\\n\\nThanks,\\nDominic\""}),
    tool("call_2", "iris", "Email sent to marco@fenceworks.ca — Subject: Re: Cedar fence quote — go ahead."),
    asst("Marco's got it — quote accepted with the 18th deadline in."),
]))

# 19. DIRECT
rows1.append(row([
    user("Send the landlord reply as-is."),
    call("call_1", "read_file", {"path": DRAFTS + "/landlord-reply.txt"}),
    tool("call_1", "read_file", catn(LANDLORD_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to Priya at priya.sharma@rentals.ca with subject \"Re: October rent transfer\" and this body: \"Hi Priya,\\n\\nThe rent transfer slipped my mind — it's going out Friday.\\nSorry for the short delay.\\n\\nDominic\""}),
    tool("call_2", "iris", "Email sent to priya.sharma@rentals.ca — Subject: Re: October rent transfer."),
    asst("Sent — Priya has the rent reply."),
]))

# 20. RAMBLING
rows1.append(row([
    user("ok i finally read the dana one over coffee, its good. fire it off"),
    call("call_1", "read_file", {"path": DRAFTS + "/dana-budget-reply.txt"}),
    tool("call_1", "read_file", catn(DANA_LINES)),
    call("call_2", "iris", {"task": "TASK: Send an email to Dana at dana.okeke@northwind.ca with subject \"Re: Q3 budget review\" and this body: \"Hi Dana,\\n\\nThursday works well for the budget review.\\nPlease bring the updated spreadsheet when you come.\\n\\nThanks,\\nDominic\""}),
    tool("call_2", "iris", "Email sent to dana.okeke@northwind.ca — Subject: Re: Q3 budget review."),
    asst("Sent — Dana's confirmed for Thursday and knows to bring the spreadsheet."),
]))

# ============================== s22-2 ==============================

# --- 8 failed-job chain rows (vulkan owning CODE, not drafting) ---

# F1. DIRECT — full failure chain
rows2.append(row([
    user("Did vulkan ever finish that weather-digest script? Nothing's in the projects folder."),
    call("call_1", "read_job_result", {"job_id": "68gn"}),
    tool("call_1", "read_job_result", "Vulkan 68gn FAILED: could not locate the target directory — no output written."),
    call("call_2", "agent_logs", {"job_id": "68gn"}),
    tool("call_2", "agent_logs", "Vulkan 68gn — 4 steps: marm recall 'projects directory', Bash(ls ~/Projects), Bash(find / -type d -name weather-digest — timed out). No file written; fetch_weather.py never created."),
    call("call_3", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "Vulkan spent its run searching for the projects directory — it made no file-writing calls and fetch_weather.py was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_4", "vulkan", started("7hq2")),
    asst("That script job died without writing the file — it spent the whole run hunting for the projects folder. I've re-run it with the exact path, ~/Projects/weather-digest/fetch_weather.py, spelled out."),
]))

# F2. CASUAL — failure chain
rows2.append(row([
    user("yo wheres that script at? u said vulkan would have it done"),
    call("call_1", "read_job_result", {"job_id": "g8ts"}),
    tool("call_1", "read_job_result", "Vulkan g8ts FAILED: run ended with no file produced."),
    call("call_2", "agent_logs", {"job_id": "g8ts"}),
    tool("call_2", "agent_logs", "Vulkan g8ts — 3 calls: marm recall 'projects', Bash(ls ~/), Bash(ls ~/Projects). No Write call — fetch_weather.py never created."),
    call("call_3", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "The job made no file-writing calls — it searched for the projects location the whole run and fetch_weather.py was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_4", "vulkan", started("j3vn")),
    asst("That job never wrote the file — it went looking for the projects folder instead. Re-briefed with the exact path and it's running now."),
]))

# F3. RAMBLING — offer instead of auto re-run
rows2.append(row([
    user("so about that weather script — i went looking in the projects folder and theres nothing there? did it not go through or what"),
    call("call_1", "read_job_result", {"job_id": "k4mp"}),
    tool("call_1", "read_job_result", "Vulkan k4mp FAILED: could not resolve the target directory; nothing was written."),
    call("call_2", "agent_logs", {"job_id": "k4mp"}),
    tool("call_2", "agent_logs", "Vulkan k4mp — 4 calls: marm recall 'projects', Bash(ls ~), Bash(find ~/ -name weather-digest), Bash(ls ~/Projects). No file written — fetch_weather.py never created."),
    call("call_3", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "Vulkan never made a file-writing call — it spent the run searching for the projects directory and fetch_weather.py was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    asst("No, it never went through — the job spent itself hunting for the projects folder and wrote nothing. Want me to re-run it with the exact path in the brief?"),
]))

# F4. CASUAL — offer instead of auto re-run
rows2.append(row([
    user("hey is the weather script done? dont see it in projects"),
    call("call_1", "read_job_result", {"job_id": "v2nq"}),
    tool("call_1", "read_job_result", "Vulkan v2nq FAILED: no output produced — target location unresolved."),
    call("call_2", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "The job made no file-writing calls — it never resolved the output location and fetch_weather.py was never created."}),
    tool("call_2", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    asst("No — it died without writing anything, and the brief never gave it the exact path to begin with. Want me to re-run it with ~/Projects/weather-digest/fetch_weather.py spelled out?"),
]))

# F5. re-run lands, verified
rows2.append(row([
    user("[inbox] Vulkan 7hq2 finished."),
    call("call_1", "read_job_result", {"job_id": "7hq2"}),
    tool("call_1", "read_job_result", "Vulkan 7hq2 completed: Wrote ~/Projects/weather-digest/fetch_weather.py (24 lines)."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", catn(["import urllib.request, json", "CITY = \"Sheridan, OR\"", "def forecast():", "    return json.load(urllib.request.urlopen(\"https://api.weather.gov/points/45.099,-123.395\"))", "print(forecast())"])),
    asst("The re-run landed it — fetch_weather.py is in ~/Projects/weather-digest, 24 lines. Want any changes?"),
]))

# F6. DIRECT — list_running_agents first, then failure chain
rows2.append(row([
    user("Vulkan finished but the projects folder is still empty — what happened?"),
    call("call_1", "list_running_agents", {}),
    tool("call_1", "list_running_agents", "No jobs running."),
    call("call_2", "read_job_result", {"job_id": "d3rn"}),
    tool("call_2", "read_job_result", "Vulkan d3rn FAILED: ran out of steps before writing any output."),
    call("call_3", "agent_logs", {"job_id": "d3rn"}),
    tool("call_3", "agent_logs", "Vulkan d3rn — 5 calls: marm recall, Bash(ls ~/Projects), Bash(ls ~/Projects/weather-digest — not found), marm recall 'projects location'. No Write call — fetch_weather.py never created."),
    call("call_4", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "The job burned its whole run looking for the projects location — no file-writing calls, and fetch_weather.py was never created."}),
    tool("call_4", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_5", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_5", "vulkan", started("c9dx")),
    asst("The job never wrote the file — it burned its whole run looking for where projects live. It's re-running now with the exact path."),
]))

# F7. RAMBLING — failure chain
rows2.append(row([
    user("i went to check the weather script in projects like you said and theres nothing there. forecast is coming up, kind of need that script"),
    call("call_1", "read_job_result", {"job_id": "w9jm"}),
    tool("call_1", "read_job_result", "Vulkan w9jm FAILED: no output file produced."),
    call("call_2", "agent_logs", {"job_id": "w9jm"}),
    tool("call_2", "agent_logs", "Vulkan w9jm — 3 calls: marm recall 'projects', Bash(ls ~/), Bash(ls ~/Projects). No file written — fetch_weather.py never created."),
    call("call_3", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "Vulkan made no file-writing calls — it searched for the projects directory the whole run and fetch_weather.py was never created."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_4", "vulkan", started("f6kp")),
    asst("That script never got written — the job spent its run hunting for the projects folder. It's re-running now with the exact path."),
]))

# F8. CASUAL — failure chain
rows2.append(row([
    user("the weather script never showed up in projects eh"),
    call("call_1", "read_job_result", {"job_id": "b3zs"}),
    tool("call_1", "read_job_result", "Vulkan b3zs FAILED: target directory never resolved; nothing written."),
    call("call_2", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "Vulkan made no file-writing calls — it searched for the projects directory the whole run and fetch_weather.py was never created."}),
    tool("call_2", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_3", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_3", "vulkan", started("n8qt")),
    asst("Yeah, it died hunting for the projects folder without writing a thing. Re-briefed with the exact path this time."),
]))

# --- 4 verdict-vs-ground-truth rows (verdict says failed, file is good) ---

# V1.
rows2.append(row([
    user("[inbox] Vulkan 3kt9 finished."),
    call("call_1", "read_job_result", {"job_id": "3kt9"}),
    tool("call_1", "read_job_result", "Vulkan 3kt9 FAILED: final report contained no script text to review."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", catn(["import urllib.request, json", "CITY = \"Sheridan, OR\"", "def forecast():", "    return json.load(urllib.request.urlopen(\"https://api.weather.gov/points/45.099,-123.395\"))", "print(forecast())"])),
    asst("The verdict says failed, but the script is right there in ~/Projects/weather-digest/fetch_weather.py and reads fine. Want any changes?"),
]))

# V2. CASUAL
rows2.append(row([
    user("u said the weather script finished? did it actually work"),
    call("call_1", "read_job_result", {"job_id": "s7mv"}),
    tool("call_1", "read_job_result", "Vulkan s7mv FAILED: report output was empty — no script content returned."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", catn(["import urllib.request, json", "CITY = \"Sheridan, OR\"", "def forecast():", "    return json.load(urllib.request.urlopen(\"https://api.weather.gov/points/45.099,-123.395\"))", "print(forecast())"])),
    asst("The verdict called it failed, but the file's there — ~/Projects/weather-digest/fetch_weather.py, 24 lines. Looks right to me."),
]))

# V3. RAMBLING
rows2.append(row([
    user("so the weather script came back marked failed somehow?? i thought vulkan finished it. is the script actually there or not"),
    call("call_1", "read_job_result", {"job_id": "r2th"}),
    tool("call_1", "read_job_result", "Vulkan r2th FAILED: no summary of the written file was included — cannot confirm the outcome."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", catn(["import urllib.request, json", "CITY = \"Sheridan, OR\"", "def forecast():", "    return json.load(urllib.request.urlopen(\"https://api.weather.gov/points/45.099,-123.395\"))", "print(forecast())"])),
    asst("It's there — ~/Projects/weather-digest/fetch_weather.py has the full script. The verdict only complained the job didn't describe it; the file itself is fine."),
]))

# V4.
rows2.append(row([
    user("[inbox] Vulkan y6ub finished."),
    call("call_1", "read_job_result", {"job_id": "y6ub"}),
    tool("call_1", "read_job_result", "Vulkan y6ub FAILED: result text did not include the script."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", catn(["import urllib.request, json", "CITY = \"Sheridan, OR\"", "def forecast():", "    return json.load(urllib.request.urlopen(\"https://api.weather.gov/points/45.099,-123.395\"))", "print(forecast())"])),
    asst("That verdict's wrong on the ground — the script is sitting in ~/Projects/weather-digest/fetch_weather.py and reads fine."),
]))

# --- 4 inverse rows (verdict says success, file missing/wrong) ---

# I1. DIRECT — file missing
rows2.append(row([
    user("Did the weather script ever get saved?"),
    call("call_1", "read_job_result", {"job_id": "p8gd"}),
    tool("call_1", "read_job_result", "Vulkan p8gd completed: wrote the weather script to the projects directory."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", "Error: file not found: /home/dominic/Projects/weather-digest/fetch_weather.py"),
    call("call_3", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "Vulkan reported success but the file was never written — fetch_weather.py does not exist."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_4", "vulkan", started("k2vw")),
    asst("It claimed success but there's no file — fetch_weather.py doesn't exist where it should. Re-running now with the exact path spelled out."),
]))

# I2. CASUAL — wrong content in the file
rows2.append(row([
    user("somethings off with the weather script, go look at it"),
    call("call_1", "read_job_result", {"job_id": "r5jc"}),
    tool("call_1", "read_job_result", "Vulkan r5jc completed: weather script written and saved."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", catn(["#!/usr/bin/env python3", "# garage-dash nightly sensor reader", "import sqlite3", "print('nightly')"])),
    call("call_3", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "The file at fetch_weather.py contains a garage-dash sensor script, not the weather digest — the wrong script was written."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    asst("Yeah, it wrote the wrong thing — fetch_weather.py has a garage sensor script in it, nothing about weather. Want me to re-run it with the weather brief pinned to that exact path?"),
]))

# I3. RAMBLING — empty file
rows2.append(row([
    user("hey so vulkan said the weather script was done, but when i opened the file it looked... empty? check it for me"),
    call("call_1", "read_job_result", {"job_id": "m4xz"}),
    tool("call_1", "read_job_result", "Vulkan m4xz completed: weather script written and saved."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", catn([""])),
    call("call_3", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "Vulkan reported success but the file it wrote is empty — fetch_weather.py has no script in it."}),
    tool("call_3", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_4", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_4", "vulkan", started("v7ks")),
    asst("The file's there but it's empty — a saved nothing. Re-running with the full brief and the exact path."),
]))

# I4. CASUAL — file saved under the wrong name
rows2.append(row([
    user("the weather script u promised isnt in projects?? just some file called script.py"),
    call("call_1", "read_job_result", {"job_id": "z9tc"}),
    tool("call_1", "read_job_result", "Vulkan z9tc completed: weather script written and saved."),
    call("call_2", "read_file", {"path": "/home/dominic/Projects/weather-digest/fetch_weather.py"}),
    tool("call_2", "read_file", "Error: file not found: /home/dominic/Projects/weather-digest/fetch_weather.py"),
    call("call_3", "read_file", {"path": "/home/dominic/Projects/weather-digest/script.py"}),
    tool("call_3", "read_file", catn(["import urllib.request, json", "CITY = \"Sheridan, OR\"", "def forecast():", "    return json.load(urllib.request.urlopen(\"https://api.weather.gov/points/45.099,-123.395\"))", "print(forecast())"])),
    call("call_4", "report_task_failure", {"task": "Write the weather-digest fetch_weather.py script", "reason": "Vulkan saved the script as script.py instead of the asked-for fetch_weather.py — the file exists at the wrong path."}),
    tool("call_4", "report_task_failure", "Noted — this task's failure is on record. You may delegate it once more, and only with a corrected brief."),
    call("call_5", "vulkan", {"task": "TASK: Write ~/Projects/weather-digest/fetch_weather.py — pulls tomorrow's forecast for Sheridan, OR from the weather API and prints it."}),
    tool("call_5", "vulkan", started("q4dm")),
    asst("It wrote the script under script.py instead of fetch_weather.py. Re-running pinned to the right path — the content was fine but the name wasn't what you asked for."),
]))

# --- 4 small-edit-after-review rows (seat's own read_file + write_file) ---

# E1. DIRECT
rows2.append(row([
    user("The JP draft reads well — add the gate code 4417 so he can buzz in."),
    call("call_1", "read_file", {"path": DRAFTS + "/response.txt"}),
    tool("call_1", "read_file", catn(JP_LINES)),
    call("call_2", "write_file", {"path": DRAFTS + "/response.txt", "content": "\n".join(["Hi JP,", "", "Thursday 10am works great on my end for the acceptance meeting.", "I'll bring the signed forms — the gate code is 4417.", "", "See you then,", "Dominic"])}),
    tool("call_2", "write_file", "The file %s/response.txt was written (7 lines)." % DRAFTS),
    asst("Added — the draft now tells JP to buzz 4417."),
]))

# E2. CASUAL
rows2.append(row([
    user("make the sue one friday not saturday, we r busy sat"),
    call("call_1", "read_file", {"path": DRAFTS + "/sue-dinner-reply.txt"}),
    tool("call_1", "read_file", catn(SUE_LINES)),
    call("call_2", "write_file", {"path": DRAFTS + "/sue-dinner-reply.txt", "content": "\n".join(["Hi Aunt Sue,", "", "We'd love to come Friday — we'll bring an apple pie.", "", "Love,", "Dominic"])}),
    tool("call_2", "write_file", "The file %s/sue-dinner-reply.txt was written (6 lines)." % DRAFTS),
    asst("Switched it to Friday — pie's still promised."),
]))

# E3. RAMBLING
rows2.append(row([
    user("read over the landlord reply for me... its a bit much with all the apologizing. just say the transfers coming friday and drop the rest"),
    call("call_1", "read_file", {"path": DRAFTS + "/landlord-reply.txt"}),
    tool("call_1", "read_file", catn(["Hi Priya,", "", "I'm so sorry — the rent transfer completely slipped my mind, my sincere apologies for the delay. It will go out first thing Friday morning.", "Apologies again for the trouble.", "", "Dominic"])),
    call("call_2", "write_file", {"path": DRAFTS + "/landlord-reply.txt", "content": "\n".join(["Hi Priya,", "", "The rent transfer slipped my mind — it's going out Friday.", "", "Dominic"])}),
    tool("call_2", "write_file", "The file %s/landlord-reply.txt was written (5 lines)." % DRAFTS),
    asst("Toned down — one plain line now: the transfer slipped, it's coming Friday."),
]))

# E4. DIRECT — full clean rewrite
rows2.append(row([
    user("The Marco draft got mangled somewhere — just rewrite it clean yourself. Agree to $3,400, done by the 20th."),
    call("call_1", "read_file", {"path": DRAFTS + "/marco-fence-reply.txt"}),
    tool("call_1", "read_file", catn(["Hi Marco,", "", "quote agree price fence $3,400 18th complete", "fence fence the by 18th done", "", "Thanks,"])),
    call("call_2", "write_file", {"path": DRAFTS + "/marco-fence-reply.txt", "content": "\n".join(["Hi Marco,", "", "The $3,400 quote works for us — please plan on finishing the fence by the 20th.", "", "Thanks,", "Dominic"])}),
    tool("call_2", "write_file", "The file %s/marco-fence-reply.txt was written (6 lines)." % DRAFTS),
    asst("Rewrote it clean — agrees to $3,400 with the fence done by the 20th."),
]))

for fname, rows in (("s22-1.jsonl", rows1), ("s22-2.jsonl", rows2)):
    assert len(rows) == 20, (fname, len(rows))
    out = os.path.join(BASE, fname)
    with open(out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("wrote", out, len(rows), "rows")
