from gen20c import *

rows = []

def CF(ask, q, results, u1, p1, u2, p2, ans):
    return R(U(ask), A("call_1", "WebSearch", query=q), T("call_1", "WebSearch", results),
             A("call_2", "WebFetch", url=u1), T("call_2", "WebFetch", p1),
             A("call_3", "WebFetch", url=u2), T("call_3", "WebFetch", p2), F(ans))

# ---- 8 comparison rows ----

rows.append(CF(
    "Is the Kindle Paperwhite worth it over the basic for reading outside?",
    "Kindle basic vs Paperwhite specs price Canada",
    "1. Kindle — compare models — https://amazon.ca/kindle-compare\n2. Kindle Paperwhite — product page — https://amazon.ca/paperwhite\n3. Kindle buying guide 2026 — https://readerjournal.ca/kindle-guide",
    "https://amazon.ca/kindle-compare",
    "## Kindle Basic\n\n6\" display, 167 ppi, 16 GB. $119.99 CAD.",
    "https://amazon.ca/paperwhite",
    "## Kindle Paperwhite\n\n**6.8\" display, 300 ppi**, warm front light, IPX8 waterproof, 16 GB. $169.99 CAD.",
    "Yes for outside — the Paperwhite's 300 ppi screen handles sun much better, and you get warm light and waterproofing for $50 more."))

rows.append(CF(
    "it's 80 feet of fence and my hands are shot — 2 gallon or 5 gallon pump sprayer for the stain, or doesn't it matter",
    "2 gallon vs 5 gallon pump sprayer fence staining",
    "1. Chapin 2-gallon sprayer — product page — https://chapin.ca/2-gallon\n2. Chapin 5-gallon wheeled sprayer — product page — https://chapin.ca/5-gallon\n3. Staining a fence with a sprayer — guide — https://stainjournal.com/sprayer-guide",
    "https://chapin.ca/2-gallon",
    "## Chapin 2-gallon sprayer\n\n$39.99. 5 ft hose, fine for spot work and small decks.",
    "https://chapin.ca/5-gallon",
    "## Chapin 5-gallon sprayer\n\n$89.99. **12 ft hose, wheels**, 1 gal/min output. One fill covers ~700 sq ft.",
    "The 5-gallon — 80 feet of fence means four or five refills on the little one, and the big one wheels along beside you and covers about 700 square feet per fill."))

rows.append(CF(
    "Ryobi or Milwaukee impact driver — I hang shelves maybe twice a year.",
    "Ryobi ONE+ HP vs Milwaukee M12 Fuel impact driver price",
    "1. Ryobi ONE+ HP impact kit — https://ryobitools.ca/one-hp-impact\n2. Milwaukee M12 Fuel impact kit — https://milwaukeetool.ca/m12-fuel-impact\n3. Budget vs pro impact drivers — https://tooljournal.ca/impact-guide",
    "https://ryobitools.ca/one-hp-impact",
    "## Ryobi ONE+ HP impact kit\n\n1,800 in-lbs, battery + charger included. **$149.99.**",
    "https://milwaukeetool.ca/m12-fuel-impact",
    "## Milwaukee M12 Fuel impact kit\n\n1,500 in-lbs, 3-yr warranty, battery + charger. $249.99.",
    "Ryobi — for shelves twice a year the Milwaukee's extra $100 buys nothing you'll feel, and the Ryobi shares batteries with the drill you already have."))

rows.append(CF(
    "yeti or rtic, i aint paying for a logo if they do the same thing",
    "Yeti Tundra vs RTIC 45 cooler ice retention price",
    "1. Yeti Tundra 45 — product page — https://yetti.ca/tundra-45\n2. RTIC 45 — product page — https://rtic.ca/rtic-45\n3. Yeti vs RTIC side-by-side test — https://coolerjournal.com/yeti-vs-rtic",
    "https://yetti.ca/tundra-45",
    "## Yeti Tundra 45\n\nBear-resistant, 26-can capacity, 3-yr warranty. **$300.00.**",
    "https://rtic.ca/rtic-45",
    "## RTIC 45\n\nSame 26-can capacity, advertised 5-day ice retention. **$220.00.**",
    "RTIC — same capacity, and the side-by-side tests show ice lasting just as long, for $80 less at $220."))

