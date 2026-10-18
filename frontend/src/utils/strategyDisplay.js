export const CURRENT_STRATEGY_KEY = 'multi_day_trend';

export const isH4Trend = (identity = {}) => {
  const key = identity.strategy || identity.key || identity.family;
  if (key) return key === CURRENT_STRATEGY_KEY;
  return identity.liveReleaseVersion === 'h4-channel-v1';
};

export const strategyLabel = (key, catalogLabel = null) => {
  if (key === 'intraday_momentum') return 'M15 Intraday Momentum';
  if (key === CURRENT_STRATEGY_KEY) return catalogLabel || 'H4 Trend';
  return catalogLabel || key || 'Live strategy';
};
