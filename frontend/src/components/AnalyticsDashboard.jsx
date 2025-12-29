// frontend/src/components/AnalyticsDashboard.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Typography, Box, CircularProgress, Alert,
  ToggleButtonGroup, ToggleButton, Divider, useTheme, Chip, Stack,
  Paper, styled, alpha, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, Avatar, LinearProgress, IconButton, Tooltip
} from '@mui/material';
import {
  PieChart, LineChart, BarChart // <--- Added BarChart
} from '@mui/x-charts';
import {
  TrendingUp, ShowChart, Insights, FilterAlt, MonetizationOn,
  DataUsage, DonutLarge, CalendarToday, ArrowDropUp, ArrowDropDown,
  BarChart as BarChartIcon, Timeline // <--- Added Icons
} from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// --- STYLED COMPONENTS ---
const GlassCard = styled(Paper)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  }
}));

const MetricValue = styled(Typography)(() => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 700,
  letterSpacing: '-1px'
}));

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    padding: '10px 16px',
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    fontSize: '0.8rem',
    fontFamily: '"Roboto Mono", monospace', 
}));

const HeaderCell = styled(TableCell)(({ theme }) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.2),
    color: theme.palette.text.secondary,
    fontWeight: 700,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 1,
    borderBottom: `1px solid ${theme.palette.divider}`,
}));

// --- COMPONENT: KPI CARD ---
const MetricCard = ({ title, value, subtitle, color = 'text.primary', icon }) => {
    const theme = useTheme();
    const isPositive = subtitle && subtitle.includes('+');
    
    return (
        <GlassCard elevation={0}>
            <Box p={3} display="flex" flexDirection="column" justifyContent="space-between" height="100%">
                <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                         <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                            {title}
                        </Typography>
                        <MetricValue variant="h4" sx={{ color: color, mt: 1 }}>
                            {value}
                        </MetricValue>
                    </Box>
                    <Avatar variant="rounded" sx={{ 
                        bgcolor: alpha(theme.palette[color.split('.')[0]].main, 0.1), 
                        color: theme.palette[color.split('.')[0]].main, 
                        border: `1px solid ${alpha(theme.palette[color.split('.')[0]].main, 0.2)}`
                    }}>
                        {icon}
                    </Avatar>
                </Box>
                
                {subtitle && (
                    <Box mt={2} display="flex" alignItems="center" gap={0.5}>
                        {isPositive ? <ArrowDropUp color="success" fontSize="small" /> : <ArrowDropDown color="error" fontSize="small" />}
                        <Typography variant="body2" color="text.secondary" fontWeight="medium">
                            {subtitle}
                        </Typography>
                    </Box>
                )}
            </Box>
        </GlassCard>
    );
};

// --- COMPONENT: EMPTY STATE ---
const EmptyState = ({ icon, message, height = 250 }) => (
    <Box 
        display="flex" 
        flexDirection="column" 
        alignItems="center" 
        justifyContent="center" 
        height={height}
        color="text.secondary"
        sx={{ opacity: 0.6 }}
    >
        {React.cloneElement(icon, { sx: { fontSize: 48, mb: 2, opacity: 0.5 } })}
        <Typography variant="button" color="text.secondary">{message}</Typography>
    </Box>
);

