#!/usr/bin/env python3
# Normalize every iris brief's `intent` to the documented enum
# (read|send|download|schedule|list|create|update|delete), matching the live
# tool schema (container/agent-runner/src/index.ts: "intent (read|send|download|
# schedule|list|create|update|delete)").
#
# The part generators write briefs as human "TASK: <verb> <rest>" strings and
# older parts carry ad-hoc verbs ("set", "reply", "check", "search", ...).
# This pass is idempotent and deterministic:
#   - a brief that parses as JSON keeps every key; only `intent` is remapped;
#   - a "TASK: <verb> <rest>" brief becomes {"intent": <enum>, "detail": rest}.
# Run it whenever parts are regenerated from a generator that emits raw verbs.
#
#   python3 normalize_iris_intents.py
import json, glob, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))

ENUM = {'read', 'send', 'download', 'schedule', 'list', 'create', 'update', 'delete'}
# Ad-hoc verb → documented intent. One action per brief; the enum is singular.
VERB_MAP = {
    'read': 'read', 'send': 'send', 'download': 'download', 'schedule': 'schedule',
    'list': 'list', 'create': 'create', 'update': 'update', 'delete': 'delete',
    'set': 'schedule', 'add': 'create', 'create': 'create',
    'reply': 'send', 'forward': 'send', 'email': 'send', 'tell': 'send',
    'check': 'read', 'find': 'read', 'search': 'read', 'scan': 'read',
    'summarize': 'read', 'report': 'read', 'confirm': 'read',
    'count': 'list', 'break': 'list',
    'archive': 'update', 'flag': 'update', 'move': 'update',
    'fix': 'update', 'change': 'update',
    'cancel': 'delete', 'unsubscribe': 'delete',
}

def map_intent(verb):
    v = (verb or '').strip().lower()
    if v in ENUM:
        return v
    return VERB_MAP.get(v)

def normalize_brief(task):
    """Return (new_task, changed). Idempotent."""
    t = task.lstrip()
    if t.startswith('{'):
        try:
            d = json.loads(task)
        except Exception:
            return task, False
        if not isinstance(d, dict):
            return task, False
        cur = d.get('intent')
        new = map_intent(cur)
        if new is None:
            print('  WARNING: unmapped intent %r — leaving unchanged' % (cur,), file=sys.stderr)
            return task, False
        if new == cur:
            return task, False
        d['intent'] = new
        return json.dumps(d, ensure_ascii=False), True
    # "TASK: <verb> <rest>" / bare "<verb> <rest>"
    body = re.sub(r'^TASK:\s*', '', task.strip(), flags=re.I)
    word, _, rest = body.partition(' ')
    new = map_intent(word)
    if new is None:
        print('  WARNING: unmapped verb %r — leaving unchanged' % (word,), file=sys.stderr)
        return task, False
    return json.dumps({'intent': new, 'detail': rest.strip()}, ensure_ascii=False), True

changed_files = changed_briefs = 0
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
                    try:
                        a = json.loads(a)
                    except Exception:
                        continue
                    tc['function']['arguments'] = a
                if not isinstance(a, dict):
                    continue
                # Accept the documented bare-object form too.
                for key in ('task', 'brief'):
                    if isinstance(a.get(key), str):
                        nt, ch = normalize_brief(a[key])
                        if ch:
                            a[key] = nt
                            changed = True
                            changed_briefs += 1
                if 'intent' in a:
                    new = map_intent(a['intent'])
                    if new and new != a['intent']:
                        a['intent'] = new
                        changed = True
                        changed_briefs += 1
    if changed:
        open(f, 'w').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
        changed_files += 1
print('normalized %d brief(s) across %d file(s)' % (changed_briefs, changed_files))
