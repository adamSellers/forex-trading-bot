# Pullback sequence investigation and implementation evidence

October 6 language-policy update: the original analysis scripts are retired from the current tree. The Git commands below inspect their preserved source; they do not rerun the study. Saved inputs, results and source hashes retain their historical provenance. Current tooling uses Node.js; see [the migration record](https://github.com/adamSellers/forex-trading-bot/blob/main/docs/reviews/2026-10-06-node-tooling.md).

The authorized integrated release uses `bar-aligned-pullback-resumption-v1` as a **structural live experiment, not a validated profitability improvement**. The existing rule deliberately compared prior candles with the new signal's EMA values; this investigation does not reclassify that former definition as a software defect. The new definition asks whether a touch occurred against the indicator at that bar and whether the later signal clears the intervening structure.

## Frozen candidate

[pullback-prespecified-candidate.json](pullback-prespecified-candidate.json) was written before running this candidate's outcome comparison. The previously reviewed losing subgroup and trade outcomes were already known, so this is not untouched out-of-sample evidence.

Keep the existing numerical settings and breakout branch. Within the preceding four completed M15 candles:

- A long touch requires a low at/below that candle's own EMA20; a short touch requires a high at/above its own EMA20.
- All four closes must remain on the trend side of their own EMA50, with the existing strict comparison.
- Select the latest touch. The directional signal candle must close beyond every high for a long, or low for a short, from that touch through the final prior candle. Keep the prior-two-bar confirmation as the minimum window when the latest touch is more recent.

The separate fresh-post-exit condition retains its prespecified **signal EMA20** reference. It answers a different question and is implemented separately; this study does not silently change that contract or evaluate the fade branch.

## What the retained observations show

All **35 saved trade trigger classifications reproduce exactly** from their saved EMA values and retained midpoint M15 candles. The candidate retains 30 actual fills and excludes five pure pullbacks:

| Trade | Cohort | Actual outcome | Actual net AUD |
| --- | --- | --- | ---: |
| 3097 | Earlier mixed-release ten | Take profit | +0.2694 |
| 3217 | Previous review fifteen | Take profit | +0.2808 |
| 3251 | Previous review fifteen | Stop loss | -0.1701 |
| 3337 | Previous review fifteen | Stop loss | -0.1871 |
| 3425 | Latest review ten | Stop loss | -0.1615 |

Those five actual outcomes total **+A$0.0315**, so their omission does not support a claim of historical improvement. The latest cohort retains both winners and excludes one loser; four of its five losing pure pullbacks remain. First-entry and repeat-entry observations are both included, without selecting pairs, sessions or indicator thresholds. Of the five excluded trades, three followed an observed same-direction protected exit and two did not. This is observed-tape classification, not an evolving alternative anchor history.

All five excluded trades lack an own-bar EMA20 touch. Four other former overlap entries become breakout-only and remain eligible; another former breakout-only entry gains pullback membership when its closes are compared with their own EMA50. The longer resumption comparison causes no additional exclusion of these 35 actual fills. Its live effect remains a hypothesis, with synthetic tests covering the intended sequence and healthy counterpart.

The latest full scan capture contains 288 distinct completed-candle observations reaching trigger evaluation, including 77 attempted setups. Retained M15 history covers AUD/USD, EUR/USD and USD/JPY: **206 observations and 59 attempted setups** can be evaluated; **82 observations and 18 attempted GBP/USD setups** are explicitly unavailable. There are no differing saved M15 contexts among repeated scans of the same candle.

For the available observations, original versus candidate trigger counts are **65 → 60**, with no newly qualifying trigger. Available attempted setups change **59 → 55**. These counts are not independent executed trades or counterfactual returns. Cost, position capacity, broker execution, cooldowns and dynamic risk state are not replayed. Earlier reduced scan evidence retains regime alone, so this study does not reconstruct earlier unfilled opportunities.

## Inspect the historical source

The original calculation used the standard library and made no network or broker calls. Inspect its preserved source:

```sh
git show af2c14da80255b07b9415af6430a476da1ff9507:docs/reviews/evidence/2026-09-26/integrated-release/pullback-analysis.py
```

- [pullback-results.json](pullback-results.json): every classified trade and available/unavailable trigger-stage observation, own-bar indicator values, old/new touches, structure and resumption boundaries, and cohort summaries.
- [pullback-opportunities.json](pullback-opportunities.json): account-free reduced full-scan fixture. It stores the source capture hash, completed-candle contexts and grouped decision outcomes, not credentials, account identifiers or operational configuration.
- [Retired pullback-analysis.py](https://github.com/adamSellers/forex-trading-bot/blob/af2c14da80255b07b9415af6430a476da1ff9507/docs/reviews/evidence/2026-09-26/integrated-release/pullback-analysis.py): the original backward EMA recurrence from the saved signal-bar EMA, using the original completed candle closes. It avoided reseeding EMA from a shorter historical download and asserted original flags and signal close values against retained live records. Its former extraction option reduced local raw captures. Recalculating the study requires a validated Node.js replacement.

The runtime implementation is in `backend/src/strategies/intradayMomentum.js`; its dedicated suite passed **36 tests on Node 22.23.1** at handoff. Eleven added cases cover symmetric own-bar touch rejection, older-touch resumption rejection and healthy acceptance, own-EMA50 validity and invalidity, and unknown warmup RSI. Existing default-entry/cost/session/freshness checks remain passing. This focused result is separate from the integrated release's full orchestration and regression validation, recorded in the release specification.
