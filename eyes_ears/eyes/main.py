#!/usr/bin/env python3
"""Oculus — structured awareness camera feed.

A cheap local model (RF-DETR Keypoint) watches the webcam at a low frame rate
and builds a structured situation description every frame: people with stable
IDs, motion regions, camera state, objects. When something changes (someone
arrives or leaves, the camera is covered, the camera is moved, large motion
while empty), a compact JSON AWARENESS message is posted to Warden's owner
chat. Warden routes these messages to Sentry, a background local model, which
decides whether to tell the user. The orchestrator can pull the live frame on
demand if it needs a visual description.

This app intentionally does NOT send images for routine awareness. Frames are
still published on the local /frame HTTP endpoint so Warden can pull a live
image on demand (e.g. when the user asks "what do you see").

Usage:
    python main.py                      # config/settings.yaml (or defaults)
    python main.py --config my.yaml
    python main.py --camera 1           # override webcam index
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

try:
    import tkinter as tk
    from tkinter import simpledialog
    _HAS_TK = True
except Exception:
    _HAS_TK = False

from core.config import Config
from eyes.detector import Detector
from eyes.motion import MotionDetector
from eyes.situation import SituationTracker
from eyes.warden import WardenClient
from eyes.server import FrameServer
from eyes import known

log = logging.getLogger("oculus")

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
    p = argparse.ArgumentParser(description="Oculus awareness feed")
    p.add_argument("--config", help="Path to settings.yaml")
    p.add_argument("--camera", type=int, help="Override webcam index")
    p.add_argument("--stream", help="Override camera with an HTTP/MJPEG stream URL (e.g. http://esp32-cam.local:81/stream)")
    p.add_argument("--no-window", action="store_true", help="Headless (no GUI window)")
    p.add_argument("--warden-url", help="Override the Warden server URL (e.g. http://192.168.0.171:3200) instead of settings.yaml warden.base_url")
    return p.parse_args(argv)


def _overlay(frame: np.ndarray, light_color, status: str, fps: float,
             source_label: str = "") -> np.ndarray:
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
    _shadow_text(out, f"Oculus  |  {status}", (55, text_y), 0.6)

    # Source label under the status line (e.g. "cam:0" or stream URL host).
    if source_label:
        src_y = text_y + 20
        cv2.rectangle(out, (50, src_y - 14), (w, src_y + 8), BLACK, -1)
        _shadow_text(out, f"source: {source_label}", (55, src_y), 0.45)

    # Keyboard hints.
    hint_y = text_y + 40
    cv2.rectangle(out, (50, hint_y - 14), (w, hint_y + 8), BLACK, -1)
    _shadow_text(out, "[q] quit  [s] source  [k] save known person", (55, hint_y), 0.4)

    # Black background strip behind FPS counter.
    fps_text = f"{fps:4.1f} fps"
    fps_w = 110
    cv2.rectangle(out, (w - fps_w, h - 32), (w, h - 8), BLACK, -1)
    _shadow_text(out, fps_text, (w - fps_w + 5, h - 12), 0.55)
    return out


def _shadow_text(out: np.ndarray, text: str, pos: tuple, scale: float,
                color: tuple = (255, 255, 255), thickness: int = 2) -> None:
    """Draw bold text with a black drop shadow for readability on any background."""
    BLACK = (0, 0, 0)
    x, y = pos
    cv2.putText(out, text, (x + 2, y + 2), cv2.FONT_HERSHEY_SIMPLEX,
                scale, BLACK, thickness, cv2.LINE_AA)
    cv2.putText(out, text, pos, cv2.FONT_HERSHEY_SIMPLEX,
                scale, color, thickness, cv2.LINE_AA)


def _iou(a: tuple, b: tuple) -> float:
    """IOU of two xyxy boxes."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def _center_in_box(cx: float, cy: float, box: tuple) -> bool:
    """True if the point (cx,cy) is inside the xyxy box."""
    x1, y1, x2, y2 = box
    return x1 <= cx <= x2 and y1 <= cy <= y2


