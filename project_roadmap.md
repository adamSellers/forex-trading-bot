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

## Active Delivery Program - Shared Strategy Runtime + Shadow Paper

Approved on 2026-03-30. This is now the primary roadmap item and supersedes the older "live-only runtime plus separate lab" direction.

| Priority | Phase | Status | Notes |
| -------- | ----- | ------ | ----- |
| HIGH | Phase 0 - Documentation alignment | Complete | Plan and session docs rewritten around the approved target architecture |
| HIGH | Phase 1 - Strategy catalog + unified run registry | Complete (code) | Canonical five-strategy catalog, `strategy_runs`, unified `runId`/`selectionId` telemetry |
| HIGH | Phase 2 - Shared runtime core + live hot swap + shadow baseline | Complete (code) | One active live entry strategy, ownership-safe switching, default shadow paper run |
| HIGH | Phase 3 - Candidate paper infrastructure + `mean_reversion` + `range_breakout` | Complete (code) | Multiple concurrent candidate runs and the runtime-backed paper comparison shell |
| HIGH | Phase 4 - Remaining strategies + unified analytics | Complete (code) | Added `stochastic_divergence`, `squeeze_play`, and runtime-wide analytics filters |
| HIGH | Phase 5 - Legacy backtest/lab removal | Complete (code) | Removed the retired comparison stack and switched docs/operators to the runtime-only workflow |
| HIGH | Phase 6 - Rollout and monitoring | Planned | Deploy the shared runtime stack and monitor live/shadow/candidate behavior in production |

Program rules:

- Existing live positions stay managed by the strategy run that opened them
- New live strategy selections affect new entries only
- Shadow paper is the default baseline for the active live strategy
- Comparison stays runtime-only; do not reintroduce a parallel backtest/lab production path

---

## Current Enhancement Status (Session Snapshot)

### Completed & Deployed

| Priority | Enhancement | Status | Notes |
| -------- | ----------- | ------ | ----- |
| HIGH | Live-only runtime cleanup | Complete (deployed, transitional baseline) | Useful as the starting point for the new shared runtime migration, but no longer the target end state |
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
| HIGH | Delayed HTF confirmation in live strategy | Complete (deployed) | M15 flips can now wait for H1 alignment instead of being discarded immediately |
| HIGH | Structured signal and trade telemetry | Complete (deployed) | Signals/trades now carry reason codes, pending states, config hash, and reconciliation metadata |
| HIGH | Trade reconciliation + restart-safe stop-state persistence | Complete (deployed) | Breakeven/trailing/reconciliation state now survives persistence and broker-close recovery |
| MEDIUM | Analytics/export expectation-vs-actual reporting | Complete (deployed) | Analytics now separates unique actionable events from cooldown duplicates and exports expectation-vs-actual cohorts |
| MEDIUM | Backtest/live config and continuation parity | Complete (deployed) | Shared defaults and backtest continuation flow now match the live strategy much more closely |

### Next Up (Pre-Rollout)

| Priority | Enhancement | Status | Notes |
| -------- | ----------- | ------ | ----- |
| HIGH | Shared strategy runtime foundation | Complete (code) | Implemented across Phases 1-2; rollout validation remains |
| HIGH | Hot-swappable live strategy selection with ownership-safe exits | Complete (code) | Preserve `ownerRunId` continuity during Phase 6 rollout |
| HIGH | Shadow paper baseline plus concurrent candidate paper runs | Complete (code) | Runtime-backed Paper and Analytics surfaces are ready for rollout validation |
| HIGH | Legacy backtest/lab retirement | Complete (code) | Offline backtest engine/scripts and `backtest_results` have been retired from the supported stack |
| MEDIUM | 2-week live cohort review on March 20 deployment baseline | In progress | Preserve findings as benchmark input while the new strategy runtime is being delivered |

---

## Retired Legacy Backtesting / Lab

| Priority | Feature | Status | Notes |
| -------- | ------- | ------ | ----- |
| MEDIUM | Historical candle helper | Retained (research-only) | `historicalDataService` remains a low-level offline helper, not a supported comparison workflow |
| MEDIUM | Backtest engine and result store | Retired (code) | `backtestEngine`, `backtestRepository`, CLI scripts, and `backtest_results` are removed from the supported stack |
| MEDIUM | Walk-forward analysis | Retired | Do not rebuild this on the legacy backtest path; use runtime paper comparison instead |
| LOW | Genetic algorithm params | Retired | Do not rebuild this on the legacy backtest path |

---

## Trading Enhancements

| Priority | Feature | Status | Notes |
| -------- | ------- | ------ | ----- |
| MEDIUM | Short selling | Complete | Entry direction and filtering fixed |
| MEDIUM | Whipsaw protection | Planned | Cooldown after consecutive stop-outs |
| LOW | Multi-timeframe confirmation | Complete (code) | Shared runtime supports the additional market context required by the current strategy catalog |
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
| HIGH | Preserve long-only / New York-only cohort finding as a comparison benchmark | In progress | Earlier cohort analysis favored long-only and New York. Keep that as a benchmark when reviewing the broader March 20 cohort rather than treating it as the current live deployment. |
| HIGH | Review March 20 broadened 4-pair / short-enabled cohort before further filter tuning | In progress | Current deployed cohort re-enabled shorts, all 4 major sessions, and delayed HTF confirmation. Hold filter thresholds steady until 2-week live review is complete. |

### Production Cohort Findings To Preserve

- 90-day live cohort: 71 closed trades, `-A$30.74` total P&L, `22.5%` win rate, `0.63` profit factor.
- BUY side was near-flat to slightly positive; SELL side drove the loss. Short continuations were the worst entry family.
- New York was the only clearly positive session; Tokyo was strongly negative.
- Higher ADX did not improve results overall, and was especially harmful on SELL trades.
- Continuation entries dominated the book, which means strategy quality is currently determined more by continuation behavior than by fresh flips.

### Current Deployed Cohort (2026-03-20 Baseline)

- Assets: `AUD_USD`, `EUR_USD`, `GBP_USD`, `USD_JPY`
- HTF filter: enabled (`1h`)
- Shorting: enabled
- Short continuation: enabled
- Sessions: `sydney`, `tokyo`, `london`, `newyork`
- Review cadence: compare actual live results to expectation-vs-actual exports after 2 weeks of trading

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
| LOW      | Signal history export   | CSV download of unified runtime signals for offline review     |

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
| MEDIUM | Legacy `backtest_results` retirement migration | Complete (code) | `006_drop_backtest_results.js` removes the retired table during rollout |

---

## Security Requirements

| Priority | Item                           | Notes                                                     |
| -------- | ------------------------------ | --------------------------------------------------------- |
| HIGH     | Audit API key storage          | Verify encrypted secrets are not exposed in logs          |

---

## Blocked Items

| Item                    | Blocked By                      | Notes                                        |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| Parameter optimization  | Walk-forward framework          | Need robust anti-overfitting flow            |

---

## Ideas / Backlog

- [ ] Add more currency pairs beyond the current 4-pair cohort
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
| Add structured signal/trade telemetry columns | Complete (deployed) | Migration `003_add_strategy_telemetry_and_reconciliation.js` |

---

_Last updated: 2026-03-30_
