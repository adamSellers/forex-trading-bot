# Replay events and recovery

This R2 implementation extends the [persisted replay foundation](2026-10-06-persisted-replay-foundation.md)
with cold process recovery, durable lifecycle feedback and explicit source/delivery
events. It runs the existing v5 strategy, execution and risk policies unchanged.
The [implementation plan](2026-10-06-profitability-implementation-plan.md) remains
active: a frozen R3 performance baseline and candidate studies are still pending.

## Persisted lifecycle and cold recovery

Five integration cases generate signals and fills through the actual coordinator,
engine, broker model and migrated SQLite repositories, then test their feedback:

- A normal stop persists its H1 reset anchor across engine restart; later generated
  requalification permits another BUY.
- Breakeven and target exits each suppress the old BUY continuation and admit a
  wholly post-exit touch.
- A structural SELL target permits one BUY fade. A local spread decline, retry
  and restart preserve its parent/setup/price anchor; a filled fade stays consumed.
- Three generated normal losses arm the existing 24-hour cooldown. An actionable
  fourth setup is declined through the existing portfolio policy. Restart retains
  the deadline; the actual risk-state check expires it at the boundary.

These are declared software fixtures. Loss-reset and SELL/fade cases supply
independent synthetic H1 evidence; the other BUY touch cases derive H1 from M15.
The three-loss fixture uses A$1,000 synthetic NAV to admit concurrent trades while
preserving the A$100 sizing cap and 0.25% risk. It does not establish those entries
as feasible on an actual A$100 account. The prior small-account rejection case
remains covered. Cooldown expiry checks eligibility state, without claiming a
post-expiry generated fill.

The cold test uses three distinct Node processes: a head, resumed tail and
uninterrupted control. File-backed SQLite, caller-owned config, explicit event
history and the separately modeled broker checkpoint cross the process boundary.
Services and caches are fresh; the process monotonic clock resets to zero. An open
BUY retains its owner, run, completed intent, broker ID and breakeven protection.
Repeated financing delivery is deduplicated; no second order appears. A later gap
exit reconciles money and ownership. The final tables, analytics, events and broker
checkpoint match the control, excluding SQLite audit timestamps and per-process
monotonic values. Config bytes remain identical.

This proves orderly cold recovery after drained work. It does not prove arbitrary
crash recovery at every submission/protection boundary. Existing lost-response
intent coverage is a separate case. The checkpoint model preserves external broker
state; it is not a production broker persistence implementation.

## Explicit events and request timing

The fine adapter distinguishes broker-source prices/conversions from delivered
observations. Each supplied envelope declares source event time, receipt time,
request start where known, identity and provenance. No tick, quote or conversion
is interpolated. Controlled events commit one at a time in the declared tie order.
Explicit source observations strictly before startup can initialize the source
book, without creating a local receipt or replaying historical protection. Earlier
unobserved protection on a pre-existing position remains unresolved.

The scheduler follows the actual current defaults: price polls every five seconds,
management every ten seconds, and candle refresh/scans every sixty seconds. The
earlier five-minute scan assumption was incorrect for the current server. Startup
phases, ties and serial callback execution are declared modeling assumptions,
not measured production event-loop timing.

The driver starts actual DataService requests and completes only a matching pending
poll after all explicitly supplied packet rows arrive. Busy polls stay skipped;
unmeasured, conversion-only and unmatched deliveries remain unresolved. Partial
responses use the service's existing missing-row path without cache/source fallback.
Separate engine conversion and final-entry pricing calls use the explicit broker
source book with zero modeled response latency. They do not establish historical
final-response timing or exact execution.

Focused checks preserve an old broker event timestamp through a healthy new receipt.
A response exactly at a declared 25ms budget succeeds; one at 26ms is rejected by
the existing deadline and retains the previous receipt; a later valid response
permits entry. The service measures elapsed time with the controlled monotonic
clock. Envelope `declaredRequestElapsedMs` is instead a difference between declared,
aligned wall-clock inputs. This harness exercises post-response validation; actual
HTTP cancellation and transport races remain covered separately by clock tests.

Review corrected three replay defects: startup exposed the source book as a local
receipt before delivery; advancing time exposed all tied source events before their
callbacks; and a prior source event could be lost at a fine replay boundary. A tied
protection fill now uses the conversion available at that event, before a later
same-time conversion update. Healthy prior-event/current-receipt startup also runs
through actual orchestration.

## Intrabar uncertainty and validation

Two explicitly supplied paths fit the same M15 OHLC. One peak ends before management
observes it and leaves the trade open with its initial stop. The other is present
at management, moves the stop to breakeven, and closes on the next supplied gap.
Both reconcile accounting. A candle touch alone therefore cannot determine the
management outcome.

The diagnostic uses BUY bid and SELL ask component contacts to report conditional
possible-outcome witnesses. They are not exhaustive bounds; lower/upper net AUD
and net R remain null. No candidate performance is scored from these fixtures.

The reduced [validation record](evidence/2026-10-06/research/event-replay-validation.json)
retains regression totals, scenario results, source/input/runtime pins and paired
historical rerun hashes. All **1,198 backend tests across 64 suites** pass, including
164 research tests. The two explicit historical commands each pass nine tests.
A new versioned
[manifest](../../backend/research/manifests/v5-coarse-parity-2026-07-events.json)
pins this implementation. The old manifest/evidence remain the earlier checkpoint.
Generated research result JSON is evidence, not executed source; explicit input
manifests must pin any JSON consumed as research input.

The July 27–31 coarse screen is still an already-inspected development software
screen: 480 steps, 1,920 signals, two spread declines and zero modeled fills. Its
quarter-hour component closes do not establish synchronous executable quotes,
intrabar outcomes, historical costs or a profitable baseline. Filled accounting
comes from the separate integration fixtures.

## Publication and next work

This slice changes research code and documentation only and is published from local
development to GitHub. It requires no production restart. Last verified deployment
remains the [measurement release at `810c7f9`](2026-10-06-analytics-measurement-release.md),
v5 / strategy 1.3.0; this is a dated verification, not a new production observation.

Remaining R2/R3 work includes retained broker H1/home-conversion comparison, usable
fine historical evidence or defensible outcome bounds, historical cost sensitivity,
session/cache/boundary coverage and crash/protection race cases, then a frozen
performance baseline. Candidate entry/model/exit/fade comparisons follow that
baseline. This slice establishes software behavior, without selecting new live
rules or claiming profitability.

Read-only inventory found a concrete next parity input in the retained
[SELL study capture](evidence/2026-10-01/sell-exit-study/market.json.gz): 102,732
completed S5 bid/ask candles across 29 SELL windows, plus 58 entry/exit fill books
linked to those trades. The [production evidence](evidence/2026-09-26/production-evidence.json)
retains 31 entry records with quote/receipt/request timing fields. These support
execution, conversion and timing parity checks. Fill books are transaction-time
observations, not pricing-poll deliveries; conversion factors are not native
`homeConversions` responses. Windows selected around existing trades cannot serve
as an unbiased complete portfolio evaluation. No raw H1 candle arrays, native
`homeConversions` responses or continuous delivery history were found in the
inspected retained captures. Their hashes and coverage pointers are retained in
the validation record for the next slice.
