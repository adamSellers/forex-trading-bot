# Live Strategy Roadmap

There is one production path and one active strategy. Planned work must improve real execution quality, risk control or the evidence obtained from actual live decisions.

## Authorized September 6 remediation

Read-only SSH on September 21 verified user-deployed `5c250a7`, v3.3 / strategy 1.1.3, including the prior runtime, quote, maintenance and reconsideration corrections. The [eight-day review](docs/reviews/2026-09-21-eight-day-trading-review.md) reconciles all 15 trades and records current performance. An independent recovery drill remains outstanding. The single `./scripts/deploy.sh` command performs its own tests, build, backup and health checks after publication. Follow the [remediation register](docs/reviews/2026-09-06-remediation.md). Correct execution/exits, broker uncertainty, private-network usability, freshness, analytics and recovery before strategy tuning. Record every justification, regression check and deployment state. Funding and risk limits remain unchanged.

## Immediate live review

- **Locally complete September 21 measurement correction:** [implementation record](docs/reviews/2026-09-21-excursion-measurement-correction.md). Version 2 reversible observations are finalized against authoritative broker closure; legacy and partial history stay outside verified averages. All 744 backend tests pass. User publication/build/deployment remains pending. Confirm the first new v2 broker-closed trade after deployment; no trading rule changes.
- **September 11 correction deployed:** [entry rejection and reconsideration](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md), verified September 21 at `5c250a7`. v3.3 separates expected pricing declines from errors, counts unexpected failures once and permits the next regular scan to reconsider a still-valid setup after a confirmed local pricing rejection. The review confirms durable original bounds and distinct attempt decisions.
- **Maintenance correction deployed:** September 11 read-only inspection verified `33e0b76`, v3.2 / strategy 1.1.2. The [maintenance and quote-limit correction](docs/reviews/2026-09-10-maintenance-and-quote-boundaries.md) preserves enabled intent, active cooldown deadlines and exact quote-limit comparisons.
- **Quote-freshness correction deployed:** September 10 read-only inspection verified `d46da61`, v3.1 / strategy 1.1.1, healthy price delivery and all four pairs evaluated. See the [quote-freshness record](docs/reviews/2026-09-08-quote-freshness-fix-plan.md).
- Verify every scheduled cycle has fresh completed M15/H1 candles and current OANDA spread data.
- Verify every actionable event has an explicit decision outcome; create a durable order intent before broker submission. A local pricing decline before submission must remain distinguishable from an order submission or unknown broker outcome.
- Verify all filled positions have a broker-side protective stop and survive process restarts.
- Track actual fill slippage, spread cost and rejection counts by reason, pair and local market session.

## After enough real observations

- **Target and re-entry work requested September 21:** the [completed study](docs/reviews/2026-09-21-target-and-reentry-evaluation.md) compares a fixed 2R target and defines a fresh-post-exit pullback condition across both entry triggers. With single-position capacity, 2R avoids reviewed loser 3207 but displaces earlier winner 3085; the reviewed week remains negative. Keep the baseline while gathering prospective classifications. Any later comparison must include each change alone, their combination and baseline, with actual costs, capacity, release cohorts and unsuccessful continuations. These conditional calculations are not portfolio return estimates.
- Review version 2 executable-quote coverage and sampling gaps after deployment. Legacy aggregates cannot establish in-position extrema; exact tick paths for old trades remain unavailable.
- Review whether the M15 trigger mix produces the intended live cadence without excessive spread cost.
- Review repeated same-direction entries after protected exits and losses alongside one-position capacity and account-wide cooldown. The September 21 all-trigger candidate is precisely specified, including its state anchor and winning counterexample. Retain the exit anchor, touching-bar start, trigger combination and completed-candle context when classifying future observations. Do not equate removed historical losses with an expected benefit; rejecting a trade changes later opportunity sequences.
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
