# Live Strategy Roadmap

**October 6 first implementation release deployed:** the user authorized implementation and deployment of the [profitability plan](docs/reviews/2026-10-06-profitability-implementation-plan.md). A1–A3 are verified deployed at clean `810c7f9`; 1,037 backend tests, builds, backup and live checks passed. Validation and delivery are tracked in the [measurement release](docs/reviews/2026-10-06-analytics-measurement-release.md). R1 input/protocol tooling and the R2 offline orchestration spike are implemented. Full replay, candidate studies and the V1/L1 behaviour decision remain pending. Live strategy/risk identity remains v5 / 1.3.0.

**October 1 deployment verified:** [v5 SELL break/retest candidate](docs/reviews/2026-10-01-sell-retest-release.md) is live at clean **`73cf4b5` / strategy 1.3.0 / intraday-risk-v5**. SELL entries require distinct completed break, retest and rejection candles with ask-based structural stops. BUY entry rules and numerical risk limits remain unchanged; BUY-to-SELL fades are disabled. All 1,004 backend tests passed locally and in deployment; build, backup and live verification passed. Entries are enabled, all four pairs have ask-candle/pattern evidence, and the chart correction is deployed. The user explicitly authorized local commits, GitHub publication, builds and deployment. This supersedes older current-state and pending-release summaries below.

**Latest delivery — September 30:** [v4.2](docs/reviews/2026-09-30-loss-reset-release.md) is deployed at clean `c6b6c77` / strategy 1.2.2. Verification confirmed healthy enabled operation, flat/resolved broker state, durable reset observations on the first ordinary scan and unchanged cooldown expiry. The user-authorized deployment is complete; the implementation/pending statements below retain earlier checkpoints.

There is one production path and one active strategy. Planned work must improve real execution quality, risk control or the evidence obtained from actual live decisions. September 30 read-only inspection verified user-deployed v4.1 at clean revision `6722838`. The user then authorized implementation, GitHub publication and deployment of the [v4.2 H1 loss-reset requirement](docs/reviews/2026-09-30-loss-reset-release.md). The release record separates verification from actual delivery; earlier pending deployment notes below are historical checkpoints.

## September 30 loss-reset release

After a normal initial stop, require a completed H1 candle that no longer qualifies in the stopped direction, then a later completed H1 candle that qualifies again, before another normal same-pair/same-side entry. Use the existing complete directional predicate, with no new thresholds; neutral is enough and a full opposite trend is unnecessary. Breakeven exits do not arm this requirement. Persist broker-anchored proof across restart and revalidate before execution. Preserve normal position management, protected-exit freshness, fades, targets, numerical risk limits, saved enabled intent and active cooldown expiry.

Retained evaluated observations block repeat sell 3465 while retaining breakouts 3455 and 3475. This is a conditional policy check, not an alternative portfolio replay or evidence of improved profitability. The [broker-backed diagnostic](docs/reviews/2026-09-30-repeated-usdjpy-review.md) retains the two full losses and breakeven distinction.

## Verified baseline — September 28

Read-only inspection verified clean user-deployed `aed750f`, release v4 / strategy 1.2.0 / execution policy `intraday-risk-v4`. Dashboard/API and broker were healthy, entries enabled and the account flat; repeated readiness checks passed. S3 uploads remain unconfigured. This supersedes earlier pending-v4-deployment notes.

## September 26 performance checkpoint

Read-only SSH verified clean user-deployed `5889b66`, v3.3 / strategy `1.1.3`, with the existing run/config and numerical rules unchanged. The [latest review](docs/reviews/2026-09-26-follow-up-trading-review.md) reconciles ten additional trades, net −A$0.5369. The reviewed v3.3 run totals 25 / −A$1.2693; the 35 trades since September 6 total −A$0.7871 across mixed releases. The review interval continues from September 21 and spans 4 days 10 hours 10 minutes, not a second seven-day sample.

Completed checkpoints:

- **Excursion correction deployed and live verification complete:** all ten new closed trades have version 2 verified lifetime samples without legacy aggregates; 4,701 retained observations and six excluded post-close observations. The original local implementation passed 744 backend tests. The first-new-trade verification is complete; ongoing sampling coverage is still limited. [Implementation record](docs/reviews/2026-09-21-excursion-measurement-correction.md).
- **Entry rejection/reconsideration deployed:** v3.3 was verified September 21 at `5c250a7` and is retained at `5889b66`. Recognized local pricing declines can be reconsidered on a regular scan with the original price anchor; filled setups remain suppressed. Ten new broker fills match ten completed, single-submission intents. [Contract](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md).
- **Maintenance/quote-limit and quote-availability corrections deployed:** prior verification established `33e0b76` / v3.2 and `d46da61` / v3.1. Their numerical settings, active cooldown carryover and receipt/event distinctions remain part of the current baseline. [Maintenance record](docs/reviews/2026-09-10-maintenance-and-quote-boundaries.md), [quote record](docs/reviews/2026-09-08-quote-freshness-fix-plan.md).

## Integrated release — deployment verified September 28

The user approved and deployed the [integrated release](docs/reviews/2026-09-26-integrated-release-specification.md). **m15-intraday-v4 / strategy 1.2.0 / intraday-risk-v4** combines:

