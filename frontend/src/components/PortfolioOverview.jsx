// frontend/src/components/PortfolioOverview.jsx - LINT FIX (Removed unused prop)
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

// Removed 'systemStatus' from destructuring as it is no longer used
const PortfolioOverview = ({ account, prices, portfolio }) => {
  const TRADING_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'SHIB', 'SOL', 'DOT']; 

  const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const formatUSDT = (val) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0) + ' USDT';
  const formatPercent = (val) => `${(val || 0).toFixed(2)}%`;

  const calculateAssetValue = (balance) => {
    if (!balance || !prices) return 0;
    if (balance.asset === 'USDT') return parseFloat(balance.total);
    const symbol = `${balance.asset}USDT`;
    const price = prices[symbol]?.price || 0;
    return parseFloat(balance.total) * price;
  };

  const getTotalPortfolioValue = () => {
    if (!account?.balances) return 0;
    return account.balances
      .filter(balance => TRADING_ASSETS.includes(balance.asset) || balance.asset === 'USDT')
      .reduce((total, balance) => total + calculateAssetValue(balance), 0);
  };

  const getUSDTBalance = () => {
    if (!account?.balances) return 0;
    return parseFloat(account.balances.find(b => b.asset === 'USDT')?.total || 0);
  };

  const totalUnrealizedPnL = portfolio?.positions?.reduce((sum, pos) => sum + (pos.unrealizedPnL || 0), 0);

  return (
    <Paper sx={{ p: 3, boxSizing: 'border-box', height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h6">Portfolio Overview</Typography>
      </Box>

      <Alert severity="success" icon={<MonetizationOn />} sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight="bold">LIVE TRADING ACTIVE</Typography>
          <Typography variant="caption" display="block">The bot is executing trades on your Binance account.</Typography>
      </Alert>
      
      {/* Wallet Section */}
      <Box sx={{ width: '100%' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          <AccountBalance sx={{ mr: 1, verticalAlign: 'middle' }} />
          Binance Wallet
        </Typography>
        
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)' }} gap={2} sx={{ mb: 2 }}>
            <MetricCard title="Total Real Value" value={formatCurrency(getTotalPortfolioValue())} subtitle="Binance Assets" color="success.main" icon={<AccountBalance fontSize="small" color="success" />} />
            <MetricCard title="USDT Available" value={formatUSDT(getUSDTBalance())} subtitle="Dry Powder" color="primary.main" />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Bot Performance */}
        <Typography variant="h6" sx={{ mb: 2 }}>
          <TrendingUp sx={{ mr: 1, verticalAlign: 'middle', color: 'success.main' }} />
          Bot Performance
        </Typography>
        
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }} gap={2} sx={{ mb: 2 }}> 
            <MetricCard title="Realized P&L" value={`${portfolio?.totalPnL >= 0 ? '+' : ''}${formatUSDT(portfolio?.totalPnL || 0)}`} subtitle="Locked In" color={portfolio?.totalPnL >= 0 ? 'success.main' : 'error.main'} />
            <MetricCard title="Unrealized P&L" value={`${(totalUnrealizedPnL || 0) >= 0 ? '+' : ''}${formatUSDT(totalUnrealizedPnL || 0)}`} subtitle="Open Positions" color={(totalUnrealizedPnL || 0) >= 0 ? 'success.main' : 'error.main'} />
            <MetricCard title="Win Rate" value={formatPercent(portfolio?.performance?.winRate || 0)} subtitle="Success Ratio" color="text.primary" />
            <MetricCard title="Open Trades" value={portfolio?.positions?.length || 0} subtitle="Active" color="text.primary" />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Risk Status */}
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