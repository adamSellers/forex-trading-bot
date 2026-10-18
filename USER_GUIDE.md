# Live Trading Operator Guide

**October 18 deployment verified:** [H4 Rolling Channel Trend 2.0.0](docs/reviews/2026-10-18-h4-channel-release.md) is deployed at clean `c09efb5`, verified healthy and flat at **17:38 AEDT**, with entries **paused** and readiness passing. All 1,468 target backend tests, build, backup and deployment health checks passed; local checks also cover 21 frontend tests, 23 health scenarios and 57 deployment/restore cases. All four pairs have completed H4 bid/ask data. Adam must use the existing Start Trading control to activate entries. Profitability and trade frequency remain unproven. Earlier pending-delivery statements below describe prior checkpoints.

**October 18 H4 replacement:** [H4 Rolling Channel Trend 2.0.0](docs/reviews/2026-10-18-h4-channel-release.md), release `h4-channel-v1`, is being validated for the authorized standard deployment. Intentional paused entries will be preserved; use Start Trading when ready. Earlier versioned sections describe historical M15 owners.

## Current H4 candidate

| Setting | Value |
| --- | --- |
| Strategy / release | `multi_day_trend` 2.0.0 / `h4-channel-v1` |
| Entry | Fresh completed H4 close beyond the preceding 20-bar high/low |
| Initial stop | 2 × ATR(14), minimum six pips |
| Protective channel | Latest 10 completed H4 bid lows for BUY / ask highs for SELL; only tightens |
| Profit target / breakeven | None |
| Holding | Overnight on weekdays; Friday close from 16:45 New York |
| Concurrent positions | One per pair, subject to existing portfolio and margin limits |
| Risk | 0.25% × min(80% available margin, A$100); aggregate stop risk ≤0.5% NAV |

A 20-bar channel is a lookback, not an 80-hour delay after a breakout. The same signal cannot submit duplicate orders. A new opposite signal does not reverse an existing position. A pause blocks entries while existing positions continue to be managed. Financing accrues for overnight positions; Friday closure does not avoid Wednesday triple financing. Gaps can exceed planned stop losses. Profitability and trade frequency are unproven.

## October 7 BUY fix deployed

The selected [v6 / strategy 1.4.0](docs/reviews/2026-10-07-buy-retest-release.md) is deployed at clean `562334b`, verified healthy/enabled and flat at 12:23 AEDT. BUY entries require a completed break above the previous eight-bar high, a distinct retest above that frozen level and a later bullish confirmation above the retest high. A fill consumes the breakout episode until price closes back through its level and a new pattern forms. Its stop sits below the minimum broker bid low of the retest episode, with the existing six-pip minimum and cash-risk budget. SELL-to-BUY fades are disabled to prevent bypass; SELL entry rules and old trades' exit management remain. All 1,316 backend tests passed locally and during deployment, with frontend checks/builds and a matched backup verified. Earlier dated sections below describe their original releases.

## October 6 analytics correction

The [measurement release](docs/reviews/2026-10-06-analytics-measurement-release.md) corrects saved signal entry attribution and observed expectancy. A single closed trade or identical observed results retain their actual P&L and mean, but have no empirical bootstrap interval. Available intervals assume independent trades. Cohort observed AUD and pip distributions include flats and keep their signs/denominators separate; missing risk/pip coverage is explicit. Deployed at `810c7f9` on October 6, these corrections retain strategy 1.3.0 and its current live cohort. The release record retains verification evidence.

## October 1: SELL break, retest and rejection

The authorized [v5 release](docs/reviews/2026-10-01-sell-retest-release.md), strategy **1.3.0**, replaces normal SELL triggers with three distinct completed M15 candles: a bearish break below the previous eight-bar low, a later retest that closes below that frozen level, then a later bearish close below the retest low. A close back at/above the level cancels it; another retouch requires another later confirmation. Existing H1/M15 qualification and trading checks still apply.

The SELL stop sits above the maximum **ask high** during the retest episode, plus one price tick. The existing six-pip minimum may put it farther away. Position size adjusts within the same cash-risk allowance; the absolute stop stays fixed after the fill, and 1.5R target/+1R breakeven are measured from the actual fill. BUY entries keep their existing stops. BUY-to-SELL fades are disabled; SELL-to-BUY fades and position exits remain unchanged.

The dashboard can show a valid bearish trend while the SELL entry is still waiting for its retest and rejection. Analytics labels the new entries **SELL break/retest** separately from prior trend/fade trades. Versioned real OANDA outcomes will determine whether this candidate improves results. Deployment is verified at `73cf4b5`; entries are enabled and the linked release record retains the checks. Older dated sections retain historical context.

