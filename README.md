# Forex Trading Bot

Forex trading platform built around a shared runtime that drives:

- one active live strategy run
- one paired shadow paper run
- any number of candidate paper runs
- unified analytics across live and paper telemetry
- broker-backed execution through Oanda REST v20

The project is split into a Node/Express backend, a React/Vite frontend, shared trading defaults, and Raspberry Pi oriented deployment scripts.

## Current Runtime Model

The strategy rebuild moved the project away from the older offline backtest-first workflow and into a runtime-first workflow:

- `live`: the active broker-connected strategy run
- `paper_shadow`: an always-on paper baseline paired to the current live selection
- `paper_candidate`: extra paper runs launched for side-by-side comparison

Important behavior:

- Live trades stay attached to the run that opened them through `ownerRunId`
- Replacing the live strategy only affects new entries
- Older live runs can drop into `managing_only` until their open trades are resolved
- Live-capable candidate strategies can be promoted from an active `paper_candidate` run; the source run remains paper history and a new live selection is created
- Analytics, signals, trade history, and equity views can all be filtered by `mode`, `strategy`, `runId`, and `selectionId`

## Strategy Catalog

The canonical strategy registry currently includes six strategies:

| Strategy Key | Label | Runtime Status | Intended Use |
| --- | --- | --- | --- |
| `supertrend_momentum` | SuperTrend Momentum | `baseline` | Current live baseline |
| `mean_reversion` | Mean Reversion | `candidate` | Paper comparison |
| `range_breakout` | Range Breakout | `candidate` | Paper comparison |
| `stochastic_divergence` | Stochastic Divergence | `candidate` | Paper comparison |
| `squeeze_play` | Squeeze Play | `candidate` | Paper comparison |
| `timesfm_directional` | TimesFM Directional | `candidate` | Paper comparison, promotable to live |

Notes:

- The runtime supports `baseline` and `live_ready` strategies for live selection.
- In the current catalog, only `supertrend_momentum` is directly live-selectable from the dashboard today.
- Candidate strategies are launched from the Paper view for comparison against the shadow baseline. All implemented candidates expose live/shadow support in metadata, but promotion is intentionally routed through a reviewed paper run rather than the dashboard selector.

## Highlights

- Shared runtime coordinator for live, shadow, and candidate runs
- Strategy catalog exposed through `/api/strategies/catalog`
- Oanda-backed live trading engine with stop loss, trailing stop, breakeven, take profit, and reconciliation
- Runtime-scoped signals, trades, and equity data for each run
- Unified analytics with live vs paper filtering
- React dashboard with dedicated `Dashboard`, `Analytics`, `Paper`, `System`, and `Settings` views
- SQLite persistence for trades, signals, entry decisions, strategy runs, and portfolio snapshots
- Optional email notifications and S3 analytics uploads
- Optional TimesFM 2.5 signal enrichment via a Mac-hosted FastAPI sidecar
- Native TimesFM Directional strategy that uses the sidecar forecast as its entry thesis and can be promoted from Paper after review
- PM2 and Raspberry Pi deployment scripts in `scripts/`

## Architecture

### Backend

- `backend/server.js`: Express + Socket.IO entrypoint
- `backend/src/runtime/`: shared runtime coordinator and market context builder
- `backend/src/strategies/`: canonical strategy registry and strategy implementations
- `backend/src/services/LiveTradingEngine.js`: broker-backed live execution
- `backend/src/services/timesFmClient.js`: fail-open Pi client for the Lathe sidecar
- `backend/src/services/timesFmSignalService.js`: runtime signal enrichment and caching
- `backend/src/services/PaperTradingRuntime.js`: paper trade simulation, snapshots, and run summaries
- `backend/src/routes/tradingRoutes.js`: health, runtime, analytics, trading, config, and reporting APIs
- `backend/src/repositories/`: SQLite persistence layer

### Frontend

- `frontend/src/components/TradingDashboard.jsx`: live dashboard and live strategy selection UI
- `frontend/src/components/AnalyticsDashboard.jsx`: unified runtime analytics
- `frontend/src/components/BacktestLab.jsx`: paper comparison shell for shadow and candidate runs
- `frontend/src/components/TradingConfig.jsx`: runtime configuration editor
- `frontend/src/components/SystemHealth.jsx`: system and service monitoring

### Shared Config

- `shared/tradingConfigDefaults.json`: canonical default config used across runtime surfaces

## Repository Layout

```text
.
├── backend/
│   ├── server.js
│   ├── migrations/
│   ├── src/
│   │   ├── config/
│   │   ├── repositories/
│   │   ├── routes/
│   │   ├── runtime/
│   │   ├── services/
│   │   ├── strategies/
│   │   └── utils/
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
├── timesfm-sidecar/
├── USER_GUIDE.md
├── PROJECT_HISTORY.md
└── ecosystem.config.js
```

