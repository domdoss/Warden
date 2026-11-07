#!/usr/bin/env python3
# s36 — memory-recall rows (10). The seat's routing prompt says "Memory:
# mcp__marm__marm_smart_recall (that exact name) before a search, lookup or
# find", but the corpus teaches read_file/grep for "find/lookup" far more than
# it teaches the recall tool (9 vs 24). Result: for "play that dark cyberpunk
# mix" the seat did not recall from MARM — it hallucinated two file paths
# (~/.local/share/Warden/marm.md, marm-context.jsonl) that exist nowhere in the
# code or corpus, read them empty, and fabricated "lost in a MARM upgrade"
# (2026-11-07). These rows teach: a remember/find/lookup ask → ONE
# mcp__marm__marm_smart_recall call, then answer from what it returns — never a
# guessed file path.
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

R.append(row(
    "what did we decide about the vendor renewal",
    call("mcp__marm__marm_smart_recall", {"query": "vendor renewal decision", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.92] Vendor renewal — Meridian Tools approved at the enterprise tier; do not downgrade. Priya owns signing it, deadline Sep 30.\n2. [0.71] Content calendar — blog posts move to every other week."),
    reply("We approved the Meridian Tools renewal at the enterprise tier — no downgrade; Priya owns signing it by September 30th.")
))

R.append(row(
    "do you remember the garage door guy's number",
    call("mcp__marm__marm_smart_recall", {"query": "garage door guy phone number", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.89] Garage door repair — call Mark (604-555-0132) when the opener sticks."),
    reply("Mark, 604-555-0132 — the garage door repair guy.")
))

R.append(row(
    "what was that error we hit on the deploy last week",
    call("mcp__marm__marm_smart_recall", {"query": "deploy error last week", "search_all": True, "include_logs": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.85] Deploy error — the build failed on a missing dist/index.js; fixed by running npx tsc before restart."),
    reply("The build was failing on a missing dist/index.js — we fixed it by running npx tsc before the restart.")
))

R.append(row(
    "where did I put the insurance policy",
    call("mcp__marm__marm_smart_recall", {"query": "insurance policy location", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.88] Insurance policy — scanned into ~/Warden/documents/insurance-policy.pdf."),
    reply("It's scanned into ~/Warden/documents/insurance-policy.pdf.")
))

R.append(row(
    "who was the contact at Meridian",
    call("mcp__marm__marm_smart_recall", {"query": "Meridian contact person", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.90] Meridian Tools contact — Priya handles the renewal; enterprise tier."),
    reply("Priya — she owns the Meridian renewal.")
))

R.append(row(
    "recall the decision about the team offsite venue",
    call("mcp__marm__marm_smart_recall", {"query": "team offsite venue decision", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.87] Offsite venue — booked the lake cabin for the retreat, June 12-14."),
    reply("We booked the lake cabin for June 12-14.")
))

R.append(row(
    "do we have anything on the roof claim",
    call("mcp__marm__marm_smart_recall", {"query": "roof claim", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.84] Roof claim — call insurance broker Dan (604-555-0148) about it."),
    reply("The roof claim goes through Dan at insurance, 604-555-0148.")
))

R.append(row(
    "what did I say about the blog schedule again",
    call("mcp__marm__marm_smart_recall", {"query": "blog schedule", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.86] Blog schedule — posts move to every other week; next draft is the local agents demo piece."),
    reply("Blog posts move to every other week, and the next draft is the local agents demo piece.")
))

R.append(row(
    "find that thing I mentioned about the homelab budget",
    call("mcp__marm__marm_smart_recall", {"query": "homelab budget", "search_all": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.93] Homelab budget — rebuild cap $2,400 including the GPU; prefer a used GPU, check the marketplace first."),
    reply("The rebuild cap is $2,400 including the GPU, and we'd prefer a used GPU from the marketplace.")
))

R.append(row(
    "I can't remember — what was the name of the note app we tried",
    call("mcp__marm__marm_smart_recall", {"query": "note app we tried", "search_all": True, "include_logs": True}),
    tool("mcp__marm__marm_smart_recall", "1. [0.82] Note app — we tried Ghostwriter and it stuck; it is the default editor."),
    reply("Ghostwriter — that's the one we kept as the default editor.")
))

assert len(R) == 10, f"expected 10 rows, got {len(R)}"
path = os.path.join(HERE, "s36-recall.jsonl")
with open(path, "w") as f:
    for r in R:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(path, len(R))
