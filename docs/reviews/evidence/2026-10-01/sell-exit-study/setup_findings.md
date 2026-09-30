# SELL setup audit — 1 October 2026

The current API capture contains **13 SELL entries after the September 21 10:35 UTC review cutoff**. There are ten negative results, two target winners and one exactly flat breakeven. Net is **−A$0.8769**. This is nine v3.3 trades, three v4.1 trades and one v4.2 trade; it is not thirteen trials of the current strategy. Sixteen earlier SELL entries from September 6 through the cutoff are retained as a separate reference cohort, net +A$0.0735.

All 29 SELL entries have a SELL source signal and SELL execution, and all have a recorded H1 short regime. None is a post-target opposite-direction fade. Original/executed-side fields are explicitly recorded in the newer release; the older release predates that provenance field. M15 RSI, H1 ADX and directional indicators are available; H1 RSI is not an input retained by this strategy.

## Recent entries

Dates below are Sydney/AEST. EMA distance measures the **filled entry below the signal's M15 EMA20**, in units of that signal's M15 ATR. Indicator levels are midpoint-based and entries are executable bid fills. These distances describe entry location; they do not measure entry slippage or establish a good/bad cutoff. Stops below are the runtime's recorded original distances; the paired exit study separately verifies rounded broker order prices.

| Trade | Entry | Pair | Trigger | Stop pips | Entry below EMA20, ATR | M15 RSI | H1 ADX | Exit | AUD |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 3347 | Sep 22 22:16 | AUD/USD | Both | 6.16 | 0.59 | 44.30 | 26.93 | Initial stop | −0.1619 |
| 3357 | Sep 23 00:46 | EUR/USD | Both | 7.83 | 2.56 | 32.94 | 21.71 | Breakeven | 0.0000 |
| 3369 | Sep 23 17:03 | AUD/USD | Both | 6.00 | 2.73 | 32.86 | 29.74 | Target | +0.2585 |
| 3381 | Sep 24 00:01 | EUR/USD | Both | 8.99 | 1.40 | 38.67 | 45.58 | Target | +0.2718 |
| 3393 | Sep 24 00:31 | EUR/USD | Both | 9.71 | 2.37 | 32.36 | 45.58 | Initial stop | −0.1841 |
| 3413 | Sep 24 04:30 | EUR/USD | Pullback only | 10.07 | 1.26 | 41.50 | 52.49 | Session close | −0.0469 |
| 3425 | Sep 25 08:53 | AUD/USD | Pullback only | 6.00 | 0.96 | 41.62 | 54.25 | Initial stop | −0.1615 |
| 3435 | Sep 25 13:05 | AUD/USD | Pullback only | 6.00 | 0.49 | 44.35 | 49.80 | Initial stop | −0.1399 |
| 3445 | Sep 26 02:15 | USD/JPY | Pullback only | 25.04 | 1.37 | 36.41 | 41.56 | Initial stop | −0.1850 |
| 3455 | Sep 28 21:30 | USD/JPY | Breakout only | 19.40 | 1.65 | 36.47 | 34.85 | Initial stop | −0.1794 |
| 3465 | Sep 28 23:45 | USD/JPY | Pullback only | 18.30 | 0.35 | 44.86 | 36.43 | Initial stop | −0.1716 |
| 3475 | Sep 29 22:00 | USD/JPY | Breakout only | 15.60 | 1.53 | 38.90 | 24.48 | Breakeven | −0.0011 |
| 3487 | Sep 30 23:45 | AUD/USD | Breakout only | 8.10 | 2.10 | 35.94 | 22.95 | Initial stop | −0.1758 |

## What setup evidence supports

- **The losses do not share a single entry shape.** Initial-stop losses span entries 0.35–2.37 ATR below EMA20. The two actual target winners were 2.73 and 1.40 ATR below EMA20. The latest AUD/USD entry was extended, but the further-extended AUD/USD winner is a direct counterexample to treating distance alone as the defect. The signal-close distance also differs from filled-entry distance, particularly when a decision or retry occurs after the candle close.
- **Recent pure pullbacks performed poorly, but that does not validate eliminating them.** Five recent pullback-only SELL entries lost −A$0.7049. Earlier pullback-only SELLs contain four positive results out of seven, net +A$0.2904. The pullback definition also changed in v4. Primary both-trigger entries total +A$0.1843; primary breakout-only entries total −A$0.3563. Trigger groups are entangled with time and release. No threshold or branch exclusion was fitted.
- **Weak initial follow-through is common, not universal.** Six of the eight initial-stop losses have verified retained-quote sampled favorable excursion below +0.5 original R. AUD/USD 3425 reached a sampled +0.883R; latest 3487 reached +0.519R. These are sampled observations, not proof of exact tick maxima. The paired broker-candle study is required to establish the alternative exit path. Both profitable recent SELL controls are kept in that study so a wider-stop policy cannot claim improvement by counting rescued losses alone.
- **The latest entry had weak relative H1 directional separation, but this is one observation.** For 3487, −DI minus +DI was 1.07, versus 6.33 for the previous protected USD/JPY scratch. ADX was 22.95, passing the configured floor. This locates that entry in its recorded context; it does not justify inventing a new DI/ADX threshold.

## Re-entry and freshness

