from gen20c import *

rows = []

# ---- 7 search -> fetch rows ----

rows.append(SF(
    "What time does the ferry to Nanaimo leave on Saturday morning?",
    "Horseshoe Bay Departure Bay Saturday ferry schedule",
    "1. BC Ferries — Horseshoe Bay–Departure Bay — https://www.bcferries.com/routes-schedules/southern/hb-db\n2. Nanaimo ferries guide — https://tourismnanaimo.ca/ferries\n3. Horseshoe Bay terminal info — https://bcferries terminals guide",
    "https://www.bcferries.com/routes-schedules/southern/hb-db",
    "## Horseshoe Bay – Departure Bay\n\nSaturday sailings: 6:35, 8:25, 10:15, then every 2 h. Vehicle reservations strongly recommended on Saturdays.",
    "Saturday boats leave Horseshoe Bay at 6:35, 8:25 and 10:15 am — book the car on, Saturdays are a reservation route."))

rows.append(SF(
    "is the dump open on thanksgiving monday",
    "Richmond Recycling Depot holiday hours Thanksgiving",
    "1. Richmond Recycling Depot — holiday hours — https://richmond.ca/recycling-depot\n2. Vancouver Landfill holiday schedule — https://vancouver.ca/landfill\n3. Stat holiday waste drop-off Metro Vancouver — https://metrovancouver.org/holidays",
    "https://richmond.ca/recycling-depot",
    "## Statutory holidays\n\n**Open Thanksgiving Monday 8:00–16:00** (winter hours). Closed only Christmas Day and New Year's Day.",
    "Yes — Thanksgiving Monday it's open 8 to 4. Only Christmas and New Year's Day close it."))

rows.append(SF(
    "Where do I get a replacement BC CareCard?",
    "replace lost BC Services Card Richmond",
    "1. Replace a BC Services Card — government page — https://www2.gov.bc.ca/servicescard/replace\n2. Service BC Richmond — office info — https://www2.gov.bc.ca/servicebc-richmond\n3. Lost CareCard what to do — guide — https://healthlinkbc.ca/services-card",
    "https://www2.gov.bc.ca/servicescard/replace",
    "## Replace a BC Services Card\n\nOrder online if your photo is still current, or visit Service BC Richmond, 6340 No. 3 Rd — walk-ins Mon–Fri 8:30–16:30. **Free.**",
    "It's free — Service BC Richmond on No. 3 Rd does walk-ins Mon–Fri 8:30 to 4:30, or order online if your photo's still current."))

rows.append(SF(
    "the fence boards are finally dry and i want to stain this weekend before the rain comes back — will 2 gallons of sikkens do 80 feet of fence?",
    "Sikkens Cetol SRD coverage per gallon fence",
    "1. Sikkens Cetol SRD — coverage specs — https://sikkens.ca/srd-coverage\n2. Stain coverage calculator — https://staincalc.ca/fence\n3. How much stain for a fence — guide — https://woodmagazine.com/fence-coverage",
    "https://sikkens.ca/srd-coverage",
    "## Coverage\n\nCetol SRD: 350–400 sq ft per gallon, first coat. A 6 ft fence, 80 ft long, both sides = ~960 sq ft. Two coats need about **5 gallons**.",
    "Two gallons won't cut it — 80 feet of six-foot fence both sides is about 960 square feet, and Sikkens covers roughly 380 per gallon, so you want five gallons for two coats."))

rows.append(SF(
    "What's the number for the dump on River Road?",
    "Richmond Recycling Depot River Road phone number",
    "1. Richmond Recycling Depot — contact — https://richmond.ca/recycling-depot\n2. City of Richmond — contact directory — https://richmond.ca/contacts\n3. Waste hotline Metro Vancouver — https://metrovancouver.org/hotline",
    "https://richmond.ca/recycling-depot",
    "## Contact\n\n8040 River Road. **604-272-2010.** Recorded line for hours and fees; press 0 for an attendant 8:00–16:00.",
    "604-272-2010 — press 0 for a person between 8 and 4, otherwise it's a recorded hours-and-fees line."))

