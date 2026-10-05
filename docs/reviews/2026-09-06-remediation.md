# September 6 remediation register

## October 6 measurement correction — implementation underway

The user requested implementation and deployment of the profitability plan. [A1–A3](2026-10-06-analytics-measurement-release.md) correct persisted entry attribution, bootstrap availability and observed expectancy without changing v5 trading behaviour or risk. Targeted integration tests pass; full validation and delivery are recorded separately in the release record. Offline research is authorized under the plan; a complete portfolio replay and selected live strategy change remain pending.

## October 1 SELL candidate — deployed

The user approved the new SELL candidate for live OANDA trading and explicitly authorized deployment. [v5 / strategy 1.3.0](2026-10-01-sell-retest-release.md) requires distinct break/retest/rejection candles, ask-based structural stops and durable pattern evidence. It disables SELL fades that would bypass the candidate, preserves BUY logic and numerical risk, and records a distinct analytics class. The release is deployed at clean `73cf4b5`, enabled and healthy, with 1,004 backend tests passing locally and during deployment. The release record retains validation and live verification separately. The earlier research-only and chart-local statements below describe their original checkpoints.

## October 1 SELL entry and exit study — research complete

The user requested examination of recent SELL setups, exit conditions and wider stops. The [dated study](2026-10-01-sell-entry-and-exit-study.md) reconciles 29 September SELL trades with OANDA and examines all 13 since the prior review cutoff, including winning controls. Wider initial stops rescue some losses on the retained quote paths, but scaling target/breakeven as well creates new losses; earlier controls and later-entry capacity conflicts prevent a blanket strategy-return claim. Verification covers 102,732 S5 candles, 29 matching baseline exit classifications, 928 scenario calculations and independent sizing/aggregate checks. Exact historical broker fills/timing are not reproduced. No trading behavior, cash-risk limits, orders or deployment changed; the separate chart correction below remains local. Research is not approval to tune the strategy.

## October 1 chart correction — deployed with v5

User-approved correction of the [demonstrated chart defect](2026-10-01-audusd-sell-loss.md): completed candles and their EMA/SuperTrend values remain unchanged by quote updates; the latest midpoint appears separately at broker event time on a numeric time axis. Completed closes use explicit display-only end times, and historical tooltips expose the original high/low. Obsolete candle responses cannot overwrite a new selection or newer poll. The [implementation record](2026-10-01-chart-correction.md) tracks targeted regression/browser checks and delivery. SELL entry setups, backend timestamp contracts, strategy and risk remain unchanged. Publication/build/deployment of this chart correction completed with v5 at `73cf4b5`.

## September 28 checkpoint — deployed v4, local v4.1

Read-only inspection verified clean user-deployed `aed750f27cd0ed24219b2965c443ba45ac05499a`, **m15-intraday-v4 / strategy 1.2.0 / intraday-risk-v4**. Dashboard/API and OANDA were online, prices/candles fresh, entries enabled, account flat and repeated readiness checks passing. Active run: `live_3c068476-9fad-4079-bb82-c24889350374`; config: `49808daa3caffd0405c4`; no v4 fills at the 14:35–14:37 AEST snapshot. S3 uploads remained unconfigured. Earlier pending-v4-deployment statements below describe the September 26 checkpoint and are superseded by this observation.

The user then explicitly requested removal of the global position-count cap so valid setups on different pairs may enter concurrently. The [September 28 release record](2026-09-28-pair-capacity-release.md) specifies local **m15-intraday-v4.1 / strategy 1.2.1 / intraday-risk-v4.1**: one position per pair, no account-wide count cap, and unchanged per-trade sizing, portfolio/margin/loss limits, broker safety and strategy rules. The retired setting is removed from active configuration/readiness; API/UI report the explicit per-pair policy. Saved settings/enabled intent survive except that field; historical snapshots, active cooldown expiry and prior ownership remain intact.

**V4.1 is implemented and locally validated; it is not deployed.** Latest passing results cover 850 tests across 41 backend suites, assembled from the full run and targeted reruns, plus changed JSX syntax checks. The release record links the retained validation evidence. The 0.5%-of-NAV aggregate stop-risk limit remains unchanged and can still reject additional full-risk pairs. Publication, builds and rollout remain user-managed through the normal GitHub-to-bot deployment. No production mutation or test orders occurred during this work.

