# Target and re-entry study inputs

The study is described in [the evaluation report](../../../2026-09-21-target-and-reentry-evaluation.md).

Reproduce it with Python 3.9+ (stdlib only):

```sh
python3 docs/reviews/evidence/2026-09-21/evaluation/analyze.py
python3 docs/reviews/evidence/2026-09-21/evaluation/test_analyze.py
```

`--inputs`, `--market-data` and `--output` override the adjacent default files. Results are deterministic. The focused regression checks that a breakeven touch in the exit-straddling starting candle is rejected, whether or not the same candle touches the alternative target. Such an aggregate does not establish whether the stop touch preceded the actual exit. The script deliberately raises an error rather than silently resolving unsupported stop/target ordering, uncertain capacity overlap, unknown future BE activation that would change an outcome, or a missing timed-exit quote.

- `inputs.json`: all 25 saved trades, actual entry/exit prices and outcomes, original stop distances, saved entry signal context, broker stop replacement transactions, distinct completed-candle regime observations from the eight-day signal archive, and actual entry decisions. The original 46,040 scan records, account details and unrelated operational configuration are omitted.
- `market-data.json`: broker M1 bid/ask candles per trade from its entry-minute floor through its original six-hour/16:45 New York deadline-minute floor; M15 midpoint candles for the three traded instruments from September 6 through the review cutoff. Complete bars only are used. M1 boundary bars are treated explicitly as uncertain and no candle's publication boundary is mistaken for the timestamp of its high, low or last tick.
- `results.json`: standalone target extensions with event intervals and ambiguity, paired frozen-entry sensitivities by cohort, and all nine observed protected-exit/re-entry episodes with exact touch-bar evidence.
- `manifest.json`: capture time, source hashes and retained counts.
- `prepare_inputs.py`: reproducible extraction from the three original local audit exports. This is not needed to rerun the retained study. To refresh from those files, pass `--production /path/production-evidence.json --broker /path/broker-evidence.json --candles /path/evaluation-candles.json`; `--output-dir` defaults to this directory. It reads local files and does not contact any service.

The 2R comparison fixes actual entry prices and non-target outcomes. It changes target outcomes conditionally, omits definitely capacity-conflicting observed entries, and introduces no replacement trades. It is not an alternative runtime replay or a forecast of cash returns. Re-entry classifications likewise screen observed episodes; they do not sum removed P&L as estimated benefit. Sample size, differing earlier releases, missing earlier complete scan history, execution timing, dynamic sizing and risk-state feedback prevent those claims.
