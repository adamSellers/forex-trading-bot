// frontend/src/components/TradingDashboard.jsx - Main Trading Dashboard with Engine Integration
import React, { useState, useMemo, useEffect } from 'react';
import {
  Container,
  Typography,
  Button,
  Chip,
  Box,
  Stack,
  LinearProgress,
  useTheme,
  alpha,
  Alert,
  Tabs,
  Tab,
  Badge,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  PieChart,
  Radar,
  ReceiptLong,
  Timeline,
  Sync,
  FiberManualRecord,
} from '@mui/icons-material';
import { useLiveOperator } from '../operator/useLiveOperator';

// --- IMPORTED WIDGETS ---
import { GlassCard, FOREX_INSTRUMENTS } from './dashboard/Shared';
import { DashboardStats } from './dashboard/StatCards';
import CurrentHoldings from './dashboard/CurrentHoldings';
import LivePrices from './dashboard/LivePrices';
import TradingSignals from './dashboard/TradingSignals';
import RecentTrades from './dashboard/RecentTrades';
import LivePriceChart from './dashboard/LivePriceChart';
import MarketStatusBanner from './dashboard/MarketStatusBanner';
import { CURRENT_STRATEGY_KEY, strategyLabel } from '../utils/strategyDisplay';

const SIDEBAR_WIDTH = 340;
const DEFAULT_STRATEGY_KEY = CURRENT_STRATEGY_KEY;
const FALLBACK_STRATEGY_OPTIONS = [
  {
    key: CURRENT_STRATEGY_KEY,
    label: 'H4 Trend',
    version: 'unknown',
    runtimeStatus: 'unavailable',
  },
];

const getStrategyOptions = (catalog = []) => {
  return catalog.length > 0 ? catalog : FALLBACK_STRATEGY_OPTIONS;
};

const normalizeStrategySelection = (strategyKey, catalog = []) => {
  const options = getStrategyOptions(catalog);
  if (options.some((option) => option.key === strategyKey)) {
    return strategyKey;
  }

  return DEFAULT_STRATEGY_KEY;
};

const getStrategyLabel = (strategyKey, catalog = []) => {
  const strategy = getStrategyOptions(catalog).find((option) => option.key === strategyKey);
  return strategyLabel(strategyKey, strategy?.label);
};

const shortenRuntimeId = (value) => (value ? String(value).slice(0, 12) : 'unassigned');

const getReadinessReasons = (readiness) => (
  Array.isArray(readiness?.reasons) ? readiness.reasons : []
);

const formatReadinessValue = (key, value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'unavailable';
  const numericValue = Number(value);
  if (key === 'maxCapitalAtRisk') return `A$${numericValue.toFixed(2)}`;
  if (key === 'maxOpenPositions' || key === 'maxConsecutiveLosses') return String(numericValue);
  if (String(key || '').toLowerCase().includes('pct') || key === 'riskPerTrade' || key === 'maxPortfolioExposure') {
    return `${(numericValue * 100).toFixed(2)}%`;
  }
  return String(numericValue);
};