| Decision / finding | Current state | Remaining work |
| --- | --- | --- |
| V4 integrated rules and precision/RSI changes | Deployment verified September 28; original local validation was 834 tests across 41 backend suites | Review natural live trades and fade episodes; no established positive expectancy |
| Global position cap | Explicit user decision removes it in local v4.1; same-pair exclusion and all existing portfolio/risk limits remain | Local validation complete; user-managed publication/build/deployment and live observation remain |
| System tab capacity display | Deployed “Max: 2” is an inaccurate fallback; actual v4 cap is one | V4.1 reports “one per pair” with matching API policy |
| Reporting/recovery/delivery | S3 unconfigured; independent restore and email-delivery checks still outstanding | Separate operational follow-ups; no new destination or notification selected |

## September 26 record (historical checkpoint)

Status as of **September 26: deployed revision `5889b66` verified by read-only production inspection**, including the [rejection/reconsideration correction](2026-09-11-entry-rejection-and-reconsideration.md) and [excursion measurement correction](2026-09-21-excursion-measurement-correction.md). All ten newly closed trades have verified v2 excursion records without legacy aggregates. Trading remains `m15-intraday-v3.3` / strategy `1.1.3`, run `live_a8458577-5451-4c6b-ae9b-adfe95d2fcf3`, with unchanged entry, exit and risk settings. The [September 26 review](2026-09-26-follow-up-trading-review.md) and [current status and decisions](2026-09-26-status-and-decisions.md) supersede earlier pending-deployment and candidate-priority statements. Earlier implementation/deployment statements below describe their recorded point in time. Authorized by the user after the [production review](2026-09-06-production-review.md). Baseline commit `bee8527`; baseline deployed release `m15-intraday-v2` / strategy `intraday_momentum` `1.0.0`.

Local status subsequently changed: the user authorized the [integrated v4 specification and implementation](2026-09-26-integrated-release-specification.md). The package is implemented locally with 834 tests across 41 backend suites passing; **no publication or deployment has occurred**. The production observation above remains unchanged. The new dated record below supersedes the earlier recommendations, not the historical performance evidence.

## September 26 — Integrated release (local)

| Finding / decision | Implemented change and rationale | Verification / remaining work |
| --- | --- | --- |
| Entry weakness extends beyond quick repeats | Ordinary pullbacks use each prior bar's EMA20/EMA50 and clear the structure from the latest touch, retaining the prior-two-bar minimum and independent breakout branch | Structural and healthy counterexamples tested; full integrated acceptance in the [specification](2026-09-26-integrated-release-specification.md). Five excluded actual fills net +A$0.0315 including two winners; no proven improvement. |
| Repeated protected-exit exposure and user-requested fade experiment | All-trigger fresh-post-exit continuation; one opposite-direction fade after normal TP without freshness; after BE wait; retain the parent TP and consumed state through restart and prevent recursive fades | Four conditional fade paths: two targets/two stops, including an original loser that also loses when faded. Real orchestration/episode/retry validation is part of integrated acceptance. |
| Broker formatting expands permitted bound after sizing | Normalize prices before sizing/validation/persistence and round adverse bounds inward; preserve movement and cash-risk limits | Engine/client precision checks cover both directions and instrument precision. Actual reviewed fills stayed within budget. |
| Existing scalar RSI missing despite computed entry RSI | Populate existing scalar RSI and preserve null when unknown; retain revised/legacy triggers, original/executed direction and parent-exit evidence in existing metadata | Persistence and integrated signal checks; no new reporting dashboard or notifications. |

Local release is **m15-intraday-v4 / strategy 1.2.0 / intraday-risk-v4**. The 1.5R target, stops, +1R breakeven, time/session exits, 0.25% risk ceiling, A$100 sizing-capital cap and one position remain. Saved settings/enabled intent, active cooldown deadlines and historical ownership are retained. Local validation passed: 834 tests across 41 backend suites; the changed analytics JSX also passed syntax validation; the specification owns the final test counts and acceptance record. S3 destination choice, independent recovery drill and email-delivery verification remain separate open operational work.

## Decisions and boundaries

