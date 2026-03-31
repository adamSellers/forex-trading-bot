# Forex Trading Bot

Monorepo for a live Oanda forex trading system with a React dashboard, backtesting lab, analytics, and Raspberry Pi deployment scripts.

The project is split into:

- `backend/`: Express API, Socket.IO server, SQLite persistence, trading engine, analytics, and backtest services
- `frontend/`: React 18 + Vite + Material UI dashboard
- `shared/`: shared trading defaults used by runtime and UI
- `scripts/`: deployment, backup, restore, health, and secret-management scripts

Live trading is disabled by default and is controlled through persisted config in `backend/data/trading_config.json`.

## Highlights

- Oanda v20 integration for live account, pricing, candles, and order execution
- SuperTrend + ADX momentum strategy with RSI, continuation-entry, and HTF filters
- Live trading engine with stop loss, trailing stop, breakeven, exposure limits, and reconciliation
- Strategy Lab and backtesting flow backed by historical data services and worker threads
- Real-time dashboard with Socket.IO updates for prices, signals, engine status, and trade events
- SQLite storage for trades, signals, entry decisions, and backtest results
- Optional email alerts and S3 analytics report uploads
- Raspberry Pi oriented PM2 deployment and maintenance scripts

## Stack

- Backend: Node.js 18+, Express, Socket.IO, Knex, better-sqlite3
- Frontend: React 18, Vite, Material UI, Recharts, `@mui/x-charts`
- Storage: SQLite
- Runtime: PM2
- Broker/API: Oanda REST v20

## Repository Layout

```text
.
├── backend/
│   ├── server.js
│   ├── config/
│   ├── data/
│   ├── migrations/
│   └── src/
│       ├── config/
│       ├── repositories/
│       ├── routes/
│       ├── services/
│       ├── socket/
│       ├── utils/
│       └── workers/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── config/
│   │   ├── theme/
│   │   └── utils/
│   └── vite.config.js
├── scripts/
├── shared/
│   └── tradingConfigDefaults.json
├── USER_GUIDE.md
├── PROJECT_HISTORY.md
└── ecosystem.config.js
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- An Oanda account and API credentials for live/practice connectivity

### Install

```bash
npm run install:all
```

### Configure local backend environment

Create `backend/.env`:

```bash
NODE_ENV=development
PORT=3101
OANDA_API_KEY=your-api-key
OANDA_ACCOUNT_ID=001-011-XXXXXXXX-001
OANDA_ENVIRONMENT=practice
```

Optional local variables used by the backend:

- `DB_PATH`: override SQLite database location
- `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_TO`: email notifications
- `ENABLE_S3_ANALYTICS`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`: S3 report uploads

### Run migrations

```bash
npm run db:migrate
```

### Start development

```bash
npm run dev
```

Services:

- Frontend: `http://localhost:3100`
- Backend health: `http://localhost:3101/api/health`

If Oanda credentials are missing, the backend still boots, but live market data, account, and trading features will be unavailable.

## Production and Raspberry Pi Deployment

This repo includes operator scripts for a Raspberry Pi deployment rooted at `/opt/forex-trading-bot`.

Common flows:

```bash
./scripts/first_time_setup.sh
./scripts/setup-secrets.sh
./scripts/deploy.sh
./scripts/update.sh
./scripts/status.sh
./scripts/backup.sh
./scripts/restore.sh
```

Important production files:

- `ecosystem.config.js`: PM2 app definition
- `scripts/start-wrapper.sh`: decrypts and injects secrets before boot
- `scripts/DEPLOYMENT_README.md`: operations reference

Encrypted secrets are stored under:

- `/opt/forex-trading-bot/.secrets/`
- `/opt/forex-trading-bot/.keys/encryption.key`

## Runtime Configuration

Defaults live in [shared/tradingConfigDefaults.json](/Users/adams/code/forex-trading-bot/shared/tradingConfigDefaults.json) and are normalized by [backend/src/config/tradingConfig.js](/Users/adams/code/forex-trading-bot/backend/src/config/tradingConfig.js). Runtime changes are persisted in `backend/data/trading_config.json`.

Current baseline defaults include:

