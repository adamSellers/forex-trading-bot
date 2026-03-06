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

### Completed & Deployed

| Priority | Enhancement | Status | Notes |
| -------- | ----------- | ------ | ----- |
| HIGH | Live-only trading runtime | Complete (deployed) | Removed paper mode from engine/API/UI/docs |
| HIGH | Deployment safety hardening | Complete (deployed) | `update.sh` + `deploy.sh` preserve runtime config, hard-fail migrations, prune WAL/SHM backups |
| HIGH | Enforce `maxPortfolioExposure` in live entry validation | Complete (deployed) | Live entry now rejects when current exposure exceeds configured cap |
| HIGH | Enforce projected post-entry exposure (`maxPortfolioExposure`) | Complete (deployed) | Entry now rejects if projected exposure after new order would breach cap |
| HIGH | Enforce session filter (`enableSessionFilter`, `activeSessions`) | Complete (deployed) | Live entry now requires current UTC time to be inside configured sessions |
| HIGH | Live breakeven logic (`enableBreakeven`) | Complete (deployed) | Live monitor moves SL to entry at trigger pips and syncs to Oanda |
| HIGH | Align stop-loss to actual fill price | Complete (deployed) | SL is recalculated from fill and synced post-open to preserve true risk distance |
| MEDIUM | Holdings stop-status visibility | Complete (deployed) | Current Holdings now shows active protective stop (`TSL` / `BE` / `SL`) + TP |
| LOW | Side performance + short health analytics | Complete (deployed) | Analytics now includes BUY/SELL split, entry-type side breakdown, and SELL health status widget |
| MEDIUM | Test suite stabilization | Complete (deployed) | Backend suite now 272/272 passing |
| HIGH | Continuation ADX hard floor parity (`ADX_SLOPE_RISING`) | Complete (deployed) | Continuations now require ADX slope + ADX threshold in both live and backtest |
| MEDIUM | Strategy Lab/worker parity cleanup | Complete (deployed) | Fixed stale simulation route/socket wiring and removed crypto-biased lab defaults |
| HIGH | Forex migration completion sweep | Complete (deployed) | Lab restored in UI/backend, Binance fee tiers replaced by forex spread/commission model, active UI/ops configs de-crypto'd |

### Not Yet Implemented (High-Value Follow-Up)

| Priority | Enhancement | Status | Notes |
| -------- | ----------- | ------ | ----- |
| HIGH | Improve TP/account-currency conversion model | Complete (deployed) | Live TP uses quote->account conversion with direct/inverse/USD-bridge fallback |
| HIGH | Backtest/live margin realism parity | In progress | Cost parity improved in lab worker; remaining work is margin/exposure behavior alignment in historical engine path |

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

### Live Signal Logic Hardening (Post-Production Review)

| Priority | Feature | Status | Notes |
| -------- | ------- | ------ | ----- |
| HIGH | Directional ADX confirmation in live signal generation | Complete (code) | `signalGenerator` now requires `+DI > -DI` for longs and `-DI > +DI` for shorts, with the result included in live signal payloads. |
| HIGH | Split continuation logic by side | Complete (code) | Long and short continuation flows are now controlled independently, with short continuation disabled by default and no longer sharing the long-side retry path. |
| HIGH | Higher-timeframe live regime filter | Complete (code) | Live signal generation now requires HTF alignment and `OandaDataService` fetches the additional candle granularity needed to evaluate that filter in production. |
| HIGH | Replace loose continuation with pullback-and-reacceleration rules | Complete (code) | Continuations are now setup-driven: valid flip -> wait for pullback -> wait for breakout/breakdown. The old time/price-band retry model is no longer the primary live entry path. |
| MEDIUM | Add side-specific continuation config | Complete (code) | Added `enableLongContinuationEntry` and `enableShortContinuationEntry`, plus new momentum-floor and pullback-depth controls for the redesigned live signal model. |
| HIGH | Add RSI momentum floors to live entries | Complete (code) | Longs now require RSI to already be in bullish territory and shorts require RSI to already be in bearish territory, which is closer to an actual momentum framework than the old “not too extreme” filter. |
| MEDIUM | Add side-specific signal quality analytics | Planned | Extend analytics to track win rate / PnL by side + ADX bucket + RSI bucket so live strategy tuning is based on actual cohort behavior. |
| HIGH | Validate long-only / New York-only live rollout before further signal rewrites | In progress | Production cohort review indicates long-only performs materially better than shorts and New York is the strongest session. Config narrowed first; signal-logic changes should be evaluated against that cleaner cohort. |

### Production Cohort Findings To Preserve

- 90-day live cohort: 71 closed trades, `-A$30.74` total P&L, `22.5%` win rate, `0.63` profit factor.
- BUY side was near-flat to slightly positive; SELL side drove the loss. Short continuations were the worst entry family.
- New York was the only clearly positive session; Tokyo was strongly negative.
- Higher ADX did not improve results overall, and was especially harmful on SELL trades.
- Continuation entries dominated the book, which means strategy quality is currently determined more by continuation behavior than by fresh flips.

---

## Dashboard & Monitoring

| Priority | Feature                    | Notes                                                        |
| -------- | -------------------------- | ------------------------------------------------------------ |
| MEDIUM   | Mobile-responsive dashboard | Responsive CSS for checking on phone                         |
| MEDIUM   | Trade annotations          | Add notes/tags to trades for post-analysis                   |
| LOW      | Compact stop chips on mobile | Optional compact labels/tooltips for `TSL`/`BE`/`SL`/`TP` in Current Holdings |
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
| MEDIUM | Backtest equity curve end-balance parity | Complete (code) | `backtestEngine` now appends final realized equity after `BACKTEST_END` closeouts; prevents chart/summary mismatch |

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

_Last updated: 2026-03-06_