The same-pair predecessor is preserved using **all trades**, including BUYs. In particular, USD/JPY 3445 followed a BUY stop, not another same-side loss in the retained sequence.

The historical EUR/USD repeat 3393 entered only 3.95 minutes after profitable 3381, using earlier pullback evidence. That v3.3 behavior was already the subject of the September 26 protected-exit freshness change. It must not be described as a bypass of the later rule.

The three v4.1 USD/JPY trades were recorded NORMAL entries after stop-loss predecessors. Their stored `freshTouch=false` is the unevaluated default from the then-applicable early return, not evidence that no touch existed. The September 30 retained-candle check found that all three would pass the existing protected-exit touch predicate if it were applied. The H1 neutral interruption would distinguish 3465; that stop-reset policy was added later in v4.2, after these entries.

Latest AUD/USD 3487 was allowed with `H1_RESET_REARMED`: after 3435 closed September 25, H1 reset and requalified September 28. The recorded entry occurred **63.76 hours after requalification**. This rule establishes a regime interruption after the previous loss; it does not establish a newly formed local pullback immediately before entry. At the actual entry, the independent breakout branch qualified and the revised pullback branch did not. No bypass or side reversal is established.

## Initial stop location versus preceding structure

The broker's actual original stops, including the immediate fill-aligned replacement, sit below the signal's M15 EMA20 in **9 of 13** trades and below EMA50 in **11 of 13**. They sit below the **highest midpoint high of the preceding four M15 bars in 11 of 13**, and below the preceding eight-bar high in **12 of 13**. For the eight initial-stop losses specifically, those counts are 4/8, 6/8, 6/8 and 7/8 respectively.

This establishes that most original stops were **inside the preceding price structure**: an upward retracement could cross the stop before reaching that prior high. It does not establish that such a retracement is statistically normal or harmless, or that placing the stop beyond the high produces better returns. **Both target winners also had stops below both preceding highs.** Conversely, losing AUD/USD 3425 already had its stop slightly above the eight-bar midpoint high, and losing 3435 was above the four-bar midpoint high.

| Trade | Broker stop distance, pips | Prior four-bar high above stop, pips | Entry to that high / original risk | Prior eight-bar high above stop, pips |
| --- | ---: | ---: | ---: | ---: |
| 3347 | 6.20 | 0.50 | 1.08× | 4.50 |
| 3357 | 7.80 | 12.10 | 2.55× | 18.50 |
| 3369 | 6.00 | 5.50 | 1.92× | 7.90 |
| 3381 | 9.00 | 7.30 | 1.81× | 7.30 |
| 3393 | 9.70 | 18.40 | 2.90× | 18.40 |
| 3413 | 10.10 | 3.60 | 1.36× | 5.20 |
| 3425 | 6.00 | −1.90 | 0.68× | −0.10 |
| 3435 | 6.00 | −1.50 | 0.75× | 0.50 |
| 3445 | 25.00 | 7.30 | 1.29× | 9.70 |
| 3455 | 19.40 | 7.20 | 1.37× | 7.20 |
| 3465 | 18.30 | 1.40 | 1.08× | 1.40 |
| 3475 | 15.60 | 9.10 | 1.58× | 38.90 |
| 3487 | 8.10 | 23.80 | 3.94× | 23.80 |

For latest AUD/USD 3487, the original stop was **0.69640**, below signal EMA20 **0.69695158** by 5.52 pips and below the preceding four/eight-bar high **0.69878** by 23.8 pips. The distance from the entry to that high is **31.9 pips, or 3.94 times the original 8.1-pip risk**. A study limited to 1.25×, 1.5× and 2× widening does **not** test a stop beyond that preceding structure. These are different policy experiments; results for one cannot establish the other.

The prior highs and EMA levels are midpoint values; the SELL protective order triggers on ask. No ask-side buffer, structural definition, new threshold or candidate stop was invented here. The distances to highs are descriptive, not executable stop recommendations. Four-bar evidence comes from entry telemetry for v4.1/v4.2 and the retained September 26 OANDA M15 candles for the nine v3.3 trades. All four intervals are checked against the signal timestamp.

Reproduce this supplement with `python3 docs/reviews/evidence/2026-10-01/sell-exit-study/setup_structure.py`; the exact broker stop-order IDs, prices, preceding bars, comparisons and source hashes are retained in [setup_structure.json](setup_structure.json). The script reads `setup_inputs.json`, the current `market.json.gz`, and the retained `2026-09-26/broker-evidence.json`; it makes no network calls.

## Reproduction and boundaries

Run `python3 docs/reviews/evidence/2026-10-01/sell-exit-study/setup_analysis.py` to reproduce [setup_results.json](setup_results.json) from selected [setup_inputs.json](setup_inputs.json). The selected input retains the current API capture hash without account identifiers, credentials or full operational settings. Source preparation used the read-only capture at `/tmp/forex-sell-exit-study/trades.json`.

The script checks the 29/13/16 SELL cohort counts, direction consistency and absence of fade entries. Earlier version-1 sampled excursion aggregates are deliberately suppressed because the prior audit demonstrated post-close contamination. This descriptive setup audit does not replay alternative orders, stops, capacity or cooldowns and cannot establish how wider stops change outcomes by itself. No trading code, thresholds, settings, orders or deployment were changed.
