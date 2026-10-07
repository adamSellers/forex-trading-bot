import React, { useMemo } from 'react';
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
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

const formatInstrument = (value = '') => value.replace('_', '/');
const number = (value, digits = 2) => {
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
  const filtered = useMemo(() => {
    const assets = new Set(systemStatus?.config?.assets || []);
    return (Array.isArray(signals) ? signals : [])
      .filter((signal) => !assets.size || assets.has(signal.symbol))
      .sort((left, right) => Number(right.strength || 0) - Number(left.strength || 0));
  }, [signals, systemStatus]);

  if (!filtered.length) {
    const candles = Number(systemStatus?.services?.dataService?.candleCount || 0);
    const target = Math.max(1, Number(systemStatus?.config?.assets?.length || 1) * 700);
    return (
      <Box height="100%" display="grid" sx={{ placeItems: 'center' }} p={3}>
        <Stack alignItems="center" spacing={1.5} maxWidth={420}>
          <Radar sx={{ fontSize: 48, opacity: 0.25 }} />
          <Typography variant="body2" fontWeight={800}>WAITING FOR LIVE MARKET SNAPSHOT</Typography>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            M15 Intraday Momentum is loading complete M15 and H1 candles plus the current OANDA spread.
          </Typography>
          {candles < target && (
            <Box width="100%" mt={1}>
              <LinearProgress variant="determinate" value={Math.min(100, (candles / target) * 100)} />
              <Typography variant="caption" color="text.secondary">{candles} candles cached</Typography>
            </Box>
          )}
        </Stack>
      </Box>
    );
  }

  if (compact) {
    return (
      <Stack sx={{ height: '100%', overflowY: 'auto' }} divider={<Box borderBottom={1} borderColor="divider" />}>
        {filtered.map((signal) => {
          const context = signal.strategyContext || signal.decisionContext?.strategyContext || {};
          return (
            <Box key={`${signal.symbol}-${signal.signalCandleTime}-${signal.reasonCode}`} p={1.5}>
              <Stack direction="row" justifyContent="space-between" gap={2}>
                <Box minWidth={0}>
                  <Typography fontWeight={800}>{formatInstrument(signal.symbol)}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{signal.message}</Typography>
                </Box>
                <Stack alignItems="flex-end" spacing={0.5}>
                  <Chip size="small" label={signal.signal} color={signalColor(signal.signal)} />
                  <Typography variant="caption">H1 ADX {number(context.h1?.adx, 1)}</Typography>
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
            <TableCell>H1 regime</TableCell>
            <TableCell align="right">H1 ADX</TableCell>
            <TableCell align="right">M15 / cost</TableCell>
            <TableCell>Decision</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filtered.map((signal) => {
            const context = signal.strategyContext || signal.decisionContext?.strategyContext || {};
            const h1 = context.h1 || {};
            const m15 = context.m15 || {};
            const costs = context.costs || {};
            const trend = h1.longRegime ? 'LONG' : h1.shortRegime ? 'SHORT' : 'FLAT';
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
                <TableCell>{trend}</TableCell>
                <TableCell align="right">{number(h1.adx, 1)}</TableCell>
                <TableCell align="right">
                  <Typography variant="body2" fontFamily="monospace">
                    RSI {number(m15.rsi, 1)}
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
