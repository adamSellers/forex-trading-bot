# Forex Trading Bot

**October 1 deployment verified:** [v5 SELL break/retest candidate](docs/reviews/2026-10-01-sell-retest-release.md) is live at clean **`73cf4b5` / strategy 1.3.0 / intraday-risk-v5**. SELL entries require distinct completed break, retest and rejection candles with ask-based structural stops. BUY entry rules and numerical risk limits remain unchanged; BUY-to-SELL fades are disabled. All 1,004 backend tests passed locally and in deployment; build, backup and live verification passed. Entries are enabled, all four pairs have ask-candle/pattern evidence, and the chart correction is deployed. The user explicitly authorized local commits, GitHub publication, builds and deployment. This supersedes older current-state and pending-release summaries below.

**September 30 deployment verified:** [v4.2 H1 loss-reset release](docs/reviews/2026-09-30-loss-reset-release.md) is live at `c6b6c77` / strategy 1.2.2. After an initial stop, the same pair/direction requires completed H1 nonqualification followed by later requalification. Breakeven does not arm this requirement. The deployment passed 906 backend tests, build, backup and health checks; enabled intent and the existing cooldown were preserved. Earlier pending-release statements below are historical checkpoints.

This repository runs one automated strategy against one live OANDA account. It has no simulated execution mode, strategy selector, or alternate runtime.

**Authorized September 30 release:** [v4.2 / strategy 1.2.2](docs/reviews/2026-09-30-loss-reset-release.md) adds an H1 reset after a normal initial stop: that pair/direction must stop qualifying on a completed hourly candle, then qualify again on a later hourly candle before another normal M15 entry. Breakeven does not arm this requirement. Validation/publication/deployment progress is recorded in the release record; existing targets, exits and numerical risk limits remain unchanged.

**September 30 observation:** user-deployed v4.1 / strategy 1.2.1 is verified at clean `6722838`; earlier pending-deployment statements below are historical. The [repeated USD/JPY review](docs/reviews/2026-09-30-repeated-usdjpy-review.md) verifies two full stops and one breakeven scratch in the new cohort and explains why ordinary stop-losses leave subsequent same-direction signals eligible. No new strategy rule was introduced by that review.

See the [September 26 follow-up trading review](docs/reviews/2026-09-26-follow-up-trading-review.md) for the next ten trades (−A$0.5369), broker verification and the updated target/re-entry evaluation. The [September 21 review](docs/reviews/2026-09-21-eight-day-trading-review.md), [September 6 production review](docs/reviews/2026-09-06-production-review.md) and [remediation register](docs/reviews/2026-09-06-remediation.md) retain earlier evidence and approved corrections.

Read-only inspection on September 26 verified the [excursion measurement correction](docs/reviews/2026-09-21-excursion-measurement-correction.md) deployed at `5889b66`; all ten new trades have verified version 2 samples. It removes post-close observations and separates unverified legacy data. The [target and re-entry study](docs/reviews/2026-09-21-target-and-reentry-evaluation.md) and its September 26 follow-up preserve the candidate rules and counterexamples reviewed before implementation.

Read-only inspection on September 28 verified the user-deployed [integrated v4 release](docs/reviews/2026-09-26-integrated-release-specification.md) at clean `aed750f`, strategy 1.2.0. It combines revised pullback/resumption, protected-exit freshness, a post-TP fade experiment, exact broker-price sizing and decision/RSI attribution; its original local validation passed 834 tests across 41 backend suites.

The user then requested removal of the global position-count cap. Local **v4.1 / strategy 1.2.1 / intraday-risk-v4.1** allows one position per pair while retaining all existing per-trade, portfolio, margin and loss limits. Local validation is complete: latest passing results cover 850 tests across 41 backend suites, plus changed JSX syntax checks. **Publication/build/deployment remain pending.** See the [pair capacity contract](docs/reviews/2026-09-28-pair-capacity-release.md) and [status register](docs/reviews/2026-09-26-status-and-decisions.md).

## Strategy and release state

V5 retains the existing H1 regime, M15 trend/RSI, sessions, pricing, loss reset and protected-exit checks. BUY entries keep their eight-bar breakout or bar-aligned pullback/resumption. Normal SELL entries require a bearish break below the prior eight-bar low, a distinct later retest closing below that frozen level, then a later bearish close below the retest low. A close at/above the level cancels; another retouch updates the retest and cannot confirm on the same candle.

The SELL stop is above the maximum retest-episode ask high plus a price tick, with the existing six-pip minimum. The exact submitted stop stays fixed after the fill; units fit the existing cash-risk budget and actual fill determines the 1.5R target and +1R breakeven. BUY stops remain max(1.25 M15 ATR, six pips). Missing ask evidence prevents a new SELL until broker evidence recovers. BUY-to-SELL fades are disabled; SELL-to-BUY fades and existing exits remain.

Position size remains 0.25% of min(80% available margin, A$100), with one position per pair, 0.5%-of-NAV aggregate stop risk and existing margin checks. Three consecutive losses pause entries for 24 hours. Six-hour and New York rollover exits remain. Durable evidence and final broker reconciliation prevent stale, changed or already-filled patterns from opening another SELL. The [release contract](docs/reviews/2026-10-01-sell-retest-release.md) defines interaction with prior positions, retries and historical cohorts.

This is a live experimental candidate; its profitability is unproven. Correctness tests validate implementation, while versioned actual OANDA outcomes provide performance evidence. Trade cadence is observed, never forced to reach a quota.

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
