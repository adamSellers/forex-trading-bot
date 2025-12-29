import React, { useState } from 'react';
import { Box, Typography, IconButton, Tooltip, useTheme, alpha } from '@mui/material';
import { LineChart, BarChart } from '@mui/x-charts';
import { ShowChart, Timeline, BarChart as BarChartIcon } from '@mui/icons-material';
import { GlassCard, EmptyState, currencyFormatter } from './Shared';

const EquityChart = ({ pnlCurve, dailyPnL }) => {
    const [chartMode, setChartMode] = useState('cumulative');
    const theme = useTheme();

    const chartAxisSx = {
        '.MuiChartsAxis-tickLabel': { fill: theme.palette.text.secondary, fontFamily: 'monospace' },
        '.MuiChartsAxis-line': { stroke: alpha(theme.palette.divider, 0.5) },
        '.MuiChartsAxis-tick': { stroke: alpha(theme.palette.divider, 0.5) },
    };

    return (
        <GlassCard sx={{ p: 2 }}>
            <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center" gap={1}>
                    <ShowChart color="primary" fontSize="small" />
                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                        {chartMode === 'cumulative' ? 'NET EQUITY GROWTH ($)' : 'DAILY PnL ($)'}
                    </Typography>
                </Box>
                <Box display="flex" bgcolor={alpha(theme.palette.action.active, 0.05)} borderRadius={1} p={0.5}>
                    <Tooltip title="Cumulative Equity Line">
                        <IconButton size="small" color={chartMode === 'cumulative' ? 'primary' : 'default'} onClick={() => setChartMode('cumulative')}>
                            <Timeline fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Daily Profit/Loss Bars">
                        <IconButton size="small" color={chartMode === 'daily' ? 'primary' : 'default'} onClick={() => setChartMode('daily')}>
                            <BarChartIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>
            
            <Box height={350} width="100%">
                {pnlCurve.length > 0 ? (
                    chartMode === 'cumulative' ? (
                        <LineChart
                            dataset={pnlCurve}
                            xAxis={[{ dataKey: 'date', scaleType: 'time', valueFormatter: (date) => date.toLocaleDateString(), tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 } }]}
                            yAxis={[{ valueFormatter: currencyFormatter, tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 } }]}
                            series={[{ dataKey: 'pnl', area: false, color: theme.palette.primary.main, showMark: false, curve: 'linear', width: 2 }]}
                            grid={{ horizontal: true }} sx={chartAxisSx}
                        />
                    ) : (
                        <BarChart
                            dataset={dailyPnL}
                            xAxis={[{ scaleType: 'band', dataKey: 'date', tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 } }]}
                            yAxis={[{ valueFormatter: currencyFormatter, tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 } }]}
                            series={[{ dataKey: 'pnl', color: theme.palette.success.main, valueFormatter: (v) => `$${v?.toFixed(2)}` }]}
                            grid={{ horizontal: true }} sx={chartAxisSx}
                        />
                    )
                ) : (
                    <EmptyState icon={<ShowChart />} message="Insufficient data" />
                )}
            </Box>
        </GlassCard>
    );
};

export default EquityChart;