# Supervision and churn (2026-08-24)

How Warden's host code watches background jobs and kills churn loops. All of this lives in `container/agent-runner/src/index.ts`; the constants are at the bottom of the file. Distinct from the orchestrator's own CONFIRM step, which grades its own chain's homework — this machinery is the independent backstop.

## Two-layer supervision on a 30s tick

`WATCHDOG_TICK_MS = 30_000`. An always-on ticker (`ensureWatchdogTicker`) is armed from `spawnBackgroundJob` and from the artemis spawn path; `watchdogBusy` guards overlap so ticks never stack. The ticker clears itself when no running jobs remain. Each tick runs two layers, in this order:

1. A **deterministic churn detector** (code, no model) — the real loop-killer.
2. An **advisory LLM watchdog** (`runSupervisorWatchdog`) — model judgement, never auto-stops a running job.

## The advisory LLM watchdog

Model: `SUPERVISOR_MODEL || ORCHESTRATOR_MODEL`. Intended target is the local toolcall model (`granite4.1:3b` — small, distinct from the orchestrator). On each tick the model sees only:

- The genuine `lastUserAsk` (one line, captured at dispatch).
- One line per running job: elapsed, tool-call count, last action + seconds ago, first 160 chars of the task. A `WARMING UP (model loading)` tag is appended for jobs under `WATCHDOG_MIN_JOB_AGE_S` with zero tool calls.

No tool schemas, no conversation history, no tool outputs. It returns strict JSON:

```
{ complete: boolean,
  jobs: [{ id, status: 'ok'|'crashed'|'off_rails', reason }],
  delegate: [{ agent: 'atlas'|'vulkan', task }] }
```

The system prompt states explicitly that `crashed`/`off_rails` are **ADVISORY WARNINGS, not stops — flagging does not kill the job**. Reason: a cloud-API stall (90–120s of silence while waiting on a model response) is indistinguishable from a dead job in a one-line snapshot, and aborting on the LLM's call killed good work. So:

- `complete=true` only emits a "may be complete, review" note; running jobs are not stopped.
- `crashed`/`off_rails` only bump `job.watchdogBadStreak` and emit a warning note.
- Jobs under `WATCHDOG_MIN_JOB_AGE_S = 120` with zero tool calls are "warming up" → ok regardless.
- `delegate[]` entries re-enter `spawnBackgroundJob`, so dedup + the one-atlas gate are re-applied. Only `atlas`/`vulkan` are delegate-able.

## The deterministic churn detector (the real loop-killer)

Runs in code before the LLM verdict is acted on. Constants:

- `RESEARCH_TOOLS` (12): `Read, Grep, Glob, Bash, WebSearch, WebFetch, read_file, list_file, get_chat_history, list_running_agents, read_job_result, agent_logs` — pure inspection calls.
- `CHURN_EXEMPT_AGENTS`: `{artemis, oculus}` — read-only by design.
- `CHURN_NUDGE_AFTER = 12`, `CHURN_ABORT_AFTER = 10`, `CHURN_MIN_AGE_S = 60`.

Per tool call (in the `runSubAgent` callback): if the tool is in `RESEARCH_TOOLS`, `consecutiveResearchCalls++` (and, if already nudged, `postNudgeResearchCalls++`); any non-research tool resets `consecutiveResearchCalls` to 0. Exempt agents and already-aborted jobs are skipped; jobs under 60s are skipped (model-loading window).

**Stage 1 — nudge.** At 12 consecutive research calls (age ≥ 60s, not exempt): set `churnNudged`, reset both counters, inject a nudge into the agent's next turn: "You have made 12+ search/read calls in a row without producing the deliverable. STOP searching. Produce the deliverable THIS turn."

**Stage 2 — abort.** After the nudge, 10 MORE research calls → `churnAborted`, `abortFlag.aborted`, `status='aborted'`.

**Critical: post-nudge streak is decoupled from writes.** Pre-nudge, a single `Edit` resets `consecutiveResearchCalls`. Post-nudge, the abort decision uses `postNudgeResearchCalls`, which ONLY increments on research tools and is NEVER reset by a write. This is the root-cause fix: before it, an agent in a churn loop could emit one occasional `Edit` in a sea of reads and the streak never reached the abort threshold — "churn punctuated by an occasional token write" evaded the kill forever (the nudge fired but never stuck). Total read-only calls before an atlas is stopped: 12 + 10 = 22+.

