# Trading Strategy Runtime Update Plan

## Session Management

This is a multi-phase feature. To preserve context:

- Start implementation in a new session by saying `continue where we left off`
- Complete the phases in order and do not skip ahead
- Stop after each major phase checkpoint
- After each phase, update `CLAUDE.md` `IN PROGRESS`, post a short checkpoint summary, and recommend starting a new thread
- Build and test incrementally for each packet before moving to the next packet or phase
- Legacy backtest/lab comparison is retired in Phase 5; continue from the runtime-only model in Phase 6

## Phase 0 Scope

This thread covers Phase 0 only:

- `DOC-01` Rewrite this document so it reflects the approved end-state architecture, full strategy catalog, atomic packet set, and phase checkpoints
- `DOC-02` Align session/planning docs so they no longer conflict with the approved direction

Stop after the Phase 0 checkpoint in this thread.

## Current Checkpoint

As of 2026-03-30:

- Phases 1-5 are complete in code
- Comparison and analytics now flow through the shared runtime only
- Legacy backtest/lab production paths and offline comparison tooling are retired
- Phase 6 rollout/monitoring remains the operator checkpoint
- As of 2026-04-28, `timesfm_directional` is live-promotable from a reviewed paper candidate run
- As of 2026-05-26, `correlation_divergence` is registered as the seventh canonical strategy and is intentionally paper-only (`supportsLive: false`)

## Current Baseline

Observed from the current codebase:

- `backend/src/runtime/runtimeCoordinator.js` is the shared orchestration layer for `live`, `paper_shadow`, and `paper_candidate` runs
- `backend/src/services/LiveTradingEngine.js` owns broker-backed live execution and keeps open trades attached to their original `ownerRunId`
- `backend/src/services/PaperTradingRuntime.js` owns paper trade execution, resets, and portfolio snapshots for shadow/candidate runs
- `backend/src/services/analyticsService.js` and `backend/src/routes/tradingRoutes.js` query unified runtime identity columns for analytics and run detail views
- `frontend/src/components/BacktestLab.jsx` is now the runtime-backed paper comparison surface despite the legacy filename
- No active UI route or production endpoint depends on the retired backtest/lab stack

## Locked Architecture Decisions

### Core Runtime Model

- The system moves to a shared strategy runtime used by live, shadow paper, and candidate paper runs
- There is exactly one active live entry strategy at a time
- A live strategy change is hot-swappable from the UI and affects new entries only
- Existing live positions remain managed by the strategy run that opened them until those positions close
- The active live strategy always has a default shadow paper run using the same strategy definition and config snapshot
- Multiple paper candidate runs may execute concurrently, including multiple runs of the same strategy with different configs

### Canonical Strategy Catalog

The canonical strategy catalog is locked to these seven strategy keys:

- `supertrend_momentum`
- `mean_reversion`
- `range_breakout`
- `stochastic_divergence`
- `squeeze_play`
- `timesfm_directional`
- `correlation_divergence`

Legacy pseudo-strategy labels such as `balanced`, `conservative`, and `responsive` are removed from the active runtime, validation, and UI during Phase 1.

### Persistence and Analytics

- Storage is unified by `mode`, `runId`, and `strategy`
- Do not create a permanent separate paper-only schema
- Add a new `strategy_runs` table and extend existing runtime telemetry tables so live and paper runs can be queried through the same analytics pipeline
- The canonical runtime modes are:
  - `live`
  - `paper_shadow`
  - `paper_candidate`
- `backtest_results` and the legacy backtest/lab stack are retired in Phase 5 and must not be reintroduced

### Runtime Ownership Rules

- Every trade row must carry the run identity that owns it
- Live position monitoring is grouped by owning run, not only by instrument
- A newly selected live strategy receives a new live `runId`
- Open trades from the prior live run keep their original `ownerRunId` and continue to use that strategy module for exit logic
- New trades open only from the currently active live selection

