import React, { useMemo } from 'react';
import {
  Typography,
  Box,
  LinearProgress,
  Stack,
  Avatar,
  useTheme,
  alpha,
  Chip,
  styled,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Timeline,
  Radar,
  ShowChart,
} from '@mui/icons-material';
import { formatInstrument, INSTRUMENT_INFO } from './Shared';

const STOCHASTIC_DIVERGENCE_KEY = 'stochastic_divergence';
const TIMESFM_DIRECTIONAL_KEY = 'timesfm_directional';

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:nth-of-type(odd)': {
    backgroundColor: alpha(theme.palette.action.hover, 0.05),
  },
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
    cursor: 'default',
  },
  '&:last-child td, &:last-child th': {
    border: 0,
  },
}));

const StyledTableCell = styled(TableCell)(({ theme }) => ({
  padding: '6px 16px',
  height: 40,
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  fontSize: '0.8rem',
  fontFamily: '"Roboto Mono", monospace',
}));

const HeaderCell = styled(TableCell)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.5),
  backdropFilter: 'blur(5px)',
  color: theme.palette.text.secondary,
  fontWeight: 700,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: 1,
  padding: '8px 16px',
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

const MonoText = styled(Typography)(({ theme, color }) => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 500,
  color: color || theme.palette.text.primary,
  fontSize: '0.8rem',
}));

const formatMetric = (value, digits = 1) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '--';
};

const humanizeToken = (value = '') =>
  String(value || '')
    .replace(/_/g, ' ')
    .trim();

const getSignalKey = (signal = {}) => `${signal.symbol || 'unknown'}-${signal.timestamp || '0'}`;

const getResolvedStrategy = (signals = [], activeStrategy = null, systemStatus = null) =>
  activeStrategy ||
  signals.find((signal) => signal?.strategy)?.strategy ||
  systemStatus?.config?.strategy ||
  'supertrend_momentum';

const getSignalMeta = (signalType) => {
  const signal = String(signalType || '').toUpperCase();
  if (signal.includes('BUY')) {
    return { color: 'success', icon: <TrendingUp fontSize="small" /> };
  }
  if (signal.includes('SELL')) {
    return { color: 'error', icon: <TrendingDown fontSize="small" /> };
  }
  return { color: 'info', icon: <Timeline fontSize="small" /> };
};

const getTrendContext = (signal) => {
  let rsiVal = null;
  let trendDir = null;

  try {
    const data =
      typeof signal.trend_data === 'string'
        ? JSON.parse(signal.trend_data)
        : signal.trend_data || signal.trend || {};

    if (data.rsi !== undefined) {
      rsiVal = parseFloat(data.rsi).toFixed(1);
    }

    if (data.supertrend_direction !== undefined) {
      trendDir = data.supertrend_direction;
    } else if (data.direction !== undefined) {
      trendDir = data.direction;
    } else if (signal.stDirection !== undefined) {
      trendDir = signal.stDirection;
    }
  } catch (error) {
    console.warn(`Trend Parse Error (${signal.symbol}):`, error);
  }

  const isBullish = trendDir == 1 || String(signal.signal || '').includes('BUY');
  const isBearish = trendDir == -1 || String(signal.signal || '').includes('SELL');

  return { rsiVal, isBullish, isBearish };
};

const getPendingBadge = (waitingFor) => {
  switch (waitingFor) {
    case 'HTF_CONFIRMATION':
      return { label: 'HTF', color: 'warning' };
    case 'ADX_SLOPE_RISING':
      return { label: 'SLOPE', color: 'error' };
    case 'ADX_STRENGTHEN':
      return { label: 'ADX', color: 'error' };
    case 'RSI_COOLDOWN':
    case 'RSI_RECOVERY':
      return { label: 'RSI', color: 'error' };
    case 'BOTH':
      return { label: 'ADX', color: 'error' };
    default:
      return { label: 'WAIT', color: 'warning' };
  }
};

