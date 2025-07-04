// frontend/src/components/LivePrices.jsx - FIXED VERSION
import React from 'react';
import { Box, Typography, Grid, Card, CardContent } from '@mui/material';
import { TrendingUp, TrendingDown } from 'lucide-react';

const LivePrices = ({ prices = {} }) => {
  // CRITICAL FIX: Handle empty or malformed prices data
  const pricesArray = React.useMemo(() => {
    if (!prices || typeof prices !== 'object') {
      return [];
    }

    // Handle different possible data structures
    let rawPrices = [];
    
    if (Array.isArray(prices)) {
      rawPrices = prices;
    } else if (prices.prices && Array.isArray(prices.prices)) {
      rawPrices = prices.prices;
    } else if (typeof prices === 'object') {
      // Convert object to array if needed
      rawPrices = Object.entries(prices).map(([symbol, data]) => ({
        symbol,
        price: typeof data === 'object' ? data.price : data,
        change: typeof data === 'object' ? data.change : 0,
        changePercent: typeof data === 'object' ? data.changePercent : 0,
      }));
    }

    // Filter and validate price data
    return rawPrices
      .filter(item => item && item.symbol && item.price !== undefined && item.price !== null)
      .map(item => ({
        symbol: item.symbol,
        price: parseFloat(item.price) || 0,
        change: parseFloat(item.change) || 0,
        changePercent: parseFloat(item.changePercent) || 0,
      }))
      .slice(0, 4); // Limit to 4 main assets
  }, [prices]);

  // If no valid prices, show placeholder
  if (pricesArray.length === 0) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Live Prices
        </Typography>
        <Grid container spacing={2}>
          {['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'DOGEUSDT'].map((symbol) => (
            <Grid item xs={6} md={3} key={symbol}>
              <Card variant="outlined">
                <CardContent sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="textSecondary">
                    {symbol.replace('USDT', '')}
                  </Typography>
                  <Typography variant="h6">
                    Loading...
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    --
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Live Prices
      </Typography>
      <Grid container spacing={2}>
        {pricesArray.map((item) => {
          const isPositive = item.changePercent >= 0;
          
          return (
            <Grid item xs={6} md={3} key={item.symbol}>
              <Card variant="outlined">
                <CardContent sx={{ p: 2 }}>
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Typography variant="subtitle2" color="textSecondary">
                      {item.symbol.replace('USDT', '')}
                    </Typography>
                    {isPositive ? (
                      <TrendingUp size={16} color="#4caf50" />
                    ) : (
                      <TrendingDown size={16} color="#f44336" />
                    )}
                  </Box>
                  
                  <Typography variant="h6">
                    ${item.price.toFixed(item.price > 1 ? 2 : 6)}
                  </Typography>
                  
                  <Typography 
                    variant="body2" 
                    color={isPositive ? 'success.main' : 'error.main'}
                  >
                    {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};

export default LivePrices;