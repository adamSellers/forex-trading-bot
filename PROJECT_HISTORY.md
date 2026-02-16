# Forex Trading Bot - Project History

This document records completed and deployed features, serving as a historical reference.

**Document purposes:**

| Document             | Purpose                          | When to update                            |
| -------------------- | -------------------------------- | ----------------------------------------- |
| `claude.md`          | Current context, in-progress work | During/after active work sessions         |
| `project_roadmap.md` | Future work, feature requests    | When user requests new features           |
| `PROJECT_HISTORY.md` | Completed & deployed features    | After features are deployed to production |

---

## How to Use This Document

When a feature is **fully completed AND deployed to production**:

1. Move it from `claude.md` IN PROGRESS section to this document
2. Include the deployment date and a brief summary
3. Add implementation details that might be useful for future reference

---

## Completed Features

### 2026-02-16 - Forex Migration Completion Sweep (Deployed)

**Summary**: Completed a full forex migration cleanup pass across Strategy Lab wiring, simulation cost model, operational configs, and active UI terminology.

**Deployed Changes**:
1. **Strategy Lab reactivation**
   - Registered lab socket handlers in `server.js`
   - Mounted `/api/backtest` route
   - Fixed worker command/event contract mismatch (`start` + `simulation_complete`)
   - Added Lab view back into frontend navigation

2. **Forex simulation cost model**
   - Removed Binance VIP/BNB fee-tier simulation in lab worker
   - Replaced with forex-oriented cost inputs:
     - `spreadPips`
     - `commissionPerSide`
   - Updated simulation reports to show `totalCosts` / `avgCostPerTrade`

3. **Continuation guardrail tightening**
   - Reduced default `continuationMaxPriceDeviation` from `0.02` to `0.005` (0.5%)
   - Applied consistently across runtime config, signal generator, backtest engine, and lab defaults

4. **Forex terminology and deploy config cleanup**
   - Removed Binance/USDT wording from active dashboard/lab paths
   - Updated nginx sample config to forex paths/ports and valid health endpoints
   - Refreshed script/docs wording away from crypto-specific references

**Validation**:
- Backend tests: **274 passing, 0 failing**
- Frontend production build: **passing**
- Node syntax checks for updated backend entry points: **passing**

### 2026-02-16 - Strategy Risk Alignment + Lab/Backtest Parity Fixes

**Summary**: Deployed and verified a full risk-alignment pass across live execution, signal continuation gating, and strategy-lab/backtest wiring.

**Deployed Changes**:
1. **Live entry exposure hardening (projected exposure)**
   - Entry validation now checks projected post-entry exposure, not only current exposure
   - Prevents new entries that would breach `maxPortfolioExposure` after the order opens

2. **Fill-price stop alignment**
   - Initial SL still protects order at placement time
   - Engine now recalculates and syncs SL from actual fill price to preserve intended risk distance

3. **Continuation quality gate hardening**
   - `ADX_SLOPE_RISING` continuation branches now also require `ADX >= minAdx`
   - Applied symmetrically to LONG and SHORT continuation paths
   - Kept live signal and backtest logic aligned

4. **Backtest/Lab wiring and defaults corrections**
   - Fixed stale backtest route + lab socket path using non-existent simulation methods
   - Restored worker-backed simulation flow in lab runtime
   - Replaced crypto-biased lab/optimizer defaults with forex-aligned defaults (pairs + risk sizing/exposure assumptions)

5. **Risk defaults/documented runtime config alignment**
   - Enabled TP in active runtime config
   - Updated config defaults to match current deployed risk model (`stopLossAtrMultiplier`, `minStopLossPips`, TP defaults)

**Files Modified (Core)**:
- `backend/src/services/LiveTradingEngine.js`
- `backend/src/services/signalGenerator.js`
- `backend/src/services/backtestEngine.js`
- `backend/src/services/configService.js`
- `backend/src/routes/backtestRoutes.js`
- `backend/src/socket/labSocket.js`
- `backend/src/workers/backtestWorker.js`
- `backend/src/workers/optimizationWorker.js`
- `backend/data/trading_config.json`
- `backend/src/services/__tests__/LiveTradingEngine.test.js`
- `frontend/src/components/BacktestLab.jsx`
- `frontend/src/components/lab/LabControls.jsx`

