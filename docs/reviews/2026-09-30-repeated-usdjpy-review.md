# Repeated USD/JPY sells — 30 September 2026

**The four consecutive USD/JPY sells are real. They comprise three initial stop losses and one protected breakeven exit, net −A$0.5371. The current strategy allows another qualifying sell after an ordinary stop-loss; the September 26 re-entry change addressed TP/breakeven exits only. No duplicate submission or deviation from that specified rule was demonstrated.**

Read-only production inspection verified clean revision `672283897ebd0c26e4924757826c4d2dcd87f329`, **m15-intraday-v4.1 / strategy 1.2.1**, matching local HEAD. This supersedes earlier statements that v4.1 awaited deployment. The active run began September 28 at 14:59:26 AEST. API/ledger capture began September 30 at 06:46:34 AEST; a subsequent direct OANDA read verified all four trades and their transactions. Times below are Sydney/AEST unless explicitly UTC.

## Actual sequence

| Broker trade | Entry | Release / trigger | Exit | Net AUD | Best sampled movement |
| --- | --- | --- | --- | ---: | ---: |
| 3445 | Sep 26 02:15 | v3.3 pullback | Initial stop, −25.0 pips | −0.1850 | +0.140R |
| 3455 | Sep 28 21:30 | v4.1 breakout only | Initial stop, −19.4 pips | −0.1794 | +0.113R |
| 3465 | Sep 28 23:45 | v4.1 pullback only | Initial stop, −18.4 pips | −0.1716 | +0.044R |
| 3475 | Sep 29 22:00 | v4.1 breakout only | Breakeven stop, −0.1 pip | −0.0011 | +1.141R |

The new release has **three closed trades: two full losses and one protected scratch, net −A$0.3521**. The four-trade sequence includes one older-release loss. The account's latest nine closed rows all have negative P&L, totaling −A$1.2574, but treating the newest scratch as another full-risk stop misrepresents its behavior. Sampled favorable movement describes retained executable quotes during the broker-confirmed lifetime, not exact tick extrema.

