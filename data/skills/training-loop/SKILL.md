---
name: training-loop
description: "Operate Warden's self-training loop: audit the logs for seat failures, fold the failures and Artemis's flagged training errors into the SFT dataset, run a 1-epoch fine-tune, stop a step, and report status, catalogs, and flags. Use when the user asks about training, fine-tuning, the training dashboard, audit catalogs, flagged errors, or improving the local model from its mistakes."
tools: ["Bash", "Read"]
---

# training-loop — how Warden runs its own fine-tuning

Three steps, run in order, each a separate background job started through the Warden API on `http://127.0.0.1:3200`. The dashboard's Training view drives the same endpoints.

| Step | Endpoint | What it does |
|---|---|---|
| 1. Audit | `POST /api/training/audit` body `{"days":1|3|7}` | Reads that window of warden.service logs, slices out failures, classifies each with the ops model, writes `training/loop/catalogs/<ts>-<N>d.json`. |
| 2. Modify | `POST /api/training/modify` | Turns the newest catalog plus every pending Artemis flag into corrected SFT rows merged into `training/orchatlas-sft.jsonl`; marks each flag consumed (`merged` / `rejected` / `no_rows`). |
| 3. Train | `POST /api/training/train` | One-epoch LoRA run of the orchatlas pipeline (`training/atlasorch.sh`, `EPOCHS=1`). The result is the `orchatlas-ft` model. |

Read endpoints:

| Endpoint | Returns |
|---|---|
| `GET /api/training/status` | `{running, step, tail}` — the running step (or null) and the last 40 log lines of the current/most recent step. |
| `GET /api/training/catalogs` | `{catalogs:[{file, ts, entries}], newest}` — `newest.failures[]` each carry `classification.{failure_class, what_went_wrong, correct_behavior, sft_correction_hint}`. |
| `GET /api/training/flags` | `{flags[], counts:{pending, consumed, total}}` — errors Artemis confirmed as trainable. |
| `POST /api/training/stop` | Stops whichever step is running (whole process tree). |

## Operating rules

- One step at a time. A start call returns `{ok:false, error}` when another step or an agent turn is running (steps clear VRAM) — report that text and wait for the user.
- Steps are long (audit minutes, train an hour or more). Start the step, give the user the step name, then check `GET /api/training/status` when asked; the step logs live at `training/loop/logs/<step>.log`.
- Start audit, modify, or train only when the user asks for it. Status, catalogs, and flags are free to read at any time.
- After train finishes, switching a seat to `orchatlas-ft` is the user's call in the dashboard — tell them the step finished and what the log's last lines say.

## Where things live

- `training/loop/` — `audit-failures.mjs`, `modify-parts.mjs`, `train-1epoch.sh`, `catalogs/`, `logs/`, `flags/artemis-flags.jsonl`.
- `training/orchatlas-sft.jsonl` — the merged-seat SFT dataset the train step consumes.
- `training/README.md` — the dataset's history and conventions; read it before hand-editing any dataset.

## Flagging errors (Artemis)

Artemis records a confirmed, model-learnable failure with `flag_training_error`; see the `log-mining` skill for how failures are sorted into trainable errors versus code defects. Flags sit as `pending` until the next modify step consumes them.
