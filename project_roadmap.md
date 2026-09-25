# Live Strategy Roadmap

There is one production path and one active strategy. Planned work must improve real execution quality, risk control or the evidence obtained from actual live decisions. The [September 26 status and decision register](docs/reviews/2026-09-26-status-and-decisions.md) separates the last verified production baseline from the user-authorized local v4 implementation. Publication and deployment remain pending.

## Verified baseline — September 26

Read-only SSH verified clean user-deployed `5889b66`, v3.3 / strategy `1.1.3`, with the existing run/config and numerical rules unchanged. The [latest review](docs/reviews/2026-09-26-follow-up-trading-review.md) reconciles ten additional trades, net −A$0.5369. The current v3.3 run totals 25 / −A$1.2693; the 35 trades since September 6 total −A$0.7871 across mixed releases. The review interval continues from September 21 and spans 4 days 10 hours 10 minutes, not a second seven-day sample.

Completed checkpoints:

- **Excursion correction deployed and live verification complete:** all ten new closed trades have version 2 verified lifetime samples without legacy aggregates; 4,701 retained observations and six excluded post-close observations. The original local implementation passed 744 backend tests. The first-new-trade verification is complete; ongoing sampling coverage is still limited. [Implementation record](docs/reviews/2026-09-21-excursion-measurement-correction.md).
- **Entry rejection/reconsideration deployed:** v3.3 was verified September 21 at `5c250a7` and is retained at `5889b66`. Recognized local pricing declines can be reconsidered on a regular scan with the original price anchor; filled setups remain suppressed. Ten new broker fills match ten completed, single-submission intents. [Contract](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md).
- **Maintenance/quote-limit and quote-availability corrections deployed:** prior verification established `33e0b76` / v3.2 and `d46da61` / v3.1. Their numerical settings, active cooldown carryover and receipt/event distinctions remain part of the current baseline. [Maintenance record](docs/reviews/2026-09-10-maintenance-and-quote-boundaries.md), [quote record](docs/reviews/2026-09-08-quote-freshness-fix-plan.md).

## Authorized integrated release — local implementation

The user approved the [integrated specification and implementation](docs/reviews/2026-09-26-integrated-release-specification.md). Local **m15-intraday-v4 / strategy 1.2.0 / intraday-risk-v4** combines:

1. **Ordinary pullback structure:** contemporaneous EMA20 touch and EMA50 integrity, plus resumption beyond the latest touch's intervening structure with the existing two-bar minimum. Breakouts remain independent; numerical thresholds are unchanged.
2. **Protected-exit continuation and fade:** require a wholly post-exit touch of the signal EMA20 across both triggers. Missing freshness after normal TP permits one opposite-direction fade; after BE it waits. Persist the TP episode through retries/restart, prevent recursive fades, and revalidate after broker reconciliation. Preserve actual-direction risk checks and owner exits.
3. **Execution precision:** size, validate and persist exact serialized stop/bound prices; round adverse bounds inward so precision cannot widen existing limits. Reviewed actual fills stayed within budget; this is a correctness fix, not the cause of losses.
4. **Attribution:** retain revised/legacy trigger evidence, original/executed direction, freshness and parent episode; populate existing scalar RSI without fabricating warmup values.

The 1.5R target, +1R breakeven, original stops/deadlines, numerical risk limits and one-position capacity remain. Existing enabled intent, saved settings, active cooldown deadline and prior open-trade ownership must survive the new cohort.

Local validation passed: 834 tests across 41 backend suites; the changed analytics JSX also passed syntax validation and its results belong in the specification. The next delivery step remains user-managed Git publication followed by the existing single-command deployment. No publication, build, production restart or deployment has occurred in this implementation pass.

Research does not establish profitable expectancy: the structural candidate excludes five of 35 actual fills, including two winners, with +A$0.0315 combined net. Of 77 latest attempted setups, 59 have retained candles and change to 55 qualifying triggers; 18 GBP/USD setups cannot be evaluated. Four conditional fade paths give two targets/two stops, with no BUY-to-SELL example. Preserve these counterexamples in the next live review and distinguish whole-release results from uncertain component attribution.

## Continuing observation and outstanding operational work

- Track complete M15/H1 candles, confirmed current quote delivery, explicit actionable decisions, durable intents, broker protection, actual slippage and rejection reasons by pair/session. Event time and successful receipt time retain different meanings.
- Continue version 2 sample-coverage checks. Legacy aggregates cannot establish in-position extrema; verified polling samples do not supply exact tick paths.
- Review trigger mix, cadence, holding duration and repeated exposure after both protected exits and losses. Thirty closed trades can trigger an inspection, not establish an edge or authorize selecting winners. The current unchanged v3.3 run contains 25 trades at this review.
- Verify the new decision/episode evidence and scalar RSI on natural live signals after rollout. Local scalar RSI population is implemented; its prior absence never established that the entry RSI filter was skipped.
- S3 destination/reporting remains an unresolved operational choice; incomplete configuration was documented previously and S3 warnings persist. No new notifications or destinations are selected by this review.
- An independent recovery drill and delivery checks remain outstanding; neither was performed in the latest review. Preserve the existing recovery and single-command deployment workflow.

The [remediation register](docs/reviews/2026-09-06-remediation.md) retains finding → change → rationale → verification history. The user manages Git publication, builds and deployment; `./scripts/deploy.sh` performs its own tests, build, backup and health checks after publication. Develop and test locally, publish to GitHub, then deploy from GitHub. No direct production source edits or new manual deployment gates.

## Permanent constraints

- One live strategy and one active entry runtime; no simulated execution subsystem or strategy switching UI.
- Private internal-network personal tool with direct dashboard/API access; no operator login or account system.
- Existing trade emails remain; operational health belongs in dashboard/API without automatic warning/recovery emails.
- No manual test orders; preserve broker ownership, durable intents, historical cohorts and trade records.
- Risk per trade at or below 0.25%, sizing-capital ceiling A$100, and one open position. Funding or limit increases need a separate explicit user decision.
- Broker/account truth wins over cached state. Uncertain exposure blocks entries while reconciliation and management continue.
