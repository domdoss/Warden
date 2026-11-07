"""
Orchatlas LoRA SFT — fine-tune granite-4.2-8b on the MERGED orchestrator+atlas
seat dataset (orchatlas-sft.jsonl).

Split out of train_iris_lora.py on 2026-09-18b. The two are separate jobs that
happen to share a rendering contract: iris is a 3b toolcall agent on ~5K-token
rows, this is the 8b seat that talks to the user and drives the machine, on
~11K-token rows carrying the whole 57-tool schema. They have different bases,
datasets, sequence lengths, batch shapes and Ollama names, and neither run may
overwrite the other's adapter. The dataset, collator and Ollama-faithful
rendering below are COPIED VERBATIM and must stay byte-identical to the iris
trainer's — they are the load-bearing part (see that file's header for why the
render matches Ollama's Go marshal instead of HF jinja).

ATTENTION: this trainer forces SDPA. Granite loaded with the eager attention
path, which materializes the full seq×seq score matrix — at 12032 tokens that
is a single 6.65 GiB allocation and an instant OOM on a 16 GB card (first
observed 2026-09-18 22:51, both ranks dead at step 0 in
eager_attention_forward). SDPA's memory-efficient kernel never builds that
matrix and IS supported on Turing; it is FlashAttention-2 that needs Ampere.
The active implementation is printed at startup — if it ever says eager again,
that is the bug, not the sequence length.

Not run automatically by Warden. To train:
    ./atlasorch.sh                       # the whole pipeline (merge → measure → train → pack)
    python atlasorch.py                  # single GPU (cuda:0, 4-bit QLoRA)
    torchrun --nproc_per_node=2 atlasorch.py     # both RTX 5000s, one rank per card

Useful knobs for a smoke test:
    python atlasorch.py --measure-only   # render the data, print seq lengths, exit
    python atlasorch.py --max-steps 2    # prove a step fits in VRAM before committing hours

Outputs an adapter (training/orchatlas-lora) and a merged fp16 model
(training/orchatlas-lora-merged) ready for GGUF conversion — pack it with
`./pack_iris.sh orchatlas-lora-merged orchatlas-ft granite4.2:8b`, or let
atlasorch.sh do it. The merge + disk writes run on the main process only;
other ranks wait at the barrier, so no races and no duplicate artifacts.
"""
import argparse
import contextlib
import json
import os
import sys

# Reduce fragmentation on the 16 GB cards before CUDA initializes.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# GPU placement, set BEFORE torch initializes CUDA:
#  - under torchrun DDP, do NOTHING — unsloth's DDP support selects each
#    rank's GPU from LOCAL_RANK itself, and pinning CUDA_VISIBLE_DEVICES per
#    rank collapses the visible set to one card, making unsloth's
#    cuda:{LOCAL_RANK} placement go out of range (IndexError in
#    _get_stream on rank 1, 2026-09-17 torchrun run);
#  - a plain single-process run stays on cuda:0 only, like the old build
#    (unsloth's default auto device-map would otherwise shard ONE model
#    across BOTH cards, stealing the desktop-holding GPU).
if "LOCAL_RANK" not in os.environ and "CUDA_VISIBLE_DEVICES" not in os.environ:
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"

import torch

# Pin the rank's GPU before anything else touches CUDA. Without this, rank 1
# can leave a stray ~170 MiB context on GPU 0 (init order probes device 0
# first), which is real headroom at 17.9k ctx on a 16 GB card — the
# 2026-10-10 run OOMed by less than that. Single-process runs are already
# pinned to cuda:0 by the CUDA_VISIBLE_DEVICES guard above.
if "LOCAL_RANK" in os.environ:
    torch.cuda.set_device(int(os.environ["LOCAL_RANK"]))
# Unsloth must be imported before transformers (it patches their modules at
# import time). It is kept AFTER the set_device above on purpose: unsloth's
# _gpu_init probes a GPU on import, and that must happen on the already-pinned
# rank, not on GPU 0 (the stray-context hazard the set_device block prevents).
from unsloth import FastLanguageModel
from torch.utils.data import Dataset
from transformers import Trainer, TrainingArguments
from accelerate import PartialState


