// frontend/src/components/AnalyticsDashboard.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, CircularProgress, Alert, ToggleButtonGroup, ToggleButton, useTheme, alpha } from '@mui/material';
import { Insights, ShowChart, DataUsage, FilterAlt } from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// Imports from Sub-Components
import EquityChart from './analytics/EquityChart';
import AssetTable from './analytics/AssetTable';
import { KPICard, SignalQualityWidget, TrendAnalysisWidget, ExitAnalysisWidget } from './analytics/StrategyWidgets';

const AnalyticsDashboard = () => {
  const [period, setPeriod] = useState('30d'); 
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const theme = useTheme();

  // --- Data Fetching ---
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [report, trades, signals] = await Promise.all([
          tradingAPI.getAnalytics(period),
          tradingAPI.getTrades({ limit: 500 }), 
          tradingAPI.getSignals({ limit: 10000 }) 
        ]);
        setData({ report, trades, signals });
      } catch (err) {
        console.error("Analytics Load Error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [period]);

  // --- Metrics Calculation ---
  const metrics = useMemo(() => {
    if (!data) return null;
    const { report, trades, signals } = data;

    const sortedTrades = [...trades]
        .filter(t => (t.pnl !== null && t.pnl !== undefined) && (!t.isOpen && t.is_open !== 1 && t.status !== 'OPEN'))
        .map(t => ({ ...t, pnl: Number(t.pnl), strength: Number(t.signalStrength || t.signal_strength || 0), exitTime: new Date(t.exitTime || t.timestamp) }))
        .sort((a, b) => a.exitTime - b.exitTime);

    const localStats = {
        totalPnL: sortedTrades.reduce((acc, t) => acc + t.pnl, 0),
        totalTrades: sortedTrades.length,
        wins: sortedTrades.filter(t => t.pnl > 0).length,
        losses: sortedTrades.filter(t => t.pnl <= 0).length,
    };
    localStats.winRate = localStats.totalTrades > 0 ? (localStats.wins / localStats.totalTrades) * 100 : 0;
    
    const grossWin = sortedTrades.filter(t => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(sortedTrades.filter(t => t.pnl <= 0).reduce((acc, t) => acc + t.pnl, 0));
    localStats.profitFactor = grossLoss === 0 ? (grossWin > 0 ? 999 : 0) : grossWin / grossLoss;

    const winTrades = sortedTrades.filter(t => t.pnl > 0 && t.strength > 0);
    const lossTrades = sortedTrades.filter(t => t.pnl <= 0 && t.strength > 0);
    const avgAdxWin = winTrades.length > 0 ? winTrades.reduce((sum, t) => sum + t.strength, 0) / winTrades.length : 0;
    const avgAdxLoss = lossTrades.length > 0 ? lossTrades.reduce((sum, t) => sum + t.strength, 0) / lossTrades.length : 0;

    const localAssetStats = {};
    sortedTrades.forEach(t => {
        if (!localAssetStats[t.symbol]) localAssetStats[t.symbol] = { performance: { totalTrades: 0, totalPnL: 0, wins: 0, bestTrade: -Infinity, worstTrade: Infinity } };
        const stats = localAssetStats[t.symbol].performance;
        stats.totalTrades++; stats.totalPnL += t.pnl;
        if (t.pnl > 0) stats.wins++;
        stats.bestTrade = Math.max(stats.bestTrade, t.pnl);
        stats.worstTrade = Math.min(stats.worstTrade, t.pnl);
    });
    Object.values(localAssetStats).forEach(item => { item.performance.winRate = (item.performance.wins / item.performance.totalTrades) * 100; });

    let runningPnL = 0;
    const pnlCurve = sortedTrades.map(t => { runningPnL += t.pnl; return { date: t.exitTime, pnl: runningPnL }; });
    const dailyMap = {};
    sortedTrades.forEach(t => { const dateStr = t.exitTime.toLocaleDateString(); dailyMap[dateStr] = (dailyMap[dateStr] || 0) + t.pnl; });
    const dailyPnL = Object.entries(dailyMap).map(([date, pnl]) => ({ date, pnl }));

    const signalStats = { executed: 0, blockedADX: 0, blockedRSI: 0, blockedOther: 0 };
    signals.forEach(s => {
        const msg = (s.message || "").toLowerCase();
        if (s.signal.includes('BUY') || s.signal.includes('SELL')) signalStats.executed++;
        else if (msg.includes('choppy') || msg.includes('adx')) signalStats.blockedADX++;
        else if (msg.includes('rsi') || msg.includes('over')) signalStats.blockedRSI++;
        else signalStats.blockedOther++;
    });
    const filterPieData = [
        { id: 0, value: signalStats.executed, label: 'Triggered', color: theme.palette.success.main },
        { id: 1, value: signalStats.blockedADX, label: 'Filtered (Choppy)', color: theme.palette.warning.main },
        { id: 2, value: signalStats.blockedRSI, label: 'Filtered (Overbought)', color: theme.palette.info.main },
        { id: 3, value: signalStats.blockedOther, label: 'Wait/Hold', color: theme.palette.grey[800] },
    ].filter(d => d.value > 0);

    const exitReasons = sortedTrades.reduce((acc, t) => { const reason = t.exitReason || 'Unknown'; acc[reason] = (acc[reason] || 0) + 1; return acc; }, {});
    const exitPieData = Object.keys(exitReasons).map((k, i) => ({ id: i, value: exitReasons[k], label: k.replace(/_/g, ' ') }));

    return {
        tradingStats: { ...(report.summary?.trading || {}), ...localStats },
        efficiency: report.summary?.efficiency || {},
        pnlCurve, dailyPnL, filterPieData, exitPieData, 
        adxStats: { avgAdxWin, avgAdxLoss }, assetStats: localAssetStats 
    };
  }, [data, theme]);

  if (loading) return <Box minHeight="80vh" display="flex" alignItems="center" justifyContent="center"><CircularProgress /></Box>;
  if (error) return <Alert severity="error">Error loading analytics: {error}</Alert>;
  if (!metrics) return <Alert severity="info">No data available</Alert>;

  const { tradingStats, efficiency, pnlCurve, dailyPnL, filterPieData, adxStats, exitPieData, assetStats } = metrics;
  
  return (
    <Box pb={4}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} mt={1}>
        <Box display="flex" alignItems="center" gap={1}>
            <Insights color="primary" fontSize="large" />
            <Box>
                <Typography variant="h5" fontWeight="900" sx={{ letterSpacing: -0.5 }}>PERFORMANCE<span style={{color: theme.palette.primary.main}}>LAB</span></Typography>
                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 2 }}>STRATEGY ANALYTICS</Typography>
            </Box>
        </Box>
        <ToggleButtonGroup value={period} exclusive onChange={(e, v) => v && setPeriod(v)} size="small" sx={{ bgcolor: alpha(theme.palette.background.paper, 0.1), backdropFilter: 'blur(5px)', border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <ToggleButton value="24h" sx={{ px: 3, fontWeight: 'bold' }}>24H</ToggleButton>
          <ToggleButton value="7d" sx={{ px: 3, fontWeight: 'bold' }}>7D</ToggleButton>
          <ToggleButton value="30d" sx={{ px: 3, fontWeight: 'bold' }}>30D</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* 1. KPI Cards */}
      <Box display="flex" gap={2} mb={2} sx={{ overflowX: 'auto', pb: 0.5 }}>
        <Box flex={1} minWidth={220}><KPICard title="Net Profit" value={`$${tradingStats.totalPnL?.toFixed(2) || '0.00'}`} subtitle={`${tradingStats.totalTrades || 0} Trades Filled`} color={tradingStats.totalPnL >= 0 ? 'success.main' : 'error.main'} icon={<ShowChart fontSize="small" />} /></Box>
        <Box flex={1} minWidth={220}><KPICard title="Win Rate" value={`${tradingStats.winRate?.toFixed(1) || 0}%`} subtitle={`Profit Factor: ${tradingStats.profitFactor?.toFixed(2) || 0}`} color={tradingStats.winRate > 50 ? 'success.main' : 'warning.main'} icon={<DataUsage fontSize="small" />} /></Box>
        <Box flex={1} minWidth={220}><KPICard title="Signal Quality" value={efficiency.signalQuality || 'N/A'} subtitle={`${efficiency.conversionRate || '0%'} Fill Rate`} color="info.main" icon={<FilterAlt fontSize="small" />} /></Box>
        <Box flex={1} minWidth={220}><KPICard title="Sharpe Ratio" value={tradingStats.sharpeRatio?.toFixed(2) || '0.00'} subtitle={tradingStats.sharpeRatio > 1 ? "Excellent Risk/Reward" : "Risk Analysis"} color={tradingStats.sharpeRatio > 1 ? "success.main" : "warning.main"} icon={<Insights fontSize="small" />} /></Box>
      </Box>

      {/* 2. Charts */}
      <Box display="flex" flexDirection={{ xs: 'column', lg: 'row' }} gap={2} mb={2}>
        <Box flex={1} minWidth={0}>
             <EquityChart pnlCurve={pnlCurve} dailyPnL={dailyPnL} />
        </Box>
        <Box flex={{ xs: 1, lg: '0 0 35%' }} minWidth={{ lg: 350 }}>
            <SignalQualityWidget filterPieData={filterPieData} />
        </Box>
      </Box>

      {/* 3. Secondary Stats */}
      <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} mb={2} sx={{ minHeight: 350 }}>
        <Box flex={1}><TrendAnalysisWidget totalTrades={tradingStats.totalTrades} adxStats={adxStats} /></Box>
        <Box flex={1}><ExitAnalysisWidget exitPieData={exitPieData} /></Box>
      </Box>

      {/* 4. Asset Table */}
      <Box width="100%">
          <AssetTable assetStats={assetStats} />
      </Box>
    </Box>
  );
};

export default AnalyticsDashboard;