const getGenericSignalStatus = (signal, config) => {
  const minAdx = config?.minAdx || 22;
  const adxVal = signal.strength || signal.trend?.adx || 0;
  const adxRising = signal.trend?.adxRising;
  const waitingFor = signal.pendingEntry?.waitingFor;
  const signalType = signal.signal;

  if (signal.signalClass === 'COOLDOWN') {
    return {
      badges: [{ label: 'COOLDOWN', color: 'default' }],
    };
  }

  if (signalType === 'BUY' || signalType === 'SELL') {
    return {
      badges: [{ label: 'NEW', color: 'success' }],
    };
  }

  const badges = [];

  if (waitingFor) {
    if (signal.pendingEntry?.direction === 'SHORT') {
      badges.push({ label: 'SHORT', color: 'warning' });
    }
    badges.push(getPendingBadge(waitingFor));
  } else {
    if (adxVal < minAdx) {
      badges.push({ label: 'ADX', color: 'warning' });
    }
    if (adxRising === false) {
      badges.push({ label: 'SLOPE', color: 'warning' });
    }
  }

  if (badges.length === 0) {
    badges.push({ label: signal.signalClass || 'HOLD', color: 'default' });
  }

  return { badges };
};

const inferStochasticSetup = (signal, strategyContext = null) => {
  if (strategyContext?.setup && strategyContext.setup !== 'none') {
    return strategyContext.setup;
  }

  const reasonCode = String(signal.reasonCode || '').toUpperCase();
  const message = String(signal.message || '').toLowerCase();

  if (
    reasonCode.includes('_LONG_') ||
    reasonCode.includes('HTF_LONG') ||
    message.includes('bullish divergence')
  ) {
    return 'bullish_divergence';
  }

  if (
    reasonCode.includes('_SHORT_') ||
    reasonCode.includes('HTF_SHORT') ||
    message.includes('bearish divergence')
  ) {
    return 'bearish_divergence';
  }

  return 'none';
};

const inferStochasticEntryBias = (signal, setup) => {
  if (signal.strategyContext?.entryBias) {
    return signal.strategyContext.entryBias;
  }

  if (signal.signal === 'BUY' || setup === 'bullish_divergence') {
    return 'long';
  }

  if (signal.signal === 'SELL' || setup === 'bearish_divergence') {
    return 'short';
  }

  return null;
};

const inferStochasticCrossState = (signal, strategyContext = null) => {
  if (strategyContext?.crossState && strategyContext.crossState !== 'none') {
    return strategyContext.crossState;
  }

  const reasonCode = String(signal.reasonCode || '').toUpperCase();

  if (reasonCode.includes('WAIT_CROSS')) {
    return 'waiting';
  }

  if (signal.signal === 'BUY' || signal.signal === 'SELL') {
    return 'confirmed';
  }

  return 'none';
};

const getStochasticContext = (signal) => {
  const strategyContext = signal.strategyContext || null;
  const setup = inferStochasticSetup(signal, strategyContext);

  return {
    setup,
    entryBias: inferStochasticEntryBias(signal, setup),
    crossState: inferStochasticCrossState(signal, strategyContext),
    m15K:
      strategyContext?.m15?.k ??
      signal.decisionContext?.rsi ??
      signal.trend?.rsi ??
      null,
    m15D:
      strategyContext?.m15?.d ??
      signal.decisionContext?.pdi ??
      signal.trend?.pdi ??
      null,
    h1K:
      strategyContext?.h1?.k ??
      signal.decisionContext?.mdi ??
      signal.trend?.mdi ??
      null,
    h1Direction: strategyContext?.h1?.direction || null,
    pivots: strategyContext?.pivots || null,
  };
};

const getStochasticSetupLabel = (setup) => {
  switch (setup) {
    case 'bullish_divergence':
      return 'Bullish Divergence';
    case 'bearish_divergence':
      return 'Bearish Divergence';
    default:
      return 'Scanning For Setup';
  }
};

const getStochasticSetupChipLabel = (setup) => {
  switch (setup) {
    case 'bullish_divergence':
      return 'BULL DIV';
    case 'bearish_divergence':
      return 'BEAR DIV';
    default:
      return 'SCAN';
  }
};

const getStochasticCrossLabel = (crossState) => {
  switch (crossState) {
    case 'confirmed':
      return 'Cross Confirmed';
    case 'waiting':
      return 'Waiting For Cross';
    default:
      return 'No Confirmed Trigger';
  }
};

const getStochasticReasonLabel = (reasonCode) => {
  const normalized = String(reasonCode || '').replace(/^STOCHASTIC_DIVERGENCE_/, '');
  return humanizeToken(normalized || 'runtime signal');
};

