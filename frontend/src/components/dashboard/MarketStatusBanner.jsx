// Market and session clocks come from the same backend policy used for entries.
import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, Collapse, IconButton, Stack, Typography, alpha, useTheme } from '@mui/material';
import { ExpandLess, ExpandMore, NightsStay, TrendingUp, WarningAmber } from '@mui/icons-material';
import { apiCall, API_ENDPOINTS } from '../../config/api';

const ENTRY_LABELS = {
  WATCHING: 'Watching for a completed M15 setup',
  PAUSED: 'New entries are paused',
  COOLDOWN: 'Consecutive-loss cooldown',
  MARKET_CLOSED: 'Waiting for the market to reopen',
  BLOCKED: 'Operational attention required',
  UNKNOWN: 'Live entry state could not be verified',
};

const MarketStatusBanner = ({ compact = false }) => {
  const theme = useTheme();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    let pending = false;
    let controller = null;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const result = await apiCall(API_ENDPOINTS.systemHealth, { signal: controller.signal });
        const snapshot = result.operationalHealth;
        if (!snapshot?.market || !Number.isFinite(snapshot.checkedAt) ||
            Date.now() - snapshot.checkedAt > 180000) {
          throw new Error('Operational status is unavailable or stale');
        }
        const brokerUnavailable = result.services?.oanda?.connected !== true;
        const verified = brokerUnavailable ? { ...snapshot, status: 'degraded',
          issues: [{ key: 'BROKER_UNAVAILABLE', code: 'BROKER_UNAVAILABLE', severity: 'critical',
            message: 'The latest broker connection check failed' }, ...(snapshot.issues || [])] } : snapshot;
        if (active) { setHealth(verified); setError(false); }
      } catch (_error) {
        if (active) setError(true);
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      clearInterval(timer);
      controller?.abort();
    };
  }, []);

  const unavailable = error || !health;
  const marketOpen = !unavailable && health.market.open === true;
  const degraded = !unavailable && health.status === 'degraded';
  const tone = unavailable || degraded ? 'warning' : marketOpen ? 'success' : 'info';
  const title = unavailable ? (error ? 'Market and bot status unavailable' : 'Checking market and bot status…')
    : degraded ? 'Bot needs attention'
    : marketOpen ? 'Markets open'
    : health.market.reason === 'DAILY_BREAK' ? 'Daily market break' : 'Markets closed for the weekend';
  const Icon = unavailable || degraded ? WarningAmber : marketOpen ? TrendingUp : NightsStay;
  const sessions = health?.market?.sessions || [];
  const issues = health?.issues || [];

  if (compact) {
    return <Chip icon={<Icon />} label={title} size="small" color={tone} variant="outlined" />;
  }

  return (
    <Box sx={{ mb: 2, border: 1, borderRadius: 2,
      borderColor: alpha(theme.palette[tone].main, 0.3),
      bgcolor: alpha(theme.palette[tone].main, 0.07) }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ p: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Icon color={tone} />
          <Box>
            <Typography variant="subtitle2" fontWeight="bold" color={tone + '.main'}>{title}</Typography>
            <Typography variant="caption" color="text.secondary">
              {unavailable ? 'Reconnect to verify live market data and position management.'
                : ENTRY_LABELS[health.entryState] || 'Review the live entry state'}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          {!unavailable && sessions.filter((session) => session.active).map((session) => (
            <Chip key={session.key} label={session.label} size="small" variant="outlined" />
          ))}
          <IconButton size="small" aria-label={expanded ? 'Hide operational details' : 'Show operational details'}
            aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </Stack>
      </Stack>
      {!unavailable && issues.length > 0 && (
        <Alert severity={issues.some((issue) => issue.severity === 'critical') ? 'error' : 'warning'}
          sx={{ mx: 1.5, mb: 1.5 }}>
          {issues[0].message}
          {issues.length > 1 ? ' (' + (issues.length - 1) + ' more in details)' : ''}
        </Alert>
      )}
      <Collapse in={expanded}>
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          {!unavailable && <>
            <Typography variant="caption" color="text.secondary">
              OANDA New York hours: Sunday 17:05 to Friday 16:59; daily break 16:59–17:05.
              Session clocks follow local daylight saving.
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', my: 1.5 }}>
              {sessions.map((session) => (
                <Box key={session.key} sx={{ minWidth: 130 }}>
                  <Typography variant="body2" fontWeight="bold">{session.label}</Typography>
                  <Typography variant="caption" display="block" color="text.secondary">
                    {session.localTime + ' local · ' + String(session.startHour).padStart(2, '0') +
                      ':00–' + String(session.endHour).padStart(2, '0') + ':00'}
                  </Typography>
                </Box>
              ))}
            </Stack>
            {health.cooldownActive && health.cooldownUntil && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                Cooldown ends {new Date(health.cooldownUntil).toLocaleString()}.
              </Typography>
            )}
            {issues.map((issue) => (
              <Typography key={issue.key} variant="body2" sx={{ mb: 0.5 }}>{issue.message}</Typography>
            ))}
            {(health.unavailablePrices || []).filter((price) => price.reason === 'PRICE_NOT_TRADEABLE').map((price) => (
              <Typography key={price.instrument} variant="body2" sx={{ mb: 0.5 }}>
                {price.instrument + ': broker pricing received; currently not tradeable.'}
              </Typography>
            ))}
            {(health.priceAvailability || []).map((price) => (
              <Typography key={price.instrument} variant="caption" display="block" color="text.secondary">
                {price.instrument + ' · Validated receipt ' + (Number.isFinite(price.receiptAgeMs)
                  ? Math.round(price.receiptAgeMs / 1000) + ' seconds ago' : 'unavailable') +
                  ' · Price event ' + (Number.isFinite(price.eventAgeMs)
                    ? Math.round(price.eventAgeMs / 1000) + ' seconds ago' : 'unavailable')}
              </Typography>
            ))}
            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
              {'Updated ' + new Date(health.checkedAt).toLocaleTimeString() +
                ' · Broker reconciliation ' + (health.brokerSyncAgeMs === null ? 'unverified'
                  : Math.round(health.brokerSyncAgeMs / 1000) + ' seconds ago')}
            </Typography>
          </>}
          {unavailable && <Typography variant="body2">The backend has not provided a current operational status.</Typography>}
        </Box>
      </Collapse>
    </Box>
  );
};

export default MarketStatusBanner;
