// frontend/src/components/LivePrices.jsx - ENHANCED VERSION
import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, Grid, Card, CardContent, Skeleton } from '@mui/material';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { assetColors } from '../theme/tradingTheme';

const PriceCard = ({ asset, priceData, history }) => {
  if (!priceData) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent sx={{ p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
          <Box>
            <Typography variant="subtitle2" color="textSecondary">
              {asset.replace('USDT', '')}
            </Typography>
            <Skeleton variant="text" width="80%" height={32} />
          </Box>
          <Skeleton variant="rectangular" width="100%" height={20} />
          <Skeleton variant="text" width="40%" />
        </CardContent>
      </Card>
    );
  }

  const isPositive = (priceData.priceChangePercent || 0) >= 0;
  const color = isPositive ? 'success.main' : 'error.main';

  return (
    <Card variant="outlined" sx={{ height: '100%', width: '100%', minWidth: 0, borderLeft: `4px solid ${assetColors[asset] || '#fff'}` }}>
      <CardContent sx={{ p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight="bold">
            {asset.replace('USDT', '')}
          </Typography>
          {isPositive ? (
            <TrendingUp size={20} color={assetColors.success || '#4caf50'} />
          ) : (
            <TrendingDown size={20} color={assetColors.error || '#f44336'} />
          )}
        </Box>
        
        <Box my={1}>
          <Typography variant="h5" fontWeight="bold">
            ${priceData.price.toFixed(priceData.price > 1 ? 2 : 6)}
          </Typography>
        </Box>

        {history && history.length > 1 && (
          <Box sx={{ height: 40, mx: 0 }}>
            <SparkLineChart
              data={history}
              height={40}
              colors={[assetColors[asset] || '#fff']}
              curve="natural"
              area
              sx={{
                '& .MuiSparkline-area': {
                  fill: assetColors[asset] || '#fff',
                  fillOpacity: 0.1,
                },
              }}
            />
          </Box>
        )}
        
        <Box display="flex" justifyContent="space-between" alignItems="baseline" mt={1}>
          <Typography variant="body2" color={color} fontWeight="500">
            {isPositive ? '+' : ''}{(priceData.priceChangePercent || 0).toFixed(2)}%
          </Typography>
          <Typography variant="caption" color="text.secondary">
            24h Change
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

const LivePrices = ({ prices = {} }) => {
  const [history, setHistory] = useState(new Map());
  const assets = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'DOGEUSDT'];

  useEffect(() => {
    if (!prices || typeof prices !== 'object' || Object.keys(prices).length === 0) {
      return;
    }

    setHistory(prevHistory => {
      const newHistory = new Map(prevHistory);
      assets.forEach(asset => {
        if (prices[asset] && typeof prices[asset].price === 'number') {
          const assetHistory = newHistory.get(asset) || [];
          const updatedHistory = [...assetHistory, prices[asset].price].slice(-30); // Keep last 30 points
          newHistory.set(asset, updatedHistory);
        }
      });
      return newHistory;
    });
  }, [prices]);

  // This useMemo is now just for getting the latest price data for the defined assets.
  // The bug is fixed because `prices` prop will be clean.
  const latestPrices = useMemo(() => {
    const data = new Map();
    assets.forEach(asset => {
      if (prices[asset]) {
        data.set(asset, prices[asset]);
      }
    });
    return data;
  }, [prices]);

  return (
    <Grid container spacing={2} sx={{ maxWidth: '100%' }}>
      {assets.map((asset) => (
        <Grid item xs={6} sm={6} md={6} lg={6} key={asset}>
          <PriceCard
            asset={asset}
            priceData={latestPrices.get(asset)}
            history={history.get(asset)}
          />
        </Grid>
      ))}
    </Grid>
  );
};

export default LivePrices;