const getStochasticStatusBadges = (signal, context) => {
  const badges = [];

  if (signal.signalClass === 'ACTIONABLE' || signal.signal === 'BUY' || signal.signal === 'SELL') {
    badges.push({
      label: 'ENTRY',
      color: signal.signal === 'SELL' ? 'error' : 'success',
    });
  } else if (signal.signalClass === 'PENDING') {
    badges.push({ label: 'PENDING', color: 'warning' });
  } else if (signal.signalClass === 'FILTERED') {
    badges.push({ label: 'FILTERED', color: 'default' });
  } else if (signal.signalClass === 'COOLDOWN') {
    badges.push({ label: 'COOLDOWN', color: 'default' });
  }

  if (context.setup !== 'none') {
    badges.push({
      label: getStochasticSetupChipLabel(context.setup),
      color: context.entryBias === 'short' ? 'error' : 'success',
    });
  }

  if (context.crossState === 'waiting') {
    badges.push({ label: 'WAIT CROSS', color: 'warning' });
  } else if (context.crossState === 'confirmed') {
    badges.push({ label: 'CROSS', color: 'success' });
  }

  if (String(signal.reasonCode || '').includes('HTF_')) {
    badges.push({ label: 'HTF', color: 'warning' });
  }

  return badges.filter(
    (badge, index, collection) =>
      collection.findIndex((candidate) => candidate.label === badge.label) === index
  ).concat(
    badges.length === 0 ? [{ label: 'WAIT', color: 'default' }] : []
  );
};

const getStochasticContextLine = (context) =>
  `M15 %K ${formatMetric(context.m15K)} / %D ${formatMetric(context.m15D)}`;

const getStochasticHtfLine = (context) => {
  const h1Direction = context.h1Direction ? ` ${context.h1Direction}` : '';
  return `H1 %K ${formatMetric(context.h1K)}${h1Direction}`;
};

const getStochasticPivotLine = (context) => {
  const firstPrice = context.pivots?.first?.price;
  const secondPrice = context.pivots?.second?.price;

  if (!Number.isFinite(firstPrice) || !Number.isFinite(secondPrice)) {
    return null;
  }

  return `Pivots ${firstPrice.toFixed(5)} -> ${secondPrice.toFixed(5)}`;
};

const getTimesFmContext = (signal = {}) =>
  signal.timesFm ||
  signal.strategyContext?.timesFm ||
  signal.decisionContext?.timesFm ||
  null;

const getTimesFmDirection = (signal = {}, timesFm = null) => {
  const forecastDirection = String(timesFm?.direction || '').toUpperCase();
  if (forecastDirection === 'BULLISH' || forecastDirection === 'BEARISH') {
    return forecastDirection;
  }
  if (forecastDirection === 'NEUTRAL') {
    return 'NEUTRAL';
  }
  if (signal.signal === 'BUY') return 'BULLISH';
  if (signal.signal === 'SELL') return 'BEARISH';
  return 'NEUTRAL';
};

const getTimesFmMeta = (signal = {}, timesFm = null) => {
  const direction = getTimesFmDirection(signal, timesFm);
  if (direction === 'BULLISH') {
    return { direction, color: 'success', icon: <TrendingUp fontSize="small" /> };
  }
  if (direction === 'BEARISH') {
    return { direction, color: 'error', icon: <TrendingDown fontSize="small" /> };
  }
  return { direction, color: 'info', icon: <Timeline fontSize="small" /> };
};

const getTimesFmConfidence = (signal = {}, timesFm = null) => {
  const confidence = Number(timesFm?.confidence);
  if (Number.isFinite(confidence)) {
    return `${(confidence * 100).toFixed(0)}%`;
  }

  const strength = Number(signal.strength);
  return Number.isFinite(strength) ? `${strength.toFixed(0)}%` : '--';
};

const getTimesFmReturn = (timesFm = null) => {
  const returnBps = Number(timesFm?.returnBps);
  return Number.isFinite(returnBps) ? `${returnBps.toFixed(1)} bps` : '--';
};

const getTimesFmVolatility = (timesFm = null) =>
  timesFm?.volatilityRegime || '--';

const getTimesFmReasonLabel = (signal = {}, timesFm = null) => {
  if (timesFm?.available === false && timesFm.reason) {
    return `TimesFM ${humanizeToken(timesFm.reason)}`;
  }
  return humanizeToken(signal.reasonCode || signal.signalClass || 'runtime signal');
};

const getTimesFmStatusBadges = (signal = {}, timesFm = null) => {
  const badges = [];

  if (signal.signal === 'BUY' || signal.signal === 'SELL') {
    badges.push({
      label: 'ENTRY',
      color: signal.signal === 'SELL' ? 'error' : 'success',
    });
  } else if (timesFm?.available === false) {
    badges.push({ label: 'NO FORECAST', color: 'warning' });
  } else if (getTimesFmDirection(signal, timesFm) === 'NEUTRAL') {
    badges.push({ label: 'NEUTRAL', color: 'default' });
  } else {
    badges.push({ label: signal.signalClass || 'FILTERED', color: 'default' });
  }

  if (timesFm?.cacheHit === true) {
    badges.push({ label: 'CACHE', color: 'info' });
  }

  return badges;
};

