// frontend/src/components/CurrentHoldings.jsx - Enhanced with Real + Paper Holdings
import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  ExpandMore,
  AccountBalance,
  TrendingUp,
  Wallet
} from '@mui/icons-material';

const CurrentHoldings = ({ account, prices, portfolio }) => {
  // Define our trading assets
  const TRADING_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'DOGE'];

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value || 0);
  };

  const formatCrypto = (value, decimals = 6) => {
    if (value === 0) return '0';
    return parseFloat(value).toFixed(decimals);
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

  // Calculate Real Portfolio Value
  const getRealPortfolioValue = () => {
    if (!account?.balances || !prices) return 0;
    return account.balances
      .filter(balance => TRADING_ASSETS.includes(balance.asset))
      .reduce((total, balance) => total + calculateAssetValue(balance, prices), 0);
  };

  // Get Paper Trading Positions
  const getPaperPositions = () => {
    if (!portfolio?.positions) return [];
    return portfolio.positions;
  };

  // Calculate Paper Portfolio Value
  const getPaperPortfolioValue = () => {
    const paperUSDT = portfolio?.usdtBalance || 0;
    const paperCrypto = portfolio?.cryptoValue || 0;
    return paperUSDT + paperCrypto;
  };

  // Combined Portfolio Value
  const getTotalPortfolioValue = () => {
    return getRealPortfolioValue() + getPaperPortfolioValue();
  };

  // Asset Card Component - Fixed linting errors
  const AssetCard = ({ asset, realBalance, paperPosition }) => {
    const realValue = realBalance ? calculateAssetValue(realBalance, prices) : 0;
    const paperValue = paperPosition ? paperPosition.currentValue || 0 : 0;
    const totalValue = realValue + paperValue;
    
    const totalPortfolio = getTotalPortfolioValue();
    const allocation = totalPortfolio > 0 ? (totalValue / totalPortfolio) * 100 : 0;

    return (
      <Card key={asset} variant="outlined" sx={{ mb: 1.5 }}>
        <CardContent sx={{ py: 1.5 }}>
          <Grid container alignItems="center" spacing={1}>
            <Grid item xs={12} sm={3}>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="subtitle1" fontWeight="bold">
                  {asset}
                </Typography>
                {asset === 'USDT' && (
                  <Chip size="small" label="Base" color="primary" />
                )}
              </Box>
            </Grid>
            
            {/* Real Holdings */}
            <Grid item xs={6} sm={2.5}>
              <Box>
                <Typography variant="body2" fontWeight="500" color={realBalance ? "text.primary" : "text.disabled"}>
                  {realBalance ? formatCrypto(realBalance.total, asset === 'USDT' ? 2 : 6) : '0'}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Real Holdings
                </Typography>
                {realBalance && realValue > 0 && (
                  <Typography variant="caption" color="success.main" sx={{ display: 'block' }}>
                    {formatCurrency(realValue)}
                  </Typography>
                )}
              </Box>
            </Grid>
            
            {/* Paper Positions */}
            <Grid item xs={6} sm={2.5}>
              <Box>
                <Typography variant="body2" fontWeight="500" color={paperPosition ? "warning.main" : "text.disabled"}>
                  {paperPosition ? formatCrypto(paperPosition.quantity || 0, asset === 'USDT' ? 2 : 6) : '0'}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Paper Position
                </Typography>
                {paperPosition && paperValue > 0 && (
                  <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                    {formatCurrency(paperValue)}
                  </Typography>
                )}
              </Box>
            </Grid>
            
            {/* Combined Value */}
            <Grid item xs={6} sm={2}>
              <Box>
                <Typography variant="body2" color="info.main" fontWeight="bold">
                  {formatCurrency(totalValue)}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Total Value
                </Typography>
              </Box>
            </Grid>
            
            {/* Allocation */}
            <Grid item xs={6} sm={1.5}>
              <Box>
                <Typography variant="body2" color="primary.main" fontWeight="500">
                  {formatPercent(allocation)}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Portfolio %
                </Typography>
              </Box>
            </Grid>
            
            {/* Current Price */}
            <Grid item xs={12} sm={1.5}>
              {asset !== 'USDT' && prices[`${asset}USDT`] && (
                <Box textAlign="right">
                  <Typography variant="body2" fontWeight="500">
                    ${prices[`${asset}USDT`].price.toFixed(2)}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    Current Price
                  </Typography>
                </Box>
              )}
            </Grid>
          </Grid>
          
          {/* Paper Position Details */}
          {paperPosition && (
            <Box mt={1} p={1} sx={{ backgroundColor: 'action.hover', borderRadius: 1 }}>
              <Grid container spacing={1}>
                <Grid item xs={3}>
                  <Typography variant="caption" color="textSecondary">Entry:</Typography>
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    ${paperPosition.avgPrice?.toFixed(2)}
                  </Typography>
                </Grid>
                <Grid item xs={3}>
                  <Typography variant="caption" color="textSecondary">P&L:</Typography>
                  <Typography 
                    variant="caption" 
                    sx={{ ml: 0.5 }}
                    color={paperPosition.unrealizedPnL >= 0 ? 'success.main' : 'error.main'}
                  >
                    {paperPosition.unrealizedPnL >= 0 ? '+' : ''}
                    {formatCurrency(paperPosition.unrealizedPnL || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={3}>
                  <Typography variant="caption" color="textSecondary">Stop Loss:</Typography>
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    ${paperPosition.stopLoss?.toFixed(2) || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={3}>
                  <Typography variant="caption" color="textSecondary">Duration:</Typography>
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    {paperPosition.entryTime ? 
                      Math.floor((Date.now() - paperPosition.entryTime) / (1000 * 60 * 60)) + 'h' : 
                      'N/A'
                    }
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Paper sx={{ p: 3, height: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Portfolio Holdings
      </Typography>
      
      {/* Portfolio Summary */}
      <Box mb={2}>
        <Grid container spacing={2}>
          <Grid item xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="caption" color="textSecondary">Real Holdings</Typography>
              <Typography variant="h6" color="success.main">
                {formatCurrency(getRealPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="caption" color="textSecondary">Paper Trading</Typography>
              <Typography variant="h6" color="warning.main">
                {formatCurrency(getPaperPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
          <Grid item xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="caption" color="textSecondary">Combined Total</Typography>
              <Typography variant="h6" color="primary.main">
                {formatCurrency(getTotalPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
        </Grid>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {account && account.balances ? (
        <Box sx={{ maxHeight: 500, overflow: 'auto' }}>
          {/* USDT Holdings */}
          {(() => {
            const usdtRealBalance = account.balances.find(b => b.asset === 'USDT');
            const paperUSDT = {
              quantity: portfolio?.usdtBalance || 0,
              currentValue: portfolio?.usdtBalance || 0
            };
            
            return (
              <AssetCard 
                asset="USDT"
                realBalance={usdtRealBalance}
                paperPosition={paperUSDT}
              />
            );
          })()}

          {/* Crypto Assets */}
          {TRADING_ASSETS.filter(asset => asset !== 'USDT').map(asset => {
            const realBalance = account.balances.find(b => b.asset === asset);
            const paperPosition = getPaperPositions().find(p => p.symbol === `${asset}USDT`);
            
            // Only show if we have real holdings or paper positions
            if (!realBalance?.total && !paperPosition) return null;
            
            return (
              <AssetCard 
                key={asset}
                asset={asset}
                realBalance={realBalance}
                paperPosition={paperPosition}
              />
            );
          })}

          {/* Paper-Only Positions */}
          {getPaperPositions()
            .filter(position => {
              const asset = position.symbol.replace('USDT', '');
              const realBalance = account.balances.find(b => b.asset === asset);
              return !realBalance?.total; // Only show if no real holdings
            })
            .map(position => {
              const asset = position.symbol.replace('USDT', '');
              return (
                <AssetCard 
                  key={`paper-${asset}`}
                  asset={asset}
                  realBalance={null}
                  paperPosition={position}
                />
              );
            })}
        </Box>
      ) : (
        <Typography variant="body2" color="textSecondary">
          Loading portfolio balances...
        </Typography>
      )}

      {/* Trading Mode Indicator */}
      <Box mt={2} p={1} sx={{ backgroundColor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="caption" color="textSecondary">
          📊 <strong>Trading Mode:</strong> {portfolio?.totalValue ? 'Paper Trading Active' : 'Real Holdings Only'} • 
          <strong> Account Type:</strong> {account?.accountType || 'SPOT'} • 
          <strong> Last Update:</strong> {new Date().toLocaleTimeString()}
        </Typography>
      </Box>
    </Paper>
  );
};

export default CurrentHoldings;