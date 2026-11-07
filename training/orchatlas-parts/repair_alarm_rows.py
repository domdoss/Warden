#!/usr/bin/env python3
# Repairs rows that read alarms out of config/alarms.json with Bash/read_file.
#
# Alarms are iris's: one `{"intent": "list", ...}` brief returns them, and the
# seat never edits that file by hand. Rows are rewritten in place; the merged
# prompt, tool pairing and final answer are preserved.
#
# Also fixes s7-4 row 24, whose work-task brief was the literal string
# "the work task ''" — work tasks live in the seat's own `project` tool.
#
# Idempotent:
#   python3 repair_alarm_rows.py
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))

def load(f):
    return [json.loads(l) for l in open(os.path.join(BASE, f)) if l.strip()]

def save(f, rows):
    open(os.path.join(BASE, f), 'w').write(
        '\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')

def brief(intent, detail):
    return json.dumps({'intent': intent, 'detail': detail}, ensure_ascii=False)

def alarm_list(items):
    """iris list result shape, matching its other list results."""
    return json.dumps({'result': f'{len(items)} alarms configured:', 'items': items},
                      ensure_ascii=False)

WAKE = 'wake-weekday — 06:00 Mon-Fri ("wake up")'
TRASH = 'trash — 19:30 Tue ("put trash out")'
STANDUP = 'standup — 09:15 Mon/Wed/Fri ("standup")'
MORNING = 'morning — 07:00 Mon-Fri'
WED_STANDUP = 'standup — 09:30 Wed'
ANNIV = 'anniversary — 08:00 on 2026-10-04'

# (file, row, ask-detail, items, final answer)
FIXES = [
    ('s10-1.jsonl', 5, 'the alarm entries currently set, including the 6am wake entry',
     [WAKE, TRASH, STANDUP],
     'Still there — wake-weekday at 6:00, Monday to Friday. Trash is Tuesday 19:30 and standup is 09:15 Mon-Wed-Fri.'),
    ('s10-2.jsonl', 5, 'all alarms currently configured',
     [WAKE, TRASH, STANDUP],
     'Three alarms: 6am wake on weekdays, trash Tuesday at 7:30pm, and standup at 9:15 on Mon-Wed-Fri.'),
    ('s10-4.jsonl', 5, 'the trash alarm and the days it runs',
     [WAKE, TRASH, STANDUP],
     'Tuesdays at 7:30 in the evening.'),
    ('s12-1.jsonl', 5, 'all alarms currently configured',
     [MORNING, WED_STANDUP, TRASH, ANNIV],
     'Four alarms: 7am on weekdays, standup Wednesdays at 9:30, trash Tuesday evenings at 7:30, and an anniversary alarm October 4 at 8am.'),
]

def uses_iris(row):
    return any(t['function']['name'] == 'iris'
               for m in row['messages'] for t in (m.get('tool_calls') or []))

for f, n, detail, items, answer in FIXES:
    rows = load(f)
    row = rows[n - 1]
    if uses_iris(row):
        print(f'{f} row {n} already uses iris')
        continue
    msgs = row['messages']
    user = next(m for m in msgs if m['role'] == 'user')
    rows[n - 1] = {'messages': [
        msgs[0],
        user,
        {'role': 'assistant', 'tool_calls': [
            {'type': 'function', 'function': {'name': 'iris', 'arguments': {'task': brief('list', detail)}}}]},
        {'role': 'tool', 'name': 'iris', 'content': alarm_list(items)},
        {'role': 'assistant', 'content': answer},
    ]}
    save(f, rows)
    print(f'{f} row {n} rewritten to iris')

# --- s7-4 row 24: work tasks → project, alarms → iris ---
rows = load('s7-4.jsonl')
row = rows[23]
broken = any('the work task' in str(t['function']['arguments'])
             for m in row['messages'] for t in (m.get('tool_calls') or []))
if broken:
    user = next(m for m in row['messages'] if m['role'] == 'user')
    rows[23] = {'messages': [
        row['messages'][0],
        user,
        {'role': 'assistant', 'tool_calls': [
            {'type': 'function', 'function': {'name': 'project',
                                              'arguments': {'kind': 'task', 'action': 'list'}}}]},
        {'role': 'tool', 'name': 'project', 'content':
            'atask-841 | in_progress | Prep demo script\n'
            'atask-822 | open | Fix voice app reconnect noise\n'
            'atask-799 | open | Update README screenshots'},
        {'role': 'assistant', 'tool_calls': [
            {'type': 'function', 'function': {'name': 'iris',
                                              'arguments': {'task': brief('list', 'all alarms currently configured')}}}]},
        {'role': 'tool', 'name': 'iris', 'content': alarm_list([WAKE, TRASH, STANDUP])},
        {'role': 'assistant', 'content':
            'Open tasks: demo script prep, the voice app reconnect noise and the README screenshots. '
            'Alarms: 6am wake weekdays, trash Tuesday 7:30pm, standup 9:15 Mon-Wed-Fri.'},
    ]}
    save('s7-4.jsonl', rows)
    print('s7-4 row 24 repaired')
else:
    print('s7-4 row 24 already repaired')
