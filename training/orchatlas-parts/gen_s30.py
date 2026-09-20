#!/usr/bin/env python3
# s30 — YouTube corrective rows, mined from the 2026-09-19 evening failures
# (granite4.2:8b seat, warden.log 22:05–22:37). The failure arc: asked to play
# something NEW, the seat (1) searched instead of playing, (2) stuffed intent
# words into the query ("SoundFlow Lab different song chillstep cyberpunk
# atmospheric not grid runner"), (3) re-searched the KNOWN/PLAYING video by
# name and played it again, (4) looped 10 searches with never a play, (5)
# hammered identical no-result queries. The 2026-09-19 tool already handles
# "new" itself — play excludes the playing video + recently played (MARM
# recall) and judges duration — so the seat's whole job is ONE clean play
# call with human search-box words. Result strings below are the LIVE ones.
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SYS = open(os.path.join(BASE, "_sys.txt")).read()  # placeholder — merge stamps the live prompt
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"

def user(ask):
    return {"role": "user", "content": ANCHOR + ask}

def acall(cid, name, args):
    return {"role": "assistant", "content": "",
            "tool_calls": [{"id": cid, "type": "function",
                            "function": {"name": name, "arguments": args}}]}

def tool(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": content}

def final(text=""):
    return {"role": "assistant", "content": text}

def dumps(rows, repeat=1):
    lines = []
    for msgs in rows:
        assert msgs[0]["role"] == "user"
        assert msgs[-1]["role"] == "assistant"
        for m in msgs:
            for tc in (m.get("tool_calls") or []):
                assert tc["function"]["name"] != "atlas", "seat delegates to atlas"
        obj = {"messages": [{"role": "system", "content": SYS}] + msgs}
        if repeat > 1:
            obj["repeat"] = repeat  # thin section — the merge emits it twice
        lines.append(json.dumps(obj, ensure_ascii=False))
    return "\n".join(lines) + "\n"

# The evening's cast: SoundFlow Lab tracks, consistent ids across rows.
DARK = ("DARK SIGNAL | Cyberpunk Music for Deep Work & Focus",
        "https://www.youtube.com/watch?v=bcmTHIqefMk")
NIGHT = ("NIGHT PROTOCOL | Dark Cyberpunk Music for Deep Work & Focus",
         "https://www.youtube.com/watch?v=7Qk2Wx9pLmZ")
NEW1 = ("UNDERCURRENT | Deep Atmospheric Cyberpunk",
        "https://www.youtube.com/watch?v=Kk3mZv8tQ2w")
NEW2 = ("STATIC BLOOM | Hypnotic Electronic Music",
        "https://www.youtube.com/watch?v=P9wYr4nD7xE")

# ─── kind 1: "something new from X" → ONE play call, clean query ─────────────
# The tool excludes the playing video and recently played ones itself — the
# seat never works that out, never searches first, never names a known title.
A_ROWS = [
    # (ask, query, (title, url))
    ("Do another song from sound flow lab",
     "SoundFlow Lab", NEW1),
    ("play a SoundFlow Lab song you havent already played yet",
     "SoundFlow Lab", NEW2),
    ("weve done grid runner and night protocol already. DIFFERENT SONG. ONE THAT HAS YET TO BE SELECTED",
     "SoundFlow Lab", NEW1),
    ("another track from the artist thats playing, one I havent heard tonight",
     "SoundFlow Lab", NEW2),
    ("switch it up — same vibe, new song",
     "dark cyberpunk music", NEW2),
]

def a_row(ask, query, pick):
    return [
        user(ask),
        acall("c1", "youtube", {"action": "play", "query": query}),
        tool("c1", "youtube", f"Playing: {pick[0]}\n{pick[1]}"),
        final(),
    ]

# ─── kind 2: query hygiene — intent words never go in the query ──────────────
# Logged failure: the query was literally "SoundFlow Lab different song
# chillstep cyberpunk atmospheric not grid runner". A query is what a human
# types in the search box: artist/genre/song words only.
B_ROWS = [
    ("play something different, not grid runner again, maybe some chillstep cyberpunk from sound flow lab",
     "SoundFlow Lab chillstep cyberpunk", NEW1),
    ("i dont want the one thats on now — something else in the same dark atmospheric style",
     "dark atmospheric music", NEW2),
    ("not this one. new song. same artist",
     "SoundFlow Lab", NEW2),
]

def b_row(ask, query, pick):
    return [
        user(ask),
        acall("c1", "youtube", {"action": "play", "query": query}),
        tool("c1", "youtube", f"Playing: {pick[0]}\n{pick[1]}"),
        final(),
    ]

# ─── kind 3: the known title is RIGHT THERE in context — and is not used ─────
# Logged failure: "you went to the correct page, the artist page THEN YOU
# SEARCHED FOR THE SONG YOU JUST PLAYED BY NAME AND PLAYED IT". A now_playing
# in context never becomes the play target when the ask is for something new.
C_ROW_1 = [
    user("what's playing right now?"),
    acall("c1", "youtube", {"action": "now_playing"}),
    tool("c1", "youtube", f"Playing: {NIGHT[0]} (12:04 / 48:15)\n{NIGHT[1]}"),
    final("NIGHT PROTOCOL — the SoundFlow Lab cyberpunk one, about a quarter in."),
    user("cool. now play a different song from the same artist"),
    acall("c2", "youtube", {"action": "play", "query": "SoundFlow Lab"}),
    tool("c2", "youtube", f"Playing: {NEW1[0]}\n{NEW1[1]}"),
    final(),
]

C_ROW_2 = [
    user("is something playing?"),
    acall("c1", "youtube", {"action": "now_playing"}),
    tool("c1", "youtube", f"Playing: {DARK[0]} (0:31 / 51:02)\n{DARK[1]}"),
    final("DARK SIGNAL is on, just started."),
    user("ive heard that one a hundred times. play a song i havent played, same style",
     ),
    acall("c2", "youtube", {"action": "play", "query": "cyberpunk music for focus"}),
    tool("c2", "youtube", f"Playing: {NEW2[0]}\n{NEW2[1]}"),
    final(),
]

# ─── kind 4: "next" → the next action, never a search ────────────────────────
D_ROWS = [
    ("next song", "GRID RUNNER | Dark Cyberpunk Music for Deep Focus", "0:00 / 44:28",
     "https://www.youtube.com/watch?v=mR5tYb2Wq8K"),
    ("good now play the next song", "LOW ORBIT | Ambient Cyberpunk Mix", "0:02 / 39:55",
     "https://www.youtube.com/watch?v=Tn7Qv3hX9dL"),
]

def d_row(ask, title, at, url):
    return [
        user(ask),
        acall("c1", "youtube", {"action": "next"}),
        tool("c1", "youtube", f"Playing: {title} ({at})\n{url}"),
        final(),
    ]

# ─── kind 5: asked for the video that IS playing → play by url, no-op ────────
# Logged failure: re-SEARCHING "SoundFlow Lab DARK SIGNAL" by name. The exact
# video is addressed by url; the tool answers "Already playing".
E_ROW = [
    user("what's on?"),
    acall("c1", "youtube", {"action": "now_playing"}),
    tool("c1", "youtube", f"Playing: {DARK[0]} (18:22 / 51:02)\n{DARK[1]}"),
    final("DARK SIGNAL, about a third in."),
    user("actually put on dark signal, that ones perfect"),
    acall("c2", "youtube", {"action": "play", "url": DARK[1]}),
    tool("c2", "youtube", f"Already playing: {DARK[0]} (18:26 / 51:02)\n{DARK[1]}"),
    final(),
]

# ─── kind 6: a genuine choice → ONE search, list it, play the pick by url ────
# The search-loop failure (10 searches, no play) dies here: search is for
# offering options, the user picks, the pick is played by its url.
F_ROW_1 = [
    user("give me a few long synthwave mixes to choose from"),
    acall("c1", "youtube", {"action": "search", "query": "synthwave mix", "limit": 3}),
    tool("c1", "youtube",
         "1. Retrowave — The Ultimate Synthwave Mix — NeonVault [1:12:40]\n"
         "   https://www.youtube.com/watch?v=Vq8Lm3RtY5N\n"
         "2. Night Drive — Full Synthwave Compilation — Pulsewave FM [58:12]\n"
         "   https://www.youtube.com/watch?v=H4wKz7DpQ9R\n"
         "3. Miami Nights — 80s Synthwave Marathon — Chrome Dunes [2:04:31]\n"
         "   https://www.youtube.com/watch?v=B2nXv6TmW8S"),
    final("Three: a 72-minute NeonVault mix, an hour of Night Drive, and a two-hour Miami Nights marathon. Which one?"),
    user("the long one"),
    acall("c2", "youtube", {"action": "play", "url": "https://www.youtube.com/watch?v=B2nXv6TmW8S"}),
    # play-by-url echoes the url as the title — that is the live string
    tool("c2", "youtube",
         "Playing: https://www.youtube.com/watch?v=B2nXv6TmW8S\nhttps://www.youtube.com/watch?v=B2nXv6TmW8S"),
    final(),
]

F_ROW_2 = [
    user("find me a video about the voyager probes, give me options"),
    acall("c1", "youtube", {"action": "search", "query": "voyager probes documentary", "limit": 3}),
    tool("c1", "youtube",
         "1. The Voyager Mission — 45 Years Later — Deep Space Docs [52:18]\n"
         "   https://www.youtube.com/watch?v=Yt5Rw9NmK3V\n"
         "2. Voyager 1 and 2 — The Grand Tour — Orbit Archive [28:44]\n"
         "   https://www.youtube.com/watch?v=Zq7Mx4LdT2P\n"
         "3. How Voyager Still Calls Home — Engineering Space [16:02]\n"
         "   https://www.youtube.com/watch?v=W3pVn8QrD6H"),
    final("A 52-minute deep dive, a 28-minute grand-tour rundown, or a short one on the comms engineering. Pick one."),
    user("the deep dive"),
    acall("c2", "youtube", {"action": "play", "url": "https://www.youtube.com/watch?v=Yt5Rw9NmK3V"}),
    tool("c2", "youtube",
         "Playing: https://www.youtube.com/watch?v=Yt5Rw9NmK3V\nhttps://www.youtube.com/watch?v=Yt5Rw9NmK3V"),
    final(),
]

# ─── kind 7: no results → simplify the query ONCE, then stop ─────────────────
# Logged failure: the identical no-result query issued 8 times in a row.
G_ROW_1 = [
    user("throw on a lofi study mix"),
    acall("c1", "youtube", {"action": "play", "query": "lofi study mix"}),
    tool("c1", "youtube", 'No YouTube results for "lofi study mix".'),
    acall("c2", "youtube", {"action": "play", "query": "lofi study"}),
    tool("c2", "youtube",
         "Deep Focus Lofi — Study Session\nhttps://www.youtube.com/watch?v=F8jMq5WnR7T"),
    final(),
]

G_ROW_2 = [
    user("any video on the 1987 packard bell keyboard restoration?"),
    acall("c1", "youtube", {"action": "search", "query": "1987 Packard Bell keyboard restoration", "limit": 3}),
    tool("c1", "youtube", 'No YouTube results for "1987 Packard Bell keyboard restoration".'),
    acall("c2", "youtube", {"action": "search", "query": "vintage keyboard restoration", "limit": 3}),
    tool("c2", "youtube",
         "1. Restoring a 1986 IBM Model M — Key Rescue [24:10]\n"
         "   https://www.youtube.com/watch?v=C6mTz2QwY9D\n"
         "2. Vintage Keyboard Teardown Series — Bit Salvage [18:35]\n"
         "   https://www.youtube.com/watch?v=D9nWk4RpL3F"),
    final("Nothing for the Packard Bell itself — closest are an IBM Model M restore and a vintage teardown series. Want one of those?"),
]

# ─── kind 8: everything recently played — report it, don't re-call ───────────
H_ROW = [
    user("another one from sound flow lab"),
    acall("c1", "youtube", {"action": "play", "query": "SoundFlow Lab"}),
    tool("c1", "youtube",
         'Every result for "SoundFlow Lab" was recently played. Try a different artist or genre — or action "next" to move on from the current video.'),
    final("That exhausts SoundFlow Lab for tonight — everything they have has been played. Want a different artist, or should I just hit next?"),
]

ROWS = []
for r in A_ROWS:
    ROWS.append(a_row(*r))
for r in B_ROWS:
    ROWS.append(b_row(*r))
ROWS.append(C_ROW_1)
ROWS.append(C_ROW_2)
for r in D_ROWS:
    ROWS.append(d_row(*r))
ROWS.append(E_ROW)
ROWS.append(F_ROW_1)
ROWS.append(F_ROW_2)
ROWS.append(G_ROW_1)
ROWS.append(G_ROW_2)
ROWS.append(H_ROW)

open(os.path.join(BASE, "s30-1.jsonl"), "w").write(dumps(ROWS, repeat=2))
print("s30-1: %d rows (all x2)" % len(ROWS))
