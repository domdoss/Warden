import json, os
from gen_s21_p1 import u, a, ev, nav, clk, typ, tabs, tr, rows_to_jsonl, BASE

S2 = []

S2.append([
    u("Clear that cookie banner so I can actually read the page."),
    ev("window.__warden.byText('Accept all') ? 'accept button found' : 'not found'"),
    tr("browser_evaluate", '"accept button found"'),
    clk("Accept all cookies button"),
    tr("browser_click", "Clicked Accept all cookies button"),
    ev("document.querySelector('#cookie-banner, .cookie-banner') ? 'banner still up' : 'banner gone'"),
    tr("browser_evaluate", '"banner gone"'),
    a("Banner's cleared — page's readable now."),
])

S2.append([
    u("add the blue kettle to my cart pls"),
    ev("window.__warden.byText('Add to cart') ? 'add-to-cart found' : 'not found'"),
    tr("browser_evaluate", '"add-to-cart found"'),
    clk("Add to cart button"),
    tr("browser_click", "Clicked Add to cart button"),
    ev("document.querySelector('#cart-count')?.textContent.trim() || 'no cart count'"),
    tr("browser_evaluate", '"2"'),
    a("In the cart — count's showing 2 now."),
])

S2.append([
    u("Search the MEC site for a 40 litre hiking backpack."),
    nav("https://mec.ca"),
    tr("browser_navigate", 'Navigated to https://mec.ca — "MEC"'),
    ev("window.__warden.query('input[type=search], input[aria-label=Search]')?.placeholder || 'no search input'"),
    tr("browser_evaluate", '"Search products"'),
    typ("Search products field", "40 litre hiking backpack", submit=True),
    tr("browser_type", 'Typed "40 litre hiking backpack" into Search products field and pressed Enter — the page did not navigate; the real search runs from a button. Find it with evaluate.'),
    ev("window.__warden.byText('Search') ? 'search button found' : 'no search button'"),
    tr("browser_evaluate", '"search button found"'),
    clk("Search button"),
    tr("browser_click", "Clicked Search button"),
    ev("document.querySelectorAll('.product-card').length + ' products'"),
    tr("browser_evaluate", '"24 products"'),
    a("Search ran — 24 backpacks came back. Want the top few listed?"),
])

S2.append([
    u("I need to get into my library account to renew the book that's due tomorrow... it's https://vpl.bibliocommons.com, card 24098, PIN 4417. Log me in?"),
    nav("https://vpl.bibliocommons.com"),
    tr("browser_navigate", 'Navigated to https://vpl.bibliocommons.com — "Vancouver Public Library"'),
    ev("(() => ({ card: !!window.__warden.query('input[name=card_number]'), pin: !!window.__warden.query('input[name=pin]'), submit: !!window.__warden.byText('Log In') }))()"),
    tr("browser_evaluate", '{"card": true, "pin": true, "submit": true}'),
    typ("Card number field", "24098"),
    tr("browser_type", 'Typed "24098" into Card number field'),
    typ("PIN field", "4417"),
    tr("browser_type", 'Typed "4417" into PIN field'),
    clk("Log In button"),
    tr("browser_click", "Clicked Log In button"),
    ev("document.querySelector('.loggedin-welcome, .my-account')?.textContent.trim() || 'not logged in'"),
    tr("browser_evaluate", '"Welcome back, Dominic"'),
    a("You're in, Dominic — want me to renew that due book while I'm here?"),
])

S2.append([
    u("Sign me up for the store newsletter with dom@example.com."),
    ev("window.__warden.byText('Subscribe') ? 'subscribe button found' : 'not found'"),
    tr("browser_evaluate", '"subscribe button found"'),
    typ("Newsletter email field", "dom@example.com"),
    tr("browser_type", 'Typed "dom@example.com" into Newsletter email field'),
    clk("Subscribe button"),
    tr("browser_click", "Clicked Subscribe button"),
    ev("document.querySelector('.newsletter-success, .subscribe-confirm')?.textContent.trim() || 'no confirmation'"),
    tr("browser_evaluate", '"Thanks — you\'re on the list!"'),
    a("You're on the list — confirmation's showing."),
])

S2.append([
    u("theres like 3 youtube tabs open again, close the dupes"),
    tabs("list"),
    tr("browser_tabs", '3 tabs open:\n[0] YouTube — lofi hip hop radio (playing)\n[1] YouTube — lofi hip hop radio\n[2] Gmail'),
    tabs("close", index=1),
    tr("browser_tabs", "Closed tab 1."),
    a("Closed the duplicate — lofi's still playing in the one tab, Gmail untouched."),
])

