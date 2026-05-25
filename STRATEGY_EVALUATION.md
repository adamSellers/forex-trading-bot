# Strategy Evaluation Framework

This document defines how we decide whether a running strategy is healthy, promising, needs tuning, should be paused, or should be written off. It applies to `live`, `paper_shadow`, and `paper_candidate` runs.

The central rule: judge strategy quality by trade sample, regime coverage, and risk behavior. Do not judge it by one good or bad week unless there is an execution or risk-control failure.

## Evaluation Principles

- Calendar time is useful for operational monitoring, but trade count carries the statistical weight.
- Every review must compare the strategy against the paired shadow baseline, not only against zero P&L.
- Live results matter most, but live/paper divergence must be explained before blaming the strategy thesis.
- Avoid changing multiple knobs during a review window. One meaningful config change should create a new run or clearly marked config hash.
- Preserve run identity: use `mode`, `runId`, `strategy`, `selectionId`, and `configHash` when reviewing results.
- Never keep a strategy live just to complete a sample if it violates risk limits or behaves mechanically wrong.

## Review Windows

| Window | Purpose | Decision Weight |
| --- | --- | --- |
| First 1 week | Smoke test execution, telemetry, risk controls, spread behavior, position management | Low |
| First 2 weeks | Early warning window for obvious mismatch or severe underperformance | Medium-low |
| 4-8 weeks | First serious performance review for active strategies | Medium-high |
| 12+ weeks | Stronger low-frequency review window | High |
| 100+ trades | Preferred minimum for tuning/write-off decisions | High |
| 150-200+ trades | More reliable estimate of expectancy and drawdown profile | Highest |

For fast strategies, prefer the trade-count gate. For slow strategies, use the longer calendar window and accept wider uncertainty.

## Trade Count Guide

| Closed Trades | Interpretation |
| --- | --- |
| Fewer than 20 | Anecdotal. Useful only for operational issues. |
| 30-50 | Early directional evidence. Good for spotting obvious issues. |
| 75-100 | Reasonable minimum for tuning or pausing decisions. |
| 150-200+ | Much more credible estimate of strategy behavior. |

Performance variability falls slowly. Roughly, cutting uncertainty in half requires about four times as many trades.

## Immediate Kill Criteria

Pause or disable a live strategy immediately if any of these happen:

- Orders are placed with the wrong side, wrong instrument, wrong size, or stale price.
- Stop loss, take profit, trailing stop, or exit ownership behaves incorrectly.
- Open position count, exposure, or margin usage breaches configured limits.
- Repeated entries occur during clearly bad market data, stale prices, or untradeable instruments.
- Live execution materially diverges from the generated signal in a way that cannot be explained by spread, slippage, or broker rejection.
- Runtime ownership is confused, for example a new live run tries to manage a position owned by an older run.

These are system failures, not strategy-performance failures.

## Probation Criteria

Put a strategy on probation, reduce risk, or move it back to paper if these persist after the first 2 weeks:

- It underperforms the paired shadow run by a clear margin.
- Drawdown is materially worse than expected for its risk profile.
- Most losses concentrate in one pair, side, session, or spread regime.
- The strategy produces many actionable signals but few valid entries because of execution gates.
- It only works in one narrow pocket and fails broadly elsewhere.

Probation does not mean write-off. It means the strategy needs more evidence, lower risk, or narrower deployment.

## Write-Off Criteria

Do not write off a strategy before one of these is true, unless it hits immediate kill criteria:

- At least 75-100 closed trades have accumulated.
- The strategy has run for 6-8 weeks and trade frequency is sufficient for review.
- A low-frequency strategy has run for 12+ weeks and still lacks a credible positive signal.

Write off or retire the current configuration when most of these are true:

- Expectancy is negative after costs.
- Profit factor remains below 1.0.
- Drawdown is worse than the strategy's expected role in the portfolio.
- The strategy underperforms the paired shadow baseline after accounting for trade count and exposure.
- Weakness is broad across pairs/sessions, not isolated to one removable segment.
- Tuning ideas would require changing the original strategy thesis rather than adjusting thresholds.

