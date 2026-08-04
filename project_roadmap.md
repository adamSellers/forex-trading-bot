# Live Strategy Roadmap

There is one production path and one active strategy. Planned work must improve real execution quality, risk control or the evidence obtained from actual live decisions.

## Immediate live review

- Verify every scheduled cycle has fresh H4/daily candles and current OANDA financing metadata.
- Verify every actionable event creates one durable order intent and either one broker fill or one explicit rejection.
- Verify all filled positions have a broker-side protective stop and survive process restarts.
- Track actual fill slippage, financing and rejection counts by reason.

## After enough real observations

- Add maximum favorable/adverse excursion fields from broker price history for closed live trades.
- Review whether the financing advantage thresholds avoid costly rollover without suppressing all suitable trends.
- Review whether 2.5 ATR produces acceptable realized loss size and holding duration.
- Consider a release change only when the live event funnel or closed-trade evidence identifies a specific failure.

## Permanent constraints

- One live strategy and one active entry runtime.
- No simulated execution subsystem or strategy switching UI.
- No manual test orders.
- Risk per trade at or below 1%; current release uses 0.5%.
- No more than one open position while the account remains near A$100.
- Broker/account truth wins over cached local state.