def load_examples(path: str):
    examples = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            examples.append(json.loads(line))
    return examples


def _row_group(row) -> str:
    """Stratification key: the first tool the row calls, or '__prose__'."""
    for m in row.get("messages", []):
        for tc in (m.get("tool_calls") or []):
            name = (tc.get("function") or {}).get("name")
            if name:
                return name
    return "__prose__"


def _stable_hash(text: str) -> int:
    """FNV-1a, the same hash the rebalance script uses — deterministic split."""
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def stratified_holdout(examples, frac: float = 0.10, seed: int = 20261106):
    """Split ~frac of every group into a held-out eval set.

    Groups are the row's primary tool (prose is its own group), so the eval
    loss measures every capability instead of whichever rows happened to sort
    last. A group of one stays in train: the trainer needs at least one
    example of a capability to learn it. Selection is a stable hash of the
    row, so the same corpus always yields the same split.
    """
    if frac <= 0:
        return examples, []
    groups = {}
    for i, row in enumerate(examples):
        groups.setdefault(_row_group(row), []).append(i)
    train_idx, eval_idx = [], []
    for key in sorted(groups):
        idxs = sorted(groups[key], key=lambda i: _stable_hash(
            f"{seed}|{json.dumps(examples[i], ensure_ascii=False, sort_keys=True)}"))
        n = len(idxs)
        if n < 2:
            train_idx.extend(idxs)
            continue
        k = min(n - 1, max(1, round(n * frac)))
        eval_idx.extend(idxs[:k])
        train_idx.extend(idxs[k:])
    train_idx.sort()
    eval_idx.sort()
    return [examples[i] for i in train_idx], [examples[i] for i in eval_idx]


# ---------------------------------------------------------------------------
# Ollama-faithful rendering.
#
# Ollama renders granite4.2 through its own Jinja2 engine (minja), and its
# `tojson` filter matches Python json.dumps with the DEFAULT separators —
# spaced (", " between items, ": " after keys), insertion order, non-ASCII
# kept raw, and NO htmlsafe escaping. The `tool_to_json` macro wraps that in
# '"key": <tojson(value)>' joined by ", ". We reproduce those bytes here
# instead of going through apply_chat_template, because we need per-segment
# labels (assistant turns labelled, everything else -100) that apply_chat_template
# cannot produce. Every rule below is verified byte-exact against the HF
# apply_chat_template render of the same rows, which in turn matches the live
# /api/chat prompt_eval_count oracle within the tokenizer's 1-token split
# difference (HF tokenizer vs llama.cpp) — not a render difference.
# ---------------------------------------------------------------------------

# granite 4.2 special tokens + tool-call tags, built via concatenation so this
# file never contains the literal tags (display mangling hazard).
# NOTE: granite4.2 (the served template) uses ChatML-style <|im_start|>/<|im_end|>,
# NOT the granite-3.x <|start_of_role|>/<|end_of_role|>/<|end_of_text|> tokens this
# file used to emit. The old tokens were a train/serve mismatch: the fine-tune was
# taught SOR/EOR while Ollama fed it im_start/im_end, and it rambled instead of
# calling tools (the "create a file → 4096-token ramble → 500" failure).
IM_START = '<|im_' + 'start|>'
IM_END = '<|im_' + 'end|>'
TC_OPEN = '<' + 'tool' + '_call' + '>'
TC_CLOSE = '<' + '/tool' + '_call' + '>'
TR_OPEN = '<' + 'tool' + '_response' + '>'
TR_CLOSE = '<' + '/tool' + '_response' + '>'

