#!/usr/bin/env python3
"""Render an SFT dataset through the Granite chat template and report token
lengths, without loading the model (tokenizer only). Mirrors
ToolcallSFTDataset.render so the numbers match the training-time printout.
Usage: check_seqlen.py [dataset.jsonl] [hf-model-id]  (defaults: iris data,
granite-4.2-3b)."""
import json
import sys
sys.path.insert(0, "training")
from transformers import AutoTokenizer

from train_iris_lora import ToolcallSFTDataset, load_examples

data = sys.argv[1] if len(sys.argv) > 1 else "/opt/Warden/training/toolcall-sft.jsonl"
model = sys.argv[2] if len(sys.argv) > 2 else "ibm-granite/granite-4.2-3b"
tok = AutoTokenizer.from_pretrained(model)
ex = load_examples(data)
ds = ToolcallSFTDataset(ex, tok, max_len=0)  # cap disabled — raw lengths
lens = [d["length"] for d in ds.cache]
lens.sort()
print(f"model={model}")
print(f"examples={len(lens)} min={lens[0]} mean={sum(lens)//len(lens)} "
      f"p95={lens[int(0.95 * len(lens))]} max={lens[-1]}")