## Runtime Terms

- `strategyKey`: one of the seven canonical strategy names
- `selectionId`: durable identifier for a live strategy selection event from the UI
- `runId`: durable identifier for an executing strategy run
- `mode`: `live`, `paper_shadow`, or `paper_candidate`
- `ownerRunId`: the run that owns a trade or open position and is responsible for managing its exits
- `configSnapshot`: the exact normalized config used when the run started

## Target End-State Architecture

### Backend

| Area | Target |
| --- | --- |
| Strategy contract | `backend/src/strategies/*` exports metadata, required data, `evaluateEntry`, `evaluateExit`, and optional state hooks |
| Strategy registry | One registry enumerates the seven canonical strategies and exposes metadata to API/UI |
| Shared runtime | A runtime coordinator creates and manages live, shadow, and candidate runs using shared market context and indicator precomputation |
| Live execution | Live order placement remains broker-backed, but entry decisions come from the shared runtime instead of a dedicated `signalGenerator` path |
| Position ownership | Open live trades are routed back to the owning strategy run for exit decisions until closure |
| Analytics | Query by `mode`, `runId`, `strategy`, `selectionId`, and `configHash` from one shared telemetry model |
| Legacy comparison | No legacy backtest/lab route, worker, or offline comparison path remains in the steady-state architecture |

### Frontend

| Surface | Target |
| --- | --- |
| Dashboard | Show active live strategy, hot-swap control, active shadow run status, and ownership-aware live position summaries |
| Paper comparison | Replace the `LAB` view with a paper comparison surface that shows shadow baseline plus concurrent candidate runs |
| Analytics | Add filters and grouping by `mode`, `runId`, and `strategy` |
| Config | Strategy-specific config editing is scoped to the selected live strategy or specific candidate run, not a global lab-only flow |

## Unified Persistence Plan

### New Table

`strategy_runs`

Required columns:

- `run_id`
- `mode`
- `strategy`
- `status`
- `selection_id`
- `shadow_of_run_id` nullable
- `config_hash`
- `config_snapshot`
- `started_at`
- `stopped_at` nullable
- `metadata` JSON nullable

### Existing Tables To Extend

| Table | Required additions |
| --- | --- |
| `trades` | `run_id`, `owner_run_id`, `selection_id`, `strategy`, `config_hash` reuse, `mode` already exists and remains required |
| `signals` | `run_id`, `selection_id`, `mode`, `strategy` remains required |
| `entry_decisions` | `run_id`, `selection_id`, `mode`, `strategy` |
| `portfolio_snapshots` | `run_id`, `selection_id`, `mode`, `strategy` |

Implementation rules:

- Live and paper telemetry flows through the same repositories and analytics service once Phase 2 cutover is complete
- Dual-write is allowed only as a transition during migration
- New runtime APIs and UI should query the unified model first, not new paper-specific tables

## Target API Surface

The final runtime/API direction is:

- `GET /api/strategies/catalog`
- `GET /api/runtime/live-selection`
- `POST /api/runtime/live-selection`
- `GET /api/runtime/runs`
- `POST /api/runtime/runs`
- `POST /api/runtime/runs/:runId/stop`
- `POST /api/runtime/runs/:runId/reset`
- `GET /api/runtime/runs/:runId/trades`
- `GET /api/runtime/runs/:runId/signals`
- `GET /api/runtime/runs/:runId/equity`
- `POST /api/runtime/runs/:runId/promote`
- `GET /api/analytics?mode=&strategy=&runId=&period=`

Behavior rules:

- `POST /api/runtime/live-selection` starts a new live run and a paired shadow paper run immediately
- Existing live trades are not force-closed on strategy selection changes
- Promotion is no longer a deploy-time config rewrite. Direct live selection uses `POST /api/runtime/live-selection` for baseline/live-ready strategies; reviewed candidate strategies use `POST /api/runtime/runs/:runId/promote`.

