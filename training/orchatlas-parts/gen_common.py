import json

with open("/opt/Warden/training/orchatlas-parts/system.txt", encoding="utf-8") as f:
    SYS = f.read()

ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"


def user(ask):
    return {"role": "user", "content": ANCHOR + ask}


def acall(cid, name, args, content=None):
    return {"role": "assistant", "content": content,
            "tool_calls": [{"id": cid, "type": "function",
                            "function": {"name": name, "arguments": args}}]}


def tool(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": content}


def final(text):
    return {"role": "assistant", "content": text}


def dumps(rows):
    lines = []
    for msgs in rows:
        assert msgs[0]["role"] == "user"
        assert msgs[-1]["role"] == "assistant"
        lines.append(json.dumps({"messages": [{"role": "system", "content": SYS}] + msgs},
                                ensure_ascii=False))
    return "\n".join(lines) + "\n"