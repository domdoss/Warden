# TODO (Dom, 2026-09-19): orch — follow-up tasks + multi-orchestration training

## The ask
Orch must be trained for LONG CHAINS, not one-in/one-out. Today a dispatch is
a single brief → one consolidated result. The wanted behavior: orch receives a
fake project, decomposes it into a long chain of individually delegated tasks,
runs follow-ups on its own results, re-delegates when a piece comes back wrong,
and sequences dependent steps — the way it should behave in real life.

## Scenario shape (the training data to generate)
- Input: one fake project brief (multi-part, dependencies between parts).
- Expected trace: many small turns, each ONE of:
  - delegate a single narrow piece to the owning specialist (vulkan/iris/artemis/sentry),
  - verify the returned piece (small command / page check),
  - follow-up task derived from a previous piece's output (piece B needs piece A's file),
  - re-delegate with the gap named when a result is wrong,
  - consolidate only after every piece verified.
- Include FOLLOW-UPS explicitly: results that spawn new tasks mid-chain
  (e.g. "the build failed → run the fix → then rerun the tests → then email the log").

## Example fake project (seed)
"Weather digest app": vulkan writes a fetcher script → vulkan runs its tests →
iris schedules a daily run → vulkan patches the formatting bug the first test
found → artemis audits the final repo → orch consolidates one report.

## Hooks already in place (2026-09-19)
- Shared piece-thread: `orchThread` (AsyncLocalStorage) — specialists see prior
  pieces; results are labeled with the producing model.
- Request-only gate: seat proposes, user approves; orch then runs unsupervised.
- Blocking dispatch branches in executeXmlTool (vulkan/sentry/iris/artemis) with
  THREAD SO FAR prepend.

## Validation
- A chain counts as correct only if every specialist result was verified by orch
  and follow-ups were actually dispatched (not narrated).
- Failure modes to train out: one giant brief instead of decomposition;
  declaring done without verification; skipping follow-ups; re-running finished pieces.
