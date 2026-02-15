# Forex Trading Bot - Claude Code Instructions

## Session Continuity

When user says **"continue where we left off"**, check **IN PROGRESS** section for current task state. Before ending a session (context ~60-70%), update IN PROGRESS with clear next steps.

### Prepare for New Session

When user says **"prepare for a new session"**:

1. **Update claude.md** - Add all relevant context, next steps, and current work items to IN PROGRESS section. Ensure enough detail so "continue where we left off" works seamlessly in a new thread.
2. **Update project_roadmap.md** - If new features were discussed or requested during the session, add them to the appropriate section of the roadmap.
3. **Update PROJECT_HISTORY.md** - Move any fully completed AND deployed features from the current session. Ask user for clarification if unsure whether a feature has been deployed.
4. **Prompt user** - Instruct them to start a new thread and say "continue where we left off".

### Multi-Phase Feature Rule

For multi-phase implementations, **stop after each major phase** and:

1. Update the IN PROGRESS section with completed steps and next steps
2. Prompt user: _"Phase X complete. Recommend starting a new thread to preserve context. Say 'continue where we left off' in the new thread."_
3. Include a checkpoint summary of what was done and what's next

This prevents context overflow on large features and ensures clean handoffs between sessions.

### Plan Generation Rule

When generating implementation plans (using plan mode), **always structure plans by phases**:

1. **Break work into phases** - Each phase should be completable within a single session
2. **Include checkpoints** - After each phase, include a checkpoint section with:
    - Verification criteria (tests passing, functionality working)
    - claude.md update instructions
    - Prompt to start new thread: _"Phase X complete. Recommend starting a new thread. Say 'continue where we left off'."_
3. **Session management header** - Include at the top:
    ```
    ## Session Management
    This is a multi-phase feature. To preserve context:
    - **Start implementation in a new session** (say "continue where we left off")
    - **After each phase completion**, update claude.md IN PROGRESS section and prompt user to start a new thread
    - Each phase is designed to be completable within a single session
    ```
4. **Final checkpoint** - Last phase should include deployment readiness prompt

This ensures consistent plan structure and clean context handoffs across sessions.

### Update Project Documentation

When user says **"update project documentation"**:

1. **Review current state** - Check the IN PROGRESS section to understand the last feature being worked on and its status
2. **Create a documentation plan** - Prepare a phased plan (following plan generation rules) for updating all relevant docs:
    - `claude.md` - Update IN PROGRESS section with current status
    - `project_roadmap.md` - Mark completed items, add new features discussed
    - `PROJECT_HISTORY.md` - Move fully deployed features to history
    - Any user-facing documentation (guides, READMEs, etc.)
3. **Prompt for new thread** - The documentation plan should be executed in a new thread to preserve context

---

## Git & Deployment Rules

**IMPORTANT**: The user manages all git, deployment, and build commands manually. Claude should:

- **NEVER** run `git commit`, `git push`, or `git add` commands directly
- **NEVER** run deployment commands directly
- **NEVER** run build commands directly
- **ALWAYS** prompt the user with the exact commands to run and explain when to run them

Example:

```
Ready to commit. Run these commands:
git add <files>
git commit -m "feat: add new feature"
git push origin main
```

### Deployment Workflow

**Claude cannot access the Pi directly.** After making changes, Claude should prompt the user to push and deploy.

**Standard Workflow**:

1. **Claude makes changes** in local IDE
2. **User pushes to GitHub** from local machine:
   ```bash
   git push origin main
   ```
3. **User SSHs to Pi** and runs the appropriate script:
   ```bash
   ssh img.oakroad
   cd /opt/forex-trading-bot
   ./scripts/update.sh    # Most changes
   # OR
   ./scripts/deploy.sh    # Major changes (new deps, migrations)
   ```

**Which Script to Use?**

| Script       | Use When                                                          |
| ------------ | ----------------------------------------------------------------- |
| `update.sh`  | Bug fixes, new features, config tweaks (smart rebuild, fast)      |
| `deploy.sh`  | New dependencies, database migrations, fresh start needed         |

---

