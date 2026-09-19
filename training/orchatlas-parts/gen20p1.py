from gen20c import *

rows = []

# ---- 20 known-URL fetch rows ----

rows.append(UF(
    "What does this page say they're changing? https://marinaplacestrata.ca/notices/2026/parking-update",
    "https://marinaplacestrata.ca/notices/2026/parking-update",
    "## NOTICE — Visitor stall repaving\n\nVisitor parking stall 12 will be repaved **Mon Sep 22 – Wed Sep 24**. During the work, visitors must use the street or stall 3. Garage access fobs remain active.",
    "They're repaving visitor stall 12 from Sept 22 to 24 — visitors get stall 3 or street parking during the work, and garage fobs still work."))

rows.append(UF(
    "how long is the rise on this one https://www.theflatbakers.com/recipes/overnight-focaccia",
    "https://www.theflatbakers.com/recipes/overnight-focaccia",
    "## Overnight focaccia\n\nAfter mixing, cover and refrigerate **12–18 hours**. Punch down, rest 2 hours at room temperature, bake 20–22 min at 240°C.",
    "It's a 12-to-18-hour cold rise in the fridge, then 2 more hours at room temperature before it goes in the oven."))

rows.append(UF(
    "the karcher site says this filter fits a k4 right? and what does it cost — https://www.karcher.ca/accessories/plug-clean-filter",
    "https://www.karcher.ca/accessories/plug-clean-filter",
    "## Kärcher Plug 'n' Clean water filter\n\nCompatible with all K2–K7 pressure washers. Removes limescale and particles before they reach the pump. **$24.99 CAD.** In stock.",
    "Yes — it fits K2 through K7, so your K4 is covered, and it's $24.99 CAD, in stock."))

rows.append(UF(
    "What does the wiki say about choosing mirrors? https://wiki.archlinux.org/title/Mirrors",
    "https://wiki.archlinux.org/title/Mirrors",
    "## Mirrors\n\nRank mirrors by speed with `rankmirrors`, or generate an up-to-date list with reflector:\n\n`reflector --latest 20 --sort rate --save /etc/pacman.d/mirrorlist`\n\nLimit by country for lower latency.",
    "It recommends reflector — take the 20 most recently synced mirrors, sort by speed, and write them straight to /etc/pacman.d/mirrorlist."))

rows.append(UF(
    "wats the forecast say for sat, i bookmarked this page https://weather.gc.ca/city/pages/bc-74_metric_e.html",
    "https://weather.gc.ca/city/pages/bc-74_metric_e.html",
    "### Saturday 20 September\n\nSunny. High 21°C. UV index 5. Night: increasing cloud, 30% chance of showers after midnight.",
    "Saturday looks sunny with a high of 21 — the showers aren't due until after midnight."))

rows.append(UF(
    "What are the hours at Harry's? https://www.harryshardware.ca/hours",
    "https://www.harryshardware.ca/hours",
    "## Store hours\n\nMon–Fri 7:30–19:00 · Saturday 8:00–18:00 · Sunday & holidays 9:00–17:00. Closed Christmas Day.",
    "Mon–Fri 7:30 to 7, Saturday 8 to 6, and Sunday and holidays 9 to 5."))

rows.append(UF(
    "i keep hearing about this river road swap station thing, what's this article actually saying https://richmondsentinel.ca/news/river-road-battery-swap-pilot",
    "https://richmondsentinel.ca/news/river-road-battery-swap-pilot",
    "## Richmond pilots battery-swap station on River Road\n\nBC Hydro and the city will open a 12-bay battery-swap station at the River Road depot next March, serving e-bikes and cargo vans. Council approved $2.1M; a public bike counter is installed first, in November.",
    "The city's opening a 12-bay battery-swap station at the River Road depot next March for e-bikes and delivery vans — council approved $2.1M, and a public bike counter goes in this November."))

rows.append(UF(
    "Does the library here have late hours any more? https://www.fvrl.bc.ca/branches/riverside",
    "https://www.fvrl.bc.ca/branches/riverside",
    "## Riverside branch\n\nMon–Thu 9:00–20:00 · Fri 9:00–18:00 · Sat 10:00–17:00 · Sun 12:00–16:00. Closed stat holidays.",
    "It's open till 8 on weekdays Monday to Thursday, 6 Fridays, 5 Saturdays, and Sundays noon to 4."))

