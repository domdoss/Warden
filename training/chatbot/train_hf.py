#!/usr/bin/env python3
"""
Custom-chatbot LoRA trainer: plain Hugging Face transformers + peft, no unsloth.

Why not train_iris_lora.py: unsloth 2026.9.6's Granite patch returns NaN logits
for granite-4.2-3b on this box — with or without 4-bit, before any LoRA, on a
single unpadded example — while stock transformers on the identical tokens gives
a normal loss (2026-09-29 diagnosis). Every logged step of the first chatbot run
had grad_norm=nan (the logged loss=0.0 was HF's NaN filter). This trainer keeps
the same idea (assistant turns only, Granite chat format) on the stock path.

Rows are {"messages":[system,user,assistant,...]} — no tools. The loss covers the
assistant turns only. A row longer than --max-len is an error, never a silent
truncation (that would cut the persona system prompt off the example).

One process = one GPU. Run bare for a single card, or under torchrun for DDP across
both (each rank holds its own fp16 base + LoRA; the effective batch stays 4 either
way). fp16 base + fp32 LoRA adapters (Turing has no bf16).
Fails immediately on a non-finite loss so a diverged run can never be packed.
"""
import argparse
import json
import math
import os

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
# bare run: stay on cuda:0 (the other card holds the desktop). Under torchrun each rank
# picks its own GPU from LOCAL_RANK — pinning CUDA_VISIBLE_DEVICES would hide the other card.
if "LOCAL_RANK" not in os.environ and "CUDA_VISIBLE_DEVICES" not in os.environ:
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
# the base is pulled into the HF cache by pull-base.sh; never touch the network here
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainerCallback, TrainingArguments

# Granite chat tokens, built by concatenation so this file never holds them literally
SOR = "<|start" + "_of_role|>"
EOR = "<|end" + "_of_role|>"
EOT = "<|end" + "_of_text|>"


def render(messages, tok, max_len):
    input_ids, labels = [], []
    for m in messages:
        role, content = m["role"], m.get("content") or ""
        text = SOR + role + EOR + content + EOT + "\n"
        ids = tok.encode(text, add_special_tokens=False)
        input_ids.extend(ids)
        labels.extend(ids if role == "assistant" else [-100] * len(ids))
    if len(input_ids) > max_len:
        raise SystemExit(f"a row is {len(input_ids)} tokens, over --max-len {max_len} — raise it, rows are never truncated")
    if not any(l != -100 for l in labels):
        raise SystemExit("a row has no assistant turn to learn from")
    return {"input_ids": input_ids, "labels": labels}


class PadCollator:
    def __init__(self, pad_id):
        self.pad_id = pad_id

    def __call__(self, batch):
        n = max(len(b["input_ids"]) for b in batch)
        pad = [n - len(b["input_ids"]) for b in batch]
        return {
            "input_ids": torch.tensor([b["input_ids"] + [self.pad_id] * p for b, p in zip(batch, pad)]),
            "labels": torch.tensor([b["labels"] + [-100] * p for b, p in zip(batch, pad)]),
            "attention_mask": torch.tensor([[1] * len(b["input_ids"]) + [0] * p for b, p in zip(batch, pad)]),
        }


class FailOnNaN(TrainerCallback):
    """A non-finite LOSS means the forward pass is broken — stop, don't train on garbage.
    (grad_norm may legitimately be inf on fp16 loss-scale warm-up steps, so it isn't checked.)"""

    def on_log(self, args, state, control, logs=None, **kw):
        v = (logs or {}).get("loss")
        if v is not None and not math.isfinite(v):
            raise RuntimeError(f"loss is {v} at step {state.global_step} — the run diverged; nothing was saved")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="HF model id (must be in the HF cache)")
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True, help="adapter output dir")
    ap.add_argument("--merged-out", required=True, help="merged fp16 model dir (for GGUF conversion)")
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    # batch 2 × accum 2 = effective 4. Batch 4 straight up OOMs a 16 GB card: the 100k-token
    # vocab makes the logits (fp16 + fp32 upcast) ~0.7 GB per 1240 tokens, on top of a 7.4 GB base.
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--grad-accum", type=int, default=0, help="0 = auto: keep the effective batch at 4 across the GPUs in use")
    ap.add_argument("--max-len", type=int, default=2048)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.model)
    pad_id = tok.convert_tokens_to_ids("<|fim_pad|>")
    if pad_id is None or pad_id == tok.unk_token_id:
        pad_id = tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id

    rows = [json.loads(l) for l in open(args.data, encoding="utf-8") if l.strip()]
    data = [render(r["messages"], tok, args.max_len) for r in rows]
    lens = [len(d["input_ids"]) for d in data]
    print(f"[bot-train] {len(data)} rows, seq len min/mean/max = {min(lens)}/{sum(lens) // len(lens)}/{max(lens)}", flush=True)

    rank = int(os.environ.get("LOCAL_RANK", 0))
    world = int(os.environ.get("WORLD_SIZE", 1))
    torch.cuda.set_device(rank)
    grad_accum = args.grad_accum or max(1, 4 // (args.batch * world))
    print(f"[bot-train] {world} GPU(s), batch {args.batch} x accum {grad_accum} x {world} = {args.batch * grad_accum * world} effective", flush=True)
    model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.float16).to(f"cuda:{rank}")
    model = get_peft_model(model, LoraConfig(
        r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=0.0, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    model.config.use_cache = False
    model.print_trainable_parameters()

    targs = TrainingArguments(
        output_dir=args.out, num_train_epochs=args.epochs, per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=grad_accum, learning_rate=args.lr, ddp_find_unused_parameters=False,
        gradient_checkpointing=True, gradient_checkpointing_kwargs={"use_reentrant": False},
        lr_scheduler_type="cosine", warmup_ratio=0.05, fp16=True,
        logging_steps=5, logging_nan_inf_filter=False, save_strategy="no", report_to=[],
        remove_unused_columns=False, optim="adamw_torch", max_grad_norm=1.0, seed=3407,
    )
    trainer = Trainer(model=model, args=targs, train_dataset=data, data_collator=PadCollator(pad_id), callbacks=[FailOnNaN()])
    trainer.train()

    # writes are rank-0 only; the other ranks wait at the barrier so nobody exits mid-merge
    if trainer.is_world_process_zero():
        model.save_pretrained(args.out)
        tok.save_pretrained(args.out)
        print(f"[bot-train] adapter saved → {args.out}", flush=True)
        merged = model.merge_and_unload()
        merged.save_pretrained(args.merged_out, safe_serialization=True)
        tok.save_pretrained(args.merged_out)
        print(f"[bot-train] merged model saved → {args.merged_out}", flush=True)
    if world > 1:
        torch.distributed.barrier()


if __name__ == "__main__":
    main()
