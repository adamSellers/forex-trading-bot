# Forex Trading Bot - Claude Code Instructions

## Session Continuity

When user says **"continue where we left off"**, check **IN PROGRESS** section for current task state. Before ending a session (context ~60-70%), update IN PROGRESS with clear next steps.

### Prepare for New Session

When user says **"prepare for a new session"**:

1. **Update CLAUDE.md** - Add all relevant context, next steps, and current work items to IN PROGRESS section. Ensure enough detail so "continue where we left off" works seamlessly in a new thread.
2. **Update project_roadmap.md** - If new features were discussed or requested during the session, add them to the appropriate section of the roadmap.
3. **Update PROJECT_HISTORY.md** - Move completed code milestones or deployed features from the current session, and state deployment status explicitly. Ask user for clarification if unsure whether a feature has been deployed.
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
    - CLAUDE.md update instructions
    - Prompt to start new thread: _"Phase X complete. Recommend starting a new thread. Say 'continue where we left off'."_
3. **Session management header** - Include at the top:
    ```
    ## Session Management
    This is a multi-phase feature. To preserve context:
    - **Start implementation in a new session** (say "continue where we left off")
    - **After each phase completion**, update CLAUDE.md IN PROGRESS section and prompt user to start a new thread
    - Each phase is designed to be completable within a single session
    ```
4. **Final checkpoint** - Last phase should include deployment readiness prompt

This ensures consistent plan structure and clean context handoffs across sessions.

### Update Project Documentation

When user says **"update project documentation"**:

1. **Review current state** - Check the IN PROGRESS section to understand the last feature being worked on and its status
2. **Create a documentation plan** - Prepare a phased plan (following plan generation rules) for updating all relevant docs:
    - `CLAUDE.md` - Update IN PROGRESS section with current status
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

**Forex Trading Bot** is a live automated trading system running on a Raspberry Pi 5 (8GB) that executes trades on the Forex market via the Oanda API using a shared strategy runtime. The current live baseline is SuperTrend Momentum; additional candidate strategies run in paper and can be promoted through the Paper workflow after review.

**Current State**: Production live trading is active. The shared strategy runtime is complete in code: live strategy selection is hot-swappable, shadow paper runs pair automatically with the active live run, candidate paper runs share the same runtime identity model, unified analytics run by `mode`/`runId`/`strategy`, live-capable candidates can be promoted from Paper, `correlation_divergence` is available as a paper-only research candidate, and the legacy backtest/lab stack is retired from the supported workflow.

| Item              | Value                            |
| ----------------- | -------------------------------- |
| Broker            | Oanda (ASIC regulated)           |
| Account Type      | Live CFD                         |
| Base Currency     | AUD                              |
| Deployment        | Raspberry Pi 5 (8GB)             |
| Backend Port      | 3101                             |
| Frontend Port     | 3100                             |
| Live Baseline     | `supertrend_momentum`            |
| Strategy Catalog  | 7 canonical strategies           |
| Database          | SQLite with WAL                  |
| Production Host   | img.oakroad                      |
| Dashboard         | http://img.oakroad:3100          |
| API               | http://img.oakroad:3101/api      |
| PM2 Process       | forex-backend                    |
| Validation        | Targeted runtime suites passing  |

**CRITICAL**: This is a LIVE trading account with real money. Exercise extreme caution with any changes that affect trading logic, position sizing, or order execution.

**Approved steady state**:

- Shared strategy runtime for live, shadow paper, and candidate paper runs
- Exactly one active live entry strategy at a time
- Live strategy hot-swap from the UI applies to new entries only
- Existing live positions remain managed by the strategy run that opened them
- Unified storage and analytics keyed by `mode`, `runId`, and `strategy`
- Candidate runs remain `paper_candidate` unless deliberately promoted through `/api/runtime/runs/:runId/promote`
- Legacy backtest/lab architecture is retired; do not recreate a parallel production comparison path

---

## Core Architecture

### Key Concepts

| Term              | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| SuperTrend        | Trend-following indicator that flips RED/GREEN based on ATR and price       |
| ADX               | Average Directional Index - measures trend strength (shared default: ≥21)   |
| FRESH_FLIP        | Entry signal when SuperTrend flips + ADX/RSI conditions met                 |
| CONTINUATION      | Entry signal when blocked flip's conditions improve within 4 hours          |
| Margin-based TP   | Take profit targets 6% of the margin used for that trade                    |
| WAL Mode          | SQLite Write-Ahead Logging for safe concurrent access                       |

