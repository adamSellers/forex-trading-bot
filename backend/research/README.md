# Offline research foundation

These tools inspect local evidence and test orchestration in an isolated process.
They do not start the application, fetch broker data, submit orders, change live
settings, create a simulated product runtime or select a profitable strategy.

R1 input auditing and protocol/ledger tooling are implemented. R2 now includes a
causal archive adapter, controlled wall/monotonic clocks, a stateful broker model
and actual isolated SQLite orchestration. A complete historical v5 evaluator with
intrabar uncertainty and full lifecycle feedback coverage is **pending**. The
[persisted replay record](../../docs/reviews/2026-10-06-persisted-replay-foundation.md)
separates software parity from profitability evidence.

## Audit existing inputs

From the repository root:

```sh
python3 backend/research/audit_inputs.py
python3 -m unittest discover -s backend/research -p 'test_*.py' -v
```

The default archive is ignored local data:
`backend/data/historical/research_M15_MBA_20200101_20260803.json`. It is required
only for the audit command, not for the tests or deployment. Missing input files
fail explicitly; the audit never downloads a replacement. The standard-library
JSON reader holds the archive in memory; allow sufficient memory for the 307 MiB
input and decoded objects. No credentials or application database are read.

The reduced report is saved to
`docs/reviews/evidence/2026-10-06/research/input-audit.json`. Use `--archive`,
`--baseline`, `--prior-results` and `--output` for another explicit capture. The
report hashes its inputs and tool, records seconds/interval-start units, price
components, completion flags, monthly counts, unobserved intervals, and earlier
research assumptions. Identical inputs/tool reproduce identical output bytes.

Absent candles can reflect closures, holidays, quiet intervals or capture gaps.
This audit does not diagnose availability or fill them with synthetic candles.
Ask-component close minus bid-component close is descriptive: the two components
can close at different events and do not prove a contemporaneous account spread.

Every previously inspected 2020–August period and reviewed September/October
result is development or retrospective robustness evidence. A historical file
named `holdout` cannot become untouched evidence again. The adapter reconstructs
H1 from exactly four contiguous completed UTC quarters and derives matching-ended
AUD conversion legs. Comparison with retained broker H1/homeConversions and
finer executable quote coverage remain pending.

## Register experiments before evaluation

`protocol.py` validates explicit candidate specifications and appends a local
trial ledger:

```sh
python3 backend/research/protocol.py validate /absolute/path/candidate.json
python3 backend/research/protocol.py register /absolute/path/candidate.json --ledger /absolute/path/trials.json
python3 backend/research/protocol.py result candidate-id --ledger /absolute/path/trials.json --artifact /absolute/path/result.json --status INCONCLUSIVE
```

The specification fields are `schemaVersion: 1`, `candidateId`, `hypothesis`,
`baselineIdentity`, `dataManifestSha256`, `entryPolicy`, `exitPolicy`,
`featuresKnownAtDecision`, `costCases`, `economicObjectives`, `uncertaintyMethod`,
`trialBudget`, `periods`, `labelPolicy`, and `evaluationUse`. `trialBudget` declares
`maximumVariants` and `selectionRule`; it is a prespecified budget, not automatic
enforcement of every experiment outside this ledger. Each period has `role`
(`DEVELOPMENT`, `VALIDATION`, `FINAL_EVALUATION`), timezone-aware `fromUtc`, and
`toUtcExclusive`, in chronological nonoverlapping order.

`evaluationUse` distinguishes `RETROSPECTIVE` from `FUTURE_UNTOUCHED`. The latter
requires an `outcomeAccessPolicy` and a final interval beginning after registration
with `alreadyInspected: false`. Duplicate candidate registration is rejected;
changes need a new identity. Rejected, abandoned and inconclusive results remain
in the event ledger. Metadata cannot prove nobody inspected outcomes, and this
tool grants no live entry permission or deployment approval. No candidate or
future dates have been selected/frozen by this foundation release.

## Run the persisted coarse replay

Use Node 22.16.0 for the checked-in manifest (the project supports Node >=20 <23):