**Validation**:
- Targeted backend suites passing after changes:
  - `LiveTradingEngine.test.js`
  - `backtestEngine.test.js`
  - `signalGenerator.test.js`
- Deployment and device verification: **confirmed**

---

### 2026-02-15 - Short-Side Hardening + Short Health Analytics

**Summary**: Deployed short-side reliability fixes plus new analytics visibility focused on SELL performance quality.

**Deployed Changes**:
1. **Short continuation hardening**
   - Fixed pending-entry direction leakage so LONG continuation logic only consumes LONG pending states
   - Made continuation price-deviation checks symmetric (`abs(deviation)`) for both long/short paths
   - Kept live/backtest continuation behavior aligned

2. **Analytics enhancement: side + short health**
   - Added backend analytics payload for BUY vs SELL performance split
   - Added entry-type side breakdown (BUY/SELL trades, win rates, P&L by `entryType`)
   - Added dashboard Short Health indicator (`Healthy` / `Watch` / `Critical`) based on SELL outcomes

**Files Modified (Core)**:
- `backend/src/services/signalGenerator.js`
- `backend/src/services/backtestEngine.js`
- `backend/src/services/analyticsService.js`
- `backend/src/services/__tests__/analyticsService.test.js`
- `frontend/src/components/AnalyticsDashboard.jsx`
- `frontend/src/components/analytics/StrategyWidgets.jsx`
- `README.md`

---

### 2026-02-15 - Live Runtime Hardening + Phase 1 Risk Gates

**Summary**: Deployed live-runtime hardening and Phase 1 risk controls to production. The engine now enforces session/exposure gates at entry and supports live breakeven stop movement.

**Deployed Changes**:
1. **Live-only runtime refactor**
   - Removed paper-mode branches from runtime engine/API/UI paths
   - Removed `tradingMode` usage from config and live controls

2. **Deployment script hardening**
   - `scripts/update.sh` and `scripts/deploy.sh` preserve runtime config across hard resets
   - Both scripts now hard-fail migration errors
   - Added pruning of old DB backup triplets (`.db`, `.db-wal`, `.db-shm`)

3. **Phase 1 live risk gates**
   - Enforced `maxPortfolioExposure` during live entry validation
   - Enforced session filter (`enableSessionFilter`, `activeSessions`) during live entry validation
   - Added live breakeven behavior (`enableBreakeven`, `breakevenTriggerPips`) with Oanda stop sync

**Files Modified (Core)**:
- `backend/src/services/LiveTradingEngine.js`
- `backend/src/services/configService.js`
- `backend/src/routes/tradingRoutes.js`
- `frontend/src/components/config/GeneralSettings.jsx`
- `frontend/src/components/config/RiskSettings.jsx`
- `frontend/src/components/config/ConfigShared.jsx`
- `frontend/src/components/SystemHealth.jsx`
- `frontend/src/config/api.js`
- `scripts/update.sh`
- `scripts/deploy.sh`

**Testing**:
- Backend tests passing: **268 passing, 0 failing**

---

### 2026-02-15 - Current Holdings Protective Stop Visibility

**Summary**: Deployed dashboard enhancement to show the active protective stop in Current Holdings.

**Changes**:
- Added protective stop display priority in holdings widget:
  - `TSL` when trailing stop is active
  - `BE` when breakeven is active
  - `SL` otherwise
- Added colored chip styling for `TSL`/`BE`/`SL` and `TP`
- Extended engine status payload to expose `trailingStopPrice`, `breakevenHit`, and `takeProfitPrice`

**Files Modified**:
- `frontend/src/components/dashboard/CurrentHoldings.jsx`
- `backend/src/services/LiveTradingEngine.js`

### 2026-02-02 - Short Entry Signal Filtering

**Summary**: SHORT positions now have the same quality filters as LONG entries, eliminating asymmetric risk where shorts bypassed all ADX/RSI checks.

**Problem Discovered**: Short positions WERE being executed (confirmed via trade history), but they bypassed all quality filters that protect long entries. SELL signals were emitted unconditionally on RED flip with no ADX or RSI filtering.

**Solution**: Added symmetric filtering for short entries:

