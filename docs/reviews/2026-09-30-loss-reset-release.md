# H1 reset after an initial stop — v4.2

## Authorization and purpose

On September 30 the user explicitly requested implementation and deployment of the proposed reset requirement. This authorizes local development, validation, local Git commits, publication to GitHub and deployment through `./scripts/deploy.sh` for this release. It supersedes the earlier user-managed publication/build/deployment restriction for this specific request. Source still travels one way: local → GitHub → production; no production source hotfixes or reverse synchronization.

The [preceding review](2026-09-30-repeated-usdjpy-review.md) found repeated normal sells after initial stops, each valid under v4.1. This is an authorized strategy experiment, not a duplicate-order repair or a demonstrated improvement in expectancy. The final breakout 3475 remains a valid setup and its protected breakeven outcome is acceptable. The new rule must not classify that outcome as another failed initial-stop setup.

Release identity: **m15-intraday-v4.2 / strategy 1.2.2 / intraday-risk-v4.2**. Implementation and delivery are in progress; verified results will be recorded below.

## Exact behavior

For each instrument and normal trade direction, consider the most recent broker-backed closed normal trade in that direction across all runs. An initial STOP_LOSS arms the reset requirement. A breakeven exit, including a tiny negative fill at a breakeven stop, does not arm it. Opposite-direction trades do not erase a stopped direction's history. Existing post-TP fade episodes retain their separate policy; a fade is not a normal trend trade.

After a confirmed broker stop time, require:

1. A completed H1 candle closing strictly after the stop for which the existing directional regime no longer qualifies.
2. A distinct later completed H1 candle for which that same directional regime qualifies again.
3. An otherwise-valid completed M15 breakout or pullback signal. Its close must be at or after the requalifying H1 close, and strictly after the stopped trade's close.

The regime is the existing complete predicate: price relative to EMA20, EMA20 relative to EMA50, directional indicator ordering and the configured ADX floor. A neutral phase is sufficient; a complete opposite trend is not required. No new price, time, indicator or risk threshold is introduced. BUY and SELL follow mirrored rules. An incomplete, future, invalid or unavailable candle is not evidence of a neutral regime.

The new check applies to both normal entry branches. Existing TP/breakeven freshness, post-TP fades, one-position-per-pair capacity, quote checks, 1.5R targets, +1R breakeven management, initial stop sizing, time/session exits and every numerical risk limit retain their current behavior. The existing P&L-based three-loss cooldown is separate and unchanged; accepting breakeven as a setup outcome does not silently change that risk counter.

## Evidence and durability

The stop anchor uses confirmed broker close-time evidence rather than a local receipt-time fallback. H1 regime history uses the same indicator calculations as the strategy, with valid warmup and completed-bar timestamps. A queued signal cannot use a reset that occurred after its own M15 close.

Reset evidence is stored separately from historical trades/configuration, in a distinct namespace of the existing durable runtime-state store. It is tied to the broker stop and directional-predicate settings, persists across scans, cache rollover, process restart and release changes, and cannot be reused for a newer stop or changed predicate. A later completed reset/requalification observation must not be lost to an older concurrent scan. Stored history remains attributable to its original run and release.

Signal generation updates reset evidence even when ordinary entry conditions are not actionable. Entry execution rechecks authoritative trade history and the same reset policy after broker reconciliation. A new stop, changed anchor, unavailable required evidence or stale queued decision cannot silently authorize an order. Existing position management continues while an entry is waiting. A fully qualifying normal reversal still closes its owned opposite position through the existing EXIT_ONLY path, without opening the blocked replacement; an existing fade retains its established exit policy.

## Observed examples and limits

At the previously recorded evaluations, the proposed rule retains breakout 3455 after an H1 reset, rejects pullback 3465 because the preceding stop was followed by no H1 interruption, and retains breakout 3475 after a later reset/requalification. These checks preserve a losing breakout as well as the acceptable breakeven breakout; they are not a retrospective ban on every loser.

Retained indicator-observation checks are not an alternative portfolio replay. The rule can miss profitable continuations after an ordinary ATR stop inside a persistent H1 trend. Removing an entry changes subsequent positions, cooldowns and opportunities. No expected profit or improved return is established by excluding 3465.

## Validation and delivery

Local validation completed on Node 22.23.1:

- **906 tests passed across 44 backend suites**, with no skipped tests, using an isolated temporary database and no broker credentials.
- Coverage includes mirrored policy cases; completed-bar and broker-time boundaries; missing/invalid/future evidence; both normal entry branches; unchanged TP/BE/fade behavior; actual signal-generation and broker-entry orchestration; a new stop discovered at reconciliation; durable reset through restart/cache rollover; concurrent older scans; lagging M15 history; existing reversal exits; saved configuration/enabled intent and active cooldown migration.
- Five retained-observation regression cases preserve 3455 and 3475 and block 3465 at their recorded evaluations; all 161 retained H1 eligibility observations match the shared predicate. This is not an alternative execution replay.
- Frontend production build passed. All **27 deployment orchestration tests passed**. `git diff --check` passed.

The pre-deployment read-only snapshot at 2026-09-30 03:54:07 UTC verified clean revision `672283897ebd0c26e4924757826c4d2dcd87f329`, enabled intent, no open positions/pending entries/uncertain exposure, and an active cooldown ending at **2026-09-30 22:13:58.006 AEST** (`1790770438006`).

At this pre-publication checkpoint, v4.2 is implemented and validated; publication and deployment are the next authorized steps. The existing deployment command will stage dependencies/tests/build, pause entries, require a flat reconciled broker, back up, fast-forward to the published revision, migrate/restart and verify health before restoring the previous enabled intent. Deployment must retain any already-active cooldown deadline. Final revision and verification results will be appended here.
