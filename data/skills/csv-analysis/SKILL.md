---
name: csv-analysis
description: "Inspect and analyze tabular data files (CSV/TSV) — headers, row counts, filtering, aggregation, sorting, joins, chart-ready summaries, xlsx conversion. Use whenever a task hands you a data file and asks a question about its contents or wants it reshaped."
---

## Inspect before anything
- First rows: `head -5 file.csv`. Line count: `wc -l file.csv`. Header: `head -1 file.csv`.
- Detect the delimiter (`,` `\t` `;`) from the header before running anything column-aware.
- Big file: `du -h file.csv` — if it's huge, sample (`head -n 10000`) rather than loading the whole thing for a first look.

## Command-line analysis (Bash)
- Column extract: `cut -d, -f3 file.csv` (add `-f2,5` for several). Number a header row into fields with `csvtool`/`xsv` when quoting gets hairy.
- Filter rows: `grep`, or `awk -F, '$3 > 100' file.csv` for comparisons. Quote-aware filtering: `mlr --csv filter '$3 > 100' file.csv` (Miller handles embedded commas/quotes correctly — prefer it once awk's comma assumption breaks).
- Aggregate: `mlr --csv count-distinct -f type file.csv`, or `awk -F, '{sum+=$3} END{print sum}'`.
- Sort: `sort -t, -k3 -n file.csv` (add `-r` to reverse; `LC_ALL=C sort` for stable byte order on mixed data).
- Unique: `sort -u`. Duplicate keys: `mlr --csv count-distinct -f id` then filter counts >1.
- Join two CSVs: `mlr --csv join -j id -f a.csv then b.csv` (or `join` after sorting both on the key).

## Spreadsheet files
- .xlsx is `xlsx` skill territory (pandas/openpyxl path); convert when the task is tabular: `python` + `pandas.read_excel` → work as a DataFrame.

## Python (pandas) for real analysis
When the question is analytic (means per group, trends, top-N, correlations), use a Python one-shot script via Bash:
```
import pandas as pd
df = pd.read_csv('file.csv')
print(df.groupby('category')['amount'].agg(['sum','mean','count']))
```
- Report numbers from the script's printed output, rounded sensibly, with the row/group counts they came from.

## Output
- Write reshaped results to a new file in the documents workspace (`/home/dominic/Warden/`), and say the path in the reply. Never overwrite the source file.

## Rules
- Quote actual counts (`1,204 rows`) — a summary without the row count behind it is a guess.
- Empty cells, mixed delimiters, and quoted commas are the usual failure — when a parse looks wrong (absurd columns, ragged rows), switch to `mlr --csv` or pandas rather than adjusting awk field indexes by hand.