## September 30: reset after an initial stop

The authorized [v4.2 release](docs/reviews/2026-09-30-loss-reset-release.md), strategy 1.2.2, adds a condition for repeating a normal trade after a full initial stop-loss. On the same pair and side, the H1 regime must stop qualifying on a completed hourly candle, then qualify again on a later hourly candle before another valid M15 breakout or pullback may enter. The condition is symmetric for buys and sells. A neutral H1 phase is enough; missing data does not prove a reset.

Breakeven exits, including tiny negative fills at the moved stop, do not arm this additional requirement. The existing TP/breakeven freshness and post-TP fade rules still apply. Position sizing, stops, 1.5R targets, +1R breakeven, one position per pair and all numerical risk limits are unchanged. The separate three-negative-P&L cooldown retains its existing behavior.

The dashboard signal reason distinguishes waiting for an H1 reset, waiting for renewed H1 qualification and unavailable reset evidence. A restart or release change does not erase an unfinished reset requirement. The release record distinguishes implementation/testing from actual deployment. Older version-specific sections below remain historical context.

The application runs `multi_day_trend` against the configured live OANDA account. The versioned M15 sections below describe historical owners.

## What the dashboard means

- **Setup forming**: waiting for a fresh completed H4 close through the rolling channel.
- **Actionable**: a new live BUY or SELL passed the strategy and is ready for execution checks.
- **Exit only**: close the corresponding existing position; never open the opposite side from that event.
- **Rejected**: an actionable event failed an explicit live check such as spread, stale price, position limit, risk, margin or account state.
- **Paused / risk halted**: no new entries are allowed. Existing broker positions continue to be reconciled and managed.

The configuration page is intentionally read-only. Strategy parameters and risk limits belong to the deployed release so production cannot drift through dashboard edits.

**Chart correction deployed with v5 on October 1:** Market Overview keeps completed midpoint candle closes and their indicators separate from the **Latest quote** point. The quote uses its broker event time, while each completed close is plotted at its candle's end time. Hover a historical point to see the completed interval and original high/low; the line itself still represents closes and does not show every intrabar excursion. The trend badge uses completed chart candles. See the [correction record](docs/reviews/2026-10-01-chart-correction.md) for verification and delivery status.

## Historical v6 release

The following table describes [v6 / strategy 1.4.0](docs/reviews/2026-10-07-buy-retest-release.md), deployed at `562334b` on October 7. Measurement corrections and existing SELL behavior remain; dated earlier release records retain their original contracts.

| Setting | Value |
| --- | --- |
| Release | `m15-intraday-v6` |
| Strategy | `intraday_momentum` `1.4.0` |
| Decision candles | completed M15 with completed H1 regime context |
| Assets | AUD/USD, EUR/USD, GBP/USD, USD/JPY |
| Entry | BUY: break/retest/confirmation, one fill per breakout episode; SELL: break/retest/rejection; existing freshness/H1 reset; fades disabled |
| Entry risk | 0.25% × min(80% available margin, A$100) |
| Capital cap | A$100 |
| Concurrent positions | one per pair, subject to portfolio risk and margin |
| Consecutive-loss control | 24-hour entry cooldown after three losses; the next streak starts at zero after expiry |
| Initial stop | BUY: retest-episode bid low minus one tick; SELL: retest-episode ask high plus one tick; both retain six-pip minimum |
| Take profit | 1.5R broker order; breakeven at 1R |
| Time controls | six-hour time stop and pre-rollover close window |
| New-install trading state | disabled; deployment requires paused/flat, restore always starts paused |

**Time Stop** means the position reached six hours from its original broker entry time. The bot requests a market close whether the trade is profitable, losing or near flat; it does not require a reversal or a stop/target price to be reached. The clock survives restarts and an entry pause. Execution occurs when the running monitor and broker can process the close, so the recorded duration may exceed six hours. The rule was documented with the August 10 strategy but was not connected to live position monitoring until the September 6 remediation. **Session Close** is the separate New York rollover-window exit. See [the September 8 example and rationale](docs/reviews/2026-09-08-exit-policy-observations.md).

## Historical v4.1: one position per pair

The user explicitly requested that a qualifying setup on one pair should not be blocked merely because another pair is held. Local **m15-intraday-v4.1 / strategy 1.2.1** removes the account-wide count cap and retains one position per pair. Strategy, quote, broker, per-trade sizing, margin, aggregate exposure and loss checks still apply. Available margin can reduce later position sizes, and the unchanged aggregate stop-risk ceiling of 0.5% of NAV can still reject an additional full-risk pair. Broker-confirmed stop movement to breakeven can release stop-risk capacity; the regression tests demonstrate admission of a third pair in that case. This increases potential concurrent exposure within the existing portfolio limits; it does not establish better returns.

