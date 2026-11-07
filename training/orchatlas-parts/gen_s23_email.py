#!/usr/bin/env python3
# Regenerates s23-1.jsonl: the "draft my email reply" conversation slice.
#
# The 2026-09 slice taught the seat to hand reply-drafting to vulkan and then
# chase the draft through read_job_result / Bash / report_task_failure. Drafting
# is text work the seat owns: it composes the reply with write_file in ~/Warden
# drafts, revises it in place, and only hands the finished body to iris to send.
# vulkan stays for code and multi-minute builds.
#
#   python3 gen_s23_email.py && python3 normalize_iris_intents.py
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
ANCHOR = 'Current local time is 2026-09-18T12:05:00 (timezone America/Vancouver).'
DRAFTS = '/home/dominic/Warden/drafts'

def call(i, name, args):
    return {'role': 'assistant', 'tool_calls': [
        {'id': f'call_{i}', 'type': 'function', 'function': {'name': name, 'arguments': args}}]}

def result(i, name, content):
    return {'role': 'tool', 'tool_call_id': f'call_{i}', 'name': name, 'content': content}

def numbered(text):
    return '\n'.join(f'{i:6d}\t{line}' for i, line in enumerate(text.split('\n'), 1))

def write_res(path, text):
    return f'The file {path} was written ({text.count(chr(10)) + 1} lines).'

def send_res(addr, subject):
    return json.dumps({'result': f'Email sent to {addr} — Subject: {subject}.', 'items': []},
                      ensure_ascii=False)

def brief(intent, detail):
    return json.dumps({'intent': intent, 'detail': detail}, ensure_ascii=False)

def row(ask, body, steps=()):
    """One conversation. `body` is the drafted reply; `steps` = extra calls after
    the draft (each ('read'|'rewrite'|'send', ...))."""
    msgs = [
        {'role': 'system', 'content': 'MERGE-STAMPS-THE-LIVE-PROMPT'},
        {'role': 'user', 'content': ANCHOR + '\n\n' + ask},
    ]
    n = 0

    def next_id():
        nonlocal n
        n += 1
        return n

    for step in steps:
        kind = step[0]
        i = next_id()
        if kind == 'draft':
            path, content = step[1], step[2]
            msgs.append(call(i, 'write_file', {'path': path, 'content': content}))
            msgs.append(result(i, 'write_file', write_res(path, content)))
        elif kind == 'read':
            path, content = step[1], step[2]
            msgs.append(call(i, 'read_file', {'path': path}))
            msgs.append(result(i, 'read_file', numbered(content)))
        elif kind == 'send':
            addr, subject, content = step[1], step[2], step[3]
            msgs.append(call(i, 'iris', {'task': brief(
                'send', f'an email to {addr} with subject "{subject}" and this body: "{content}"')}))
            msgs.append(result(i, 'iris', send_res(addr, subject)))
        else:
            raise ValueError(kind)
    msgs.append({'role': 'assistant', 'content': body})
    return {'messages': msgs}

def draft(name):
    return os.path.join(DRAFTS, name)