| Filter | LONG (BUY) | SHORT (SELL) |
|--------|------------|--------------|
| ADX ≥ minAdx | ✓ | ✓ (NEW) |
| ADX Rising | ✓ | ✓ (NEW) |
| RSI Check | < 75 (overbought) | > 30 (oversold) (NEW) |
| Pending Entry Tracking | ✓ | ✓ (NEW) |
| Continuation Window | 4 hours | 4 hours (NEW) |

**Key Changes**:
1. **Signal Generator** - Section 5 (RED flip) now filters shorts like Section 3 filters longs
   - `entryType: "SHORT_ENTRY"` when conditions met
   - `entryType: "EXIT_ONLY"` when conditions fail (still closes longs, but no short opened)
   - Pending short entries tracked with `direction: "SHORT"` field
   - New `RSI_RECOVERY` waitingFor state (inverse of RSI_COOLDOWN)

2. **LiveTradingEngine** - Checks `entryType !== "EXIT_ONLY"` before opening shorts

3. **Frontend** - Added short pending badges ("S" indicator) and RSI_RECOVERY handling

**Files Modified**:
- `backend/src/services/signalGenerator.js` - Short filtering + continuation logic
- `backend/src/services/LiveTradingEngine.js` - entryType check for shorts
- `frontend/src/components/dashboard/TradingSignals.jsx` - Short pending badges

**Config Notes**: `enableShorting: true` and `rsiOversold: 30` already existed in config.

---

### 2026-02-02 - Signals Component Enhancement

**Summary**: Improved the Signals table in the Trading Dashboard with ADX trend arrows and meaningful block reason badges.

**Changes**:

1. **ADX Arrows** - Added rising/falling arrows (↑/↓) next to ADX values
   - Green ↑ when `trend.adxRising` is true
   - Red ↓ when `trend.adxRising` is false

2. **Block Reason Badges** - Replaced generic "NEW/LOGGED" status with meaningful badges:
   - "NEW" (green) - BUY/SELL signals
   - "ADX" (red) - Blocked due to weak ADX
   - "SLOPE" (red) - Blocked due to falling ADX
   - "RSI" (red) - Blocked due to overbought
   - "HOLD" (gray) - Neutral hold
   - Uses `signal.pendingEntry.waitingFor` enum

3. **Fixed Signal Repository Bug** - Column name mismatch was causing `SQLITE_ERROR`:
   - `symbol` → `instrument`
   - `current_price` → `price`
   - `atr` → `atr_pips`
   - `trend_data` JSON → individual columns (`rsi`, `adx`, `supertrend_direction`, `entry_type`)
   - `new Date()` → epoch milliseconds (bigint)

**Files Modified**:
- `frontend/src/components/dashboard/TradingSignals.jsx` - ADX arrows and block reason badges
- `backend/src/repositories/signalRepository.js` - Fixed column name mapping

---

### 2026-01-31 - Signal Persistence for Analytics

**Summary**: Fixed "No signal data" issue in Analytics Dashboard Signal Filtering widget by persisting signals to the database with 90-day retention.

**Problem**: `signalGenerator.js` emitted signals but never saved them to the database. The analytics endpoint queried an empty signals table.

**Solution**:
- SignalGenerator now accepts `signalRepository` as second constructor parameter
- Calls `signalRepo.saveBatch(signals)` after each signal cycle
- Added `deleteOlderThan(days)` method to signalRepository for retention cleanup
- Daily cleanup job runs at midnight (90-day retention keeps table bounded at ~5.4 MB)

**Files Modified**:
- `backend/src/services/signalGenerator.js` - Accept signalRepository, persist signals
- `backend/src/repositories/signalRepository.js` - Added `deleteOlderThan()` method
- `backend/server.js` - Wire up signalRepository, add daily cleanup scheduler
- `backend/src/services/__tests__/signalGenerator.test.js` - 6 new tests for persistence
- `backend/src/repositories/__tests__/signalRepository.test.js` - NEW file, 13 tests

**Testing**: 193 passing, 0 failing (was 174)

**Verification**:
```bash
# Check signals being saved
sqlite3 backend/data/trading.db "SELECT COUNT(*) FROM signals WHERE timestamp > datetime('now', '-1 hour');"

# Check cleanup scheduler
pm2 logs forex-backend --lines 50 | grep "cleanup scheduled"
```

---

### 2026-01-27 - Exit Reason Detection

**Summary**: Fixed analytics dashboard showing all exits as "EXTERNAL" - now correctly identifies Stop Loss, Take Profit, and Trailing Stop exits from Oanda.

