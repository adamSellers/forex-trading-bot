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
  Tooltip
} from '@mui/material';
import {
  BarChart,
  PieChart,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('7d');

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await tradingAPI.getAnalytics(period);
        setAnalytics(data);
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

  const { overview, assetAnalysis, timeAnalysis } = analytics;
  const winRate = (overview.profitableTrades / (overview.totalTrades || 1)) * 100;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
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
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} md={3}>
          <MetricCard
            title="Total P&L"
            value={`${overview.totalPnL >= 0 ? '+' : ''}${overview.totalPnL.toFixed(2)} USDT`}
            subtitle="Net Profit/Loss"
            color={overview.totalPnL >= 0 ? 'success.main' : 'error.main'}
            icon={<ShowChart color={overview.totalPnL >= 0 ? 'success' : 'error'} />}
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricCard
            title="Win Rate"
            value={`${winRate.toFixed(1)}%`}
            subtitle={`${overview.profitableTrades} / ${overview.totalTrades} trades`}
            color={winRate >= 50 ? 'success.main' : 'warning.main'}
            icon={<Insights color={winRate >= 50 ? 'success' : 'warning'} />}
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <MetricCard
            title="Total Trades"
            value={overview.totalTrades}
            subtitle="Completed sell orders"
            icon={<QueryStats color="primary" />}
          />
        </Grid>
        <Grid item xs={12} md={3}>
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
        <Grid item xs={12} lg={7}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Asset Performance</Typography>
            <Grid container spacing={2}>
              {Object.entries(assetAnalysis).map(([asset, data]) => (
                <Grid item xs={12} md={6} key={asset}>
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
        <Grid item xs={12} lg={5}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Trading Activity by Hour (UTC)</Typography>
            {timeAnalysis.hourlyDistribution.some(h => h.count > 0) ? (
              <Box sx={{ height: 300 }}>
                <BarChart
                  dataset={timeAnalysis.hourlyDistribution}
                  xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
                  series={[{ dataKey: 'count', label: 'Trades & Signals' }]}
                  layout="vertical"
                  grid={{ vertical: true }}
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
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Trading Activity by Day of Week</Typography>
            {timeAnalysis.dailyDistribution.some(d => d.count > 0) ? (
              <Box sx={{ height: 250 }}>
                <BarChart
                  dataset={timeAnalysis.dailyDistribution}
                  xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
                  series={[{ dataKey: 'count', label: 'Trades & Signals' }]}
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
      </Grid>
    </Container>
  );
};

export default AnalyticsDashboard;