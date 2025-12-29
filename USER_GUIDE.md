# 📘 V3.2 Smart Engine - User Manual

This guide covers the operation, configuration, and emergency procedures for the Crypto Trend Trading Bot (V3.2).

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
    -   **Actionable Badge**: The red notification dot on the tab only appears for **BUY/SELL** signals (ignoring routine HOLDS).

### 3. Analytics Tab

Visual performance tracking.

-   **Equity Curve**: Visualizes your PnL growth over time.
-   **Trend Strength Analysis**: Compares the average ADX of your winning trades vs. losing trades. Green (Winners) should be higher than Red (Losers).
-   **Asset Performance**: Breakdown of Win Rate, Best Trade, and Worst Trade per coin.

---

## 🔬 Strategy Lab (AI Optimization)

**NEW IN V3.2:** A dedicated sandbox for testing and optimizing your strategy using historical data.

### 1. Manual Simulation

Test your current settings against the last 30-120 days of market data.

-   **Run Test**: Click the blue button to run a simulation.
-   **Controls**: Use the sliders in the sidebar to adjust Stop Loss, RSI limits, and Capital.
-   **Result**: Displays an Equity Curve and a Trade Table showing exactly where the bot would have bought and sold.

### 2. AI Auto-Optimize (Genetic Screener)

Let the bot find the best assets for you.

1.  Click **AI AUTO-OPTIMIZE** (Orange Button).
2.  The system will download missing data and test a "Universe" of 15 assets (BTC, ETH, SOL, NEAR, etc.).
3.  **The Report**:
    -   **Asset Leaderboard (Left)**: Shows how each asset performed individually ("All-In" test).
    -   **Dream Team (Right)**: Shows the performance of the **Top 4** assets combined into a diversified portfolio.
4.  **Apply Recommended**: Click the green button to instantly overwrite your Live Configuration with the optimized asset mix and weights.

### 3. Managing Data

-   **Restore DB (Orange Icon)**: Downloads fresh 15m candle data (120 days history) from Binance. Use this if your simulation data feels stale.

---

## ⚙️ Configuration & Strategy

All settings are applied **instantly** when you click "Save Changes". No restart required.

### 💰 Portfolio Tab (Asset Allocation)

Control _what_ the bot trades and _how much_ money it uses.

-   **Add Asset**: Select a pair (e.g., `NEARUSDT`) to add it to your list.
-   **Allocation Inputs**:
    -   You can now **type directly** into the percentage box (e.g., "33") or use the slider.
    -   **0%**: **Watchlist Mode**. The bot tracks the price and signals but **will NOT trade**.
    -   **>0%**: **Active Trading**. The bot will use up to this % of your total capital.
-   **Equity-Based Sizing**:
    -   The system now calculates trade size based on **Total Equity** (Cash + Crypto). This allows you to hold multiple positions (e.g., 3 x 30%) without the 2nd and 3rd trades being "shrunk" by a lack of available cash.

### 🧠 Strategy Tab (The Brain)

Fine-tune the "SuperTrend Momentum" logic.

-   **Min ADX Strength**: (Default: `25`). The "Trend Floor".
    -   Ensures you don't buy into choppy/sideways markets.
-   **RSI Ceiling**: (Default: `70`).
    -   Prevents buying when an asset is already "overbought" (too expensive too fast).
-   **Burst Mode**:
    -   **Toggle ON**: Allows the bot to ignore the ADX threshold if **RSI > 50**.
    -   _Use Case_: Catching extremely fast "pumps" that happen before the trend (ADX) fully establishes itself.

### 🛡️ Risk Tab (Safety)

-   **Risk Factor**: (Default: `0.98` or 98%). How much of the _allocated_ slice to use per trade.
-   **Stop Loss Type**:
    -   **FIXED**: Hard % drop (Default: `2%`). Simple and safe protection against sudden dumps.
    -   **ATR**: Volatility-based. Adapts to the market.

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