- **September 26 review checkpoint, before subsequent implementation approval:** the next ten trades lost **A$0.5369**; the unchanged v3.3 run now totals **25 trades / −A$1.2693**. Recommend retaining 1.5R: the prespecified 2R sensitivity did not improve this batch. Prioritize the specified fresh post-exit pullback candidate for local implementation/validation, then investigate pullback entry quality. At that review checkpoint these were recommendations, not an approved or implemented new live default; earlier winning counterexamples and changed portfolio/cooldown paths remain relevant. No increased capital or risk is supported. See the [current decision record](2026-09-26-status-and-decisions.md).
- **September 26 execution-defect discovery, before subsequent local correction:** broker price serialization can slightly expand permitted worst-case risk beyond the saved budget; production parameters and source tracing establish the sizing/serialization mismatch, and the isolated real-client serializer reproduces the rounding expansion. All ten actual fills remained within their budgets. An execution fix should size/validate against the exact serialized prices and preserve existing limits. It was not implemented at the review checkpoint and has since been corrected in local v4 above; it does not explain the observed negative expectancy.
- **September 21 follow-up approved:** after the eight-day review the user requested the measurement bug first, then target evaluation and re-entry rule work. Version 2 stores reversible observations, separates authoritative broker close time from accounting fallback and excludes legacy/unverified values from verified averages. A retained 25-trade study specifies the target/re-entry candidates and counterexamples; this study includes earlier releases and is distinct from the 25-trade v3.3 cohort now reviewed. The implementation record preserves local validation and September 21 delivery status; September 26 inspection confirms deployment and live v2 operation.
- **September 11 correction approved:** production v3.2 at `33e0b76` was verified read-only. The user approved [specific local rejection reporting and same-candle reconsideration](2026-09-11-entry-rejection-and-reconsideration.md) for v3.3, preserving original decision-price bounds, durable submission safety and every numerical setting. Local validation passed: 713 backend tests in 39 suites. Rollout was pending at that implementation checkpoint and was subsequently verified at `5c250a7` on September 21.
- **September 8 correction approved:** the user selected the full [quote-freshness correction](2026-09-08-quote-freshness-fix-plan.md). Local v3.1 / strategy 1.1.1 fixes validated receipt semantics across health, entry, management, conversions and API/deployment checks; the narrow upgrade preserves saved parameters and prior cohorts. Publication/build/deployment remain user-managed. The linked record captures each change, rationale and validation. This supersedes M1/M3 event-age availability interpretations below; completed-candle freshness remains required.
- Implement operational, execution, security, measurement and recovery corrections from the review. Preserve the single live strategy and historical broker records.
- At the September 6/26 checkpoint, retain 0.25% risk ceiling, A$100 sizing-capital cap and one position. The explicit September 28 decision above supersedes the global count constraint only; no funding, other risk-limit change, ADX/RSI/trigger tuning or retrospective pair selection is authorized.
- September 6 corrected local cohort: `m15-intraday-v3`, `intraday-risk-v3`, strategy `1.1.0`. This historical version change identifies corrected execution/exits, not a claimed profitable strategy; the current identity is recorded above.
- No production mutation, test orders, Git publication, build or deployment occurred in the September 6 implementation pass. Its user-managed rollout was a separate step; later deployment observations are recorded above and in the dated follow-ups below.
- **September 7 user correction:** this is a private personal tool on the user's internal network. Remove the operator login/token requirement throughout the app and maintenance. This supersedes the original authentication implementation; retain broker credentials and trading risk/readiness checks.
- **September 7 notification correction:** remove the newly introduced operational warning/recovery emails. Preserve existing trade emails and keep operational health in the dashboard/API. The trade-email setting does not authorize new notification categories.

## Funding decision and justification

More balance scales dollar outcomes only if sizing increases; it does not improve expected return per unit of risk. Current flat-account sizing is `0.0025 × min(0.8 × available margin, A$100)`. A$96.76 implies about A$0.194 risk, A$125 implies A$0.25, and A$1,000 still implies A$0.25 under the cap. The observed 76–351-unit trades, zero commissions and absence of size/margin rejections do not establish a material small-account disadvantage. Integer rounding is at most roughly 1.3% of the smallest observed position. Correct quote selection and timed exits before attributing weak results to account size. Any later scaling decision requires a clean, larger live sample and separately agreed drawdown/capital limits.

## Accepted changes and acceptance evidence

This table retains the original implementation milestones except where a later dated verification is stated. The current deployed revision and open follow-up work are recorded above; “locally verified” here does not imply those original changes still await deployment.

