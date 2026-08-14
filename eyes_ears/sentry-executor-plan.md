# Sentry Awareness — EXECUTOR PLAN (exact, do not deviate)

## STEP 0 — Inspect what's already done (DO THIS FIRST, no edits yet)

Several edits were already applied by hand and by interrupted subagents. **Subagents may have partially applied, duplicated, or mangled the edits below.** Before editing anything, run:

```bash
cd /home/dominic/Projects/Warden

# agent-runner index.ts — check for the 3 Sentry edits + any duplicates
grep -nE "sentry|Sentry|awareness|EYES — YOUR SURROUNDINGS" container/agent-runner/src/index.ts | head -40

# toolsets — should show awareness + awareness-core (already applied, verify)
grep -nE "awareness" container/agent-runner/src/toolsets.ts

# awareness-tools.ts — should exist with awareness_log + tell_sentry (already applied, verify)
grep -nE "awareness_log|tell_sentry" container/agent-runner/src/tools/awareness-tools.ts container/agent-runner/src/tools/index.ts

# Warden host — should show all of these (already applied, verify)
grep -nE "resolveAwarenessModel|awareness_log|tell_sentry|isAwareness|agent: 'sentry'" src/index.ts | head
grep -nE "awarenessLog|awareness_log" src/security-log.ts | head

# security app (already applied, verify)
grep -nE "send_awareness|room_occupied|awareness" security/main.py security/core/warden.py security/config/settings.example.yaml | head -20
```

**If a Sentry edit exists TWICE in `container/agent-runner/src/index.ts` (dup entries from interrupted agents), delete the duplicate(s) first.** The file must contain each of the three blocks below exactly ONCE.

**Already applied (verify, do NOT redo):**
- `security/main.py` — arm/disarm state + presence tracker + AWARENESS emission + dot-only annotate
- `security/core/warden.py` — `send_awareness(event, data)`
- `security/core/server.py` — `/arm` `/disarm` endpoints + `armed` in `/status`
- `security/core/capture.py` — `annotate()` draws keypoints only, no boxes (helper `_draw_box` still exists, unused — remove it if it's the only remaining reference)
- `security/config/settings.example.yaml` — `awareness:` + `model.device:` sections, `device: cuda`
- `src/index.ts` — `resolveAwarenessModel()`, `arm_security`/`disarm_security`/`awareness_log`/`tell_sentry` host callbacks, arm/disarm + AWARENESS blocks in `processOwnerMessages`
- `src/security-log.ts` — `awareness_log` table + `awarenessLog()`
- `container/agent-runner/src/toolsets.ts` — `awareness` + `awareness-core`
- `container/agent-runner/src/tools/index.ts` — imports `awareness-tools.js`
- `container/agent-runner/src/tools/awareness-tools.ts` — new file

---

## STEP 1 — container/agent-runner/src/index.ts: Sentry SUBAGENTS entry

Find the Heimdall entry (it ends with `toolsets: ['security-core'],` followed by `},`). Insert immediately after that `},`:

```ts
    {
        delegate: 'sentry',
        label: 'Sentry',
        maxIterations: 8,
        summary:
            "situational awareness: assess a webcam AWARENESS event (arrival/departure/unknown/covered) using " +
            "the detector's raw data + history, and speak a brief greeting/note only if it's worth announcing. " +
            "Runs in the background; dies silently on non-events.",
        systemPrompt: `You are Sentry, Warden's situational-awareness agent. You run in the background.

The webcam detector posts an AWARENESS event with raw data (no frame): event type (arrival / departure / unknown / covered), whether the person is known + their label, person count, motion area, seconds the room was empty (seconds_empty) or occupied (seconds_occupied), camera-covered flag, and time.

YOUR CALL — is this worth saying out loud?

GREET (send_message ONCE):
- A KNOWN person (e.g. the owner) arrives after the room was empty a while (seconds_empty large — a real absence, not a kitchen trip) → a brief warm greeting.
- An UNKNOWN person arrives → one brief note.
DIE SILENTLY (no send_message):
- Routine presence, brief absences/re-entries, or something you already announced recently. Query awareness_log (action: query) to check whether you greeted recently; if so, stay silent.
- A departure is usually silent — only note it if genuinely unusual.

ALWAYS record your verdict first: awareness_log action: record, assessment 'spoken' + spoken=<your line> if you spoke, else 'silent'. Then, if speaking, send_message ONCE — plain spoken English, no markdown, no emoji, one or two short sentences.

You may call webcam_capture ONCE only if the raw data genuinely isn't enough; it almost always is. Then STOP.`,
        toolsets: ['awareness-core'],
    },
```

## STEP 2 — container/agent-runner/src/index.ts: Sentry run-mode dispatch

Find the block starting `if (containerInput.agent === 'heimdall') {` and ending with:
```ts
        if ((globalThis as any)._keepAlive) clearInterval((globalThis as any)._keepAlive);
        process.exit(0);
    }
```
Insert immediately after that block (before the `log(\`Using Ollama runner ...\`)` line):