const AnalyticsDashboard = () => {
  const [period, setPeriod] = useState('30d'); 
  const [chartMode, setChartMode] = useState('cumulative'); // 'cumulative' | 'daily'
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

    // 1. Filter Completed Trades (Robust)
    const sortedTrades = [...trades]
        .filter(t => {
            const hasPnL = t.pnl !== null && t.pnl !== undefined;
            const isClosed = !t.isOpen && t.is_open !== 1 && t.status !== 'OPEN';
            return hasPnL && isClosed;
        })
        .map(t => ({
            ...t,
            pnl: Number(t.pnl), 
            strength: Number(t.signalStrength || t.signal_strength || 0),
            exitTime: new Date(t.exitTime || t.timestamp)
        }))
        .sort((a, b) => a.exitTime - b.exitTime);

    // 2. Local Stats Calculation
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
    localStats.avgWin = localStats.wins > 0 ? grossWin / localStats.wins : 0;
    localStats.avgLoss = localStats.losses > 0 ? -grossLoss / localStats.losses : 0; 

    // --- NEW: Calculate ADX Stats ---
    const winTrades = sortedTrades.filter(t => t.pnl > 0 && t.strength > 0);
    const lossTrades = sortedTrades.filter(t => t.pnl <= 0 && t.strength > 0);

    const avgAdxWin = winTrades.length > 0 
        ? winTrades.reduce((sum, t) => sum + t.strength, 0) / winTrades.length 
        : 0;
        
    const avgAdxLoss = lossTrades.length > 0 
        ? lossTrades.reduce((sum, t) => sum + t.strength, 0) / lossTrades.length 
        : 0;

    // 3. Asset Performance
    const localAssetStats = {};
    sortedTrades.forEach(t => {
        if (!localAssetStats[t.symbol]) {
            localAssetStats[t.symbol] = { 
                performance: { totalTrades: 0, totalPnL: 0, wins: 0, bestTrade: -Infinity, worstTrade: Infinity } 
            };
        }
        const stats = localAssetStats[t.symbol].performance;
        stats.totalTrades++;
        stats.totalPnL += t.pnl;
        if (t.pnl > 0) stats.wins++;
        stats.bestTrade = Math.max(stats.bestTrade, t.pnl);
        stats.worstTrade = Math.min(stats.worstTrade, t.pnl);
    });

    Object.values(localAssetStats).forEach(item => {
        item.performance.winRate = (item.performance.wins / item.performance.totalTrades) * 100;
    });

    // 4. Merge Data
    const tradingStats = { ...(report.summary?.trading || {}), ...localStats };
    const efficiency = report.summary?.efficiency || {};
    
    // P&L Curves
    let runningPnL = 0;
    const pnlCurve = sortedTrades.map(t => {
        runningPnL += t.pnl;
        return { date: t.exitTime, pnl: runningPnL };
    });

    // Daily PnL Aggregation
    const dailyMap = {};
    sortedTrades.forEach(t => {
        const dateStr = t.exitTime.toLocaleDateString();
        dailyMap[dateStr] = (dailyMap[dateStr] || 0) + t.pnl;
    });
    const dailyPnL = Object.entries(dailyMap).map(([date, pnl]) => ({
        date, pnl
    }));

    // Filter Efficiency
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

    // Exit Reasons
    const exitReasons = sortedTrades.reduce((acc, t) => {
        const reason = t.exitReason || 'Unknown';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
    }, {});
    const exitPieData = Object.keys(exitReasons).map((k, i) => ({
        id: i, value: exitReasons[k], label: k.replace(/_/g, ' ')
    }));

    return {
        tradingStats, efficiency, pnlCurve, dailyPnL, filterPieData, 
        adxStats: { avgAdxWin, avgAdxLoss }, 
        exitPieData, 
        assetStats: localAssetStats 
    };
  }, [data, theme]);

  if (loading) return <Box minHeight="80vh" display="flex" alignItems="center" justifyContent="center"><CircularProgress /></Box>;
  if (error) return <Alert severity="error">Error loading analytics: {error}</Alert>;
  if (!metrics) return <Alert severity="info">No data available</Alert>;

  const { tradingStats, efficiency, pnlCurve, dailyPnL, filterPieData, adxStats, exitPieData, assetStats } = metrics;
  
  // Format Large Numbers
  const currencyFormatter = (value) => {
      if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
      return `$${value.toFixed(0)}`;
  };

  const chartAxisSx = {
      '.MuiChartsAxis-tickLabel': { fill: theme.palette.text.secondary, fontFamily: 'monospace' },
      '.MuiChartsAxis-line': { stroke: alpha(theme.palette.divider, 0.5) },
      '.MuiChartsAxis-tick': { stroke: alpha(theme.palette.divider, 0.5) },
  };

  return (
    <Box pb={4}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} mt={1}>
        <Box display="flex" alignItems="center" gap={1}>
            <Insights color="primary" fontSize="large" />
            <Box>
                <Typography variant="h5" fontWeight="900" sx={{ letterSpacing: -0.5 }}>PERFORMANCE<span style={{color: theme.palette.primary.main}}>LAB</span></Typography>
                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 2 }}>STRATEGY ANALYTICS</Typography>
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
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}` 
          }}
        >
          <ToggleButton value="24h" sx={{ px: 3, fontWeight: 'bold' }}>24H</ToggleButton>
          <ToggleButton value="7d" sx={{ px: 3, fontWeight: 'bold' }}>7D</ToggleButton>
          <ToggleButton value="30d" sx={{ px: 3, fontWeight: 'bold' }}>30D</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* 1. KPI Cards */}
      <Box display="flex" gap={2} mb={2} sx={{ overflowX: 'auto', pb: 0.5 }}>
        <Box flex={1} minWidth={220}>
            <MetricCard 
                title="Net Profit" 
                value={`$${tradingStats.totalPnL?.toFixed(2) || '0.00'}`} 
                subtitle={`${tradingStats.totalTrades || 0} Trades Filled`}
                color={tradingStats.totalPnL >= 0 ? 'success.main' : 'error.main'}
                icon={<ShowChart fontSize="small" />}
            />
        </Box>
        <Box flex={1} minWidth={220}>
            <MetricCard 
                title="Win Rate" 
                value={`${tradingStats.winRate?.toFixed(1) || 0}%`} 
                subtitle={`Profit Factor: ${tradingStats.profitFactor?.toFixed(2) || 0}`}
                color={tradingStats.winRate > 50 ? 'success.main' : 'warning.main'}
                icon={<DataUsage fontSize="small" />}
            />
        </Box>
        <Box flex={1} minWidth={220}>
            <MetricCard 
                title="Signal Quality" 
                value={efficiency.signalQuality || 'N/A'} 
                subtitle={`${efficiency.conversionRate || '0%'} Fill Rate`}
                color="info.main"
                icon={<FilterAlt fontSize="small" />}
            />
        </Box>
        <Box flex={1} minWidth={220}>
            <MetricCard 
                title="Sharpe Ratio" 
                value={tradingStats.sharpeRatio?.toFixed(2) || '0.00'} 
                subtitle={tradingStats.sharpeRatio > 1 ? "Excellent Risk/Reward" : "Risk Analysis"}
                color={tradingStats.sharpeRatio > 1 ? "success.main" : "warning.main"}
                icon={<Insights fontSize="small" />}
            />
        </Box>
      </Box>

      {/* 2. Main Charts Row */}
      <Box display="flex" flexDirection={{ xs: 'column', lg: 'row' }} gap={2} mb={2} sx={{ minHeight: 420 }}>
        
        {/* Growth Curve (Dual Mode) */}
        <Box flex={1} minWidth={0}>
          <GlassCard sx={{ p: 2, height: '100%' }}>
            <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center" gap={1}>
                    <ShowChart color="primary" fontSize="small" />
                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                        {chartMode === 'cumulative' ? 'EQUITY GROWTH ($)' : 'DAILY PnL ($)'}
                    </Typography>
                </Box>
                <Box display="flex" bgcolor={alpha(theme.palette.action.active, 0.05)} borderRadius={1} p={0.5}>
                    <Tooltip title="Cumulative Equity Line">
                        <IconButton 
                            size="small" 
                            color={chartMode === 'cumulative' ? 'primary' : 'default'}
                            onClick={() => setChartMode('cumulative')}
                        >
                            <Timeline fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Daily Profit/Loss Bars">
                        <IconButton 
                            size="small" 
                            color={chartMode === 'daily' ? 'primary' : 'default'}
                            onClick={() => setChartMode('daily')}
                        >
                            <BarChartIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>
            
            <Box flexGrow={1} minHeight={0} sx={{ width: '100%', height: '100%' }}>
                {pnlCurve.length > 0 ? (
                    chartMode === 'cumulative' ? (
                        <LineChart
                            dataset={pnlCurve}
                            xAxis={[{ 
                                dataKey: 'date', 
                                scaleType: 'time', 
                                valueFormatter: (date) => date.toLocaleDateString(),
                                tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 }
                            }]}
                            yAxis={[{
                                valueFormatter: currencyFormatter,
                                tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 }
                            }]}
                            series={[{ 
                                dataKey: 'pnl', 
                                area: false, // CLEANER LOOK: No Fill
                                color: theme.palette.primary.main, 
                                showMark: false,
                                curve: 'linear',
                                width: 2
                            }]}
                            grid={{ horizontal: true }}
                            sx={chartAxisSx}
                        />
                    ) : (
                        <BarChart
                            dataset={dailyPnL}
                            xAxis={[{ 
                                scaleType: 'band', 
                                dataKey: 'date',
                                tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 }
                            }]}
                            yAxis={[{
                                valueFormatter: currencyFormatter,
                                tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 }
                            }]}
                            series={[{ 
                                dataKey: 'pnl', 
                                color: theme.palette.success.main,
                                valueFormatter: (v) => `$${v?.toFixed(2)}`
                            }]}
                            grid={{ horizontal: true }}
                            sx={chartAxisSx}
                        />
                    )
                ) : (
                    <EmptyState icon={<ShowChart />} message="Insufficient data to plot equity curve" />
                )}
            </Box>
          </GlassCard>
        </Box>

        {/* Filter Efficiency */}
        <Box flex={{ xs: 1, lg: '0 0 35%' }} minWidth={{ lg: 350 }}>
          <GlassCard sx={{ p: 2, height: '100%' }}>
            <Box mb={2} display="flex" alignItems="center" gap={1}>
                <FilterAlt color="secondary" fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">SIGNAL FILTERING</Typography>
            </Box>
            <Box flexGrow={1} display="flex" alignItems="center" justifyContent="center">
                {filterPieData.length > 0 ? (
                    <PieChart
                        series={[{
                            data: filterPieData,
                            innerRadius: 80,
                            paddingAngle: 2,
                            cornerRadius: 4,
                            highlightScope: { faded: 'global', highlighted: 'item' },
                        }]}
                        margin={{ right: 0, left: 0, top: 0, bottom: 80 }}
                        slotProps={{
                            legend: { 
                                direction: 'row', 
                                position: { vertical: 'bottom', horizontal: 'middle' }, 
                                padding: 0,
                                labelStyle: { fill: theme.palette.text.secondary, fontSize: 11 }
                            }
                        }}
                        height={300}
                    />
                ) : (
                    <EmptyState icon={<FilterAlt />} message="No signals generated" />
                )}
            </Box>
          </GlassCard>
        </Box>
      </Box>

      {/* 3. Secondary Stats Row */}
      <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} mb={2} sx={{ minHeight: 350 }}>
        {/* Trend Strength */}
        <Box flex={1}>
          <GlassCard sx={{ p: 3, height: '100%' }}>
            <Box mb={2} display="flex" alignItems="center" gap={1}>
                <TrendingUp color="warning" fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">TREND STRENGTH ANALYSIS</Typography>
            </Box>
            
            {tradingStats.totalTrades > 0 ? (
                <Stack spacing={4} mt={2}>
                    <Box display="flex" justifyContent="space-around" alignItems="center">
                        <Box textAlign="center">
                            <Typography variant="h3" color="success.main" fontWeight="900" sx={{ fontFamily: 'monospace' }}>
                                {adxStats.avgAdxWin.toFixed(0)}
                            </Typography>
                            <Typography variant="caption" fontWeight="bold" color="text.secondary">WINNER ADX</Typography>
                        </Box>
                        <Divider orientation="vertical" flexItem sx={{ height: 40, alignSelf: 'center' }} />
                        <Box textAlign="center">
                            <Typography variant="h3" color="error.main" fontWeight="900" sx={{ fontFamily: 'monospace' }}>
                                {adxStats.avgAdxLoss.toFixed(0)}
                            </Typography>
                            <Typography variant="caption" fontWeight="bold" color="text.secondary">LOSER ADX</Typography>
                        </Box>
                    </Box>
                    
                    <Box>
                        <Box display="flex" justifyContent="space-between" mb={1}>
                            <Typography variant="caption" color="text.secondary">STRATEGY HEALTH</Typography>
                            <Typography variant="caption" color={adxStats.avgAdxWin > adxStats.avgAdxLoss ? 'success.main' : 'error.main'}>
                                {adxStats.avgAdxWin > adxStats.avgAdxLoss ? 'OPTIMAL' : 'INVERTED'}
                            </Typography>
                        </Box>
                        <LinearProgress 
                            variant="determinate" 
                            value={Math.min((adxStats.avgAdxWin / (adxStats.avgAdxWin + adxStats.avgAdxLoss)) * 100, 100)} 
                            color={adxStats.avgAdxWin > adxStats.avgAdxLoss ? "success" : "error"}
                            sx={{ height: 6, borderRadius: 3 }}
                        />
                         <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', fontStyle: 'italic' }}>
                            *Winning trades should ideally have a higher ADX than losing trades.
                        </Typography>
                    </Box>
                </Stack>
            ) : (
                <EmptyState height={200} icon={<TrendingUp />} message="No data for ADX analysis" />
            )}
          </GlassCard>
        </Box>

        {/* Exit Breakdown */}
        <Box flex={1}>
          <GlassCard sx={{ p: 2, height: '100%' }}>
             <Box mb={2} display="flex" alignItems="center" gap={1}>
                <DonutLarge color="info" fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">EXIT STRATEGY BREAKDOWN</Typography>
            </Box>
            <Box height={250} display="flex" alignItems="center" justifyContent="center">
                {exitPieData.length > 0 ? (
                    <PieChart
                        series={[{
                            data: exitPieData,
                            innerRadius: 40,
                            paddingAngle: 2,
                            cornerRadius: 4
                        }]}
                        slotProps={{
                            legend: { 
                                direction: 'column', 
                                position: { vertical: 'middle', horizontal: 'right' },
                                labelStyle: { fill: theme.palette.text.secondary, fontSize: 11 }
                            }
                        }}
                    />
                ) : (
                    <EmptyState icon={<DonutLarge />} message="No trade exits recorded" />
                )}
            </Box>
          </GlassCard>
        </Box>
      </Box>

      {/* 4. Asset Table Row - FIXED COLOR LOGIC */}
      <Box width="100%">
          <GlassCard sx={{ p: 0, overflow: 'hidden' }}>
            <Box p={2} borderBottom={1} borderColor="divider" display="flex" alignItems="center" gap={1}>
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">ASSET PERFORMANCE</Typography>
            </Box>
            
            {Object.keys(assetStats).length > 0 ? (
                <TableContainer sx={{ maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <HeaderCell>Asset</HeaderCell>
                                <HeaderCell align="right">Trades</HeaderCell>
                                <HeaderCell align="right">Win Rate</HeaderCell>
                                <HeaderCell align="right">Net PnL</HeaderCell>
                                <HeaderCell align="right">Best Trade</HeaderCell>
                                <HeaderCell align="right">Worst Trade</HeaderCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {Object.entries(assetStats).map(([symbol, stats]) => {
                                const perf = stats.performance || {};
                                return (
                                    <TableRow key={symbol} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                        <StyledTableCell sx={{ fontWeight: 'bold' }}>
                                            {symbol.replace('USDT', '')}
                                        </StyledTableCell>
                                        <StyledTableCell align="right">
                                            {perf.totalTrades}
                                        </StyledTableCell>
                                        <StyledTableCell align="right">
                                            <Chip 
                                                label={`${perf.winRate?.toFixed(0)}%`} 
                                                size="small" 
                                                color={perf.winRate > 50 ? "success" : "default"}
                                                variant={perf.winRate > 50 ? "filled" : "outlined"}
                                                sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }}
                                            />
                                        </StyledTableCell>
                                        <StyledTableCell align="right" sx={{ color: perf.totalPnL >= 0 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                                            {perf.totalPnL >= 0 ? "+" : ""}{perf.totalPnL?.toFixed(2)}
                                        </StyledTableCell>
                                        
                                        {/* FIXED BEST TRADE COLOR */}
                                        <StyledTableCell align="right" sx={{ 
                                            color: perf.bestTrade >= 0 ? 'success.light' : 'error.light',
                                            fontWeight: 'bold' 
                                        }}>
                                            {perf.bestTrade > 0 ? "+" : ""}${perf.bestTrade?.toFixed(2)}
                                        </StyledTableCell>

                                        {/* FIXED WORST TRADE COLOR */}
                                        <StyledTableCell align="right" sx={{ 
                                            color: perf.worstTrade >= 0 ? 'success.light' : 'error.light',
                                            fontWeight: 'bold'
                                        }}>
                                            {perf.worstTrade > 0 ? "+" : ""}${perf.worstTrade?.toFixed(2)}
                                        </StyledTableCell>

                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            ) : (
                <EmptyState height={200} icon={<CalendarToday />} message="No asset data available" />
            )}
          </GlassCard>
      </Box>

    </Box>
  );
};

export default AnalyticsDashboard;