## Strategy-To-Phase Map

| Strategy | Phase introduced | First runtime role | Notes |
| --- | --- | --- | --- |
| `supertrend_momentum` | Phase 1 | Extracted canonical baseline | Must match current live behavior before any new runtime cutover |
| `mean_reversion` | Phase 3 | Candidate paper | Promotable to live after shared runtime is proven |
| `range_breakout` | Phase 3 | Candidate paper | Requires M5 context support in shared runtime |
| `stochastic_divergence` | Phase 4 | Candidate paper | Uses pivot and divergence helpers |
| `squeeze_play` | Phase 4 | Candidate paper | Uses Bollinger, Keltner, and low-volatility release logic |
| `timesfm_directional` | Post Phase 4 | Candidate paper, live-promotable | Uses the TimesFM sidecar forecast as the entry thesis |
| `correlation_divergence` | Phase 7 | Candidate paper only | Uses peer USD-factor candles to test single-leg mean reversion after residual divergence |

## Canonical Strategy Specs

### `supertrend_momentum`

Thesis:

- Preserve the current live momentum/trend strategy exactly as the compatibility baseline and default shadow benchmark

Required data:

- M15 candles
- H1 candles when HTF confirmation is enabled
- Live bid/ask/mid price
- Precomputed SuperTrend, RSI, ADX, ATR, and session context

Entry logic:

- Fresh long entry:
  - M15 SuperTrend flips bearish to bullish
  - ADX filter passes and directional ADX favors longs when enabled
  - RSI momentum floor passes and fresh-entry RSI is not overextended
  - HTF filter passes when enabled
  - Session, spread, and live-entry validation gates pass
- Fresh short entry:
  - Mirror of the long flow using bearish flip, bearish DI alignment, and short momentum filters
- Continuation entries:
  - A valid flip may wait for HTF confirmation or for a pullback-and-reacceleration sequence
  - Pullback must remain inside the configured ATR depth band and the continuation window
  - Reacceleration reopens entry eligibility without allowing an uncontrolled chase move

Exit and management:

- Stop-loss remains driven by the live risk model already used by `LiveTradingEngine`
- Optional take-profit, breakeven, and trailing stop behavior stay intact during extraction
- Opposite-side strategy exits continue to be evaluated by the owning strategy run

Canonical preservation rule:

- Phase 1 must extract this strategy from the deployed runtime with parity tests before any cleanup or retuning
- If legacy docs disagree with runtime/config values, deployed runtime behavior wins

### `mean_reversion`

Thesis:

- Fade statistical extremes in ranging conditions

Required data:

- M15 candles
- H1 ADX regime context
- Bollinger Bands, RSI, ATR, session context, spread data

Long entry:

- H1 `ADX(14) < 25`
- M15 close at or below the lower Bollinger Band
- `RSI(14) < 30`
- Band width is at least `0.5x` its 20-bar average
- London or New York session
- Spread below `maxSpreadPips`

Short entry:

- Mirror of the long entry at the upper band with `RSI(14) > 70`

Exit and management:

- Stop loss: `1.5 x ATR(14)`
- Take profit: middle Bollinger Band
- Breakeven at `50%` of the distance to target
- Time stop: `8h`

Default config:

```json
{
  "bbPeriod": 20,
  "bbStdDev": 2.0,
  "bbwMinRatio": 0.5,
  "maxRegimeAdx": 25,
  "rsiOversoldEntry": 30,
  "rsiOverboughtEntry": 70,
  "stopLossAtrMultiplier": 1.5,
  "breakevenAtTpPercent": 0.5,
  "timeStopHours": 8,
  "activeSessions": ["london", "newyork"]
}
```

### `range_breakout`

Thesis:

- Trade London and New York opening-range expansion without lagging indicators

Required data:

- M5 candles for opening-range construction
- M15 candles for breakout confirmation
- H1 ATR context

