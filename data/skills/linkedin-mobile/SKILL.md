---
name: linkedin-phone
description: Drive LinkedIn on the Android phone with a text-only driver script — reply to people who commented on our posts first (never to agreement), accept connection requests, then one scored search per cycle (like good posts, comment only at 7/10+), publish hourly. Verify everything in the UI dump.
---

# LinkedIn on the phone — driver script + model judgment

The model supplies **judgment only**: whether an inbound comment deserves a reply, which
candidates to like, and the text of replies/comments.
Everything mechanical (search, scroll, tap, type, send, verify) is done by one script.

```bash
SKILL=/home/user/your-project/.opencode/skills/linkedin-phone
E=$SKILL/scripts/engage.sh
```

`aab` and `adb` must be on `PATH` (the script adds the standard locations itself).
The script auto-detects the connected phone on every run. **Never hardcode `SERIAL=`**
and never reuse an old IP — wireless-debug serials change when the phone reboots, and a
stale serial makes every command fail.

**There are no screenshots in this procedure.** The local models are text-only, and
`aab ui` is the source of truth. Never propose "take a screenshot and look at it" —
the model cannot see it.

## The cycle (repeat continuously)

**Inbound first, then outbound.** People who wrote to us come before any new search,
because replying is the whole point and the comment budget is scarce.

```bash
bash $E replies                    # who commented on our post / replied to us
bash $E openreply 1                # open one, read the comment, get a decision
bash $E reply - <<'TXT'            # (only if DECISION: REPLY)
your reply here
TXT
bash $E invites                    # pending connection requests
bash $E invites accept             # accept up to 3

bash $E due                        # post reminder: POST_DUE or NOT_DUE (in Nm)
bash $E publish "<text>"           # only when due printed POST_DUE

bash $E ready                      # READY tab_feed=N, else dismiss whatever is on screen
bash $E plan                       # search + candidate table + score decision
```

### Replying to people

`replies` prints `1 | comment | Kelsey T.` / `1 | reply | Dr William Chen`. `openreply <i>`
opens that thread (or pass the author, `openreply "Kelsey T."`, which survives the list
reordering) and prints:

```
OPENED: Kelsey T. (comment)
COMMENT: <what they actually said>
SCORE: 7/10 <reason>
DECISION: REPLY
```

- Act only on the decision. `DECISION: NO_REPLY` means leave it — like and move on.
- **Never reply to agreement or praise.** "Completely agree", "well said", "great post",
  "spot on", or a restatement of the same point is not engagement and scores 0-3.
  **Length does not change this** — a long, eloquent agreement is still agreement; leave it.
- Reply when they **add something**: a new point, a counterpoint, a concrete experience,
  a named case, a number, or a question. Roll with that.
  Reply only when there is a question, a specific claim to answer, a correction, or a
  real experience worth acknowledging.
- Never reply twice to the same person. Skip spam, pitches, recruiters and hostility.
- `reply` always threads **under that person's comment**. If it cannot find their
  Reply button it prints `NO_REPLY_BUTTON` and posts nothing — it never falls back to
  a new top-level comment on the post.
- Answer the specific point; no pitch, no product mention, no emoji, no invented facts.
- Never invent facts about the business: no numbers, client names, certifications, or
  claims about "our infrastructure" you cannot verify. Speak to principles and tradeoffs
  instead of fabricating specifics.
- `DRY=1 bash $E reply "..."` types the reply and backs out without sending (for testing).

### Connection requests

`invites` prints how many are pending; `invites accept` taps Accept on each (capped at 15
per cycle) and re-checks the screen after every tap. It never cold-connects anyone — this
only accepts people who asked to connect.

Run `open` with **no argument**. Never pass a topic by hand — the script pulls the next
unused one from the ledger and refuses a query that was already worked (`ALREADY_USED`).

`open` prints a table like:

```
TOPIC: confidentiality chatbot law firm (scrolled 6, settle)
CANDIDATES (only rows fully on screen):
1 | no reaction | likes=2 | Most law firms install a generic AI chatbot and expect it to handle client intake...
2 | no reaction | likes=? | Law firms and businesses handling confidential client information: please think before...
3 | no reaction | likes=? | A UK Tribunal Called ChatGPT Open-Source and Said Typing Into It Waives Privilege...
```

