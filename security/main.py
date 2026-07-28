#!/usr/bin/env python3
"""Security Mode — structured awareness camera feed.

A cheap local model (RF-DETR Keypoint) watches the webcam at a low frame rate
and builds a structured situation description every frame: people with stable
IDs, motion regions, camera state, objects. When something changes (someone
arrives or leaves, the camera is covered, the camera is moved, large motion
while empty), a compact JSON AWARENESS message is posted to Warden's owner
chat. Warden routes these messages to Sentry, a background local model, which
decides whether to tell the user.

This app intentionally does NOT send images for routine awareness. Frames are
still published on the local /frame HTTP endpoint so Warden can pull a live
image on demand (e.g. when the user asks "what do you see").

Usage:
    python main.py                      # config/settings.yaml (or defaults)
    python main.py --config my.yaml
    python main.py --camera 1           # override webcam index
    python main.py --no-voice           # don't launch the voice/ client
    python main.py --no-window          # headless (no GUI window)
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from typing import Optional

import cv2
import numpy as np

from core.config import load_config
from core.detector import Detector
from core.motion import MotionDetector
from core.situation import SituationTracker
from core.warden import WardenClient
from core.voice_launcher import VoiceLauncher
from core.server import FrameServer

log = logging.getLogger("security")

# Status-light colours (BGR).
LIGHT_GREEN = (0, 200, 0)     # idle / clear
LIGHT_AMBER = (0, 180, 255)   # motion
LIGHT_RED = (0, 0, 230)       # camera covered or camera moved
LIGHT_GREY = (120, 120, 120)  # no data

_running = True


def _stop(*_):
    global _running
    _running = False


def parse_args(argv: list[str] | None = None):
    p = argparse.ArgumentParser(description="Warden Security Mode awareness feed")
    p.add_argument("--config", help="Path to settings.yaml")
    p.add_argument("--camera", type=int, help="Override webcam index")
    p.add_argument("--no-voice", action="store_true", help="Don't launch the voice/ client")
    p.add_argument("--no-window", action="store_true", help="Headless (no GUI window)")
    return p.parse_args(argv)


def _overlay(frame: np.ndarray, light_color, status: str, fps: float) -> np.ndarray:
    """Draw the alert light (top-left circle) + a status line onto the frame."""
    out = frame
    h, w = out.shape[:2]
    BLACK = (0, 0, 0)
    WHITE = (255, 255, 255)

    cv2.circle(out, (28, 28), 14, light_color, -1)
    cv2.circle(out, (28, 28), 14, WHITE, 1)
    cv2.rectangle(out, (0, 0), (w, 4), light_color, -1)  # top bar

    # Black background strip behind status text so it stays readable on dark frames.
    text_y = 38
    cv2.rectangle(out, (50, text_y - 24), (w, text_y + 10), BLACK, -1)
    _shadow_text(out, f"Warden Security  |  {status}", (55, text_y), 0.6)

    # Black background strip behind FPS counter.
    fps_text = f"{fps:4.1f} fps"
    fps_w = 110
    cv2.rectangle(out, (w - fps_w, h - 32), (w, h - 8), BLACK, -1)
    _shadow_text(out, fps_text, (w - fps_w + 5, h - 12), 0.55)
    return out


def _shadow_text(out: np.ndarray, text: str, pos: tuple, scale: float) -> None:
    """Draw bold white text with a black drop shadow for readability on any background."""
    BLACK = (0, 0, 0)
    WHITE = (255, 255, 255)
    x, y = pos
    # Single offset shadow, then bold white text on top.
    cv2.putText(out, text, (x + 2, y + 2), cv2.FONT_HERSHEY_SIMPLEX,
                scale, BLACK, 2, cv2.LINE_AA)
    cv2.putText(out, text, pos, cv2.FONT_HERSHEY_SIMPLEX,
                scale, WHITE, 2, cv2.LINE_AA)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    cfg = load_config(args.config)
    logging.basicConfig(
        level=getattr(logging, cfg.get("logging", {}).get("level", "INFO").upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    cam_cfg = cfg["camera"]
    model_cfg = cfg["model"]
    motion_cfg = cfg["motion"]
    aware_cfg = cfg.get("awareness", {})
    warden_cfg = cfg.get("warden", {})
    voice_cfg = cfg.get("voice", {})
    fs_cfg = cfg.get("frame_server", {})

    if args.camera is not None:
        cam_cfg["index"] = args.camera

    show_window = not args.no_window

    log.info("opening webcam index %s (%dx%d @ %d fps)",
             cam_cfg["index"], cam_cfg["width"], cam_cfg["height"], cam_cfg["fps"])
    cap = cv2.VideoCapture(int(cam_cfg["index"]))
    if not cap.isOpened():
        log.error("could not open webcam index %s", cam_cfg["index"])
        return 2
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, cam_cfg["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cam_cfg["height"])

    log.info("loading model (variant=%s, threshold=%.2f) — first frame may be slow",
             model_cfg["variant"], model_cfg["threshold"])
    detector = Detector(
        variant=model_cfg["variant"],
        threshold=model_cfg["threshold"],
        size=model_cfg.get("size", "small"),
    )
    motion = MotionDetector(
        blur=motion_cfg["blur"],
        pixel_threshold=motion_cfg["pixel_threshold"],
        min_area=motion_cfg["min_area"],
    )
    tracker = SituationTracker(
        presence_debounce=int(aware_cfg.get("presence_debounce", 3)),
        absence_debounce=int(aware_cfg.get("absence_debounce", 0)) or None,
        motion_min_area=int(aware_cfg.get("motion_min_area", 1500)),
        motion_movement_px=int(aware_cfg.get("motion_movement_px", 80)),
        camera_moved_threshold=int(aware_cfg.get("camera_moved_threshold", 16)),
        camera_moved_history=int(aware_cfg.get("camera_moved_history", 5)),
        object_min_confidence=float(aware_cfg.get("object_min_confidence", 0.2)),
    )

    warden = WardenClient(
        base_url=warden_cfg.get("base_url", "http://127.0.0.1:3200"),
        owner_jid=warden_cfg.get("owner_jid", "owner@local"),
    )

    frame_server = FrameServer(
        host=fs_cfg.get("host", "0.0.0.0"),
        port=int(fs_cfg.get("port", 8765)),
    )
    frame_server.start()
    frame_server.set_armed(False)  # no armed-flagging concept anymore

    # Alert state set by the desktop when Heimdall confirms an anomaly.
    alert_active = False
    alert_until = 0.0
    alert_timeout = 60.0  # seconds the red light stays on after /alert/open

    def set_alert():
        nonlocal alert_active, alert_until
        alert_active = True
        alert_until = time.time() + alert_timeout
        log.info("desktop confirmed alert → red alert light on")

    frame_server.on_alert_open = set_alert

    voice = None
    if not args.no_voice and voice_cfg.get("enabled", True):
        voice = VoiceLauncher(
            voice_dir=voice_cfg.get("dir", "../voice"),
            auto_setup=voice_cfg.get("auto_setup", True),
        )
        voice.start()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    # Camera-tamper detection: near-uniform frame sustained over a few frames.
    covered_std = float(aware_cfg.get("covered_std", 6))
    covered_frames = int(aware_cfg.get("covered_frames", 3))
    covered_count = 0

    # Awareness posting cooldown (min seconds between any two AWARENESS messages).
    awareness_cooldown = float(aware_cfg.get("cooldown_seconds", 30))
    last_awareness_event: Optional[str] = None
    last_awareness_post = 0.0
    last_suppression_log = 0.0  # rate-limit "suppressed/cooldown" log lines

    interval = 1.0 / max(1, cam_cfg["fps"])
    last_infer = 0.0
    last_frame_time = 0.0
    fps = 0.0
    state = "IDLE"
    light = LIGHT_GREEN

    # Live sliders.
    if show_window:
        cv2.namedWindow("Warden Security")
        cv2.createTrackbar("conf x100", "Warden Security",
                           int(model_cfg.get("threshold", 0.2) * 100), 95, lambda _v: None)
        cv2.createTrackbar("motion px", "Warden Security",
                           int(motion_cfg.get("min_area", 800)), 5000, lambda _v: None)

    try:
        while _running:
            now = time.time()
            if now - last_infer < interval:
                time.sleep(min(0.05, interval - (now - last_infer)))
                continue

            ok, frame = cap.read()
            if not ok or frame is None:
                log.warning("frame grab failed; retrying")
                time.sleep(0.1)
                continue

            last_infer = now
            if last_frame_time:
                fps = 0.9 * fps + 0.1 * (1.0 / max(1e-3, now - last_frame_time))
            last_frame_time = now

            if show_window:
                detector.threshold = cv2.getTrackbarPos("conf x100", "Warden Security") / 100.0
                motion.min_area = cv2.getTrackbarPos("motion px", "Warden Security")

            # Publish the raw frame to the /frame server so Warden can pull it on demand.
            ok_enc, jpg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if ok_enc:
                frame_server.set_frame(jpg.tobytes())

            motion_res = motion.step(frame)
            dets = detector.predict(frame)

            # Camera-tamper check.
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            frame_std = float(gray.std())
            if frame_std < covered_std:
                covered_count += 1
            else:
                covered_count = 0
            camera_covered = covered_count >= covered_frames

            # Build structured situation and detect changes.
            situation, events = tracker.update(frame, dets, motion_res, camera_covered)

            # Expire desktop-triggered alert after alert_timeout.
            if alert_active and time.time() > alert_until:
                alert_active = False

            # Status light: red if desktop alerted, camera covered, or camera moved;
            # amber on motion; green when idle. No armed state anymore.
            if alert_active:
                light, state = LIGHT_RED, "ALERT — desktop confirmed"
            elif camera_covered or situation.camera_moved:
                light, state = LIGHT_RED, "CAMERA ALERT"
            elif motion_res.area >= motion.min_area:
                light, state = LIGHT_AMBER, "MOTION"
            elif situation.room_occupied:
                light, state = LIGHT_GREEN, "OCCUPIED"
            else:
                light, state = LIGHT_GREEN, "IDLE"

            # Post change events to Warden, respecting the cooldown.
            # # TODO: batch closely-spaced events into one AWARENESS message to
            # reduce Sentry wake-ups; e.g. arrival + movement on the same frame
            # should probably be a single "arrival" event with movement data.
            if events:
                since_last = now - last_awareness_post
                # Pick the highest-priority event to announce. Order matters.
                priority = ["camera_covered", "camera_moved", "arrival", "departure",
                            "movement", "camera_uncovered", "motion_burst", "note"]
                chosen = min(events, key=lambda e: priority.index(e.event)
                             if e.event in priority else len(priority))

                # Only send if the high-level situation actually changed from the
                # last sent one, AND we're past the cooldown. This stops repeated
                # arrival events caused by IDs flipping (a new person gets a new ID
                # every time the tracker loses/re-acquires them).
                situation_digest = (
                    f"event={chosen.event}:count={situation.person_count}:"
                    f"occupied={situation.room_occupied}:covered={situation.camera_covered}:"
                    f"moved={situation.camera_moved}"
                )
                if since_last >= awareness_cooldown and situation_digest != last_awareness_event:
                    payload = {
                        "event": chosen.event,
                        "situation": situation.to_dict(),
                    }
                    payload.update(chosen.data)
                    res = warden.send_awareness(chosen.event, payload)
                    if res.get("ok"):
                        last_awareness_post = now
                        last_awareness_event = situation_digest
                        log.info("AWARENESS — %s posted", chosen.event)
                    else:
                        log.warning("AWARENESS %s not delivered: %s", chosen.event, res.get("error"))
                else:
                    # Suppression/cooldown is expected; keep it at debug level so a
                    # moving person doesn't fill the info log for the entire window.
                    if now - last_suppression_log >= 5.0:
                        last_suppression_log = now
                        if since_last < awareness_cooldown:
                            log.debug("AWARENESS events queued but cooldown active (%.0fs left)",
                                      awareness_cooldown - since_last)
                        else:
                            log.debug("AWARENESS %s suppressed — same situation already reported", chosen.event)

            frame_server.set_state(state)
            if show_window:
                display = _overlay(frame.copy(), light, state, fps)
                cv2.imshow("Warden Security", display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    finally:
        cap.release()
        if show_window:
            cv2.destroyAllWindows()
        frame_server.stop()
        if voice is not None:
            voice.stop()
        log.info("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