## Local Development

### Prerequisites

- Node.js 18+
- npm
- Oanda credentials for live/practice connectivity

### Install

```bash
npm run install:all
```

### Configure `backend/.env`

```bash
NODE_ENV=development
PORT=3101
OANDA_API_KEY=your-api-key
OANDA_ACCOUNT_ID=001-011-XXXXXXXX-001
OANDA_ENVIRONMENT=practice
```

Optional backend environment variables:

- `DB_PATH`
- `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_TO`
- `ENABLE_S3_ANALYTICS`
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`
- `TIMESFM_URL`, `TIMESFM_KEY`

### Migrate and run

```bash
npm run db:migrate
npm run dev
```

Local endpoints:

- Frontend: `http://localhost:3100`
- Backend health: `http://localhost:3101/api/health`

If Oanda credentials are missing, the server still boots, but live pricing, account, and trading endpoints will be unavailable.

## Operator Workflow

### Live selection

The runtime bootstraps a live selection from persisted config on startup. The current live selection includes:

- the active live run
- its paired shadow paper run
- a shared `selectionId`

Live strategy changes are handled through:

- `POST /api/runtime/live-selection`
- the Dashboard strategy selector

### Paper comparison

The Paper view is built around runtime-backed comparison, not legacy offline backtests.

Typical flow:

1. Keep the current live strategy paired with its shadow run.
2. Launch one or more candidate paper runs.
3. Inspect each run's signals, trades, equity curve, and config snapshot.
4. Compare outcomes in the unified analytics view.
5. Promote a live-capable candidate only after the paper run has enough evidence and you are comfortable with the cutover behavior.

How to use it:

1. Open the `Paper` tab and confirm the shadow baseline is present for the current live `selectionId`.
2. Launch a candidate from the `Launch Candidate Runs` section.
3. Click the shadow card or a candidate card to focus that run.
4. Use the run detail panel to inspect:
   - `Equity`
   - `Recent Trades`
   - `Recent Signals`
   - `Config Snapshot`
5. Reset a candidate if you want to restart its paper history from a clean point-in-time.
6. Stop a candidate when you are done comparing it.

What each candidate is testing:

- `mean_reversion`: fades stretched moves back toward the mean during ranging conditions using Bollinger Bands, RSI, ATR, and H1 regime checks.
- `range_breakout`: looks for continuation when intraday ranges compress and then break, with an opening-range breakout bias.
- `stochastic_divergence`: looks for reversal setups where divergence and stochastic timing align.
- `squeeze_play`: looks for directional expansion after low-volatility compression releases.
- `timesfm_directional`: originates entries directly from TimesFM forecast direction, confidence, and expected return.

How to watch candidate performance:

- In the `Paper` tab, compare each candidate against the shadow baseline first.
- Watch the equity curve shape, not just the latest PnL. A smoother curve with smaller drawdowns is usually more useful than a noisy spike.
- Check `Recent Signals` to see whether the strategy is producing clean actionables or mostly filtered / waiting states.
- Check `Recent Trades` for trade frequency, hold time, and whether wins are coming from a repeatable pattern rather than one outsized move.
- Use the `Config Snapshot` to confirm you are comparing the exact version of the strategy settings you intended to run.
- Move to the `Analytics` tab and filter by:
  - `Mode = Candidate Paper` to isolate paper candidates
  - `Strategy` to compare one candidate family over time
  - `Run` to inspect a single launched candidate
- In Analytics, pay particular attention to:
  - net PnL versus the shadow baseline
  - win rate and profit factor
  - trade count and sample size
  - pair performance
  - session performance
  - equity curve and drawdown behavior

Before promoting a candidate, look for:

- better or at least comparable performance versus the shadow run
- enough trades to avoid judging on a tiny sample
- stable behavior across sessions and pairs
- understandable signal reasons, not just accidental outlier wins

Promotion notes:

- `POST /api/runtime/runs/:runId/promote` only accepts `paper_candidate` runs.
- Promotion pauses/restarts the live engine if it was running, liquidates open live positions when the market is open, then creates a new live run plus paired shadow run from the candidate config snapshot.
- The promoted source run remains `paper_candidate` and is annotated with promotion metadata for audit.
- TimesFM Directional promotion requires the TimesFM sidecar to be reachable for actionable forecasts; if the forecast is unavailable, the strategy holds rather than inventing a direction.

### Analytics

`GET /api/analytics` supports runtime filters such as:

- `period`
- `mode`
- `strategy`
- `runId`
- `selectionId`

When no runtime filters are supplied, analytics default to the live cohort.

## Main API Surface

### Health and status

- `GET /api/health`
- `GET /api/system/health`
- `GET /api/system/info`

