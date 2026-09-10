# Forex Trading Bot - Project History

This document records completed and deployed features, serving as a historical reference.

**Document purposes:**

| Document             | Purpose                          | When to update                            |
| -------------------- | -------------------------------- | ----------------------------------------- |
| `CLAUDE.md`          | Current context, in-progress work | During/after active work sessions         |
| `project_roadmap.md` | Future work, feature requests    | When user requests new features           |
| `PROJECT_HISTORY.md` | Completed/deployed feature record | After production deployments or explicit code-complete milestones |

---

## How to Use This Document

When a feature is **fully completed in code** or **deployed to production**:

1. Move it from `CLAUDE.md` IN PROGRESS section to this document
2. Include the completion/deployment date and a brief summary
3. State deployment status explicitly when code is complete but not yet rolled out
4. Add implementation details that might be useful for future reference

---

## Current Repository State

The current product has one live OANDA runtime and one strategy. Production `intraday_momentum` `1.1.1` / `m15-intraday-v3.1` was verified at user-deployed revision `d46da61` on September 10. Local v3.2 / strategy 1.1.2 contains the approved maintenance and quote-limit corrections and awaits user publication/build/deployment. Simulated runtimes, alternate strategy modules, strategy switching, forecasting services and offline replay tooling are retired. Runtime identity remains for broker ownership and cohort analytics.

---

## Completed Features

### 2026-09-10 — Maintenance and quote-limit correction (local)

The user approved fixes after read-only investigation identified backup restoration turning a bounded loss cooldown into a persistent pause, and exact-limit spreads rejected through floating-point error. Activation now distinguishes desired enabled state from current entry eligibility, with truthful dashboard wording and all other readiness blockers retained. An active cooldown retains its original deadline across a new release cohort. Quote-derived spread, cost and movement comparisons account for numerical error without changing price precision or trading limits. The v3/v3.1 migration preserves saved parameters; new execution decisions belong to v3.2 / strategy 1.1.2. [The implementation record](docs/reviews/2026-09-10-maintenance-and-quote-boundaries.md) contains rationale, verification and limitations. **Local changes only; no production activation or deployment.**

The same inspection verified the user's earlier v3.1 deployment at `d46da61`. Repeated entries were distinct completed-candle setups under the existing continuation strategy; no re-entry or pair-selection tuning was implemented.

### 2026-09-08 — Quote-freshness investigation and full correction (local)

Read-only observation showed normal five-second price delivery while the new event-age classification reported a degraded bot. Isolated engine reproductions confirmed possible entry vetoes, though the inspected current-run decisions contained no recorded age-based rejection. The user requested a cross-project lesson and a plan before deciding on implementation. Saved the lesson in global Codex instructions and wrote the [fix plan](docs/reviews/2026-09-08-quote-freshness-fix-plan.md), including hidden conversion/telemetry/deployment consumers and the release-upgrade defaults-reset hazard. The user then approved the full fix. Implemented validated receipt semantics across all affected consumers, preserved event-time evidence and numerical strategy/risk/exit settings, added bounded final request-to-submit timing, corrected health/API reporting and retained strict deployment checks. A narrow v3→v3.1 upgrade preserves saved parameters and prior owners/cohorts. The linked implementation record contains the change/rationale/test matrix and final verification totals. **Local code complete; production not changed in this pass.**

### 2026-09-08 — Record exit-policy observations and take-profit review priority

The user requested that future performance reviews keep the fixed 1.5R target under consideration after September 7's three USD/JPY profits preceded a larger decline. Updated current project instructions and the roadmap with that priority, evaluation criteria and the boundary that no tuning is authorized yet. Read-only production inspection explained September 8's USD/JPY Time Stop: entry 00:30:45, exit 06:30:51 AEST, net A$0.0219. The six-hour rule dated to August 10 but only became active through the September 6 live-monitor correction. The [observation record](docs/reviews/2026-09-08-exit-policy-observations.md) preserves exact evidence, provenance and limitations. This pass changed documentation only.

### 2026-09-07 — Remove operational warning/recovery emails (deployed)

The remediation had reused the existing trade-email flag for automatic health incidents and immediate recovery messages. Production logs showed 18 warning/recovery pairs (36 emails) on September 7, including the user's pictured quote-age warnings while the broker remained connected. Removed the operational email method, health-monitor mail dependencies, incident notification state and dashboard email-status label. Existing trade emails, health visibility and trading checks remain. The [incident record](docs/reviews/2026-09-07-operational-email-removal.md) captures the cause, product boundary and verification. **Subsequently deployed by the user at `8e4fb99`, verified over read-only SSH on September 7 and 8.**

