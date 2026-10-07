# BUY break/retest and consumed episodes — 7 October 2026

## Problem and selected change

The [overnight EUR/USD review](2026-10-07-eurusd-breakeven-repeat.md) broker-verified a breakeven BUY followed by another BUY and a full initial stop. The existing protected-exit guard accepted genuinely new EMA-touch candles, but those candles belonged to another local pullback inside the same broader trend. The BUY ATR stop was inside the accepted bid structure. This was a strategy limitation, rather than a duplicate order or bypass of the specified guard.

The user subsequently requested implementation of the changes. This selects the combined BUY break/retest, bid structural stop and consumed-breakout contract below. Existing authorization for local development, tests, commits, GitHub publication and the normal deployment workflow remains applicable. No manual test orders, additional funding or increased cash-risk limits are authorized. This is a prospective strategy change, not a claim of positive expectancy or a replay showing that either overnight trade would win.

Release identity: **m15-intraday-v6 / intraday_momentum 1.4.0 / intraday-risk-v6**. Pricing remains `broker-liquidity-v3.1`. Existing SELL pattern semantics remain unchanged.

## Exact BUY entry and episode contract

The normal BUY trigger changes from independent breakout/pullback entries to a completed break/retest/confirmation sequence. Existing completed H1 bullish qualification, M15 alignment/RSI/candle-quality, sessions, cost, protected-exit freshness, initial-loss H1 reset, quotes, account, portfolio and broker checks still apply.

1. A completed bullish M15 candle closes above the preceding eight completed midpoint candles' high. Freeze that broken level and identify the breakout episode by the instrument and breakout time.
2. A distinct later completed candle trades to/below the level and closes above it. Retain its high/time and the minimum broker **bid low** from the first retest onward.
3. A distinct subsequent bullish completed candle closes above the retained retest high without retouching the frozen level. This is the confirmation candle.

A close at/below the frozen level cancels the episode. Another retouch that closes above it updates the retest and requires a later confirmation. The retouch candle cannot confirm itself. Episode bid lows include intervening and confirmation candles; today's spread never supplies missing historical evidence. A complete ordinary broker candle refresh can restore missing bid evidence across the retained episode.

Only the latest fresh completed confirmation candle offers an entry. On the next completed candle an unfilled confirmation expires; the broken level stays frozen while a new distinct retest/confirmation can form. No additional timer or rapid retry loop is introduced. Existing same-current-candle pricing-decline reconsideration retains its original reference anchor and bounds.

**One broker fill consumes the entire breakout episode**, rather than only a retest/confirmation tuple. Broker-backed BUY trade metadata across all runs supplies consumption, including open and closed trades. Another EMA touch, retest, confirmation, restart or strategy release cannot re-arm that episode. Price must close at/below its frozen level, cancel it, and subsequently establish a new break/retest/confirmation. Durable serialized state is independent of run identity; old concurrent candle snapshots cannot roll it backward.

SELL-to-BUY fades are disabled because they would bypass the new BUY prerequisites. BUY-to-SELL fades remain disabled. Historical fades retain their original ownership/exit behavior. Legacy reversal evidence can still request an exit from an owned position without authorizing an entry lacking its required pattern.

## Stop, sizing and compatibility contract

The BUY structural anchor is **minimum episode bid low minus one broker price tick**. Missing/crossed structure prevents entry. The existing six-pip minimum can widen a valid stop farther below structure; it cannot rescue a crossed anchor. Final broker bid at/below the anchor invalidates the new BUY even when the entry ask is higher.

Shared structural resolution now supports BUY and SELL explicitly. BUY protective prices round downward; SELL prices retain upward rounding. Sizing uses exact serialized protective prices and the worst permitted adverse fill, retaining the existing movement bound and cash-risk budget. The submitted absolute stop stays fixed after fill and during protection repair or ambiguous-intent recovery. Target and +1R breakeven derive from actual fill-to-stop distance. Old distance-based trades retain their original contract; stored owner exit policies continue to manage old positions.

M15 data retains additive broker `bid` OHLC alongside existing midpoint and `ask` data. H1/H4 requests, midpoint values and event/receipt timestamps retain their meanings. Malformed/missing bid data leaves the dependent BUY pattern unavailable while valid midpoint/ask data remains usable.

