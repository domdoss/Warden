import json

D = "/opt/Warden/training/orchatlas-parts/"
SYS = open(D + "_sys.txt", encoding="utf-8").read()
ANCHOR = "Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).\n\n"
ALLOWED = {"WebSearch", "WebFetch", "browser_navigate", "browser_snapshot",
           "mcp__marm__marm_smart_recall", "escalate_to_cloud", "generate_pdf"}

ok = True
total = 0
for name in ["s20-1.jsonl", "s20-2.jsonl", "s20-3.jsonl", "s20-4.jsonl"]:
    lines = open(D + name, encoding="utf-8").read().splitlines()
    if len(lines) != 25:
        print(name, "FAIL: line count", len(lines)); ok = False
    for i, line in enumerate(lines, 1):
        total += 1
        try:
            row = json.loads(line)
        except Exception as e:
            print(name, i, "FAIL: JSON parse:", e); ok = False; continue
        msgs = row["messages"]
        if set(row.keys()) != {"messages"}:
            print(name, i, "FAIL: extra keys or missing messages"); ok = False
        # system byte-identity
        if msgs[0]["role"] != "system" or msgs[0]["content"] != SYS:
            print(name, i, "FAIL: system mismatch"); ok = False
        if msgs[1]["role"] != "user" or not msgs[1]["content"].startswith(ANCHOR):
            print(name, i, "FAIL: user anchor"); ok = False
        if msgs[-1]["role"] != "assistant" or msgs[-1].get("tool_calls"):
            print(name, i, "FAIL: last message not a final answer"); ok = False
        seen_search = False
        read_after_search = False
        last_tc_id = None
        for m in msgs[2:]:
            r = m["role"]
            if r == "assistant":
                if "tool_calls" in m:
                    for tc in m["tool_calls"]:
                        fn = tc["function"]
                        if fn["name"] not in ALLOWED:
                            print(name, i, "FAIL: bad tool", fn["name"]); ok = False
                        if not isinstance(fn["arguments"], dict):
                            print(name, i, "FAIL: arguments not object:", fn["name"]); ok = False
                        if fn["name"] == "WebSearch":
                            seen_search = True
                        elif fn["name"] in ("WebFetch", "browser_navigate") and seen_search:
                            read_after_search = True
                        last_tc_id = tc["id"]
                elif m.get("content") is None:
                    print(name, i, "FAIL: plain assistant with null content"); ok = False
            elif r == "tool":
                if m.get("name") not in ALLOWED:
                    print(name, i, "FAIL: tool msg missing/bad name:", m.get("name")); ok = False
                if m.get("tool_call_id") != last_tc_id:
                    print(name, i, "FAIL: tool_call_id chain"); ok = False
            elif r == "user":
                print(name, i, "FAIL: mid-row user message"); ok = False
        if seen_search and not read_after_search:
            print(name, i, "FAIL: answered from search titles alone"); ok = False
        # every row must make at least one tool call
        if not any("tool_calls" in m for m in msgs if m["role"] == "assistant"):
            print(name, i, "FAIL: no tool calls at all"); ok = False

print("total rows:", total)
print("VERIFY OK" if ok else "VERIFY FAILED")