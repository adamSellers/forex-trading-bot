# Forex Trading Bot

One automated strategy trades one live OANDA AUD account. The backend reconciles broker state with SQLite, persists order intents before submission, recovers uncertain outcomes, quarantines unknown positions and retains the exit policy of the run that opened each trade. The React dashboard provides entry controls, position monitoring, analytics and operational health on the private internal network.

The [Option C implementation record](docs/reviews/2026-11-09-option-c-operator.md) separates current local work, the published release and the last saved production observation. Consult it for delivery state; the description below concerns the current source and does not assert today's production revision or enabled state.

The backend operator module owns entry readiness, enable/pause/reconcile commands and a composed dashboard view. Its observations retain independent availability and successful-read timestamps, so a failed source can keep its last good value without appearing current. One client module handles subscriptions, reconnects and display ordering; React reads that shared state. Command outcomes remain separate from display-refresh failures. See the [operator interface and verification record](docs/reviews/2026-11-09-option-c-operator.md) for these contracts and the [earlier engineering corrections](docs/reviews/2026-11-09-engineering-review.md) for the recovery/lifecycle foundation.

## H4 strategy

Current source defines `multi_day_trend` 2.1.0 / `h4-channel-v2`. A completed H4 close must freshly cross the preceding 20-bar high or low. Initial protection is max(2 × ATR(14), six pips); a channel then ratchets using the latest ten completed H4 bid lows for BUY or ask highs for SELL. Version 2.1.0 also activates a 0.5R trail behind the best observed executable price after +1R. R remains the original actual filled-entry-to-stop distance. The tighter stop wins and never loosens.

Positions may span weekdays and close from Friday 16:45 New York. There is no fixed profit target, automatic breakeven or six-hour exit for H4 owners. Financing, gaps and execution costs affect actual results. This is an experimental candidate with unproven profitability and trade frequency.

Sizing retains 0.25% of min(80% available margin, A$100), one position per pair, a 0.5%-of-NAV aggregate stop-risk ceiling and the existing margin, exposure, quote and loss controls. Three consecutive losses retain the 24-hour entry cooldown. Entry pauses leave existing positions managed. Historical H4-v1 owners retain channel-only exits, and historical M15 owners retain their recorded policies.

Read the [H4-v1 release contract](docs/reviews/2026-10-18-h4-channel-release.md) and [H4-v2 peak protection contract](docs/reviews/2026-10-26-h4-peak-profit-release.md) for exact rules, compatibility, validation and dated delivery evidence. [USER_GUIDE.md](USER_GUIDE.md) explains the operator controls and measurements.

## Runtime and local verification

- Backend: Node.js 20–22, Express, Socket.IO, SQLite/Knex
- Frontend: React, Vite, Material UI
- Broker: OANDA REST v20 live API
- Production: Raspberry Pi under PM2
- Project tooling: Node.js and shell; no Python

Use the version pinned by `.nvmrc`; native SQLite must match Node's ABI. Local isolated checks include:

```bash
cd backend
npm test -- --runInBand
cd ..
node --test frontend/src/components/__tests__/*.test.cjs frontend/src/operator/__tests__/*.test.cjs
cd frontend
npm run build
```

The [research tools](backend/research/README.md) run offline orchestration/replay with isolated market, broker and storage adapters. They are separate from the single live product runtime, and passing research software checks does not establish trading profitability.

## Deployment and recovery

The dashboard opens directly on the private internal network, without an app login or operator token. Broker credentials stay server-side.

After authorized local publication of the reviewed release to GitHub `main`, the single deployment command is:

```bash
./scripts/deploy.sh
```

The command handles SSH, pause and broker checks, preparation, tests, build, backup, migration, restart, health and restoration of the prior trading intent through readiness. Develop and publish source locally; production consumes published revisions. See the [deployment guide](scripts/DEPLOYMENT_README.md) and [maintenance/recovery reference](docs/operations/recovery-and-access.md).

## Historical evidence

Dated release records and [PROJECT_HISTORY.md](PROJECT_HISTORY.md) preserve prior M15 strategies, research findings and observed deployments. The [pre-cleanup top-level snapshots](docs/archive/2026-11-09-top-level-checkpoints.md) retain the earlier README and instruction checkpoints byte-for-byte; their historical state and authorization statements remain dated.
