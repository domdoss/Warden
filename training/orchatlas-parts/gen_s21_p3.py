import json, os
from gen_s21_p1 import (u, a, ev, nav, clk, typ, tabs, yt, v, dclick, dtype,
                         launch, tr, rows_to_jsonl, BASE)

def vul_start(vid):
    return tr("vulkan", "Vulkan %d started (urgent — its result will interrupt you when ready) — the result will arrive in your inbox when it finishes." % vid)

S3 = []

# --- 12 vulkan delegations ---

S3.append([
    u("yo why wont the price show on that watch page — https://watchzone.com/products/chrono-42 — can u grab it for me"),
    ev("document.querySelector('.price, [data-price]')?.textContent.trim() || 'no price text on page'"),
    tr("browser_evaluate", '"no price text on page"'),
    v("https://watchzone.com/products/chrono-42 — the price is drawn on a canvas so browser reads come back empty. Look at the page and report the exact price and whether it says in stock."),
    vul_start(41),
    a("The price is canvas-drawn so my reads come back empty — Vulkan's on it with eyes. I'll report back."),
])

S3.append([
    u("Get me through the sign-up form on https://webcomponents-showcase.dev/join — I can't get it to take input."),
    ev("window.__warden.queryAll('input').length + ' inputs reachable'"),
    tr("browser_evaluate", '"0 inputs reachable"'),
    v("https://webcomponents-showcase.dev/join — the join form lives inside a closed shadow root so its fields can't be read or typed into from here. Look at the form and report what fields it has, what each asks for, and whether the submit button is enabled."),
    vul_start(42),
    a("That form's sealed in a closed shadow root — no handle from here. Vulkan's on it; I'll get you through it once it maps the fields."),
])

S3.append([
    u("I've been at the grocery checkout for twenty minutes and the delivery slot calendar just spins forever. Is the slot picker broken for you too? https://grocer.example.com/checkout"),
    ev("(() => { const cal = document.querySelector('.slot-calendar'); return { hasCalendar: !!cal, busy: !!document.querySelector('[aria-busy=true], .spinner') } })()"),
    tr("browser_evaluate", '{"hasCalendar": true, "busy": true}'),
    v("https://grocer.example.com/checkout — the delivery slot calendar has been spinning for the user for twenty minutes and page reads show it empty. Check whether slots are visibly rendering on screen, and if so list which ones are open this week."),
    vul_start(43),
    a("From here the calendar's an empty div with the spinner still running. Vulkan's on it with eyes on the page — I'll tell you if it's broken or just slow."),
])

S3.append([
    u("kdenlives erroring on export again, theres some dialog on screen — what does it even say"),
    v("Kdenlive just failed an export and there's an error dialog on the user's screen that this seat can't see. Read the dialog and report exactly what it says and what buttons it offers."),
    vul_start(44),
    a("That dialog's a vision job from this seat — Vulkan's on it. I'll relay exactly what it says."),
])

S3.append([
    u("What's on my screen right now?"),
    v("The user wants to know what their screen is showing right now. Capture it and report: which windows are open, what the browser tab is showing, and anything that looks like it's waiting on them."),
    vul_start(45),
    a("I don't have eyes on this seat — Vulkan's capturing the screen now. I'll tell you what's up there when it reads."),
])

S3.append([
    u("I'm trying to figure out the drive to the airport for Friday, the route's already up in the maps tab... https://maps.google.com — but I can't make sense of what it's showing me."),
    ev("document.querySelector('.directions-trip-duration, [data-testid=trip-duration]')?.textContent.trim() || 'no readable duration'"),
    tr("browser_evaluate", '"no readable duration"'),
    v("https://maps.google.com in the Warden Chrome is showing a route to YVR, but the drive time is rendered on the map canvas so text reads come back empty. Read the screen and report the drive time and distance it's currently showing."),
    vul_start(46),
    a("The drive time's drawn on the map canvas — nothing I can read from here. Vulkan's on it; I'll have the time when it reads."),
])