```ts
    // Sentry run-mode: host spawns this process with agent:'sentry' to run the
    // background awareness agent directly. Mirrors the heimdall branch above.
    if (containerInput.agent === 'sentry') {
        try {
            const def = SUBAGENT_BY_DELEGATE.get('sentry');
            if (!def) throw new Error('sentry sub-agent not defined');
            const tools = SUBAGENT_TOOL_DEFS.get('sentry') || [];
            const ctx = {
                chatJid: containerInput.chatJid || 'owner@local',
                groupFolder: containerInput.groupFolder || 'owner',
                isMain: containerInput.isMain ?? true,
                userId: process.env.WARDEN_USER_ID || '',
            };
            const model = containerInput.model || process.env.AWARENESS_MODEL || ORCHESTRATOR_MODEL;
            log(`[sentry] starting background awareness agent: model=${model || '(none)'}, tools=${tools.length}, task="${(containerInput.prompt || '').slice(0, 80)}"`);
            const sa = await runSubAgent('sentry', model, def.systemPrompt, tools, containerInput.prompt || '', ctx, def.maxIterations);
            writeOutput({ status: 'success', result: sa.content || 'Sentry: done (silent).', error: null });
        } catch (err: any) {
            log(`[sentry] error: ${err.message}`);
            writeOutput({ status: 'error', result: null, error: `Sentry error: ${err.message}` });
        }
        if ((globalThis as any)._keepAlive) clearInterval((globalThis as any)._keepAlive);
        process.exit(0);
    }
```

## STEP 3 — container/agent-runner/src/index.ts: tell_sentry exposed to orchestrator

Find the `ALWAYS_INCLUDED_TOOLS` set. It ends with:
```ts
        'tell_heimdall',
    ]);
```
Change to:
```ts
        'tell_heimdall',
        'tell_sentry',
    ]);
```

## STEP 4 — container/agent-runner/src/index.ts: orchestrator EYES prompt section

In the `systemPrompt` const (~line 1757), find the `# WHAT THE USER HEARS` heading. Insert BEFORE it:

```
# EYES — YOUR SURROUNDINGS

You have a webcam facing the room (the `webcam_capture` tool). When the user asks a contextual question about your immediate surroundings — "what do you see", "what's around you", "who's there", "what's that over there", "is someone at the door", "what's on my desk" — call `webcam_capture` once, look at the frame yourself, and answer directly in plain spoken English (one or two sentences). Do NOT delegate this to a sub-agent: sub-agents cannot see images — only you can. Only use it for genuine "look at my surroundings" questions. If the frame can't be interpreted (model not vision-capable), say briefly that you can't see right now.

```

## STEP 5 — Dashboard-configurable awareness model

`sentry` model is resolved by `resolveAwarenessModel()` in `src/index.ts` (env `WARDEN_AWARENESS_MODEL` → router key `awareness:model` → default `granite4:latest`). Make it a dashboard setting:

1. Find how the dashboard renders/writes model settings — look in `src/status-server.ts` (grep `orchestrator:model`, ~line 1399 mirrors settings into router_state + live env) and the dashboard HTML/JS (grep for `orchestrator:model` in `public/` or wherever settings UI lives).
2. Add an `awareness:model` field next to the `orchestrator:model` picker, reusing the SAME write path (save → `router_state` key `awareness:model`, prefix `local:` for Ollama models exactly like other model settings).
3. Default suggestion for the UI placeholder: `granite4:latest`.

If the settings UI is a hand-edited page, just add the one field following the existing model-setting pattern — no new framework.

## STEP 6 — Build + restart

```bash
cd /home/dominic/Projects/Warden
npm run build                    # must complete with zero TS errors (or whatever the build script is — check package.json)
systemctl --user restart warden
```

## STEP 7 — Verify end-to-end

```bash
# 1. Security app emits AWARENESS (use low thresholds to trigger quickly):
cd /home/dominic/Projects/Warden/security
cat > /tmp/aware_test.yaml <<EOF
awareness:
  enabled: true
  empty_threshold_seconds: 5
  presence_debounce: 2
  cooldown_seconds: 5
EOF
./run.sh --no-window --config /tmp/aware_test.yaml
# Leave frame for >5s, then re-enter → expect log line:
#   "AWARENESS arrival (empty Ns, known=...) → Sentry"

# 2. Warden routes it + Sentry runs on the local model:
journalctl --user -u warden -f | grep -iE "awareness|sentry"
# expect: "Awareness event → routing to Sentry (background)" with model=granite4:latest
# (or whatever awareness:model is set to) and a send_message when it decides to greet.

# 3. history recorded:
sqlite3 /home/dominic/Projects/Warden/store/security.db "SELECT ts, event, assessment, spoken FROM awareness_log ORDER BY id DESC LIMIT 5;"

# 4. Eyes: in the chat, ask "what do you see right now?" → orchestrator answers via webcam_capture.
#    (Needs the orchestrator/on whatever model to be vision-capable.)
```

## DO NOT
- Do not re-apply any edit in the "Already applied" list.
- Do not change Heimdall, the security alert path, or the arm/disarm path.
- Do not add cloud-model defaults anywhere; Sentry must stay local by default (`granite4:latest`).
- Do not remove the pHash known-person path in `security/core/known.py` (face-ID is a separate later plan in `/home/dominic/.claude/plans/face-id-next.md`).