Then:

```bash
# pass EVERY candidate you rate as good (up to six). The script likes a random
# 1-5 of them per cycle - sometimes one, sometimes five - so the pattern is not
# a fixed three every time.
bash $E like 1 3 4 2 6

# comment: pass the text on stdin with a quoted heredoc so apostrophes/quotes
# in your writing can never break the shell command
bash $E comment 2 - <<'TXT'
Your post-specific, specific comment here.
TXT
```

Pass all the rows you consider good content. The script chooses a random 1–5 of them to
actually like, verifies each, and prints `like volume: N of M target`. Never ask for an
index that is not in the table (`NO_ROW` means it does not exist on screen).

Then the cycle is **over**. The next cycle calls `open` again, which picks the next unused
topic from the ledger and opens a brand-new search. **One search per cycle, always.**
Never like more on a result set that has already been worked, and never return to a topic
already in the ledger.

## Pacing (never fight the budget)

Every action is counted in `data/limits.json` and capped per local day: **8 comments,
15 replies, 15 likes, 10 invitations**, at most **3 invitations accepted per cycle**.
Outside 07:00-23:00 **every** command prints `QUIET_HOURS` and does nothing — that is
correct: call `done` and stop. When a cap is reached it prints `CAP <kind> n/max` and
refuses; never retry or work around it.

```bash
python3 $SKILL/scripts/limits.py status   # today's counters
```

The goal is to look like a person who uses LinkedIn a little, not a machine that
posts all day.

## Reading the table

`index | like-state | reaction count | body snippet`

- Only rows **fully on screen** are listed. If a row is not listed, it cannot be liked —
  do not ask for its index, do not "nudge" it.
- `no reaction` means likeable; `Like` means already liked (skip it).
- Choose three posts that are **actually good content** — a real argument, a concrete
  detail, something written by a professional. Skip ads, vendor pitches ("COO @ …",
  "Brand partnership"), recruiters, reposts without commentary, and anything you would
  not read voluntarily.
- Choose **one** of the listed posts for the comment: the most specific, contested or
  useful claim on the page, not simply the first row — **but only if it clears the
  score bar below. Otherwise leave NO comment this cycle.**

## Deciding whether to comment (strict bar)

The daily comment cap is nearly exhausted, and replies to people must always have room.
So an outbound comment is rationed by **score**, not by slot: it only happens when a post
genuinely earns one of the last comments.

Score every candidate 0–10 before you call `comment`:

- **Replies**: the bar is 4/10; agreement and praise are hard-capped at 3 and never get a
  reply. A concrete anecdote or question clears it.
- **7–10** — a real argument, a contested or specific claim, a concrete detail (a number,
  a named case, a rule, a price, a real experience), professional substance from a
  practitioner, and something you can answer with a specific, non-generic point.
- **4–6** — readable but nothing specific to answer.
- **0–3** — vendor pitch, product launch, recruiter, repost without commentary,
  engagement bait, emoji-only, generic motivation, ad, off-topic or hostile.

The app cuts long posts off with `… more`. Judge the visible text: a truncated post that
shows a real claim, number or named case still counts — do not penalise it for the cut.

Then:

- Comment **only** when the best candidate scores **7 or higher**. Never spend a comment
  on a 6 "because it is the best one here".
- If nothing clears 7, **do not comment this cycle** — like what is good, call `done`,
  and leave the budget for replies.
- When you do comment, answer the specific claim; the writing rules below still apply.

The bar is enforced by `scripts/score.py` (qwen3.8:27b). The loop's own agent is a
different model — so when score.py prints a DECISION, obey it rather than re-judging.

## Writing the comment

- Respond to something specific in the post: a claim, a number, a phrase, a name.
- No pitch, no product mention, no "DM me", no emoji, no invented facts or clients.
- Plain professional English. Never reuse a comment you have already left.

Before posting, the text is checked **against the post** (`score.py --check-comment`).
Generic agreement — "Spot on", "Great point", "Interesting perspective" — is rejected as
`comment: TOO_GENERIC` even if the post itself scored well. Rewrite it to answer
something specific, or skip.

