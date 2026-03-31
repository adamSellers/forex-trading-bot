// frontend/src/components/analytics/EquityChart.jsx - Forex Equity Chart
import React, { useState, useMemo } from 'react';
import { Box, Typography, IconButton, Tooltip, Chip, useTheme, alpha } from '@mui/material';
import { LineChart, BarChart } from '@mui/x-charts';
import { ShowChart, Timeline, BarChart as BarChartIcon } from '@mui/icons-material';
import { GlassCard, EmptyState, formatCurrency } from '../dashboard/Shared';

const EquityChart = ({ equityCurve, dailyPnL }) => {
  const [chartMode, setChartMode] = useState('cumulative');
  const theme = useTheme();

  // Process equity curve data for chart
  const processedEquityCurve = useMemo(() => {
    if (!equityCurve || equityCurve.length === 0) return [];
    return equityCurve.map((point) => ({
      ...point,
      date: new Date(point.timestamp || point.date),
      pnl: point.totalValueAud ?? point.balanceAud ?? point.pnlAud ?? point.pnl ?? 0,
    }));
  }, [equityCurve]);

  // Process daily P/L data for chart
  const processedDailyPnL = useMemo(() => {
    if (!dailyPnL || dailyPnL.length === 0) return [];
    return dailyPnL.map((day) => ({
      ...day,
      dateLabel: new Date(day.date).toLocaleDateString('en-AU', { 
        month: 'short', 
        day: 'numeric' 
      }),
      pnl: day.pnlAud ?? day.pnl ?? 0,
    }));
  }, [dailyPnL]);

  // Calculate summary stats
  const stats = useMemo(() => {
    if (processedEquityCurve.length === 0) return null;
    const lastPoint = processedEquityCurve[processedEquityCurve.length - 1];
    const maxPnL = Math.max(...processedEquityCurve.map((p) => p.pnl));
    const minPnL = Math.min(...processedEquityCurve.map((p) => p.pnl));
    const drawdown = maxPnL - lastPoint.pnl;
    
    return {
      currentPnL: lastPoint.pnl,
      maxPnL,
      minPnL,
      maxDrawdown: maxPnL > 0 ? drawdown : 0,
    };
  }, [processedEquityCurve]);

  // AUD currency formatter
  const audFormatter = (value) => {
    if (value === null || value === undefined) return '';
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}A$${value.toFixed(2)}`;
  };

  // Chart axis styling
  const chartAxisSx = {
    '.MuiChartsAxis-tickLabel': { 
      fill: theme.palette.text.secondary, 
      fontFamily: 'monospace',
      fontSize: 10,
    },
    '.MuiChartsAxis-line': { stroke: alpha(theme.palette.divider, 0.5) },
    '.MuiChartsAxis-tick': { stroke: alpha(theme.palette.divider, 0.5) },
  };

  const hasData = chartMode === 'cumulative' 
    ? processedEquityCurve.length > 0 
    : processedDailyPnL.length > 0;

  return (
    <GlassCard sx={{ p: 2, height: '100%' }}>
      {/* Header */}
      <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="center" gap={1}>
          <ShowChart color="primary" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            {chartMode === 'cumulative' ? 'EQUITY CURVE (AUD)' : 'DAILY P&L (AUD)'}
          </Typography>
          {stats && (
            <Chip
              label={audFormatter(stats.currentPnL)}
              size="small"
              color={stats.currentPnL >= 0 ? 'success' : 'error'}
              sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
            />
          )}
        </Box>

        {/* Chart Mode Toggle */}
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

      {/* Chart */}
      <Box height={320} width="100%">
        {hasData ? (
          chartMode === 'cumulative' ? (
            <LineChart
              dataset={processedEquityCurve}
              xAxis={[
                {
                  dataKey: 'date',
                  scaleType: 'time',
                  valueFormatter: (date) =>
                    date.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }),
                  tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 9 },
                },
              ]}
              yAxis={[
                {
                  valueFormatter: audFormatter,
                  tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 9 },
                },
              ]}
              series={[
                {
                  dataKey: 'pnl',
                  area: true,
                  color: stats?.currentPnL >= 0 ? theme.palette.success.main : theme.palette.error.main,
                  showMark: false,
                  curve: 'monotoneX',
                },
              ]}
              grid={{ horizontal: true }}
              sx={{
                ...chartAxisSx,
                '.MuiAreaElement-root': {
                  fillOpacity: 0.15,
                },
              }}
            />
          ) : (
            <BarChart
              dataset={processedDailyPnL}
              xAxis={[
                {
                  scaleType: 'band',
                  dataKey: 'dateLabel',
                  tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 9 },
                },
              ]}
              yAxis={[
                {
                  valueFormatter: audFormatter,
                  tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 9 },
                },
              ]}
              series={[
                {
                  dataKey: 'pnl',
                  valueFormatter: audFormatter,
                  color: theme.palette.primary.main,
                },
              ]}
              grid={{ horizontal: true }}
              sx={chartAxisSx}
            />
          )
        ) : (
          <EmptyState
            icon={<ShowChart sx={{ fontSize: 48 }} />}
            message="No equity data available"
            subMessage="Complete some trades to see your equity curve"
          />
        )}
      </Box>

      {/* Stats Footer */}
      {stats && chartMode === 'cumulative' && (
        <Box
          mt={2}
          pt={2}
          borderTop={1}
          borderColor="divider"
          display="flex"
          justifyContent="space-around"
        >
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              Peak
            </Typography>
            <Typography variant="body2" fontWeight="bold" color="success.main">
              {audFormatter(stats.maxPnL)}
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              Trough
            </Typography>
            <Typography variant="body2" fontWeight="bold" color="error.main">
              {audFormatter(stats.minPnL)}
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              Max Drawdown
            </Typography>
            <Typography variant="body2" fontWeight="bold" color="warning.main">
              A${stats.maxDrawdown.toFixed(2)}
            </Typography>
          </Box>
        </Box>
      )}
    </GlassCard>
  );
};

export default EquityChart;
