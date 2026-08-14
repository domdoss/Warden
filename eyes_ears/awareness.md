# Jarvis Situational Awareness — continuous, local, token-frugal

## Context

Jarvis (the `voice/` client → Warden) already has **ears + mouth** (mic→Whisper→Warden, Warden→Kokoro→speaker). It has **eyes** mechanically (`webcam_capture`, orchestrator-only, injected via `_pendingImages`), but the orchestrator is never told it can look, and eyes are only on-demand screenshots.

The user wants **ongoing** awareness — Jarvis watches the room continuously via the *cheap, already-running* RF-DETR detector (free on GPU), and a **local** model processes that raw data to decide when something interesting is happening and react (e.g. say hello when the user comes home). The hard constraints: **event-driven** (not per-frame) and **no cloud tokens** — a local model decides, and it only fires on interesting events.

The pipeline:

```
webcam → RF-DETR (local, free, ongoing) → raw data
  (person present?, known/unknown + pHash label, motion, seconds room empty)
  │  presence tracker: empty→occupied after absence = ARRIVAL event
  ▼
AWARENESS — <event> at <ts>. data: {json}  ← posted to Warden /api/messages
  ▼
Warden processOwnerMessages detects AWARENESS → spawns "sentry" background agent
  (LOCAL model, e.g. granite4:latest — free) with the event + raw data + history
  ▼
Sentry decides: worth announcing?  yes → send_message (→ Kokoro speaks) | no → die silent
```

No cloud model, no per-frame VLM, no orchestrator turn. The deciding agent is local and fires only on events.

**Both run at once.** The armed-security path (Heimdall) and the awareness path (Sentry) coexist on the same detector: when **armed**, a person/covered-camera flag still goes to Heimdall (`SECURITY ALERT`) exactly as today; **always** (armed or disarmed), the presence tracker emits `AWARENESS` events to Sentry. So the user can arm it for security and still leave it running for awareness — the same webcam + RF-DETR feed both, on different events. Awareness is independent of `armed` ("outside the security thing"), with its own cooldown and enable flag.

A separate small tweak makes the **orchestrator** use its existing `webcam_capture` eyes for on-demand contextual questions ("what do you see", "who's there").

---

## Changes

### 1. Security app — presence tracking + AWARENESS events

**`security/main.py`** — add a presence tracker that runs every frame *regardless of* `armed` (awareness ≠ security arming):

- Track `room_occupied` (debounced: `presence_debounce` consecutive frames with/without a person to flip), `last_present_ts`, `empty_since_ts`.
- **ARRIVAL** event: empty→occupied transition where the room was empty ≥ `awareness.empty_threshold_seconds`. On arrival, run `known.is_known(frame)` (existing pHash, `security/core/known.py`) → include `is_known` + `label` in the event data.
- **DEPARTURE** event: occupied→empty sustained ≥ `presence_debounce` (optional, lower priority — Sentry decides if worth noting).
- Build a compact JSON data payload: `event`, `is_known`, `label`, `person_count`, `motion_area`, `seconds_empty`, `ts`, `camera_covered`.
- Post `AWARENESS — <event> at <ts>. data: <json>` to Warden via the existing `WardenClient` (new `send_awareness(event, data)` method mirroring `send_alert`, same `/api/messages` POST). Subject to `awareness.cooldown_seconds` and `awareness.enabled`.
- This block is **separate from** the armed-flagging block; it emits even when disarmed.

**`security/core/warden.py`** — add `send_awareness(self, event, data)` that POSTs `{"jid": owner_jid, "text": "AWARENESS — {event} at {ts}. data: {json}"}` to `/api/messages` (reuse the `send_alert` HTTP path).

**`security/config/settings.example.yaml`** — new section:
```yaml
awareness:
  enabled: true            # independent of security arm/disarm
  empty_threshold_seconds: 300   # room empty >= this → an arrival is "coming home"
  presence_debounce: 3            # consecutive frames to flip occupied/empty
  cooldown_seconds: 600          # min seconds between AWARENESS posts
```

### 2. Warden — route AWARENESS to a new "sentry" background agent

