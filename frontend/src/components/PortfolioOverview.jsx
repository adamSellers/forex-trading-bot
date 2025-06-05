// frontend/src/components/PortfolioOverview.jsx - FIXED Grid Layout
import React from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  Chip
} from '@mui/material';

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

  const allocation = getAssetAllocation();

  // Metric Card Component for consistent styling
  const MetricCard = ({ title, value, subtitle, color = 'text.primary' }) => (
    <Card 
      variant="outlined" 
      sx={{ 
        height: 100,
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 0 // CRITICAL: Allow flexbox to shrink
      }}
    >
      <CardContent sx={{ 
        width: '100%', 
        textAlign: 'center', 
        py: 1.5,
        px: 1,
        '&:last-child': { pb: 1.5 }
      }}>
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
            wordBreak: 'break-word' // Handle long numbers
          }}
        >
          {value}
        </Typography>
        {subtitle && (
          <Typography 
            variant="caption" 
            color="textSecondary"
            sx={{ 
              fontSize: '0.7rem',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" mb={3}>
        <Typography variant="h6">
          Portfolio Overview
        </Typography>
        <Chip size="small" label="Live Binance Testnet" color="primary" sx={{ ml: 2 }} />
      </Box>
      
      {/* FIXED: Grid Container with proper width control */}
      <Box sx={{ width: '100%' }}>
        {/* Row 1: Main Portfolio Metrics */}
        <Grid container spacing={1} sx={{ mb: 1 }}>
          <Grid item xs={3}>
            <MetricCard
              title="Total Value"
              value={formatCurrency(getTotalPortfolioValue())}
              subtitle={portfolio?.totalPnL >= 0 ? `+${formatUSDT(portfolio?.totalPnL || 0)}` : formatUSDT(portfolio?.totalPnL || 0)}
              color={portfolio?.totalPnL >= 0 ? 'success.main' : 'error.main'}
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="USDT Balance"
              value={formatUSDT(getUSDTBalance())}
              subtitle="Available Cash"
              color="primary.main"
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Crypto Value"
              value={formatCurrency(getCryptoValue())}
              subtitle="Holdings Value"
              color="warning.main"
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Total Return"
              value={formatPercent(portfolio?.totalPnLPercent)}
              subtitle="Since Start"
              color={portfolio?.totalPnLPercent >= 0 ? 'success.main' : 'error.main'}
            />
          </Grid>
        </Grid>

        {/* Row 2: Risk Management */}
        <Typography variant="h6" sx={{ mb: 1, mt: 2 }}>
          Risk Management Status
        </Typography>
        <Grid container spacing={1} sx={{ mb: 1 }}>
          <Grid item xs={3}>
            <MetricCard
              title="Daily Loss Used"
              value={`${formatUSDT(portfolio?.riskStatus?.dailyLossUsed)}`}
              subtitle={`/ ${formatUSDT(portfolio?.riskStatus?.dailyLossLimit)}`}
              color={portfolio?.riskStatus?.dailyLossUsed > portfolio?.riskStatus?.dailyLossLimit * 0.8 ? 'error.main' : 'success.main'}
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Weekly Loss Used"
              value={`${formatUSDT(portfolio?.riskStatus?.weeklyLossUsed)}`}
              subtitle={`/ ${formatUSDT(portfolio?.riskStatus?.weeklyLossLimit)}`}
              color={portfolio?.riskStatus?.weeklyLossUsed > portfolio?.riskStatus?.weeklyLossLimit * 0.8 ? 'error.main' : 'success.main'}
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Max Drawdown"
              value={formatPercent(portfolio?.performance?.maxDrawdown)}
              subtitle="Peak to Trough"
              color={portfolio?.performance?.maxDrawdown > 15 ? 'error.main' : 'warning.main'}
            />
          </Grid>
          <Grid item xs={3}>
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

        {/* Row 3: Performance Metrics */}
        <Grid container spacing={1} sx={{ mb: 1 }}>
          <Grid item xs={3}>
            <MetricCard
              title="Active Positions"
              value={portfolio?.positionCount || 0}
              subtitle="Open Trades"
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Win Rate"
              value={formatPercent(portfolio?.performance?.winRate)}
              subtitle="Profitable Trades"
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Daily P&L"
              value={`${portfolio?.dailyPnL >= 0 ? '+' : ''}${formatUSDT(portfolio?.dailyPnL || 0)}`}
              subtitle="Today's Performance"
              color={portfolio?.dailyPnL >= 0 ? 'success.main' : 'error.main'}
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Asset Allocation"
              value={`${formatPercent(allocation.usdt)} USDT`}
              subtitle={`${formatPercent(allocation.crypto)} Crypto`}
            />
          </Grid>
        </Grid>

        {/* Row 4: Additional Metrics */}
        <Grid container spacing={1} sx={{ mb: 2 }}>
          <Grid item xs={3}>
            <MetricCard
              title="Profit Factor"
              value={portfolio?.performance?.profitFactor?.toFixed(2) || '0.00'}
              subtitle="Gross Profit/Loss"
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Sharpe Ratio"
              value={portfolio?.performance?.sharpeRatio?.toFixed(2) || '0.00'}
              subtitle="Risk-Adj Return"
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Avg Win"
              value={formatUSDT(portfolio?.performance?.avgWin || 0)}
              subtitle="Per Winning Trade"
              color="success.main"
            />
          </Grid>
          <Grid item xs={3}>
            <MetricCard
              title="Avg Loss"
              value={formatUSDT(portfolio?.performance?.avgLoss || 0)}
              subtitle="Per Losing Trade"
              color="error.main"
            />
          </Grid>
        </Grid>

        {/* Row 5: Account Status - Center Justified */}
        <Box display="flex" justifyContent="center" mt={2}>
          <Card variant="outlined" sx={{ px: 3, py: 1 }}>
            <Typography variant="body2" color="textSecondary" textAlign="center">
              Account: {account?.accountType || 'SPOT'} | 
              Trading: {account?.canTrade ? ' ✅ Enabled' : ' ❌ Disabled'} |
              Mode: Binance Testnet
            </Typography>
          </Card>
        </Box>
      </Box>
    </Paper>
  );
};

export default PortfolioOverview;