S3.append([
    u("Get me past the captcha on the https://portal.example.gov login — I can't read mine."),
    ev("document.querySelector('input[name=captcha]') ? 'captcha input present' : 'no captcha field'"),
    tr("browser_evaluate", '"captcha input present"'),
    v("https://portal.example.gov login is blocked by an image captcha this seat can't read. Read the captcha visually and report the exact characters it shows; the rest of the form gets filled from here."),
    vul_start(47),
    a("That captcha needs eyes I don't have — Vulkan's reading it now. I'll relay the characters and finish the login myself."),
])

S3.append([
    u("whats the big number on that chart in the dashboard tab"),
    ev("document.querySelector('canvas') ? 'canvas present, no readable text' : 'no canvas'"),
    tr("browser_evaluate", '"canvas present, no readable text"'),
    v("The analytics dashboard tab in the Warden Chrome renders its headline chart on a canvas — no text for my reads. Look at it and report the big headline number it's showing and the timeframe label underneath."),
    vul_start(48),
    a("The chart's a canvas — nothing readable in the DOM. Vulkan's on it, number incoming."),
])

S3.append([
    u("The insurance site's plan comparison is one of those 3D widget things and I honestly can't tell what it wants me to pick. https://insurer.example.com/compare — can you make sense of it?"),
    ev("document.querySelector('.comparison-widget')?.innerText.slice(0, 120) || 'widget has no readable text'"),
    tr("browser_evaluate", '"widget has no readable text"'),
    v("https://insurer.example.com/compare — the plan comparison renders in a 3D widget with no readable text for this seat. Look at the page and report what it's asking the user to pick and what plans it's showing."),
    vul_start(49),
    a("That widget's a WebGL blob to my reads. Vulkan's on it with vision — I'll make sense of it when it reports back."),
])

S3.append([
    u("What does the strata bylaw PDF at https://marinaplacestrata.ca/bylaws.pdf say about pets?"),
    nav("https://marinaplacestrata.ca/bylaws.pdf"),
    tr("browser_navigate", 'Navigated to https://marinaplacestrata.ca/bylaws.pdf — "bylaws.pdf"'),
    ev("document.querySelector('text, .textLayer') ? 'text layer present' : 'no readable text layer'"),
    tr("browser_evaluate", '"no readable text layer"'),
    v("https://marinaplacestrata.ca/bylaws.pdf is open in Chrome's PDF viewer with no text layer this seat can read. Read the pets section and report what it allows and any registration rules."),
    vul_start(50),
    a("The PDF viewer gives me no text to read there. Vulkan's on it — I'll have the pets bylaw shortly."),
])

S3.append([
    u("the booking calendar on the squash site just looks totally blank to me — is it me or is it the site? https://squashbook.example.ca"),
    ev("document.querySelector('.calendar-grid')?.innerText.slice(0, 100) || 'calendar empty to reads'"),
    tr("browser_evaluate", '"calendar empty to reads"'),
    v("https://squashbook.example.ca — the court booking calendar reads empty from this seat, can't tell if it's broken or just rendering oddly. Check visually whether the calendar is rendering, and if so which evening slots are free this week."),
    vul_start(51),
    a("From my side it's an empty div — could be broken, could be fancy. Vulkan's on it with eyes; I'll let you know which."),
])

S3.append([
    u("I finally pushed the new landing page live for the cabin rental — https://cabin.example.ca. Does it actually look right? I can't tell from my phone whether the hero loaded."),
    ev("(() => { const imgs = Array.from(document.querySelectorAll('img')); const broken = imgs.filter(i => i.complete && i.naturalWidth === 0).length; return { heroLoaded: imgs[0] && imgs[0].complete && imgs[0].naturalWidth > 0, brokenImages: broken } })()"),
    tr("browser_evaluate", '{"heroLoaded": true, "brokenImages": 0}'),
    v("https://cabin.example.ca — the new landing page. My reads say all images load, but whether the page LOOKS right needs eyes. Look it over and report any visual problems: overlaps, squashed images, misaligned sections, broken layout."),
    vul_start(52),
    a("Images all load per my reads — the looks-right part needs eyes. Vulkan's on it, I'll report what it finds."),
])

