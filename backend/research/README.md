# Offline research foundation

These tools inspect local evidence and test orchestration in an isolated process.
They do not start the application, fetch broker data, submit orders, change live
settings, create a simulated product runtime or select a profitable strategy.

R1 input auditing and protocol/ledger tooling are implemented. R2 now includes a
causal archive adapter, controlled wall/monotonic clocks, a stateful broker model
and actual isolated SQLite orchestration. Persisted lifecycle feedback, orderly
cold process restart, focused pricing requests and explicit fine event schedules
have synthetic software tests. A complete historical v5 evaluator with retained
broker parity, exhaustive intrabar uncertainty and a frozen profitability baseline
is **pending**. The
[events and recovery record](../../docs/reviews/2026-10-06-replay-events-and-recovery.md)
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
node backend/research/run_replay.cjs backend/research/manifests/v5-coarse-parity-2026-07-events.json /absolute/path/new-replay.json
```

This manifest pins the current foundation's local archive, runtime
source/configuration/migrations, the research harness and dependencies.
Missing, changed or newly unpinned sources
fail before historical evaluation. Its v5 identity must match the actual catalog
and config. Output paths must be new; the launcher does not overwrite evidence.
The ignored archive is needed only for this explicit command. Normal backend
tests use synthetic observations and require no archive.

The original `v5-coarse-parity-2026-07.json` and its emitted evidence remain an
immutable earlier checkpoint. Its source hashes describe that earlier code;
do not rewrite it to accept later sources. The `-events` manifest records the
current implementation separately. This historical command still runs the
quarter-hour coarse screen; its filename does not imply historical tick inputs
or the fine schedule described below.

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
intent recovery and breakeven/gap/cost accounting. Generated entries and actual
persisted decisions also exercise normal-stop H1 reset/requalification, protected
exit blocking and wholly post-exit touches, one post-target fade with its parent
and original retry anchor, fade consumption, and the three-loss cooldown deadline
across engine/coordinator restart. These are representative software fixtures,
not a claim that every historical lifecycle path is covered.

The cold restart test runs separate Node processes against file-backed SQLite.
Fresh ConfigService, DataService, market caches, coordinator and engine recover
the saved run, intent and protected trade. A validated checkpoint preserves the
modeled external broker's cash, trades, protection, financing deduplication,
transactions and next identifiers. The caller-owned config survives shutdown.
After a repeated scan and financing delivery, a supplied gap stop settles with
the same persisted/account results as an uninterrupted control. Process-local
monotonic time deliberately restarts; comparison excludes that clock value while
retaining explicit wall/event times. This proves an orderly cold process restart
with an open protected trade. Arbitrary crashes during pending submissions,
responses or protection writes remain outside this test's claim.

The checked-in five-day July manifest is a **software/accounting screen**, using
already inspected development data. It models completed M15 component closes,
declared liquidity/tradeability, fixed 5% margin and explicit slippage. Independent
bid/ask component closes do not prove a synchronous executable spread. Its
quarter-hour management schedule does not reconstruct five-second price delivery
or ten-second live management. The coarse screen supplies zero-latency pricing
responses at its scheduled observations. It leaves positions open at the final observation;
it neither forces a boundary close nor adds entries after the boundary. SQL-only
`created_at`/`updated_at` audit fields are excluded from comparable snapshots;
all explicit event, receipt, decision, intent and lifecycle times are retained.

Do not score candidate profitability from this July screen or treat it as the
frozen R3 baseline. Retained broker parity, historical executable point/delivery
coverage, exhaustive intrabar outcomes, cost sensitivities and baseline evaluation
remain to be completed. No candidate or live behaviour is selected here.

## Exercise focused requests and fine schedules

From `backend`, run the research suites with the supported Node runtime:

```sh
npm test -- --runInBand research/__tests__
```

`persistedReplay.cjs` exposes separate broker-price, candle-refresh, management
and scan actions, plus pricing-request start/completion. Advancing the replay
clock does not dispatch polling timers. Focused request fixtures exercise the
actual DataService's in-flight poll suppression, response failure and
post-response deadline with controlled monotonic time. A request can remain
pending without creating a new receipt. An unchanged source event can be
successfully received again; source event time, successful receipt time and
request duration remain distinct. These tests do not reproduce HTTP
AbortController cancellation or every transport race.

`observedQuoteMarket.cjs`, `fineEventSchedule.cjs` and `runFineSchedule.cjs`
separate broker-source quote/conversion events from local deliveries and timer
requests. Every supplied point/delivery carries explicit provenance. Current
fine orchestration tests use synthetic scenarios, not retained historical ticks.
The default schedule follows the current application: price polls every five
seconds, management every ten seconds, and candle refresh/scans every sixty
seconds. Startup phases and tied-event ordering are explicitly declared modeling
assumptions. The earlier five-minute scan assumption does not describe the
current server. Equal millisecond timestamps do not prove real broker or
event-loop ordering.

Broker-held protection can act on a supplied source price before the application
receives or manages it. Local delivery alone does not refresh the DataService
cache: a response needs an actual pending poll with a matching explicit request
start, and all rows of its declared packet must have arrived. Deliveries without
an explicit request start, deliveries for a skipped poll and conflicting packet rows
remain unresolved. Missing instrument rows pass through the actual DataService's
partial-response path; source quotes and old cache rows do not replace them.
Source event timestamps remain unchanged when receipt occurs later.

Adapter `visible*Deliveries` counts applied envelope evidence, including unresolved
packets. Actual DataService cache/receipt state and request logs establish whether
the application accepted a response.

Explicit source observations strictly before startup initialize the broker source
book without creating local deliveries or replaying earlier protection callbacks.
Equal-start events retain their declared tie order. This supports unchanged broker
event timestamps received successfully at startup; earlier protection outcomes on
pre-existing positions still require their own evidence.

Engine-side direct broker pricing and conversion lookups use the current source
view with zero modeled request latency, separately from these app-poll responses.
The broker's fill/slippage model remains an explicit assumption. The focused
request tests therefore do not establish historical entry-request latency or
exact broker fills. Neither timer ticks nor clock progress interpolate quotes,
conversion rates, successful responses or receipts between supplied observations.

`intrabarUncertainty.cjs` is a post-outcome diagnostic. Retained BUY bid-component
and SELL ask-component ranges can identify threshold contacts and conditional
outcome witnesses. They do not establish the order of those contacts, a delivered
management quote, a broker acknowledgement or realized P/L. Synthetic paths with
the same OHLC can produce different breakeven outcomes at the management poll.
The candidates are nonexhaustive; survival is unresolved. Numeric lower/upper
net-AUD and net-R bounds remain `null` with `NOT_ESTABLISHED` status. This module
neither supplies entry features nor a profitability interval.

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
