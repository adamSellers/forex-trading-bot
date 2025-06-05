// frontend/src/components/CurrentHoldings.jsx - Separated Holdings Component
import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip
} from '@mui/material';

const CurrentHoldings = ({ account, prices }) => {
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

  const getTotalPortfolioValue = () => {
    if (!account?.balances || !prices) return 0;
    return account.balances
      .filter(balance => TRADING_ASSETS.includes(balance.asset))
      .reduce((total, balance) => total + calculateAssetValue(balance, prices), 0);
  };

  return (
    <Paper sx={{ p: 3, height: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Current Holdings
      </Typography>
      
      {account && account.balances ? (
        <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
          {account.balances
            .filter(balance => TRADING_ASSETS.includes(balance.asset) && balance.total > 0)
            .map((balance) => {
              const usdValue = calculateAssetValue(balance, prices);
              const allocation = getTotalPortfolioValue() > 0 ? (usdValue / getTotalPortfolioValue()) * 100 : 0;
              
              return (
                <Card key={balance.asset} variant="outlined" sx={{ mb: 1.5 }}>
                  <CardContent sx={{ py: 1.5 }}>
                    <Grid container alignItems="center" spacing={1}>
                      <Grid item xs={12} sm={3}>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Typography variant="subtitle1" fontWeight="bold">
                            {balance.asset}
                          </Typography>
                          {balance.asset === 'USDT' && (
                            <Chip size="small" label="Base" color="primary" />
                          )}
                        </Box>
                      </Grid>
                      
                      <Grid item xs={6} sm={2}>
                        <Box>
                          <Typography variant="body2" fontWeight="500">
                            {formatCrypto(balance.total, balance.asset === 'USDT' ? 2 : 6)}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            Total Balance
                          </Typography>
                        </Box>
                      </Grid>
                      
                      <Grid item xs={6} sm={2}>
                        <Box>
                          <Typography variant="body2" color="success.main" fontWeight="500">
                            {formatCurrency(usdValue)}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            USD Value
                          </Typography>
                        </Box>
                      </Grid>
                      
                      <Grid item xs={6} sm={2}>
                        <Box>
                          <Typography variant="body2" color="info.main" fontWeight="500">
                            {formatPercent(allocation)}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            Allocation
                          </Typography>
                        </Box>
                      </Grid>
                      
                      <Grid item xs={6} sm={2}>
                        {balance.asset !== 'USDT' && prices[`${balance.asset}USDT`] && (
                          <Box>
                            <Typography variant="body2" fontWeight="500">
                              ${prices[`${balance.asset}USDT`].price.toFixed(2)}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              Current Price
                            </Typography>
                          </Box>
                        )}
                      </Grid>
                      
                      <Grid item xs={12} sm={1}>
                        {balance.locked > 0 && (
                          <Box>
                            <Typography variant="body2" color="warning.main" fontWeight="500">
                              {formatCrypto(balance.locked)}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              Locked
                            </Typography>
                          </Box>
                        )}
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              );
            })
          }
        </Box>
      ) : (
        <Typography variant="body2" color="textSecondary">
          Loading portfolio balances...
        </Typography>
      )}
    </Paper>
  );
};

export default CurrentHoldings;