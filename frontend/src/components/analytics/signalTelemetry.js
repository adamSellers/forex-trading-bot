const EMPTY_LABEL = '--';

export const toFiniteNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const valueAtPath = (source, path) =>
  path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    return current[key];
  }, source);

const firstFiniteValue = (values = []) => {
  for (const value of values) {
    const parsed = toFiniteNumber(value, null);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};

const firstFiniteByPath = (source, paths = []) =>
  firstFiniteValue(paths.map((path) => valueAtPath(source, path)));

const firstStringValue = (values = []) => {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
};

const firstStringByPath = (source, paths = []) =>
  firstStringValue(paths.map((path) => valueAtPath(source, path)));

export const humanizeTelemetryToken = (value = '') =>
  String(value || '')
    .replace(/_/g, ' ')
    .trim()
    .toUpperCase();

export const formatSignedBps = (value, digits = 1) => {
  const parsed = toFiniteNumber(value, null);
  if (parsed === null) {
    return EMPTY_LABEL;
  }

  return `${parsed > 0 ? '+' : ''}${parsed.toFixed(digits)} bps`;
};

export const formatSignedPips = (value, digits = 1) => {
  const parsed = toFiniteNumber(value, null);
  if (parsed === null) {
    return EMPTY_LABEL;
  }

  return `${parsed > 0 ? '+' : ''}${parsed.toFixed(digits)} pips`;
};

export const formatPips = (value, digits = 1) => {
  const parsed = toFiniteNumber(value, null);
  if (parsed === null) {
    return EMPTY_LABEL;
  }

  return `${parsed.toFixed(digits)} pips`;
};

export const formatMs = (value) => {
  const parsed = toFiniteNumber(value, null);
  if (parsed === null) {
    return EMPTY_LABEL;
  }

  if (parsed >= 1000) {
    return `${(parsed / 1000).toFixed(1)}s`;
  }

  return `${parsed.toFixed(0)}ms`;
};

export const getTimesFmContext = (signal = {}) =>
  signal.timesFm ||
  signal.timesFmContext ||
  signal.strategyContext?.timesFm ||
  signal.decisionContext?.timesFm ||
  signal.decisionContext?.timesFmContext ||
  null;

export const getStoredStrategyContext = (signal = {}) =>
  signal.strategyContext || signal.decisionContext?.strategyContext || {};

export const getExpectedEdgeContext = (signal = {}) => {
  const strategyContext = getStoredStrategyContext(signal);
  return (
    signal.expectedEdge ||
    signal.tradePlan?.expectedEdge ||
    signal.decisionContext?.expectedEdge ||
    strategyContext.expectedEdge ||
    strategyContext.edge ||
    null
  );
};

const getTimesFmEdgeBps = (timesFm = {}) => {
  if (!timesFm || timesFm.available === false) {
    return null;
  }

  return firstFiniteValue([timesFm.netReturnBps, timesFm.returnBps]);
};

export const deriveSignalSide = (signal = {}) => {
  const intent = String(signal.intent || '').toUpperCase();
  if (intent === 'LONG') return 'BUY';
  if (intent === 'SHORT') return 'SELL';

  const side = String(signal.side || signal.decisionContext?.side || '').toUpperCase();
  if (side === 'BUY' || side === 'LONG') return 'BUY';
  if (side === 'SELL' || side === 'SHORT') return 'SELL';

  const type = String(signal.signal || '').toUpperCase();
  if (type.includes('BUY')) return 'BUY';
  if (type.includes('SELL')) return 'SELL';
  return 'UNKNOWN';
};

export const isActionableSignal = (signal = {}) => {
  const signalClass = String(signal.signalClass || '').toUpperCase();
  const intent = String(signal.intent || '').toUpperCase();
  const signalType = String(signal.signal || '').toUpperCase();
  const entryType = String(signal.entryType || '').toUpperCase();

  if (signalClass === 'COOLDOWN' || signalClass === 'EXIT_ONLY' || entryType === 'EXIT_ONLY') {
    return false;
  }

  return signalClass === 'ACTIONABLE' || intent === 'LONG' || intent === 'SHORT' || signalType === 'BUY' || signalType === 'SELL';
};

const getSignalMode = (signal = {}, options = {}) =>
  signal.mode ||
  signal.decisionContext?.mode ||
  options.runtimeMode ||
  options.mode ||
  'live';

const isPaperMode = (mode = '') => String(mode).startsWith('paper_');

const getConfig = (options = {}) =>
  options.config || options.systemStatus?.config || options.run?.configSnapshot || {};

export const getBrokerPosture = (signal = {}, options = {}) => {
  const mode = getSignalMode(signal, options);
  const actionable = isActionableSignal(signal);
  const stage = String(signal.decisionContext?.stage || signal.stage || '').toUpperCase();
  const outcome = String(signal.decisionContext?.outcome || signal.outcome || '').toUpperCase();
  const config = getConfig(options);
  const tradingEnabled =
    options.tradingEnabled !== undefined ? options.tradingEnabled : config.enableTrading;

  if (isPaperMode(mode)) {
    return {
      label: mode === 'paper_shadow' ? 'SHADOW PAPER' : 'PAPER ONLY',
      color: 'default',
      feedsBroker: false,
    };
  }

  if (!actionable) {
    return { label: 'NO ORDER', color: 'default', feedsBroker: false };
  }

  if (outcome === 'FILLED' || stage === 'FILLED' || signal.tradeId) {
    return { label: 'FILLED', color: 'success', feedsBroker: true };
  }

  if (
    stage === 'ORDER_SUBMITTED' ||
    signal.orderId ||
    signal.brokerOrderId ||
    signal.decisionContext?.orderId
  ) {
    return { label: 'ORDER SENT', color: 'info', feedsBroker: true };
  }

  if (tradingEnabled === false) {
    return { label: 'BROKER OFF', color: 'warning', feedsBroker: false };
  }

  return { label: 'BROKER FEED', color: 'warning', feedsBroker: true };
};

const getEdgeTone = (edgeBps, thresholdBps, side) => {
  if (edgeBps === null) {
    return 'text.secondary';
  }

  const aligned =
    side === 'SELL'
      ? edgeBps < 0
      : side === 'BUY'
      ? edgeBps > 0
      : edgeBps !== 0;
  const largeEnough = thresholdBps === null || Math.abs(edgeBps) >= thresholdBps;

  if (!aligned) {
    return 'error.main';
  }

  return largeEnough ? 'success.main' : 'warning.main';
};

const getCostTone = (spreadPips, maxSpreadPips) => {
  if (spreadPips === null) {
    return 'text.secondary';
  }

  if (maxSpreadPips === null) {
    return 'warning.main';
  }

  return spreadPips <= maxSpreadPips ? 'success.main' : 'error.main';
};

const getPnlEdgeTone = (edgePips, thresholdPips = null) => {
  if (edgePips === null) {
    return 'text.secondary';
  }

  if (edgePips <= 0) {
    return 'error.main';
  }

  return thresholdPips === null || edgePips >= thresholdPips ? 'success.main' : 'warning.main';
};

const getRegimeTone = (regime = '') => {
  const normalized = String(regime || '').toUpperCase();
  if (['EXTREME', 'TRENDY', 'HIGH'].some((token) => normalized.includes(token))) {
    return 'warning.main';
  }
  if (['BLOCKED', 'OFF', 'UNAVAILABLE'].some((token) => normalized.includes(token))) {
    return 'error.main';
  }
  if (['NORMAL', 'RANGE', 'LOW', 'ACTIVE', 'OK'].some((token) => normalized.includes(token))) {
    return 'success.main';
  }
  return 'text.secondary';
};

export const extractSignalTelemetry = (signal = {}, options = {}) => {
  const timesFm = getTimesFmContext(signal) || {};
  const strategyContext = getStoredStrategyContext(signal);
  const expectedEdge = getExpectedEdgeContext(signal);
  const config = getConfig(options);
  const side = deriveSignalSide(signal);
  const mode = getSignalMode(signal, options);

  const explicitEdgeBps = firstFiniteByPath(signal, [
    'netEdgeBps',
    'expectedEdgeBps',
    'edgeBps',
    'expectedReturnBps',
    'expectedMoveBps',
    'tradePlan.expectedEdgeBps',
    'tradePlan.netEdgeBps',
    'decisionContext.netEdgeBps',
    'decisionContext.expectedEdgeBps',
    'decisionContext.expectedReturnBps',
    'decisionContext.strategyContext.edge.netBps',
    'decisionContext.strategyContext.expectedEdgeBps',
    'decisionContext.strategyContext.expectedReturnBps',
  ]);
  const strategyEdgeBps = firstFiniteValue([
    strategyContext.edge?.netBps,
    strategyContext.expectedEdgeBps,
    strategyContext.expectedReturnBps,
  ]);
  const timesFmEdgeBps = expectedEdge ? null : getTimesFmEdgeBps(timesFm);
  const edgeBps = explicitEdgeBps ?? strategyEdgeBps ?? timesFmEdgeBps;

  const edgePips =
    firstFiniteByPath(signal, [
      'netEdgePips',
      'expectedEdgePips',
      'edgePips',
      'expectedEdge.netExpectancyPips',
      'expectedEdge.netEdgePips',
      'decisionContext.expectedEdge.netExpectancyPips',
      'decisionContext.expectedEdge.netEdgePips',
      'decisionContext.strategyContext.expectedEdge.netExpectancyPips',
      'decisionContext.strategyContext.expectedEdge.netEdgePips',
      'decisionContext.strategyContext.edge.netPips',
      'strategyContext.expectedEdge.netExpectancyPips',
      'strategyContext.expectedEdge.netEdgePips',
      'strategyContext.edge.netPips',
    ]) ?? firstFiniteValue([
      expectedEdge?.netExpectancyPips,
      expectedEdge?.netEdgePips,
      strategyContext.edge?.netPips,
    ]);

  const payoffPips =
    firstFiniteByPath(signal, [
      'expectedEdge.targetAfterCostPips',
      'expectedEdge.payoffSkewPips',
      'decisionContext.expectedEdge.targetAfterCostPips',
      'decisionContext.expectedEdge.payoffSkewPips',
      'decisionContext.strategyContext.expectedEdge.targetAfterCostPips',
      'decisionContext.strategyContext.expectedEdge.payoffSkewPips',
      'strategyContext.expectedEdge.targetAfterCostPips',
      'strategyContext.expectedEdge.payoffSkewPips',
    ]) ?? firstFiniteValue([
      expectedEdge?.targetAfterCostPips,
      expectedEdge?.payoffSkewPips,
    ]);

  const thresholdBps = firstFiniteValue([
    signal.minEdgeBps,
    signal.edgeThresholdBps,
    signal.decisionContext?.minEdgeBps,
    signal.decisionContext?.edgeThresholdBps,
    config.minExpectedEdgeBps,
    config.expectedEdgeThresholdBps,
    config.minNetEdgeBps,
    config.timesFmStrategyMinReturnBps,
  ]);
  const thresholdPips = firstFiniteValue([
    signal.minNetEdgePips,
    signal.decisionContext?.minNetEdgePips,
    config.minNetEdgePips,
  ]);

  const spreadPips =
    firstFiniteByPath(signal, [
      'spreadPips',
      'cost.spreadPips',
      'costs.spreadPips',
      'expectedEdge.spreadCostPips',
      'decisionContext.spreadPips',
      'decisionContext.expectedEdge.spreadCostPips',
      'decisionContext.strategyContext.expectedEdge.spreadCostPips',
      'decisionContext.strategyContext.session.spreadPips',
      'strategyContext.session.spreadPips',
      'strategyContext.expectedEdge.spreadCostPips',
      'session.spreadPips',
    ]) ?? firstFiniteValue([expectedEdge?.spreadCostPips, strategyContext.session?.spreadPips]);

  const costPips =
    firstFiniteByPath(signal, [
      'totalCostPips',
      'expectedCostPips',
      'costPips',
      'cost.totalPips',
      'costs.totalPips',
      'expectedEdge.totalCostPips',
      'decisionContext.totalCostPips',
      'decisionContext.expectedCostPips',
      'decisionContext.expectedEdge.totalCostPips',
      'decisionContext.strategyContext.expectedEdge.totalCostPips',
      'strategyContext.expectedEdge.totalCostPips',
    ]) ?? firstFiniteValue([expectedEdge?.totalCostPips, spreadPips]);

  const costBps = firstFiniteByPath(signal, [
    'totalCostBps',
    'expectedCostBps',
    'costBps',
    'cost.totalBps',
    'costs.totalBps',
    'decisionContext.totalCostBps',
    'decisionContext.expectedCostBps',
  ]);

  const maxSpreadPips = firstFiniteValue([
    signal.maxSpreadPips,
    signal.decisionContext?.configSnapshot?.maxSpreadPips,
    config.maxSpreadPips,
  ]);

  const priceAgeMs = firstFiniteByPath(signal, [
    'priceAgeMs',
    'decisionContext.priceAgeMs',
    'cost.priceAgeMs',
  ]);

  const sessionLabel = firstStringValue([
    strategyContext.session?.name,
    signal.session?.name,
    signal.sessionName,
  ]);

  const regimeLabel = firstStringValue([
    signal.regime,
    signal.marketRegime,
    signal.volatilityRegime,
    strategyContext.regime?.label,
    strategyContext.regime?.name,
    strategyContext.regime?.state,
    strategyContext.volatility?.regime,
    strategyContext.volatility?.volatilityRegime,
    timesFm.volatilityRegime,
    sessionLabel,
  ]);

  const setupLabel = firstStringValue([
    signal.entryType,
    strategyContext.setup,
    signal.setupId,
    signal.reasonCode,
  ]);

  const broker = getBrokerPosture(signal, { ...options, config, runtimeMode: mode });
  const requiresProbabilityModel = Boolean(expectedEdge?.requiresProbabilityModel);
  const brokerFeedingOnly = Boolean(expectedEdge?.brokerFeedingOnly);
  const edgeLabel =
    edgeBps !== null
      ? formatSignedBps(edgeBps)
      : edgePips !== null
      ? formatSignedPips(edgePips)
      : payoffPips !== null
      ? `payoff ${formatSignedPips(payoffPips)}`
      : requiresProbabilityModel
      ? 'needs win-rate'
      : EMPTY_LABEL;
  const edgeTone =
    edgeBps !== null
      ? getEdgeTone(edgeBps, thresholdBps, side)
      : edgePips !== null
      ? getPnlEdgeTone(edgePips, thresholdPips)
      : brokerFeedingOnly
      ? 'error.main'
      : requiresProbabilityModel || payoffPips !== null
      ? 'warning.main'
      : 'text.secondary';
  const edgeThresholdLabel =
    thresholdBps !== null
      ? `${thresholdBps.toFixed(1)} bps min`
      : thresholdPips !== null
      ? `${thresholdPips.toFixed(1)} pips min`
      : EMPTY_LABEL;

  return {
    side,
    mode,
    edgeBps,
    edgePips,
    payoffPips,
    edgeLabel,
    edgeThresholdBps: thresholdBps,
    edgeThresholdPips: thresholdPips,
    edgeThresholdLabel,
    edgeTone,
    spreadPips,
    maxSpreadPips,
    costPips,
    costBps,
    costLabel: costBps !== null ? formatSignedBps(costBps) : formatPips(costPips),
    spreadLabel:
      spreadPips === null
        ? EMPTY_LABEL
        : maxSpreadPips === null
        ? formatPips(spreadPips)
        : `${spreadPips.toFixed(1)} / ${maxSpreadPips.toFixed(1)} pips`,
    costTone: getCostTone(spreadPips, maxSpreadPips),
    priceAgeMs,
    priceAgeLabel: formatMs(priceAgeMs),
    regimeLabel: humanizeTelemetryToken(regimeLabel || 'unknown regime'),
    regimeTone: getRegimeTone(regimeLabel),
    sessionLabel: sessionLabel || EMPTY_LABEL,
    setupLabel: humanizeTelemetryToken(setupLabel || ''),
    broker,
    hasEdge: edgeLabel !== EMPTY_LABEL,
    requiresProbabilityModel,
    brokerFeedingOnly,
    hasCost: costPips !== null || costBps !== null || spreadPips !== null,
    hasRegime: Boolean(regimeLabel),
  };
};

const findFreshFlipToggleKey = (config = {}) =>
  [
    'enableFreshFlipEntries',
    'enableFreshFlips',
    'enableFreshFlip',
    'allowFreshFlipEntries',
    'disableFreshFlipEntries',
    'disableFreshFlips',
  ].find((key) => Object.prototype.hasOwnProperty.call(config, key));

const getFreshFlipPolicy = (config = {}) => {
  const toggleKey = findFreshFlipToggleKey(config);
  if (toggleKey) {
    const disabledKey = toggleKey.toLowerCase().startsWith('disable');
    const enabled = disabledKey ? !Boolean(config[toggleKey]) : Boolean(config[toggleKey]);
    return {
      key: toggleKey,
      label: enabled ? 'Fresh flips on' : 'Fresh flips off',
      color: enabled ? 'success' : 'warning',
      enabled,
    };
  }

  const multiplier = toFiniteNumber(config.freshFlipRiskMultiplier, null);
  if (multiplier !== null) {
    return {
      key: 'freshFlipRiskMultiplier',
      label: multiplier <= 0 ? 'Fresh flips off' : `Fresh flips ${multiplier.toFixed(2)}x`,
      color: multiplier <= 0 ? 'warning' : multiplier < 0.75 ? 'warning' : 'success',
      enabled: multiplier > 0,
    };
  }

  return {
    key: null,
    label: 'Fresh flips --',
    color: 'default',
    enabled: null,
  };
};

export const extractRunTelemetry = (run = {}, options = {}) => {
  const config = run.configSnapshot || options.config || {};
  const lastSignal = run.summary?.lastSignal || run.lastSignal || {};
  const signalTelemetry = extractSignalTelemetry(lastSignal, {
    config,
    run,
    runtimeMode: run.mode || options.runtimeMode,
    tradingEnabled: run.mode === 'live' ? config.enableTrading : false,
  });
  const minEdgeBps = firstFiniteValue([
    config.minExpectedEdgeBps,
    config.expectedEdgeThresholdBps,
    config.minNetEdgeBps,
    config.timesFmStrategyMinReturnBps,
  ]);
  const maxSpreadPips = toFiniteNumber(config.maxSpreadPips, null);
  const maxPriceAgeMs = toFiniteNumber(config.maxPriceAgeMs, null);
  const freshFlip = getFreshFlipPolicy(config);

  return {
    ...signalTelemetry,
    strategy: run.strategy || 'unknown',
    mode: run.mode || signalTelemetry.mode,
    minEdgeBps,
    edgeGateLabel: minEdgeBps === null ? 'Edge gate --' : `Edge >= ${minEdgeBps.toFixed(1)} bps`,
    costGateLabel:
      maxSpreadPips === null ? 'Spread gate --' : `Spread <= ${maxSpreadPips.toFixed(1)} pips`,
    freshnessGateLabel:
      maxPriceAgeMs === null ? 'Price age --' : `Age <= ${formatMs(maxPriceAgeMs)}`,
    freshFlip,
  };
};

export const getFreshFlipToggleKey = findFreshFlipToggleKey;
