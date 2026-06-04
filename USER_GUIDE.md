# Forex Trading Bot - User Guide

A practical guide for understanding and configuring your forex trading bot, written for traders coming from a crypto background.

---

## Table of Contents

1. [Current App Model](#current-app-model)
2. [Forex vs Crypto: Key Differences](#forex-vs-crypto-key-differences)
3. [Understanding Leverage & Margin](#understanding-leverage--margin)
4. [What Are Pips?](#what-are-pips)
5. [Trading Sessions](#trading-sessions)
6. [Strategy Settings](#strategy-settings)
7. [Risk Management Settings](#risk-management-settings)
8. [Position Sizing](#position-sizing)
9. [Stop Loss Configuration](#stop-loss-configuration)
10. [Take Profit (Margin-Based)](#take-profit-margin-based)
11. [Email Notifications](#email-notifications)
12. [S3 Analytics Reports](#s3-analytics-reports)
13. [Engine Activation](#engine-activation)
14. [Monitoring & Commands](#monitoring--commands)
15. [Safety Features](#safety-features)
16. [Troubleshooting](#troubleshooting)

---

## Current App Model

The app now uses a shared runtime for live trading and paper comparison:

- `live`: the active broker-connected strategy run
- `paper_shadow`: the always-on paper mirror paired with the active live selection
- `paper_candidate`: isolated paper runs launched from the Paper view for comparison

There is one active live entry strategy at a time. Existing live positions stay attached to the run that opened them through `ownerRunId`, so switching or promoting strategies affects new entries rather than rewriting ownership of open trades.

The current strategy registry contains:

| Strategy | Role | Live Path |
| --- | --- | --- |
| `supertrend_momentum` | Baseline | Direct dashboard selection |
| `mean_reversion` | Candidate | Paper run, then Promote to Live |
| `range_breakout` | Candidate | Paper run, then Promote to Live |
| `stochastic_divergence` | Candidate | Paper run, then Promote to Live |
| `squeeze_play` | Candidate | Paper run, then Promote to Live |
| `timesfm_directional` | Candidate | Paper run, then Promote to Live; requires TimesFM sidecar forecasts |
| `correlation_divergence` | Candidate | Paper only; not live-promotable today |
| `counter_signal_reversion` | Candidate | Paper run, then Promote to Live |
| `signal_following` | Candidate | Paper run, then Promote to Live |

The older offline backtest/lab workflow is retired. Use the Paper and Analytics views for comparison.

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
leverage: 20; // 20:1 leverage
```

The shared default is 20:1. ASIC allows up to 30:1 for major forex pairs; reducing leverage lowers maximum notional exposure.

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

**Note:** Take profit is optional and disabled by default. When enabled, it uses margin-based targeting (`takeProfitPercent: 0.06`) instead of fixed pips. See [Take Profit section](#take-profit-margin-based) for details.

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

The active live default is **SuperTrend Momentum**, a trend-following strategy that combines SuperTrend, ADX, RSI momentum, ATR sizing context, and optional higher-timeframe confirmation. The app also supports paper candidate strategies in the Paper view. Most candidates are live-capable only after paper review and promotion; `correlation_divergence` is intentionally paper-only today.

### Candidate Strategy Summary

| Strategy | What It Tests | Live Promotion |
| --- | --- | --- |
| `mean_reversion` | Fades stretched moves back toward the mean during ranging conditions | Yes, after paper review |
| `range_breakout` | Looks for continuation after opening-range compression and breakout | Yes, after paper review |
| `stochastic_divergence` | Looks for reversal setups where price divergence and stochastic timing align | Yes, after paper review |
| `squeeze_play` | Looks for directional expansion after low-volatility compression releases | Yes, after paper review |
| `timesfm_directional` | Trades directly from TimesFM forecast direction, confidence, and expected return | Yes, after paper review and sidecar validation |
| `correlation_divergence` | Compares one USD pair against peer USD-factor moves and paper-tests mean reversion | No; paper-only research candidate |
| `counter_signal_reversion` | Fades the first actionable signal from the configured source strategy stack | Yes, after paper review |
| `signal_following` | Follows the first actionable signal from the configured source strategy stack | Yes, after paper review |

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
minAdx: 21
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
-   Current default (21): Good balance for the deployed forex cohort
-   Higher (25-28): Fewer trades, higher quality

#### RSI Filter (Momentum Exhaustion)

```javascript
enableRsiFilter: true,
longRsiMomentumFloor: 52,
shortRsiMomentumCeiling: 50,
freshLongRsiCeiling: 68,
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

The live baseline now uses both momentum floors and overextension ceilings. In plain English: longs need enough bullish RSI momentum but should not be freshly overextended; shorts mirror that with bearish momentum checks.

### Continuation Entry

```javascript
enableContinuationEntry: true,
enableLongContinuationEntry: true,
enableShortContinuationEntry: true,
continuationWindowMs: 14400000,  // 4 hours
continuationPullbackMinAtr: 0.5,
continuationPullbackMaxAtr: 1.5
```

**The problem:** Sometimes a valid flip needs H1 confirmation or a pullback before the entry is worth taking.

**The solution:** Save the setup as pending and wait for higher-timeframe confirmation or a pullback-and-reacceleration sequence inside the configured window.

```
Candle 1:  SuperTrend flips 🟢, H1 not aligned → setup saved as pending
Candle 4:  H1 confirms but move is stretched → wait for pullback
Candle 9:  Pullback stays inside ATR band and price breaks out → ✅ Continuation entry
4 hours+:  Pending expires if setup never confirms
```

**Settings explained:**

-   `continuationWindowMs`: How long to keep the setup alive (4 hours)
-   `continuationPullbackMinAtr`: Minimum pullback depth before reacceleration is meaningful
-   `continuationPullbackMaxAtr`: Maximum pullback depth before the setup is considered damaged

### TimesFM Settings

TimesFM can run in two ways:

- Overlay enrichment for normal strategy signals. Modes are `observe`, `size`, and `veto`.
- Native `timesfm_directional` candidate strategy, which creates entries directly from forecast direction, confidence, and expected return.

Shared defaults:

```javascript
timesFmEnabled: true,
timesFmMode: "observe",
timesFmHorizonBars: 12,
timesFmTimeoutMs: 5000,
timesFmVetoConfidence: 0.75,
timesFmDeadZoneBps: 3
```

The sidecar is fail-open for overlay enrichment. For the native TimesFM Directional strategy, unavailable forecasts produce HOLD signals rather than guessed entries.

---

## Risk Management Settings

These settings protect your capital.

### Risk Per Trade

```javascript
riskPerTrade: 0.01; // 1%
```

This means each trade risks 1% of the available sizing base before leverage and margin caps are applied.

| Account Balance | 1% Risk | Max Loss Per Trade |
| --------------- | ------- | ------------------ |
| $100            | $1      | ~$1                |
| $1,000          | $10     | ~$10               |
| $10,000         | $100    | ~$100              |

**Professional standard:** 1-2% per trade. Never exceed 5%.

### Maximum Capital at Risk

```javascript
maxCapitalAtRisk: 500; // AUD
```

This is a hard cap on the capital base used for risk sizing. Even if the account has more available margin, sizing is capped by this value.

### Maximum Open Positions

```javascript
maxOpenPositions: 2;
```

Limits how many trades can be open simultaneously. The shared default is 2 positions; portfolio exposure is also capped separately.

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
Risk: 1% = $10
Stop Loss: 30 pips
Pip Value: $0.10 per pip per 1,000 units

Position = $10 / (30 × $0.0001) = ~3,333 units
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
stopLossAtrMultiplier: 2.0,
minStopLossPips: 15
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

## Take Profit (Margin-Based)

```javascript
enableTakeProfit: false,
takeProfitPercent: 0.06  // 6% of margin used when enabled
```

Take profit is disabled by default. When enabled, it uses a **margin-based approach** rather than fixed pips or account-balance targeting.

**How it works:**

```
Target Profit = Margin Used × takeProfitPercent
TP Price = Entry Price + (Target Profit / Units)

Example (with $46 margin used and 850 units EUR_USD):
Target = $46 × 0.06 = $2.76
Price Change = $2.76 / 850 = 0.00325
TP Price = 1.1050 + 0.00325 = 1.10825 (~32.5 pips above entry)
```

**Key behaviors:**
- TP order is set on Oanda at entry time (server-side execution, no lag)
- Scales with actual margin used by that trade
- Can be adjusted from 2% to 15% via UI slider
- Coexists with signal reversal exits (whichever comes first)

| Setting | Range | Description |
|---------|-------|-------------|
| `enableTakeProfit` | true/false | Enable/disable the feature |
| `takeProfitPercent` | 0.02-0.15 | Target as percentage of margin used |

**Why margin-based instead of fixed pips?**
- Adapts to actual trade size and leverage
- Prevents the issue of trades reaching large unrealized profits but exiting small due to lagging signal reversals

---

## Email Notifications

Get notified on your phone/email when trades open and close.

### Setup

1. **Configure Gmail App Password** (one-time setup on Pi):
   - Go to https://myaccount.google.com/apppasswords
   - Generate an App Password for "Mail"
   - Run `setup-secrets.sh` on the Pi and enter credentials when prompted

2. **Enable in Dashboard**:
   - Go to Settings → Notifications
   - Toggle "Email Alerts" ON
   - Enter your email address
   - Click "Send Test" to verify it works

### Alert Types

| Event | What You Receive |
|-------|------------------|
| Trade Opened | Pair, entry price, stop loss, take profit, units |
| Trade Closed (win) | P/L in AUD and pips, exit reason, hold time |
| Trade Closed (loss) | P/L in AUD and pips, exit reason, hold time |

### Example Alerts

**Trade Opened:**
```
Subject: OPENED: EUR_USD @ 1.09234

Pair: EUR_USD
Direction: BUY
Units: 855
Entry Price: 1.09234
Stop Loss: 1.09134
Take Profit: 1.09887 ($5.55)
Signal: FRESH_FLIP
Strength: 78%
```

**Trade Closed:**
```
Subject: CLOSED: EUR_USD +$5.50 AUD

Pair: EUR_USD
Entry: 1.09234
Exit: 1.09887
Units: 855
P/L: +$5.50 AUD (+65.3 pips)
Exit Reason: TAKE_PROFIT
Hold Time: 4h 23m
```

### Configuration

```javascript
enableEmailAlerts: true,     // Enable/disable alerts
alertEmail: "you@example.com" // Recipient address
```

---

## S3 Analytics Reports

Automated upload of performance analytics to AWS S3 for historical tracking and external analysis.

### What Gets Uploaded

The scheduler automatically uploads:
- **Daily reports** - At midnight UTC (comprehensive 24h analytics)
- **Weekly reports** - On Sundays (7-day performance summary)

Reports include: summary stats, pair performance, session analysis, equity curve, ADX correlation, and trade breakdown.

### Dashboard Access

Go to **Settings → Notifications** to see:
- Scheduler status (Running/Stopped)
- Connected S3 bucket name
- Last Daily/Weekly upload timestamps
- Manual upload button with period selector

### Manual Uploads

You can trigger manual uploads anytime via the dashboard:
1. Go to Settings → Notifications
2. Select period (24h, 7d, or 30d)
3. Click "Upload Now"

### S3 Bucket Structure

```
forex-bot-log-stash/
├── daily/
│   └── 2026-01-10/
│       └── analytics.json
├── weekly/
│   └── 2026/
│       └── week-02/
│           └── analytics.json
└── manual/
    └── 2026-01-10T05-27-21-599Z/
        └── analytics-24h.json
```

### API Commands

```bash
# Check scheduler status
curl http://localhost:3101/api/reports/status

# Manual upload
curl -X POST http://localhost:3101/api/reports/upload \
  -H "Content-Type: application/json" \
  -d '{"period": "7d"}'
```

### Configuration

Set via environment variables (through `setup-secrets.sh`):

| Variable | Description |
|----------|-------------|
| `ENABLE_S3_ANALYTICS` | Set to `true` to enable |
| `S3_BUCKET_NAME` | Your S3 bucket name |
| `AWS_REGION` | AWS region (e.g., `ap-southeast-2`) |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |

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
    Verify `enableTrading`, `maxCapitalAtRisk`, etc.

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

## Monitoring & Commands

### Check Engine Status

```bash
curl http://localhost:3101/api/engine/status
```

Returns:

-   `isRunning`: Engine active
-   `tradingEnabled`: Will execute trades
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
| Paper runtime               | Shadow and candidate runs test without real money |
| Position limits             | `maxOpenPositions` cap                         |
| Capital limits              | `maxCapitalAtRisk` cap                         |
| Entry validation            | Multiple checks before execution               |
| Signal queue                | Sequential processing prevents race conditions |
| Session filter              | Avoid low-liquidity periods                    |
| ADX filter                  | Avoid choppy markets                           |
| RSI filter                  | Avoid buying tops                              |
| Take profit                 | Optional margin-based TP when enabled          |
| Runtime ownership           | Open live positions stay attached to their owner run |
| Candidate promotion review  | Live-capable candidates promote only from Paper |
| Paper-only research runs    | `correlation_divergence` cannot be promoted unless metadata/code changes |
| TimesFM fail-open overlay   | Sidecar failure does not block normal strategies |
| Email alerts                | Get notified when trades open/close            |
| S3 analytics reports        | Daily/weekly performance uploads to AWS S3     |
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
2. `maxOpenPositions` not reached?
3. Signal ADX >= `minAdx`?
4. Instrument in `assets` array?
5. Within active trading session?
6. Check logs for "Entry rejected" messages

### "Trading engine not available" error

-   Engine failed to start - check backend logs
-   Oanda client failed to initialize - verify API key

### Trades not showing in database

-   Query recent trades via `/api/trades`
-   Confirm backend can write to `backend/data/trading.db`
-   Live stop loss/take profit are managed by Oanda once orders are placed

### Spread seems high

-   Check if you're in an active trading session
-   Major news events widen spreads temporarily
-   Weekend approaching = spreads widen

---

## Quick Reference Card

### Your Current Settings Summary

| Category      | Setting             | Value          |
| ------------- | ------------------- | -------------- |
| **Risk**      | Risk Per Trade      | 1%             |
| **Risk**      | Max Capital at Risk | $500           |
| **Risk**      | Max Open Positions  | 2              |
| **Risk**      | Leverage            | 20:1           |
| **Strategy**  | Timeframe           | 15 minutes     |
| **Strategy**  | Min ADX             | 21             |
| **Strategy**  | RSI Overbought      | 75             |
| **Stop Loss** | Type                | ATR-based      |
| **Stop Loss** | ATR Multiplier      | 2.0            |
| **Stop Loss** | Minimum             | 15 pips        |
| **Trailing**  | Enabled             | Yes            |
| **Trailing**  | Activation          | 20 pips profit |
| **Trailing**  | Distance            | 25 pips        |
| **Take Profit** | Enabled           | No             |
| **Take Profit** | Target when on    | 6% of margin used |
| **TimesFM**   | Mode                | Observe        |
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
    ADX ≥ 21? ──No──► REJECTED
         │ Yes
         ▼
    Momentum + HTF OK? ──No──► Save as PENDING
         │ Yes              │
         ▼                  ▼
    ✅ BUY/SELL SIGNAL   Wait for confirmation or pullback
         │                  │
         ▼                  ▼
    Execute Trade       ✅ CONTINUATION ENTRY
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
| **TimesFM**       | Time-series forecast sidecar used for optional signal context or native directional entries |
| **Trailing Stop** | Stop loss that follows price, locking in profits                  |

---

_Last updated: May 26, 2026_