### Live Baseline Strategy

**Signal Generation** (every 60 seconds):
1. Fetch 20 recent 15-min candles per pair
2. Calculate SuperTrend line (ATR multiplier: 3.0)
3. Detect SuperTrend flip (RED → GREEN = potential BUY)
4. Filter by ADX, directional ADX, RSI momentum/overextension, optional HTF context, session, and spread
5. Emit BUY/SELL/HOLD signal if all conditions are met

**Entry Validation**:
- Trading enabled (`enableTrading: true`)
- Open positions < `maxOpenPositions` (default 2)
- Pair in configured `assets` array
- No existing position for this pair
- Signal ADX >= `minAdx` threshold (default 21)
- Sufficient margin available (with 20% buffer)

**Position Sizing** (risk-based):
```
stop_loss_pips = max(ATR × 2.0, 15 pips floor)
risk_amount = sizing_base × 0.01 (1% risk)
units = risk_amount / (stop_loss_pips × pip_value × current_price)
```

**Exit Management**:
- Take Profit: optional, 6% of margin used when enabled
- Stop Loss: ATR-based, minimum 15 pips by shared default
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
| Logging     | Custom JSON file/console logger | PM2 captures stdout/stderr; daily files are written under backend logs |

---

## Project Structure

```
forex-trading-bot/
├── backend/
│   ├── server.js                          # Express + Socket.IO entry point
│   ├── knexfile.js                        # Database config (WAL mode)
│   ├── jest.config.js                     # Test configuration
│   ├── data/
│   │   ├── trading.db                     # SQLite database (UNTRACKED)
│   │   ├── trading.db-wal                 # WAL file (UNTRACKED)
│   │   ├── trading_config.json            # Runtime config (tracked, preserved by deploy scripts)
│   │   └── trading_config_initial.json    # Config template (tracked)
│   ├── migrations/
│   │   ├── 001_create_forex_tables.js     # Core forex schema
│   │   ├── 002_create_backtest_results.js # Historical, later retired
│   │   ├── 003_add_strategy_telemetry_and_reconciliation.js
│   │   ├── 004_add_entry_decisions.js
│   │   ├── 005_add_strategy_runs_and_runtime_identity.js
│   │   ├── 006_drop_backtest_results.js   # Retires legacy table during rollout
│   │   └── 007_add_timesfm_context.js      # TimesFM signal/decision context
│   ├── src/
│   │   ├── routes/tradingRoutes.js        # 50+ API endpoints
│   │   ├── runtime/                       # Shared runtime orchestration + market context
│   │   ├── strategies/                    # Canonical strategy catalog + implementations
│   │   ├── services/
│   │   │   ├── LiveTradingEngine.js       # CRITICAL - Broker-backed live execution
│   │   │   ├── PaperTradingRuntime.js     # Shadow/candidate paper execution
│   │   │   ├── signalGenerator.js         # Legacy-compatible signal helper surface
│   │   │   ├── timesFmClient.js           # Fail-open client for Lathe TimesFM sidecar
│   │   │   ├── timesFmSignalService.js    # Forecast enrichment, caching, and status
│   │   │   ├── historicalDataService.js   # Offline historical candle helper
│   │   │   ├── Oandaclient.js             # Oanda API wrapper
│   │   │   ├── OandaDataService.js        # Price polling
│   │   │   ├── analyticsService.js        # Unified runtime analytics
│   │   │   ├── configService.js           # Config persistence
│   │   │   ├── emailService.js            # Trade alerts
│   │   │   └── s3ReportScheduler.js       # S3 report uploads
│   │   ├── repositories/
│   │   │   ├── tradeRepository.js         # Trade CRUD
│   │   │   ├── signalRepository.js        # Signal CRUD
│   │   │   ├── portfolioRepository.js     # Portfolio snapshots CRUD
│   │   │   └── strategyRunRepository.js   # Shared runtime run registry
│   │   └── utils/
│   │       ├── logger.js                  # Custom JSON logger with daily files
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
│   └── status.sh                          # Operations status helper
├── timesfm-sidecar/                        # FastAPI TimesFM 2.5 sidecar for Lathe
├── ecosystem.config.js                    # PM2 configuration
├── CLAUDE.md                              # This file
├── project_roadmap.md                     # Future features
└── PROJECT_HISTORY.md                     # Completed features
```

---

## Database Schema