| ID | Change and justification | Required verification | Status |
| --- | --- | --- | --- |
| F1 | Wire owner-run six-hour/rollover exits; a broker-verified position lasted 11h57 and paid financing | Real monitor path, pause/restart, missing prices, DST and rollover-entry conflicts | Deployed; live six-hour Time Stop observed September 8 |
| F2 | Use normal liquidity-sized entry bids/asks; closeout prices caused false movement comparisons and distorted initial protection | Divergent closeout/ordinary quotes, liquidity, price bounds, fill alignment, explicit pre-submit rejection | Implemented; locally verified |
| F3 | Reconcile while locally flat and block account-wide uncertain/pending/quarantined exposure | Lost fill response then next queued pair, restart, unknown broker trades | Implemented; locally verified |
| F4 | Confirm broker protection/units; retry initial SL and TP independently of monotonic tightening | Equal/favorable fill, failed alignment, missing/changed broker stops, partial units | Implemented; locally verified |
| F5 | Original operator authentication proposal superseded by the user: private-network tool with direct dashboard/API/socket access | No-login server/socket and startup/maintenance regressions; preserve trading checks | Login removed locally on September 7 |
| F6 | Durable atomic pause and cancellation of in-flight/queued entry work | Filesystem failure, restart state, pause during async validation | Implemented; locally verified |
| F7 | Restore safely with preserved/separately recovered credentials and validated data, paused | Isolated restore, invalid archives/snapshots, credentials, no live orders, failure recovery | Implemented; locally verified |
| M1 | Separate broker/candle event time from fetch time and enforce actual completed-bar freshness | Weekend/reopen, daily break, stale H1/M15, malformed times | Implemented; locally verified |
| M2 | Bound data requests and release in-flight flags on timeout | Hung request abort then successful polling | Implemented; locally verified |
| M3 | Recheck final quote spread/cost/age; null or missing spread fails closed | Spread widening and malformed quote inputs at submission | Implemented; locally verified |
| M4 | Dashboard/API health includes lifecycle obligations, uncertain exposure and service freshness; operational emails withdrawn following user feedback | Healthy process with stale data/overdue exits fails readiness; health changes send no emails; existing trade mail retained | Health and email removal deployed at `8e4fb99` |
| M5 | Remove API-editable release-freeze bypass | Attempts to disable freeze/change protected fields are rejected | Implemented; locally verified |
| M6 | Correct positive broker-fee signs and cumulative financing | Broker-shaped commission/fee payloads and full-close finance | Implemented; locally verified |
| M7 | Correct net AUD/R and actual session/trigger-overlap cohorts | Net-negative price-positive trade; DST and overlapping sessions | Implemented; locally verified |
| M8 | Correct dashboard performance/refresh state and remove unsupported ADX conclusions | Backend/frontend data contracts, sample/uncertainty, failed reads | Implemented; locally verified |
| M9 | Align current-release/all-live/historical and entry/realized-period scopes; expose entry/rejection counts with honest stage coverage | Historical-run filter, closed-at boundaries, UI/export parity | Implemented; locally verified |
| M10 | Persist report successes, immutable interval identity and retries; expose disabled reporting | Failed upload/retry/restart/date boundaries | Implemented; locally verified |
| M11 | Update affected dependency lockfile without unrelated upgrades | Production audit and full regression suite | Implemented; locally verified |
| M12 | Replace stale current instructions, preserve archive and document actual deployment state | Current docs agree and review/register remain traceable | Implemented; locally verified |
| M13 | Document midpoint breakeven/pullback semantics and correct executable-price protection inputs | Bid/ask breakeven behavior, production-default/pullback fixtures | Implemented; locally verified |
| M14 | Capture initial risk, fills/costs, executable excursions, sessions, trigger overlap, rejection obligations consistently | Restart-safe telemetry and analytics across prior/current records | Excursion-lifetime correction deployed at `5889b66`, verified September 26 on ten closed v2 trades; legacy history remains unverified |
| O1 | Document database free-page maintenance and independent recovery; avoid automatic production compaction | Safe maintenance procedure, backup validation | Runbook complete; production maintenance/drill not performed |

## Validation record

Baseline: 313 tests passed; 47 database tests could not initialize because local native SQLite binding was absent. Backup regression script passed. Production M15 closes matched OANDA and latest immutable backup quick_check passed. Baseline green helper tests did not prove live timed exits were connected. Final checks below exercise the actual management paths and failure cases.

Final local validation (September 6):

- **500/500 backend tests passed across 32 suites**, using Node 20.20.2 and the exact updated lockfile. SQLite repository tests ran against the existing 9.6.0 package's official Node20 prebuilt binary; no native compilation or production build was run. Relevant mocked execution/data/auth suites also passed on Node22.
- **7 backup scenarios**, **8 operational-health shell scenarios**, and **15 restore/credential/preflight tests** passed in isolated temporary fixtures. No real PM2, npm build, deployment or broker action occurred in those script tests.
- **4 frontend refresh contract scenarios** passed against the actual source: obsolete request exclusion, partial failure retaining last-good data, catalog retention and read deadline. Runner: `scripts/tests/frontend_refresh_contract.test.cjs`.
- Modified backend JavaScript, shell/Python scripts and JSON passed syntax checks; modified frontend JSX/JavaScript passed Babel parsing. Relative CommonJS imports were checked against exact filesystem names to avoid macOS/Linux casing differences. `git diff --check` passed.
- Backend full dependency audit: **0 reported vulnerabilities** after installing the updated lockfile with lifecycle scripts disabled. Frontend production audit: **0 reported vulnerabilities**. Audit results are point-in-time, not a permanent security guarantee.
- Frontend production build, visual/browser acceptance, production deployment, real recovery drill, email delivery and S3 delivery were **not performed**. These remain explicit operator verification steps under repository instructions; successful local tests do not claim live profitability or production completion.

