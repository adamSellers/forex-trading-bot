# Live Strategy Roadmap

There is one production path and one active strategy. Planned work must improve real execution quality, risk control or the evidence obtained from actual live decisions.

## Authorized September 6 remediation

The user deployed v3 at `8d45be3`; healthy runtime and direct API access were verified on September 7. The [startup checkpoint/locale correction](docs/reviews/2026-09-07-startup-checkpoint.md) is local and pending the single `./scripts/deploy.sh` deployment. An independent recovery drill remains outstanding. The deployment command performs its own tests, build, backup and health checks. Follow the [remediation register](docs/reviews/2026-09-06-remediation.md). Correct execution/exits, broker uncertainty, private-network usability, freshness, analytics and recovery before strategy tuning. Record every justification, regression check and deployment state. Funding and risk limits remain unchanged.

## Immediate live review

- Verify every scheduled cycle has fresh completed M15/H1 candles and current OANDA spread data.
- Verify every actionable event creates one durable order intent and either one broker fill or one explicit rejection.
- Verify all filled positions have a broker-side protective stop and survive process restarts.
- Track actual fill slippage, spread cost and rejection counts by reason, pair and local market session.

## After enough real observations

- Review the new executable-quote excursion coverage and sampling gaps. Exact tick-path excursions for old trades remain unavailable.
- Review whether the M15 trigger mix produces the intended live cadence without excessive spread cost.
- Review breakout and pullback-resumption cohorts independently as new trades accumulate; 30 closed trades can trigger inspection, but does not establish an edge or justify selecting winners.
- Review whether the 1.25 ATR stop, 1.5R target and six-hour time stop produce acceptable expectancy and holding duration.
- Consider a release change only when the live event funnel or closed-trade evidence identifies a specific failure.

## Permanent constraints

- One live strategy and one active entry runtime.
- Private internal-network personal tool with direct dashboard/API access; no operator login or account system.
- No simulated execution subsystem or strategy switching UI.
- No manual test orders.
- Risk per trade at or below 0.25% for the current intraday release.
- No more than one open position while the account remains near A$100.
- Broker/account truth wins over cached local state.
