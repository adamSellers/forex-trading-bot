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
-   **24h PnL**: Real-time calculation of your Net Profit/Loss over the last 24 hours.
-   **Live Chart**: Displays real-time price action with EMA(20/50) and SuperTrend overlay. Defaults to **15m** timeframe (switchable to 1H/4H).

### 2. Holdings & Signals Tabs

-   **Holdings**: Manage your open positions.
    -   **EXIT Button (Red)**: **Emergency Use Only**. Immediately sells the asset at market price and removes it from the database. Use this if a trade is stuck.
-   **Signals**: Live feed of strategy decisions.
    -   **Trend / RSI Column**: Shows the market context for every signal.
        -   **BULLISH/BEARISH**: The current SuperTrend direction.
        -   **RSI Value**: Color-coded (Red > 70 is Overbought, Green < 30 is Oversold).
    -   **Strength (ADX)**: Shows the power of the current trend (Values > 25 are strong).

### 3. History Tab

A detailed ledger of all closed trades.

-   **Table View**: Shows Asset, Entry Price, Exit Price, and Realized PnL.
-   **Exit Reason**: Tags indicate _why_ a trade closed (e.g., `STOP LOSS`, `TREND FLIP`, `TAKE PROFIT`).

### 4. Analytics Tab

Visual performance tracking.

-   **Equity Curve**: Visualizes your PnL growth over time.
-   **Trend Strength Analysis**: Compares the average ADX of your winning trades vs. losing trades. Green (Winners) should be higher than Red (Losers).
-   **Asset Performance**: Breakdown of Win Rate, Best Trade, and Worst Trade per coin.

---

## ⚙️ Configuration & Strategy

All settings are applied **instantly** when you click "Save Changes". No restart required.

### 💰 Portfolio Tab (Asset Allocation)

Control _what_ the bot trades and _how much_ money it uses.

-   **Add Asset**: Select a pair (e.g., `NEARUSDT`) to add it to your list.
-   **Allocation Sliders**:
    -   **0%**: **Watchlist Mode**. The bot tracks the price and signals but **will NOT trade**.
    -   **>0%**: **Active Trading**. The bot will use up to this % of your total capital for this specific asset.
    -   _Recommendation_: Set 3 assets to **30%** each to allow them to trade simultaneously.

### 🧠 Strategy Tab (The Brain)

Fine-tune the "SuperTrend Momentum" logic.

-   **Timeframe**: The candle size used for decisions (Default: `15m`).
    -   `15m` is recommended for catching intraday volatility.
-   **Min ADX Strength**: (Default: `25`). The "Trend Floor".
    -   Ensures you don't buy into choppy/sideways markets.
-   **RSI Ceiling**: (Default: `70`).
    -   Prevents buying when an asset is already "overbought" (too expensive too fast).

### 🛡️ Risk Tab (Safety)

-   **Risk Factor**: (Default: `0.98` or 98%). How much of the _allocated_ slice to use per trade.
-   **Stop Loss Type**:
    -   **FIXED**: Hard % drop (Default: `2%`). Simple and safe protection against sudden dumps.
    -   **ATR**: Volatility-based. Adapts to the market.

### 🔔 Notifications Tab

-   **Enable Email Alerts**: Toggle ON to receive real-time emails for every Buy and Sell.
-   **Alert Email**: Enter your destination address (e.g., your personal Gmail).

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
| **No Trades Taking Place** | Allocation is 0% or ADX is too low             | Check **Portfolio Tab** (ensure >0%) and **Strategy Tab** (lower Min ADX to 20 or 25)                                        |
| **"Insufficient Balance"** | Binance wallet empty or funds locked in orders | Check Binance "Open Orders" or deposit USDT                                                                                  |
| **Email Alerts Failing**   | Feature disabled or credentials invalid        | 1. Toggle "Enable Email Alerts" in Config.<br>2. If that fails, re-run `./scripts/setup-secrets.sh` to verify SMTP password. |
