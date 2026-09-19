from gen_common import user, acall, tool, final, dumps

rows = []

# ---- FORWARD / CLEANUP (5) ----

rows.append([
    user("Forward the airline itinerary email to mom at carol.h2020@gmail.com so she knows when we land."),
    acall("call_1", "iris", {"task": "TASK: Forward the email 'Your upcoming trip — Pacific Air itinerary' to carol.h2020@gmail.com, with a note that this is so she knows when we land."}),
    tool("call_1", "iris", "Forwarded 'Your upcoming trip — Pacific Air itinerary' to carol.h2020@gmail.com — Subject: Fwd: Your upcoming trip — Pacific Air itinerary."),
    final("Mom has the itinerary with the landing time."),
])

rows.append([
    user("trash the linkedin recruiter spam, i never asked for any of that"),
    acall("call_1", "iris", {"task": "TASK: Delete all the LinkedIn recruiter emails in the inbox."}),
    tool("call_1", "iris", "Deleted 11 LinkedIn recruiter emails."),
    final("Trashed 11 recruiter emails."),
])

rows.append([
    user("forward that fence photo email mike sent to sarah.kline@example.com, she wants to see what the cedar looks like"),
    acall("call_1", "iris", {"task": "TASK: Forward the email with the fence photos from mike.renner@rennerbuilds.com to sarah.kline@example.com, with a note that she wanted to see the cedar."}),
    tool("call_1", "iris", "Forwarded 'Cedar samples — photos' from Mike Renner to sarah.kline@example.com — Subject: Fwd: Cedar samples — photos."),
    final("Sarah has Mike's cedar photos."),
])

rows.append([
    user("unsubscribe me from the hoa's weekly digest too, i read the board emails anyway"),
    acall("call_1", "iris", {"task": "TASK: Unsubscribe me from the Maplewood HOA weekly digest mailing list."}),
    tool("call_1", "iris", "Unsubscribed you from the Maplewood HOA weekly digest."),
    final("You're off the HOA weekly digest — the board emails still come through."),
])

rows.append([
    user("forward the security notice from the bank to dana@example.com, she handles the shared card"),
    acall("call_1", "iris", {"task": "TASK: Forward the email 'Security notice — your shared card' from security@cascadebank.com to dana@example.com, with a note that she handles this card."}),
    tool("call_1", "iris", "Forwarded 'Security notice — your shared card' to dana@example.com — Subject: Fwd: Security notice — your shared card."),
    final("Dana has the bank's security notice."),
])

# ---- COMBINED ASKS (15) ----

rows.append([
    user("Email dana@example.com that Thursday works for the review, and put the review on my calendar for Thursday at 2pm."),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on 'Re: Q3 budget review' saying Thursday works, and add a calendar event 'Q3 budget review' for Thursday September 24 at 2:00pm."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Q3 budget review.\nAdded calendar event 'Q3 budget review' for Thursday, September 24 at 2:00pm."),
    final("Dana knows Thursday's on, and it's on your calendar for 2pm."),
])

rows.append([
    user("reply to mike that we'll be home friday after 3, and set me a reminder thursday evening to tidy the side yard"),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on 'Fence repair quote' saying we'll be home Friday after 3pm, and set a reminder for Thursday evening to tidy the side yard."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Fence repair quote.\nReminder set: 'tidy the side yard' Thursday at 6:00pm."),
    final("Mike knows we're home Friday after 3, and you'll get a Thursday evening nudge to tidy the yard."),
])

rows.append([
    user("tell dana the receipts are coming today i promise, and remind me tomorrow morning to actually send them"),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on 'Review docs?' saying the Q3 receipts are coming today, and set a reminder for tomorrow morning to send Dana the receipts."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Review docs?\nReminder set: 'send Dana the receipts' tomorrow at 9:00am."),
    final("Promised Dana the receipts today — there's a 9am reminder so it actually happens."),
])

rows.append([
    user("write up a punch list for mike — gate needs re-staining, two pickets are split near the driveway, and there's a gap under the north post — email it to him, and remind me in two weeks to check the fence work"),
    acall("call_1", "Write", {"file_path": "/home/dominic/Warden/notes/mike-punchlist.txt", "content": "Fence punch list\n\n1. Gate needs re-staining\n2. Two pickets split near the driveway\n3. Gap under the north post\n"}, content="Plan: write the list, send it to Mike, set the reminder."),
    tool("call_1", "Write", "Wrote 5 lines to /home/dominic/Warden/notes/mike-punchlist.txt"),
    acall("call_2", "iris", {"task": "TASK: Send an email to mike.renner@rennerbuilds.com with subject 'Punch list — fence', attaching /home/dominic/Warden/notes/mike-punchlist.txt and listing the items: gate needs re-staining, two pickets split near the driveway, gap under the north post; and set a reminder in two weeks, on October 2, to check the fence work."}),
    tool("call_2", "iris", "Email sent to mike.renner@rennerbuilds.com with mike-punchlist.txt attached — Subject: Punch list — fence.\nReminder set: 'check the fence work' October 2 at 10:00am."),
    final("Punch list sent to Mike, and you'll be reminded October 2 to check his work."),
])

