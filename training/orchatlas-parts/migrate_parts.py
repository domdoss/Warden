#!/usr/bin/env python3
# One-time part-file migration to the post-8ddc077 seat:
#   Read/Write            → read_file/write_file (file_path → path)
#   Grep/Glob             → Bash one-liners (the seat's own hands)
#   Edit                  → vulkan delegation (dispatch → started → read_job_result)
#   project (work tasks)  → iris `task` (byte merged into iris; work tasks are iris's)
#   browser_navigate/tabs/current_url/evaluate → chrome MCP equivalents
#   browser_click/type/press_key/wait_for/hover/... → QUARANTINE (ref-based
#     flows can't be honestly renamed without the read_page step)
# Rows quarantined land in quarantine-<part>.jsonl next to the part.
import json, glob, os, shlex, hashlib

BASE = os.path.dirname(os.path.abspath(__file__))
RENAME = {"Read": "read_file", "Write": "write_file"}
KEYMAP = {"Read": {"file_path": "path"}, "Write": {"file_path": "path"}}
# Tool-result name fields: every name a call could have been renamed to.
RESULT_RENAME = {"Read": "read_file", "Write": "write_file", "Grep": "Bash",
                 "Glob": "Bash", "browser_navigate": "chrome_navigate",
                 "browser_evaluate": "chrome_javascript",
                 "browser_current_url": "chrome_javascript",
                 "browser_tabs": "get_windows_and_tabs",
                 "browser_press_key": "chrome_keyboard", "project": "iris"}
# Old browser_* tools with no honest chrome_* mapping → row quarantined.
QUARANTINE_TOOLS = {"browser_click", "browser_type", "browser_press_key",
                    "browser_wait_for", "browser_hover", "browser_select_option",
                    "browser_download", "browser_back"}

def grep_cmd(a):
    pat = a.get("pattern", ""); p = a.get("path", ".")
    return {"command": "grep -rn -- %s %s 2>/dev/null | head -20" % (shlex.quote(pat), shlex.quote(p))}

def glob_cmd(a):
    pat = a.get("pattern", "*"); p = a.get("path", ".")
    base = pat.split("/")[-1] if pat else "*"
    return {"command": "find %s -name %s -not -path '*/node_modules/*' 2>/dev/null | head -20" % (shlex.quote(p), shlex.quote(base))}

def edit_to_vulkan(cid, args, rid, result):
    """Edit call+result → vulkan dispatch, started, read_job_result, finished."""
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    args = args or {}
    fp = args.get("file_path", "the file")
    old = (args.get("old_string") or "").strip()
    new = (args.get("new_string") or "").strip()
    brief = ("TASK: Edit %s — replace %s with %s. Verify the file still parses/reads cleanly after the edit."
             % (fp, shlex.quote(old[:160]), shlex.quote(new[:160])))
    h = hashlib.md5(fp.encode()).hexdigest()[:4]
    job = "vulkan-ed%s" % h
    return [
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": rid, "type": "function",
                         "function": {"name": "vulkan", "arguments": {"task": brief}}}]},
        {"role": "tool", "tool_call_id": rid, "name": "vulkan",
         "content": "Vulkan %s started (urgent — its result will interrupt you when ready) — "
                    "the result will arrive in your inbox when it finishes." % job[8:]},
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": rid + "r", "type": "function",
                         "function": {"name": "read_job_result", "arguments": {"job_id": job}}}]},
        {"role": "tool", "tool_call_id": rid + "r", "name": "read_job_result",
         "content": "Vulkan %s finished. Edit applied to %s. %s" % (job[8:], fp, (result or "")[:400])},
    ]

def project_to_iris(cid, args, rid, result):
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    args = args or {}
    verb = {"create": "Create", "complete": "Mark complete", "update": "Update",
            "list": "List"}.get(str(args.get("action", "create")), "Create")
    title = args.get("title", "")
    due = args.get("due", "")
    text = "TASK: %s the work task '%s'" % (verb, title)
    if due:
        text += ", due %s" % due
    for k, v in args.items():
        if k in ("kind", "action", "title", "due"):
            continue
        if isinstance(v, str) and v:
            text += ", %s: %s" % (k, v)
    return [{"role": "assistant", "content": None,
             "tool_calls": [{"id": cid, "type": "function",
                             "function": {"name": "iris", "arguments": {"task": text}}}]},
            {"role": "tool", "tool_call_id": cid, "name": "iris",
             "content": result or "Work task recorded."}]

def cloud_to_vulkan(cid, args, rid, result):
    """escalate_to_cloud → vulkan: vulkan runs the cloud model now, so the
    deep-reasoning hand-off is a plain vulkan delegation. The cloud's answer
    becomes the finished job result."""
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    args = args or {}
    task = args.get("task") or args.get("input") or args.get("prompt") or str(args)
    h = hashlib.md5(task.encode()).hexdigest()[:4]
    job = "vulkan-cl" + h[:2] + h[3] if len(h) > 3 else "vulkan-cl" + h
    return [
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": rid, "type": "function",
                         "function": {"name": "vulkan", "arguments": {"task": task}}}]},
        {"role": "tool", "tool_call_id": rid, "name": "vulkan",
         "content": "Vulkan %s started (urgent — its result will interrupt you when ready) — "
                    "the result will arrive in your inbox when it finishes." % job[8:]},
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": rid + "r", "type": "function",
                         "function": {"name": "read_job_result", "arguments": {"job_id": job}}}]},
        {"role": "tool", "tool_call_id": rid + "r", "name": "read_job_result",
         "content": "Vulkan %s finished.\n%s" % (job[8:], (result or "")[:1200])},
    ]

