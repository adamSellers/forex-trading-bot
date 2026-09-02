# Forex Trading Bot

This repository runs one automated strategy against one live OANDA account. It has no simulated execution mode, strategy selector, or alternate runtime.

## Live strategy

The only strategy is `intraday_momentum` version `1.0.0`. It evaluates completed M15 candles and trades only when all of these agree:

- the completed H1 close, 20/50 EMAs and ADX define a directional regime;
- M15 trend and RSI confirm that direction;
- a fresh eight-bar breakout or four-bar pullback resumption occurs;
- the pair is in a liquid, daylight-saving-aware Sydney, Tokyo, London or New York session;
- spread plus expected slippage is no more than 15% of the planned stop;
- the live account, portfolio, price-freshness and execution checks pass.

Every entry receives broker-side stop-loss and take-profit protection. The initial stop is the greater of 1.25 M15 ATR or six pips, the target is 1.5R, breakeven activates at 1R, and a six-hour time stop plus a narrow pre-rollover exit window keep positions intraday. Position size risks 0.25% of NAV, is capped to A$100 capital, and only one position may be open. Three consecutive losses pause entries for 24 hours; expiry begins a fresh streak without deleting trade history.

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

Production changes flow through Git and the repository scripts. Do not edit source directly on the Pi.

```bash
./scripts/deploy-check.sh
ssh adam@img.oakroad
cd /opt/forex-trading-bot
./scripts/update.sh
```

See [USER_GUIDE.md](USER_GUIDE.md) for the operator surface and [M15_INTRADAY_RELEASE_2026-08-10.md](M15_INTRADAY_RELEASE_2026-08-10.md) for the current design and live improvement loop.
