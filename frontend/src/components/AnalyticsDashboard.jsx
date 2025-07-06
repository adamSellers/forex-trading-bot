import React, { useState, useEffect } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Divider,
  Tooltip,
  useTheme
} from '@mui/material';
import {
  BarChart,
  pieArcLabelClasses,
  PieChart as MuiPieChart, // Renamed to avoid conflict
  LineChart
} from '@mui/x-charts';
import {
  TrendingUp,
  TrendingDown,
  ShowChart,
  Insights,
  QueryStats,
  CalendarToday
} from '@mui/icons-material'; 
import { PieChart } from 'recharts'; // Using recharts for more flexible pie charts
import { tradingAPI } from '../config/api';

const MetricCard = ({ title, value, subtitle, color = 'text.primary', icon }) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
    <CardContent>
      <Box display="flex" alignItems="center" mb={1}>
        {icon}
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {title}
        </Typography>
      </Box>
      <Typography variant="h5" fontWeight="bold" color={color}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {subtitle}
      </Typography>
    </CardContent>
  </Card>
);

const AnalyticsDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('7d');
  const theme = useTheme();

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        setError(null);
        // Fetch all data in parallel
        const [analyticsData, portfolioData, tradesData] = await Promise.all([
          tradingAPI.getAnalytics(period),
          tradingAPI.getPortfolio(),
          tradingAPI.getTrades({ limit: 1000 }) // Fetch enough for P&L chart
        ]);
        setAnalytics(analyticsData);
        setPortfolio(portfolioData);
        setTrades(tradesData);
      } catch (err) {
        setError(`Failed to load analytics: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [period]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '80vh' }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading Analytics...</Typography>
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>;
  }

  if (!analytics || !analytics.overview) {
    return <Alert severity="info" sx={{ m: 3 }}>No analytics data available for the selected period.</Alert>;
  }

  const { overview, assetAnalysis, timeAnalysis, strategyAnalysis } = analytics;
  const winRate = (overview.profitableTrades / (overview.totalTrades || 1)) * 100;

  // Prepare data for P&L over time chart
  const pnlChartData = trades
    .filter(t => t.side === 'SELL' && t.pnl !== null)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .reduce((acc, trade) => {
      const cumulativePnl = (acc.length > 0 ? acc[acc.length - 1].pnl : 0) + trade.pnl;
      acc.push({
        time: new Date(trade.timestamp).toLocaleDateString(),
        pnl: cumulativePnl,
      });
      return acc;
    }, []);

  // Prepare data for Exit Reason chart
  const exitReasonStats = portfolio?.enhancedPerformance?.detailed?.exitReasonStats || {};
  const exitReasonData = Object.entries(exitReasonStats)
    .filter(([_, data]) => data.count > 0)
    .map(([reason, data]) => ({
      name: reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: data.count,
      pnl: data.avgPnL
    }));

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Performance Analytics</Typography>
        <ToggleButtonGroup
          value={period}
          exclusive
          onChange={(e, newPeriod) => newPeriod && setPeriod(newPeriod)}
          size="small"
        >
          <ToggleButton value="1d">24 Hours</ToggleButton>
          <ToggleButton value="7d">7 Days</ToggleButton>
          <ToggleButton value="30d">30 Days</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* KPI Overview */}
      <Grid container spacing={3} mb={2}>
        <Grid xs={12} md={3}>
          <MetricCard
            title="Total P&L"
            value={`${overview.totalPnL >= 0 ? '+' : ''}${overview.totalPnL.toFixed(2)} USDT`}
            subtitle="Net Profit/Loss"
            color={overview.totalPnL >= 0 ? 'success.main' : 'error.main'}
            icon={<ShowChart color={overview.totalPnL >= 0 ? 'success' : 'error'} />}
          />
        </Grid>
        <Grid xs={12} md={3}>
          <MetricCard
            title="Win Rate"
            value={`${winRate.toFixed(1)}%`}
            subtitle={`${overview.profitableTrades} / ${overview.totalTrades} trades`}
            color={winRate >= 50 ? 'success.main' : 'warning.main'}
            icon={<Insights color={winRate >= 50 ? 'success' : 'warning'} />}
          />
        </Grid>
        <Grid xs={12} md={3}>
          <MetricCard
            title="Total Trades"
            value={overview.totalTrades}
            subtitle="Completed sell orders"
            icon={<QueryStats color="primary" />}
          />
        </Grid>
        <Grid xs={12} md={3}>
          <MetricCard
            title="Signal Conversion"
            value={`${(overview.signalToTradeRatio * 100).toFixed(1)}%`}
            subtitle={`${overview.totalSignals} signals generated`}
            icon={<TrendingUp color="secondary" />}
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Asset Performance */}
        <Grid xs={12} lg={7}>
          <Paper sx={{ p: 3, height: '100%', width: '100%', boxSizing: 'border-box' }}>
            <Typography variant="h6" gutterBottom>Asset Performance</Typography>
            <Grid container spacing={2}>
              {Object.entries(assetAnalysis).map(([asset, data]) => (
                <Grid xs={12} md={6} key={asset}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight="bold">{asset.replace('USDT', '')}</Typography>
                      <Divider sx={{ my: 1 }} />
                      <Box display="flex" justifyContent="space-between">
                        <Typography variant="body2">P&L:</Typography>
                        <Typography variant="body2" color={data.pnl >= 0 ? 'success.main' : 'error.main'}>
                          {data.pnl.toFixed(2)} USDT
                        </Typography>
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography variant="body2">Win Rate:</Typography>
                        <Typography variant="body2">{data.winRate.toFixed(1)}%</Typography>
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography variant="body2">Trades:</Typography>
                        <Typography variant="body2">{data.totalTrades}</Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>

        {/* Trading Activity by Hour */}
        <Grid xs={12} lg={5}>
          <Paper sx={{ p: 3, height: '100%', width: '100%', boxSizing: 'border-box' }}>
            <Typography variant="h6" gutterBottom>Trading Activity by Hour (UTC)</Typography>
            {timeAnalysis.hourlyDistribution.some(h => h.trades > 0 || h.signals > 0) ? (
              <Box sx={{ height: 300 }}>
                <BarChart
                  dataset={timeAnalysis.hourlyDistribution || []}
                  xAxis={[{ 
                    scaleType: 'band', 
                    dataKey: 'label', 
                    tickLabelStyle: { angle: -45, textAnchor: 'end', fontSize: 10 } 
                  }]}
                  series={[
                    { dataKey: 'trades', label: 'Trades', color: theme.palette.success.main },
                    { dataKey: 'signals', label: 'Signals', color: theme.palette.info.main }
                  ]}
                  // layout="vertical" // Switched to horizontal layout to fix crash
                  grid={{ horizontal: true }}
                />
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                <Typography color="text.secondary">No activity in this period.</Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Trading Activity by Day */}
        <Grid xs={12} lg={7}>
          <Paper sx={{ p: 3, width: '100%', boxSizing: 'border-box' }}>
            <Typography variant="h6" gutterBottom>Trading Activity by Day of Week</Typography>
            {timeAnalysis.dailyDistribution.some(d => d.trades > 0 || d.signals > 0) ? (
              <Box sx={{ height: 250 }}>
                <BarChart
                  dataset={timeAnalysis.dailyDistribution || []}
                  xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
                  series={[
                    { dataKey: 'trades', label: 'Trades', color: theme.palette.success.main },
                    { dataKey: 'signals', label: 'Signals', color: theme.palette.info.main }
                  ]}
                  grid={{ horizontal: true }}
                />
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={250}>
                <Typography color="text.secondary">No activity in this period.</Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* P&L Over Time */}
        <Grid xs={12} lg={5}>
          <Paper sx={{ p: 3, height: '100%', width: '100%', boxSizing: 'border-box' }}>
            <Typography variant="h6" gutterBottom>Cumulative P&L Over Time</Typography>
            {pnlChartData.length > 1 ? (
              <Box sx={{ height: 250 }}>
                <LineChart
                  dataset={pnlChartData}
                  xAxis={[{ scaleType: 'point', dataKey: 'time' }]}
                  series={[{ dataKey: 'pnl', label: 'Cumulative P&L', area: true, showMark: false }]}
                  grid={{ horizontal: true }}
                  sx={{
                    '& .MuiLineElement-root': {
                      stroke: '#8884d8',
                      strokeWidth: 2,
                    },
                    '& .MuiAreaElement-root': {
                      fill: 'url(#pnlGradient)',
                    },
                  }}
                >
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                </LineChart>
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={250}>
                <Typography color="text.secondary">Not enough trade data for P&L chart.</Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Exit Reason Analysis */}
        <Grid xs={12}>
          <Paper sx={{ p: 3, width: '100%', boxSizing: 'border-box' }}>
            <Typography variant="h6" gutterBottom>Exit Reason Analysis</Typography>
            {exitReasonData.length > 0 ? (
              <Box sx={{ height: 300 }}>
                 <MuiPieChart
                    series={[{ data: exitReasonData, arcLabel: (item) => `${item.name} (${item.value})` }]}
                    sx={{ [`& .${pieArcLabelClasses.root}`]: { fill: 'white', fontSize: 12 } }}
                 />
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                <Typography color="text.secondary">No exit data to analyze.</Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AnalyticsDashboard;