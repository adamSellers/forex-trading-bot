# Follow-up trading review — 26 September 2026

**The next ten trades lost A$0.5369 (−0.5563%). The strategy continues to show weak observed expectancy. This new sample strengthens the case for evaluating fresh post-exit pullbacks, but does not support increasing the target to 2R as the next change. Losses extend well beyond quick re-entry.**

Reviewed interval: **21 September 20:35 through 26 September 06:45 AEST, end excluded**, equivalent to 21 September 10:35 through 25 September 20:45 UTC. This continues exactly from the previous review: **4 days 10 hours 10 minutes**, not another seven elapsed days. It covers every trade since that cutoff. No position crossed either boundary. All report times are Sydney/AEST unless marked UTC.

Read-only production inspection verified clean revision `5889b66ca0cf88bb17298c8d9a9b2ed0abfccf75`, matching local HEAD. The measurement correction is deployed. Trading remains `m15-intraday-v3.3` / strategy `1.1.3`, run `live_a8458577-5451-4c6b-ae9b-adfe95d2fcf3`, config `51bcdfe44054c4f69668`, with unchanged numerical entry, exit and risk rules. Older documents saying the measurement correction awaited deployment are superseded by this observation. This review made local analysis/documentation changes only; no orders, settings, production source, processes, publication or deployment were changed.

## 1. Broker-verified performance

| Measure | Previous review | New interval |
| --- | ---: | ---: |
| Closed trades | 15 | **10** |
| Positive / negative / flat | 4 / 9 / 2 | **2 / 7 / 1** |
| Net AUD | −0.7324 | **−0.5369** |
| Return on opening balance | −0.7532% | **−0.5563%** |
| Profit factor | 0.525 | **0.497** |
| Mean net cash-risk R | −0.285R | **−0.329R** |
| Total net cash-risk R | −4.281R | **−3.289R** |

Balance declined **A$96.5056 → A$95.9687**. Gross gains were A$0.5303 against A$1.0672 of losses. The two positive trades were targets; the seven negative trades comprise six initial stops (−A$1.0203) and one session close (−A$0.0469). One breakeven trade returned zero. Median hold was 84m42s; the longest was 3h06m28s. No trade reached the six-hour exit.

The last six trades all lost, surrendering A$0.9053 from the interval's realized balance peak of A$96.8740: **0.9345% realized drawdown**. A valid 24-hour cooldown separated the two groups of three; this was not six entries ignoring a three-loss pause. No portfolio snapshots were retained, so this is drawdown between realized closes, not continuous mark-to-market drawdown.

Across the **25 trades in this unchanged v3.3 run**, net is **−A$1.2693**, with 6 positive, 16 negative and 3 flat outcomes; profit factor **0.513**. All **35 trades since the September 6 review** total **−A$0.7871**, including the earlier ten trades' A$0.4822 profit. Those earlier ten span different releases and must remain a separate reference cohort.

