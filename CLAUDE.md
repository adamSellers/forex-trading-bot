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

### Current Phase (2026-05-29) — Profitability Remediation

Active initiative: stop the live account's slow bleed and rebuild a trustworthy validation loop.
Plan: `.claude/plans/okay-claude-this-is-iridescent-shore.md` (5 phases, 0–4). Diagnosis came from a
read-only pull of the production DB: 98 closed live trades Jan 23 → May 27 2026, **−A$48.86**; every
strategy tried live lost money, and paper P&L is inverted-sign vs live for the *same* strategy
(paper is fantasy — the core thing Phase 1 fixes).

The prior shared-runtime program ("Phase 6") is now confirmed LIVE in production: an active live run,
a paired `paper_shadow`, and multiple `paper_candidate` runs are all running on the Pi. That rollout
is effectively complete; the architecture constraints below remain in force.

#### Phase 0 — Stop the bleed + freeze baseline (DONE this session; one user commit pending)

- **Live trading PAUSED and verified.** `POST /api/trading/stop` set `enableTrading:false` (persists to
  the Pi config + applies immediately). `/api/engine/status` confirms `tradingEnabled:false`,
  `isRunning:true` (exits/monitoring still active), 0 open live positions.
- **Active live selection confirmed = `timesfm_directional`** (run `live_5cafbc39…`, started 2026-05-26;
  paired shadow `paper_shadow_7a7efb5b…`). WARNING: the repo `trading_config.json` says
  `supertrend_momentum`/`maxOpenPositions:2`, but the Pi runtime is `timesfm_directional`/`maxPositions:3`.
  The runtime `strategy_runs` selection is the SOURCE OF TRUTH — do not trust the repo config's
  `strategy` field. At freeze time the TimesFM sidecar (lathe.oakroad:5050) was timing out/unavailable.
- **Baseline frozen** in `analysis/baseline/` (384 closed trades: 98 live / 242 candidate / 44 shadow):
  `closed_trades_baseline_2026-05-29.csv`, `summary_stats_baseline_2026-05-29.json`,
  `manifest_baseline_2026-05-29.json`. Every later change is measured against this fixed reference.
- **PENDING USER ACTION:** commit the baseline — `git add analysis/baseline/ && git commit`. Not yet
  committed as of this session's end.

#### Profitability plan — locked decisions

- Live trading stays PAUSED while iterating.
- Do BOTH in sequence: fix the live strategy's structural flaws AND validate candidates in realistic paper.
- Claude has READ-ONLY SSH to the Pi for data only (`adam@img.oakroad`, `sqlite3 -readonly`); user runs
  all git/deploy/build and any live-config writes per the Git & Deployment Rules above.

#### Carried-forward architecture constraints (still true)

- Shared runtime across live, `paper_shadow`, `paper_candidate`; exactly one active live entry strategy.
- Live strategy switches apply to NEW entries only; open live trades stay owned by their original `ownerRunId`.
- Default shadow run always tracks the active live strategy; multiple paper candidates supported.
- Unified persistence/analytics keyed by `mode`, `runId`, `strategy`. Legacy backtest/lab is retired —
  do not reintroduce a second comparison path.
- Canonical strategy catalog: `supertrend_momentum`, `mean_reversion`, `range_breakout`,
  `stochastic_divergence`, `squeeze_play`, `timesfm_directional`, `correlation_divergence`
  (paper-only; not live-promotable today).

### Current Phase — Phase 1: Make paper trustworthy (LOCAL CODE DONE; user commit/deploy pending)

Goal: make `paper_shadow` per-pip track `live` so promotion decisions stop being made on fantasy numbers.

Completed locally on 2026-05-29:

1. `PaperTradingRuntime` now has calibrated non-zero default execution costs:
   `DEFAULT_PAPER_ENTRY_SLIPPAGE_PIPS=0.25`, `DEFAULT_PAPER_EXIT_SLIPPAGE_PIPS=0.25`,
   `DEFAULT_PAPER_STOP_SLIPPAGE_PIPS=0.5`. Explicit config values, including `0`, still override.
2. Paper stop fills now execute worse than the trigger: BUY stop exits fill below stop, SELL stop exits
   fill above stop, and close metadata uses `PAPER_STOP_FILL` with stop slippage recorded.