**Problem**: When Oanda closed trades (via SL/TP orders), the `determineExitReason()` method returned generic "EXTERNAL" instead of checking what actually triggered the close.

**Solution**: Enhanced `determineExitReason()` to check Oanda order states:
- `stopLossOrder.state === "FILLED"` → "STOP_LOSS"
- `takeProfitOrder.state === "FILLED"` → "TAKE_PROFIT"
- `trailingStopLossOrder.state === "FILLED"` → "TRAILING_STOP"
- Otherwise → "EXTERNAL" (manual close on Oanda platform)

**Additional Changes**:
- Added `formatExitReason()` helper for title case display (STOP_LOSS → "Stop Loss")
- Added "External" color to analytics pie chart
- Updated RecentTrades component for Signal Reversal and External color coding
- Fixed 2 failing tests (expected title case format)

**Files Modified**:
- `backend/src/services/LiveTradingEngine.js` - Enhanced `determineExitReason()`
- `backend/src/services/analyticsService.js` - Added `formatExitReason()` helper
- `frontend/src/components/analytics/StrategyWidgets.jsx` - Added External color
- `frontend/src/components/dashboard/RecentTrades.jsx` - Updated exit reason colors
- `backend/src/services/__tests__/analyticsService.test.js` - Fixed test expectations

**Testing**: 174 passing, 0 failing

---

### 2026-01-27 - Short Selling Bug Fix

**Summary**: Fixed 5 critical bugs causing 100% loss rate on SHORT positions.

**Root Cause**: Short selling logic was hardcoded for BUY direction only.

**Bugs Fixed**:
1. **Missing `enableShorting` config** - Added to DEFAULT_CONFIG (defaults to `false`)
2. **Paper trade stop loss check** - Now direction-aware (BUY: `<=`, SELL: `>=`)
3. **Paper trade take profit check** - Now direction-aware (BUY: `>=`, SELL: `<=`)
4. **P/L calculation** - Now direction-aware (BUY: exit-entry, SELL: entry-exit)
5. **Logging** - Changed hardcoded "PAPER BUY" to dynamic `trade.side`

**Files Modified**:
- `backend/src/services/configService.js` - Added `enableShorting: false`
- `backend/src/services/LiveTradingEngine.js` - Fixed lines 888, 965-968, 1088-1093, 1103-1108

**Note**: `enableShorting` defaults to `false`. Enable in config to allow short positions.

---

### 2026-01-20 - Test Suite Complete

**Summary**: Comprehensive Jest test suite for critical trading logic - all tests passing.

**Key Changes**:
- Created test infrastructure with fixtures, mocks, and in-memory SQLite
- 174 tests passing covering LiveTradingEngine, signalGenerator, Oandaclient, analyticsService, tradeRepository
- Fixed Oandaclient tests (native fetch mocking instead of nock)
- Fixed signalGenerator tests (assertion update for HOLD signal)
- Fixed Jest hoisting issue in tradeRepository tests (`testDbInstance` → `mockTestDbInstance`)
- Added missing EventEmitter methods to mock services (`removeListener`, `off`, `once`, etc.)
- Fixed LiveTradingEngine test assertions (margin validation, Oanda sync mocking)

**Files Modified**:
- `backend/jest.config.js` - Test configuration
- `backend/__tests__/setup.js` - Global test setup
- `backend/__tests__/fixtures/` - Mock data factories
- `backend/__tests__/helpers/mockServices.js` - Mock service utilities with EventEmitter support
- `backend/src/services/__tests__/*.test.js` - Service tests
- `backend/src/repositories/__tests__/tradeRepository.test.js` - Repository tests

**Testing**: 174 passing, 0 failing

---

### 2026-01-19 - Margin-Aware Position Sizing

**Summary**: Position sizing now uses available margin instead of total balance, preventing over-leveraging and margin call warnings.

**Key Changes**:
- Changed position sizing from `balance` to `marginAvailable`
- Added 20% margin buffer (configurable via `marginBuffer` config)
- Trades rejected when insufficient margin available
- Log output shows margin status on each trade evaluation

**Files Modified**:
- `backend/src/services/LiveTradingEngine.js` - `calculatePositionSize()` now uses marginAvailable
- `frontend/src/components/dashboard/CurrentHoldings.jsx` - Calculates P&L when Oanda data missing

