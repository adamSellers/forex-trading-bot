// frontend/src/components/AnalyticsDashboard.jsx - Forex Analytics Dashboard
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  useTheme,
  alpha,
} from '@mui/material';
import { Insights, ShowChart, DataUsage, FilterAlt, TrendingUp } from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// Sub-components
import EquityChart from './analytics/EquityChart';
import PairPerformance from './analytics/PairPerformance';
import {
  KPICard,
  SignalQualityWidget,
  TrendAnalysisWidget,
  ExitAnalysisWidget,
  SessionPerformanceWidget,
} from './analytics/StrategyWidgets';

const AnalyticsDashboard = () => {
  const [period, setPeriod] = useState('30d');
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const theme = useTheme();

  // Fetch analytics data
  useEffect(() => {
    const loadAnalytics = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await tradingAPI.getAnalytics(period);
        setAnalytics(data);
      } catch (err) {
        console.error('Analytics Load Error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadAnalytics();
  }, [period]);

  if (loading) {
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

  const { summary, signalAnalysis, equityData, adxAnalysis, exitAnalysis, pairPerformance, sessionPerformance } = analytics;

  // Format holding time
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

  return (
    <Box px={3} pb={4} pt={2}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <Insights color="primary" fontSize="large" />
          <Box>
            <Typography variant="h5" fontWeight="900" sx={{ letterSpacing: -0.5 }}>
              PERFORMANCE<span style={{ color: theme.palette.primary.main }}>LAB</span>
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 2 }}>
              FOREX STRATEGY ANALYTICS
            </Typography>
          </Box>
        </Box>
        <ToggleButtonGroup
          value={period}
          exclusive
          onChange={(e, v) => v && setPeriod(v)}
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

      {/* 1. KPI Cards Row */}
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
            subtitle={`${summary.winningTrades}W / ${summary.losingTrades}L`}
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
            subtitle={summary.sharpeRatio > 1 ? 'Excellent Risk/Reward' : 'Risk Analysis'}
            color={summary.sharpeRatio > 1 ? 'success.main' : 'warning.main'}
            icon={<Insights fontSize="small" />}
          />
        </Box>
        <Box flex={1} minWidth={200}>
          <KPICard
            title="Avg Hold Time"
            value={formatHoldingTime(summary.avgHoldingTimeMs)}
            subtitle={`Best: +A$${summary.largestWinAud || 0}`}
            color="info.main"
            icon={<FilterAlt fontSize="small" />}
          />
        </Box>
      </Box>

      {/* 2. Charts Row */}
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

      {/* 3. Analysis Widgets Row */}
      <Box
        display="flex"
        flexDirection={{ xs: 'column', md: 'row' }}
        gap={2}
        mb={2}
        sx={{ minHeight: 320 }}
      >
        <Box flex={1}>
          <TrendAnalysisWidget
            totalTrades={summary.totalTrades || 0}
            adxAnalysis={adxAnalysis}
          />
        </Box>
        <Box flex={1}>
          <SessionPerformanceWidget sessions={sessionPerformance || []} />
        </Box>
        <Box flex={1}>
          <ExitAnalysisWidget exitAnalysis={exitAnalysis} />
        </Box>
      </Box>

      {/* 4. Pair Performance Table */}
      <Box width="100%">
        <PairPerformance pairStats={pairPerformance || []} />
      </Box>
    </Box>
  );
};

export default AnalyticsDashboard;