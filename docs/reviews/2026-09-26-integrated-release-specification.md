# Integrated entry and execution release — 26 September 2026

> **September 28 deployment and capacity addendum:** Read-only inspection verified user-deployed v4 at clean `aed750f`, strategy 1.2.0 / `intraday-risk-v4`. The implementation and original 834-test validation below remain the September 26 record. The user subsequently requested removal of the account-wide position cap. The separate [v4.1 pair capacity release](2026-09-28-pair-capacity-release.md) supersedes this document's one-position preservation rule with one position per pair and unchanged portfolio/risk checks. V4.1 is implemented and locally validated with latest passing results covering 850 tests across 41 backend suites plus changed JSX syntax checks; publication/build/deployment remain pending. No historical study or test result below is rewritten by that decision.

## Authorization and delivery state

The user authorized preparation of this integrated specification and local implementation on September 26, following the complete [performance review](2026-09-26-follow-up-trading-review.md) and discussion of fading failed-freshness post-target re-entry signals. This is one live `intraday_momentum` strategy, release **m15-intraday-v4**, strategy **1.2.0**, execution policy **intraday-risk-v4**. It combines entry-quality research, protected-exit freshness, an explicit countertrend experiment, exact serialized-price sizing and review telemetry. Publication, builds and deployment remain user-managed; the last verified production release remains v3.3.

Implementation and validation results are recorded at the end of this document. No claim of profitable expectancy follows from implementing these rules.

## Evidence and selected hypotheses

The unchanged v3.3 cohort contains 25 trades, net −A$1.2693. Fourteen pure-pullback trades account for −A$1.0426. Trigger and chronology are confounded; no pair, direction, ADX, RSI, session or stop-width threshold is selected from that losing subgroup. Six of seven new losers showed less than +0.5R sampled favourable movement. The freshness condition screens one of ten new observed entries, so it cannot address the whole problem.

The pullback change below was specified structurally before measuring its historical exclusions. Earlier candles currently use the signal candle's EMA values, and two-bar resumption can omit an older touch candle's extreme. The selected hypothesis asks for a contemporaneous touch and clearance of the subsequent pullback structure. This is a strategy experiment, not a demonstrated broker or indicator calculation defect.

The [retained pullback investigation](evidence/2026-09-26/integrated-release/pullback-README.md) excludes five of 35 actual fills, including two winners; their combined actual P&L was **+A$0.0315**. Thus it does not improve this retrospective total. All five exclusions lack an own-bar touch; the extended resumption window excludes no additional actual fill in this sample. Available attempted setups change 59→55; 18 GBP/USD attempts lack retained candle coverage. These results delimit the experiment and are not a reason to claim validated improvement.

Four retained post-TP/no-freshness episodes permit a separate [opposite-direction path check](evidence/2026-09-26/integrated-release/fade-findings.md). With the prespecified existing stop distance, 1.5R target and +1R breakeven, the classification is two fade targets and two fade stops, **+1.00536 conditional price-R** across mixed releases. In particular, original losing 3207 also loses when faded. Retained executable bid/ask candle paths cannot establish hypothetical fills or exact intraminute stop-management timing. The evidence justifies a bounded live experiment, not a proven reversal edge.

## 1. Pullback and resumption

Keep the existing H1 regime, M15 alignment, RSI, candle quality, four-bar pullback window, eight-bar breakout, costs and sessions. For the pullback branch:

- Each of the four prior completed M15 candles must close on the trend side of **its own** EMA50.
- At least one of those candles must touch **its own** EMA20: low ≤ EMA20 for BUY, high ≥ EMA20 for SELL.
- Identify the most recent qualifying touch. The signal must close beyond the directional extreme from that touch through the last prior candle, and still beyond the existing two-bar resumption extreme. BUY closes above the maximum high; SELL closes below the minimum low.
- Keep the directional signal candle requirement. Breakout remains an independent branch; record whether breakout, pullback or both qualify under the revised definition, alongside legacy pullback flags for review.