`strategyContext.buyRetest` uses its own versioned evidence, episode ID, frozen level, retest/confirmation times and bid-based stop. Normal BUY entries use `M15_BREAK_RETEST_CONFIRMATION`; analytics distinguishes **BUY break/retest** from old trend, SELL retest and historical fade classes without rewriting raw trigger flags or old trade outcomes. Old BUY trades without this episode evidence are not retroactively assigned an invented breakout identity. Exit-only reversal signals are explicitly labelled in the dashboard using their entry type/intent as well as historical class labels.

Saved risk, entry/exit settings and enabled intent migrate from v5. Only release/execution identities change. The existing active cooldown deadline is preserved; historical cohorts, incomplete-streak isolation and all-history H1 loss-reset evidence retain their established contracts. One position per pair, 0.25% sizing risk, A$100 sizing-capital cap, aggregate stop-risk/margin limits, three-loss cooldown, 1.5R target, +1R breakeven and time/session exits remain.

## Verification and delivery checkpoint

Local implementation passed **1,316 backend tests across 68 suites**, **16 frontend checks**, the production frontend build, the retained incident verifier and whitespace checks on Node 22.16.0. The [validation record](evidence/2026-10-07/buy-retest-validation.json) retains source hashes and the reduced preflight observation. A focused real-engine H1 regression accepts valid past reset/re-arm proof and rejects future persisted proof at final loss-reset revalidation while the current BUY confirmation remains valid. Publication and delivery will be appended below.

Coverage includes healthy new BUY entry, distinct-bar cancellation/retouch cases, consumed episode after breakeven and restart, fresh re-arming after cancellation, bid recovery, stale/concurrent state, final broker reconciliation/revalidation, exact precision/sizing, fill/recovery, preserved SELL/legacy owner behavior, migration and distinct analytics attribution. The actual coordinator → generator → engine test fills a new BUY, activates breakeven, reconciles its broker-confirmed scratch, blocks the consumed episode after restart with or without its dedicated state row, then fills a different episode after observed cancellation and a complete later pattern. A known cancellation can clear the episode across a cache gap; unknown or above-level candles cannot invent cancellation. Final-bid comparisons account for arithmetic roundoff without expanding the price boundary. No manual test order was placed.

Three retained incident regressions show the overnight second entry lacks the new BUY pattern, while preserving the old freshness result and bid-stop geometry. They do not supply an alternative portfolio return. Active research runtime tests use valid current BUY patterns; historical v5 manifests/results keep their original source identity and deliberately reject current v6 code. Complete historical performance evaluation remains pending.

At the local checkpoint production was unchanged. The **12:03 AEDT** preflight verified clean v5 `9b3785b`, healthy/enabled and flat, balance A$95.0930, with no pending orders. The original incident report remains a dated record of v5 behavior.

## Published and deployed

Local source commit **`562334beffefc7a26d3eee99db5c73631e3a2ec0`** was published to GitHub `main`, then installed using `./scripts/deploy.sh`. The target passed all **1,316 backend tests / 68 suites**, the production frontend build, matched source/database backup `20261007_121825`, migration and operational health checks. The command restored the previously enabled intent. No production source was edited, committed or pushed manually.

Read-only verification at **12:23 AEDT on October 7** confirmed clean `562334b`, **strategy 1.4.0 / m15-intraday-v6 / intraday-risk-v6**, healthy services, passing readiness and enabled entries. The broker remained flat at A$95.0930, with zero pending orders, unresolved intents, quarantines or protection repairs. All four instruments exposed 20 completed cached M15 candles with normalized bid and ask sides and had current durable BUY state. The [deployment evidence](evidence/2026-10-07/buy-retest-deployment-verification.json) retains the reduced observation and validation results.

The numerical risk, pricing, target, breakeven, minimum-stop and time settings match the preflight. The new cohort has zero incomplete consecutive losses under the established release-isolation contract; no active cooldown existed to carry. EUR/USD's all-history H1 loss-reset anchor for overnight BUY 3519 remains armed, with observed reset and requalification still pending at verification. Historical trade ownership and records remain. No v6 fill had occurred at this checkpoint; filled-episode persistence/restart behavior is validated through the integration tests, and prospective trading outcomes remain unmeasured.