const formatCooldownRemaining = (remainingMs) => {
  const totalMinutes = Math.max(0, Math.ceil(Number(remainingMs || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const getReadinessReasonDetail = (reason) => {
  if (reason?.cooldownUntil) {
    return `Cooldown ends at ${new Date(reason.cooldownUntil).toLocaleString()} (${formatCooldownRemaining(reason.remainingMs)} remaining).`;
  }
  if (reason?.key) {
    return `Current ${formatReadinessValue(reason.key, reason.actual)}; live maximum ${formatReadinessValue(reason.key, reason.max)}.`;
  }
  if (reason?.actualConfigHash || reason?.requiredConfigHash) {
    return `Current ${reason.actualConfigHash || 'unavailable'}; required ${reason.requiredConfigHash || 'unavailable'}.`;
  }
  return null;
};

const TradingDashboard = ({ operator } = {}) => {
  const theme = useTheme();

  const {
    view, loading, dataError, error, notice, action: tradingAction,
    pendingCommands = [], lastUpdate, commandResult,
    refresh, enableEntries, pauseEntries, reconcileBroker, clearFeedback,
  } = useLiveOperator(operator);
  const [readinessDialogOpen, setReadinessDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const overview = view?.overview || {};
  const systemStatus = overview.systemStatus || null;
  const engineStatus = overview.engineStatus || null;
  const portfolio = overview.portfolio || null;
  const account = overview.account || null;
  const trades = Array.isArray(overview.trades) ? overview.trades : [];
  const strategyCatalog = Array.isArray(overview.catalog) ? overview.catalog : [];
  const liveSelection = overview.liveSelection || null;
  const tradingEnabled = view?.intent?.entriesEnabled === true;
  const selectedStrategy = normalizeStrategySelection(
    view?.identity?.strategy || liveSelection?.strategy || systemStatus?.config?.strategy,
    strategyCatalog
  );
  const readinessAvailable = view?.observations?.readiness?.status === 'available';
  const liveReadiness = readinessAvailable ? overview.readiness : null;
  const entryRisk = view?.entries?.entryRisk || null;
  const enabling = pendingCommands.includes('enable') || tradingAction === 'enable';
  const pausing = pendingCommands.includes('pause') || tradingAction === 'pause';
  // Pause stays available while activation awaits the backend or broker.
  const pauseAvailable = tradingEnabled || enabling;
  const activationFailure = commandResult?.command === 'enableEntries' &&
    commandResult.outcome !== 'accepted' ? commandResult : null;
  const prices = useMemo(() => Object.fromEntries(
    (Array.isArray(overview.prices) ? overview.prices : []).filter(price => price?.instrument)
      .map(price => [price.instrument, { ...price, price: price.mid ?? price.price, symbol: price.instrument }])
  ), [overview.prices]);
  const hasSignalData = Array.isArray(overview.signals);
  const latestSignals = useMemo(() => {
    const current = new Map();
    const runId = view?.identity?.liveRunId;
    for (const signal of Array.isArray(overview.signals) ? overview.signals : []) {
      if (!signal?.symbol || (runId && signal.runId && signal.runId !== runId)) continue;
      const prior = current.get(signal.symbol);
      if (!prior || Number(new Date(signal.timestamp)) >= Number(new Date(prior.timestamp))) {
        current.set(signal.symbol, signal);
      }
    }
    return current;
  }, [overview.signals, view?.identity?.liveRunId]);

  useEffect(() => {
    if (commandResult?.command === 'enableEntries' &&
        ['rejected', 'failed'].includes(commandResult.outcome)) setReadinessDialogOpen(true);
  }, [commandResult]);

  const handleToggleTrading = () => pauseAvailable ? pauseEntries() : enableEntries();
  const handleSyncEngine = () => reconcileBroker();

  // --- MEMOIZED HELPERS ---
  const signalsToRender = useMemo(
    () =>
      Array.from(latestSignals.values()).sort((a, b) => b.timestamp - a.timestamp),
    [latestSignals]
  );
  const strategyOptions = useMemo(
    () => getStrategyOptions(strategyCatalog),
    [strategyCatalog]
  );
  const activeChartAssets = useMemo(
    () => systemStatus?.config?.assets || FOREX_INSTRUMENTS,
    [systemStatus]
  );
  const activeStrategyLabel = useMemo(
    () => getStrategyLabel(liveSelection?.strategy || selectedStrategy, strategyOptions),
    [liveSelection?.strategy, selectedStrategy, strategyOptions]
  );
  const activeStrategyDefinition = useMemo(
    () => strategyOptions.find(
      (option) => option.key === (liveSelection?.strategy || selectedStrategy)
    ) || null,
    [liveSelection?.strategy, selectedStrategy, strategyOptions]
  );
  const activeStrategyVersion = systemStatus?.config?.strategyVersion ||
    activeStrategyDefinition?.version || 'unknown';
  const actionableSignalCount = useMemo(() => {
    return signalsToRender.filter(
      (s) =>
        (s.signal === 'BUY' || s.signal === 'SELL') &&
        s.signalClass !== 'EXIT_ONLY' &&
        s.entryType !== 'EXIT_ONLY' &&
        !String(s.intent || '').startsWith('EXIT_')
    ).length;
  }, [signalsToRender]);

  // Engine stats
  const engineOpenPositions = engineStatus?.openPositions || 0;
  const engineIsRunning = view?.protection?.engineAttached === true;
  const readinessReasons = getReadinessReasons(liveReadiness);
  const lossCooldownActive = entryRisk?.cooldownActive === true;
  const liveActivationBlocked = !pauseAvailable && readinessAvailable && view?.activation?.allowed === false;
  const tradingActionPending = pausing;
  const activationFailureReasons = Array.isArray(activationFailure?.baselineResume?.reasons)
    ? activationFailure.baselineResume.reasons
    : [];

  if (loading && !systemStatus)
    return (
      <Box
        minHeight="80vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <LinearProgress sx={{ width: 300 }} />
      </Box>
    );

  return (
    <Container
      maxWidth={false}
      sx={{
        py: 2,
        height: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Control Bar */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
        px={1}
        flexShrink={0}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Tooltip title="The active strategy is defined by the deployed release">
            <Chip
              label={`LIVE STRATEGY: ${activeStrategyLabel} v${activeStrategyVersion}`}
              size="small"
              variant="outlined"
              sx={{ height: 32, fontWeight: 'bold' }}
            />
          </Tooltip>
          <Button
            variant="contained"
            color={pauseAvailable ? 'error' : liveActivationBlocked || !readinessAvailable ? 'warning' : 'success'}
            onClick={handleToggleTrading}
            startIcon={
              tradingActionPending
                ? <CircularProgress size={16} color="inherit" />
                : pauseAvailable
                  ? <Stop />
                  : <PlayArrow />
            }
            disabled={tradingActionPending}
            size="small"
            sx={{ px: 3, fontWeight: 'bold' }}
          >
            {pausing ? 'PAUSING LIVE'
              : pauseAvailable ? 'PAUSE LIVE'
                : liveActivationBlocked ? 'LIVE BLOCKED' : 'ENABLE LIVE'}
          </Button>
          {!readinessAvailable && (
            <Chip label="READINESS UNAVAILABLE" size="small" color="warning" variant="outlined"
              onClick={() => setReadinessDialogOpen(true)} />
          )}
          {liveReadiness && (lossCooldownActive || !tradingEnabled) && (
            <Tooltip title={lossCooldownActive ? 'View consecutive-loss cooldown' : liveReadiness.passed ? 'Live readiness passed' : 'View live activation blockers'}>
              <Chip
                label={lossCooldownActive ? `LOSS COOLDOWN · ${formatCooldownRemaining(entryRisk.remainingMs)}` : liveReadiness.passed ? 'READY' : `${readinessReasons.length} BLOCKER${readinessReasons.length === 1 ? '' : 'S'}`}
                size="small"
                color={lossCooldownActive ? 'warning' : liveReadiness.passed ? 'success' : 'warning'}
                variant="outlined"
                onClick={() => setReadinessDialogOpen(true)}
                sx={{ height: 26, fontSize: '0.65rem', fontWeight: 'bold' }}
              />
            </Tooltip>
          )}
          <Tooltip title="Sync engine with Oanda">
            <Button
              variant="outlined"
              size="small"
              onClick={handleSyncEngine}
              aria-label="Reconcile broker"
              disabled={pendingCommands.includes('reconcile')}
              sx={{ minWidth: 40, p: 0.5 }}
            >
              <Sync fontSize="small" />
            </Button>
          </Tooltip>
        </Stack>

        {/* Engine Status Indicator */}
        <Stack direction="row" spacing={2} alignItems="center">
          <Chip
            label={`Live: ${activeStrategyLabel}`}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ height: 22, fontSize: '0.72rem' }}
          />
          <Chip
            label="LIVE ONLY"
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 22, fontSize: '0.72rem' }}
          />
          <Box display="flex" alignItems="center" gap={1}>
            <FiberManualRecord
              sx={{
                fontSize: 12,
                color: engineIsRunning ? 'success.main' : 'text.disabled',
                animation: engineIsRunning ? 'pulse 2s infinite' : 'none',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.5 },
                },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Engine: {engineIsRunning ? 'Running' : 'Stopped'}
            </Typography>
          </Box>
          {engineOpenPositions > 0 && (
            <Chip
              label={`${engineOpenPositions} Open`}
              size="small"
              color="warning"
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
          )}
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color: 'text.secondary',
              display: { xs: 'none', md: 'block' },
            }}
          >
            Selection: {shortenRuntimeId(liveSelection?.selectionId)}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color: 'text.secondary',
              display: { xs: 'none', md: 'block' },
            }}
          >
            Last operator view: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--:--'}
          </Typography>
        </Stack>
      </Box>

      {lossCooldownActive && (
        <Alert severity="warning" sx={{ mb: 2, flexShrink: 0 }}>
          Three consecutive losses triggered the 24-hour safety cooldown, ending at{' '}
          <strong>{new Date(entryRisk.cooldownUntil).toLocaleString()}</strong>.{' '}
          {tradingEnabled
            ? 'Live trading is enabled; entries can resume then, subject to the normal entry checks.'
            : 'Live trading is paused and will remain paused until you choose Enable Live.'}
        </Alert>
      )}

      {dataError && <Alert severity="warning" sx={{ mb: 2, flexShrink: 0 }}>{dataError}</Alert>}
      {error && (
        <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }} onClose={clearFeedback}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2, flexShrink: 0 }} onClose={clearFeedback}>
          {notice}
        </Alert>
      )}

      <Dialog
        open={readinessDialogOpen}
        onClose={() => setReadinessDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {!readinessAvailable ? 'Live readiness is unavailable' : liveReadiness?.passed ? 'Live strategy is ready'
            : liveReadiness?.activationAllowed ? 'New entries are cooling down'
              : 'Live activation is blocked'}
        </DialogTitle>
        <DialogContent dividers>
          {activationFailure && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              <Typography variant="body2" fontWeight="bold">
                {activationFailure.error || 'Live activation failed'}
              </Typography>
              {activationFailure.code && (
                <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                  {activationFailure.code}
                </Typography>
              )}
              {Array.isArray(activationFailure.openPositions) && (
                <Typography variant="caption" display="block">
                  {activationFailure.openPositions.length} open position{activationFailure.openPositions.length === 1 ? '' : 's'} must be resolved before resuming.
                </Typography>
              )}
              {!Array.isArray(activationFailure.openPositions) &&
                Number.isFinite(Number(activationFailure.openPositions)) && (
                <Typography variant="caption" display="block">
                  {Number(activationFailure.openPositions)} open position{Number(activationFailure.openPositions) === 1 ? '' : 's'} must be resolved before resuming.
                </Typography>
              )}
              {activationFailureReasons.map((reason, index) => (
                <Typography key={`${reason.code || 'baseline'}-${index}`} variant="caption" display="block">
                  {reason.message || reason.code || String(reason)}
                </Typography>
              ))}
            </Alert>
          )}
          {!readinessAvailable ? (
            <Alert severity="warning">Current activation readiness is unavailable. Refresh the operator view to check again.</Alert>
          ) : liveReadiness?.passed ? (
            <Alert severity="success">
              Every live readiness check currently passes. Close this dialog and choose Enable Live to activate entries.
            </Alert>
          ) : (
            <Stack spacing={1.25}>
              <Alert severity="warning">
                {lossCooldownActive && liveReadiness?.activationAllowed
                  ? tradingEnabled
                    ? `Live trading is enabled. New entries can resume after the cooldown ends in ${formatCooldownRemaining(entryRisk.remainingMs)}, subject to the normal entry checks.`
                    : `Live trading is paused. Choose Enable Live to allow entries after the cooldown ends in ${formatCooldownRemaining(entryRisk.remainingMs)}; enabling does not shorten the cooldown.`
                  : 'Live entries remain paused. Resolve every item below; this safety gate cannot be bypassed from the dashboard.'}
              </Alert>
              <Alert severity="info">
                This installation runs one deployed strategy directly against the live OANDA account.
              </Alert>
              {readinessReasons.length > 0 ? readinessReasons.map((reason, index) => {
                const detail = getReadinessReasonDetail(reason);
                return (
                  <Box
                    key={`${reason.code || 'readiness'}-${reason.key || index}`}
                    sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                      <Chip
                        label={reason.code || 'READINESS_CHECK'}
                        size="small"
                        color="warning"
                        variant="outlined"
                        sx={{ fontFamily: 'monospace', fontSize: '0.62rem' }}
                      />
                      {reason.key && (
                        <Typography variant="caption" fontWeight="bold">
                          {reason.key}
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="body2">{reason.message || 'Readiness check failed'}</Typography>
                    {detail && (
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        {detail}
                      </Typography>
                    )}
                  </Box>
                );
              }) : (
                <Typography variant="body2" color="text.secondary">
                  The backend did not return individual readiness reasons. Refresh and try again.
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={refresh}>Refresh operator view</Button>
          <Button onClick={() => setReadinessDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Market Status Banner - Shows open/closed status with countdown */}
      <Box sx={{ flexShrink: 0 }}>
        <MarketStatusBanner
          strategy={systemStatus?.config?.strategy || liveSelection?.strategy || selectedStrategy}
          health={overview.operationalHealth}
          entryState={view?.entries?.state}
          error={view?.observations?.operationalHealth?.status === 'unavailable'}
          brokerUnavailable={view?.observations?.account?.status === 'unavailable'}
        />
      </Box>

      {/* KPI Stats */}
      <DashboardStats
        portfolio={portfolio}
        activeSignalsCount={hasSignalData ? actionableSignalCount : null}
        engineStatus={engineStatus}
      />

      {/* Data Terminal (Tabs) */}
      <GlassCard sx={{ flexGrow: 0, height: 520, flexShrink: 0, mb: 2 }}>
        <Box
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: alpha(theme.palette.background.paper, 0.02),
          }}
        >
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            textColor="primary"
            indicatorColor="primary"
            sx={{ minHeight: 40 }}
          >
            <Tab
              icon={<PieChart fontSize="small" />}
              iconPosition="start"
              label="HOLDINGS"
              sx={{ minHeight: 40, fontWeight: 'bold' }}
            />
            <Tab
              icon={<Radar fontSize="small" />}
              iconPosition="start"
              label={
                <Badge
                  badgeContent={actionableSignalCount}
                  color="warning"
                  variant="dot"
                  sx={{
                    '& .MuiBadge-badge': {
                      right: -3,
                      top: 3,
                      animation:
                        actionableSignalCount > 0 ? 'pulse 1.5s infinite' : 'none',
                      '@keyframes pulse': {
                        '0%': { transform: 'scale(1)', opacity: 1 },
                        '50%': { transform: 'scale(1.5)', opacity: 0.7 },
                        '100%': { transform: 'scale(1)', opacity: 1 },
                      },
                    },
                  }}
                >
                  SIGNALS
                </Badge>
              }
              sx={{ minHeight: 40, fontWeight: 'bold', pl: 1 }}
            />
            <Tab
              icon={<ReceiptLong fontSize="small" />}
              iconPosition="start"
              label="HISTORY"
              sx={{ minHeight: 40, fontWeight: 'bold' }}
            />
          </Tabs>
        </Box>
        <Box sx={{ flexGrow: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 0 && (
            <Box height="100%" sx={{ overflowY: 'auto' }}>
              <CurrentHoldings
                account={account}
                prices={prices}
                portfolio={portfolio}
                systemStatus={systemStatus}
                engineStatus={engineStatus}
              />
            </Box>
          )}
          {activeTab === 1 && (
            <Box height="100%" sx={{ overflow: 'hidden' }}>
              <TradingSignals
                signals={signalsToRender}
                systemStatus={systemStatus}
                activeStrategy={liveSelection?.strategy || systemStatus?.config?.strategy || null}
              />
            </Box>
          )}
          {activeTab === 2 && (
            <Box height="100%" sx={{ overflowY: 'auto', p: 2 }}>
              <RecentTrades trades={trades} />
            </Box>
          )}
        </Box>
      </GlassCard>

      {/* Charts & Sidebar */}
      <Box sx={{ display: 'flex', gap: 2, flexGrow: 1, minHeight: 0 }}>
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <GlassCard>
            <Box
              p={1.5}
              borderBottom={1}
              borderColor="divider"
              display="flex"
              alignItems="center"
              gap={1}
            >
              <Timeline color="primary" fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                MARKET OVERVIEW
              </Typography>
            </Box>
            <Box flexGrow={1} sx={{ position: 'relative' }}>
              <LivePriceChart prices={prices} assets={activeChartAssets}
                initialTimeframe={systemStatus?.config?.timeframe === '15m' ? 'M15' : 'H4'} height="100%" />
            </Box>
          </GlassCard>
        </Box>
        <Box
          sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <GlassCard>
            <Box
              p={1.5}
              borderBottom={1}
              borderColor="divider"
              display="flex"
              alignItems="center"
              gap={1}
            >
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                LIVE MARKETS
              </Typography>
              <Chip
                label={activeChartAssets.length}
                size="small"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            </Box>
            <Box flexGrow={1} sx={{ overflowY: 'auto', p: 0 }}>
              <LivePrices prices={prices} assets={activeChartAssets} />
            </Box>
          </GlassCard>
        </Box>
      </Box>
    </Container>
  );
};

export default TradingDashboard;
