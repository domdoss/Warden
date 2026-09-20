#!/usr/bin/env python3
# Iris JSON flip: the delegation edge to iris is now JSON in / JSON out.
#   briefs "TASK: <verb> <rest>" → {"intent": "<verb>", "detail": "<rest>"}
#   iris results (prose line)    → {"result": "<line>"}
# Idempotent: briefs already starting {"intent" and results already JSON are
# left alone.
import json, glob, os

BASE = os.path.dirname(os.path.abspath(__file__))
n_briefs = n_results = 0

def conv_brief(task):
    global n_briefs
    if task.lstrip().startswith('{"intent"'):
        return task
    t = task.strip()
    if t.upper().startswith('TASK:'):
        t = t[5:].strip()
    words = t.split(' ', 1)
    intent = words[0].lower()
    detail = words[1] if len(words) > 1 else ''
    n_briefs += 1
    return json.dumps({"intent": intent, "detail": detail}, ensure_ascii=False)

def flatten(t):
    return ' '.join(str(t).split())

def conv_result(content):
    global n_results
    c = (content or '').strip()
    if c.startswith('{"result"'):
        # Re-flatten already-wrapped rows: json.dumps escaped newlines as
        # literal \n sequences — actual spaces instead.
        try:
            d = json.loads(c)
        except Exception:
            return content
        flat = flatten(d.get('result', ''))
        n_results += 1
        return json.dumps({"result": flat, "items": d.get('items', [])}, ensure_ascii=False)
    n_results += 1
    return json.dumps({"result": flatten(c)}, ensure_ascii=False)

for f in sorted(glob.glob(os.path.join(BASE, 's*.jsonl'))):
    rows = [json.loads(l) for l in open(f) if l.strip()]
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
                if isinstance(a, dict) and isinstance(a.get('task'), str):
                    nt = conv_brief(a['task'])
                    if nt != a['task']:
                        a['task'] = nt
                        tc['function']['arguments'] = a
                        changed = True
            if m.get('role') == 'tool' and m.get('name') == 'iris':
                nc = conv_result(m.get('content'))
                if nc != m.get('content'):
                    m['content'] = nc
                    changed = True
    if changed:
        open(f, 'w').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
print('iris briefs converted: %d, results converted: %d' % (n_briefs, n_results))
