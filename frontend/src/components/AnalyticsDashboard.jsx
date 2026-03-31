import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  DataUsage,
  FilterAlt,
  Insights,
  Radar,
  ShowChart,
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
  { value: 'all', label: 'All Modes' },
  { value: 'live', label: 'Live' },
  { value: 'paper_shadow', label: 'Shadow Paper' },
  { value: 'paper_candidate', label: 'Candidate Paper' },
];

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
  return `${strategyLabel} • ${modeLabel} • ${shortRunId}`;
};

const AnalyticsDashboard = () => {
  const theme = useTheme();
  const [period, setPeriod] = useState('30d');
  const [mode, setMode] = useState('all');
  const [strategy, setStrategy] = useState('');
  const [runId, setRunId] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [availableRuns, setAvailableRuns] = useState([]);
  const [strategyCatalog, setStrategyCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const loadFilterContext = async () => {
      setContextLoading(true);
      try {
        const [runsResponse, catalog] = await Promise.all([
          runtimeAPI.getRuns({
            mode: mode === 'all' ? undefined : mode,
            strategy: strategy || undefined,
          }),
          strategiesAPI.getCatalog(),
        ]);

        if (cancelled) return;

        const runs = Array.isArray(runsResponse?.runs) ? runsResponse.runs : [];
        setAvailableRuns(runs);
        setStrategyCatalog(Array.isArray(catalog) ? catalog : []);

        if (runId && !runs.some((run) => run.runId === runId)) {
          setRunId('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setContextLoading(false);
        }
      }
    };

    loadFilterContext();

    return () => {
      cancelled = true;
    };
  }, [mode, strategy, runId]);

  useEffect(() => {
    let cancelled = false;

    const loadAnalytics = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await analyticsAPI.get({
          period,
          mode,
          strategy: strategy || undefined,
          runId: runId || undefined,
        });

        if (!cancelled) {
          setAnalytics(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [period, mode, strategy, runId]);

  const selectedRun = useMemo(
    () => availableRuns.find((run) => run.runId === runId) || null,
    [availableRuns, runId]
  );

  if ((loading || contextLoading) && !analytics) {
    return (
      <Box minHeight="80vh" display="flex" alignItems="center" justifyContent="center">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
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
    summary,
    signalAnalysis,
    equityData,
    adxAnalysis,
    exitAnalysis,
    pairPerformance,
    sessionPerformance,
    sidePerformance,
    filters,
    rawCounts,
  } = analytics;

  return (
    <Box px={3} pb={4} pt={2}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} gap={2} flexWrap="wrap">
        <Box display="flex" alignItems="center" gap={1}>
          <Insights color="primary" fontSize="large" />
          <Box>
            <Typography variant="h5" fontWeight="900" sx={{ letterSpacing: -0.5 }}>
              RUNTIME<span style={{ color: theme.palette.primary.main }}>ANALYTICS</span>
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 2 }}>
              UNIFIED LIVE, SHADOW, AND CANDIDATE PERFORMANCE
            </Typography>
          </Box>
        </Box>

        <ToggleButtonGroup
          value={period}
          exclusive
          onChange={(_, value) => value && setPeriod(value)}
          size="small"
          sx={{
            bgcolor: alpha(theme.palette.background.paper, 0.1),
            backdropFilter: 'blur(5px)',
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}
        >
          <ToggleButton value="24h" sx={{ px: 3, fontWeight: 'bold' }}>
            24H
          </ToggleButton>
          <ToggleButton value="7d" sx={{ px: 3, fontWeight: 'bold' }}>
            7D
          </ToggleButton>
          <ToggleButton value="30d" sx={{ px: 3, fontWeight: 'bold' }}>
            30D
          </ToggleButton>
          <ToggleButton value="90d" sx={{ px: 3, fontWeight: 'bold' }}>
            90D
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', lg: 'center' }}
        mb={2}
      >
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select value={mode} onChange={(event) => setMode(event.target.value)}>
            {MODE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 220 }}>
          <Select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
            <MenuItem value="">All Strategies</MenuItem>
            {strategyCatalog.map((option) => (
              <MenuItem key={option.key} value={option.key}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 320 }}>
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

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            icon={<FilterAlt sx={{ fontSize: 16 }} />}
            label={`Mode ${formatModeLabel(filters?.mode || mode)}`}
            variant="outlined"
          />
          <Chip
            icon={<Radar sx={{ fontSize: 16 }} />}
            label={`Signals ${rawCounts?.totalSignals || 0}`}
            variant="outlined"
          />
          <Chip
            icon={<Timeline sx={{ fontSize: 16 }} />}
            label={`Run ${selectedRun ? String(selectedRun.runId).slice(0, 12) : 'All'}`}
            variant="outlined"
          />
        </Stack>
      </Stack>

      <Box display="flex" gap={2} mb={2} sx={{ overflowX: 'auto', pb: 0.5 }}>
        <Box flex={1} minWidth={200}>
          <KPICard
            title="Net Profit"
            value={`A$${summary.totalPnLAud?.toFixed(2) || '0.00'}`}
            subtitle={`${summary.totalTrades || 0} trades | ${summary.totalPnLPips?.toFixed(0) || 0} pips`}
            color={summary.totalPnLAud >= 0 ? 'success.main' : 'error.main'}
            icon={<ShowChart fontSize="small" />}
          />
        </Box>
        <Box flex={1} minWidth={200}>
          <KPICard
            title="Win Rate"
            value={`${summary.winRate?.toFixed(1) || 0}%`}
            subtitle={`${summary.winningTrades || 0}W / ${summary.losingTrades || 0}L`}
            color={summary.winRate > 50 ? 'success.main' : 'warning.main'}
            icon={<DataUsage fontSize="small" />}
          />
        </Box>
        <Box flex={1} minWidth={200}>
          <KPICard
            title="Profit Factor"
            value={summary.profitFactor?.toFixed(2) || '0.00'}
            subtitle={`Avg Win: A$${summary.avgWinAud?.toFixed(2) || 0}`}
            color={summary.profitFactor > 1 ? 'success.main' : 'error.main'}
            icon={<TrendingUp fontSize="small" />}
          />
        </Box>
        <Box flex={1} minWidth={200}>
          <KPICard
            title="Sharpe Ratio"
            value={summary.sharpeRatio?.toFixed(2) || '0.00'}
            subtitle={selectedRun ? formatRunLabel(selectedRun, strategyCatalog) : 'Aggregate runtime view'}
            color={summary.sharpeRatio > 1 ? 'success.main' : 'warning.main'}
            icon={<Insights fontSize="small" />}
          />
        </Box>
        <Box flex={1} minWidth={200}>
          <KPICard
            title="Avg Hold Time"
            value={formatHoldingTime(summary.avgHoldingTimeMs)}
            subtitle={`Largest win: +A$${summary.largestWinAud || 0}`}
            color="info.main"
            icon={<FilterAlt fontSize="small" />}
          />
        </Box>
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
            totalSignals={signalAnalysis?.total || 0}
            avgStrength={signalAnalysis?.avgStrength || 0}
          />
        </Box>
      </Box>

      <Box
        display="flex"
        flexDirection={{ xs: 'column', md: 'row' }}
        gap={2}
        mb={2}
        sx={{ minHeight: 320 }}
      >
        <Box flex={1}>
          <TrendAnalysisWidget totalTrades={summary.totalTrades || 0} adxAnalysis={adxAnalysis} />
        </Box>
        <Box flex={1}>
          <SessionPerformanceWidget sessions={sessionPerformance || []} />
        </Box>
        <Box flex={1}>
          <ExitAnalysisWidget exitAnalysis={exitAnalysis} />
        </Box>
      </Box>

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
