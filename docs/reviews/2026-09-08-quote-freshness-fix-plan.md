# Quote freshness correction — approved plan and implementation record

**Status: deployed.** Read-only inspection on September 10 verified user-deployed `d46da61`, `m15-intraday-v3.1` / strategy `1.1.1`. The correction remains included in `5889b66` / v3.3, verified September 26; see the [current status and decision register](2026-09-26-status-and-decisions.md). The implementation and validation record below describes the September 8 local work, when production was still `8e4fb99`; its local-only delivery statements are historical. The user selected the full correction and required every change to be justified, validated and minimal. Publication, builds and deployment remain user-managed.

## Problem and evidence

September 6 changed the cached price `timestamp` from download time to OANDA price-event time. Existing consumers continued interpreting that field as recent availability: 15 seconds for entry/cache checks, 20 seconds for health, and 30 seconds for quote-dependent management/conversion. New final-quote and pre-submission checks also used event age. These are different measurements, and replacing their common input changed behaviour throughout the app.

At 07:31 AEST on September 8, read-only production observation found successful downloads every five seconds, broker responses in 211–218 ms, current candles/reconciliation and readiness PASS. The event-age warning moved from USD/JPY to AUD/USD and EUR/USD while polling continued successfully. At the last sample the oldest event was about 51 seconds old. This demonstrated the false health classification, not a measured OANDA outage.

An isolated reproduction through actual engine methods used a valid, tradeable quote with an event 25 seconds old and receipt now. Cached validation rejected it before requesting final pricing; a forced final GET with the same valid event was also rejected. At inspection, the current run's eight recorded decisions comprised four fills, two already-in-position rejections, one spread rejection and one broker-confirmed rejection/cancellation. There were no recorded age-based entry rejections. Potential execution impact and observed production impact must remain distinct.

OANDA defines `ClientPrice.time` as when the price was created. A successful full pricing request returns the requested instrument prices; it does not promise a newly created price event on each request. The response's top-level `time` is a cursor for the next `since` request, not a documented freshness guarantee. Sources: [price definitions](https://developer.oanda.com/rest-live-v20/pricing-df/) and [pricing endpoint](https://developer.oanda.com/rest-live-v20/pricing-ep/).

## Recommended scope and alternatives

**Recommend one cohesive correction of quote availability semantics across all affected consumers.** Preserve broker-event provenance, use confirmed delivery and elapsed request time for availability, and leave strategy parameters unchanged.

| Option | Result | Assessment |
| --- | --- | --- |
| Hide the banner | Removes noise; entry, management, conversion and deployment problems remain | Incomplete |
| Raise or remove age limits globally | Changes tolerance without correcting what is measured; may hide real delivery failures | Does not address the cause |
| Replace every timestamp with download time | Restores some old behaviour but corrupts event provenance, deduplication and historical comparisons | Avoid |
| Correct each consumer to use the appropriate clock | Addresses the cause while preserving bounded delivery and execution checks | Recommended |

Refreshing missing/expired caches on demand, moving the final GET earlier, switching to streaming, changing numerical thresholds, tuning 1.5R/six hours, and adding notifications are outside this correction. They can be discussed separately if needed.

## 1. Make the quote contract explicit

Keep `time` / `timestamp` and final `quoteTime` as OANDA event time. Keep `fetchedAt` as receipt time and add request-start timing where needed. A receipt is usable only when the requested instrument was actually returned and the quote passed validation. Use a small shared quote-availability helper so health, execution and conversion do not invent different meanings for the same fields.

- Preserve ordinary bid/ask validation, instrument matching, existing timestamp parsing/future-time checks, tradeability and executable liquidity checks. Old or repeated event time alone is not a failure.
- Continue requesting full prices without `since`; no new API mode is needed.
- Track the most recent response outcome for each requested instrument. A missing instrument, malformed response or invalid quote must not refresh its last valid receipt or leave an older executable quote silently eligible. Last-good display values may remain only if marked unavailable.
- A valid `tradeable: false` response confirms communication but disallows execution for that instrument. Treat it as broker market state rather than a transport outage; retain market-calendar handling.
- Retain the existing request timeout. Include body receipt/validation in request completion; a late response cannot become fresh simply because it was finally parsed. Measure local elapsed time consistently, with monotonic timing for active request deadlines where available.
- Missing timing metadata cannot default to “now.” Restart must obtain fresh observations; persisted broker event times cannot substitute for current delivery.

Do not introduce another undocumented rule, such as requiring cross-request event timestamps to increase monotonically or treating the response cursor as a delivery SLA. Record event-time anomalies as evidence before deciding on additional policy.

