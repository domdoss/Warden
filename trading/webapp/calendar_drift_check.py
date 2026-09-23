#!/usr/bin/env python3
"""POST-HOC supplement to calendar_validation.py (does NOT change its verdicts).

calendar_validation's chance null is a zero-drift sign flip, and its drift
control (CTRL C2C long) passes the gate on some tickers, so a long-only pass
can be plain beta. This reports, on the FULL history per ticker:
  - the raw decomposition: mean gross bps of ON (close->next open), ID
    (open->close) and C2C (close->next close);
  - for TOM -1..+3 (4 held sessions) and PREHOL base (1 held session): event
    mean gross vs the unconditional long hold of the same length over all days,
    excess bps and a t-stat of (event - unconditional mean).
Same data loaders as calendar_validation (frozen yfinance cache, 1-min pkls).
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, "/opt/Warden/trading/webapp")

import numpy as np  # noqa: E402
import daytrade  # noqa: E402
import calendar_validation as cv  # noqa: E402


def excess(ev: np.ndarray, allk: np.ndarray) -> dict:
    if len(ev) < 2:
        return {"n": int(len(ev))}
    m, mu = float(ev.mean()), float(np.nanmean(allk))
    t = (m - mu) / (float(ev.std(ddof=1)) / np.sqrt(len(ev)))
    return {"n": int(len(ev)), "event_gross_bps": round(m, 2),
            "uncond_gross_bps": round(mu, 2), "excess_bps": round(m - mu, 2),
            "t": round(float(t), 2)}


def main() -> None:
    last = daytrade.last_session()
    master = list(cv.yf_daily("SPY", last, fetch=False).index.date)
    for t in cv.ENGINE + cv.YF_TICKERS:
        P = cv.load_engine(t, last) if t in cv.ENGINE else \
            cv.load_yf(cv.yf_daily(t, last, fetch=False))
        days, o, c = P["days"], P["o"], P["c"]
        cal = cv.build_calendar([d for d in master if days[0] <= d <= days[-1]])
        on = (o[1:] / c[:-1] - 1) * 1e4
        idr = (c / o - 1) * 1e4
        c2c = (c[1:] / c[:-1] - 1) * 1e4
        rec = {"ticker": t, "sessions": len(days),
               "ON_gross_bps": round(float(on.mean()), 2),
               "ID_gross_bps": round(float(idr.mean()), 2),
               "C2C_gross_bps": round(float(c2c.mean()), 2),
               "ON_minus_ID_bps": round(float(on.mean() - idr.mean()), 2),
               "ON_minus_ID_t": round(float((on.mean() - idr[1:].mean()) /
                                            np.std(on - idr[1:], ddof=1) * np.sqrt(len(on))), 2)}
        for spec, k in ((cv.counted_cells()[-2], 4), (cv.counted_cells()[-1], 1)):
            ev = np.array([x[3] for x in cv.cell_trades(spec, P, cal)])
            allk = (c[k:] / c[:-k] - 1) * 1e4
            rec[cv.cell_name(spec)] = excess(ev, allk)
        print(json.dumps(rec), flush=True)
    print("DONE calendar-drift-check", flush=True)


if __name__ == "__main__":
    main()
