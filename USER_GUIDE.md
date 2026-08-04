# Live Trading Operator Guide

The application now has one job: run `carry_trend` against the configured live OANDA account.

## What the dashboard means

- **Setup forming**: daily trend, momentum or financing is valid, but there is no fresh completed-candle breakout.
- **Actionable**: a new live BUY or SELL passed the strategy and is ready for execution checks.
- **Exit only**: close the corresponding existing position; never open the opposite side from that event.
- **Rejected**: an actionable event failed an explicit live check such as spread, stale price, position limit, risk, margin or account state.
- **Paused / risk halted**: no new entries are allowed. Existing broker positions continue to be reconciled and managed.

The configuration page is intentionally read-only. Strategy parameters and risk limits belong to the deployed release so production cannot drift through dashboard edits.

## Current release

| Setting | Value |
| --- | --- |
| Release | `carry-trend-v1` |
| Strategy | `carry_trend` `1.0.0` |
| Decision candles | completed H4 and daily |
| Assets | AUD/USD, EUR/USD, GBP/USD, USD/JPY, NZD/USD, USD/CAD, USD/CHF |
| Entry | fresh 20-day breakout with 50/200 EMA, 60-day momentum and financing alignment |
| Entry risk | 0.5% of NAV |
| Capital cap | A$100 |
| Concurrent positions | 1 |
| Initial stop | max(2.5 daily ATR, 20 pips) |
| Take profit | none |
| New-install trading state | disabled; an existing production enable state is preserved across this release |

## Live controls

The dashboard can start or stop new entries and can close a specific live trade. Closing a trade is a real broker action. Resetting statistics does not reset the broker account.

Useful read-only endpoints:

- `GET /api/health`
- `GET /api/system/health`
- `GET /api/account`
- `GET /api/trading/live-readiness`
- `GET /api/runtime/live-selection`
- `GET /api/signals`
- `GET /api/engine/status`
- `GET /api/analytics?period=30d&mode=live`

The old strategy-selection endpoint returns HTTP 405. The active strategy can change only in a reviewed code release.

## How strategy improvement works

Changes go directly to a versioned live release. Use actual OANDA outcomes as the evidence:

1. Record the completed-candle setup, financing snapshot, spread, requested units, actual fill, initial stop and rejection reason.
2. For every closed trade, review realized P&L, financing, slippage, maximum favorable/adverse movement, holding time and exit reason.
3. Review the entry funnel weekly, including all no-trade reason codes. Do not judge only the trades that filled.
4. Change one coherent hypothesis at a time, bump the strategy/release version, test execution and risk regressions, deploy, and compare the new live cohort with prior real trades.

Do not weaken filters merely to create activity. The model is deliberately selective, and several weeks without an entry can be valid when there is no fresh breakout aligned with financing.

## Incident rule

If broker state and local state disagree, stop new entries and inspect reconciliation before restarting. Never place a manual test order to prove a code path. Unknown broker trades are quarantined instead of adopted or closed automatically.
