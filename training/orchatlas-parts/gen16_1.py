from gen_common import user, acall, tool, final, dumps

rows = []

# ---- REPLIES (20) ----

rows.append([
    user("Reply to Dana: Thursday works for the budget review, and ask her to bring the updated spreadsheet."),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on the thread 'Re: Q3 budget review' saying Thursday works for the budget review and asking her to bring the updated spreadsheet."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Q3 budget review."),
    final("Replied to Dana — Thursday works, and she's bringing the updated spreadsheet."),
])

rows.append([
    user("tell the contractor we'll be home friday after 3 so he can come look at the fence"),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on the thread 'Fence repair quote' saying we will be home Friday after 3pm so he can come look at the fence."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Fence repair quote."),
    final("Told Mike we'll be home Friday after 3."),
])

rows.append([
    user("the dentist sent me a reminder to confirm and honestly if I don't do it now I'll forget, can you reply confirming the tuesday appointment"),
    acall("call_1", "iris", {"task": "TASK: Reply to frontdesk@riversidedental.com on the email 'Reminder: confirm your appointment' confirming the Tuesday appointment."}),
    tool("call_1", "iris", "Email sent to frontdesk@riversidedental.com — Subject: Re: Reminder: confirm your appointment."),
    final("Confirmed the Tuesday appointment with the dentist's office."),
])

rows.append([
    user("Reply to Dana that I can't make the Friday 3pm sync after all, and offer Monday morning instead."),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on the thread 'Friday 3pm sync' saying I can't make the Friday 3pm sync and offering Monday morning instead."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Friday 3pm sync."),
    final("Dana knows you're out Friday — I offered Monday morning instead."),
])

rows.append([
    user("reply to the bank email and say yes that was me, the charge at fairway market was legit"),
    acall("call_1", "iris", {"task": "TASK: Reply to security@cascadebank.com on the email 'Did you make this purchase?' confirming the charge at Fairway Market was legitimate and made by me."}),
    tool("call_1", "iris", "Email sent to security@cascadebank.com — Subject: Re: Did you make this purchase?"),
    final("Confirmed the Fairway Market charge with the bank."),
])

rows.append([
    user("just reply to mike and say go ahead with the cedar, the price is fine"),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on the thread 'Fence material options' telling him to go ahead with the cedar because the price is fine."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Fence material options."),
    final("Mike's going ahead with the cedar."),
])

rows.append([
    user("Reply to the UPS delivery notice and tell them to leave it at the side door, the front gate might be latched"),
    acall("call_1", "iris", {"task": "TASK: Reply to quantum.view@ups.com on the email 'Delivery scheduled: 1 package' telling them to leave the package at the side door because the front gate might be latched."}),
    tool("call_1", "iris", "Email sent to quantum.view@ups.com — Subject: Re: Delivery scheduled: 1 package."),
    final("Told UPS to leave it at the side door."),
])

rows.append([
    user("Reply to Dana: the budget review is moved to Thursday 2pm, same room, and I'll bring the printed figures."),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on the thread 'Re: Q3 budget review' saying the budget review is moved to Thursday 2pm in the same room, and I'll bring the printed figures."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Q3 budget review."),
    final("Dana has the new time — Thursday 2pm, same room, printed figures coming."),
])

rows.append([
    user("Reply to Mike Renner and tell him the gate latch still sticks when it rains, ask if that's covered under his work warranty."),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on the thread 'Gate install follow-up' telling him the gate latch still sticks when it rains and asking if that's covered under his work warranty."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Gate install follow-up."),
    final("Asked Mike whether the rain-sticking latch is under warranty."),
])

rows.append([
    user("reply to the dentist ppl and say i gotta push my cleaning back a few weeks, ask them what tuesdays they got in october"),
    acall("call_1", "iris", {"task": "TASK: Reply to frontdesk@riversidedental.com on the thread 'Cleaning reminder' saying I need to push the cleaning back a few weeks and asking which Tuesdays they have open in October."}),
    tool("call_1", "iris", "Email sent to frontdesk@riversidedental.com — Subject: Re: Cleaning reminder."),
    final("Asked the dentist for their open October Tuesdays."),
])

