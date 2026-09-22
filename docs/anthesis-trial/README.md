# Warden Anthesis trial runbook

This runbook exercises the bounded cooperative `Write` adapter. It does not claim OS-level containment.

## Required inputs

Provide these values from the verified Governance Lab acquisition:

```text
ANTHESIS_LAB_BIN=/path/to/verified/anthesis-lab
ANTHESIS_LAB_REPO=/path/to/anthesis-governance-lab
```

The paths are intentionally supplied by the operator and are not embedded in Warden.

## Governed runtime configuration

```text
ANTHESIS_GOVERNED_WRITES=true
ANTHESIS_TRIAL_RESTRICT_TOOLS=true
ANTHESIS_TRIAL_ALLOWED_TOOLS=Write
ANTHESIS_TRIAL_ROOT=/path/to/disposable-workspace
ANTHESIS_TRIAL_RUNTIME=<registered-runtime-id>
ANTHESIS_TRIAL_ATTEMPT_ID=<unique-attempt-id>
ANTHESIS_TRIAL_EVIDENCE_FILE=/path/to/disposable-workspace/evidence.jsonl
ANTHESIS_TRIAL_POLICY=<policy-name>
ANTHESIS_TRIAL_EXPECTED_DECISION=allow
ANTHESIS_TRIAL_EXPECTED_SOURCE=policy_rule
ANTHESIS_TRIAL_EXPECTED_RULE=<policy-rule-id>
ANTHESIS_TRIAL_EXPECTED_REASON=<policy-reason>
```

The attempt ID must be unique for each authorization attempt. Do not reuse it to represent a new request.

For an engine-guard denial, use:

```text
ANTHESIS_TRIAL_EXPECTED_DECISION=deny
ANTHESIS_TRIAL_EXPECTED_SOURCE=engine_guard
unset ANTHESIS_TRIAL_EXPECTED_RULE
ANTHESIS_TRIAL_EXPECTED_REASON=unknown_runtime
```

## Verification commands

From the Warden repository:

```bash
npm test
npm run build:agent-runner
```

With the evaluator environment configured:

```bash
npm test -- container/agent-runner/src/anthesis-authorization.test.ts
```

The evaluator-backed tests cover:

- generated exact-request allow;
- unknown-runtime engine-guard denial;
- target/payload binding;
- caller and attempt binding;
- symlink escape denial;
- malformed decision denial;
- pre/post filesystem evidence;
- direct dispatch denial for a tool outside the trial allowlist.

## Independent evidence checks

The evidence file is JSONL. Inspect it independently of model output:

```bash
jq -c . "$ANTHESIS_TRIAL_EVIDENCE_FILE"
```

For a successful write, verify:

- `outcome == "success"`;
- `target` is the intended relative path;
- `pre_state_digest != post_state_digest` when content changed;
- `attempt_id` matches the current attempt;
- `request_binding` matches the evaluator-bound request;
- `evaluator.name == "anthesis-lab"`;
- `adapter_version` is present.

For a denied write, verify:

- `outcome == "denied-before-effect"`;
- the target state is unchanged independently of the returned tool string.

## Bypass cases

Do not call the trial complete until the runtime has either disabled or explicitly tested:

- `Edit`;
- Bash/terminal;
- MCP-derived tools;
- desktop and host callbacks;
- document writers and skill-management writers;
- direct filesystem and child-process access.

A successful `Write` authorization only proves the selected cooperative seam. Any residual path must be reported as a bypass or the runtime must be restricted to the `anthesis-trial` toolset.
