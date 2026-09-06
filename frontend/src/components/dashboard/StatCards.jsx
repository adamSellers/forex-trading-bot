import React from 'react';
import { Box, Typography, Avatar, alpha, useTheme } from '@mui/material';
import { AccountBalanceWallet, ShowChart, Bolt, History } from '@mui/icons-material';
import { GlassCard, MetricValue, formatCurrency } from './Shared';

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
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {subValue}
                    </Typography>
                </Box>
            )}
        </Box>
    </GlassCard>
);

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const money = (value) => finite(value) ? formatCurrency(Number(value)) : 'N/A';

export const DashboardStats = ({ portfolio, activeSignalsCount }) => {
    const theme = useTheme();

    // Forex uses AUD as base currency
    const totalEquity = portfolio?.totalValue;
    const marginAvailable = portfolio?.marginAvailable;
    const realizedPnl = portfolio?.realizedLast24hAud;

    return (
        <Box display="flex" gap={2} mb={2} flexShrink={0} sx={{ overflowX: 'auto', pb: 0.5 }}>
            <Box flex={1} minWidth={200}>
                <StatCard
                    title="Total Equity"
                    value={money(totalEquity)}
                    subValue={`${money(marginAvailable)} broker margin available`}
                    icon={<AccountBalanceWallet fontSize="small" />}
                    color={theme.palette.primary.main}
                />
            </Box>
            <Box flex={1} minWidth={200}>
                <StatCard
                    title="24h PnL"
                    value={money(realizedPnl)}
                    subValue="Realized net AUD · all live trades"
                    icon={<ShowChart fontSize="small" />}
                    color={!finite(realizedPnl) ? theme.palette.info.main : Number(realizedPnl) >= 0 ? theme.palette.success.main : theme.palette.error.main}
                />
            </Box>
            <Box flex={1} minWidth={200}>
                <StatCard
                    title="Active Positions"
                    value={Array.isArray(portfolio?.positions) ? portfolio.positions.length : 'N/A'}
                    subValue={finite(activeSignalsCount) ? `${activeSignalsCount} actionable signals` : 'Signal data unavailable'}
                    icon={<Bolt fontSize="small" />}
                    color={theme.palette.warning.main}
                />
            </Box>
            <Box flex={1} minWidth={200}>
                <StatCard
                    title="Win Rate · Current Run"
                    value={!finite(portfolio?.performance?.winRate) ? "N/A" : `${Number(portfolio.performance.winRate).toFixed(1)}%`}
                    subValue={portfolio?.performance ? `${portfolio.performance.totalTrades} closed trades` : "Statistics unavailable"}
                    icon={<History fontSize="small" />}
                    color={theme.palette.info.main}
                />
            </Box>
        </Box>
    );
};