S2.append([
    u("There's a review on the tent page that's cut off behind a Read more link — it's the one about waterproofing in the rain. Open it and tell me what it says?"),
    ev("window.__warden.byText('Read more') ? 'read more found' : 'not found'"),
    tr("browser_evaluate", '"read more found"'),
    clk("Read more link on the waterproofing review"),
    tr("browser_click", "Clicked Read more link on the waterproofing review"),
    ev("document.querySelector('.review-full, .review-expanded')?.textContent.trim().slice(0, 300) || 'not expanded'"),
    tr("browser_evaluate", '"Took it out in three days of steady West Coast rain and the floor stayed bone dry. Only gripe: the zipper flap wicks a bit after a full day of downpour."'),
    a("Good news — three days of steady rain and the floor stayed dry; only gripe is the zipper flap wicking in an all-day downpour."),
])

S2.append([
    u("Filter the results to under $25 and tell me how many are left."),
    ev("window.__warden.byText('Under $25') ? 'filter found' : 'not found'"),
    tr("browser_evaluate", '"filter found"'),
    clk("Under $25 filter chip"),
    tr("browser_click", "Clicked Under $25 filter chip"),
    ev("document.querySelector('.result-count')?.textContent.trim() || document.querySelectorAll('.product-card').length + ' products'"),
    tr("browser_evaluate", '"18 results"'),
    a("18 left under $25."),
])

S2.append([
    u("bump the kettle in my cart to qty 2"),
    typ("Quantity input for the Bodum kettle", "2"),
    tr("browser_type", 'Typed "2" into Quantity input for the Bodum kettle'),
    ev("document.querySelector('.cart-total')?.textContent.trim() || 'no total'"),
    tr("browser_evaluate", '"Total: $118.98"'),
    a("Done — two kettles, total's now $118.98."),
])

S2.append([
    u("Pick size M in the tee and add it to the cart."),
    ev("window.__warden.queryAll('.size-button').map(b => b.textContent.trim()).join(' | ')"),
    tr("browser_evaluate", '"XS | S | M | L | XL"'),
    clk("Size M button"),
    tr("browser_click", "Clicked Size M button"),
    clk("Add to cart button"),
    tr("browser_click", "Clicked Add to cart button"),
    ev("document.querySelector('#cart-count')?.textContent.trim() || 'no cart count'"),
    tr("browser_evaluate", '"1"'),
    a("Size M is in the cart — count's at 1."),
])

S2.append([
    u("Before I head to bed — actually, can you log me out of the bank tab? It's the one that's up now, I don't want it sitting signed in overnight."),
    ev("window.__warden.byText('Log Out') ? 'logout found' : 'not found'"),
    tr("browser_evaluate", '"logout found"'),
    clk("Log Out button"),
    tr("browser_click", "Clicked Log Out button"),
    ev("window.__warden.byText('Log In') ? 'logged out' : 'still logged in'"),
    tr("browser_evaluate", '"logged out"'),
    a("Logged out — the sign-in screen's showing now."),
])

S2.append([
    u("Apply SAVE15 at checkout and give me the new total."),
    typ("Promo code field", "SAVE15"),
    tr("browser_type", 'Typed "SAVE15" into Promo code field'),
    ev("window.__warden.byText('Apply') ? 'apply button found' : 'not found'"),
    tr("browser_evaluate", '"apply button found"'),
    clk("Apply promo code button"),
    tr("browser_click", "Clicked Apply promo code button"),
    ev("(() => ({ discount: document.querySelector('.discount-row')?.textContent.trim(), total: document.querySelector('.order-total')?.textContent.trim() }))()"),
    tr("browser_evaluate", '{"discount": "SAVE15 — -$13.50", "total": "$76.49"}'),
    a("SAVE15 took $13.50 off — new total $76.49."),
])

S2.append([
    u("take the coffee filters outta my cart"),
    ev("window.__warden.byText('Remove') ? 'remove link found' : 'not found'"),
    tr("browser_evaluate", '"remove link found"'),
    clk("Remove link for Coffee Filters (100)"),
    tr("browser_click", "Clicked Remove link for Coffee Filters (100)"),
    ev("(() => { const names = Array.from(document.querySelectorAll('.cart-item-name')).map(e => e.textContent.trim()); return { count: names.length, items: names } })()"),
    tr("browser_evaluate", '{"count": 1, "items": ["Bodum Kettle"]}'),
    a("Filters are out — just the kettle left in there."),
])