Reproduce the backend and script checks using supported Node20–22 with a matching installed SQLite binding:

```bash
cd backend
npm test -- --runInBand
cd ..
bash scripts/tests/backup_test.sh
bash scripts/tests/health_check_test.sh
python3 scripts/tests/restore_test.py
node scripts/tests/frontend_refresh_contract.test.cjs
```

## Implementation checkpoints

1. Preserve audit and decisions; correct current instructions and register all work.
2. Implement execution/data/auth foundations with lifecycle regression tests.
3. Integrate operator health, analytics, reports, recovery and telemetry; update release/user/deployment docs.
4. Run full isolated regression and relevant checks; document the one-command user-managed deployment and rollback prerequisites. Mark production unchanged until independently verified after a later rollout.

## Implementation detail and deliberate behavior

### Execution, ownership and risk (F1–F4, F6, M1–M3, M6, M13–M14)

`LiveTradingEngine`, `Oandaclient`, `tradeReconciliationService`, `OandaDataService`, `marketContextService`, `runtimeCoordinator` and `marketDataFreshness` now enforce these boundaries:

- Account reconciliation, entries, manual closes, retries and protective-order changes share a lifecycle queue. Flat local state still triggers broker reconciliation. Prepared/ambiguous/recoverable intents and quarantined broker exposure block entries across every pair.
- Timed exits use the opening run's policy and are checked by the actual position monitor before requiring a market-price cache. Pausing entries does not disable management. Broker closure availability still limits an exit attempt; failed obligations stay observable and retryable.
- Opening prices use ordinary bid/ask liquidity sized for the requested units. Closeout prices are excluded. Final quote timestamp, tradeability, spread/cost and permissible movement are checked again before sending an order. Broker price bounds constrain execution; an order rejected before submission is distinguished from an ambiguous broker request.
- Every entry records original risk, executable quote/fill information, sessions and raw strategy context. Broker stop/target state is confirmed and repaired. A known managed position with changed broker units is closed rather than silently adopting unplanned exposure. If required protection remains unconfirmed, the engine attempts an emergency close. Unknown broker positions remain quarantined for operator review; they are not automatically closed.
- A configuration generation invalidates queued/in-flight entries after pause or configuration changes. The final activation check occurs immediately before broker submission. Orders already accepted by the broker remain reconciliation obligations.
- Cumulative broker close records include all financing and positive commission/guaranteed-execution charges with the correct sign. Partial close effects are not mistaken for a complete trade close.
- Quote age means the broker's event timestamp. Completed M15/H1 age means the actual bar time, with a bounded 90-second publication grace and the broker's New York daily/weekend schedule. Freshly downloaded stale candles remain stale. HTTP request/body timeouts release polling flags.
- Original ATR/RSI/ADX/EMA/pullback thresholds and midpoint-based breakeven trigger semantics remain unchanged. Production-default long/short breakout and pullback fixtures establish that these paths are reachable. At that checkpoint, per-bar historical EMA semantics remained a future experiment; the September 26 integrated release subsequently implements it in a distinct local cohort.

Telemetry schema for new trades uses `brokerReconciliationPayload.liveRuntime.initialRiskAud` and `.liveRuntime.entryTelemetry` (`requestedPrice`, `executablePrice`, `worstPrice`, `quoteTime`, `units`, `finalSpreadPips`, `entrySlippagePips`, `sessions`, `strategyContext`). `.sampledExcursion` stores executable-side sampled MFE/MAE, R values, observation count and timestamps. These are polling observations, not tick-exact excursions; historical coverage is explicitly unknown. Existing retained order-intent context is joined read-only for earlier trigger/session evidence.

### Access, health and recovery (F5, F7, M4–M5, O1)

The initial authentication service, middleware and browser token gate were removed at the user's explicit request on September 7. The app is a private internal-network tool; dashboard, API and live updates open directly. Release freeze cannot be disabled through the API. Configuration saves flush a same-directory temporary file, rename it, and flush the directory before updating memory or emitting success. Any persistence failure forces an in-memory pause, invalidates pending entries and exposes a critical persistence fault. It does not acknowledge a durable pause: restart may reload the prior on-disk state. Activation is blocked until a paused configuration is saved successfully.

Operational health checks service/event freshness, broker uncertainty, unresolved intents, protection, monitoring and overdue closes. The dashboard uses this backend market/session calendar instead of a second hardcoded UTC schedule. The original implementation also persisted active email incidents and emailed on recovery using the existing trade-email setting. That notification design caused repeated warning/recovery pairs and is superseded by the [September 7 removal](2026-09-07-operational-email-removal.md). Health monitoring remains active; it no longer sends mail or persists notification incidents. Existing trade emails retain bounded SMTP timeouts. External `health-check.sh` remains necessary to detect a dead process/host.

