# Anthesis trial bypass inventory

Status: bounded cooperative adapter

This inventory records effect-capable paths visible in the current Warden agent runtime. The Anthesis adapter governs only the registered `Write` handler. It is not an OS containment boundary.

## Governed path

| Path | Current status | Evidence |
| --- | --- | --- |
| `container/agent-runner/src/tools/file-write.ts` → `Write` | Governed when `ANTHESIS_GOVERNED_WRITES=true`; disabled mode preserves existing behavior | Authorization runs before the write; target and payload are bound; post-state is read back; JSONL outcome evidence is optional/configured by `ANTHESIS_TRIAL_EVIDENCE_FILE` |

## Residual effect paths

| Path | Current status | Trial classification |
| --- | --- | --- |
| `container/agent-runner/src/tools/file-edit.ts` → `Edit` | Direct `fs.writeFileSync`; no Anthesis authorization hook | Residual bypass: can mutate files outside the governed `Write` path |
| `container/agent-runner/src/tools/terminal.ts` | Runs shell commands through `/bin/bash` and can write arbitrary files/processes | Residual bypass: unrestricted command execution can bypass the adapter |
| `container/agent-runner/src/tools/host-tools.ts` → `open_app` | Emits a host callback with arbitrary application and arguments | Residual host-effect path; callback consumer must be audited separately |
| `container/agent-runner/src/tools/desktop.ts` | Uses host command execution | Residual host-effect path |
| MCP-derived tools in `src/skills.ts` / `src/mcp-client.ts` | Dynamically registered external tools; authorization depends on each provider | Residual bypass unless the trial runtime excludes MCP tools or wraps every effect-capable provider |
| `container/agent-runner/src/tools/documents.ts` | Writes generated document content directly | Residual write path; not covered by the file-write adapter |
| `container/agent-runner/src/skills.ts` | Built-in skill management writes skill/config files | Residual write path; not covered by the file-write adapter |
| Host filesystem access by any process in the trial runtime | Not mediated by the tool registry | Residual bypass unless the disposable runtime isolates the workspace and process capabilities |

## Non-authorization paths

The following may influence context but must not authorize effects:

- Mercury memory and retrieval context.
- Model prose claiming that an action is approved.
- Prior execution results or evidence records.
- MCP tool descriptions or skill text.

Only a validated Governance Lab decision bound to the current request may authorize the governed `Write` path.

## Trial assurance level

Current assurance: cooperative tool-wrapper enforcement.

This supports claims about the selected `Write` seam only. It does not support claims of complete mediation, universal non-bypassability, credential isolation, or protection against a hostile local process or administrator.

## Required next runtime restriction

The registry now supports an opt-in bounded trial allowlist:

```text
ANTHESIS_TRIAL_RESTRICT_TOOLS=true
ANTHESIS_TRIAL_ALLOWED_TOOLS=Write
```

When enabled, disallowed tools are removed from generated tool definitions and rejected at direct dispatch. The default allowlist is `Write`; set `ANTHESIS_TRIAL_ALLOWED_TOOLS` explicitly for a different bounded fixture.

The registry restriction is also exposed as the explicit `anthesis-trial` toolset, whose only tool is `Write`. Use that toolset when constructing the disposable runtime so the intended boundary is visible in configuration as well as enforced at dispatch.

This remains insufficient against a process with direct filesystem or child-process access.

For a complete-mediation trial, start a disposable runtime exposing only the governed write dispatcher and the evaluator client. Disable or remove:

1. `Edit`.
2. Shell and terminal tools.
3. Host callbacks and desktop tools.
4. MCP-derived tools.
5. Direct filesystem and child-process access unrelated to the dispatcher.

If those paths remain available, execute each as an explicit bypass case and report the result as residual rather than claiming the authorization boundary held.