## Project Overview

**Forex Trading Bot** is a live automated trading system running on a Raspberry Pi 5 (8GB) that executes trades on the Forex market via the Oanda API using a SuperTrend + ADX Momentum strategy.

**Current State**: Phase 3 - Production (Live Trading Active since Jan 19, 2026)

| Item              | Value                            |
| ----------------- | -------------------------------- |
| Broker            | Oanda (ASIC regulated)           |
| Account Type      | Live CFD                         |
| Base Currency     | AUD                              |
| Deployment        | Raspberry Pi 5 (8GB)             |
| Backend Port      | 3101                             |
| Frontend Port     | 3100                             |
| Strategy          | SuperTrend + ADX Momentum (v4.5) |
| Database          | SQLite with WAL                  |
| Production Host   | img.oakroad                      |
| Dashboard         | http://img.oakroad:3100          |
| API               | http://img.oakroad:3101/api      |
| PM2 Process       | forex-backend                    |
| Test Suite        | 253 passing, 0 failing           |

**CRITICAL**: This is a LIVE trading account with real money. Exercise extreme caution with any changes that affect trading logic, position sizing, or order execution.

---

## Core Architecture

### Key Concepts

| Term              | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| SuperTrend        | Trend-following indicator that flips RED/GREEN based on ATR and price       |
| ADX               | Average Directional Index - measures trend strength (≥22 required)          |
| FRESH_FLIP        | Entry signal when SuperTrend flips + ADX/RSI conditions met                 |
| CONTINUATION      | Entry signal when blocked flip's conditions improve within 4 hours          |
| Margin-based TP   | Take profit targets 6% of the margin used for that trade                    |
| WAL Mode          | SQLite Write-Ahead Logging for safe concurrent access                       |

### Trading Strategy (v4.5)

**Signal Generation** (every 60 seconds):
1. Fetch 20 recent 15-min candles per pair
2. Calculate SuperTrend line (ATR multiplier: 3.0)
3. Detect SuperTrend flip (RED → GREEN = potential BUY)
4. Filter by ADX ≥ 22 and RSI < 75
5. Emit BUY signal if all conditions met

**Entry Validation**:
- Trading enabled (`enableTrading: true`)
- Open positions < `maxOpenPositions` (default 2)
- Pair in configured `assets` array
- No existing position for this pair
- Signal ADX >= `minAdx` threshold (22)
- Sufficient margin available (with 20% buffer)

**Position Sizing** (risk-based):
```
stop_loss_pips = max(ATR × 2.0, 12 pips floor)
risk_amount = margin_available × 0.8 × 0.02 (2% risk)
units = risk_amount / (stop_loss_pips × pip_value × current_price)
```

**Exit Management**:
- Take Profit: 6% of margin used
- Stop Loss: ATR-based, minimum 12 pips
- Signal Reversal: SuperTrend flip to RED

---

## Tech Stack

| Layer       | Technology                     | Why                                                              |
| ----------- | ------------------------------ | ---------------------------------------------------------------- |
| Backend     | Node.js + Express + Socket.IO  | Lightweight for Pi, real-time WebSocket for dashboard            |
| Database    | SQLite + Knex.js               | No external DB needed, WAL mode for concurrent access            |
| Trading API | Oanda REST v20                 | ASIC regulated, mature REST API, good documentation              |
| Indicators  | technicalindicators npm        | Battle-tested SuperTrend/ADX calculations                        |
| Frontend    | React + Vite + Material-UI     | Fast builds (critical for Pi), comprehensive dark theme          |
| Charts      | Recharts                       | Lightweight, React-native charting                               |
| Process Mgr | PM2                            | Handles restarts, logging, multiple apps on same Pi              |
| Alerts      | Nodemailer                     | Gmail SMTP for trade notifications                               |
| Reports     | AWS S3 SDK                     | Daily/weekly analytics uploads                                   |
| Testing     | Jest + Nock + Supertest        | Unit tests with HTTP mocking, API integration tests              |

---

## Project Structure

