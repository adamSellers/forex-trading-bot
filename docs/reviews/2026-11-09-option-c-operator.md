# Option C operator module — 9 November 2026

Adam requested full implementation and a local build of Option C after the architecture review. The selected design gathers operator behavior behind two small interfaces: the backend owns readiness, entry intent, supervised attachment and dashboard observations; the client owns presentation ordering and transport lifetime. React renders the shared client state.

The implementation request authorized local work, builds and tests. Adam subsequently explicitly requested committing and pushing all reviewed changes, then deploying with the standard script on November 9. That authorizes publication and standard deployment of Option C together with the [earlier five engineering corrections](2026-11-09-engineering-review.md). Their original verification record and the top-level document archives retain their dated evidence.

## Source and delivery status

| Fact | Recorded state |
| --- | --- |
| Released implementation | Option C and the recovery, dependency-injection, lifecycle, admission and documentation corrections are published and deployed at `6aae5ab08e71837fde0942468807e62f93be39c1`. Local checks, target checks and post-deployment verification passed. |
| Source base and publication | The release was committed locally on `main` over `7ddee79`, then pushed to GitHub before deployment. It contains the 44 reviewed implementation/test/documentation files; pre-existing H4 observation captures remain local. |
| Prior published executable release | H4-v2 peak protection 2.1.0, implementation `461a27758c6b181b2ec679eef060aeefb3f0708c`. |
| Prior October 27 observation | At 07:20 AEDT, clean `c09efb5` / H4-v1 had enabled entries and two protected positions, with healthy management/readiness. Its earlier delivery record retains that dated checkpoint. |
| November 9 pre-deployment observation | At 12:16:45 AEDT, clean `c09efb5` / H4-v1 was healthy, enabled and flat, with readiness PASS, monitoring active, zero pending entry intents/quarantines/protection updates and resolved broker state. Standard deployment preserves that observed enabled intent. |
| Prior deployment attempt | H4-v2 deployment deferred at the existing flat-broker check before cutover; the [release record](2026-10-26-h4-peak-profit-release.md) and [delivery evidence](evidence/2026-10-27/peak-profit-deployment-deferred.json) preserve that checkpoint. |
| Verified November 9 deployment | At **12:26:11 AEDT**, production was clean at `6aae5ab`, healthy, enabled and flat, with readiness PASS, active monitoring, zero pending broker orders/intents/quarantines/protection updates and all eleven operator observations available. |

## Deployment receipt

The standard `./scripts/deploy.sh` command exited **0**. It consumed the published revision through GitHub, passed **1,545 backend tests across 78 suites** on the target (one opt-in historical experiment skipped), built the frontend, verified matching source/SQLite backup `20261109_122012`, confirmed schema was already up to date, installed the release and passed operational health. The command restored the previously enabled entry intent.

This also completes delivery of the previously published H4-v2 release: config is `h4-channel-v2` / `h4-channel-risk-v2`, hash `bd00b22e4ca1d3a6d182`, with the already-approved +1R activation / 0.5R peak trail for new owners. The observed risk settings remain 0.25% entry risk, A$100 sizing-capital ceiling and 0.5%-of-NAV aggregate stop risk. Retained owners keep their saved policies.

Post-deployment GETs confirmed the operator schema, enabled/durable intent, readiness, protection and all eleven source observations. A read-only Socket.IO probe subscribed, received a composed view and released its subscription. Nginx returned **HTTP 200** at `http://fx.oakroad/` and served the new `/assets/index-Bv_U2o8G.js` entry artifact. No manual test order or production source edit was made. The [reduced delivery evidence](evidence/2026-11-09/operator-deployment.json) records before/after observations, backup identity and command-log hash. A documentation-only delivery receipt follows the deployed executable commit in GitHub history.

During the standard backup, the backend was deliberately stopped while copying the approximately 2.8G SQLite database. The dashboard returned `502 Bad Gateway` during that window; PM2 reported the process stopped while the active SQLite copy had reached approximately 2.3G. The script restarted the backend after the copy, verified the snapshot and completed cutover. This was observed maintenance downtime before the new source was installed, not evidence of a crash in Option C. The visible downtime should have been flagged before the backup began.

## Module interfaces and ownership

