# LinkedIn cycle — proven process

This is the process that was run end-to-end and verified on the phone. Warden's loop
and opencode both call the same commands; there is no separate implementation.

## Verified live (19 Nov 2026)

| Action | Result |
|---|---|
| reply to someone who commented on our post | `reply: POSTED` (Kelsey T.) |
| comment on a search candidate | `comment: POSTED (author: Max Tran)` |
| accept connection requests | `INVITES: 2` / `accepted: 2` |
| post reminder | `NOT_DUE (next post in 82m)` |
| scored outbound search | real topic, table, `DECISION: COMMENT/NO_COMMENT` |

## Order (inbound first)

```bash
E=/home/user/your-project/.opencode/skills/linkedin-phone/scripts/engage.sh

bash $E replies                  # who wrote to us
bash $E openreply 1              # or openreply "Kelsey T." (robust to list reorder)
bash $E reply - <<'TXT'          # only on DECISION: REPLY
...
TXT
bash $E invites accept           # up to 3
bash $E due                     # POST_DUE / NOT_DUE
bash $E publish "<text>"         # only on POST_DUE
bash $E plan                    # search + score + DECISION: COMMENT <i>
bash $E like <indices>
bash $E comment <i> - <<'TXT'    # only on DECISION: COMMENT
...
TXT
```

## Rules that matter

- Never reply to agreement or praise. Blocked in code (capped at 3/10), **even when long**.
  Reply only when they add something: a new point, counterpoint, concrete experience,
  named case, number, or question.
- Only comment when the decision says `COMMENT` (bar 7/10). Truncated posts with a
  named case/ruling/number still clear the bar.
- Budgets: 8 comments, 15 replies, 15 likes, 10 invites, 3 posts per day; 3 invites
  per cycle; quiet hours 07:00–23:00 (every command refuses outside them).
- Never hardcode `SERIAL=`; the script re-detects the phone each run.

- `reply` is **threaded**: it taps Reply on that person's comment. If it cannot find
  it, it prints `NO_REPLY_BUTTON` and posts nothing (never a top-level comment).
- Comment text is scored **against the post** before posting; generic agreement is
  rejected as `TOO_GENERIC`.

## Dedup (why it stops re-processing)

`data/handled.tsv` is the exact gate: `author <tab> kind <tab> reply|skip <tab> epoch`.
A `reply` hides that person for 14 days; a `skip` hides them for 12 hours. Grouped
names normalise ("Kelsey T. and 1 new person" == "Kelsey T."). `replies` filters
against it, so a notification is opened once, not every cycle.

Every entry is mirrored to MARM under `session_name: linkedin` for durable,
cross-session context. MARM is **not** the gate: its recall is semantic and scoped,
and it is a network call on the hot path.

The scorer runs on `qwen3.6:35b` — the same model as the loop — so only one ~20GB
model stays resident on the GPU. Mixing it with 27b caused timeouts that made the
loop skip good comments.

## Known limitations (fail closed, not open)

- "replied to your comment" notifications open the post in the feed; the reply sits
  behind the comments sheet and is often not reachable from a text dump. `openreply`
  returns `NO_TEXT` and `NO_REPLY` rather than answering the wrong person.
- `openreply <i>` uses the live list index. If there is more than a second or two
  between `replies` and `openreply`, the list can reorder — pass the author name.
- The post composer is a Compose field; if `aab text` misses, `reply`/`comment`
  retype through the ADBKeyboard IME.

## Copying to Warden

Warden's loop runs the same `engage.sh` by absolute path, so the scripts are already
shared. Only the skill text is duplicated:

```bash
cp ~/.opencode/skills/linkedin-phone/SKILL.md /opt/Warden/data/skills/linkedin-mobile/SKILL.md
```