```
forex-trend-bot/
├── backend/
│   ├── server.js                          # Express + Socket.IO entry point
│   ├── knexfile.js                        # Database config (WAL mode)
│   ├── jest.config.js                     # Test configuration
│   ├── data/
│   │   ├── trading.db                     # SQLite database (UNTRACKED)
│   │   ├── trading.db-wal                 # WAL file (UNTRACKED)
│   │   ├── trading_config.json            # Runtime config (UNTRACKED)
│   │   └── trading_config_initial.json    # Config template (tracked)
│   ├── migrations/
│   │   ├── 001_create_forex_tables.js     # Database schema
│   │   └── 002_create_backtest_results.js # Backtest results storage
│   ├── src/
│   │   ├── routes/tradingRoutes.js        # 50+ API endpoints
│   │   ├── services/
│   │   │   ├── LiveTradingEngine.js       # CRITICAL - Trade execution
│   │   │   ├── signalGenerator.js         # CRITICAL - Strategy signals
│   │   │   ├── backtestEngine.js          # Strategy backtesting on historical data
│   │   │   ├── historicalDataService.js   # Oanda candle fetching with cache
│   │   │   ├── Oandaclient.js             # Oanda API wrapper
│   │   │   ├── OandaDataService.js        # Price polling
│   │   │   ├── analyticsService.js        # Performance metrics
│   │   │   ├── configService.js           # Config persistence
│   │   │   ├── emailService.js            # Trade alerts
│   │   │   └── s3ReportScheduler.js       # S3 report uploads
│   │   ├── repositories/
│   │   │   ├── tradeRepository.js         # Trade CRUD
│   │   │   ├── signalRepository.js        # Signal CRUD
│   │   │   └── backtestRepository.js      # Backtest results CRUD
│   │   └── utils/
│   │       ├── logger.js                  # Winston with daily rotation
│   │       └── awsS3Utils.js              # S3 upload helpers
│   └── __tests__/                         # Test infrastructure
│       ├── setup.js                       # Global test setup
│       ├── fixtures/                      # Mock data factories
│       └── helpers/                       # Test utilities
├── frontend/
│   ├── vite.config.js                     # Vite + dev proxy config
│   └── src/
│       ├── App.jsx                        # Navigation router
│       ├── components/
│       │   ├── TradingDashboard.jsx       # Main view
│       │   ├── AnalyticsDashboard.jsx     # Performance charts
│       │   ├── SystemHealth.jsx           # Service monitoring
│       │   └── TradingConfig.jsx          # Settings UI
│       └── config/api.js                  # API client
├── scripts/
│   ├── deploy.sh                          # Full deployment
│   ├── update.sh                          # Smart update
│   ├── backup.sh                          # Manual backup
│   ├── restore.sh                         # Restore from backup
│   ├── setup-secrets.sh                   # API key setup
│   ├── backtest.js                        # CLI backtest runner
│   └── backtestSweep.js                   # Batch parameter sweep runner
├── ecosystem.config.js                    # PM2 configuration
├── claude.md                              # This file
├── project_roadmap.md                     # Future features
└── PROJECT_HISTORY.md                     # Completed features
```

---

## Database Schema

| Table               | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `trades`            | Trade records with entry/exit, P&L, signals          |
| `signals`           | Real-time trading signal log                         |
| `portfolio_snapshots` | Account state history                              |
| `performance`       | Calculated metrics (win rate, Sharpe ratio, etc.)    |
| `trading_config`    | Persisted settings as JSON blob                      |
| `backtest_results`  | Stored backtest run results for comparison            |

Key columns in `trades`:
- `id`, `trade_id`, `oanda_trade_id`, `instrument`, `side`
- `entry_price`, `exit_price`, `entry_time`, `exit_time`
- `pnl_aud`, `pnl_pips`, `swap_aud`
- `units`, `margin_used_aud`, `stop_loss_price`, `take_profit_price`
- `signal`, `entry_type` (FRESH_FLIP/CONTINUATION)
- `is_open`, `exit_reason` (STOP_LOSS/TAKE_PROFIT/SIGNAL/MANUAL)

---

## Roadmap & Future Features

