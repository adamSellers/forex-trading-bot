import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Cached,
  DataUsage,
  FilterAlt,
  Insights,
  QueryStats,
  Radar,
  Refresh,
  ShowChart,
  Storage,
  Timeline,
  TrendingUp,
} from '@mui/icons-material';
import { analyticsAPI, runtimeAPI, strategiesAPI } from '../config/api';
import EquityChart from './analytics/EquityChart';
import PairPerformance from './analytics/PairPerformance';
import {
  ExitAnalysisWidget,
  KPICard,
  SessionPerformanceWidget,
  SidePerformanceWidget,
  SignalQualityWidget,
  TrendAnalysisWidget,
} from './analytics/StrategyWidgets';

const MODE_OPTIONS = [
  { value: 'live', label: 'Live' },
  { value: 'paper_shadow', label: 'Shadow Paper' },
  { value: 'paper_candidate', label: 'Candidate Paper' },
  { value: 'all', label: 'All Modes' },
];

const PERIOD_OPTIONS = ['24h', '7d', '30d', '90d'];
const DEFAULT_PERIOD = '30d';
const DEFAULT_MODE = 'live';

const formatNumber = (value) =>
  new Intl.NumberFormat('en-AU').format(Number.isFinite(Number(value)) ? Number(value) : 0);

const formatMoney = (value) => {
  const parsed = Number(value || 0);
  return `${parsed < 0 ? '-' : ''}A$${Math.abs(parsed).toFixed(2)}`;
};

const formatSignedMoney = (value) => {
  const parsed = Number(value || 0);
  return `${parsed >= 0 ? '+' : '-'}A$${Math.abs(parsed).toFixed(2)}`;
};

const formatHoldingTime = (ms) => {
  if (!ms) return 'N/A';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
};

const formatModeLabel = (mode) =>
  MODE_OPTIONS.find((option) => option.value === mode)?.label || 'All Modes';

const formatRunLabel = (run, catalog = []) => {
  if (!run) return 'All Runs';
  const strategyLabel =
    catalog.find((strategy) => strategy.key === run.strategy)?.label || run.strategy;
  const modeLabel = formatModeLabel(run.mode);
  const shortRunId = String(run.runId || '').slice(0, 12);
  const status = run.status ? ` | ${String(run.status).toUpperCase()}` : '';
  return `${strategyLabel} | ${modeLabel} | ${shortRunId}${status}`;
};

