import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, '_sys.txt'), encoding='utf-8').read()
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"
CID = [0]

def _cid():
    CID[0] += 1
    return "call_%d" % CID[0]

def u(ask):
    return {"role": "user", "content": ANCHOR + ask}

def a(text):
    return {"role": "assistant", "content": text}

def tc(name, args, text=None):
    m = {"role": "assistant"}
    if text:
        m["content"] = text
    m["tool_calls"] = [{"id": _cid(), "type": "function",
                        "function": {"name": name, "arguments": args}}]
    return m

def tr(name, content):
    return {"role": "tool", "tool_call_id": "call_%d" % CID[0], "name": name, "content": content}

def ev(js):
    return tc("browser_evaluate", {"js": js})

def nav(url):
    return tc("browser_navigate", {"url": url})

def clk(ref):
    return tc("browser_click", {"ref": ref})

def typ(ref, text, submit=False):
    args = {"ref": ref, "text": text}
    if submit:
        args["submit"] = True
    return tc("browser_type", args)

def v(task):
    return tc("vulkan", {"task": task, "urgent": True})

def tabs(action, index=None):
    args = {"action": action}
    if index is not None:
        args["index"] = index
    return tc("browser_tabs", args)

def yt(action, **kw):
    args = {"action": action}
    args.update(kw)
    return tc("youtube", args)

def dclick(x, y):
    return tc("desktop_click", {"x": x, "y": y})

def dtype(text=None, keys=None):
    args = {}
    if text is not None:
        args["text"] = text
    if keys is not None:
        args["keys"] = keys
    return tc("desktop_type", args)

def launch(app):
    return tc("open_app", {"app": app})

def cur():
    return tc("browser_current_url", {})

def rows_to_jsonl(rows):
    out = []
    for msgs in rows:
        out.append(json.dumps({"messages": [{"role": "system", "content": SYS}] + msgs},
                               ensure_ascii=False))
    return "\n".join(out) + "\n"


# ---------------- s21-1: browser_evaluate reads ----------------

S1 = []

S1.append([
    u("yo wats the price on that bookshelf page im lookin at"),
    ev("document.querySelector('.price')?.textContent.trim() || 'no price found'"),
    tr("browser_evaluate", '"$18.99"'),
    a("It's $18.99 — the Classic Ladder Bookshelf on that page."),
])

S1.append([
    u("How many items are in my cart right now?"),
    ev("document.querySelector('#cart-count')?.textContent.trim() || 'no cart element'"),
    tr("browser_evaluate", '"3"'),
    a("3 items in the cart."),
])

S1.append([
    u("did my order go thru or did the page eat it lol"),
    ev("document.querySelector('.order-confirmation')?.textContent.trim() || 'no confirmation on page'"),
    tr("browser_evaluate", '"Order #78421 confirmed — receipt emailed to dom@example.com"'),
    a("It went through — Order #78421 confirmed, receipt emailed to you."),
])

S1.append([
    u("I was halfway through that article you opened about caffeine and sleep before I had to run this morning. Give me the gist?"),
    ev("Array.from(document.querySelectorAll('article p')).slice(0, 2).map(p => p.textContent.trim()).join(' ')"),
    tr("browser_evaluate", '"Caffeine\'s half-life runs five to six hours, so an afternoon cup is still working at bedtime. The study tracked 2,000 sleepers and found late-afternoon caffeine cut deep sleep by about 20 percent without people noticing."'),
    a("Gist: afternoon caffeine is still half-active at bedtime and quietly cuts deep sleep by about 20%. Morning coffee is the safe zone."),
])

S1.append([
    u("What email is typed into the contact form on this page?"),
    ev("document.querySelector('input[type=email]')?.value || 'no email field'"),
    tr("browser_evaluate", '"dominic@example.com"'),
    a("dominic@example.com is what's in the email field."),
])

S1.append([
    u("is the video on this page paused or nah"),
    ev("(() => { const v = document.querySelector('video'); return v ? { paused: v.paused, seconds: Math.round(v.currentTime) } : 'no video' })()"),
    tr("browser_evaluate", '{"paused": true, "seconds": 42}'),
    a("Paused, 42 seconds in."),
])