Restore stages and validates the archive and exact matching SQLite snapshot before any service stop. It requires a persisted pause, verified flat broker account with no pending orders, and no unresolved durable lifecycle state. It preserves credentials and the original installation in a rollback directory, validates integrity/schema, and restores paused. Invalid input or a preparation failure does not remove the installation. A failure after cutover leaves the process stopped with the original retained for explicit recovery. See [the one-command deployment guide](../../scripts/DEPLOYMENT_README.md) and [the recovery/access reference](../operations/recovery-and-access.md) for HTTPS, verification and independent backup/compaction procedures. No compaction or off-host backup was performed in this pass.

### Measurement and reports (M7–M10)

`tradeRepository` supports entry or realized timestamps with an exclusive end boundary; `all` is all persisted history, not a hidden one-year cap. `/analytics` explicitly separates current run, all live history and an identified historical run. It no longer forces the active strategy when the user requests all history. The dashboard's win rate is current-run closed trades; its 24-hour net P/L is all live closures. Failed refreshes report stale data rather than advancing the successful-sync timestamp.

Cohort wins/losses and R use net AUD, with missing original risk left unknown. Sampled excursion R averages use only finite R observations and report separate risk coverage. Gross price P/L removes financing/dividend adjustments and adds back positive charges. Price-pip statistics remain separate. Actual pair sessions include daylight saving and overlap, and raw triggers distinguish pure pullback, pure breakout and both. ADX text no longer claims that a filter works from a handful of executed trades. Mean net R, sample coverage and descriptive uncertainty are visible; none is a promotion rule for profitability.

Dashboard analytics retain entry decisions/rejections while using compact signal reads. Actionable-event deduplication includes run/config identity so separate releases are not collapsed. Signal/decision funnels are explicitly event-time views and are not a matched closure conversion rate; unmatched closure rates are unavailable. Existing decision rows retain terminal stages, not every reached stage, so intermediate counts are explicitly minimum observed reach rather than a full historical sequence. Compact dashboard signals omit expected-edge context, so expectation/execution diagnostics are only included in full reports. Empty samples show no measured confidence interval. S3 exports use complete UTC days and Sunday-to-Sunday weeks, immutable `v2` object identities, success-only durable checkpoints and bounded catch-up after outages. Finalization requires successful post-boundary broker reconciliation with no pending/uncertain/quarantined accounting, preventing a known delayed close from being permanently omitted. Failed uploads retry every five minutes; first enablement starts with the latest completed periods. Existing-object acknowledgement is safe after an upload/checkpoint split failure. Late broker corrections need a separately identified corrected export, preserving the original report. Disabled/credential-incomplete reporting is visible. The manual S3 audit utility resolves dependencies from the backend installation.

### Dependencies and release identity (M11–M12)

The local release becomes `m15-intraday-v3` / `intraday-risk-v3` / `broker-liquidity-v2`, strategy `1.1.0`, to distinguish corrected execution from the reviewed v2 sample. Risk/capital limits are unchanged. `qs` is pinned through an override to 6.16.0; compatible development dependency fixes include Browserslist 4.28.9 and js-yaml 3.15.2 with their required browser-data updates. The exact lockfile was installed locally with lifecycle scripts disabled. Backend audit returned zero vulnerabilities after installation.

The original `CLAUDE.md` is preserved under `docs/archive/`; current instructions link to the review, remediation and operator/deployment guides. Historical facts are kept distinct from local implementation and later deployment.

## September 6 rollout handoff

The following records the handoff at the September 6 implementation checkpoint. Its pending rollout instructions were subsequently completed through the user-managed releases recorded below; they are not a request to redeploy the old v3 release now.

No source, configuration, broker state, service process, credentials, capital or deployment on `img.oakroad` was changed during implementation. No order, email or S3 upload was sent. Builds, Git publication and deployment remain user-managed under the repository instructions.

Deploy v3 with `./scripts/deploy.sh` after publishing the reviewed release. The command prepares/tests/builds the release, verifies pause and broker flatness, backs up, migrates, restarts and checks operational health. It restores previously enabled entries through readiness and preserves a pre-existing pause. Afterward, verify direct dashboard access, v3 run identity and preserved history. Observe the first actual broker fill/protection and timed exit; do not manufacture a test order. Begin the next profitability assessment with the corrected cohort and recorded costs, rather than combining it with v1/v2 and attributing any change to increased funding.

