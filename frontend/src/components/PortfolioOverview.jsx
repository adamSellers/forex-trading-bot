import React from 'react';
import { Box, Paper, Typography, Card, CardContent, Chip, Alert, Divider } from '@mui/material';
import {
  AccountBalance, TrendingUp, MonetizationOn, Security, PlayArrow, Pause
} from '@mui/icons-material';

const MetricCard = ({ title, value, subtitle, color = 'text.primary', icon }) => (
  <Card variant="outlined" sx={{ height: '100%', width: '100%', minWidth: 0 }}>
    <CardContent sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', p: 2, '&:last-child': { pb: 2 } }}>
      {icon && <Box display="flex" justifyContent="center" mb={0.5}>{icon}</Box>}
      <Typography color="textSecondary" gutterBottom variant="body2" sx={{ fontWeight: 500, fontSize: '0.75rem', mb: 0.5 }}>{title}</Typography>
      <Typography variant="h6" sx={{ color, fontWeight: 600, mb: 0.25, fontSize: '1rem', lineHeight: 1.2, wordBreak: 'break-word' }}>{value}</Typography>
      {subtitle && <Typography variant="caption" color="textSecondary" sx={{ fontSize: '0.7rem' }}>{subtitle}</Typography>}
    </CardContent>
  </Card>
);

const PortfolioOverview = ({ account, portfolio }) => {
  const accountCurrency = account?.currency || 'AUD';

  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: accountCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val || 0);

  const formatPercent = (val) => `${(val || 0).toFixed(2)}%`;

  const totalValue = portfolio?.totalValue || account?.balance || 0;
  const cashBalance = account?.marginAvailable || account?.balance || 0;
  const totalUnrealizedPnL = portfolio?.positions?.reduce((sum, pos) => sum + (pos.unrealizedPL || pos.unrealizedPnL || 0), 0) || 0;

  return (
    <Paper sx={{ p: 3, boxSizing: 'border-box', height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h6">Portfolio Overview</Typography>
      </Box>

      <Alert severity="success" icon={<MonetizationOn />} sx={{ mb: 2 }}>
        <Typography variant="body2" fontWeight="bold">LIVE TRADING ACTIVE</Typography>
        <Typography variant="caption" display="block">The bot is executing trades on your Oanda account.</Typography>
      </Alert>

      <Box sx={{ width: '100%' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          <AccountBalance sx={{ mr: 1, verticalAlign: 'middle' }} />
          Account Snapshot
        </Typography>

        <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)' }} gap={2} sx={{ mb: 2 }}>
          <MetricCard title="Total Equity" value={formatCurrency(totalValue)} subtitle="Net Asset Value" color="success.main" icon={<AccountBalance fontSize="small" color="success" />} />
          <MetricCard title="Available Margin" value={formatCurrency(cashBalance)} subtitle="Capacity" color="primary.main" />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="h6" sx={{ mb: 2 }}>
          <TrendingUp sx={{ mr: 1, verticalAlign: 'middle', color: 'success.main' }} />
          Bot Performance
        </Typography>

        <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }} gap={2} sx={{ mb: 2 }}>
          <MetricCard title="Realized P&L" value={`${(portfolio?.realizedPnL || 0) >= 0 ? '+' : ''}${formatCurrency(portfolio?.realizedPnL || account?.pl || 0)}`} subtitle="Locked In" color={(portfolio?.realizedPnL || account?.pl || 0) >= 0 ? 'success.main' : 'error.main'} />
          <MetricCard title="Unrealized P&L" value={`${totalUnrealizedPnL >= 0 ? '+' : ''}${formatCurrency(totalUnrealizedPnL)}`} subtitle="Open Positions" color={totalUnrealizedPnL >= 0 ? 'success.main' : 'error.main'} />
          <MetricCard title="Win Rate" value={formatPercent(portfolio?.performance?.winRate || 0)} subtitle="Success Ratio" color="text.primary" />
          <MetricCard title="Open Trades" value={portfolio?.positions?.length || account?.openTrades || 0} subtitle="Active" color="text.primary" />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="h6" sx={{ mb: 2 }}>
          <Security sx={{ mr: 1, verticalAlign: 'middle' }} />
          Risk Status
        </Typography>

        <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)' }} gap={2} sx={{ mb: 2 }}>
          <MetricCard title="Max Drawdown" value={formatPercent(portfolio?.performance?.maxDrawdown || 0)} subtitle="Peak Risk" color="error.main" />

          <Card variant="outlined" sx={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
              <Box display="flex" justifyContent="center" mb={0.5}>
                {portfolio?.riskStatus?.isHalted ? <Pause fontSize="small" color="error" /> : <PlayArrow fontSize="small" color="success" />}
              </Box>
              <Typography color="textSecondary" gutterBottom variant="body2" sx={{ fontWeight: 500, fontSize: '0.75rem', mb: 0.5 }}>Status</Typography>
              <Chip label={portfolio?.riskStatus?.isHalted ? 'HALTED' : 'ACTIVE'} color={portfolio?.riskStatus?.isHalted ? 'error' : 'success'} size="small" />
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Paper>
  );
};

export default PortfolioOverview;
