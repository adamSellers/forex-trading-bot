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
  MonetizationOn,
  Security, // Keep for risk
  PlayArrow,
  Pause,
  Cloud,
  CloudOff,
  MoneyOff,
  CheckCircle,
  Warning,
  Info, // Keep for info
  DataUsage
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
    const isLiveMode = portfolio?.mode === 'live'; // Assuming portfolio indicates mode

    return {
      marketData: hasAccountData ? 'Live' : 'Fallback',
      tradingMode: isLiveMode ? 'Live' : 'Paper',
      tradingStatus: paperTradingActive ? 'Active' : 'Inactive',
    };
  };

  const systemStatus = getSystemStatus();
  const isLiveMode = portfolio?.mode === 'live';

  return (
    <Paper sx={{ p: 3, boxSizing: 'border-box', height: '100%', width: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h6">
          Portfolio Overview
        </Typography>
        
        {/* Enhanced Status Indicators */}
        <Box display="flex" gap={1} flexWrap="wrap" sx={{ display: { xs: 'none', md: 'flex' } }}>
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
      {systemStatus.tradingMode === 'Live' ? (
        <Alert severity="info" icon={<MonetizationOn />} sx={{ mb: 2, backgroundColor: 'success.dark' }}>
          <Typography variant="body2" fontWeight="bold">
            LIVE TRADING IS ACTIVE
          </Typography>
          <Typography variant="caption" display="block">
            The bot is executing trades with real funds on your Binance account.
          </Typography>
        </Alert>
      ) : (
        <Alert severity="warning" icon={<Psychology />} sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight="bold">
            PAPER TRADING MODE
          </Typography>
          <Typography variant="caption" display="block">
            The system is in simulation mode. No real funds are at risk.
          </Typography>
        </Alert>
      )}
      
      {/* Portfolio Value Section */}
      <Box sx={{ width: '100%' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          <AccountBalance sx={{ mr: 1, verticalAlign: 'middle' }} />
          Real Portfolio Value
        </Typography>
        
        <Box
          display="grid"
          gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }}
          gap={2}
          sx={{ mb: 2 }}
        >
            <MetricCard
              title="Total Real Value"
              value={formatCurrency(getTotalPortfolioValue())}
              subtitle="From Binance Account"
              color="success.main"
              icon={<AccountBalance fontSize="small" color="success" />}
            />
            <MetricCard
              title="USDT Balance"
              value={formatUSDT(getUSDTBalance())}
              subtitle="Available Cash"
              color="primary.main"
            />
            <MetricCard
              title="Crypto Value"
              value={formatCurrency(getCryptoValue())}
              subtitle="Holdings Value"
              color="info.main"
            />
            <MetricCard
              title="Cash Allocation"
              value={formatPercent(allocation.usdt)}
              subtitle={`${formatPercent(allocation.crypto)} Crypto`}
              color="text.primary"
            />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Paper Trading Section */}
        <Typography variant="h6" sx={{ mb: 2 }}>
          {isLiveMode 
            ? <TrendingUp sx={{ mr: 1, verticalAlign: 'middle', color: 'success.main' }} /> 
            : <Psychology sx={{ mr: 1, verticalAlign: 'middle', color: 'warning.main' }} />
          }
          {isLiveMode ? 'Live Trading Performance' : 'Paper Trading Performance'}
        </Typography>
        
        <Box
          display="grid"
          gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(5, 1fr)' }}
          gap={2}
          sx={{ mb: 2 }}
        > 
            <MetricCard
              title={isLiveMode ? "Live Portfolio" : "Virtual Portfolio"}
              value={formatCurrency(portfolio?.totalValue || 5000)}
              subtitle={isLiveMode ? "Live Account Value" : "Simulated Trading"}
              color={isLiveMode ? "success.main" : "warning.main"}
              icon={isLiveMode ? <AccountBalance fontSize="small" color="success" /> : <Psychology fontSize="small" color="warning" />}
            />
            <MetricCard
              title={isLiveMode ? "Realized P&L" : "Virtual P&L"}
              value={`${portfolio?.totalPnL >= 0 ? '+' : ''}${formatUSDT(portfolio?.totalPnL || 0)}`}
              subtitle={`${formatPercent(portfolio?.totalPnLPercent || 0)} Return`}
              color={portfolio?.totalPnL >= 0 ? 'success.main' : 'error.main'}
            />
            <MetricCard
              title="Unrealized P&L"
              value={`${(totalUnrealizedPnL || 0) >= 0 ? '+' : ''}${formatUSDT(totalUnrealizedPnL || 0)}`}
              subtitle="From open positions"
              color={(totalUnrealizedPnL || 0) >= 0 ? 'success.main' : 'error.main'}
            />
            <MetricCard
              title={isLiveMode ? "Live Positions" : "Virtual Positions"}
              value={portfolio?.positionCount || 0}
              subtitle="Open Positions"
              color={isLiveMode ? "success.main" : "warning.main"}
            />
            <MetricCard
              title="Win Rate"
              value={formatPercent(portfolio?.performance?.winRate || 0)}
              subtitle="Successful Trades"
              color={portfolio?.performance?.winRate > 50 ? 'success.main' : 'text.primary'}
            />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Risk Management Section */}
        <Typography variant="h6" sx={{ mb: 2 }}>
          <Security sx={{ mr: 1, verticalAlign: 'middle' }} />
          Risk Management Status
        </Typography>
        
        <Box
          display="grid"
          gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }}
          gap={2}
          sx={{ mb: 2 }}
        >
            <MetricCard
              title="Daily Risk Used"
              value={`${formatUSDT(portfolio?.riskStatus?.dailyLossUsed || 0)}`}
              subtitle={`/ ${formatUSDT(portfolio?.riskStatus?.dailyLossLimit || 100)}`}
              color={portfolio?.riskStatus?.dailyLossUsed > (portfolio?.riskStatus?.dailyLossLimit * 0.8) ? 'error.main' : 'success.main'}
            />
            <MetricCard
              title="Weekly Risk Used"
              value={`${formatUSDT(portfolio?.riskStatus?.weeklyLossUsed || 0)}`}
              subtitle={`/ ${formatUSDT(portfolio?.riskStatus?.weeklyLossLimit || 250)}`}
              color={portfolio?.riskStatus?.weeklyLossUsed > (portfolio?.riskStatus?.weeklyLossLimit * 0.8) ? 'error.main' : 'success.main'}
            />
            <MetricCard
              title="Max Drawdown"
              value={formatPercent(portfolio?.performance?.maxDrawdown || 0)}
              subtitle="Peak to Trough"
              color={portfolio?.performance?.maxDrawdown > 15 ? 'error.main' : 'success.main'}
            />
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
        </Box>

        {/* Performance Metrics */}
        <Box
          display="grid"
          gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }}
          gap={2}
          sx={{ mb: 2 }}
        >
            <MetricCard
              title="Profit Factor"
              value={portfolio?.performance?.profitFactor?.toFixed(2) || '0.00'}
              subtitle="Gross Profit/Loss"
            />
            <MetricCard
              title="Sharpe Ratio"
              value={portfolio?.performance?.sharpeRatio?.toFixed(2) || '0.00'}
              subtitle="Risk-Adj Return"
            />
            <MetricCard
              title="Avg Win"
              value={formatUSDT(portfolio?.performance?.avgWin || 0)}
              subtitle="Per Winning Trade"
              color="success.main"
            />
            <MetricCard
              title="Avg Loss"
              value={formatUSDT(portfolio?.performance?.avgLoss || 0)}
              subtitle="Per Losing Trade"
              color="error.main"
            />
        </Box>

        {/* Enhanced Account Status */}
        <Box display="flex" justifyContent="center" mt={2}>
          <Card variant="outlined" sx={{ px: 3, py: 1.5, backgroundColor: 'action.hover', width: '100%' }}>
            <Box 
              display="grid"
              gridTemplateColumns={{ xs: '1fr', md: '1fr auto 1fr auto 1fr' }}
              gap={2}
              alignItems="center"
            >
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
              <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
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
              <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
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
            </Box>
          </Card>
        </Box>
      </Box>
    </Paper>
  );
};

export default PortfolioOverview;