For all planned features, enhancements, and technical improvements, see **[project_roadmap.md](project_roadmap.md)**.

**Document purposes:**

| Document              | Purpose                          | When to update                              |
| --------------------- | -------------------------------- | ------------------------------------------- |
| `claude.md`           | Current context, in-progress work | During/after active work sessions           |
| `project_roadmap.md`  | Future work, feature requests    | When user requests new features             |
| `PROJECT_HISTORY.md`  | Completed & deployed features    | After features are deployed to production   |

When user wants to **add features** → update `project_roadmap.md`
When user wants to **work on a feature** → pick from roadmap, add to IN PROGRESS here

---

## Troubleshooting

| Issue                   | Fix                                                                |
| ----------------------- | ------------------------------------------------------------------ |
| No trades executing     | Check `enableTrading` in config, ADX threshold, open position limit |
| Engine shows stopped    | Race condition - restart backend with `pm2 restart forex-backend`  |
| Database path issues    | Verify `DB_PATH` in ecosystem.config.js                            |
| API connection errors   | Check Oanda API key in secrets                                     |
| Data lost after deploy  | Check `~/forex-backups/` for recent backup                         |
| Margin call warning     | Reduce `maxCapitalAtRisk`, increase `marginBuffer`                 |
| Position size too small | Check logs for `Insufficient margin available`                     |
| Ghost position          | Reconciliation bug - check `reconcilePositions()` in LiveTradingEngine |

### Common Commands

```bash
# View PM2 status
pm2 list

# View logs
pm2 logs forex-backend --lines 200

# Query recent trades
sqlite3 backend/data/trading.db "SELECT * FROM trades ORDER BY entry_time DESC LIMIT 10;"

# Check engine status
curl http://localhost:3101/api/engine/status

# Run tests
cd backend && npm test
```

---

## Workflow Preferences

1. One feature at a time - complete and test before moving on
2. Follow existing code patterns
3. Run tests after changes (`npm test` in backend/)
4. **Code comments for Claude** - Write comments optimized for Claude's understanding upon future code review
5. **Update documentation on completion** - When features are marked complete, update relevant documentation
6. **Safety first** - This is LIVE trading. Confirm before modifying trading logic, position sizing, or order execution
7. **Dependencies** - When adding new `require()` or `import` statements, ALWAYS add the package to `package.json`

---

## Recent Milestones

For full project history and detailed feature implementations, see **[PROJECT_HISTORY.md](PROJECT_HISTORY.md)**.

| Date       | Milestone                                                    |
| ---------- | ------------------------------------------------------------ |
| 2025-06-04 | Project initialized                                          |
| 2025-06-05 | Live API integration complete                                |
| 2026-01-02 | Production deployment on Raspberry Pi                        |
| 2026-01-10 | Week 1 analysis, stop loss tuning, take profit, email alerts |
| 2026-01-12 | Database WAL fix, margin-based take profit                   |
| 2026-01-17 | Navigation overhaul, analytics dashboard                     |
| 2026-01-19 | Margin-aware position sizing deployed                        |
| 2026-01-20 | Test suite complete (174 passing, 0 failing)                 |
| 2026-01-27 | Short selling fix, ADX slope filter, exit reason detection   |
| 2026-01-31 | Signal persistence for analytics, 90-day retention           |
| 2026-02-02 | Signals component enhancement, Short entry signal filtering  |
| 2026-02-05 | Backtesting engine complete (Phases 1-4), CLI + API + DB     |
| 2026-02-06 | Batch sweep script, comprehensive 132-run analysis across 6 pairs |
| 2026-02-06 | HTF trend filter implemented, 12-month sweep analysis completed   |
| 2026-02-06 | Multi-TF simulation (M15 fills + H1 signals), 12-month sweep     |

---

## IN PROGRESS

### Multi-Timeframe Simulation (IMPLEMENTED — NEEDS TEST VERIFICATION)

**Implemented 2026-02-06**. M15 fill resolution with H1 signal quality. Aggregates M15 candles into H1 bars for indicator/signal evaluation while iterating M15 candles for exit checks (SL/TP/trailing/breakeven) — 4x more granular fill simulation.