| Table               | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `trades`            | Trade records with entry/exit, P&L, signals          |
| `signals`           | Real-time trading signal log                         |
| `entry_decisions`   | Entry funnel and rejection telemetry                 |
| `strategy_runs`     | Shared run registry for live/shadow/candidate modes |
| `portfolio_snapshots` | Account state history                              |
| `performance`       | Calculated metrics (win rate, Sharpe ratio, etc.)    |
| `trading_config`    | Persisted settings as JSON blob                      |

Key columns in `trades`:
- `id`, `trade_id`, `oanda_trade_id`, `instrument`, `side`
- `entry_price`, `exit_price`, `entry_time`, `exit_time`
- `pnl_aud`, `pnl_pips`, `swap_aud`
- `units`, `margin_used_aud`, `stop_loss_price`, `take_profit_price`
- `signal`, `entry_type` (FRESH_FLIP/CONTINUATION)
- `run_id`, `owner_run_id`, `selection_id`, `strategy`, `mode`
- `is_open`, `exit_reason` (STOP_LOSS/TAKE_PROFIT/SIGNAL/MANUAL)

---

## Roadmap & Future Features

For all planned features, enhancements, and technical improvements, see **[project_roadmap.md](project_roadmap.md)**.

**Document purposes:**

| Document              | Purpose                          | When to update                              |
| --------------------- | -------------------------------- | ------------------------------------------- |
| `CLAUDE.md`           | Current context, in-progress work | During/after active work sessions           |
| `project_roadmap.md`  | Future work, feature requests    | When user requests new features             |
| `PROJECT_HISTORY.md`  | Completed/deployed feature record | After production deployments or explicit code-complete milestones |

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
| 2026-02-16 | Risk-alignment hardening deployed (projected exposure, fill-price SL, continuation ADX floor, lab parity fixes) |
| 2026-02-16 | Backtest equity-curve closeout parity fix (final curve point now matches realized end balance) |

---

## IN PROGRESS

### Current Phase (2026-05-26)

Shared runtime, TimesFM Directional promotion readiness, and Correlation Divergence paper-candidate support are complete in code. Phase 6 rollout and monitoring guidance is prepared for the swappable live strategies + shadow paper trading program.

Documentation refresh completed in this pass:

- Updated repository docs to describe seven canonical strategies instead of six.
- Marked `correlation_divergence` as paper-only wherever strategy promotion is discussed.
- Replaced collaborator-hostile absolute local links in the README with relative links.
- Refreshed deployment guidance, issue templates, and TimesFM notes against current code.
- Kept rollout status separate from code-complete status; production deployment still requires the Phase 6 checklist.

Completed in this phase:

- Prepared an operator-facing Phase 6 rollout packet in `scripts/PHASE6_ROLLOUT_CHECKLIST.md` with the packet order locked to:
  - local manual frontend build
  - deployment
  - runtime QA
  - monitoring window
- Updated `scripts/DEPLOYMENT_README.md` so deployment guidance now matches the shared runtime stack and points operators to the Phase 6 checklist
- Tightened shared-runtime monitoring helpers:
  - `scripts/status.sh` now shows the active live selection, paired shadow run, active candidate count, and managing-only live runs
  - `scripts/health-check.sh` now verifies that the active live run has a paired shadow run after startup
  - `scripts/logs.sh runtime` now filters runtime/shadow/candidate activity
- Updated `scripts/deploy-check.sh` so the optional preflight uses the current ports and runtime endpoints instead of legacy management/backtest paths
- Kept the Phase 2 ownership model and runtime-only comparison workflow intact:
  - live strategy changes affect new entries only
  - open live trades remain attached to their original `ownerRunId`
  - the paired shadow run remains tied to the active live selection
  - candidate runs remain paper mode until an explicit promotion step creates a new live selection
  - analytics/reporting continue from unified runtime identity columns
- Kept migration `006_drop_backtest_results.js` called out explicitly in rollout guidance so old research rows can be exported before deployment if needed
- Updated `timesfm_directional` metadata so a reviewed TimesFM paper candidate can be promoted to live when the sidecar-backed strategy has enough evidence
- Registered `correlation_divergence` as a paper-only candidate strategy with peer-candle context and no live promotion support

Locked decisions carried forward:

