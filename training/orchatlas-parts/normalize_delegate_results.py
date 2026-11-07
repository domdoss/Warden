#!/usr/bin/env python3
# Normalize every delegate start result and read_job_result result in the part
# files to the strings the live runner actually emits.
#
# Ground truth: orchatlas-parts/_internals.md, "Job supervision — verbatim
# result shapes". Job ids are 4 chars of base36; delegate ids are
# `<agent>-<short>`.
#
#   start (vulkan / sentry / atlas_background):
#     Vulkan q8vb started — running. Result arrives in your inbox.
#     Reply: running, result on the way. End your turn.
#   start (artemis, urgent):
#     Artemis a7f2 started (urgent — its result will interrupt you when ready)
#     — the audit result will arrive in your inbox. (job id: artemis-a7f2)
#   read_job_result (found):
#     artemis-a7f2 (artemis, done) — task: "<the task it was given>"
#
#     <the full result text>
#   read_job_result (unknown):
#     No stored result for "atlas-zzzz". Results live for this runner session
#     only — use read_job_result with no arguments to list what is available.
#
# Idempotent and deterministic: ids are recovered from the row where present and
# otherwise derived from a hash of (agent, task), so a re-run changes nothing.
#
#   python3 normalize_delegate_results.py
import json, glob, os, re, hashlib

BASE = os.path.dirname(os.path.abspath(__file__))
AGENTS = {'vulkan', 'artemis', 'sentry', 'atlas_background'}
ALNUM36 = '0123456789abcdefghijklmnopqrstuvwxyz'

def short_of(text, agent):
    m = re.search(re.escape(agent) + r'-([a-z0-9]{4})\b', text or '')
    if m:
        return m.group(1)
    return None

def gen_short(agent, task):
    h = int(hashlib.sha1(f'{agent}|{task}'.encode()).hexdigest(), 16) % (36 ** 4)
    out = ''
    for _ in range(4):
        h, r = divmod(h, 36)
        out = ALNUM36[r] + out
    return out

def start_text(agent, short, urgent, job_id):
    label = {'vulkan': 'Vulkan', 'artemis': 'Artemis', 'sentry': 'Sentry',
             'atlas_background': 'Atlas'}[agent]
    u = ' (urgent — its result will interrupt you when ready)' if urgent else ''
    if agent == 'artemis':
        return (f'{label} {short} started{u} — the audit result will arrive in your inbox. '
                f'(job id: {job_id})')
    return (f'{label} {short} started{u} — running. Result arrives in your inbox. '
            f'Reply: running, result on the way. End your turn.')

PREFIXES = [
    re.compile(r'^(?:Vulkan|Atlas|Sentry|Artemis)\s+[a-z0-9-]{1,12}\s+(?:finished|completed|complete|FAILED|failed)\b(?:\s*\([^)]*\))?[\s.:—–-]*', re.I),
    re.compile(r'^Job\s+[a-z_]+-[a-z0-9]{1,12}\s+finished:\s*', re.I),
    re.compile(r'^Artemis audit complete for [^.:]*\.\s*', re.I),
    re.compile(r'^Sentry scan complete:?\s*', re.I),
]
TAIL_JOBID = re.compile(r'\s*Job id:\s*[a-z_]+-[a-z0-9]{1,12}\.?\s*$', re.I)

def body_of(text):
    b = text.strip()
    for p in PREFIXES:
        b = p.sub('', b)
        b = b.lstrip()
    b = TAIL_JOBID.sub('', b).strip()
    if len(b) >= 2 and b[0] == "'" and b[-1] == "'":
        b = b[1:-1].strip()
    return b

def user_ask(msgs):
    for m in reversed(msgs):
        if m.get('role') != 'user':
            continue
        lines = [l for l in str(m.get('content') or '').split('\n')
                 if l.strip() and not l.lower().startswith('[inbox]')
                 and not l.startswith('Current local time is')]
        if lines:
            return lines[-1].strip()
    return 'the delegated task'

