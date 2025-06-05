// frontend/src/components/RecentTrades.jsx
import React from 'react';
import {
  Paper,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown
} from '@mui/icons-material';

const RecentTrades = ({ trades }) => {
  const formatUSDT = (value) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value || 0) + ' USDT';
  };

  return (
    <Paper sx={{ p: 3, height: 400, overflow: 'auto' }}>
      <Typography variant="h6" gutterBottom>
        Recent Trades
      </Typography>
      
      {trades.slice(0, 10).map((trade, index) => (
        <Card key={index} variant="outlined" sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1 }}>
            <Grid container alignItems="center" spacing={1}>
              <Grid item>
                {trade.side === 'BUY' ? <TrendingUp color="success" /> : <TrendingDown color="error" />}
              </Grid>
              <Grid item xs={2}>
                <Typography variant="body2" fontWeight="bold">
                  {trade.symbol?.replace('USDT', '')}
                </Typography>
              </Grid>
              <Grid item xs={2}>
                <Chip
                  size="small"
                  label={trade.side}
                  color={trade.side === 'BUY' ? 'success' : 'error'}
                />
              </Grid>
              <Grid item xs={2}>
                <Typography variant="body2">
                  ${trade.price?.toFixed(trade.price > 1 ? 2 : 6)}
                </Typography>
              </Grid>
              <Grid item xs={2}>
                <Typography variant="body2" color="info.main">
                  {trade.side === 'BUY' 
                    ? formatUSDT(trade.usdtCost)
                    : formatUSDT(trade.usdtReceived)
                  }
                </Typography>
              </Grid>
              <Grid item xs={2}>
                {trade.pnl !== undefined && (
                  <Typography 
                    variant="body2" 
                    color={trade.pnl >= 0 ? 'success.main' : 'error.main'}
                    fontWeight="bold"
                  >
                    {trade.pnl >= 0 ? '+' : ''}{formatUSDT(trade.pnl)}
                  </Typography>
                )}
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="textSecondary">
                  {new Date(trade.timestamp).toLocaleString()}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      ))}
    </Paper>
  );
};

export default RecentTrades;