ROWS = [
    # 1 — fence quote: compose, confirm with the user
    row('Draft a reply to Marco about the fence quote — take the $3,400 option, and say I\'ll confirm the start date tomorrow.',
        'Drafted it — ~/Warden/drafts/marco-fence-reply.txt. It takes the $3,400 option and says you\'ll confirm the start date tomorrow. Want me to send it?',
        [('draft', draft('marco-fence-reply.txt'),
          'Hi Marco,\n\nThanks for the quote. We\'ll go with the $3,400 option on the fence.\nI\'ll confirm the start date tomorrow once I\'ve checked the schedule.\n\nBest,\nDominic')]),
    # 2 — JP meeting acceptance
    row('can u get a response written back to JP accepting the new Thursday 10am meeting',
        'Written to ~/Warden/drafts/jp-meeting-reply.txt — it accepts Thursday 10am and says you\'ll bring the signed forms.',
        [('draft', draft('jp-meeting-reply.txt'),
          'Hi JP,\n\nThursday 10am works great on my end for the meeting.\nI\'ll bring the signed forms.\n\nSee you then,\nDominic')]),
    # 3 — Dana budget review
    row('JP finally got back to me about the budget review — draft a reply saying Thursday works for me.',
        'Drafted — ~/Warden/drafts/dana-budget-reply.txt. It confirms Thursday works for the budget review.',
        [('draft', draft('dana-budget-reply.txt'),
          'Hi Dana,\n\nThanks for waiting on me. Thursday works for the budget review.\nAny time after 1pm is good on my end.\n\nDominic')]),
    # 4 — recruiter phone screen
    row('draft a reply to the recruiter from Sarah — Friday after 2pm works for the phone screen.',
        'Drafted — ~/Warden/drafts/recruiter-reply.txt. It says Friday after 2pm works for the phone screen.',
        [('draft', draft('recruiter-reply.txt'),
          'Hi Sarah,\n\nThanks for reaching out. Friday after 2pm works fine for the phone screen.\n\nDominic')]),
    # 5 — landlord plumber visit
    row('Draft my reply to the landlord — Tuesday 9am works for the plumber visit and I\'ll be home.',
        'Drafted — ~/Warden/drafts/landlord-reply.txt. It confirms Tuesday 9am for the plumber visit and that you\'ll be home.',
        [('draft', draft('landlord-reply.txt'),
          'Hi Renata,\n\nAs per our conversation earlier, Tuesday 9am works for the plumber visit.\nI\'ll be home to let him in.\n\nDominic')]),
    # 6 — strata parking stall
    row('need a reply written to the strata about taking parking stall 22.',
        'Written to ~/Warden/drafts/strata-parking-reply.txt — it asks to take parking stall 22 and offers the deposit right away.',
        [('draft', draft('strata-parking-reply.txt'),
          'Hi Cheryl,\n\nI\'d like to take parking stall 22 at the rate you listed.\nI can drop off the deposit this week.\n\nDominic')]),
    # 7 — dentist
    row('I keep forgetting to reply to the dentist — confirm the cleaning appointment for the 29th at 8:30.',
        'Drafted — ~/Warden/drafts/dentist-reply.txt. It confirms the cleaning on the 29th at 8:30.',
        [('draft', draft('dentist-reply.txt'),
          'Hi,\n\nI\'d like to confirm my cleaning appointment for the 29th at 8:30am.\n\nThanks,\nDominic')]),
    # 8 — Chris hockey ice time
    row('Draft a reply to Chris confirming our team takes the Thursday ice slot.',
        'Drafted — ~/Warden/drafts/chris-hockey-reply.txt. It confirms the Thursday ice slot for the team.',
        [('draft', draft('chris-hockey-reply.txt'),
          'Hi Chris,\n\nOur team will take the Thursday ice slot.\nSee you at the rink.\n\nDominic')]),
    # 9 — revise an existing draft (read then rewrite)
    row('The JP acceptance draft reads a bit stiff — warm it up but keep the Thursday 10am confirmation.',
        'Revised — ~/Warden/drafts/jp-acceptance-reply.txt. Same Thursday 10am confirmation, warmer opening.',
        [('read', draft('jp-acceptance-reply.txt'),
          'Hi JP,\n\nThis is to confirm that Thursday 10am is acceptable for the acceptance meeting.\n\nDominic'),
         ('draft', draft('jp-acceptance-reply.txt'),
          'Hi JP,\n\nGreat news — Thursday 10am works perfectly on my end for the acceptance meeting.\nI\'ll bring the signed forms.\n\nSee you then,\nDominic')]),
    # 10 — draft then send (accountant)
    row('reply to Priya at the accountant about dropping off the receipts binder — Saturday morning works.',
        'Sent — Priya has the confirmation that Saturday morning works for the receipts binder.',
        [('draft', draft('accountant-reply.txt'),
          'Hi Priya,\n\nSaturday morning works — I\'ll drop off the receipts binder around 10am.\n\nDominic'),
         ('send', 'priya.nair@brightbooks.ca', 'Re: receipts binder drop-off',
          'Hi Priya,\\n\\nSaturday morning works — I\'ll drop off the receipts binder around 10am.\\n\\nDominic')]),
    # 11 — city noise permit
    row('ey does the reply to the city about the noise permit have the variance dates in it? Draft it if not.',
        'Drafted — ~/Warden/drafts/city-noise-reply.txt. It states the variance runs 2026-10-01 to 2026-10-14.',
        [('draft', draft('city-noise-reply.txt'),
          'Hello,\n\nRe the noise permit variance for our renovation at 42 Fisher Lane: the work runs from 2026-10-01 to 2026-10-14, weekdays 8am to 5pm.\n\nDominic')]),
    # 12 — Megan site visit
    row('Megan asked about the site visit — write back that the 24th works.',
        'Drafted — ~/Warden/drafts/megan-site-visit-reply.txt. It confirms the 24th for the site visit.',
        [('draft', draft('megan-site-visit-reply.txt'),
          'Hi Megan,\n\nYes, the 24th works for the site visit.\nI\'ll be there from 9am.\n\nDominic')]),
    # 13 — neighbour fence line, revise
    row('hey that reply to my neighbour Tom about the fence line — make it clearer that the surveyor\'s pins are the boundary.',
        'Updated — ~/Warden/drafts/neighbour-reply.txt now says the surveyor\'s pins mark the boundary, not the old hedge line.',
        [('read', draft('neighbour-reply.txt'),
          'Hi Tom,\n\nSorry again for the confusion over the fence line.\nI think we should sort out the boundary before any work starts.\n\nDominic'),
         ('draft', draft('neighbour-reply.txt'),
          'Hi Tom,\n\nSorry again for the confusion over the fence line.\nThe surveyor\'s pins are the boundary — the old hedge line is not.\nHappy to walk it with you this weekend.\n\nDominic')]),
    # 14 — insurance claim
    row('did the reply to the insurance guy with claim number CLM-88421 ever get drafted? If not, draft it.',
        'Drafted — ~/Warden/drafts/insurance-reply.txt. It quotes claim CLM-88421 and asks for the adjuster\'s next step.',
        [('draft', draft('insurance-reply.txt'),
          'Hi,\n\nRe claim CLM-88421: the contractor\'s estimate is attached.\nCould you confirm the next step and the adjuster\'s timeline?\n\nDominic')]),
    # 15 — city parking permit renewal, draft then send
    row('draft the reply to the city parking office renewing permit P-2261, then send it.',
        'Sent — the parking office has the P-2261 renewal and the payment reference.',
        [('draft', draft('parking-permit-reply.txt'),
          'Hello,\n\nPlease renew residential parking permit P-2261 for another year.\nPayment reference: PRK-5521.\n\nDominic'),
         ('send', 'city.parking@sheridan.example', 'Re: permit P-2261 renewal',
          'Hello,\\n\\nPlease renew residential parking permit P-2261 for another year.\\nPayment reference: PRK-5521.\\n\\nDominic')]),
]

out = os.path.join(BASE, 's23-1.jsonl')
with open(out, 'w') as fh:
    for r in ROWS:
        fh.write(json.dumps(r, ensure_ascii=False) + '\n')
print(f'wrote {len(ROWS)} rows to {out}')
