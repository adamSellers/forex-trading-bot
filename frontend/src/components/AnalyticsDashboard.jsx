// frontend/src/components/AnalyticsDashboard.jsx - VISUAL POLISH
import React, { useState, useEffect, useMemo } from 'react';
import {
  Grid, Paper, Typography, Box, Card, CardContent, CircularProgress, Alert,
  ToggleButtonGroup, ToggleButton, Divider, useTheme, Chip, Stack
} from '@mui/material';
import {
  PieChart, LineChart
} from '@mui/x-charts';
import {
  TrendingUp, ShowChart, Insights, FilterAlt, MonetizationOn,
  DataUsage, TableChart, DonutLarge
} from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// --- Reusable Metric Card ---
const MetricCard = ({ title, value, subtitle, color = 'text.primary', icon }) => (
  <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
    <CardContent>
      <Box display="flex" alignItems="center" mb={1} gap={1}>
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', display: 'flex' }}>{icon}</Box>
        <Typography variant="body2" color="text.secondary" fontWeight="medium">
          {title}
        </Typography>
      </Box>
      <Typography variant="h4" fontWeight="bold" color={color} sx={{ my: 1 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {subtitle}
      </Typography>
    </CardContent>
  </Card>
);

// --- Reusable Empty State Placeholder ---
const EmptyState = ({ icon, message, height = 250 }) => (
    <Box 
        display="flex" 
        flexDirection="column" 
        alignItems="center" 
        justifyContent="center" 
        height={height}
        color="text.disabled"
        sx={{ opacity: 0.7 }}
    >
        {React.cloneElement(icon, { sx: { fontSize: 48, mb: 1, opacity: 0.5 } })}
        <Typography variant="body2">{message}</Typography>
    </Box>
);

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
          tradingAPI.getSignals({ limit: 1000 }) 
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

    // 1. Overview
    const tradingStats = report.summary?.trading || {};
    const efficiency = report.summary?.efficiency || {};
    
    // 2. P&L Curve
    const sortedTrades = [...trades]
        .filter(t => t.side === 'SELL')
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    let runningPnL = 0;
    const pnlCurve = sortedTrades.map(t => {
        runningPnL += (t.pnl || 0);
        return { date: new Date(t.timestamp), pnl: runningPnL };
    });

    // 3. Filter Efficiency
    const signalStats = { executed: 0, blockedADX: 0, blockedRSI: 0, blockedOther: 0 };
    signals.forEach(s => {
        const msg = (s.message || "").toLowerCase();
        if (s.signal.includes('BUY') || s.signal.includes('SELL')) signalStats.executed++;
        else if (msg.includes('choppy') || msg.includes('adx')) signalStats.blockedADX++;
        else if (msg.includes('rsi') || msg.includes('over')) signalStats.blockedRSI++;
        else signalStats.blockedOther++;
    });

    const filterPieData = [
        { id: 0, value: signalStats.executed, label: 'Executed', color: theme.palette.success.main },
        { id: 1, value: signalStats.blockedADX, label: 'Blocked (ADX)', color: theme.palette.warning.main },
        { id: 2, value: signalStats.blockedRSI, label: 'Blocked (RSI)', color: theme.palette.info.main },
        { id: 3, value: signalStats.blockedOther, label: 'Wait/Hold', color: theme.palette.grey[500] },
    ].filter(d => d.value > 0);

    // 4. ADX Stats
    const wins = sortedTrades.filter(t => t.pnl > 0);
    const losses = sortedTrades.filter(t => t.pnl <= 0);
    const avgAdxWin = wins.reduce((sum, t) => sum + (t.signalStrength || 0), 0) / (wins.length || 1);
    const avgAdxLoss = losses.reduce((sum, t) => sum + (t.signalStrength || 0), 0) / (losses.length || 1);

    // 5. Exit Reasons
    const exitReasons = sortedTrades.reduce((acc, t) => {
        const reason = t.exitReason || 'Unknown';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
    }, {});
    const exitPieData = Object.keys(exitReasons).map((k, i) => ({
        id: i, value: exitReasons[k], label: k.replace(/_/g, ' ')
    }));

    return {
        tradingStats, efficiency, pnlCurve, filterPieData, 
        adxStats: { avgAdxWin, avgAdxLoss }, exitPieData, assetStats: report.assets || {}
    };
  }, [data, theme]);

  if (loading) return <Box display="flex" justifyContent="center" p={10}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">Error loading analytics: {error}</Alert>;
  if (!metrics) return <Alert severity="info">No data available</Alert>;

  const { tradingStats, efficiency, pnlCurve, filterPieData, adxStats, exitPieData, assetStats } = metrics;
  const assetKeys = Object.keys(assetStats);

  return (
    <Box pb={4}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
        <Typography variant="h4" component="h1">Performance Analytics</Typography>
        <ToggleButtonGroup 
          value={period} 
          exclusive 
          onChange={(e, v) => v && setPeriod(v)}
          size="small"
        >
          <ToggleButton value="24h">24H</ToggleButton>
          <ToggleButton value="7d">7D</ToggleButton>
          <ToggleButton value="30d">30D</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* KPI Cards - Top Row */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Total P&L" 
            value={`$${tradingStats.totalPnL?.toFixed(2) || '0.00'}`} 
            subtitle={`${tradingStats.totalTrades || 0} Trades`}
            color={tradingStats.totalPnL >= 0 ? 'success.main' : 'error.main'}
            icon={<ShowChart color="inherit" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Win Rate" 
            value={`${tradingStats.winRate?.toFixed(1) || 0}%`} 
            subtitle={`PF: ${tradingStats.profitFactor?.toFixed(2) || 0}`}
            color={tradingStats.winRate > 50 ? 'success.main' : 'warning.main'}
            icon={<Insights color="inherit" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Signal Quality" 
            value={efficiency.signalQuality || 'N/A'} 
            subtitle={`${efficiency.conversionRate || '0%'} Conversion`}
            icon={<FilterAlt color="info" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Avg. Trade" 
            value={`$${tradingStats.avgWin?.toFixed(2) || '0.00'}`} 
            subtitle={`Avg Loss: $${tradingStats.avgLoss?.toFixed(2) || '0.00'}`}
            icon={<MonetizationOn color="success" />}
          />
        </Grid>
      </Grid>

      {/* Main Charts Grid */}
      <Grid container spacing={3}>
        
        {/* Row 2: Growth & Filters */}
        <Grid item xs={12} lg={8}>
          <Paper sx={{ p: 3, height: 400, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" gutterBottom>Portfolio Growth</Typography>
            <Box flexGrow={1} minHeight={0}>
                {pnlCurve.length > 1 ? (
                    <LineChart
                        dataset={pnlCurve}
                        xAxis={[{ dataKey: 'date', scaleType: 'time', valueFormatter: (date) => date.toLocaleDateString() }]}
                        series={[{ dataKey: 'pnl', area: true, color: theme.palette.primary.main, showMark: false }]}
                        grid={{ horizontal: true }}
                    />
                ) : (
                    <EmptyState icon={<ShowChart />} message="Not enough trade data to plot growth curve" />
                )}
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 3, height: 400, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" gutterBottom>Smart Filter Efficiency</Typography>
            <Box flexGrow={1} display="flex" alignItems="center" justifyContent="center">
                {filterPieData.length > 0 ? (
                    <PieChart
                        series={[{
                            data: filterPieData,
                            innerRadius: 60,
                            paddingAngle: 2,
                            cornerRadius: 4,
                            highlightScope: { faded: 'global', highlighted: 'item' },
                        }]}
                        margin={{ right: 10, left: 10, top: 10, bottom: 60 }}
                        slotProps={{
                            legend: { direction: 'row', position: { vertical: 'bottom', horizontal: 'middle' }, padding: 0 }
                        }}
                    />
                ) : (
                    <EmptyState icon={<FilterAlt />} message="Waiting for signals..." />
                )}
            </Box>
          </Paper>
        </Grid>

        {/* Row 3: ADX & Exits */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Trend Strength Impact</Typography>
            {tradingStats.totalTrades > 0 ? (
                <>
                    <Box display="flex" justifyContent="space-around" mt={4} mb={4}>
                        <Box textAlign="center">
                            <Typography variant="h3" color="success.main" fontWeight="bold">
                                {adxStats.avgAdxWin.toFixed(1)}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">Avg ADX of Winners</Typography>
                        </Box>
                        <Divider orientation="vertical" flexItem />
                        <Box textAlign="center">
                            <Typography variant="h3" color="error.main" fontWeight="bold">
                                {adxStats.avgAdxLoss.toFixed(1)}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">Avg ADX of Losers</Typography>
                        </Box>
                    </Box>
                    <Alert severity="info" variant="outlined">
                        Target: Winners should have higher ADX ({'>'}25) than losers.
                    </Alert>
                </>
            ) : (
                <EmptyState height={200} icon={<TrendingUp />} message="No completed trades to analyze ADX" />
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Exit Strategy Performance</Typography>
            <Box height={250} display="flex" alignItems="center" justifyContent="center">
                {exitPieData.length > 0 ? (
                    <PieChart
                        series={[{
                            data: exitPieData,
                            innerRadius: 40,
                            paddingAngle: 1,
                        }]}
                        slotProps={{
                            legend: { direction: 'row', position: { vertical: 'bottom', horizontal: 'middle' } }
                        }}
                    />
                ) : (
                    <EmptyState icon={<DonutLarge />} message="No exits recorded yet" />
                )}
            </Box>
          </Paper>
        </Grid>

        {/* Row 4: Asset Breakdown (Forced to Full Width) */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Asset Breakdown</Typography>
            {assetKeys.length > 0 ? (
                <Grid container spacing={2}>
                    {Object.entries(assetStats).map(([symbol, stats]) => {
                        const perf = stats.performance;
                        if (!perf) return null;
                        return (
                            <Grid item xs={12} sm={6} md={4} key={symbol}>
                                <Card variant="outlined">
                                    <CardContent>
                                        <Stack direction="row" justifyContent="space-between" mb={1}>
                                            <Typography fontWeight="bold">{symbol.replace('USDT','')}</Typography>
                                            <Chip 
                                                label={`${perf.winRate.toFixed(0)}% WR`} 
                                                size="small" 
                                                color={perf.winRate > 50 ? "success" : "default"} 
                                            />
                                        </Stack>
                                        <Typography variant="h5" color={perf.totalPnL >= 0 ? "success.main" : "error.main"}>
                                            {perf.totalPnL >= 0 ? "+" : ""}{perf.totalPnL.toFixed(2)}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {perf.totalTrades} Trades • Best: +{perf.bestTrade?.toFixed(2)}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        );
                    })}
                </Grid>
            ) : (
                <EmptyState height={150} icon={<TableChart />} message="No asset performance data available yet" />
            )}
          </Paper>
        </Grid>

      </Grid>
    </Box>
  );
};

export default AnalyticsDashboard;