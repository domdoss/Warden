#!/usr/bin/env python3
"""One-shot 2026-09-19: rewrite part rows whose tool calls name tools the live
merged seat can never see (the 2026-09-19 schema audit), and cut rows that
train removed machinery outright.

Why this exists: the parts were written against an older seat model that
carried Write/Edit/Glob/Grep/project/escalate_to_cloud. The live merged
orch/atlas seat does NOT have those (Write/Edit/Glob/Grep are vulkan-owned and
withheld; `project` is not even registered — tools/index.ts never imports it;
escalate_to_cloud was removed). Training those calls teaches "Unknown tool"
at inference.

Per-class decisions (verified against container/agent-runner/src/ + dist/):
  Write (162 rows)   → write_file  — the seat's real file hand (core skill);
                       result restamped to the real write_file format.
  Grep  (38 rows)    → Bash grep -rn — ORCH_SYSTEM rule 2 says "grep for it
                       once"; Bash is a real pool tool. Results were already
                       grep -rn shaped, kept verbatim; "No matches found."
                       restamped to the real Bash exit-1 shape.
  Glob  (49 rows)    → Bash find -name. Results were already find shaped.
  Edit  (25 rows)    → Bash sed -i (no edit tool exists on the seat).
  escalate_to_cloud, async result (8 rows) → atlas_background, the live
                       analogue (same {task} arg, same inbox semantics);
                       result restamped to the real describeSpawn text.
  escalate_to_cloud, blocking result (40 rows) → CUT. They train a removed
                       capability that returned the deliverable in the tool
                       result; the correct live behaviour (write it inline,
                       few-mode "do the work yourself") would mean authoring
                       40 deliverables — a regeneration job, not a mechanical
                       rewrite.
  project (86 rows)  → CUT. No live path: the worktasks toolset lives in
                       byte-core and byte is not a seat or a delegate of the
                       chat seat.
  cloud-job machinery rows (9 rows, s9-*) → CUT. They train supervision prose
                       about a nonexistent "cloud" job type (cloud-clXXXX job
                       ids, "cloud jobs drop off while they think").

Run once:  python3 transform_parts_20260919.py   (writes parts in place,
prints a per-file report; re-running is a no-op by construction — the
rewritten calls are live tools and the cut rows are gone).
"""
import json
import glob
import re
import sys

PARTS = sorted(glob.glob('/opt/Warden/training/orchatlas-parts/*.jsonl'))

# Synthetic-but-plausible job ids for the 8 atlas_background rewrites (real
# format: atlas-<4 chars>). Not factual claims — job ids are opaque tokens.
JOB_IDS = ['atlas-7f2k', 'atlas-3d9m', 'atlas-9q1b', 'atlas-5h8x',
           'atlas-2c6n', 'atlas-8t4v', 'atlas-6j0y', 'atlas-4k7p']

CUT_TOOL_CALLS = {'project'}                     # no live path at all
CLOUD_JOB = re.compile(r'cloud-[a-z0-9]{4,}|cloud job|cloud thing')

report = {'write_file': 0, 'bash_grep': 0, 'bash_find': 0, 'bash_sed': 0,
          'atlas_background': 0, 'cut_project': 0, 'cut_escalate_blocking': 0,
          'cut_cloud_job': 0, 'prose_patch': 0, 'files': {}}


def shell_quote(s):
    return "'" + s.replace("'", "'\\''") + "'"


def sed_command(file_path, old, new):
    delim = next(d for d in '|#@,~^%' if d not in old and d not in new)
    esc = lambda t: t.replace('\\', '\\\\').replace(delim, '\\' + delim)
    return 'sed -i ' + shell_quote(f's{delim}{esc(old)}{delim}{esc(new)}{delim}') + ' ' + shell_quote(file_path)