# --- 5 desktop last-resort rows ---

S3.append([
    u("Export my blend file to glTF, please — the button's in the export dialog."),
    launch("blender"),
    tr("open_app", "Launched blender — window is up."),
    dtype(keys="ctrl+e"),
    tr("desktop_type", "Sent ctrl+e."),
    dclick(612, 745),
    tr("desktop_click", "Clicked at (612, 745)."),
    dclick(1120, 980),
    tr("desktop_click", "Clicked at (1120, 980)."),
    a("Export ran from the dialog — glTF saved."),
])

S3.append([
    u("just hit play on hades in steam for me"),
    launch("steam"),
    tr("open_app", "Launched steam — window is up."),
    dclick(1210, 970),
    tr("desktop_click", "Clicked at (1210, 970)."),
    a("Play button's hit — Hades should be launching now."),
])

S3.append([
    u("The monitor's been bugging my eyes tonight... can you flip the night light on? It's in the KDE settings, display section."),
    launch("systemsettings"),
    tr("open_app", "Launched systemsettings — window is up."),
    dclick(640, 120),
    tr("desktop_click", "Clicked at (640, 120)."),
    dtype(text="night color"),
    tr("desktop_type", 'Typed "night color".'),
    dclick(980, 420),
    tr("desktop_click", "Clicked at (980, 420)."),
    a("Night Color's on — give it a minute to warm up."),
])

S3.append([
    u("Discard the unsaved changes in GIMP — click Don't save."),
    dclick(705, 512),
    tr("desktop_click", "Clicked at (705, 512)."),
    a("Discarded — GIMP's closed out without saving."),
])

S3.append([
    u("export the audacity thing as mp3, i always fumble the menus"),
    launch("audacity"),
    tr("open_app", "Launched audacity — window is up."),
    dtype(keys="ctrl+shift+e"),
    tr("desktop_type", "Sent ctrl+shift+e."),
    dtype(text="/home/dominic/Warden/podcast.mp3"),
    tr("desktop_type", 'Typed "/home/dominic/Warden/podcast.mp3".'),
    dclick(1115, 985),
    tr("desktop_click", "Clicked at (1115, 985)."),
    a("Export's running — podcast.mp3 going into ~/Warden."),
])

# --- 8 mixed normal flows ending in evaluate verification ---

S3.append([
    u("Search the library site for Ursula K. Le Guin and tell me how many results are in."),
    nav("https://vpl.bibliocommons.com"),
    tr("browser_navigate", 'Navigated to https://vpl.bibliocommons.com — "Vancouver Public Library"'),
    ev("window.__warden.query('input[type=search]')?.placeholder || 'no search input'"),
    tr("browser_evaluate", '"Search the catalogue"'),
    typ("Search the catalogue field", "Ursula K. Le Guin", submit=True),
    tr("browser_type", 'Typed "Ursula K. Le Guin" into Search the catalogue field and pressed Enter — search results loaded.'),
    ev("document.querySelector('.results-count, .pagination-info')?.textContent.trim() || 'no count'"),
    tr("browser_evaluate", '"37 results"'),
    a("37 results in the catalogue."),
])

S3.append([
    u("check out with the card on file n gimme the order number"),
    ev("window.__warden.byText('Checkout') ? 'checkout button found' : 'not found'"),
    tr("browser_evaluate", '"checkout button found"'),
    clk("Checkout button"),
    tr("browser_click", "Clicked Checkout button"),
    ev("window.__warden.byText('Place order') ? 'place order found' : 'not found'"),
    tr("browser_evaluate", '"place order found"'),
    clk("Place order button"),
    tr("browser_click", "Clicked Place order button"),
    ev("document.querySelector('.order-number')?.textContent.trim() || 'no order number'"),
    tr("browser_evaluate", '"Order #99231"'),
    a("Order #99231 is in — confirmation's on screen."),
])