```sh
node backend/research/run_replay.cjs backend/research/manifests/v5-coarse-parity-2026-07.json /absolute/path/new-replay.json
```

The manifest pins the local archive, all runtime source/configuration/migrations,
the research harness and dependencies. Missing, changed or newly unpinned sources
fail before historical evaluation. Its v5 identity must match the actual catalog
and config. Output paths must be new; the launcher does not overwrite evidence.
The ignored archive is needed only for this explicit command. Normal backend
tests use synthetic observations and require no archive.

The launcher uses a separate process, clears credential variables and inherited
Node/dotenv preload settings, and does not import the server or dotenv. The Jest
harness intercepts database and broker imports, uses migrated in-memory SQLite
and a temporary config file, denies observed network transport calls, and keeps
polling timers dormant. This is application/test isolation, not an OS network
sandbox. There are no observed import-time network calls in its source closure.

The actual coordinator, generator, strategy, queue, execution/risk, management,
durable intents, reconciliation, repositories and analytics run unchanged. The
broker model evolves balance, NAV, margin, exposure, whole-unit fills, price
bounds and explicit costs. Broker-held protection acts only on supplied quotes;
stops can gap and targets fill at threshold or better. Financing requires explicit
timestamped events; missing historical charges remain unknown. Independent checks
require complete cash evidence, unique/bidirectional trade ownership and matching
local/broker results. Synthetic fixtures cover valid BUY/SELL, JPY/non-JPY,
competing pairs, small-account rejection, pricing reconsideration, lost-response
intent recovery, breakeven/gap/cost accounting and engine/coordinator restart
equivalence with retained database/data caches. A cold process/file-database
restart remains pending. Transport deadline tests run separately; the historical
screen models zero-latency deliveries.

The checked-in five-day July manifest is a **software/accounting screen**, using
already inspected development data. It models completed M15 component closes,
declared liquidity/tradeability, fixed 5% margin and explicit slippage. Independent
bid/ask component closes do not prove a synchronous executable spread. Its
quarter-hour management schedule does not reconstruct five-second price delivery
or ten-second live management. It leaves positions open at the final observation;
it neither forces a boundary close nor adds entries after the boundary. SQL-only
`created_at`/`updated_at` audit fields are excluded from comparable snapshots;
all explicit event, receipt, decision, intent and lifecycle times are retained.

Do not score candidate profitability from this screen. Actual polling and
intrabar path uncertainty, loss/reset/cooldown and protected-exit/fade feedback
coverage, retained broker parity, cost sensitivities and the frozen R3 baseline
remain to be completed. No candidate or live behaviour is selected here.

## Run the earlier architecture spike

Use the project-supported Node >=20 <23 (the repository pins v22.16.0):

```sh
node backend/research/run_spike.cjs docs/reviews/evidence/2026-10-06/research/orchestration-spike.json
```

The launcher removes broker/email/AWS/S3 credential variables from the child
environment and runs only the spike's Jest suite. Network transports are denied.
The suite also participates in ordinary backend tests and requires no ignored
historical input or native SQLite module.

It uses the actual coordinator, signal generator, indicators, v5 strategy,
durable-evidence resolver, entry engine, sizing/protection, management and
reconciliation with fixed time and broker-shaped synthetic observations. Only
completed M15/H1 candles are exposed. Tests verify break → retest → confirmation,
one fill with the absolute structural stop, six-hour management closure, restart
between retest/confirmation, and missing-ask rejection/recovery. Two identical
uninterrupted runs must produce identical reduced ledgers.

The repositories are in-memory test doubles. The broker fixture intentionally
does not implement historical intrabar triggers, dynamic margin/NAV, liquidity,
slippage or ten-second price interpolation. The emitted artifact identifies these
limits and source hashes. It does not claim complete v5 replay, real SQLite
parity, exact OANDA execution, statistical validation or profitability.

The persisted replay above supersedes this spike's in-memory repositories and
minimal broker model. Its original evidence remains an earlier software checkpoint.