All ten entry/exit prices, units, net AUD results and millisecond timestamps match direct OANDA records. The transaction archive contains exactly the same ten broker openings and ten closings, without an unmatched trade, transfer or financing/commission/guaranteed-stop fee. Entry plus exit half-spread costs total **A$0.1723**, already reflected in the executable prices and P&L: do not subtract them again. Broker field meanings were checked against [OANDA's trade definitions](https://developer.oanda.com/rest-live-v20/trade-df/).

Cash-risk R divides net AUD P&L by units × original stop distance × entry transaction's quote-to-AUD loss conversion. Initial cash risks ranged A$0.14004–A$0.18774. This differs from price-distance R, used in the target study; actual price-distance outcomes total **−3.23645R**.

## 2. Every new trade

`Both` means breakout and pullback conditions passed; the stored pullback label alone conceals that distinction. MFE below is maximum favourable **sampled** movement during the confirmed position lifetime, not exact tick extrema.

| Broker ID | Entry AEST | Pair / side | Trigger | Exit | Net AUD | Sampled MFE |
| --- | --- | --- | --- | --- | ---: | ---: |
| 3347 | 22 Sep 22:16:05 | AUD/USD SELL | Both | Stop Loss | -0.1619 | 0.406R |
| 3357 | 23 Sep 00:46:09 | EUR/USD SELL | Both | Breakeven Stop | +0.0000 | 1.265R |
| 3369 | 23 Sep 17:03:05 | AUD/USD SELL | Both | Take Profit | +0.2585 | 1.400R |
| 3381 | 24 Sep 00:01:09 | EUR/USD SELL | Both | Take Profit | +0.2718 | 1.446R |
| 3393 | 24 Sep 00:31:09 | EUR/USD SELL | Both | Stop Loss | -0.1841 | 0.000R |
| 3403 | 24 Sep 01:31:10 | USD/JPY BUY | Pullback | Stop Loss | -0.1879 | 0.223R |
| 3413 | 24 Sep 04:30:31 | EUR/USD SELL | Pullback | Session Close | -0.0469 | 0.000R |
| 3425 | 25 Sep 08:53:28 | AUD/USD SELL | Pullback | Stop Loss | -0.1615 | 0.883R |
| 3435 | 25 Sep 13:05:28 | AUD/USD SELL | Pullback | Stop Loss | -0.1399 | 0.000R |
| 3445 | 26 Sep 02:15:33 | USD/JPY SELL | Pullback | Stop Loss | -0.1850 | 0.140R |

Pair totals: **AUD/USD 4 trades / −A$0.2048; EUR/USD 4 / +A$0.0408; USD/JPY 2 / −A$0.3729; GBP/USD 0**. Nine sells lost A$0.3490; the only buy, USD/JPY, lost A$0.1879. These small, confounded groups do not justify choosing pairs or sides retrospectively.

## 3. What the losses say about entries

**Six of seven losing trades showed less than +0.5R sampled favourable movement; three showed none.** The remaining loser, AUD/USD 3425, reached +0.883R sampled before stopping. All six initial stop losses were approximately −1R. There is no evidence here of unusually large actual loss exits explaining the result. Increasing only the target cannot directly rescue these fixed-entry, non-target outcomes.

**All five pullback-only entries lost A$0.7212.** The five entries satisfying both triggers netted **+A$0.1843**, including both winners and the breakeven. Across the previous fifteen plus new ten, pure pullbacks account for fourteen trades and −A$1.0426.

This identifies the pullback entry logic as a research priority, not a validated exclusion rule. The first five new trades all satisfied both triggers; the last five were all pure pullbacks, so trigger type and changing market conditions are inseparable in this sample. Last week's weak overlap group would have led to removing this week's winners. Higher ADX or candle-body thresholds also do not consistently separate winners and losers. No new numeric threshold was selected from these ten outcomes.

## 4. The quick re-entry pattern occurred again

**EUR/USD 3381 → 3393** repeats the concern raised in the previous review:

1. Sell 3381 entered at **00:01:09 on September 24**, price **1.13997**; target at **00:27:12**, exit **1.13861**, profit **A$0.2718**.
2. Sell 3393 entered **3m56.976s later**, at **00:31:09**, price **1.13879**. It stopped at **00:53:14**, exit **1.13977**, losing **A$0.1841**. Together they retained **A$0.0877**.
3. The new signal's candle was **00:15–00:30**, spanning the earlier exit. Its preceding four pullback bars all began before that exit; the EMA20-touch evidence was entirely pre-exit. Both breakout and pullback passed. This was a distinct qualifying candle under the existing strategy, not a duplicate fill.

The **previously specified** candidate requires a fully post-exit EMA20-touch candle within the four-bar pullback window before repeating the same pair/direction after target or breakeven. It applies to **both** trigger branches, retains existing confirmation and cost checks, and uses the most recent closed trade in that pair as the anchor. It does not impose an arbitrary minute delay.

| Protected-exit sequence | Next actual result | Fresh post-exit touch? |
| --- | --- | --- |
| EUR/USD 3357 breakeven → 3381 | Target, +A$0.2718 | Yes; retained |
| EUR/USD 3381 target → 3393 | Stop, −A$0.1841 | **No; screened out** |
| AUD/USD 3369 target → 3425 | Stop, −A$0.1615 | Yes; retained |

This is new evidence in favour of the specifically defined freshness condition: it separates one failed repeat from one successful repeat. It also retains a later loser. The earlier September 7 counterexample, where the same rule rejects winning 3085, still matters. Restricting only the pullback branch would retain 3393 because breakout also passed.

After omitting 3393, the later EUR/USD 3413 must be checked against retained predecessor 3381 instead; it has qualifying fresh touch evidence and remains included. Even with that anchor update, a frozen-fill sensitivity cannot establish live portfolio improvement: skipped losses change cooldown timing and expose other possible entries.

## 5. The prespecified 2R target did not improve this batch

Historical OANDA M1 **ask** candles were used for these two short positions. Both had broker-confirmed breakeven stops before their actual targets. Original six-hour/session deadlines remain in force.

| Target trade | First relevant continuation event, UTC | Conditional result at 2R |
| --- | --- | ---: |
| AUD/USD 3369 | 23 Sep 10:22–10:23 touches 2R before breakeven | +2R |
| EUR/USD 3381 | 23 Sep 14:53–14:54 touches breakeven before 2R | 0R |

EUR/USD eventually reached 2R around 16:51–16:52 UTC, **after breakeven would already have closed it**. Counting that later high/low as a successful 2R exit would be wrong. The longer 3381 position also occupies the only position slot when actual losing re-entry 3393 occurred, so that trade is omitted in the target sensitivity.

| Conditional fixed-fill comparison | Retained observed entries | Price-distance R |
| --- | ---: | ---: |
| Actual 1.5R baseline | 10 | **−3.23645R** |
| 2R only | 9 | **−3.27266R** |
| 1.5R + fresh post-exit pullback | 9 | **−2.22695R** |
| 2R + fresh post-exit pullback | 9 | **−3.27266R** |

These are **conditional sensitivities, not alternative strategy returns or forecasts**. They retain actual fills, initial stops and non-target outcomes, assume rounded alternative target/BE level fills, omit conflicting observed entries, and introduce no replacement trades. They do not replay entry decisions, dynamic sizing, AUD conversion, slippage or changed risk-state feedback. The fresh-only improvement is the omission of an observed loser, not a claim that implementing the rule would earn that amount. Every column remains negative.

The 2R sensitivity is effectively unchanged/slightly worse by 0.03621 price-R in this batch. The new evidence weakens the case for raising the target now. Last week's conditional improvement did not generalize to this batch. Using [OANDA's candle definitions](https://developer.oanda.com/rest-live-v20/instrument-df/), candle timestamps denote interval starts; extrema do not have individual timestamps. Partial boundary bars and stop/target ordering are explicitly handled in the retained analysis.

Separately retained post-exit paths show that two of six initial-stop trades later revisited their original target before the original deadline; four did not. The breakeven trade subsequently touched its original stop, without reaching its original target. These observations do not establish that loosening stops or delaying breakeven would improve performance.

## 6. Measurement, execution and operating checks

All ten closed trades have **version 2, VERIFIED excursion records without legacy aggregates**. Independent checks reproduced counts, extrema, strict observation ordering and broker-lifetime boundaries for **4,701 retained observations**. Six post-close observations were excluded across six trades: the deployed correction is working in this sample. “Verified” verifies the sample lifetime, not complete price coverage. The longest interval between retained samples was 102.865 seconds; 3435's final sample preceded its close by 43.741 seconds. A target trade's sampled MFE can legitimately be below its actual target fill.

**25,464 pair observations → 77 distinct attempted setups → 166 emitted attempts → 10 fills.** Repeated scans and reconsiderations are not independent opportunities. Seventeen setups were retried; one eventually filled after two cost/stop rejections (3435), preserving the original reference price. It lost A$0.1399; enabling reconsideration does not establish profitable expectancy.

All ten intents completed with one broker submission, and all ten entries requested `OPEN_ONLY` plus stop/target protection, created at the fill timestamp. Fill-alignment replacements followed about 230–242 ms later. No duplicate filled setup, overlapping position, unresolved intent or quarantine was found. The session exit closed 3413 at **06:45:04.804 on September 24**, within the configured New York 16:45 window.

Recorded rejection attempts: 75 spread, 34 exposure/risk, 16 entry deviation, 14 cost/stop, 8 max positions, 6 already in position, 3 temporarily disabled. Within exposure/risk, 29 were expected consecutive-loss cooldown and five temporarily unreconciled broker state. The three disabled attempts coincide with restart/config restoration at 03:02 on September 24; logs do not establish backup completion. The largest per-pair scan gap was 147.05 seconds and coincided with a process boot. No long scan outage was observed.

Eight dated ERROR records comprise five pricing deadlines and three reconciliation timeouts; some occurred together. They are not eight independent outages. Broker exit warnings represent expected TP/SL/BE closures, not evidence of manual interference. The host had about 28 GB disk available and 6.9 GB available memory. These observations do not identify resource exhaustion as a cause of the losses.

At capture the bot was **enabled and flat**, with no broker trades/pending orders, no unresolved exposure, successful recent reconciliation, and an active three-loss cooldown until **27 September 03:37:28 AEST**. Readiness was `COOLDOWN`, as intended. A successful recently received quote with an older unchanged broker event was not misclassified as a fresh outage.

### Small execution-boundary defect, separate from observed losses

The engine calculates worst-fill risk against an unformatted `priceBound`; the broker client later rounds the bound and attached stop to instrument precision. In four of ten submitted orders, the resulting serialized worst-fill risk slightly exceeded the saved budget, by approximately **A$0.00014–A$0.00113** (maximum **0.59% of that risk budget**). For 3435 the serialized-bound risk was approximately **A$0.19372 versus budget A$0.19259**.

**Actual fills and reconstructed initial stop risks were below their budgets.** This is a demonstrated precision mismatch in permitted worst-case order risk, not an observed oversized loss or an explanation for negative expectancy. The cohesive correction is to size and validate against the exact prices serialized to the broker, preserving existing limits. The real broker-client serializer was exercised with HTTP stubbed in the retained [isolated reproducer](evidence/2026-09-26/price-bound-reproduction.cjs); it reproduces both the risk expansion and a 1.50 → 1.55 pip permitted-deviation expansion. See [engine sizing](../../backend/src/services/LiveTradingEngine.js) and [broker serialization](../../backend/src/services/Oandaclient.js). This review records the defect without changing execution code or trading settings.

## 7. Recommended next algorithm work

1. **Keep the target at 1.5R for the next proposed change.** This new batch does not support increasing it; retaining profit through reversals was useful.
2. **Prioritize the precisely specified fresh-post-exit pullback condition as the first candidate for local implementation and orchestration validation.** Preserve the same-pair/latest-closed-trade anchor, both-trigger coverage, broker timestamp semantics, restart persistence, opposite-direction behavior and healthy continuation examples. Keep this distinct from a proven duplicate-order repair. Earlier winning counterexamples prevent claiming it is already a profitable policy.
3. **Make pullback entry quality the next research focus.** Evaluate the sequence of pullback and resumption, first entries as well as repeats, and all eligible/rejected opportunities across more retained market history. Define candidates before examining their next outcomes. Do not select a pair, direction, ADX cutoff, stop width or session merely because it would remove this week's losers.
4. **Correct the small serialized-price risk mismatch as a separate execution fix.** It should preserve risk limits and be validated through actual engine-to-client serialization, including both buy and sell precision boundaries.

No increase in capital or risk is supported by these results. Current settings and live state remain unchanged. The review's conclusion is that entry selection and repeated exposure deserve targeted changes; it does not establish a winning replacement algorithm.

## Evidence and reproducibility

The [complete ledger](evidence/2026-09-26/trade-ledger.csv), [performance summary](evidence/2026-09-26/performance-summary.json), [broker checks](evidence/2026-09-26/broker-verification.json), [entry analysis](evidence/2026-09-26/entry-analysis.json), [candidate results](evidence/2026-09-26/candidate-results.json) and [reproduction instructions](evidence/2026-09-26/README.md) are retained. Reduced inputs include all 35 reference trades, the ten newly verified broker trades, relevant transactions and separately fetched bid/ask M1 and midpoint M15 candles. Raw operational captures remain temporary and are identified by hashes in the manifest; no credentials were exported.

Verification covered exact broker reconciliation, input/interval completeness, risk and protection evidence, sample lifetime/extrema, conditional event ordering and capacity/anchor handling. Analysis scripts ran locally against retained inputs. No full backend regression or frontend build was required for these documentation/analysis changes; no live failure injection, full alternative-runtime replay, restore drill, email delivery or claim about macroeconomic causation is included.
