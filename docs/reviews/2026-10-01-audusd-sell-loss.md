# AUD/USD SELL 3487 — 1 October 2026

**The bot sold after a substantial fall, was stopped by a brief rebound, and was already out when the downward move resumed. The dashboard's M15 close-only line hides the rebound that triggered the stop. Direct OANDA records establish a real 8.3-pip loss, not an inverted SELL or P&L sign. This establishes the mechanics of this loss; it does not establish acceptable entry selection or strategy performance.**

Read-only production inspection on October 1 verified clean deployed revision `c6b6c7714564fef4f9abd03727378aad2ab41a0d`, v4.2 / strategy 1.2.2. Broker capture completed at 06:33:40 AEST. All times below use Sydney/AEST (UTC+10). No source, trading configuration, orders, process state, Git publication or deployment was changed.

## Actual trade and the hidden spike

| Event | Sydney time | Broker evidence |
| --- | --- | --- |
| Sell entry | September 30, 23:45:51.138 | Transaction 3487, −146 units at 0.69559 |
| Initial protection | At fill, replaced at 23:45:51.365 | Stop 0.69640, target 0.69437; replacement retained the same prices |
| Best M1 ask low while open | October 1, 00:38 minute | 0.69516: +4.3 pips, approximately +0.531R |
| Broker stop exit | October 1, 00:50:34.656 | Transaction 3494, +146 units at ask 0.69642; stop order 3493 filled |
| Actual result | 64 minutes 43.518 seconds held | −8.3 pips / −A$0.1758; 0.2 pip beyond the requested stop |
| First later M1 ask touch of original target | October 1, 06:03 minute | 0.69437 or below, more than five hours after the stop |

The stop-containing **00:45–01:00 M15 candle opened at 0.69552, reached midpoint high 0.69644, and closed at 0.69564**. A chart connecting only its close to adjacent closes conceals almost the entire adverse spike. The close fill itself records top bid 0.69633 and ask 0.69642, a 0.9-pip spread. This was not a large spread-only stop excursion: midpoint also rose above the stop level during the minute. M1 extrema describe their full minute; the fill transaction establishes the exact execution time/price.

The retained lifetime quote polls peaked at +4.2 pips/+0.519R. The independent M1 ask minimum supports +4.3 pips/+0.531R. The 0.1-pip difference is expected from discrete polling, not contradictory measurements. Breakeven required ask 0.69478 (+8.1 pips/+1R); even all candles overlapping the lifetime stayed above it. There was no missed +1R activation on the retained broker path. The first subsequent M1 touch of that price was 05:06, after the trade had closed.

Broker quote-currency loss is `(0.69559 − 0.69642) × 146 = −US$0.12118`. Applying the close transaction's loss conversion factor agrees with its −A$0.1758 realized result to broker rounding. Financing and commission are zero. OANDA defines negative units as short orders and default buy-side fills/triggers using ask ([order definitions](https://developer.oanda.com/rest-live-v20/order-df/)); its transaction fields distinguish quote-currency P&L from account-currency P&L ([transaction definitions](https://developer.oanda.com/rest-live-v20/transaction-df/)). These match the actual opening and closing transactions.

## Why the bot entered there

This was **NORMAL / M15_RANGE_BREAKOUT**, with original and executed side both SELL. It was not the opposite-direction post-TP fade.

The completed 23:30–23:45 signal candle closed at 0.69578, 4.1 pips below the preceding eight-bar low 0.69619. M15 close < EMA20 < EMA50, RSI 35.94, body ratio 65.9%, candle range 1.357 ATR, and cost/stop ratio 13.57% passed the configured rules. The last completed H1 candle at 23:00 had close 0.69720 < EMA20 0.697746 < EMA50 0.699087, ADX 22.95 and −DI 20.63 > +DI 19.56.

The pullback branch did **not** qualify: the 22:30 candle closed above its own EMA50. The independent breakout branch admitted the trade, as specified. Execution was 1.9 pips below the signal close and 13.62 pips below M15 EMA20. The decision reference was a current quote midpoint, not the signal candle close; the 1.9-pip difference therefore does not establish a violation of the existing 1.5-pip decision-price bound. The order's actual price bound was 0.69550 and its fill 0.69559. These observations locate the entry after a substantial move; they do not prove that adding a distance filter or increasing stops would improve performance.

