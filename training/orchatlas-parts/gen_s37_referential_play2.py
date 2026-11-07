#!/usr/bin/env python3
# s37 — referential "play that X <suffix>" rows (second batch, ~40).
#
# s35 taught "play that <descriptive>" → ONE youtube play call, but its
# ambiguous-suffix coverage was thin: two "from earlier" rows, one "from
# yesterday", a handful of "thing"/"we had going". At temperature 0 the seat
# still folded "play that ambient thing from earlier" into media_control
# {"action":"play"} — the base model's "resume what was playing earlier" prior
# (41 media_control rows) out-voted two youtube rows. This part multiplies the
# referential-suffix family so the signal is unambiguous: "play that <genre>"
# names a thing to fetch and is the youtube tool's job, no matter the suffix.
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SYS = "placeholder (stamped live by merge)"
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver)."

def user(text):
    return {"role": "user", "content": ANCHOR + "\n\n" + text}

def call(name, args, content=""):
    return {"role": "assistant", "content": content, "tool_calls": [
        {"type": "function", "function": {"name": name, "arguments": args}}]}

def tool(name, content):
    return {"role": "tool", "name": name, "content": content}

def reply(text):
    return {"role": "assistant", "content": text}

def row(*msgs):
    return {"messages": [{"role": "system", "content": SYS}] + [user(m) if isinstance(m, str) else m for m in msgs]}

R = []

# (ask, query, playing_title, reply) — reply names the genre and confirms play.
ROWS = [
    # ---- "from earlier" (the exact failing family) -------------------------
    ("play that lofi mix from earlier", "lofi mix", "Lofi Hip Hop Mix — Beats to Study/Relax To", "Playing the lofi mix."),
    ("play that jazz from earlier", "jazz music", "Relaxing Jazz — Smooth Saxophone Playlist", "Playing the jazz."),
    ("play that piano thing from earlier", "piano music", "Peaceful Piano Music for Focus", "Playing the piano one."),
    ("play that synthwave from earlier", "synthwave", "Synthwave Mix — Retro Future Drive", "Playing the synthwave."),
    ("play that white noise from earlier", "white noise", "White Noise — Deep Sleep Fan Sound", "Playing the white noise."),
    ("play that classical from earlier", "classical music", "Classical Music for Studying — Mozart & Beethoven", "Playing the classical."),
    ("play that rain sounds thing from earlier", "rain sounds", "Rain Sounds for Sleeping — 10 Hours", "Playing the rain sounds."),
    ("play that chillhop from earlier", "chillhop", "Chillhop Radio — jazzy beats to relax", "Playing the chillhop."),
    ("play that techno from earlier", "techno", "Techno Mix — Berlin Underground Set", "Playing the techno."),
    ("play that focus music from earlier", "focus music", "Deep Focus Music — Study Concentration", "Playing the focus music."),
    ("play that binaural beats from earlier", "binaural beats", "Binaural Beats — Theta Waves for Focus", "Playing the binaural beats."),
    ("play that instrumental from earlier", "instrumental music", "Instrumental Music — Study and Work", "Playing the instrumental."),

    # ---- time-referential ("from yesterday / last night / this morning") ---
    ("play that lofi from yesterday", "lofi music", "Lofi Hip Hop Radio — Chill Study Beats", "Playing the lofi from yesterday."),
    ("play that jazz from last night", "jazz", "Late Night Jazz — Mellow Saxophone", "Playing the jazz from last night."),
    ("play that synthwave from this morning", "synthwave", "Synthwave Mix — Neon Drive", "Playing the synthwave."),
    ("play that ambient from last night", "ambient music", "Ambient Space Music for Sleep & Focus", "Playing the ambient."),
    ("play that rain sounds from yesterday", "rain sounds", "Rain on Window — Cozy Sleep Sounds", "Playing the rain sounds."),
    ("play that piano from this morning", "piano music", "Morning Piano — Gentle Melodies", "Playing the piano."),
    ("play that classical from last week", "classical music", "Classical Piano — Chopin Nocturnes", "Playing the classical."),
    ("play that white noise from before", "white noise", "White Noise — Fan Sound for Sleep", "Playing the white noise."),

    # ---- "thing" -----------------------------------------------------------
    ("play that jazz thing", "jazz music", "Smooth Jazz — Coffee Shop Vibes", "Playing the jazz thing."),
    ("play that piano thing", "piano music", "Relaxing Piano — Calm Study Music", "Playing the piano thing."),
    ("play that synthwave thing", "synthwave", "Synthwave — Outrun Retro Mix", "Playing the synthwave thing."),
    ("play that chillhop thing", "chillhop", "Chillhop Essentials — Spring Mix", "Playing the chillhop thing."),
    ("play that techno thing", "techno", "Techno — Warehouse Rave Set", "Playing the techno thing."),
    ("play that acoustic thing", "acoustic", "Acoustic Covers — Guitar & Vocals", "Playing the acoustic thing."),

    # ---- "we had going" / "we were listening to" ---------------------------
    ("play that jazz we had going", "jazz music", "Jazz for Work — Instrumental Bebop", "Playing the jazz we had going."),
    ("play that piano we had going", "piano music", "Piano for Deep Work — Focus Mix", "Playing the piano we had going."),
    ("play that synthwave we were listening to", "synthwave", "Synthwave — Retrowave Night Ride", "Playing the synthwave."),
    ("play that lofi we had going", "lofi music", "Lofi Girl — Beats to Relax/Study To", "Playing the lofi we had going."),
    ("play that rain sounds we had going", "rain sounds", "Rain Sounds — Thunderstorm Ambience", "Playing the rain sounds."),
    ("play that classical we were listening to", "classical music", "Classical Music — Symphony Orchestra", "Playing the classical."),

    # ---- "again" / "back on" / "back" --------------------------------------
    ("play that jazz again", "jazz", "Jazz Radio — Classic Standards", "Playing the jazz again."),
    ("put that piano back on", "piano music", "Piano Music — Relaxing Instrumentals", "Piano's back on."),
    ("play that synthwave again", "synthwave", "Synthwave Mix — Cyber City Drive", "Playing the synthwave again."),
    ("put that acoustic back on", "acoustic", "Acoustic Instrumentals — Focus and Relax", "Acoustic's back on."),
    ("play that chillhop again", "chillhop", "Chillhop Radio — Lazy Sunday Beats", "Playing the chillhop again."),
    ("put that techno back", "techno", "Techno Mix — Peak Hour Set", "Techno's back on."),

    # ---- "the one / that one" ----------------------------------------------
    ("play that one — the jazz mix", "jazz mix", "Jazz Mix — Smooth Evening", "Playing the jazz mix."),
    ("play the one I had on — ambient", "ambient music", "Ambient Mix — Drone for Deep Focus", "Playing the ambient one."),
    ("play that piano one again", "piano music", "Piano — Solo Instrumental", "Playing the piano one again."),
    ("play the one we had going — lofi", "lofi", "Lofi Mix — Chill Study Beats", "Playing the lofi one."),
]

for ask, query, title, rp in ROWS:
    R.append(row(
        ask,
        call("youtube", {"action": "play", "query": query}),
        tool("youtube", f"Playing: {title}\nhttps://www.youtube.com/watch?v=W4RD3N37"),
        reply(rp),
    ))

out = os.path.join(HERE, "s37-referential-play-2.jsonl")
with open(out, "w") as f:
    for r in R:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"wrote {len(R)} rows -> {out}")