rows.append(UF(
    "whats on the menu at ramen buta these days https://ramenbuta.ca/menu",
    "https://ramenbuta.ca/menu",
    "## Ramen Buta — menu\n\nSpicy miso tonkotsu $16.50 · shoyu $15.00 · veggie tantanmen $15.50 · extra chashu $4.00 · gyoza (5) $7.00 · Sapporo on tap $7.50.",
    "Spicy miso tonkotsu is $16.50, shoyu $15, and there's a veggie tantanmen for $15.50 — gyoza are $7 for five."))

rows.append(UF(
    "when's the next sailing to the island from tsawwassen https://www.bcferries.com/routes-schedules/southern/tsawwassen-swartz-bay",
    "https://www.bcferries.com/routes-schedules/southern/tsawwassen-swartz-bay",
    "## Tsawwassen – Swartz Bay\n\nSailings hourly 7:00–22:00 (winter: last sailing 21:00). Next departures: 13:00, 14:00, 15:00. Vehicle booking recommended on weekends.",
    "Sailings are hourly — next ones are the 1:00, 2:00 and 3:00 pm, and the last boat of the day is at 10."))

rows.append(UF(
    "Where do they do the flu shots this year? https://www.immunizebc.ca/flu",
    "https://www.immunizebc.ca/flu",
    "## Get your flu shot\n\nFree for all BC residents. Drop in at any participating pharmacy from **Oct 5**, or book online. Bring your CareCard.",
    "Free for anyone in BC — drop in at any participating pharmacy from Oct 5 or book online, and bring your CareCard."))

rows.append(UF(
    "how much is this one https://www.ikea.com/ca/en/p/billy-bookcase-white-20263850",
    "https://www.ikea.com/ca/en/p/billy-bookcase-white-20263850",
    "## BILLY / OXBERG bookcase\n\nWhite, 80x202 cm. **$49.99.** Six adjustable shelves. Must be anchored to the wall.",
    "$49.99 for the 80 by 202 cm one — six adjustable shelves, and it needs anchoring to the wall."))

rows.append(UF(
    "Anything good in the new release? https://github.com/ollama/ollama/releases/tag/v0.14.2",
    "https://github.com/ollama/ollama/releases/tag/v0.14.2",
    "## v0.14.2\n\nNew: vision model support for GGUF quantization. Fix: context window drift after 100+ turns. Tool-calling latency reduced ~30%.",
    "Vision model quantization is new, there's a fix for context drift in long conversations, and tool calling got about 30% faster."))

rows.append(UF(
    "How early does check-in close for a domestic flight? https://www.aircanada.ca/ca/en/plan/way-finding/checkin.html",
    "https://www.aircanada.ca/ca/en/plan/way-finding/checkin.html",
    "## Check-in deadlines\n\nDomestic: 45 minutes before departure. Vancouver (YVR): 60 minutes if checking bags. Gate closes 15 minutes prior.",
    "Check-in closes 45 minutes before a domestic flight — 60 at YVR if you're checking bags — and the gate shuts 15 minutes out."))

rows.append(UF(
    "the counter guy said the good deck stain might be in the flyer this week, can you look? https://www.harryshardware.ca/weekly-flyer",
    "https://www.harryshardware.ca/weekly-flyer",
    "## Week of Sept 18–24\n\n- 30% off all Sikkens exterior stains\n- Karcher K4 bundle (washer + patio kit) $349.99\n- Cedar fence pickets $6.99 each",
    "It is — 30% off all Sikkens exterior stains this week, fence pickets at $6.99, and a K4 bundle with the patio kit for $349.99."))

rows.append(UF(
    "is the goldstream falls trail open or still closed https://bcparks.ca/goldstream/trail-notices",
    "https://bcparks.ca/goldstream/trail-notices",
    "## Gold Creek Falls trail\n\nUpdate Sept 10: the bridge at the 1.2 km mark has been **reopened** after repairs. Full trail open. Lower parking lot resurfacing Sept 25–27.",
    "Fully open again — the bridge at 1.2 km was fixed on Sept 10 — but the lower lot is closed for paving Sept 25 to 27."))