S1.append([
    u("What's the Jarvis standing desk going for? https://fully.com/desks/jarvis-standing-desk"),
    nav("https://fully.com/desks/jarvis-standing-desk"),
    tr("browser_navigate", 'Navigated to https://fully.com/desks/jarvis-standing-desk — "Jarvis Standing Desk | Fully"'),
    ev("document.querySelector('.product-price')?.textContent.trim() || 'no price found'"),
    tr("browser_evaluate", '"$599.00"'),
    a("$599.00 on Fully's page."),
])

S1.append([
    u("Grandma keeps asking when that foot spa would actually get to her... can you check https://shop.example.com/foot-spa and see what delivery they're quoting?"),
    nav("https://shop.example.com/foot-spa"),
    tr("browser_navigate", 'Navigated to https://shop.example.com/foot-spa — "Hydro Foot Spa"'),
    ev("document.querySelector('.delivery-estimate')?.textContent.trim() || 'no delivery estimate'"),
    tr("browser_evaluate", '"Delivery: Oct 2 – Oct 5 (Vancouver, BC)"'),
    a("Delivery to Vancouver is Oct 2–5 — about two weeks out."),
])

S1.append([
    u("wuts the damage on my cart — total incl shipping"),
    ev("(() => ({ subtotal: document.querySelector('.cart-subtotal')?.textContent.trim(), shipping: document.querySelector('.cart-shipping')?.textContent.trim(), total: document.querySelector('.cart-total')?.textContent.trim() }))()"),
    tr("browser_evaluate", '{"subtotal": "$118.98", "shipping": "Free", "total": "$118.98"}'),
    a("Total's $118.98 — and shipping's free."),
])

S1.append([
    u("I just hit place order. Did it land?"),
    ev("document.querySelector('.checkout-success')?.textContent.trim() || 'no confirmation yet'"),
    tr("browser_evaluate", '"Thank you! Order #41288 is confirmed. Estimated delivery Oct 1."'),
    a("Landed — Order #41288 confirmed, delivery estimated Oct 1."),
])

S1.append([
    u("I clicked add to cart on the kettle a while back, kept getting sidetracked... did it actually end up in there?"),
    ev("(() => { const items = Array.from(document.querySelectorAll('.cart-item-name')).map(e => e.textContent.trim()); return { count: items.length, items: items } })()"),
    tr("browser_evaluate", '{"count": 2, "items": ["Bodum Kettle", "Coffee Filters (100)"]}'),
    a("It's in — the kettle plus a box of filters, 2 items total."),
])

S1.append([
    u("does the page say that board game is in stock"),
    ev("document.querySelector('.availability')?.textContent.trim() || 'no availability text'"),
    tr("browser_evaluate", '"Out of stock — back Oct 12"'),
    a("No — it says out of stock, back Oct 12."),
])

S1.append([
    u("Did the FALL10 coupon actually apply at checkout?"),
    ev("document.querySelector('.discount-row, .promo-applied')?.textContent.trim() || 'no discount shown'"),
    tr("browser_evaluate", '"FALL10 applied — you saved $6.20"'),
    a("Applied — saved you $6.20."),
])

S1.append([
    u("I'm after a replacement lid for the OXO pop container — the round one, got cracked in the move. Can you search their site and see what comes up?"),
    nav("https://oxo.com/search?q=pop+container+lid"),
    tr("browser_navigate", 'Navigated to https://oxo.com/search?q=pop+container+lid — "Search | OXO"'),
    ev("window.__warden.queryAll('.product-card h3').slice(0, 5).map(e => e.textContent.trim()).join(' || ')"),
    tr("browser_evaluate", '"OXO POP Container Lid — Small || OXO POP Container Lid — Medium || OXO POP Container Lid — Large || OXO POP Container Lid — Round"'),
    a("Four lids came back — small, medium, large, and the round one you want."),
])

S1.append([
    u("the price on that jacket page wont show for me, can u grab it"),
    ev("window.__warden.query('span[data-price]')?.textContent.trim() || window.__warden.query('.price')?.textContent.trim() || 'no price found'"),
    tr("browser_evaluate", '"$189.00"'),
    a("It's there — $189.00, just buried in a web component so the page render hides it."),
])