rows.append(CF(
    "Garmin or Apple Watch — I run three times a week and I have an iPhone.",
    "Garmin Forerunner 265 vs Apple Watch for running",
    "1. Garmin Forerunner 265 — product page — https://garmin.ca/forerunner-265\n2. Apple Watch Series 11 — product page — https://apple.ca/watch-series-11\n3. Garmin vs Apple Watch runners — https://runnersjournal.ca/garmin-apple",
    "https://garmin.ca/forerunner-265",
    "## Forerunner 265\n\n**13-day battery**, training load and recovery metrics, GPS accuracy rated best in class. $549.",
    "https://apple.ca/watch-series-11",
    "## Apple Watch Series 11\n\nECG, 36-h battery, deep iPhone integration. $519.",
    "For running, the Garmin — a week-plus of battery instead of 36 hours, and it actually tracks training load and recovery. The iPhone integration is the only thing you'd miss."))

rows.append(CF(
    "Does Ramen Buta do a vegetarian broth, or is that Izakaya Yu?",
    "Ramen Buta vegetarian ramen Izakaya Yu menu",
    "1. Ramen Buta — menu — https://ramenbuta.ca/menu\n2. Izakaya Yu — menu — https://izakayayu.ca/menu\n3. Vegetarian ramen Vancouver — round-up — https://vancouver.eater.ca/veg-ramen",
    "https://ramenbuta.ca/menu",
    "## Ramen Buta — menu\n\n**Veggie tantanmen $15.50** — sesame-miso broth, no pork. Vegetable gyoza $6.50.",
    "https://izakayayu.ca/menu",
    "## Izakaya Yu — menu\n\nNabemono, karaage, agedashi tofu. No ramen on the menu.",
    "Ramen Buta — the veggie tantanmen is a sesame-miso broth with no pork in it. Izakaya Yu doesn't do ramen at all."))

rows.append(CF(
    "Costco has the K4 bundle this month per the flyer — is Kärcher's own site cheaper with the free shipping and all?",
    "Karcher K4 bundle Costco vs Karcher Canada price",
    "1. Costco — Karcher K4 bundle — https://www.costco.ca/karcher-k4-bundle\n2. Kärcher Canada — K4 — https://www.karcher.ca/products/k4-pressure-washer\n3. Karcher patio kit price — https://yardgearlab.com/k4-patio-kit",
    "https://www.costco.ca/karcher-k4-bundle",
    "## Karcher K4 + patio kit bundle\n\n**$319.99** (was $399.99). Includes T-Racer T35 patio cleaner.",
    "https://www.karcher.ca/products/k4-pressure-washer",
    "## K4 Pressure Washer\n\n$329.99 CAD, free shipping. Patio kit **sold separately at $119.99**.",
    "Costco — $319.99 with the T-Racer head included is about $140 cheaper than Kärcher's own site, where the washer is $329.99 and the patio kit adds $119.99."))

rows.append(CF(
    "iPhone 15 or 16 — it's really just WhatsApp and photos.",
    "iPhone 15 vs iPhone 16 price Canada differences",
    "1. iPhone 15 — Apple Canada — https://apple.ca/iphone-15\n2. iPhone 16 — Apple Canada — https://apple.ca/iphone-16\n3. iPhone 15 vs 16 — comparison — https://phonejournal.ca/iphone15-16",
    "https://apple.ca/iphone-15",
    "## iPhone 15\n\nA16 chip, 48 MP camera. **$1,019 CAD.**",
    "https://apple.ca/iphone-16",
    "## iPhone 16\n\nA18 chip, 48 MP + Camera Control button, Apple Intelligence. $1,099 CAD.",
    "The 15 — $80 less and the photos come out the same. The 16's extras are for people who game on it."))

# ---- 5 browser fallback rows ----

rows.append(BF(
    "Are the ferries running normally Friday night? https://www.bcferries.com/current-conditions",
    "https://www.bcferries.com/current-conditions",
    "The request was blocked (HTTP 403) — the site refuses automated readers.",
    "BC Ferries — Current conditions",
    "heading 'Current conditions'\ntext 'Tsawwassen – Swartz Bay: normal service.'\ntext 'Horseshoe Bay – Departure Bay: 1 sailing approx. 45 min late (mechanical).'\ntext 'All other routes: normal service.'",
    "Your route — Tsawwassen to Swartz Bay — is running normally Friday. Horseshoe Bay has one delayed sailing, but that's the other side."))