This changes first entries and repeats. A fade must originate from an otherwise-valid signal under these revised rules; obsolete weak signals are not retained solely to create fades.

## 2. Protected-exit freshness and fade decision

Use durable broker-confirmed closed live trades in the same instrument, ordered by broker close time, across release boundaries. The most recent normal closed trade anchors the decision. A close is protected when its recorded outcome is TAKE_PROFIT or BREAKEVEN_STOP. Use broker close time, never local observation/receipt time.

Resolve that time from matched explicit close-time evidence or the retained broker CLOSED-trade/full-close response. The legacy `brokerClosedAt` field can contain a local fallback, so it alone cannot prove freshness. Fallback timestamps may locate the latest recorded close; if a same-direction protected anchor lacks broker time proof, wait for evidence. Opposite-direction and unprotected normal entries retain their existing eligibility.

For a same-direction repeat after a protected exit, require at least one of the four prior completed M15 candles to **start at or after** that exit and touch the **new signal's EMA20**. This preserves the previously specified freshness test; it is intentionally distinct from each-bar EMA semantics in ordinary pullback qualification. A candle straddling the exit cannot prove a post-exit touch. Apply freshness to both trigger branches.

The new signal candle must **complete strictly after** the protected exit. An already-completed signal cannot be repurposed as a fade merely because changing direction/type produces a different setup ID. A signal candle spanning the TP may qualify once complete; it still cannot serve as a prior fresh-touch candle.

| Event | Action |
| --- | --- |
| First entry, opposite-direction normal signal, or repeat after another normal exit reason | Normal qualifying entry |
| Same-direction repeat after TP/BE with fresh touch | Normal continuation |
| Same-direction repeat after a normal TP without fresh touch | One opposite-direction fade may enter |
| Same-direction repeat after BE without fresh touch | Wait for freshness; no fade |
| Original direction after a filled fade, still without fresh touch | Wait; do not fade again |

The normal trend signal qualifies the fade event; the executed side is reversed. Do not require the opposite H1 trend, since that would contradict the countertrend experiment. Do apply all existing direction-specific shorting, price, cost, exposure, cooldown, capacity and risk checks to the actual order.

### Episode lifetime and persistence

Persist the originating normal TP trade ID, broker ID, side, broker close time, original signal side/type and freshness evidence with every fade signal, intent and filled trade using existing JSON metadata. One **filled** fade consumes that TP episode. A local pre-submission price rejection does not consume it; existing same-setup retry rules and first decision-price anchors remain in force. Submission uncertainty retains the existing broker reconciliation block.

While a fade is open, normal signals do not close it through SIGNAL_REVERSAL. A fade signal also cannot close an existing position to make room. Existing stops, target, breakeven, timed/session exits and broker management own its exit. On restart, recover provenance from the persisted trade/intent evidence.

If the latest closed trade is a fade, carry its original normal TP anchor and the consumed state forward. Its own TP/BE/SL cannot arm another fade or erase the original freshness requirement. A qualifying fresh continuation or independent opposite normal entry may subsequently fill; when that normal trade closes it becomes the new anchor. No new clock-based waiting period is introduced.

Revalidate the anchor after authoritative broker reconciliation within the serialized entry execution path. A queued signal whose anchor/consumption decision has changed must be rejected and reevaluated by the next ordinary scan. Missing required provenance must not silently grant fade eligibility.

## 3. Exits and risk

Normal and fade entries retain stop=max(1.25 M15 ATR, six pips), the existing 1.5R target, breakeven at +1R, six-hour deadline and New York 16:45 closure window. For a fade, construct protection on its actual side around its executable entry; do not reuse the original direction's stop/target prices. This fixed baseline was chosen before inspecting fade outcomes and is not optimized across targets.

Preserve 0.25% entry risk on capped/buffered sizing capital, the A$100 ceiling, one concurrent position and all existing portfolio/loss protections. Fade outcomes participate in the same account, run and loss cooldown. A new release creates a distinct cohort while retaining existing open-trade ownership/exit policy and any active cooldown deadline.

## 4. Serialized-price correctness

