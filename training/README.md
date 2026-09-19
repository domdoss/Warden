# Toolcall SFT pipeline (iris)

LoRA fine-tuning data + training + verification for the toolcall model
(Granite 4.2:3b base, served via Ollama as `toolcall-ft`).

- **iris** — the single toolcall agent. Byte was merged into iris on
  2026-09-05 (one toolcall agent, one fine-tuned model); dexter had been
  absorbed earlier. The 2026-09-09 collapse stripped iris to FOUR merged
  action tools — email, task (scheduled reminders), calendar, alarm
  (projects/work-tasks are orchestrator-direct now). Since 2026-09-15 a
  dispatch allows **up to 3 tool calls** (`maxIterations: 3`): each call
  must use a fact an earlier call returned (an id from a read, a filename
  from a get), and no succeeded call is repeated. The 2026-09-15 dataset
  expansion took iris to **993 rows** with broad email coverage (see
  `gen_toolcall_sft.mjs` "EMAIL BREADTH" section).
- **merged (orch/atlas)** — 2026-09-18, the orchestrator and atlas seats
  are merging into ONE local agent (Granite 4.1:8b) with cloud
  auto-escalation (`escalate_to_cloud`) and vulkan/iris as delegates. Its
  dataset lives here: see "The merged-seat dataset" below.
- **sentry is NOT covered** (changed 2026-09-08): the background
  security-scanner run-mode briefly had SFT rows here, but the user
  switched sentry to share the orchestrator/atlas model (set manually in
  the dashboard), so the toolcall fine-tune trains only what toolcall-ft
  actually runs. The sentry generator, scenarios, and dryfire suite were
  removed; if sentry ever returns to this model, re-add from git history.

## The standing loop: logs → rows (do this every session)

The user's standing instruction: **constantly update the training data based
on what the logs show.** `grep /opt/Warden/logs/warden.log` for the
sub-agent tool lines (`[agent-runner] [iris] Tool:`), the digest lifecycle
(`bg-agent[iris-digest-…]`), and any `Error on iteration` lines. Every REAL
misbehavior found — malformed args, invented content, wrong tool, churn/
re-issue patterns — becomes one or more SFT rows with the CORRECT
transcription as the target, grounded in the logged input (real task text,
real output shapes; never bake secrets/tokens from logs). Then regenerate +
dryfire. Baked from the 2026-09-08 log/dryfire runs: `add_blocker`
dropping `severity` when the brief uses the TRAILING form ("…, high
severity" — every prior rep used the pre-noun "a high-severity blocker",
so the trailing form was untrained), and the daily digest calling
`read_emails` with EMPTY args (stably reproducible on the 24h/limit-100
window; reinforced with a busy-morning daily rep).

## The merged-seat dataset (orchatlas, 2026-09-18)

`orchatlas-sft.jsonl` (**2190 rows**): fine-tune data for the merged
orchestrator+atlas seat on **granite-4.2-8b** (`ibm-granite/granite-4.2-8b`),
built yolo-style from the logs before the seat lands in `SUBAGENTS`. Same
messages+`tools` format as the iris dataset; the tools array is the
**57-tool merged schema** (`merged` key in `tool_schemas.json`, dumped from
the live registry + hand-built delegate/escalate/supervision/internal/marm
defs — see `dump_tool_schemas.mjs`). Train it with `./atlasorch.sh`. The merged seat is visionless: no
browser_screenshot/browser_snapshot/desktop_screenshot anywhere — page state
is read with `browser_evaluate`, difficult-to-drive screens get delegated to
vulkan (the one seat with capture), and `desktop_click` stays as the
last-resort hand for a broken site.

