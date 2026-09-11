# Maintenance restoration and quote-limit correction

**Status:** local implementation and verification completed September 10. User deployment of `33e0b76`, v3.2 / strategy 1.1.2, was verified read-only on September 11. The [September 11 follow-up](2026-09-11-entry-rejection-and-reconsideration.md) addresses local rejection reporting and same-candle reconsideration; its delivery state is recorded separately. Publication, builds and deployment remain user-managed.

## Findings and scope

The investigation found two demonstrated defects:

- A scheduled backup durably paused an enabled bot, restarted it, then exhausted its activation retries because the consecutive-loss cooldown was active. Trading remained disabled after the script exited, and its database snapshot was not finalized. The restoration loop dates to August 13; adding cooldown to activation readiness on September 2 created the interaction.
- Exact-limit spreads were rejected because floating-point subtraction produced a value just above the configured limit. September 6 removed cached spread rounding and added final execution-cost checks without accounting for numerical error. The final quote's movement comparison had the same boundary defect before that release.

The concentration investigation found distinct completed-candle entries under the existing continuation strategy. Other pairs were evaluated and produced actionable signals. Their recorded rejection reasons included occupied capacity, cooldown and the spread boundary defect. No evidence established a new pair/side selection loop. Re-entry restrictions, target tuning, wider limits and additional positions are outside this fix.

Only operational behavior and numerical correctness change. Broker credentials, private-network access, existing trade emails, risk amounts, position limits, strategy parameters, time stops, take profit and quote-age contracts retain their existing meanings. No raw account identifiers, trade exports or credentials are added to this record.

## Changes and justification

| Change | Why it is necessary | Verification |
| --- | --- | --- |
| Distinguish activation permission from immediate entry readiness | `enableTrading` records the desired enabled state; a temporary cooldown must not erase that state during maintenance | Real activation route, configuration persistence and engine signal processing during/after cooldown |
| Permit activation when the sole blocker is a bounded, active loss cooldown | Backup can restore enabled intent while the existing engine risk gate continues rejecting entries until the original deadline | Backup script → actual activation route → persisted state; snapshot finalized; expiry restores eligibility |
| Preserve rejection for other readiness blockers | Unresolved broker state, unsafe configuration and failed persistence must still prevent activation | Mixed cooldown/blocker and unavailable/malformed state tests |
| Make dashboard cooldown wording depend on the enabled state | A user pause must not promise automatic resumption; enabling during cooldown must not claim entries can start immediately | Actual frontend activation callback plus source parsing |
| Preserve an active cooldown across release replacement | The required new release cohort would otherwise clear the current run's cooldown merely by deploying this fix | Startup → new cohort → entry rejection; restart, another release and exact original expiry |
| Use floating-point error bounds for quote-derived comparisons | An exact configured limit must pass, while a real excess must still fail; rounding prices or widening the trading limit would change the policy | Broker-shaped cached/final quotes, GBP and JPY precision, BUY/SELL, exact limits and genuine excesses |
| Apply the correction to spread, execution movement and cost/stop checks | All consume quote-derived distances; fixing one check would leave another false rejection in the entry path | Strategy cost gate and engine entry/final-quote regressions |
| Advance release identities without resetting saved parameters | New decisions need their own execution cohort while the live experiment's numerical settings remain intact | Exact configuration equality across v3/v3.1 upgrades and restart, with nondefault settings and both enabled states |

### Activation and maintenance contract

Readiness retains `passed: false` and `status: COOLDOWN` while entries are cooling down. The additive `activationAllowed` field permits recording enabled intent only when readiness passes or the sole issue is a valid active cooldown. Persistence and broker lifecycle blockers explicitly make activation unavailable. `/trading/start` returns an enabled-but-cooling message when appropriate; it does not clear losses, shorten the deadline or submit an order.

The existing backup and deployment workflows continue restoring only a state they paused themselves. A previously disabled installation remains disabled. No alternative scheduler, maintenance state machine, authentication or notification channel is introduced.

Release replacement retains only an already-active cooldown's original deadline and provenance in durable run metadata. Retiring the previous active run and persisting its replacement happen in one SQLite transaction; failed insertion cannot leave a stopped owner with no replacement carrying its cooldown. In-memory sessions change only after commit. It does not merge historical trades, transfer an incomplete loss streak, change ownership, or restart the 24-hour period. Expiry clears the inherited restriction naturally. Unrelated historical runs remain separate.

### Numerical contract

Broker prices and calculated spreads retain their precision. The comparison allowance derives from machine epsilon and the original price magnitudes, expressed in the comparison's units. It represents arithmetic uncertainty, not an additional trading allowance. Spread uncertainty is propagated through cost/stop calculation. Tests distinguish exact boundaries from both a full broker tick and smaller representable excesses. Original decision price bounds and sizing remain unchanged.

The release identities are `m15-intraday-v3.2`, `intraday-risk-v3.2`, `broker-liquidity-v3.1`, strategy `1.1.2`. The v3 and v3.1 upgrade path replaces only those configuration identities. Existing analytics, orders and trades retain their prior run/configuration attribution.

## Validation and delivery

Validation completed:

- **659 backend tests across 37 suites passed in the final full run**, including real SQLite transaction rollback after successor insertion failure and restart recovery. The HTTP/Socket.IO suite uses permitted loopback socket access; external broker, persistence, email and storage effects in that server fixture are mocked.
- **15 backup scenarios passed**, including the real script calling the actual activation routes, durable disposable configuration, actual engine cooldown reconstruction, completed snapshot, expiry and preserved operator pause.
- **27 deployment/startup scenarios passed**, including the real activation route restoring enabled intent during cooldown after deployment health verification. Git, SSH, installation/build and process operations are stubbed.
- **19 operational-health scenarios passed.** Expected cooldown remains distinct from service failure.
- **3 frontend activation tests and 4 refresh-contract scenarios passed.** The actual dashboard callbacks are evaluated with mocked API/React state; no frontend build is run.
- Numerical regression coverage includes both directions and pip scales through pricing service → engine → durable intent → mocked order submission. Exact limits pass; a tick beyond fails; a real 1.2005-pip volume-weighted spread is retained and rejected. The shared helper also rejects a genuine 0.000001-pip excess. An independent 73,535-case boundary sweep found no mismatch.
- Release integration covers startup, persisted restart, a second update during cooldown, original expiry, the next loss starting at one, prior incomplete-streak isolation, unchanged attribution, and refusal to retire a run when its risk history cannot be read. Real SQLite insertion failures roll back both stopped and managing-only transitions; no runtime events claim success before commit.

Tests use disposable local persistence and mocked external operations. They place no orders and perform no real production backup, restart, deployment, email or upload. All numerical trading defaults were compared with the previous revision; only the three release identities differ. Syntax/parsing and whitespace checks pass. Frontend/production builds remain user-managed.

The user publishes local commits to GitHub, then runs the existing single command, `./scripts/deploy.sh`. No source edits, commits or reverse synchronization occur on production. The September 10 implementation did not re-enable production. An installation still disabled when deployed requires the dashboard's **Enable Live** control once; the bot retains any active cooldown until expiry.