Normalize broker order prices before final sizing, validation and persistence. Round an adverse market-order bound inward (BUY downward, SELL upward) at the instrument's display precision so formatting cannot expand the original permitted deviation. Size against the exact serialized bound and stop, and persist those exact prices. Normalize fill-aligned protection before comparing or persisting it. Preserve the existing numerical movement and cash-risk limits; verify BUY/SELL and JPY/non-JPY through the real client serializer.

A half-tick fill-alignment case reproduced during implementation can otherwise increase risk after a better fill because the newly aligned stop rounds independently. When necessary, cap the aligned stop at the nearest broker tick toward the fill that preserves the persisted cash-risk budget. Existing attached protection and recovery remain active. This additional boundary was reproduced in isolated tests, not observed in production.

This fixes a reproduced permitted-worst-fill mismatch. Reviewed actual fills were within budget; the correction is not an explanation for negative expectancy.

## 5. Attribution and weekly review

Persist revised and legacy trigger flags, touch/resumption evidence, original versus executed direction, normal/fresh-continuation/fade classification, anchor and fresh-touch evidence. Populate existing scalar RSI fields from the already-calculated RSI, retaining unknown as null. The deployed version-2 excursion correction stays intact.

Review the new release's total net AUD, cash-risk R, costs, drawdown and cooldowns, then distinguish normal breakout/pullback/both and fade entries. Count distinct eligible episodes and filled/rejected decisions, not repeated scans as independent opportunities. Keep v3.3 and older results separate. Multiple simultaneous changes limit causal attribution; hypothetical excluded entries are not executable control returns. One week's duration does not guarantee enough fade episodes to infer expectancy.

The existing trigger-performance table separates trend and post-TP fade entry classes while preserving the original breakout/pullback flags. A fade's profit or loss therefore cannot be silently attributed to normal trend entries with the same source trigger.

S3 destination choice, independent restore and email-delivery verification remain separate operational follow-ups. No new notification, authentication, capital, strategy-selection or deployment workflow is introduced.

## Acceptance and completion record

Required checks: structural pullback healthy/failure examples; both-trigger freshness; TP/BE/other exits and opposite continuations; exit-straddling timestamps; mirrored fade direction/protection; one filled fade per TP through restart; no recursive fade; no signal-reversal closure of fades; stale-anchor rejection after reconciliation; retry/reference preservation; saved enabled/settings/cooldown/owner-policy migration; scalar RSI persistence; exact serialized BUY/SELL precision and budget boundaries; relevant regression suite on supported Node.

**Implemented and locally validated; not published or deployed.** The [validation record](evidence/2026-09-26/integrated-release/validation.json) records **834 passing tests across 41 backend suites on Node 22.23.1**, including real SQLite persistence and engine-to-real-client serialization with broker transport stubbed. The full run passed 823 tests; ten API/socket tests required localhost-listener permission and passed on the isolated rerun. The final 73-test analytics run replaces its earlier 72-test result. These are the latest passing results for every suite, not a claim of one single all-green invocation.

The changed analytics JSX passed parsing with the installed Babel parser. No frontend build was run under the user-managed build workflow; no ESLint script/tool is installed. Both retained Python investigations reproduce successfully. The deprecated price-bound reproducer intentionally asserts the former behavior and remains historical evidence; current execution regressions cover the corrected boundary.

Integration checks include actual broker-shaped TP/SL closure followed by restart, both fade directions and all source trigger combinations, price rejection/reconsideration with the first reference intact, consumed-parent persistence, no recursive fade, owner exits, same-candle reuse rejection, broker time proof versus local fallback, stale-anchor rejection following reconciliation, scalar RSI through SQLite, release settings and cooldown preservation, exact broker price bounds and budget-preserving fill alignment. The existing excursion-lifetime regression remains passing.

Source/test hashes are retained in the validation record. No broker calls, live orders, source commits, publication, frontend/production builds, production restart or deployment were performed for this implementation. The next delivery step is the existing user-managed publication/build/deployment workflow. Forward expectancy and the number of natural eligible fade episodes remain open experimental questions.
