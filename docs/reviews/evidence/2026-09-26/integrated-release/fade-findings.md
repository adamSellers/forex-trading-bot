# Prespecified post-TP fade check

October 6 language-policy update: the original analysis scripts are retired from the current tree. The Git commands below inspect their preserved source; they do not rerun the study. Saved inputs, results and source hashes retain their historical provenance. Current tooling uses Node.js; see [the migration record](https://github.com/adamSellers/forex-trading-bot/blob/main/docs/reviews/2026-10-06-node-tooling.md).

Prepared locally on September 26, 2026 for the integrated release specification. No broker calls, orders, settings, builds or deployments were made by this investigation.

## Decision

Use the original otherwise-valid signal's stop distance for the opposite-direction experiment, retain the 1.5R target and +1R breakeven rule, and retain the six-hour/New York 16:45 deadlines. The four retained episodes do not justify tuning a separate target. This is a coherent experimental baseline, not validated positive expectancy.

Only a normal strategy TP can arm a fade. Identify the latest broker-confirmed closed trade in the same instrument, across release boundaries; require the proposed normal signal to repeat its direction and lack the already-specified fresh touch. A qualifying touch must be in the four completed M15 bars preceding the signal bar, have started at or after the broker exit, and touch the signal's EMA20. The freshness condition covers both breakout and pullback signals. The integrated entry-quality rule is evaluated first and may change which future events qualify.

Record actual order direction separately from the original trend signal. Apply execution checks to that actual direction. A fresh post-exit pullback permits normal continuation; a breakeven anchor without freshness permits no fade. Fade exits must never re-arm another fade. If the latest closed trade is a fade, carry forward its parent normal TP and the consumed state: the original direction must still obtain a fresh pullback and cannot generate another fade for that TP. A later normal trade's close supplies the next anchor. Persist the parent trade identifier in signal, intent and trade context and include it in fade setup identity. Pre-submission pricing reconsideration can retry the same setup with its original entry-reference price; a fill or uncertain submission retains existing durable suppression and reconciliation. Do not introduce a new retry loop.

## Conditional results

All four historical original signals were SELL, so each candidate fade is BUY. The entry proxy uses the recorded final ask reconstructed from original executable bid plus that snapshot's spread; the exit path uses OANDA bid candles. Original sell fills are not reused as hypothetical buy fills. Stops and targets are rounded to instrument precision. No target search was performed.

| Normal TP → observed repeat | Original repeat | Fade first terminal interval (UTC) | Conditional fade price-R |
| --- | --- | --- | ---: |
| 3073 → 3085, USD/JPY, v3 | TP | Initial stop, Sep 7 06:22–06:23 | −0.99756 |
| 3121 → 3133, USD/JPY, v3.1 | Initial stop | Target, Sep 9 06:43–06:44 | +1.49897 |
| 3195 → 3207, AUD/USD, v3.3 | Initial stop | Initial stop, Sep 14 08:14–08:15 | −1.00000 |
| 3381 → 3393, EUR/USD, v3.3 | Initial stop | Target, Sep 23 14:54–14:55 | +1.50394 |

The four conditional outcomes sum to **+1.00536 price-R**. There are only two examples in the current v3.3 cohort, one stop and one target. This does not establish expected return, and there is no observed BUY-to-SELL fade example. AUD/USD 3207 is a concrete counterexample to the proposition that an original loser must become a winning opposite trade: its upward retracement did not reach the fade's +1R, and the subsequent decline reached the fade's initial stop.

All four candidates also satisfy the integrated release's requirement for a new post-exit signal completion: the signal candle closes **83.941 seconds** after TP for 3085, **989.783 seconds** for 3133, **552.035 seconds** for 3207 and **167.120 seconds** for 3393. The script asserts strict completion after the anchor's broker exit. A candle already completed at or before TP cannot be repurposed as a fade simply because its setup identity changes. This lifecycle check excludes none of the four retained candidates and does not change their conditional outcomes.

Entry-boundary candles touch neither initial protection nor the +1R trigger, so their untimed extrema cannot decide these results. No terminal bar touches both stop and target. In the two target paths, no bid retouch of entry occurs between the first +1R touch and the target, including the trigger bar. Consequently immediate breakeven activation and missing every breakeven poll give the same conditional terminal level in these four paths. This does not claim the runtime polls continuously or that a historical stop update was actually sent for a nonexistent fade.

Each path resolves before its original deadline and before the retained M1 window ends. Candle timestamps mark intervals, not the exact instant of each high or low. The final opposite quote is a proxy for an unobserved fill; reverse-side liquidity/slippage, protection alignment, rounding-driven sizing, changing AUD conversion and alternative portfolio state are not replayed. Spreads are reflected by opposite entry/exit quote sides and must not be subtracted twice. No aggregate hypothetical AUD profit is reported. Changed position occupancy, opportunities, anchors, risk and cooldowns prevent interpreting this as an alternative live portfolio.

## Historical calculation sources

Inspect the preserved source from the repository root:

```sh
git show af2c14da80255b07b9415af6430a476da1ff9507:docs/reviews/evidence/2026-09-26/integrated-release/fade-analysis.py
```

[The script](https://github.com/adamSellers/forex-trading-bot/blob/af2c14da80255b07b9415af6430a476da1ff9507/docs/reviews/evidence/2026-09-26/integrated-release/fade-analysis.py) reads only retained review evidence. [Results](fade-results.json) include source SHA-256 hashes, freshness checks, entry proxies, precise rounded levels, intervals and every retained M1 exit-side candle through the first terminal event. Assertions validate latest-closed-trade anchors, missing freshness, contiguous complete quote candles, boundary ambiguity, level ordering, deadline coverage and breakeven independence for these episodes.
