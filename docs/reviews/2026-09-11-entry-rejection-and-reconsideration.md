# Entry rejection reporting and same-candle reconsideration

**Status:** implemented and locally validated for `m15-intraday-v3.3` / strategy `1.1.3`; awaiting user publication/build/deployment. Read-only production inspection on September 11 verified the user's deployment of `33e0b76`, v3.2 / strategy 1.1.2. No Git publication, build, production activation or deployment has been performed in this pass.

## Observed behavior

The inspection found four local pricing declines on September 11. These were entry checks declining the quote before order submission. Later scans could still identify the same completed-candle setup, but the generator had already consumed that setup and suppressed it.

| Initial decision, AEST | Local decline | Later observation |
| --- | --- | --- |
| 02:45, GBP/USD SELL | Rechecked spread 1.3 pips exceeded the 1.2-pip limit | The 02:48 cached spread was 1.2 pips and the setup qualified again, but duplicate suppression prevented reconsideration |
| 04:00, GBP/USD SELL | Rechecked spread 1.3 pips exceeded the 1.2-pip limit | The 04:01 cached spread was 1.1 pips; the qualifying same-candle setup was suppressed |
| 09:30, USD/JPY BUY | Rechecked spread 1.3 pips exceeded the 1.2-pip limit | The 09:33 cached spread was 0.8 pips; the qualifying same-candle setup was suppressed |
| 10:05, AUD/USD SELL | Final cost check declined the quote, but the recorded generic error did not retain the actual quote values | At 10:06, 10:07 and 10:09, the cached 0.7-pip spread plus 0.2-pip expected slippage was 15% of the six-pip stop; the qualifying same-candle setup was suppressed |

The successful order in the inspected cohort was EUR/USD. This evidence explains rejected opportunities on the other pairs without establishing a pair-selection defect. A later qualifying cached quote does **not** prove that a fresh executable quote, the original movement bound, or the remaining entry checks would have passed. No missed fill or hypothetical profit is claimed.

The process restarted at 03:02 AEST. The three local declines after that restart appeared as six errors because two layers counted the same failure. That count excludes the 02:45 decline before restart; four cohort declines and six process errors describe different windows.

## Approved correction and justification

| Change | Justification | Required verification |
| --- | --- | --- |
| Give local spread, cost/stop and movement declines specific rejection codes and useful measured context | A policy declining its quote is an expected decision outcome; a generic submission error conceals what happened | Actual final-quote path records the local reason and measurements without claiming a broker submission |
| Keep expected local declines out of the unexpected-error count; count a real failure once | Current double counting exaggerates both frequency and severity | Engine handling of each recognized decline and one unexpected failure |
| Reconsider a still-valid setup after a recognized local pricing decline on the next regular scan | Consuming the setup before knowing the outcome prevented subsequent qualifying checks within the same candle | Generator → coordinator → engine → persisted decision, then the next existing scan |
| Preserve the first decision-price reference across reconsideration and restart | Replacing the reference with each new quote would move the existing 1.5-pip bound and permit chasing a price outside the original decision | Repeat/restart cases inside and outside the original bound; the original reference remains unchanged |
| Keep a durable distinction between confirmed local decline, submission, uncertainty and fill | A process restart or missing acknowledgement must not reopen a submitted or filled setup | Persisted replay eligibility and original reference; submitted/uncertain/filled outcomes remain suppressed |
| Preserve saved configuration and advance release identity | The orchestration change requires a separate live cohort, without changing the strategy's numerical experiment | Exact v3/v3.1/v3.2 migration equality, both enabled states, persistence and idempotent reload |
| Attach the engine before the first strategy scan, including delayed startup recovery | The previous boot order emitted and consumed the first setup before the engine subscribed; durable reconsideration would otherwise be lost on restart | Startup ordering and delayed attachment with a restored eligible setup |
| Count distinct emitted attempts in analytics while retaining completed-candle setup grouping | Reconsideration creates multiple attempts for one setup; collapsing those attempts would inflate decision coverage and mislabel them as suppressed duplicates | Rejection then fill yields two attempts, one strategy setup and 100% decision coverage; compact/full reads agree |

## Reconsideration contract