**Configuration**:
```javascript
{
  maxCapitalAtRisk: 70,    // Cap for position sizing base
  marginBuffer: 0.20       // Keep 20% margin reserve
}
```

---

### 2026-01-17 - Navigation Overhaul & Analytics Dashboard

**Summary**: Full routing implementation with dedicated pages for Dashboard, Analytics, System Health, and Settings.

**Key Changes**:
- Implemented tab-based navigation with React Router
- Added deep analytics with server-side metrics calculation
- Created System Health monitoring page with real-time service status
- Session analysis and pair performance breakdowns

**Files Modified**:
- `frontend/src/App.jsx` - Navigation router
- `frontend/src/components/Navigation.jsx` - Tab bar component
- `frontend/src/components/AnalyticsDashboard.jsx` - Performance charts
- `frontend/src/components/SystemHealth.jsx` - Service monitoring
- `backend/src/services/analyticsService.js` - Metrics calculations

---

### 2026-01-12 - Database WAL Fix

**Summary**: Fixed critical data loss issue caused by SQLite WAL files being tracked by git.

**Key Changes**:
- Untracked `trading.db-wal` and `trading.db-shm` from git
- Untracked `trading_config.json` from git
- Added `trading_config_initial.json` as tracked config template
- Deploy scripts now backup WAL files and initialize config from template

