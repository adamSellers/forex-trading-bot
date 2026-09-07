# Live Strategy Roadmap

There is one production path and one active strategy. Planned work must improve real execution quality, risk control or the evidence obtained from actual live decisions.

## Authorized September 6 remediation

Read-only SSH on September 7 and 8 verified user-deployed `8e4fb99`, including v3, the startup checkpoint/locale correction and operational-email removal. September 8's Time Stop was verified against a live closed-trade record. An independent recovery drill remains outstanding. The single `./scripts/deploy.sh` command performs its own tests, build, backup and health checks after publication. Follow the [remediation register](docs/reviews/2026-09-06-remediation.md). Correct execution/exits, broker uncertainty, private-network usability, freshness, analytics and recovery before strategy tuning. Record every justification, regression check and deployment state. Funding and risk limits remain unchanged.

## Immediate live review

- **Implementation approved September 8:** [quote-freshness correction plan](docs/reviews/2026-09-08-quote-freshness-fix-plan.md). Separate event time from validated receipt throughout health, execution and management. Local code is complete for v3.1 / strategy 1.1.1; see the record for verification. The upgrade preserves existing settings. Next: user publication/deployment and observation of receipt/event separation in production.
- Verify every scheduled cycle has fresh completed M15/H1 candles and current OANDA spread data.
- Verify every actionable event creates one durable order intent and either one broker fill or one explicit rejection.
- Verify all filled positions have a broker-side protective stop and survive process restarts.
- Track actual fill slippage, spread cost and rejection counts by reason, pair and local market session.

## After enough real observations

- **Explicit user priority, September 8: review the fixed 1.5R target as the live sample grows.** September 7 USD/JPY banked three targets before a much larger continuation. Evaluate whether a different exit policy would improve net expectancy across continuing trends and reversals, including costs, drawdown, holding time and the one-position/re-entry constraints. Do not sum incompatible hypothetical trades or treat a larger possible winner as evidence of a superior policy. No target/trailing change is authorized by this request. See [exit-policy observations](docs/reviews/2026-09-08-exit-policy-observations.md).
- Review the new executable-quote excursion coverage and sampling gaps. Exact tick-path excursions for old trades remain unavailable.
- Review whether the M15 trigger mix produces the intended live cadence without excessive spread cost.
- Review breakout and pullback-resumption cohorts independently as new trades accumulate; 30 closed trades can trigger inspection, but does not establish an edge or justify selecting winners.
- Review whether the 1.25 ATR stop, 1.5R target and six-hour time stop produce acceptable expectancy and holding duration.
- Consider a release change only when the live event funnel or closed-trade evidence identifies a specific failure.

## Permanent constraints

- One live strategy and one active entry runtime.
- Private internal-network personal tool with direct dashboard/API access; no operator login or account system.
- Preserve existing trade emails; operational health is shown in the dashboard/API without automatic warning/recovery emails.
- No simulated execution subsystem or strategy switching UI.
- No manual test orders.
- Risk per trade at or below 0.25% for the current intraday release.
- No more than one open position while the account remains near A$100.
- Broker/account truth wins over cached local state.