# The granite4.2 tools block, byte-for-byte from the served template (ollama
# /api/show on granite4.2:8b). Tool schemas are JSON objects inside <tools>,
# and the answer format is <function=...>/<parameter=...> — NOT the flat
# <tool_call>{"name":...} JSON this file used to emit.
TOOLS_PREFIX = '# Tools\n\nYou have access to the following functions:\n\n<tools>'
TOOLS_SUFFIX = (
    '\n</tools>\n\n'
    'If you choose to call a function ONLY reply in the following format with NO suffix:\n\n'
    '<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\n'
    'value_1\n</parameter>\n<parameter=example_parameter_2>\n'
    'This is the value for the second parameter\nthat can span\nmultiple lines\n'
    '</parameter>\n</function>\n</tool_call>\n\n'
    '<IMPORTANT>\nReminder:\n'
    '- Function calls MUST follow the specified format: an inner <function=...></function> '
    'block must be nested within <tool_call></tool_call> XML tags\n'
    '- Required parameters MUST be specified\n'
    '- You may provide optional reasoning for your function call in natural language '
    'BEFORE the function call, but NOT after\n'
    '- If there is no function call available, answer the question like normal with your '
    'current knowledge and do not tell the user about function calls\n'
    '</IMPORTANT>')


def _tojson(v):
    # Python Jinja2 `tojson` as transformers applies it: json.dumps with the
    # default spaced separators (', ', ': '), insertion order, non-ASCII raw,
    # and NO htmlsafe escaping. Verified against the live served template:
    # a '<' in a schema description renders raw (not backslash-u003c), and '→'
    # stays raw.
    # Minja (ollama's Jinja2) also keeps UTF-8 raw, so ensure_ascii=False matches
    # serve-time for both the tools block (explicit `tojson(ensure_ascii=False)`)
    # and the bare-`tojson` argument path.
    return json.dumps(v, ensure_ascii=False)


def _go_tool(t):
    # granite4.2 `tool_to_json` macro: strip the OpenAI {"type":"function",...}
    # envelope, emit the bare function object's keys in order with '": "' and
    # '", "' separators, each value through tojson(ensure_ascii=False).
    f = t.get('function', t)
    parts = []
    for k, v in f.items():
        if k in ('defer_loading', 'strict'):
            continue
        parts.append('"' + k + '": ' + _tojson(v))
    return '{' + ', '.join(parts) + '}'


def _go_arg(v):
    # Template line 128: a mapping or non-string sequence renders via tojson;
    # every other value renders via the `string` filter (str()). Strings are
    # RAW (the <parameter> value is literal text), bools use Python's str()
    # spelling ("True"/"False") — both verified against the live template.
    if isinstance(v, dict) or isinstance(v, list):
        return _tojson(v)
    return str(v)