1. **Ordinary pullback structure:** contemporaneous EMA20 touch and EMA50 integrity, plus resumption beyond the latest touch's intervening structure with the existing two-bar minimum. Breakouts remain independent; numerical thresholds are unchanged.
2. **Protected-exit continuation and fade:** require a wholly post-exit touch of the signal EMA20 across both triggers. Missing freshness after normal TP permits one opposite-direction fade; after BE it waits. Persist the TP episode through retries/restart, prevent recursive fades, and revalidate after broker reconciliation. Preserve actual-direction risk checks and owner exits.
3. **Execution precision:** size, validate and persist exact serialized stop/bound prices; round adverse bounds inward so precision cannot widen existing limits. Reviewed actual fills stayed within budget; this is a correctness fix, not the cause of losses.
4. **Attribution:** retain revised/legacy trigger evidence, original/executed direction, freshness and parent episode; populate existing scalar RSI without fabricating warmup values.

V4 retained the 1.5R target, +1R breakeven, original stops/deadlines, numerical risk limits and one-position capacity; the separate September 28 decision below supersedes only the global count cap. Existing enabled intent, saved settings, active cooldown deadline and prior open-trade ownership must survive the new cohort.

The original v4 local validation passed 834 tests across 41 backend suites; changed analytics JSX also passed syntax validation. The user subsequently published and deployed v4, verified September 28. These results do not validate the new v4.1 capacity change.

Research does not establish profitable expectancy: the structural candidate excludes five of 35 actual fills, including two winners, with +A$0.0315 combined net. Of 77 latest attempted setups, 59 have retained candles and change to 55 qualifying triggers; 18 GBP/USD setups cannot be evaluated. Four conditional fade paths give two targets/two stops, with no BUY-to-SELL example. Preserve these counterexamples in the next live review and distinguish whole-release results from uncertain component attribution.

## Authorized September 28 capacity change — local v4.1

Remove the account-wide position-count cap so qualifying setups on different pairs may enter concurrently, keeping one position per pair. Retain all per-trade, portfolio, margin, loss, broker and strategy checks. The old cap was a carried-forward rollout constraint, not an empirically selected optimum. Do not replace it with another global count.

Local identity is **m15-intraday-v4.1 / strategy 1.2.1 / intraday-risk-v4.1**. Remove the retired active setting and readiness ceiling; expose the explicit per-instrument policy in API/UI; preserve v3–v4 saved settings/enabled intent apart from that field, historical snapshots, active cooldown expiry and owner exit policy. Local validation is complete: latest passing results cover 850 tests across 41 backend suites, plus changed JSX syntax checks. The [release record](docs/reviews/2026-09-28-pair-capacity-release.md) explains the full-run/targeted-rerun accounting and retains the unchanged 0.5%-of-NAV aggregate stop-risk limit. Publication/build/deployment remain user-managed.

## Continuing observation and outstanding operational work

- Track complete M15/H1 candles, confirmed current quote delivery, explicit actionable decisions, durable intents, broker protection, actual slippage and rejection reasons by pair/session. Event time and successful receipt time retain different meanings.
- Continue version 2 sample-coverage checks. Legacy aggregates cannot establish in-position extrema; verified polling samples do not supply exact tick paths.
- Review trigger mix, cadence, holding duration and repeated exposure after both protected exits and losses. Thirty closed trades can trigger an inspection, not establish an edge or authorize selecting winners. The reviewed v3.3 run contained 25 trades; keep its evidence separate from v4 and v4.1.
- Verify the new decision/episode evidence and scalar RSI on natural live signals in deployed v4 and after v4.1 rollout. Scalar RSI population is implemented; its prior absence never established that the entry RSI filter was skipped.
- S3 destination/reporting remains an unresolved operational choice; incomplete configuration was documented previously and S3 warnings persist. No new notifications or destinations are selected by this review.
- An independent recovery drill and delivery checks remain outstanding; neither was performed in the latest review. Preserve the existing recovery and single-command deployment workflow.

The [remediation register](docs/reviews/2026-09-06-remediation.md) retains finding → change → rationale → verification history. The user normally manages Git publication, builds and deployment; the specific September 30 v4.2 request authorizes the agent to complete these steps. `./scripts/deploy.sh` performs its own tests, build, backup and health checks after publication. Develop and test locally, publish to GitHub, then deploy from GitHub. No direct production source edits or new manual deployment gates.

## Permanent constraints

- One live strategy and one active entry runtime; no simulated execution subsystem or strategy switching UI.
- Private internal-network personal tool with direct dashboard/API access; no operator login or account system.
- Existing trade emails remain; operational health belongs in dashboard/API without automatic warning/recovery emails.
- No manual test orders; preserve broker ownership, durable intents, historical cohorts and trade records.
- Risk per trade at or below 0.25%, sizing-capital ceiling A$100 and existing portfolio/margin/loss limits. The September 28 user decision permits one position per pair with no global count cap. Further funding or risk-limit changes need an explicit user decision.
- Broker/account truth wins over cached state. Uncertain exposure blocks entries while reconciliation and management continue.