rows.append([
    user("email dana that the vendor call is still on today at 2 and add it to my calendar as a half hour block"),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on 'Before the vendor call' saying the 2pm vendor call is still on today, and add a calendar event 'Vendor call' today from 2:00pm to 2:30pm."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Before the vendor call.\nAdded calendar event 'Vendor call' today, 2:00pm–2:30pm."),
    final("Dana's confirmed for 2 — it's a 30-minute block on your calendar."),
])

rows.append([
    user("tell the dentist the 28th at 2 works and remind me that morning to leave early for it"),
    acall("call_1", "iris", {"task": "TASK: Reply to frontdesk@riversidedental.com on 'Your cleaning — two options' confirming Tuesday the 28th at 2:00pm, and set a reminder for the morning of the 28th to leave early for the dentist."}),
    tool("call_1", "iris", "Email sent to frontdesk@riversidedental.com — Subject: Re: Your cleaning — two options.\nReminder set: 'leave early for the dentist' September 28 at 12:00pm."),
    final("The cleaning's set for the 28th at 2, with a noon reminder to head out early."),
])

rows.append([
    user("email the board at board@maplewoodhoa.org the fence permit number P-2231 so they have it on file, and remind me the day before the october 2nd inspection"),
    acall("call_1", "iris", {"task": "TASK: Send an email to board@maplewoodhoa.org with subject 'Fence permit number' telling them the fence permit number is P-2231, and set a reminder for October 1 to be ready for the fence inspection on October 2."}),
    tool("call_1", "iris", "Email sent to board@maplewoodhoa.org — Subject: Fence permit number.\nReminder set: 'be ready for the fence inspection' October 1 at 9:00am."),
    final("The board has the permit number, and you'll get an October 1 reminder before the inspection."),
])

rows.append([
    user("see what dana said about thursday, reply that it works, and put the review on my calendar for whenever she proposed"),
    acall("call_1", "iris", {"task": "TASK: Read the latest email from dana@example.com about the Thursday review."}, content="Plan: read Dana's email, then reply and calendar it."),
    tool("call_1", "iris", "Email from Dana Whitfield (11:42am), Subject: Re: Q3 budget review:\n\nCan we push the review to Thursday? I was thinking 2:30pm — the room's free then. Bring the final spend figure if you can.\n"),
    acall("call_2", "iris", {"task": "TASK: Reply to dana@example.com on 'Re: Q3 budget review' saying Thursday at 2:30pm works and I'll bring the final spend figure, and add a calendar event 'Q3 budget review' for Thursday September 24 at 2:30pm."}),
    tool("call_2", "iris", "Email sent to dana@example.com — Subject: Re: Q3 budget review.\nAdded calendar event 'Q3 budget review' for Thursday, September 24 at 2:30pm."),
    final("Dana's Thursday 2:30 works — replied and it's on your calendar."),
])

rows.append([
    user("email mike the deposit's sent and remind me friday to ask for the receipt"),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on 'Fence repair quote' saying the deposit has been sent, and set a reminder for Friday to ask Mike for the receipt."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Fence repair quote.\nReminder set: 'ask Mike for the receipt' Friday at 10:00am."),
    final("Mike knows the deposit's in, and Friday you'll be reminded to chase the receipt."),
])

rows.append([
    user("read the inspection notes and email dana the summary — the file's in my warden folder, subject 'Inspection notes'"),
    acall("call_1", "Glob", {"pattern": "**/*inspection*notes*", "path": "/home/dominic/Warden"}, content="Plan: find the notes, read them, then email Dana the summary."),
    tool("call_1", "Glob", "Found 1 file:\n/home/dominic/Warden/notes/inspection-notes.txt"),
    acall("call_2", "Read", {"file_path": "/home/dominic/Warden/notes/inspection-notes.txt"}),
    tool("call_2", "Read", "Fence inspection prep — Riverton County, permit P-2231\n\n- Posts set within code depth, verified against drawings\n- Setback from property line: 6 inches, as drawn\n- One item outstanding: gate must self-latch, latch at 48 inches\n\nInspector contact: permits@rivertoncounty.gov\n"),
    acall("call_3", "iris", {"task": "TASK: Send an email to dana@example.com with subject 'Inspection notes' summarizing the fence inspection prep: posts verified within code against the drawings, setback 6 inches from the property line as drawn, and one outstanding item — the gate must self-latch with the latch at 48 inches."}),
    tool("call_3", "iris", "Email sent to dana@example.com — Subject: Inspection notes."),
    final("Sent Dana the summary — everything's in code except the gate, which still needs the self-latch at 48 inches."),
])

rows.append([
    user("reply to the bank confirming those two charges are legit, and remind me in a week to check the statement anyway"),
    acall("call_1", "iris", {"task": "TASK: Reply to security@cascadebank.com on 'Did you make these purchases?' confirming the two charges — $62.40 at Fairway Market and $18.75 at Kaffeine — are legitimate, and set a reminder in one week, on September 25, to check the bank statement."}),
    tool("call_1", "iris", "Email sent to security@cascadebank.com — Subject: Re: Did you make these purchases?\nReminder set: 'check the bank statement' September 25 at 9:00am."),
    final("Confirmed the charges, and you'll be reminded September 25 to eyeball the statement."),
])