class OrchatlasSFTDataset(Dataset):
    """Renders each example BYTE-EXACTLY as Ollama's granite4.2 template does
    at inference (see the block comment above for why). Per-message segments
    are assembled as text, encoded atomically with add_special_tokens=False,
    and only assistant segments carry labels; everything else is -100.

    Framing (granite4.2, validated against the live template):
      system (index 0): IM_START+system+"\\n" + content + "\\n\\n" + tools block
                        + IM_END + "\\n"
      user / mid-turn system: IM_START+role+"\\n" + content + IM_END + "\\n"
      tool run: consecutive tool messages fold into ONE user turn —
                IM_START+user+"\\n" + per message TR_OPEN+"\\n"+content+"\\n"+
                TR_CLOSE+"\\n", then IM_END+"\\n"
      assistant: IM_START+assistant+"\\n" + ("<think></think>" prepended to
                 content), then per tool call TC_OPEN+"\\n<function=NAME>\\n" +
                 per arg "<parameter=K>\\n"+value+"\\n</parameter>\\n" +
                 "</function>\\n"+TC_CLOSE+"\\n", then IM_END+"\\n\""""

    def __init__(self, examples, tokenizer, max_len=None):
        self.examples = examples
        self.tokenizer = tokenizer
        self.max_len = max_len
        self.cache = []
        for ex in examples:
            self.cache.append(self._render(ex, tokenizer))
        if max_len:
            n = 0
            for d in self.cache:
                if d["length"] > max_len:
                    d["input_ids"] = d["input_ids"][-max_len:]
                    d["labels"] = d["labels"][-max_len:]
                    d["length"] = max_len
                    n += 1
            if n:
                print(f"[orchatlas] left-truncated {n}/{len(self.cache)} "
                      f"examples to max_len={max_len}", flush=True)

    @staticmethod
    def _render(ex, tokenizer):
        messages = list(ex["messages"])
        tools = ex.get("tools") or []

        tools_block = ""
        if tools:
            tools_block = TOOLS_PREFIX
            for t in tools:
                tools_block += "\n" + _go_tool(t)
            tools_block += TOOLS_SUFFIX

        # messages[0] with role system supplies the system prompt; the tools
        # block is appended to it (or stands alone) exactly like the template.
        sys_content = ""
        if messages and messages[0].get("role") == "system":
            sys_content = messages[0].get("content") or ""
            messages = messages[1:]

        segments = []
        if sys_content or tools_block:
            if sys_content and tools_block:
                sysmsg = sys_content + "\n\n" + tools_block
            else:
                sysmsg = sys_content or tools_block
            segments.append((IM_START + "system\n" + sysmsg + IM_END + "\n", False))

        i, n = 0, len(messages)
        while i < n:
            m = messages[i]
            role = m.get("role")
            content = m.get("content") or ""
            if role == "tool":
                # fold the whole consecutive run into ONE user turn (the template
                # opens <|im_start|>user only before the first response and closes
                # after the last — no leading "\n" before the first <tool_response>).
                body = ""
                while i < n and messages[i].get("role") == "tool":
                    body += (TR_OPEN + "\n" +
                             (messages[i].get("content") or "") + "\n" + TR_CLOSE + "\n")
                    i += 1
                segments.append((IM_START + "user\n" + body + IM_END + "\n", False))
            elif role == "assistant":
                # The template prepends an empty <think></think> placeholder to
                # assistant content that doesn't already carry think tags.
                c = content
                if '<think>' not in c and '</think>' not in c:
                    c = '<think></think>' + c
                text = IM_START + "assistant\n"
                tcs = m.get("tool_calls") or []
                if tcs:
                    text += c.strip() + "\n"
                    for tc in tcs:
                        fn = tc.get("function", tc)
                        text += TC_OPEN + "\n<function=" + fn["name"] + ">\n"
                        for aname, aval in (fn.get("arguments") or {}).items():
                            text += ("<parameter=" + aname + ">\n" + _go_arg(aval) +
                                     "\n</parameter>\n")
                        text += "</function>\n" + TC_CLOSE + "\n"
                    text += IM_END + "\n"
                else:
                    text += c.strip() + IM_END + "\n"
                segments.append((text, True))
                i += 1
            else:
                segments.append((IM_START + role + "\n" + content + IM_END + "\n", False))
                i += 1

        # special tokens are atomic, so segment boundaries (always at one)
        # are safe encode points
        input_ids, labels = [], []
        for text, labelled in segments:
            ids = tokenizer.encode(text, add_special_tokens=False)
            input_ids.extend(ids)
            labels.extend(ids if labelled else [-100] * len(ids))
        return {"input_ids": input_ids, "labels": labels, "length": len(input_ids)}

    def __len__(self):
        return len(self.cache)

    def __getitem__(self, i):
        return self.cache[i]


