#!/usr/bin/env python3
# Rewrite iris tool results with real structure, no escaped-newline sequences
# and no flattening: recover the pre-JSON prose rows from git (62ed2f6, after
# the tool-name migration, before the iris JSON wrap), then wrap each result
# as {"result": "<first line>", "items": ["<each further line>", ...]} — the
# items array carries multi-line lists as real strings, one per line.
import json, glob, os, subprocess

BASE = os.path.dirname(os.path.abspath(__file__))
GIT_REV = '62ed2f6'
n = 0

def wrap_result(content):
    lines = [l.strip() for l in str(content).splitlines() if l.strip()]
    if not lines:
        return json.dumps({"result": ""}, ensure_ascii=False)
    head = lines[0]
    if head.upper().startswith('TASK:'):
        head = head[5:].strip()
    items = lines[1:]
    # Split any enumeration baked into one line ("1. a 2. b") stays as-is —
    # only REAL newlines become items.
    return json.dumps({"result": head, "items": items}, ensure_ascii=False)

for f in sorted(glob.glob(os.path.join(BASE, 's*.jsonl'))):
    rel = os.path.relpath(f, '/opt/Warden')
    old = subprocess.run(['git', 'show', f'{GIT_REV}:{rel}'], capture_output=True, text=True, cwd='/opt/Warden')
    if old.returncode != 0:
        continue  # born after that rev (s28 etc.) — nothing to recover
    rows = [json.loads(l) for l in old.stdout.splitlines() if l.strip()]
    changed = False
    for row in rows:
        for m in row['messages']:
            for tc in (m.get('tool_calls') or []):
                if tc['function']['name'] != 'iris':
                    continue
                a = tc['function']['arguments']
                if isinstance(a, str):
                    try: a = json.loads(a)
                    except Exception: continue
                if isinstance(a, dict) and isinstance(a.get('task'), str) and not a['task'].lstrip().startswith('{"intent"'):
                    t = a['task'].strip()
                    if t.upper().startswith('TASK:'):
                        t = t[5:].strip()
                    w = t.split(' ', 1)
                    a['task'] = json.dumps({"intent": w[0].lower(), "detail": w[1] if len(w) > 1 else ''}, ensure_ascii=False)
                    changed = True
            if m.get('role') == 'tool' and m.get('name') == 'iris':
                m['content'] = wrap_result(m.get('content'))
                changed = True
    if changed:
        open(f, 'w').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
        n += 1
print('part files rewritten from %s with result+items split: %d' % (GIT_REV, n))
