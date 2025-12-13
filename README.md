# Crypto Trend Trading Bot (V2 Smart Engine)

A production-ready, full-stack cryptocurrency trend-following bot with live/paper trading engines, advanced risk management, and a self-optimizing portfolio manager.

![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)
![Node.js Version](https://img.shields.io/badge/node-v22%2B-green.svg)

![Dashboard Screenshot](docs/dashboard-preview.png)

This project is a sophisticated trend-following system designed for the Raspberry Pi 5. It features a **React Dashboard** for real-time control and a **Node.js Backend** that executes a momentum-based strategy (ADX + EMA + RSI). Unlike static bots, this system allows for **Dynamic Asset Rotation**, letting you swap underperforming coins for trending winners instantly without downtime.

## ✨ Key Features

-   **Dual Trading Modes**:
    -   **Live Trading**: Real-money execution on Binance with "Ghost Trade" protection.
    -   **Paper Trading**: Zero-risk simulation with persistent P&L tracking.
-   **Dynamic Asset Management**:
    -   **Hot-Swapping**: Add or remove trading pairs (e.g., swap BTC for SOL) instantly via the UI.
    -   **Zero-Downtime**: The backend automatically restarts data streams when the portfolio changes.
    -   **Fine-Grained Control**: Adjust capital allocation per asset (e.g., 35% NEAR, 10% BTC) with 1% precision.
-   **🧠 AI Portfolio Optimizer**:
    -   **Backtesting Engine**: Built-in script analyzes the last 180 days of market data across 20+ top assets.
    -   **Regime Detection**: Identifies which coins are trending vs. chopping to avoid "Regime Bias."
    -   **Strategy Showdown**: Compares your current portfolio against a mathematically optimized one to show potential ROI improvements.
-   **Advanced Risk Engine**:
    -   **Volatility Sizing**: Uses ATR (Average True Range) to calculate stop losses and position sizes dynamically.
    -   **Trend Filtering**: ADX > 30 filter prevents trading during choppy/sideways markets.
    -   **Trailing Stops**: Locks in profits automatically as the price moves in your favor.
-   **Production-Grade Security**:
    -   **Encrypted Secrets**: API keys are AES-256 encrypted at rest.
    -   **Dashboard Auth**: Secure interface for monitoring and configuration.

## 🚀 Getting Started

### 1. Installation

```bash
# Clone the repository
git clone [https://github.com/yourusername/crypto-trend-bot.git](https://github.com/yourusername/crypto-trend-bot.git)
cd crypto-trend-bot

# Run the automated setup (installs dependencies & sets up environment)
./scripts/clean-install.sh


2. Secure Configuration
Generate your encrypted secrets file. You will need your Binance API Key and Secret.

Bash


./scripts/setup-secrets.sh


3. Launch

Bash


# Start the full stack (Backend + Frontend)
npm run start


Access the dashboard at http://localhost:5173.
🧠 Using the Portfolio Optimizer
Don't guess which coins to trade. Let the data decide.
The included optimizer script backtests your strategy against the Top 20 assets on Binance to find the highest probability setups for the current market cycle.
How to Run

Bash


node backend/scripts/optimize-strategy.js


What It Does
Prompts for a timeframe (recommended: 180 days).
Fetches high-resolution candle data for 20+ liquid assets (BTC, ETH, SOL, NEAR, PEPE, etc.).
Simulates your exact trading strategy (ADX > 30, TP 3.0 ATR) on every candle.
Ranks assets by Win Rate, ROI, and Stability.
Outputs a JSON block of the perfect portfolio allocation.
Example Output

Plaintext


🏆 ASSET PERFORMANCE RANKING (180 Days)
-----------------------------------------------------------------
Symbol      | Profit ($) | Return (%) | Win Rate | Trades
-----------------------------------------------------------------
NEARUSDT    | $242.98    | 24.3%      | 67%      | 12
LTCUSDT     | $148.57    | 14.9%      | 48%      | 23
...

⚖️  STRATEGY SHOWDOWN ($10,000 Portfolio)
-----------------------------------------------------------------
Strategy       | Net Profit   | Total ROI | Avg Win Rate
-----------------------------------------------------------------
Current (PRD)  | $471.32      | 4.71%     | 43.0%
Optimized      | $1615.33     | 16.15%    | 55.0%


Workflow: Copy the recommended JSON output, go to the Configuration tab in the dashboard, and adjust your Portfolio Composition to match the winners.
🏗 System Architecture
The application follows a Service-Oriented Architecture (SOA) optimized for the Raspberry Pi 5.

Code snippet


graph TD
    A[React Frontend] -->|Socket.IO| B(TradingController)
    B --> C{TradingService}
    C --> D[BinanceData]
    C --> E[Trading Engine]
    C --> F[Risk Management]
    C --> G[SignalGenerator]
    H[Optimizer Script] -.->|Updates| I[Config JSON]
    I --> C


🛠 Strategy: "The Golden Config"
The bot uses a "Momentum Sniper" strategy tuned for trending markets.
Entry:
Price crosses 20/50 EMA (Trend Change).
AND ADX > 25 (Trend Strength is verified).
AND RSI < 30 (Pullback entry for Longs).
Exit:
Take Profit: 3.0x ATR (Ride the wave).
Stop Loss: 1.5x ATR (Cut losers fast).
Trailing Stop: Activates after 1.5% profit to lock in gains.
⚠️ Disclaimer
USE AT YOUR OWN RISK.
Cryptocurrency trading involves significant risk of financial loss. The "Optimizer" uses historical data, which is not a guarantee of future performance. Always test with Paper Trading mode before risking real capital.
```