rows.append(SF(
    "what time does the sun set saturday, want to finish the fence in daylight",
    "sunset time Vancouver September 20 2026",
    "1. Sunrise and sunset — Vancouver — https://nrc.canada.ca/sunset-vancouver\n2. Sunset times Vancouver — timeanddate — https://timeanddate.com/vancouver-sunset\n3. Vancouver daylight hours September — almanac — https://almanac.ca/vancouver",
    "https://timeanddate.com/vancouver-sunset",
    "## Vancouver, Sept 20\n\nSunset **19:11**. Civil twilight until 19:40.",
    "Sunset's at 7:11 pm Saturday, with usable light till about 7:40."))

rows.append(SF(
    "where's the nearest place that sharpens chainsaw blades",
    "chainsaw chain sharpening service Richmond Vancouver",
    "1. Cutting Edge Sharpening — Westminster Hwy — https://cuttingedgesharpening.ca\n2. Blade & Bit sharpening — directory listing — https://bcsharpeners.ca\n3. Tools & Edge — Kerrisdale — https://toolsedge.ca",
    "https://cuttingedgesharpening.ca",
    "## Cutting Edge Sharpening — 3-6171 Westminster Hwy\n\nChainsaw chains $12 each. Drop-off before noon = same-day. Open Mon–Fri 8:00–17:00, Sat 9:00–13:00.",
    "Cutting Edge Sharpening on Westminster Highway — $12 a chain, and drop-off before noon gets it same day."))

# ---- 8 comparison rows (search -> fetch both -> answer from specs) ----

def CF(ask, q, results, u1, p1, u2, p2, ans):
    return R(U(ask), A("call_1", "WebSearch", query=q), T("call_1", "WebSearch", results),
             A("call_2", "WebFetch", url=u1), T("call_2", "WebFetch", p1),
             A("call_3", "WebFetch", url=u2), T("call_3", "WebFetch", p2), F(ans))

rows.append(CF(
    "so the karcher k4 or the sun joe spx3000 — which one for a cedar deck once a year, i don't want to fuzz the wood",
    "Karcher K4 vs Sun Joe SPX3000 pressure washer specs",
    "1. Kärcher Canada — K4 — https://www.karcher.ca/products/k4-pressure-washer\n2. Sun Joe SPX3000 — official page — https://sunjoe.com/spx3000\n3. K4 vs SPX3000 — comparison review — https://yardgearlab.com/k4-vs-spx3000",
    "https://www.karcher.ca/products/k4-pressure-washer",
    "## K4 Pressure Washer\n\n**1800 PSI, 1.32 GPM.** Induction motor rated 500 h. 6 m hose, Vario and dirtblaster nozzles. $329.99 CAD.",
    "https://sunjoe.com/spx3000",
    "## SPX3000\n\n**2030 PSI, 1.76 GPM.** Five quick-connect nozzles including 40°. Universal motor. $199.99 USD.",
    "For a cedar deck, the K4 — 1800 PSI is gentler, and its induction motor is rated for 500 hours against the Sun Joe's universal one. The SPX3000 is cheaper but runs 2030 PSI, so you'd need the 40° nozzle to keep from fuzzing the wood."))

rows.append(CF(
    "V12 or V11 Dyson — is the newer one worth it?",
    "Dyson V12 Detect Slim vs V11 specs price",
    "1. Dyson Canada — V12 Detect Slim — https://dyson.ca/v12\n2. Dyson V11 Torque Drive — product page — https://dyson.ca/v11\n3. V12 vs V11 — review comparison — https://vacuumlab.ca/v12-v11",
    "https://dyson.ca/v12",
    "## V12 Detect Slim\n\n150 AW suction, 60 min runtime, laser dust detection, 2.2 kg. **$649.99.**",
    "https://dyson.ca/v11",
    "## V11 Torque Drive\n\n**185 AW suction**, 60 min runtime, HEPA filtration, 3.1 kg. $499.99 (refurb $329).",
    "The V11 actually pulls harder — 185 vs 150 airwatts — for $150 less, and refurbs go for $329. The V12's case is weight and the laser display, not cleaning power."))

