import React, { useMemo } from 'react';
import {
  Alert,
  Box,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Radar } from '@mui/icons-material';
import { isH4Trend, strategyLabel } from '../../utils/strategyDisplay';

const formatInstrument = (value = '') => value.replace('_', '/');
const number = (value, digits = 2) => {
  if (value === null || value === undefined || value === '') return '--';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '--';
};
const signalColor = (signal) => {
  if (signal === 'BUY') return 'success';
  if (signal === 'SELL') return 'error';
  if (signal === 'COOLDOWN') return 'warning';
  return 'default';
};

const TradingSignals = ({ signals, systemStatus, compact = false }) => {
  const h4Release = isH4Trend(systemStatus?.config || {});
  const filtered = useMemo(() => {
    const assets = new Set(systemStatus?.config?.assets || []);
    return (Array.isArray(signals) ? signals : [])
      .filter((signal) => !assets.size || assets.has(signal.symbol))
      .sort((left, right) => Number(right.strength || 0) - Number(left.strength || 0));
  }, [signals, systemStatus]);

  if (!filtered.length) {
    const candles = Number(systemStatus?.services?.dataService?.candleCount || 0);
    return (
      <Box height="100%" display="grid" sx={{ placeItems: 'center' }} p={3}>
        <Stack alignItems="center" spacing={1.5} maxWidth={420}>
          <Radar sx={{ fontSize: 48, opacity: 0.25 }} />
          <Typography variant="body2" fontWeight={800}>WAITING FOR LIVE MARKET SNAPSHOT</Typography>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            {h4Release
              ? 'H4 Trend is loading completed H4 candles and the current OANDA quote.'
              : 'M15 Intraday Momentum is loading complete M15 and H1 candles plus the current OANDA spread.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">{candles} completed candles cached</Typography>
        </Stack>
      </Box>
    );
  }

  if (compact) {
    return (
      <Stack sx={{ height: '100%', overflowY: 'auto' }} divider={<Box borderBottom={1} borderColor="divider" />}>
        {filtered.map((signal) => {
          const context = signal.strategyContext || signal.decisionContext?.strategyContext || {};
          const h4Signal = isH4Trend(signal) || isH4Trend(context);
          return (
            <Box key={`${signal.symbol}-${signal.signalCandleTime}-${signal.reasonCode}`} p={1.5}>
              <Stack direction="row" justifyContent="space-between" gap={2}>
                <Box minWidth={0}>
                  <Typography fontWeight={800}>{formatInstrument(signal.symbol)}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{signal.message}</Typography>
                </Box>
                <Stack alignItems="flex-end" spacing={0.5}>
                  <Chip size="small" label={signal.signal} color={signalColor(signal.signal)} />
                  <Typography variant="caption">
                    {h4Signal ? `H4 ATR ${number(context.h4?.atr, signal.symbol?.endsWith('_JPY') ? 3 : 5)}`
                      : `H1 ADX ${number(context.h1?.adx, 1)}`}
                  </Typography>
                </Stack>
              </Stack>
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
            <TableCell>Pair</TableCell>
            <TableCell>Live action</TableCell>
            <TableCell>Strategy / direction</TableCell>
            <TableCell align="right">Volatility / strength</TableCell>
            <TableCell align="right">Setup / cost</TableCell>
            <TableCell>Decision</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filtered.map((signal) => {
            const context = signal.strategyContext || signal.decisionContext?.strategyContext || {};
            const h1 = context.h1 || {};
            const m15 = context.m15 || {};
            const h4 = context.h4 || {};
            const h4Signal = isH4Trend(signal) || isH4Trend(context);
            const costs = context.costs || {};
            const trend = h1.longRegime ? 'LONG' : h1.shortRegime ? 'SHORT' : 'FLAT';
            const channelDirection = h4.freshLong ? 'LONG BREAKOUT' : h4.freshShort ? 'SHORT BREAKOUT'
              : h4.channelHigh != null ? 'IN CHANNEL / NO FRESH BREAKOUT' : 'AWAITING H4 DATA';
            const priceDigits = signal.symbol?.endsWith('_JPY') ? 3 : 5;
            return (
              <TableRow key={`${signal.symbol}-${signal.signalCandleTime}-${signal.reasonCode}`} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={800}>{formatInstrument(signal.symbol)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(signal.timestamp).toLocaleTimeString([], { hour12: false })}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.75}>
                    <Chip size="small" label={signal.signal || 'HOLD'} color={signalColor(signal.signal)} />
                    {(signal.signalClass === 'EXIT_ONLY' || signal.entryType === 'EXIT_ONLY' ||
                      ['EXIT_LONG_ONLY', 'EXIT_SHORT_ONLY'].includes(signal.intent)) &&
                      <Chip size="small" label="EXIT ONLY" variant="outlined" />}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {strategyLabel(signal.strategy || context.family)} v{signal.strategyVersion || context.version || 'unknown'}
                  </Typography>
                  {h4Signal ? channelDirection : `H1 ${trend}`}
                </TableCell>
                <TableCell align="right">
                  {h4Signal ? `ATR ${number(h4.atr, priceDigits)}` : `ADX ${number(h1.adx, 1)}`}
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" fontFamily="monospace">
                    {h4Signal ? `H4 ${number(h4.channelLow, priceDigits)} – ${number(h4.channelHigh, priceDigits)}`
                      : `M15 RSI ${number(m15.rsi, 1)}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    spread {number(costs.spreadPips, 1)}p / stop {number(costs.stopPips, 1)}p
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: 360 }}>
                  <Typography variant="caption" display="block">{signal.message}</Typography>
                  <Typography variant="caption" color="text.secondary">{signal.reasonCode}</Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {filtered.every((signal) => signal.signalClass !== 'ACTIONABLE') && (
        <Alert severity="info" sx={{ m: 2 }}>
          No new order is warranted by the latest completed market data.
        </Alert>
      )}
    </TableContainer>
  );
};

export default TradingSignals;
