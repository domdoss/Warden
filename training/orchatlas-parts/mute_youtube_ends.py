#!/usr/bin/env python3
# The live contract: a youtube call that touches the player ENDS the turn with
# an empty reply. Rows that put a narration line after such a result train the
# old talk-over behavior — blank them. Rows whose last youtube result is NOT
# player-touching (search results, now_playing, errors) keep their text.
import json, glob, os

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIRM_RE = ('Playing:', 'Resumed:', 'Paused:', 'Already playing:', 'Still playing:', 'Queued:')
n = 0
for f in sorted(glob.glob(os.path.join(BASE, 's*.jsonl'))) + sorted(glob.glob(os.path.join(BASE, 'orch-*.jsonl'))):
    rows = [json.loads(l) for l in open(f) if l.strip()]
    changed = False
    for row in rows:
        msgs = row['messages']
        if len(msgs) < 2:
            continue
        last = msgs[-1]
        if last['role'] != 'assistant' or not last.get('content'):
            continue
        prev = msgs[-2]
        if prev.get('role') == 'tool' and prev.get('name') == 'youtube':
            c = str(prev.get('content') or '').lstrip()
            if c.startswith(CONFIRM_RE):
                last['content'] = ''
                n += 1
                changed = True
    if changed:
        open(f, 'w').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
print('youtube-terminal rows silenced: %d' % n)