### 2026-09-07 — v3 and startup checkpoint correction verified deployed

Read-only SSH first verified user-deployed `8d45be3`, `m15-intraday-v3`, strategy `1.1.0`, healthy operation and direct API access. Repeated startup candle aborts coincided with an exact 30-second synchronous WAL checkpoint stall while the deployment health scan held a database reader. The correction moves TRUNCATE into a bounded child process, defers database health scans until the runtime is ready, identifies timeout timeframes and selects the installed UTF-8 locale. At 13:56 AEST, read-only SSH verified user-deployed `788a725`, healthy operation after more than five hours of uptime, fresh quotes/candles and resolved broker state. [The incident report](docs/reviews/2026-09-07-startup-checkpoint.md) records evidence, justification and tests.

### 2026-09-07 — Remove operator login for private use (local)

The user clarified that the bot is a private personal tool on their internal network and explicitly requested removal of the login requirement. Removed the dashboard gate, login/logout, API/socket authentication and startup/provisioning requirements. Maintenance uses direct local API calls; the deployment command can reuse a previously saved credential only when replacing the old login-gated process. Trading controls still enforce readiness/risk checks, and broker credentials remain server-side. Current instructions record this product boundary to avoid reintroducing a SaaS-style access model. Local verification is recorded in the remediation register; no deployment was performed in this pass.

### 2026-09-06 — One-command deployment follow-up (local)

At the user's request, `./scripts/deploy.sh` was extended to own SSH, first-upgrade operator setup (subsequently removed on September 7), staged preparation/test/build, pause/flat/queue checks, verified backup, migration, restart, health and readiness-gated restoration of the previous trading state. `update.sh` uses the same workflow on the Pi. The ordinary guide is short; recovery and access administration have a separate reference. [The remediation register](docs/reviews/2026-09-06-remediation.md#one-command-deployment-follow-up) records rationale and verification. **Not deployed in this pass.**

### 2026-09-06 — End-to-end production review and remediation authorization

Read-only review verified production commit `bee8527`, `m15-intraday-v2`, a flat A$96.7558 account, and all 17 M15 close prices/net outcomes against OANDA. Combined net profit was A$0.0162; this is not evidence of reliable profitability. Found disconnected timed exits, incorrect closeout entry quotes, lifecycle/recovery gaps and misleading operator analytics. The full [review](docs/reviews/2026-09-06-production-review.md) preserves evidence and limitations.

The user authorized local implementation and documentation of the findings. Track each change and its justification in the [remediation register](docs/reviews/2026-09-06-remediation.md). Funding and risk limits remain unchanged. The former CLAUDE instructions are archived and replaced by an authoritative current-state guide.

**Deployment state**: September 2 cooldown and August backup changes verified deployed on September 6. September 6 remediation is implemented and verified locally (500 backend tests; isolated operations tests), and has not been deployed. The corrected local identity is `m15-intraday-v3` / `intraday-risk-v3` / `broker-liquidity-v2`, strategy `1.1.0`. The remediation register records each change, justification and verification limit.


### 2026-09-02 - Bounded Consecutive-Loss Cooldown (Code Complete)

**Root cause**: The live risk policy counted losses across the entire active run and permanently rejected every later entry after three consecutive losses. A restart correctly reconstructed the same streak, but there was no cooldown expiry and no possible winning trade to clear it.

**Implementation**: The `m15-intraday-v2` / `intraday-risk-v2` release starts a 24-hour entry cooldown at the third broker-confirmed losing exit. The state is reconstructed deterministically from retained live trades, expires into a fresh streak without deleting history, and treats the first later loss as one rather than four.

**Observability**: Live readiness now reports `COOLDOWN` with the exact expiry, system health distinguishes the expected safety state from infrastructure degradation, and both dashboard views show the active cooldown and remaining time.

**Coverage**: Risk, engine, route and configuration tests cover activation, expiry, restart reconstruction, new-run isolation, post-expiry counting and readiness-gated activation.

**Deployment Note**: Verified deployed on 2026-09-06 at production commit `bee8527`, with `m15-intraday-v2` active. Future rollouts still require a flat broker account, paused entries, readiness and reconciliation.

### 2026-08-13 - Bounded, Single-Instance Production Backups (Code Complete)

**Containment**: Stopped three overlapping SQLite backup jobs that had run for up to 53 hours and generated roughly 10 TB of SD-card writes. Removed only their incomplete snapshots, recovering 8.3 GB while retaining four completed database backups.

