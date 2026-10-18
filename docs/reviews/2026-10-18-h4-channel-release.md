# H4 rolling-channel release — October 18, 2026

Adam requested a replacement after the v6 viability review, accepted multi-day
holding and one position per pair, delegated remaining choices, and explicitly
authorized building, publishing and standard deployment on October 18. Trading
was intentionally paused. This deployment preserves that intent; Adam activates
entries himself through the existing Start Trading control.

## Frozen candidate

Strategy `multi_day_trend` version `2.0.0`, release `h4-channel-v1`, execution
policy `h4-channel-risk-v1`. These rules were fixed before release validation:

- Use completed OANDA H4 mid candles, aligned to 17:00 America/New_York. A BUY
  requires the latest close above the preceding 20-bar high and the prior close
  at or below its own preceding 20-bar high. SELL mirrors this below the low.
  This is a fresh crossing, not an 80-hour waiting period after a signal.
- Initial stop distance is twice Wilder ATR(14), retaining the existing 6-pip
  minimum. Translate that distance to the executable entry and round protection
  outward to broker precision; size against the submitted stop and worst
  permitted fill. No fixed profit target or automatic breakeven.
- Ratchet the broker stop to the latest 10 completed H4 bid lows for a BUY or
  ask highs for a SELL. Never loosen a tighter existing broker stop. If the
  liquidation quote has already crossed a newly tighter channel, close through
  the existing broker lifecycle. Missing side history leaves protection intact.
- One open position per pair. Different pairs may overlap subject to existing
  portfolio limits. An opposite entry signal does not reverse an open position.
- Hold overnight Monday through Thursday. Close from Friday 16:45 New York;
  block entries until Sunday 17:05 New York. Existing market/tradeable checks
  still apply. Remove the former daily close and six-hour time stop for new
  owners. Broker stops cannot guarantee protection through gaps.
- Admit entries only with current completed H4 history and within four hours
  plus the existing 90-second publication allowance after the signal bar closes.
  Historical Friday signals expire before Sunday reopen. A normal weekday daily
  maintenance break does not require an extra H4 waiting period.
- Retain the 1.2-pip spread cap, 1.5-pip execution deviation bound and cost test
  `(spreadPips + 0.2 expectedSlippagePips) / effectiveStopPips <= 0.15`.
  Expected slippage is counted once, matching the established admission rule.

Shared risk settings are unchanged: 0.25% entry risk against at most A$100 sizing
capital, 0.5% NAV aggregate stop-risk, existing margin, currency exposure,
drawdown, daily-loss and consecutive-loss protections. Migration retains saved
shared risk and operational settings. It does not reset loss/cooldown history.

The legacy `intraday_momentum` definition, defaults, hashes and persisted owner
exit snapshots remain available for historical attribution and management. New
H4 defaults must not change an old run's meaning. The dashboard exposes the one
current strategy, without adding a strategy chooser.

## Evidence and limits

This is a new, unproven candidate. The old v6 replay results do not measure it.
Software validation establishes rule implementation and broker lifecycle
behaviour, not positive expectancy or a promised trade rate. ATR(14), 20/10
channels and 2 ATR were selected prospectively without parameter search.

Spread, execution slippage and daily side-specific financing affect realized
returns. Overnight holdings incur OANDA financing at 17:00 New York; FX commonly
has triple financing on Wednesday, with holiday adjustments. Friday closure
does not avoid that charge. No zero-financing backtest is an all-in profitability
claim. Longer stops and multi-day holding can still produce quiet periods.

Broker contracts: [FX hours](https://www.oanda.com/au-en/trading/hours-of-operation/),
[financing](https://www.oanda.com/au-en/trading/financing-costs/), and
[candle alignment](https://developer.oanda.com/rest-live-v20/instrument-ep/).

## Validation and delivery

Local validation passed **1,468 backend tests across 74 passing suites**, with
one opt-in historical viability experiment skipped (75 suites / 1,469 tests
discovered). All **21 frontend checks** and the Vite production build passed.
Checks ran on Node 22.23.1. See the [validation record](evidence/2026-10-18/local-validation.json).

Coverage includes actual coordinator → generator → engine → OANDA order
serialization, both directions, overlapping pairs, duplicate/reversal rejection,
final spread/cost limits, queued stale decisions, Friday cutoff during pricing,
pause during pricing, broker-stop ratchets, pending confirmation/retries,
restart, DST, financing-aware existing lifecycle accounting and old owner exits.
Saved enabled intent and shared risk survive migration; the new entry path also
enforces the existing release caps if an old file already exceeds them.

Read-only broker requests retrieved 30 recent H4 candles for each configured
pair. [Raw RFC3339 observations](evidence/2026-10-18/h4-broker-candles.json) exercise
the actual data-service normalization, alignment and side-channel calculations.
A [separate client request](evidence/2026-10-18/h4-broker-candles-unix-client.json)
retains its ordinary UNIX timestamp contract; neither changes quote event/receipt
semantics. Old research fixtures explicitly pin retained v6 defaults; their
passing software checks do not evaluate H4 returns or rewrite old evidence.

Publication and observed deployment state will be recorded after delivery.
Delivery follows local development and commits → GitHub publication →
`./scripts/deploy.sh`. No production source hotfixes or automatic live activation
are performed by this implementation.
