# Integrated v4 release evidence

The [release specification](../../../2026-09-26-integrated-release-specification.md) records the authorized rules, implementation, delivery state and limits. This directory contains local research and acceptance evidence, not a simulated execution runtime or a profitability forecast.

- [Pullback investigation](pullback-README.md): frozen structural candidate, 35 historical trades and available signal opportunities. Five excluded fills include two winners and total +A$0.0315; no retrospective improvement claim.
- [Fade investigation](fade-findings.md): four executable quote-side conditional paths, two targets/two stops; strict post-TP signal-completion checks. No hypothetical AUD portfolio return.
- [Validation record](validation.json): latest passing results for 834 tests across 41 backend suites on Node 22.23.1, source/test hashes, localhost API rerun and frontend JSX syntax-check boundaries. No frontend build or production deployment.

Reproduce the retained investigations from the repository root:

```sh
python3 docs/reviews/evidence/2026-09-26/integrated-release/pullback-analysis.py
python3 docs/reviews/evidence/2026-09-26/integrated-release/fade-analysis.py
```

Run backend regressions with supported Node 20–22 using `npm test -- --runInBand` from `backend`. The API/socket suite needs a loopback listener; broker, credentials, email and production storage are mocked. Native SQLite must match the Node ABI. Historical evidence and previous cohorts remain unchanged.