const formatGeneratedAt = (value) => {
  if (!value) return 'Not loaded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not loaded';
  return date.toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const AnalyticsDashboard = () => {
  const theme = useTheme();
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [strategy, setStrategy] = useState('');
  const [runId, setRunId] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [availableRuns, setAvailableRuns] = useState([]);
  const [strategyCatalog, setStrategyCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    strategiesAPI
      .getCatalog()
      .then((catalog) => {
        if (!cancelled) {
          setStrategyCatalog(Array.isArray(catalog) ? catalog : []);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRuns = async () => {
      setContextLoading(true);
      try {
        const runsResponse = await runtimeAPI.getRuns({
          mode: mode === 'all' ? undefined : mode,
          strategy: strategy || undefined,
          includeSummary: false,
          limit: 150,
        });

        if (cancelled) return;
        const runs = Array.isArray(runsResponse?.runs) ? runsResponse.runs : [];
        setAvailableRuns(runs);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    };

    loadRuns();

    return () => {
      cancelled = true;
    };
  }, [mode, strategy]);

  useEffect(() => {
    if (runId && !availableRuns.some((run) => run.runId === runId)) {
      setRunId('');
    }
  }, [availableRuns, runId]);

  useEffect(() => {
    let cancelled = false;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    const loadAnalytics = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await analyticsAPI.get({
          period,
          mode,
          strategy: strategy || undefined,
          runId: runId || undefined,
          profile: 'dashboard',
        });

        if (!cancelled && requestSeqRef.current === requestSeq) {
          setAnalytics(data);
        }
      } catch (err) {
        if (!cancelled && requestSeqRef.current === requestSeq) {
          setError(err.message);
        }
      } finally {
        if (!cancelled && requestSeqRef.current === requestSeq) {
          setLoading(false);
        }
      }
    };

    loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [period, mode, strategy, runId, refreshNonce]);

  const selectedRun = useMemo(
    () => availableRuns.find((run) => run.runId === runId) || null,
    [availableRuns, runId]
  );

  const selectedStrategyLabel = useMemo(() => {
    if (!strategy) return 'All Strategies';
    return strategyCatalog.find((option) => option.key === strategy)?.label || strategy;
  }, [strategy, strategyCatalog]);

  const selectedScopeLabel = useMemo(() => {
    if (selectedRun) return formatRunLabel(selectedRun, strategyCatalog);
    return `${formatModeLabel(mode)} | ${selectedStrategyLabel}`;
  }, [mode, selectedRun, selectedStrategyLabel, strategyCatalog]);

  const handleModeChange = useCallback((event) => {
    setMode(event.target.value);
    setRunId('');
  }, []);

  const handleStrategyChange = useCallback((event) => {
    setStrategy(event.target.value);
    setRunId('');
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const firstLoad = (loading || contextLoading) && !analytics;

  if (firstLoad) {
    return (
      <Box minHeight="80vh" display="flex" alignItems="center" justifyContent="center">
        <Stack alignItems="center" spacing={2}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Loading analytics
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (error && !analytics) {
    return (
      <Box p={3}>
        <Alert severity="error">Error loading analytics: {error}</Alert>
      </Box>
    );
  }

  if (!analytics) {
    return (
      <Box p={3}>
        <Alert severity="info">No analytics data available</Alert>
      </Box>
    );
  }

  const {
    summary = {},
    signalAnalysis = {},
    equityData = {},
    adxAnalysis,
    exitAnalysis,
    pairPerformance = [],
    sessionPerformance = [],
    sidePerformance,
    filters = {},
    rawCounts = {},
  } = analytics;

  const netPnL = Number(summary.totalPnLAud || 0);
  const loadingFreshData = loading || contextLoading;

  return (
    <Box px={{ xs: 2, md: 3 }} pb={4} pt={2}>
      {loadingFreshData && (
        <LinearProgress
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            mb: 2,
            borderRadius: 1,
          }}
        />
      )}

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Showing last analytics snapshot. Refresh failed: {error}
        </Alert>
      )}

      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2} gap={2} flexWrap="wrap">
        <Box display="flex" alignItems="center" gap={1.25}>
          <Insights color="primary" fontSize="large" />
          <Box>
            <Typography variant="h5" fontWeight="900">
              Runtime Analytics
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {selectedScopeLabel}
            </Typography>
          </Box>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            icon={<Storage sx={{ fontSize: 16 }} />}
            label={`${formatNumber(rawCounts.totalSignals)} signals`}
            variant="outlined"
          />
          <Chip
            icon={<QueryStats sx={{ fontSize: 16 }} />}
            label={`${formatNumber(rawCounts.closedTrades)} closed trades`}
            variant="outlined"
          />
          <Chip
            icon={<Cached sx={{ fontSize: 16 }} />}
            label={analytics.cached ? `Cache ${Math.round((analytics.cacheAgeMs || 0) / 1000)}s` : 'Fresh'}
            color={analytics.cached ? 'default' : 'primary'}
            variant="outlined"
          />
          <Tooltip title="Refresh analytics">
            <span>
              <IconButton onClick={handleRefresh} disabled={loadingFreshData} size="small">
                <Refresh fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      <Box
        display="flex"
        flexDirection={{ xs: 'column', lg: 'row' }}
        gap={1.5}
        alignItems={{ xs: 'stretch', lg: 'center' }}
        mb={2}
        p={1.5}
        sx={{
          border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
          bgcolor: alpha(theme.palette.background.paper, 0.25),
          borderRadius: 2,
        }}
      >
        <ToggleButtonGroup
          value={period}
          exclusive
          onChange={(_, value) => value && setPeriod(value)}
          size="small"
          sx={{ flexShrink: 0 }}
        >
          {PERIOD_OPTIONS.map((option) => (
            <ToggleButton key={option} value={option} sx={{ px: 2.5, fontWeight: 'bold' }}>
              {option.toUpperCase()}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}>
          <Select value={mode} onChange={handleModeChange}>
            {MODE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
          <Select value={strategy} onChange={handleStrategyChange}>
            <MenuItem value="">All Strategies</MenuItem>
            {strategyCatalog.map((option) => (
              <MenuItem key={option.key} value={option.key}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 360 }, flex: 1 }}>
          <Select
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            disabled={contextLoading}
          >
            <MenuItem value="">All Runs</MenuItem>
            {availableRuns.map((run) => (
              <MenuItem key={run.runId} value={run.runId}>
                {formatRunLabel(run, strategyCatalog)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={handleRefresh}
          disabled={loadingFreshData}
          sx={{ flexShrink: 0 }}
        >
          Refresh
        </Button>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
        <Chip
          icon={<FilterAlt sx={{ fontSize: 16 }} />}
          label={`Mode ${formatModeLabel(filters.mode || mode)}`}
          variant="outlined"
        />
        <Chip
          icon={<Timeline sx={{ fontSize: 16 }} />}
          label={`Run ${selectedRun ? String(selectedRun.runId).slice(0, 12) : 'All'}`}
          variant="outlined"
        />
        <Chip
          icon={<Radar sx={{ fontSize: 16 }} />}
          label={`Generated ${formatGeneratedAt(analytics.generatedAt)}`}
          variant="outlined"
        />
      </Stack>

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(5, 1fr)' }} gap={2} mb={2}>
        <KPICard
          title="Net Profit"
          value={formatMoney(netPnL)}
          subtitle={`${summary.totalTrades || 0} trades | ${summary.totalPnLPips?.toFixed?.(0) || 0} pips`}
          color={netPnL >= 0 ? 'success.main' : 'error.main'}
          icon={<ShowChart fontSize="small" />}
        />
        <KPICard
          title="Win Rate"
          value={`${summary.winRate?.toFixed?.(1) || 0}%`}
          subtitle={`${summary.winningTrades || 0}W / ${summary.losingTrades || 0}L`}
          color={summary.winRate > 50 ? 'success.main' : 'warning.main'}
          icon={<DataUsage fontSize="small" />}
        />
        <KPICard
          title="Profit Factor"
          value={summary.profitFactor?.toFixed?.(2) || '0.00'}
          subtitle={`Avg win ${formatSignedMoney(summary.avgWinAud || 0)}`}
          color={summary.profitFactor > 1 ? 'success.main' : 'error.main'}
          icon={<TrendingUp fontSize="small" />}
        />
        <KPICard
          title="Sharpe Ratio"
          value={summary.sharpeRatio?.toFixed?.(2) || '0.00'}
          subtitle={selectedRun ? 'Selected run' : 'Aggregate scope'}
          color={summary.sharpeRatio > 1 ? 'success.main' : 'warning.main'}
          icon={<Insights fontSize="small" />}
        />
        <KPICard
          title="Avg Hold Time"
          value={formatHoldingTime(summary.avgHoldingTimeMs)}
          subtitle={`Largest win ${formatSignedMoney(summary.largestWinAud || 0)}`}
          color="info.main"
          icon={<FilterAlt fontSize="small" />}
        />
      </Box>

      <Box display="flex" flexDirection={{ xs: 'column', lg: 'row' }} gap={2} mb={2}>
        <Box flex={1} minWidth={0}>
          <EquityChart
            equityCurve={equityData?.equityCurve || []}
            dailyPnL={equityData?.dailyPnL || []}
          />
        </Box>
        <Box flex={{ xs: 1, lg: '0 0 35%' }} minWidth={{ lg: 350 }}>
          <SignalQualityWidget
            filterBreakdown={signalAnalysis?.filterBreakdown || []}
            totalSignals={signalAnalysis?.rawTotal || signalAnalysis?.total || 0}
            uniqueDecisions={signalAnalysis?.decisionTotal || 0}
            avgStrength={signalAnalysis?.avgStrength || 0}
          />
        </Box>
      </Box>

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, 1fr)' }} gap={2} mb={2}>
        <TrendAnalysisWidget totalTrades={summary.totalTrades || 0} adxAnalysis={adxAnalysis} />
        <SessionPerformanceWidget sessions={sessionPerformance || []} />
        <ExitAnalysisWidget exitAnalysis={exitAnalysis} />
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box mb={2}>
        <SidePerformanceWidget sidePerformance={sidePerformance} />
      </Box>

      <Box width="100%">
        <PairPerformance pairStats={pairPerformance || []} />
      </Box>
    </Box>
  );
};

export default AnalyticsDashboard;