rows.append(BF(
    "how longs the wait at the walkin clinic right now https://mediq-clinic.ca/wait-times",
    "https://mediq-clinic.ca/wait-times",
    "The page returned no content — it requires JavaScript to render.",
    "MedIQ Clinic — Current wait",
    "heading 'Current wait time'\ntext '40 minutes (checked 12:05)'\ntext '6 patients ahead of you'\ntext 'Clinic closes 20:00 today'",
    "About a 40-minute wait — 6 patients ahead, and the clinic's open till 8 tonight."))

rows.append(BF(
    "Does the Recycle Coach page show our pickup day? https://app.recyclecoach.com/richmond/schedule",
    "https://app.recyclecoach.com/richmond/schedule",
    "The page returned no content — it requires JavaScript to render.",
    "Richmond collection schedule — Recycle Coach",
    "heading 'Your collection schedule'\ntext 'Garbage + food scraps: Friday, set out by 6:30 am'\ntext 'Recycling (blue box): alternating Fridays — next Sept 26'\ntext 'Next garbage pickup: Friday Sept 19'",
    "Yes — garbage and food scraps go out Friday by 6:30 am (next one Sept 19), and the blue box is every other Friday, next on the 26th."))

rows.append(BF(
    "trying to see if that harbor air deal is still on before i book the friday flight to victoria, their deals page https://www.harborair.ca/deals never loads for me",
    "https://www.harborair.ca/deals",
    "The page returned no content — it requires JavaScript to render.",
    "Harbour Air — Deals",
    "heading 'Fly Friday'\ntext '15% off Friday flights YVR–Victoria and YVR–Nanaimo'\ntext 'Book by Sept 30, travel through Nov 21'\ntext 'Use promo code FLYFR at checkout'",
    "The Fly Friday deal's still on — 15% off the Friday Victoria and Nanaimo flights if you book by Sept 30, code FLYFR."))

rows.append(BF(
    "What's the long-term parking rate at YVR? https://www.yvr.ca/en/parking",
    "https://www.yvr.ca/en/parking",
    "The request was blocked (HTTP 403) — the site refuses automated readers.",
    "YVR — Parking rates",
    "heading 'Parking'\ntext 'Long term: $24.75/day drive-up, $19.75/day prebooked online'\ntext 'Economy JetSet: $15.75/day, free shuttle every 10 min'",
    "Long-term is $24.75 a day drive-up, $19.75 prebooked — or the economy lot at $15.75 with a free shuttle every 10 minutes."))

# ---- 8 research -> escalate rows ----

def ESC(ask, q, results, fetches, task, ans):
    msgs = [U(ask), A("call_1", "WebSearch", query=q), T("call_1", "WebSearch", results)]
    cid = 2
    for u, p in fetches:
        msgs.append(A("call_" + str(cid), "WebFetch", url=u))
        msgs.append(T("call_" + str(cid), "WebFetch", p))
        cid += 1
    msgs.append(A("call_" + str(cid), "escalate_to_cloud", task=task))
    msgs.append(T("call_" + str(cid), "escalate_to_cloud",
                  "Escalated to cloud reasoning — the answer will arrive in your inbox when it finishes."))
    msgs.append(F(ans))
    return R(*msgs)

rows.append(ESC(
    "Research the best heat pumps for a 1980s Vancouver split-level and write up the tradeoffs — cold-climate ratings, cost vs. gas, and what rebates we'd actually get.",
    "cold climate heat pump BC rebate CleanBC 2026",
    "1. CleanBC Better Homes — heat pump rebates — https://cleanbc.betterhomes.ca/rebates\n2. Best cold-climate heat pumps 2026 — https://hvacjournal.ca/cold-climate-heat-pumps\n3. BC Hydro — heat pump vs gas furnace costs — https://bchydro.ca/heat-pump-comparison",
    [("https://cleanbc.betterhomes.ca/rebates",
      "## Heat pump rebates\n\nUp to **$6,000** income-scaled through CleanBC, plus a $3,000 federal top-up for oil-to-heat-pump switches. Licensed contractor and pre-approval required."),
     ("https://bchydro.ca/heat-pump-comparison",
      "## Heat pump vs gas\n\nAnnual heating cost: heat pump ~$1,100 at current rates vs gas ~$850. Heat pump wins with cooling included; watch time-of-use rates announced for 2027.")],
    "Research the best heat pumps for a 1980s Vancouver split-level and write up the tradeoffs — cold-climate ratings, cost vs. gas, and what rebates we'd actually get. Facts gathered: CleanBC rebate up to $6,000 income-scaled plus $3,000 federal oil-switch top-up, licensed contractor + pre-approval required (https://cleanbc.betterhomes.ca/rebates). Annual cost comparison: heat pump ~$1,100 vs gas ~$850, time-of-use rates coming 2027 (https://bchydro.ca/heat-pump-comparison).",
    "I've gathered the rebate and cost baseline — CleanBC pays up to $6,000, and running cost is roughly $250/yr over gas — and escalated the full heat pump trade-off write-up to cloud reasoning. It'll land in your inbox."))