def norm_row(row):
    msgs = row['messages']
    calls = []  # delegate calls in order
    for m in msgs:
        for t in (m.get('tool_calls') or []):
            fn = t.get('function') or {}
            if fn.get('name') in AGENTS:
                a = fn.get('arguments')
                if isinstance(a, str):
                    try: a = json.loads(a)
                    except Exception: a = {}
                calls.append({'agent': fn['name'], 'task': str((a or {}).get('task', '')),
                              'tool': t, 'short': None, 'used': False})
    # first pass: pair starts with calls to learn the row's short ids
    for m in msgs:
        if m.get('role') != 'tool' or m.get('name') not in AGENTS:
            continue
        c = str(m.get('content') or '')
        if 'started' not in c:
            continue
        agent = m['name']
        nxt = next((k for k in calls if k['agent'] == agent and not k['used']), None)
        if nxt:
            nxt['used'] = True
            sh = short_of(c, agent) or gen_short(agent, nxt['task'])
            nxt['short'] = sh
        else:
            sh = short_of(c, agent) or gen_short(agent, c)
            calls.append({'agent': agent, 'task': user_ask(msgs), 'tool': None,
                          'short': sh, 'used': True})
    # second pass: rewrite starts, consuming each agent's records in order
    queues = {}
    for k in calls:
        queues.setdefault(k['agent'], []).append(k)
    for m in msgs:
        if m.get('role') != 'tool' or m.get('name') not in AGENTS:
            continue
        c = str(m.get('content') or '')
        if 'started' not in c:
            continue
        agent = m['name']
        rec = queues.get(agent, [None]).pop(0) if queues.get(agent) else None
        if rec is None:
            continue
        urgent = 'urgent' in c
        rec['job_id'] = f"{agent}-{rec['short']}"
        m['content'] = start_text(agent, rec['short'], urgent, rec['job_id'])
    # third pass: read_job_result calls — resolve each to a record, keep order
    rjr_recs = []
    rjr_fns = []
    for m in msgs:
        for t in (m.get('tool_calls') or []):
            fn = t.get('function') or {}
            if fn.get('name') != 'read_job_result':
                continue
            rjr_fns.append(fn)
            a = fn.get('arguments')
            if isinstance(a, str):
                try: a = json.loads(a)
                except Exception: a = {}
            a = a if isinstance(a, dict) else {}
            jid = str(a.get('job_id', '') or '').strip()
            rec = None
            if jid:
                base = jid.split('-')[-1]
                rec = next((k for k in calls if k.get('short') == base or k.get('job_id') == jid), None)
            if rec is None and len(calls) == 1:
                rec = calls[0]
            if rec is None:
                rec = next((k for k in reversed(calls) if k.get('short')), None)
            if rec is not None:
                rec['job_id'] = rec.get('job_id') or f"{rec['agent']}-{rec['short']}"
                a['job_id'] = rec['job_id']
                fn['arguments'] = a
            rjr_recs.append(rec)

    # fourth pass: rewrite read_job_result results, consuming recs in order
    ri = 0
    for m in msgs:
        if m.get('role') != 'tool' or m.get('name') != 'read_job_result':
            continue
        c = str(m.get('content') or '')
        rec = rjr_recs[ri] if ri < len(rjr_recs) else None
        ri += 1
        if rec is None:
            # follow-up turn: no delegate call in the row — recover agent/short
            # from the old result text itself.
            mo = re.match(r'^(Vulkan|Atlas|Sentry|Artemis)\s+([a-z0-9]{1,12})\s+(?:finished|completed|complete|FAILED|failed)\b', c, re.I)
            mj = re.match(r'^Job\s+([a-z_]+)-([a-z0-9]{1,12})\s+(?:finished|FAILED|failed)\b', c, re.I)
            if mo:
                agent = {'vulkan': 'vulkan', 'atlas': 'atlas_background',
                         'sentry': 'sentry', 'artemis': 'artemis'}[mo.group(1).lower()]
                short = mo.group(2)
            elif mj:
                agent, short = mj.group(1), mj.group(2)
            else:
                agent = short = None
            if agent:
                if len(short) > 4:
                    short = gen_short(agent, c)
                rec = {'agent': agent, 'short': short, 'task': user_ask(msgs),
                       'tool': None, 'used': True, 'job_id': f'{agent}-{short}'}
                calls.append(rec)
                fn = rjr_fns[ri - 1] if ri - 1 < len(rjr_fns) else None
                if fn is not None:
                    a = fn.get('arguments')
                    if not isinstance(a, dict):
                        a = {}
                    a['job_id'] = rec['job_id']
                    fn['arguments'] = a
        if c.startswith('No stored result for'):
            # The id the seat asked for is part of the result — keep it.
            want = ''
            fn = rjr_fns[ri - 1] if ri - 1 < len(rjr_fns) else None
            if fn is not None:
                a = fn.get('arguments')
                if isinstance(a, dict):
                    want = str(a.get('job_id', '') or '')
            if not want:
                mo_old = re.search(r'No stored result for "([^"]*)"', c)
                want = mo_old.group(1) if mo_old else 'atlas-zzzz'
            m['content'] = (f'No stored result for "{want}". Results live for this runner session '
                            'only — use read_job_result with no arguments to list what is available.')
            continue
        if rec is None or not rec.get('short'):
            continue
        agent, short = rec['agent'], rec['short']
        jid = rec.get('job_id') or f'{agent}-{short}'
        if re.match(rf'^{re.escape(jid)} \({re.escape(agent)}, ', c):
            continue  # already live
        body = body_of(c)
        if not body:
            continue
        task = rec['task'].replace('"', "'") if rec['task'] else user_ask(msgs)
        m['content'] = f'{jid} ({agent}, done) — task: "{task}"\n\n{body}'

    # keep user-visible `[inbox] Vulkan q7tf finished.` lines consistent with the ids
    for m in msgs:
        if m.get('role') != 'user':
            continue
        def fix(mo):
            label, sh = mo.group(1), mo.group(2)
            agent = {'Vulkan': 'vulkan', 'Atlas': 'atlas_background',
                     'Sentry': 'sentry', 'Artemis': 'artemis'}[label]
            rec = next((k for k in calls if k['agent'] == agent and k.get('short')), None)
            if rec and rec['short'] != sh:
                return f'[inbox] {label} {rec["short"]} finished.'
            return mo.group(0)
        m['content'] = re.sub(r'\[inbox\] (Vulkan|Atlas|Sentry|Artemis) ([a-z0-9]{1,12}) finished\.',
                              fix, m['content'])

changed = 0
for f in sorted(glob.glob(os.path.join(BASE, 's*.jsonl'))):
    rows = [json.loads(l) for l in open(f) if l.strip()]
    before = json.dumps(rows, ensure_ascii=False, sort_keys=True)
    for r in rows:
        norm_row(r)
    if json.dumps(rows, ensure_ascii=False, sort_keys=True) != before:
        open(f, 'w').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
        changed += 1
print(f'normalized delegate results in {changed} file(s)')
