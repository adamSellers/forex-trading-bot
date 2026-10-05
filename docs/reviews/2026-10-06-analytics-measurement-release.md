# October 6 analytics measurement release

The user requested implementation and deployment of the [profitability plan](2026-10-06-profitability-implementation-plan.md). This first release implements A1–A3: correct persisted entry attribution, distinguish observed results from inferential availability, and replace a misleading retrospective payoff forecast with observed expectancy. The instruction authorizes local tests, builds, commits, GitHub publication and the existing deployment command, superseding older user-managed delivery restrictions for this work.

## Contract and scope

**A1:** `SignalRepository` now exposes saved `entry_type` as `entryType`, matching the decision/trade contract. Raw columns and legacy unknown values remain intact. Full and dashboard reads reconcile two distinct actionable pullback events with two decisions, one fill and one `ALREADY_IN_POSITION` rejection. This is attribution repair, not a missed-order or duplicate-entry fix.

**A2:** `summary.expectancy95Aud` retains `lower`, `upper` and `samples`, adding `observations`, `status`, `reason` and `method`. Status is `EMPTY_SAMPLE`, `SINGLE_OBSERVATION`, `NO_OBSERVED_VARIATION` or `AVAILABLE`. The first three return null bounds and zero resamples. Observed P&L/means remain available. Net R retains its existing fields and adds corresponding `intervalStatus`, `intervalReason`, `intervalMethod`, `intervalSamples` and `missingRiskTrades`. Risk coverage uses original recorded risk only. Diverse samples retain the deterministic empirical percentile bootstrap; its method treats observations as independent and does not prove a durable edge. Wilson win-rate intervals retain their contract.

The dashboard explains unavailable intervals instead of presenting mechanically identical bootstrap bounds as certainty. It retains observed net expectancy, including the current one-trade loss. S3 JSON and API responses use the same calculation.

**A3:** Each performance cohort now includes `observedExpectancy.aud` and `.pips`. Each specifies its basis, observations, missing observations, positive/negative/flat counts and probabilities, direct arithmetic mean, and signed conditional win/loss means. AUD uses realized net results including recorded costs. Pips use finite recorded executable-price results and their own signs; missing pips are excluded and counted, not made into flats. Flats contribute zero to the mean, not a loss. Spread is not deducted again from realized AUD.

The old retrospective `expectedEdge` key is retained as null with `expectedEdgeDeprecated: true`. Consumers should use the explicitly labelled observations. Cohort `avgWinPips` and positive-magnitude `avgLossPips` now divide their pip-sign numerators by pip-sign counts; the prior AUD-sign denominators were wrong when costs changed the outcome sign. Legacy top-level summary averages and direct mean fields retain their existing semantics. The prospective payoff helper is unchanged. Consumer tracing found no execution or UI reader of the deprecated cohort forecast; the dashboard's bootstrap reader was updated.

The strategy remains **1.3.0 / m15-intraday-v5 / intraday-risk-v5 / broker-liquidity-v3.1**. This measurement release does not create a new trading cohort. Entry rules, exits, quotes, units, risk limits, saved enabled intent, loss streak/cooldown and broker ownership retain their established contracts. No manual orders are part of validation.

## Validation

Targeted backend verification passed 100 analytics/statistics/report/prospective-helper tests and 34 persisted repository/integration tests. The persisted tests use migrated isolated SQLite, actual repositories and analytics, the real route/Express JSON serializer, and the actual scheduled/manual S3 report serializer. Only network transport is substituted; local TCP binding is unavailable in the sandbox. They cover current/run/all-live scopes, full/dashboard profiles, legacy unknowns, normal/fade/retest attribution and run/config boundaries.

Full local validation passed on Node 22.16.0: **1,037 tests across 50 backend suites**, including the research spike; **16 frontend/deployment-contract tests**; and the Vite production build. An initial sandboxed run could not bind TCP in ten existing API tests; the complete rerun with local binding permitted passed. The reduced [validation artifact](evidence/2026-10-06/local-validation.json) pins changed source hashes and totals.

## Delivery

Read-only preflight on October 6 verified clean deployed `73cf4b5`, healthy enabled v5, A$95.2621 balance, zero open/pending trades, resolved ownership/intents and unchanged one-loss state. This is a dated observation, not an assumption that exposure remains flat.

**Deployed and verified at 10:34:10 AEDT on October 6:** clean revision **`810c7f91b02ea1b8d5298ed2fedabdefcd3e5c6c`**, published from the local checkout to GitHub and deployed with `./scripts/deploy.sh` (exit 0). The target passed all 1,037 backend tests across 50 suites and the production frontend build. Backup `20261006_102749` verified its source archive and SQLite snapshot before cutover. The deployment restored the prior enabled intent.

The reduced [deployment verification](evidence/2026-10-06/deployment-verification.json) records successful health, revision, frontend and API checks. The account remained flat/resolved at A$95.2621, with no pending/uncertain intents or quarantines. Strategy 1.3.0, health configuration, run `live_8f6557a3-2661-4643-acd0-e524414f2173`, config `07ea89df6b94cef9e5cc`, and the original one-loss/no-active-cooldown state were preserved.

Live full analytics now show one `USD_JPY|BUY|M15_PULLBACK_RESUMPTION` cohort: two actionable events, two decisions, one fill and one rejection (50% observed execution), instead of separate intent/entry-type buckets. Actual −A$0.1787 and mean −1.0023R remain intact; AUD/net-R bootstrap bounds are null with `SINGLE_OBSERVATION`, and missing risk count is zero. Both full/compact responses expose the new observed expectancy contract. Compact responses intentionally omit full execution diagnostics. The served frontend assets contain the corrected unavailable-interval message. Verification used read-only bot APIs; no manual test orders or direct production source edits occurred.

A documentation-only follow-up publishes this final verification and updates the project status; the deployed runtime remains the tested `810c7f9` revision.

## Remaining research

The [R1 input/protocol tooling and R2 orchestration spike](../../backend/research/README.md) are implemented offline. Six Python tests and three orchestration scenarios pass; the fixture covers causal SELL break/retest/confirmation, restart and missing-ask recovery, deterministic reduced ledgers, sizing/protection and timed management, with zero network attempts. A reproducible audit records 1,147,442 M15 bars across seven pairs with no observed structural input problems. Completion provenance and unobserved intervals remain explicitly limited. All previously inspected historical evaluation periods retain their development/retrospective classification.

The [research validation](evidence/2026-10-06/research/validation.json) distinguishes this foundation from pending work: verified H1/conversion reconstruction, real SQLite replay, BUY/concurrent portfolio and dynamic account state, loss/reentry/cooldown feedback, fine-price/cost uncertainty, frozen v5 baseline and candidate comparisons. The spike controls `Date.now()` for its covered paths; complete calendar-clock and monotonic request-delay/budget checks remain pending. No future evaluation protocol or candidate has been selected. This release fixes evidence quality; it does not establish profitable trading or select new live strategy rules.
