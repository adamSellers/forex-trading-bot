// frontend/src/components/LivePrices.jsx
import React from 'react';
import {
  Paper,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip
} from '@mui/material';

const LivePrices = ({ prices }) => {
  const formatPercent = (value) => {
    return `${(value || 0).toFixed(2)}%`;
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Live Prices
      </Typography>
      
      {Object.entries(prices).map(([symbol, data]) => (
        <Card key={symbol} variant="outlined" sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1 }}>
            <Grid container alignItems="center" justifyContent="space-between">
              <Grid item>
                <Typography variant="subtitle1" fontWeight="bold">
                  {symbol.replace('USDT', '')}/USDT
                </Typography>
              </Grid>
              <Grid item>
                <Typography variant="h6">
                  ${data.price.toFixed(data.price > 1 ? 2 : 6)}
                </Typography>
              </Grid>
              <Grid item>
                <Chip
                  size="small"
                  label={formatPercent(data.priceChange)}
                  color={data.priceChange >= 0 ? 'success' : 'error'}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      ))}
    </Paper>
  );
};

export default LivePrices;