**Implementation**: Replaced live, unbounded `.backup` copies with a locked, timed and atomic workflow. Database snapshots pause entries, require a flat OANDA account, stop PM2 only while flat, verify with `PRAGMA quick_check`, restart the runtime and restore trading through live readiness. Retention runs before and after backup and defaults to three verified copies.

**Coverage**: `deploy.sh` and `update.sh` now use the canonical implementation and require a fresh backup. Shell regression tests cover success, overlap, snapshot failure recovery, and open-position refusal.

**Deployment Note**: Verified deployed on 2026-09-06. Current backup logs show bounded snapshots, open-position deferral and restoration; September 6 immutable SQLite snapshot passed an independent quick_check.

### 2026-08-10 - M15 Intraday Momentum Live Release (Code Complete)

**Summary**: Replaced the low-frequency daily carry breakout with the `m15-intraday-v1` release. The sole strategy uses completed M15 triggers, completed H1 EMA/ADX direction, M15 RSI confirmation, pair-specific daylight-saving-aware liquid sessions, and a spread-plus-slippage cost gate.

**Risk and exits**: 0.25% NAV risk, A$100 capital cap, one position, 1.25 M15 ATR/six-pip minimum broker stop, 1.5R broker take profit, breakeven at 1R, six-hour time stop, narrow pre-rollover closure, 1% daily loss halt, three-loss halt and 5% high-watermark drawdown halt.

**Removal**: Deleted the runnable `carry_trend` strategy and its configuration surface. Historical trade records and the dated August 4 design document remain as audit history.

**Deployment Note**: Mark deployed only after the production rollout, live-readiness check and broker reconciliation complete.

### 2026-08-04 - Live-Only Carry Trend Rebuild (Code Complete)

**Summary**: Rebuilt the runnable product around direct live OANDA execution and the `carry-trend-v1` release. The strategy uses completed H4/daily candles, 50/200-day trend, 60-day momentum, a fresh 20-day breakout and live broker financing alignment.

**Risk**: 0.5% NAV per trade, A$100 capital cap, one position, 2.5 daily ATR/20-pip minimum broker stop, portfolio enforcement and fail-closed readiness checks.

**Removal**: Deleted the simulated engine, simulated runtime APIs/UI, alternate strategy implementations, strategy-change workflow, forecasting sidecar and replay/research CLIs.

**Deployment Note**: Mark deployed only after the production rollout and post-deploy broker reconciliation complete.

### 2026-05-26 - Correlation Divergence Candidate (Code Complete)

**Summary**: Registered `correlation_divergence` as the seventh canonical strategy. It runs as a paper-only candidate that compares a target USD pair against peer USD-factor moves and tests single-leg mean reversion when residual divergence is large.

**Code State**:
1. `backend/src/strategies/correlationDivergence.js` exports the strategy definition, default config, and analysis helpers.
2. The strategy catalog marks it as `runtimeStatus: "candidate"` with `supportsCandidate: true`, `supportsLive: false`, and `supportsShadow: false`.
3. `MarketContextService` exposes peer candles so the strategy can compare the active instrument against other configured assets.
4. Backend tests cover the strategy and peer-candle runtime context.

**Deployment Note**:
- Not marked deployed here until the user confirms a production rollout.

### 2026-04-28 - TimesFM Directional Promotion Readiness (Code Complete)

**Summary**: Updated the strategy catalog metadata so `timesfm_directional` can be promoted from a candidate paper run to a live selection after review.

**Code Changes**:
1. Marked `timesfm_directional` as `supportsLive: true` and `supportsShadow: true`.
2. Added registry coverage to lock live/shadow/candidate support metadata.
3. Added runtime coordinator coverage proving a live TimesFM run prefetches forecast context and emits an entry-enabled live signal.
4. Updated operator docs to describe candidate promotion and sidecar dependency behavior.

**Validation**:
- Targeted backend suites passing:
  - `src/strategies/__tests__/registry.test.js`
  - `src/runtime/__tests__/runtimeCoordinator.test.js`
  - `src/strategies/__tests__/timesFmDirectional.test.js`
- Full backend suite requires a compatible local `better-sqlite3` native binding for the active Node version before DB-backed repository suites can run.

**Deployment Note**:
- Not marked deployed here until the user confirms the production rollout.

### 2026-03-30 - Shared Strategy Runtime Phases 1-5 (Code Complete)

**Summary**: Completed the runtime migration in code: strategy runs, live hot-swap, shadow paper baseline, candidate paper runs, unified analytics, and legacy backtest/lab retirement.