rows.append([
    user("email mom we'll be there sunday at 5 and i'm on dessert, and set an alarm sunday 4pm so we actually leave on time"),
    acall("call_1", "iris", {"task": "TASK: Send an email to carol.h2020@gmail.com with subject 'Sunday dinner' confirming we'll be there Sunday at 5 and bringing dessert, and set an alarm for Sunday at 4:00pm to leave for mom's."}),
    tool("call_1", "iris", "Email sent to carol.h2020@gmail.com — Subject: Sunday dinner.\nAlarm set: 'leave for mom's' Sunday at 4:00pm."),
    final("Mom's expecting us at 5 with dessert, and a 4pm alarm Sunday gets us out the door."),
])

rows.append([
    user("type up a quick apology to karen for missing the bake sale planning meeting — say work exploded last week — email it to karen@lakesidepto.org, and remind me friday to drop off the cookies"),
    acall("call_1", "Write", {"file_path": "/home/dominic/Warden/notes/karen-apology.txt", "content": "Hi Karen,\n\nSorry I missed the bake sale planning meeting — work exploded last week. I'm still in for two dozen cookies, and I'll get them to you Friday.\n"}, content="Plan: write the apology, send it, set the Friday reminder."),
    tool("call_1", "Write", "Wrote 4 lines to /home/dominic/Warden/notes/karen-apology.txt"),
    acall("call_2", "iris", {"task": "TASK: Send an email to karen@lakesidepto.org with subject 'Sorry I missed the meeting' with the body from /home/dominic/Warden/notes/karen-apology.txt — apologizing for missing the bake sale planning meeting because work exploded, and confirming two dozen cookies for Friday — and set a reminder for Friday morning to drop off the cookies."}),
    tool("call_2", "iris", "Email sent to karen@lakesidepto.org — Subject: Sorry I missed the meeting.\nReminder set: 'drop off cookies at the school' Friday at 8:00am."),
    final("Karen has the apology and the cookie promise — Friday 8am you'll be reminded to drop them off."),
])

rows.append([
    user("tell mike the gravel quote is approved and put the fence start on my calendar for monday the 22nd, which is what he proposed"),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on 'Gravel quote' saying the 180-dollar gravel quote is approved, and add a calendar event 'Fence work starts' for Monday September 22 at 8:00am."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Gravel quote.\nAdded calendar event 'Fence work starts' for Monday, September 22 at 8:00am."),
    final("Mike's gravel quote is approved, and the fence start is on your calendar for Monday the 22nd."),
])

rows.append([
    user("if i haven't heard back from the insurance guy by friday i'm going to forget to chase him... send danielle a nudge now asking where the renewal paperwork is, and set a reminder friday morning to chase if there's still nothing"),
    acall("call_1", "iris", {"task": "TASK: Send an email to danielle@harborinsurance.com with subject 'Renewal paperwork' asking where the home insurance renewal paperwork is, and set a reminder for Friday morning to chase Danielle if the renewal paperwork still hasn't arrived."}),
    tool("call_1", "iris", "Email sent to danielle@harborinsurance.com — Subject: Renewal paperwork.\nReminder set: 'chase Danielle if the renewal paperwork still hasn't arrived' Friday at 9:00am."),
    final("Nudged Danielle about the renewal paperwork, with a Friday morning reminder as the backstop."),
])

# ---- ASK-BACKS (5) ----

rows.append([
    user("send mike an email about the gate"),
    final("What should the email to Mike say about the gate?"),
])

rows.append([
    user("reply to that guy about the thing from last week"),
    final("Which email do you mean — who's it from, or what's the subject line?"),
])

rows.append([
    user("forward the invoice from renner to my accountant"),
    final("What's your accountant's email address?"),
])

rows.append([
    user("email dana about the conference"),
    final("What should I tell Dana about the conference?"),
    user("that i'm not going this year but she definitely should, company covers her ticket"),
    acall("call_1", "iris", {"task": "TASK: Send an email to dana@example.com with subject 'Conference' saying I'm not going this year but she should definitely go, and the company will cover her ticket."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Conference."),
    final("Told Dana to go to the conference — the company's covering her ticket."),
])

rows.append([
    user("send the contractor the gate keypad thing"),
    final("What's the contractor's email address?"),
    user("mike.renner@rennerbuilds.com — and tell him we replaced the keypad batteries and it's still flaky, ask what he'd charge to look at it"),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com with subject 'Gate keypad' telling him we replaced the keypad batteries and it's still flaky, and asking what he would charge to look at it."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Gate keypad."),
    final("Asked Mike what he'd charge to look at the flaky gate keypad."),
])

assert len(rows) == 25, len(rows)
with open("/opt/Warden/training/orchatlas-parts/s16-4.jsonl", "w", encoding="utf-8") as f:
    f.write(dumps(rows))
print("s16-4.jsonl", len(rows))