## atlas→vulkan auto-escalation

On an atlas churn-abort, the watchdog:

1. Spawns `vulkan` on the same task: `spawnBackgroundJob('vulkan', j.task, …)`.
2. Records `j.escalatedTo = vk` (the new vulkan job id).
3. Consumes the one retry credit: `retryLedger.set(taskSig(j.task), { failCount: 1, lastAt })`.

`taskSig` is the lowercased, whitespace-normalized, 80-char key. The `retryGate` then refuses any later orchestrator re-dispatch of the same task from an inbox-digest turn (user-driven turns bypass it) — so the orchestrator can't double-dispatch on top of the vulkan the watchdog already started. Vulkan (no bigger brother) just aborts → FAILED → reported. If the vulkan spawn itself fails (e.g. dedup), the retry credit is NOT consumed, leaving the orchestrator's re-delegation as the fallback.

## One-atlas-at-a-time gate

In `spawnBackgroundJob`, after the dedup backstop and before the same-file backstop: if a new `atlas` is dispatched while another atlas is running, abort the running one (`abortFlag.aborted`, `status='aborted'`) and spawn the new one. Applies to all dispatch sources — orchestrator tool calls, watchdog `delegate[]`, atlas-direct "go". Vulcan is intentionally exempt: the watchdog's churn-escalation spawns vulkan while atlas winds down, and vulkan is the bigger brother that may need to run concurrently.

## Completion verdict

`runCompletionVerdict` runs once per job at completion, before `inbox.push`. Tool-less LLM call on the supervisor model, `VERDICT_FETCH_TIMEOUT_MS = 12_000`; timeout/error → `unverifiable`, never blocks reporting. It sees `lastUserAsk` + task + `fullResult` (capped at 3000 chars) + a compact activity digest (last 40 `activityLog` entries as `tool(args)`). Returns:

```
{ verdict: 'confirmed'|'failed'|'unverifiable',
  reason, remaining, followup[] }
```

CONFIRMED = deliverable present and matches the ask. FAILED includes cases like "claims edit work but the activity shows zero Edit/Write/Bash calls" and "narrates steps without naming a concrete outcome".

## Churn-abort override

If `jobRecord.churnAborted` is true, the verdict is STAMPED regardless of what the LLM concluded:

- `verdict = 'failed'`
- `reason = "Supervisor stopped <delegate>: it churned on 22+ read-only calls with no deliverable, even after a commit nudge. Already auto-escalated to vulkan (<escalatedTo>, running) — do NOT re-delegate; report vulkan's result when it arrives."`

The stamped FAILED + the consumed retry credit are belt-and-suspenders against the orchestrator re-delegating. The verdict is explicitly advisory — it stamps the inbox item and logs but does NOT auto-execute a destructive re-delegate (a false FAILED must not trigger a re-delegate loop; human-in-the-loop + the orchestrator decide from the stamped verdict). Status pushed to the inbox is `aborted` (not `done`) when the job was watchdog-aborted; otherwise `done`.

## Constants

| Name | Value | Line |
|---|---|---|
| `WATCHDOG_TICK_MS` | `30_000` | 1630 |
| `WATCHDOG_KEEP_ALIVE_S` | `60` | 1627 |
| `WATCHDOG_FETCH_TIMEOUT_MS` | `15_000` | 1628 |
| `WATCHDOG_MIN_JOB_AGE_S` | `120` | 1629 |
| `CHURN_NUDGE_AFTER` | `12` | 1642 |
| `CHURN_ABORT_AFTER` | `10` | 1643 |
| `CHURN_MIN_AGE_S` | `60` | 1644 |
| `VERDICT_FETCH_TIMEOUT_MS` | `12_000` | 1977 |
| `RESEARCH_TOOLS` | 12 tools | 1640 |
| `CHURN_EXEMPT_AGENTS` | `{artemis, oculus}` | 1641 |