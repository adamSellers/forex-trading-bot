# Live Trading Operator Guide

The application now has one job: run `intraday_momentum` against the configured live OANDA account.

## What the dashboard means

- **Setup forming**: the H1 regime is valid, but M15 confirmation or a fresh completed-candle trigger is absent.
- **Actionable**: a new live BUY or SELL passed the strategy and is ready for execution checks.
- **Exit only**: close the corresponding existing position; never open the opposite side from that event.
- **Rejected**: an actionable event failed an explicit live check such as spread, stale price, position limit, risk, margin or account state.
- **Paused / risk halted**: no new entries are allowed. Existing broker positions continue to be reconciled and managed.

The configuration page is intentionally read-only. Strategy parameters and risk limits belong to the deployed release so production cannot drift through dashboard edits.

## Current deployed release

Read-only production checks on September 26 verified clean commit `5889b66`, with the [excursion measurement correction](docs/reviews/2026-09-21-excursion-measurement-correction.md) deployed. Release v3.3 / strategy 1.1.3, the existing run/config and numerical trading rules remain unchanged, including the [entry-rejection and reconsideration correction](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md). This table describes the last verified deployed release; the [current status and decisions](docs/reviews/2026-09-26-status-and-decisions.md) separate deployed behavior from the authorized local v4 implementation.

| Setting | Value |
| --- | --- |
| Release | `m15-intraday-v3.3` |
| Strategy | `intraday_momentum` `1.1.3` |
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

**Time Stop** means the position reached six hours from its original broker entry time. The bot requests a market close whether the trade is profitable, losing or near flat; it does not require a reversal or a stop/target price to be reached. The clock survives restarts and an entry pause. Execution occurs when the running monitor and broker can process the close, so the recorded duration may exceed six hours. The rule was documented with the August 10 strategy but was not connected to live position monitoring until the September 6 remediation. **Session Close** is the separate New York rollover-window exit. See [the September 8 example and rationale](docs/reviews/2026-09-08-exit-policy-observations.md).

## Local v4 release awaiting rollout

The user authorized the [integrated release](docs/reviews/2026-09-26-integrated-release-specification.md), now implemented locally as **m15-intraday-v4 / strategy 1.2.0**. Local validation passed: 834 tests across 41 backend suites; the changed analytics JSX also passed syntax validation; it has not been published or deployed. The table above remains the last verified production state.

Normal pullbacks now use each prior candle's own EMA20 touch and EMA50 integrity, then require the signal to clear the structure from the latest touch while retaining the two-bar confirmation. The independent breakout branch remains. For a same-direction repeat after TP or breakeven, both branches need a prior completed candle that started at or after the broker exit and touched the new signal's EMA20. The new signal must complete after the exit; an already-completed candle cannot be reused as a fade.

A repeat after a normal TP without that fresh touch may produce **one opposite-direction fade**. The original trend signal still has to qualify; a fade deliberately trades against that direction. After breakeven, missing freshness means wait. A filled fade consumes its originating TP episode through restart, and the fade's own exit cannot arm another fade. A fresh normal continuation or independent opposite normal entry remains possible. Signal-reversal events do not close an open fade or close another position to make room for a fade.

Normal and fade trades retain the same 1.5R target, +1R breakeven, stop-distance policy, time/session exits and risk controls. The order path sizes and checks exact broker-formatted prices; unchanged movement limits cannot expand through formatting. Existing scalar RSI now carries the calculated value, with unknown values left null. Trigger, original/executed direction and parent-exit evidence are retained for review. The existing trigger-performance table separates trend entries from post-TP fades while preserving their original trigger classification.

The experiments have mixed evidence: five removed historical pullbacks included two winners and totalled +A$0.0315; four conditional fade paths produced two targets and two stops. Treat the next live cohort as an experiment, not a demonstrated improvement.

## Opening the app