The only eligible local outcomes are `SPREAD_TOO_WIDE`, `COST_TO_STOP_TOO_HIGH` and `ENTRY_PRICE_DEVIATION`, confirmed to have happened before any order submission. The next existing regular scan may reevaluate the same completed-candle setup. The strategy must still qualify, and current entry checks run again. There is no extra timer, tight retry loop or promise of a subsequent fill.

The original decision-price reference and outcome remain in the existing durable decision records. Reconsideration cannot reset the reference on another attempt or after restart. Once submission has begun, its outcome is uncertain, or an order has filled, duplicate suppression remains in force. Risk, capacity, cooldown and other rejection types retain their existing treatment. Broker ownership, durable intents and reconciliation continue to decide whether submission is safe.

Migration 011 adds `entry_reference_price`, `can_reconsider` and `rejection_context` to `entry_decisions`. Historical references/context stay null and historical retry permission defaults to false. Each emitted attempt has a UUID used as its decision ID; run/config/setup identity groups related attempts. Recovery selects the latest inserted attempt, independently of wall-clock adjustments. A durable rejection must succeed before acknowledgement can rearm the exact current attempt; missing rows, failed writes and delayed acknowledgements cannot reopen a newer attempt. The existing 60-second action rate limit remains in force.

The rejection context records the check phase, actual quote measurements and applicable limits. Scalar spread/age fields reflect the rejecting check; their event-age meaning is unchanged. Unexpected local preparation errors use `ENTRY_PREPARATION_FAILED`, while `ORDER_SUBMIT_FAILED` remains reserved for a request that began. Neither outcome permits reconsideration. Existing historical errors and counters are not rewritten.

Analytics uses the new attempt identity to distinguish actual emissions from repeated copies of one event. Legacy rows retain their existing deduplication, and strategy-decision grouping still counts the completed-candle setup once. Compact dashboard reads extract only the attempt ID from saved signal context; full context remains excluded from that read path.

This corrects reconsideration after a rejected attempt. It does not alter the strategy's rules for a later completed candle or add a new rule for re-entry after a closed trade. Spread, expected slippage, cost/stop, movement, account-risk, position-size and position-count limits remain unchanged. Take profit, time stop, breakeven, loss cooldown, enabled intent and quote-timestamp meanings retain their existing contracts. No new authentication, operational email or health gate is introduced.

## Release and configuration

The new identities are `m15-intraday-v3.3`, `intraday-risk-v3.3` and strategy `1.1.3`. The pricing model remains `broker-liquidity-v3.1`; this correction does not change quote arithmetic or the numerical limit allowance introduced in v3.2.

Saved v3, v3.1 and v3.2 configurations upgrade through the narrow maintenance path, preserving all numerical settings, asset choices, operational preferences and enabled intent. Earlier releases retain their existing migration behavior. Historical trade/configuration ownership and active cooldown carryover remain intact.

## Validation and delivery

**713/713 backend tests passed across 39 suites on Node 20.20.2.** This includes 221 engine tests (28 new), 12 new complete scan-to-execution reconsideration cases, ordinary/delayed startup delivery, actual server/API/Socket.IO wiring, real SQLite migration and recovery, and 27 configuration/registry checks. The supported saved releases and both enabled states preserve exact nondefault configuration values. Whitespace checks pass.

Validation used disposable local persistence and mocked external operations. The orchestration tests exercise actual coordinator, completed-candle strategy evaluation, generator, engine queue, pricing normalization, sizing and broker-intent handling. Cases cover a pricing decline followed by a fill, a strategy HOLD before later recovery, unchanged rate limiting, original-bound rejection across restart, late acknowledgements, failed persistence, and pending/ambiguous/filled suppression. SQLite tests preserve historical rows and choose the latest inserted attempt even after a backward clock adjustment. Analytics tests retain two attempts and one strategy setup without inflated coverage. True preparation/broker failures still surface and count once. No live fill or profitability improvement is claimed before deployment and observation.

Publication, builds and deployment remain user-managed. The workflow stays local development and commits → GitHub → the existing single-command deployment, `./scripts/deploy.sh`. No production source edits, reverse synchronization, real orders, emails or uploads are part of this implementation or its tests. Existing enabled/paused state is preserved through deployment.