## 2. Correct entry validation and final submission

Keep the current sequence: completed M15/H1 setup and cached context → initial checks → broker/account reconciliation and sizing → dedicated final pricing GET → final execution/risk checks → bounded order submission.

The cached gate will measure age since the last **validated receipt**, using the existing 15-second setting. A genuinely missing, invalid or expired cache can still stop entry before the final GET. This preserves the existing workflow; the fix does not create additional refresh/retry paths.

The final GET will retain event time for evidence and record request start and validated receipt separately. Use the existing 15-second execution budget for elapsed time from that request's start through order submission, alongside the existing request timeout. An unchanged broker event is acceptable; a request/preparation that actually took too long is not. Recheck immediately before `placeMarketOrder`, including time spent on account/risk checks and durable intent writes. Expiry produces an explicit local pre-submit rejection, no broker order, and a resolved intent rather than an ambiguous outstanding submission.

Keep tradeability, requested-unit liquidity, spread/cost limits, movement from the original signal reference, price bounds, worst-fill sizing, account risk, paused-entry cancellation, completed-candle freshness and lifecycle reconciliation intact. The final quote remains a snapshot, not a guaranteed fill: the existing broker price bound and fill reconciliation still handle execution movement. This plan does not expand allowed slippage.

## 3. Correct management, conversions and measurements

Breakeven and trailing calculations will use the age of the validated receipt, retaining the existing 30-second management limit. A current response confirming an unchanged price can support management. A failed/stalled or invalid observation still cannot authorize a quote-dependent adjustment. Trailing remains disabled; breakeven remains at 1R. Timed exits, broker close retries and pending protection retries retain their paths independent of quote availability. Existing broker stops and targets remain active.

AUD conversion fallback quotes currently consume the same event timestamp. Use validated receipt time there too, retaining the existing conversion lifetime and native OANDA `homeConversions` path. Reading/caching a conversion must not refresh the source observation's age, and missing conversions must not become 1:1 rates. Carry the final quote's actual timing into conversion snapshots rather than stamping it with the time a conversion calculation runs.

Keep event time as the identity of sampled price excursions. A newly received repeat of the same event must not inflate observation counts, fabricate post-entry observations or rewrite first/last event times. Receipt freshness governs usability; event identity governs deduplication. Post-exit price tracking is not added.

Existing historical `priceAgeMs`, `quoteTime` and related averages must retain their recorded meanings. Add explicitly named delivery/request-age fields to the existing supported JSON context/intent telemetry where possible; do not reinterpret old database columns. If the existing schema cannot carry this evidence, document a narrowly scoped migration before implementation rather than losing attribution.

## 4. Correct dashboard, API and deployment health

During scheduled market hours, health will assess whether valid pricing responses for the requested instruments have arrived within the existing 20-second delivery budget. Preserve the five-second poll cadence. This is an application availability budget, not a requirement that OANDA prices change every 20 seconds, nor a claim that 20 seconds is an empirically optimal timeout.

Repeated, old-but-valid events received successfully will remain healthy. Actual missing/invalid instrument data or expired delivery will identify the affected pair and the observed problem. Event age may appear as neutral detail, separate from receipt age. Use the existing banner/details surface; no new email, sound, notification option or alert subsystem.

Stop deriving a claim that all entries are blocked merely from any health issue. Keep the operational summary distinct from the actual global entry gates and per-instrument availability. Broker uncertainty, protection failures, runtime stalls, stale completed candles and real connection failures remain visible and continue their established execution protections.

Normalize the cached and broker-fallback `/prices` responses to the same quote/timing contract; the cached path currently uses event age and the fallback omits fields present in socket/cache messages. Preserve existing socket fields and pass through the additional receipt evidence without redesigning the connection.

The deployment health script currently fails when this false warning degrades operational status. Keep its strict health requirement; prove that normal repeated prices pass and genuine delivery failures fail. Do not bypass health checks or add manual deployment steps.

## Impact map

| Area | Source to review/change after approval | Expected impact |
| --- | --- | --- |
| Pricing ingestion/availability | `backend/src/services/OandaDataService.js`; small shared quote helper | Separates event identity from validated delivery; handles omitted/invalid responses |
| Entry/order placement | `LiveTradingEngine.validateEntry`, `getFinalEntryQuote`, final pre-submit check | Removes event-age vetoes; preserves bounded observation-to-order time and all price/risk checks |
| Management/telemetry | `checkPosition`, `_recordSampledExcursion`, `buildDecisionContext`, entry telemetry | Restores valid management checks without fabricating samples or relabelling history |
| Conversion | `backend/src/runtime/currencyConversion.js`; engine conversion snapshot | Uses actual receipt age without extending cache life |
| API/UI/health | `tradingRoutes.js`, `operationalHealthService.js`, `MarketStatusBanner.jsx`, price consumers | Accurate banner, consistent API/socket metadata and entry-state wording |
| Deployment | Health/deployment regression fixtures | Quiet prices no longer fail deployment health; actual failures still do |
| Release/history | Configuration upgrade and runtime identity paths | Identifies changed execution behaviour while preserving settings and prior cohorts |