```json
{
  "enableTrading": false,
  "assets": ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"],
  "strategy": "supertrend_momentum",
  "timeframe": "15m",
  "minAdx": 21,
  "enableHTFFilter": true,
  "htfTimeframe": "1h",
  "enableShorting": true,
  "riskPerTrade": 0.01,
  "maxOpenPositions": 2,
  "maxPortfolioExposure": 0.5,
  "leverage": 20,
  "maxSpreadPips": 1.2,
  "stopLossType": "ATR",
  "stopLossAtrMultiplier": 2,
  "minStopLossPips": 15,
  "enableTrailingStops": true,
  "enableBreakeven": true,
  "enableTakeProfit": false,
  "enableSessionFilter": true,
  "activeSessions": ["sydney", "tokyo", "london", "newyork"],
  "enableEmailAlerts": false,
  "enforceConfigFreeze": false
}
```

Notable behavior:

- Trading is gated by `enableTrading`, not by starting and stopping the Node process.
- Config changes are applied to the running data service and signal generator.
- `configHash` is computed from protected strategy/risk fields.
- `enforceConfigFreeze` can block changes to protected runtime parameters.

## Main API Surface

### Health and system

- `GET /api/health`
- `GET /api/system/health`
- `GET /api/system/info`

### Market data and portfolio

- `GET /api/account`
- `GET /api/prices`
- `GET /api/candles/:instrument`
- `GET /api/signals`
- `GET /api/portfolio`
- `GET /api/trades`
- `POST /api/trade/close/:id`

### Trading control and config

- `POST /api/trading/start`
- `POST /api/trading/stop`
- `POST /api/trading/reset`
- `GET /api/config`
- `POST /api/config`
- `POST /api/config/reset`

### Engine endpoints

- `GET /api/engine/status`
- `GET /api/engine/stats`
- `GET /api/engine/trades`
- `POST /api/engine/close/:tradeId`
- `POST /api/engine/sync`
- `POST /api/engine/reset-stats`

### Analytics and reporting

- `GET /api/analytics?period=30d`
- `GET /api/reports/status`
- `POST /api/reports/upload`
- `POST /api/reports/upload/daily`
- `POST /api/reports/upload/weekly`

### Backtesting

- `POST /api/backtest/run`
- `GET /api/backtest/results`
- `GET /api/backtest/results/:id`
- `DELETE /api/backtest/results/:id`

## Socket.IO Events

Server-to-client events currently emitted by the backend include:

- `connected`
- `priceUpdate`
- `signalUpdate`
- `tradeSignal`
- `tradeOpened`
- `tradeClosed`
- `tradeUpdate`
- `engineStatus`
- `configUpdate`

## Scripts

### Root scripts

```bash
npm run install:all
npm run install:backend
npm run install:frontend
npm run dev
npm run dev:backend
npm run dev:frontend
npm run build
npm run build:frontend
npm run db:migrate
```

### Backend scripts

```bash
cd backend
npm run dev
npm run start
npm run db:migrate
npm run db:rollback
npm test
npm run test:coverage
```

### Frontend scripts

```bash
cd frontend
npm run dev
npm run build
npm run preview
```

## Testing and Verification

- Backend tests live under `backend/src/**/__tests__` and `backend/src/repositories/__tests__`
- Frontend does not currently expose a dedicated test script
- The main verification commands are:

```bash
cd backend && npm test
cd frontend && npm run build
```

## Additional Documentation

- [USER_GUIDE.md](/Users/adams/code/forex-trading-bot/USER_GUIDE.md): trading concepts and configuration guidance
- [scripts/DEPLOYMENT_README.md](/Users/adams/code/forex-trading-bot/scripts/DEPLOYMENT_README.md): Raspberry Pi deployment and operations
- [PROJECT_HISTORY.md](/Users/adams/code/forex-trading-bot/PROJECT_HISTORY.md): project timeline and change history
- [project_roadmap.md](/Users/adams/code/forex-trading-bot/project_roadmap.md): roadmap notes

## Disclaimer

This codebase executes live forex trades against a broker account. Review the strategy, defaults, and environment configuration carefully before enabling trading. Use practice credentials first, and treat all live deployment changes as high-risk operations.
