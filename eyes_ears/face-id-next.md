# Face-ID (next, after awareness)

## Why
The current known-person recognition (`security/core/known.py`) is whole-frame **pHash + Hamming distance**. It's cheap and app-side (no Heimdall round-trip), but it breaks across lighting, pose, and position — exactly the conditions where "hello Dominic" should still fire when you come home. Face embeddings (InsightFace) fix that.

## Goal
Replace pHash with InsightFace face embeddings **behind the same interface** so `main.py`, the security skip, and the awareness arrival-greet logic don't change:

```python
is_known(frame_bgr) -> (bool: is_known, str|None: label)
```

## Design

### Swap point: `security/core/known.py`
- Lazy singleton InsightFace `FaceAnalysis(name='buffalo_l')`, `app.prepare(ctx_id, det_size=(640,640))`. Device from config (`recognition.device`), default **CPU** (recognition runs only on arrival events, not per-frame, so CPU latency is fine and it avoids VRAM contention with RF-DETR / gemma3:4b on the 4 GB 3050 Ti).
- `_compute_embedding(frame_bgr)` → list of `(bbox, det_score, 512-d embedding)`.
- `is_known(frame_bgr)`: detect faces; for each, cosine-similarity vs cached known embeddings; best match ≥ `recognition.match_threshold` (default **0.42**) → `(True, label)`. No face / no match → `(False, None)`.

### Storage — `store/security.db` `known_persons`
- Add `embedding` BLOB column (migration `ALTER TABLE known_persons ADD COLUMN embedding BLOB`).
- Host `save_known_person` callback (`src/security-log.ts`) still inserts `{label, frame_path}` with the embedding NULL; the **detector** computes the embedding and UPDATEs the row — same pattern as today's pHash UPDATE.
- One-time back-fill migration in `known.py`: for rows with NULL embedding and an existing `frame_path`, re-encode the keyframe into an embedding (best-effort; skip missing files / no-face frames).
- Keep `phash` column (legacy fallback if `recognition.method: phash`).

### Config — `security/config/settings.example.yaml`
```yaml
recognition:
  method: insightface     # insightface (default) | phash (legacy)
  device: cpu              # cpu (default, avoids VRAM contention) | cuda
  match_threshold: 0.42   # cosine similarity to count as a match
  min_face_size: 60       # ignore faces smaller than this (too far to ID)
```

### Dependencies — `security/requirements.txt`
- `insightface>=0.7.3`
- `onnxruntime>=1.16` (CPU). For GPU, swap to `onnxruntime-gpu` (but CPU is the recommended default here — recognition is event-driven, not per-frame).

### Heimdall interaction — unchanged
Heimdall's `save_known_person` tool (called on a NORMAL verdict) still writes `{label, frame_path}`; the detector computes the embedding. Heimdall supplies the **label** (its judgment: "this is the owner, label 'dominic'"); the detector supplies the **embedding** (the biometric). The first clear-face keyframe Heimdall saves for a label becomes the reference; subsequent saves for the same label average into the reference.

## Verification
1. Save yourself as known (trigger a flag, Heimdall declares NORMAL + `save_known_person` with label "dominic"). Confirm `known_persons` row has a non-null `embedding`.
2. Leave the room > `empty_threshold_seconds`, return in **different lighting / pose** (the pHash failure case). `is_known` returns `(True, "dominic")`; Sentry greets by name.
3. A different person arrives → `(False, None)`; Sentry notes "someone's here" (or stays silent per its prompt).
4. Person too far for a detectable face → no face → `(False, None)`; no crash, falls back to unknown behavior.
5. Disable: set `recognition.method: phash` → old behavior restored, embeddings ignored.

## Risks / notes
- Small faces at distance → detection misses → recognition fails (graceful fallback to unknown, not a crash). `min_face_size` tunes this.
- First run downloads buffalo_l (~330 MB) — needs internet once.
- Privacy: embeddings stored locally in `store/security.db`, nothing leaves the machine.
- VRAM: only an issue if `recognition.device: cuda` AND gemma3:4b awareness model AND RF-DETR all on the 4 GB GPU simultaneously. Default CPU for recognition avoids this.

## Files
- `security/core/known.py` — main rewrite (interface unchanged)
- `security/requirements.txt` — insightface + onnxruntime
- `security/config/settings.example.yaml` — `recognition:` section
- `src/security-log.ts` — `known_persons` DDL: add `embedding` column
- `security/core/awareness`-related call sites — none (they already call `is_known(frame)`)