rows.append(CF(
    "weber or traeger if we mostly do burgers and the odd brisket",
    "Traeger Ironwood vs Weber Genesis grill comparison",
    "1. Traeger Ironwood 885 — product page — https://traeger.ca/ironwood-885\n2. Weber Genesis E-325s — product page — https://weber.com/genesis-e325s\n3. Pellet vs gas grills — buying guide — https://grilljournal.com/pellet-vs-gas",
    "https://traeger.ca/ironwood-885",
    "## Traeger Ironwood 885\n\n885 sq in, WiFIRE app, Super Smoke mode. Wood pellet. **$1,499.**",
    "https://weber.com/genesis-e325s",
    "## Weber Genesis E-325s\n\n3 burners, 513 sq in, cast-iron grates, sear station. Gas. **$1,049.**",
    "For mostly burgers, the Weber Genesis — gas sears properly and it's $450 less at $1,049. The Traeger's the better brisket machine, so if the brisket habit grows, that's the upgrade."))

rows.append(CF(
    "Sikkens or the Behr semi-transparent for the cedar fence — what's actually different?",
    "Sikkens Cetol SRD vs Behr semi-transparent stain comparison",
    "1. Sikkens Cetol SRD — product specs — https://sikkens.ca/srd\n2. Behr Premium semi-transparent — product page — https://behr.com/premium-semi-transparent\n3. Oil vs water-based fence stain — guide — https://stainjournal.com/oil-vs-water",
    "https://sikkens.ca/srd",
    "## Cetol SRD\n\nAlkyd **oil-based**. 350–400 sq ft/gal. 3–5 yr wear on vertical surfaces. Mineral spirits cleanup. $89/gal.",
    "https://behr.com/premium-semi-transparent",
    "## Behr Premium Semi-Transparent\n\nWater-based alkyd hybrid. 250–350 sq ft/gal. 2–3 yr wear. Soap cleanup. **$52/gal.**",
    "Sikkens is oil-based — more penetration, 3 to 5 years of wear, $89 a gallon and mineral-spirits cleanup. Behr's a soap-cleanup hybrid at $52 but expect 2 to 3 years. On a fence you'd rather not redo, the Sikkens buys you time."))

rows.append(CF(
    "Galaxy S25 or Pixel 9 — it's mostly for photos of the dog.",
    "Galaxy S25 vs Pixel 9 camera comparison price Canada",
    "1. Samsung Galaxy S25 — specs — https://samsung.ca/galaxy-s25\n2. Google Pixel 9 — specs — https://store.google.ca/pixel-9\n3. S25 vs Pixel 9 camera test — https://phonejournal.ca/s25-pixel9",
    "https://samsung.ca/galaxy-s25",
    "## Galaxy S25\n\n50 MP main f/1.8, night video mode, 4000 mAh, $1,099 CAD.",
    "https://store.google.ca/pixel-9",
    "## Pixel 9\n\n50 MP main + 48 MP ultrawide, Tensor G4, Magic Editor, class-leading night shots. **$979 CAD.**",
    "Pixel 9 — moving-dog and night shots are exactly what its Tensor chip is best at, and it's $120 cheaper at $979."))

rows.append(CF(
    "i'm on the beach every second weekend with the family and the power bank always dies — is that anker 737 actually worth the money or just the brand?",
    "Anker 737 power bank review worth it",
    "1. Anker 737 Power Bank — official page — https://anker.ca/737\n2. Anker 737 review — tested — https://chargejournal.com/anker-737-review\n3. Best power banks 2026 — https://wirecutter.com/power-banks",
    "https://anker.ca/737",
    "## Anker 737 Power Bank\n\n24,000 mAh, **140 W output** (charges a laptop), smart display. $149.99 CAD.",
    "https://chargejournal.com/anker-737-review",
    "## Anker 737 review — verdict\n\nBest 24,000 mAh unit tested. Charged a MacBook Pro 0–50% in 42 min. 4.8 stars from 1,800 reviews.",
    "Worth it for beach days — 24,000 mAh is about five phone charges, it'll even top up a laptop at 140 watts, and the reviews back it up. $149.99, but it's the last power bank you'll buy."))

