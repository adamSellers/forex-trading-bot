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

### Update 2026-07-06 — Why live placed ZERO trades since 2026-06-09: HTF filter fails closed with a null dataService (DEPLOYED + VERIFIED)

Diagnosis (read-only Pi SSH): engine running, `enableTrading:true`, Oanda + TimesFM healthy, live run
`live_7b62da29…` (`supertrend_momentum`) active — but **0 trades since 2026-06-01** (last trade was the
old TimesFM run). Signal funnel for the live run: 111k HOLDs, 68 SELLs (correctly suppressed by
long-only), and **zero BUYs ever emitted**. All 3,912 long-related events were blocked with
`"htf":{"direction":0,"longAllowed":false,"shortAllowed":false,"reason":"HTF 1h unavailable"}` —
never once `longAllowed:true` in the entire run. The paired shadow run has 0 trades too (same block).

Root cause (code bug, NOT market conditions or over-tight tuning):
- `runtimeCoordinator._createRunSession` builds each per-run generator as
  `new SignalGenerator(configSnapshot, null)` and never sets `generator.dataService` (the legacy
  `SignalGenerator.start(dataService)` injection path is never called in the shared runtime).
- `supertrendMomentum.evaluateEntry` prefers `getHtfTrendContextFn` (bound to the generator) over the
  marketContext HTF candles the coordinator correctly precomputes.
- `SignalGenerator.getHtfTrendContext` reads `this.dataService?.getCandles?.(instrument,"1h")` →
  null → `[]` → <50 candles → "HTF unavailable" → fails CLOSED, blocking BOTH directions.
- So ANY run with `enableHTFFilter:true` can never enter. The Pi dataService itself DOES cache H1
  (6 cache keys / ~2994 candles verified) — the candles were there all along; the generator just
  couldn't see them. TimesFM/other strategies traded before because they don't consult this HTF path.

Fix (local, tests green):
- `backend/src/runtime/runtimeCoordinator.js`: `_createRunSession` now sets
  `generator.dataService = this.dataService`; `start()` re-syncs it onto sessions registered before
  start (rehydrated persisted runs). Two regression tests added in `runtimeCoordinator.test.js`
  (18/18 pass); focused suites supertrendMomentum + signalGenerator + LiveTradingEngine +
  PaperTradingRuntime + tradingRoutes = 174/174 pass.

Performance context pulled this session (all-time live: −A$50.67 over 99 closed trades; nothing yet
has proven positive edge): new paper candidates since 2026-06-09 are BOTH negative —
`signal_following` 58 closed −A$13.64 (33% win), `counter_signal_reversion` 52 closed −A$19.10 (44% win).
Neither is promotable under the Phase 3 gate. The restricted supertrend_momentum posture has NO
forward evidence yet because of this bug; fixing it is how we finally collect it. Do NOT loosen
filters (ADX 21, long-only, HTF confirm) in response to the silence — the silence was the bug.

DEPLOYED + VERIFIED 2026-07-05 ~22:32 UTC (read-only SSH): Pi is on `3fe4412` (both the dataService
wiring fix `57979bb` and the granularity-union fix `3fe4412`), backend restarted cleanly, engine
healthy with `enableTrading:true`. First post-restart signal cycle confirmed the HTF filter now
reads real candles: EUR_USD + GBP_USD `"HTF 1h uptrend"` with `longAllowed:true` (first time in the
entire run), USD_JPY `"HTF 1h downtrend"`, and ZERO `"HTF 1h unavailable"` since restart.

Remaining follow-up (forward monitoring only):
- Shadow + live both resume entry evaluation; entries still require the full funnel (long-only,
  London/NY session, ADX ≥ 21 rising, RSI floor, continuation setup + HTF uptrend), so expect
  roughly ~1 qualifying setup/day reaching the HTF stage — first trades may take days.
- Review cohort expectancy after ~20–30 closed trades via
  `/api/analytics?mode=live&runId=live_7b62da29-7325-4819-8df8-15466282a78d&strategy=supertrend_momentum&period=all`.
- Do NOT loosen filters in response to slow cadence; judge the posture on realized expectancy.