### Strategy and runtime

- `GET /api/strategies/catalog`
- `GET /api/runtime/live-selection`
- `POST /api/runtime/live-selection`
- `GET /api/runtime/runs`
- `POST /api/runtime/runs`
- `GET /api/runtime/runs/:runId/trades`
- `GET /api/runtime/runs/:runId/signals`
- `GET /api/runtime/runs/:runId/equity`
- `POST /api/runtime/runs/:runId/promote`
- `POST /api/runtime/runs/:runId/stop`
- `POST /api/runtime/runs/:runId/reset`

### Trading, config, and portfolio

- `GET /api/account`
- `GET /api/prices`
- `GET /api/candles/:instrument`
- `GET /api/signals`
- `GET /api/portfolio`
- `GET /api/trades`
- `POST /api/trade/close/:id`
- `POST /api/trading/start`
- `POST /api/trading/stop`
- `POST /api/trading/reset`
- `GET /api/config`
- `POST /api/config`
- `POST /api/config/reset`
- `GET /api/engine/status`
- `GET /api/engine/stats`
- `GET /api/engine/trades`
- `POST /api/engine/close/:tradeId`
- `POST /api/engine/sync`
- `POST /api/engine/reset-stats`

### Analytics and reporting

- `GET /api/analytics`
- `GET /api/reports/status`
- `POST /api/reports/upload`
- `POST /api/reports/upload/daily`
- `POST /api/reports/upload/weekly`

## Socket.IO Events

The backend currently emits:

- `connected`
- `priceUpdate`
- `signalUpdate`
- `tradeSignal`
- `tradeOpened`
- `tradeClosed`
- `tradeUpdate`
- `engineStatus`
- `configUpdate`
- `liveSelectionUpdated`
- `runtimeRunsChanged`
- `paperRunUpdated`

## Current Shared Defaults

Shared defaults live in [shared/tradingConfigDefaults.json](/Users/adams/code/forex-trading-bot/shared/tradingConfigDefaults.json). A few important baseline values:

```json
{
  "enableTrading": false,
  "strategy": "supertrend_momentum",
  "assets": ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"],
  "timeframe": "15m",
  "minAdx": 21,
  "enableHTFFilter": true,
  "htfTimeframe": "1h",
  "enableShorting": true,
  "timesFmEnabled": true,
  "timesFmMode": "observe",
  "timesFmHorizonBars": 12,
  "timesFmTimeoutMs": 5000,
  "timesFmVetoConfidence": 0.75,
  "timesFmDeadZoneBps": 3,
  "riskPerTrade": 0.01,
  "maxOpenPositions": 2,
  "maxPortfolioExposure": 0.5,
  "leverage": 20,
  "maxSpreadPips": 1.2,
  "stopLossType": "ATR",
  "enableTrailingStops": true,
  "enableTakeProfit": false,
  "enableBreakeven": true,
  "enableSessionFilter": true,
  "activeSessions": ["sydney", "tokyo", "london", "newyork"]
}
```

Runtime config is persisted in `backend/data/trading_config.json`.

## Legacy Notes

The older offline backtest/lab workflow is no longer the supported operator path:

- legacy `backtest_results` storage is retired
- migration `006_drop_backtest_results.js` removes the old table
- the supported comparison workflow now lives in the runtime-backed Paper view

## Scripts

### Root

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

### Backend

```bash
cd backend
npm run dev
npm run start
npm run db:migrate
npm run db:rollback
npm test
npm run test:coverage
```

### Frontend

```bash
cd frontend
npm run dev
npm run build
npm run preview
```

## Raspberry Pi Deployment

The repo includes deployment tooling for `/opt/forex-trading-bot`:

```bash
./scripts/first_time_setup.sh
./scripts/setup-secrets.sh
./scripts/deploy.sh
./scripts/update.sh
./scripts/status.sh
./scripts/backup.sh
./scripts/restore.sh
```

Key production files:

- `ecosystem.config.js`
- `scripts/start-wrapper.sh`
- `scripts/DEPLOYMENT_README.md`

## Additional Documentation

- [USER_GUIDE.md](/Users/adams/code/forex-trading-bot/USER_GUIDE.md)
- [scripts/DEPLOYMENT_README.md](/Users/adams/code/forex-trading-bot/scripts/DEPLOYMENT_README.md)
- [PROJECT_HISTORY.md](/Users/adams/code/forex-trading-bot/PROJECT_HISTORY.md)
- [project_roadmap.md](/Users/adams/code/forex-trading-bot/project_roadmap.md)

## Disclaimer

This codebase can place live trades against a broker account. Review the active strategy, runtime selection, and risk configuration carefully before enabling trading. Use practice credentials first and treat production changes as high-risk operations.