def transform_row(row, where):
    """Returns the transformed row, or None to cut it."""
    msgs = row['messages']

    # 1. cut rules first
    calls = [c['function']['name'] for m in msgs for c in (m.get('tool_calls') or [])]
    if any(c in CUT_TOOL_CALLS for c in calls):
        report['cut_project'] += 1
        return None
    # escalate blocking: an escalate call whose result is NOT the async shape
    for i, m in enumerate(msgs):
        if m.get('role') == 'tool' and m.get('name') == 'escalate_to_cloud':
            if 'arrive in your inbox' not in (m.get('content') or ''):
                report['cut_escalate_blocking'] += 1
                return None
    # cloud-job machinery in prose (system prompt excluded; msgs[0] is stamped
    # by the merge anyway)
    if any(CLOUD_JOB.search((m.get('content') or '')) for m in msgs[1:]):
        report['cut_cloud_job'] += 1
        return None

    # 2. call/result rewrites, walking with a pending queue like the merge does
    pending = []  # (call dict) in issue order
    for m in msgs:
        if m.get('role') == 'assistant' and m.get('tool_calls'):
            for tc in m['tool_calls']:
                if isinstance(tc['function'].get('arguments'), str):
                    tc['function']['arguments'] = json.loads(tc['function']['arguments'])
                pending.append(tc)
        if m.get('role') != 'tool':
            continue
        # associate this result with its call (name match, else FIFO)
        call = None
        for cand in pending:
            if cand['function']['name'] == m.get('name'):
                call = cand
                pending.remove(cand)
                break
        if call is None and pending:
            call = pending.pop(0)
        name = call['function']['name'] if call else m.get('name')
        args = call['function']['arguments'] if call else {}

        if name == 'Write':
            path, content = args.get('file_path'), args.get('content', '')
            call['function']['name'] = 'write_file'
            call['function']['arguments'] = {'path': path, 'content': content}
            m['name'] = 'write_file'
            m['content'] = f'Wrote {len(content.encode("utf-8"))} bytes to {path}'
            report['write_file'] += 1
        elif name == 'Grep':
            cmd = 'grep -rn ' + shell_quote(args.get('pattern', '')) + ' ' + shell_quote(args.get('path', '.'))
            call['function']['name'] = 'Bash'
            call['function']['arguments'] = {'command': cmd}
            m['name'] = 'Bash'
            if 'No matches found' in (m.get('content') or ''):
                m['content'] = 'Error (exit 1): '
            report['bash_grep'] += 1
        elif name == 'Glob':
            pattern = args.get('pattern', '*').replace('**/', '')
            base = args.get('path', '.')
            cmd = 'find ' + shell_quote(base) + ' -name ' + shell_quote(pattern)
            call['function']['name'] = 'Bash'
            call['function']['arguments'] = {'command': cmd}
            m['name'] = 'Bash'
            if 'No files found' in (m.get('content') or ''):
                m['content'] = 'Command executed successfully (no output).'
            report['bash_find'] += 1
        elif name == 'Edit':
            cmd = sed_command(args.get('file_path'), args.get('old_string', ''), args.get('new_string', ''))
            call['function']['name'] = 'Bash'
            call['function']['arguments'] = {'command': cmd}
            m['name'] = 'Bash'
            m['content'] = 'Command executed successfully (no output).'
            report['bash_sed'] += 1
        elif name == 'escalate_to_cloud':
            job = JOB_IDS[report['atlas_background'] % len(JOB_IDS)]
            short = job.split('-')[1]
            call['function']['name'] = 'atlas_background'
            call['function']['arguments'] = {'task': args.get('task')}
            m['name'] = 'atlas_background'
            m['content'] = (f'Atlas {short} started — running. Result arrives in your inbox. '
                            'Reply: running, result on the way. End your turn.')
            report['atlas_background'] += 1

    # 3. prose patches on the rewritten async-escalate rows (the 8 finals all
    # said "escalated ... to cloud reasoning")
    for m in msgs:
        c = m.get('content')
        if not isinstance(c, str):
            continue
        if 'cloud reasoning' in c and 'escalat' in c.lower():
            c2 = c.replace('cloud reasoning', 'a background Atlas job').replace('escalated', 'sent')
            if c2 != c:
                m['content'] = c2
                report['prose_patch'] += 1

    # 4. the one s11-2 offer of a nonexistent path ("hand the full comparison
    # to the cloud model" → a background job, which IS a real offer)
    for m in msgs:
        c = m.get('content')
        if isinstance(c, str) and 'hand the full comparison to the cloud model' in c:
            m['content'] = c.replace(
                'hand the full comparison to the cloud model, or just lay out the tradeoffs myself?',
                'hand the full comparison to a background job, or just lay out the tradeoffs myself?')
            report['prose_patch'] += 1
    return row


for path in PARTS:
    fname = path.split('/')[-1]
    rows_in, rows_out = [], []
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        rows_in.append(json.loads(line))
    kept = 0
    for i, row in enumerate(rows_in):
        out_row = transform_row(row, f'{fname}:{i + 1}')
        if out_row is not None:
            rows_out.append(out_row)
            kept += 1
    if len(rows_out) != len(rows_in) or any(json.dumps(a) != json.dumps(b) for a, b in zip(rows_in, rows_out)):
        with open(path, 'w') as f:
            for r in rows_out:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')
        report['files'][fname] = (len(rows_in), kept)

print('per-file changes (in → kept):')
for f, (a, b) in report['files'].items():
    print(f'  {f}: {a} → {b}')
for k in ['write_file', 'bash_grep', 'bash_find', 'bash_sed', 'atlas_background',
          'prose_patch', 'cut_project', 'cut_escalate_blocking', 'cut_cloud_job']:
    print(f'  {k}: {report[k]}')
total_in = sum(open(p).read().count('\n') for p in PARTS)
print(f'total rows now: {total_in}')