Known latent gap — FIXED 2026-07-06 on branch `claude/elated-khorana-d72006`, now merged as
`3fe4412` and DEPLOYED to the Pi (verified in Pi git log):
`OandaDataService.getRequiredGranularities` only honored the GLOBAL config's
`enableHTFFilter`/`htfTimeframe`, so a candidate run enabling HTF (or a different HTF timeframe)
while the global config had it off would hit the same fail-closed block because its candles were
never fetched. Fix: `runtimeCoordinator.syncDataServiceTimeframes()` pushes the union of every
active run's required timeframes (strategy `requiredData.timeframes` + run `timeframe` + run HTF
when enabled, via `marketContextService.getRequiredTimeframesForRun`) onto
`OandaDataService.updateRuntimeTimeframes()` whenever run sessions change (register/stop/config
update/global updateConfig/coordinator start). The data service unions these with the global-config
granularities and refetches immediately when a new granularity appears. Data fetching only — no
trading logic touched. Tests: new `OandaDataService.test.js` (7), +4 runtimeCoordinator, +3
marketContextService; full suite 416 pass / 44 fail (only the pre-existing better-sqlite3 binding
failures in the 3 real-DB repo suites, unchanged).

### Update 2026-06-10 — Database retention overhaul + one-off shrink (DEPLOYED + VERIFIED)

Root cause of oversized backups: Pi `trading.db` was 3.3GB (47% freelist, never VACUUMed) plus a
1.6GB WAL. The WAL grew because passive autocheckpoints (`wal_autocheckpoint=1000`) can never RESET
the WAL while readers are active, and the bot reads constantly — nothing ever ran
`wal_checkpoint(TRUNCATE)`. The 90-day signal sweep itself WAS working (oldest signal exactly 90d);
the volume is just high (~13k signal rows/day across live+shadow+candidate runs, 13 indexes,
`timesfm_context` ~600B/row = 347MB). `portfolio_snapshots` had NO retention at all.

Code changes (storage only, no trading logic):
- `backend/server.js`: `scheduleSignalCleanup` → `scheduleDataRetention`. Daily midnight sweep now:
  signals 30d (was 90d), TimesFM context nulled after 7d, entry_decisions 90d, portfolio_snapshots
  90d, then `PRAGMA wal_checkpoint(TRUNCATE)`. All retention days env-overridable
  (`SIGNAL_RETENTION_DAYS`, `TIMESFM_CONTEXT_RETENTION_DAYS`, `ENTRY_DECISION_RETENTION_DAYS`,
  `PORTFOLIO_SNAPSHOT_RETENTION_DAYS`).
- `signalRepository.deleteOlderThan` now batched (5k-row id-subquery chunks, short transactions so
  big purges never block live writes); new `clearTimesFmContextOlderThan`. New `deleteOlderThan` on
  `entryDecisionRepository` (`decision_time`) and `portfolioRepository` (`snapshot_time`).
- Tests: full `npm test` = 400 pass / 44 fail, failures ONLY the pre-existing better-sqlite3 binding
  issue in the 3 real-DB repo suites (tradeRepository, portfolioRepository, strategyRunRepository —
  failing before this change too). Batched SQL verified against real SQLite via sqlite3 CLI.
  NOTE: `require('better-sqlite3')` succeeds locally — the binding fails lazily at `new Database()`,
  so a bare require is not a valid health check.