Setup:

- Build the opening range from the first 12 M5 candles of London (`07:00-08:00 UTC`) or New York (`12:00-13:00 UTC`)

Long entry:

- M15 close above opening-range high

Short entry:

- M15 close below opening-range low

Filters:

- Opening-range height between `0.5x` and `2.0x` H1 ATR
- Breakout candle body below `70%` of the opening-range height
- Entry occurs within `4h` of opening-range formation
- Spread below `maxSpreadPips`

Exit and management:

- Stop loss: opposite side of the opening range
- Take profit: `1.5x` opening-range height
- Trail after `1.0x` range profit using `0.5x` range distance
- Time stop: close by `17:00 UTC`

Default config:

```json
{
  "londonOpenHourUTC": 7,
  "nyOpenHourUTC": 12,
  "rangeMinAtrRatio": 0.5,
  "rangeMaxAtrRatio": 2.0,
  "tpRangeMultiplier": 1.5,
  "trailActivationMultiplier": 1.0,
  "trailDistanceMultiplier": 0.5,
  "maxBreakoutBodyRatio": 0.7,
  "entryWindowHours": 4,
  "sessionCloseHourUTC": 17
}
```

### `stochastic_divergence`

Thesis:

- Detect momentum exhaustion before reversal through price-versus-oscillator divergence

Required data:

- M15 candles
- H1 stochastic context
- Pivot detection helpers
- Stochastic, ATR, session context, spread data

Long entry:

- Two M15 pivot lows inside the last 30 bars
- Second pivot price is lower than the first
- Stochastic `%K` at the second pivot is higher than at the first
- Both readings are below `20`
- H1 stochastic `%K > 50` or rising
- M15 `%K` crosses above `%D`
- London or New York session with spread filter

Short entry:

- Mirror of the bullish divergence flow using pivot highs and the overbought zone

Exit and management:

- Stop loss: below recent pivot low plus `0.5 ATR`
- Take profit: `2.0x` stop distance
- Breakeven at `1.0x` stop distance
- Trail after `1.5x` stop distance using `1.0 ATR`

Default config:

```json
{
  "stochPeriod": 14,
  "stochSignalPeriod": 3,
  "stochSmoothK": 3,
  "pivotWindow": 2,
  "maxPivotLookback": 30,
  "oversoldZone": 20,
  "overboughtZone": 80,
  "htfStochThreshold": 50,
  "tpSlMultiplier": 2.0,
  "breakevenSlMultiplier": 1.0,
  "trailActivationSlMultiplier": 1.5,
  "trailDistanceAtr": 1.0,
  "slPivotAtrBuffer": 0.5,
  "activeSessions": ["london", "newyork"]
}
```

### `squeeze_play`

Thesis:

- Trade volatility release after a sustained compression regime

Required data:

- M15 candles
- H1 ATR percentile context
- Bollinger Bands, Keltner Channels, ATR, linear-regression slope, session context

Entry:

- Bollinger Band width remains inside Keltner width for at least 6 consecutive M15 bars
- Bollinger width expands back above Keltner width
- Direction is set by the linear-regression slope of the last 12 closes
- Release candle closes in the same direction
- H1 ATR is below the 60th percentile of the last 50 H1 bars
- London or New York session with spread filter

Exit and management:

- Stop loss: `2.0 ATR`
- Take profit: `3.0 ATR`
- Trail after `2.0 ATR` profit using `1.0 ATR`
- Time stop: `12h`

Default config:

```json
{
  "bbPeriod": 20,
  "bbStdDev": 2.0,
  "keltnerEmaPeriod": 20,
  "keltnerAtrPeriod": 20,
  "keltnerAtrMultiplier": 1.5,
  "minSqueezeBarCount": 6,
  "linRegPeriod": 12,
  "h1AtrPercentileMax": 60,
  "h1AtrLookback": 50,
  "stopLossAtrMultiplier": 2.0,
  "takeProfitAtrMultiplier": 3.0,
  "trailActivationAtr": 2.0,
  "trailDistanceAtr": 1.0,
  "timeStopHours": 12,
  "activeSessions": ["london", "newyork"]
}
```

