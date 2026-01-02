# Forex Trend-Following Trading Bot

A Forex trading bot using the SuperTrend + ADX Momentum strategy, built for deployment on a Raspberry Pi alongside an existing crypto trading bot.

## Features

-   **SuperTrend + ADX Strategy**: Proven trend-following approach adapted for Forex markets
-   **Oanda Integration**: Live trading via Oanda REST v20 API (ASIC regulated)
-   **Risk Management**: Pip-based stop losses, position sizing, leverage limits
-   **Multiple Pairs**: AUD/USD, EUR/USD, GBP/USD, USD/JPY
-   **Real-time Dashboard**: React frontend for monitoring (coming soon)

## Architecture

```
/opt/forex-trading-bot/
├── backend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── OandaClient.js        # Oanda API client
│   │   │   ├── ForexDataService.js   # Market data management
│   │   │   ├── LiveTradingEngine.js  # Trade execution
│   │   │   └── signalGenerator.js    # Signal generation
│   │   ├── repositories/
│   │   │   └── tradeRepository.js    # Database access
│   │   └── config/
│   │       └── database.js           # SQLite configuration
│   ├── migrations/
│   └── data/
│       └── trading_config.json       # Trading configuration
├── frontend/                          # React dashboard (coming soon)
├── scripts/
│   ├── exploreForex.js               # Strategy exploration
│   ├── testConnection.js             # API connection test
│   ├── setup-secrets.sh              # Secure credential storage
│   └── deploy.sh                     # Production deployment
└── data/
    └── trading.db                    # SQLite database
```

## Quick Start

### 1. Clone and Install

```bash
cd /opt
git clone <your-repo> forex-trading-bot
cd forex-trading-bot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Oanda credentials
```

Or use the secure secrets setup:

```bash
./scripts/setup-secrets.sh
```

### 3. Test Connection

```bash
export OANDA_API_KEY="your-api-key"
npm run test:connection
```

### 4. Explore Strategy

Run the exploration script to see how the strategy behaves on live Forex data:

```bash
npm run explore
```

This will show:

-   ADX distribution across pairs
-   Signal frequency at different thresholds
-   Current market state

### 5. Run Database Migrations

```bash
npm run db:migrate
```

### 6. Start the Bot

Development:

```bash
npm run dev
```

Production (with PM2):

```bash
./scripts/deploy.sh
```

## Configuration

### Trading Parameters

Edit `backend/data/trading_config.json`:

```json
{
    "strategy": {
        "adx": { "threshold": 22 },
        "supertrend": { "period": 10, "multiplier": 3.0 }
    },
    "riskManagement": {
        "riskPerTradePercent": 0.01,
        "maxPortfolioExposure": 0.8
    },
    "stopLoss": { "fixedPips": 30 },
    "trailingStop": { "enabled": true, "pips": 20 },
    "leverage": { "default": 10, "max": 30 }
}
```

### Key Differences from Crypto Bot

| Aspect        | Crypto           | Forex                             |
| ------------- | ---------------- | --------------------------------- |
| ADX Threshold | 25-28            | 20-22 (lower for smoother trends) |
| Stop Loss     | % based          | Pip based (30-50 pips)            |
| Position Size | USDT amount      | Lots (units)                      |
| Leverage      | 1:1 (spot)       | Up to 30:1                        |
| Fees          | 0.1% maker/taker | Spread (built-in)                 |

## Port Configuration

The Forex bot uses different ports to coexist with the crypto bot:

| Service     | Crypto Bot | Forex Bot |
| ----------- | ---------- | --------- |
| Backend API | 3001       | 3101      |
| Frontend    | 3000       | 3100      |

## Safety Features

-   **Leverage Cap**: Enforces ASIC 30:1 limit (defaults to 10:1)
-   **Exposure Limit**: Maximum 80% portfolio exposure
-   **Stop Loss**: Required on every trade
-   **Reconciliation**: Syncs with Oanda on startup
-   **Recovery Queue**: Tracks failed database operations

## PM2 Commands

```bash
# Start
pm2 start ecosystem.config.js --env production

# View logs
pm2 logs forex-backend --lines 50

# Restart
pm2 restart forex-backend

# Status
pm2 status
```

## API Endpoints (Backend)

```
GET  /api/health           - Health check
GET  /api/portfolio        - Current portfolio
GET  /api/signals          - Latest signals
GET  /api/trades           - Trade history
POST /api/config           - Update configuration
POST /api/trade/close/:id  - Force close position
```

## License

MIT
