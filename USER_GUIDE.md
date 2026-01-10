# Forex Trading Bot - User Guide

A practical guide for understanding and configuring your forex trading bot, written for traders coming from a crypto background.

---

## Table of Contents

1. [Forex vs Crypto: Key Differences](#forex-vs-crypto-key-differences)
2. [Understanding Leverage & Margin](#understanding-leverage--margin)
3. [What Are Pips?](#what-are-pips)
4. [Trading Sessions](#trading-sessions)
5. [Strategy Settings](#strategy-settings)
6. [Risk Management Settings](#risk-management-settings)
7. [Position Sizing](#position-sizing)
8. [Stop Loss Configuration](#stop-loss-configuration)
9. [Take Profit (Balance-Based)](#take-profit-balance-based)
10. [Engine Activation](#engine-activation)
11. [Monitoring & Commands](#monitoring--commands)
12. [Safety Features](#safety-features)
13. [Troubleshooting](#troubleshooting)

---

## Forex vs Crypto: Key Differences

If you're coming from crypto trading, here are the key differences to understand:

| Aspect       | Crypto (Spot)      | Forex                        |
| ------------ | ------------------ | ---------------------------- |
| Ownership    | You own the asset  | You trade contracts (CFDs)   |
| Leverage     | Usually 1:1 (spot) | 10:1 to 30:1 typical         |
| Market Hours | 24/7/365           | 24/5 (closed weekends)       |
| Volatility   | High (2-10% daily) | Low (0.5-1% daily)           |
| Liquidity    | Varies by coin     | Extremely high (major pairs) |
| Spreads      | Can be high        | Very tight (0.5-1.5 pips)    |

### Why Use Leverage in Forex?

Forex price movements are much smaller than crypto. A "big move" in forex might be 1%, whereas crypto can move 10% in a day. Leverage makes these smaller moves profitable.

```
Crypto:  BTC moves 3% = $1,500 profit on $50,000 position
Forex:   AUD_USD moves 0.3% = $30 profit on $10,000 position
         AUD_USD moves 0.3% with 10x leverage = $300 profit on same capital
```

---

## Understanding Leverage & Margin

### The Basics

**Leverage** allows you to control a large position with a small deposit.

| Leverage | Your Capital | Position Controlled | Movement Impact           |
| -------- | ------------ | ------------------- | ------------------------- |
| 1:1      | $1,000       | $1,000              | 1% move = 1% profit/loss  |
| 10:1     | $1,000       | $10,000             | 1% move = 10% profit/loss |
| 30:1     | $1,000       | $30,000             | 1% move = 30% profit/loss |

**Margin** is the deposit required to open a leveraged position. Think of it as collateral.

```
With 10:1 leverage:
- You have $1,000 in your account
- You can control $10,000 worth of currency
- Your $1,000 is "margin" (collateral)
- If the trade goes against you by 10%, your margin is wiped out
```

### Worst Case Scenarios

| Scenario              | What Happens                                       |
| --------------------- | -------------------------------------------------- |
| Normal loss           | Stop loss triggers, you lose planned amount        |
| Price gaps past stop  | You lose more than planned (filled at worse price) |
| Account goes negative | **Negative Balance Protection** resets to $0       |

**Important:** Under ASIC regulation, retail clients have Negative Balance Protection. You cannot lose more than your deposit. If your account goes negative, the broker absorbs the loss.

### Your Leverage Setting

```javascript
leverage: 10; // 10:1 leverage
```

This is moderate and sensible. ASIC allows up to 30:1 for major forex pairs, but 10:1 gives you room for error.

---

## What Are Pips?

**Pip = "Percentage in Point"** - the smallest standard price movement in forex.

### The Math

For most currency pairs (AUD_USD, EUR_USD, GBP_USD):

```
1 pip = 0.0001 (4th decimal place)

EUR_USD: 1.1746
              ↑
           This digit = 1 pip
```

For JPY pairs (USD_JPY):

```
1 pip = 0.01 (2nd decimal place)

USD_JPY: 150.25
            ↑
         This digit = 1 pip
```

### Pip Value by Position Size

| Position Size | 1 Pip Worth | 10 Pip Move | 30 Pip Move |
| ------------- | ----------- | ----------- | ----------- |
| 100 units     | $0.01       | $0.10       | $0.30       |
| 1,000 units   | $0.10       | $1.00       | $3.00       |
| 10,000 units  | $1.00       | $10.00      | $30.00      |
| 100,000 units | $10.00      | $100.00     | $300.00     |

### Typical Pip Movements

| Timeframe        | Typical Range |
| ---------------- | ------------- |
| 1 minute         | 1-3 pips      |
| 15 minutes       | 5-15 pips     |
| 1 hour           | 15-30 pips    |
| 1 day            | 50-100 pips   |
| Major news event | 50-200 pips   |

### Pips in Your Config

| Setting                      | Value | Meaning                               |
| ---------------------------- | ----- | ------------------------------------- |
| `stopLossPips`               | 30    | Backup fixed stop loss distance       |
| `trailingStopPips`           | 25    | Trail this far behind price           |
| `trailingStopActivationPips` | 20    | Start trailing after this much profit |

**Note:** Take profit now uses balance-based targeting (`takeProfitPercent: 0.06`) instead of fixed pips. See [Take Profit section](#take-profit-balance-based) for details.

---

## Trading Sessions

Unlike crypto's 24/7 market, forex activity follows global financial centers.

### The Four Major Sessions

| Session      | UTC Hours     | Characteristics                          |
| ------------ | ------------- | ---------------------------------------- |
| **Sydney**   | 21:00 - 06:00 | AUD pairs most active                    |
| **Tokyo**    | 00:00 - 09:00 | JPY pairs most active, generally quieter |
| **London**   | 07:00 - 16:00 | EUR, GBP pairs active, high volume       |
| **New York** | 12:00 - 21:00 | USD pairs active, highest volume         |

### Session Overlaps (Best Trading Times)

```
UTC Timeline:

Sydney:    ████████████████
Tokyo:          █████████████████
London:                   █████████████████
New York:                       █████████████████
                          ↑
                    OVERLAP = Best liquidity & trends
```

**London/New York Overlap (12:00-16:00 UTC)** is the most active period with:

-   Tightest spreads
-   Highest volume
-   Strongest trends
-   Best execution

### Why Sessions Matter

| Active Session  | Spread              | Trends          | Risk     |
| --------------- | ------------------- | --------------- | -------- |
| Major session   | Tight (0.5 pips)    | Real, tradeable | Normal   |
| Session overlap | Tightest (0.3 pips) | Strongest       | Normal   |
| Off-hours       | Wide (1-2 pips)     | Choppy, random  | Higher   |
| Weekend         | Market closed       | N/A             | Gap risk |

### Session Filter Setting

```javascript
enableSessionFilter: true,
activeSessions: ["sydney", "tokyo", "london", "newyork"]
```

When enabled, the bot only enters trades during selected sessions. With all four sessions selected, you're covered from 21:00 UTC to 21:00 UTC the next day (essentially 24 hours on weekdays).

**Recommendation:** Enable session filter with all 4 sessions selected. This protects you from the quiet gap between New York close and Sydney open.

---

## Strategy Settings

The bot uses a **SuperTrend + ADX Momentum** strategy - a trend-following approach that enters when trends flip direction.

### Timeframe

```javascript
timeframe: "15m";
```

| Timeframe | Trade Duration   | Signal Frequency | Best For          |
| --------- | ---------------- | ---------------- | ----------------- |
| 5m        | Minutes to hours | Many signals     | Scalping          |
| **15m**   | Hours to days    | Moderate         | **Swing trading** |
| 1h        | Days to weeks    | Few signals      | Position trading  |

**15-minute** is the sweet spot: filters out noise while catching meaningful moves.

### SuperTrend Parameters

SuperTrend is your core trend indicator - a dynamic line that flips when trend changes.

```javascript
supertrendPeriod: 10,    // ATR lookback period
supertrendMultiplier: 3.0 // Band distance multiplier
```

**Visual representation:**

```
Price:       ~~~~\/\/\/~~~~

SuperTrend:  ___________/‾‾‾‾‾‾‾
             🔴 BEARISH  🟢 BULLISH
                       ↑
                 FLIP = BUY SIGNAL
```

| Parameter  | Lower Value                      | Higher Value                   |
| ---------- | -------------------------------- | ------------------------------ |
| ATR Period | More sensitive, more signals     | Smoother, fewer signals        |
| Multiplier | Band closer to price, more flips | Band further away, fewer flips |

**Recommended values:** Period 10, Multiplier 3.0 (these are industry standard)

### Entry Filters

These filters BLOCK trades that don't meet quality criteria.

#### ADX Filter (Trend Strength)

```javascript
enableAdxFilter: true,
minAdx: 22
```

**ADX (Average Directional Index)** measures trend strength, not direction:

-   0-20: No trend (choppy, ranging market)
-   20-30: Developing trend
-   30-50: Strong trend
-   50+: Very strong (possibly exhausted)

**How it works:**

```
SuperTrend flips 🟢 + ADX = 18:  ❌ Blocked - "Trend too weak"
SuperTrend flips 🟢 + ADX = 25:  ✅ Allowed - "Strong trend confirmed"
```

**Tuning guide:**

-   Lower (18-20): More trades, more false signals
-   Standard (22): Good balance for forex
-   Higher (25-28): Fewer trades, higher quality

#### RSI Filter (Momentum Exhaustion)

```javascript
enableRsiFilter: true,
rsiOverbought: 75,
rsiOversold: 30
```

**RSI (Relative Strength Index)** measures momentum:

-   Below 30: Oversold (might bounce up)
-   30-70: Neutral zone
-   Above 70: Overbought (might pull back)

**How it works:**

```
SuperTrend flips 🟢 + RSI = 80:  ❌ Blocked - "Already overbought"
SuperTrend flips 🟢 + RSI = 55:  ✅ Allowed - "Room to run"
```

This prevents buying at the top of a move.

### Continuation Entry

```javascript
enableContinuationEntry: true,
continuationWindowMs: 14400000,  // 4 hours
continuationRsiThreshold: 70,
continuationMaxPriceDeviation: 0.02  // 2%
```

**The problem:** Sometimes SuperTrend flips but RSI is too high, blocking entry. Then price keeps going and you miss the move.

**The solution:** Save the blocked signal as "pending" and enter later when RSI cools down.

```
Candle 1:  SuperTrend flips 🟢, RSI = 78 → ❌ Blocked, saved as pending
Candle 10: RSI drops to 65 → ✅ Continuation entry triggered!
4 hours+:  Pending expires if RSI never cooled
```

**Settings explained:**

-   `continuationWindowMs`: How long to wait for RSI cooldown (4 hours)
-   `continuationRsiThreshold`: RSI must drop below this (70)
-   `continuationMaxPriceDeviation`: Cancel if price moved more than 2% from original signal

---

## Risk Management Settings

These settings protect your capital.

### Risk Per Trade

```javascript
riskPerTrade: 0.02; // 2%
```

This means each trade risks 2% of your account balance.

| Account Balance | 2% Risk | Max Loss Per Trade |
| --------------- | ------- | ------------------ |
| $100            | $2      | ~$2                |
| $1,000          | $20     | ~$20               |
| $10,000         | $200    | ~$200              |

**Professional standard:** 1-2% per trade. Never exceed 5%.

### Maximum Capital at Risk

```javascript
maxCapitalAtRisk: 100; // AUD
```

This is a hard cap. Even if 2% of your balance exceeds this, you won't risk more than $100 per trade.

### Maximum Open Positions

```javascript
maxOpenPositions: 2;
```

Limits how many trades can be open simultaneously. With 2 positions at 2% risk each, your maximum exposure is 4% of account.

### Maximum Portfolio Exposure

```javascript
maxPortfolioExposure: 0.5; // 50%
```

Total account percentage that can be deployed across all positions.

---

## Position Sizing

How the bot calculates trade size.

### Position Size Method

```javascript
positionSizeMethod: "RISK"; // or "FIXED"
```

#### RISK Method (Recommended)

Calculates position size so you risk exactly `riskPerTrade` percentage on each trade.

```
Formula:
Position Size = Risk Amount / (Stop Loss Pips × Pip Value)

Example:
Account: $1,000
Risk: 2% = $20
Stop Loss: 30 pips
Pip Value: $0.10 per pip per 1,000 units

Position = $20 / (30 × $0.0001) = ~6,666 units
```

**Benefits:**

-   Consistent risk regardless of stop loss distance
-   Wider stop = smaller position
-   Tighter stop = larger position
-   Dollar risk stays the same

#### FIXED Method

Always trades a fixed number of units regardless of stop loss.

```javascript
fixedPositionUnits: 1000;
```

**Drawbacks:**

-   Inconsistent risk
-   A 50-pip stop loses more than a 20-pip stop
-   Not recommended for serious trading

---

## Stop Loss Configuration

### Stop Loss Type

```javascript
stopLossType: "ATR"; // or "FIXED"
```

#### ATR-Based Stop Loss (Recommended)

```javascript
stopLossType: "ATR",
stopLossAtrMultiplier: 2.0
```

**ATR (Average True Range)** measures recent volatility. Your stop loss adapts to market conditions:

| Market Condition      | ATR     | Stop Loss (2.0×) |
| --------------------- | ------- | ---------------- |
| Quiet (Asian session) | 15 pips | 30 pips          |
| Normal                | 25 pips | 50 pips          |
| Volatile (news)       | 50 pips | 100 pips         |

**Multiplier guide:**

-   1.5×: Tighter stops, more stopouts, less loss per trade
-   2.0×: Standard, good balance
-   2.5×: Wider stops, fewer stopouts, more loss per trade

#### Fixed Pip Stop Loss

```javascript
stopLossType: "FIXED",
stopLossPips: 30
```

Always sets stop loss 30 pips from entry. Doesn't adapt to volatility.

### Trailing Stop

```javascript
enableTrailingStops: true,
trailingStopPips: 25,
trailingStopActivationPips: 20
```

**How trailing stops work:**

1. Trade opens with initial stop loss
2. Price moves in your favor
3. After `trailingStopActivationPips` (20 pips) profit, trailing begins
4. Stop loss follows price, staying `trailingStopPips` (25 pips) behind
5. Stop only moves UP (for long trades), never down
6. Price reverses → trailing stop catches the exit

```
Entry: 0.6700
Initial Stop: 0.6650 (50 pips)

Price rises to 0.6720 (+20 pips) → Trailing activates
New Stop: 0.6695 (25 pips behind)

Price rises to 0.6750 (+50 pips)
New Stop: 0.6725 (25 pips behind)

Price falls to 0.6725 → Stop triggered
Result: +25 pips profit instead of +50, but locked in gains
```

---

## Take Profit (Balance-Based)

```javascript
enableTakeProfit: true,
takeProfitPercent: 0.06  // 6% of account balance
```

The take profit feature uses a **balance-based approach** rather than fixed pips. This creates a consistent 1:3 risk:reward ratio with your 2% risk per trade.

**How it works:**

```
Target Profit = Account Balance × takeProfitPercent
TP Price = Entry Price + (Target Profit / Units)

Example (on $100 account with 850 units EUR_USD):
Target = $100 × 0.06 = $6.00
Price Change = $6.00 / 850 = 0.00706
TP Price = 1.1050 + 0.00706 = 1.1121 (~70 pips above entry)
```

**Risk:Reward calculation:**
- Risk: 2% of balance (~$2 on $100 account)
- Reward: 6% of balance (~$6 on $100 account)
- **R:R = 1:3** (only need 25% win rate to break even)

**Key behaviors:**
- TP order is set on Oanda at entry time (server-side execution, no lag)
- Scales automatically with account balance (larger account = larger TP target)
- Can be adjusted from 2% to 15% via UI slider
- Coexists with signal reversal exits (whichever comes first)

| Setting | Range | Description |
|---------|-------|-------------|
| `enableTakeProfit` | true/false | Enable/disable the feature |
| `takeProfitPercent` | 0.02-0.15 | Target as percentage of balance |

**Why balance-based instead of fixed pips?**
- Adapts to your account size automatically
- Maintains consistent risk:reward ratio
- Prevents the issue of trades reaching large unrealized profits but exiting small due to lagging signal reversals

---

## Engine Activation

### Pre-Flight Checklist

Before enabling trading, verify:

1. **Engine is running:**

    ```bash
    curl http://localhost:3101/api/engine/status
    ```

    Look for: `"isRunning": true`

2. **Oanda is connected:**

    ```bash
    curl http://localhost:3101/api/account
    ```

    Should show your balance

3. **Signals are generating:**

    ```bash
    curl http://localhost:3101/api/signals
    ```

    Should show current signals for your pairs

4. **Config is correct:**
    ```bash
    curl http://localhost:3101/api/config
    ```
    Verify `tradingMode`, `maxCapitalAtRisk`, etc.

### Enabling Trading

Via frontend: Use the "Enable Trading" switch in General settings

Via API:

```bash
curl -X POST http://localhost:3101/api/trading/start
```

### Disabling Trading

Via frontend: Toggle "Enable Trading" off

Via API:

```bash
curl -X POST http://localhost:3101/api/trading/stop
```

### Paper vs Live Mode

```javascript
tradingMode: "paper"; // or "live"
```

| Aspect          | Paper Mode              | Live Mode         |
| --------------- | ----------------------- | ----------------- |
| Real money      | No                      | Yes               |
| Oanda execution | Simulated               | Real orders       |
| Stop loss       | Bot monitors internally | Oanda server-side |
| Database `mode` | `paper`                 | `live`            |
| Use for         | Testing strategy        | Real trading      |

**Recommendation:** Test in paper mode for 24-48 hours before going live.

---

## Monitoring & Commands

### Check Engine Status

```bash
curl http://localhost:3101/api/engine/status
```

Returns:

-   `isRunning`: Engine active
-   `tradingEnabled`: Will execute trades
-   `tradingMode`: paper/live
-   `openPositions`: Current open trades count
-   `stats`: Signals received, trades executed, errors

### Check Open Trades

```bash
curl http://localhost:3101/api/engine/trades
```

### Check Trade History

```bash
curl http://localhost:3101/api/trades
```

### View Current Signals

```bash
curl http://localhost:3101/api/signals
```

### Check Account

```bash
curl http://localhost:3101/api/account
```

### Sync with Oanda

If trades get out of sync:

```bash
curl -X POST http://localhost:3101/api/engine/sync
```

### Reset Engine Stats

```bash
curl -X POST http://localhost:3101/api/engine/reset-stats
```

---

## Safety Features

The bot includes multiple safety layers:

| Feature                     | Description                                    |
| --------------------------- | ---------------------------------------------- |
| Trading disabled by default | Must explicitly enable                         |
| Paper mode                  | Test without real money                        |
| Position limits             | `maxOpenPositions` cap                         |
| Capital limits              | `maxCapitalAtRisk` cap                         |
| Entry validation            | Multiple checks before execution               |
| Signal queue                | Sequential processing prevents race conditions |
| Session filter              | Avoid low-liquidity periods                    |
| ADX filter                  | Avoid choppy markets                           |
| RSI filter                  | Avoid buying tops                              |
| Take profit                 | Balance-based TP (6% target, 1:3 risk:reward)  |
| Graceful shutdown           | Clean stop with timeout                        |
| Oanda sync                  | Detects externally closed positions            |
| Negative Balance Protection | ASIC requirement, can't lose more than deposit |

### Emergency Stop

Multiple ways to stop trading immediately:

1. **Frontend:** Click "Stop Trading" button
2. **API:** `curl -X POST http://localhost:3101/api/trading/stop`
3. **Config:** Set `enableTrading: false`
4. **Nuclear:** Kill the backend process
5. **Oanda:** Close positions directly in Oanda platform

---

## Troubleshooting

### Engine not executing trades

Check in order:

1. `enableTrading` is `true`?
2. `tradingMode` is set correctly?
3. `maxOpenPositions` not reached?
4. Signal is `BUY`? (engine only goes long)
5. Signal ADX >= `minAdx`?
6. Instrument in `assets` array?
7. Within active trading session?
8. Check logs for "Entry rejected" messages

### "Trading engine not available" error

-   Engine failed to start - check backend logs
-   Oanda client failed to initialize - verify API key

### Trades not showing in database

-   Check `tradingMode` - paper trades have `mode: 'paper'`
-   Query with correct mode: `/api/trades?mode=paper`

### Stop loss not triggering (paper mode)

-   Engine must be running to monitor paper trades
-   If engine stops, paper stop losses won't trigger

### Spread seems high

-   Check if you're in an active trading session
-   Major news events widen spreads temporarily
-   Weekend approaching = spreads widen

---

## Quick Reference Card

### Your Current Settings Summary

| Category      | Setting             | Value          |
| ------------- | ------------------- | -------------- |
| **Mode**      | Trading Mode        | live           |
| **Risk**      | Risk Per Trade      | 2%             |
| **Risk**      | Max Capital at Risk | $100           |
| **Risk**      | Max Open Positions  | 2              |
| **Risk**      | Leverage            | 10:1           |
| **Strategy**  | Timeframe           | 15 minutes     |
| **Strategy**  | Min ADX             | 22             |
| **Strategy**  | RSI Overbought      | 75             |
| **Stop Loss** | Type                | ATR-based      |
| **Stop Loss** | ATR Multiplier      | 2.0            |
| **Trailing**  | Enabled             | Yes            |
| **Trailing**  | Activation          | 20 pips profit |
| **Trailing**  | Distance            | 25 pips        |
| **Take Profit** | Enabled           | Yes            |
| **Take Profit** | Target            | 6% of balance  |
| **Take Profit** | Risk:Reward       | 1:3            |
| **Sessions**  | Filter Enabled      | Yes            |
| **Sessions**  | Active              | All four       |

### Signal Flow

```
Every 60 seconds:
         │
         ▼
    SuperTrend Flipped? ──No──► HOLD
         │ Yes
         ▼
    ADX ≥ 22? ──No──► REJECTED
         │ Yes
         ▼
    RSI < 75? ──No──► Save as PENDING
         │ Yes         │
         ▼             ▼
    ✅ BUY SIGNAL    Wait for RSI < 70
         │             │
         ▼             ▼
    Execute Trade    ✅ CONTINUATION ENTRY
```

### Key Commands

```bash
# Status
curl http://localhost:3101/api/engine/status

# Enable trading
curl -X POST http://localhost:3101/api/trading/start

# Disable trading
curl -X POST http://localhost:3101/api/trading/stop

# View trades
curl http://localhost:3101/api/engine/trades

# Check signals
curl http://localhost:3101/api/signals
```

---

## Glossary

| Term              | Definition                                                        |
| ----------------- | ----------------------------------------------------------------- |
| **ADX**           | Average Directional Index - measures trend strength (0-100)       |
| **ATR**           | Average True Range - measures volatility in price units           |
| **Leverage**      | Multiplier allowing control of larger positions with less capital |
| **Margin**        | Collateral/deposit required to maintain leveraged position        |
| **Pip**           | Smallest price movement (0.0001 for most pairs, 0.01 for JPY)     |
| **RSI**           | Relative Strength Index - measures momentum (0-100)               |
| **Spread**        | Difference between buy and sell price (broker's fee)              |
| **Stop Loss**     | Automatic exit to limit losses                                    |
| **SuperTrend**    | Trend indicator that flips between bullish/bearish                |
| **Trailing Stop** | Stop loss that follows price, locking in profits                  |

---

_Last updated: January 2026_