**`src/index.ts` `processOwnerMessages`** — add a block (after the arm/disarm block, before the `SECURITY ALERT` block) mirroring the Heimdall routing:

- Detect `pending.some(m => (m.content||'').startsWith('AWARENESS'))`.
- Advance cursor, save state, pre-write an `awarenessLog` row (so an event is always recorded even if Sentry crashes — same engrained-logging pattern as security flags at `src/index.ts:1447-1458`).
- Build the task: `Current local time is {localNow} (timezone {tz}).\n\n{awarenessText}`.
- Model: `getRouterState('awareness:model')` stripped of `local:`, **fallback `granite4:latest`** (local text, 2.1 GB, frugal; runs on CPU to avoid VRAM contention with RF-DETR). Guarantee: if the resolved model is a cloud model and no `awareness:model` is explicitly set, keep the local default — so it never burns tokens unless the user explicitly opts in. Allow override via env `WARDEN_AWARENESS_MODEL`.
- `runSubAgentBackground({ agent: 'sentry', prompt: task, model, sessionId:'owner', workspaceRoot: WORKSPACE_ROOT, chatJid: OWNER_JID, groupFolder:'owner', isMain:true, timeoutMs: 90*1000, callbacks: buildAgentCallbacks() })` (fire-and-forget, exactly the Heimdall shape at `src/index.ts:1469-1480`).
- `return;` so the orchestrator never runs on awareness events.

### 3. Sentry subagent definition

**`container/agent-runner/src/index.ts`** — add to the `SUBAGENTS` array right after Heimdall (`:765`):

- `delegate: 'sentry'`, `label: 'Sentry'`, `maxIterations: 8` (greetings are short)
- `summary`: "situational awareness: assess a webcam AWARENESS event (arrival/departure/unknown/covered) using the detector's raw data + history, and speak a brief greeting/note only if it's worth announcing. Runs in the background; dies silently on non-events."
- `systemPrompt`: "You are Sentry, Warden's situational-awareness agent. You run in the background. The webcam detector reports an AWARENESS event with raw data: event type (arrival/departure/unknown/covered), whether the person is known + their label, person count, motion area, how long the room was empty, and the time. Decide whether this is worth announcing to the user. A known person (e.g. the owner) arriving after the room was empty a while → a brief warm greeting, spoken via send_message. Routine presence, brief absences, or events you already announced recently (check awareness_log) → die silently with NO send_message. Unknown person arriving → one brief note. Be concise, plain spoken English, no markdown, no emoji. If not worth announcing, STOP. You may call webcam_capture once if you genuinely need to see the frame to decide — but the raw data is usually enough; prefer not to."
- `toolsets: ['awareness-core']` (new).

### 4. Sentry toolset + tools

