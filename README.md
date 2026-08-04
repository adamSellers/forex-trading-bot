# Forex Trading Bot

This repository runs one automated strategy against one live OANDA account. It has no simulated execution mode, strategy selector, or alternate runtime.

## Live strategy

The only strategy is `carry_trend` version `1.0.0` on completed H4 and daily candles. It trades a fresh 20-day price breakout only when all of these agree:

- the completed daily close and 50/200-day EMAs define the same trend;
- 60-day momentum is at least 1% in magnitude;
- OANDA's current instrument financing makes the breakout direction materially better than the opposite direction;
- the live spread, account, portfolio and price-freshness checks pass.

Every entry receives a broker-side protective stop at the greater of 2.5 daily ATR or 20 pips. Position size risks 0.5% of NAV, is capped to A$100 capital, and only one position may be open. There is no fixed take-profit or time stop; trend invalidation, breakeven and monotonic trailing-stop logic manage exits.

This is an unproven trading hypothesis being tested with real money. Positive returns are not guaranteed. The intended cadence is low: roughly zero to a few entries per month across the seven configured major pairs, depending on whether fresh breakouts and financing alignment occur together.

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
npm run lint
npm run build
```

The repository requires Node `>=20 <23`; native SQLite tests will not load under unsupported Node releases.

## Deployment

Production changes flow through Git and the repository scripts. Do not edit source directly on the Pi.

```bash
./scripts/deploy-check.sh
ssh adam@img.oakroad
cd /opt/forex-trading-bot
./scripts/update.sh
```

See [USER_GUIDE.md](USER_GUIDE.md) for the operator surface and [LIVE_ONLY_REBUILD_2026-08-04.md](LIVE_ONLY_REBUILD_2026-08-04.md) for the design and live improvement loop.
