# Production audit and strategy overhaul — 2026-08-04

## Decision

No strategy tested in this audit qualifies for live entry submission. The active
SuperTrend strategy remains useful as an observed market-state and exit-management
baseline, but it is explicitly classified `REJECTED` for new live entries. Live
entry cadence is therefore intentionally zero until a paper candidate passes the
existing realistic-paper promotion gate.

This is an evidence decision, not a trading-toggle diagnosis. Trading was enabled
during the audit. The selected strategy still produced no actionable entries in
the inspected seven-day window, and its historical live cohort was unprofitable.

## Production state before the change

- Host: Raspberry Pi at `/opt/forex-trading-bot`, clean `main` at `c13e76a`.
- Broker: OANDA live, AUD account, NAV and balance A$96.74, no open broker or
  engine positions at the inspection point.
- Account realized P/L: -A$52.18.
- Selected strategy: `supertrend_momentum`, M15, four instruments, one maximum
  position, 0.5% risk per trade, A$50 capital-at-risk cap, long-only.
- Services reported running and OANDA connected. The detailed health route was
  not measuring cache freshness correctly: it read a nonexistent `lastUpdate`
  property and could call a running-but-stale data service healthy.
- TimesFM was connected in observe mode but did not provide an actionable edge.

### Historical production cohorts

| Mode / strategy | Closed trades | Net P/L (AUD) | Expectancy (AUD/trade) | Result |
|---|---:|---:|---:|---|
| Live legacy / unclassified | 77 | -30.56 | -0.397 | Reject |
| Live `mean_reversion` | 16 | -9.17 | -0.573 | Reject |
| Live `stochastic_divergence` | 4 | -7.43 | -1.857 | Reject; all losses |
| Live `timesfm_directional` | 2 | -3.51 | -1.755 | Reject; all losses |
| Live `supertrend_momentum` | 1 | -0.21 | -0.214 | Inadequate sample; not positive |
| Paper `signal_following` | 15 | +6.30 | +0.420 | Too few trades; not promoted |
| Paper `correlation_divergence` | 19 | +0.25 | +0.013 | Too few trades / negligible edge |

Paper results are not combined with live results and are not treated as broker
execution evidence.

## Why the selected strategy was inactive

The seven-day live SuperTrend query contained 40,324 raw signal rows and zero
actionable entries. The dominant observations were:

- 38,812 `BASE_TREND_STATE` rows;
- 1,167 pending rows, mostly HTF confirmation waits;
- 322 cooldown duplicates;
- 135 fresh-long flips blocked by the H1 filter;
- 75 fresh-long flips blocked by ADX;
- 23 exit-only short events while short entries were disabled.

The main issue was not one especially restrictive switch. It was a strategy with
no demonstrated positive net edge and a stacked rule set that repeatedly observed
state without reaching a cost-justified entry. Relaxing those rules would increase
turnover, but the faster family tests show that spread then dominates the result.

The dashboard made this worse in two ways:

1. Every polling row was counted as a new strategy observation. Routine base-state
   messages contained the word “ADX” and were mislabeled “Filtered (Choppy).”
2. `SELL` exit-only events were rendered as new entries before `entryType`, `intent`,
   and `signalClass` were checked.

## Research design

### Data

- Source: OANDA REST v20 instrument candles.
- Components: midpoint, bid, and ask (`price=MBA`).
- Only `complete=true` candles are accepted.
- Granularity: M15.
- Period: 2020-01-01 through 2026-08-03.
- Instruments: AUD/USD, EUR/USD, GBP/USD, USD/JPY, NZD/USD, USD/CAD,
  and USD/CHF.
- Approximately 163,800–163,950 candles per instrument.
- Local ignored dataset:
  `backend/data/historical/research_M15_MBA_20200101_20260803.json`.
- SHA-256:
  `fd30b7bc2f98f2d362c2be658338d944f9fade5c01dd142d1b91f470b0a75b5d`.

The downloader and experiment definitions are committed; the 301 MB market-data
file and generated result payloads remain ignored.

### Execution assumptions

- Signals are calculated only from information available at the completed bar.
- Orders fill on the next bar, never on the signal bar.
- Long entries use ask and exits use bid; shorts use bid and exits use ask.
- Normal slippage is 0.1 pip; stress slippage is 0.5 pip plus A$10 per million
  notional commission.
- Stops are resolved conservatively when an OHLC bar makes stop/target ordering
  ambiguous.
- Position sizing is AUD NAV-aware with 0.5% risk per trade and one live position
  unless the experiment explicitly allows two cross-sectional legs.
- The long-horizon research run uses zero financing because the downloaded candle
  file has no account-specific financing schedule. That assumption is optimistic,
  so a negative result remains a rejection. No positive long-horizon result is
  accepted without a future financing-aware rerun.

### Temporal separation

- Development: 2020-01-01 through 2024-12-31.
- Validation: 2025-01-01 through 2025-12-31.
- Untouched recent holdout: 2026-01-01 through 2026-08-03.

The GBP 20-day/60-day candidate was frozen after development and validation, then
the 2026 holdout was opened once. No parameters were changed after that result.

## Families tested and outcomes