### `timesfm_directional`

Thesis:

- Trade directly from TimesFM forecast direction when confidence and expected return clear explicit thresholds

Required data:

- M15 candles
- Live price, session, and spread context
- ATR for sizing
- TimesFM sidecar forecast context

Entry:

- Forecast must be available from the sidecar
- Forecast direction must be BULLISH or BEARISH, not neutral
- Confidence must be at least `timesFmStrategyMinConfidence`
- Absolute expected return must be at least `timesFmStrategyMinReturnBps`
- Extreme volatility is blocked by default
- Session and spread filters must pass

Exit and management:

- Stop loss: `timesFmStrategyStopLossAtrMultiplier x ATR`
- Take profit: `timesFmStrategyRiskReward x stop distance`
- Time stop: `3h` by default
- If the sidecar is unavailable, the strategy emits HOLD instead of guessing direction

Default config:

```json
{
  "timesFmStrategyMinConfidence": 0.7,
  "timesFmStrategyMinReturnBps": 10,
  "timesFmStrategyHighConfidenceThreshold": 0.8,
  "timesFmStrategyHighConfidenceMinReturnBps": 7.5,
  "timesFmStrategyStopLossAtrMultiplier": 1.5,
  "timesFmStrategyRiskReward": 1.5,
  "timesFmStrategyBlockExtremeVolatility": true,
  "timeStopHours": 3
}
```

### `correlation_divergence`

Thesis:

- When one USD pair materially diverges from the anti-USD move implied by peer USD pairs, paper-test single-leg mean reversion back toward the peer factor.

Required data:

- M15 candles for the target instrument
- M15 candles for peer instruments in the same configured asset set
- Live price, session, and spread context
- ATR for stop sizing

Entry:

- Build lookback log returns for the target and peer instruments.
- Normalize pairs into an anti-USD direction so quote-USD and base-USD instruments can be compared.
- Estimate peer factor return, rolling correlation, beta-adjusted residual, residual mean/stddev, and z-score.
- Require enough observations, enough peer instruments, minimum peer move, and minimum rolling correlation.
- BUY when the target has underperformed the peer factor by the configured negative z-score.
- SELL when the target has outperformed the peer factor by the configured positive z-score.

Exit and management:

- Stop loss: `correlationDivergenceStopLossAtrMultiplier x ATR`
- Take profit: `correlationDivergenceRiskReward x stop distance`
- Time stop: `4h` by default
- Current catalog metadata makes this strategy paper-only: `supportsLive=false`, `supportsShadow=false`, `supportsCandidate=true`

Default config:

```json
{
  "correlationDivergenceLookbackBars": 16,
  "correlationDivergenceZWindowBars": 320,
  "correlationDivergenceMinObservations": 120,
  "correlationDivergenceEntryZScore": 2.0,
  "correlationDivergenceMinPeerMoveBps": 5,
  "correlationDivergenceMinPeerInstruments": 2,
  "correlationDivergenceMinCorrelation": 0.35,
  "correlationDivergenceBetaMin": 0.25,
  "correlationDivergenceBetaMax": 1.75,
  "correlationDivergenceStopLossAtrMultiplier": 1.25,
  "correlationDivergenceRiskReward": 1.0,
  "timeStopHours": 4
}
```

## Atomic Packet Set

### Phase 0 - Documentation Alignment

Packets:

- `DOC-01` Rewrite `trading_strategy_update_plan.md`
- `DOC-02` Align `CLAUDE.md` and `project_roadmap.md`

Verification:

- Doc content reflects the locked architecture and packet set
- Session docs no longer describe live-only plus lab as the long-term target
- Run doc validation (`git diff --check` at minimum)

