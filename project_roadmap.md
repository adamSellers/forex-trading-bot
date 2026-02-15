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

## Current Enhancement Status (Session Snapshot)

### Completed In Code (Pending Deployment Verification)

| Priority | Enhancement | Status | Notes |
| -------- | ----------- | ------ | ----- |
| HIGH | Live-only trading runtime | Complete (code) | Removed paper mode from engine/API/UI/docs |
| HIGH | Deployment safety hardening | Complete (code) | `update.sh` + `deploy.sh` preserve runtime config, hard-fail migrations, prune WAL/SHM backups |
| MEDIUM | Test suite stabilization | Complete (code) | Backend suite now 263/263 passing |

### Not Yet Implemented (High-Value Follow-Up)

| Priority | Enhancement | Status | Notes |
| -------- | ----------- | ------ | ----- |
| HIGH | Enforce `maxPortfolioExposure` in live entry validation | Planned | Config exists but not enforced in engine |
| HIGH | Enforce session filter (`enableSessionFilter`, `activeSessions`) | Planned | Config exists but not enforced in engine |
| HIGH | Live breakeven logic (`enableBreakeven`) | Planned | Backtest supports it; live path does not |
| HIGH | Improve TP/account-currency conversion model | Planned | TP model uses simplified AUD conversion |
| HIGH | Backtest/live margin realism parity | Planned | Backtest currently less strict than live margin behavior |

---

## Phase 4 - Backtesting & Optimization

| Priority | Feature | Status | Notes |
| -------- | ------- | ------ | ----- |
| MEDIUM | Historical data pipeline | Complete | Implemented in `historicalDataService` |
| MEDIUM | Backtest engine | Complete | Implemented with CLI/API + result storage |
| MEDIUM | Walk-forward analysis | Planned | Not implemented yet |
| LOW | Genetic algorithm params | Planned | Not implemented yet |

---

## Trading Enhancements

| Priority | Feature | Status | Notes |
| -------- | ------- | ------ | ----- |
| MEDIUM | Short selling | Complete | Entry direction and filtering fixed |
| MEDIUM | Whipsaw protection | Planned | Cooldown after consecutive stop-outs |
| LOW | Multi-timeframe confirmation | Complete (backtest) | M15 fills + H1 signal mode implemented in backtests |
| LOW | Trailing stop improvements | Planned | Dynamic ATR-based trail still pending |

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

| Priority | Item | Status | Notes |
| -------- | ---- | ------ | ----- |
| LOW | Health check improvements | Planned | Include last trade time, signal age in endpoint |
| LOW | Disk space monitoring | Planned | Alert if Pi storage gets low |
| LOW | Uptime tracking | Planned | Log/display how long bot has been running |
| LOW | Log rotation cleanup | Planned | Auto-delete logs older than 30 days |
| HIGH | Preserve runtime config on deploy | Complete (code) | Added to `update.sh` and `deploy.sh` |
| HIGH | Hard-fail migration on deploy | Complete (code) | Added to `update.sh` and `deploy.sh` |

---

## Security Requirements

| Priority | Item                           | Notes                                                     |
| -------- | ------------------------------ | --------------------------------------------------------- |
| HIGH     | Audit API key storage          | Verify encrypted secrets are not exposed in logs          |

---

## Blocked Items

| Item                    | Blocked By                      | Notes                                        |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| Backtest UI             | Product prioritization          | Engine/data now available                    |
| Parameter optimization  | Walk-forward framework          | Need robust anti-overfitting flow            |

---

## Ideas / Backlog

- [ ] Add more currency pairs (GBP_USD, USD_JPY)
- [ ] Strategy comparison mode (run multiple strategies in parallel)
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

_Last updated: 2026-02-15_
