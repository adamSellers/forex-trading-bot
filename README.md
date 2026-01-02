# Forex Trend-Following Trading Bot

A professional Forex trading bot using the **SuperTrend + ADX Momentum** strategy, built for deployment on a Raspberry Pi alongside an existing crypto trading bot. Features a real-time React dashboard, comprehensive analytics, and integration with Oanda's REST v20 API.

![Status](https://img.shields.io/badge/Phase%201-Complete-success) ![Status](https://img.shields.io/badge/Phase%202-In%20Progress-yellow) ![Node](https://img.shields.io/badge/Node-18%2B-green) ![License](https://img.shields.io/badge/License-MIT-blue)

---

## 🎯 Features

### Trading

-   **SuperTrend + ADX Strategy**: Trend-following approach optimized for Forex markets
-   **Multiple Pairs**: AUD/USD, EUR/USD, GBP/USD, USD/JPY
-   **Oanda Integration**: Live trading via REST v20 API (ASIC regulated)
-   **Risk Management**: Pip-based stops, ATR-based position sizing, leverage limits

### Dashboard

-   **Real-time Prices**: WebSocket-based live price updates every 5 seconds
-   **Signal Monitoring**: SuperTrend flip detection with ADX/RSI filters
-   **Portfolio Tracking**: Live positions, P/L, margin usage
-   **Performance Analytics**: Win rate, profit factor, Sharpe ratio, equity curves
-   **System Health**: Service status, API latency, memory monitoring

### Architecture

-   **Backend**: Node.js + Express + Socket.IO
-   **Frontend**: React 18 + Material UI + Recharts
-   **Database**: SQLite via better-sqlite3 + Knex
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

### Phase 2: Core Trading 🔄 IN PROGRESS

-   [ ] LiveTradingEngine implementation
-   [ ] Position sizing (risk-based + fixed units)
-   [ ] Pip-based stop loss / take profit
-   [ ] Trade execution via Oanda API
-   [ ] Trailing stop implementation
-   [ ] Trade logging to database

### Phase 3: Production (Planned)

-   [ ] PM2 deployment alongside crypto bot
-   [ ] Performance tracking
-   [ ] Error handling + recovery
-   [ ] Email notifications

### Phase 4: Backtesting (Planned)

-   [ ] Historical data pipeline
-   [ ] Backtest engine
-   [ ] Strategy optimization

---

## 🏗️ Architecture

### Directory Structure

```
/opt/forex-trading-bot/
├── backend/
│   ├── server.js                     # Express + Socket.IO entry
│   ├── package.json
│   ├── .env                          # OANDA_API_KEY, PORT=3101
│   ├── data/
│   │   ├── trading.db                # SQLite database
│   │   └── trading_config.json       # Persisted config
│   └── src/
│       ├── routes/
│       │   └── tradingRoutes.js      # All API endpoints
│       ├── services/
│       │   ├── configService.js      # Config + persistence
│       │   ├── OandaDataService.js   # Price/candle fetching
│       │   ├── signalGenerator.js    # SuperTrend + ADX signals
│       │   ├── analyticsService.js   # Performance metrics
│       │   └── LiveTradingEngine.js  # Trade execution (Phase 2)
│       ├── repositories/
│       │   ├── tradeRepository.js    # Trade CRUD
│       │   └── signalRepository.js   # Signal history
│       └── utils/
│           └── logger.js             # Logging utility
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js                # Port 3100, proxy to 3101
│   └── src/
│       ├── App.jsx                   # Navigation + view routing
│       ├── index.css
│       ├── theme/
│       │   └── tradingTheme.js       # MUI dark theme
│       ├── config/
│       │   └── api.js                # API client + Socket.IO
│       └── components/
│           ├── Navigation.jsx        # Top nav bar
│           ├── TradingDashboard.jsx  # Main trading view
│           ├── AnalyticsDashboard.jsx # Performance metrics
│           ├── SystemHealth.jsx      # Service monitoring
│           ├── TradingConfig.jsx     # Settings panel
│           ├── dashboard/            # Dashboard widgets
│           │   ├── Shared.jsx
│           │   ├── StatCards.jsx
│           │   ├── LivePrices.jsx
│           │   ├── LivePriceChart.jsx
│           │   ├── TradingSignals.jsx
│           │   ├── CurrentHoldings.jsx
│           │   └── RecentTrades.jsx
│           ├── analytics/            # Analytics widgets
│           │   ├── EquityChart.jsx
│           │   ├── PairPerformance.jsx
│           │   └── StrategyWidgets.jsx
│           └── config/               # Config widgets
│               ├── GeneralSettings.jsx
│               ├── StrategySettings.jsx
│               ├── RiskSettings.jsx
│               ├── InstrumentSettings.jsx
│               └── NotificationSettings.jsx
│
└── migrations/
    └── 001_create_forex_tables.js    # Database schema
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

### 5. Test Endpoints

```bash
# Health check
curl http://localhost:3101/api/health

# Live prices
curl http://localhost:3101/api/prices

# Current signals
curl http://localhost:3101/api/signals

# System health
curl http://localhost:3101/api/system/health
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

| Method | Endpoint               | Description                 |
| ------ | ---------------------- | --------------------------- |
| GET    | `/api/trades`          | Trade history from database |
| POST   | `/api/trade/close/:id` | Force close a position      |
| POST   | `/api/trading/start`   | Enable trading engine       |
| POST   | `/api/trading/stop`    | Disable trading engine      |
| POST   | `/api/trading/reset`   | Reset signal generator      |

### Configuration

| Method | Endpoint            | Description          |
| ------ | ------------------- | -------------------- |
| GET    | `/api/config`       | Full configuration   |
| POST   | `/api/config`       | Update configuration |
| POST   | `/api/config/reset` | Reset to defaults    |

### Analytics

| Method | Endpoint                    | Description                       |
| ------ | --------------------------- | --------------------------------- |
| GET    | `/api/analytics?period=30d` | Comprehensive performance metrics |

---

## ⚙️ Configuration

### Default Settings (`trading_config.json`)

```json
{
    "enableTrading": false,
    "tradingMode": "live",
    "maxCapitalAtRisk": 500,
    "maxOpenPositions": 2,

    "assets": ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"],
    "timeframe": "15m",

    "strategy": "supertrend_momentum",
    "supertrendPeriod": 10,
    "supertrendMultiplier": 3.0,
    "minAdx": 22,
    "rsiOverbought": 75,
    "rsiOversold": 30,

    "riskPerTrade": 0.02,
    "leverage": 10,
    "stopLossType": "ATR",
    "stopLossAtrMultiplier": 1.5,
    "stopLossFixedPips": 30,
    "enableTrailingStops": true,
    "trailingStopPips": 25
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

    - SuperTrend flips GREEN → RED

4. **HOLD**:
    - No conditions met

### Trading Sessions (UTC)

| Session     | Hours         | Best Pairs       | Volatility |
| ----------- | ------------- | ---------------- | ---------- |
| Sydney      | 21:00 - 06:00 | AUD_USD          | Low        |
| Tokyo       | 00:00 - 09:00 | USD_JPY          | Medium     |
| London      | 07:00 - 16:00 | EUR_USD, GBP_USD | High       |
| New York    | 12:00 - 21:00 | All majors       | High       |
| **Overlap** | 12:00 - 16:00 | All              | Highest    |

---

## 🖥️ Dashboard Views

### Dashboard Tab

-   **KPI Cards**: Balance, Daily P/L, Active Signals, Win Rate
-   **Holdings**: Open positions with live P/L
-   **Signals**: Current SuperTrend signals with ADX strength
-   **History**: Recent closed trades
-   **Chart**: Multi-pair price visualization
-   **Live Markets**: Sidebar with bid/ask/spread

### Analytics Tab

-   **Performance KPIs**: Net profit, Win rate, Profit factor, Sharpe ratio
-   **Equity Chart**: Cumulative P/L curve + daily bars
-   **Signal Quality**: Filter breakdown (triggered vs filtered)
-   **Session Analysis**: Performance by trading session
-   **ADX Correlation**: Winner vs loser trend strength
-   **Exit Analysis**: Exit reason distribution
-   **Pair Performance**: Per-instrument breakdown

### System Tab

-   **Status Banner**: Overall health (healthy/degraded)
-   **Service Status**: Oanda API, Data Service, Signal Generator
-   **Environment**: Uptime, Node version, platform
-   **Memory Usage**: Heap visualization
-   **Trading Telemetry**: Account balance, open positions, signal queue
-   **Raw Diagnostics**: Collapsible JSON logs

### Settings Tab

-   **General**: Trading enable/disable, mode selection
-   **Strategy**: SuperTrend, ADX, RSI parameters
-   **Risk**: Position sizing, stop loss, trailing stops
-   **Instruments**: Active currency pairs
-   **Notifications**: Alert configuration

---

## 🔌 Real-Time Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  OandaDataService          SignalGenerator        ConfigService │
│  (polls every 5s)          (runs every 60s)       (persists)    │
│         │                        │                      │       │
│         ▼                        ▼                      ▼       │
│    emit('priceUpdate')    emit('signalGenerated')   emit()     │
│         │                        │                      │       │
│         └────────────┬───────────┴──────────────────────┘       │
│                      ▼                                          │
│               Socket.IO Server                                  │
│         io.emit('priceUpdate', prices)                          │
│         io.emit('signalUpdate', signals)                        │
│         io.emit('configUpdate', config)                         │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│  Navigation                                                     │
│  └── [Dashboard] [Analytics] [System] [Settings]                │
│                                                                 │
│  TradingDashboard                                               │
│  ├── socket.on('priceUpdate') → setPrices()                     │
│  ├── socket.on('signalUpdate') → setLatestSignals()             │
│  └── socket.on('configUpdate') → setSystemStatus()              │
│                                                                 │
│  Components read from state:                                    │
│  ├── LivePrices ← prices                                        │
│  ├── LivePriceChart ← prices + config.assets                    │
│  ├── TradingSignals ← latestSignals                             │
│  └── StatCards ← portfolio                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Safety Features

-   **Leverage Cap**: Enforces ASIC 30:1 limit (defaults to 10:1)
-   **Exposure Limit**: Maximum portfolio exposure configurable
-   **Stop Loss Required**: Every trade requires a stop loss
-   **Kill Switch**: Master enable/disable in config
-   **Mode Toggle**: Live vs Paper trading
-   **Reconciliation**: Syncs with Oanda on startup

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

### Database

```bash
# Direct SQLite access
sqlite3 backend/data/trading.db ".tables"
sqlite3 backend/data/trading.db "SELECT * FROM trades LIMIT 10;"
```

---

## 📝 Forex Concepts Reference

### Pip Calculations

-   **Standard pairs** (AUD_USD, EUR_USD, GBP_USD): 1 pip = 0.0001
-   **JPY pairs** (USD_JPY): 1 pip = 0.01

### Position Sizing

```
Units = (Account Risk $) / (Stop Loss Pips × Pip Value)
```

### Lot Sizes

| Type     | Units   |
| -------- | ------- |
| Standard | 100,000 |
| Mini     | 10,000  |
| Micro    | 1,000   |

---

## 🚨 Troubleshooting

### "Cannot open database because the directory does not exist"

Check `NODE_ENV` in `.env`. Must be `development` for local dev.

### WebSocket connection failed

Ensure backend is running on port 3101 and Socket.IO is configured.

### Config changes not reflecting

Verify `configUpdate` socket event is being emitted. Check ConfigService.

### Signals all show HOLD

No SuperTrend flip occurred. Strategy only triggers on direction changes.

### JPY pairs show wrong pip values

Ensure `getPipValue()` returns 0.01 for JPY pairs.

### Prices not updating

Check `priceUpdate` socket handler. Backend emits every 5 seconds.

### Oanda API errors

-   Verify API key is correct
-   Check environment (live vs practice)
-   Confirm account ID matches

---

## 📄 License

MIT

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## ⚠️ Disclaimer

This software is for educational purposes only. Trading foreign exchange carries a high level of risk and may not be suitable for all investors. Past performance is not indicative of future results. Only trade with money you can afford to lose.
