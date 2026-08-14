"""Structured situation tracker for the security camera.

Builds a compact, frame-by-frame JSON description of what the cheap detector
sees, then emits *change events* when something meaningfully changes. The goal
is to stop shipping JPEGs to a vision model for routine awareness; instead we
send structured data (people, motion, objects, camera state) to Sentry/Warden
and only escalate when the data says something changed.

Current simplifications (marked with # TODO: improvement comments):
- Person IDs are kept with simple center-distance/IOU matching. This breaks on
  occlusion or people crossing paths; a real re-ID embedding is the upgrade.
- "Camera moved" uses whole-frame pHash differences. It works for abrupt scene
  changes (camera picked up / door opened / light switched) but confuses big
  moving objects with camera motion. ORB/RANSAC or optical-flow ego-motion is
  the upgrade.
- Object list is whatever RF-DETR returns; the keypoint model is person-only, so
  in practice objects are empty. A multi-class detection model, or a second
  specialized classifier, would populate this.
- Motion region is just the bounding box of the thresholded mask. A contour
  cluster would be more useful.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from .motion import MotionResult

log = logging.getLogger("security.situation")


@dataclass
class TrackedPerson:
    """One person with a stable(ish) ID for change detection."""
    id: int
    cx: float
    cy: float
    w: float
    h: float
    confidence: float
    keypoints: List[Dict[str, Any]] = field(default_factory=list)
    frames_missing: int = 0
    # centroid history for movement detection
    history: deque = field(default_factory=lambda: deque(maxlen=10))


@dataclass
class GhostTrack:
    """A recently-lost person kept alive for re-identification.

    When the detector briefly drops a stationary person (sitting still, low
    confidence), we keep their last-known position as a ghost. If they reappear
    in roughly the same spot within ``ghost_ttl_frames``, we revive the original
    ID instead of minting a new one and spamming arrival/departure events.
    """
    id: int
    cx: float
    cy: float
    w: float
    h: float
    confidence: float
    keypoints: List[Dict[str, Any]] = field(default_factory=list)
    frames_missing: int = 0


@dataclass
class DetectedObject:
    """Non-person detection in the frame."""
    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass
class Situation:
    """The complete structured snapshot for one frame."""
    ts: str
    frame_width: int
    frame_height: int
    camera_covered: bool
    camera_moved: bool
    room_occupied: bool
    seconds_in_state: float
    person_count: int
    persons: List[Dict[str, Any]]
    objects: List[Dict[str, Any]]
    motion_area: int
    motion_ratio: float
    motion_bbox: Optional[Tuple[int, int, int, int]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ts": self.ts,
            "frame": {"width": self.frame_width, "height": self.frame_height},
            "camera": {"covered": self.camera_covered, "moved": self.camera_moved},
            "room": {"occupied": self.room_occupied, "seconds_in_state": round(self.seconds_in_state, 1)},
            "persons": self.persons,
            "objects": self.objects,
            "motion": {
                "area": self.motion_area,
                "ratio": round(self.motion_ratio, 4),
                "bbox": self.motion_bbox,
            },
        }


@dataclass
class ChangeEvent:
    """A single semantic change worth telling Warden about."""
    event: str  # arrival|departure|movement|camera_covered|camera_uncovered|camera_moved|motion_burst|note
    subject_id: Optional[int] = None
    data: Dict[str, Any] = field(default_factory=dict)


class SituationTracker:
    """Maintains scene state and returns (Situation, [ChangeEvent]) per frame."""

    def __init__(
        self,
        presence_debounce: int = 3,
        absence_debounce: int | None = None,
        motion_min_area: int = 1500,
        motion_movement_px: int = 80,
        camera_moved_threshold: int = 16,
        camera_moved_history: int = 5,
        object_min_confidence: float = 0.2,
    ):
        # Debounce frames before flipping occupancy. Absence uses a higher default
        # so brief detector dropouts while someone is sitting still don't spam
        # departure/arrival cycles.
        self.presence_debounce = max(1, presence_debounce)
        self.absence_debounce = max(1, absence_debounce if absence_debounce is not None else presence_debounce * 3)
        self.motion_min_area = motion_min_area
        self.motion_movement_px = motion_movement_px
        self.camera_moved_threshold = camera_moved_threshold
        self.camera_moved_history = camera_moved_history
        self.object_min_confidence = object_min_confidence

        # Person re-identification state.
        # TODO: upgrade to appearance embedding (e.g. OSNet/ReID or a small
        # self-supervised embedding) so IDs survive occlusion and crossing paths.
        self._next_id = 1
        self._tracked: Dict[int, TrackedPerson] = {}
        self._persons_missing_frames: Dict[int, int] = {}

        # Recently-lost tracks kept as "ghosts" so brief detector dropouts don't
        # mint a new person ID and spam arrival/departure events. TTL is based on
        # the occupancy absence debounce; default gives ~3-6 seconds at 5 fps.
        self._ghosts: Dict[int, GhostTrack] = {}
        self._ghost_ttl_frames = max(15, self.absence_debounce * 2)

        # Room occupancy state.
        self._room_occupied = False
        self._state_since = time.time()
        self._present_streak = 0
        self._absent_streak = 0
        self._last_announced_count = 0

        # Person-count debounce: require the count to be stable for a few frames
        # before announcing arrival/departure, so brief detector flicker doesn't
        # spam awareness events while someone is sitting still.
        self._stable_count = 0
        self._stable_count_streak = 0

        # Per-event cooldowns (seconds) so a flickering non-person motion signal
        # or a wobbling camera cover doesn't generate a stream of awareness events.
        self._motion_burst_cooldown_seconds = 15.0
        self._camera_cover_cooldown_seconds = 5.0
        self._last_motion_burst_event = 0.0
        self._last_camera_cover_event = 0.0

        # Camera-motion state.
        self._prev_phashes: deque = deque(maxlen=camera_moved_history)
        self._camera_moved_recent = 0.0  # time we last flagged camera_moved

        # Misc.
        self._prev_covered = False
        self._prev_motion_area = 0

    # ── Public API ───────────────────────────────────────────────────────────

    def update(
        self,
        frame_bgr: np.ndarray,
        detections,
        motion_res: MotionResult,
        camera_covered: bool,
    ) -> Tuple[Situation, List[ChangeEvent]]:
        """Process one frame and return the current situation + any change events."""
        now = time.time()
        h, w = frame_bgr.shape[:2]
        ts = time.strftime("%Y%m%dT%H%M%S")

        # Split detections into persons and objects.
        persons_input, objects_input = self._split_detections(detections)

        # Match persons to existing IDs and update tracks.
        matched_ids, new_persons = self._update_tracks(persons_input, w, h)
        current_count = len(self._tracked)

        # Compute room occupancy with debounce.
        room_occupied, seconds_in_state = self._update_occupancy(current_count, now)

        # Detect camera motion from whole-frame pHash differences.
        camera_moved = self._detect_camera_moved(frame_bgr, camera_covered)

        # Motion region bbox from the binary mask.
        motion_bbox = self._motion_bbox(motion_res.mask)

        # Build serializable lists. Ghosts are included so the person count
        # stays stable across brief detector dropouts; frames_missing > 0 marks
        # entries that haven't been re-detected this frame.
        persons_out = [
            self._person_to_dict(p)
            for p in list(self._tracked.values()) + list(self._ghosts.values())
        ]
        objects_out = [self._object_to_dict(o) for o in objects_input]

        situation = Situation(
            ts=ts,
            frame_width=w,
            frame_height=h,
            camera_covered=camera_covered,
            camera_moved=camera_moved,
            room_occupied=room_occupied,
            seconds_in_state=seconds_in_state,
            person_count=len(persons_out),
            persons=persons_out,
            objects=objects_out,
            motion_area=motion_res.area,
            motion_ratio=motion_res.ratio,
            motion_bbox=motion_bbox,
        )

        events: List[ChangeEvent] = []

        # Camera covered/uncovered transitions.
        if (
            camera_covered
            and not self._prev_covered
            and now - self._last_camera_cover_event >= self._camera_cover_cooldown_seconds
        ):
            self._last_camera_cover_event = now
            events.append(ChangeEvent("camera_covered", data={"ts": ts}))
        if not camera_covered and self._prev_covered:
            events.append(ChangeEvent("camera_uncovered", data={"ts": ts}))
        self._prev_covered = camera_covered

        # Camera moved is a self-diagnostic, not an awareness event. If the camera
        # physically moves we reset tracking state, but we do NOT notify Sentry.
        if camera_moved and (now - self._camera_moved_recent) >= 10.0:
            self._camera_moved_recent = now
            self.reset()

        # Person-count transitions are the real awareness events. We don't care
        # about individual IDs — we care whether the number of people changed.
        # Debounce the count so a flickering detector while someone sits still
        # doesn't emit repeated arrival/departure events.
        current_count = len(persons_out)
        if current_count == self._stable_count:
            self._stable_count_streak += 1
        else:
            self._stable_count = current_count
            self._stable_count_streak = 1

        prev_count = self._last_announced_count
        count_stable = self._stable_count_streak >= self.presence_debounce
        if (
            count_stable
            and current_count != prev_count
            and room_occupied == self._room_occupied
        ):
            # Count changed while occupancy state was stable (e.g. 1 -> 2 people).
            if current_count > prev_count:
                events.append(ChangeEvent(
                    "arrival",
                    data={"ts": ts, "person_count": current_count, "previous_count": prev_count},
                ))
            elif current_count < prev_count:
                events.append(ChangeEvent(
                    "departure",
                    data={"ts": ts, "person_count": current_count, "previous_count": prev_count},
                ))
            self._last_announced_count = current_count

        # Room occupancy transitions: empty -> occupied or occupied -> empty.
        if room_occupied and not self._room_occupied:
            events.append(ChangeEvent(
                "arrival",
                data={"ts": ts, "person_count": current_count, "summary": "room became occupied"},
            ))
            self._last_announced_count = current_count
        if not room_occupied and self._room_occupied:
            events.append(ChangeEvent(
                "departure",
                data={"ts": ts, "person_count": current_count, "summary": "room became empty"},
            ))
            self._last_announced_count = current_count

        self._room_occupied = room_occupied

        # NOTE: deliberate choice — do NOT emit "movement" events from tracked
        # people. People move constantly; centroid drift is not a meaningful
        # awareness event. Only transitions in person count / occupancy and
        # non-person motion bursts are reported.

        # Motion burst while room is empty: something moved but no person was
        # detected. Could be a pet, door, fan, or missed detection.
        # Cooldown prevents a flickering motion mask from spamming events.
        if (
            not room_occupied
            and not camera_covered
            and motion_res.area >= self.motion_min_area
            and self._prev_motion_area < self.motion_min_area
            and now - self._last_motion_burst_event >= self._motion_burst_cooldown_seconds
        ):
            self._last_motion_burst_event = now
            events.append(ChangeEvent(
                "motion_burst",
                data={"ts": ts, "motion_area": motion_res.area, "motion_ratio": round(motion_res.ratio, 4)},
            ))
        self._prev_motion_area = motion_res.area

        return situation, events

    def reset(self) -> None:
        """Drop all state (e.g. after camera moved / camera uncovered)."""
        self._tracked.clear()
        self._persons_missing_frames.clear()
        self._next_id = 1
        self._room_occupied = False
        self._state_since = time.time()
        self._present_streak = 0
        self._absent_streak = 0
        self._prev_phashes.clear()
        self._prev_covered = False
        self._stable_count = 0
        self._stable_count_streak = 0
        self._last_motion_burst_event = 0.0
        self._last_camera_cover_event = 0.0
        self._ghosts.clear()

    # ── Internal helpers ────────────────────────────────────────────────────

    def _split_detections(self, detections):
        """Separate person detections from other COCO detections.

        Runs non-maximum suppression on person boxes to collapse the overlapping
        hallucinations that the keypoint model sometimes emits at low confidence.
        """
        persons = []
        objects = []
        raw_persons = []
        for d in detections.detections:
            if d.class_name == "person":
                raw_persons.append(d)
            elif d.confidence >= self.object_min_confidence:
                objects.append(DetectedObject(
                    class_name=d.class_name,
                    confidence=d.confidence,
                    x1=float(d.xyxy[0]),
                    y1=float(d.xyxy[1]),
                    x2=float(d.xyxy[2]),
                    y2=float(d.xyxy[3]),
                ))

        # NMS to merge overlapping person detections into one real person.
        # TODO: this is a coarse fix; the real issue is the model threshold. Once
        # the threshold is raised, NMS should rarely need to merge more than 2 boxes.
        if raw_persons:
            boxes = np.array([[d.xyxy[0], d.xyxy[1], d.xyxy[2], d.xyxy[3]] for d in raw_persons], dtype=float)
            scores = np.array([d.confidence for d in raw_persons], dtype=float)
            keep = cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), 0.35, 0.5)
            if keep is not None and len(keep) > 0:
                keep = keep.flatten() if hasattr(keep, 'flatten') else keep
                persons = [raw_persons[int(i)] for i in keep]
            else:
                persons = raw_persons

        return persons, objects

    def _best_match(
        self,
        track: TrackedPerson | GhostTrack,
        candidates: List[Dict[str, Any]],
        matched_new: set,
    ) -> Tuple[int, float]:
        """Return (candidate_index, cost) for the best unmatched candidate."""
        best_idx = -1
        best_cost = float("inf")
        for i, c in enumerate(candidates):
            if i in matched_new:
                continue
            dx = c["cx"] - track.cx
            dy = c["cy"] - track.cy
            dist = (dx * dx + dy * dy) ** 0.5
            iou = self._iou(
                (track.cx - track.w / 2, track.cy - track.h / 2,
                 track.cx + track.w / 2, track.cy + track.h / 2),
                (c["x1"], c["y1"], c["x2"], c["y2"]),
            )
            # Weight distance more than IOU; IOU is unreliable on fast motion.
            cost = dist - iou * 50.0
            if cost < best_cost:
                best_cost = cost
                best_idx = i
        return best_idx, best_cost

    def _update_tracks(self, persons, frame_w, frame_h):
        """Match detected people to existing IDs; return (matched_ids, new_ids).

        Ghost tracks are recently-lost people kept alive for re-identification.
        A detection that matches a ghost revives the original ID silently; only
        detections that match neither a live track nor a ghost become new IDs.
        """
        # Build candidate centers/boxes.
        candidates = []
        for p in persons:
            x1, y1, x2, y2 = (float(v) for v in p.xyxy[:4])
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            candidates.append({
                "cx": cx, "cy": cy, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "conf": p.confidence, "keypoints": p.keypoints,
            })

        matched_existing: set = set()
        matched_new: set = set()
        live_matches: List[Tuple[int, int, float]] = []  # (track_id, cand_idx, cost)

        # 1. Match live tracks first.
        for tid, track in self._tracked.items():
            best_idx, best_cost = self._best_match(track, candidates, matched_new)
            if best_idx >= 0 and best_cost < 150.0:
                live_matches.append((tid, best_idx, best_cost))

        # Greedy live assignment by lowest cost.
        live_matches.sort(key=lambda x: x[2])
        assigned_tracks: Dict[int, TrackedPerson] = {}
        for tid, cidx, _cost in live_matches:
            if tid in assigned_tracks or cidx in matched_new:
                continue
            c = candidates[cidx]
            track = self._tracked[tid]
            track.cx = c["cx"]
            track.cy = c["cy"]
            track.w = c["x2"] - c["x1"]
            track.h = c["y2"] - c["y1"]
            track.confidence = c["conf"]
            track.frames_missing = 0
            track.history.append((track.cx, track.cy))
            track.keypoints = self._keypoints_to_dict(c["keypoints"])
            assigned_tracks[tid] = track
            matched_existing.add(tid)
            matched_new.add(cidx)

        # 2. Promote unmatched live tracks that have passed presence_debounce to
        #    ghosts so a brief dropout can be recovered without a new ID.
        gone_ids = []
        for tid, track in self._tracked.items():
            if tid not in matched_existing:
                track.frames_missing += 1
                if track.frames_missing >= self.presence_debounce:
                    gone_ids.append(tid)
        for tid in gone_ids:
            track = self._tracked.pop(tid)
            self._ghosts[tid] = GhostTrack(
                id=track.id,
                cx=track.cx,
                cy=track.cy,
                w=track.w,
                h=track.h,
                confidence=track.confidence,
                keypoints=track.keypoints,
                frames_missing=track.frames_missing,
            )

        # 3. Try to revive ghosts with remaining candidates. Use the same cost
        #    threshold as live tracks; a stationary person in the same chair will
        #    match, while a new person entering across the room will not.
        ghost_matches: List[Tuple[int, int, float]] = []
        for tid, ghost in list(self._ghosts.items()):
            best_idx, best_cost = self._best_match(ghost, candidates, matched_new)
            if best_idx >= 0 and best_cost < 150.0:
                ghost_matches.append((tid, best_idx, best_cost))

        ghost_matches.sort(key=lambda x: x[2])
        revived: set = set()
        for tid, cidx, _cost in ghost_matches:
            if cidx in matched_new or tid in revived:
                continue
            c = candidates[cidx]
            ghost = self._ghosts.pop(tid)
            self._tracked[tid] = TrackedPerson(
                id=tid,
                cx=c["cx"],
                cy=c["cy"],
                w=c["x2"] - c["x1"],
                h=c["y2"] - c["y1"],
                confidence=c["conf"],
                keypoints=self._keypoints_to_dict(c["keypoints"]),
                frames_missing=0,
                history=deque([(c["cx"], c["cy"])], maxlen=10),
            )
            matched_existing.add(tid)
            matched_new.add(cidx)
            revived.add(tid)

        # 4. Age ghosts and drop expired ones.
        expired = []
        for tid, ghost in list(self._ghosts.items()):
            ghost.frames_missing += 1
            if ghost.frames_missing >= self._ghost_ttl_frames:
                expired.append(tid)
        for tid in expired:
            self._ghosts.pop(tid, None)

        # 5. Fresh detections become new IDs.
        new_ids = []
        for i, c in enumerate(candidates):
            if i in matched_new:
                continue
            pid = self._next_id
            self._next_id += 1
            new_ids.append(pid)
            self._tracked[pid] = TrackedPerson(
                id=pid,
                cx=c["cx"],
                cy=c["cy"],
                w=c["x2"] - c["x1"],
                h=c["y2"] - c["y1"],
                confidence=c["conf"],
                keypoints=self._keypoints_to_dict(c["keypoints"]),
                frames_missing=0,
                history=deque([(c["cx"], c["cy"])], maxlen=10),
            )

        return matched_existing, new_ids

    @staticmethod
    def _iou(a, b) -> float:
        """IOU of two xyxy boxes."""
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        iw = max(0.0, ix2 - ix1)
        ih = max(0.0, iy2 - iy1)
        inter = iw * ih
        area_a = (ax2 - ax1) * (ay2 - ay1)
        area_b = (bx2 - bx1) * (by2 - by1)
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0

    def _update_occupancy(self, person_count: int, now: float):
        """Return (occupied, seconds_in_current_state) with debounce."""
        if person_count > 0:
            self._present_streak += 1
            self._absent_streak = 0
        else:
            self._absent_streak += 1
            self._present_streak = 0

        # Transition only after debounce frames. Absence requires more frames
        # so brief detector dropouts don't declare the room empty.
        if not self._room_occupied and self._present_streak >= self.presence_debounce:
            self._room_occupied = True
            self._state_since = now
        elif self._room_occupied and self._absent_streak >= self.absence_debounce:
            self._room_occupied = False
            self._state_since = now

        return self._room_occupied, now - self._state_since

    def _detect_camera_moved(self, frame_bgr: np.ndarray, camera_covered: bool) -> bool:
        """True if the whole-frame pHash changed abruptly vs recent history.

        # TODO: replace pHash with ORB keypoints + RANSAC homography or optical
        # flow to separate camera ego-motion from moving objects. pHash sees
        # any big spatial-frequency change as "moved", which is acceptable for
        # "did someone pick up the camera / open a door" but noisy otherwise.
        """
        if camera_covered:
            # Don't compare covered frames; they will always register as moved.
            return False

        h = self._frame_phash(frame_bgr)
        if h is None:
            return False

        moved = False
        if self._prev_phashes:
            # Compare against the average of recent hashes so one odd frame
            # doesn't trigger; require agreement across the window.
            distances = [self._phash_distance(h, prev) for prev in self._prev_phashes]
            avg_dist = sum(distances) / len(distances)
            if avg_dist >= self.camera_moved_threshold:
                moved = True

        self._prev_phashes.append(h)
        return moved

    def _frame_phash(self, frame_bgr: np.ndarray) -> Optional[str]:
        """Return a cheap perceptual hash string, or None if libs unavailable.

        # TODO: this duplicates known.py's deleted pHash logic; keep it here
        # because the upgrade path is different (camera motion vs person re-ID).
        """
        try:
            from PIL import Image
            import imagehash
            import cv2
        except Exception as e:
            if not hasattr(self, "_phash_warned"):
                log.warning("imagehash/PIL unavailable for camera-moved detection: %s", e)
                self._phash_warned = True
            return None
        try:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            pil = Image.fromarray(rgb)
            return str(imagehash.phash(pil))
        except Exception as e:
            log.warning("camera-moved pHash failed: %s", e)
            return None

    @staticmethod
    def _phash_distance(a: str, b: str) -> int:
        """Hamming distance between two hex pHash strings."""
        try:
            # If imagehash is available, use its parser for robustness.
            import imagehash
            return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)
        except Exception:
            pass
        # Fallback bit-diff between hex strings.
        try:
            ai = int(a, 16)
            bi = int(b, 16)
            x = ai ^ bi
            return bin(x).count("1")
        except Exception:
            return 0

    @staticmethod
    def _motion_bbox(mask: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
        """Bounding box of nonzero motion mask, or None if no motion."""
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return None
        return (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))

    @staticmethod
    def _keypoints_to_dict(kps):
        """Serialize RF-DETR keypoints to compact dicts."""
        if kps is None:
            return []
        try:
            xy = kps.xy
            conf = kps.confidence
        except Exception:
            return []
        out = []
        # COCO person keypoint names, same order as RF-DETR keypoint preview.
        names = [
            "nose", "left_eye", "right_eye", "left_ear", "right_ear",
            "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
            "left_wrist", "right_wrist", "left_hip", "right_hip",
            "left_knee", "right_knee", "left_ankle", "right_ankle",
        ]
        for i, (x, y) in enumerate(xy):
            c = float(conf[i]) if i < len(conf) else 1.0
            if c <= 0.3:
                continue
            out.append({
                "k": names[i] if i < len(names) else f"kp{i}",
                "x": round(float(x), 1),
                "y": round(float(y), 1),
                "c": round(c, 2),
            })
        return out

    @staticmethod
    def _person_to_dict(p: TrackedPerson) -> Dict[str, Any]:
        return {
            "id": p.id,
            "cx": round(p.cx, 1),
            "cy": round(p.cy, 1),
            "w": round(p.w, 1),
            "h": round(p.h, 1),
            "conf": round(p.confidence, 2),
            "keypoints": p.keypoints,
            "frames_missing": p.frames_missing,
        }

    @staticmethod
    def _object_to_dict(o: DetectedObject) -> Dict[str, Any]:
        return {
            "class": o.class_name,
            "conf": round(o.confidence, 2),
            "bbox": [round(o.x1, 1), round(o.y1, 1), round(o.x2, 1), round(o.y2, 1)],
        }
