# Live-Only Rebuild — 2026-08-04

## Outcome

The application has been rebuilt around a single live OANDA execution path. The previous simulated runtimes, alternate strategies, forecasting sidecar, offline replay tools, strategy switching and related dashboard surfaces were removed from the runnable product.

The only deployed strategy contract is `carry_trend` version `1.0.0`, released as `carry-trend-v1`.

## Why this model

The former short-horizon indicator stack accumulated multiple overlapping gates, unstable candle/session assumptions and extra services without establishing useful real-time results. It also created a false sense of evidence through an execution model the operator did not trust.

The replacement starts with a narrower economic hypothesis:

> A persistent multi-month currency trend may continue after a fresh medium-term breakout, and holding cost should support—or at least not strongly oppose—the trade direction.

That hypothesis produces three observable components using broker data already needed for execution:

- persistent direction: completed daily close plus 50/200-day EMA ordering;
- persistence strength: 60-day price momentum and a fresh 20-day closing breakout;
- holding economics: the current long/short financing differential from OANDA account instruments.

The model is intentionally sparse. It does not claim demonstrated profitability, and no profit guarantee is possible. This release is a controlled real-money test on the small funded account.

## Exact decision rule

For each configured pair, every live cycle reads only completed OANDA H4 and daily candles. A long entry requires daily close above the fast EMA, fast EMA above slow EMA, positive momentum of at least 1%, a fresh close above the prior 20-day high, and financing that favors long by at least 0.5 percentage points annually while the long rate is no worse than -3% annually. Shorts are symmetric.

No entry is allowed unless live price freshness, tradeability, spread, one-position, margin, risk, exposure and account-currency checks pass. All failures have explicit reason codes.

## Risk and exits

- 0.5% NAV risk per entry, with a hard 1% release-readiness ceiling.
- Maximum A$100 capital allocation.
- One open position.
- Initial broker stop: max(2.5 daily ATR, 20 pips).
- No fixed profit target or time stop.
- Breakeven at 1R and trailing activation at 2R with a monotonic 1.5R distance.
- Daily trend invalidation emits a side-specific exit-only action.
- Daily loss, drawdown, correlated exposure, currency exposure and consecutive-loss checks fail closed.

## Expected behavior

The likely cadence is zero to a few entries per month across seven major pairs. A long stretch of HOLD decisions is not an error when no fresh completed daily breakout and financing alignment exist. Operational health is evaluated separately from trade frequency.

## Direct live improvement loop

The useful evidence is the full live decision funnel, not just account P&L:

- completed-candle trend, momentum, breakout and financing state;
- spread, price age and every rejected-entry reason;
- requested size, broker fill, initial stop and any submission recovery;
- realized P&L, OANDA financing, slippage, holding time and exit reason;
- protective-order and reconciliation status across restarts.

Review the funnel weekly and every closed trade individually. Strategy changes should alter one coherent hypothesis, increment both the strategy version and live release, retain the prior live cohort in telemetry, pass execution/risk regression tests, and then go directly to the live account. There is no secondary promotion or simulation workflow.
