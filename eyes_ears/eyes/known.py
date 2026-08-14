"""Known-person recognition for the security camera.

Primary: InsightFace face embeddings (default). Falls back to whole-frame
perceptual hash (pHash) if config says ``recognition.method: phash`` or if
InsightFace is unavailable.

Interface:
    is_known(frame_bgr) -> (bool, label|None)
    save_known_person(frame_bgr, label) -> bool
"""

from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

log = logging.getLogger("security.known")

DEFAULT_MATCH_THRESHOLD = 0.42
DEFAULT_MIN_FACE_SIZE = 60
DB_RELATIVE_PATH = Path(__file__).resolve().parent.parent.parent / "store" / "security.db"


class KnownPersons:
    """Lazy singleton that manages the known-persons DB and runs recognition."""

    def __init__(self, cfg: Optional[dict] = None):
        self.cfg = cfg or {}
        self.rec_cfg = self.cfg.get("recognition", {})
        self.method = str(self.rec_cfg.get("method", "insightface")).lower()
        self.device = str(self.rec_cfg.get("device", "cpu")).lower()
        self.match_threshold = float(self.rec_cfg.get("match_threshold", DEFAULT_MATCH_THRESHOLD))
        self.min_face_size = int(self.rec_cfg.get("min_face_size", DEFAULT_MIN_FACE_SIZE))
        self.db_path = Path(self.rec_cfg.get("db_path", str(DB_RELATIVE_PATH)))
        self._face = None
        self._db_init()

    # ── Public API ────────────────────────────────────────────────────────────

    def is_known(self, frame_bgr: np.ndarray, return_box: bool = False):
        """Return (is_known, label) for the best face in the frame.

        If return_box=True, returns (is_known, label, bbox) where bbox is
        (x1, y1, x2, y2) in pixel coords, or None.
        """
        if frame_bgr is None or frame_bgr.size == 0:
            if return_box:
                return False, None, None
            return False, None

        if self.method == "insightface":
            try:
                return self._is_known_insightface(frame_bgr, return_box=return_box)
            except Exception as e:
                log.warning("InsightFace recognition failed: %s", e)
                if return_box:
                    return False, None, None
                return self._is_known_phash(frame_bgr)

        result = self._is_known_phash(frame_bgr)
        if return_box:
            return (*result, None)
        return result

    def save_known_person(self, frame_bgr: np.ndarray, label: str) -> bool:
        """Store a face (or whole-frame pHash) as a known reference.

        For InsightFace the detector computes the embedding and writes it into
        the DB immediately. For pHash the hash is stored directly.
        """
        if frame_bgr is None or frame_bgr.size == 0 or not label:
            return False

        if self.method == "insightface":
            try:
                emb, _bbox = self._compute_embedding(frame_bgr)
                if emb is None:
                    log.warning("save_known_person: no face detected for %r", label)
                    return False
                self._store_embedding(label, emb)
                log.info("Stored InsightFace embedding for %r", label)
                return True
            except Exception as e:
                log.warning("save_known_person insightface failed: %s", e)
                return False

        phash = self._frame_phash(frame_bgr)
        if phash is None:
            return False
        self._store_phash(label, phash)
        log.info("Stored pHash for %r", label)
        return True

    # ── InsightFace backend ─────────────────────────────────────────────────

    def _insightface(self):
        """Lazy-load the InsightFace analyzer."""
        if self._face is None:
            import insightface
            from insightface.app import FaceAnalysis
            ctx_id = 0 if self.device == "cuda" else -1
            app = FaceAnalysis(name="buffalo_l")
            app.prepare(ctx_id=ctx_id, det_size=(640, 640))
            self._face = app
            log.info("InsightFace ready (device=%s)", self.device)
        return self._face

    @staticmethod
    def _flat_bbox(bbox) -> Optional[tuple]:
        """Normalize InsightFace bbox to (x1, y1, x2, y2) floats."""
        try:
            arr = np.asarray(bbox, dtype=float).reshape(-1)
            if arr.size == 4:
                return (float(arr[0]), float(arr[1]), float(arr[2]), float(arr[3]))
            if arr.size == 2 and arr.shape == (2,):
                # Some versions return top-left + bottom-right separately.
                tl = np.asarray(bbox[0], dtype=float).reshape(-1)
                br = np.asarray(bbox[1], dtype=float).reshape(-1)
                return (float(tl[0]), float(tl[1]), float(br[0]), float(br[1]))
            return None
        except Exception:
            return None

    @staticmethod
    def _flat_embedding(emb) -> Optional[np.ndarray]:
        """Normalize InsightFace embedding to a 1-D float32 array."""
        try:
            # Some InsightFace versions return embedding as a list whose
            # elements are themselves small arrays/lists; flatten recursively.
            out = []
            def _collect(x):
                if isinstance(x, (list, tuple, np.ndarray)):
                    for item in x:
                        _collect(item)
                else:
                    out.append(float(x))
            _collect(emb)
            return np.array(out, dtype=np.float32)
        except Exception:
            return None

    def _compute_embedding(self, frame_bgr: np.ndarray):
        """Return (embedding, bbox) for the best face, or (None, None)."""
        app = self._insightface()
        faces = app.get(frame_bgr)
        if not faces:
            return None, None

        # Normalize each face's bbox and det_score first.
        candidates = []
        for f in faces:
            score = float(getattr(f, "det_score", 0.0))
            bbox = self._flat_bbox(getattr(f, "bbox", None))
            if bbox is None or score < 0.5:
                continue
            x1, y1, x2, y2 = bbox
            if self.min_face_size > 0 and min(x2 - x1, y2 - y1) < self.min_face_size:
                continue
            emb = self._flat_embedding(getattr(f, "embedding", None))
            if emb is None or emb.size == 0:
                continue
            candidates.append({"emb": emb, "bbox": bbox, "score": score})

        if not candidates:
            return None, None

        best = max(candidates, key=lambda c: (c["bbox"][2] - c["bbox"][0]) * (c["bbox"][3] - c["bbox"][1]))
        return best["emb"], best["bbox"]

    def _is_known_insightface(self, frame_bgr: np.ndarray, return_box: bool = False):
        emb, bbox = self._compute_embedding(frame_bgr)
        if emb is None:
            if return_box:
                return False, None, None
            return False, None

        known = self._load_embeddings()
        if not known:
            if return_box:
                return False, None, bbox
            return False, None

        best_label: Optional[str] = None
        best_score = -1.0
        for label, embs in known.items():
            for ref in embs:
                sim = self._cosine_similarity(emb, ref)
                if sim > best_score:
                    best_score = sim
                    best_label = label

        if best_label is not None and best_score >= self.match_threshold:
            log.debug("InsightFace matched %r (score=%.3f)", best_label, best_score)
            if return_box:
                return True, best_label, bbox
            return True, best_label
        if return_box:
            return False, None, bbox
        return False, None

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        a = np.asarray(a, dtype=float)
        b = np.asarray(b, dtype=float)
        denom = (np.linalg.norm(a) * np.linalg.norm(b))
        if denom == 0:
            return 0.0
        return float(np.dot(a, b) / denom)

    # ── pHash legacy backend ─────────────────────────────────────────────────

    def _is_known_phash(self, frame_bgr: np.ndarray) -> Tuple[bool, Optional[str]]:
        h = self._frame_phash(frame_bgr)
        if h is None:
            return False, None
        known = self._load_phashes()
        if not known:
            return False, None
        best_label: Optional[str] = None
        best_dist = float("inf")
        for label, hashes in known.items():
            for ref in hashes:
                dist = self._phash_distance(h, ref)
                if dist < best_dist:
                    best_dist = dist
                    best_label = label
        # A pHash Hamming distance under ~10 is a reasonable match.
        if best_label is not None and best_dist <= 10:
            log.debug("pHash matched %r (dist=%d)", best_label, best_dist)
            return True, best_label
        return False, None

    def _frame_phash(self, frame_bgr: np.ndarray) -> Optional[str]:
        try:
            from PIL import Image
            import imagehash
        except Exception as e:
            if not getattr(self, "_phash_warned", False):
                log.warning("imagehash/PIL unavailable for pHash fallback: %s", e)
                self._phash_warned = True
            return None
        try:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            pil = Image.fromarray(rgb)
            return str(imagehash.phash(pil))
        except Exception as e:
            log.warning("pHash computation failed: %s", e)
            return None

    @staticmethod
    def _phash_distance(a: str, b: str) -> int:
        try:
            import imagehash
            return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)
        except Exception:
            pass
        try:
            ai = int(a, 16)
            bi = int(b, 16)
            return bin(ai ^ bi).count("1")
        except Exception:
            return 0

    # ── Database ─────────────────────────────────────────────────────────────

    def _db_init(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS known_persons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    label TEXT NOT NULL,
                    phash TEXT,
                    embedding BLOB,
                    frame_path TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_known_persons_label ON known_persons(label)"
            )
            # In-place migration: older tables may lack the embedding column.
            cols = {r[1] for r in conn.execute("PRAGMA table_info(known_persons)")}
            if "embedding" not in cols:
                conn.execute("ALTER TABLE known_persons ADD COLUMN embedding BLOB")
                log.info("Added embedding column to known_persons")
        self._backfill_embeddings()

    def _load_embeddings(self) -> Dict[str, List[np.ndarray]]:
        out: Dict[str, List[np.ndarray]] = {}
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                for label, blob in conn.execute(
                    "SELECT label, embedding FROM known_persons WHERE embedding IS NOT NULL"
                ):
                    try:
                        emb = np.frombuffer(blob, dtype=np.float32)
                        if emb.size == 0:
                            continue
                        out.setdefault(label, []).append(emb)
                    except Exception:
                        continue
        except Exception as e:
            log.warning("Failed to load embeddings: %s", e)
        return out

    def _load_phashes(self) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {}
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                for label, phash in conn.execute(
                    "SELECT label, phash FROM known_persons WHERE phash IS NOT NULL"
                ):
                    out.setdefault(label, []).append(phash)
        except Exception as e:
            log.warning("Failed to load pHashes: %s", e)
        return out

    def _store_embedding(self, label: str, emb: np.ndarray):
        blob = np.asarray(emb, dtype=np.float32).tobytes()
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                "INSERT INTO known_persons (label, embedding, frame_path, created_at) VALUES (?, ?, ?, ?)",
                (label, blob, "", time.strftime("%Y-%m-%dT%H:%M:%S")),
            )

    def _store_phash(self, label: str, phash: str, frame_path: Optional[str] = None):
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                "INSERT INTO known_persons (label, phash, frame_path, created_at) VALUES (?, ?, ?, ?)",
                (label, phash, frame_path, time.strftime("%Y-%m-%dT%H:%M:%S")),
            )

    def _backfill_embeddings(self):
        """Best-effort: encode stored pHash-only frames into embeddings.

        Used when the host saved a row with only a frame_path (e.g. Heimdall
        calling save_known_person) before the detector had a chance to compute
        the embedding.
        """
        if self.method != "insightface":
            return
        rows = []
        try:
            with sqlite3.connect(str(self.db_path)) as conn:
                rows = conn.execute(
                    "SELECT id, label, frame_path FROM known_persons "
                    "WHERE embedding IS NULL AND frame_path IS NOT NULL"
                ).fetchall()
        except Exception as e:
            log.warning("Backfill query failed: %s", e)
            return

        for row_id, label, frame_path in rows:
            try:
                if not frame_path or not os.path.exists(frame_path):
                    continue
                frame = cv2.imread(frame_path)
                if frame is None:
                    continue
                emb = self._compute_embedding(frame)
                if emb is None:
                    continue
                blob = np.asarray(emb, dtype=np.float32).tobytes()
                with sqlite3.connect(str(self.db_path)) as conn:
                    conn.execute(
                        "UPDATE known_persons SET embedding = ? WHERE id = ?",
                        (blob, row_id),
                    )
                log.info("Backfilled embedding for %r from %s", label, frame_path)
            except Exception as e:
                log.debug("Backfill failed for frame %s: %s", frame_path, e)


# Module-level singleton so callers can import once and reuse.
_known_singleton: Optional[KnownPersons] = None


def _get_singleton(cfg: Optional[dict] = None) -> KnownPersons:
    global _known_singleton
    if _known_singleton is None:
        _known_singleton = KnownPersons(cfg)
    return _known_singleton


def is_known(frame_bgr: np.ndarray, cfg: Optional[dict] = None, return_box: bool = False):
    return _get_singleton(cfg).is_known(frame_bgr, return_box=return_box)


def save_known_person(frame_bgr: np.ndarray, label: str, cfg: Optional[dict] = None) -> bool:
    return _get_singleton(cfg).save_known_person(frame_bgr, label)
