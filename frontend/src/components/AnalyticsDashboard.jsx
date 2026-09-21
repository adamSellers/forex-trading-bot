import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
];

const PERIOD_OPTIONS = ['24h', '7d', '30d', '90d', 'all'];
const DEFAULT_PERIOD = '30d';
const DEFAULT_MODE = 'live';

const withReadDeadline = (request) => {
  let timer;
  return Promise.race([request, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Analytics request timed out')), 20000);
  })]).finally(() => clearTimeout(timer));
};

const formatNumber = (value) =>
  new Intl.NumberFormat('en-AU').format(Number.isFinite(Number(value)) ? Number(value) : 0);

const formatMoney = (value) => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return 'N/A';
  const parsed = Number(value);
  return `${parsed < 0 ? '-' : ''}A$${Math.abs(parsed).toFixed(Math.abs(parsed) < 1 ? 4 : 2)}`;
};

const formatSignedMoney = (value) => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return 'N/A';
  const parsed = Number(value);
  return `${parsed >= 0 ? '+' : '-'}A$${Math.abs(parsed).toFixed(Math.abs(parsed) < 1 ? 4 : 2)}`;
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
  const release = run.metadata?.releaseVersion || run.configSnapshot?.liveReleaseVersion || 'Historical';
  const status = run.status ? ` | ${String(run.status).toUpperCase()}` : '';
  return `${release} | ${strategyLabel} | ${modeLabel} | ${shortRunId}${status}`;
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
  const mode = DEFAULT_MODE;
  const [strategy, setStrategy] = useState('');
  const [scope, setScope] = useState('current');
  const [timeBasis, setTimeBasis] = useState('realized');
  const [runId, setRunId] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [availableRuns, setAvailableRuns] = useState([]);
  const [strategyCatalog, setStrategyCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contextErrors, setContextErrors] = useState({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    withReadDeadline(strategiesAPI.getCatalog({ force: true }))
      .then((catalog) => {
        if (!cancelled) {
          setStrategyCatalog(Array.isArray(catalog) ? catalog : []);
          setContextErrors((previous) => ({ ...previous, catalog: null }));
        }
      })
      .catch((err) => {
        if (!cancelled) setContextErrors((previous) => ({ ...previous, catalog: err.message }));
      });

    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;

    const loadRuns = async () => {
      setContextLoading(true);
      try {
        const runsResponse = await withReadDeadline(runtimeAPI.getRuns({
          mode,
          strategy: scope === 'all-live' ? strategy || undefined : undefined,
          includeSummary: false,
          limit: 150,
        }));

        if (cancelled) return;
        const runs = Array.isArray(runsResponse?.runs) ? runsResponse.runs : [];
        setAvailableRuns(runs);
        setContextErrors((previous) => ({ ...previous, runs: null }));
      } catch (err) {
        if (!cancelled) setContextErrors((previous) => ({ ...previous, runs: err.message }));
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    };

    loadRuns();

    return () => {
      cancelled = true;
    };
  }, [mode, strategy, scope, refreshNonce]);

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
      if (scope === 'run' && !runId) {
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await withReadDeadline(analyticsAPI.get({
          period,
          mode,
          scope,
          timeBasis,
          strategy: strategy || undefined,
          runId: runId || undefined,
          profile: 'dashboard',
        }));

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
  }, [period, mode, scope, timeBasis, strategy, runId, refreshNonce]);

  const selectedScopeLabel = useMemo(() => {
    if (!analytics) return 'Choose a live history scope';
    const snapshotRun = availableRuns.find((run) => run.runId === analytics.filters?.runId);
    const snapshotStrategy = analytics.filters?.strategy;
    const strategyLabel = strategyCatalog.find((option) => option.key === snapshotStrategy)?.label || snapshotStrategy || 'All strategies';
    if (analytics.scope === 'current') return `Current live run snapshot | ${String(analytics.filters?.runId || '').slice(0, 12)}`;
    if (analytics.scope === 'run') return snapshotRun ? formatRunLabel(snapshotRun, strategyCatalog) : `Run ${analytics.filters?.runId || 'unavailable'}`;
    return `All live history | ${strategyLabel}`;
  }, [analytics, availableRuns, strategyCatalog]);

  const handleStrategyChange = useCallback((event) => {
    setStrategy(event.target.value);
    setRunId('');
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

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
  } = analytics || {};

  const netPnL = Number(summary.totalPnLAud || 0);
  const loadingFreshData = loading || contextLoading;
  const hasClosedTrades = Number(summary.totalTrades) > 0;
  const awaitingRun = scope === 'run' && !runId;

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
          {analytics ? 'Showing the previously loaded scope below. ' : ''}Analytics unavailable: {error}
        </Alert>
      )}
      {Object.entries(contextErrors).filter(([, message]) => message).map(([source, message]) => (
        <Alert key={source} severity="warning" sx={{ mb: 2 }}>{source === 'runs' ? 'Run list' : 'Strategy catalog'} refresh failed: {message}. Previously loaded choices may be stale.</Alert>
      ))}

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
            label={`${analytics ? formatNumber(rawCounts.totalSignals) : 'N/A'} signals`}
            variant="outlined"
          />
          <Chip
            icon={<QueryStats sx={{ fontSize: 16 }} />}
            label={`${analytics ? formatNumber(rawCounts.closedTrades) : 'N/A'} closed trades`}
            variant="outlined"
          />
          <Chip
            icon={<Cached sx={{ fontSize: 16 }} />}
            label={!analytics ? 'No snapshot' : loadingFreshData ? 'Refreshing' : error || awaitingRun ? 'Previous snapshot' : analytics.cached ? `Cache ${Math.round((analytics.cacheAgeMs || 0) / 1000)}s` : 'Loaded'}
            color="default"
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

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select value={scope} onChange={(event) => { setScope(event.target.value); setRunId(''); }} inputProps={{ 'aria-label': 'Analytics scope' }}>
            <MenuItem value="current">Current live run</MenuItem>
            <MenuItem value="all-live">All live history</MenuItem>
            <MenuItem value="run">Selected run</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select value={timeBasis} onChange={(event) => setTimeBasis(event.target.value)} inputProps={{ 'aria-label': 'Period time basis' }}>
            <MenuItem value="realized">Closed in period</MenuItem>
            <MenuItem value="entry">Entered in period</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }} disabled={scope !== 'all-live'}>
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
            disabled={contextLoading || scope !== 'run'}
          >
            <MenuItem value="">Select a run</MenuItem>
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

      {awaitingRun && <Alert severity="info" sx={{ mb: 2 }}>Select a run to load its results. {analytics && 'The previous snapshot remains displayed below.'}</Alert>}
      {!analytics && !error && !awaitingRun && <Alert severity="info">No analytics snapshot is loaded.</Alert>}
      {analytics && <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
        <Chip
          icon={<FilterAlt sx={{ fontSize: 16 }} />}
          label={`Mode ${formatModeLabel(filters.mode || mode)}`}
          variant="outlined"
        />
        <Chip
          icon={<Timeline sx={{ fontSize: 16 }} />}
          label={`Run ${filters.runId ? String(filters.runId).slice(0, 12) : 'All live'}`}
          variant="outlined"
        />
        <Chip
          icon={<Radar sx={{ fontSize: 16 }} />}
          label={`Generated ${formatGeneratedAt(analytics.generatedAt)}`}
          variant="outlined"
        />
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        {analytics.sampleNotice} {hasClosedTrades ? <>Net expectancy: {formatSignedMoney(summary.avgPnLAud)} per trade;
        95% bootstrap interval {formatSignedMoney(summary.expectancy95Aud?.lower)} to {formatSignedMoney(summary.expectancy95Aud?.upper)}.</> : 'No closed trades in this scope and period; win rate, expectancy and confidence intervals are unavailable.'}
        {analytics.interval && ` Period ${new Date(analytics.interval.start).toLocaleDateString('en-AU')} to ${new Date(analytics.interval.endExclusive).toLocaleString('en-AU')} (end excluded; ${analytics.interval.timeBasis === 'realized' ? 'close time' : 'entry time'}).`}
      </Alert>
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
          value={hasClosedTrades && summary.winRate != null ? `${summary.winRate.toFixed(1)}%` : 'N/A'}
          subtitle={`${summary.winningTrades || 0}W / ${summary.losingTrades || 0}L`}
          color={summary.winRate > 50 ? 'success.main' : 'warning.main'}
          icon={<DataUsage fontSize="small" />}
        />
        <KPICard
          title="Profit Factor"
          value={!hasClosedTrades ? 'N/A' : Number(summary.losingTrades) === 0 ? Number(summary.winningTrades) > 0 ? 'No losses' : 'N/A' : summary.profitFactor?.toFixed?.(2) || 'N/A'}
          subtitle={`Avg win ${formatSignedMoney(Number(summary.winningTrades) > 0 ? summary.avgWinAud : null)}`}
          color={summary.profitFactor > 1 ? 'success.main' : 'error.main'}
          icon={<TrendingUp fontSize="small" />}
        />
        <KPICard
          title="Mean Net R"
          value={summary.netR?.mean == null ? 'N/A' : summary.netR.mean.toFixed(3)}
          subtitle={`${summary.netR?.observations || 0} trades with original AUD risk`}
          color="info.main"
          icon={<Insights fontSize="small" />}
        />
        <KPICard
          title="Avg Hold Time"
          value={formatHoldingTime(summary.avgHoldingTimeMs)}
          subtitle={`Largest win ${formatSignedMoney(Number(summary.winningTrades) > 0 ? summary.largestWinAud : null)}`}
          color="info.main"
          icon={<FilterAlt fontSize="small" />}
        />
      </Box>

      <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Typography variant="h6">Entry decisions and trigger overlap</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>{analytics.funnelTimeBasis}</Typography>
        {analytics.entryFunnel?.stageCoverage && <Typography variant="body2" color="text.secondary" mb={1}>{analytics.entryFunnel.stageCoverage}</Typography>}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
          {(analytics.rejectionBreakdown?.breakdown || []).map((item) => (
            <Chip key={item.code || item.reason || item.rejectionCode} label={`${item.code || item.reason || item.rejectionCode}: ${item.count || item.total || 0}`} />
          ))}
          <Chip label={`${rawCounts.entryDecisions || 0} entry decisions`} />
          <Chip label={`${rawCounts.uniqueActionableSignals || 0} distinct actionable signals`} />
        </Stack>
        <Box component="table" sx={{ width: '100%', textAlign: 'left', '& th, & td': { p: 0.75 } }}>
          <thead><tr><th>Raw trigger</th><th>Trades</th><th>Net AUD</th><th>Net mean R</th><th>Wins / losses / flat</th></tr></thead>
          <tbody>{(analytics.triggerPerformance || []).map((row) => <tr key={row.trigger}>
            <td>{row.trigger.replaceAll('_', ' ')}</td><td>{row.trades}</td><td>{formatSignedMoney(row.totalPnLAud)}</td>
            <td>{row.avgR == null ? 'Unknown' : row.avgR.toFixed(3)}</td><td>{row.wins} / {row.losses} / {row.flat}</td>
          </tr>)}</tbody>
        </Box>
        <Typography variant="body2" color="text.secondary" mt={1}>
          Verified excursion coverage: {analytics.excursionCoverage?.verifiedTrades || 0} / {analytics.excursionCoverage?.totalTrades || 0} trades. {analytics.excursionCoverage?.unverifiedTrades || 0} trades have unverified samples. {analytics.excursionCoverage?.method}
        </Typography>
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
      </>}
    </Box>
  );
};

export default AnalyticsDashboard;