**`container/agent-runner/src/toolsets.ts`** — add (mirror `security-core` at `:48-49`):
```ts
awareness:    { name: 'awareness', tools: ['send_message','webcam_capture','awareness_log'], tier: 'public' },
'awareness-core': { name: 'awareness-core', includes: ['awareness'] },
```
(`send_message` and `webcam_capture` are already registered; listing them here just resolves them into Sentry's toolset — no re-registration.)

**`container/agent-runner/src/tools/awareness-tools.ts`** (new, mirror `security-tools.ts`):
- `awareness_log` — record/query a sqlite history (mirror `security_log`), `callHost('awareness_log', args)`.
- `tell_sentry` — orchestrator→Sentry direct (mirror `tell_heimdall`, `container/agent-runner/src/tools/security-tools.ts:119-142`), `toolset: 'chat'`, `tier: 'public'` (orchestrator-only). Lets the user tell Jarvis facts ("heading out for the evening") that factor into greetings.

### 5. Host callbacks

**`src/index.ts` `buildAgentCallbacks()`**:
- `awareness_log` → `awarenessLog(args)` (new, in `src/security-log.ts` mirroring `securityLog` — new `awareness_log` table in `store/security.db`: `id, timestamp, event, label, is_known, seconds_empty, assessment, spoken, data`).
- `tell_sentry` → spawn Sentry background with the passed message to record as context (mirror `tell_heimdall` at `src/index.ts:1219-1247`).
- `send_message` already exists and routes to Kokoro (proven path: `storeMessage` + `pushNotification('owner',{type:'chat_complete',...})` → SSE → `voice/core/assistant.py:183` → Kokoro). No change needed.

### 6. Orchestrator "eyes" for on-demand contextual Q&A

**`container/agent-runner/src/index.ts`** — add a short section to `systemPrompt` (after the `# ENVIRONMENT` block, ~`:1778`):

> **# EYES — YOUR SURROUNDINGS**
> You have a webcam (`webcam_capture`) facing the room. For a contextual question about your immediate surroundings — "what do you see", "what's around you", "who's there", "what's that over there", "is someone at the door" — call `webcam_capture` once, look at the frame yourself, and answer directly in spoken English. Do NOT delegate this to a sub-agent: sub-agents cannot see images (only you can). Keep it to a sentence or two. (Requires your model to be vision-capable; if it isn't, say briefly that you can't see right now.)

Note: this path uses the orchestrator's model — to keep it token-frugal, the orchestrator model should be set to a local vision model (e.g. `gemma3:4b`) in the dashboard. That's a dashboard setting, not code; call it out as a recommendation.

---

## Files touched

- `security/main.py` — presence tracker + AWARENESS event emission (independent of armed)
- `security/core/warden.py` — `send_awareness(event, data)`
- `security/config/settings.example.yaml` — `awareness:` section
- `src/index.ts` — `processOwnerMessages` AWARENESS routing + `awareness_log`/`tell_sentry` host callbacks
- `src/security-log.ts` — `awarenessLog` + `awareness_log` table
- `container/agent-runner/src/index.ts` — Sentry `SUBAGENTS` entry + orchestrator "eyes" prompt section
- `container/agent-runner/src/toolsets.ts` — `awareness` / `awareness-core` toolsets
- `container/agent-runner/src/tools/awareness-tools.ts` — new (awareness_log, tell_sentry)

Reused, not re-implemented: `runSubAgentBackground` (`src/agent-spawn.ts:43`), `buildAgentCallbacks` `send_message` (`src/index.ts:312-350`), the `chat_complete`→Kokoro path (`voice/core/assistant.py:183`), `known.is_known` (`security/core/known.py`), the `NewMessage` ack pattern (`src/index.ts:1356-1367`).

---

## Verification

1. **Security app presence/emission** — `cd security && ./run.sh --no-window`. Leave the room > `empty_threshold_seconds`, re-enter. Log shows `AWARENESS — arrival at <ts>. data: {...}`. Confirm with Warden off it still logs locally.
2. **Routing + Sentry** — start Warden (`systemctl --user start warden` after `npm run build`). Trigger an arrival. `journalctl --user -u warden` shows `Security awareness → routing to Sentry (background)` and Sentry's `send_message` (`src/index.ts:312-350` log). Jarvis speaks the greeting via Kokoro.
3. **Silent on routine** — stay in frame; no AWARENESS posts (cooldown + debounce). Briefly leave/return (< threshold) → no greeting (Sentry dies silent; check `awareness_log` row has `spoken=false`).
4. **No tokens** — `awareness:model` unset → resolved model is `granite4:latest` (local). Confirm in logs the Sentry model is local, not a cloud model.
5. **Eyes (orchestrator)** — in Jarvis, ask "what do you see right now?" → orchestrator calls `webcam_capture`, answers in one or two spoken sentences. (Needs orchestrator model set to a local vision model for the token-frugal version.)
6. **Arm/disarm independence** — `curl -X POST 127.0.0.1:8765/disarm`, then trigger an arrival → awareness still fires and greets (independent of security arming).

## Out of scope / future

- Face-ID (replace pHash with embeddings for reliable recognition across lighting/position) — `known.py` is the swap point.
- Richer scene understanding (the agent describing what's happening, not just greeting) — set `awareness:model` to `gemma3:4b` (vision) and let Sentry call `webcam_capture`.
- Dashboard UI for the `awareness:model` setting (currently env/router-key only).
- Multi-camera / RTSP (the detector opens one webcam).