#!/usr/bin/env python3
# Rewrites three legacy read_job_result result formats left in the corpus so
# they match the live runner (orchatlas-parts/_internals.md):
#
#   "Stored result for vulkan-vk4t81 (completed):\n<body>"
#       → "vulkan-<short> (vulkan, done) — task: \"<task>\"\n\n<body>"
#   "3 stored results:\n- vulkan-vk4t81 (<label>, completed)"
#       → "Stored job results:\n- vulkan-<short> (vulkan, finished 34s ago) task: \"<label>\""
#   a bare result body with no header (the report-back turn)
#       → "<job id> (<agent>, done) — task: \"<task>\"\n\n<body>"
#
# Old ids were 6+ chars; live ids are 4 chars of base36. The old `cloud-` agent
# no longer exists — those results belong to the seat's own background jobs, so
# they become `atlas-`.
#
# Idempotent:
#   python3 repair_legacy_job_results.py
import json, glob, os, re, hashlib

BASE = os.path.dirname(os.path.abspath(__file__))
ALNUM36 = '0123456789abcdefghijklmnopqrstuvwxyz'
LIVE = re.compile(r'^[a-z_]+-[a-z0-9]{4} \([a-z_]+, [a-z]+\) — task: "')

def gen_short(agent, seed):
    h = int(hashlib.sha1(f'{agent}|{seed}'.encode()).hexdigest(), 16) % (36 ** 4)
    out = ''
    for _ in range(4):
        h, r = divmod(h, 36)
        out = ALNUM36[r] + out
    return out

def live_agent(prefix):
    return {'cloud': 'atlas', 'atlas': 'atlas', 'vulkan': 'vulkan',
            'artemis': 'artemis', 'sentry': 'sentry', 'iris': 'iris'}.get(prefix, prefix)

def user_task(msgs):
    for m in reversed(msgs):
        if m.get('role') != 'user':
            continue
        c = str(m.get('content') or '')
        mo = re.search(r'task: "([^"]+)"', c)
        if mo:
            return mo.group(1)
        lines = [l for l in c.split('\n')
                 if l.strip() and not l.startswith('Current local time is')
                 and not l.strip().lower().startswith('[inbox]')]
        if lines:
            return lines[-1].strip()
    return 'the delegated task'

def fix_row(row):
    msgs = row['messages']
    changed = False
    call_jobs = [t for m in msgs for t in (m.get('tool_calls') or [])
                 if (t.get('function') or {}).get('name') == 'read_job_result']

    for m in msgs:
        if m.get('role') != 'tool' or m.get('name') != 'read_job_result':
            continue
        c = str(m.get('content') or '')
        if LIVE.match(c):
            continue

        # A. "Stored result for <id> (<status>):" ---------------------------------
        mo = re.match(r'^Stored result for ([a-z_]+)-([a-z0-9]+) \([a-z]+\):\s*\n?', c)
        if mo:
            old_id = f'{mo.group(1)}-{mo.group(2)}'
            agent = live_agent(mo.group(1))
            body = c[mo.end():].strip()
            short = gen_short(agent, body)
            jid = f'{agent}-{short}'
            m['content'] = f'{jid} ({agent}, done) — task: "{user_task(msgs)}"\n\n{body}'
            for t in call_jobs:
                a = t['function'].get('arguments')
                if isinstance(a, dict) and str(a.get('job_id', '')) == old_id:
                    a['job_id'] = jid
            changed = True
            continue

        # B. "N stored results:" list ---------------------------------------------
        mo = re.match(r'^\d+ stored results[^:]*:\s*\n', c)
        if mo:
            lines = [l.strip() for l in c[mo.end():].split('\n') if l.strip().startswith('- ')]
            out = ['Stored job results:']
            for l in lines:
                mi = re.match(r'-\s+([a-z_]+)-([a-z0-9]+)\s+\((.+),\s*[a-z]+\)\s*$', l)
                if not mi:
                    continue
                agent = live_agent(mi.group(1))
                label = mi.group(3)
                short = gen_short(agent, label)
                out.append(f'- {agent}-{short} ({agent}, finished 34s ago) task: "{label}"')
            if len(out) > 1:
                m['content'] = '\n'.join(out)
                changed = True
            continue

        # C. bare body with no header --------------------------------------------
        # Only when the row has one read_job_result call naming the job and the
        # turn is a report-back (the user message carries `task: "..."`).
        mo = re.match(r'^([A-Z][a-z]+) [a-z]+ — full text\.\n\n', c)
        jid_call = None
        for t in call_jobs:
            a = t['function'].get('arguments')
            if isinstance(a, dict) and a.get('job_id'):
                jid_call = str(a['job_id'])
                break
        if mo and jid_call:
            agent = jid_call.split('-')[0]
            body = c[mo.end():].strip()
            m['content'] = f'{jid_call} ({agent}, done) — task: "{user_task(msgs)}"\n\n{body}'
            changed = True
    return changed

changed_files = 0
for f in sorted(glob.glob(os.path.join(BASE, 's*.jsonl'))):
    rows = [json.loads(l) for l in open(f) if l.strip()]
    changed = False
    for r in rows:
        changed = fix_row(r) or changed
    if changed:
        open(f, 'w').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
        changed_files += 1
print(f'repaired legacy job results in {changed_files} file(s)')