const TradingSignals = ({
  signals,
  systemStatus,
  compact = false,
  activeStrategy = null,
}) => {
  const theme = useTheme();

  const filteredSignals = useMemo(() => {
    if (!signals || !Array.isArray(signals)) {
      return [];
    }

    if (!systemStatus?.config?.assets) {
      return signals;
    }

    const activeAssets = new Set(systemStatus.config.assets);
    return signals
      .filter((signal) => activeAssets.has(signal.symbol))
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  }, [signals, systemStatus]);

  const dataStatus = useMemo(() => {
    if (!systemStatus?.services?.dataService) {
      return null;
    }

    const { candleCount: totalCandles = 0 } = systemStatus.services.dataService;
    const target = 800;
    const percent = Math.min((totalCandles / target) * 100, 100);
    return { totalCandles, percent };
  }, [systemStatus]);

  const resolvedStrategy = useMemo(
    () => getResolvedStrategy(filteredSignals, activeStrategy, systemStatus),
    [filteredSignals, activeStrategy, systemStatus]
  );

  if (filteredSignals.length === 0) {
    const timesFmMode = systemStatus?.config?.timesFmMode || 'disabled';
    const isTimesFmStrategy = resolvedStrategy === TIMESFM_DIRECTIONAL_KEY;

    return (
      <Box
        height="100%"
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        color="text.secondary"
        p={4}
      >
        <Radar sx={{ fontSize: 48, opacity: 0.2, mb: 2, animation: 'pulse 2s infinite' }} />
        <Typography variant="body2" fontWeight="bold">
          {isTimesFmStrategy ? 'NO TIMESFM SIGNAL SNAPSHOT' : 'NO ACTIVE SIGNALS'}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {signals && signals.length > 0
            ? 'Signals exist but match no active assets.'
            : isTimesFmStrategy
            ? `Waiting for the next TimesFM ${timesFmMode} runtime cycle...`
            : 'Scanning portfolio assets...'}
        </Typography>

        {dataStatus && dataStatus.percent < 100 && (
          <Box width="100%" maxWidth={200} mt={3}>
            <Box display="flex" justifyContent="space-between" mb={0.5}>
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
                DATA TRAINING
              </Typography>
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
                {Math.round(dataStatus.percent)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={dataStatus.percent}
              sx={{ height: 2, borderRadius: 2 }}
            />
          </Box>
        )}
      </Box>
    );
  }

  if (resolvedStrategy === TIMESFM_DIRECTIONAL_KEY) {
    if (compact) {
      return (
        <Stack spacing={0} sx={{ height: '100%', overflowY: 'auto' }}>
          {filteredSignals.map((signal) => {
            const timesFm = getTimesFmContext(signal);
            const { direction, color, icon } = getTimesFmMeta(signal, timesFm);
            const paletteColor = theme.palette[color];
            const info = INSTRUMENT_INFO[signal.symbol] || {};
            const reasonLabel = getTimesFmReasonLabel(signal, timesFm);

            return (
              <Box
                key={getSignalKey(signal)}
                sx={{
                  p: 1.5,
                  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1.5,
                  '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.05) },
                }}
              >
                <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
                  <Avatar
                    variant="rounded"
                    sx={{
                      width: 28,
                      height: 28,
                      bgcolor: alpha(paletteColor.main, 0.1),
                      color: paletteColor.main,
                      border: `1px solid ${alpha(paletteColor.main, 0.2)}`,
                    }}
                  >
                    {icon}
                  </Avatar>
                  <Box minWidth={0}>
                    <Typography variant="body2" fontWeight="bold">
                      {info.flag || '💱'} {formatInstrument(signal.symbol)}
                    </Typography>
                    <MonoText sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                      {new Date(signal.timestamp).toLocaleTimeString([], { hour12: false })}
                    </MonoText>
                  </Box>
                </Box>
                <Box textAlign="right" minWidth={0}>
                  <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                    <Chip
                      label={direction}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        fontWeight: 'bold',
                        bgcolor: alpha(paletteColor.main, 0.1),
                        color: paletteColor.main,
                      }}
                    />
                    <Chip
                      label={signal.signal || 'HOLD'}
                      size="small"
                      color={signal.signal === 'SELL' ? 'error' : signal.signal === 'BUY' ? 'success' : 'default'}
                      sx={{ height: 18, fontSize: '0.6rem', fontWeight: 'bold' }}
                    />
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5, fontSize: '0.68rem' }}
                  >
                    Conf {getTimesFmConfidence(signal, timesFm)} | {getTimesFmReturn(timesFm)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontSize: '0.63rem',
                      color:
                        signal.signalClass === 'ACTIONABLE'
                          ? paletteColor.main
                          : theme.palette.text.secondary,
                      letterSpacing: 0.3,
                      maxWidth: 240,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {reasonLabel}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Stack>
      );
    }

    return (
      <TableContainer component={Box} sx={{ height: '100%', overflow: 'auto' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <HeaderCell>Pair</HeaderCell>
              <HeaderCell>Time</HeaderCell>
              <HeaderCell>Forecast</HeaderCell>
              <HeaderCell align="right">Confidence</HeaderCell>
              <HeaderCell align="right">Return</HeaderCell>
              <HeaderCell align="center">Volatility</HeaderCell>
              <HeaderCell align="center">Status</HeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSignals.map((signal) => {
              const timesFm = getTimesFmContext(signal);
              const { direction, color, icon } = getTimesFmMeta(signal, timesFm);
              const paletteColor = theme.palette[color];
              const info = INSTRUMENT_INFO[signal.symbol] || {};
              const statusBadges = getTimesFmStatusBadges(signal, timesFm);
              const reasonLabel = getTimesFmReasonLabel(signal, timesFm);

              return (
                <StyledTableRow key={getSignalKey(signal)}>
                  <StyledTableCell>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Avatar
                        variant="rounded"
                        sx={{
                          width: 24,
                          height: 24,
                          bgcolor: alpha(paletteColor.main, 0.1),
                          color: paletteColor.main,
                        }}
                      >
                        {icon}
                      </Avatar>
                      <Typography variant="body2" sx={{ fontSize: '0.9rem' }}>
                        {info.flag || '💱'}
                      </Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {formatInstrument(signal.symbol)}
                      </Typography>
                    </Box>
                  </StyledTableCell>

                  <StyledTableCell>
                    {new Date(signal.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </StyledTableCell>

                  <StyledTableCell>
                    <Chip
                      label={direction}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        fontWeight: 'bold',
                        bgcolor: alpha(paletteColor.main, 0.1),
                        color: paletteColor.main,
                        border: `1px solid ${alpha(paletteColor.main, 0.2)}`,
                      }}
                    />
                  </StyledTableCell>

                  <StyledTableCell align="right">
                    <MonoText>{getTimesFmConfidence(signal, timesFm)}</MonoText>
                  </StyledTableCell>

                  <StyledTableCell align="right">
                    <MonoText
                      color={
                        Number(timesFm?.returnBps) > 0
                          ? theme.palette.success.main
                          : Number(timesFm?.returnBps) < 0
                          ? theme.palette.error.main
                          : theme.palette.text.secondary
                      }
                    >
                      {getTimesFmReturn(timesFm)}
                    </MonoText>
                  </StyledTableCell>

                  <StyledTableCell align="center">
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color:
                          getTimesFmVolatility(timesFm) === 'EXTREME'
                            ? 'error.main'
                            : getTimesFmVolatility(timesFm) === 'HIGH'
                            ? 'warning.main'
                            : 'text.secondary',
                      }}
                    >
                      {getTimesFmVolatility(timesFm)}
                    </Typography>
                  </StyledTableCell>

                  <StyledTableCell align="center">
                    <Box display="flex" flexDirection="column" alignItems="center" gap={0.5}>
                      <Box display="flex" gap={0.5} justifyContent="center" flexWrap="wrap">
                        {statusBadges.map((badge) => (
                          <Chip
                            key={`${badge.label}-${signal.symbol}`}
                            label={badge.label}
                            size="small"
                            color={badge.color}
                            sx={{
                              height: 18,
                              fontSize: '0.6rem',
                              fontWeight: 'bold',
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
                        ))}
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.62rem',
                          color: 'text.secondary',
                          letterSpacing: 0.4,
                        }}
                      >
                        {reasonLabel}
                      </Typography>
                    </Box>
                  </StyledTableCell>
                </StyledTableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (resolvedStrategy === STOCHASTIC_DIVERGENCE_KEY) {
    if (compact) {
      return (
        <Stack spacing={0} sx={{ height: '100%', overflowY: 'auto' }}>
          {filteredSignals.map((signal) => {
            const { color, icon } = getSignalMeta(signal.signal);
            const paletteColor = theme.palette[color];
            const info = INSTRUMENT_INFO[signal.symbol] || {};
            const stochasticContext = getStochasticContext(signal);
            const reasonLabel = getStochasticReasonLabel(signal.reasonCode);
            const contextLine = `${getStochasticContextLine(stochasticContext)} | ${getStochasticHtfLine(
              stochasticContext
            )}`;

            return (
              <Box
                key={getSignalKey(signal)}
                sx={{
                  p: 1.5,
                  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1.5,
                  '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.05) },
                }}
              >
                <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
                  <Avatar
                    variant="rounded"
                    sx={{
                      width: 28,
                      height: 28,
                      bgcolor: alpha(paletteColor.main, 0.1),
                      color: paletteColor.main,
                      border: `1px solid ${alpha(paletteColor.main, 0.2)}`,
                    }}
                  >
                    {icon}
                  </Avatar>
                  <Box minWidth={0}>
                    <Typography variant="body2" fontWeight="bold">
                      {info.flag || '💱'} {formatInstrument(signal.symbol)}
                    </Typography>
                    <MonoText sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                      {new Date(signal.timestamp).toLocaleTimeString([], { hour12: false })}
                    </MonoText>
                  </Box>
                </Box>
                <Box textAlign="right" minWidth={0}>
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="flex-end"
                    gap={0.5}
                    flexWrap="wrap"
                  >
                    <Chip
                      label={signal.signal?.split('_')[0] || 'HOLD'}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        fontWeight: 'bold',
                        bgcolor: alpha(paletteColor.main, 0.1),
                        color: paletteColor.main,
                      }}
                    />
                    <Chip
                      label={getStochasticSetupChipLabel(stochasticContext.setup)}
                      size="small"
                      color={
                        stochasticContext.entryBias === 'short'
                          ? 'error'
                          : stochasticContext.entryBias === 'long'
                          ? 'success'
                          : 'default'
                      }
                      sx={{ height: 18, fontSize: '0.6rem', fontWeight: 'bold' }}
                    />
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: 'block',
                      mt: 0.5,
                      fontSize: '0.68rem',
                      maxWidth: 240,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {contextLine}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontSize: '0.63rem',
                      color:
                        signal.signalClass === 'ACTIONABLE'
                          ? paletteColor.main
                          : theme.palette.text.secondary,
                      letterSpacing: 0.3,
                    }}
                  >
                    {reasonLabel}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Stack>
      );
    }

    return (
      <TableContainer component={Box} sx={{ height: '100%', overflow: 'auto' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <HeaderCell>Pair</HeaderCell>
              <HeaderCell>Time</HeaderCell>
              <HeaderCell>Action</HeaderCell>
              <HeaderCell>Setup</HeaderCell>
              <HeaderCell>Context</HeaderCell>
              <HeaderCell align="center">Reason</HeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSignals.map((signal) => {
              const { color, icon } = getSignalMeta(signal.signal);
              const paletteColor = theme.palette[color];
              const info = INSTRUMENT_INFO[signal.symbol] || {};
              const stochasticContext = getStochasticContext(signal);
              const statusBadges = getStochasticStatusBadges(signal, stochasticContext);
              const pivotLine = getStochasticPivotLine(stochasticContext);

              return (
                <StyledTableRow key={getSignalKey(signal)}>
                  <StyledTableCell>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Avatar
                        variant="rounded"
                        sx={{
                          width: 24,
                          height: 24,
                          bgcolor: alpha(paletteColor.main, 0.1),
                          color: paletteColor.main,
                        }}
                      >
                        {icon}
                      </Avatar>
                      <Typography variant="body2" sx={{ fontSize: '0.9rem' }}>
                        {info.flag || '💱'}
                      </Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {formatInstrument(signal.symbol)}
                      </Typography>
                    </Box>
                  </StyledTableCell>

                  <StyledTableCell>
                    {new Date(signal.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </StyledTableCell>

                  <StyledTableCell>
                    <Chip
                      label={signal.signal?.replace(/_/g, ' ') || 'UNKNOWN'}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        fontWeight: 'bold',
                        bgcolor: alpha(paletteColor.main, 0.1),
                        color: paletteColor.main,
                        border: `1px solid ${alpha(paletteColor.main, 0.2)}`,
                      }}
                    />
                  </StyledTableCell>

                  <StyledTableCell>
                    <Box display="flex" flexDirection="column">
                      <Typography
                        variant="caption"
                        sx={{
                          color:
                            stochasticContext.entryBias === 'short'
                              ? 'error.main'
                              : stochasticContext.entryBias === 'long'
                              ? 'success.main'
                              : 'text.secondary',
                          fontWeight: 'bold',
                          fontSize: '0.72rem',
                          letterSpacing: 0.4,
                        }}
                      >
                        {getStochasticSetupLabel(stochasticContext.setup)}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ fontSize: '0.65rem', color: 'text.secondary', mt: 0.2 }}
                      >
                        {getStochasticCrossLabel(stochasticContext.crossState)}
                      </Typography>
                    </Box>
                  </StyledTableCell>

                  <StyledTableCell>
                    <Box display="flex" flexDirection="column" gap={0.15}>
                      <MonoText sx={{ fontSize: '0.72rem' }}>
                        {getStochasticContextLine(stochasticContext)}
                      </MonoText>
                      <MonoText sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                        {getStochasticHtfLine(stochasticContext)}
                      </MonoText>
                      {pivotLine && (
                        <Typography
                          variant="caption"
                          sx={{ fontSize: '0.62rem', color: 'text.secondary' }}
                        >
                          {pivotLine}
                        </Typography>
                      )}
                    </Box>
                  </StyledTableCell>

                  <StyledTableCell align="center">
                    <Box display="flex" flexDirection="column" alignItems="center" gap={0.5}>
                      <Box display="flex" gap={0.5} justifyContent="center" flexWrap="wrap">
                        {statusBadges.map((badge) => (
                          <Chip
                            key={`${badge.label}-${signal.symbol}`}
                            label={badge.label}
                            size="small"
                            color={badge.color}
                            sx={{
                              height: 18,
                              fontSize: '0.6rem',
                              fontWeight: 'bold',
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
                        ))}
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.62rem',
                          color: 'text.secondary',
                          letterSpacing: 0.4,
                        }}
                      >
                        {getStochasticReasonLabel(signal.reasonCode)}
                      </Typography>
                    </Box>
                  </StyledTableCell>
                </StyledTableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (compact) {
    return (
      <Stack spacing={0} sx={{ height: '100%', overflowY: 'auto' }}>
        {filteredSignals.map((signal) => {
          const { color, icon } = getSignalMeta(signal.signal);
          const paletteColor = theme.palette[color];
          const info = INSTRUMENT_INFO[signal.symbol] || {};
          const pendingBadge = signal.signal === 'HOLD' && signal.pendingEntry?.waitingFor
            ? getPendingBadge(signal.pendingEntry.waitingFor)
            : null;

          return (
            <Box
              key={getSignalKey(signal)}
              sx={{
                p: 1.5,
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.05) },
              }}
            >
              <Box display="flex" alignItems="center" gap={1.5}>
                <Avatar
                  variant="rounded"
                  sx={{
                    width: 28,
                    height: 28,
                    bgcolor: alpha(paletteColor.main, 0.1),
                    color: paletteColor.main,
                    border: `1px solid ${alpha(paletteColor.main, 0.2)}`,
                  }}
                >
                  {icon}
                </Avatar>
                <Box>
                  <Typography variant="body2" fontWeight="bold">
                    {info.flag || '💱'} {formatInstrument(signal.symbol)}
                  </Typography>
                  <MonoText sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                    {new Date(signal.timestamp).toLocaleTimeString([], { hour12: false })}
                  </MonoText>
                </Box>
              </Box>
              <Box textAlign="right">
                <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                  <Chip
                    label={signal.signal?.split('_')[0]}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: '0.65rem',
                      fontWeight: 'bold',
                      bgcolor: alpha(paletteColor.main, 0.1),
                      color: paletteColor.main,
                    }}
                  />
                  {pendingBadge && (
                    <>
                      {signal.pendingEntry?.direction === 'SHORT' && (
                        <Chip
                          label="S"
                          size="small"
                          color="warning"
                          sx={{
                            height: 14,
                            fontSize: '0.55rem',
                            '& .MuiChip-label': { px: 0.3 },
                          }}
                        />
                      )}
                      <Chip
                        label={pendingBadge.label}
                        size="small"
                        color={pendingBadge.color}
                        sx={{
                          height: 14,
                          fontSize: '0.55rem',
                          '& .MuiChip-label': { px: 0.5 },
                        }}
                      />
                    </>
                  )}
                </Box>
                <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.3} mt={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    ADX: {signal.strength?.toFixed(0)}
                  </Typography>
                  {signal.trend?.adxRising !== undefined && (
                    <Typography
                      component="span"
                      sx={{
                        fontSize: '0.75rem',
                        color: signal.trend.adxRising ? 'success.main' : 'error.main',
                        fontWeight: 'bold',
                      }}
                    >
                      {signal.trend.adxRising ? '↑' : '↓'}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Stack>
    );
  }

  return (
    <TableContainer component={Box} sx={{ height: '100%', overflow: 'auto' }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            <HeaderCell>Pair</HeaderCell>
            <HeaderCell>Time</HeaderCell>
            <HeaderCell>Signal Type</HeaderCell>
            <HeaderCell align="right">Strength (ADX)</HeaderCell>
            <HeaderCell align="center">Trend / RSI</HeaderCell>
            <HeaderCell align="center">Status</HeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredSignals.map((signal) => {
            const { color, icon } = getSignalMeta(signal.signal);
            const paletteColor = theme.palette[color];
            const { rsiVal, isBullish, isBearish } = getTrendContext(signal);
            const info = INSTRUMENT_INFO[signal.symbol] || {};
            const status = getGenericSignalStatus(signal, systemStatus?.config);

            return (
              <StyledTableRow key={getSignalKey(signal)}>
                <StyledTableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Avatar
                      variant="rounded"
                      sx={{
                        width: 24,
                        height: 24,
                        bgcolor: alpha(paletteColor.main, 0.1),
                        color: paletteColor.main,
                      }}
                    >
                      {icon}
                    </Avatar>
                    <Typography variant="body2" sx={{ fontSize: '0.9rem' }}>
                      {info.flag || '💱'}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {formatInstrument(signal.symbol)}
                    </Typography>
                  </Box>
                </StyledTableCell>

                <StyledTableCell>
                  {new Date(signal.timestamp).toLocaleTimeString([], {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </StyledTableCell>

                <StyledTableCell>
                  <Chip
                    label={signal.signal?.replace(/_/g, ' ') || 'UNKNOWN'}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      bgcolor: alpha(paletteColor.main, 0.1),
                      color: paletteColor.main,
                      border: `1px solid ${alpha(paletteColor.main, 0.2)}`,
                    }}
                  />
                </StyledTableCell>

                <StyledTableCell align="right">
                  <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min((signal.strength || 0) * 2, 100)}
                      sx={{ width: 50, height: 4, borderRadius: 2 }}
                      color={signal.strength > (systemStatus?.config?.minAdx || 22) ? 'primary' : 'secondary'}
                    />
                    <Box display="flex" alignItems="center" gap={0.3}>
                      <MonoText>{signal.strength?.toFixed(1)}</MonoText>
                      {signal.trend?.adxRising !== undefined && (
                        <Typography
                          component="span"
                          sx={{
                            fontSize: '0.9rem',
                            color: signal.trend.adxRising ? 'success.main' : 'error.main',
                            fontWeight: 'bold',
                            lineHeight: 1,
                          }}
                        >
                          {signal.trend.adxRising ? '↑' : '↓'}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </StyledTableCell>

                <StyledTableCell align="center">
                  <Box display="flex" flexDirection="column" alignItems="center">
                    <Typography
                      variant="caption"
                      sx={{
                        color: isBullish
                          ? 'success.main'
                          : isBearish
                          ? 'error.main'
                          : 'text.disabled',
                        fontWeight: 'bold',
                        fontSize: '0.7rem',
                        letterSpacing: 0.5,
                      }}
                    >
                      {isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : '-'}
                    </Typography>
                    {rsiVal && (
                      <Box display="flex" alignItems="center" gap={0.5} mt={0.2}>
                        <ShowChart sx={{ fontSize: 10, color: 'text.secondary' }} />
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: '0.65rem',
                            fontFamily: 'monospace',
                            color:
                              rsiVal > 70
                                ? 'error.main'
                                : rsiVal < 30
                                ? 'success.main'
                                : 'text.secondary',
                          }}
                        >
                          RSI: {rsiVal}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </StyledTableCell>

                <StyledTableCell align="center">
                  <Box display="flex" gap={0.5} justifyContent="center" flexWrap="wrap">
                    {status.badges.map((badge) => (
                      <Chip
                        key={`${badge.label}-${signal.symbol}`}
                        label={badge.label}
                        size="small"
                        color={badge.color}
                        sx={{
                          height: 18,
                          fontSize: '0.6rem',
                          fontWeight: 'bold',
                          '& .MuiChip-label': { px: 0.75 },
                        }}
                      />
                    ))}
                  </Box>
                </StyledTableCell>
              </StyledTableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default TradingSignals;
