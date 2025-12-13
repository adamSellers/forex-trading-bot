// frontend/src/components/AnalyticsDashboard.jsx - PRO ANALYTICS SUITE
import React, { useState, useEffect, useMemo } from 'react';
import {
  Grid, Typography, Box, CircularProgress, Alert,
  ToggleButtonGroup, ToggleButton, Divider, useTheme, Chip, Stack,
  Paper, styled, alpha, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, Avatar, LinearProgress
} from '@mui/material';
import {
  PieChart, LineChart
} from '@mui/x-charts';
import {
  TrendingUp, ShowChart, Insights, FilterAlt, MonetizationOn,
  DataUsage, DonutLarge, CalendarToday, ArrowDropUp, ArrowDropDown
} from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// --- STYLED COMPONENTS (Shared with TradingDashboard) ---
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
        { id: 3, value: signalStats.blockedOther, label: 'Wait/Hold', color: theme.palette.grey[800] },
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

  if (loading) return <Box minHeight="80vh" display="flex" alignItems="center" justifyContent="center"><CircularProgress /></Box>;
  if (error) return <Alert severity="error">Error loading analytics: {error}</Alert>;
  if (!metrics) return <Alert severity="info">No data available</Alert>;

  const { tradingStats, efficiency, pnlCurve, filterPieData, adxStats, exitPieData, assetStats } = metrics;
  
  // Chart Color Config
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

      {/* KPI Cards - Top Row */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Net Profit" 
            value={`$${tradingStats.totalPnL?.toFixed(2) || '0.00'}`} 
            subtitle={`${tradingStats.totalTrades || 0} Trades Executed`}
            color={tradingStats.totalPnL >= 0 ? 'success.main' : 'error.main'}
            icon={<ShowChart fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Win Rate" 
            value={`${tradingStats.winRate?.toFixed(1) || 0}%`} 
            subtitle={`Profit Factor: ${tradingStats.profitFactor?.toFixed(2) || 0}`}
            color={tradingStats.winRate > 50 ? 'success.main' : 'warning.main'}
            icon={<DataUsage fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Signal Efficiency" 
            value={efficiency.signalQuality || 'N/A'} 
            subtitle={`${efficiency.conversionRate || '0%'} Execution Rate`}
            color="info.main"
            icon={<FilterAlt fontSize="small" />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard 
            title="Avg. PnL" 
            value={`$${tradingStats.avgWin?.toFixed(2) || '0.00'}`} 
            subtitle={`Avg Loss: $${tradingStats.avgLoss?.toFixed(2) || '0.00'}`}
            color="warning.main"
            icon={<MonetizationOn fontSize="small" />}
          />
        </Grid>
      </Grid>

      {/* Main Charts Grid */}
      <Grid container spacing={2}>
        
        {/* Row 2: Growth Curve */}
        <Grid item xs={12} lg={8}>
          <GlassCard sx={{ p: 2, height: 420 }}>
            <Box mb={2} display="flex" alignItems="center" gap={1}>
                <ShowChart color="primary" fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">EQUITY CURVE</Typography>
            </Box>
            <Box flexGrow={1} minHeight={0} sx={{ width: '100%', height: '100%' }}>
                {pnlCurve.length > 1 ? (
                    <LineChart
                        dataset={pnlCurve}
                        xAxis={[{ 
                            dataKey: 'date', 
                            scaleType: 'time', 
                            valueFormatter: (date) => date.toLocaleDateString(),
                            tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 }
                        }]}
                        yAxis={[{
                            tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 }
                        }]}
                        series={[{ 
                            dataKey: 'pnl', 
                            area: true, 
                            color: theme.palette.primary.main, 
                            showMark: false,
                            curve: 'monotoneX' 
                        }]}
                        grid={{ horizontal: true }}
                        sx={chartAxisSx}
                    />
                ) : (
                    <EmptyState icon={<ShowChart />} message="Insufficient data to plot equity curve" />
                )}
            </Box>
          </GlassCard>
        </Grid>

        {/* Row 2b: Filter Efficiency */}
        <Grid item xs={12} lg={4}>
          <GlassCard sx={{ p: 2, height: 420 }}>
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
                    <EmptyState icon={<FilterAlt />} message="No signals generated in this period" />
                )}
            </Box>
          </GlassCard>
        </Grid>

        {/* Row 3: ADX & Exits */}
        <Grid item xs={12} md={6}>
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
        </Grid>

        <Grid item xs={12} md={6}>
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
        </Grid>

        {/* Row 4: Asset Breakdown (Replaced with Table) */}
        <Grid item xs={12}>
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
                                        <StyledTableCell align="right" sx={{ color: 'success.light' }}>
                                            +${perf.bestTrade?.toFixed(2)}
                                        </StyledTableCell>
                                         <StyledTableCell align="right" sx={{ color: 'error.light' }}>
                                            ${perf.worstTrade?.toFixed(2)}
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
        </Grid>

      </Grid>
    </Box>
  );
};

export default AnalyticsDashboard;