import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { Refresh, ShowChart, Shield, SwapVert } from '@mui/icons-material';
import { configAPI } from '../config/api';
import { isH4Trend, strategyLabel } from '../utils/strategyDisplay';

const pct = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;

const Value = ({ label, children }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" textTransform="uppercase">
      {label}
    </Typography>
    <Typography variant="h6" fontWeight={800}>{children}</Typography>
  </Box>
);

const TradingConfig = () => {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setConfig(await configAPI.get());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!config && !error) {
    return <Box minHeight="60vh" display="grid" sx={{ placeItems: 'center' }}><CircularProgress /></Box>;
  }

  const h4Trend = isH4Trend(config || {});
  const fridayClose = `${String(config?.weekendCloseLocalHour ?? 16).padStart(2, '0')}:${String(config?.weekendCloseLocalMinute ?? 45).padStart(2, '0')}`;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={900}>LIVE STRATEGY</Typography>
          <Typography color="text.secondary">
            The exact release currently driving the OANDA account.
          </Typography>
        </Box>
        <Button startIcon={<Refresh />} onClick={load}>Refresh</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {config && (
        <Stack spacing={3}>
          <Alert severity="info">
            Strategy and risk parameters are code-owned and immutable at runtime. The dashboard reports the live release; it does not provide strategy-selection or tuning controls.
          </Alert>

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
              <Stack direction="row" spacing={2} alignItems="center">
                <ShowChart color="primary" fontSize="large" />
                <Box>
                  <Typography variant="h5" fontWeight={900}>{strategyLabel(config.strategy)}</Typography>
                  <Typography color="text.secondary">
                    {h4Trend ? 'Completed-H4 rolling channel breakouts with a protective exit channel'
                      : 'Completed-M15 entries aligned with liquid-session H1 trends'}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label="LIVE ONLY" color="error" />
                <Chip label={config.liveReleaseVersion} variant="outlined" />
              </Stack>
            </Stack>
            <Divider sx={{ my: 3 }} />
            <Grid container spacing={3}>
              <Grid item xs={6} md={3}><Value label="Scan timeframe">{config.timeframe}</Value></Grid>
              {h4Trend ? <>
                <Grid item xs={6} md={3}><Value label="Breakout channel">Prior {config.trendBreakoutBars} H4 bars</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Initial stop">{config.trendStopAtr} × H4 ATR({config.trendAtrPeriod})</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Minimum stop">{config.minStopLossPips} pips</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Protective trail">{config.trendExitBars} H4 bars</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Profit target / breakeven">None / off</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Weekend close">Friday {fridayClose} New York</Value></Grid>
              </> : <>
                <Grid item xs={6} md={3}><Value label="H1 trend EMAs">{config.intradayFastEmaPeriod}/{config.intradaySlowEmaPeriod}</Value></Grid>
                <Grid item xs={6} md={3}><Value label="H1 minimum ADX">{config.intradayMinAdx}</Value></Grid>
                <Grid item xs={6} md={3}><Value label="M15 breakout">{config.intradayBreakoutBars} bars</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Initial stop">{config.intradayStopAtr} M15 ATR</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Profit target">{config.intradayTargetRiskMultiple}R</Value></Grid>
                <Grid item xs={6} md={3}><Value label="Time stop">{config.timeStopHours} hours</Value></Grid>
              </>}
              <Grid item xs={6} md={3}><Value label="Direction">{config.enableShorting === false ? 'Long only' : 'Long + short'}</Value></Grid>
            </Grid>
          </Paper>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
                <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
                  <Shield color="primary" />
                  <Typography variant="h6" fontWeight={800}>Live risk envelope</Typography>
                </Stack>
                <Stack spacing={1.5}>
                  <Value label="Risk per trade">{pct(config.riskPerTrade)}</Value>
                  <Value label="Capital ceiling">A${Number(config.maxCapitalAtRisk).toFixed(2)}</Value>
                  <Value label="Open positions">
                    {config.positionPolicy?.scope === 'PER_INSTRUMENT' && config.positionPolicy.maxPerInstrument === 1
                      ? 'One per pair'
                      : config.maxOpenPositions != null ? `${config.maxOpenPositions} across the account` : 'Unavailable'}
                  </Value>
                  {config.positionPolicy?.scope === 'PER_INSTRUMENT' && (
                    <Typography variant="body2" color="text.secondary">
                      No account-wide position-count cap. Each pair can enter independently, subject to the portfolio risk checks.
                    </Typography>
                  )}
                  <Value label="Aggregate stop risk ceiling">{pct(config.maxAggregateStopRiskPctNav)}</Value>
                  <Value label="Daily loss stop">{pct(config.maxDailyLossPctNav)}</Value>
                  <Value label="Drawdown stop">{pct(config.maxDrawdownPctNav)}</Value>
                </Stack>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
                <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
                  <SwapVert color="primary" />
                  <Typography variant="h6" fontWeight={800}>Live instruments</Typography>
                </Stack>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {(config.assets || []).map((instrument) => (
                    <Chip key={instrument} label={instrument.replace('_', '/')} variant="outlined" />
                  ))}
                </Stack>
                <Typography variant="body2" color="text.secondary" mt={3}>
                  {h4Trend
                    ? `Entries require a fresh completed H4 close beyond the prior ${config.trendBreakoutBars}-bar channel. The initial volatility stop uses ${config.trendStopAtr} ATR with the displayed minimum, then can only tighten using the latest ${config.trendExitBars} completed H4 bars. There is no fixed profit target, breakeven move or six-hour exit. Positions close before the weekend on Friday at ${fridayClose} New York time.`
                    : 'Entries require a completed M15 break, a distinct retest and later directional confirmation, a matching H1 EMA/ADX regime, a liquid pair-specific session and acceptable spread cost. BUY breakout episodes allow one fill until the broken level is cancelled and a new pattern forms. Stops sit beyond broker bid/ask structure, with risk-based unit sizing and broker-native take-profit protection.'}
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </Stack>
      )}
    </Container>
  );
};

export default TradingConfig;
