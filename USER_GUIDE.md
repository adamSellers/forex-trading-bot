# Live Trading Operator Guide

The application now has one job: run `intraday_momentum` against the configured live OANDA account.

## What the dashboard means

- **Setup forming**: the H1 regime is valid, but M15 confirmation or a fresh completed-candle trigger is absent.
- **Actionable**: a new live BUY or SELL passed the strategy and is ready for execution checks.
- **Exit only**: close the corresponding existing position; never open the opposite side from that event.
- **Rejected**: an actionable event failed an explicit live check such as spread, stale price, position limit, risk, margin or account state.
- **Paused / risk halted**: no new entries are allowed. Existing broker positions continue to be reconciled and managed.

The configuration page is intentionally read-only. Strategy parameters and risk limits belong to the deployed release so production cannot drift through dashboard edits.

## Corrected release (local; not yet deployed)

The September 6 production review verified v2 / strategy 1.0.0. This table describes the authorized v3 implementation. Follow the [remediation register](docs/reviews/2026-09-06-remediation.md) for validation and rollout state.

| Setting | Value |
| --- | --- |
| Release | `m15-intraday-v3` |
| Strategy | `intraday_momentum` `1.1.0` |
| Decision candles | completed M15 with completed H1 regime context |
| Assets | AUD/USD, EUR/USD, GBP/USD, USD/JPY |
| Entry | eight-bar breakout or four-bar pullback resumption with H1 EMA/ADX and M15 RSI alignment |
| Entry risk | 0.25% × min(80% available margin, A$100) |
| Capital cap | A$100 |
| Concurrent positions | 1 |
| Consecutive-loss control | 24-hour entry cooldown after three losses; the next streak starts at zero after expiry |
| Initial stop | max(1.25 M15 ATR, 6 pips) |
| Take profit | 1.5R broker order; breakeven at 1R |
| Time controls | six-hour time stop and pre-rollover close window |
| New-install trading state | disabled; deployment requires paused/flat, restore always starts paused |

## Operator access

Sign in with the separate operator access token provisioned using `scripts/setup-operator-access.sh`; never use the OANDA key. Sessions expire after eight hours and on restart, use an HttpOnly cookie, and are not stored in browser localStorage. API and socket access require authentication. The only anonymous health endpoint is `GET /api/liveness`, which says nothing about trading safety. Unattended scripts use the encrypted operator credential through `scripts/load-operator-auth.sh`.

Provisioning, HTTPS/proxy settings and recovery are documented in [the deployment runbook](scripts/DEPLOYMENT_README.md). Missing credentials fail closed.

## Reading results

Analytics defaults to the current live run and trades **closed in the selected period**. Choose all live history or a named historical run explicitly. The alternative entry-time view includes trades opened in the period; entry decisions and signals always use their own event times. Earlier stages overwritten by a final rejection cannot be recovered; intermediate stage counts are labelled as minimum observed reach. A report's end boundary is excluded. Do not divide closures by signals from a different time cohort and call it a conversion rate.

Wins, losses and R use **net AUD** including financing and explicit broker charges. Original risk is captured at entry; missing original risk is unknown, never reconstructed from a later moved stop. Historical intent evidence preserves raw `PULLBACK_ONLY`, `BREAKOUT_ONLY` and `BOTH` triggers. Display entry labels alone do not identify these groups. Pair sessions use their actual timezone and overlapping sessions remain visible.

The dashboard win-rate card is explicitly current-run closed trades; the 24-hour P/L card includes all live closures. Failed refreshes retain prior values with a visible stale-data warning. ADX comparisons and bootstrap intervals describe the available sample; they do not establish filter effectiveness or a durable edge.

New trades capture sampled favorable/adverse excursions using executable exit bids/asks. The dashboard reports measurement coverage. Polling misses movements between observations; older trades have no invented excursion history. S3 reports use immutable completed UTC days and Sunday-to-Sunday weeks, wait for post-boundary broker reconciliation, retry failed uploads, and persist successful checkpoints. A first-time scheduler starts with the latest completed periods; it catches up subsequent missed periods. Reports are snapshots of reconciled records available at generation, so later broker corrections require a separately identified corrected export, not overwriting history.

## Strategy semantics retained

No ADX, RSI, EMA, pullback or target thresholds were optimized in this remediation. The existing pullback tests compare the lookback window against the latest EMA value; changing this to each historical bar's EMA is a separate hypothesis requiring its own cohort. Both breakout and pullback can be true. Breakeven moves the stop to the entry fill price at the existing midpoint-based trigger; spread, financing, slippage and quote polling mean it is not a guarantee of zero net loss.

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
- `GET /api/analytics?period=30d&scope=current&timeBasis=realized`

The old strategy-selection endpoint returns HTTP 405. The active strategy can change only in a reviewed code release.

## How strategy improvement works

Changes go directly to a versioned live release. Use actual OANDA outcomes as the evidence:

1. Record the completed M15 trigger, H1 regime, pair session, spread/cost ratio, requested units, actual fill, initial stop and rejection reason.
2. For every closed trade, review realized P&L, spread, slippage, maximum favorable/adverse movement, holding time and exit reason.
3. Review the entry funnel weekly, including all no-trade reason codes. Do not judge only the trades that filled.
4. Change one coherent hypothesis at a time, bump the strategy/release version, test execution and risk regressions, deploy, and compare the new live cohort with prior real trades.

The design target is roughly 5–15 trades per week, not a quota. A quiet day is possible, but repeated weeks with materially lower cadence should trigger a review of the decision funnel rather than arbitrary filter removal.

## Incident rule

If broker state and local state disagree, stop new entries and inspect reconciliation before restarting. Never place a manual test order to prove a code path. Unknown broker trades are quarantined and block all entries; they are not closed automatically. Known managed trades with changed broker units are closed to remove unplanned exposure. Missing/changed protection is repaired and confirmed; an unconfirmed required stop triggers an emergency-close attempt. Pausing entries keeps management running. If saving configuration fails, the process pauses entries in memory and shows a critical persistence fault; restart may reload the earlier saved state. Repair storage and successfully save a paused configuration before reactivation or maintenance. Stopping the engine itself stops management and is an incident state when positions are open.