rows.append(UF(
    "When's the Vancity on 41st open till? https://www.vancity.com/branches/kerrisdale",
    "https://www.vancity.com/branches/kerrisdale",
    "## Kerrisdale branch\n\nMon–Wed 9:30–16:00 · Thu–Fri 9:30–17:00 · Sat 9:30–15:00. Closed Sundays.",
    "9:30 to 4 Monday to Wednesday, 9:30 to 5 Thursday and Friday, and Saturdays until 3."))

rows.append(UF(
    "how many bananas does this recipe actually want https://sallysbakingaddiction.com/banana-bread/",
    "https://sallysbakingaddiction.com/banana-bread/",
    "## Moist banana bread\n\n3 large very ripe bananas (about 1.5 cups mashed). Bake 55–65 min at 350°F.",
    "Three large very-ripe bananas — about a cup and a half mashed — and it bakes for roughly an hour at 350."))

rows.append(UF(
    "my panel keeps freezing after wake, did they ever fix it? found this thread https://discuss.kde.org/t/plasma-6-3-panel-freeze-after-wake/12345",
    "https://discuss.kde.org/t/plasma-6-3-panel-freeze-after-wake/12345",
    "## Plasma 6.3 panel freeze after wake — FIXED in 6.3.2\n\nBug 465542: kwin restart loop on resume with certain Intel drivers. Update to 6.3.2; workaround is disabling the fade animation.",
    "Yes — fixed in Plasma 6.3.2. It was an Intel driver bug in the resume animation, so update, or switch the fade animation off until you do."))

rows.append(UF(
    "What time is checkout at the place in Tofino we're looking at? https://www.oceanstoneinn.ca/policies",
    "https://www.oceanstoneinn.ca/policies",
    "## Policies\n\nCheck-in 15:00, checkout 11:00. Late checkout to 14:00 available for $30, subject to availability. Parking free.",
    "Checkout's 11 am, and they'll hold the room till 2 for $30 if it's available."))

# ---- 5 memory-first rows (marm answers, no web) ----

rows.append(MB(
    "what was that ramen place we liked again",
    "ramen place we liked",
    "1. [2026-05-02 · 0.92] Ramen Buta, Fraser St — spicy miso tonkotsu with extra chashu, captain called it the best of the year.\n2. [2026-03-11 · 0.71] Marutama, Denman — round chicken broth, decent.",
    "Ramen Buta on Fraser Street — the spicy miso tonkotsu with extra chashu was the one we rated best."))

rows.append(MB(
    "whats the plumbers name again, the one who did the bathroom",
    "plumber who did the bathroom",
    "1. [2026-02-17 · 0.94] PipeDream Plumbing — Marco, 604-555-0147, replaced the bathroom vanity trap, $180, on time.",
    "Marco at PipeDream Plumbing — 604-555-0147. He did the vanity trap for $180."))

rows.append(MB(
    "do you remember the wifi password at dad's place",
    "wifi password dad's place",
    "1. [2025-12-26 · 0.88] Dad's wifi — password SprinterBlue2019, network name Aurora-5G.",
    "SprinterBlue2019 — the network's called Aurora-5G."))

rows.append(MB(
    "which garage did we take the car to for the brakes",
    "garage brake job",
    "1. [2026-06-20 · 0.90] Precision Auto, No. 3 Road — front brake pads, rotors machined, $640.\n2. [2025-08-02 · 0.60] Oil change — Mr. Lube, quick lane.",
    "Precision Auto on No. 3 Road — front pads and machined rotors, $640."))

rows.append(MB(
    "what did i end up picking for the fence stain",
    "fence stain choice",
    "1. [2026-08-30 · 0.93] Fence stain decision — Cedar Naturaltone semi-transparent, about 2 gallons needed for 80 ft of fence.",
    "You picked the Cedar Naturaltone semi-transparent — about two gallons for the fence."))

save("s20-1.jsonl", rows)