S3.append([
    u("That webinar I signed up for was supposed to come with the slides... it's the tab with the Vimeo embed. Can you grab them for me?"),
    tabs("list"),
    tr("browser_tabs", '4 tabs open:\n[0] Gmail\n[1] Vimeo — Q3 Strategy Webinar\n[2] YouTube — lofi hip hop radio (playing)\n[3] AllRecipes — best banana bread'),
    tabs("select", index=1),
    tr("browser_tabs", "Switched to tab 1 — Vimeo — Q3 Strategy Webinar."),
    ev("window.__warden.byText('Download slides') ? 'slides link found' : 'not found'"),
    tr("browser_evaluate", '"slides link found"'),
    clk("Download slides link"),
    tr("browser_click", "Clicked Download slides link"),
    ev("document.querySelector('.download-toast, .toast')?.textContent.trim() || 'no toast'"),
    tr("browser_evaluate", '"Downloading q3-strategy-slides.pdf"'),
    a("Grabbing them — q3-strategy-slides.pdf is downloading now."),
])

S3.append([
    u("Set the flour quantity to 3 and give me the new subtotal."),
    typ("Quantity input for flour", "3"),
    tr("browser_type", 'Typed "3" into Quantity input for flour'),
    ev("document.querySelector('.cart-subtotal')?.textContent.trim() || 'no subtotal'"),
    tr("browser_evaluate", '"Subtotal: $14.97"'),
    a("Three bags now — subtotal $14.97."),
])

S3.append([
    u("whats playing on yt rn"),
    yt("now_playing"),
    tr("youtube", "Now playing: lofi hip hop radio — beats to relax/study to — 1:12:45 of 3:06:00 (playing)."),
    a("Lofi hip hop radio, an hour twelve in, still playing."),
])

S3.append([
    u("Renew the book that's due in the library account and confirm it took."),
    ev("window.__warden.byText('Renew') ? 'renew button found' : 'not found'"),
    tr("browser_evaluate", '"renew button found"'),
    clk("Renew button"),
    tr("browser_click", "Clicked Renew button"),
    ev("document.querySelector('.loan-due')?.textContent.trim() || 'no due date'"),
    tr("browser_evaluate", '"Renewed — new due date Oct 2, 2026"'),
    a("Renewed — it's due Oct 2 now."),
])

S3.append([
    u("I think I left my email to the city half-written... the one about the bike lane on Cypress. It's in a compose tab somewhere — what's typed so far?"),
    tabs("list"),
    tr("browser_tabs", '3 tabs open:\n[0] Gmail — Compose (1)\n[1] YouTube — lofi hip hop radio (playing)\n[2] AllRecipes — best banana bread'),
    tabs("select", index=0),
    tr("browser_tabs", "Switched to tab 0 — Gmail — Compose (1)."),
    ev("(() => { const t = window.__warden.query('div[aria-label*=Body], textarea'); return t ? (t.value || t.innerText).slice(0, 300) : 'no compose body' })()"),
    tr("browser_evaluate", '"Hi there, the new bike lane on Cypress is a huge improvement for our family, but the paint is already fading at the Dunbar corner and cars..."'),
    a("You've got one line and change — it praises the Cypress bike lane, then stops mid-sentence about fading paint at Dunbar."),
])

S3.append([
    u("Turn on subtitles for the course video and confirm they're showing."),
    ev("window.__warden.byText('CC') ? 'cc button found' : 'not found'"),
    tr("browser_evaluate", '"cc button found"'),
    clk("CC subtitles button"),
    tr("browser_click", "Clicked CC subtitles button"),
    ev("(() => { const t = document.querySelector('video').textTracks[0]; return t ? t.mode : 'no track' })()"),
    tr("browser_evaluate", '"showing"'),
    a("Subtitles are on — track's showing."),
])

assert len(S3) == 25, len(S3)
open(os.path.join(BASE, 's21-3.jsonl'), 'w', encoding='utf-8').write(rows_to_jsonl(S3))
print("s21-3 written:", len(S3), "rows")