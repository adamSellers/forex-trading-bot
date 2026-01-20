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
| Test Suite        | 142 passing, 5 failing           |

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
│   │   └── 001_create_forex_tables.js     # Database schema
│   ├── src/
│   │   ├── routes/tradingRoutes.js        # 50+ API endpoints
│   │   ├── services/
│   │   │   ├── LiveTradingEngine.js       # CRITICAL - Trade execution
│   │   │   ├── signalGenerator.js         # CRITICAL - Strategy signals
│   │   │   ├── Oandaclient.js             # Oanda API wrapper
│   │   │   ├── OandaDataService.js        # Price polling
│   │   │   ├── analyticsService.js        # Performance metrics
│   │   │   ├── configService.js           # Config persistence
│   │   │   ├── emailService.js            # Trade alerts
│   │   │   └── s3ReportScheduler.js       # S3 report uploads
│   │   ├── repositories/
│   │   │   ├── tradeRepository.js         # Trade CRUD
│   │   │   └── signalRepository.js        # Signal CRUD
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
│   └── setup-secrets.sh                   # API key setup
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
| 2026-01-20 | Test suite partial fix (142 passing)                         |

---

## IN PROGRESS

### Documentation Migration Complete - Ready for Next Task

**Status**: Complete (Jan 20, 2026)

**What Was Done This Session**:
- Migrated to structured documentation system
- Created `CLAUDE.md` from template with full project context
- Created `project_roadmap.md` with future features and known issues
- Created `PROJECT_HISTORY.md` with 17 completed feature entries
- Deleted template files

**Pending Commit**:
```bash
git add CLAUDE.md project_roadmap.md PROJECT_HISTORY.md
git commit -m "docs: migrate to structured documentation system"
git push origin main
```

---

### Outstanding Work (from previous sessions)

**1. Ghost Position Bug** (HIGH priority)
- EUR/USD trade ID 11, Oanda trade 489
- Trade closed on Oanda via TP but DB shows `is_open=1`
- Need to: Query Oanda for exit details, manually fix DB, investigate `reconcilePositions()`

**2. Test Suite - 5 Remaining Failures** (MEDIUM priority)
- `tradeRepository.test.js` - Jest hoisting issue (rename `testDbInstance` to `mockTestDbInstance`)
- `LiveTradingEngine.test.js` - `removeListener is not a function`, position size assertions

**Debug Commands**:
```bash
# Check reconciliation logic
grep -n -A 20 "reconcile\|handleExternal" backend/src/services/LiveTradingEngine.js

# Get closed trade from Oanda
grep -i "getTransaction\|getTrade\|closed" backend/src/services/Oandaclient.js

# Run tests
cd backend && npm test
```

---

_See [project_roadmap.md](project_roadmap.md) for full feature list._
