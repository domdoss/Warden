"""
Orchatlas LoRA SFT — fine-tune granite-4.2-8b on the MERGED orchestrator+atlas
seat dataset (orchatlas-sft.jsonl).

Split out of train_iris_lora.py on 2026-09-18b. The two are separate jobs that
happen to share a rendering contract: iris is a 3b toolcall agent on ~5K-token
rows, this is the 8b seat that talks to the captain and drives the machine, on
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
from torch.utils.data import Dataset
from transformers import Trainer, TrainingArguments
from unsloth import FastLanguageModel
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


# ---------------------------------------------------------------------------
# Ollama-faithful rendering.
#
# The old _render went through tokenizer.apply_chat_template (HF jinja), but
# inference serves a DIFFERENT byte sequence: Ollama marshals the tools block
# and tool-call arguments with Go encoding/json — compact separators,
# alphabetized map keys, struct field order, HTML escapes — and the HF render
# uses json.dumps spacing with insertion-order keys. The fine-tune learned the
# HF bytes, then the model saw Ollama's bytes at inference and emitted tool
# calls the parser silently ate (empty content, no tool_calls). Training on
# the Ollama bytes closes the gap. Every rule below was validated against the
# live granite template + api structs (ollama 0.32.14), down to an exact
# prompt_eval_count match on the raw /api/generate oracle.
# ---------------------------------------------------------------------------

# granite special tokens + tool-call tags, built via concatenation so this
# file never contains the literal tags (display mangling hazard)
SOR = '<|start' + '_of_role|>'
EOR = '<|end' + '_of_role|>'
EOT = '<|end' + '_of_text|>'
TC_OPEN = '<' + 'tool' + '_call' + '>'
TC_CLOSE = '<' + '/tool' + '_call' + '>'
TR_OPEN = '<' + 'tool' + '_response' + '>'
TR_CLOSE = '<' + '/tool' + '_response' + '>'

TOOLS_PREFIX = ('You are a helpful assistant with access to the following tools. '
    'You may call one or more tools to assist with the user query.\n\n'
    'You are provided with function signatures within <tools></tools> XML tags:\n<tools>')
TOOLS_SUFFIX = ('\n</tools>\n\nFor each tool call, return a json object with function '
    'name and arguments within ' + TC_OPEN + TC_CLOSE + ' XML tags:\n' + TC_OPEN +
    '\n{"name": <function-name>, "arguments": <args-json-object>}\n' + TC_CLOSE +
    '. If a tool does not exist in the provided list of tools, notify the user '
    'that you do not have the ability to fulfill the request.')


def _gostr(s):
    # Go json.Marshal of a string: standard escapes, control chars, and Go's
    # default HTML escaping of <, >, &. Non-ASCII stays raw UTF-8.
    out = []
    for ch in s:
        if ch == '"': out.append('\\"')
        elif ch == '\\': out.append('\\\\')
        elif ch == '\n': out.append('\\n')
        elif ch == '\r': out.append('\\r')
        elif ch == '\t': out.append('\\t')
        elif ch == '<': out.append('\\u003c')
        elif ch == '>': out.append('\\u003e')
        elif ch == '&': out.append('\\u0026')
        elif ord(ch) < 0x20: out.append('\\u%04x' % ord(ch))
        else: out.append(ch)
    return '"' + ''.join(out) + '"'


def _gov(v):
    # Go json.Marshal of any: maps marshal with keys sorted lexicographically,
    # compact separators, no spaces after ':' or ','.
    if v is True: return 'true'
    if v is False: return 'false'
    if v is None: return 'null'
    if isinstance(v, str): return _gostr(v)
    if isinstance(v, (int, float)): return json.dumps(v)
    if isinstance(v, list):
        return '[' + ','.join(_gov(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(_gostr(k) + ':' + _gov(v[k]) for k in sorted(v)) + '}'
    raise TypeError(type(v))


def _go_tool(t):
    # api.Tool{Type, Items(omitempty), Function{Name, Description, Parameters}}
    # ToolFunctionParameters{Type, $defs(omitempty), items(omitempty),
    #   required(omitempty), Properties (insertion order)}
    # each ToolProperty value: struct field order anyOf/type/items/description/
    # enum/properties/required (all omitempty) — this is the `json $tool_body`
    # the granite template emits per tool.
    f = t['function']
    parts = [_gostr('name') + ':' + _gostr(f['name'])]
    if 'description' in f:
        parts.append(_gostr('description') + ':' + _gostr(f['description']))
    p = f['parameters']
    pparts = [_gostr('type') + ':' + _gov(p['type'])]
    if p.get('required'):
        pparts.append(_gostr('required') + ':[' +
                      ','.join(_gostr(x) for x in p['required']) + ']')
    if 'properties' in p:
        def go_property(prop):
            out = []
            if 'anyOf' in prop: out.append(_gostr('anyOf') + ':' + _gov(prop['anyOf']))
            if 'type' in prop: out.append(_gostr('type') + ':' + _gov(prop['type']))
            if 'items' in prop: out.append(_gostr('items') + ':' + _gov(prop['items']))
            if 'description' in prop: out.append(_gostr('description') + ':' + _gostr(prop['description']))
            if 'enum' in prop: out.append(_gostr('enum') + ':' + _gov(prop['enum']))
            if 'properties' in prop: out.append(_gostr('properties') + ':' + _gov(prop['properties']))
            if 'required' in prop: out.append(_gostr('required') + ':' + _gov(prop['required']))
            return '{' + ','.join(out) + '}'
        inner = ','.join(_gostr(k) + ':' + go_property(props_v)
                        for k, props_v in p['properties'].items())
        pparts.append(_gostr('properties') + ':{' + inner + '}')
    parts.append(_gostr('parameters') + ':{' + ','.join(pparts) + '}')
    return '{"type":"function","function":{' + ','.join(parts) + '}}'


class OrchatlasSFTDataset(Dataset):
    """Renders each example BYTE-EXACTLY as Ollama's granite template does at
    inference (see the block comment above for why). Per-message segments are
    assembled as text, encoded atomically with add_special_tokens=False, and
    only assistant segments carry labels; everything else is -100.

    Framing (validated against the live template):
      system (index 0): SOR+system+EOR + content + "\\n\\n" + tools block
                        + EOT + "\\n"
      user / mid-turn system: SOR+role+EOR + content + EOT + "\\n"
      tool run: consecutive tool messages fold into ONE user turn —
                SOR+user+EOR + per message "\\n" + TR_OPEN + "\\n" + content
                + "\\n" + TR_CLOSE, then EOT + "\\n"
      assistant: SOR+assistant+EOR + content, then per tool call
                 (a "\\n" first if content is non-empty or it isn't the first
                 call) TC_OPEN + "\\n{\\"name\\": \\"NAME\\", \\"arguments\\": "
                 + Go-marshal(args) + "}\\n" + TC_CLOSE, then EOT + "\\n\""""

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
        if sys_content or tools_block:
            if sys_content and tools_block:
                sysmsg = sys_content + "\n\n" + tools_block
            else:
                sysmsg = sys_content or tools_block
            segments = [(SOR + "system" + EOR + sysmsg + EOT + "\n", False)]
        else:
            segments = []

        i, n = 0, len(messages)
        while i < n:
            m = messages[i]
            role = m.get("role")
            content = m.get("content") or ""
            if role == "tool":
                # fold the whole consecutive run into ONE user turn
                body = ""
                while i < n and messages[i].get("role") == "tool":
                    body += ("\n" + TR_OPEN + "\n" +
                             (messages[i].get("content") or "") + "\n" + TR_CLOSE)
                    i += 1
                segments.append((SOR + "user" + EOR + body + EOT + "\n", False))
            elif role == "assistant":
                text = SOR + "assistant" + EOR + content
                for idx, tc in enumerate(m.get("tool_calls") or []):
                    fn = tc["function"]
                    if content or idx:
                        text += "\n"
                    text += (TC_OPEN + '\n{"name": "' + fn["name"] +
                             '", "arguments": ' + _gov(fn["arguments"]) +
                             "}\n" + TC_CLOSE)
                text += EOT + "\n"
                segments.append((text, True))
                i += 1
            else:
                segments.append((SOR + role + EOR + content + EOT + "\n", False))
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
    ap.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "orchatlas-sft.jsonl"))
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
                         "The orchatlas rows carry the full 57-tool schema and run "
                         "min/mean/max 10472/10717/11785 on the 4.2-8b tokenizer, so the "
                         "12032 default clips nothing. A LOWER cap does not save you: it "
                         "amputates the system prompt and the tool schemas from every row — "
                         "the two things this fine-tune exists to learn — and reports a clean "
                         "run while doing it. atlasorch.sh measures the data and derives this. "
                         "Pass 0 to disable the cap entirely.")
    ap.add_argument("--measure-only", action="store_true",
                    help="render the dataset, print the seq-length stats, and exit without "
                         "loading the model — what atlasorch.sh uses to derive --max-len.")
    ap.add_argument("--max-steps", type=int, default=0,
                    help="stop after N optimizer steps (smoke test). 0 = train the full run.")
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
        print(f"[orchatlas] examples={len(ex)} min={min(ls)} mean={sum(ls)//len(ls)} max={max(ls)}",
              flush=True)
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
    print(f"[orchatlas] {len(examples)} examples", flush=True)
    dataset = OrchatlasSFTDataset(examples, tokenizer, max_len=args.max_len)
    lens = [d["length"] for d in dataset.cache]
    print(f"[orchatlas] seq len min/mean/max = {min(lens)}/{sum(lens)//len(lens)}/{max(lens)}"
          + (f" (capped at {args.max_len})" if args.max_len else ""), flush=True)

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
        save_strategy="no",
        report_to=[],
        remove_unused_columns=False,
        dataloader_drop_last=False,
        optim="adamw_torch",
        ddp_find_unused_parameters=False,
        **({"max_steps": args.max_steps} if args.max_steps else {}),
    )
    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=dataset,
        data_collator=PadCollator(tokenizer.pad_token_id),
    )
    trainer.train()

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