The dashboard/API describe the policy as “one per pair”. Saved settings and enabled intent survive migration except the retired global count field; historical snapshots remain unchanged. Active cooldown expiry and existing trades' owner exit policies carry forward. Validation and delivery state are recorded in the [release contract](docs/reviews/2026-09-28-pair-capacity-release.md). No production settings were changed during local implementation.

## Historical v4 entry and execution rules (SELL entry rules superseded above)

The user-authorized [integrated release](docs/reviews/2026-09-26-integrated-release-specification.md) is verified deployed as **m15-intraday-v4 / strategy 1.2.0**. Its original local validation passed 834 tests across 41 backend suites plus analytics JSX parsing. Those results do not substitute for v4.1 validation.

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

S3 uploads remained unconfigured at the September 28 check. When configured, S3 reports use the same analytics calculation and immutable completed UTC days and Sunday-to-Sunday weeks, wait for post-boundary broker reconciliation, retry failed uploads, and persist successful checkpoints. A first-time scheduler starts with the latest completed periods; it catches up subsequent missed periods. Reports are snapshots of reconciled records available at generation, so later broker corrections require a separately identified corrected export, not overwriting history.

## Strategy semantics retained

No numeric ADX, RSI, EMA-period, pullback-window or target threshold was optimized. Deployed v4 uses each prior candle's own EMA for ordinary pullbacks; v4.1 retains that rule in a distinct capacity-policy cohort. The separate post-exit freshness test retains its signal-EMA reference. Both breakout and pullback can be true. Breakeven moves the stop to the entry fill price at 1R; v3.1 quote-dependent management requires a validated bid and ask and uses the exit bid for a BUY and ask for a SELL. Missing executable pricing defers that adjustment; timed exits and existing close/protection retries remain independent. Financing, execution costs, slippage and quote polling mean it is not a guarantee of zero net loss.

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

The [October 6 implementation plan](docs/reviews/2026-10-06-profitability-implementation-plan.md) adds isolated offline data audits and chronological research before selecting a versioned live change. Historical models must disclose missing paths, execution assumptions and reused evaluation periods. Actual OANDA outcomes remain the live evidence:

1. Record the completed M15 trigger, H1 regime, pair session, spread/cost ratio, requested units, actual fill, initial stop and rejection reason.
2. For every closed trade, review realized P&L, spread, slippage, maximum favorable/adverse movement, holding time and exit reason.
3. Review the entry funnel weekly, including all no-trade reason codes. Do not judge only the trades that filled.
4. Specify the complete release and each experimental component before implementation, bump its strategy/release version, test execution and risk regressions, then compare the deployed cohort with prior real trades. A combined release limits causal attribution; record entry categories and distinct episodes without treating hypothetical skipped trades as control returns.

The design target is roughly 5–15 trades per week, not a quota. A quiet day is possible, but repeated weeks with materially lower cadence should trigger a review of the decision funnel rather than arbitrary filter removal.

## Current review and decision points — September 28

The [follow-up review](docs/reviews/2026-09-26-follow-up-trading-review.md) checked every trade from September 21 20:35 to September 26 06:45 AEST, end excluded: ten closed trades, two positive, seven negative and one flat, net **−A$0.5369**. The unchanged v3.3 run now has 25 closed trades and **−A$1.2693** net. The new interval is four days, ten hours and ten minutes, not seven elapsed days; earlier releases remain separate cohorts.

The review itself changed no live setting. The subsequent authorized integrated implementation is described above and in the [release specification](docs/reviews/2026-09-26-integrated-release-specification.md). It retains 1.5R and existing risk/capital limits while combining entry changes, precision correctness and attribution. Actual reviewed fill risks remained within budget. Research sensitivities are not alternative live returns. V4 deployment was verified September 28; the separately requested v4.1 capacity change remains local. See the [status and decision record](docs/reviews/2026-09-26-status-and-decisions.md) for remaining verification, rollout and operational work.

## Incident rule

If broker state and local state disagree, stop new entries and inspect reconciliation before restarting. Never place a manual test order to prove a code path. Unknown broker trades are quarantined and block all entries; they are not closed automatically. Known managed trades with changed broker units are closed to remove unplanned exposure. Missing/changed protection is repaired and confirmed; an unconfirmed required stop triggers an emergency-close attempt. Pausing entries keeps management running. If saving configuration fails, the process pauses entries in memory and shows a critical persistence fault; restart may reload the earlier saved state. Repair storage and successfully save a paused configuration before reactivation or maintenance. Stopping the engine itself stops management and is an incident state when positions are open.
