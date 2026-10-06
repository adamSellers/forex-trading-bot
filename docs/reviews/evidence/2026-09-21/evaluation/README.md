# Target and re-entry study inputs

October 6 language-policy update: the original analysis scripts are retired from the current tree. The Git commands below inspect their preserved source; they do not rerun the study. Saved inputs, results and source hashes retain their historical provenance. Current tooling uses Node.js; see [the migration record](https://github.com/adamSellers/forex-trading-bot/blob/main/docs/reviews/2026-10-06-node-tooling.md).

The study is described in [the evaluation report](../../../2026-09-21-target-and-reentry-evaluation.md).

Inspect the preserved source:

```sh
git show af2c14da80255b07b9415af6430a476da1ff9507:docs/reviews/evidence/2026-09-21/evaluation/analyze.py
git show af2c14da80255b07b9415af6430a476da1ff9507:docs/reviews/evidence/2026-09-21/evaluation/test_analyze.py
```

The original tool accepted `--inputs`, `--market-data` and `--output` to override adjacent defaults. Its retained results are deterministic. The historical regression checked that a breakeven touch in the exit-straddling starting candle was rejected, whether or not the same candle touched the alternative target. Such an aggregate does not establish whether the stop touch preceded the actual exit. The original script raised an error rather than silently resolving unsupported stop/target ordering, uncertain capacity overlap, unknown future BE activation that would change an outcome, or a missing timed-exit quote.

- `inputs.json`: all 25 saved trades, actual entry/exit prices and outcomes, original stop distances, saved entry signal context, broker stop replacement transactions, distinct completed-candle regime observations from the eight-day signal archive, and actual entry decisions. The original 46,040 scan records, account details and unrelated operational configuration are omitted.
- `market-data.json`: broker M1 bid/ask candles per trade from its entry-minute floor through its original six-hour/16:45 New York deadline-minute floor; M15 midpoint candles for the three traded instruments from September 6 through the review cutoff. Complete bars only are used. M1 boundary bars are treated explicitly as uncertain and no candle's publication boundary is mistaken for the timestamp of its high, low or last tick.
- `results.json`: standalone target extensions with event intervals and ambiguity, paired frozen-entry sensitivities by cohort, and all nine observed protected-exit/re-entry episodes with exact touch-bar evidence.
- `manifest.json`: capture time, source hashes and retained counts.
- Retired `prepare_inputs.py`: the original extraction from three local audit exports, preserved at `af2c14da80255b07b9415af6430a476da1ff9507:docs/reviews/evidence/2026-09-21/evaluation/prepare_inputs.py`. It read local files without service calls. Refreshing this historical calculation requires a validated Node.js replacement.

The 2R comparison fixes actual entry prices and non-target outcomes. It changes target outcomes conditionally, omits definitely capacity-conflicting observed entries, and introduces no replacement trades. It is not an alternative runtime replay or a forecast of cash returns. Re-entry classifications likewise screen observed episodes; they do not sum removed P&L as estimated benefit. Sample size, differing earlier releases, missing earlier complete scan history, execution timing, dynamic sizing and risk-state feedback prevent those claims.
