#!/usr/bin/env python3
# s38 — "put that X back on" / "play that X again" / "resume that X" rows (~26).
#
# s35+s37 taught "play that X" → ONE youtube play call, but the RESUME-SHAPED
# suffixes ("back on", "again", "resume that X") still leak: "put that lofi mix
# back on" → youtube search (or media_control play / youtube now_playing)
# instead of youtube play. The base model's "play that X" prior is `search`,
# and the "back on"/"again" suffix reads as "resume the player" → the bare
# media_control/now_playing tools. s35/s37 carried only ~4 "back on" rows, too
# few to out-vote that. This part multiplies the resume-shaped family so
# "put that <genre> back on" is unambiguously the youtube tool's play job.
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

# (ask, query, title, reply)
ROWS = [
    # ---- "put that X back on" (the exact failing family) -------------------
    ("put that lofi mix back on", "lofi mix", "Lofi Hip Hop Mix — Beats to Study/Relax To", "Lofi's back on."),
    ("put that jazz mix back on", "jazz mix", "Smooth Jazz — Coffee Shop Mix", "Playing the jazz mix again."),
    ("put that piano back on", "piano music", "Peaceful Piano Music for Focus", "Piano's back on."),
    ("put that synthwave mix back on", "synthwave mix", "Synthwave Mix — Retro Future Drive", "Synthwave's back on."),
    ("put that ambient mix back on", "ambient mix", "Ambient Space Music for Sleep & Focus", "Ambient's back on."),
    ("put that classical back on", "classical music", "Classical Music for Studying", "Playing the classical."),
    ("put that techno mix back on", "techno mix", "Techno Mix — Berlin Underground Set", "Techno's back on."),
    ("put that focus music back on", "focus music", "Deep Focus Music — Study Concentration", "Focus music's back on."),
    ("put that rain sounds back on", "rain sounds", "Rain Sounds for Sleeping", "Rain sounds are back on."),
    ("put that chillhop back on", "chillhop", "Chillhop Radio — jazzy beats to relax", "Chillhop's back on."),
    ("put that white noise back on", "white noise", "White Noise — Deep Sleep Fan Sound", "White noise is back on."),
    ("put that binaural beats back on", "binaural beats", "Binaural Beats — Theta Waves for Focus", "Binaural beats are back on."),
    ("put that acoustic back on", "acoustic", "Acoustic Instrumentals — Focus and Relax", "Acoustic's back on."),

    # ---- "play that X again" ----------------------------------------------
    ("play that jazz again", "jazz", "Jazz Radio — Classic Standards", "Playing the jazz again."),
    ("play that piano again", "piano music", "Piano — Solo Instrumental", "Playing the piano again."),
    ("play that synthwave again", "synthwave", "Synthwave Mix — Cyber City Drive", "Playing the synthwave again."),
    ("play that ambient again", "ambient music", "Ambient Mix — Drone for Deep Focus", "Playing the ambient again."),
    ("play that lofi again", "lofi music", "Lofi Girl — Beats to Relax/Study To", "Playing the lofi again."),
    ("play that classical again", "classical music", "Classical Piano — Chopin Nocturnes", "Playing the classical again."),
    ("play that rain sounds again", "rain sounds", "Rain on Window — Cozy Sleep Sounds", "Playing the rain sounds again."),

    # ---- "resume that X" (named thing → youtube play, not media_control) ---
    ("resume that ambient playlist", "ambient playlist", "Ambient Playlist — Deep Focus", "Resuming the ambient playlist."),
    ("resume that jazz station", "jazz", "Jazz Radio — Smooth Saxophone", "Resuming the jazz station."),
    ("resume that lofi mix", "lofi mix", "Lofi Mix — Chill Study Beats", "Resuming the lofi mix."),
    ("resume that synthwave mix", "synthwave mix", "Synthwave Mix — Neon Drive", "Resuming the synthwave mix."),
    ("resume that rain sounds track", "rain sounds", "Rain Sounds — Thunderstorm Ambience", "Resuming the rain sounds."),
    ("resume that white noise track", "white noise", "White Noise — Fan Sound for Sleep", "Resuming the white noise."),
]

for ask, query, title, rp in ROWS:
    R.append(row(
        ask,
        call("youtube", {"action": "play", "query": query}),
        tool("youtube", f"Playing: {title}\nhttps://www.youtube.com/watch?v=W4RD3N37"),
        reply(rp),
    ))

out = os.path.join(HERE, "s38-back-on.jsonl")
with open(out, "w") as f:
    for r in R:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"wrote {len(R)} rows -> {out}")