Checkpoint:

- Update `CLAUDE.md` `IN PROGRESS`
- Post a short checkpoint summary
- Recommend a new thread before Phase 1

### Phase 1 - Strategy Catalog And Unified Run Registry

Goal:

- Lock the shared strategy contract, remove non-canonical strategy labels, and establish unified run identity in storage

Packets:

- `ARC-01` Create `backend/src/strategies/` contract, metadata shape, and registry for the canonical strategies
- `ARC-02` Extract `supertrend_momentum` from `signalGenerator.js` with parity tests against the current runtime behavior
- `ARC-03` Remove legacy strategy aliases from validation, dashboard controls, and config affordances
- `DB-01` Add `strategy_runs` and extend `trades`, `signals`, `entry_decisions`, and `portfolio_snapshots` with `runId`/`selectionId`/`strategy`
- `REPO-01` Update repositories and analytics plumbing so the unified columns are available without breaking current live behavior

Verification:

- Existing live strategy tests remain green
- New parity tests prove extracted `supertrend_momentum` matches current live signals
- Repository tests cover the new runtime identity columns

Checkpoint:

- Phase 1 complete
- Update `CLAUDE.md` `IN PROGRESS`
- Recommend a new thread before Phase 2

### Phase 2 - Shared Runtime Core, Live Hot Swap, And Shadow Baseline

Goal:

- Replace the dedicated live signal path with a shared runtime coordinator and make live selection hot-swappable without breaking existing positions

Packets:

- `RT-01` Build a shared market-context and indicator-precompute layer used by all run modes
- `RT-02` Build runtime coordinator and per-run lifecycle management for `live`, `paper_shadow`, and `paper_candidate`
- `LIVE-01` Route live entry generation through the shared runtime instead of a standalone `signalGenerator` loop
- `LIVE-02` Implement `selectionId` and `ownerRunId` semantics so existing live trades remain managed by their opening strategy run
- `LIVE-03` Add the active live strategy selection API/UI flow and automatically start the paired shadow paper run

Verification:

- Selecting a new live strategy changes new entries only
- Open live trades created before the switch still receive exit management from their original owner run
- Shadow paper run starts automatically for the active live strategy
- Backend targeted tests and frontend build pass

Checkpoint:

- Phase 2 complete
- Update `CLAUDE.md` `IN PROGRESS`
- Recommend a new thread before Phase 3

### Phase 3 - Candidate Paper Infrastructure, `mean_reversion`, And `range_breakout`

Goal:

- Make the new paper comparison system useful with the first two candidate strategies and candidate-run controls

Packets:

- `PAPER-01` Implement candidate paper run creation, stop/reset controls, and run listing APIs
- `STRAT-01` Implement `mean_reversion`
- `STRAT-02` Implement `range_breakout`
- `DATA-01` Add shared-runtime M5 context support required by `range_breakout`
- `UI-01` Replace the `LAB` navigation entry with a paper comparison shell that shows the shadow run and candidate runs

Verification:

- Multiple candidate paper runs execute concurrently
- `mean_reversion` and `range_breakout` trades/signals persist with correct `mode`, `runId`, and `strategy`
- The paper comparison page updates from unified runtime data instead of the legacy lab pipeline

Checkpoint:

- Phase 3 complete
- Update `CLAUDE.md` `IN PROGRESS`
- Recommend a new thread before Phase 4

### Phase 4 - Remaining Strategies And Unified Analytics

Goal:

- Finish the strategy catalog and make the new paper comparison system operationally complete

Packets:

- `STRAT-03` Implement `stochastic_divergence`
- `STRAT-04` Implement `squeeze_play`
- `ANA-01` Extend analytics queries and UI filters to group by `mode`, `runId`, `strategy`, and shadow versus candidate runs
- `UI-02` Add run comparison cards, run detail panes, per-run config display, and live-selection controls tied to the new runtime
- `OPS-01` Add runtime status visibility for active live run, paired shadow run, and candidate runs