Retained scan evidence explains the delay: until 21:45, AUD/USD was outside its permitted session; 22:00 lacked a trigger; 22:15–22:45 failed candle quality; 23:00 lacked M15 confirmation; 23:15 lacked a trigger; 23:30 failed candle quality. At 23:45 the breakout finally qualified and filled. A further 00:30 sell was correctly rejected because this pair already had a position. These are observed decisions, not reconstructed hypothetical orders.

The H1 loss-reset requirement was satisfied by an older sequence: previous AUD/USD SELL stop 3435 closed September 25 at 14:38; a nonmatching H1 completed at 16:00; H1 requalified September 28 at 08:00. The state was checked through September 30 at 23:00 and recorded `H1_RESET_REARMED`. This requirement establishes a regime interruption after the prior loss. It does not require an immediately fresh local pullback or ensure a favorable entry price. No bypass was demonstrated.

## What is wrong, and what remains unproven

- **Observed performance:** the latest ten closed ledger rows all have negative P&L, net −A$1.4332 across releases. They comprise eight initial stops, one breakeven scratch and one session-close loss. Nine are SELL and one BUY. This is a poor observed sequence; it is not a homogeneous ten-trade v4.2 sample (3487 is its first trade).
- **Observed trade outcome:** this entry and its 8.1-pip initial stop failed to survive the rebound despite the broader downward path. Entry/stop design requires evaluation on the full retained cohort, including winners, before prescribing new rules. Correct execution alone is not evidence of an effective strategy.
- **Display limitation directly relevant here:** the dashboard plots smoothed midpoint closes without intrabar highs/lows, executed trade markers or stop levels. Its BEARISH badge is client M15 SuperTrend, not the backend's H1 entry predicate. Recent Trades' generic Time column prefers exit time and does not expose entry time/duration in that view.
- **Separate demonstrated display defect:** `LivePriceChart.jsx:136–151` overwrites the last completed candle's OHLC with the current live midpoint while retaining the historical timestamp and old EMA/SuperTrend calculations. The API supplies completed candles only (`tradingRoutes.js:464`). This contaminates the final displayed bar. It does not drive backend execution and is not established as the cause of the loss.
- **Not demonstrated:** reversed SELL units, wrong-side protection, inverted P&L, stop moved in the wrong direction, missing broker protection, missed breakeven activation, fade mislabeling, or H1 loss-reset bypass.

No strategy tuning or display implementation was made in this diagnostic. The next strategy investigation should compare entry distance, pre-entry movement and the executable post-entry path across the full cohort, preserving counterexamples. The directly supported display correction is to retain completed historical candles and represent live prices at their real times, with trade-lifetime/stop visibility; it must not be confused with a profitability correction.

## Verification and retained evidence

Independent source traces checked the actual orchestration: signed SELL submission (`LiveTradingEngine.js:2923`), bid entry (`Oandaclient.js:267`), stop above/target below short entry (`executionPolicy.js:83–108`), ask-side short management (`LiveTradingEngine.js:3645,3678,4026`) and broker-authoritative realized P&L (`LiveTradingEngine.js:3446–3474`). Existing owning-run exit policy is preserved.

Using Node 22.23.1, **323/323 tests passed across five suites**: LiveTradingEngine, sampledExcursionIntegration, tradeReconciliationService, Oandaclient and executionPolicy. This validates their covered execution/lifecycle cases; it is not a strategy profitability test. Direct breakeven tests are predominantly BUY, a coverage gap separate from this trade's proven lack of a +1R touch. No frontend build or deployment was performed.

The [sanitized evidence](evidence/2026-10-01/audusd-3487.json) retains broker trade/transactions, M1 bid/ask/mid prices, M15 candles, entry telemetry, lifetime samples, distinct signal-state observations, entry decisions and recent ledger rows. [Test summary](evidence/2026-10-01/test-summary.json) and [capture manifest](evidence/2026-10-01/manifest.json) distinguish sources and verification. Reproduce the numerical checks with:

```sh
python3 docs/reviews/evidence/2026-10-01/verify_audusd.py
```

At the first runtime capture (about 06:32 AEST), trading was enabled, no positions were open and the current run recorded one loss. This is a dated observation, not a continuing state assertion. Read-only diagnosis did not pause or change live trading.
