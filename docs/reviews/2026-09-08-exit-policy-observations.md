# September 8 exit-policy observations and follow-up

Status: read-only production investigation and local documentation updates only. Production revision `8e4fb99` was verified over SSH. No strategy, funding, risk, notification, broker or deployment changes were made.

## User-requested take-profit review

The user asked to keep the fixed 1.5R take-profit parameter under review as more live observations accumulate. This is a standing topic for future project/performance reviews, not approval to tune it now. Current settings remain: initial stop max(1.25 × M15 ATR14, 6 pips), fixed 1.5R target, breakeven at 1R, trailing disabled, six-hour time stop and separate pre-rollover exit.

September 7's three USD/JPY SELL trades closed at 15:58, 16:24 and 18:07 Sydney time for A$0.2637, A$0.2693 and A$0.2694 net, totalling A$0.8024. Initial cash risk was approximately A$0.18 each; position sizes fell from 170 to 155 to 113 units as volatility increased. The user's screenshot subsequently showed 154.399, about 87 pips below the last exit at 155.267. This demonstrates uncaptured continuation, not the profitability of an alternative exit strategy.

Saved decisions after the final target showed duplicate-candle suppression, then oversized completed candles at 18:15 and 18:30 (4.95 and 2.85 ATR versus a 2.5 limit), followed by RSI below the short-entry minimum at 18:45. The H1 short regime remained valid and data was fresh at these observations. A fixed target plus restrictive re-entry can leave the bot outside an extended trend.

Future assessment must include continuing winners, reversals, losers, costs, net R, time in market and drawdown across the relevant live cohort. Account for the one-position limit: holding the first position excludes later overlapping entries. Existing executable-price excursion samples end at trade closure; post-exit comparisons require available market-price history and explicit sampling limits. Neither 1.5R nor six hours is established as optimal by the current small sample.

## September 8 Time Stop

Production trade `dcf9f16e-08fb-4169-9e92-74b28630c228`, in run `live_d52e2213-97c9-477c-85f9-fb7ce58a1571`, was a USD/JPY SELL of 88 units:

- Opened **00:30:45.834 AEST**, September 8, at **154.397**.
- Closed **06:30:51.157 AEST** at **154.369**, after **6h 00m 05.323s**.
- Exit reason **TIME_STOP**; net **A$0.0219**, **+2.8 pips**.
- Saved target **154.04738**, initial stop **154.63008**, initial risk **A$0.18583**; breakeven had not activated.
- The saved owner exit policy specifies `timeStopHours: 6`. The elapsed holding time explains this closure; the trade did not need to reach either price boundary.

`resolveTimedExitReason` checks wall-clock time since the original entry, independently of current profit/loss or trend. The live monitor requests a market close at the first available check after expiry; runtime/broker delays can postpone actual execution. An entry pause or process restart does not reset the trade's age. Broker stop/target orders remain a separate form of protection; the time exit requires the app and broker connection to function.

## Why it became visible after the remediation

The six-hour setting was introduced with the intraday strategy in commit `1f54e5f` on **August 10**, and the release document described its purpose as preventing stagnant positions. The general timed-exit helper already existed, but the September 6 audit found no live production call site. The remediation connected it to position management in `0d62293` on **September 6**.

The audit's F1 evidence included a EUR/USD position held **11h57m** across the intended rollover boundary, with **A$0.0499 financing** and a **−A$0.0520 net result** despite a broker breakeven exit. Enforcing the existing six-hour and separate rollover rules corrected that mismatch. It also changed actual trading behavior, which must be communicated explicitly rather than dismissed as an internal wiring change. Six hours is a strategy assumption about the lifetime of an intraday setup; the code does not diagnose stagnant momentum before closing, and the duration has not been proved optimal.

References: [original August release](../../M15_INTRADAY_RELEASE_2026-08-10.md), [September 6 audit F1](2026-09-06-production-review.md), [time rule](../../backend/src/runtime/exitPolicy.js), [live monitor](../../backend/src/services/LiveTradingEngine.js).

Verification: read-only live trade and saved-policy inspection, local source/Git-history review, Markdown link and whitespace checks. No runtime tests were needed for documentation-only changes.