S2.append([
    u("The docs site for that API is a maze, I can never find anything... https://docs.example.com/api. Search it for webhooks and find me the auth page?"),
    nav("https://docs.example.com/api"),
    tr("browser_navigate", 'Navigated to https://docs.example.com/api — "Example API Docs"'),
    ev("window.__warden.query('input[type=search], input[placeholder*=Search]')?.placeholder || 'no search input'"),
    tr("browser_evaluate", '"Search the docs"'),
    typ("Search the docs field", "webhooks", submit=True),
    tr("browser_type", 'Typed "webhooks" into Search the docs field and pressed Enter — the page did not navigate; the real search runs from a button. Find it with evaluate.'),
    ev("window.__warden.byText('Search') ? 'search button found' : 'no search button'"),
    tr("browser_evaluate", '"search button found"'),
    clk("Search button"),
    tr("browser_click", "Clicked Search button"),
    ev("window.__warden.queryAll('.search-result a').slice(0, 4).map(a => a.textContent.trim()).join(' || ')"),
    tr("browser_evaluate", '"Webhook authentication || Webhook payload reference || Webhook retries and failures || Getting started with webhooks"'),
    a("Found it — top result is Webhook authentication, plus payload reference and retries pages."),
])

S2.append([
    u("Reject the cookies — non-essential only, whatever the button says."),
    ev("(() => ({ reject: !!window.__warden.byText('Reject'), manage: !!window.__warden.byText('Manage') }))()"),
    tr("browser_evaluate", '{"reject": true, "manage": true}'),
    clk("Reject non-essential cookies button"),
    tr("browser_click", "Clicked Reject non-essential cookies button"),
    ev("document.querySelector('.cookie-banner, #cookie-banner') ? 'banner still up' : 'banner gone'"),
    tr("browser_evaluate", '"banner gone"'),
    a("Rejected and the banner's gone."),
])

S2.append([
    u("mute the vid on this page pls"),
    ev("(() => { const v = document.querySelector('video'); if (!v) return 'no video'; v.muted = true; return v.muted })()"),
    tr("browser_evaluate", "true"),
    a("Muted."),
])

S2.append([
    u("The shipping options on this checkout keep confusing me and I need that ladder by Friday... pick me the fastest one?"),
    ev("window.__warden.queryAll('.shipping-option .option-name').map(e => e.textContent.trim()).join(' || ')"),
    tr("browser_evaluate", '"Standard (4–7 business days) || Express (2 business days) || Overnight"'),
    clk("Express shipping option radio"),
    tr("browser_click", "Clicked Express shipping option radio"),
    ev("document.querySelector('.shipping-option.selected .option-name')?.textContent.trim() || 'none selected'"),
    tr("browser_evaluate", '"Express (2 business days)"'),
    a("Express is selected — 2 business days, so it lands Thursday, inside your Friday."),
])

S2.append([
    u("Download the spec sheet off the ladder page."),
    ev("window.__warden.byText('Spec Sheet') ? 'spec sheet link found' : 'not found'"),
    tr("browser_evaluate", '"spec sheet link found"'),
    clk("Spec Sheet PDF link"),
    tr("browser_click", "Clicked Spec Sheet PDF link"),
    ev("document.querySelector('.toast, .download-toast')?.textContent.trim() || 'no download toast'"),
    tr("browser_evaluate", '"Downloading spec-sheet.pdf"'),
    a("Downloading — spec-sheet.pdf is on its way."),
])

S2.append([
    u("switch me to the recipe tab, the banana bread one"),
    tabs("list"),
    tr("browser_tabs", '3 tabs open:\n[0] Gmail\n[1] AllRecipes — best banana bread\n[2] YouTube — lofi hip hop radio (playing)'),
    tabs("select", index=1),
    tr("browser_tabs", "Switched to tab 1 — AllRecipes — best banana bread."),
    a("You're on the banana bread recipe now."),
])

S2.append([
    u("I want to reply to that espresso thread on the coffee forum before I lose my train of thought... you'll have to log me in first — forums.coffeenuts.com, username domdoss, password Espresso2024."),
    nav("https://forums.coffeenuts.com/login"),
    tr("browser_navigate", 'Navigated to https://forums.coffeenuts.com/login — "Log In — Coffee Nuts"'),
    ev("(() => ({ user: !!window.__warden.query('input[name=username]'), pass: !!window.__warden.query('input[type=password]'), submit: !!window.__warden.byText('Log in') }))()"),
    tr("browser_evaluate", '{"user": true, "pass": true, "submit": true}'),
    typ("Username field", "domdoss"),
    tr("browser_type", 'Typed "domdoss" into Username field'),
    typ("Password field", "Espresso2024"),
    tr("browser_type", 'Typed "Espresso2024" into Password field'),
    clk("Log in button"),
    tr("browser_click", "Clicked Log in button"),
    ev("document.querySelector('.user-menu .username')?.textContent.trim() || 'not logged in'"),
    tr("browser_evaluate", '"domdoss"'),
    a("You're logged in as domdoss — the thread's up whenever you want to reply."),
])