def project_task_text(args):
    verb = {"create": "Create", "complete": "Mark complete", "update": "Update",
            "list": "List"}.get(str(args.get("action", "create")), "Create")
    title = args.get("title", "")
    due = args.get("due", "")
    text = "TASK: %s the work task '%s'" % (verb, title)
    if due:
        text += ", due %s" % due
    for k, v in args.items():
        if k in ("kind", "action", "title", "due"):
            continue
        if isinstance(v, str) and v:
            text += ", %s: %s" % (k, v)
    return text

def conv_call(name, args):
    """→ (new_name, new_args) or ("SKIP", None) when the row must be quarantined."""
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    args = args or {}
    if name in RENAME:
        a = dict(args)
        for k, v in KEYMAP[name].items():
            if k in a:
                a[v] = a.pop(k)
        return RENAME[name], a
    if name == "Grep":
        return "Bash", grep_cmd(args)
    if name == "Glob":
        return "Bash", glob_cmd(args)
    if name == "browser_navigate":
        return "chrome_navigate", dict(args)
    if name == "browser_evaluate":
        js = args.get("js", "")
        code = js if "return " in js else "return (%s);" % js
        return "chrome_javascript", {"code": code}
    if name == "browser_current_url":
        return "chrome_javascript", {"code": "return window.location.href;"}
    if name == "browser_tabs":
        if args.get("action", "list") == "list":
            return "get_windows_and_tabs", {}
        return "SKIP", None
    if name == "browser_press_key":
        return "chrome_keyboard", {"keys": args.get("key", args.get("keys", ""))}
    if name == "project":
        return "iris", {"task": project_task_text(args)}
    return ("SKIP", None) if name in QUARANTINE_TOOLS else (name, args)  # unknown → untouched

for old in glob.glob(os.path.join(BASE, "quarantine-*.jsonl")):
    os.remove(old)
totals = {"kept": 0, "transformed": 0, "quarantined": 0}
for f in sorted(glob.glob(os.path.join(BASE, "s*.jsonl"))):
    if "s28" in os.path.basename(f):
        continue  # born post-migration
    rows = [json.loads(l) for l in open(f) if l.strip()]
    out, quars = [], []
    for row in rows:
        msgs = row["messages"]
        bad = any(m.get("role") == "assistant" and any(
            (tc["function"]["name"] in QUARANTINE_TOOLS)
            for tc in (m.get("tool_calls") or [])) for m in msgs)
        if bad:
            quars.append(row)
            totals["quarantined"] += 1
            continue
        new_msgs, changed, skip = [], False, False
        i = 0
        while i < len(msgs):
            m = msgs[i]
            calls = m.get("tool_calls") or []
            edits = [tc for tc in calls if tc["function"]["name"] == "Edit"]
            projs = [tc for tc in calls if tc["function"]["name"] == "project"]
            clouds = [tc for tc in calls if tc["function"]["name"] == "escalate_to_cloud"]
            if m.get("role") == "assistant" and (edits or projs or clouds) and len(calls) == 1:
                tc = calls[0]
                rid = tc.get("id") or "call_m%d" % i
                result = msgs[i + 1].get("content") if i + 1 < len(msgs) and msgs[i + 1].get("role") == "tool" else ""
                if edits:
                    new_msgs.extend(edit_to_vulkan(rid, tc["function"]["arguments"], rid, result))
                elif clouds:
                    new_msgs.extend(cloud_to_vulkan(rid, tc["function"]["arguments"], rid, result))
                else:
                    new_msgs.extend(project_to_iris(rid, tc["function"]["arguments"], rid, result))
                i += 2
                changed = True
                continue
            if calls:
                for tc in calls:
                    nn, na = conv_call(tc["function"]["name"], tc["function"]["arguments"])
                    if nn == "SKIP":
                        skip = True
                        break
                    if nn != tc["function"]["name"] or na != tc["function"]["arguments"]:
                        tc["function"]["name"], tc["function"]["arguments"] = nn, na
                        changed = True
                if skip:
                    break
            # tool-result name field follows the same rename
            if m.get("role") == "tool" and m.get("name") in RESULT_RENAME:
                m["name"] = RESULT_RENAME[m["name"]]
                changed = True
            new_msgs.append(m)
            i += 1
        if skip:
            quars.append(row)
            totals["quarantined"] += 1
            continue
        out.append({"messages": new_msgs})
        totals["transformed" if changed else "kept"] += 1
    open(f, "w").write("\n".join(json.dumps(r, ensure_ascii=False) for r in out) + ("\n" if out else ""))
    if quars:
        qdir = os.path.join(BASE, "quarantine")
        os.makedirs(qdir, exist_ok=True)
        open(os.path.join(qdir, os.path.basename(f)), "w").write(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in quars) + "\n")
    print("%-14s kept=%d transformed=%d quarantined=%d" % (os.path.basename(f), totals["kept"] and 0 or 0, 0, 0) if False else
          "%-14s rows_out=%d quarantined=%d" % (os.path.basename(f), len(out), len(quars)))
print("TOTALS:", totals)