def _draw_scene_overlay(
    frame: np.ndarray,
    dets,
    recognized: Optional[dict],
    motion_bbox: Optional[tuple] = None,
) -> np.ndarray:
    """Draw detection boxes, labels, keypoints, and recognized names on the frame."""
    out = frame.copy()
    h, w = out.shape[:2]
    GREEN = (0, 255, 0)
    RED = (0, 0, 255)
    BLUE = (255, 0, 0)
    YELLOW = (0, 255, 255)
    WHITE = (255, 255, 255)

    # Motion region.
    if motion_bbox is not None:
        x1, y1, x2, y2 = motion_bbox
        cv2.rectangle(out, (x1, y1), (x2, y2), YELLOW, 2)
        _shadow_text(out, "motion", (x1, max(y1 - 4, 15)), 0.45, YELLOW, 1)

    # Best-matched recognized face box, if any.
    rec_label = None
    rec_bbox = None
    if recognized and recognized.get("label"):
        rec_label = recognized["label"]
        rec_bbox = recognized.get("bbox")

    # Per-detection overlays.
    for d in dets.detections:
        x1, y1, x2, y2 = (int(v) for v in d.xyxy[:4])
        cls = d.class_name
        conf = d.confidence
        box_color = GREEN
        label_text = f"{cls} {conf:.2f}"

        if cls == "person":
            box_color = BLUE
            # If this person box contains the recognized face center, show the name.
            # A face is almost always inside the person detection, so center-in-box
            # is more reliable than IOU when the two boxes differ in size.
            if rec_label and rec_bbox:
                face_cx = (rec_bbox[0] + rec_bbox[2]) / 2.0
                face_cy = (rec_bbox[1] + rec_bbox[3]) / 2.0
                if _center_in_box(face_cx, face_cy, (x1, y1, x2, y2)):
                    label_text = f"{rec_label} ({conf:.2f})"
                    box_color = GREEN

        cv2.rectangle(out, (x1, y1), (x2, y2), box_color, 2)
        _shadow_text(out, label_text, (x1, max(y1 - 4, 15)), 0.45, box_color, 1)

        # Keypoints for person detections.
        if cls == "person" and d.keypoints is not None:
            try:
                kps = d.keypoints.xy
                for (kx, ky) in kps:
                    cx, cy = int(kx), int(ky)
                    if 0 <= cx < w and 0 <= cy < h:
                        cv2.circle(out, (cx, cy), 3, (0, 200, 255), -1)
            except Exception:
                pass

    return out


def _source_label(stream_url: str | None, cam_index: int, width: int = 70) -> str:
    """Compact label for the active video source."""
    if not stream_url:
        return f"cam:{cam_index}"
    # Trim to width; show scheme+host+path tail.
    s = stream_url.replace("http://", "").replace("https://", "")
    if len(s) > width:
        s = s[:width - 3] + "..."
    return s


def _open_capture(stream_url: str | None, cam_cfg: dict):
    """Open a VideoCapture from an HTTP stream or a local webcam index."""
    if stream_url:
        cap = cv2.VideoCapture(stream_url)
    else:
        cap = cv2.VideoCapture(int(cam_cfg["index"]))
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, cam_cfg["width"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cam_cfg["height"])
    return cap


