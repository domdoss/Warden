#!/usr/bin/env python3
"""Append one activity entry to the Warden mobile journal."""
import json, sys, time
action = sys.argv[1] if len(sys.argv) > 1 else 'act'
text = sys.argv[2] if len(sys.argv) > 2 else ''
result = sys.argv[3] if len(sys.argv) > 3 else 'ok'
entry = {"ts": int(time.time() * 1000), "action": action, "text": text, "result": result}
with open('/opt/Warden/data/mobile-journal.jsonl', 'a') as f:
    f.write(json.dumps(entry) + '\n')