rows.append([
    user("my mom keeps asking if we're still on for sunday dinner, i feel bad leaving her on read, just reply that yes we'll be there around 5 and i'm bringing dessert"),
    acall("call_1", "iris", {"task": "TASK: Reply to carol.h2020@gmail.com on the thread 'Sunday dinner?' saying yes we'll be there around 5 and I'm bringing dessert."}),
    tool("call_1", "iris", "Email sent to carol.h2020@gmail.com — Subject: Re: Sunday dinner?"),
    final("Mom knows we're coming at 5, dessert's on me."),
])

rows.append([
    user("Reply to Karen that we'll pass on the fundraiser this year but thank her for thinking of us."),
    acall("call_1", "iris", {"task": "TASK: Reply to karen@lakesidepto.org on the thread 'Fall fundraiser — can you help?' saying we'll pass on the fundraiser this year and thanking her for thinking of us."}),
    tool("call_1", "iris", "Email sent to karen@lakesidepto.org — Subject: Re: Fall fundraiser — can you help?"),
    final("Passed on the fundraiser, with thanks."),
])

rows.append([
    user("Reply to Dana with the number: Q3 spend came in at 41,300 dollars, confirmed with finance, and it's all in the spreadsheet."),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on the thread 'Re: Q3 budget review' with the confirmed figure: Q3 spend came in at 41,300 dollars, confirmed with finance, and it's all in the spreadsheet."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Q3 budget review."),
    final("Sent Dana the confirmed figure — 41,300."),
])

rows.append([
    user("tell dana sure the 2pm slot works fine instead of the 3"),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on the thread 'Re: Q3 budget review' saying the 2pm slot works fine instead of 3pm."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Q3 budget review."),
    final("Dana knows 2pm works."),
])

rows.append([
    user("Reply to Mike confirming we received the signed contract, and tell him he can start Monday the 22nd."),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on the thread 'Contract — fence replacement' confirming we received the signed contract and telling him he can start Monday the 22nd."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Contract — fence replacement."),
    final("Mike's confirmed to start Monday the 22nd."),
])

rows.append([
    user("the hoa lady emailed again about the backyard project approval and i keep meaning to answer her... reply that the fence stays inside the property line exactly like the drawings they have on file"),
    acall("call_1", "iris", {"task": "TASK: Reply to greta@maplewoodhoa.org on the thread 'Backyard project — property line question' saying the fence stays inside the property line exactly like the drawings they have on file."}),
    tool("call_1", "iris", "Email sent to greta@maplewoodhoa.org — Subject: Re: Backyard project — property line question."),
    final("Told the HOA the fence matches the drawings they have on file."),
])

rows.append([
    user("Reply to the UPS claims email with claim number C78412 and tell them the damaged package was picked up by the driver on the 16th."),
    acall("call_1", "iris", {"task": "TASK: Reply to claims@ups.com on the thread 'Claim C78412 — follow-up' giving claim number C78412 and telling them the damaged package was picked up by the driver on the 16th."}),
    tool("call_1", "iris", "Email sent to claims@ups.com — Subject: Re: Claim C78412 — follow-up."),
    final("UPS has the pickup confirmation for claim C78412."),
])

