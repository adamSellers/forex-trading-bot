# Forex Trading Bot

**October 26 local implementation complete:** [H4 peak profit protection 2.1.0](docs/reviews/2026-10-26-h4-peak-profit-release.md), release `h4-channel-v2`, adds a 0.5R trail behind the best observed executable price after +1R alongside the ten-bar channel. The tighter stop wins; existing owners retain their exits. Local validation passes 1,508 backend tests, 22 frontend tests, 24 health scenarios, 57 deployment/restore scenarios and the frontend build. Changes remain uncommitted, unpublished and **not deployed**.

**October 18 deployment verified:** [H4 Rolling Channel Trend 2.0.0](docs/reviews/2026-10-18-h4-channel-release.md) is deployed at clean `c09efb5`, verified healthy and flat at **17:38 AEDT**, with entries **paused** and readiness passing. All 1,468 target backend tests, build, backup and deployment health checks passed; local checks also cover 21 frontend tests, 23 health scenarios and 57 deployment/restore cases. All four pairs have completed H4 bid/ask data. Adam must use the existing Start Trading control to activate entries. Profitability and trade frequency remain unproven. Earlier pending-delivery statements below describe prior checkpoints.

**October 18 H4 replacement:** Adam authorized implementation, publication and standard deployment of [H4 Rolling Channel Trend 2.0.0](docs/reviews/2026-10-18-h4-channel-release.md), release `h4-channel-v1`. Completed H4 20-bar crossings enter with a 2 ATR(14) stop and a 10-bar bid/ask protective channel. One position per pair, overlapping pairs within existing risk limits, weekday overnight holding and Friday 16:45 New York closure. No fixed target, automatic breakeven or six-hour exit for new owners. Historical M15 owners retain their policies. Delivery is being validated; intentional paused entries will be preserved. Profitability and trade frequency are unproven. Earlier checkpoints below remain historical.

**October 7 BUY fix deployed:** [v6 BUY break/retest and consumed episodes](docs/reviews/2026-10-07-buy-retest-release.md), strategy **1.4.0**, is verified at clean **`562334b`**, healthy/enabled and flat. BUY entries require distinct completed break/retest/confirmation candles, a stop below broker bid structure and one fill per frozen breakout episode until observed cancellation and new formation. SELL-to-BUY fades are disabled; existing SELL behavior and cash-risk limits remain. All 1,316 backend tests passed locally and on the target, alongside 16 local frontend checks, builds and a matched backup. This is a prospective change, not demonstrated profitability.

**October 6 Node.js tooling deployed:** verified clean `9b3785b` after tests, build, matched backup and health checks, with enabled intent and strategy/risk/run/loss state preserved. the permanent project language policy requires no Python. Active research, analysis, deployment, backup and restore tools now use Node.js/shell; retired source remains in Git history and historical numerical evidence is preserved. Validation passes 1,229 backend tests, 57 deployment/restore cases, 21 health scenarios and the backup regressions. The [migration record](docs/reviews/2026-10-06-node-tooling.md) records contracts, limits and delivery. Earlier release and runtime observations below are dated checkpoints.

The [offline research tools](backend/research/README.md) cover persisted replay, cold recovery, lifecycle feedback and explicit price/delivery timing. Their dated [v5 validation record](docs/reviews/2026-10-06-replay-events-and-recovery.md) reports 1,198 passing backend tests and reproducible historical software screens. Active runtime fixtures now use the selected v6 contract; historical v5 source/evidence pins retain their original identity. Full historical performance evaluation and the remaining candidate comparisons are pending.

**October 6 measurement release deployed:** A1–A3 are verified at clean `810c7f9`; 1,037 backend tests passed locally and on the target, plus 16 local frontend/deployment-contract checks and production builds. Backup and post-release checks passed; enabled v5 strategy/risk/run/config and loss state were preserved. The [release record](docs/reviews/2026-10-06-analytics-measurement-release.md) specifies attribution, uncertainty and observed-expectancy contracts. The user explicitly authorizes local tests/builds, commits, GitHub publication and the existing deployment command for this work, superseding older user-managed delivery restrictions. Strategy 1.3.0 and live risk rules remain unchanged. The [plan](docs/reviews/2026-10-06-profitability-implementation-plan.md) authorizes isolated offline research; the product continues to have one live runtime.

