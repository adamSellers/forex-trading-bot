# Forex Trading Bot

This repository runs one automated strategy against one live OANDA account. It has no simulated execution mode, strategy selector, or alternate runtime.

See the [September 21 eight-day trading review](docs/reviews/2026-09-21-eight-day-trading-review.md) for current performance and observed re-entry behaviour, and the [September 6 production review](docs/reviews/2026-09-06-production-review.md) and [remediation register](docs/reviews/2026-09-06-remediation.md) for the earlier audit and approved corrections.

The [excursion measurement correction](docs/reviews/2026-09-21-excursion-measurement-correction.md) is complete locally, with 744 backend tests passing, and awaits user publication/deployment. It removes post-close observations from new measurements and separates unverified legacy data. The [target and re-entry study](docs/reviews/2026-09-21-target-and-reentry-evaluation.md) records candidate rules and counterexamples; trading settings remain unchanged.

## Live strategy

Read-only inspection on September 21 verified user-deployed revision `5c250a7` / `m15-intraday-v3.3` / strategy `1.1.3`, including the approved [entry-rejection and reconsideration correction](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md). Recognized local pricing declines can be reconsidered on a later regular scan while preserving the original decision-price bound; expected rejections are counted separately from unexpected errors. Existing numerical strategy, risk and exit settings are preserved. The strategy evaluates completed M15 candles and trades only when all of these agree:

- the completed H1 close, 20/50 EMAs and ADX define a directional regime;
- M15 trend and RSI confirm that direction;
- a fresh eight-bar breakout or four-bar pullback resumption occurs;
- the pair is in a liquid, daylight-saving-aware Sydney, Tokyo, London or New York session;
- spread plus expected slippage is no more than 15% of the planned stop;
- the live account, portfolio, price-freshness and execution checks pass.

Every entry requests broker-side stop-loss and take-profit protection; the engine verifies it and attempts an emergency close when required protection cannot be confirmed. The initial stop is the greater of 1.25 M15 ATR or six pips, the target is 1.5R, breakeven activates at 1R, and a six-hour time stop plus a narrow pre-rollover exit window keep positions intraday. Position size uses 0.25% of the smaller of 80% of available margin and A$100, and only one position may be open. Three consecutive losses pause entries for 24 hours; expiry begins a fresh streak without deleting trade history.

This is an unproven trading hypothesis being tested with real money. Positive returns are not guaranteed. The design target is approximately 5–15 trades per week across four liquid major pairs, but observed live cadence—not a forced quota—is the source of truth.

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

See [USER_GUIDE.md](USER_GUIDE.md) for the operator surface and [M15_INTRADAY_RELEASE_2026-08-10.md](M15_INTRADAY_RELEASE_2026-08-10.md) for the current design and live improvement loop.
