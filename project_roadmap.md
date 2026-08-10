# Live Strategy Roadmap

There is one production path and one active strategy. Planned work must improve real execution quality, risk control or the evidence obtained from actual live decisions.

## Immediate live review

- Verify every scheduled cycle has fresh completed M15/H1 candles and current OANDA spread data.
- Verify every actionable event creates one durable order intent and either one broker fill or one explicit rejection.
- Verify all filled positions have a broker-side protective stop and survive process restarts.
- Track actual fill slippage, spread cost and rejection counts by reason, pair and local market session.

## After enough real observations

- Add maximum favorable/adverse excursion fields from broker price history for closed live trades.
- Review whether the M15 trigger mix produces the intended live cadence without excessive spread cost.
- Review breakout and pullback-resumption cohorts independently after at least 30 closed trades.
- Review whether the 1.25 ATR stop, 1.5R target and six-hour time stop produce acceptable expectancy and holding duration.
- Consider a release change only when the live event funnel or closed-trade evidence identifies a specific failure.

## Permanent constraints

- One live strategy and one active entry runtime.
- No simulated execution subsystem or strategy switching UI.
- No manual test orders.
- Risk per trade at or below 0.25% for the current intraday release.
- No more than one open position while the account remains near A$100.
- Broker/account truth wins over cached local state.