**October 1 deployment verified:** [v5 SELL break/retest candidate](docs/reviews/2026-10-01-sell-retest-release.md) is live at clean **`73cf4b5` / strategy 1.3.0 / intraday-risk-v5**. SELL entries require distinct completed break, retest and rejection candles with ask-based structural stops. BUY entry rules and numerical risk limits remain unchanged; BUY-to-SELL fades are disabled. All 1,004 backend tests passed locally and in deployment; build, backup and live verification passed. Entries are enabled, all four pairs have ask-candle/pattern evidence, and the chart correction is deployed. The user explicitly authorized local commits, GitHub publication, builds and deployment. This supersedes older current-state and pending-release summaries below.

**September 30 deployment verified:** [v4.2 H1 loss-reset release](docs/reviews/2026-09-30-loss-reset-release.md) is live at `c6b6c77` / strategy 1.2.2. After an initial stop, the same pair/direction requires completed H1 nonqualification followed by later requalification. Breakeven does not arm this requirement. The deployment passed 906 backend tests, build, backup and health checks; enabled intent and the existing cooldown were preserved. Earlier pending-release statements below are historical checkpoints.

This repository runs one automated strategy against one live OANDA account. It has no simulated execution mode, strategy selector, or alternate runtime.

**Authorized September 30 release:** [v4.2 / strategy 1.2.2](docs/reviews/2026-09-30-loss-reset-release.md) adds an H1 reset after a normal initial stop: that pair/direction must stop qualifying on a completed hourly candle, then qualify again on a later hourly candle before another normal M15 entry. Breakeven does not arm this requirement. Validation/publication/deployment progress is recorded in the release record; existing targets, exits and numerical risk limits remain unchanged.

**September 30 observation:** user-deployed v4.1 / strategy 1.2.1 is verified at clean `6722838`; earlier pending-deployment statements below are historical. The [repeated USD/JPY review](docs/reviews/2026-09-30-repeated-usdjpy-review.md) verifies two full stops and one breakeven scratch in the new cohort and explains why ordinary stop-losses leave subsequent same-direction signals eligible. No new strategy rule was introduced by that review.

See the [September 26 follow-up trading review](docs/reviews/2026-09-26-follow-up-trading-review.md) for the next ten trades (−A$0.5369), broker verification and the updated target/re-entry evaluation. The [September 21 review](docs/reviews/2026-09-21-eight-day-trading-review.md), [September 6 production review](docs/reviews/2026-09-06-production-review.md) and [remediation register](docs/reviews/2026-09-06-remediation.md) retain earlier evidence and approved corrections.

Read-only inspection on September 26 verified the [excursion measurement correction](docs/reviews/2026-09-21-excursion-measurement-correction.md) deployed at `5889b66`; all ten new trades have verified version 2 samples. It removes post-close observations and separates unverified legacy data. The [target and re-entry study](docs/reviews/2026-09-21-target-and-reentry-evaluation.md) and its September 26 follow-up preserve the candidate rules and counterexamples reviewed before implementation.

Read-only inspection on September 28 verified the user-deployed [integrated v4 release](docs/reviews/2026-09-26-integrated-release-specification.md) at clean `aed750f`, strategy 1.2.0. It combines revised pullback/resumption, protected-exit freshness, a post-TP fade experiment, exact broker-price sizing and decision/RSI attribution; its original local validation passed 834 tests across 41 backend suites.

The user then requested removal of the global position-count cap. Local **v4.1 / strategy 1.2.1 / intraday-risk-v4.1** allows one position per pair while retaining all existing per-trade, portfolio, margin and loss limits. Local validation is complete: latest passing results cover 850 tests across 41 backend suites, plus changed JSX syntax checks. **Publication/build/deployment remain pending.** See the [pair capacity contract](docs/reviews/2026-09-28-pair-capacity-release.md) and [status register](docs/reviews/2026-09-26-status-and-decisions.md).

## Historical M15 strategy and release state

