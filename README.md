# Crypto Trend Trading Bot

This is a full-stack cryptocurrency trading bot that operates in **Paper Trading Mode**. It executes virtual trades with a simulated $5,000 USDT balance while monitoring real-time Binance market data and displaying your actual Binance holdings for comparison.

## Features

-   **Real-Time Data**: Connects to Binance via REST API and WebSockets for live market data.
-   **Automated Signal Generation**: Analyzes EMA/SMA crossovers to generate BUY/SELL/HOLD signals.
-   **Sophisticated Paper Trading**: Simulates trades with a virtual portfolio, tracking P&L and performance metrics.
-   **Advanced Risk Management**: Implements rules for position sizing, stop losses, and daily/weekly loss limits.
-   **React Dashboard**: A comprehensive UI to monitor signals, trades, portfolio performance, and system health.
-   **Production-Ready**: Configured for deployment on a Raspberry Pi using PM2.

## Tech Stack

-   **Backend**: Node.js, Express, Knex.js, SQLite3
-   **Frontend**: React, Vite, Material-UI, Recharts
-   **Real-Time**: Socket.IO
-   **API**: Binance API (via `node-binance-api`)
-   **Process Management**: PM2

## Getting Started

### Prerequisites

Make sure you have the following installed:

-   Node.js (v16.0.0 or higher)
-   npm (v8.0.0 or higher)

### Installation & Setup

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/adamSellers/crypto-trading-bot.git
    cd crypto-trading-bot
    ```

2.  **Install dependencies for both workspaces:**

    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    The backend requires environment variables for configuration. For development, create a `.env` file in the `backend/` directory. For production, these are managed in `ecosystem.config.js`.

    Create `backend/.env` and add the following:

    ```env
    # Server Configuration
    NODE_ENV=development
    PORT=3001

    # Binance API (Read-only access is sufficient)
    BINANCE_API_KEY=YOUR_BINANCE_API_KEY
    BINANCE_API_SECRET=YOUR_BINANCE_API_SECRET
    USE_REAL_BINANCE_DATA=true

    # Database and Logging
    DB_PATH=./data/trading_bot_dev.db
    LOG_LEVEL=debug
    ```

4.  **Initialize the Database:**
    Run the database migrations and seed initial data.
    ```bash
    npm run db:migrate
    npm run db:seed
    ```

## Development Commands

-   **Run full stack (backend & frontend) in dev mode:**
    ```bash
    npm run dev
    ```
-   **Run backend only:** `npm run dev:backend`
-   **Run frontend only:** `npm run dev:frontend`
-   **Build for production:** `npm run build`
-   **Run production server locally:** `npm run serve`
-   **Run linter:** `npm run lint`

## System Architecture

## Database Schema

The system is composed of several key services that work together to analyze data and simulate trades.

-   **BinanceDataService**: Fetches real market data via Binance API, provides live price streams via WebSocket, and supplies historical candles for analysis. It has **read-only access** and places no real orders.
-   **SignalGenerator**: Analyzes technical indicators (EMA/SMA crossovers) on live data to generate BUY/SELL/HOLD signals every minute.
-   **PaperTradingEngine**: Executes virtual trades based on signals, manages the virtual USDT balance, calculates position sizes, and tracks all performance metrics.

## Paper Trading Mechanics

### Trade Execution Flow

1.  **Signal Generated**: e.g., BTC 20-EMA crosses above 50-EMA.
2.  **Risk Calculation**: Max risk is calculated (e.g., 1% of $5K = $50). Position size is determined based on this risk and the asset's volatility (ATR).
3.  **Virtual Buy**: A virtual order is executed and recorded.
4.  **Balance Update**: The virtual USDT balance is reduced by the cost of the trade.
5.  **Position Tracking**: The new position is added to the virtual portfolio, with a calculated stop-loss price.
6.  **Database Record**: The complete trade is stored in the SQLite database.

### Risk Management Rules

-   **Position Size**: 1% risk rule = max $50 loss per trade.
-   **Stop Loss**: 1.5x ATR below entry price for BUY orders.
-   **Portfolio Allocation**: 35% BTC, 35% ETH, 20% BNB, 10% DOGE.
-   **Daily Limit**: Stop trading after $100 daily loss (2%).
-   **Weekly Limit**: Stop trading after $250 weekly loss (5%).

## Deployment

This application is designed to be deployed to a Raspberry Pi using PM2.

-   **Configuration**: Production environment variables are managed in `ecosystem.config.js`. **You must update the placeholder API keys in this file on the server.**
-   **Deployment Script**: The `./scripts/deploy.sh` script automates the process of building the frontend, syncing files, installing dependencies, and reloading the application on the remote server.

### Manual Update Steps

1.  SSH to the host: `ssh {user}@{host}`
2.  Navigate to the project directory: `cd /opt/crypto-trading-bot`
3.  Pull the latest changes: `git pull origin main`
4.  Install dependencies: `npm install --prefix backend --production`
5.  Build the frontend: `npm run build:frontend`
6.  Run database migrations: `npm run db:migrate`
7.  Reload the app with PM2: `pm2 reload ecosystem.config.js`

### Verifying the Deployment

-   Check PM2 status: `pm2 status` or `./scripts/status.sh`
-   View live logs: `pm2 logs crypto-trend-bot` or `./scripts/logs.sh`

## API Endpoints

### Trading (`/api/trading/`)

-   `GET /status`: System status and initialization state.
-   `GET /portfolio`: Current portfolio balance and positions.
-   `GET /signals`: Recent trading signals.
-   `GET /trades`: Trade history.
-   `GET /prices`: Current market prices.
-   `POST /start`, `POST /stop`: Control the trading engine.
-   `POST /config`: Update trading configuration.

### Management (`/api/management/`)

-   `GET /health`: Detailed system health check.
-   `GET /system`: System information and metrics.
-   `GET /logs`: Application logs.

## Troubleshooting

-   **API Key Errors (`Invalid API-key...`)**:

    -   Ensure `BINANCE_API_KEY` and `BINANCE_API_SECRET` are correct in your `.env` (development) or `ecosystem.config.js` (production).
    -   In your Binance API settings, make sure the key has "Enable Reading" permissions.
    -   If you have IP restrictions enabled, ensure your server's IP is whitelisted.

-   **WebSocket Connection Fails / No Live Price Updates**:
    -   The application has a fallback to HTTP polling, so it may seem to work. Check the logs for WebSocket errors.
    -   This is often caused by the `node-binance-api` library returning `BigNumber` objects that cannot be parsed. Ensure the client is initialized with a custom `json_parse` function to handle this.
    -   Check for firewall or network issues blocking the WebSocket protocol (`wss://`).