rows.append(CF(
    "Does the Karcher K4 Premium actually give you anything over the regular K4?",
    "Karcher K4 vs K4 Premium differences",
    "1. Kärcher — K4 — https://www.karcher.ca/products/k4-pressure-washer\n2. Kärcher — K4 Premium — https://www.karcher.ca/products/k4-premium\n3. K4 vs K4 Premium — comparison — https://yardgearlab.com/k4-premium",
    "https://www.karcher.ca/products/k4-pressure-washer",
    "## K4\n\n1800 PSI, 1.32 GPM, 6 m hose, Vario + dirtblaster nozzles. $329.99 CAD.",
    "https://www.karcher.ca/products/k4-premium",
    "## K4 Premium\n\nSame 1800 PSI motor. **8 m hose**, storage reel, **T-Racer wide-area patio cleaner included.** $449.99 CAD.",
    "Same motor and pressure — the Premium adds an 8-metre hose, a reel and the T-Racer patio head. If the deck's the whole job, the T-Racer head alone is worth the $120 difference."))

rows.append(CF(
    "instant pot duo or the duo plus, its just me and the dog here",
    "Instant Pot Duo vs Duo Plus differences price",
    "1. Instant Pot Duo 6 qt — product page — https://instantpot.com/duo\n2. Instant Pot Duo Plus 6 qt — product page — https://instantpot.com/duo-plus\n3. Duo vs Duo Plus — comparison — https://kitchenjournal.ca/duo-vs-duo-plus",
    "https://instantpot.com/duo",
    "## Duo 6 qt\n\n13 smart programs, stainless inner pot. **$99.95.**",
    "https://instantpot.com/duo-plus",
    "## Duo Plus 6 qt\n\n17 smart programs, large blue display, sterilize cycle. **$119.95.**",
    "For one person the basic Duo's fine — $20 less and the Plus mostly adds programs you won't touch, though the sterilize cycle is handy if you can jar stuff."))

# ---- 5 browser fallback rows (WebFetch empty -> navigate + snapshot) ----

rows.append(BF(
    "How much are the tickets on this page? https://tickets.richmondnightmarket.ca/2026",
    "https://tickets.richmondnightmarket.ca/2026",
    "The page returned no content — the page requires JavaScript to render.",
    "Richmond Night Market 2026 Tickets",
    "heading 'Richmond Night Market 2026 Tickets'\nbutton 'Buy Adult Gate Pass $15.00'\nbutton 'Buy Fast Pass $35.00'\ntext 'Fast Pass — skip the line, valid any night'\ntext 'Season Pass $99.00'\ntext 'Children under 5 admitted free'",
    "Adults are $15 at the gate, $35 for the skip-the-line Fast Pass, $99 for a season pass — kids under 5 get in free."))

rows.append(BF(
    "how much are the cronuts at that bakery now https://www.lunettebakery.ca/menu — the page never loads for me",
    "https://www.lunettebakery.ca/menu",
    "The page returned no content — it requires JavaScript to render.",
    "Lunette Bakery — Menu",
    "heading 'Lunette Bakery'\nlist item 'Cronut — $6.50 (limit 2 per person, sold out after 14:00 most days)'\nlist item 'Almond croissant — $5.75'\nlist item 'Baguette — $4.25'",
    "The cronut's $6.50, limit two per person, and they're usually sold out after 2 pm — so get there early."))

rows.append(BF(
    "What does the city's page say about the water main work on River Road? https://richmond.ca/city-news/river-road-watermain",
    "https://richmond.ca/city-news/river-road-watermain",
    "The request was blocked (HTTP 403) — the site refuses automated readers.",
    "River Road water main renewal — City of Richmond",
    "heading 'River Road water main renewal'\ntext 'Night work Sept 22–26, 22:00–06:00.'\ntext 'River Road closed to through traffic between No. 3 Rd and the recycling depot.'\ntext 'Water shut-offs 02:00–05:00 Wednesday Sept 24, affected addresses notified.'",
    "Night work Sept 22 to 26, 10 pm to 6 am — River Road is closed to through traffic between No. 3 Rd and the depot, and there's a water shut-off Wednesday from 2 to 5 am."))

rows.append(BF(
    "When do doors open at the Commodore Friday? https://www.commodoreballroom.com/events/the-hail-friday",
    "https://www.commodoreballroom.com/events/the-hail-friday",
    "The page returned no content — it requires JavaScript to render.",
    "The Hail — Commodore Ballroom, Friday Sept 19",
    "heading 'The Hail — Friday Sept 19'\ntext 'Doors 20:00, show 21:00.'\ntext 'All ages. $28 advance, $33 at the door.'\nbutton 'Buy tickets'",
    "Doors at 8 Friday, show at 9 — all ages, $28 in advance or $33 at the door."))

