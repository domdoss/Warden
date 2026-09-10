#!/usr/bin/env python3
"""
Toolcall (iris) LoRA SFT — fine-tune granite-4.1-3b on the toolcall (iris) dataset.

Trains ONLY the assistant turns (the Granite <|tool_call|> JSON and the final
one-sentence summary); system / user / tool-result turns are masked to -100 so
the model never wastes capacity learning to parrot inputs. Tools are rendered
BYTE-EXACTLY as Ollama does at inference (Go-style marshal: compact separators,
struct field order, alphabetized property keys, JSON-escaped non-ASCII) — the
previous HF-jinja render (space separators, insertion-order keys, raw em-dashes)
differed from the live tool block by ~265 tokens, and the fine-tuned model's
emission fell apart on that distribution shift (dryfire: 6 empty-turn failures
traced to the mismatch). Training on the Ollama bytes closes the gap.

Not run automatically by Warden. To train:
    . .venv/bin/activate
    python train_iris_lora.py            # single GPU (cuda:0 only)

To use BOTH RTX 5000s (DDP — fills both cards, bigger effective batch):
    torchrun --nproc_per_node=2 train_iris_lora.py

Outputs an adapter (training/toolcall-lora) and a merged model
(training/toolcall-lora-merged) ready for GGUF conversion (see pack_iris.sh).
The merge + disk writes run on the main process only; other ranks wait at the
barrier, so no races and no duplicate artifacts.
"""
import argparse
import gc
import json
import os
import sys

# Reduce fragmentation on the 16 GB cards before CUDA initializes.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import torch
from torch.utils.data import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
)
from peft import (
    LoraConfig,
    PeftModel,
    TaskType,
    get_peft_model,
    prepare_model_for_kbit_training,
)
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


