#!/usr/bin/env python3
# Repairs the two remaining rows that hand text work to vulkan.
#
#   s8-3.jsonl   row 4  — city permit appeal letter: the seat writes it.
#   s24-1.jsonl  row 18 — tidy the drafts folder: the seat lists it and asks
#                         before deleting anything.
#
# Idempotent: rows already repaired are detected and left alone.
#
#   python3 repair_drafting_rows.py
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))

def load(f):
    return [json.loads(l) for l in open(os.path.join(BASE, f)) if l.strip()]

def save(f, rows):
    open(os.path.join(BASE, f), 'w').write(
        '\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')

def call(i, name, args):
    return {'role': 'assistant', 'tool_calls': [
        {'id': i, 'type': 'function', 'function': {'name': name, 'arguments': args}}]}

def result(i, name, content):
    return {'role': 'tool', 'tool_call_id': i, 'name': name, 'content': content}

def uses_vulkan(row):
    return any(t['function']['name'] == 'vulkan'
               for m in row['messages'] for t in (m.get('tool_calls') or []))

# --- s8-3 row 4: appeal letter, written by the seat ---
PERMIT_PATH = '/home/dominic/Warden/letters/park-permit-appeal.txt'
PERMIT_TEXT = (
    'To the City Parks and Recreation Permitting Office,\n'
    '\n'
    'Re: appeal of the denial of park event permit P-2291\n'
    '\n'
    'I am writing to appeal the September 29 denial of permit application P-2291, '
    'which cited incomplete insurance documentation.\n'
    'We submitted the certificate of insurance on September 20 and hold the '
    'confirmation email for that submission.\n'
    '\n'
    'Please reinstate permit P-2291, or advise in writing what remains outstanding, '
    'within the 30-day appeal window.\n'
    '\n'
    'Thank you,\n'
    'Dominic'
)

rows = load('s8-3.jsonl')
if len(rows) >= 4 and uses_vulkan(rows[3]):
    ask = rows[3]['messages'][1]['content']
    rows[3] = {'messages': [
        rows[3]['messages'][0],
        {'role': 'user', 'content': ask},
        call('call_p1', 'write_file', {'path': PERMIT_PATH, 'content': PERMIT_TEXT}),
        result('call_p1', 'write_file',
               f'The file {PERMIT_PATH} was written ({PERMIT_TEXT.count(chr(10)) + 1} lines).'),
        {'role': 'assistant', 'content':
         'Your appeal letter is written — ~/Warden/letters/park-permit-appeal.txt. '
         'It leads with the September 20 submission and asks them to reinstate P-2291 '
         'within the appeal window. Ready to send.'},
    ]}
    save('s8-3.jsonl', rows)
    print('s8-3 row 4 repaired')
else:
    print('s8-3 row 4 already repaired')

# --- s24-1 row 18: drafts-folder cleanup, seat lists it first ---
rows = load('s24-1.jsonl')
if len(rows) >= 18 and uses_vulkan(rows[17]):
    ask = rows[17]['messages'][1]['content']
    listing = (
        '/home/dominic/Warden/drafts/\n'
        'marco-fence-reply.txt\n'
        'jp-meeting-reply.txt\n'
        'dana-budget-reply.txt\n'
        'recruiter-reply.txt\n'
        'landlord-reply.txt\n'
        'strata-parking-reply.txt\n'
        'dentist-reply.txt\n'
        'chris-hockey-reply.txt\n'
        'jp-acceptance-reply.txt\n'
        'accountant-reply.txt\n'
        'city-noise-reply.txt\n'
        'megan-site-visit-reply.txt'
    )
    rows[17] = {'messages': [
        rows[17]['messages'][0],
        {'role': 'user', 'content': ask},
        call('call_d1', 'Bash', {'command': 'ls -1t /home/dominic/Warden/drafts'}),
        result('call_d1', 'Bash', listing),
        {'role': 'assistant', 'content':
         'There are 12 drafts in ~/Warden/drafts. Sending is one word away, so tell me which '
         'ones are stale and I\'ll clear them out.'},
    ]}
    save('s24-1.jsonl', rows)
    print('s24-1 row 18 repaired')
else:
    print('s24-1 row 18 already repaired')
