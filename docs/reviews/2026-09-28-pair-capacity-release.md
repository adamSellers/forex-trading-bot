# Pair capacity release — 28 September 2026

## Decision and evidence

The user explicitly requested removal of the account-wide position-count cap: a valid setup on a pair should be able to enter while another pair is held. Local release **m15-intraday-v4.1 / strategy 1.2.1 / intraday-risk-v4.1** applies that decision while retaining one position per pair and every existing strategy, broker, price, per-trade risk, portfolio, margin and loss check.

The old cap came from the May 29 controlled-live rollout and was retained through the August rebuild/M15 releases and September 26 integrated release. No comparison established that one concurrent position was optimal. The September 26 review recorded eight attempts rejected for capacity; their rejection does not prove they would have filled or made money. This change improves access to qualifying opportunities across pairs; it is not a claim of better expectancy.

## Last verified deployment

Read-only inspection on September 28 around 14:35–14:37 AEST verified clean user-deployed commit `aed750f27cd0ed24219b2965c443ba45ac05499a`, release **m15-intraday-v4 / strategy 1.2.0 / intraday-risk-v4**. Dashboard/API and OANDA were online; prices/candles were fresh, entries enabled, account flat, and repeated readiness checks passed. The active run was `live_3c068476-9fad-4079-bb82-c24889350374`, config `49808daa3caffd0405c4`, with no v4 fills at that snapshot. The one-position global cap was still active. This is a dated observation, not continuous monitoring.

S3 uploads remained unconfigured. The System tab's “Max: 2” was a display fallback; the server enforced one. No production source, settings, orders or processes changed during that inspection. Earlier documents describing v4 as awaiting deployment are superseded by this verification; their implementation/test evidence remains historical.

## Contract

- Remove `maxOpenPositions` from active release configuration and the global readiness ceiling. Do not replace it with another arbitrary account-wide count. One managed position per instrument remains enforced through the serialized entry path; no same-pair stacking or hedging is introduced.
- A qualifying different-pair entry proceeds through the existing checks. Existing positions still affect available margin, aggregate stop risk and currency/correlated exposure. The existing aggregate stop-risk ceiling remains **0.5% of NAV**, so additional full-risk positions can still be rejected. A broker-confirmed breakeven stop can reduce existing stop risk and permit another pair without changing any limit. Removing a count veto does not guarantee every signal will fill.
- Keep 0.25% × min(80% available margin, A$100) sizing, existing aggregate exposure/margin/loss limits, three-loss cooldown, strategy/freshness/fade rules, 1.5R target, +1R breakeven and timed/session exits. More pairs may be held concurrently, so total open exposure can increase within those unchanged portfolio limits.
- Preserve broker reconciliation, unresolved-intent reservations, duplicate-order suppression, protective orders and uncertain-exposure entry blocks. Never close another pair merely to make capacity for an entry.
- Preserve saved v3–v4 settings and enabled intent except the retired active count field. Retain historical run/config snapshots unchanged, carry an active cooldown's original expiry and manage prior trades with their owner exit policy. Attribute new decisions to the v4.1 cohort.
- Status/API compatibility reports `maxOpenPositions: null` in `/health` and `/system/health`, and `maxPositions: null` in engine status. The explicit policy is `positionPolicy: { scope: "PER_INSTRUMENT", maxPerInstrument: 1 }`. `GET /config` adds this policy to the returned copy only; stored snapshots and their hashes are unaffected. Dashboard labels say “one per pair” instead of inventing a global maximum.

## Validation and delivery

**Implemented and locally validated; publication, builds and deployment remain pending.** The [validation record](evidence/2026-09-28/pair-capacity-validation.json) records the latest passing results for **850 tests across 41 backend suites**, assembled from the full run and targeted reruns rather than one all-green invocation.

The initial full run passed 838 tests and failed 12. Ten API/socket failures came from the sandbox denying localhost listeners (`EPERM`); all ten passed the authorized isolated rerun. Two new engine tests incorrectly assumed the retained aggregate risk limit would admit additional full-risk positions. Their fixtures/expectations were corrected without changing production risk settings, and the final entire engine suite passed **237/237**. The other 39 suites passed in the full run. The additional engine/fade-restart run passed 258 tests (237 + 21), overlapping these results and not adding to the 850 total. The 56 configuration/migration/readiness/cohort checks are also included, not additional tests.

Coverage demonstrates different-pair admission and same-pair duplicate rejection through the serialized entry path, uncertainty/intent handling, unchanged portfolio limits, saved-config migration, active cooldown and owner-policy preservation, and truthful API/UI reporting. The engine regression admits a third pair after a broker-confirmed breakeven adjustment reduces aggregate stop risk; it also verifies rejection when the existing aggregate limit would be exceeded.

JSX syntax checks passed for `SystemHealth`, `TradingConfig` and `TradingDashboard`. No frontend build was run.

No test orders, production mutation, publication, frontend/production build or deployment are part of this implementation. Git publication, builds and rollout remain user-managed through the existing local → GitHub → `./scripts/deploy.sh` workflow. After rollout, review actual concurrency, rejected-entry reasons, aggregate exposure, costs and net results by release. No extra alert, manual deployment gate or strategy filter is introduced.
