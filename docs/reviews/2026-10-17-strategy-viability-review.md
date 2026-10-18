# Forex strategy viability review

Review date: 17 October 2026, Sydney.

**Recommendation: SCRAP the current v6 rule set as a live strategy.** Preserve the execution and evidence infrastructure. A redesign would be a new research candidate; this review has not demonstrated a profitable component that deserves another live tweak.

Statistical evidence for positive expectancy is **INCONCLUSIVE**, which fails the registered KEEP criteria. Six synthetic cases finish slightly positive, so this is not a claim that all modeled outcomes lose or that profitable FX trading is impossible. The decision rests on unresolved expectancy, poor temporal stability, cost sensitivity and achieved cadence.

## What was evaluated

The selected live strategy is v6, intraday_momentum 1.4.0. The review holds its numerical rules fixed: H1 regime, M15 quality/EMA/RSI, pair sessions, distinct break/retest/confirmation, frozen episodes, loss reset and protected-exit rules, actual portfolio/margin checks, 1.5R target, +1R breakeven, six-hour exit and New York session closure. No parameter search or alternative live candidate was selected.

All 72 compared trading-rule configuration fields in the deployed file match the checked-in defaults used by the evaluator. Enabled intent and notification/operational preferences are excluded from that rule comparison. Historical cases evaluate the strategy with entries enabled. See [configuration parity](evidence/2026-10-17/live-config-parity.json).

The portfolio evaluator uses the actual coordinator, generator, entry queue, risk checks, durable intents, migrated SQLite repositories, broker-shaped responses, protection, management and reconciliation. Each model starts at A$100, evolves its own cash and eligibility, and carries state continuously across calendar years. Open boundary positions remain open. Costs and outcomes from one model do not determine another model's eligibility.

The live results must stay separated by release. The broker-verified v3.3 cohort was 25 trades, 6 positive / 16 negative / 3 flat, net −A$1.2693. The retained v5 cohort was three trades, two losses and one flat, net −A$0.3478. The latest loss, EUR/USD BUY 3519 on October 7, occurred before v6 deployment. Current v6 has no live outcomes, so neither the older losses nor its ten idle days estimate v6's expectancy. They do establish that repeated live revisions have not supplied evidence of a profitable strategy. See the [September cohort review](2026-09-26-follow-up-trading-review.md) and [October incident](2026-10-07-eurusd-breakeven-repeat.md).

The long cohort scores March 2020 through August 3, 2026, with a 40-day unscored prefix. A separate recent cohort scores September 15 through October 16, 2026, with its own 40-day prefix. The August 3–5 data gap is not invented or bridged. The recent cohort is a counterfactual cold start under current rules, not a reconstruction of the live run's inherited state. All data is retrospective; none is an untouched holdout.

## Results after modeled costs

| Cost world / path | Closed trades | Net A$ | Mean net R | Profit factor | Sampled max NAV drawdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Optimistic / OHLC | 40 | 0.6599 | 0.0888 | 1.225 | 1.041% |
| Optimistic / OLHC | 40 | 0.3881 | 0.0515 | 1.132 | 1.203% |
| Current medians / OHLC | 28 | 0.4256 | 0.0789 | 1.201 | 1.328% |
| Current medians / OLHC | 28 | 0.7046 | 0.1334 | 1.333 | 1.330% |
| P90 stress / OHLC | 28 | 0.0415 | 0.0073 | 1.019 | 1.384% |
| P90 stress / OLHC | 28 | 0.0116 | 0.0015 | 1.005 | 1.409% |
| Archive component proxy / OHLC | 2 | -0.1101 | -0.2817 | 0.000 | 0.299% |
| Archive component proxy / OLHC | 3 | -0.0845 | -0.1424 | 0.233 | 0.274% |

All cases start at A$100, end flat, and include modeled spread, execution slippage and the once-per-settlement conversion markup. Net excludes unavailable historical financing. OHLC and OLHC specify the two assumed intrabar traversal orders. R uses immutable original filled-entry-to-stop risk in AUD, not a later moved stop.

[Complete case reduction](evidence/2026-10-17/viability-full-summary-r3-complete.json) and [independent accounting](evidence/2026-10-17/economic-audit-r3-full.json) retain every case, annual/quarterly/pair/side bucket and exact result hash.

The six coherent synthetic worlds earn only **A$0.0116–A$0.7046 over 6.42 years** on the A$100 starting portfolio. Current-median worlds earn A$0.4256–A$0.7046; stress leaves A$0.0116–A$0.0415. The archive-component proxy loses A$0.0845–A$0.1101, but its price-contract mismatch prevents treating that loss or its tiny count as exact real-account performance.