DEPLOYED 2026-06-10: user committed/pushed, ran the one-off Pi shrink (pm2 stop → purge SQL +
`wal_checkpoint(TRUNCATE)` + `VACUUM`) and `./scripts/update.sh`. Verified via read-only SSH:
db 3.3GB → 838MB, WAL 1.6GB → 0, freelist 0, oldest signal 29.5d, no TimesFM context older than 7d,
`trades` untouched (168). Startup sweep + WAL checkpoint confirmed in Pi logs. Trade-off accepted:
signal-event counters on the 90d analytics view only cover 30d of signals (trade/P&L analytics
unaffected). Passive follow-ups only: confirm tomorrow's midnight sweep logs + WAL stays in the MBs,
and confirm the next backup is small. This `update.sh` also deployed the stop-floor fix from the
live-only diagnosis session below, and the user completed the `supertrend_momentum` live-selection
switch — VERIFIED 2026-06-10 via read-only SSH: active live run `live_7b62da29…` =
`supertrend_momentum` (started 2026-06-09 22:46:22 UTC, old TimesFM run stopped same second, shadow
paired), full reconciled config confirmed (no AUD_USD, long-only both flags, London/NY only,
risk-multiple exits 1.0R/1.5R/1.0R with breakeven+trailing enabled, riskPerTrade 0.01,
maxOpenPositions 2, timeStopHours 0, enableTrading true). Leftover pip exit keys in the snapshot are
inert — `exitPolicy.resolveConfiguredDistance` prefers risk multiples; pips are last-resort fallback
only. 0 trades yet (expected; restricted posture). Next: review cohort expectancy after ~20–30
closed trades via `/api/analytics?mode=live&runId=live_7b62da29-7325-4819-8df8-15466282a78d&strategy=supertrend_momentum&period=all`.

### Update 2026-06-10 — Live-only diagnosis + stop-floor fix (CODE DONE; user config apply + deploy pending)

User direction this session: ignore paper entirely, focus on live trading only. Live trading was
re-enabled by the user (~2026-06-01) and is ACTIVE — the "live stays PAUSED" statements below are
historical. Active live strategy remains `timesfm_directional` (run `live_5cafbc39…`).

