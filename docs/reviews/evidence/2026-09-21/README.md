# September 21 review evidence

The parent review explains the interval, measurements and conclusions. CSV and JSON files are derived observations, not new trading configuration. Excursion columns in the CSV retain the observed, potentially contaminated historical aggregates; see the reported defect.

`reentry-review.test.js` is a historical observation fixture pinned to reviewed revision `5c250a7`. Two tests establish TP/new-candle suppression and restart behaviour through the actual coordinator, generator and engine. The third intentionally asserts the excursion contamination defect and is expected to fail against the corrected source. It must not be interpreted as a regression test proving the defect fixed. The new `backend/src/services/__tests__/sampledExcursionIntegration.test.js` suite verifies the correction. Synthetic next-candle history demonstrates lifecycle semantics, not a market counterfactual. External services, notifications and persistence are mocked; no broker credentials or production database are loaded.

Against the reviewed source revision, from repository root with Node 20–22:

```sh
node backend/node_modules/jest/bin/jest.js --runInBand --config docs/reviews/evidence/2026-09-21/jest.config.cjs --silent
```

Reviewed against revision `5c250a74b33705eda15dc2b94d2e84a5afff30a3`; 3 tests passed on Node 22.23.1. The main review also records 269 existing tests passing. Raw source exports were kept in the temporary local audit directory and identified by SHA-256 in `manifest.json`; their retention beyond this review is not guaranteed. No raw credentials were exported.
