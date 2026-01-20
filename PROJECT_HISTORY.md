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

---

_This document is updated when features are deployed to production._
