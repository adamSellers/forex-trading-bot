# Persisted replay foundation

Later checkpoint: [replay events and recovery](2026-10-06-replay-events-and-recovery.md)
extends this implementation with cold recovery, durable feedback and fine event
dispatch. The source pins and evidence below retain this earlier checkpoint.

The next R1/R2 implementation slice runs unchanged v5 decisions through actual
isolated repositories and a stateful research broker. It implements software and
accounting checks needed before a profitability evaluation. It does not select
entry/exit rules or establish positive expectancy. The
[implementation plan](2026-10-06-profitability-implementation-plan.md) remains the
scope and sequence; full R2 and the frozen R3 baseline are not complete.

## Implemented contracts

`HistoricalMarket` accepts explicit interval-start UNIX seconds and completion
provenance, exposes only completed history at the advanced clock, retains separate
mid/bid/ask components and never fills absent intervals. H1 reconstruction requires
four contiguous completed M15 quarters on a UTC hour. AUD gain/loss/position-value
conversion legs share a completed interval end. This is a declared coarse research
model, not a new live freshness constraint. Missing component/conversion evidence
remains unavailable. All seven archive instruments pass adapter construction:
1,147,442 M15 bars, 286,634 reconstructed H1 bars and 320 discarded partial hours.
Retained broker H1/conversion parity remains unverified.

`ReplayClock` controls calendar time, `Date.now()` and both monotonic consumers
without dispatching timers. Actual data-service/final-entry quote tests cover
request-budget boundaries, repeated old-event delivery and receipt expiry. Successful
receipt, source event time and request duration retain their separate meanings.

`ReplayBroker` models dynamic balance/NAV/margin, directional AUD conversion,
whole-unit pricing, adverse bounds, explicit liquidity, deterministic broker IDs,
client-intent lookup and protective-order/close responses. Stops act at the supplied
executable side and may gap; targets execute at threshold or better. Fixed execution
commission and timestamped financing are applied once, with lifetime costs passed
through actual reconciliation. Missing metadata/conversions are not replaced with
guessed rates. Partial closes and broker trailing orders remain unsupported.

The persisted harness uses actual config, coordinator, generator, indicators,
strategy, queue, risk/execution, management, durable-intent recovery, reconciliation,
analytics and repositories with fully migrated in-memory SQLite. Only the database,
transport, clock, market observations and deterministic research IDs are replaced.
Normal broker reconciliation settles the final snapshot without closing positions
or generating more entries beyond the boundary. Comparable snapshots omit SQLite's
own `created_at`/`updated_at` audit fields and retain every explicit decision/event/
receipt/intent/lifecycle timestamp and identity reference.

Independent accounting checks verify complete numeric cash evidence, lifetime
costs, balance/NAV/margin identities, unique bidirectional local/broker ownership,
closed-trade net results and total closed PnL. Reproduced fault injections showed
that a missing zero-value result, duplicate local owners or an extra local closed
trade could previously pass the initial checker. The corrected checker rejects
all three while genuine numeric/string zero remains valid. This correction affects
research evidence only.

## Isolation and reproducibility

The launcher starts a separate test process without the application/server or
dotenv, removes broker/email/AWS/S3 credentials and inherited Node/dotenv preload
settings, and uses a temporary config location. The harness intercepts repositories'
database import before load and denies observed network transport calls. Polling
timers remain dormant while native SQLite async work settles. This is test-process
isolation, not an OS network sandbox; no import-time network call was found in the
reviewed source closure.

The manifest pins Node 22.16.0, the archive and the complete runtime/research/
configuration/migration source set. Omitted, changed or newly unpinned files fail
the provenance check. Baseline identity is checked against the actual catalog and
config. Artifacts record Node/platform/architecture/ICU/timezone and dependency
versions, input coverage, model assumptions, event/trade/intent/decision ledgers,
accounting and actual analytics. Evidence paths must be new; reruns do not overwrite
earlier captures. Large local outputs are identified by hash instead of committed.

## Validation and historical screen

The reduced [validation record](evidence/2026-10-06/research/persisted-replay-validation.json)
contains final suite totals, source/manifest hashes, deterministic rerun hashes,
coverage, decision counts and accounting checks. Final regression passed **1,139
tests across 56 backend suites**, including 102 added research tests. Each of the
two explicit historical command runs also passed its nine-test suite. Frontend,
deployment scripts and product source are unchanged; their prior release checks
remain the recorded validation. Integration fixtures pass healthy
BUY/SELL, JPY/non-JPY precision, actual structural SELL stops and timed exits,
competing pairs, legitimate small-account rejection, final-quote spread decline
and valid reconsideration, lost-response intent resolution without another order,
breakeven update followed by a gap/cost exit, and restart equality. Those restart
tests recreate engine/coordinator while retaining the same database connection,
repositories, config and data-service caches; they prove runtime rehydration,
not a cold process/file-database restart. BUY and archive tests reconstruct H1
causally; the SELL software fixture declares independent synthetic H1 evidence.
Clock deadline tests use the actual transport/final-quote paths separately; the
historical harness supplies zero-latency model responses through a transport seam.

The archived software screen covers 27–31 July 2026 with a 40-day unscored warmup,
four configured assets and A$100 synthetic initial NAV. Its 480 observation steps
persist 1,920 signals and two entry decisions: a USD/JPY SELL and GBP/USD BUY both
declined by the existing spread limit. There are no modeled orders or fills in this
sample. That absence is a screen result; it neither demonstrates a defect nor
supports profitability. The bid/ask component spread is modeled, not proven to be
a synchronous executable broker spread. Cash checks pass on this empty historical
trade ledger; filled/closed accounting is established separately by integration
fixtures. Identical reruns reproduce the complete comparable artifact bytes.

The screen explicitly declares modeled tradeability, one-million-unit liquidity,
fixed 5% margin, 0.2-pip adverse slippage and zero supplied commission. Historical
liquidity/margin/financing are not established by those assumptions. All inspected
archive periods remain development/retrospective evidence.

## Delivery and remaining work

All implementation is under `backend/research/`; no product source, strategy
catalog, risk defaults, notifications, access flow or live settings changed. This
offline slice is published from the local checkout to GitHub. It does not require
a live-process deployment/restart. The last verified deployed runtime remains the
[measurement release at `810c7f9`](2026-10-06-analytics-measurement-release.md),
v5 / strategy 1.3.0; that is a dated verification, not a new production observation.

Next R2 work must reproduce actual price-delivery/management schedules with
explicitly observed or declared evidence, handle unresolved intrabar stop/target/
breakeven ordering without claiming exact fills from OHLC, and extend persisted
coverage of loss/H1 reset, protected exits, fades, cooldown, session/boundary state
and cache rollover, including cold process/file-database restart. Retained broker H1/conversion comparisons, historical cost
coverage and uncertainty/possible-outcome reporting remain pending. A frozen R3
baseline precedes S1/S2/M1/M2/X1/X2 candidate comparisons; V1/L1 retain the evidence
review and user selection of any live behaviour.