Verification:

- All runtime strategies are registered and runnable through the shared runtime
- Analytics and UI can compare live, shadow, and candidate runs from one storage model
- The paper comparison system is functional enough to replace the legacy lab flow

Checkpoint:

- Phase 4 complete
- Update `CLAUDE.md` `IN PROGRESS`
- Recommend a new thread before Phase 5

### Phase 5 - Legacy Backtest/Lab Removal

Goal:

- Remove the retired backtest/lab architecture once the new paper comparison runtime is working

Packets:

- `CLEAN-01` Remove frontend `LAB` components and routing
- `CLEAN-02` Remove legacy lab socket/worker wiring and obsolete routes
- `CLEAN-03` Remove `backtestEngine`-driven comparison dependencies that are no longer needed by production runtime flows
- `CLEAN-04` Update docs, roadmap, and operator guidance for the new runtime-only comparison model

Verification:

- No active UI path or production dependency relies on the legacy lab/backtest comparison system
- Frontend build and backend targeted tests pass after removal
- Docs reflect the new steady-state architecture

Checkpoint:

- Phase 5 complete
- Update `CLAUDE.md` `IN PROGRESS`
- Recommend a new thread before Phase 6

### Phase 6 - Rollout And Monitoring

Goal:

- Deploy the runtime migration and monitor the new live plus shadow plus candidate workflow

Packets:

- `OPS-02` Deploy the new runtime stack
- `OPS-03` Verify live selection, ownership continuity, shadow baseline, and candidate paper runs in production
- `OPS-04` Monitor resource usage, run health, and analytics integrity during the first live comparison window

Verification:

- Production can switch the active live strategy from the UI without disrupting existing open live positions
- Shadow paper baseline is present for the selected live strategy
- Candidate runs and analytics remain stable over a multi-day monitoring window

Checkpoint:

- Phase 6 complete
- Update `CLAUDE.md` `IN PROGRESS`
- Capture rollout learnings in project docs

### Phase 7 - Correlation Divergence Paper Candidate

Goal:

- Add a paper-only research candidate that uses peer USD-factor divergence without expanding the live promotion surface.

Packets:

- `STRAT-05` Implement `correlation_divergence` with residual/z-score entry logic and ATR-based trade planning
- `DATA-02` Expose peer candles in the shared market context
- `TEST-01` Cover strategy math and peer-candle runtime context
- `DOC-03` Update strategy catalog docs so collaborators know the strategy is paper-only

Verification:

- Strategy registry includes `correlation_divergence`
- Catalog metadata has `supportsCandidate=true`, `supportsLive=false`, and `supportsShadow=false`
- Candidate runs can be launched from Paper without becoming promotable
- Backend strategy/runtime tests cover peer-candle context

Checkpoint:

- Phase 7 complete in code
- Deployment remains separate from the code-complete status

## Implementation Guardrails

- Do not change strategy logic and runtime architecture in the same packet unless the packet explicitly calls for parity-backed extraction
- Do not re-tune `supertrend_momentum` during extraction; preserve behavior first
- Do not add a permanent second comparison system beside the new paper comparison runtime
- Do not force-close open live positions when switching strategies
- Do not permit candidate paper controls to bypass unified storage or analytics
- Do not promote `correlation_divergence` to live unless its catalog metadata and live-risk review are deliberately changed in a separate packet

## Phase 0 Checkpoint

Phase 0 is complete when:

- This plan fully reflects the approved target architecture
- `CLAUDE.md` and `project_roadmap.md` no longer conflict with the approved direction
- Validation for the doc edits has been run

After Phase 0:

- Update `CLAUDE.md` `IN PROGRESS`
- Post a short checkpoint summary
- Recommend starting a new thread before Phase 1