Independent integration review additionally corrected close/retry queue boundaries, risk/cooldown checks after reconciliation, sizing against the worst permitted fill, manual closes without a price cache, a Linux-sensitive import name, durable-intent checks in maintenance, a failed-save in-memory pause, run-aware signal deduplication, unmatched closure rates, empty-sample confidence intervals and stale overlapping dashboard refreshes. These are correctness fixes, not parameter tuning.


## One-command deployment follow-up

The user requested that deployment remain a single command. The operator-token setup described in the original September 6 follow-up was subsequently removed at the user's request on September 7. The previous runbook exposed first-upgrade bootstrap, pause and activation as manual chores; these now belong to the scripts. The additional authentication setup was removed entirely. `./scripts/deploy.sh` from the local checkout deploys published `main` over SSH; `./scripts/update.sh` remains the Pi equivalent. Recovery/access detail moved into a separate reference.

| Change | Justification | Verification |
| --- | --- | --- |
| SSH bootstrap fetches and pins a release archive before using its helpers | The old unauthenticated installation cannot supply newly introduced scripts; tracked source stays untouched during preparation | Isolated bootstrap and first-upgrade fixtures |
| Stage dependencies, backend tests and frontend build; repeat gates on same-revision runs | A failed install/build must not damage running dependencies, and HEAD alone is not a success receipt | Preparation failures, sequencing and same-revision tests |
| Original operator provisioning removed on September 7 | User requires a private tool with no application login; only deployment compatibility may read an existing token to replace the old process | No-token startup/API and migration compatibility fixtures |
| Read exact trading state, durably pause, require an idle entry queue and broker flatness; recheck before cutover | Legacy in-flight signals can outlive a pause; open positions need management to keep running | Queue/broker and pre-cutover failure tests |
| Hold the shared maintenance lock throughout deployment and reuse its verified descriptor for backup | Prevents a cron backup or restore colliding with preparation/cutover without deadlocking the nested backup | Descriptor inheritance and contention tests |
| Build/test against staging with explicit test DB/environment; migrate the intended production DB | An inherited operator environment must not redirect tests into production or omit Jest | Environment and path assertions in isolated deployment tests |
| Restore the prior enabled state through readiness and verify it even after a lost HTTP response | Preserves the ordinary operator workflow without bypassing cooldowns or confusing an uncertain reply with a pause | Enabled/paused, readiness and lost-response fixtures |
| Retain recovery artifacts after cutover failure; report failure rather than silently resuming | Migration or startup failures need concrete evidence and deliberate recovery | Cutover failure fixtures |

Validation: **24 deployment tests**, **13 backup tests** (including lock inheritance and malformed/busy queue payloads), **17 restore tests** (including a queue becoming busy during preparation), and **8 operational-health scenarios** pass. Shell syntax and `git diff --check` pass. These fixtures stub SSH, Git release operations, npm, PM2 and external APIs; encryption tests use temporary test-only credentials. The earlier 500 backend tests were not repeated because this follow-up changes deployment/maintenance scripts and documentation, not backend trading code. No production deployment or real build was performed; the deployment script runs those steps only when invoked by the user.

## September 7 — Remove the operator login requirement

**User decision:** the app is a private personal tool available on their internal network. They explicitly requested removal of the new login requirement. General remediation approval had been interpreted too broadly when the access gate was introduced; improving the bot does not authorize adding a product account/login model.

| Change | Justification | Verification |
| --- | --- | --- |
| Remove browser gate, login/logout component, auth client and auth-triggered socket redirects | Dashboard should open directly with no token entry or session expiry | Frontend parsing and refresh regression checks |
| Remove server auth routes, API middleware, session service and Socket.IO credential checks | UI-only removal would leave API and live updates unusable | Actual server integration: no-token reads, controls, readiness rejection and socket events |
| Remove operator provisioning and startup/restore credential prerequisites; rename helper to `load-maintenance-api.sh` | First install and ongoing maintenance must work without operator secret files | Startup and maintenance fixtures with no operator token/files |
| Permit an opt-in, single 401 retry during deployment using only the old saved encrypted credential | The currently running gated release must still be paused/backed up before replacement; no new login/setup is introduced | Legacy 401, success and ambiguous-response tests; compatibility absent from new PM2 environment |
| Update product instructions, deployment, user guide and recovery reference | Future work must honor the private-use boundary and keep deployment one command | Current-document reference review |

Broker credentials, source/DB recovery, queue/flatness checks, risk limits and live-readiness checks remain in place. Historical review evidence and earlier validation counts remain above for traceability. Existing legacy operator files are not deleted; normal startup and API access no longer read them. This is an access/usability change, so the trading strategy/cohort identity is unchanged.