## 5. Prove the correction through the real paths

Start with broker-shaped fixtures reproducing the observed case: five-second successful responses containing a 45–60-second-old event. Test both successful operation and actual failures through data parsing, signal/entry orchestration, mocked broker placement, position management and API health.

Acceptance requires:

1. Healthy repeated prices produce no operational warning and allow an otherwise eligible entry to reach its final GET and mocked order placement.
2. A recent valid final response with an old event passes; a timed-out response, delayed body or preparation beyond the execution budget places no order and leaves no unresolved local intent.
3. Missing instruments, malformed/crossed bid/ask, invalid timestamps and nontradeable responses cannot revive a previously executable quote. Other instruments do not refresh the missing pair's age.
4. Stopped polling eventually produces a real delivery warning; recovery follows new validated data. Planned closures and valid nontradeable states remain distinguishable from transport failures.
5. Breakeven still runs for a recent valid receipt with an old event, and defers for genuinely unavailable data. Broker protection, timed exits and retry behaviour remain intact.
6. Repeated/pre-entry events do not create extra excursion samples. Conversion source ages and historical diagnostic meanings remain intact.
7. Fresh HTTP delivery with stale completed M15/H1 candles still rejects entry. Existing spread, cost, deviation, liquidity, risk and duplicate-order controls remain covered.
8. Cache/API fallback/socket fields agree. Real `/system/health` and deployment-health fixtures accept normal delivery and reject real failures. Operational emails stay absent.

The existing test asserting that a recent download cannot make an old event “fresh” must be split into two assertions: the event remains old, while confirmed delivery is current. Tests must express the corrected contract, not merely repeat the old assumption. After focused regressions, run the backend suite and relevant frontend/health/deployment checks with mocked external services. No test orders, real mail or fault injection on production.

## Release and review boundary

This corrects execution eligibility and management, so it needs the repository's required release/strategy identity update and an explicit execution/pricing policy identity. That may start a new analytics cohort; previous trades and runs must remain available. Existing open positions retain their original exit rules and ownership.

There is a specific upgrade hazard: `configService.load()` currently resets most settings to defaults on a release-version change. The implementation must include a narrow, tested upgrade that preserves the current strategy, risk and exit settings while updating the policy identity. Test with deliberately nondefault settings to prove no incidental retuning. This is necessary to deliver the correction safely, not permission for a general configuration redesign.

After review, the user publishes and deploys with the existing single command: `./scripts/deploy.sh`. Verify receipt/event separation, healthy quiet-market polling and retained settings after deployment. No rollback should rewrite trade history or silently restore the defective semantics; any rollback uses the existing reviewed deployment/recovery workflow.

**Decision recorded:** the user approved the full correction on September 8. The implementation must preserve the agreed scope and numerical settings. Local validation does not establish that the budgets maximize trading performance or that production is already fixed.


## Implementation record — September 8

The full correction is implemented locally. The changes below repair quote availability and its direct consumers; entry indicators, numerical time budgets, risk limits, exits and polling cadence retain their existing values. No dependency or database-schema change was needed.