Open [the dashboard](http://fx.oakroad) directly on your internal network. This is a private personal tool with no login, operator token or session expiry. The API and live updates use the same network access. Broker credentials remain server-side, and trading readiness/risk checks still govern entries.

Deploy with `./scripts/deploy.sh` from your local checkout after publishing the reviewed release. See [the deployment guide](scripts/DEPLOYMENT_README.md), or [maintenance and recovery](docs/operations/recovery-and-access.md) for operational details.

## Notifications

The existing email setting controls trade-open and trade-close notifications. Operational health remains visible in the dashboard and API, with readiness and risk checks active. Operational warning/recovery emails were removed in deployed revision `8e4fb99`. See the [incident record](docs/reviews/2026-09-07-operational-email-removal.md).

## Pricing health

A broker quote can be current even when its price-event timestamp is old: OANDA may return the same event on successive successful polls. The dashboard separates **validated receipt age** from **price event age**. An old event alone produces no warning. A missing/invalid pair, failed request or receipt older than the existing 20-second health budget identifies the actual delivery problem. Valid nontradeable responses appear as broker market state in the details.

Cached entry checks retain a 15-second receipt limit. The final pricing request and preparation must fit within the existing 15-second submission budget; spread, liquidity, movement bounds and risk checks still apply. Quote-dependent stop management and conversion fallback retain 30-second receipt limits. A genuinely unavailable cached quote can still stop entry before final pricing. Broker protection, six-hour exits and protection/close retries keep their existing paths.

Health severity and entry state describe different things. A pair-specific delivery warning does not assert that every instrument is blocked. “Watching for a completed M15 setup” means the global runtime is enabled; each prospective trade still has to pass its own checks. Operational emails remain absent.

## Pricing rejections and later scans

The deployed v3.3 correction records a spread, execution-cost or price-movement decline before submission as an expected entry rejection, with its specific reason. The error count records unexpected failures; one failure is counted once.

After a recognized local pricing rejection, the next regular scan may reconsider the same completed-candle setup if it still qualifies. Every entry check runs again, and the original decision-price movement limit remains anchored to the first attempt, including after restart. A better cached quote does not guarantee an acceptable final executable quote. Submission, an uncertain outcome or a fill keeps duplicate entry suppression in place; risk and other rejection types retain their existing behavior. There is no new polling loop or wider cost/risk allowance.

## Reading results

Analytics defaults to the current live run and trades **closed in the selected period**. Choose all live history or a named historical run explicitly. The alternative entry-time view includes trades opened in the period; entry decisions and signals always use their own event times. Earlier stages overwritten by a final rejection cannot be recovered; intermediate stage counts are labelled as minimum observed reach. A report's end boundary is excluded. Do not divide closures by signals from a different time cohort and call it a conversion rate.

From v3.3, actionable-event and entry-decision counts include each distinct reconsideration attempt. Several attempts can belong to one completed-candle setup; the strategy-decision count still groups that setup once. A rejected attempt followed by a fill is two attempts and one trade.

Wins, losses and R use **net AUD** including financing and explicit broker charges. Original risk is captured at entry; missing original risk is unknown, never reconstructed from a later moved stop. Historical intent evidence preserves raw `PULLBACK_ONLY`, `BREAKOUT_ONLY` and `BOTH` triggers. Display entry labels alone do not identify these groups. Pair sessions use their actual timezone and overlapping sessions remain visible.

The dashboard win-rate card is explicitly current-run closed trades; the 24-hour P/L card includes all live closures. Failed refreshes retain prior values with a visible stale-data warning. ADX comparisons and bootstrap intervals describe the available sample; they do not establish filter effectiveness or a durable edge.

Trades capture sampled favorable/adverse excursions using executable exit bids/asks. The deployed September 21 measurement correction keeps new version 2 samples provisional until the matching broker close establishes their lifetime. The close removes observations outside that lifetime and recomputes extrema. The September 26 review independently verified all ten new trades' version 2 records. The dashboard reports verified coverage separately from unverified samples; averages use verified closed-trade samples only. Older aggregates and partial legacy history remain available but excluded from these averages because their timing cannot be repaired. Polling still misses movements between observations; verified does not mean tick-complete or exact historical extrema.

S3 reports use the same analytics calculation and immutable completed UTC days and Sunday-to-Sunday weeks, wait for post-boundary broker reconciliation, retry failed uploads, and persist successful checkpoints. A first-time scheduler starts with the latest completed periods; it catches up subsequent missed periods. Reports are snapshots of reconciled records available at generation, so later broker corrections require a separately identified corrected export, not overwriting history.

## Strategy semantics retained

No numeric ADX, RSI, EMA-period, pullback-window or target threshold was optimized. Last verified production v3.3 compares prior candles against the signal's EMA values; local v4 changes ordinary pullbacks to each bar's EMA and receives its own cohort. The separate post-exit freshness test retains its signal-EMA reference. Both breakout and pullback can be true. Breakeven moves the stop to the entry fill price at 1R; v3.1 quote-dependent management requires a validated bid and ask and uses the exit bid for a BUY and ask for a SELL. Missing executable pricing defers that adjustment; timed exits and existing close/protection retries remain independent. Financing, execution costs, slippage and quote polling mean it is not a guarantee of zero net loss.

## Live controls

The dashboard can start or stop new entries and can close a specific live trade. Closing a trade is a real broker action. Resetting statistics does not reset the broker account.

In v3.2, **Enable Live** can record that trading should resume after an active loss cooldown. Entries remain blocked until its original expiry; the dashboard shows the cooldown separately from the enabled state. **Pause Entries** keeps trading disabled even after expiry. Backups and deployments preserve that choice, and a release update retains an already-active cooldown without restarting its clock. Other readiness failures still prevent enabling.

The earlier backup fault could leave an installation disabled; deploying its correction preserved that disabled choice. Such an installation needs **Enable Live** to resume by the user's choice. This is historical recovery guidance, not a standing post-deployment step; ordinary maintenance preserves enabled intent while respecting cooldowns.

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
4. Specify the complete release and each experimental component before implementation, bump its strategy/release version, test execution and risk regressions, then compare the deployed cohort with prior real trades. A combined release limits causal attribution; record entry categories and distinct episodes without treating hypothetical skipped trades as control returns.

The design target is roughly 5–15 trades per week, not a quota. A quiet day is possible, but repeated weeks with materially lower cadence should trigger a review of the decision funnel rather than arbitrary filter removal.

## Current review and decision points — September 26

The [follow-up review](docs/reviews/2026-09-26-follow-up-trading-review.md) checked every trade from September 21 20:35 to September 26 06:45 AEST, end excluded: ten closed trades, two positive, seven negative and one flat, net **−A$0.5369**. The unchanged v3.3 run now has 25 closed trades and **−A$1.2693** net. The new interval is four days, ten hours and ten minutes, not seven elapsed days; earlier releases remain separate cohorts.

The review itself changed no live setting. The subsequent authorized integrated implementation is described above and in the [release specification](docs/reviews/2026-09-26-integrated-release-specification.md). It retains 1.5R and existing risk/capital limits while combining entry changes, precision correctness and attribution. Actual reviewed fill risks remained within budget. Research sensitivities are not alternative live returns, and the new code has not been deployed. See the [status and decision record](docs/reviews/2026-09-26-status-and-decisions.md) for remaining verification, rollout and operational work.

## Incident rule

If broker state and local state disagree, stop new entries and inspect reconciliation before restarting. Never place a manual test order to prove a code path. Unknown broker trades are quarantined and block all entries; they are not closed automatically. Known managed trades with changed broker units are closed to remove unplanned exposure. Missing/changed protection is repaired and confirmed; an unconfirmed required stop triggers an emergency-close attempt. Pausing entries keeps management running. If saving configuration fails, the process pauses entries in memory and shows a critical persistence fault; restart may reload the earlier saved state. Repair storage and successfully save a paused configuration before reactivation or maintenance. Stopping the engine itself stops management and is an incident state when positions are open.