| Module | Interface and responsibility |
| --- | --- |
| [Backend `LiveOperator`](../../backend/src/runtime/liveOperator.js) | `attach`, `readReadiness`, `readDashboard`, `observeDashboard`, `enableEntries`, `pauseEntries` and `reconcileBroker`. Owns supervised engine attachment, readiness evaluation, durable intent changes, composed views and observer lifetime. |
| [Dashboard source adapter](../../backend/src/runtime/operatorDashboardSources.js) | Provides nine observation readers and event invalidation. Account and portfolio share one broker account response within a refresh; price-only refreshes do not request account data. |
| [HTTP/socket wiring](../../backend/src/routes/tradingRoutes.js) and [server](../../backend/server.js) | Expose the operator interface. Existing control routes delegate to the same operator so maintenance and dashboard controls retain the same behavior. |
| [Client operator](../../frontend/src/operator/liveOperator.js) | Owns shared immutable state, observation ordering, reconnect/read refresh, command feedback and cleanup. It has no authority to approve execution. |
| [React hook](../../frontend/src/operator/useLiveOperator.js) | Uses `useSyncExternalStore` to subscribe to the client operator. The dashboard and status banner consume that view instead of owning separate read/socket/readiness loops. |

Broker mutations still pass through the engine's existing serialized lifecycle. Strategy rules, numerical risk limits, quote semantics, owner exits, protection retries and unresolved-broker-state entry blocking retain their established contracts. This refactor adds no execution token, strategy selector, authentication requirement or notification category.

The transport is:

| Transport | Operation |
| --- | --- |
| `GET /api/operator/dashboard` | Read the composed operator view. |
| `POST /api/operator/entries/enable` | Evaluate existing activation requirements and persist enabled intent when allowed. |
| `POST /api/operator/entries/pause` | Persist paused intent without waiting for broker/display reads. |
| `POST /api/operator/reconcile` | Run existing broker reconciliation and report whether lifecycle state remains unresolved. |
| Socket.IO `operatorSubscribe` / `operatorUnsubscribe` | Start or release that socket's operator observation without disconnecting other socket consumers. |
| Socket.IO `operatorSubscription` | Acknowledge the observation's `active` state; this has no execution authority. |
| Socket.IO `operatorView` | Receive composed publications while subscribed through the same backend operator. |

The first client observer starts the shared subscription, and the final unsubscribe releases its backend observation, listeners and polling. Leaving the dashboard therefore stops dashboard observation even while Navigation keeps its socket connection. Reconnection resubscribes while an operator observer exists. The live coordinator's `activeSignals` array is authoritative, including an empty array that clears earlier setups; persisted history is a fallback only when that live array is absent.

## View and timestamp contracts

Schema version 1 keeps `intent`, `activation`, `entries`, `protection` and `identity` distinct. Saved enabled intent is not proof that entries are currently allowed; a cooldown can permit activation while continuing to block entries. Protection attachment/monitoring fields describe the running engine, while existing broker reconciliation and protective-order checks remain authoritative for exposure.

The view contains eleven observations: `systemStatus`, `engineStatus`, `portfolio`, `trades`, `signals`, `prices`, `account`, `liveSelection`, `catalog`, `readiness` and `operationalHealth`. The source adapter supplies the first nine; the operator evaluates readiness and operational health. These are independent observations, not a transactionally simultaneous broker snapshot.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | The operator-view format; currently 1. |
| `streamId` | Identity of the running process's operator instance. A replacement instance has a new stream. |
| `publication` | Display-order counter within a stream. It orders views only; it cannot authorize an entry, retry a command or redefine market timestamps. |
| `generatedAt` | Time the composed view was generated. It does not make retained source values fresh. |
| `observations[source].observedAt` | Successful completion time of that source's last accepted read. |
| `observations[source].lastAttemptAt` | Start time of the latest accepted refresh attempt for that source, including a failed attempt. |
| `observations[source].status` / `error` | Availability of the latest observation attempt and its reported failure, if any. |

A failed source retains its last good value and successful `observedAt`, with explicit unavailable metadata and a newer attempt time. A source with no successful observation remains unavailable. Failed readiness observations do not reuse cached activation permission as current. Quote event time, validated receipt time and request duration retain their existing meanings inside the source values.

Each backend source read has a 20-second observation deadline. The client dashboard GET has a 25-second read deadline. These are display/read bounds, not new mutation deadlines or trading freshness rules. Older source attempts and HTTP replies cannot overwrite accepted newer observations; reconnects also retire publications from the previous process stream. Read subscriptions, timers and listeners are released independently of engine protection.

## Commands and partial failure

Command acceptance and display availability are separate outcomes. Backend commands report known `accepted`, `rejected`, `failed` or `unresolved` results; the client reports `unknown` if a mutation response is lost or invalid. Unknown mutations are not automatically repeated, and the display-read deadline does not time out an in-progress mutation.

