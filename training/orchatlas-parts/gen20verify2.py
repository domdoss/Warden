import json

D = "/opt/Warden/training/orchatlas-parts/"
asks = []
marm_hits_that_search = 0
esc = pdf = fallback = marm = search = known = compare = 0
for name in ["s20-1.jsonl", "s20-2.jsonl", "s20-3.jsonl", "s20-4.jsonl"]:
    for line in open(D + name, encoding="utf-8"):
        msgs = json.loads(line)["messages"]
        asks.append(msgs[1]["content"])
        tools = [tc["function"]["name"]
                 for m in msgs if m["role"] == "assistant" for tc in m.get("tool_calls", [])]
        # marm hit followed by a web search = wrong
        if "mcp__marm__marm_smart_recall" in tools:
            idx = tools.index("mcp__marm__marm_smart_recall")
            marm_res = [m for m in msgs if m["role"] == "tool"
                        and m.get("name") == "mcp__marm__marm_smart_recall"][0]["content"]
            if marm_res != "No memories matched." and "WebSearch" in tools[idx + 1:]:
                marm_hits_that_search += 1
        if "escalate_to_cloud" in tools:
            esc += 1
        elif "generate_pdf" in tools:
            pdf += 1
        elif "browser_snapshot" in tools:
            fallback += 1
        elif "mcp__marm__marm_smart_recall" in tools:
            marm += 1
        elif tools[0] == "WebFetch" and "WebSearch" not in tools:
            known += 1
        elif tools.count("WebFetch") >= 2:
            compare += 1
        elif "WebSearch" in tools:
            search += 1

print("distinct asks:", len(set(asks)), "of", len(asks))
print("marm-hit rows that wrongly searched:", marm_hits_that_search)
print("known-url fetches:", known, "| search->fetch:", search,
      "| two-fetch compares:", compare, "| browser fallbacks:", fallback,
      "| marm rows:", marm, "| escalates:", esc, "| pdfs:", pdf)