S1.append([
    u("How far into the webinar recording is the playback?"),
    ev("(() => { const v = document.querySelector('video'); return v ? { at: Math.round(v.currentTime), of: Math.round(v.duration), paused: v.paused } : 'no video' })()"),
    tr("browser_evaluate", '{"at": 1140, "of": 3600, "paused": false}'),
    a("19 minutes in of an hour, still playing."),
])

S1.append([
    u("what rating does that udemy course have"),
    ev("document.querySelector('[data-testid=rating-text], .star-rating-text')?.textContent.trim() || 'no rating found'"),
    tr("browser_evaluate", '"4.6 instructor rating (12,431 reviews)"'),
    a("4.6 from 12,431 reviews."),
])

S1.append([
    u("The strata put up a new notice about the parking and I skimmed it on my way out... what was it saying? Tab's probably still open."),
    ev("document.querySelector('.notice-body')?.textContent.trim() || document.querySelector('article')?.innerText.slice(0, 300) || 'no notice found'"),
    tr("browser_evaluate", '"Visitor stall 12 will be repaved Mon Sep 22 – Wed Sep 24. During the work, visitors may use stall 3 or street parking. Garage fobs are unaffected."'),
    a("They're repaving visitor stall 12 Sept 22–24 — visitors get stall 3 or street parking, and garage fobs are fine."),
])

S1.append([
    u("What's selected in the country dropdown on the shipping form?"),
    ev("document.querySelector('select#country')?.value || 'no country select'"),
    tr("browser_evaluate", '"CA"'),
    a("Canada's selected."),
])

S1.append([
    u("I keep meaning to check this — on the transit fares page https://translink.ca/fares, what's the off-peak fare for a two-zone trip these days?"),
    nav("https://translink.ca/fares"),
    tr("browser_navigate", 'Navigated to https://translink.ca/fares — "Fares | TransLink"'),
    ev("document.querySelector('table')?.rows[3]?.innerText.replace(/\\s+/g, ' ').trim() || 'fare table not found'"),
    tr("browser_evaluate", '"Zone 2 Off-peak $3.10 · On-peak $4.60"'),
    a("Off-peak two-zone is $3.10 — on-peak would be $4.60."),
])

S1.append([
    u("am i still on the checkout page or did it kick me back out"),
    cur(),
    tr("browser_current_url", 'https://shop.example.com/checkout — "Checkout | ExampleShop"'),
    a("Still on checkout, all good."),
])

S1.append([
    u("Is the buy button greyed out on that concert page?"),
    ev("document.querySelector('button[data-testid=buy-now]')?.disabled ?? 'no buy button'"),
    tr("browser_evaluate", "true"),
    a("Yes, it's disabled — that showing's likely sold out."),
])

S1.append([
    u("Before I bother going back to that coffee site — is the flash sale banner still running? I saw it Tuesday and keep forgetting to use the code."),
    ev("document.querySelector('.promo-banner, #sale-banner')?.textContent.trim() || 'no banner'"),
    tr("browser_evaluate", '"Flash sale ends tonight! 20% off with code FLASH20"'),
    a("Still up, but it ends tonight — 20% off with FLASH20. Now's the moment."),
])

S1.append([
    u("What's the same monitor going for on Best Buy? https://bestbuy.ca/catalog/lg-27-ips-105123"),
    nav("https://bestbuy.ca/catalog/lg-27-ips-105123"),
    tr("browser_navigate", 'Navigated to https://bestbuy.ca/catalog/lg-27-ips-105123 — "LG 27-inch IPS Monitor | Best Buy"'),
    ev("document.querySelector('.product-price')?.textContent.trim() || 'no price found'"),
    tr("browser_evaluate", '"$429.99"'),
    a("$429.99 over there."),
])

S1.append([
    u("how many results come up if u search wireless mouse on the site im on"),
    ev("document.querySelector('.results-count')?.textContent.trim() || 'no results count'"),
    tr("browser_evaluate", '"1,247 results"'),
    a("1,247 results — plenty to dig through."),
])

assert len(S1) == 25, len(S1)
open(os.path.join(BASE, 's21-1.jsonl'), 'w', encoding='utf-8').write(rows_to_jsonl(S1))
print("s21-1 written:", len(S1), "rows")