An accepted command remains accepted if its subsequent dashboard read fails. A rejected enable retains readiness evidence. A completed reconciliation with unresolved order/exposure state reports that state rather than claiming successful resolution. A known command failure reports its error while preserving existing safety behavior, including an in-memory pause after persistence failure.

Pause persists `enableTrading: false` synchronously before broker or display awaits, publishes the local view and returns `refreshPending: true`. A bounded background observation refresh follows. This keeps maintenance pause acknowledgement prompt without hiding later partial-read failures. Pause invalidates an in-flight enable so delayed activation cannot overwrite the newer intent; it leaves position management and reconciliation running.

## Verification

Final validation used **Node 22.16.0**, matching the project's native SQLite ABI, without Python:

| Check | Final result |
| --- | --- |
| Full backend suite | **1,545 tests passed across 78 passing suites**, zero failures; one opt-in historical research test/suite remained skipped. |
| Frontend suite | **50 tests passed**: 33 component checks, including 12 real ReactDOM/jsdom/StrictMode scenarios, plus 17 public client-interface checks. |
| Compatibility refresh runner | Passed the same 17 public client checks; these are not additional tests in the 50-test total. |
| Local production frontend build | **Vite 8.1.4 passed**, after all source changes; final run completed in 694 ms. |
| Deployment/restore fixtures | **57 passed**; no real deployment or restore. |
| Operational health fixtures | **24 passed**. |
| Backup regressions | All passed. |
| Whitespace | `git diff --check` passed. |
| Independent reviews | Standards/design and spec reviews found no actionable findings after the follow-up corrections. |

The tests exercise public backend/operator/client interfaces with isolated SQLite or broker-shaped adapters, including:

- Existing cooldown, readiness, persistence and broker-lifecycle rules through enable/pause/reconcile and compatibility routes.
- Concurrent enable/pause, slow broker initialization, immediate pause acknowledgement and accepted commands followed by failed reads.
- Partial-source failures, retained values and successful-read timestamps, unchanged quote events, scoped refreshes and delayed older responses.
- Same-stream ordering, process replacement, reconnects, obsolete HTTP responses and complete observer cleanup, including the real socket subscription protocol.
- Lost/invalid mutation responses without automatic retry, read deadlines that leave mutations independent, and dashboard/banner rendering from one shared view.
- Full backend/frontend regressions, maintenance/deployment/restore fixtures and a local production frontend build.

Presentation checks mount the actual Dashboard, `useLiveOperator`/`useSyncExternalStore`, ThemeProvider, MUI and widgets under React.StrictMode through ReactDOM. Only external transport/socket delivery, browser ResizeObserver/layout and chart HTTP are test doubles. The earlier VM/custom-hook approach was replaced. The renderer uses **jsdom 26.1.0** as a development-only dependency: 36 packages were added, with no existing locked package version changed.

Review follow-ups were reproduced red before correction: an authoritative empty live-signal array must clear stored setups, and ending a dashboard subscription must release the backend observation while the shared navigation socket stays connected. Their public-client/source and actual-socket regressions pass. The first full backend run also exposed an existing test-fixture wall-clock race; its entry time is now pinned to the intended first sample timestamp, with no runtime semantic change. The 299 engine tests and subsequent full 1,545-test run passed.

The corresponding local commands, with the pinned Node runtime on `PATH`, are:

```bash
cd backend
NODE_ENV=test DB_PATH=:memory: node node_modules/jest/bin/jest.js --runInBand
cd ..
node --test frontend/src/components/__tests__/*.test.cjs frontend/src/operator/__tests__/*.test.cjs
node scripts/tests/frontend_refresh_contract.test.cjs
node --test scripts/tests/deployment_test.cjs scripts/tests/restore_test.cjs
bash scripts/tests/health_check_test.sh
bash scripts/tests/backup_test.sh
cd frontend
npm run build
cd ..
git diff --check
```

The full backend run used isolated localhost permission for the API/socket fixtures. Tests used local fixtures and no production services or live orders. Software checks do not establish trading profitability. The previous engineering record and archives retain their own dated results unchanged.

Implementation, build, local/target testing, publication and standard deployment are complete. The recorded post-deployment checks describe the measured state at 12:26:11 AEDT; they do not guarantee future connectivity, exposure or profitability. The pre-existing H4 live-observation captures remain local. Unrelated research and operational follow-ups retain their prior status.
