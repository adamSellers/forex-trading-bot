// frontend/src/components/PortfolioOverview.jsx - ENHANCED with Clear Status Indicators
import React from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  Chip,
  Alert,
  Divider
} from '@mui/material';
import {
  Psychology,
  AccountBalance,
  TrendingUp,
  Security,
  PlayArrow,
  Pause,
  DataUsage,
  CheckCircle,
  Warning,
  Info
} from '@mui/icons-material';

// Moved MetricCard outside the component for performance and clarity
const MetricCard = ({ title, value, subtitle, color = 'text.primary', icon }) => (
  <Card 
    variant="outlined" 
    sx={{
      height: '100%',
      width: '100%',
      minWidth: 0,
    }}
  >
    <CardContent sx={{
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100%',
      p: 2,
      '&:last-child': {
        pb: 2
      }
    }}>
      {icon && (
        <Box display="flex"
          justifyContent="center"
          mb={0.5}
        >
          {icon}
        </Box>
      )}
      <Typography 
        color="textSecondary" 
        gutterBottom 
        variant="body2" 
        sx={{ 
          fontWeight: 500,
          fontSize: '0.75rem',
          mb: 0.5
        }}
      >
        {title}
      </Typography>
      <Typography 
        variant="h6" 
        sx={{ 
          color, 
          fontWeight: 600, 
          mb: 0.25,
          fontSize: '1rem',
          lineHeight: 1.2,
          wordBreak: 'break-word'
        }}
      >
        {value}
      </Typography>
      {subtitle && (
        <Typography 
          variant="caption" 
          color="textSecondary"
          sx={{ fontSize: '0.7rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {subtitle}
        </Typography>
      )}
    </CardContent>
  </Card>
);

const PortfolioOverview = ({ account, prices, portfolio }) => {
  // Define our trading assets
  const TRADING_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'DOGE'];

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value || 0);
  };

  const formatUSDT = (value) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value || 0) + ' USDT';
  };

  const formatPercent = (value) => {
    return `${(value || 0).toFixed(2)}%`;
  };

  const calculateAssetValue = (balance, prices) => {
    if (!balance || !prices) return 0;
    if (balance.asset === 'USDT') return balance.total;
    const symbol = `${balance.asset}USDT`;
    const price = prices[symbol]?.price || 0;
    return balance.total * price;
  };

  const getTotalPortfolioValue = () => {
    if (!account?.balances || !prices) return 0;
    return account.balances
      .filter(balance => TRADING_ASSETS.includes(balance.asset))
      .reduce((total, balance) => total + calculateAssetValue(balance, prices), 0);
  };

  const getUSDTBalance = () => {
    if (!account?.balances) return 0;
    const usdtBalance = account.balances.find(b => b.asset === 'USDT');
    return usdtBalance?.total || 0;
  };

  const getCryptoValue = () => {
    if (!account?.balances || !prices) return 0;
    return account.balances
      .filter(balance => TRADING_ASSETS.includes(balance.asset) && balance.asset !== 'USDT')
      .reduce((total, balance) => total + calculateAssetValue(balance, prices), 0);
  };

  const getAssetAllocation = () => {
    const totalValue = getTotalPortfolioValue();
    if (totalValue === 0) return { usdt: 100, crypto: 0 };
    
    const usdtValue = getUSDTBalance();
    const cryptoValue = getCryptoValue();
    
    return {
      usdt: (usdtValue / totalValue) * 100,
      crypto: (cryptoValue / totalValue) * 100
    };
  };

  const totalUnrealizedPnL = portfolio?.positions?.reduce(
    (sum, pos) => sum + (pos.unrealizedPnL || 0),
    0
  );

  const allocation = getAssetAllocation();

  // Enhanced system status determination
  const getSystemStatus = () => {
    const hasAccountData = account && !account.error;
    const paperTradingActive = portfolio?.riskStatus && !portfolio.riskStatus.isHalted;
    
    return {
      marketData: hasAccountData ? 'live' : 'fallback',
      paperTrading: paperTradingActive ? 'active' : 'inactive',
      realTrading: 'disabled', // Always disabled for safety
      dataMode: hasAccountData ? 'Live Binance API' : 'Fallback Data'
    };
  };

  const systemStatus = getSystemStatus();

  return (
    <Paper sx={{ p: 3, boxSizing: 'border-box' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h6">
          Portfolio Overview
        </Typography>
        
        {/* Enhanced Status Indicators */}
        <Box display="flex" gap={1} flexWrap="wrap">
          <Chip 
            size="small" 
            icon={<DataUsage />}
            label={systemStatus.dataMode}
            color={systemStatus.marketData === 'live' ? 'success' : 'warning'}
            variant="outlined"
          />
          <Chip 
            size="small" 
            icon={<Psychology />}
            label={`Paper Trading: ${systemStatus.paperTrading === 'active' ? 'Active' : 'Inactive'}`}
            color={systemStatus.paperTrading === 'active' ? 'warning' : 'default'}
            variant="outlined"
          />
          <Chip 
            size="small" 
            icon={<Security />}
            label="Live Trading: Disabled"
            color="error"
            variant="outlined"
          />
        </Box>
      </Box>

      {/* System Status Alert */}
      <Alert 
        severity={systemStatus.marketData === 'live' ? 'success' : 'warning'} 
        sx={{ mb: 2 }}
        icon={systemStatus.marketData === 'live' ? <CheckCircle /> : <Warning />}
      >
        <Box>
          <Typography variant="body2" fontWeight="bold">
            System Status: {systemStatus.marketData === 'live' ? 'Fully Operational' : 'Operating with Fallback Data'}
          </Typography>
          <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
            • <strong>Market Data:</strong> {systemStatus.dataMode} • 
            <strong> Paper Trading:</strong> {systemStatus.paperTrading === 'active' ? 'Simulating trades with virtual $5,000' : 'Inactive'} • 
            <strong> Real Trading:</strong> Safely disabled - no real orders will be placed
          </Typography>
        </Box>
      </Alert>
      
      {/* Portfolio Value Section */}
      <Box sx={{ width: '100%' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          <AccountBalance sx={{ mr: 1, verticalAlign: 'middle' }} />
          Real Portfolio Value
        </Typography>
        
        <Grid container spacing={1} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Total Real Value"
              value={formatCurrency(getTotalPortfolioValue())}
              subtitle="From Binance Account"
              color="success.main"
              icon={<AccountBalance fontSize="small" color="success" />}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="USDT Balance"
              value={formatUSDT(getUSDTBalance())}
              subtitle="Available Cash"
              color="primary.main"
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Crypto Value"
              value={formatCurrency(getCryptoValue())}
              subtitle="Holdings Value"
              color="info.main"
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Cash Allocation"
              value={formatPercent(allocation.usdt)}
              subtitle={`${formatPercent(allocation.crypto)} Crypto`}
              color="text.primary"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* Paper Trading Section */}
        <Typography variant="h6" sx={{ mb: 2 }}>
          <Psychology sx={{ mr: 1, verticalAlign: 'middle' }} />
          Paper Trading Performance
        </Typography>
        
        <Grid container spacing={1} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={4} md={2.4} lg={2.4}>
            <MetricCard
              title="Virtual Portfolio"
              value={formatCurrency(portfolio?.totalValue || 5000)}
              subtitle="Simulated Trading"
              color="warning.main"
              icon={<Psychology fontSize="small" color="warning" />}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2.4} lg={2.4}>
            <MetricCard
              title="Virtual P&L"
              value={`${portfolio?.totalPnL >= 0 ? '+' : ''}${formatUSDT(portfolio?.totalPnL || 0)}`}
              subtitle={`${formatPercent(portfolio?.totalPnLPercent || 0)} Return`}
              color={portfolio?.totalPnL >= 0 ? 'success.main' : 'error.main'}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2.4} lg={2.4}>
            <MetricCard
              title="Unrealized P&L"
              value={`${totalUnrealizedPnL >= 0 ? '+' : ''}${formatUSDT(totalUnrealizedPnL || 0)}`}
              subtitle="From open positions"
              color={totalUnrealizedPnL >= 0 ? 'success.main' : 'error.main'}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2.4} lg={2.4}>
            <MetricCard
              title="Virtual Positions"
              value={portfolio?.positionCount || 0}
              subtitle="Open Positions"
              color="warning.main"
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2.4} lg={2.4}>
            <MetricCard
              title="Paper Win Rate"
              value={formatPercent(portfolio?.performance?.winRate || 0)}
              subtitle="Successful Trades"
              color={portfolio?.performance?.winRate > 50 ? 'success.main' : 'text.primary'}
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* Risk Management Section */}
        <Typography variant="h6" sx={{ mb: 2 }}>
          <Security sx={{ mr: 1, verticalAlign: 'middle' }} />
          Risk Management Status
        </Typography>
        
        <Grid container spacing={1} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Daily Risk Used"
              value={`${formatUSDT(portfolio?.riskStatus?.dailyLossUsed || 0)}`}
              subtitle={`/ ${formatUSDT(portfolio?.riskStatus?.dailyLossLimit || 100)}`}
              color={portfolio?.riskStatus?.dailyLossUsed > (portfolio?.riskStatus?.dailyLossLimit * 0.8) ? 'error.main' : 'success.main'}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Weekly Risk Used"
              value={`${formatUSDT(portfolio?.riskStatus?.weeklyLossUsed || 0)}`}
              subtitle={`/ ${formatUSDT(portfolio?.riskStatus?.weeklyLossLimit || 250)}`}
              color={portfolio?.riskStatus?.weeklyLossUsed > (portfolio?.riskStatus?.weeklyLossLimit * 0.8) ? 'error.main' : 'success.main'}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Max Drawdown"
              value={formatPercent(portfolio?.performance?.maxDrawdown || 0)}
              subtitle="Peak to Trough"
              color={portfolio?.performance?.maxDrawdown > 15 ? 'error.main' : 'success.main'}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <Card 
              variant="outlined" 
              sx={{ 
                height: 100,
                display: 'flex', 
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 0
              }}
            >
              <CardContent sx={{ 
                width: '100%', 
                textAlign: 'center', 
                py: 1.5,
                px: 1,
                '&:last-child': { pb: 1.5 }
              }}>
                <Box display="flex" justifyContent="center" mb={0.5}>
                  {portfolio?.riskStatus?.isHalted ? 
                    <Pause fontSize="small" color="error" /> : 
                    <PlayArrow fontSize="small" color="success" />
                  }
                </Box>
                <Typography 
                  color="textSecondary" 
                  gutterBottom 
                  variant="body2" 
                  sx={{ 
                    fontWeight: 500,
                    fontSize: '0.75rem',
                    mb: 0.5
                  }}
                >
                  Trading Status
                </Typography>
                <Chip
                  label={portfolio?.riskStatus?.isHalted ? 'HALTED' : 'ACTIVE'}
                  color={portfolio?.riskStatus?.isHalted ? 'error' : 'success'}
                  size="small"
                  sx={{ mb: 0.5 }}
                />
                {portfolio?.riskStatus?.haltReason && (
                  <Typography 
                    variant="caption" 
                    color="error" 
                    sx={{ 
                      display: 'block',
                      fontSize: '0.7rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {portfolio.riskStatus.haltReason}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Performance Metrics */}
        <Grid container spacing={1} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Profit Factor"
              value={portfolio?.performance?.profitFactor?.toFixed(2) || '0.00'}
              subtitle="Gross Profit/Loss"
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Sharpe Ratio"
              value={portfolio?.performance?.sharpeRatio?.toFixed(2) || '0.00'}
              subtitle="Risk-Adj Return"
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Avg Win"
              value={formatUSDT(portfolio?.performance?.avgWin || 0)}
              subtitle="Per Winning Trade"
              color="success.main"
            />
          </Grid>
          <Grid item xs={6} sm={4} md={3} lg={3}>
            <MetricCard
              title="Avg Loss"
              value={formatUSDT(portfolio?.performance?.avgLoss || 0)}
              subtitle="Per Losing Trade"
              color="error.main"
            />
          </Grid>
        </Grid>

        {/* Enhanced Account Status */}
        <Box display="flex" justifyContent="center" mt={2}>
          <Card variant="outlined" sx={{ px: 3, py: 1.5, backgroundColor: 'action.hover', width: '100%' }}>
            <Grid container spacing={2} alignItems="center" justifyContent="center">
              <Grid item>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" justifyContent="center">
                  <AccountBalance color="success" />
                  <Typography variant="body2" fontWeight="bold">
                    Real Account: {account?.accountType || 'SPOT'}
                  </Typography>
                  <Chip 
                    size="small" 
                    label={account?.canTrade ? 'Trading Enabled' : 'Read-Only'} 
                    color={account?.canTrade ? 'warning' : 'success'}
                    variant="outlined"
                  />
                </Box>
              </Grid>
              <Grid item sx={{ display: { xs: 'none', md: 'block' } }}>
                <Divider orientation="vertical" flexItem />
              </Grid>
              <Grid item>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" justifyContent="center">
                  <Psychology color="warning" />
                  <Typography variant="body2" fontWeight="bold">
                    Paper Mode: Virtual Trading
                  </Typography>
                  <Chip 
                    size="small" 
                    label="No Real Money Risk" 
                    color="success"
                    variant="outlined"
                  />
                </Box>
              </Grid>
              <Grid item sx={{ display: { xs: 'none', md: 'block' } }}>
                <Divider orientation="vertical" flexItem />
              </Grid>
              <Grid item>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" justifyContent="center">
                  <DataUsage color="info" />
                  <Typography variant="body2" fontWeight="bold">
                    Data: {systemStatus.dataMode}
                  </Typography>
                  <Chip 
                    size="small" 
                    label="Live Prices" 
                    color="info"
                    variant="outlined"
                  />
                </Box>
              </Grid>
            </Grid>
          </Card>
        </Box>
      </Box>
    </Paper>
  );
};

export default PortfolioOverview;