rows.append([
    user("reply to mike n say the gravel guys can park in the driveway, no problem at all"),
    acall("call_1", "iris", {"task": "TASK: Reply to mike.renner@rennerbuilds.com on the thread 'Fence repair quote' saying the gravel guys can park in the driveway, no problem at all."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Re: Fence repair quote."),
    final("Mike knows the gravel crew can use the driveway."),
])

rows.append([
    user("Reply to Dana and thank her for handling the vendor call, tell her I'll review her notes before Friday."),
    acall("call_1", "iris", {"task": "TASK: Reply to dana@example.com on the thread 'Vendor call recap' thanking her for handling the vendor call and saying I'll review her notes before Friday."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Re: Vendor call recap."),
    final("Thanked Dana — I'll look at her notes before Friday."),
])

rows.append([
    user("i have got to stop leaving sarah on read about the book club, she asked if i finished it and honestly i did — reply that i finished it and offer to host next month"),
    acall("call_1", "iris", {"task": "TASK: Reply to sarah.kline@example.com on the thread 'Book club — did you finish it?' saying I finished the book and offering to host next month."}),
    tool("call_1", "iris", "Email sent to sarah.kline@example.com — Subject: Re: Book club — did you finish it?"),
    final("Sarah knows you finished — I offered to host next month."),
])

# ---- NEW SENDS (5) ----

rows.append([
    user("Send an email to dana@example.com with subject 'Lunch tomorrow?' saying I'll be at the Copper Fork at noon tomorrow, and ask if she can make it."),
    acall("call_1", "iris", {"task": "TASK: Send an email to dana@example.com with subject 'Lunch tomorrow?' saying I'll be at the Copper Fork at noon tomorrow and asking if she can make it."}),
    tool("call_1", "iris", "Email sent to dana@example.com — Subject: Lunch tomorrow?"),
    final("Lunch invite is out to Dana — noon at the Copper Fork."),
])

rows.append([
    user("email mike.renner@rennerbuilds.com and tell him the final payment for the fence is coming by e-transfer today, subject can just be 'payment'"),
    acall("call_1", "iris", {"task": "TASK: Send an email to mike.renner@rennerbuilds.com with subject 'payment' telling him the final payment for the fence is coming by e-transfer today."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: payment."),
    final("Mike knows the e-transfer is coming today."),
])

rows.append([
    user("i need to ask the dentist office for the estimate on the crown work before i commit to that appointment they keep bumping me about, can you email them"),
    acall("call_1", "iris", {"task": "TASK: Send an email to frontdesk@riversidedental.com with subject 'Crown estimate' asking them to send the estimate for the crown work before the appointment is confirmed."}),
    tool("call_1", "iris", "Email sent to frontdesk@riversidedental.com — Subject: Crown estimate."),
    final("Asked the dentist's office for the crown estimate before you commit."),
])

rows.append([
    user("Write up a quick note for Dana listing our three action items from the call — review the final spreadsheet, confirm the conference room, send her the Q3 receipts — then email it to dana@example.com with subject 'Action items from our call'."),
    acall("call_1", "Write", {"file_path": "/home/dominic/Warden/notes/dana-action-items.txt", "content": "Action items from our call\n\n1. Review the final spreadsheet\n2. Confirm the conference room\n3. Send Dana the Q3 receipts\n"}, content="Plan: write the note, then send it to Dana."),
    tool("call_1", "Write", "Wrote 4 lines to /home/dominic/Warden/notes/dana-action-items.txt"),
    acall("call_2", "iris", {"task": "TASK: Send an email to dana@example.com with subject 'Action items from our call' attaching /home/dominic/Warden/notes/dana-action-items.txt, with the body listing the three action items: review the final spreadsheet, confirm the conference room, send her the Q3 receipts."}),
    tool("call_2", "iris", "Email sent to dana@example.com with dana-action-items.txt attached — Subject: Action items from our call."),
    final("Sent Dana the action items — spreadsheet, room, receipts."),
])

rows.append([
    user("Send mike.renner@rennerbuilds.com an email, subject 'Site access', body: the crew can reach the backyard through the side gate, the gate code is 4471, and please don't let the dog out."),
    acall("call_1", "iris", {"task": "TASK: Send an email to mike.renner@rennerbuilds.com with subject 'Site access' and body: the crew can reach the backyard through the side gate, the gate code is 4471, and please don't let the dog out."}),
    tool("call_1", "iris", "Email sent to mike.renner@rennerbuilds.com — Subject: Site access."),
    final("Mike has the gate access details."),
])

assert len(rows) == 25, len(rows)
with open("/opt/Warden/training/orchatlas-parts/s16-1.jsonl", "w", encoding="utf-8") as f:
    f.write(dumps(rows))
print("s16-1.jsonl", len(rows))