# Toolcall SFT pipeline (iris)

LoRA fine-tuning data + training + verification for the toolcall model
(Granite 4.1:3b base, served via Ollama as `toolcall-ft`).

- **iris** — the single toolcall agent. Byte was merged into iris on
  2026-09-05 (one toolcall agent, one fine-tuned model); dexter had been
  absorbed earlier. The 2026-09-09 collapse stripped iris to FOUR merged
  action tools — email, task (scheduled reminders), calendar, alarm
  (projects/work-tasks are orchestrator-direct now). Since 2026-09-15 a
  dispatch allows **up to 3 tool calls** (`maxIterations: 3`): each call
  must use a fact an earlier call returned (an id from a read, a filename
  from a get), and no succeeded call is repeated.
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

## Pipeline

```
node dump_tool_schemas.mjs   # tool_schemas.json — live schemas: iris-core (4 action tools)
node gen_toolcall_sft.mjs    # toolcall-sft.jsonl — the SFT dataset (iris rows)
./run.sh                     # train (torchrun, both RTX 5000s) + pack → ollama:toolcall-ft
node dryfire.mjs             # verify the fine-tune against the real run contract
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
  (229 rows: iris, 1–3 tool-call turns — mostly single-turn, plus the
  read→get / get→download email chains).
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

`node dryfire.mjs` (or `MODEL=granite4.1:3b node dryfire.mjs` for a stock
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
prompt-hack around them). Historical baselines: stock granite 4.1:3b scores
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
stock `granite4.1:3b` template so tool-call rendering is identical).

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
**2073/2161/2465** over 229 rows (p95 2236; check with
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
- every request carries the ANCHOR time header.