V5 retains the existing H1 regime, M15 trend/RSI, sessions, pricing, loss reset and protected-exit checks. BUY entries keep their eight-bar breakout or bar-aligned pullback/resumption. Normal SELL entries require a bearish break below the prior eight-bar low, a distinct later retest closing below that frozen level, then a later bearish close below the retest low. A close at/above the level cancels; another retouch updates the retest and cannot confirm on the same candle.

The SELL stop is above the maximum retest-episode ask high plus a price tick, with the existing six-pip minimum. The exact submitted stop stays fixed after the fill; units fit the existing cash-risk budget and actual fill determines the 1.5R target and +1R breakeven. BUY stops remain max(1.25 M15 ATR, six pips). Missing ask evidence prevents a new SELL until broker evidence recovers. BUY-to-SELL fades are disabled; SELL-to-BUY fades and existing exits remain.

Position size remains 0.25% of min(80% available margin, A$100), with one position per pair, 0.5%-of-NAV aggregate stop risk and existing margin checks. Three consecutive losses pause entries for 24 hours. Six-hour and New York rollover exits remain. Durable evidence and final broker reconciliation prevent stale, changed or already-filled patterns from opening another SELL. The [release contract](docs/reviews/2026-10-01-sell-retest-release.md) defines interaction with prior positions, retries and historical cohorts.

This is a live experimental candidate; its profitability is unproven. Correctness tests validate implementation, while versioned actual OANDA outcomes provide performance evidence. Trade cadence is observed, never forced to reach a quota.

## Current H4 strategy

The locally implemented candidate is `multi_day_trend` 2.1.0; deployed 2.0.0 owners retain channel-only exits. A completed H4 close must freshly cross the preceding 20-bar high or low. The 20 bars describe recent history; the bot does not wait 80 hours after a crossing. Initial protection is max(2 × H4 ATR(14), six pips), then ratchets using the latest 10 completed H4 bid lows for a BUY or ask highs for a SELL. Version 2.1.0 additionally activates a 0.5R trail behind the best observed executable bid/ask after +1R, where R remains the original filled-entry-to-stop distance. The tighter stop wins and never loosens. Positions may span weekdays and close from Friday 16:45 New York.

Position size remains 0.25% of min(80% available margin, A$100), one position per pair, 0.5%-of-NAV aggregate stop risk and existing margin/exposure controls. Three consecutive losses retain the 24-hour cooldown. Spread, expected slippage, price movement, broker reconciliation and receipt freshness checks remain. Daily financing affects overnight positions, including the usual Wednesday triple charge. Trade cadence is observed, never forced to a quota.

The [peak protection release record](docs/reviews/2026-10-26-h4-peak-profit-release.md) tracks local validation and pending delivery; the [original H4 release](docs/reviews/2026-10-18-h4-channel-release.md) retains its deployment evidence. This is an experimental candidate with unproven profitability.

## Runtime

- Backend: Node.js 20-22, Express, Socket.IO, SQLite/Knex
- Frontend: React, Vite, Material UI
- Broker: OANDA REST v20 live API
- Production: Raspberry Pi under PM2
- Account/reference currency: AUD

The engine reconciles its database with OANDA after restart, persists deterministic order intents before submission, recovers ambiguous submissions, quarantines unknown broker trades, and keeps protective-stop ownership with the live run that opened a position.

## Local verification

```bash
cd backend
npm test -- --runInBand
cd ../frontend
npm run build
```

The repository requires Node `>=20 <23`; native SQLite tests will not load under unsupported Node releases.

## Deployment

This is a private internal-network tool. Open the dashboard directly; there is no app login or operator token.

After publishing the reviewed changes to `main`, deploy from your local checkout:

```bash
./scripts/deploy.sh
```

The command handles SSH, pause and broker checks, tests, build, backup, migration, restart, health and restoration of the previous trading state through readiness. See [the short deployment guide](scripts/DEPLOYMENT_README.md). The user explicitly authorized publication/build/deployment for the October 1 v5 release.

See [USER_GUIDE.md](USER_GUIDE.md) for the operator surface and [M15_INTRADAY_RELEASE_2026-08-10.md](M15_INTRADAY_RELEASE_2026-08-10.md) for the original August design. The user guide and status register describe current behavior and decision points.
