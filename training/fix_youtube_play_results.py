#!/usr/bin/env python3
# One-shot: normalize stale youtube PLAY results in the part files to the live
# tool string. The 2026-09-19 tool rewrite changed play's success result from
# "Playing: {title} — {channel} ({m:ss})\n{url}" to bare "Playing: {title}\n{url}"
# (no channel, no position — the picker logs position nowhere). 136 trained
# results still carry the old shape. ONLY results whose producing call is
# action=play are touched: next/now_playing legitimately return
# "Playing: {title} ({at})\n{url}" and "Already playing:" is untouched.
import json, glob, os, re

# " — Channel Name (12:34)" or " (1:02:33)" immediately before \n{url}
SUFFIX = re.compile(r'( — [^\n]+?)? \(\d+(?::\d+)+\)(\nhttps?://\S+)$')

changed_rows = 0
changed_files = 0
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'orchatlas-parts', '*.jsonl'))):
    if os.path.basename(f).startswith('orch-'):
        continue
    out, touched = [], False
    for line in open(f):
        row = json.loads(line)
        pending = []  # (name, args) in call order
        hit = False
        for m in row['messages']:
            if m.get('role') == 'assistant':
                for tc in (m.get('tool_calls') or []):
                    pending.append((tc['function']['name'], tc['function'].get('arguments')))
            elif m.get('role') == 'tool' and pending:
                name, args = pending.pop(0)
                if name == 'youtube' and isinstance(args, dict) and args.get('action') == 'play':
                    c = m.get('content')
                    if isinstance(c, str) and c.startswith('Playing: ') and '\nhttp' in c:
                        new = SUFFIX.sub(r'\2', c)
                        if new != c:
                            m['content'] = new
                            hit = True
        if hit:
            changed_rows += 1
            touched = True
        out.append(json.dumps(row, ensure_ascii=False))
    if touched:
        changed_files += 1
        open(f, 'w').write('\n'.join(out) + '\n')
        print(f"normalized: {os.path.basename(f)}")
print(f"{changed_rows} rows across {changed_files} files")
