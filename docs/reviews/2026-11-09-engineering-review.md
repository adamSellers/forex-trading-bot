# Engineering corrections — 9 November 2026

Adam requested a whole-bot review using the Matt Pocock engineering skills, then explicitly authorized implementation of all five suggestions, starting with the recovery defect, and local testing. The work is local; this request does not authorize publication or deployment.

## Source and delivery status

| Fact | Recorded state |
| --- | --- |
| Local source | All five engineering corrections are implemented and locally validated in the working tree based on `7ddee7923839bcd7ae8a4cac0df3c182229a07c2`. They have not been committed or published. |
| Prior published executable release | H4 peak protection 2.1.0 / `h4-channel-v2`, implementation `461a27758c6b181b2ec679eef060aeefb3f0708c`, published to GitHub `main` before this work. |
| Last saved production observation | At 07:20 AEDT on October 27, source remained clean at `c09efb5` / H4-v1; entries were enabled, two protected positions remained open and management/readiness were healthy. This is not a present runtime assertion. |
| Prior deployment attempt | The October 27 standard command deferred before cutover because the account had open broker exposure. H4-v2 peak protection was not deployed at that checkpoint. |
| This work | No source commits, pushes, application builds, production inspection or deployment have been performed. |

The [H4-v2 release record](2026-10-26-h4-peak-profit-release.md) and [reduced October 27 delivery evidence](evidence/2026-10-27/peak-profit-deployment-deferred.json) establish the published/deployed distinction above. Earlier H4-v1 delivery evidence remains in its [release record](2026-10-18-h4-channel-release.md). A Git revision, local test result or dated healthy response is not evidence of a later completed deployment.

## Findings and authorized corrections

| Finding | Correction and rationale | Local status |
| --- | --- | --- |
| A filled entry can remain unresolved after its trade save fails or a process stops, if broker protection closes it before recovery. Recovery ignores the retained fill, scans after the fill and overwrites the known evidence with an ambiguous outcome. | Recovery consumes validated saved fills, retains known broker identifiers and uses the existing close-accounting path. Already-closed entries skip protective mutations; a previously persisted closed row is reused. A fill discovered after a response omitted it is retained before awaiting protection. Unknown outcomes and incomplete accounting remain blocked. | Complete locally; seven new SQLite startup regressions and one public execution regression pass. The original defect first failed with expected one durable trade, received zero. |
| Engine and repository imports hide broker/storage dependencies, forcing global module replacement in replay. | The engine and server pass `brokerClient` explicitly. Six repositories accept injected databases with lazy production defaults. Replay uses those adapters directly instead of global database/OANDA replacements, with a cold-restart sentinel against opening the default database. | Complete locally; repository/replay checks and a new repository-isolation regression pass. |
| Callers must understand lifecycle queuing, unqueued methods and current-trade reload ordering. | The [lifecycle coordinator](../../backend/src/runtime/brokerLifecycle.js) owns FIFO serialization, latest-trade reads and scoped nested commands. Engine callers cross that interface while the existing serialized execution is retained. | Complete locally; three new public-engine concurrency regressions pass. |
| BUY and SELL admission repeat validation, rejection bookkeeping, decision persistence and execution. | Both directions use one admission sequence after their existing owner/direction-specific guards, retaining their intentional decisions and trading rules. | Complete locally; the full backend regression suite passes. |
| Top-level documents stack superseded deployment and authorization checkpoints beneath current descriptions. | Permanent instructions live in `CLAUDE.md`, the current source description in `README.md`, and dated implementation/delivery state here. The original top-level documents remain in an archive. | Complete locally; archived bytes/hashes, 37 local documentation links and whitespace checks pass. |

The recovery defect was reproduced in isolation during review. It has not been observed in production. The design recommendations do not establish other runtime defects, and the H4 contract review found no concrete entry/exit/compatibility mismatch. This work changes no strategy parameters, numerical risk limits, quote timestamp meanings, historical ownership, notification categories or authentication policy.

## Verification

Final local validation used the project-pinned **Node 22.16.0**, matching the installed native SQLite ABI. No Python was used. The runtime was placed in temporary storage; project dependencies were not rewritten.

| Check | Final result |
| --- | --- |
| Full backend suite | **1,520 tests passed across 76 passing suites**, zero failures; one opt-in historical research test/suite remained skipped. |
| Frontend checks | **22 passed**, plus **four refresh-contract scenarios**. |
| Deployment/restore fixtures | **57 passed**; no real deployment or restore. |
| Operational health fixtures | **24 passed**. |
| Backup regressions | All passed. |
| Documentation | Original snapshots match `HEAD` byte-for-byte and their stored SHA-256 hashes; all 37 checked local links resolve. |
| Whitespace | `git diff --check` passed. |

Twelve new tests cover the correction and refactors: seven durable SQLite recovery/startup regressions, one public execution regression for retained fill evidence, three public-engine concurrency regressions and one repository-isolation regression. The recovery test went red before the fix, then green through the actual startup/reconciliation path. Cases include successful and lost broker responses, persistence failure, a broker close before restart, reuse of an already-persisted closed trade and incomplete outcome/accounting evidence that must continue blocking entries. The additional execution test also went red before its correction: a discovered fill was absent from the durable intent while a protective broker response was pending. The fix preserves both the original response metadata and discovered fill before that await. This injected response case does not establish its occurrence in production.

The final full backend invocation ran with localhost permission so the existing isolated API/Socket.IO tests could bind their temporary loopback listener. The earlier review baseline had 1,508 passing backend tests; it is separate from the final 1,520-test implementation result. Tests used isolated local storage and broker-shaped adapters, without production services or live orders. They establish software behavior, not strategy profitability.

The corresponding local commands, with the pinned Node runtime on `PATH`, are:

```bash
cd backend
NODE_ENV=test DB_PATH=:memory: node node_modules/jest/bin/jest.js --runInBand
cd ..
node --test frontend/src/components/__tests__/*.test.cjs
node scripts/tests/frontend_refresh_contract.test.cjs
node --test scripts/tests/deployment_test.cjs scripts/tests/restore_test.cjs
bash scripts/tests/health_check_test.sh
bash scripts/tests/backup_test.sh
git diff --check
```

Independent standards, spec and lifecycle static reviews found no remaining actionable findings. The final retained-evidence correction passed its red/green regression and the complete backend suite.

## Documentation provenance and remaining work

The [pre-cleanup snapshots](../archive/2026-11-09-top-level-checkpoints.md) retain the original `CLAUDE.md` and `README.md` contents byte-for-byte with source hashes. Release-specific permissions, old numerical evidence and dated operational observations remain historical facts. The existing [pre-September instruction archive](../archive/CLAUDE_HISTORY_BEFORE_2026-09-06.md), individual release records and their evidence are unchanged.

Implementation, local validation and review of all five suggestions are complete. Publication and deployment have not been requested for these changes. If subsequently authorized, they must use the existing one-way local → GitHub → production workflow. Unrelated research, recovery-drill, storage-access and notification-delivery follow-ups are not completed by this work.
