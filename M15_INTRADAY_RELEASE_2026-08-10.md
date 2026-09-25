# M15 Intraday Live Release — 2026-08-10

> **Historical release record.** The body records the August 10 design and is not the current deployed specification. September 26 inspection verified `5889b66`, release `m15-intraday-v3.3` / strategy `1.1.3`, including the excursion measurement correction. Use the [operator guide](USER_GUIDE.md) for current behavior and the [current status and decisions](docs/reviews/2026-09-26-status-and-decisions.md) for review findings and pending proposals. In particular, v3.3 permits multiple attempts for one completed-candle setup after eligible confirmed local pricing rejections, while retaining suppression after submission, uncertainty or a fill; the historical one-actionable-event statement below no longer describes attempt counts. The six-hour time stop described here was connected to live monitoring in the September 6 remediation.

## Outcome

The single live strategy is `intraday_momentum` version `1.0.0`, currently released as `m15-intraday-v2`. It replaces the low-frequency daily carry breakout with a completed-M15 intraday decision loop. There is still one live runtime, no simulated execution path, no strategy selector and no promotion workflow.

## Entry hypothesis

The strategy looks for short-horizon momentum continuation without trading every fluctuation:

- H1 close, EMA 20/50 ordering and ADX at or above 20 establish direction and strength.
- M15 EMA 20/50 ordering and RSI confirm the same direction without accepting extreme RSI.
- A fresh eight-bar range breakout or four-bar pullback resumption supplies the entry trigger.
- Pair-specific Sydney, Tokyo, London and New York clocks admit entries only during relevant liquid sessions. Named time zones make daylight-saving changes explicit.
- Live spread plus 0.2-pip expected slippage must be no more than 15% of the planned stop distance.

All decisions use OANDA candles marked complete. The runtime polls each minute, but a pair can emit at most one actionable event for the same completed M15 candle and direction.

## Universe and risk

The release trades AUD/USD, EUR/USD, GBP/USD and USD/JPY. It risks 0.25% of AUD NAV per entry, limits sizing capital to A$100, permits one open position and caps projected margin at 30% of account balance. Currency-notional limits allow up to six times NAV only inside that stricter one-position margin and stop-risk envelope. Portfolio entry checks halt at 1% daily realized loss or 5% drawdown from the persisted NAV high watermark. Three consecutive losses start a 24-hour entry cooldown; expiry begins a fresh streak without deleting or rewriting the closed trades.

Every order carries a broker-side stop and take profit. The stop is the greater of 1.25 M15 ATR or six pips; the target is 1.5 times initial risk. Breakeven activates at 1R. A six-hour time stop prevents stagnant positions, and a 30-minute closure window beginning 16:45 New York time exits before the broker's daily liquidity break without suppressing the reopened Asian session.

## Expected behavior and evaluation

The design target is roughly 5–15 completed trades per week across the four pairs, not a guaranteed quota. The first operational review occurs after 30 closed trades; breakout and pullback cohorts, pair/session results, execution cost, rejection funnel and exit reasons must remain separate. A profitability conclusion requires a larger sample and multiple market conditions.

This remains an unproven real-money hypothesis. Higher frequency accelerates feedback and trading costs at the same time; it does not guarantee positive expectancy.
