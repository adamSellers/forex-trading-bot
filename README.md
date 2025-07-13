# Crypto Trend Trading Bot

A full-stack, production-ready cryptocurrency trading bot featuring real-time data analysis, advanced paper trading, a live trading engine, and a comprehensive monitoring dashboard.

 <!-- TODO: Replace with an actual screenshot -->

## ✨ Features

-   **Dual Trading Modes**:
    -   **Live Trading Engine**: Execute real trades on your Binance account with real money.
    -   **Paper Trading Engine**: Simulate trades with a virtual portfolio, tracking detailed P&L without financial risk.
-   **Advanced Signal Generation**:
    -   Configurable EMA/SMA crossover strategies (`conservative`, `balanced`, `responsive`).
    -   **Volatility Filtering** using Average True Range (ATR) to avoid trading in choppy markets.
    -   Signal strength calculation and cooldown periods to prevent over-trading.
-   **Sophisticated Order & Risk Management**:
    -   **Dynamic Position Sizing**: Calculates order size based on user-defined risk per trade and real-time ATR.
    -   **Advanced Order Management**: Implements **Trailing Stops** and ATR-based **Take Profit** levels for both paper and live trading.
    -   **Centralized Risk Service**: Configurable daily and weekly loss limits that automatically halt trading to protect capital.
-   **Backtesting Engine**:
    -   Run strategies against months of historical data to evaluate performance before deployment.
    -   Scripts provided to fetch historical data and run backtests.
-   **Rich React Dashboard**:
    -   **Live Price Charts** with configurable assets, timeframes, and moving average overlays.
    -   **Real-time Feeds** for signals and trade executions via WebSockets.
    -   Detailed portfolio overview distinguishing between paper positions and real Binance holdings.
    -   **Analytics Dashboard** to visualize performance, P&L over time, and trading activity.
    -   **System Health** monitoring for all backend services.
    -   **Full Configuration UI** to adjust trading strategy and risk parameters on the fly.
    -   System status banner showing data collection progress.
-   **Secure & Persistent**:
    -   **Encrypted API Key Storage**: Credentials are encrypted on disk and only loaded into memory at runtime.
    -   **Persistent Database**: All signals and trades are saved to a SQLite database for analysis, audit, and state restoration.
-   **Production-Ready Deployment**:
    -   Optimized for Raspberry Pi 5 (ARM64) with Node.js v22.
    -   Managed by PM2 with a detailed `ecosystem.config.js`.
    -   Served via nginx with WebSocket proxying.
    -   **Comprehensive Shell Scripts** for automated clean installation, deployment, updates, backups, and restoration.

## Tech Stack

-   **Backend**: Node.js, Express
-   **Frontend**: React, Vite, Material-UI
-   **Charting**: Recharts, MUI X-Charts
-   **Real-Time Communication**: Socket.IO
-   **Database**: SQLite3 with Knex.js for migrations
-   **API Client**: `node-binance-api`
-   **Process Management**: PM2 for production

## Getting Started

### Local Development

The quickest way to get a local development environment running.

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/adamSellers/crypto-trading-bot.git
    cd crypto-trading-bot
    ```

2.  **Run the setup script:** This will install all dependencies and create the necessary `.env` files.

    ```bash
    ./scripts/dev-setup.sh
    ```

3.  **Add API Keys:** Edit the newly created `backend/.env` file and add your Binance API keys. Read-only keys are sufficient for development.

4.  **Run the database migrations:**

    ```bash
    npm run db:migrate
    ```

5.  **Start the development servers:**
    ```bash
    npm run dev
    ```
    This will start the backend and frontend concurrently. The dashboard will be available at `http://localhost:5173`.

### Production Install on Raspberry Pi

For a full production deployment on a Raspberry Pi 5, use the automated installation script. This will set up the entire environment, including dependencies, nginx, PM2, and security features.

```bash
# Run this from your home directory on the Pi
git clone https://github.com/adamSellers/crypto-trading-bot.git
cd crypto-trading-bot
./scripts/clean-install.sh
```

The script will guide you through the process, including setting up your encrypted API keys.

## System Architecture

The application follows a clean, service-oriented architecture. The `TradingService` acts as the central orchestrator, initializing and managing all sub-services. It selects an `activeEngine` (either `PaperTradingEngine` or `LiveTradingEngine`) based on the configuration, ensuring a clear and reliable data flow.

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