**Architecture**:
- `_aggregateToH1(m15Candles)` groups by hour boundary (`Math.floor(time/3600)*3600`)
- Returns `h1Candles`, `m15ToH1Index` (maps each M15→parent H1), `h1CompletionM15Indices` (Set)
- `shouldEvaluateSignal(i)` predicate wraps sections 3/3e/4 — signals only fire at H1 completion
- `getIndicators(i)` maps through `m15ToH1Index` transparently
- Sections 1 (pending entry) and 2 (exit checks) run every M15 candle
- No look-ahead bias: signals fire at H1 completion (all 4 M15 candles are past)
- `enableMultiTimeframe: false` default — backwards compatible

**Files modified**: `backtestEngine.js` (core + `_aggregateToH1`), `backtestEngine.test.js` (10 new tests), `backtest.js` (`--multiTF` flag), `backtestSweep.js` (5 new scenarios)

**12-Month MultiTF Baseline Sweep Results (2025-02-01 to 2026-02-01)**:
| Pair | Trades | Win Rate | P&L | Return |
|------|--------|----------|-----|--------|
| AUD_USD | 38 | 44.7% | +$20.54 | +4.1% |
| NZD_USD | 34 | 52.9% | +$24.48 | +4.9% |
| GBP_USD | 31 | 45.2% | -$11.97 | -2.4% |
| USD_JPY | 35 | 40.0% | -$14.88 | -3.0% |
| EUR_USD | 44 | 29.5% | -$105.89 | -21.2% |
| USD_CAD | 39 | 33.3% | -$117.20 | -23.4% |
| **Total** | **221** | | **-$204.92** | |

**Key findings**:
- AUD_USD + NZD_USD profitable (+$45.02 combined)
- EUR_USD + USD_CAD significantly negative — strategy doesn't work on these pairs
- AUD_USD with TP off: +$60.60 vs +$20.54 with TP on (TP cuts winners short)
- Still need to run MultiTF+NoCont, MultiTF+HTF, and TP-off sweep variants

**Pending**:
1. **Run tests**: `cd backend && npx jest --testPathPattern backtestEngine` (user runs in terminal)
2. **Run additional sweep scenarios**: MultiTF+NoCont, MultiTF+HTF, MultiTF+HTF+NoCont
3. **Analyze which pair/config combos are viable for live trading**

**Instruments for testing**: AUD_USD, EUR_USD, USD_JPY, NZD_USD, GBP_USD, USD_CAD
**Historical data cached**: All instruments, M15 + H1 + H4 in `backend/data/historical/`

---

### HTF Trend Filter (COMPLETE)

**Implemented 2026-02-06**. H4 SuperTrend higher-timeframe filter added to backtest engine. Filter at entry gating (section 4), not signal generation (section 3) — preserves signal reversal exits. Binary search helper `_getHTFDirection()` for efficient H4 direction lookup. 5 new sweep scenarios added. CLI `--htfFilter` flag added.

**Files modified**: `backtestEngine.js`, `backtestSweep.js`, `backtest.js`

---

### Backtesting Engine — Infrastructure (COMPLETE)

**What's Built (Phases 1-4 complete, 253 tests passing)**:

| Component | File | Status |
|-----------|------|--------|
| Shared indicators | `backend/src/utils/indicators.js` | Complete |
| Historical data service | `backend/src/services/historicalDataService.js` | Complete |
| Backtest engine | `backend/src/services/backtestEngine.js` | Complete + HTF filter + Multi-TF |
| Backtest repository | `backend/src/repositories/backtestRepository.js` | Complete |
| Database migration | `backend/migrations/002_create_backtest_results.js` | Complete |
| API endpoints | `backend/src/routes/tradingRoutes.js` (backtest section) | Complete |
| CLI script | `scripts/backtest.js` | Complete + HTF + MultiTF flags |
| Sweep script | `scripts/backtestSweep.js` | Complete + HTF + MultiTF scenarios |

---

_See [project_roadmap.md](project_roadmap.md) for full feature list._
