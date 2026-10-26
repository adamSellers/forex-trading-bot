# H4 peak profit protection — 26 October 2026

Local implementation and validation are complete for strategy **2.1.0**,
release **`h4-channel-v2`**, execution policy **`h4-channel-risk-v2`**.
**October 27 delivery update:** implementation commit `461a277` is published to
GitHub `main`. Standard deployment was attempted and **deferred by the existing
flat-broker check** while GBP/USD and EUR/USD SELL positions remain open.
Production still runs `c09efb5` / H4-v1. Enabled entries and healthy position
management were restored and verified. The new exit rule is **not deployed**.

Adam accepted the channel-plus-peak recommendation and requested implementation.
The selected starting rule activates at **+1R** and trails the best observed
executable price by **0.5R**. The [trade review](2026-10-26-latest-trade-profit-comparison.md)
records the observed problem and alternatives. These parameters are a prospective
choice, not demonstrated optimal settings or improved expectancy.

## Contract

The initial stop, ten-completed-H4 channel and Friday 16:45 New York exit remain.
Entry rules and numerical cash-risk limits retain their established contracts.
R is the immutable actual filled-entry-to-original-stop price distance saved at
entry. A moved stop, changed conversion rate or later configuration cannot
redefine it.

BUY peaks use observed liquidation bids; SELL peaks use observed liquidation
asks. Quotes retain the established validated receipt-freshness contract;
freshly received unchanged prices remain usable. At +1R, BUY peak protection
is peak bid minus 0.5R; SELL protection is lowest ask plus 0.5R. Prices round
outward at the broker tick. The tighter eligible channel or peak stop wins;
broker-confirmed protection never loosens. Missing completed side candles do
not disable independent peak protection.

Each newly favorable executable price is saved before a protective write. After
the asynchronous save, the engine re-reads and validates the current quote.
Failed/unconfirmed stop writes remain durable. A valid quote already crossing
the intended peak stop closes through the existing lifecycle as
`PEAK_PROFIT_EXIT`, including during retry backoff. Stale receipts wait for fresh
pricing while existing broker protection remains in place.

This follows observed quotes on the existing ten-second monitor; unobserved
ticks cannot advance the trail. Confirmed stops remain at the broker between
polls. Gaps, slippage, financing and conversion can change realized AUD profit.

## Compatibility and consumers

New owner snapshots use **version 3**, retaining kind `H4_CHANNEL`, with explicit
fields `enablePeakProfitTrail`, `peakProfitTrailActivationRiskMultiple` and
`peakProfitTrailRiskMultiple`. H4-v1/version-2 owners remain channel-only; M15
owners retain their exits. An H4 trade lacking an owner snapshot and retained
exit config conservatively resolves to v1 instead of acquiring new exits.

Independent durable control state is `brokerReconciliationPayload.peakProfitTrail`:
version 1, `peakPrice`, local `observedAt`, and broker `quoteEventAt`. The first
peak is the actual executable quote, even when adverse to entry. This neither
reuses reversible excursion telemetry nor changes legacy highest/lowest fields.
Repository round trips, reconciliation, pending writes and closes preserve it.

Config schema advances to 6. H4-v1 migration overlays only release/schema IDs
and the three new fields, preserving saved entry/channel settings, risk and
enabled intent. New fields remain hash-protected and frozen against ordinary
updates. Existing readiness requires a matching active run. The v1 snapshot/hash
**`5c21f2ba01099502340f`** remains unchanged; v2 defaults hash to
**`bd00b22e4ca1d3a6d182`**.

Successful peak updates have active stop type `PEAK_PROFIT`. Broker fills remain
physically recorded as ordinary `STOP_LOSS` orders, with that owning stop type
retained. Recent trades display these as peak trailing stops. The retained
intraday initial-loss-reset consumer recognizes the new managed stop type;
actual net AUD outcomes still determine the existing loss streak.

APIs/exports retain stored snapshots and cohort hashes. Dashboard settings show
activation, gap and the tighter-stop rule. No new notification, authentication
or operational gate was introduced.

## Verification

Node **22.23.1**, without Python:

- **1,508 backend tests passed across 75 suites**; the existing opt-in historical
  viability experiment remains skipped.
- **22 frontend tests**, production frontend build, **24 health scenarios** and
  **57 deployment/restore scenarios** passed.
- `git diff --check` passed.

The new management suite covers 28 integration scenarios through the real engine
monitor and normalized OANDA cache. Existing v1 channel management retains its
15 scenarios. Coverage includes BUY/SELL, exact activation, adverse first quotes,
healthy retracement/resumption, channel precedence, missing candles, pause,
Friday closure, original risk, real SQLite persistence, restart, stronger broker
stops, failed/unconfirmed writes, crossed pending stops, and quote changes or
receipt expiry during persistence.

The compact trade-3550 fixture retains executable asks and event times with its
source capture hash; bids, receipts and broker responses are explicit test
assumptions. Its first observed activation is +75.4 pips, producing SELL stop
156.648; later peak ask 156.085 produces tick-rounded stop **156.446**. This
verifies mechanics, not an obtainable historical fill or hypothetical net profit.

The first full test invocation passed 1,496 tests but ten existing local server
tests could not bind 127.0.0.1 under the sandbox. The complete rerun with loopback
access passed, including API/Socket.IO checks. Tests used no production services
or broker orders.

## Delivery

Adam explicitly requested deployment on October 27. The tested implementation
was committed locally as `461a27758c6b181b2ec679eef060aeefb3f0708c`, then pushed
to GitHub `main`. The existing `./scripts/deploy.sh` fetched that published
revision and exited 1 before preparation/cutover because the broker had open
exposure. No source/dependency replacement, build, backup or restart occurred.
The script restored its temporary entry pause to the previously enabled state.

At **07:20 AEDT on October 27**, post-attempt API verification found healthy
H4-v1 management, readiness passing, enabled entries, two open positions,
no unresolved entry intents, no broker uncertainty and no pending protection
updates. Each position retains its original version-2 channel-only owner and
positive stop price. An independent authenticated broker summary confirmed
two open trades and two pending orders. Production source remained clean at
`c09efb5`. The [reduced delivery evidence](evidence/2026-10-27/peak-profit-deployment-deferred.json)
records publication, the command output and before/after observations.

Deployment requires a flat broker account and resolved pending orders under the
existing script. No position was manually closed and no automatic retry was
scheduled. Rerun the same standard command when its flat-account condition is
satisfied. Deployment does not retroactively change existing trade owners.
