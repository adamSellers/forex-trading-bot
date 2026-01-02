# Forex Trend-Following Trading Bot

A professional Forex trading bot using the **SuperTrend + ADX Momentum** strategy, built for deployment on a Raspberry Pi alongside an existing crypto trading bot. Features a real-time React dashboard, comprehensive analytics, live trading engine, and integration with Oanda's REST v20 API.

![Status](https://img.shields.io/badge/Phase%202-Complete-success) ![Status](https://img.shields.io/badge/Phase%203-In%20Progress-yellow) ![Node](https://img.shields.io/badge/Node-18%2B-green) ![License](https://img.shields.io/badge/License-MIT-blue)

---

## 🎯 Features

### Trading Engine

-   **LiveTradingEngine**: Fully automated trade execution based on signals
-   **SuperTrend + ADX Strategy**: Trend-following approach optimized for Forex markets
-   **Multiple Pairs**: AUD/USD, EUR/USD, GBP/USD, USD/JPY
-   **Oanda Integration**: Live trading via REST v20 API (ASIC regulated)
-   **Paper & Live Modes**: Test strategies without risking real capital

### Risk Management

-   **ATR-Based Stop Loss**: Dynamic stops that adapt to market volatility
-   **Trailing Stops**: Lock in profits as price moves in your favor
-   **Risk-Based Position Sizing**: Consistent risk per trade (default 2%)
-   **Leverage Limits**: Enforces ASIC 30:1 max (configurable, default 10:1)
-   **Max Position Limits**: Cap on concurrent open trades
-   **Negative Balance Protection**: ASIC-mandated retail client protection

### Dashboard

-   **Real-time Prices**: WebSocket-based live price updates every 5 seconds
-   **Signal Monitoring**: SuperTrend flip detection with ADX/RSI filters
-   **Portfolio Tracking**: Live positions, P/L, margin usage
-   **Performance Analytics**: Win rate, profit factor, Sharpe ratio, equity curves
-   **System Health**: Service status, API latency, memory monitoring
-   **Trading Sessions**: Visual session indicators with best trading windows

### Architecture

-   **Backend**: Node.js + Express + Socket.IO
-   **Frontend**: React 18 + Material UI + Recharts
-   **Database**: SQLite via Knex.js
-   **Deployment**: PM2 process management

---

## 📊 Current Status

### Phase 1: Foundation ✅ COMPLETE

-   [x] Oanda account setup + API verified
-   [x] Project structure (monorepo)
-   [x] OandaDataService (polling + EventEmitter)
-   [x] SignalGenerator (SuperTrend + ADX + RSI)
-   [x] Database schema + migrations
-   [x] API routes with live Oanda data
-   [x] Socket.IO real-time updates
-   [x] React + MUI dashboard
-   [x] ConfigService with persistence
-   [x] Full navigation (Dashboard | Analytics | System | Settings)
-   [x] Analytics with server-side metrics
-   [x] System health monitoring

### Phase 2: Core Trading ✅ COMPLETE

-   [x] LiveTradingEngine implementation
-   [x] Position sizing (risk-based + fixed units)
-   [x] Pip-based stop loss calculation
-   [x] ATR-based dynamic stop loss
-   [x] Trade execution via Oanda API
-   [x] Paper trading mode support
-   [x] Trade logging to database
-   [x] Socket broadcast of trade events
-   [x] Engine status API endpoints
-   [x] Graceful shutdown handling
-   [x] Trailing stop implementation
-   [x] Trading session filter

### Phase 3: Production 🔄 IN PROGRESS

-   [x] Live trading activation
-   [x] Trading session filters
-   [x] Codebase cleanup (removed legacy crypto bot files)
-   [x] Engine status broadcast fix (race condition)
-   [ ] PM2 deployment alongside crypto bot
-   [ ] Email notifications for trades
-   [ ] Extended monitoring period

### Phase 4: Backtesting (Planned)

-   [ ] Historical data pipeline
-   [ ] Backtest engine
-   [ ] Strategy optimization

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
```

### Dual-Bot Deployment

| Service     | Crypto Bot                    | Forex Bot                    |
| ----------- | ----------------------------- | ---------------------------- |
| Backend API | 3001                          | **3101**                     |
| Frontend    | 3000                          | **3100**                     |
| Database    | /opt/crypto-trading-bot/data/ | /opt/forex-trading-bot/data/ |
| PM2 Name    | crypto-backend                | forex-backend                |

---

## 🚀 Quick Start

### Prerequisites

-   Node.js 18+
-   Oanda Live/Practice account with API access

### 1. Clone and Install

```bash
cd /opt
git clone <your-repo> forex-trading-bot
cd forex-trading-bot

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 2. Configure Environment

```bash
# Backend .env
cd backend
cat > .env << EOF
NODE_ENV=development
PORT=3101
OANDA_API_KEY=your-api-key-here
OANDA_ACCOUNT_ID=001-011-XXXXXXXX-001
OANDA_ENVIRONMENT=live
EOF
```

### 3. Run Database Migrations

```bash
cd backend
npm run db:migrate
```

### 4. Start Development

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

Open http://localhost:3100 to view the dashboard.

### 5. Enable Trading

```bash
# Check engine status
curl http://localhost:3101/api/engine/status

# Enable trading (paper mode by default)
curl -X POST http://localhost:3101/api/trading/start

# Or set to live mode first
curl -X POST http://localhost:3101/api/config \
  -H "Content-Type: application/json" \
  -d '{"tradingMode": "live"}'
```

---

## 📡 API Reference

### System

| Method | Endpoint             | Description                      |
| ------ | -------------------- | -------------------------------- |
| GET    | `/api/health`        | Basic health + config summary    |
| GET    | `/api/system/health` | Comprehensive service status     |
| GET    | `/api/system/info`   | Memory, environment, server info |

### Market Data

| Method | Endpoint                   | Description                      |
| ------ | -------------------------- | -------------------------------- |
| GET    | `/api/account`             | Oanda account summary            |
| GET    | `/api/prices`              | Live prices for configured pairs |
| GET    | `/api/candles/:instrument` | Historical candles               |
| GET    | `/api/signals`             | Current signals from generator   |
| GET    | `/api/portfolio`           | Open positions + account         |

### Trading

| Method | Endpoint               | Description                   |
| ------ | ---------------------- | ----------------------------- |
| GET    | `/api/trades`          | Trade history from database   |
| POST   | `/api/trade/close/:id` | Force close a position        |
| POST   | `/api/trading/start`   | Enable trading (sets config)  |
| POST   | `/api/trading/stop`    | Disable trading (sets config) |
| POST   | `/api/trading/reset`   | Reset signal generator state  |

### Engine Control

| Method | Endpoint                     | Description                       |
| ------ | ---------------------------- | --------------------------------- |
| GET    | `/api/engine/status`         | Engine status, stats, open trades |
| GET    | `/api/engine/stats`          | Detailed statistics               |
| GET    | `/api/engine/trades`         | Open trades tracked by engine     |
| POST   | `/api/engine/close/:tradeId` | Close specific trade via engine   |
| POST   | `/api/engine/sync`           | Sync engine with Oanda positions  |
| POST   | `/api/engine/reset-stats`    | Reset engine statistics           |

### Configuration

| Method | Endpoint            | Description        |
| ------ | ------------------- | ------------------ |
| GET    | `/api/config`       | Full config object |
| POST   | `/api/config`       | Update config      |
| POST   | `/api/config/reset` | Reset to defaults  |

### Analytics

| Method | Endpoint                              | Description         |
| ------ | ------------------------------------- | ------------------- |
| GET    | `/api/analytics?period=30d&mode=live` | Performance metrics |

---

## 📌 Socket.IO Events

### Server → Client

| Event             | Payload                    | Description          |
| ----------------- | -------------------------- | -------------------- |
| `priceUpdate`     | `{AUD_USD: {...}, ...}`    | Price updates (5s)   |
| `signalUpdate`    | `[signals]`                | All signals batch    |
| `signalGenerated` | `{signal}`                 | Individual signal    |
| `configUpdate`    | `{config}`                 | Config changed       |
| `engineStatus`    | `{isRunning, stats, ...}`  | Engine state changed |
| `tradeOpened`     | `{tradeId, instrument...}` | Trade executed       |
| `tradeClosed`     | `{tradeId, pnlAud, ...}`   | Trade closed         |

---

## ⚙️ Configuration Reference

### Key Settings

```javascript
{
  // Master Controls
  enableTrading: false,        // Must be true to execute trades
  tradingMode: 'paper',        // 'paper' or 'live'

  // Position Limits
  maxOpenPositions: 2,         // Max concurrent trades
  maxCapitalAtRisk: 500,       // Max AUD per trade

  // Instruments
  assets: ['AUD_USD', 'EUR_USD'],

  // Strategy
  strategy: 'supertrend_momentum',
  timeframe: '15m',
  supertrendPeriod: 10,
  supertrendMultiplier: 3.0,
  minAdx: 22,                  // Trend strength threshold
  rsiOverbought: 75,
  rsiOversold: 30,

  // Continuation Entry
  enableContinuationEntry: true,
  continuationWindowMs: 14400000,  // 4 hours
  continuationRsiThreshold: 70,

  // Risk Management
  riskPerTrade: 0.02,          // 2% account risk per trade
  leverage: 10,
  positionSizeMethod: 'RISK',  // 'RISK' or 'FIXED'
  fixedPositionUnits: 1000,

  // Stop Loss
  stopLossType: 'ATR',         // 'ATR' or 'FIXED'
  stopLossAtrMultiplier: 2.0,  // ATR Ã— 2.0
  stopLossPips: 30,            // For FIXED type

  // Trailing Stops
  enableTrailingStops: true,
  trailingStopPips: 25,
  trailingStopActivationPips: 20,

  // Trading Sessions
  enableSessionFilter: true,
  activeSessions: ['sydney', 'tokyo', 'london', 'newyork'],
}
```

### Key Forex Adaptations

| Parameter           | Crypto Bot | Forex Bot  | Reason                    |
| ------------------- | ---------- | ---------- | ------------------------- |
| ADX Threshold       | 25-28      | 22         | Forex trends are smoother |
| Max Price Deviation | 3%         | 2%         | Forex moves less          |
| Stop Loss Unit      | %          | Pips       | Industry standard         |
| Position Sizing     | % capital  | Risk-based | Professional approach     |
| Leverage            | 1:1 (spot) | Up to 30:1 | Regulated CFD             |

---

## 📈 Strategy: SuperTrend + ADX Momentum

### Signal Logic

1. **BUY Signal (FRESH_FLIP)**:

    - SuperTrend flips RED → GREEN
    - ADX > 22 (trend strength)
    - RSI < 75 (not overbought)

2. **BUY Signal (CONTINUATION)**:

    - RSI cools below 70 after blocked flip
    - Within 4-hour window
    - Price deviation < 2%

3. **SELL Signal**:

    - SuperTrend flips GREEN → RED (exits long position)

4. **HOLD**:
    - No conditions met

### Signal Flow

```
Every 60 seconds:
         |
         v
    SuperTrend Flipped? --No---> HOLD
         | Yes
         v
    ADX ≥ 22? --No---> REJECTED
         | Yes
         v
    RSI < 75? --No---> Save as PENDING
         | Yes         |
         v             v
    ✅ BUY SIGNAL    Wait for RSI < 70
         |             |
         v             v
    Execute Trade    ✅ CONTINUATION ENTRY
```

### Entry Validation

Before executing a trade, the engine validates:

-   `enableTrading === true`
-   `openPositions < maxOpenPositions`
-   Instrument is in `assets` array
-   No existing position for this pair
-   Signal ADX >= `minAdx`
-   Within active trading session (if filter enabled)

### Trading Sessions (UTC)

| Session     | Hours         | Best Pairs       | Volatility |
| ----------- | ------------- | ---------------- | ---------- |
| Sydney      | 21:00 - 06:00 | AUD_USD          | Low        |
| Tokyo       | 00:00 - 09:00 | USD_JPY          | Medium     |
| London      | 07:00 - 16:00 | EUR_USD, GBP_USD | High       |
| New York    | 12:00 - 21:00 | All majors       | High       |
| **Overlap** | 12:00 - 16:00 | All              | Highest    |

---

## 🛡️ Safety Features

| Feature                         | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| **Trading Disabled by Default** | Must explicitly enable via config              |
| **Paper Mode**                  | Test strategies without real money             |
| **Position Limits**             | `maxOpenPositions` caps concurrent trades      |
| **Capital Limits**              | `maxCapitalAtRisk` caps risk per trade         |
| **Entry Validation**            | Multiple checks before every trade             |
| **Signal Queue**                | Sequential processing prevents race conditions |
| **Session Filter**              | Avoid low-liquidity trading periods            |
| **ADX Filter**                  | Avoid choppy, trendless markets                |
| **RSI Filter**                  | Avoid buying exhausted momentum                |
| **Leverage Cap**                | Enforces ASIC 30:1 limit (default 10:1)        |
| **Stop Loss Required**          | Every trade has a stop loss on Oanda           |
| **Trailing Stops**              | Lock in profits automatically                  |
| **Graceful Shutdown**           | Clean stop with 5s timeout                     |
| **Oanda Sync**                  | Detects externally closed positions            |
| **Negative Balance Protection** | ASIC-mandated, can't lose more than deposit    |

### Emergency Stop

Multiple ways to stop trading immediately:

1. **Frontend**: Toggle "Enable Trading" off
2. **API**: `curl -X POST http://localhost:3101/api/trading/stop`
3. **Config**: Set `enableTrading: false`
4. **Process**: Kill the backend process
5. **Oanda**: Close positions directly in Oanda platform

---

## 📊 Data Logging & Analytics

### What Gets Logged

**Every Trade:**

-   Entry/exit prices and times
-   Position size and leverage
-   P/L in AUD and pips
-   Signal strength (ADX) at entry
-   Entry type (FRESH_FLIP, CONTINUATION)
-   Stop loss and trailing stop prices
-   Exit reason (STOP_LOSS, TRAILING_STOP, SIGNAL, MANUAL)
-   Holding period

**Every Signal (60s):**

-   Instrument and signal type
-   ADX, RSI values
-   SuperTrend direction
-   ATR in pips
-   Current price

**Portfolio Snapshots:**

-   Account balance and value
-   Unrealized/realized P/L
-   Margin usage
-   Open positions

### Analytics Available

| Metric                 | Description                   |
| ---------------------- | ----------------------------- |
| Win Rate               | % of profitable trades        |
| Profit Factor          | Gross wins / Gross losses     |
| Sharpe Ratio           | Risk-adjusted returns         |
| Avg Win / Loss         | Risk:Reward achieved          |
| Performance by Pair    | Which pairs work best         |
| Performance by Session | Best trading times            |
| Exit Analysis          | Why trades closed             |
| ADX Analysis           | Performance vs trend strength |
| Equity Curve           | Account growth visualization  |

---

## 🔧 Development Commands

### Backend

```bash
cd backend

npm run dev          # Start with nodemon
npm run start        # Production start
npm run db:migrate   # Run migrations
npm run db:rollback  # Rollback migrations
```

### Frontend

```bash
cd frontend

npm run dev          # Vite dev server (port 3100)
npm run build        # Production build
npm run preview      # Preview production build
```

### Database Queries

```bash
# Direct SQLite access
sqlite3 backend/data/trading.db

# View tables
.tables

# Recent trades
SELECT * FROM trades ORDER BY entry_time DESC LIMIT 10;

# Performance by pair
SELECT
  instrument,
  COUNT(*) as trades,
  ROUND(SUM(pnl_aud), 2) as total_pnl,
  ROUND(AVG(pnl_pips), 1) as avg_pips
FROM trades
WHERE is_open = 0
GROUP BY instrument;

# Win rate
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN pnl_aud > 0 THEN 1 ELSE 0 END) as wins,
  ROUND(SUM(CASE WHEN pnl_aud > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate
FROM trades WHERE is_open = 0;
```

---

## 📝 Forex Concepts Reference

### Pip Calculations

-   **Standard pairs** (AUD_USD, EUR_USD, GBP_USD): 1 pip = 0.0001
-   **JPY pairs** (USD_JPY): 1 pip = 0.01

### Position Sizing (RISK Method)

```
Risk Amount = Account Balance Ã— Risk Per Trade (e.g., 2%)
Stop Loss Price = Stop Loss Pips Ã— Pip Value
Position Size = Risk Amount / Stop Loss Price
```

### Pip Value by Position Size

| Position Size | 1 Pip Worth |
| ------------- | ----------- |
| 1,000 units   | $0.10       |
| 10,000 units  | $1.00       |
| 100,000 units | $10.00      |

### Lot Sizes

| Type     | Units   |
| -------- | ------- |
| Standard | 100,000 |
| Mini     | 10,000  |
| Micro    | 1,000   |

---

## 🚨 Troubleshooting

### Engine not executing trades

Check in order:

1. `enableTrading` is `true`?
2. `tradingMode` is set (`paper` or `live`)?
3. `maxOpenPositions` not reached?
4. Signal is `BUY`? (engine only goes long currently)
5. Signal ADX >= `minAdx`?
6. Instrument in `assets` array?
7. Within active trading session?
8. Check logs for "Entry rejected" messages

### "Trading engine not available" error

-   Engine failed to start - check backend logs
-   Oanda client failed to initialize - verify API key

### Trades not showing in database

-   Check `tradingMode` - paper trades have `mode: 'paper'`
-   Query with correct mode: `/api/trades?mode=paper`

### Stop loss not triggering (paper mode)

-   Engine must be running to monitor paper trades
-   If engine stops, paper stop losses won't trigger
-   Live trades have stop loss managed by Oanda server

### Signals all show HOLD

-   No SuperTrend flip occurred
-   Strategy only triggers on direction changes
-   Wait for trend reversal

### Oanda API errors

-   Verify API key is correct
-   Check environment (live vs practice)
-   Confirm account ID matches
-   Check Oanda service status

### WebSocket connection failed

-   Ensure backend is running on port 3101
-   Check Socket.IO configuration
-   Verify no firewall blocking

---

## 📚 Documentation

-   **USER_GUIDE.md**: Comprehensive guide for traders (concepts, settings, activation)
-   **PROJECT_INSTRUCTIONS.md**: Development reference and architecture details

---

## 🔄 License

MIT

---

## ⚠️ Disclaimer

This software is for educational purposes only. Trading foreign exchange carries a high level of risk and may not be suitable for all investors. The high degree of leverage can work against you as well as for you. Before deciding to trade foreign exchange, you should carefully consider your investment objectives, level of experience, and risk appetite.

**Past performance is not indicative of future results. Only trade with money you can afford to lose.**

Under ASIC regulation, retail clients have Negative Balance Protection - you cannot lose more than your deposited funds.