**Every synthetic case is negative in each calendar period from 2022 through partial 2026.** Its positive full-history balance comes from 2020–21. The median-cost breakdown shows the dependence:

| Entry year | Trades, either path | Median-cost net A$, OHLC | Median-cost net A$, OLHC |
| --- | ---: | ---: | ---: |
| 2020 | 3 | 0.4505 | 0.4511 |
| 2021 | 8 | 0.8728 | 1.1496 |
| 2022 | 2 | -0.1989 | -0.2006 |
| 2023 | 2 | -0.3884 | -0.3885 |
| 2024 | 1 | -0.0678 | -0.0678 |
| 2025 | 8 | -0.2243 | -0.2253 |
| 2026 (through Aug 3) | 4 | -0.0183 | -0.0139 |

These are retrospective entry-year groupings of closed outcomes; there are no open boundary trades. No annual portfolio reset or forced final liquidation creates these totals.

## Trade frequency and the frozen levels

The recent cohort produced **zero actionable entries and zero trades** in all eight cost/path cases over 2,292 distinct M15 boundaries and 32 calendar days. Expectancy and win rate are undefined for that cohort.

An independent actual-policy audit found **34 raw confirmation candles across 32 breakout episodes**. Of 33 confirmations with computed H1 context, 20 had neutral/weak regimes and 13 faced the opposite trend; none aligned. All 34 failed an earlier strategy gate before costs could decide entry. The independent final pattern states exactly matched the persisted model.

The separate long-history raw-pattern screen recorded 1,497 confirmations: 56 BUY and 1,441 SELL. Only 111 aligned with H1. It models no fills or consumption and is not an attainable portfolio trade count. In that continuous lineage, frozen AUD/USD and USD/JPY BUY levels from March 2020 survived through August 2026; EUR/USD and GBP/USD BUY levels from September 2022 also survived. The no-expiry rule can keep a direction waiting for years. Live inspection separately found EUR/USD SELL waiting on a September 25 level and USD/JPY BUY waiting on a September 30 level.

This behavior matches the [selected v6 contract](2026-10-07-buy-retest-release.md): an unfilled BUY confirmation expires, but the broken level remains until a completed close at/below it cancels the episode. A new range, regime, session, restart or elapsed time does not replace it. SELL clears its episode after an expired confirmation; both sides can wait indefinitely before confirmation. The design was intended to prevent repeated BUY continuations within one market idea. The multi-year persistence consequence was not established by that release's validation. It is a design and starting-state sensitivity, not a demonstrated code/contract mismatch.

The attained median and stress portfolios make **28 entries across 6.42 years: 4.36 per year, or 0.358 per 30 calendar days**. They have 56 empty months out of 78 touched months, including partial boundary months. Their longest actual inter-entry gap is **495.875 calendar days**, containing 33,871 retained M15 boundaries across 425 observed UTC dates. Both ends are observed entries, so that gap is not boundary-censored.

Optimistic worlds make 40 entries, or 6.23 per year / 0.512 per 30 days, with 51 empty months. Their longest inter-entry gap is 382.896 days, containing 26,097 M15 boundaries across 328 UTC dates, also uncensored. The recent zero-entry window is censored at both ends. These are conditional historical cadences, not forecasts; repeated scans are not independent opportunities. See the [cadence audit](evidence/2026-10-17/cadence-audit-r3-full.json).

All 28 median/stress fills are SELLs: 15 USD/JPY, seven AUD/USD and six EUR/USD. Optimistic worlds add 12 GBP/USD fills, with only one BUY across the entire 40-trade history. Current BUY viability is therefore unestablished. USD/JPY supplies much of the median profit but becomes negative under both stress paths; this review does not establish a profitable pair or side to select retrospectively.

## Costs and what the prices establish

The current-account open-market quote summary had medians of 0.8 pip AUD/USD, 1.0 EUR/USD, 1.5 GBP/USD and 1.0 USD/JPY. GBP/USD exceeded the 1.2 pip admission ceiling on about 95.3% of those repeated observations. These are present-account scan distributions, not reconstructed historical spreads.

The eight models cross two declared OHLC traversal paths with four cost worlds: optimistic observed minimum spreads and zero slippage; current median spreads and 0.2 pip adverse execution slippage; current p90 spreads and 0.5 pip adverse slippage; and archive-native component prices with 0.2 pip slippage. The constant-spread worlds derive coherent side candles and quotes from midpoint; they are explicit alternative price worlds. Constant median/p90 GBP/USD spreads exceed the 1.2 pip gate and exclude that pair by construction; actual observations met the gate about 4.7% of the time, so these worlds do not reconstruct joint signal/spread availability or forecast exact live cadence. The archive-native case synchronizes independent component extrema by assumption.

