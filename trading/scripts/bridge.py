import json
import sys
import pandas as pd
from datetime import datetime
from pathlib import Path

# The Kronos `model` package lives under the Kronos repo root. Add it to the
# import path so this script can be run from anywhere (the guide runs it with
# cwd = ~/alpha-stack/Kronos, but Python only puts the *script* dir on the path).
_KRONOS_ROOT = Path("~/alpha-stack/Kronos").expanduser()
if str(_KRONOS_ROOT) not in sys.path:
    sys.path.insert(0, str(_KRONOS_ROOT))


class KronosSignal:
    def __init__(self, forecast_df, confidence):
        self.forecast = forecast_df
        self.confidence = confidence
        self.generated_at = datetime.utcnow().isoformat()

    def to_markdown(self):
        last = self.forecast['close'].iloc[0]
        pred = self.forecast['close'].iloc[-1]
        chg = (pred - last) / last * 100
        vol_up = self.forecast['volume'].iloc[-1] > self.forecast['volume'].iloc[0]
        return (
            "## Quant Signal (Kronos-mini)\n"
            f"- **Horizon**: {len(self.forecast)} bars\n"
            f"- **Predicted change**: {chg:.2f}%\n"
            f"- **Confidence**: {self.confidence:.2f}\n"
            f"- **Volume trend**: {'Up' if vol_up else 'Down'}\n"
        )


def run_cycle(predictor, df, lookback=400, pred_len=120):
    # The ingested parquet stores datetimes in a `timestamps` column with a
    # RangeIndex; the predictor's calc_time_stamps needs a DatetimeIndex/Series
    # with a `.dt` accessor, so we use that column for the timestamp inputs.
    if 'timestamps' not in df.columns:
        raise ValueError("DataFrame must have a `timestamps` column (run ingest.py first)")
    x = df.iloc[:lookback]
    x_ts = pd.Series(pd.to_datetime(x['timestamps']))
    last_ts = pd.to_datetime(df['timestamps'].iloc[lookback - 1])
    freq = pd.infer_freq(pd.DatetimeIndex(x_ts)) or 'h'
    y_ts = pd.Series(pd.date_range(start=last_ts, periods=pred_len, freq=freq))
    forecast = predictor.predict(
        df=x[['open', 'high', 'low', 'close', 'volume']],
        x_timestamp=x_ts, y_timestamp=y_ts, pred_len=pred_len
    )
    std = forecast['close'].std()
    conf = max(0.0, 1.0 - (std / forecast['close'].mean()))
    return KronosSignal(forecast, conf)


def log(signal, decision, execution):
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "signal": {"confidence": signal.confidence, "generated_at": signal.generated_at},
        "decision": decision,
        "execution": execution
    }
    path = Path("~/alpha-stack/logs/decisions.jsonl").expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(entry) + "\n")


if __name__ == "__main__":
    from model import Kronos, KronosTokenizer, KronosPredictor
    tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
    model = Kronos.from_pretrained("NeoQuasar/Kronos-mini")
    predictor = KronosPredictor(model, tokenizer, max_context=2048)

    df = pd.read_parquet(Path("~/alpha-stack/data/SPY_1h.parquet").expanduser())
    signal = run_cycle(predictor, df)
    print(signal.to_markdown())