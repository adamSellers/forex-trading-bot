<<<<<<< HEAD
# Forex Trend-Following Trading Bot

A professional Forex trading bot built for deployment on a Raspberry Pi. It now runs a shared strategy runtime with hot-swappable live selection, an always-on shadow paper baseline, concurrent candidate paper runs, unified analytics, and broker-backed live execution via Oanda's REST v20 API.

![Status](https://img.shields.io/badge/Phase%205-Complete-success) ![Status](https://img.shields.io/badge/Phase%206-Next-blue) ![Node](https://img.shields.io/badge/Node-18%2B-green) ![License](https://img.shields.io/badge/License-MIT-blue)

---

## 🎯 Features

### Trading Engine

-   **LiveTradingEngine**: Fully automated trade execution based on signals
-   **Shared Runtime**: Unified run orchestration for `live`, `paper_shadow`, and `paper_candidate`
-   **Hot-Swappable Live Selection**: Live strategy changes affect new entries only
-   **Owner-Safe Exit Management**: Open trades stay attached to the `ownerRunId` that opened them
-   **Delayed HTF Confirmation**: Lower-timeframe flips can wait for higher-timeframe alignment instead of being discarded immediately
-   **Multiple Pairs**: AUD/USD, EUR/USD, GBP/USD, USD/JPY
-   **Oanda Integration**: Live trading via REST v20 API (ASIC regulated)

### Risk Management

-   **ATR-Based Stop Loss**: Dynamic stops that adapt to market volatility
-   **Trailing Stops**: Lock in profits as price moves in your favor
-   **Breakeven + Reconciliation Persistence**: Stop-state and broker-close metadata survive persistence and restart recovery
-   **Margin-Based Take Profit**: Automatic profit target (default 6% of used margin) with quote-to-account currency conversion
-   **Risk-Based Position Sizing**: Consistent risk per trade (default 2%)
-   **Leverage Limits**: Enforces ASIC 30:1 max (configurable, default 10:1)
-   **Max Position Limits**: Cap on concurrent open trades
-   **Negative Balance Protection**: ASIC-mandated retail client protection

### Notifications & Reporting

-   **Email Alerts**: Trade open/close notifications via Gmail
-   **S3 Analytics Reports**: Automated daily/weekly uploads to AWS S3
-   **Automated Backups**: Daily database backups via cron

### Dashboard

-   **Real-time Prices**: WebSocket-based live price updates every 5 seconds
-   **Signal Monitoring**: Runtime-backed signal inspection across live, shadow, and candidate runs
-   **Portfolio Tracking**: Live positions, P/L, margin usage
-   **Performance Analytics**: Win rate, profit factor, Sharpe ratio, equity curves, and runtime filters
-   **Expectation vs Actual Analytics**: Unique actionable signals separated from cooldown duplicates for cleaner review
-   **Paper Comparison**: Compare the active shadow baseline against concurrent candidate runs from the unified runtime model
-   **System Health**: Service status, API latency, memory monitoring
-   **Trading Sessions**: Visual session indicators with best trading windows

### Architecture

-   **Backend**: Node.js + Express + Socket.IO
-   **Frontend**: React 18 + Material UI + Recharts
-   **Database**: SQLite via Knex.js
-   **Deployment**: PM2 process management
-   **Shared Config Contract**: Canonical trading defaults shared across the live runtime, paper runtime, and frontend config surfaces

---

## 📊 Current Status

### Shared Runtime Program ✅ PHASES 1-5 COMPLETE IN CODE

-   [x] Canonical five-strategy catalog with unified `strategy_runs`
-   [x] Shared runtime coordinator for live, shadow paper, and candidate paper runs
-   [x] Hot-swappable live strategy selection with `ownerRunId` continuity for open trades
-   [x] Default shadow paper baseline paired to the active live run
-   [x] Concurrent candidate paper runs with unified run detail APIs
-   [x] Runtime-backed `Paper` and `Analytics` views with `mode` / `strategy` / `runId` filters
-   [x] Legacy lab routes, workers, offline backtest engine, and `backtest_results` store retired from the supported stack
-   [ ] Phase 6 rollout, manual QA, and production monitoring

### Current Live Baseline

-   Deployment baseline: `2026-03-20`
-   Active cohort: `AUD_USD`, `EUR_USD`, `GBP_USD`, `USD_JPY`
-   HTF filter: enabled on `1h`
-   Shorting: enabled
-   Review cadence: compare live results against expectation-vs-actual exports after 2 weeks of trading

### Runtime-Only Comparison Workflow

-   Use the `Dashboard` view to inspect the active live strategy and perform live-ready hot swaps
-   Use the `Paper` view to compare the paired shadow run against candidate paper runs
-   Use the `Analytics` view with `mode`, `strategy`, `runId`, and `selectionId` filters for unified reporting
-   Legacy `/api/backtest` endpoints and offline backtest CLI workflows are no longer part of the supported operator path

---

## 🏗️ Architecture

### Directory Structure

```
/opt/forex-trading-bot/
+-- backend/
|   +-- server.js                     # Express + Socket.IO entry
|   +-- package.json
|   +-- .env                          # OANDA_API_KEY, PORT=3101
|   +-- data/
|   |   +-- trading.db                # SQLite database
|   |   +-- trading_config.json       # Persisted config
|   +-- src/
|       +-- routes/
|       |   +-- tradingRoutes.js      # All API endpoints
|       +-- services/
|       |   +-- configService.js      # Config + persistence
|       |   +-- OandaDataService.js   # Price/candle fetching
|       |   +-- Oandaclient.js        # Oanda API wrapper
|       |   +-- signalGenerator.js    # SuperTrend + ADX signals
|       |   +-- analyticsService.js   # Performance metrics
|       |   +-- LiveTradingEngine.js  # Trade execution engine
|       +-- repositories/
|       |   +-- tradeRepository.js    # Trade CRUD
|       |   +-- signalRepository.js   # Signal history
|       |   +-- portfolioRepository.js
|       +-- utils/
|           +-- logger.js             # Logging utility
|
+-- frontend/
|   +-- package.json
|   +-- vite.config.js                # Port 3100, proxy to 3101
|   +-- src/
|       +-- App.jsx                   # Navigation + view routing
|       +-- config/
|       |   +-- api.js                # API client
|       +-- components/
|           +-- TradingDashboard.jsx  # Main view
|           +-- AnalyticsDashboard.jsx
|           +-- SystemHealth.jsx
|           +-- TradingConfig.jsx
|           +-- dashboard/            # Dashboard widgets
|           +-- config/               # Config tab components
|
+-- ecosystem.config.js               # PM2 configuration
+-- package.json                      # Root monorepo scripts
=======
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
>>>>>>> 8371a92844cf5d89b2d94d5dcc9671454e9fd3d1
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