**Code Changes**:
1. Added the shared `strategy_runs` registry and runtime identity columns.
2. Routed live, shadow paper, and candidate paper signal generation through `runtimeCoordinator`.
3. Preserved `ownerRunId` semantics so existing live positions remain managed by their opening run.
4. Added `PaperTradingRuntime` for shadow/candidate execution, resets, snapshots, and run summaries.
5. Replaced the supported operator comparison workflow with the runtime-backed Paper view.
6. Added runtime analytics and run detail APIs for trades, signals, and equity.
7. Retired the legacy backtest/lab production path.

**Deployment Note**:
- Phase 6 rollout and monitoring remain the operator checkpoint before this becomes deployed production history.

### 2026-03-20 - Trading Telemetry, Reconciliation, and Parity Hardening (Deployed)

**Summary**: Deployed the March 20 hardening pass across live signal generation, execution persistence, broker-close reconciliation, analytics/export, and backtest/lab parity. This deployment is the baseline for the next 2-week live review window.

**Deployed Changes**:
1. **Canonical config/default contract**
   - Added shared config defaults used across backend, frontend, and lab
   - Normalized config coercion and protected config-freeze keys
   - Added strategy-scoped `configHash` generation for telemetry cohorts
   - Aligned committed runtime templates to the approved live cohort:
     - `AUD_USD`, `EUR_USD`, `GBP_USD`, `USD_JPY`
     - `enableShorting=true`
     - `enableShortContinuationEntry=true`
     - `enableHTFFilter=true`
     - all four major sessions enabled

2. **Live signal logic hardening**
   - Added delayed higher-timeframe confirmation handling so valid M15 flips are not discarded when H1 is late
   - Preserved stable setup identity across pending-state transitions
   - Added structured signal telemetry:
     - `reasonCode`
     - `signalClass`
     - `intent`
     - `setupId`
     - `signalCandleTime`
     - `uniqueEvent`
     - `cooldownSuppressed`
     - `pendingState`
     - `decisionContext`

3. **Execution persistence and broker reconciliation**
   - Persisted stop-management state used by live monitoring and restart recovery:
     - `stopLossPrice`
     - `lowestPrice`
     - `breakevenHit`
     - `activeStopType`
   - Added broker-close reconciliation metadata:
     - `closePriceSource`
     - `reconciliationStatus`
     - `brokerExitReason`
     - `brokerClosedAt`
     - `lastBrokerSyncAt`
     - `brokerReconciliationPayload`
   - Hardened external-close handling so broker-side exits are recovered and classified instead of silently flattening to entry price

4. **Analytics/export uplift**
   - Fixed signal cutoff handling in analytics
   - Split unique actionable events from cooldown duplicates
   - Added expectation-vs-actual reporting keyed by cohort/config hash
   - Updated export script to emit structured signal telemetry, cooldown duplicate exports, and expectation-vs-actual CSV output

5. **Backtest and lab parity**
   - Moved backtest defaults closer to live config behavior
   - Kept delayed HTF confirmation and pullback continuation taxonomy aligned with live strategy
   - Updated lab/worker/CLI config mapping to the canonical config contract
   - Updated frontend config surfaces to use shared defaults and current live field names

6. **Operational safety**
   - Added additive migration `003_add_strategy_telemetry_and_reconciliation.js`
   - Confirmed deploy scripts run `npm run db:migrate` during deployment
   - Confirmed the March 20 migration is additive only and does not destroy existing rows during normal deploys

**Validation**:
- Targeted backend verification: **244 passing, 0 failing**
  - `signalGenerator.test.js`
  - `LiveTradingEngine.test.js`
  - `analyticsService.test.js`
  - `signalRepository.test.js`
  - `tradeRepository.test.js`
  - `backtestEngine.test.js`
- Frontend production build: **passing**

**Operational Note**:
- This deployment is the measurement baseline for the next live review after 2 weeks of trading.

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
- Preserved `trading_config.json` across deploy resets so production runtime settings are not overwritten
- Added `trading_config_initial.json` as tracked config template
- Deploy scripts now backup WAL files and initialize config from template

**Files Modified**:
- `.gitignore` - Already had patterns (just didn't affect tracked files)
- `scripts/update.sh` - WAL backup + config template logic
- `scripts/deploy.sh` - WAL backup + config template logic
- `backend/data/trading_config_initial.json` - NEW tracked template
- `backend/data/trading_config.json` - current runtime config file; deploy/update scripts back it up before git reset and restore it afterward

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
| 2026-03-30 | Shared runtime Phases 1-5 code complete, legacy lab retired    |
| 2026-04-28 | TimesFM Directional promotion readiness code complete          |
| 2026-05-26 | Correlation Divergence paper candidate code complete           |

---

_This document records deployed features and code-complete milestones. Deployment status is called out explicitly for unreleased items._
