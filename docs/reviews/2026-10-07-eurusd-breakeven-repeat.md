# EUR/USD breakeven then repeat BUY — 7 October 2026

**The repeat exposure is real. The first BUY closed at breakeven; the next BUY lost A$0.1691. The protected-exit guard ran and accepted a fresh EMA pullback within the same bullish trend. No duplicate submission or guard bypass was demonstrated. The limitation is the strategy's definition of a fresh continuation.**

Read-only production inspection at **06:43 AEDT** verified clean `9b3785bd814b33d8a01d573ebdd40512f7a6dde8`, v5 / strategy 1.3.0. Direct OANDA GETs at **06:45 AEDT** independently verified both trades, their opening/closing/protective-stop transactions, and five hours of completed midpoint/bid/ask candles. Times below are October 7 Sydney **AEDT (UTC+11)**; retained broker records use October 6 UTC. Local analysis HEAD was `658ebb9`, whose difference from production is documentation only.

## Broker-confirmed sequence

| | First BUY 3507 | Second BUY 3519 |
| --- | ---: | ---: |
| Entry → exit | 02:00:52 → 03:11:22 | 04:52:52 → 05:36:34 |
| Entry price | 1.12570 | 1.12637 |
| Initial stop | 1.12465 | 1.12558 |
| Initial stop distance | 10.5 pips | 7.9 pips |
| Units / initial AUD risk | 114 / A$0.17325 | 148 / A$0.16903 |
| Best retained quote movement | +11.7 pips / +1.114R | +1.1 pips / +0.139R |
| Exit price / reason | 1.12570 / breakeven stop | 1.12558 / initial stop |
| Net AUD | 0.0000 | −0.1691 |

OANDA created the first trade's replacement stop at **02:36:16.839**, at its entry price of 1.12570. That stop filled at **03:11:22.870**. Protection worked, and realized P&L, financing and commission were zero. The second trade's initial protective stop filled at its specified price, with no observed gap loss. The higher unit count reflects a smaller ATR stop: ATR fell from 8.40 to 6.29 pips while monetary risk slightly decreased. There is no observed risk escalation.

The best-movement figures are the maxima of 420 and 243 retained executable quote samples inside broker-confirmed lifetimes. They are not complete tick extrema. Retrospective candle-component highs and quote samples differ slightly and are separate observations; neither should replace the other as exact path truth.

## Why another BUY was allowed

The [shared re-entry policy](../../backend/src/runtime/intradayReentryPolicy.js) requires a new signal completing after the protected exit, plus at least one wholly post-exit prior M15 candle touching the new signal's EMA20. It does not consume the broader bullish swing or require a break of its earlier high. The [H1 loss-reset policy](../../backend/src/runtime/intradayLossResetPolicy.js) applies to initial stop losses; a breakeven exit explicitly does not arm it.

For the second BUY, the confirmed anchor was trade 3507's breakeven exit. Four completed candles starting **03:30, 03:45, 04:00 and 04:15** met the freshness predicate. Fresh broker midpoint OHLC matches all four stored candles. All four also touched their own historical EMA20, so changing the freshness reference to each candle's EMA would still admit this case. Recomputing the deployed policy returns the recorded **`FRESH_CONTINUATION`, allowed=true**; filled-signal and trade telemetry agree.

The **04:30–04:45** confirmation candle closed at **1.12623**, above the local pullback resumption boundary **1.12600**, but below the prior eight-bar high **1.12694**. H1 remained long-eligible. This passed the current [BUY pullback branch](../../backend/src/strategies/intradayMomentum.js) without a range breakout. It was another locally qualifying continuation inside the existing trend, rather than evidence that the earlier rally high had been reclaimed.

The **04:45–04:51** scans held because expected cost exceeded the existing 15% cost/stop limit. At **04:52**, spread narrowed to 0.9 pips; with 0.2-pip expected slippage, the ratio became 13.99% and the BUY became actionable. This was ordinary scan eligibility, not repeated order submission. Its confirmation candle remained the latest completed M15 candle.

The two filled decisions have different candle-based setup IDs. Three other decisions were rejected because the pair was already in a position. Breakeven exit to second entry was **101.4908 minutes**. No reused filled candle or duplicate fill was found. A distinct software setup ID, however, does not establish a distinct broader market idea.

## Stop location and the next research priority

The second BUY's ATR stop **1.12558** was **inside the pullback's bid range**. The planned structural BUY span—from the latest qualifying touch at **04:15** through the confirmation candle—has minimum bid low **1.12548**. The existing stop was **1.0 pip above** that level. The broader four-touch window's bid low was **1.12536**; that is a different anchor and must not silently replace the selected S1 span.

This demonstrates that the current BUY stop is a volatility distance, rather than the pullback's structural invalidation level. The second trade also showed little favorable follow-through. It does not establish that a wider stop would win or improve portfolio returns.

Prioritize the two separately specified [S1 candidates](2026-10-06-profitability-implementation-plan.md#s1-evaluate-structural-buy-and-entry-location-candidates):

1. Keep BUY entries fixed and evaluate stops below the latest-touch-to-confirmation **bid** structure, with existing precision, minimum-distance and cash-risk rules.
2. Evaluate the directional BUY counterpart of the SELL break/retest rule, with a frozen level, distinct confirmation, explicit cancellation/re-arming and **one filled trade per defined pattern episode**. A later EMA touch alone would not create permission under that candidate.

These are different experiments. The second changes entry eligibility and can remove good entries as well as losses; the first changes risk geometry and holding paths. Full chronological baseline/candidate replay must include winners, scratches, losers, displaced opportunities and resulting cooldown state. Do not infer a profitable prior-high threshold, entry-distance cap, breakeven ban or H1 reset requirement from this pair of trades. Live selection remains the plan's explicit L1 decision.

## Evidence, verification and delivery state

The [reduced evidence](evidence/2026-10-07/eurusd-breakeven-repeat.json) retains the two trades, lifetime quote samples, five decisions, 103 selected signal observations, independent broker records/transactions, 300 M1 and 20 M15 MBA candles, source hashes and dated runtime state. Account identifiers, credentials and email settings are excluded. Raw captures remain temporary; broker credentials stayed on the target.

Run `node docs/reviews/evidence/2026-10-07/verify-eurusd-breakeven-repeat.cjs` with the project's Node 22 runtime. The [read-only verifier](evidence/2026-10-07/verify-eurusd-breakeven-repeat.cjs) passes: broker/local outcomes and timestamps agree; initial-risk arithmetic and sampled-lifetime aggregates match; stored/recomputed re-entry decisions agree; all four touch bars match broker OHLC; seven cost holds precede the second fill; and the stop is 1 pip above the selected bid anchor. Relevant existing strategy/re-entry/generated-lifecycle suites also passed **106 tests**. A full backend regression was not run for this documentation-only review.

The five-hour candle capture does not independently reconstruct full indicator warmup or an alternative holding horizon. Exact persisted order-intent NAV/budget context was not captured; the report verifies recorded initial cash risk, not a complete independent budget reconstruction. This is incident evidence, not an alternate portfolio performance result.

At the dated capture the bot was healthy, enabled and flat, with no pending orders; balance was **A$95.0930**, risk readiness READY and consecutive losses 1. This is a snapshot, not a continuing status claim. The review changed local documentation/evidence only. No trading code, settings, orders, runtime state, commits, publication, build, deployment or restart changed.
