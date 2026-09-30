# Completed-candle chart correction — 1 October 2026

The user requested the chart defect be corrected before returning to SELL entry setups. This is a frontend display correction only. Trading signals, execution, stops, risk, quote-health contracts and strategy/release identity are unchanged.

## Finding and correction

The [AUD/USD investigation](2026-10-01-audusd-sell-loss.md) demonstrated that the chart replaced the last completed candle's close/high/low with each current quote while retaining the old candle timestamp and EMA/SuperTrend values. The candle API returns completed midpoint candles; a later quote does not belong to that historical candle.

`LivePriceChart.jsx` now keeps completed candle OHLC and derived indicators together and never edits them in response to quotes. The latest midpoint is drawn as a separate labeled point at the normalized broker event `timestamp`. Its value and timestamp also appear in the header. A repeated broker event with a newer receipt remains at its original event time; this adds no event-age gate or service-health warning.

Historical close/indicator points use a new display-only `closeTime` derived from candle start plus the selected M15/H1/H4 interval. Original candle start `time` remains available for the tooltip. A numeric time axis spaces the quote according to elapsed time, rather than giving it an artificial full candle interval. The quote marker extends the plotting domain when necessary. Candle tooltips explicitly identify the completed interval, midpoint close, and original high/low. The historical series is labeled **Midpoint close**; it remains a close-price line rather than a candlestick or full tick-path display.

The same chart hook also had an observed source-level request race: a slow prior pair/timeframe or poll request could replace the newer chart snapshot. Loaded data now carries its selection identity, and effect disposal/request sequencing discard obsolete successes and errors. Selection changes cannot temporarily combine one pair's candles with another pair's quote. Successful empty responses clear the old data.

## Validation and delivery

Local browser verification uses the actual component with recorded OANDA candles and an isolated quote fixture. Moving the latest quote from 0.69550 at 01:01 to 0.69670 at 01:04 moved only its independent marker and header; the 00:45–01:00 completed candle still showed close **0.69564**, high **0.69644**, low **0.69552**, and its historical indicator values. The marker and its label remained visible at the chart's right edge. No live API/broker connection was used by the preview.

Eight new regressions execute the actual component/hook, real indicator calculation and real Recharts SVG rendering with controlled API responses. They cover immutable OHLC/indicators and tooltips, repeated event/new receipt, candle rollover, proportional numeric-time marker placement, out-of-order polls and errors, pair/timeframe switches, empty responses/recovery, and missing timestamp handling. Their inline fixture retains only sanitized market observations from the investigation.

Validation uses Node 22.23.1. All eight new tests and three existing activation tests pass (11/11); the four existing dashboard-refresh scenarios also pass. JSX syntax and whitespace checks pass. Reproduce with:

```sh
node --test frontend/src/components/__tests__/livePriceChart.test.cjs frontend/src/components/__tests__/tradingActivation.test.cjs
node scripts/tests/frontend_refresh_contract.test.cjs
```

**Implemented and verified locally; not deployed.** No production build, publication, deployment, restart or trading-state change occurred; the existing user-managed delivery workflow remains in effect. The temporary browser preview used Vite development serving, not a frontend release build.
