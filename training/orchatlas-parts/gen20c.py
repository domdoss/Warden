import json

D = "/opt/Warden/training/orchatlas-parts/"
SYS = open(D + "_sys.txt", encoding="utf-8").read()
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"

ALLOWED = {"WebSearch", "WebFetch", "browser_navigate", "browser_snapshot",
           "mcp__marm__marm_smart_recall", "escalate_to_cloud", "generate_pdf"}


def U(ask):
    return {"role": "user", "content": ANCHOR + ask}


def A(cid, name, **args):
    assert name in ALLOWED, name
    return {"role": "assistant", "content": None,
            "tool_calls": [{"id": cid, "type": "function",
                            "function": {"name": name, "arguments": args}}]}


def T(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": content}


def F(text):
    return {"role": "assistant", "content": text}


def R(*msgs):
    return {"messages": [{"role": "system", "content": SYS}] + list(msgs)}


def UF(ask, url, page, ans):
    return R(U(ask), A("call_1", "WebFetch", url=url),
             T("call_1", "WebFetch", page), F(ans))


def SF(ask, q, results, url, page, ans):
    return R(U(ask), A("call_1", "WebSearch", query=q), T("call_1", "WebSearch", results),
             A("call_2", "WebFetch", url=url), T("call_2", "WebFetch", page), F(ans))


def MB(ask, query, mres, ans):
    return R(U(ask), A("call_1", "mcp__marm__marm_smart_recall", query=query),
             T("call_1", "mcp__marm__marm_smart_recall", mres), F(ans))


def BF(ask, url, empty, title, snap, ans):
    return R(U(ask),
             A("call_1", "WebFetch", url=url), T("call_1", "WebFetch", empty),
             A("call_2", "browser_navigate", url=url),
             T("call_2", "browser_navigate", "Navigated to " + url + " — \"" + title + "\""),
             A("call_3", "browser_snapshot"), T("call_3", "browser_snapshot", snap),
             F(ans))


def save(fname, rows):
    for r in rows:
        msgs = r["messages"]
        assert msgs[0]["role"] == "system" and msgs[0]["content"] == SYS
        assert msgs[-1]["role"] == "assistant"
        for m in msgs[1:]:
            if m["role"] == "assistant" and "tool_calls" in m:
                for tc in m["tool_calls"]:
                    assert isinstance(tc["function"]["arguments"], dict)
                    assert tc["function"]["name"] in ALLOWED
            if m["role"] == "tool":
                assert m.get("name") in ALLOWED, m
    with open(D + fname, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(fname, len(rows))