The script validates the comment in two ways before it reports success: the text appears
as a `TextView` in the thread **and** the composer `EditText` is empty. If it prints
`UNVERIFIED`, the comment did not post — try the next best candidate with `comment <i>`.

## If a comment is refused

`comment: BLOCKED (only connections)` — that post will not accept comments. The script
closes it. Pick another listed candidate and call `comment <i>` again. Do not retry the
blocked one.

## Daily comment limit

LinkedIn enforces a daily comment cap. When `comment` prints `DAILY_LIMIT`, the script has
written a 24-hour cooldown to `data/comment_cooldown_until.txt` and will refuse further
comments with `COOLDOWN` until it expires. Do not try to work around it: keep liking if that
still works, or call `done` and let the next cycle skip commenting. Only the user can clear
the cooldown (delete that file) if they want comments earlier.

## Publishing (own post, when the reminder fires)

```bash
bash $E due                        # POST_DUE, or NOT_DUE (next post in Nm)
bash $E publish "post text"
```

`due` reads a timer file that is reset to a random 1-3 hours after every successful
publish, so never post unless `due` says `POST_DUE`. When it is due, `due` also prints
**CONTEXT**: the recent topics you searched and real post bodies people are writing.

Write the post **from that context** — take a specific thing people are actually saying
or arguing about and add your own point of view. Do not write generic thought-leadership
boilerplate. Still no invented facts, 3-5 hashtags, and no link in the first line. Posts are also capped at 3 per
day. `publish` prints `publish: POSTED` and resets the timer; anything else means it
did not go out. 3–5 hashtags, a specific
hook, no invented claims, no link in the first line. If it prints `UNVERIFIED`, read the screen
with `bash $E` helpers below before trying again.

## Offline scoring tests (capture)

To test the score bar without spending a comment or consuming a topic:

```bash
bash $E capture              # random unused seed: search -> scroll -> dump table
bash $E capture "AI governance law firm"   # or name the query
```

`capture` likes nothing, comments nothing, and does **not** write to `used.txt`. It
appends the table to `data/captures.jsonl`. Score them offline:

```bash
python3 $SKILL/scripts/score.py data/captures.jsonl            # all captures
python3 $SKILL/scripts/score.py data/captures.jsonl --last 1   # just the newest
```

Each candidate gets a score and a reason; the verdict is `comment on #N` or
`NO_COMMENT`. Use it to tune the bar, not to post.

## Troubleshooting

- `open` prints `LOAD_FAIL` → run `bash $E ready`, then `open` again. The script already
  force-stops and retries once on its own.
- A bottom sheet or comment sheet covers the screen (dump shows `Bottom Sheet Control
  Bar`) → dismiss it with `aab -s $SERIAL swipe 540 600 540 2200`.
- A row refuses to like (`like N: OFF_SCREEN` after the retries) → it was clipped. Pick
  another listed index; do not chase it.
- `NOT_READY` → the app is not on the feed. `ready` relaunches it; if something overlays
  it, dismiss with a downward swipe as above.

## Fallback primitives (only if the script fails)

```bash
export PATH="$HOME/.local/bin:$HOME/.local/share/android-platform-tools/platform-tools:$PATH"
S=192.168.1.198:44577
aab -s $S ui | grep -E "Reaction button state|desc='Comment'"    # rows + centres
aab -s $S tap X Y                                               # tap a centre
aab -s $S ui | grep -E "Reaction button state"                  # verify state became Like
```

Deep link (search), if needed manually:

```bash
ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$Q")
adb -s $S shell am start -a android.intent.action.VIEW \
  -d "https://www.linkedin.com/search/results/content/?keywords=$ENC"
```

Send control for a comment is the `TextView` `text='Comment'` at the bottom right of the
composer (`~902,2353`) — **not** a `desc='Comment'` post row.

## Rules

- Never invent customers, numbers, testimonials or claims.
- Never cold-connect, cold-message, DM or email — public engagement only.
- Never comment twice on the same post.
- Never claim an action without a UI dump showing its result.
- One search per cycle, three likes and one comment per search, then move on.
- Stop immediately on any verification interstitial ("verify it's you", captcha) and report it.
