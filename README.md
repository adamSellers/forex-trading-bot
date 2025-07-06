# Crypto Trend Trading Bot

A full-stack, production-ready cryptocurrency trading bot featuring real-time data analysis, advanced paper trading with sophisticated risk management, and a comprehensive monitoring dashboard.

 <!-- TODO: Replace with an actual screenshot -->

## Features

-   **Real-Time Binance Integration**: Live market data via WebSockets with a robust HTTP polling fallback.
-   **Advanced Signal Generation**:
    -   Configurable EMA/SMA crossover strategies.
    -   **Volatility Filtering** using Average True Range (ATR) to avoid trading in choppy markets.
    -   Signal strength calculation and cooldown periods to prevent over-trading.
-   **Sophisticated Paper Trading Engine**:
    -   Simulates trades with a virtual portfolio, tracking detailed P&L.
    -   **Dynamic Position Sizing**: Calculates order size based on user-defined risk per trade and real-time ATR.
    -   **Advanced Order Management**: Implements **Trailing Stops** and ATR-based **Take Profit** levels.
-   **Comprehensive Risk Management**:
    -   Configurable daily and weekly loss limits that automatically halt trading.
    -   Per-asset portfolio allocation rules.
-   **Rich React Dashboard**:
    -   Live price charts with **Moving Average overlays**.
    -   Real-time signal and trade execution feed.
    -   Detailed portfolio overview distinguishing between paper positions and real Binance holdings.
    -   System status banner showing data collection progress.
-   **Persistent Storage**: All signals and trades are saved to a SQLite database for analysis and audit.
-   **Production-Ready Deployment**:
    -   Optimized for Raspberry Pi 5 (ARM64) with Node.js v22.
    -   Managed by PM2 with a detailed `ecosystem.config.js`.
    -   Served via nginx with WebSocket proxying.
    -   Includes automated deployment and backup scripts.

## Tech Stack

-   **Backend**: Node.js, Express
-   **Frontend**: React, Vite, Material-UI
-   **Charting**: Recharts
-   **Real-Time Communication**: Socket.IO
-   **Database**: SQLite3 with Knex.js for migrations
-   **API Client**: `node-binance-api`
-   **Process Management**: PM2 for production

## Getting Started

-   npm (v8.0.0 or higher)

### Installation & Setup

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/crypto-trading-bot.git
    cd crypto-trading-bot
    ```

    npm install

    ```

    ```

2.  **Configure Environment Variables for Development:**
    Create a `.env` file in the `backend/` directory. For production, secrets are managed by the deployment scripts.

    **`backend/.env`**

    ```env
    # Server Configuration

    # Binance API (Read-only access is sufficient)
    BINANCE_API_KEY=YOUR_BINANCE_API_KEY
    BINANCE_API_SECRET=YOUR_BINANCE_API_SECRET

    # Database and Logging
    DB_PATH=./data/trading.db
    LOG_LEVEL=debug
    ```

3.  **Initialize the Database:**
    Run the database migrations.
    ````bash
    npm run db:migrate
    npm run db:seed
    ```bash
    npm run dev
    ````

-   **Build for production:** `npm run build`
-   **Run linter:** `npm run lint`

## System Architecture

The application follows a clean, service-oriented architecture. The `TradingService` acts as the central orchestrator, ensuring a clear and reliable data flow.

```
                                       +-------------------------+
                                       |      React Frontend     |
                                       +------------+------------+
                                                    | (Socket.IO)
                                       +------------v------------+
                                       |   TradingController.js  | (API/Socket Bridge)
                                       +------------+------------+
                                                    | (Events)
+----------------------+               +------------v------------+
| Binance API / WSS    |<------------->|     TradingService.js   | (Orchestrator)
+----------------------+               +--+---------+---------+--+
                                          |          |         |
             +----------------------------+          |         +--------------------------+
             |                                       |                                    |
 +-----------v-----------+               +-----------v-----------+              +-----------v-----------+
 | BinanceDataService.js |               |  SignalGenerator.js   |              | PaperTradingEngine.js |
 +-----------------------+               +-----------------------+              +-----------------------+
             |                                       |                                    |
             | (Candles/Prices)                      | (Signals)                          | (Trades)
             |                                       |                                    |
             +--------------------------->-----------+------------------------------------+
                                                     |
                                         +-----------v-----------+
                                         |   SQLite3 Database    | (Repositories)
                                         +-----------------------+
```

## Paper Trading Mechanics

### Trade Execution Flow

1.  **Signal Generated**: e.g., BTC 20-EMA crosses above 50-EMA, and volatility is above the minimum threshold.
2.  **Risk Calculation**: Position size is determined based on the **Risk Per Trade** setting (e.g., 1% of capital) and the asset's real-time **ATR**.
3.  **Virtual Buy**: A virtual order is executed and recorded.
4.  **Balance Update**: The virtual USDT balance is reduced by the cost of the trade.
5.  **Position Tracking**: The new position is added to the virtual portfolio with a calculated **Stop Loss**, **Take Profit**, and initial **Trailing Stop** price.
6.  **Database Record**: The complete trade is stored in the SQLite database.

## Deployment

This application is optimized for deployment on a **Raspberry Pi 5 (ARM64)** using PM2 and nginx.

### Automated Clean Install

The `./scripts/clean-install.sh` script automates the entire setup process on a fresh Raspberry Pi, including dependency installation, nginx configuration, and PM2 setup.

### Verifying the Deployment

-   Check PM2 status: `pm2 status` or `./scripts/status.sh`
-   View live logs: `pm2 logs crypto-trend-bot` or `./scripts/logs.sh`

## Troubleshooting

    -   In your Binance API settings, make sure the key has "Enable Reading" permissions.
    -   If you have IP restrictions enabled, ensure your server's IP is whitelisted.