Validation: **494/494 backend tests pass in 32 suites** on Node 20.20.2, including five new tests through actual server/API/Socket.IO wiring. Eleven obsolete login/session tests were removed, explaining the change from the earlier 500-test total. **26 deployment/startup/maintenance tests, 15 restore tests, 13 backup tests and 8 health scenarios pass** (62 operational cases). All **27 frontend JavaScript/JSX files parse**, and **4 frontend refresh scenarios pass**. Shell syntax and whitespace checks pass. Test integrations use mocks/disposable fixtures and loopback sockets; no real broker orders, email or S3 requests were made. This pass makes local code/documentation changes only; no Git publication, frontend build or production restart/deployment has been performed.

## September 7 — Deployment verified and startup follow-up

Production `8d45be3` was verified healthy with direct access, fresh data and resolved broker state. The user's new timeout logs exposed a 30-second event-loop stall from synchronous SQLite WAL truncation during the deployment health scan. [The incident report](2026-09-07-startup-checkpoint.md) records exact timestamps, the background checkpoint and health-sequencing correction, clearer request diagnostics, installed-locale fix and verification. The user subsequently deployed this correction at `788a725`, verified healthy by read-only SSH at 13:56 AEST. Strategy and risk limits remain unchanged.

## September 7 operational-email removal

The user reported repeated operational warning/recovery emails following the remediation. Logs showed 18 pairs (36 emails) that day; the pictured warnings concerned broker quote age. The monitor reused the existing trade-email flag, announced an issue after successive one-minute samples, then sent a recovery and immediately rearmed after one clear sample. Successful broker polling does not guarantee a new broker price-event timestamp, and different stale instruments shared one incident key. Persisting only active incidents prevented duplicate messages during a continuous incident but did not prevent repeated warning/recovery cycles.

Removed the operational email sender, monitor mail/state dependencies, announcement/recovery bookkeeping and API/dashboard email-status metadata. Existing trade-open/close emails, health conditions, readiness gates and risk limits remain unchanged. No substitute notification setting or cooldown was added. **511/511 backend tests pass across 34 suites**; changed dashboard JSX parses and whitespace checks pass. The [incident record](2026-09-07-operational-email-removal.md) records detailed verification and deployment status. This correction was subsequently deployed by the user at `8e4fb99`, verified over read-only SSH on September 7 and 8.

Follow-up verification: **510 backend tests in 33 suites**, **17 health-check scenarios** and **26 deployment/startup/maintenance scenarios** pass. Real WAL contention preserves timer/API responsiveness and history; the incident report records deadline, cancellation, truncation and validation details. Production was not mutated during diagnosis or implementation.


## September 8 — Full quote-freshness correction (local status at that checkpoint)

The user approved the full repair after reviewing the plan. The [implementation record](2026-09-08-quote-freshness-fix-plan.md#implementation-record--september-8) traces changes and tests across price ingestion, bounded request completion, cached/final entry, management, conversion, API/socket/UI, strict deployment health and config/cohort upgrades. Release v3.1 / strategy 1.1.1 retains all strategy/risk/exit settings; broker event time remains historical evidence while validated receipt and elapsed request time govern availability. Cross-review also covered the management await/cache race and missing home-conversion provider timing. No deployment, build, Git publication, real order, operational email or schema change was performed. Final verification totals are in the linked record.

## September 10 — Maintenance restoration and quote boundaries (local)

Read-only inspection verified user-deployed v3.1 at `d46da61`. The user then approved fixing the observed backup/cooldown pause and exact-limit spread rejections. v3.2 restores enabled intent during a bounded cooldown without permitting entries early, preserves an active deadline through release replacement, and corrects quote-derived spread/cost/deviation comparisons without widening limits. Strategy parameters and historical attribution remain intact. [The correction record](2026-09-10-maintenance-and-quote-boundaries.md) documents each change, its justification, integrated checks and deployment limits. No production activation, build, publication or deployment was performed in this pass.

## September 11 — Local pricing rejections and reconsideration

Read-only inspection verified user-deployed v3.2 at `33e0b76`. Four local pricing declines were followed by same-candle suppression; later cached quotes sometimes satisfied the strategy again. Three declines since the process restart were counted as six errors. The approved v3.3 correction gives expected local declines specific rejection outcomes, counts unexpected failures once, and lets the next existing scan reconsider only recognized pricing declines confirmed before submission. The original decision reference survives attempts and restart, and all entry/risk checks run again. Limits, position sizing, historical ownership, uncertain-order handling and the active cooldown contract remain intact. [The implementation record](2026-09-11-entry-rejection-and-reconsideration.md) tracks validation and delivery; no Git publication, build, production activation or deployment was performed in this pass.