def _prompt_source(current: str, cam_index: int) -> str | None:
    """Ask the user for a new source (HTTP stream URL or camera index)."""
    if not _HAS_TK:
        log.warning("tkinter unavailable — cannot show settings dialog")
        return None
    try:
        root = tk.Tk()
        root.withdraw()
        prompt = (
            f"Current source: {current or f'cam:{cam_index}' }\n\n"
            "Enter an HTTP stream URL (e.g. http://esp32-cam.local:81/stream) "
            "or a camera index (e.g. 0, 1)."
        )
        result = simpledialog.askstring("Oculus — Source", prompt)
        root.destroy()
        return result.strip() if result else None
    except Exception as e:
        log.warning("source dialog failed: %s", e)
        return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    cfg = Config(args.config)
    logging.basicConfig(
        level=getattr(logging, cfg.get("logging", {}).get("level", "INFO").upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    cam_cfg = cfg.get("camera", {})
    model_cfg = cfg.get("model", {})
    motion_cfg = cfg.get("motion", {})
    aware_cfg = cfg.get("awareness", {})
    rec_cfg = cfg.get("recognition", {})
    warden_cfg = cfg.get("warden", {})
    fs_cfg = cfg.get("frame_server", {})

    if args.camera is not None:
        cam_cfg["index"] = args.camera

    show_window = not args.no_window

    stream_url = args.stream or cam_cfg.get("stream_url")
    cap = _open_capture(stream_url, cam_cfg)
    if not cap.isOpened():
        log.error("could not open video source")
        return 2

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

    # Lazy singleton for face recognition; it loads the model only when an
    # event actually fires, so the oculus feed starts fast.
    known_persons = known.KnownPersons(cfg)

    warden = WardenClient(
        base_url=args.warden_url or warden_cfg.get("base_url", "http://127.0.0.1:3200"),
        owner_jid=warden_cfg.get("owner_jid", "owner@local"),
    )

    frame_server = FrameServer(
        host=fs_cfg.get("host", "0.0.0.0"),
        port=int(fs_cfg.get("port", 8765)),
    )
    frame_server.start()
    # Eyes-open flagging is handled by the desktop now. The laptop accepts
    # /open and /close commands from the desktop/guard, but starts with eyes
    # closed so the user must explicitly open them.
    frame_server.set_eyes_open(False)

    def on_open():
        frame_server.set_eyes_open(True)
        log.info("oculus eyes open")

    def on_close():
        frame_server.set_eyes_open(False)
        log.info("oculus eyes closed")

    frame_server.on_open = on_open
    frame_server.on_close = on_close

    def on_known_save(frame_bgr, label):
        """Save the current frame's face as a known person on the laptop CPU."""
        ok = known_persons.save_known_person(frame_bgr, label)
        return {"ok": ok, "label": label} if ok else {"ok": False, "error": "no face detected"}

    frame_server.on_known_save = on_known_save

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

    # Visual feedback: run face recognition every N seconds just for the overlay.
    # This is separate from the awareness event recognition; it lets the GUI show
    # a name above a recognized person's head without spamming recognition on
    # every single frame.
    recognition_overlay_interval = float(rec_cfg.get("overlay_interval_seconds", 2.0))
    last_recognition_overlay = 0.0
    recognized_overlay: Optional[dict] = None

    interval = 1.0 / max(1, cam_cfg["fps"])
    last_infer = 0.0
    last_frame_time = 0.0
    fps = 0.0
    state = "IDLE"
    light = LIGHT_GREEN

    # Live sliders.
    source_label = _source_label(stream_url, int(cam_cfg["index"]))

    def switch_source():
        nonlocal cap, stream_url, source_label
        current = stream_url or f"cam:{cam_cfg['index']}"
        result = _prompt_source(current, int(cam_cfg["index"]))
        if result is None:
            return
        new_url: str | None = None
        try:
            idx = int(result)
            cam_cfg["index"] = idx
        except ValueError:
            new_url = result
        stream_url = new_url
        old_cap = cap
        cap = _open_capture(stream_url, cam_cfg)
        if cap.isOpened():
            old_cap.release()
            source_label = _source_label(stream_url, int(cam_cfg["index"]))
            log.info("switched source to %s", source_label)
        else:
            log.error("failed to open new source, keeping previous")
            cap.release()
            cap = old_cap

    if show_window:
        cv2.namedWindow("Oculus")
        cv2.createTrackbar("conf x100", "Oculus",
                           int(model_cfg.get("threshold", 0.2) * 100), 95, lambda _v: None)
        cv2.createTrackbar("motion px", "Oculus",
                           int(motion_cfg.get("min_area", 800)), 5000, lambda _v: None)

    def save_known_from_gui():
        """Prompt for a label and save the current frame as a known person."""
        if not _HAS_TK:
            log.warning("tkinter unavailable — cannot save known person from GUI")
            return
        try:
            root = tk.Tk()
            root.withdraw()
            label = simpledialog.askstring("Oculus — Save Known Person", "Enter name/label for this person:")
            root.destroy()
            if not label or not label.strip():
                return
            label = label.strip()
            ok, _ = cap.read()
            if ok:
                success = known_persons.save_known_person(frame, label)
                if success:
                    log.info("GUI: saved known person %r", label)
                else:
                    log.warning("GUI: no face detected; could not save %r", label)
            else:
                log.warning("GUI: no frame available to save known person")
        except Exception as e:
            log.warning("GUI save known person failed: %s", e)

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
                detector.threshold = cv2.getTrackbarPos("conf x100", "Oculus") / 100.0
                motion.min_area = cv2.getTrackbarPos("motion px", "Oculus")

            # Publish the raw frame to the /frame server so Warden can pull it on demand.
            ok_enc, jpg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if ok_enc:
                frame_server.set_frame(jpg.tobytes())

            motion_res = motion.step(frame)
            dets = detector.predict(frame)

            # Periodically run face recognition just for the visual overlay.
            # This is independent of awareness event recognition.
            if now - last_recognition_overlay >= recognition_overlay_interval:
                last_recognition_overlay = now
                try:
                    is_known, label, face_bbox = known_persons.is_known(frame, return_box=True)
                    if is_known and label:
                        recognized_overlay = {"label": label, "bbox": face_bbox}
                    else:
                        recognized_overlay = None
                except Exception as e:
                    log.debug("overlay recognition skipped: %s", e)
                    recognized_overlay = None

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

            # Status light reflects eyes-open state + situation.
            eyes_open = frame_server.is_eyes_open()
            if not eyes_open:
                light, state = LIGHT_GREY, "EYES CLOSED"
            elif camera_covered or situation.camera_moved:
                light, state = LIGHT_RED, "CAMERA ALERT"
            elif motion_res.area >= motion.min_area:
                light, state = LIGHT_AMBER, "MOTION"
            elif situation.room_occupied:
                light, state = LIGHT_GREEN, "OCCUPIED"
            else:
                light, state = LIGHT_GREEN, "IDLE"

            # Post change events to Warden, respecting the cooldown. Text
            # awareness (arrival/departure/face labels) is ALWAYS posted while
            # the detector runs — even with eyes closed, the host gets told
            # "3 people came, 2 left, one was so-and-so". eyes_open only gates
            # the IMAGE: the host fetches /frame when eyes_open is true so it
            # can look at the scene + describe it. We report eyes_open in the
            # payload so the host knows whether to fetch.
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
                        "eyes_open": eyes_open,
                    }
                    payload.update(chosen.data)

                    # Enrich awareness events with face recognition (CPU).
                    try:
                        is_known, label = known_persons.is_known(frame)
                        payload["is_known"] = is_known
                        payload["label"] = label
                        if label:
                            log.info("recognized %s as known person", label)
                    except Exception as e:
                        log.debug("face recognition skipped: %s", e)

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
                display = _draw_scene_overlay(frame, dets, recognized_overlay, situation.motion_bbox)
                display = _overlay(display, light, state, fps, source_label)
                cv2.imshow("Oculus", display)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if key == ord("s"):
                    switch_source()
                if key == ord("k"):
                    save_known_from_gui()
    finally:
        cap.release()
        if show_window:
            cv2.destroyAllWindows()
        frame_server.stop()
        log.info("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
