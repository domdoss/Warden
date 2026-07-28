---
name: add-feature
description: Add a feature to Warden. Researches GitHub for similar implementations, plans, backs up, implements, tests, and verifies. Use when the user wants to add, change, or extend any capability in Warden.
parameters:
  - name: feature
    type: string
    description: What the user wants to add or change
when_to_use: User asks to add a feature, change behavior, extend capabilities, or build something new into Warden. Phrases like "add a...", "can you make it so...", "I want the dashboard to...", "build a...", "create a...".
example_prompt: Add a dark mode toggle to the dashboard settings
---

# Add Feature to Warden

You are adding a feature to the Warden codebase. Follow each phase in order. Do not skip phases.

## Phase 1: Research

Search GitHub for how other projects have implemented this kind of feature:

```bash
gh search code "<feature keywords>" --language=typescript --limit=10
gh search repos "<feature topic>" --limit=10
```

Also check if a Warden plugin or skill already exists for this:

```bash
ls data/skills/ | grep -i "<feature>"
gh search code "warden <feature>" --limit=10
```

Summarize findings: what patterns exist, what approaches other projects use, whether anything already exists for Warden. Present this to the user before proceeding.

## Phase 2: Plan

Based on the research, write a brief implementation plan:

- Which files will change
- What the approach is
- Any new dependencies needed
- Estimated scope (small/medium/large)

Present the plan to the user. Wait for approval before proceeding.

## Phase 3: Backup

Before touching any files, create a timestamped backup of every file that will be modified:

```bash
BACKUP_DIR="data/backups/feature-<name>-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp <file1> <file2> ... "$BACKUP_DIR/"
```

Also back up the current database:

```bash
cp store/messages.db "$BACKUP_DIR/messages.db"
```

Log the backup location.

## Phase 4: Implement

Make the changes. You are free to:

- Modify TypeScript source files
- Create new files, scripts, or tools
- Add MCP servers if needed
- Update package.json if new dependencies are required

After implementation, rebuild if TypeScript was changed:

```bash
npm run build
```

If the agent-runner source changed, rebuild it too:

```bash
cd container/agent-runner && npx tsc --outDir ../../dist/agent-runner --skipLibCheck --strict false
```

## Phase 5: Unit Tests

Write unit tests alongside the new code. Follow existing test patterns in the repo:

- Test files go next to the source they test (e.g., `src/foo.test.ts` for `src/foo.ts`)
- Use the existing test framework (vitest or plain node assertions — match what's already used)
- Cover: happy path, error cases, edge cases

Run the tests:

```bash
npx vitest run <test-file> 2>/dev/null || node --test <test-file>
```

Fix any failures before proceeding.

## Phase 6: End-to-End Tests

Drive the feature through its actual interface:

- If it's a dashboard feature: use browser tools to navigate to the dashboard and verify the feature works
- If it's an API endpoint: use `curl` to hit the endpoint and verify the response
- If it's a channel feature: send a test message through that channel
- If it's a CLI/config change: run the affected command and verify output

Document what you tested and the results.

## Phase 7: Verify

Run the full test suite to confirm nothing broke:

```bash
npm test 2>/dev/null || npx vitest run 2>/dev/null || echo "No test runner configured — manual verification required"
```

Restart the service to apply changes:

```bash
systemctl --user restart warden
```

Wait for it to come up, then confirm the feature works live:

```bash
systemctl --user status warden
curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/
```

## Phase 8: Report

Summarize what was done:

- Feature implemented
- Files changed (list each one)
- Tests added (list each one)
- Backup location
- Any caveats or follow-up items