**Files Modified**:
- `.gitignore` - Already had patterns (just didn't affect tracked files)
- `scripts/update.sh` - WAL backup + config template logic
- `scripts/deploy.sh` - WAL backup + config template logic
- `backend/data/trading_config_initial.json` - NEW tracked template

**Root Cause**: `git reset --hard` during deployment overwrote WAL files with stale versions, corrupting/losing uncommitted transactions.

---

### 2026-01-12 - Margin-Based Take Profit

**Summary**: Changed take profit calculation from account-balance-based to margin-based, making targets achievable per-trade.

**Key Changes**:
- TP now targets 6% of margin used for that specific trade
- TP set via `modifyTrade()` after order fills (uses actual `initialMarginRequired`)
- Frontend and backend both updated
- Configurable from 2% to 15% via UI slider

**Files Modified**:
- `backend/src/services/LiveTradingEngine.js` - `calculateTakeProfit()` uses margin
- `backend/data/trading_config.json` - Added `enableTakeProfit`, `takeProfitPercent`
- `frontend/src/components/config/RiskSettings.jsx` - UI for TP settings

**Example**: With $46.17 margin and 795 units EUR_USD, TP target = $2.77 (~35 pips)

---

### 2026-01-10 - Stop Loss Tuning

**Summary**: Widened stop losses to reduce premature stop-outs observed in Week 1 (9/12 trades hit SL).

**Key Changes**:
- Increased ATR multiplier from 1.5x to 2.0x
- Added minimum stop loss floor of 12 pips
- Position sizes automatically decrease (wider stops = smaller positions for same risk)

**Files Modified**:
- `backend/data/trading_config.json` - Updated multiplier, added minStopLossPips
- `backend/src/services/LiveTradingEngine.js` - Added minimum floor logic
- `frontend/src/components/config/RiskSettings.jsx` - UI for min stop setting

**Configuration**:
```javascript
{
  stopLossAtrMultiplier: 2.0,  // Was 1.5
  minStopLossPips: 12          // New - floor to prevent tight stops
}
```

---

### 2026-01-10 - Email Alerts

**Summary**: Trade open/close notifications via Gmail SMTP.

**Key Changes**:
- Added nodemailer integration for email alerts
- Trade opened/closed emails with position details and P&L
- Test email button in dashboard UI
- Configurable via UI toggle and email field

**Files Modified**:
- `backend/src/services/emailService.js` - NEW Gmail SMTP integration
- `backend/src/routes/tradingRoutes.js` - `/api/email/test` endpoint
- `frontend/src/components/config/NotificationSettings.jsx` - Email UI

---

### 2026-01-10 - S3 Analytics Reports

**Summary**: Automated upload of performance analytics to AWS S3 for historical tracking.

**Key Changes**:
- S3ReportScheduler runs hourly
- Daily reports uploaded at midnight UTC
- Weekly reports uploaded on Sundays
- Manual upload via API or dashboard button

**Files Modified**:
- `backend/src/services/s3ReportScheduler.js` - NEW scheduler service
- `backend/src/utils/awsS3Utils.js` - NEW S3 upload utility
- `frontend/src/components/config/NotificationSettings.jsx` - S3 status UI

---

### 2026-01-10 - Take Profit Feature (Initial)

**Summary**: Added take profit functionality to capture profits before signal reversal.

**Key Changes**:
- Target profit based on configurable percentage
- TP orders set on Oanda server-side
- Coexists with signal reversal exits

**Problem Solved**: EUR/USD trade peaked at +$6 unrealized but exited at ~$1.50 waiting for SuperTrend reversal.

---

### 2026-01-10 - P&L Tracking Fix

**Summary**: Fixed P/L calculation to use Oanda's `realizedPL` instead of simple price difference.

**Key Changes**:
- Now uses Oanda's `realizedPL` as source of truth (includes spreads, financing, conversion)
- Swap fees stored in `swap_aud` column
- Fixed ~$2.65 AUD discrepancy from Week 1

**Files Modified**:
- `backend/src/services/LiveTradingEngine.js` - `handleExternalClose()`, `executeExit()`, `closeTrade()`

---

### 2026-01-10 - Automated Backups

**Summary**: Daily automated backups via cron job at 3:00 AM.

**Key Changes**:
- Full backup to `~/forex-trading-bot-backups/`
- 7-day retention for full backups, 14-day for DB only
- Setup script for cron installation

**Files Modified**:
- `scripts/backup.sh` - Backup script
- `scripts/restore.sh` - Restore script
- `scripts/setup-cron-backup.sh` - Cron installation

---

### 2026-01-03 - Market Status Banner

**Summary**: Added market status indicator with countdown timer to next session.

**Files Modified**:
- `frontend/src/components/dashboard/` - Market status component

---

### 2026-01-02 - Production Deployment

**Summary**: Deployed to Raspberry Pi 5 at img.oakroad for live trading.

**Key Changes**:
- PM2 configuration with ecosystem.config.js
- Deployment scripts (deploy.sh, update.sh)
- Secret encryption setup
- Health check endpoints
- Nginx reverse proxy (optional)

---

### 2025-12-31 - Trailing Stop Support

**Summary**: Added trailing stop functionality for profit lock-in.

**Configuration**:
```javascript
{
  enableTrailingStop: true,
  trailingStopPips: 25,      // Trail distance
  trailingActivationPips: 20  // Activation threshold
}
```

---

### 2025-06-05 - Core Refactor

**Summary**: Major refactor of trading engine architecture.

**Key Changes**:
- Separated concerns: SignalGenerator, LiveTradingEngine, OandaDataService
- Event-driven architecture with EventEmitter
- Repository pattern for data access
- Service layer for business logic

---

### 2025-06-05 - Live API Integration

**Summary**: Connected to Oanda Live API for paper trading and strategy testing.

---

### 2025-06-04 - Project Initialized

**Summary**: Initial project setup with Express backend and React frontend.

**Key Changes**:
- Express.js + Socket.IO backend structure
- React + Vite frontend structure
- SQLite database with Knex.js migrations
- Basic trading dashboard components

---

## Timeline

| Date       | Milestone                                              |
| ---------- | ------------------------------------------------------ |
| 2025-06-04 | Project initialized                                    |
| 2025-06-05 | Live API integration, core refactor                    |
| 2025-12-31 | Trailing stop support                                  |
| 2026-01-02 | Production deployment on Raspberry Pi                  |
| 2026-01-03 | Market status banner                                   |
| 2026-01-10 | Week 1 analysis, P&L fix, stop loss tuning, TP, email, S3, backups |
| 2026-01-12 | Database WAL fix, margin-based TP                      |
| 2026-01-17 | Navigation overhaul, analytics dashboard               |
| 2026-01-19 | Margin-aware position sizing                           |
| 2026-01-20 | Test suite complete (174 passing, 0 failing)           |
| 2026-01-27 | Short selling bug fix, ADX slope filter, exit reason detection |
| 2026-01-31 | Signal persistence for analytics, 90-day retention (193 tests) |
| 2026-02-02 | Signals component enhancement, Short entry signal filtering    |
| 2026-02-15 | Short-side hardening and short health analytics                |

---

_This document is updated when features are deployed to production._
