#!/usr/bin/env python3
# s35 — referential "play that X" rows (8). The corpus teaches "play <genre>" →
# youtube(action:play, query:<genre>) 29 ways, but every row's ask names the
# music directly ("play some fleetwood mac"). The referential shape — "play
# that dark cyberpunk mix", "put that lofi thing back on" — has NO rows, so the
# seat treats the demonstrative "that" as a memory-recall job (read MARM files)
# and, when the recall comes back empty, improvises raw chrome_navigate +
# chrome_get_web_content with hand-written selectors instead of the one youtube
# call (2026-11-07: "play that dark cyberpunk mix" took 5 turns and never played).
# These rows teach: "play that <descriptive>" = ONE youtube play call — the tool
# searches, de-dups recently-played, picks and plays; memory is the tool's job,
# never the seat's.
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

# 1. The exact failing ask: "play that dark cyberpunk mix" → search+play, one call.
R.append(row(
    "play that dark cyberpunk mix",
    call("youtube", {"action": "play", "query": "dark cyberpunk mix"}),
    tool("youtube", "Playing: NIGHT PROTOCOL | Dark Cyberpunk Music for Deep Work & Focus\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    reply("Playing the dark cyberpunk mix — NIGHT PROTOCOL, deep focus.")
))

# 2. "put that X back on".
R.append(row(
    "put that lofi mix back on",
    call("youtube", {"action": "play", "query": "lofi mix"}),
    tool("youtube", "Playing: Lofi Hip Hop Mix — Beats to Study/Relax To\nhttps://www.youtube.com/watch?v=jfKfPfyJRdk"),
    reply("Lofi's back on.")
))

# 3. "play that X from earlier".
R.append(row(
    "play that ambient thing from earlier",
    call("youtube", {"action": "play", "query": "ambient music"}),
    tool("youtube", "Playing: Ambient Space Music for Sleep & Focus\nhttps://www.youtube.com/watch?v=8TDcGYmQdLM"),
    reply("Playing the ambient one.")
))

# 4. "play the X we had going".
R.append(row(
    "play the ambient mix we had going",
    call("youtube", {"action": "play", "query": "ambient mix"}),
    tool("youtube", "Playing: Ambient Mix — Deep Focus & Study\nhttps://www.youtube.com/watch?v=xY6g54ZtKws"),
    reply("Ambient mix is back on.")
))

# 5. "put on that X again".
R.append(row(
    "put on that japanese cafe thing again",
    call("youtube", {"action": "play", "query": "japanese cafe music"}),
    tool("youtube", "Playing: Japanese Cafe Music — Coffee Shop Jazz & Bossa Nova\nhttps://www.youtube.com/watch?v=JWQzJfA8NkE"),
    reply("Japanese cafe music is on.")
))

# 6. "play that X from yesterday".
R.append(row(
    "play that focus music from yesterday",
    call("youtube", {"action": "play", "query": "focus music"}),
    tool("youtube", "Playing: Deep Focus Music — Study & Concentration\nhttps://www.youtube.com/watch?v=qzY3PfC3PYQ"),
    reply("Focus music is on.")
))

# 7. "bring back that X playlist".
R.append(row(
    "bring back that cyberpunk playlist",
    call("youtube", {"action": "play", "query": "cyberpunk"}),
    tool("youtube", "Playing: Cyberpunk Synthwave Mix — Dark Retro Future\nhttps://www.youtube.com/watch?v=hLQl3WQQoQ0"),
    reply("Cyberpunk playlist is back.")
))

# 8. "play that one — the X" (split reference).
R.append(row(
    "play that one — the dark synthwave mix",
    call("youtube", {"action": "play", "query": "dark synthwave mix"}),
    tool("youtube", "Playing: Dark Synthwave Mix — Retrowave & Outrun\nhttps://www.youtube.com/watch?v=4xDzrJKXOOY"),
    reply("Playing the dark synthwave mix.")
))

assert len(R) == 8, f"expected 8 rows, got {len(R)}"
path = os.path.join(HERE, "s35-referential-play.jsonl")
with open(path, "w") as f:
    for r in R:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(path, len(R))