**Root cause found — config drift:** deploy scripts preserve the Pi's `trading_config.json`, so the
Phase 2 remediation config NEVER reached the Pi. The Pi runtime config still has the pre-remediation
tuning that the data condemned: `enableShorting:true` (live shorts −A$35.03), all four sessions
(Tokyo −A$36.32, Sydney −A$33.65; NY overlap +A$9.86 is the only positive cohort), AUD_USD in assets
(−A$35.80, worst pair), `timesFmStrategyRiskReward:1.5` (can't carry a ~21% win rate; needs ~3.8x),
no risk-multiple exit keys so the engine falls back to `breakevenTriggerPips:10` /
`trailingStopActivationPips:15` / `trailingStopPips:5` (strangles winners; live avg win A$2.78 vs
avg loss −A$1.43 at 21% win rate = guaranteed bleed), `riskPerTrade:0.02`, `maxOpenPositions:3`.
Live evidence base: 99 closed live trades, −A$50.67; 68 died at STOP_LOSS (avg 2.8h hold).

**Code bug found + fixed locally:** strategy `tradePlan` stops bypassed the `minStopLossPips` floor —
`LiveTradingEngine.resolveStopLoss` only floored the GLOBAL_CONFIG fallback path. Live AUD_USD trade
2026-06-01 entered with an 8.7-pip stop and was stopped out in 6 minutes. Fixes:
1. `backend/src/strategies/timesFmDirectional.js` — plan stop floored at `minStopLossPips`
   (default 15, added to strategy defaults); target scales off the floored stop so configured R:R
   geometry is preserved. Covers live AND paper since both run the same strategy code.
2. `backend/src/services/LiveTradingEngine.js` `resolveStopLoss` — defensive floor for ALL
   strategies' plan stops (widens to floor from reference price, keeps `SIGNAL_TRADE_PLAN` source so
   post-fill realignment doesn't replace it, adds `floored:true`).
3. Tests updated/added: `timesFmDirectional.test.js` (2 new geometry tests),
   `LiveTradingEngine.test.js` (sub-floor plan widened; existing plan tests moved above floor).
   Focused suites pass: timesFmDirectional + LiveTradingEngine (96), PaperTradingRuntime +
   runtimeCoordinator + registry + tradingRoutes (53). Full `npm test` still blocked locally by the
   known `better-sqlite3` native binding issue.

**Strategy decision (user, 2026-06-10): switch live back to `supertrend_momentum`.** The bot was
originally designed for momentum; TimesFM and the other strategies were edge-hunting attempts. With
the structural fixes in, the user wants the original methodology back. Live entry-type evidence
supports the configured posture: long continuations (`CONTINUATION_ADX`) were the only positive
entry family (+A$4.45/23 overall, +A$11.71/9 in the restricted cohort), FRESH_FLIP went 1/5
(−A$3.74, keep disabled), every SHORT_* family lost (keep `enableShorting:false` AND
`enableShortContinuationEntry:false`). Momentum has no `tradePlan` stops, so it uses the engine's
global ATR stop path (always floored); `enableTakeProfit:false` stays — winners exit via
trail/reversal, which is the runner profile the new exits are designed to harvest.

**Pending user actions:**
1. Commit + push the stop-floor code fix, then deploy on the Pi via `./scripts/update.sh`.
2. Switch strategy + apply the reconciled config in ONE call:
   `POST /api/runtime/live-selection` with `strategyKey:"supertrend_momentum"` and `config` overrides
   (drop AUD_USD, long-only incl. short continuations off, London/NY only, risk-multiple exits
   BE 1.0R / trail activate 1.5R / trail 1.0R, `riskPerTrade:0.01`, `maxOpenPositions:2`,
   `timeStopHours:0`). Exact curl in session summary. This creates a NEW live run (fresh runId) —
   clean attribution for the new posture. 0 open live positions at decision time, so a clean switch.
3. Forward-monitor the new run's cohort expectancy after ~20–30 closed trades via
   `/api/analytics?mode=live&runId=<new>&strategy=supertrend_momentum&period=all`.

Note: `timeStopHours` is a no-op in the live engine (paper-only feature) — the Pi's `3` wasn't
hurting live, but set it to 0 for paper parity and clarity.

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
- Claude has READ-ONLY SSH to the Pi for data only (`adam@img.oakroad`, bot path `/opt/forex-trading-bot`,
  `sqlite3 -readonly`); user runs
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

### Phase 1: Make paper trustworthy (LOCAL CODE DONE; user commit/deploy pending)

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

### Phase 2: Long-only room-to-run candidate (LOCAL CODE DONE; paper launch pending)

Goal: address the LIVE-loss drivers without re-enabling live yet. Phase 2 builds a candidate that removes
negative-edge cohorts and lets winners breathe, then validates it in realistic paper before any promotion.

Completed locally on 2026-05-29:

1. Added shared risk/ATR-aware exit-policy helpers in `backend/src/runtime/exitPolicy.js`.
2. `LiveTradingEngine` now persists live runtime stop metadata at entry (`initialStopLossPrice`,
   `initialStopDistance`, `atrDistance`) and supports risk/ATR-based breakeven/trailing controls:
   `breakevenTriggerRiskMultiple`, `breakevenTriggerAtrMultiplier`,
   `trailingStopActivationRiskMultiple`, `trailingStopActivationAtrMultiplier`,
   `trailingStopRiskMultiple`, `trailingStopAtrMultiplier`. Existing pip configs still work.
3. `PaperTradingRuntime` now supports the same risk/ATR exit controls, so Phase 2 paper candidates and
   future live management use the same protective-stop policy.
4. Added `phase2_room_to_run` candidate preset:
   long-only, short continuations off, London/New York only, excludes AUD_USD, `timeStopHours:0`,
   TimesFM target widened to 3R, breakeven at 1R, trailing activates at 1.5R and trails by 1R.
5. TimesFM directional defaults now mirror that Phase 2 posture (`enableShorting:false`,
   `activeSessions:["london","newyork"]`, `timesFmStrategyRiskReward:3.0`, no time stop). Explicit
   config can still re-enable shorts.
6. Local `backend/data/trading_config*.json` now mirror the Phase 2 candidate posture for fresh installs.
   IMPORTANT: deploy scripts preserve the Pi config, so these do not automatically alter the running Pi config.
7. Read-only Pi cohort checks used to justify the preset: live shorts `-A$35.03`, AUD_USD `-A$33.99`,
   Tokyo `-A$45.48`, Sydney `-A$33.65`, New York `+A$4.07`.
8. Tests: focused Phase 2 suites pass:
   `npm test -- LiveTradingEngine.test.js PaperTradingRuntime.test.js runtimeCoordinator.test.js timesFmDirectional.test.js validation.test.js`
   (`128/128`) and `npm test -- tradingRoutes.test.js` (`3/3`). Full `npm test` remains locally blocked
   by the known missing native `better-sqlite3` binding in repository tests.

Pending user actions after commit/deploy:

- Launch the paper-only Phase 2 candidate on the Pi:
  `curl -s -X POST http://img.oakroad:3101/api/runtime/runs -H 'Content-Type: application/json' -d '{"strategyKey":"timesfm_directional","presetKey":"phase2_room_to_run","label":"TimesFM Phase 2 room-to-run"}'`
- Let it collect a forward sample under realistic paper costs. Do not promote or re-enable live until the
  realistic-paper sample passes the Phase 3 gate.

Checkpoint: the `phase2_room_to_run` candidate shows positive net expectancy in realistic paper over a
minimum sample, ideally by side/session/pair, before live promotion is considered.

### Phase 3: Measurement + hard promotion gate (LOCAL CODE DONE; deploy pending)

Goal: prevent another fantasy-paper promotion by making the promotion path consume realistic-paper
cohort expectancy and fail closed before touching live state.

Completed locally on 2026-05-29:

1. `AnalyticsService` now returns `cohortExpectancy` from closed trades, keyed by the existing
   runtime identity filters (`mode`/`runId`/`strategy`) and grouped by side, instrument, session,
   entry type, and combined `side|session|entryType|instrument` cohort.
2. Cohort expectancy reports net expectancy in pips/AUD using realized trade outcomes, win/loss
   counts, win rate, profit factor, empirical expected edge, and `avgR` where the Phase 2 paper/live
   stop metadata is present.
3. Added `backend/src/runtime/promotionGate.js` with the hard default policy:
   minimum `50` closed realistic-paper trades, positive overall net expectancy, and positive
   expectancy on every side the candidate config can trade. Long-only configs require only BUY;
   configs with shorts enabled require BUY and SELL to both clear the gate.
4. `/api/runtime/runs/:runId/promote` now evaluates the gate for the candidate run using
   `AnalyticsService.getAnalytics("all", { mode:"paper_candidate", runId, strategy })` before
   syncing live trades, stopping/restarting the engine, liquidating positions, updating config, or
   selecting a live strategy. Failed gates return `409 Promotion gate failed`.
5. Passing promotions annotate the candidate run metadata and response payload with the gate result
   so the exact evidence used for promotion is auditable later.
6. Tests: `npm test -- analyticsService.test.js promotionGate.test.js tradingRoutes.test.js` passes
   (`56/56`). Earlier focused Phase 2 suites were also passing; full `npm test` remains locally
   blocked by the known missing native `better-sqlite3` binding in repository tests.

Pending user actions after commit/deploy:

- Ensure new files are included in the commit/deploy set, especially `backend/src/runtime/candidatePresets.js`,
  `backend/src/runtime/exitPolicy.js`, new Phase 3 `backend/src/runtime/promotionGate.js`, and
  Phase 4 `backend/src/runtime/liveActivationReadiness.js`.
- Launch or continue the `phase2_room_to_run` paper candidate and let it reach at least 50 closed
  realistic-paper trades. Promotion should remain blocked until the gate returns `PASS`.
- Do not re-enable live or promote any candidate without explicit user approval.

Checkpoint: candidate promotion is now gated on realistic-paper numbers; a negative or under-sampled
candidate cannot reach live through the promotion endpoint.

### Current Phase — Phase 4: Controlled live re-enable (LOCAL CODE DONE; operational approval pending)

Goal: make the final live re-enable a separate, explicit, size-capped step after a paper candidate
passes the Phase 3 gate.

Completed locally on 2026-05-29:

1. Added `backend/src/runtime/liveActivationReadiness.js` with the Phase 4 controlled-live policy:
   promotion keeps `enableTrading:false`, caps `maxOpenPositions` at `1`, `riskPerTrade` at `0.005`,
   `maxCapitalAtRisk` at `50`, and `maxPortfolioExposure` at `0.1`.
2. Candidate promotion now applies that controlled-live config overlay, so a successful promotion
   selects the gate-passing strategy for live/shadow but still leaves live entries paused.
3. Promotion metadata now carries `promotionGate` and `phase4ControlledLive` onto the live run,
   shadow run, candidate audit metadata, and API response.
4. Added `GET /api/trading/live-readiness` to report whether the active live selection is eligible
   for controlled activation.
5. `POST /api/trading/start` returns `409 Controlled live readiness failed` by default unless
   the active live run has passing promotion-gate evidence and the controlled risk caps are intact.
   The dashboard sends an explicit `manualOverride:true` when the user clicks `ENABLE LIVE`, so the
   user can still manually enable live entries while seeing the readiness warning/result.
6. Tests: `npm test -- liveActivationReadiness.test.js promotionGate.test.js tradingRoutes.test.js runtimeCoordinator.test.js`
   passes (`28/28`). The full focused remediation set should be run before deploy.
7. Added an operational Paper Lab reset-all control:
   `POST /api/runtime/paper/reset` with `{ "confirm": "RESET_PAPER" }` clears paper shadow/candidate
   trades, signals, entry decisions, portfolio snapshots, and active paper run summaries, then
   re-seeds active paper snapshots at starting balance. The Paper Comparison UI exposes this as
   `Reset All Paper`. Live trades and live selection are untouched.

Pending operational steps (user-run only):

- Deploy the full Phase 1-4 commit set.
- Let `phase2_room_to_run` collect the required realistic-paper sample and verify the promotion gate.
- Only after explicit approval, promote the passing candidate. Promotion will keep entries paused.
- Check `GET /api/trading/live-readiness` before live enablement. Dashboard `ENABLE LIVE` can
  manually override a failed readiness result if the user deliberately chooses to proceed.
- After controlled live starts, monitor live vs paired `paper_shadow` per-pip tracking and compare
  against the frozen Phase 0 baseline.

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
- `backend/src/strategies/expectedEdge.js`, `backend/src/services/analyticsService.js`, and
  `backend/src/runtime/promotionGate.js` — Phase 3 cohort expectancy + hard promotion gate.
- `backend/src/runtime/liveActivationReadiness.js` — Phase 4 controlled live-start guardrail.
- Pause/resume live via `POST /api/trading/stop` / `POST /api/trading/start` (persists to config + applies live).

### Next Session Start Checklist

1. Start a new thread; read this `IN PROGRESS` section and `.claude/plans/okay-claude-this-is-iridescent-shore.md`.
2. Do not re-check that live is paused; the user has confirmed it. The active live strategy remains whatever
   `strategy_runs` says, currently `timesfm_directional`, not the repo config's strategy field.
3. Prompt the user to commit Phase 0 baseline + Phase 1/2 changes if they have not already.
4. Include Phase 3 files in the same commit/deploy set. The Pi boot issue on 2026-05-29 was caused by
   a deployed route requiring a new runtime file that was not present on the Pi.
5. Prompt the user to set Pi `timeStopHours:0` and deploy via `./scripts/update.sh`; do not run git/deploy/build.
6. After deploy, ask the user to launch the `phase2_room_to_run` paper candidate via the curl command above.
7. Forward-monitor paired live/shadow data and the Phase 2 candidate via read-only SQL.
8. Use `/api/analytics?mode=paper_candidate&runId=<runId>&strategy=timesfm_directional&period=all`
   to inspect `cohortExpectancy` before any promotion attempt.
9. Use `/api/trading/live-readiness` before any live re-enable. Dashboard `ENABLE LIVE` sends a
   manual override, so it will still let the user proceed even if readiness is not `PASS`.
10. To zero all paper state, use the Paper Comparison `Reset All Paper` button or
   `POST /api/runtime/paper/reset` with `{ "confirm": "RESET_PAPER" }`.
11. Keep `runtimeCoordinator`/`paperTradingRuntime` as the shared backbone; analytics use runtime
   identity columns (`mode`/`runId`/`strategy`). Do not re-enable live or promote a candidate without
   explicit user approval.
12. Remember the config/runtime mismatch: the live strategy is whatever `strategy_runs` says is active,
   not the repo `trading_config.json` field.

### Future UI Enhancement (Captured)

- Current Holdings: compact mobile stop chips / tooltip mode for `TSL` / `BE` / `SL` / `TP` labels (deferred)

---

_See [project_roadmap.md](project_roadmap.md) for full feature list and enhancement status._
