# 📘 V2 Smart Engine - User Manual

This guide covers the operation, configuration, and emergency procedures for the Crypto Trend Trading Bot.

---

## 🖥️ The Dashboard

Access the dashboard at `http://your-pi-ip:3000`.

### 1. Dashboard Tab (Live Terminal)

The command center for real-time monitoring.

-   **System Status**: Top-right chip. `SYSTEM ONLINE` means the backend is connected to the frontend.
-   **Start/Stop Engine**: The big button in the header.
    -   **GREEN (START)**: Connects to Binance, loads wallet balances, and starts processing signals.
    -   **RED (STOP)**: Disconnects from Binance. No new trades will be taken, but open positions remain in the database.
-   **Live Markets**: Sidebar showing the assets you are currently watching.
-   **Force Refresh**: Use the sync icon if the data looks stale (older than 1 minute).

### 2. Holdings Tab (Active Management)

Manage your open positions and wallet.

-   **Bot Positions**: Trades currently managed by the strategy.
    -   **Entry**: The price you bought at.
    -   **Current**: Real-time market price.
    -   **Stop Loss**: The "hard stop" price stored in the database.
    -   **EXIT Button (Red)**: **Emergency Use Only**. Immediately sells the asset at market price and removes it from the database database. Use this if a trade is stuck or you want to manual panic-sell.
-   **Wallet Balances**: Your actual assets on Binance.

### 3. Analytics Tab

Visual performance tracking.

-   **Equity Curve**: Visualizes your PnL growth over time.
-   **Signal Quality**: Shows how many signals resulted in profitable trades.
-   **Filter Efficiency**: A donut chart showing _why_ trades were skipped (e.g., "Choppy Market" means ADX was too low).

---

## ⚙️ Configuration & Strategy

All settings are applied **instantly** when you click "Save Changes". No restart required.

### 💰 Portfolio Tab (Asset Allocation)

Control _what_ the bot trades and _how much_ money it uses.

-   **Add Asset**: Select a pair (e.g., `SOLUSDT`) to add it to your list.
-   **Allocation Sliders**:
    -   **0%**: **Watchlist Mode**. The bot tracks the price and signals but **will NOT trade**.
    -   **>0%**: **Active Trading**. The bot will use up to this % of your total capital for this specific asset.
    -   _Example_: If Total Capital = $1000 and ETH = 50%, the bot will buy up to $500 worth of ETH.

### 🧠 Strategy Tab (The Brain)

Fine-tune the "SuperTrend Momentum" logic.

-   **Timeframe**: The candle size used for decisions (Default: `1h`).
-   **Min ADX Strength**: (Default: `20`). The "Trend Floor".
    -   _Higher (e.g., 30)_ = Fewer trades, only catches strong trends.
    -   _Lower (e.g., 15)_ = More trades, but higher risk of "chop" (fakeouts).
-   **RSI Ceiling**: (Default: `75`).
    -   Prevents buying when an asset is already "overbought" (too expensive too fast).

### 🛡️ Risk Tab (Safety)

-   **Risk Factor**: (Default: `0.98` or 98%). How much of the _allocated_ capital to use per trade.
-   **Stop Loss Type**:
    -   **FIXED**: Hard % drop (e.g., 5%). Simple and safe.
    -   **ATR**: Volatility-based. Adapts to the market (wider stop in volatile markets, tighter in calm ones).

### 🔔 Notifications Tab

-   **Enable Email Alerts**: Toggle ON to receive real-time emails for every Buy and Sell.
-   **Alert Email**: Enter your destination address (e.g., your personal Gmail).
-   **Sender Config**: The _sending_ email credentials (SMTP) were configured during installation via `./scripts/setup-secrets.sh`. To change the sender, you must re-run the secrets setup script.

---

## 🚨 Emergency Procedures

### "Zombie Position" (Sold on Binance, Open in Bot)

If the bot thinks it has a position but you already sold it on Binance:

1.  The bot's **Zombie Killer** logic usually detects this automatically on the next sell attempt and auto-closes the DB record.
2.  **Manual Fix**: Go to **Holdings Tab** and click the red **EXIT** button on the position.

### "Death Loop" (Spamming Errors)

If the logs show thousands of errors per second:

1.  **SSH into Pi**.
2.  Run: `pm2 stop crypto-trend-bot`.
3.  Check logs: `pm2 logs crypto-trend-bot --lines 50`.
4.  If it's an API ban (HTTP 418/429), wait 15 minutes before restarting.

### Factory Reset (The Nuclear Option)

If the database is corrupted or you want a fresh start:

1.  Go to **Configuration > General**.
2.  Scroll to **Danger Zone**.
3.  Click **Factory Wipe**.
4.  **Warning**: This deletes ALL trade history, performance stats, and active positions from the database. It does NOT sell your assets on Binance.

---

## 🔧 Troubleshooting

| Issue                      | Likely Cause                                   | Fix                                                                                                                          |
| :------------------------- | :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **"System Offline"**       | Backend crash or PM2 stopped                   | SSH in and run `pm2 restart crypto-trend-bot`                                                                                |
| **No Trades Taking Place** | Allocation is 0% or ADX is too low             | Check **Portfolio Tab** (ensure >0%) and **Strategy Tab** (lower Min ADX)                                                    |
| **"Insufficient Balance"** | Binance wallet empty or funds locked in orders | Check Binance "Open Orders" or deposit USDT                                                                                  |
| **Email Alerts Failing**   | Feature disabled or credentials invalid        | 1. Toggle "Enable Email Alerts" in Config.<br>2. If that fails, re-run `./scripts/setup-secrets.sh` to verify SMTP password. |
