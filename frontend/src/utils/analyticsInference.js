const isFiniteValue = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export function formatExpectancyInference(summary = {}, formatMoney) {
  const interval = summary.expectancy95Aud || {};
  const observations = interval.observations ?? summary.totalTrades ?? 0;
  if (Number(observations) === 0 || interval.status === 'EMPTY_SAMPLE') {
    return 'An expectancy interval is unavailable without closed trades.';
  }
  if (Number(observations) === 1 || interval.status === 'SINGLE_OBSERVATION') {
    return 'An expectancy interval is unavailable with only one closed trade.';
  }
  if (interval.status === 'NO_OBSERVED_VARIATION' ||
      (!interval.status && isFiniteValue(interval.lower) && interval.lower === interval.upper)) {
    return 'An expectancy interval is unavailable because the observed outcomes have no variation.';
  }
  if ((interval.status && interval.status !== 'AVAILABLE') ||
      !isFiniteValue(interval.lower) || !isFiniteValue(interval.upper)) {
    return 'An expectancy interval is unavailable for this sample.';
  }
  return `95% empirical bootstrap interval ${formatMoney(interval.lower)} to ${formatMoney(interval.upper)}. The calculation treats trades as independent.`;
}