rows.append(ESC(
    "I need to replace about 80 feet of rotted cedar panel fence and I keep getting wildly different quotes — can you look into what fencing actually costs per foot around here and who's reputable, and write me a short brief?",
    "cedar fence installation cost per foot Vancouver 2026 contractor",
    "1. Fencing costs Metro Vancouver — 2026 guide — https://homewise.ca/fence-cost-vancouver\n2. Best fence contractors Vancouver — reviews — https://trustedcontractors.ca/fencing-vancouver\n3. Cedar panel fence pricing — forum thread — https://reddit.com/r/vancouverhomes",
    [("https://homewise.ca/fence-cost-vancouver",
      "## Fence costs — Metro Vancouver\n\nCedar panel, 6 ft: **$45–$75 per linear foot installed**, 80 ft ≈ $4,300–$6,000. Demolition of old fence $8–$12/ft extra."),
     ("https://trustedcontractors.ca/fencing-vancouver",
      "## Top-rated fence contractors — Vancouver\n\nNorthwest Fence Co. — 4.8★, 210 reviews. Alpine Fencing — 4.7★, 96 reviews, cedar specialists. Both licensed, free estimates.")],
    "I need to replace about 80 feet of rotted cedar panel fence and I keep getting wildly different quotes — can you look into what fencing actually costs per foot around here and who's reputable, and write me a short brief? Facts gathered: cedar panel 6 ft runs $45–$75/ft installed (~$4,300–$6,000 for 80 ft, plus $8–$12/ft demolition) per https://homewise.ca/fence-cost-vancouver; top-rated contractors are Northwest Fence Co. 4.8★/210 reviews and Alpine Fencing 4.7★ cedar specialists per https://trustedcontractors.ca/fencing-vancouver.",
    "The baseline is $45 to $75 a foot installed for six-foot cedar — about $4,300 to $6,000 for your 80 feet, plus demo — and I found the two top-rated local contractors. I've escalated the full cost brief to cloud reasoning; watch your inbox."))

rows.append(ESC(
    "Is it worth switching our gas furnace to a heat pump with BC Hydro's new time-of-use rates? Write me a short memo with the numbers.",
    "BC Hydro time of use rates heat pump vs gas furnace 2026",
    "1. BC Hydro — time-of-use rates explained — https://bchydro.ca/tou-rates\n2. Heat pump vs furnace operating cost BC — https://bchydro.ca/heat-pump-comparison\n3. Gas furnace to heat pump switch — CleanBC — https://cleanbc.betterhomes.ca/switch-guide",
    [("https://bchydro.ca/tou-rates",
      "## Time-of-use rates\n\nOff-peak $0.099/kWh, peak (16:00–21:00) **$0.161/kWh**. Rates fully in effect 2027. Heating load mostly off-peak benefits.")],
    "Is it worth switching our gas furnace to a heat pump with BC Hydro's new time-of-use rates? Write me a short memo with the numbers. Facts gathered: time-of-use electricity is $0.099/kWh off-peak vs $0.161/kWh peak 16:00–21:00, fully in effect 2027, and heating load mostly falls off-peak (https://bchydro.ca/tou-rates); CleanBC rebates up to $6,000 income-scaled (https://cleanbc.betterhomes.ca/rebates).",
    "I've got the rate structure — $0.099 off-peak vs $0.161 peak, with heating mostly falling off-peak — and escalated the switch-vs-stay memo to cloud reasoning with the numbers inline. It'll arrive in your inbox."))

