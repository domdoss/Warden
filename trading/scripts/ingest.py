import yfinance as yf
import pandas as pd
from pathlib import Path


def ingest(ticker, interval="1h", days=60):
    df = yf.download(ticker, period=f"{days}d", interval=interval, progress=False)
    df = df.reset_index()
    df.columns = ['timestamps', 'open', 'high', 'low', 'close', 'volume']
    out = Path(f"~/alpha-stack/data/{ticker.replace('/', '_')}_{interval}.parquet").expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out)
    print(f"ingested {ticker} {interval}: {len(df)} rows -> {out}")
    return df


if __name__ == "__main__":
    ingest("SPY")
    ingest("BTC-USD")