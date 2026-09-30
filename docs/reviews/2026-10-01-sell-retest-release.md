# SELL break/retest release — 1 October 2026

## Decision and authorization

The user explicitly requested implementation and deployment of the proposed SELL candidate as the live OANDA strategy. They accept the funded balance being at risk and want growth assessed using actual live results. This authorizes local development, correctness tests, commits, GitHub publication, builds and the normal deployment command for this release. It does not change numerical risk limits or authorize forced test orders. The target of doubling the account is an objective, not a demonstrated expected return.

Identity: **m15-intraday-v5 / intraday_momentum 1.3.0 / intraday-risk-v5**. Pricing model remains `broker-liquidity-v3.1`. The preceding live revision is `c6b6c77` / strategy 1.2.2. The separate [chart correction](2026-10-01-chart-correction.md) is included in this delivery. Earlier dates' pending-deployment records retain their original checkpoint meaning.

The [SELL entry/exit study](2026-10-01-sell-entry-and-exit-study.md) supports testing a different entry/stop relationship, not claiming that this candidate has positive expectancy. Wider stops alone did not consistently improve the retained paths; controls included winners damaged by the change. This release is a prospective live experiment, not an optimized historical winner.

## Exact entry and stop contract

Existing completed-H1 bearish qualification, M15 EMA/RSI/quality, sessions, cost, quote, account, broker and risk checks remain prerequisites. Only normal SELL entry trigger and its initial stop change:

1. A completed bearish M15 candle closes below the preceding eight completed candles' low. Freeze that broken level.
2. A distinct later completed M15 candle trades back to that level and closes below it. Retain its low and the maximum ask high from the first retest onward.
3. A distinct subsequent bearish completed candle closes below the retained retest low without retouching the broken level. This is the confirmation candle.

A close at or above the frozen level cancels the pattern. A later retouch that still closes below updates the retest low/time and requires another later confirmation; it cannot confirm on its own candle. Maximum ask high is retained across the whole retest episode, including intervening and confirmation candles. Confirmation must be the latest fresh completed candle. Advancing to another completed candle ends that confirmation's entry opportunity; only the existing permitted local-pricing retries may reconsider it while it remains current. There is no new retry loop or arbitrary pattern timer.

The structural stop anchor is **maximum episode ask high plus one broker price tick**. Missing ask evidence cannot be synthesized from today's spread. A subsequent complete broker candle refresh can restore missing ask evidence for the entire retained episode. M15 requests now include midpoint/bid/ask components; midpoint OHLC and existing event/receipt timestamp meanings are unchanged. H1/H4 candle requests are unchanged.

The existing six-pip minimum stop can place the submitted stop farther above the anchor. A quote at/above the anchor invalidates the entry; the floor cannot rescue crossed structure. Execution sizes the exact serialized absolute stop against the worst permitted fill within the existing adverse-price bound. It never tightens the stop inside structure to fit the budget. After a fill, that submitted absolute stop remains fixed; target and +1R breakeven use the actual fill-to-stop distance. Protection repair and ambiguous-order recovery preserve it too. `tradePlan.stopPriceMode: STRUCTURAL` and `structuralStopLossPrice` are additive fields; old distance-based trades and BUYs retain their existing contract.

## Interaction with existing rules

BUY breakout/pullback entries and ATR-based initial stops remain unchanged. BUY-to-SELL post-TP fades are disabled because they would bypass the new bearish SELL pattern. Existing SELL-to-BUY fades retain their original qualifying SELL trigger and episode rules. No recursive fade or displacement of an existing position is introduced.

The H1 reset after an initial stop, protected-exit freshness after TP/breakeven, six-hour time exit, New York rollover exit, reversal handling and historical owner policies remain. A legacy qualifying reversal can still close an owned BUY without permitting a new SELL that lacks the candidate. Old positions remain managed by their recorded policy.

Frozen pattern progress is stored durably per instrument, breakout-window and precision, independent of run ID. Scans and final execution validation share serialized read/advance/write handling. Empty startup candles can recover; older concurrent snapshots cannot roll state backward. Filled pattern IDs are recovered from all broker-backed live SELL history, including closed trades and prior runs. Final entry validation runs again after broker reconciliation and checks the version, entry type, exact confirmation, pattern ID and stop anchor against current evidence. Missing durable evidence cannot silently fall back to the old SELL rule.

Unchanged limits: 0.25% × min(80% available margin, A$100) sizing; one position per pair; 0.5%-of-NAV aggregate stop risk; existing margin and three-loss/24-hour cooldown controls. Target remains 1.5R and breakeven +1R. Saved parameters and enabled intent migrate from v4.2; active cooldown expiry is preserved under the existing release policy. Historical cohorts and incomplete-streak isolation are unchanged.

## Research attribution

New SELL entries use `M15_BREAK_RETEST_REJECTION`; `strategyContext.sellRetest` records broken level, bar times, retest low, episode ask high, confirmation, pattern ID and structural stop. Existing order intents/trade metadata retain requested and actual prices, units, initial R, execution costs, protection and exit outcomes. Analytics keeps a separate SELL break/retest entry class while retaining the original raw breakout/pullback fields for historical comparisons.

The pre-deployment read-only snapshot shows **A$95.4408**, flat, on v4.2. Doubling that snapshot would mean A$190.8816 and then A$381.7632 before any subsequent funding/withdrawal adjustments. Whole-account growth also includes unchanged BUY trades; evaluate candidate SELL net AUD, initial-risk R, costs, exits, sampled excursions and rejection/cadence separately. No backtest or synthetic fill constitutes live profitability evidence. Natural broker fills remain the outcome evidence; local tests establish software behavior only.

## Validation and delivery

Local validation passed on Node 22.23.1: **1,004 tests across all 47 backend suites**, 11 frontend component tests (including eight chart regressions), four refresh-contract scenarios and 27 deployment workflow tests. The production frontend build and whitespace checks passed. Tests use isolated databases and mocked broker transport; no live test order was placed. Actual deployed revision and runtime verification will be recorded after delivery. The standard `./scripts/deploy.sh` must consume the published GitHub revision; no production source editing or reverse synchronization is authorized.

Correctness coverage includes distinct-bar eligibility; cancellation/retouches; ask availability/recovery; price precision; durable cache/restart/concurrency/consumption; actual coordinator → indicators → signal → broker reconciliation → sizing → intent → protection flow; invalid or stale candidate evidence; absolute-stop fill/recovery; unchanged BUY/reversal/fade/loss-reset behavior; saved settings migration and analytics attribution. Independent reviews found and corrected a six-pip cost-floor mismatch and an empty-startup-state recovery defect before delivery.