rows.append(ESC(
    "Look into whether a heat pump water heater beats the tankless gas one we have and write up whether it's worth switching.",
    "heat pump water heater vs tankless gas cost BC",
    "1. Heat pump water heaters — CleanBC rebate — https://cleanbc.betterhomes.ca/hpwh\n2. HPWH vs tankless — cost comparison — https://energyjournal.ca/hpwh-tankless\n3. Sanden and Rheem HPWH reviews — https://hvactoday.ca/hpwh-reviews",
    [("https://cleanbc.betterhomes.ca/hpwh",
      "## Heat pump water heater rebate\n\nCleanBC: **$1,000** off a qualifying heat pump water heater. Requires pre-approval, installed by licensed contractor."),
     ("https://energyjournal.ca/hpwh-tankless",
      "## HPWH vs tankless gas\n\nHPWH: ~$220/yr electricity for a family of four. Tankless gas: ~$310/yr at 2026 gas rates. HPWH unit cost higher ($3,000–$4,500 installed) but lifespan 12–15 yr similar.")],
    "Look into whether a heat pump water heater beats the tankless gas one we have and write up whether it's worth switching. Facts gathered: CleanBC gives $1,000 off qualifying HPWHs with pre-approval (https://cleanbc.betterhomes.ca/hpwh); running cost ~$220/yr HPWH vs ~$310/yr tankless gas, HPWH install $3,000–$4,500 (https://energyjournal.ca/hpwh-tankless).",
    "The raw numbers say the heat pump water heater runs about $90 a year cheaper plus a $1,000 rebate, but the install is $3,000-plus. I've escalated the worth-it write-up to cloud reasoning with those figures inline."))

rows.append(ESC(
    "compare the main cedar stain brands and write me a recommendation for 80 feet of fence that we don't want to redo every second year",
    "best cedar fence stain brands Canada longevity comparison",
    "1. Best deck and fence stains 2026 — ranked — https://stainjournal.com/best-stains-2026\n2. Sikkens Cetol SRD — product specs — https://sikkens.ca/srd\n3. TWP and Ready Seal reviews Canada — https://yardgearlab.ca/stain-reviews",
    [("https://stainjournal.com/best-stains-2026",
      "## Best exterior stains 2026\n\n1. Sikkens Cetol SRD — 3–5 yr wear, oil-based, $89/gal. 2. TWP 1500 — 3–4 yr, $74/gal, US-made, mail order in Canada. 3. Ready Seal — 2–3 yr, $62/gal, easiest application."),
     ("https://sikkens.ca/srd",
      "## Cetol SRD\n\nAlkyd oil, one-coat coverage 350–400 sq ft/gal, 3–5 yr wear on vertical surfaces, mineral spirits cleanup.")],
    "compare the main cedar stain brands and write me a recommendation for 80 feet of fence that we don't want to redo every second year. Facts gathered: ranked list is Sikkens Cetol SRD 3–5 yr wear $89/gal, TWP 1500 3–4 yr $74/gal mail-order, Ready Seal 2–3 yr $62/gal (https://stainjournal.com/best-stains-2026); Sikkens covers 350–400 sq ft/gal one coat, 3–5 yr vertical wear (https://sikkens.ca/srd); our fence is 80 ft, 6 ft high, both sides ~960 sq ft, captain already chose Cedar Naturaltone.",
    "I've pulled the ranked list — Sikkens leads on wear at 3–5 years, TWP and Ready Seal behind — and escalated the brand recommendation with your fence's coverage numbers to cloud reasoning. The write-up will land in your inbox."))

rows.append(ESC(
    "research whether an e-bike actually makes sense for commuting from Richmond to downtown with the hills and the rain, and write up a short buying brief",
    "e-bike commuting Richmond to Vancouver bridge route buying guide",
    "1. E-bike commuter buying guide 2026 — https://bikejournal.ca/ebike-guide\n2. Cycling the Canada Line bridge — route notes — https://ridevancouver.ca/canada-line-bridge\n3. Best commuter e-bikes under $3000 CAD — https://ebiketest.ca/commuters",
    [("https://bikejournal.ca/ebike-guide",
      "## E-bike commuter guide\n\nCommuter e-bikes: mid-drive vs hub motor, torque sensors matter in rain; budget $2,000–$3,500 for a reliable commuter with fenders and rack. Winterize: hydraulic discs + good fenders mandatory in Vancouver."),
     ("https://ridevancouver.ca/canada-line-bridge",
      "## Richmond to downtown by bike\n\nVia Canada Line bridge path: 14 km, mostly flat, 50 min on an e-bike. Bridge path closes for maintenance some winters.")],
    "research whether an e-bike actually makes sense for commuting from Richmond to downtown with the hills and the rain, and write up a short buying brief. Facts gathered: reliable commuter e-bikes run $2,000–$3,500, hydraulic discs and fenders essential in Vancouver rain (https://bikejournal.ca/ebike-guide); the route via the Canada Line bridge path is 14 km, mostly flat, ~50 min by e-bike (https://ridevancouver.ca/canada-line-bridge).",
    "The route's 14 km and mostly flat via the Canada Line bridge path, about 50 minutes by e-bike — I've escalated the rain-and-hills worth-it brief with the route and budget facts to cloud reasoning."))

