from gen_common import user, acall, tool, final, dumps

rows = []

# ---- READ-THEN-ACT CHAINS (5) ----

rows.append([
    user("see what sarah picked for book club next month and reply that i'm in"),
    acall("call_1", "iris", {"task": "TASK: Read the latest email from sarah.kline@example.com about next month's book club pick."}, content="Plan: read Sarah's pick, then reply."),
    tool("call_1", "iris", "Email from Sarah Kline (6:48pm), Subject: Next month's pick:\n\nThe vote's done — we're reading 'The Overstory' next month, and I'm hosting on the 14th. You in?\n"),
    acall("call_2", "iris", {"task": "TASK: Reply to sarah.kline@example.com on 'Next month's pick' saying I'm in for 'The Overstory' on the 14th."}),
    tool("call_2", "iris", "Email sent to sarah.kline@example.com — Subject: Re: Next month's pick."),
    final("Sarah's got me down for The Overstory on the 14th."),
])

rows.append([
    user("check dana's email about the review docs and reply that i sent them yesterday"),
    acall("call_1", "iris", {"task": "TASK: Read the latest email from dana@example.com about the Q3 review docs."}, content="Plan: read Dana's question, then answer it."),
    tool("call_1", "iris", "Email from Dana Whitfield (1:33pm), Subject: Review docs?:\n\nDidn't see the Q3 review docs come through — did you send them, or should I grab them from the shared drive?\n"),
    acall("call_2", "iris", {"task": "TASK: Reply to dana@example.com on 'Review docs?' saying I sent them yesterday and she should check her inbox."}),
    tool("call_2", "iris", "Email sent to dana@example.com — Subject: Re: Review docs?"),
    final("Told Dana the docs went out yesterday — she'll check her inbox."),
])