class ToolcallSFTDataset(Dataset):
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
                print(f"[toolcall-sft] left-truncated {n}/{len(self.cache)} "
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
    ap.add_argument("--model", default="ibm-granite/granite-4.1-3b",
                    help="HF model id or local path (must match Ollama granite4.1:3b)")
    ap.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "toolcall-sft.jsonl"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "toolcall-lora"))
    ap.add_argument("--merged-out", default=os.path.join(os.path.dirname(__file__), "toolcall-lora-merged"))
    # 2 epochs, not 4: 281 examples converge by epoch 2 (loss flattens ~0.12)
    # and epochs 3-4 just memorize verbatim phrasings — measured regression
    # risk, no gain (2026-09-02 dryfire comparison).
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--lr", type=float, default=1e-4)
    # per-device batch. With torchrun --nproc=2 the effective batch is
    # batch * grad_accum * 2. batch=1 + grad-accum=2 keeps effective batch 4 (×2
    # DDP). Since the byte merge (2026-09-05) EVERY example carries the full
    # 41-tool iris schema block: seq min/mean/max = 1401/4702/4994 — the cap
    # must sit above that or it left-truncates the system prompt off nearly the
    # whole dataset (left-truncation keeps the tail). 6144 clears the max with
    # headroom while still bounding the logits-upcast peak (batch×seq×vocab×4B
    # — the OOM chunk on 16 GB cards). If a desktop-taxed GPU (Chrome/kwin
    # ~1.4 GB on GPU 1) still OOMs, drop to --grad-accum 4, not a lower cap.
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--grad-ckpt", action=argparse.BooleanOptionalAction, default=True,
                    help="gradient checkpointing (on by default; --no-grad-ckpt disables)")
    ap.add_argument("--qlora", action="store_true",
                    help="QLoRA: load base in 4-bit NF4 (bitsandbytes). For 12 GB "
                         "cards where the fp16 base + logits upcast peak OOMs. The "
                         "merge at the end reloads the base in fp16 so the saved "
                         "merged model is a normal HF model, not a 4-bit one.")
    ap.add_argument("--max-len", type=int, default=6144,
                    help="cap rendered seq length; longer examples are left-truncated "
                         "(keep last N) so the assistant labels at the tail are preserved. "
                         "Bounds the logits-upcast peak (batch×seq×vocab×4B) — the OOM chunk "
                         "on 16 GB cards. The merged iris dataset (41 schemas on every row) "
                         "runs min/mean/max 1401/4702/4994, so the 6144 default clips nothing; "
                         "any lower value amputates the system prompt from most examples. "
                         "Pass 0 to disable the cap entirely.")
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    args = ap.parse_args()

    print(f"[toolcall-sft] model={args.model} data={args.data}", flush=True)
    state = PartialState()
    if state.num_processes > 1:
        print(f"[toolcall-sft] DDP across {state.num_processes} GPUs "
              f"(rank {state.process_index})", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # fp16 — RTX 5000 (Turing) has no native bf16, so use fp16 not bf16.
    # Load on the rank's own GPU; under torchrun DDP each rank loads its copy.
    quant = None
    if args.qlora:
        quant = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.float16,
        )
    model = AutoModelForCausalLM.from_pretrained(
        args.model, dtype=torch.float16, trust_remote_code=True,
        quantization_config=quant,
    )
    model.config.use_cache = False
    if args.qlora:
        # Frozen 4-bit base: upcast norms, enable grads for checkpointed inputs.
        model = prepare_model_for_kbit_training(model)
    # Gradient checkpointing ON by default: the tools block makes sequences
    # ~2K tokens, so batch>2 with no checkpointing OOMs a 16 GB card. Checkpointing
    # trades recompute for memory, letting a bigger batch fill the cards.
    if args.grad_ckpt:
        if hasattr(model, "gradient_checkpointing_enable"):
            model.gradient_checkpointing_enable()
        # Frozen base + grad checkpointing needs this or the first backward errors.
        if hasattr(model, "enable_input_require_grads"):
            model.enable_input_require_grads()

    examples = load_examples(args.data)
    print(f"[toolcall-sft] {len(examples)} examples", flush=True)
    dataset = ToolcallSFTDataset(examples, tokenizer, max_len=args.max_len)
    lens = [d["length"] for d in dataset.cache]
    print(f"[toolcall-sft] seq len min/mean/max = {min(lens)}/{sum(lens)//len(lens)}/{max(lens)}"
          + (f" (capped at {args.max_len})" if args.max_len else ""), flush=True)

    # LoRA on every linear layer — this is tool-call transcription (style), not
    # new knowledge, so a small rank is plenty.
    lora = LoraConfig(
        r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=0.05, bias="none",
        task_type=TaskType.CAUSAL_LM,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

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
    )
    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=dataset,
        data_collator=PadCollator(tokenizer.pad_token_id),
    )
    trainer.train()

    # Save the adapter (small) AND a merged model (for GGUF conversion).
    # Under DDP the local `model` is the unwrapped PeftModel (Trainer keeps its
    # own DDP copy), so merge_and_unload works on it directly. Writes are
    # main-process-only; other ranks wait at the barrier — no races, no dupes.
    if state.is_main_process:
        model.save_pretrained(args.out)
        tokenizer.save_pretrained(args.out)
        print(f"[toolcall-sft] adapter saved → {args.out}", flush=True)

        if args.qlora:
            # Don't merge into the 4-bit weights — the result would stay in
            # bitsandbytes format, unreadable by GGUF conversion, and the LoRA
            # deltas would be re-quantized to 4-bit. Reload the base in fp16
            # and merge into that instead: plain merge, no training state.
            del model
            gc.collect()
            torch.cuda.empty_cache()
            base = AutoModelForCausalLM.from_pretrained(
                args.model, dtype=torch.float16, trust_remote_code=True)
            merged = PeftModel.from_pretrained(base, args.out).merge_and_unload()
        else:
            merged = model.merge_and_unload()
        merged.save_pretrained(args.merged_out)
        tokenizer.save_pretrained(args.merged_out)
        print(f"[toolcall-sft] merged model saved → {args.merged_out}", flush=True)
        print("[toolcall-sft] next: ./pack_iris.sh (convert to GGUF + ollama create)",
              flush=True)
    state.wait_for_everyone()


if __name__ == "__main__":
    main()