# Crypto Trend Trading Bot (V2 Smart Engine)

A production-ready, full-stack cryptocurrency trading bot with live/paper trading engines, advanced risk management, email notifications, and a comprehensive real-time dashboard.

![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)
![Node.js Version](https://img.shields.io/badge/node-v22%2B-green.svg)

![Dashboard Screenshot](docs/dashboard-preview.png)

This project is a sophisticated, full-stack cryptocurrency trend-following bot designed for both simulation and live trading on Binance. It combines a Node.js backend for data processing and trade execution with a real-time React dashboard for monitoring and configuration. The architecture is optimized for low-latency execution on ARM64 hardware (Raspberry Pi 5).

## ✨ Features

-   **Dual Trading Modes**:
    -   **Live Trading Engine**: Execute real trades on your Binance account with real money.
    -   **Paper Trading Engine**: Simulate trades with a virtual portfolio, tracking detailed P&L without financial risk. State is persisted to disk to survive restarts.
-   **Advanced Signal Generation**:
    -   **Multi-Indicator Strategy**: Combines EMA crossovers (20/50), RSI filters (30/70), and ADX trend strength validation.
    -   **Golden Config**: Pre-tuned for BTC, ETH, BNB, and DOGE based on historical backtesting (ADX > 30, TP 3.0 ATR).
    -   **Volatility Filtering**: Uses Average True Range (ATR) to size positions dynamically and avoid chop.
-   **Sophisticated Order & Risk Management**:
    -   **Dynamic Position Sizing**: Automatically calculates order size based on risk percentage (e.g., 2% per trade) relative to the asset's volatility.
    -   **Ghost Trade Protection**: Atomic execution logic verifies wallet balances before and after trades to prevent database/exchange desync.
    -   **Trailing Stops**: Secures profits by trailing the price movement once a trade moves in favor.
-   **Real-Time Notifications**:
    -   **Email Alerts**: Instant HTML email notifications for every Buy and Sell execution via secure SMTP (Gmail supported).
-   **Rich React Dashboard**:
    -   **Live Price Charts** with real-time EMA overlays.
    -   **Portfolio Overview** showing real Binance wallet balances vs. virtual paper trading performance.
    -   **Signal Widget** displaying live ADX strength and trend direction for all tracked assets.
    -   **System Health** banner monitoring data collection depth and API latency.
    -   **Full Configuration UI** to adjust strategies, risk limits, and notification settings on the fly.
-   **Secure & Persistent**:
    -   **Encrypted Secrets**: API keys and email credentials are encrypted at rest using OpenSSL (`.enc` files) and decrypted only in memory at runtime.
    -   **Persistent Database**: All signals and trades are stored in SQLite for audit trails and analytics.
-   **Production-Ready Deployment**:
    -   Optimized for Raspberry Pi 5 (ARM64) with Node.js v22.
    -   **Zero-Downtime Updates**: `deploy.sh` script handles updates without wiping local data.
    -   **Automated Maintenance**: Scripts for log rotation and nightly database backups.

## Tech Stack

-   **Backend**: Node.js, Express.js, Knex.js, Nodemailer
-   **Frontend**: React, Vite, Material-UI, Recharts
-   **Real-time**: Socket.IO (WebSockets)
-   **Database**: SQLite3
-   **API Client**: `node-binance-api`
-   **Process Management**: PM2
-   **Security**: OpenSSL (AES-256-CBC)

## Getting Started

### Local Development

The quickest way to get a local development environment running.

1.  **Prerequisites**: Node.js (v16+ recommended, v22+ for Pi) and `npm`.

2.  **Clone the repository:**

    ```bash
    git clone [https://github.com/adamSellers/crypto-trading-bot.git](https://github.com/adamSellers/crypto-trading-bot.git)
    cd crypto-trading-bot
    ```

3.  **Run the setup script:** This will install all dependencies for both frontend and backend.

    ```bash
    ./scripts/dev-setup.sh
    ```

4.  **Configure Environment**:
    Create a `backend/.env` file with your credentials (for local dev only):

    ```dotenv
    BINANCE_API_KEY=your_key
    BINANCE_API_SECRET=your_secret
    EMAIL_USER=your_email@gmail.com
    EMAIL_PASS=your_app_password
    ```

5.  **Run Migrations & Start**:
    ```bash
    npm run db:migrate
    npm run dev
    ```
    Access the dashboard at `http://localhost:5173`.

### Production Install (Raspberry Pi 5)

For a secure production deployment, use the automated installation scripts.

1.  **Clone & Install**:

    ```bash
    git clone [https://github.com/adamSellers/crypto-trading-bot.git](https://github.com/adamSellers/crypto-trading-bot.git)
    cd crypto-trading-bot
    ./scripts/clean-install.sh
    ```

2.  **Secure Setup**:
    Run the secrets management script to encrypt your credentials. You will need your Binance API keys and Gmail App Password.

    ```bash
    ./scripts/setup-secrets.sh
    ```

3.  **Deploy Updates**:
    To update the code later without wiping data:
    ```bash
    ./scripts/deploy.sh
    ```

## System Architecture

The application follows a Service-Oriented Architecture (SOA). The `TradingService` acts as the brain, orchestrating data from Binance and managing the active trading engine.