- Shared runtime across live, `paper_shadow`, and `paper_candidate`
- Exactly one active live entry strategy at a time
- Strategy switches from the UI apply to new entries only
- Existing live positions remain owned by the strategy run that opened them until closure
- Default shadow paper run always tracks the active live strategy
- Multiple concurrent paper candidate runs are supported
- Live-capable candidates can be promoted from the Paper view; the source run remains `paper_candidate`
- Unified persistence and analytics are keyed by `mode`, `runId`, and `strategy`
- Legacy backtest/lab comparison is retired; do not reintroduce a second production comparison path
- Canonical strategy catalog is fixed to:
  - `supertrend_momentum`
  - `mean_reversion`
  - `range_breakout`
  - `stochastic_divergence`
  - `squeeze_play`
  - `timesfm_directional`
  - `correlation_divergence` (paper-only; not live-promotable today)

### Next Recommended Phase

Run the Phase 6 rollout packet manually on the target environment.

Manual steps still pending outside this session:

1. Run `cd frontend && npm run build`
2. Push the Phase 6 docs/script updates
3. On the Pi, export `backtest_results` first if historical research rows still matter
4. On the Pi, run `./scripts/deploy.sh` for the first shared-runtime rollout
5. Execute the QA and monitoring checklist in `scripts/PHASE6_ROLLOUT_CHECKLIST.md`
6. Capture any production observations before deciding on follow-up code changes

### Codebase Reminders For The Next Thread

- `backend/server.js` now boots three runtime layers in sequence:
  - `runtimeCoordinator` for shared run orchestration
  - `paperTradingRuntime` for simulated paper execution/snapshots
  - `LiveTradingEngine` for broker-backed live execution only
- Production comparison flow is now runtime-only:
  - no `/api/backtest` mount
  - no legacy lab socket/worker pipeline
  - no active frontend path uses `frontend/src/components/lab/*`
- `backend/src/runtime/runtimeCoordinator.js` remains the source of truth for active runs, live selection, paired shadow runs, and ownership-aware live signal evaluation; do not fork a separate paper coordinator
- `backend/src/services/PaperTradingRuntime.js` owns paper trade open/close, run reset cleanup, portfolio snapshots, and paper-only management rules for `paper_shadow` / `paper_candidate`
- `backend/src/routes/tradingRoutes.js` now exposes the unified run detail APIs; analytics/detail work should continue using runtime identity columns instead of paper-specific reporting tables
- `frontend/src/components/BacktestLab.jsx` keeps the legacy filename but is now the runtime-backed paper comparison surface
- Candidate runs remain paper mode unless promoted through the dedicated promotion endpoint
- `backend/migrations/006_drop_backtest_results.js` removes the retired legacy table during rollout; export old research rows before deployment if they matter

### Validation Completed In This Session

- `bash -n scripts/status.sh`
- `bash -n scripts/health-check.sh`
- `bash -n scripts/logs.sh`
- `bash -n scripts/deploy-check.sh`

Manual rollout follow-up still pending:

- Frontend build was not run in this session because repo workflow rules reserve build commands for the user; run `cd frontend && npm run build` manually before rollout
- No browser/manual QA was run against the updated `Dashboard`, `Paper`, or `Analytics` views in this session
- Deployment/update was not run in this session, so `006_drop_backtest_results.js` has not been applied to a real environment yet
- The first live comparison monitoring window still needs to be observed on the Pi
- This thread re-read the Phase 6 packet, revalidated the rollout scripts/endpoints, and prepared the exact Pi command sequence plus production verification checks; the Phase 6 checkpoint is still pending the user's manual rollout execution

### Next Session Start Checklist

1. Start a new thread and read this `IN PROGRESS` section plus `trading_strategy_update_plan.md`
2. Have the user run `cd frontend && npm run build`
3. Preserve the Phase 2 live ownership model:
   - live strategy changes affect new entries only
   - open live trades stay attached to their original `ownerRunId`
   - candidate runs remain paper mode unless a dedicated promotion step creates a new live selection
4. Keep `runtimeCoordinator` and `paperTradingRuntime` as the shared backbone; do not reintroduce paper-only orchestration outside that path
5. Use unified runtime identity columns for any further analytics/reporting work
6. Remember that rollout will drop the retired `backtest_results` table via migration `006`
7. Follow `scripts/PHASE6_ROLLOUT_CHECKLIST.md` in packet order and record any production observations before changing code again

### Future UI Enhancement (Captured)

- Current Holdings: compact mobile stop chips / tooltip mode for `TSL` / `BE` / `SL` / `TP` labels (deferred)

---

_See [project_roadmap.md](project_roadmap.md) for full feature list and enhancement status._