3. Local repo config templates set `timeStopHours:0` so fresh installs align with live's no-time-stop behavior.
   IMPORTANT: deploy scripts preserve the Pi config, so the user still needs to set `timeStopHours:0`
   on the Pi for the currently running paper runtime.
4. Calibration used read-only Pi SQL and paired 20 live/shadow trades by live run -> shadow run plus
   same instrument/side/nearest entry time. Same-stop/same-exit pairs were already close (`n=5`,
   avg paper-live gap `-0.53` pips), so the original rough 5-pip gap was mostly time-stop/stop-plan
   mismatch rather than pure execution slippage. Chosen defaults are intentionally small and non-zero.
5. Candidate re-check with calibrated costs:
   `timesfm_directional` paper_candidate `+2.30 -> +1.72` pips/trade,
   `mean_reversion` `+1.90 -> +1.30`,
   `correlation_divergence` `-1.17 -> -1.68`,
   `squeeze_play` `-2.92 -> -3.61`,
   `stochastic_divergence` `-1.04 -> -1.63`.
   Active candidates: `timesfm_directional` remains positive in paper (`30` closed, adjusted `+3.93`
   pips/trade), `correlation_divergence` is negative, active `stochastic_divergence` is only `4` trades.
6. Tests: `npm test -- PaperTradingRuntime.test.js` passes (`18/18`). Full `npm test` was attempted;
   `PaperTradingRuntime` passed in the full run, but repository tests are blocked locally by a missing
   native `better-sqlite3` binding.

Pending user actions before Phase 1 can be considered deployed:

- Commit the untracked Phase 0 baseline artifacts, `CLAUDE.md`, memory/plan updates, and Phase 1 code/config.
- Set `timeStopHours:0` on the Pi's preserved runtime config.
- Deploy with the standard update script.

Checkpoint after deploy: reset/continue shadow paper under the active `timesfm_directional` run and verify
new `paper_shadow` per-pip tracks live within tolerance over forward trades.

### Codebase Reminders For The Next Thread

- `backend/server.js` boots three runtime layers: `runtimeCoordinator` (shared run orchestration),
  `paperTradingRuntime` (simulated paper execution/snapshots), `LiveTradingEngine` (broker-backed live only).
- Production comparison is runtime-only: no `/api/backtest` mount, no legacy lab socket/worker, no
  active frontend path uses `frontend/src/components/lab/*`.
- `backend/src/runtime/runtimeCoordinator.js` is the source of truth for active runs, live selection,
  paired shadow runs, and ownership-aware live signal evaluation; do not fork a separate paper coordinator.
- `backend/src/services/PaperTradingRuntime.js` owns paper open/close, run reset, snapshots, and
  paper-only management for `paper_shadow`/`paper_candidate` — this is the Phase 1 edit surface.
- `backend/src/services/LiveTradingEngine.js` holds the live exit stack (break-even `:2110-2176`,
  trailing `:2192`) — the Phase 2 exit-redesign surface.
- `backend/src/strategies/expectedEdge.js` + `backend/src/services/analyticsService.js` — Phase 3 cohort
  expectancy + the promotion gate.
- Pause/resume live via `POST /api/trading/stop` / `POST /api/trading/start` (persists to config + applies live).

### Next Session Start Checklist

1. Start a new thread; read this `IN PROGRESS` section and `.claude/plans/okay-claude-this-is-iridescent-shore.md`.
2. Do not re-check that live is paused; the user has confirmed it. The active live strategy remains whatever
   `strategy_runs` says, currently `timesfm_directional`, not the repo config's strategy field.
3. Prompt the user to commit Phase 0 baseline + Phase 1 changes if they have not already.
4. Prompt the user to set Pi `timeStopHours:0` and deploy via `./scripts/update.sh`; do not run git/deploy/build.
5. After deploy, forward-monitor paired live/shadow data via read-only SQL to confirm tracking.
6. Keep `runtimeCoordinator`/`paperTradingRuntime` as the shared backbone; analytics use runtime
   identity columns (`mode`/`runId`/`strategy`). No live changes in Phase 1.
7. Remember the config/runtime mismatch: the live strategy is whatever `strategy_runs` says is active,
   not the repo `trading_config.json` field.

### Future UI Enhancement (Captured)

- Current Holdings: compact mobile stop chips / tooltip mode for `TSL` / `BE` / `SL` / `TP` labels (deferred)

---

_See [project_roadmap.md](project_roadmap.md) for full feature list and enhancement status._