S2.append([
    u("Book the 3pm Thursday slot on the pickleball booking page."),
    ev("window.__warden.queryAll('.slot-btn:not([disabled])').map(b => b.textContent.trim()).slice(0, 8).join(' | ')"),
    tr("browser_evaluate", '"Thu 1:00 PM | Thu 2:00 PM | Thu 3:00 PM | Thu 4:00 PM"'),
    clk("Thu 3:00 PM slot button"),
    tr("browser_click", "Clicked Thu 3:00 PM slot button"),
    ev("document.querySelector('.booking-confirm')?.textContent.trim() || 'not confirmed'"),
    tr("browser_evaluate", '"Booked: Thursday 3:00 PM — Court 2"'),
    a("Booked — Thursday 3 PM on Court 2."),
])

S2.append([
    u("search ebay for vintage pyrex bowls, see whats out there"),
    nav("https://ebay.ca"),
    tr("browser_navigate", 'Navigated to https://ebay.ca — "eBay"'),
    typ("Search field", "vintage pyrex bowls", submit=True),
    tr("browser_type", 'Typed "vintage pyrex bowls" into Search field and pressed Enter — search results loaded.'),
    ev("window.__warden.queryAll('.s-item__title').slice(0, 5).map(e => e.textContent.trim()).join(' || ')"),
    tr("browser_evaluate", '"Vintage Pyrex 470 Bowl Set of 4 || Vintage Pyrex Spring Blossom Mixing Bowls || Vintage Pyrex Primary Colors Bowl Set || Vintage Pyrex Snowflake Cinderella Bowls"'),
    a("Lots out there — Spring Blossom, Primary Colors and Snowflake bowl sets are the top ones."),
])

S2.append([
    u("Change the grocery pickup to Saturday and confirm it stuck."),
    ev("window.__warden.query('input[name=pickup_date]')?.value || 'no date field'"),
    tr("browser_evaluate", '"2026-09-18"'),
    clk("Pickup date field"),
    tr("browser_click", "Clicked Pickup date field"),
    ev("window.__warden.byText('Sat, Sep 20') ? 'saturday option found' : 'not found'"),
    tr("browser_evaluate", '"saturday option found"'),
    clk("Sat Sep 20 date option"),
    tr("browser_click", "Clicked Sat Sep 20 date option"),
    ev("document.querySelector('.selected-date')?.textContent.trim() || document.querySelector('input[name=pickup_date]')?.value || 'not set'"),
    tr("browser_evaluate", '"Sat, Sep 20"'),
    a("Pickup's moved to Saturday Sep 20 — page confirms it."),
])

S2.append([
    u("hit notify me on that sold out board game"),
    ev("window.__warden.byText('Notify Me') ? 'notify button found' : 'not found'"),
    tr("browser_evaluate", '"notify button found"'),
    clk("Notify Me button"),
    tr("browser_click", "Clicked Notify Me button"),
    ev("document.querySelector('.notify-confirm, .alert-success')?.textContent.trim() || 'no confirmation'"),
    tr("browser_evaluate", '"You\'ll get an email when this item is back in stock."'),
    a("Done — they'll email you when it's back."),
])

S2.append([
    u("I don't trust the top reviews on the mattress page, they all read like plants. Sort them by most recent and tell me what the newest one actually says."),
    ev("window.__warden.byText('Most Recent') ? 'sort option found' : 'not found'"),
    tr("browser_evaluate", '"sort option found"'),
    clk("Most Recent sort option"),
    tr("browser_click", "Clicked Most Recent sort option"),
    ev("document.querySelector('.review .review-body')?.textContent.trim().slice(0, 250) || 'no review text'"),
    tr("browser_evaluate", '"Two months in: still firm, no sag, and it sleeps cool like they claim. Delivery guys were 3 hours late though."'),
    a("Newest one's solid — two months in, still firm and sleeps cool; only complaint was late delivery."),
])

assert len(S2) == 25, len(S2)
open(os.path.join(BASE, 's21-2.jsonl'), 'w', encoding='utf-8').write(rows_to_jsonl(S2))
print("s21-2 written:", len(S2), "rows")