rows.append(ESC(
    "look up the rules for backyard hens in Richmond and write up what the permit process actually involves",
    "Richmond backyard chickens bylaw permit rules",
    "1. City of Richmond — urban hens bylaw — https://richmond.ca/bylaws/hens\n2. Backyard hens Metro Vancouver rules by city — https://metrovancouver.org/hens-guide\n3. Richmond hen permit experience — forum thread — https://reddit.com/r/richmondbc",
    [("https://richmond.ca/bylaws/hens",
      "## Backyard hens — Richmond\n\nAllowed: up to **4 hens** on lots over 370 m², no roosters. Annual permit $50, requires neighbor sign-off and a predator-proof coop plan.")],
    "look up the rules for backyard hens in Richmond and write up what the permit process actually involves. Facts gathered: Richmond allows up to 4 hens on lots over 370 m², no roosters, annual permit $50 with neighbor sign-off and a predator-proof coop plan (https://richmond.ca/bylaws/hens).",
    "Richmond allows up to four hens with a $50 annual permit, no roosters, neighbor sign-off and a coop plan — I've escalated the full permit-walkthrough to cloud reasoning with the bylaw facts inline."))

rows.append(ESC(
    "who are the good dentists near us that are taking new patients, make me a shortlist",
    "dentist Kerrisdale Richmond accepting new patients reviews",
    "1. Best dentists Vancouver — patient reviews — https://rateyourdentist.ca/vancouver\n2. Kerrisdale dental clinics directory — https://bcdental.org/find-a-dentist\n3. Dentists accepting new patients near V6P — https://google.ca/dentists-v6p",
    [("https://rateyourdentist.ca/vancouver",
      "## Top-rated dentists — west side\n\nKerrisdale Dental Studio — 4.9★, 420 reviews, open Saturdays. Oakridge Family Dental — 4.8★, 310 reviews, evening hours Thurs."),
     ("https://bcdental.org/find-a-dentist",
      "## Find a dentist — BC Dental\n\nFilter by 'accepting new patients': 6 clinics within 5 km of Kerrisdale, including Kerrisdale Dental Studio and Oakridge Family Dental.")],
    "who are the good dentists near us that are taking new patients, make me a shortlist. Facts gathered: Kerrisdale Dental Studio 4.9★/420 reviews, open Saturdays, accepting new patients; Oakridge Family Dental 4.8★/310 reviews, evening hours Thursdays, accepting new patients (https://rateyourdentist.ca/vancouver, https://bcdental.org/find-a-dentist).",
    "Two clear front-runners — Kerrisdale Dental Studio at 4.9 stars with Saturday hours, and Oakridge Family Dental with Thursday evenings — both taking new patients. I've escalated the shortlist write-up to cloud reasoning to weigh them properly."))

# ---- 4 PDF-save chains ----

rows.append(R(
    U("Print me the ferry schedule to Swartz Bay as a PDF."),
    A("call_1", "WebFetch", url="https://www.bcferries.com/routes-schedules/southern/tsawwassen-swartz-bay"),
    T("call_1", "WebFetch",
      "## Tsawwassen – Swartz Bay\n\nSailings hourly 7:00–22:00 (winter: last sailing 21:00). Next departures: 13:00, 14:00, 15:00. Vehicle booking recommended on weekends. Check in 60 min before sailing with a vehicle."),
    A("call_2", "generate_pdf", filename="tsawwassen-swartz-bay-schedule.pdf",
      content="# Tsawwassen – Swartz Bay ferry schedule\n\nSailings hourly, 7:00-22:00 (winter: last sailing 21:00).\n\nNext departures: 13:00, 14:00, 15:00.\n\nVehicle booking recommended on weekends. Check in 60 minutes before sailing with a vehicle."),
    T("call_2", "generate_pdf", "PDF generated: /home/dominic/Warden/tsawwassen-swartz-bay-schedule.pdf (1 pages, 28 KB)."),
    F("Saved it — /home/dominic/Warden/tsawwassen-swartz-bay-schedule.pdf, one page with the hourly sailing grid and the check-in note.")))

