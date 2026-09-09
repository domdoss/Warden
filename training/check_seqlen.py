#!/usr/bin/env python3
"""One-off: render the merged-iris dataset through the Granite chat template and
report token lengths, without loading the model (tokenizer only). Mirrors
DexterSFTDataset.render so the numbers match the training-time printout."""
import json
import sys
sys.path.insert(0, "training")
from transformers import AutoTokenizer

from train_dexter_lora import DexterSFTDataset, load_examples

tok = AutoTokenizer.from_pretrained("ibm-granite/granite-4.1-3b")
ex = load_examples("/opt/Warden/training/toolcall-sft.jsonl")
ds = DexterSFTDataset(ex, tok, max_len=0)  # cap disabled — raw lengths
lens = [d["length"] for d in ds.cache]
lens.sort()
over = sum(1 for n in lens if n > 2048)
print(f"examples={len(lens)} min={lens[0]} mean={sum(lens)//len(lens)} "
      f"p95={lens[int(0.95 * len(lens))]} max={lens[-1]} over-2048={over}")