The rows are hand-written by a fleet of subagents (27 sections, 25 rows per
part file) into `orchatlas-parts/`, then merged by `merge_orchatlas_parts.mjs`,
which
also normalizes benign shape drift (arguments-as-string → object, tool
results missing their name → the pending call's name) and hard-fails on real
defects (unknown tools, bad JSON, anchor missing, system-prompt drift,
duplicate rows). `gen_orchatlas_sft.mjs` is the superseded first-pass
generator, kept for reference only.

Row coverage, grounded in `logs/warden.log` (the 2026-09-18 playback session)
and the recorded failure classes — user asks deliberately mix human voices
(direct / casual-typo / rambling; the variety is on the USER side only, replies
stay terse):

- **playback** — 299 direct `youtube` tool calls (the most-called tool in the
  dataset: play/search/now_playing/pause/resume/next/seek/fullscreen, result
  strings byte-match `tools/youtube.ts`), media_control, audio_volume,
  mic_volume, the playerctl sudo-install flow (`tools/media.ts`); autoplay is
  the norm — exactly one blocked→media_control chain row; "no autoplay" only
  where the user explicitly asks for it;
- **browser/desktop** — tabs (incl. closing duplicate YouTube players),
  browser_evaluate specific-value reads (the page-reading tool: named values,
  not page dumps), navigate, form typing by ref, desktop_click as last
  resort, open_app + desktop_type (focus-based, blind-usable), the
  Ghostwriter typing chains, and vulkan delegation for anything that needs
  eyes;
- **email/calendar** — every intent in many different human phrasings, all
  routed to iris as labelled one-line `TASK:` briefs (the brief distills the
  ramble; ask-backs when address/content/time is missing). Inbox checks relay
  ONLY what iris returned — senders and subjects first, never invented
  timestamps, never times-instead-of-names; quiet inboxes are stated plainly
  (the 2026-09-18 fabrication fix, 200 rows);
- **charts/spreadsheets/visuals** — matplotlib/gnuplot/convert_file chains
  producing actual files (100 rows);
- **tasks/calendar events** — the `project` tool and calendar asks (100 rows);
- **web research** — WebSearch/WebFetch multi-hop lookups with honest misses
  and source-relay-only answers (100 rows);
- **draft fidelity** — vulkan-drafted emails verified with Read against the
  actual ask, invented content stripped with Edit (apology nobody asked for,
  links "as you requested", phone numbers, doubled-path reports), garbage
  files → report_task_failure + one corrected re-brief (55 rows, s22+s23);
- **decomposition** — multi-chain asks broken into steps with the plan stated
  once, conditionals (check-then-act, incl. FALSE conditions), read→email
  carrying the actual words, combined two-request messages;
- **delegation** — vulkan WHAT-not-HOW briefs, escalate_to_cloud verbatim
  full asks, wrong-seat corrections (do it yourself, don't delegate);
- **supervision/report-back** — list/stop/nudge/agent_logs/read_job_result,
  FAILED verdicts → report_task_failure + ONE re-brief naming the gap, the
  real REPORT-BACK digest block → the TERSE one/two-sentence reply (the
  2026-09-18 verbose-output fix, trained in);
- **files/system/tasks/history/memory** — Read/Grep/Glob/Bash own-hands work,
  the `project` tool, get_chat_history, and `mcp__marm__marm_smart_recall`
  (the exact prefixed wire name — the unprefixed spelling caused 5 straight
  "Unknown tool" failures on 2026-09-18);
- **the internal machinery** (s24-s27, 100 rows, added 2026-09-18b) — the
  things the seat reaches for when WARDEN ITSELF is the subject, and the one
  area the first 23 sections never touched:
  - *MCP + skills* (s24): `install_mcp_server` / `uninstall_mcp_server` with
    real npx/uvx commands, the "available as a skill on the NEXT turn" truth
    (never call what you just registered), installs bundled with a real task
    that the seat finishes itself, a missing secret asked for instead of
    invented, `list_skills` answered in spoken English, `activate_skill` on a
    user skill vs the refusal on an MCP skill (those tools run in the
    sub-agents, not here) vs the "that's a sub-agent, call it directly" error,
    and `create_skill` packaging a finished workflow;
  - *artemis* (s25): "why did that never come back", "what went wrong", "check
    yourself before I send this" — plus the DIVIDING LINE the seat has to hold:
    `list_running_agents` / `agent_logs` / `read_job_result` for a status
    question, artemis only for diagnosis across the logs and the DB;
  - *the Council* (s26): self-contained `task` strings (the seats see no chat
    history), `max_rounds` used deliberately, the one-at-a-time collision,
    `council_status` peeks summarized rather than pasted, and five decoys where
    the phrasing invites a council but the right move is a lookup, vulkan,
    artemis, or just doing it;
  - *the rest* (s27): `atlas_background` hand-offs (and two rows that correctly
    do NOT hand off), `sentry` peek/deep scans, `api_request` / `list_api_keys`
    incl. the keyless `warden` loopback to localhost:3200, `attach_file`,
    `clear_context` (only on an explicit ask), `fabric_pattern`, and
    `mcp__marm__marm_log_entry` for a durable fact.
  Verbatim live result strings for all of it live in
  `orchatlas-parts/_internals.md` — the sheet the row writers worked from, so
  no tool output in the dataset is invented.

**The system prompt is authored, not extracted** — the merged seat does not
exist in the runner yet. It lives in ONE place, `orchatlas-parts/_sys.txt`:
the file the row-writing subagents are handed, and the file
`merge_orchatlas_parts.mjs` reads and enforces byte-identical across every row
(2026-09-18b — it used to be a second copy inline in the merge script). Edit
that file and every part row must be re-stamped with it, or the merge fails.
When the seat lands in the runner, switch to verbatim extraction from the
SUBAGENTS entry (the IRIS_SYSTEM pattern in `gen_toolcall_sft.mjs`) and
replace the hand-built `escalate_to_cloud` def with the dumped registry
shape, so training keeps matching inference.

**Sequence length is the one hard constraint**: the 57-tool schema block
puts every row at **min/mean/p95/max 10472/10717/11050/11785** tokens on the
4.2-8b tokenizer (check: `./.venv/bin/python check_seqlen.py
orchatlas-sft.jsonl ibm-granite/granite-4.2-8b`) — up from 7253/…/8566 when
the schema was 40 tools. The trainer's `--max-len 6144` default
left-truncates EVERY row of this dataset, and truncation is keep-last-N, so a
low cap silently amputates the system prompt and the tool schemas — the two
things this fine-tune exists to learn. Train with **`--max-len 12032`**, or
just run `./atlasorch.sh`, which measures the data and rounds up to the next
multiple of 256 so the cap can never clip a row. No dryfire suite yet (the
seat is not live); when one is written, re-baseline stock granite-4.2-8b
before trusting it.

## Pipeline

```
node dump_tool_schemas.mjs   # tool_schemas.json — live schemas: iris-core (4 action tools) + the 57-tool merged seat
node gen_toolcall_sft.mjs    # toolcall-sft.jsonl — the SFT dataset (iris rows)
./run.sh                     # train (torchrun, both RTX 5000s) + pack → ollama:toolcall-ft
node dryfire.mjs             # verify the fine-tune against the real run contract
```

The merged seat has its own pipeline (same trainer, different base, dataset,
sequence length and Ollama name — neither run overwrites the other's adapter):

```
node dump_tool_schemas.mjs        # refresh the 57-tool merged schema
node merge_orchatlas_parts.mjs    # orchatlas-parts/*.jsonl → orchatlas-sft.jsonl (also the validator)
./atlasorch.sh                    # measure seq-len → train granite-4.2-8b → pack → ollama:orchatlas-ft
```

Run `dump_tool_schemas.mjs` **after** building the agent-runner
(`npm run build:agent-runner` from /opt/Warden) — it reads the compiled
registry. `AR_DIST=<dir>` points it at a scratch compile instead (the dir
must end in `dist/agent-runner` — the loader stubs `index.js` by that path),
so schemas can be refreshed from source without rebuilding the dist the
running Warden serves from. `gen_toolcall_sft.mjs` extracts the iris system
prompt **verbatim from the runner source at gen time** (throws if the
extraction drifts), so training always matches production exactly. Re-run
both whenever the runner's SUBAGENTS entry, toolsets, or tool schemas change.

**The ANCHOR time header is BAKED IN** (`gen_toolcall_sft.mjs`, `ANCHOR`):
`2026-08-31T14:05:00 (timezone America/Vancouver)`. Every row's user turn
carries it, so the model trains on Vancouver-local timestamps. If the machine
this serves runs in a different timezone, change the `ANCHOR` line to match
the local one **before regenerating** the dataset — otherwise the fine-tune
computes clock math in the wrong offset at inference time.

## Files

- `dump_tool_schemas.mjs` — dumps the exact Ollama tool definitions from the
  compiled agent-runner registry (via `tool_schema_loader.mjs`, which stubs
  the runner's IPC imports). Agent: `iris-core` (4 action tools: email,
  task, calendar, alarm).
- `tool_schemas.json` — the dumped schemas (`iris` key).
- `gen_toolcall_sft.mjs` — dataset generator → `toolcall-sft.jsonl`
  (993 rows: iris, 0–3 tool-call turns — 700 single-call rows, 136 two-call
  chains, 36 three-call chains, 121 text-only clarification rows). Two parts:
  a curated corpus (hand-written rows grounded in logged failures) plus a
  **seeded combinatorial EMAIL BREADTH section** (mulberry32, seed 20260915 —
  regens are byte-stable) that paraphrases one canonical call many ways over
  banks of senders/subjects/attachments. Action mix ≈ read 26%, get 22%,
  download 17%, send 9%, refresh+cached 4%, scheduling chains ~10%,
  text-only 12%; every result string byte-matches the live handler.
- `dryfire.mjs` — the verification harness (below).
- `train_dexter_lora.py`, `pack_dexter.sh`, `run.sh` — LoRA train + GGUF pack
  (filenames are historical; they serve toolcall-ft now).
- `check_seqlen.py` — tokenizer-only render of the dataset to print seq
  min/mean/p95/max (GPU-free); run it after any toolset change to confirm the
  `--max-len` cap still clears the max.
- `toolcall-sft.jsonl`, `toolcall-lora/`, `toolcall-lora-merged/`,
  `toolcall-ft.{f16,q4_k_m}.gguf` — artifacts.

## Why these examples (grounded in real failures)

Every hard class below was mined from `logs/warden.log` or a dryfire
checkpoint failure; the dataset trains its **correct** counterpart (SFT
trains on correct outputs only):

1. **Clock math on relative times.** "in 2 minutes" once produced `13:12`
   (added 2 to the hour). → `once` + ISO-8601 **duration** (`PT2M`) reps;
   every request carries the injected time header ("Current local time is
   YYYY-MM-DDTHH:MM:SS (timezone …). Compute every absolute timestamp from
   this."), which the dispatch path prepends to ALL iris tasks.
2. **Malformed / wrong-field cron.** `0 11:30 * * *`, then `0 11 12 * *`.
   → many cron reps with varied minutes, plus step/comma/range/weekday forms.
3. **Interval ms arithmetic.** "every 2 hours" once produced `1200000`
   (20 min). → interval reps with the ms value restated in the reply.
4. **Invented content.** No-content reminders once got invented prompts.
   → ask-back text-only reps (~3 schedule_task per ask-back).
5. **Plain to-dos.** Once handed off to byte / scheduled with invalid
   `schedule_value: "now"`. → since the 2026-09-09 collapse iris has no
   work-task tool: a plain to-do (content but no time) gets one short line
   asking for a time, then it becomes a scheduled reminder.
6. **Schema-as-args / wrong artifact.** `send_email` without `to`; "add a
   priority" answered with `create_work_task`; "mark as Blocked" answered by
   creating a junk project. → clean single-call reps, and id-supplied manage
   reps (the orchestrator resolves ids; the brief carries them).
7. **Empty turns on multi-part requests.** "reminder + calendar event"
   once produced no calls. → both-calls-in-one-turn pairs.

## Format

Each row is OpenAI-style messages + a `tools` array:

```json
{
  "messages": [
    {"role":"system","content":"<iris system prompt, extracted verbatim from the live runner>"},
    {"role":"user","content":"Current local time is 2026-08-31T14:05:00 (timezone America/Vancouver). Compute every absolute timestamp from this.\n\n<orchestrator-style brief>"},
    {"role":"assistant","content":"","tool_calls":[{"type":"function","function":{"name":"task","arguments":{...}}}]},
    {"role":"tool","name":"task","content":"OK"},
    {"role":"assistant","content":"Set a reminder …"}
  ],
  "tools": [ <4 tool defs matching the live registry schemas> ]
}
```

The Granite chat template renders the same system block + tools the agent
sees at inference; the assistant tool-call renders as `<|tool_call|>
{"name": …, "arguments": …} <|end|>` — the wire format Ollama parses. The
anchor time is fixed so absolute-timestamp targets are reproducible.

Request strings are written in the real orchestrator-brief style (verbose,
parenthetical timezone, explicit ids, em-dashes) so train ≈ infer.

## dryfire — verifying the fine-tune

`node dryfire.mjs` (or `MODEL=granite4.2:3b node dryfire.mjs` for a stock
baseline) hits Ollama `/api/chat` directly with the extracted system prompt
and the live tool schemas, then scores against the **real run contract**:

- **iris**: ONE Ollama call per case — the harness scores the FIRST model
  turn only, so each case pins the exact expected call set for that turn
  (extra calls in turn one are the fine-tune over-firing). Manage briefs
  carry ids; email briefs carry resolved addresses. Covers every
  `schedule_value` form, ask-backs, email, and alarms. (The 2-turn
  read→get / get→download chains are NOT dryfire-covered yet — the harness
  has no tool-result feedback loop; those rows are verified structurally at
  gen time. Extend the harness with a multi-turn runner before trusting a
  retrain on the chains.)

Transport note: dryfire talks to Ollama **streaming**. A non-streaming reply
sends headers only after the whole generation, and Node's fetch gives up on
headers after 300s — a runaway generation then aborts the CALL while Ollama
keeps generating server-side, and that zombie queues every later case past
the same wall (a whole baseline suite was poisoned this way on 2026-09-08).
Streaming returns headers immediately and an abort propagates to Ollama, so
the wall-clock cap actually cancels runaways. A wall-clock abort is the
harness working as designed — the case is recorded as a FAIL ("runaway:
generation exceeded the wall-clock cap") and the suite CONTINUES (the abort
reason must be an Error object, not a string, or the failure prints as bare
`undefined`).

Exits non-zero on any failure; data-fix failures in the generator (never
prompt-hack around them). Historical baselines: stock granite 4.2:3b scores
far below the fine-tune; the 2-epoch toolcall-ft (2026-09-02 data) was
45/50 on the pre-merge suite — re-baseline after the merge, then keep it
green before packing. The 2026-09-08 pre-retrain baseline on this 50-case
suite (45 iris, 5 digest): **47/50** — 43/45 iris (the 2 known no-content
ask-back inventions, data-fixed in this set) and 4/5 digest (a stable
digest:daily failure — read_emails with EMPTY args — data-fixed with an
extra daily rep). That is exactly the failure class the current dataset
exists to fix.

## Training (LoRA)

`run.sh` automates the whole thing: uv venv (Python 3.12), deps, VRAM
cleanup, `torchrun` across both RTX 5000s, llama.cpp build (one-time), pack
to Ollama `toolcall-ft` (GGUF f16 → Q4_K_M via `pack_dexter.sh`, reusing the
stock `granite4.2:3b` template so tool-call rendering is identical).

```
./run.sh              # full pipeline (train + pack)
SKIP_PACK=1 ./run.sh  # train only
NPROC=2 ./run.sh      # override GPU count
```

`train_dexter_lora.py` applies the model's chat template with each example's
tools, masks non-assistant turns to `-100`, trains LoRA r=16/alpha=32 on
every linear layer (2 epochs default, fp16, grad checkpointing on). This is
tool-call transcription, not new knowledge — small rank is plenty. Sequence
length matters a lot post-merge: every example carries the full schema block
(4 iris action tools), so rendered seqs run min/mean/max
**2071/2225/2533** over 993 rows (p95 2419; check with
`./.venv/bin/python check_seqlen.py`, or the training-time printout) — the
trainer's `--max-len` default is **6144** accordingly. Any lower value
left-truncates the system prompt off nearly the whole dataset; if a
desktop-taxed GPU OOMs, raise `--grad-accum`, never lower the cap.

Route it: the Toolcall model is dashboard-selected, not env (memory
`feedback-models-not-in-env`). Set it to `toolcall-ft` in the dashboard.

## Extending

Add examples to `gen_toolcall_sft.mjs` and re-run the generator, then
`node dryfire.mjs`.
Invariants:
- relative `once` → ISO-8601 duration (`PT2M`), never a computed timestamp;
  absolute clock time → local `YYYY-MM-DDTHH:MM:SS` computed from the ANCHOR.
- cron for "every day at HH:MM" is `MM HH * * *` — minute first.
- interval → milliseconds as a string.
- no content / no time → ask back, no tool call.
- a plain to-do (content, no time) → ask back for a time; it becomes a
  scheduled reminder once a time is given.
- manage (task/calendar/alarm) → the id arrives in the brief; ONE call.
- email chains (read→get, get→download) may span up to 3 calls; every call
  after the first must use an id/filename an earlier result returned, and no
  succeeded call is repeated.
- task `list` is fire-and-forget in production (`{"ok":true,…}` — no ids
  come back), so there are NO task list→act chains; scheduling chains use
  alarm/calendar `list` results only.
- new breadth rows go in the seeded EMAIL BREADTH section: fixed PRNG seed
  (regens must stay byte-stable), result strings byte-match the handler, and
  the ASK is paraphrased while tool args stay canonical.
- every request carries the ANCHOR time header.