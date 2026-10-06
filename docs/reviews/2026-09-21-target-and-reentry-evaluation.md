# Target and re-entry evaluation — 21 September 2026

October 6 language-policy update: the original analysis scripts are retired from the current tree. The Git commands below inspect their preserved source; they do not rerun the study. Saved inputs, results and source hashes retain their historical provenance. Current tooling uses Node.js; see [the migration record](https://github.com/adamSellers/forex-trading-bot/blob/main/docs/reviews/2026-10-06-node-tooling.md).

**Historical study:** the results and September 21 decision below are retained as dated evidence. The [September 26 follow-up](#26-september-2026-follow-up) records the next sample and revised recommendation; see the [current status and decisions](2026-09-26-status-and-decisions.md) for outstanding work.

**The stronger target is worth testing, but this evidence does not justify changing the live default. A rule requiring a fresh post-exit pullback is now precisely specified and checked against losing and winning repetitions; it also removes a legitimate winner.** This work follows the [eight-day review](2026-09-21-eight-day-trading-review.md). It changes no trading rules or configuration.

The comparison uses all 15 observed entries from 13 September 10:35 through 21 September 10:35 UTC, plus the preceding ten entries as a separate reference cohort. New read-only OANDA M1 bid/ask candles cover each trade through its original six-hour/session deadline. Exact M15 midpoint candles establish which pullback bars preceded an exit. Saved broker transactions establish actual breakeven activation. The known-contaminated excursion aggregates are not used. OANDA defines the candle timestamp as its start and OHLC as aggregate prices within that interval; those fields do not timestamp the extrema. [OANDA candle definitions](https://developer.oanda.com/rest-live-v20/instrument-df/).

## 1. A paired 2R sensitivity, including the position constraint

The candidate was fixed at **2R**, compared with the existing **1.5R** target. No target grid was searched. Hold the observed entry fills, initial stops and all non-target outcomes fixed; extend actual target winners along the broker quote-side price path, retaining their already activated breakeven stop. Use bid for closing buys and ask for closing sells. Round target prices to the instrument's broker precision. Remove an observed later entry if the earlier extended position certainly still occupies the single position slot. Do not invent replacement entries.

| Cohort | Observed entries / price-distance R | Conditional entries / price-distance R at 2R | Capacity consequence |
| --- | ---: | ---: | --- |
| Eight-day v3.3 review | 15 / **−4.187R** | 14 / **−1.734R** | Extended 3195 excludes losing re-entry 3207 |
| Earlier ten, mixed v3/v3.1/v3.2 | 10 / **+2.809R** | 9 / **+2.785R** | Extended 3073 excludes winning re-entry 3085 |

**The reviewed week remains negative even under these favorable fixed-fill assumptions. The earlier cohort gains nothing from the larger target once the displaced winner is counted.** These R values divide executable entry-to-exit price movement by each original stop distance. They are not the review's AUD cash-risk-normalized R, an AUD return forecast, or the result of replaying the live runtime.

The three reviewed targets have broker-confirmed breakeven stops before their actual exits. Their conditional 2R levels are reached before any subsequent bar touches breakeven:

| Trade | Actual target exit, UTC | First complete M1 bar touching rounded 2R | Rounded target | Later observed entry excluded |
| --- | --- | --- | ---: | --- |
| AUD/USD SELL 3195 | Sep 14 06:50:47.965 | Sep 14 08:05–08:06 | 0.71355 | AUD/USD 3207 at 07:00:26.746 |
| USD/JPY BUY 3217 | Sep 14 13:48:20.698 | Sep 14 13:54–13:55 | 154.975 | None |
| USD/JPY BUY 3295 | Sep 15 23:37:42.138 | Sep 15 23:38–23:39 | 155.314 | None |

No other saved actionable decision occurred during 3195's extension before its 2R touch; 3207 is the only one. This makes the highlighted sequence particularly informative: retaining the original position through the retracement and resetting entry/stop levels produced different exposure. It does not prove that longer holds generally improve outcomes.

The earlier positive control matters. Extending 3073 to 2R occupies capacity until the 06:19–06:20 UTC bar on September 7, so the successful 3085 entry at 06:00:45 would be unavailable. The remaining earlier targets continue to 2R, but their larger gains are almost exactly offset by losing that continuation entry. Release differences prevent treating these cohorts as a controlled before/after experiment.

There is one useful M1 limitation: 3085's actual-close minute touches 2R but finishes below it; subsequent complete bars reach breakeven before another 2R touch. Under the assumed level fills, that standalone continuation is therefore **0R or approximately 2R**, with timing inside the boundary minute unresolved. It is excluded by capacity in the paired comparison, so this ambiguity does not affect the table. Trade 3097 had no confirmed breakeven replacement before its target; all bars through its later 2R touch remain above its entry, so retaining its original stop or activating breakeven produce the same conditional result. No continuous breakeven monitoring is assumed.

Executable-side candles include spread. The study does not subtract historical half-spread costs again. It keeps entry slippage already present in filled prices, but assumes an alternative target exit at its rounded level. Alternative fill slippage, changing position sizes, AUD conversion, exact quote/order timing, newly available entries and later risk-state changes remain unmodelled. Earlier complete scan history is unavailable. This is a constrained sensitivity check, not a full alternative-strategy performance estimate.

## 2. Precisely testable re-entry candidates

The existing trigger accepts a later completed M15 candle as a new setup. Its pullback test looks at four prior candles against the EMA20 **at the new signal candle**, and separately accepts an eight-bar breakout. Filled setup suppression already prevents duplicate same-candle orders.

A prospective candidate can be specified without choosing an arbitrary delay:

> After a same-pair, same-direction target or breakeven exit, require at least one of the four prior completed M15 candles used by the next trigger to start at or after the broker-confirmed exit and touch the new signal's EMA20: low ≤ EMA20 for a buy, high ≥ EMA20 for a sell. All existing regime, candle, resumption, RSI, cost and execution checks remain required. Apply this additional condition to both breakout and pullback entries.

The anchor is the most recent broker-confirmed closed trade in that pair. Apply the condition only when that trade exited at target/breakeven and the proposed entry repeats its direction; opposite-direction entries and entries following other exit reasons retain the existing rules. A rejected attempt does not consume the condition. After a subsequently filled trade closes, that new closed trade becomes the anchor. This defines a stateful candidate for future evaluation; the table below classifies actual historical predecessors rather than pretending those predecessors remain unchanged after alternative rejections.

Requiring a **fully post-exit candle** makes timestamp meaning explicit. It is deliberately stricter than a touch somewhere inside an exit-straddling candle; such a bar does not establish whether its touch preceded closure. This is a candidate strategy change, not a repair to duplicate-entry handling. Comparing against the current signal EMA preserves the existing pullback calculation; comparing each old bar to its contemporaneous EMA would be a different candidate.

All nine target/breakeven → next same-pair episodes repeat the same direction:

| Sequence | Next outcome / actual AUD | Fully post-exit touching bar in four-bar window? | Additional H1 regime reset observed? |
| --- | ---: | --- | --- |
| 3073 → 3085, earlier | Target / +0.2693 | **No** | Earlier scans unavailable |
| 3085 → 3097, earlier | Target / +0.2694 | Yes | Earlier scans unavailable |
| 3097 → 3109, earlier | Time stop / +0.0219 | Yes | Earlier scans unavailable |
| 3121 → 3133, earlier | Stop / −0.1926 | **No** | Earlier scans unavailable |
| 3195 → 3207 | Stop / −0.1604 | **No** | No |
| 3217 → 3261 | Breakeven / 0 | Yes | Yes |
| 3239 → 3251 | Stop / −0.1701 | **No — touch only in exit-straddling bar** | No |
| 3261 → 3273 | Stop / −0.1829 | Yes | No |
| 3295 → 3317 | Stop / −0.1760 | Yes | Yes |

This candidate filters the highlighted 3207 and earlier failed 3133 because their pullback touch evidence is entirely pre-exit. It retains earlier successful continuation 3097, but also rejects successful 3085. It retains losing 3273 because two prior candles genuinely satisfy the fully post-exit touch condition. Freshness alone does not establish a profitable setup.

For 3251, the touching M15 candle is 06:00–06:15 UTC, while the previous breakeven exit is at 06:14:10.197. Its M1 boundary bar cannot establish the touch's exact ordering relative to that exit. The strict candidate rejects it by definition; the data does not establish that no post-exit touch occurred.

Two alternative formulations have different consequences:

- **Restrict only the pullback branch:** this removes only 3251 among these nine episodes. The highlighted 3207 and earlier failed 3133 also passed breakout, so they still qualify. Merely discarding old pullback evidence does not address the reported sequence.
- **Require an H1 neutral/opposite regime before same-direction re-entry:** this excludes the three reviewed episodes 3207, 3251 and 3273, but retains 3261 and 3317 after observed neutral regimes. Earlier scan history does not support an equivalent positive-control comparison. This is substantially broader than a fresh-pullback condition.

These are screens of **observed episodes**, not portfolio simulations. Adding any gate frees capacity and changes the identities of subsequent entries and exits. The removed trades' historical P&L must not be presented as an expected improvement. Likewise, requiring only the new signal candle to start after the exit excludes both loser 3207 and winner 3085; a candle-recency rule does not separate them.

## 3. Decision and next evidence

Keep the current target and re-entry behavior while the measurement correction is validated. The concrete research candidate is **2R paired with the all-trigger fresh-post-exit pullback condition**, evaluated alongside each individual change and the unchanged baseline. This specifies what to compare; it does not select a winner or authorize a silent live rule change.

The next useful observation is whether new qualifying entries use pre-exit or fully post-exit pullback evidence, including successful continuations and entries rejected by capacity. Retain the broker exit anchor, touch-bar timestamp, trigger combination, contemporaneous completed-candle context, and actual execution decision. Compare all opportunities by release cohort; account for breakeven and capacity before attributing a difference to targets. A read-only classification of the existing signal stream can collect this evidence without rejecting trades or creating simulated orders.

The current study establishes that the reported pattern can be explained by legal repeated exposure, that a longer original hold would change the highlighted sequence, and that the same changes can remove profitable continuations. It does not establish an optimal target or a consistently beneficial re-entry gate.

## Historical calculation sources

Inspect the preserved calculation source with `git show af2c14da80255b07b9415af6430a476da1ff9507:docs/reviews/evidence/2026-09-21/evaluation/analyze.py`. The retained [inputs](evidence/2026-09-21/evaluation/inputs.json), [broker candles](evidence/2026-09-21/evaluation/market-data.json), [results](evidence/2026-09-21/evaluation/results.json) and [README](evidence/2026-09-21/evaluation/README.md) preserve the historical calculation evidence without production access. The original script checked the 25/15 entry counts, lack of actual position overlap, price-side R calculation and explicit ambiguity handling. No credentials, account identifiers, full operational export, production changes, replacement entries or simulated order records are retained in these artifacts. Conditional exit levels are retained explicitly as research assumptions.

## 26 September 2026 follow-up

The [next review](2026-09-26-follow-up-trading-review.md) covers all ten trades since the September 21 cutoff: **−A$0.5369**, bringing the unchanged v3.3 run to **25 trades / −A$1.2693**. Read-only production inspection verified clean revision `5889b66` and the deployed measurement correction; all ten new excursion records are version 2 / VERIFIED. Strategy `1.1.3`, the 1.5R target and the existing re-entry and risk rules remain unchanged. This is deployment verification, not an established deployment timestamp.

The new target comparison retains confirmed breakeven stops and one-position capacity. Actual 1.5R outcomes total **−3.23645 price-distance R**; the conditional 2R sensitivity totals **−3.27266R**, slightly worse. EUR/USD 3381 reaches breakeven before its later 2R touch, and extending that position displaces losing re-entry 3393. The September 21 improvement therefore did not generalize to this next sample. **The current recommendation is to keep 1.5R for the next proposed change**, superseding the earlier priority of testing 2R paired with the freshness condition. The original results above remain unchanged.

The precisely specified fresh post-exit pullback candidate excludes failed EUR/USD repeat 3393, whose touch evidence preceded the prior target exit, while retaining successful repeat 3381 and later losing AUD/USD repeat 3425. Both trigger branches must be covered because 3393 also passed breakout. When 3393 is omitted, the later 3413 still qualifies using retained predecessor 3381 as its anchor. The earlier rejected winner 3085 remains a counterexample. These fixed-fill sensitivities do not replay replacement entries, sizing or changed cooldown timing and do not establish portfolio improvement.

**Prioritize local implementation and orchestration validation of this freshness candidate; it is not implemented or approved as a new live default.** Pullback-only entry quality is the next research focus: all five new pullback-only entries lost, but their ordering is confounded with changing market conditions, so this is not a validated exclusion rule. Keep the separate serialized-price risk mismatch in the follow-up report as an execution correction preserving existing limits; actual fills stayed below their budgets. The [current status and decisions](2026-09-26-status-and-decisions.md) distinguish these recommendations from implementation and deployment status.
