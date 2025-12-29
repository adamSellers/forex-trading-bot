import React from 'react';
import { Box, Typography, Avatar, Stack, Divider, LinearProgress, useTheme, alpha } from '@mui/material';
import { PieChart } from '@mui/x-charts';
import { ArrowDropUp, ArrowDropDown, TrendingUp, FilterAlt, DonutLarge } from '@mui/icons-material';
import { GlassCard, MetricValue, EmptyState } from './Shared';

// --- KPI CARD ---
export const KPICard = ({ title, value, subtitle, color = 'text.primary', icon }) => {
    const theme = useTheme();
    const isPositive = subtitle && subtitle.includes('+');
    return (
        <GlassCard elevation={0}>
            <Box p={3} display="flex" flexDirection="column" justifyContent="space-between" height="100%">
                <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                         <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>{title}</Typography>
                        <MetricValue variant="h4" sx={{ color: color, mt: 1 }}>{value}</MetricValue>
                    </Box>
                    <Avatar variant="rounded" sx={{ bgcolor: alpha(theme.palette[color.split('.')[0]].main, 0.1), color: theme.palette[color.split('.')[0]].main, border: `1px solid ${alpha(theme.palette[color.split('.')[0]].main, 0.2)}` }}>{icon}</Avatar>
                </Box>
                {subtitle && (
                    <Box mt={2} display="flex" alignItems="center" gap={0.5}>
                        {isPositive ? <ArrowDropUp color="success" fontSize="small" /> : <ArrowDropDown color="error" fontSize="small" />}
                        <Typography variant="body2" color="text.secondary" fontWeight="medium">{subtitle}</Typography>
                    </Box>
                )}
            </Box>
        </GlassCard>
    );
};

// --- SIGNAL QUALITY ---
export const SignalQualityWidget = ({ filterPieData }) => {
    const theme = useTheme();
    return (
        <GlassCard sx={{ p: 2 }}>
            <Box mb={2} display="flex" alignItems="center" gap={1}>
                <FilterAlt color="secondary" fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">SIGNAL FILTERING</Typography>
            </Box>
            <Box height={350} display="flex" alignItems="center" justifyContent="center">
                {filterPieData.length > 0 ? (
                    <PieChart
                        series={[{ data: filterPieData, innerRadius: 80, paddingAngle: 2, cornerRadius: 4, highlightScope: { faded: 'global', highlighted: 'item' } }]}
                        margin={{ right: 0, left: 0, top: 0, bottom: 80 }}
                        slotProps={{ legend: { direction: 'row', position: { vertical: 'bottom', horizontal: 'middle' }, padding: 0, labelStyle: { fill: theme.palette.text.secondary, fontSize: 11 } } }}
                        height={300}
                    />
                ) : (
                    <EmptyState icon={<FilterAlt />} message="No signals" />
                )}
            </Box>
        </GlassCard>
    );
};

// --- TREND ANALYSIS ---
export const TrendAnalysisWidget = ({ totalTrades, adxStats }) => (
    <GlassCard sx={{ p: 3, height: '100%' }}>
        <Box mb={2} display="flex" alignItems="center" gap={1}>
            <TrendingUp color="warning" fontSize="small" />
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">TREND STRENGTH ANALYSIS</Typography>
        </Box>
        {totalTrades > 0 ? (
            <Stack spacing={4} mt={2}>
                <Box display="flex" justifyContent="space-around" alignItems="center">
                    <Box textAlign="center">
                        <Typography variant="h3" color="success.main" fontWeight="900" sx={{ fontFamily: 'monospace' }}>{adxStats.avgAdxWin.toFixed(0)}</Typography>
                        <Typography variant="caption" fontWeight="bold" color="text.secondary">WINNER ADX</Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ height: 40, alignSelf: 'center' }} />
                    <Box textAlign="center">
                        <Typography variant="h3" color="error.main" fontWeight="900" sx={{ fontFamily: 'monospace' }}>{adxStats.avgAdxLoss.toFixed(0)}</Typography>
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
                </Box>
            </Stack>
        ) : (
            <EmptyState height={200} icon={<TrendingUp />} message="No data" />
        )}
    </GlassCard>
);

// --- EXIT ANALYSIS ---
export const ExitAnalysisWidget = ({ exitPieData }) => {
    const theme = useTheme();
    return (
        <GlassCard sx={{ p: 2, height: '100%' }}>
             <Box mb={2} display="flex" alignItems="center" gap={1}>
                <DonutLarge color="info" fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">EXIT STRATEGY BREAKDOWN</Typography>
            </Box>
            <Box height={250} display="flex" alignItems="center" justifyContent="center">
                {exitPieData.length > 0 ? (
                    <PieChart
                        series={[{ data: exitPieData, innerRadius: 40, paddingAngle: 2, cornerRadius: 4 }]}
                        slotProps={{ legend: { direction: 'column', position: { vertical: 'middle', horizontal: 'right' }, labelStyle: { fill: theme.palette.text.secondary, fontSize: 11 } } }}
                    />
                ) : (
                    <EmptyState icon={<DonutLarge />} message="No exits" />
                )}
            </Box>
        </GlassCard>
    );
};