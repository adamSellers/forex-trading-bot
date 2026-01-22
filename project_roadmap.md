# Forex Trading Bot - Roadmap

This document tracks all planned features, enhancements, and technical improvements.

**Document purposes:**

| Document             | Purpose                          | When to update                            |
| -------------------- | -------------------------------- | ----------------------------------------- |
| `claude.md`          | Current context, in-progress work | During/after active work sessions         |
| `project_roadmap.md` | Future work, feature requests    | When user requests new features           |
| `PROJECT_HISTORY.md` | Completed & deployed features    | After features are deployed to production |

---

## Priority Legend

| Priority   | Meaning                                    |
| ---------- | ------------------------------------------ |
| HIGH       | Critical for launch / blocking other work  |
| MEDIUM     | Important but not blocking                 |
| LOW        | Nice to have / future enhancement          |
| BLOCKED    | Waiting on external dependency             |

---

## Known Issues / Bugs

_No active bugs at this time._

**Recently Fixed (Jan 22, 2026):**
- SELL orders sent positive units (opened LONGs instead of SHORTs) - FIXED
- Trailing stops only worked for BUY trades - FIXED
- SELL stop loss calculation was unreachable code - FIXED

---

## Phase 4 - Backtesting & Optimization

These features were planned but not yet implemented.

| Priority | Feature                  | Notes                                                          |
| -------- | ------------------------ | -------------------------------------------------------------- |
| MEDIUM   | Historical data pipeline | Fetch and store historical candles for backtesting             |
| MEDIUM   | Backtest engine          | Simulate trades against historical data                        |
| MEDIUM   | Walk-forward analysis    | Rolling optimization to avoid overfitting                      |
| LOW      | Genetic algorithm params | Auto-optimize strategy parameters                              |

---

## Trading Enhancements

| Priority | Feature                     | Notes                                                       |
| -------- | --------------------------- | ----------------------------------------------------------- |
| MEDIUM   | Short selling               | Mechanism fixed (Jan 22); requires `enableShorting: true`   |
| MEDIUM   | Whipsaw protection          | Cooldown after consecutive stop-outs (Jan 9 event)          |
| LOW      | Multi-timeframe confirmation | Use 1H + 15M signals for higher conviction entries         |
| LOW      | Trailing stop improvements  | Dynamic trail based on ATR instead of fixed pips            |

---

## Dashboard & Monitoring

| Priority | Feature                    | Notes                                                        |
| -------- | -------------------------- | ------------------------------------------------------------ |
| MEDIUM   | Mobile-responsive dashboard | Responsive CSS for checking on phone                         |
| MEDIUM   | Trade annotations          | Add notes/tags to trades for post-analysis                   |
| LOW      | Weekly P&L email summary   | Auto-send performance report every Sunday                    |
| LOW      | Price alerts               | Notify when price reaches specified levels                   |

---

## Analytics & Reporting

| Priority | Feature                 | Notes                                                          |
| -------- | ----------------------- | -------------------------------------------------------------- |
| MEDIUM   | Equity curve chart      | Visual balance history over time on dashboard                  |
| MEDIUM   | Drawdown tracking       | Max drawdown, current drawdown metrics                         |
| LOW      | Trade duration analysis | How long do winning vs losing trades last?                     |
| LOW      | Time-of-day analysis    | Which hours produce best/worst results?                        |
| LOW      | Trade export to CSV     | For spreadsheet analysis                                       |
| LOW      | Signal history export   | CSV download of all signals for backtesting analysis           |

---

## Technical Improvements

| Priority | Item                           | Notes                                                     |
| -------- | ------------------------------ | --------------------------------------------------------- |
| LOW      | Health check improvements      | Include last trade time, signal age in endpoint           |
| LOW      | Disk space monitoring          | Alert if Pi storage gets low                              |
| LOW      | Uptime tracking                | Log/display how long bot has been running                 |
| LOW      | Log rotation cleanup           | Auto-delete logs older than 30 days                       |

---

## Security Requirements

| Priority | Item                           | Notes                                                     |
| -------- | ------------------------------ | --------------------------------------------------------- |
| HIGH     | Audit API key storage          | Verify encrypted secrets are not exposed in logs          |

---

## Blocked Items

| Item                    | Blocked By                      | Notes                                        |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| Backtest UI             | Historical data pipeline        | Need data before UI makes sense              |
| Parameter optimization  | Backtest engine                 | Need simulation capability first             |

---

## Ideas / Backlog

- [ ] Add more currency pairs (GBP_USD, USD_JPY)
- [ ] Strategy comparison mode (run multiple strategies in parallel on paper)
- [ ] Telegram bot integration for alerts
- [ ] Performance comparison vs benchmark (buy-and-hold)
- [ ] Risk-adjusted position sizing based on recent volatility
- [ ] Session-based trading (only trade during London/NY overlap)
- [ ] Sentiment analysis integration
- [ ] API rate limit monitoring and backoff

---

## Database Changes Tracker

| Change               | Status    | Migration Notes                              |
| -------------------- | --------- | -------------------------------------------- |
| Add trade_notes col  | Planned   | For trade annotation feature                 |
| Add drawdown metrics | Planned   | For drawdown tracking feature                |

---

_Last updated: 2026-01-20_