For 3475, entry was 157.171, initial stop 157.327 and target 156.936. A retained sample first reached +1R at 22:04:22.799. OANDA created replacement stop 3483 at **22:04:26.699**, at the entry price of **157.171**. The sampled peak was +17.8 pips/+1.141R at 22:05:02.783. The stop filled at **157.172 at 22:13:58.006**, giving the 0.1-pip/A$0.0011 loss. Breakeven management therefore operated before the favorable peak; this was not an unprotected reversal into the original stop. OANDA reports order price separately from actual execution price ([trade fields](https://developer.oanda.com/rest-live-v20/trade-df/), [stop-order fields](https://developer.oanda.com/rest-live-v20/order-df/)).

## Why it keeps selling

The [re-entry policy](../../backend/src/runtime/intradayReentryPolicy.js#L91) returns a normal eligible classification when the preceding normal trade exited for a reason other than TAKE_PROFIT or BREAKEVEN_STOP. STOP_LOSS therefore bypasses the extra protected-exit freshness check. This is the [specified contract](2026-09-26-integrated-release-specification.md), including its table row for repeats after other normal exits, and has an explicit [test](../../backend/src/runtime/__tests__/intradayReentryPolicy.test.js#L42).

A later candle can independently satisfy H1 bearish structure/ADX, M15 bearish alignment/RSI and either breakout or pullback resumption. A stopped trade does not consume or invalidate the broader bearish idea. The only loss-history restriction affecting these entries was the existing run-scoped three-negative-P&L cooldown. That explains the repeated exposure; it does not establish that a new loss-specific restriction will improve returns.

There are four distinct signal candles and setup IDs. Current-release broker intents each show exactly one submission and a completed outcome. The signal-candle closes were Sep 26 02:15, Sep 28 21:30, Sep 28 23:45 and Sep 29 22:00 AEST; all occurred after the preceding USD/JPY close. The [setup identity](../../backend/src/services/signalGenerator.js#L51) includes instrument, side, candle timestamp and trigger type. No reused filled setup, duplicate submission or same-candle re-entry was found.

The new release's three stored legacy pullback flags are also true, and both breakout entries passed the unchanged breakout branch. The structural change did not newly admit these particular signal evaluations. That comparison uses recorded indicator values and is not a claim about fills or returns from replaying the old runtime. No post-TP fade occurred, and none of these positions overlapped; the removed global position cap does not explain the sequence.

## What did and did not reset

The retained Sep 28–29 signal observations include 161 records with H1 context. All have EMA20 below EMA50 and none has a bullish H1 regime. However, short eligibility was interrupted: 76 observations were neutral because the H1 close was above EMA20, while 85 were short-eligible. The underlying bearish EMA ordering persisted, but continuously valid sell conditions did not.

- Between 3455's stop and 3465's entry, the retained H1 evaluations stayed bearish. M15 confirmation did reset: the bar closing Sep 28 **12:45 UTC** closed at 157.188, above EMA20 157.1017, with RSI 51.65. The 13:45 UTC signal restored short confirmation.
- After 3465, H1 neutral observations occur before 3475. Before the latter entry, neutral H1 evaluations are present for bars closing Sep 29 10:00–10:45 UTC; the bar closing 11:00 UTC has short eligibility again. M15 EMA20 also crossed back below EMA50 before the 12:00 UTC entry.

These are completed-bar labels associated with retained evaluations, not exact first-observed transition times. Missing-context operational holds do not establish a regime. The capture does not cover every minute since 3445's Friday exit.

**Copying the TP/breakeven freshness test to stop-losses would pass all three new entries.** Applying its exact predicate—one of the preceding four wholly post-exit M15 bars with high at least the new signal's EMA20—finds qualifying touches for 3455, 3465 and 3475. Saved `reentry.freshTouch=false` on these trades is an unevaluated default caused by the early return; it is not evidence that a touch was absent.

Likewise, requiring M15 confirmation to reset would not distinguish these observed entries. Requiring an H1 neutral interruption would exclude 3465 at its recorded entry, while allowing the others. Requiring a full bullish H1 regime is a different, materially stricter rule. These are conditional checks at the actual signals, not alternative portfolio results or validated recommendations. Removing a losing fill changes subsequent positions, cooldowns and available opportunities.

## Execution, risk and present state

Direct OANDA trade data matches all four local entries, exits, units and P&L; nanosecond broker timestamps agree with local millisecond timestamps within 1 ms. The transaction sequence contains four openings and four stop-order closures. Initial risk was approximately A$0.1853, A$0.1798, A$0.1709 and A$0.1761. Increasing unit counts reflect changing stop distances, not escalating cash risk. Entry slippage and spread were small relative to the 18–25-pip initial-stop outcomes. The first three trades' weak favorable movement points to failed directional follow-through in this sample; it does not establish a particular market cause or profitable replacement rule.

At capture the bot was enabled, flat and reconciled, with no unresolved intents or quarantined exposure. Direct broker balance/NAV was **A$95.6166**, with zero open trades or pending orders. The tiny negative breakeven result counted as the third current-run loss under the existing [P&L-based policy](../../backend/src/runtime/portfolioRiskPolicy.js#L134). Entries were in cooldown until **September 30 22:13:58 AEST**. This is a dated observation, not a continuing status guarantee.

## Decision boundary and evidence

The observed limitation is that prior failed directional attempts do not affect the next qualifying signal beyond the run-scoped cooldown. The current implementation matches its narrower approved contract. A loss-specific invalidation/re-arming rule would be a strategy change, and its reset criterion needs to be explicit. A fresh-touch-only extension demonstrably does not address these examples. Neither these trades nor the previous mixed historical study proves the revised strategy better or worse in expectation.

Retained [account-free evidence](evidence/2026-09-30/repeated-usdjpy.json) contains the reduced four-trade analysis, direct broker records/transactions, distinct decisions, single-submission intents, signal observations, freshness predicate inputs/results, runtime snapshot and source hashes. Validation checked the four broker matches, distinct setup IDs, all three completed single-submission intents, the loss total and the three predicate results. Raw captures remain temporary; broker credentials stayed on the production host.

This review changed local documentation/evidence only. No strategy code, thresholds, enabled state, orders, production processes or source changed. No source commit/publication, build, deployment or full backend test run was performed. The loss-specific strategy choice remains open; no new restriction or reversal rule was silently selected.