If the thesis is still plausible but the config is poor, retire the config rather than the strategy family.

## Core Metrics

Every review should include:

- Closed trade count.
- Net P&L in AUD.
- Expectancy per trade.
- Profit factor.
- Win rate and average win/loss.
- Max drawdown and current drawdown.
- Average holding time.
- Exposure and margin usage.
- Rejected entries by reason.
- Live vs shadow performance.
- Pair, side, session, and entry-type breakdown.

For comparisons, normalize by risk where possible. A higher-P&L strategy that used much more exposure is not automatically better.

## Required Breakdowns

Review each strategy by:

- Pair: `AUD_USD`, `EUR_USD`, `GBP_USD`, `USD_JPY`.
- Side: long vs short.
- Session: Sydney, Tokyo, London, New York.
- Signal class: actionable, filtered, cooldown, pending.
- Entry type or strategy-specific setup.
- Spread bucket at signal/entry time.
- Volatility regime.
- Config hash.

If performance is bad overall but one segment is clearly responsible, prefer narrowing or filtering before discarding the whole strategy.

## TimesFM Directional Checks

For `timesfm_directional`, review these extra dimensions:

- Forecast availability and sidecar uptime.
- Actionable forecasts vs filtered forecasts.
- Confidence buckets: `70-80`, `80-90`, `90+`.
- Expected return buckets: `7.5-10 bps`, `10-15 bps`, `15+ bps`.
- Direction: bullish vs bearish.
- Volatility regime: low, normal, high, extreme.
- Spread at signal time.
- Cache hit rate.
- Forecast agreement with eventual price movement.
- Entry rejection reasons after an actionable forecast.

For the current live gate, high-confidence forecasts can use the lower return floor:

- Base floor: `10 bps`.
- High-confidence threshold: `0.80`.
- High-confidence floor: `7.5 bps`.

This should be reviewed as its own cohort, especially the `7.5-10 bps` bucket. If that bucket underperforms, raise the lower floor or require tighter spread/stronger confidence.

## Correlation Divergence Checks

For `correlation_divergence`, review these extra dimensions:

- Peer candle availability for every configured asset in the candidate run.
- Observation count versus `correlationDivergenceMinObservations`.
- Peer count versus `correlationDivergenceMinPeerInstruments`.
- Rolling correlation buckets and beta clipping frequency.
- Residual z-score buckets around the entry threshold.
- Target underperformance versus outperformance cases.
- Whether entries revert toward the peer factor before the time stop.
- Pair concentration, because this strategy depends heavily on the active asset basket.

This strategy is paper-only in current catalog metadata. Do not treat a good paper run as live-promotable unless a separate review changes `supportsLive` and validates live-risk behavior.

## Decision Process

Use this order during reviews:

1. Confirm there were no execution, data, or ownership bugs.
2. Compare live performance to the paired shadow run.
3. Check whether losses are concentrated by pair, side, session, spread, or volatility regime.
4. Review rejected entries and filtered signals to see whether the thesis is producing usable trades.
5. Confirm whether the strategy is live-capable in catalog metadata before considering promotion.
6. Decide one of: continue, continue at lower risk, narrow deployment, tune one parameter, pause, retire config, retire strategy family.

## Review Cadence

- Daily: operational health only.
- Weekly: smoke-test and anomaly review.
- Fortnightly: early warning review.
- Monthly: strategy-quality review.
- Quarterly: write-off, promotion, or capital allocation decision.

## Decision Log Template

Use this template in project notes or issue comments when making a strategy decision.

```md
## Strategy Review

- Date:
- Strategy:
- Mode/runId:
- Config hash:
- Review window:
- Closed trades:
- Net P&L:
- Profit factor:
- Expectancy:
- Max drawdown:
- Shadow comparison:
- Main strengths:
- Main weaknesses:
- Segment notes:
- Execution issues:
- Decision:
- Next review date:
```
