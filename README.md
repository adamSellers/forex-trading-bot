# Crypto Trend Trading Bot (V2 Smart Engine)

A production-ready, full-stack cryptocurrency trend-following bot built for the Raspberry Pi 5. It features a robust **Live Trading Engine**, advanced risk management with "Zombie Position" protection, and a real-time React Dashboard for full control.

![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg)  
![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)  
![Node.js Version](https://img.shields.io/badge/node-v22%2B-green.svg)

![Dashboard Screenshot](docs/dashboard-preview.png)

This project is a sophisticated trend-following system executing a **SuperTrend + ADX Momentum** strategy. It is designed for "set and forget" operation with built-in fail-safes against network outages and API drift. Unlike static bots, this system allows for **Dynamic Asset Allocation**, letting you rebalance your portfolio on the fly via the UI.

## ✨ Key Features

-   **🛡️ Robust Live Engine**:

    -   **"Zombie Killer" Logic**: Automatically detects and repairs database/exchange mismatches (e.g., trades sold during a network timeout).
    -   **Atomic Execution**: Ensures local database state always matches Binance reality to prevent "death loops."
    -   **Force Exit**: Manual override button to panic-sell individual positions instantly.

-   **⚡ Dynamic Asset Management**:

    -   **Live Rebalancing**: Adjust capital allocation per asset (e.g., 0% BNB, 50% ETH) instantly without restarting.
    -   **Watchlist Mode**: Assets set to 0% allocation are tracked for signals but not traded.
    -   **Allocation Validation**: Prevents buying assets with 0% assigned capital (Nullish Coalescing fix).

-   **📈 Momentum Strategy (SuperTrend)**:

    -   **Trend Following**: Enters when SuperTrend flips GREEN.
    -   **Filters**:
        -   **ADX > 25**: Ensures the trend has sufficient strength.
        -   **RSI < 75**: Prevents buying at the absolute top (overbought filter).
    -   **Risk Management**: Fixed % Stop Loss or ATR-based Trailing Stops.

-   **📊 Real-Time Dashboard**:
    -   **System Health**: Monitors CPU/RAM, API Latency, and Service Uptime.
    -   **Live Telemetry**: WebSocket feeds for price updates, PnL tracking, and trade history.
    -   **Notification Center**: Built-in Email Alert configuration (Gmail/SMTP).

## 🚀 Getting Started

### 1. Installation

```bash
# Clone the repository
git clone [https://github.com/yourusername/crypto-trend-bot.git](https://github.com/yourusername/crypto-trend-bot.git)
cd crypto-trend-bot
```

# Run the automated production installer

```bash
./clean-install.sh
```

### **2. Secure Configuration**

Generate your encrypted secrets file. You will need your Binance API Key and Secret.

```bash

./scripts/setup-secrets.sh
```

### **3. Launch**

```bash
# Start the full stack (Backend + Frontend) via PM2
pm2 start ecosystem.config.js --env production
```

Access the dashboard at http://your-pi-ip:3000.

##

**🏗 System Architecture**

The application follows a Service-Oriented Architecture (SOA) optimized for reliability.

Code snippet

graph TD  
 A[React Dashboard] <-->|Socket.IO| B(TradingController)  
 B --> C{TradingService}  
 C --> D[BinanceDataService]  
 C --> E[LiveTradingEngine]  
 C --> F[SignalGenerator]  
 E -->|Executes| G[Binance API]  
 E -->|Persists| H[(SQLite DB)]  
 F -->|Feeds| E  
 D -->|Feeds| F

## **🛠 Configuration Guide**

### **1. The Strategy (SuperTrend Momentum)**

The bot uses a "Momentum Sniper" strategy tuned for trending markets.

-   **Entry:** SuperTrend (10, 3) flips **GREEN** + ADX > 20.
-   **Exit:** SuperTrend flips **RED** OR Stop Loss hit.
-   **Filters:** RSI < 75 (Avoid FOMO buying).

### **2. Allocation Logic**

Control how much capital goes to each asset via the **Portfolio Tab**.

-   **Example:**
    -   Total Capital: $1,000
    -   ETH Allocation: 50% ($500 max position)
    -   SOL Allocation: 50% ($500 max position)
    -   BNB Allocation: 0% (Watch only, no buys)

### **3. Notifications**

Enable email alerts in the **Notifications Tab** to receive real-time buy/sell reports. Requires a Gmail App Password.

##

**⚠️ Disclaimer**

USE AT YOUR OWN RISK.  
Cryptocurrency trading involves significant risk of financial loss. This software is provided "as is" with no warranty. The authors are not responsible for any financial losses incurred while using this bot. Always start with small capital to verify stability.