class PadCollator:
    def __init__(self, pad_id):
        self.pad_id = pad_id

    def __call__(self, batch):
        maxlen = max(len(b["input_ids"]) for b in batch)
        input_ids, labels, attn = [], [], []
        for b in batch:
            ids = b["input_ids"]
            lab = b["labels"]
            pad = maxlen - len(ids)
            input_ids.append(ids + [self.pad_id] * pad)
            labels.append(lab + [-100] * pad)
            attn.append([1] * len(ids) + [0] * pad)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
            "attention_mask": torch.tensor(attn, dtype=torch.long),
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="ibm-granite/granite-4.2-8b",
                    help="HF model id or local path (the pack step's Modelfile donor must match it: granite4.2:8b)")
    ap.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "orchatlas-sft-balanced.jsonl"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "orchatlas-lora"))
    ap.add_argument("--merged-out", default=os.path.join(os.path.dirname(__file__), "orchatlas-lora-merged"))
    # 2 epochs, not 4: 281 examples converge by epoch 2 (loss flattens ~0.12)
    # and epochs 3-4 just memorize verbatim phrasings — measured regression
    # risk, no gain (2026-09-02 dryfire comparison).
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--lr", type=float, default=1e-4)
    # per-device batch 1, accum 2 — effective batch 4 under 2-rank DDP, the same
    # training math as the iris run at a quarter of its per-step activation
    # footprint. batch 2 does NOT fit here: 11K-token rows on an 8b base leave
    # no room, and the logits upcast alone (batch×seq×vocab×4B) is ~2.5 GiB per
    # sample at this vocabulary.
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=2)
    # 4-bit QLoRA is the DEFAULT now (the whole point of the unsloth switch):
    # ~half the VRAM of the fp16 base. --no-4bit loads the fp16 base for the
    # old heavyweight path.
    ap.add_argument("--no-4bit", action="store_true",
                    help="load the base in fp16 instead of 4-bit QLoRA")
    ap.add_argument("--max-len", type=int, default=12032,
                    help="cap rendered seq length; longer examples are left-truncated "
                         "(keep last N) so the assistant labels at the tail are preserved. "
                         "Rows carry only the tool schemas they exercise (prose rows carry "
                         "none), so the balanced corpus measures min/mean/max ~1500/1850/4100 "
                         "and the 12032 default clips nothing. A LOWER cap does not save you: "
                         "it amputates the system prompt and the tool schemas from every row — "
                         "the two things this fine-tune exists to learn — and reports a clean "
                         "run while doing it. atlasorch.sh measures the data and derives this. "
                         "Pass 0 to disable the cap entirely.")
    ap.add_argument("--measure-only", action="store_true",
                    help="render the dataset, print the seq-length stats, and exit without "
                         "loading the model — what atlasorch.sh uses to derive --max-len.")
    # Held-out eval: ~10% of each capability group is never trained on, and the
    # checkpoint with the best eval loss is the one that gets packed. Without
    # this the run keeps whatever the last optimizer step produced, which is how
    # verbatim replay of a handful of phrasings went unnoticed (2026-10-18).
    ap.add_argument("--holdout", type=float, default=0.10,
                    help="fraction held out per capability group for eval (0 disables; "
                         "a group of one row always stays in train)")
    ap.add_argument("--holdout-seed", type=int, default=20261106,
                    help="seed for the deterministic holdout split")
    ap.add_argument("--eval-steps", type=int, default=25,
                    help="eval + checkpoint interval when a holdout is active")
    ap.add_argument("--max-steps", type=int, default=0,
                    help="stop after N optimizer steps (smoke test). 0 = train the full run.")
    ap.add_argument("--resume", action="store_true",
                    help="resume from the newest checkpoint in --out. Without this the run "
                         "starts from the base model, even when checkpoints exist.")
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    # dropout 0, not 0.05: unsloth's fast Granite patch only engages its fused
    # kernels when LoRA dropout is 0 (with dropout > 0 it patches every layer
    # the slow way and prints a performance-hit warning — measured at the
    # 2026-09-17 smoke test). 281→1K short examples don't overfit enough to
    # need it.
    ap.add_argument("--lora-dropout", type=float, default=0.0)
    args = ap.parse_args()

    print(f"[orchatlas] model={args.model} data={args.data} "
          f"{'fp16' if args.no_4bit else '4bit-QLoRA'}", flush=True)

    # --measure-only renders the data through the tokenizer and stops. It must
    # use THIS trainer's dataset class, not a sibling script's: the number
    # atlasorch.sh turns into --max-len is only trustworthy if it came from the
    # exact renderer that will build the training batches.
    if args.measure_only:
        from transformers import AutoTokenizer
        tok = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token
        ex = load_examples(args.data)
        ds = OrchatlasSFTDataset(ex, tok, max_len=None)
        ls = [d["length"] for d in ds.cache]
        tr, ev = stratified_holdout(ex, args.holdout, args.holdout_seed)
        print(f"[orchatlas] examples={len(ex)} min={min(ls)} mean={sum(ls)//len(ls)} max={max(ls)} "
              f"train={len(tr)} holdout={len(ev)}", flush=True)
        return

    state = PartialState()
    if state.num_processes > 1:
        print(f"[orchatlas] DDP across {state.num_processes} GPUs "
              f"(rank {state.process_index})", flush=True)

    # fp16 — RTX 5000 (Turing) has no native bf16, so use fp16 not bf16.
    # CUDA_VISIBLE_DEVICES (set at the top of this file) pins this process to
    # one GPU; under torchrun each rank trains its own copy.
    # NO trust_remote_code here, and that is load-bearing. granite-4.2-8b ships
    # no remote modeling code at all (config.json has no auto_map; the
    # architecture is the native GraniteForCausalLM, model_type "granite"), so
    # the flag bought nothing — and it cost everything: unsloth_compile_transformers
    # opens with `if trust_remote_code and not unsloth_force_compile: return`,
    # bailing out of ALL of its compile patches, fuse_lm_head among them. Without
    # that patch the model returns real [1, seq, 100352] logits, accelerate's
    # mixed-precision wrapper calls .float() on them on the way out, and that
    # single fp32 copy is 3.95 GiB at an 11K row — OOM at step 0 on a 16 GB card
    # (2026-09-19 08:15, both ranks dead in _convert_to_fp32). The bail-out is
    # silent: the loader runs that call inside `with redirector:`, so unsloth's
    # "we can't trace models" line never reaches the log.
    # attn_implementation="sdpa" is not optional at this sequence length. Left
    # to itself Granite loaded the EAGER path, whose first act is
    # matmul(query, key.transpose(2,3)) — a seq×seq score tensor, 6.65 GiB at
    # 12032 tokens, dead at step 0 on a 16 GB card. SDPA's memory-efficient
    # kernel never materializes it. It is passed through **kwargs (unsloth has
    # no named parameter for it) AND re-asserted on the config after load,
    # because a silently-ignored kwarg would put us straight back in eager.
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_len or 12032,
        dtype=torch.float16,
        load_in_4bit=not args.no_4bit,
        full_finetuning=False,
        attn_implementation="sdpa",
        # Tiled MLP: the MLP backward holds 4-5 (seq x 12800) fp16
        # intermediates at once, ~410 MiB each at 16.5k tokens; that alone
        # OOMed step 0 on the 16 GB cards (2026-10-14). Tiling runs the MLP in
        # sequence chunks so only one chunk's intermediates are live.
        unsloth_tiled_mlp=True,
    )
    try:
        model.config._attn_implementation = "sdpa"
        if getattr(model.config, "text_config", None) is not None:
            model.config.text_config._attn_implementation = "sdpa"
    except Exception as err:
        print(f"[orchatlas] WARNING: could not force sdpa on the config ({err})", flush=True)
    # Printed, not assumed: "eager" here means the next step will OOM, and that
    # is worth knowing now rather than 30 seconds in.
    print(f"[orchatlas] attention implementation = "
          f"{getattr(model.config, '_attn_implementation', 'unknown')}", flush=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # LoRA on every linear layer — this is tool-call transcription (style), not
    # new knowledge, so a small rank is plenty. use_gradient_checkpointing=
    # "unsloth" is unsloth's own checkpointing (it handles input-grad enabling
    # for the frozen base internally — no manual prepare/enable dance needed).
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth",
        random_state=3407,
    )
    model.print_trainable_parameters()

    examples = load_examples(args.data)
    train_examples, eval_examples = stratified_holdout(examples, args.holdout, args.holdout_seed)
    if not train_examples:
        raise SystemExit("[orchatlas] holdout consumed every example — lower --holdout")
    print(f"[orchatlas] {len(train_examples)} train / {len(eval_examples)} holdout", flush=True)
    dataset = OrchatlasSFTDataset(train_examples, tokenizer, max_len=args.max_len)
    eval_dataset = (OrchatlasSFTDataset(eval_examples, tokenizer, max_len=args.max_len)
                    if eval_examples else None)
    lens = [d["length"] for d in dataset.cache]
    print(f"[orchatlas] seq len min/mean/max = {min(lens)}/{sum(lens)//len(lens)}/{max(lens)}"
          + (f" (capped at {args.max_len})" if args.max_len else ""), flush=True)
    if eval_dataset is not None:
        ev_lens = [d["length"] for d in eval_dataset.cache]
        print(f"[orchatlas] holdout seq len min/mean/max = "
              f"{min(ev_lens)}/{sum(ev_lens)//len(ev_lens)}/{max(ev_lens)}", flush=True)

    # Gradient sync is done here, not by DDP's hooks. The tiled MLP runs one
    # nested backward per sequence chunk, and the chunk count follows each
    # row's length: DDP's hooks reject a grad landing more than once ("mark a
    # variable ready only once"), and static_graph rejects the per-row graph
    # change. So every micro-step runs under no_sync (the hooks stand down)
    # and the LoRA grads are all-reduced once, after the micro-step that ends
    # the optimizer step. That is before Trainer unscales/clips, so both ranks
    # see the same grads and agree on any fp16 inf-skip.
    class OrchatlasTrainer(Trainer):
        def training_step(self, model, inputs, num_items_in_batch=None):
            ddp = model if isinstance(model, torch.nn.parallel.DistributedDataParallel) else None
            with (ddp.no_sync() if ddp is not None else contextlib.nullcontext()):
                loss = super().training_step(model, inputs, num_items_in_batch)
            if ddp is not None and self.accelerator.sync_gradients:
                world = torch.distributed.get_world_size()
                for p in ddp.module.parameters():
                    if p.requires_grad and p.grad is not None:
                        torch.distributed.all_reduce(p.grad)
                        p.grad.div_(world)
            return loss

    # Eval wiring is passed only when a holdout exists. `eval_strategy` is the
    # 4.46+ name; older transformers only accept `evaluation_strategy`, so the
    # kwarg is chosen from the installed signature instead of guessing.
    eval_kwargs = {}
    if eval_dataset is not None:
        import inspect
        eval_key = ("eval_strategy" if "eval_strategy" in inspect.signature(
            TrainingArguments.__init__).parameters else "evaluation_strategy")
        eval_kwargs = {
            eval_key: "steps",
            "eval_steps": args.eval_steps,
            "per_device_eval_batch_size": 1,
            # Checkpoint selection follows eval loss, not step count: the best
            # generalization point is what gets packed.
            "load_best_model_at_end": True,
            "metric_for_best_model": "eval_loss",
            "greater_is_better": False,
        }

    targs = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        fp16=True,
        logging_steps=2,
        # Keep the work. An interrupted epoch used to be total loss: the
        # adapter was only written at the end, so stopping a healthy run cost
        # the whole run (2026-10-18, 123/200 steps thrown away). Two
        # checkpoints is ~600 MB; --resume picks the newest.
        save_strategy="steps",
        save_steps=args.eval_steps,
        save_total_limit=2,
        report_to=[],
        remove_unused_columns=False,
        dataloader_drop_last=False,
        # 8-bit Adam: fp32 m/v for 49.5M LoRA params is ~380 MiB per card,
        # which 18k-token rows on 16 GB cards cannot spare (2026-10-14 OOM).
        optim="adamw_8bit",
        ddp_find_unused_parameters=False,
        **eval_kwargs,
        **({"max_steps": args.max_steps} if args.max_steps else {}),
    )
    trainer = OrchatlasTrainer(
        model=model,
        args=targs,
        train_dataset=dataset,
        eval_dataset=eval_dataset,
        data_collator=PadCollator(tokenizer.pad_token_id),
    )
    trainer.train(resume_from_checkpoint=True if args.resume else None)

    # Save the adapter (small) AND a merged fp16 model (for GGUF conversion).
    # Writes are main-process-only; other ranks wait at the barrier — no
    # races, no dupes. save_pretrained_merged("merged_16bit") dequantizes the
    # 4-bit base + LoRA into a plain fp16 HF model, exactly what
    # convert_hf_to_gguf.py expects.
    if state.is_main_process:
        model.save_pretrained(args.out)
        tokenizer.save_pretrained(args.out)
        print(f"[orchatlas] adapter saved → {args.out}", flush=True)

        model.save_pretrained_merged(
            args.merged_out, tokenizer, save_method="merged_16bit",
        )
        print(f"[orchatlas] merged model saved → {args.merged_out}", flush=True)
        print("[orchatlas] next: ./pack_iris.sh orchatlas-lora-merged orchatlas-ft granite4.2:8b",
              flush=True)
    state.wait_for_everyone()


if __name__ == "__main__":
    main()