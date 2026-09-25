# Forex Trading Bot

This repository runs one automated strategy against one live OANDA account. It has no simulated execution mode, strategy selector, or alternate runtime.

See the [September 26 follow-up trading review](docs/reviews/2026-09-26-follow-up-trading-review.md) for the next ten trades (−A$0.5369), broker verification and the updated target/re-entry evaluation. The [September 21 review](docs/reviews/2026-09-21-eight-day-trading-review.md), [September 6 production review](docs/reviews/2026-09-06-production-review.md) and [remediation register](docs/reviews/2026-09-06-remediation.md) retain earlier evidence and approved corrections.

Read-only inspection on September 26 verified the [excursion measurement correction](docs/reviews/2026-09-21-excursion-measurement-correction.md) deployed at `5889b66`; all ten new trades have verified version 2 samples. It removes post-close observations and separates unverified legacy data. The [target and re-entry study](docs/reviews/2026-09-21-target-and-reentry-evaluation.md) and its September 26 follow-up preserve the candidate rules and counterexamples reviewed before implementation.

The user-authorized [integrated v4 release](docs/reviews/2026-09-26-integrated-release-specification.md) is implemented locally, with 834 tests across 41 backend suites passing. It combines revised pullback/resumption, protected-exit freshness, an explicit post-TP fade experiment, exact broker-price sizing and decision/RSI attribution. **It has not been published or deployed.** The [status register](docs/reviews/2026-09-26-status-and-decisions.md) separates local v4 / strategy 1.2.0 from the last verified production v3.3 / 1.1.3, whose 25 reviewed trades total −A$1.2693.

## Strategy and release state

Read-only inspection on September 26 verified user-deployed revision `5889b66` / `m15-intraday-v3.3` / strategy `1.1.3`, including the approved [entry-rejection and reconsideration correction](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md). Recognized local pricing declines can be reconsidered on a later regular scan while preserving the original decision-price bound; expected rejections are counted separately from unexpected errors. The following normal-signal prerequisites are retained in local v4. They qualify the original trend signal; the post-TP branch described below may execute the opposite direction:

- the completed H1 close, 20/50 EMAs and ADX define a directional regime;
- M15 trend and RSI confirm that direction;
- an eight-bar breakout or four-bar pullback resumption occurs; local v4 measures each pullback candle against its own EMAs and requires clearance from the latest touch;
- the pair is in a liquid, daylight-saving-aware Sydney, Tokyo, London or New York session;
- spread plus expected slippage is no more than 15% of the planned stop;
- the live account, portfolio, price-freshness and execution checks pass.

Local v4 requires a fully post-exit EMA20 touch before repeating direction after TP or breakeven, across both triggers. An otherwise-valid same-direction signal after a normal TP without that touch may take one opposite-direction fade. After breakeven it waits. A fade cannot arm another fade, and normal signals do not close an open fade. Original direction, executed direction and episode evidence are persisted. See the [exact specification](docs/reviews/2026-09-26-integrated-release-specification.md) for anchor and retry semantics.

Every entry requests broker-side stop-loss and take-profit protection; the engine verifies it and attempts an emergency close when required protection cannot be confirmed. The initial stop is the greater of 1.25 M15 ATR or six pips, the target is 1.5R, breakeven activates at 1R, and a six-hour time stop plus a narrow pre-rollover exit window keep positions intraday. Position size uses 0.25% of the smaller of 80% of available margin and A$100, and only one position may be open. Three consecutive losses pause entries for 24 hours; expiry begins a fresh streak without deleting trade history.

This is an experimental live strategy. The structural candidate excludes five historical fills including two winners, net +A$0.0315; the four conditional fade examples produce two targets and two stops. Neither establishes positive expectancy. Exact serialized-price sizing fixes a demonstrated precision mismatch without raising risk. The target remains 1.5R for normal and fade entries. The design target is approximately 5–15 trades per week across four liquid major pairs, but observed live cadence—not a forced quota—is the source of truth.

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

The command handles SSH, pause and broker checks, tests, build, backup, migration, restart, health and restoration of the previous trading state through readiness. See [the short deployment guide](scripts/DEPLOYMENT_README.md). Builds and deployment remain user-managed.

See [USER_GUIDE.md](USER_GUIDE.md) for the operator surface and [M15_INTRADAY_RELEASE_2026-08-10.md](M15_INTRADAY_RELEASE_2026-08-10.md) for the original August design. The user guide and status register describe current behavior and decision points.