rows.append([
    user("mike mentioned some kind of delay in his last email i think, can you look and ask him what the new finish date is"),
    acall("call_1", "iris", {"task": "TASK: Read the latest email from mike.renner@rennerbuilds.com about the fence timeline."}, content="Plan: read Mike's delay note, then ask for the new date."),
    tool("call_1", "iris", "Email from Mike Renner (7:56am), Subject: Small delay on the fence:\n\nThe cedar delivery slipped two days, so the start moves back a bit. I'll have the new finish date once the lumber yard confirms — probably by tomorrow.\n"),
    acall("call_2", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on 'Small delay on the fence' asking for the new finish date as soon as the lumber yard confirms."}),
    tool("call_2", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Small delay on the fence."),
    final("Cedar delivery slipped — I asked Mike for the new finish date."),
])

rows.append([
    user("check what the county sent about the inspection and reply that october 2nd works"),
    acall("call_1", "iris", {"task": "TASK: Read the latest email from permits@rivertoncounty.gov about the fence inspection."}, content="Plan: read the county's email, then pick a date."),
    tool("call_1", "iris", "Email from Riverton County Permits (9:20am), Subject: Fence inspection scheduling:\n\nYour fence inspection under permit P-2231 can be scheduled October 1st or October 2nd. Reply with your preferred date.\n"),
    acall("call_2", "iris", {"task": "TASK: Reply to permits@rivertoncounty.gov on 'Fence inspection scheduling' choosing October 2nd for the inspection under permit P-2231."}),
    tool("call_2", "iris", "Email sent to permits@rivertoncounty.gov — Subject: Re: Fence inspection scheduling."),
    final("The fence inspection is on for October 2nd."),
])

rows.append([
    user("look at the ups email n tell them the package showed up but one corner's crushed, so they know for the record"),
    acall("call_1", "iris", {"task": "TASK: Read the latest email from UPS about the delivered package."}),
    tool("call_1", "iris", "Email from UPS (11:37am), Subject: Your delivery was completed:\n\nYour package (1Z8927...2291) was delivered today at 11:02am. Let us know if there are any issues with the delivery.\n"),
    acall("call_2", "iris", {"task": "TASK: Reply to quantum.view@ups.com on 'Your delivery was completed' reporting the package arrived but one corner is crushed, so there's a record of the damage."}),
    tool("call_2", "iris", "Email sent to quantum.view@ups.com — Subject: Re: Your delivery was completed."),
    final("Told UPS the package came in with a crushed corner."),
])

# ---- ATTACHMENTS (15) ----

rows.append([
    user("Email the lease PDF to mike.renner@rennerbuilds.com so he has the exact property lines, subject 'Property lines'."),
    acall("call_1", "Glob", {"pattern": "**/*lease*.pdf", "path": "/home/dominic/Warden"}, content="Plan: find the lease PDF, then send it to Mike."),
    tool("call_1", "Glob", "Found 1 file:\n/home/dominic/Warden/docs/lease-agreement.pdf"),
    acall("call_2", "iris", {"task": "TASK: Send an email to mike.renner@rennerbuilds.com with subject 'Property lines', attaching /home/dominic/Warden/docs/lease-agreement.pdf, saying this is the lease with the exact property lines for the fence work."}),
    tool("call_2", "iris", "Email sent to mike.renner@rennerbuilds.com with lease-agreement.pdf attached — Subject: Property lines."),
    final("Sent Mike the lease PDF with the property lines."),
])

rows.append([
    user("Download the invoice from the UPS email."),
    acall("call_1", "iris", {"task": "TASK: Download the invoice attachment from the latest UPS email."}),
    tool("call_1", "iris", "Downloaded invoice-2291.pdf from the UPS email to /home/dominic/Warden/downloads."),
    final("Saved the UPS invoice to the Warden downloads folder as invoice-2291.pdf."),
])

rows.append([
    user("Forward that contract renewal email from the HOA to my lawyer at amelia.chen@chenlaw.com so she can review it before I sign."),
    acall("call_1", "iris", {"task": "TASK: Forward the email 'Contract renewal — Maplewood HOA' from board@maplewoodhoa.org to amelia.chen@chenlaw.com, with a note asking her to review it before I sign."}),
    tool("call_1", "iris", "Forwarded 'Contract renewal — Maplewood HOA' to amelia.chen@chenlaw.com — Subject: Fwd: Contract renewal — Maplewood HOA."),
    final("The HOA contract is with Amelia for review."),
])

rows.append([
    user("Write up a punch list for the fence — gate latch sticks when it rains, post 4 is leaning, and the cap on post 7 is cracked — then email it to mike.renner@rennerbuilds.com with subject 'Fence punch list'."),
    acall("call_1", "Write", {"file_path": "/home/dominic/Warden/notes/fence-punchlist.txt", "content": "Fence punch list\n\n1. Gate latch sticks when it rains\n2. Post 4 is leaning\n3. Cap on post 7 is cracked\n"}, content="Plan: write the punch list, then email it to Mike."),
    tool("call_1", "Write", "Wrote 5 lines to /home/dominic/Warden/notes/fence-punchlist.txt"),
    acall("call_2", "iris", {"task": "TASK: Send an email to mike.renner@rennerbuilds.com with subject 'Fence punch list', attaching /home/dominic/Warden/notes/fence-punchlist.txt, listing the three items: gate latch sticks when it rains, post 4 is leaning, cap on post 7 is cracked."}),
    tool("call_2", "iris", "Email sent to mike.renner@rennerbuilds.com with fence-punchlist.txt attached — Subject: Fence punch list."),
    final("Mike has the punch list — latch, post 4, post 7's cap."),
])

rows.append([
    user("grab the receipts attachment from dana's email and save it for me"),
    acall("call_1", "iris", {"task": "TASK: Download the receipts attachment from the latest email from dana@example.com."}),
    tool("call_1", "iris", "Downloaded q3-receipts.zip from Dana's email to /home/dominic/Warden/downloads."),
    final("Dana's receipts are saved in the Warden downloads folder as q3-receipts.zip."),
])

rows.append([
    user("Email the fence damage photos to the insurance broker, danielle@harborinsurance.com, with subject 'Fence damage — claim photos'."),
    acall("call_1", "Glob", {"pattern": "**/fence-damage*.jpg", "path": "/home/dominic/Warden"}, content="Plan: find the damage photos, then send them to the broker."),
    tool("call_1", "Glob", "Found 3 files:\n/home/dominic/Warden/uploads/fence-damage-1.jpg\n/home/dominic/Warden/uploads/fence-damage-2.jpg\n/home/dominic/Warden/uploads/fence-damage-3.jpg"),
    acall("call_2", "iris", {"task": "TASK: Send an email to danielle@harborinsurance.com with subject 'Fence damage — claim photos', attaching /home/dominic/Warden/uploads/fence-damage-1.jpg, /home/dominic/Warden/uploads/fence-damage-2.jpg and /home/dominic/Warden/uploads/fence-damage-3.jpg."}),
    tool("call_2", "iris", "Email sent to danielle@harborinsurance.com with 3 photos attached — Subject: Fence damage — claim photos."),
    final("All three damage photos are off to Danielle at Harbor Insurance."),
])

rows.append([
    user("Download the september statement from the bank's email and put it in the taxes folder"),
    acall("call_1", "iris", {"task": "TASK: Download the September statement attachment from the latest Cascade Bank email to /home/dominic/Warden/taxes."}),
    tool("call_1", "iris", "Downloaded statement-september.pdf from the Cascade Bank email to /home/dominic/Warden/taxes."),
    final("The September statement is in the Warden taxes folder."),
])

rows.append([
    user("send mike the gate quote pdf, it's in my warden folder somewhere"),
    acall("call_1", "Glob", {"pattern": "**/*gate*quote*.pdf", "path": "/home/dominic/Warden"}),
    tool("call_1", "Glob", "Found 1 file:\n/home/dominic/Warden/docs/gate-quote.pdf"),
    acall("call_2", "iris", {"task": "TASK: Send an email to mike.renner@rennerbuilds.com with subject 'Gate quote', attaching /home/dominic/Warden/docs/gate-quote.pdf."}),
    tool("call_2", "iris", "Email sent to mike.renner@rennerbuilds.com with gate-quote.pdf attached — Subject: Gate quote."),
    final("Found the gate quote and sent it over to Mike."),
])

rows.append([
    user("forward the dentist's crown estimate email to dana@example.com so she can sanity check the price"),
    acall("call_1", "iris", {"task": "TASK: Forward the email 'Crown estimate' from frontdesk@riversidedental.com to dana@example.com, with a note asking her to sanity check the price."}),
    tool("call_1", "iris", "Forwarded 'Crown estimate' to dana@example.com — Subject: Fwd: Crown estimate."),
    final("The crown estimate is with Dana for a sanity check."),
])

rows.append([
    user("Email the signed fence contract to the HOA board, board@maplewoodhoa.org, subject 'Signed contract — fence'."),
    acall("call_1", "Glob", {"pattern": "**/fence-contract*.pdf", "path": "/home/dominic/Warden"}, content="Plan: find the signed contract, then send it to the board."),
    tool("call_1", "Glob", "Found 1 file:\n/home/dominic/Warden/docs/fence-contract-signed.pdf"),
    acall("call_2", "iris", {"task": "TASK: Send an email to board@maplewoodhoa.org with subject 'Signed contract — fence', attaching /home/dominic/Warden/docs/fence-contract-signed.pdf."}),
    tool("call_2", "iris", "Email sent to board@maplewoodhoa.org with fence-contract-signed.pdf attached — Subject: Signed contract — fence."),
    final("The signed contract is with the HOA board."),
])

rows.append([
    user("download the permit from the county email"),
    acall("call_1", "iris", {"task": "TASK: Download the permit attachment from the latest Riverton County email."}),
    tool("call_1", "iris", "Downloaded permit-P-2231.pdf from the Riverton County email to /home/dominic/Warden/downloads."),
    final("The fence permit is saved to the Warden downloads folder as permit-P-2231.pdf."),
])

rows.append([
    user("the contractor needs a copy of our insurance declaration page for his files, it should be somewhere in my warden folder — find it and email it to mike.renner@rennerbuilds.com"),
    acall("call_1", "Glob", {"pattern": "**/*insurance*.pdf", "path": "/home/dominic/Warden"}, content="Plan: find the declarations page, then email it to Mike."),
    tool("call_1", "Glob", "Found 1 file:\n/home/dominic/Warden/docs/insurance-declarations.pdf"),
    acall("call_2", "iris", {"task": "TASK: Send an email to mike.renner@rennerbuilds.com with subject 'Insurance declaration page', attaching /home/dominic/Warden/docs/insurance-declarations.pdf."}),
    tool("call_2", "iris", "Email sent to mike.renner@rennerbuilds.com with insurance-declarations.pdf attached — Subject: Insurance declaration page."),
    final("Found the declarations page and sent it to Mike."),
])

rows.append([
    user("pull the invoice off mike's email and tell me the total"),
    acall("call_1", "iris", {"task": "TASK: Download the invoice attachment from the latest email from mike.renner@rennerbuilds.com."}, content="Plan: download the invoice, then read out the total."),
    tool("call_1", "iris", "Downloaded renner-invoice-04.pdf from Mike Renner's email to /home/dominic/Warden/downloads."),
    acall("call_2", "Read", {"file_path": "/home/dominic/Warden/downloads/renner-invoice-04.pdf"}),
    tool("call_2", "Read", "Invoice REN-004 from Renner Builds\n\nCedar fence replacement (materials and labor) .... $2,150.00\nGravel for post footings ......................... $180.00\n\nTotal due: $2,330.00\n"),
    final("Mike's invoice total is 2,330 dollars — 2,150 for the fence and 180 for the gravel."),
])

rows.append([
    user("email the budget meeting notes to dana@example.com, subject 'Meeting notes', the file's somewhere in my notes folder"),
    acall("call_1", "Glob", {"pattern": "**/*budget*notes*", "path": "/home/dominic/Warden/notes"}),
    tool("call_1", "Glob", "Found 1 file:\n/home/dominic/Warden/notes/budget-meeting-notes.txt"),
    acall("call_2", "iris", {"task": "TASK: Send an email to dana@example.com with subject 'Meeting notes', attaching /home/dominic/Warden/notes/budget-meeting-notes.txt."}),
    tool("call_2", "iris", "Email sent to dana@example.com with budget-meeting-notes.txt attached — Subject: Meeting notes."),
    final("The budget meeting notes are off to Dana."),
])

rows.append([
    user("save the flyer attachment from the book club email to my warden folder"),
    acall("call_1", "iris", {"task": "TASK: Download the flyer attachment from the latest book club email to /home/dominic/Warden."}),
    tool("call_1", "iris", "Downloaded book-club-flyer.pdf from Sarah Kline's email to /home/dominic/Warden."),
    final("The book club flyer is saved in your Warden folder."),
])

# ---- FORWARD / CLEANUP (5) ----

rows.append([
    user("Forward the hotel confirmation email to dana@example.com so she has the booking number for the trip."),
    acall("call_1", "iris", {"task": "TASK: Forward the email 'Booking confirmed — Harbourview Hotel' to dana@example.com, with a note that the booking number is in there for the trip."}),
    tool("call_1", "iris", "Forwarded 'Booking confirmed — Harbourview Hotel' to dana@example.com — Subject: Fwd: Booking confirmed — Harbourview Hotel."),
    final("Dana has the hotel confirmation with the booking number."),
])

rows.append([
    user("Archive all the daily deals newsletters, I never read them."),
    acall("call_1", "iris", {"task": "TASK: Archive all the Daily Deals Central newsletter emails in the inbox."}),
    tool("call_1", "iris", "Archived 14 emails from Daily Deals Central."),
    final("Archived 14 daily deals newsletters."),
])

rows.append([
    user("unsubscribe me from that daily deals thing, it's spamming me every single morning"),
    acall("call_1", "iris", {"task": "TASK: Unsubscribe me from the Daily Deals Central mailing list."}),
    tool("call_1", "iris", "Unsubscribed you from Daily Deals Central and deleted 6 of their emails."),
    final("You're off the daily deals list — cleared 6 of their emails too."),
])

rows.append([
    user("forward mike's last email about the fence timeline to dana@example.com so she's in the loop"),
    acall("call_1", "iris", {"task": "TASK: Forward the latest email from mike.renner@rennerbuilds.com about the fence timeline to dana@example.com, with a note that she should be in the loop on the fence dates."}),
    tool("call_1", "iris", "Forwarded 'Small delay on the fence' from Mike Renner to dana@example.com — Subject: Fwd: Small delay on the fence."),
    final("Dana's looped in on the fence delay."),
])

rows.append([
    user("archive everything from the printer ink place, they email twice a week and it's all junk"),
    acall("call_1", "iris", {"task": "TASK: Archive all emails from InkCorner in the inbox."}),
    tool("call_1", "iris", "Archived 9 emails from InkCorner."),
    final("Archived 9 InkCorner emails."),
])

assert len(rows) == 25, len(rows)
with open("/opt/Warden/training/orchatlas-parts/s16-3.jsonl", "w", encoding="utf-8") as f:
    f.write(dumps(rows))
print("s16-3.jsonl", len(rows))