rows.append(BF(
    "does the shuttle page say where it picks up, cant find it https://jetsetshuttle.ca/pickup-points",
    "https://jetsetshuttle.ca/pickup-points",
    "The page returned no content — it requires JavaScript to render.",
    "JetSet Shuttle — Pickup points",
    "heading 'Pickup points'\ntext 'YVR: International Arrivals, Bay 10.'\ntext 'Domestic stops: River Rock Casino, Aberdeen Centre.'\ntext 'Drop-off by address anywhere in Richmond.'",
    "It picks up at YVR International Arrivals, Bay 10 — with stops at River Rock Casino and Aberdeen Centre, and drop-off by address anywhere in Richmond."))

# ---- 5 memory-first rows ----

rows.append(MB(
    "What size was the water heater again — the plumber asked on the phone.",
    "water heater size model",
    "1. [2026-02-17 · 0.90] Water heater replaced 2020 — 40 gallon Rheem, warranty card in the basement folder.",
    "40-gallon Rheem, replaced in 2020 — the warranty card's in the basement folder."))

rows.append(MB(
    "when did we last do the furnace filter, is it due",
    "furnace filter last changed",
    "1. [2026-06-14 · 0.91] Furnace filter changed June 14, 2026 — 16x25x1, on a 3-month replacement cycle.",
    "Changed June 14 on a 3-month cycle — so it's due right about now."))

rows.append(R(
    U("what was the paint code for the shutters, gunmetal something?"),
    A("call_1", "mcp__marm__marm_smart_recall", query="paint code shutters gunmetal"),
    T("call_1", "mcp__marm__marm_smart_recall", "No memories matched."),
    A("call_2", "WebSearch", query="Cloverdale Paint gunmetal grey exterior paint code"),
    T("call_2", "WebSearch",
      "1. Cloverdale Paint — colour library — https://cloverdalepaint.com/colours\n2. Exterior greys — Cloverdale fan deck — https://cloverdalepaint.com/exterior-greys\n3. Grey exterior paint codes — guide — https://paintguide.ca/greys"),
    A("call_3", "WebFetch", url="https://cloverdalepaint.com/colours"),
    T("call_3", "WebFetch",
      "## Colour library — greys\n\n**Gunmetal Grey — CL7136**, available in Aura exterior satin. Sample pots $8 at all stores."),
    F("Nothing in memory, but the colour is Cloverdale's Gunmetal Grey, code CL7136, in the Aura exterior line — $8 sample pots if you want to check it against the shutters first.")))

# marm missed -> fall through to a search
rows.append(R(
    U("What was the name of that bike shop that fixed Sam's gears last spring?"),
    A("call_1", "mcp__marm__marm_smart_recall", query="bike shop fixed Sam's gears"),
    T("call_1", "mcp__marm__marm_smart_recall", "No memories matched."),
    A("call_2", "WebSearch", query="bike repair shop Fraser Street Vancouver drivetrain same-day"),
    T("call_2", "WebSearch",
      "1. RideOn Cycles — Fraser St — reviews — https://rideoncycles.ca/reviews\n2. JV Bike — service — https://jvbike.ca/service\n3. On the Spot Tuning — mobile repair — https://onthespotuning.ca"),
    A("call_3", "WebFetch", url="https://rideoncycles.ca/reviews"),
    T("call_3", "WebFetch",
      "## Reviews\n\n'Fixed a seized Shimano 105 drivetrain same-day' — April 2026. 'Best gear tuning on Fraser' — March 2026. 4.8 stars."),
    F("Nothing in memory, but it was almost certainly RideOn Cycles on Fraser — there's an April review describing a same-day Shimano 105 drivetrain fix.")))

rows.append(MB(
    "Did I ever note down Mom's flight number for October?",
    "mom's flight number October",
    "1. [2026-09-01 · 0.87] Mom's flight — AC 116, Oct 2, arrives YVR 21:40, domestic terminal M.",
    "Yes — AC 116 on Oct 2, landing at 9:40 pm at the domestic terminal."))

save("s20-3.jsonl", rows)