| Candidate | Development | 2025 validation | Decision |
|---|---|---|---|
| Session expansion | 1,408 trades, -A$4,243.83, PF 0.881 | 222, -A$745.12, PF 0.896 | Reject |
| Medium trend 10d/40d | 312, +A$864.33, PF 1.075 | 51, -A$273.36, PF 0.844 | Reject |
| Medium trend 20d/60d | 229, +A$813.47, PF 1.087 | 41, -A$592.89, PF 0.623 | Reject |
| Cross-sectional 20d weekly | 257, -A$390.69, PF 0.964 | 51, +A$422.69, PF 1.205 | Reject; unstable sign |
| Cross-sectional 60d weekly | 247, -A$3,388.06, PF 0.633 | 52, +A$380.86, PF 1.180 | Reject; unstable sign |
| Cross-sectional 20d monthly, 7 pairs | 118, -A$1,546.61, PF 0.689 | 24, -A$698.25, PF 0.348 | Reject |
| Cross-sectional 60d monthly, 7 pairs | 113, -A$2,122.98, PF 0.553 | 24, +A$897.17, PF 1.972 | Reject; unstable sign |
| Cross-sectional 120d monthly, 7 pairs | 107, -A$1,459.26, PF 0.684 | 24, -A$790.86, PF 0.256 | Reject |

Faster pullback-continuation and mean-reversion screens were also rejected after
bid/ask costs. Several were much less negative at midpoint, which is exactly why
midpoint-only backtests are not accepted.

### Frozen finalist

GBP/USD 20-day/60-day medium trend looked best before the holdout:

- Development: 88 trades, +A$1,234.96, PF 1.379, +A$14.03 expectancy,
  9.44% maximum drawdown.
- 2025 validation: 18 trades, +A$94.28, PF 1.136, +A$5.24 expectancy,
  7.52% maximum drawdown.
- Its confidence interval still crossed zero in both periods.

Untouched 2026 holdout:

| Scenario | Trades | Net P/L | PF | Expectancy | 95% expectancy interval | Max DD | Deflated-Sharpe probability |
|---|---:|---:|---:|---:|---:|---:|---:|
| Normal | 6 | -A$84.25 | 0.578 | -A$14.04 | -A$49.91 to +A$30.57 | 4.38% | 0.58% |
| Stress | 6 | -A$88.61 | 0.561 | -A$14.77 | crosses zero | 4.41% | below acceptance |

The candidate is rejected. The tiny holdout sample also means there is no basis
for a claim that the strategy merely experienced bad luck.

## Implemented changes

- Added a reproducible OANDA MBA downloader and research-family runner.
- Added aggregated replay decision funnels so multi-year tests do not retain
  millions of duplicate decision objects in memory.
- Versioned the active SuperTrend definition as `2.0.0` and added a catalog-level
  live qualification record. Its current status is `REJECTED`, reason
  `FAILED_OUT_OF_SAMPLE_STRATEGY_AUDIT`.
- Added a default production qualification marker that blocks the legacy
  controlled-baseline resume path. A future paper candidate can still qualify
  through the existing promotion gate.
- Changed analytics to report raw observations separately from unique
  closed-candle strategy decisions and added a reason-level strategy funnel.
- Separated market state, setup forming, filtered, actionable, exit-only, and
  cooldown buckets.
- Corrected entry/exit-only and long/short entry labels in every signal card.
- Added price-cache and candle-refresh freshness to service status and detailed
  health. Candle freshness uses successful refresh time rather than last market
  candle time, avoiding false weekend alarms.
- Removed all API-key fragments from OANDA credential logging.

## Expected cadence and promotion rule

Expected live entry cadence is **zero** while the selected strategy is rejected.
This is not a silent failure: the dashboard and APIs expose the strategy version,
qualification, reason code, activation blockers, data freshness, and decision
funnel.

Future candidate cadence must be measured in the realistic paper runtime. It must
pass the existing versioned promotion gate with sufficient trades, positive net
expectancy after spread/slippage/commission/financing, controlled drawdown,
matched shadow evidence, and immutable configuration identity. No manual rule
relaxation or strategy-label change constitutes qualification.

## Reproduction

```bash
cd backend
node scripts/fetchReplayDataset.js \
  --from 2020-01-01 --to 2026-08-03 --granularity M15 \
  --instruments AUD_USD,EUR_USD,GBP_USD,USD_JPY,NZD_USD,USD_CAD,USD_CHF \
  --output data/historical/research_M15_MBA_20200101_20260803.json

node scripts/researchStrategyFamilies.js \
  --data data/historical/research_M15_MBA_20200101_20260803.json \
  --variants research/slow_family_variants.json \
  --periods research/development_validation_periods.json \
  --stress both \
  --output data/backtests/slow_family_development_validation.json

node scripts/researchStrategyFamilies.js \
  --data data/historical/research_M15_MBA_20200101_20260803.json \
  --variants research/frozen_gbp_trend_candidate.json \
  --periods research/recent_holdout_period.json \
  --stress both \
  --trialCount 15 \
  --output data/backtests/frozen_gbp_trend_holdout.json
```

## Primary references

- OANDA candle schema and price components:
  https://developer.oanda.com/rest-live-v20/instrument-df/
- OANDA instrument precision, pip location, minimum size, and margin fields:
  https://developer.oanda.com/rest-live-v20/primitives-df/
- OANDA account and pricing endpoints:
  https://developer.oanda.com/rest-live-v20/account-ep/ and
  https://developer.oanda.com/rest-live-v20/pricing-ep/
- Time-series momentum: Moskowitz, Ooi, and Pedersen,
  https://fairmodel.econ.yale.edu/ec439/mosk.pdf
- Currency momentum: Menkhoff, Sarno, Schmeling, and Schrimpf,
  https://www.bis.org/publ/work366.pdf

These references motivate families and execution correctness; they do not prove
that this account, universe, implementation, or sample has a tradable edge.