All final cases also include the current **1% home-currency settlement markup**: foreign P/L converts at the modeled midpoint AUD cross ×0.99 for gains or ×1.01 for losses. The fee is applied once, and it affects sizing and later account eligibility through a complete rerun. The broker's current USD and JPY factors independently confirm these ratios, and retained October 7 transactions already include the fee in live net P/L. See [OANDA's conversion-fee contract](https://help.oanda.com/au/en/faqs/home-currency-conversion.htm), [factor proof](evidence/2026-10-17/home-conversion-proof.json) and [cost audit](evidence/2026-10-17/cost-contract-audit.json). Current fees applied to old prices are a sensitivity model, not a reconstruction of each year's account terms.

The final model uses the four instruments' authenticated current 3.3333% broker margin rates, price precision and whole-unit contract; the bot's own 20× leverage ceiling remains unchanged. Explicit commission is zero in the declared cases. Reported modeled net excludes unavailable historical financing, which is modeled as zero; any rollover exposure is reported separately from the final outputs. Midpoint conversion and supplied instrument marks remain modeled observations; they do not establish exact historical account NAV or fills.

OANDA candles contain separate bid/ask/midpoint OHLC values, while the pricing API supplies account ClientPrice observations. A component-close difference is not a verified simultaneous executable spread. The recent candle archive had no EUR/USD or GBP/USD component-close differences within 1.2 pips, despite current account quotes often meeting that gate. It would be misleading to use that proxy alone to conclude the real account could never trade. See [OANDA candle definitions](https://developer.oanda.com/rest-live-v20/instrument-df/) and [pricing definitions](https://developer.oanda.com/rest-live-v20/pricing-df/).

Both OHLC paths are conditional witnesses, not exhaustive profit bounds. They do not establish exact intrabar ordering, quote delivery, latency, or real fills. While exposed, the broker model samples source prices and protection every five seconds; the actual app manager runs every ten seconds, with source protection applied first. Target/stop behavior follows the documented threshold direction. See [OANDA order definitions](https://developer.oanda.com/rest-live-v20/order-df/).

Half-tick synthetic source quotes introduce up to 0.05 pip per execution in display-price rounding, or 0.1 pip for two executions. The recent zero-entry result is unaffected because no pattern reached the cost stage. An edge comparable to that precision uncertainty would need further evidence.

At median costs, fixed-timing midpoint gross is A$1.0355–A$1.3165; execution friction costs A$0.5625–A$0.5633 and conversion costs A$0.0467–A$0.0494. Together they consume **46.5–58.9%** of that gross. Stress consumes **95.5–98.7%**, leaving only A$0.000415–A$0.001483 per closed trade before any unavailable charge. Gross here is a decomposition of the actual executed ledger at fixed entry/exit times, not the attainable return of a separate cost-free portfolio.

Independent 5,000-replication day and true-breakout-episode resampling both span zero mean net R in every synthetic case. Median models have 27 trade-bearing days and 28 episodes; their day-cluster 95% empirical ranges are approximately −0.278 to +0.466R and −0.243 to +0.530R. Episode ranges are −0.290 to +0.459R and −0.256 to +0.531R. The day-size Kish descriptor is 26.13; episode risk-size descriptors are about 27.98. Optimistic models have 39 trade-bearing days / 40 episodes, day-size Kish 38.10 and episode risk-size about 39.95. These quantify sample concentration and conditional resampling sensitivity, not independent prospective trials or a guaranteed confidence level.

Every case has zero modeled New York 17:00 cutoff crossings and zero modeled financing. That limits exposure in the declared paths; it does not recover historical financing charges. The maximum sampled NAV drawdown across all cases is 1.409%, well below 5%, and exported decisions contain no portfolio-risk, drawdown or margin rejection. Those observed limits do not explain the modeled drought. The liquidation-side instrument mark remains an approximation to broker mid-price NAV; sampled drawdown is not an exhaustive intrabar bound.

## Data and software checks

The retained multi-year input contains 1,147,442 completed candles across seven pairs; the evaluator uses only the four live pairs, including the AUD conversion bridge. Independent audit found no structural defects. The recent download contains 20,000 M15 candles and 5,000 independently retrieved H1 candles. Every recent reconstructed H1 midpoint/bid/ask OHLC and volume matches exactly. All recent missing intervals are normal weekends. Older H1 bars are derived causally from complete UTC quartets; they were not independently compared with historical broker H1 downloads.

Software optimization parity compared full one-minute scans with compressed static waits, and original calendar calculations with exact memoization. Full broker ledgers, persisted trades, decisions and durable state matched in a case with a pricing rejection, valid reconsideration, entry and timed closure. All eight full and eight recent scored results verify the same 119 source pins before and after execution, reconcile cash/trades, and report zero network attempts and zero engine errors. Every original full process exited zero; no runtime-budget repair or additional historical rerun was used. See the [completion/log manifest](evidence/2026-10-17/full-run-completion-r3.json).

The research outcomes remain conditional on supplied historical prices, declared account/margin/cost assumptions and admitted paths. Source correctness and accounting agreement do not establish a profitable live edge. Day- and episode-cluster intervals are conditional sensitivities, not independent prospective evidence.

Trade, decision and broker execution ledgers and final durable episode state are exported. Internal order-intent and quarantine tables participate in the actual replay but are not serialized in these results. The embedded `retentionPolicy` string overstates that export; the [output-contract erratum](evidence/2026-10-17/viability-output-contract-errata-r3.json) records the exact limit without rewriting historical results. Separate accounting checks cannot certify rows that were not exported.

The independent fill audit initially omitted the broker model’s single-bucket quantity-weighting step before entry-price rounding. Its original tool and failure were preserved, then the exact arithmetic was corrected without widening tolerance. The two affected optimistic fixed-ledger comparisons differ by less than A$0.0008 each and do not change a case’s sign. All financial outputs remain unchanged. See the [audit repair evidence](evidence/2026-10-17/economic-audit-r3-fill-rounding-repair.json).

The original r2 long runs were stopped before completion after the cost audit found the missing settlement markup and mismatched test margin metadata. Their logs, source snapshot, completed zero-entry recent checkpoint and abandonment record remain intact. Final economic conclusions use the corrected r3 reruns. No earlier partial trade count is presented as a result.

## Broker evidence recovery and live state

The two missing records were recovered directly from OANDA: AUD/USD BUY 2867 closed June 1, and GBP/USD BUY 2858 closed May 28. The old local timestamps were retained; explicit broker close-time proof and its provenance were added separately.

The recovery fix was committed locally, published to GitHub and deployed using the approved standard command at source revision **519b428**. All 1,336 target backend checks, the frontend build, matched backup 20261017_171918 and health checks passed. Verification at 17:23 AEDT found the same v6 strategy/run, enabled intent, A$95.093 balance, no positions and no unresolved exposure. The existing H1 reset states have re-armed from observed candles. No entry, risk, stop, target or episode rule changed.

A later health check at 17:59 AEDT found the service healthy with entries **disabled**. Sanitized access records show a successful Start request at 17:34:34, then a successful Stop request at 17:34:38; the latter matches the saved config modification and broadcast. Both requests classify as browser-like, which does not identify actor or intent. The later disabled setting has been preserved. A final read-only check at **20:45 AEDT** again found healthy services, v6 / 1.4.0 at deployed 519b428, entries disabled, no positions, no pending intents, no quarantines and no uncertain exposure. This pause does not explain the preceding ten-day pattern drought. See the [final runtime observation](evidence/2026-10-17/final-runtime-observation-r3.json). See [state-transition evidence](evidence/2026-10-17/state-transition-route-evidence.json).

The earlier 152 scans with unavailable historical proof also lacked ready patterns. Recovery corrects evidence availability; it does not demonstrate missed fills or repair strategy expectancy.

Current persisted NAV drawdown is 2.826% from the retained A$97.8585 high watermark to A$95.093, below the configured 5% limit, and no cooldown is active. Those observed limits do not explain the drought. The v6 live scan record contained 57,912 pair scans and zero actionable entry decisions; 296 pair/candles passed early filters, but none had a direction-aligned ready retest.

## Decision and next action

**Retire current v6 as a live strategy; leave the current paused entry setting preserved.** KEEP fails because positive expectancy remains unresolved, the later years lose, and the observed cadence produces very little economic return at the established capital/risk scale. A positive point estimate below A$1 over six years is not sufficient evidence to continue live iteration. No new income target or arbitrary minimum trade count is imposed.

The broker recovery fix remains useful and deployed. Preserve reconciliation, ownership, sizing, protection, durable intents and the corrected evidence; these provide infrastructure for evaluating a future idea. Their successful tests do not validate the current signal.

A redesign is optional new research. It would need a separately specified market thesis and an explicit completed-bar formation/cancellation/renewal lifecycle that fits its H1 regime. Its filter contributions, costs, trade cadence and future evaluation must be declared before selecting outcomes. Adding an arbitrary expiry, loosening gates to manufacture trades, choosing the best historical pair, or increasing risk is not a demonstrated correction. No redesign rule was implemented; the later disabled entry setting was preserved. All examined historical data has already been seen, so any later claim of fresh evidence must come from genuinely untouched observations.

The final [decision record](evidence/2026-10-17/viability-decision-r3.json) separates the practical SCRAP recommendation from INCONCLUSIVE statistical evidence. The research and this report remain local and unpublished. The approved recovery-only fix is published/deployed; local research validation passed 1,353 tests across 70 suites, with the opt-in long evaluation verified separately by all eight successful original process exits. This review does not complete the older v5 R3 baseline or other untouched research/operational packages.

## Reproduction and evidence

The [registered protocol](evidence/2026-10-17/viability-protocol-r3.json), [frozen inputs](evidence/2026-10-17/viability-inputs-r3.json), [launch specification](evidence/2026-10-17/viability-launch-r3.json) and [trial ledger](evidence/2026-10-17/viability-trials.json) retain the criteria, dates and all cost/path cases. The [r2 abandonment record](evidence/2026-10-17/viability-abandonment-r2.json) preserves the model correction's lineage.

Run from `/Users/adams/code/forex-trading-bot` with the recorded Node 22.23.1 runtime and the original registered files/data available. The launcher refuses changed source/input registrations and existing result files. The commands below create new output directories; they do not replace the review's raw results.

```sh
nvm use 22.23.1
export NODE_GYP_FORCE_PYTHON=/usr/bin/false
viability_evidence=docs/reviews/evidence/2026-10-17
viability_reproduction=$(mktemp -d "$PWD/backend/data/backtests/viability-r3-reproduction.XXXXXX")
for viability_cohort in full recent; do
  mkdir "$viability_reproduction/$viability_cohort"
  for viability_spec in "$viability_evidence/viability-r3/specs/$viability_cohort/"*.json; do
    node backend/research/run_viability.cjs "$viability_spec" \
      "$viability_reproduction/$viability_cohort/$(basename "$viability_spec")"
  done
done
node "$viability_evidence/economic-audit.cjs" \
  --spec-dir "$viability_evidence/viability-r3/specs/full" \
  --result-dir "$viability_reproduction/full" \
  --output "$viability_reproduction/full-economic-audit.json"
node "$viability_evidence/economic-audit.cjs" --recent \
  --spec-dir "$viability_evidence/viability-r3/specs/recent" \
  --result-dir "$viability_reproduction/recent" \
  --output "$viability_reproduction/recent-economic-audit.json"
```

The independent economic reducer accepts custom spec/result/output directories. The docs summary and cadence reducers read the retained canonical raw-result directories; these commands recheck those original results into fresh output files:

```sh
node "$viability_evidence/summarize-viability-r3.cjs" \
  --output "$viability_reproduction/original-full-summary.json"
node "$viability_evidence/summarize-viability-r3.cjs" --recent \
  --output "$viability_reproduction/original-recent-summary.json"
node "$viability_evidence/cadence-audit-r3.cjs" \
  --output "$viability_reproduction/original-full-cadence.json"
node "$viability_evidence/cadence-audit-r3.cjs" --recent \
  --output "$viability_reproduction/original-recent-cadence.json"
```

These are reproduction instructions only. No new historical run was launched while preparing them. The dormant timeout-repair launcher is unnecessary unless an actual native-timeout failure is separately registered and preserved; it is not part of the original scored CLI.


Supporting records: [deployment](evidence/2026-10-17/recovery-deployment-verification.json), [corrected recent results](evidence/2026-10-17/viability-recent-summary-r3.json), [independent recent accounting](evidence/2026-10-17/economic-audit-r3-recent.json), [raw recent patterns](evidence/2026-10-17/unconditional-pattern-audit.json), [long raw pattern screen](evidence/2026-10-17/full-pattern-screen.json), [H1 parity](evidence/2026-10-17/parity-audit.json), [cost/input audit](evidence/2026-10-17/method-audit.json), [corrected software controls](evidence/2026-10-17/viability-software-r3.json), [final local regression](evidence/2026-10-17/final-software-validation-r3.json), and [source snapshot](evidence/2026-10-17/viability-source-snapshot-r3.json).