| Change | Why it is necessary | Validation |
| --- | --- | --- |
| Small shared `runtime/quoteAvailability.js` contract, used by ingestion, entry, management, conversion and `/prices` | Avoids repeating the original field-meaning mismatch; supports the existing ISO and UNIX response formats without requiring event timestamps to advance | Old/repeated events pass; missing, malformed, crossed, future-time, nontradeable and missing-receipt cases exercise the real consumers |
| Each requested pricing row receives a validated receipt or an explicit unavailable outcome | A successful response for another instrument must not revive a missing/duplicate/invalid pair; a failed poll cannot silently expose its last executable value | Partial and malformed responses, request failure/recovery, valid nontradeable state, requested AUD/USD conversion bridge outside trading assets |
| Existing abort deadlines also check elapsed time after body completion in data, route and OANDA client reads | A body that resolves late or a delayed timer callback must not make a late response appear fresh | Hung fetch/body, late headers/body, blocked-clock completion; mutating timeouts retain ambiguous-outcome reconciliation |
| Cached entry uses validated receipt; final quote uses monotonic request-start-to-submit elapsed time | Keeps the 15-second budgets while accepting unchanged current quotes; covers account preparation and durable writes before broker submission | Full signal-to-order success with a 60-second-old event; expiry at pricing, account preparation, intent creation and submission-state write; wall-clock rollback; no orders and resolved local intents |
| Quote-dependent management uses receipt age and rereads the latest cache after awaited work | A poll can fail while an excursion write or protection retry is awaited; retaining the old object would bypass its newly unavailable outcome | Breakeven with old event/current receipt, latest failure during retry, deferred adjustment on unavailable quotes, time exit/protection retry without prices |
| Conversion fallback requires canonical quote metadata; native factors retain actual receipt time | Removes fabricated `Date.now()` timing and untimed reference-price/cache bypasses while preserving executable-price conversion math and native OANDA factors | USD/JPY AUD bridge, invalid latest observations, repeated reads do not extend either quote or home-factor lifetime; missing provider timestamps cannot become fresh on a second read |
| Health/API/banner distinguish delivery, broker event and nontradeable state | Healthy polling must not warn just because prices have not changed; a pair-specific warning must not claim every entry is globally blocked | Real DataService → health route and `/prices` paths; live server API/socket parity; strict health-script healthy/failed-delivery fixtures |
| Narrow v3 → v3.1 config upgrade; identities `intraday-risk-v3.1`, `broker-liquidity-v3`, strategy `1.1.1` | This execution change needs a separate cohort without resetting saved strategy/risk/exit parameters | Exact preservation of deliberately nondefault settings, durable/idempotent reload, one new cohort, unchanged prior run/config/hash and managed-trade ownership |

`timestamp`, `time`, `quoteTime`, `quoteAgeMs` and the historical decision `priceAgeMs` retain broker-event meaning. Intent JSON adds `cachedPriceObservation` and final quote `requestStartedAt`, `fetchedAt`, `requestElapsedMs`; trade `liveRuntime.entryTelemetry` adds named receipt/request fields. The monotonic start is process-local and non-enumerable, so it is never persisted as a reusable timestamp. The decision table has no general JSON context field; receipt evidence belongs in the existing intent/trade payloads rather than misusing configuration snapshots or adding a schema migration. Decisions rejected before intent creation still have their explicit reason and original event-age metric.

Pricing health covers every requested instrument, including the AUD/USD conversion bridge when it is outside configured trading assets. Completed-candle requirements still follow trading assets. Valid nontradeable pricing confirms communication and is shown as instrument availability detail; it cannot authorize entry or a quote-dependent stop adjustment. Actual latest-request failure immediately marks that observation unavailable; stopped delivery expires by the existing age budgets. Neither path sends an operational email.

The unrelated legacy engine `getMidPrice`/broker conversion read path has no dependency on cached event-age semantics and was not redesigned. Native broker protection, six-hour and rollover exits, close/protection retries, slippage bounds, liquidity and risk checks remain. The dashboard's `WATCHING` state indicates an enabled global runtime, not approval of every instrument's eventual entry checks.

## Final validation and delivery

Final verification on Node 20.20.2:

- **576/576 backend tests pass across 35 suites** (baseline 511/34), including 150 engine tests and the new pricing/health route suite. The real server API/Socket.IO regression verifies identical quote timing fields without login. Existing strategy, risk, lifecycle, ownership, analytics and operational-email-removal regressions remain green.
- **26 deployment/startup/maintenance tests**, **19 strict health-script scenarios** and **4 frontend refresh-contract scenarios** pass. The health script itself was not relaxed.
- **All 27 frontend JavaScript/JSX files parse**; whitespace checks pass. The earlier failing integration fixture was corrected to expect the requested AUD/USD conversion bridge among failed pricing rows, then the complete suite passed.

Tests use isolated mocks, disposable databases and loopback sockets; they make no live orders or real email/storage calls. Cross-review covered release/config migration, OANDA response completion, conversion receipt provenance, management during concurrent polling and health/engine agreement. The production instance was not modified in this implementation pass. The last read-only production verification remains revision `8e4fb99`. No frontend/production build or visual acceptance of a built release was performed under the user-managed build boundary.

After user publication, the deployment command remains `./scripts/deploy.sh`. There are no additional manual deployment steps. Frontend/production builds, publication and deployment remain user-managed. A post-deployment observation should verify the new identity, retained settings and normal quiet-price delivery; local regressions cannot establish live profitability or measured improvements in returns.
