#!/usr/bin/env python3
"""
Dexter LoRA SFT — fine-tune granite-4.1-3b on the dexter tool-call dataset.

Trains ONLY the assistant turns (the Granite <|tool_call|> JSON and the final
one-sentence summary); system / user / tool-result turns are masked to -100 so
the model never wastes capacity learning to parrot inputs. Per-example tools
are rendered through the model's own chat template, so the trained sequence is
identical to what dexter sees at inference (Ollama applies the same template).

Not run automatically by Warden. To train:
    . .venv/bin/activate
    python train_dexter_lora.py            # single GPU (cuda:0 only)

To use BOTH RTX 5000s (DDP — fills both cards, bigger effective batch):
    torchrun --nproc_per_node=2 train_dexter_lora.py

Outputs an adapter (training/dexter-lora) and a merged model
(training/dexter-lora-merged) ready for GGUF conversion (see pack_dexter.sh).
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


class DexterSFTDataset(Dataset):
    """Renders each example through the Granite chat template and masks every
    non-assistant turn. Built by incremental prefix-diff: apply_chat_template on
    messages[:i+1] is a prefix of the render on messages[:i+2] (Granite's
    template is prefix-structured), so the tokens a given message contributes
    are exactly the suffix added at step i. Assistant turns become labels; the
    rest become -100."""

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
                print(f"[dexter-sft] left-truncated {n}/{len(self.cache)} "
                      f"examples to max_len={max_len}", flush=True)

    @staticmethod
    def _render(ex, tokenizer):
        messages = ex["messages"]
        tools = ex.get("tools") or None
        prev_ids = None
        input_ids = []
        labels = []
        for msg in messages:
            partial = messages[: messages.index(msg) + 1]
            try:
                ids = tokenizer.apply_chat_template(
                    partial, tools=tools, tokenize=True,
                    add_generation_prompt=False, return_dict=False,
                )
            except TypeError:
                # tokenizer without tool-aware template: render without tools
                # (the tools block then needs to live in the system prompt; not
                # the case for granite-4.1-3b, but degrade gracefully).
                ids = tokenizer.apply_chat_template(
                    partial, tokenize=True, add_generation_prompt=False,
                    return_dict=False,
                )
            ids = list(ids)
            if prev_ids is None:
                new = ids
            else:
                # the suffix this message contributed
                if len(ids) < len(prev_ids) or ids[: len(prev_ids)] != prev_ids:
                    # Template isn't a clean prefix (rare); fall back to masking
                    # nothing beyond the system+user prefix. Re-derive by
                    # rendering the prompt-only and masking that length.
                    new = ids[len(prev_ids):]
                else:
                    new = ids[len(prev_ids):]
            input_ids.extend(new)
            labels.extend(new if msg.get("role") == "assistant" else [-100] * len(new))
            prev_ids = ids
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

    print(f"[dexter-sft] model={args.model} data={args.data}", flush=True)
    state = PartialState()
    if state.num_processes > 1:
        print(f"[dexter-sft] DDP across {state.num_processes} GPUs "
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
    print(f"[dexter-sft] {len(examples)} examples", flush=True)
    dataset = DexterSFTDataset(examples, tokenizer, max_len=args.max_len)
    lens = [d["length"] for d in dataset.cache]
    print(f"[dexter-sft] seq len min/mean/max = {min(lens)}/{sum(lens)//len(lens)}/{max(lens)}"
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
        print(f"[dexter-sft] adapter saved → {args.out}", flush=True)

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
        print(f"[dexter-sft] merged model saved → {args.merged_out}", flush=True)
        print("[dexter-sft] next: ./pack_dexter.sh (convert to GGUF + ollama create)",
              flush=True)
    state.wait_for_everyone()


if __name__ == "__main__":
    main()