rows.append(R(
    U("Can you make a PDF of the recycling depot info — hours, fees and the phone number?"),
    A("call_1", "WebSearch", query="Richmond Recycling Depot hours fees phone River Road"),
    T("call_1", "WebSearch",
      "1. Richmond Recycling Depot — hours and fees — https://richmond.ca/recycling-depot\n2. City of Richmond — contact directory — https://richmond.ca/contacts\n3. Waste drop-off Metro Vancouver — https://metrovancouver.org/waste"),
    A("call_2", "WebFetch", url="https://richmond.ca/recycling-depot"),
    T("call_2", "WebFetch",
      "## Richmond Recycling Depot — 8040 River Road\n\nOpen 7 days, 8:00–17:00 (Oct 1–Mar 31: closes 16:00). Yard waste free for residents; gypsum $15/load. Phone 604-272-2010, press 0 for attendant 8:00–16:00. Closed Christmas Day."),
    A("call_3", "generate_pdf", filename="richmond-recycling-depot.pdf",
      content="# Richmond Recycling Depot\n\nAddress: 8040 River Road\nPhone: 604-272-2010 (press 0 for attendant, 8:00-16:00)\n\nHours: 7 days, 8:00-17:00 (Oct 1 - Mar 31: closes 16:00)\nClosed Christmas Day.\n\nFees: yard waste free for residents; gypsum $15 per load."),
    T("call_3", "generate_pdf", "PDF generated: /home/dominic/Warden/richmond-recycling-depot.pdf (1 pages, 24 KB)."),
    F("Done — /home/dominic/Warden/richmond-recycling-depot.pdf has the address, phone, hours and fees on one page.")))

rows.append(R(
    U("save that focaccia recipe as a pdf for the kitchen please, https://www.theflatbakers.com/recipes/overnight-focaccia"),
    A("call_1", "WebFetch", url="https://www.theflatbakers.com/recipes/overnight-focaccia"),
    T("call_1", "WebFetch",
      "## Overnight focaccia\n\nAfter mixing, cover and refrigerate 12–18 hours. Punch down, rest 2 hours at room temperature, bake 20–22 min at 240°C. Top with rosemary and coarse salt before baking."),
    A("call_2", "generate_pdf", filename="overnight-focaccia.pdf",
      content="# Overnight focaccia\n\n1. Mix dough, cover and refrigerate 12-18 hours.\n2. Punch down, rest 2 hours at room temperature.\n3. Top with rosemary and coarse salt.\n4. Bake 20-22 min at 240C."),
    T("call_2", "generate_pdf", "PDF generated: /home/dominic/Warden/overnight-focaccia.pdf (1 pages, 21 KB)."),
    F("Saved — /home/dominic/Warden/overnight-focaccia.pdf, one page: cold rise overnight, 2-hour rest, then 20-odd minutes at 240.")))

rows.append(R(
    U("before we fly tuesday, can you pdf the airport parking rates so i don't get robbed at the gate"),
    A("call_1", "WebFetch", url="https://www.yvr.ca/en/parking"),
    T("call_1", "WebFetch",
      "## Parking — YVR\n\nLong term: $24.75/day drive-up, $19.75/day prebooked online. Economy JetSet: $15.75/day, free shuttle every 10 min. Parkade (hourly): $7.50/30 min, $46.50/day max."),
    A("call_2", "generate_pdf", filename="yvr-parking-rates.pdf",
      content="# YVR parking rates\n\nLong term: $24.75/day drive-up, $19.75/day prebooked online.\nEconomy JetSet: $15.75/day, free shuttle every 10 min.\nParkade (hourly): $7.50 per 30 min, $46.50/day max."),
    T("call_2", "generate_pdf", "PDF generated: /home/dominic/Warden/yvr-parking-rates.pdf (1 pages, 22 KB)."),
    F("Done — /home/dominic/Warden/yvr-parking-rates.pdf. Short version: prebook the economy lot online and it's $15.75 a day instead of $46.50 at the parkade.")))

save("s20-4.jsonl", rows)