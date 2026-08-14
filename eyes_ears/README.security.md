# Warden Security Mode

A standalone webcam watcher that posts compact structured-JSON events to
**Sentry**, Warden's single background security/awareness agent. Sentry applies
the editable `security/sentry.md` rules and decides per event whether to alert
(send a captioned frame to chat + Telegram and light the red alert on the
camera machine), greet, or stay silent. It's a **basic framework** — plumbed in
and upgradable for real home-security use (Home Assistant, a real guard-dispatch
service, face-ID, etc. can be added as plugins/MCP later).

No YOLO (AGPL). Commercially-free models only: **RF-DETR Keypoint** (Apache 2.0)
for detection. Sentry runs on a light local model (vision optional).

## How it works

```
webcam (or ESP32-CAM HTTP stream) → RF-DETR Keypoint detector (CPU)
  │  builds a structured JSON situation each frame:
  │    persons, motion, camera state, room occupancy
  ▼
on a meaningful change (arrival, departure, camera covered/moved, motion burst)
  → POST AWARENESS JSON to Warden's dedicated /api/awareness endpoint
  │  (/api/messages rejects AWARENESS — routine awareness never hits chat)
  ▼
Warden spawns Sentry (background sub-agent, NOT the main chat)
  ▼
Sentry applies security/sentry.md rules + reads the latest frame:
  │  ALERT   → send_message (captioned frame, shows in chat + Telegram)
  │           + alert_security + open_security_alert (red STAND DOWN on the camera machine)
  │           + security_log (abnormal)
  │  GREET   → send_message (friendly arrival, no image)
  │  SILENT  → dismiss_security_flag / security_log (normal)
  ▼
ALERTED → red STAND DOWN button on the camera machine's window.
  The GUARD presses STAND DOWN (or says "close the alert" in chat) to re-arm.
```

There is no separate vision verifier — Sentry is the whole background security
path. Arm/disarm is owned by Sentry (and the laptop's `/arm` `/disarm`
endpoints); the detector starts **disarmed** by default and the status light
shows grey when disarmed.

### Events

AWARENESS events are **internal control messages**, not chat messages:

- POSTed to the dedicated `/api/awareness` endpoint on the desktop.
- `/api/messages` rejects AWARENESS; the awareness endpoint is the only valid path.
- Person `movement` is intentionally **not** an event — people move constantly,
  so only occupancy/count transitions and non-person motion bursts are reported.
- Count transitions are debounced (separate, longer `absence_debounce`) so a
  flickering detector while someone sits still doesn't spam arrival/departure.

## Files

```
security/
  main.py                # webcam loop, GUI (alert light + sliders + source switch)
  run.sh                 # activates the shared venv and runs main.py
  core/
    detector.py          # RF-DETR Keypoint wrapper
    motion.py            # frame-differencing motion detector
    situation.py         # structured situation tracker + change events
    config.py            # settings loader + COCO class names
    warden.py            # posts AWARENESS JSON to /api/awareness
    server.py            # tiny HTTP server: GET /frame, /status; POST /arm, /disarm, /alert/*
  config/settings.example.yaml   # copy to settings.yaml to customize
  sentry.md              # user-editable Sentry policy (injected into Sentry's prompt)
  requirements.txt
```

## Install

```bash
cd security
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt     # rfdetr pulls weights on first run (CPU)
cp config/settings.example.yaml config/settings.yaml   # edit if you like

# OpenCV's bundled Qt needs fonts for slider labels. Copy system DejaVu fonts
# into the cv2 Qt fonts directory so the GUI trackbars render correctly:
mkdir -p .venv/lib/python*/site-packages/cv2/qt/fonts
cp /usr/share/fonts/TTF/DejaVuSans.ttf .venv/lib/python*/site-packages/cv2/qt/fonts/
cp /usr/share/fonts/TTF/DejaVuSans-Bold.ttf .venv/lib/python*/site-packages/cv2/qt/fonts/
```

## Start

```bash
cd security && ./run.sh
# flags (forwarded to main.py):
#   --camera 1        override webcam index
#   --stream URL      use an HTTP/MJPEG stream (e.g. http://esp32-cam.local:81/stream)
#   --no-window       headless (no GUI)
#   --config my.yaml  override settings file
```

The window shows the live feed, an alert light (grey disarmed / green idle /
amber motion / red alert), and two sliders: **conf x100** (detection threshold)
and **motion px** (motion sensitivity). The active source is shown under the
status line. Press **s** to switch the video source live (HTTP stream URL or
camera index) via a small dialog.

Keyboard shortcuts:

- **q** — quit
- **s** — switch source
- **k** — save the current frame's face as a known person. You are prompted for
  a name/label; the face embedding is computed on CPU and stored locally in
  `store/security.db`. Future arrivals with a visible face will report
  `is_known: true` and the label, so Sentry can greet by name and skip alerts.

When Sentry raises an alert, a **red STAND DOWN** button appears at the bottom.
Press STAND DOWN (or type "close the alert" / "stand down" / "all clear" in the
Warden chat) to close the alert and re-arm.

## Stop

- Close the webcam window or press **q** in it, or
- `pkill -f "security/main.py"` (or kill the pid printed at start).

The frame server (`http://0.0.0.0:8765`) stops with it; Warden's
`webcam_capture` then falls back to ffmpeg `/dev/video0`.

## Warden side (already plumbed in)

- **Sentry** sub-agent: `container/agent-runner/src/index.ts` (SUBAGENTS),
  toolsets `awareness-core` + `security-core`. The agent-runner host reads
  `security/sentry.md` and prepends it to Sentry's system prompt; edit that file
  to change the policy.
- **AWARENESS routing**: the dedicated `/api/awareness` endpoint in
  `src/status-server.ts` records the event to `awareness_log` and spawns Sentry
  in the background. `/api/messages` rejects AWARENESS messages.
- **Orchestrator → Sentry direct**: the `tell_sentry` tool.
- **Arm/disarm**: `/arm` and `/disarm` endpoints on the camera machine's frame
  server; Sentry arms/disarms when the user asks.
- **Telegram**: alert `send_message` includes `[Image: …]`; the Telegram channel
  sends it as a photo, so alerts + their frames show on your phone.
- **security.db** (`store/security.db`): `security_log` (every flag +
  assessment) + `awareness_log` (every AWARENESS event + Sentry assessment).

## Model

Sentry shares the dashboard's **Toolcall model** (`local:subagent_model`). It's a light data-only decision maker — a small local model is plenty. Vision is optional: the security laptop runs Moondream on GPU when Sentry asks a question via `security_caption({"question":"..."})`, so the desktop Sentry model itself can stay text-only.

## Upgradable (later, not in the demo)

- **Home Assistant** as a plugin/MCP (arm/disarm, sensors, automations).
- **Real guard-dispatch** — swap the `alert_security` mock stub for a real
  HTTP call to a monitoring service.
- **More cameras / RTSP** — the detector opens one source (webcam or HTTP
  stream); multi-camera is a config + loop change.