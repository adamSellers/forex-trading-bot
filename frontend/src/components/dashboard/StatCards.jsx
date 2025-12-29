import React from 'react';
import { Box, Typography, Avatar, alpha, useTheme } from '@mui/material';
import { AccountBalanceWallet, ShowChart, Bolt, History } from '@mui/icons-material';
import { GlassCard, MetricValue } from './Shared';

const StatCard = ({ title, value, subValue, icon, color }) => (
    <GlassCard elevation={0}>
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Box>
                    <Typography variant="overline" color="text.secondary" fontWeight="700" letterSpacing={1}>{title}</Typography>
                    <MetricValue variant="h5" sx={{ mt: 0.5 }}>{value}</MetricValue>
                </Box>
                <Avatar variant="rounded" sx={{ bgcolor: alpha(color, 0.1), color: color, width: 36, height: 36, border: `1px solid ${alpha(color, 0.2)}` }}>
                    {icon}
                </Avatar>
            </Box>
            {subValue && (
                <Box mt={1} display="flex" alignItems="center" gap={0.5}>
                    <Typography variant="caption" sx={{ color: subValue.includes('+') ? 'success.main' : subValue.includes('Flat') ? 'text.secondary' : 'error.main', fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {subValue}
                    </Typography>
                </Box>
            )}
        </Box>
    </GlassCard>
);

export const DashboardStats = ({ portfolio, calculatedDailyPnL, activeSignalsCount }) => {
    const theme = useTheme();
    return (
        <Box display="flex" gap={2} mb={2} flexShrink={0} sx={{ overflowX: 'auto', pb: 0.5 }}>
            <Box flex={1} minWidth={200}>
                <StatCard title="Total Equity" value={`$${(portfolio?.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} subValue={`${(portfolio?.usdtBalance || 0).toFixed(2)} USDT Available`} icon={<AccountBalanceWallet fontSize="small" />} color={theme.palette.primary.main} />
            </Box>
            <Box flex={1} minWidth={200}>
                <StatCard title="24h PnL" value={`$${calculatedDailyPnL.toFixed(2)}`} subValue={calculatedDailyPnL > 0 ? "+ Profit" : calculatedDailyPnL < 0 ? "- Loss" : "Flat"} icon={<ShowChart fontSize="small" />} color={calculatedDailyPnL >= 0 ? theme.palette.success.main : theme.palette.error.main} />
            </Box>
            <Box flex={1} minWidth={200}>
                <StatCard title="Active Positions" value={portfolio?.positions?.length || 0} subValue={`${activeSignalsCount} Signals Active`} icon={<Bolt fontSize="small" />} color={theme.palette.warning.main} />
            </Box>
            <Box flex={1} minWidth={200}>
                <StatCard title="Win Rate" value={`${(portfolio?.performance?.winRate || 0).toFixed(1)}%`} subValue={`${portfolio?.performance?.totalTrades || 0} Trades`} icon={<History fontSize="small" />} color={theme.palette.info.main} />
            </Box>
        </Box>
    );
};