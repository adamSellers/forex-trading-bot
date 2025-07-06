// frontend/src/components/LivePriceChart.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Paper,
  Typography,
  Box,
  ToggleButtonGroup,
  ToggleButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
} from '@mui/material';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Legend
} from 'recharts';
import { assetColors } from '../theme/tradingTheme';

const LivePriceChart = ({ prices = {}, signals = [] }) => {
  const [selectedAsset, setSelectedAsset] = useState('BTCUSDT');
  const [timeRange, setTimeRange] = useState('30min'); // 5min, 15min, 30min, 1hour
  const [priceHistory, setPriceHistory] = useState(new Map());

  const assets = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'DOGEUSDT'];
  
  const timeRangeConfig = {
    '5min': { minutes: 5, maxPoints: 60, label: '5 Minutes' },
    '15min': { minutes: 15, maxPoints: 90, label: '15 Minutes' },
    '30min': { minutes: 30, maxPoints: 120, label: '30 Minutes' },
    '1hour': { minutes: 60, maxPoints: 120, label: '1 Hour' }
  };

  // Process incoming price updates
  useEffect(() => {
    if (!prices || Object.keys(prices).length === 0) return;

    const now = Date.now();
    
    // Update price history for each asset
    assets.forEach(asset => {
      if (prices[asset]) {
        setPriceHistory(prev => {
          const newHistory = new Map(prev);
          const assetHistory = newHistory.get(asset) || [];
          
          // Find the latest signal for THIS asset to get MA values
          const signal = signals.find(s => s.symbol === asset);
          const fastMA = signal?.data ? parseFloat(signal.data.fastMA) : null;
          const slowMA = signal?.data ? parseFloat(signal.data.slowMA) : null;
          
          // Add new price point
          const newPoint = {
            timestamp: now,
            time: new Date(now).toLocaleTimeString('en-US', { 
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }),
            price: prices[asset].price,
            change: prices[asset].priceChange || 0,
            // Add MAs, carrying forward the last known value if current signal is null
            fastMA: fastMA ?? (assetHistory.length > 0 ? assetHistory[assetHistory.length - 1].fastMA : null),
            slowMA: slowMA ?? (assetHistory.length > 0 ? assetHistory[assetHistory.length - 1].slowMA : null),
          };
          
          // Add to history and limit points based on time range
          const updatedHistory = [...assetHistory, newPoint];
          const config = timeRangeConfig[timeRange];
          const cutoffTime = now - (config.minutes * 60 * 1000);
          
          // Filter to time range and limit points
          const filteredHistory = updatedHistory
            .filter(point => point.timestamp > cutoffTime)
            .slice(-config.maxPoints);
          
          newHistory.set(asset, filteredHistory);
          return newHistory;
        });
      }
    });
  }, [prices, signals, timeRange]);

  // Get chart data for selected asset
  const chartData = useMemo(() => {
    const assetHistory = priceHistory.get(selectedAsset) || [];
    return assetHistory.map(point => ({
      ...point,
      formattedPrice: point.price.toFixed(point.price > 1 ? 2 : 6)
    }));
  }, [priceHistory, selectedAsset]);

  // Calculate price statistics
  const priceStats = useMemo(() => {
    if (chartData.length === 0) return null;
    
    const prices = chartData.map(d => d.price);
    const currentPrice = prices[prices.length - 1];
    const firstPrice = prices[0];
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceChange = currentPrice - firstPrice;
    const priceChangePercent = ((priceChange / firstPrice) * 100);
    
    return {
      current: currentPrice,
      change: priceChange,
      changePercent: priceChangePercent,
      min: minPrice,
      max: maxPrice,
      range: maxPrice - minPrice
    };
  }, [chartData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <Paper sx={{ p: 1.5, border: 1, borderColor: 'divider', backgroundColor: 'rgba(30, 30, 30, 0.9)' }}>
          <Typography variant="caption" color="textSecondary">
            {data.time}
          </Typography>
          <Typography variant="body2" fontWeight="bold" sx={{ color: assetColors[selectedAsset] }}>
            Price: ${data.price?.toFixed(data.price > 1 ? 2 : 6)}
          </Typography>
          {data.fastMA && (
            <Typography variant="caption" sx={{ color: '#ff9900' }}>
              Fast MA: ${data.fastMA.toFixed(data.price > 1 ? 2 : 6)}
            </Typography>
          )}
          {data.slowMA && (
            <Typography variant="caption" sx={{ color: '#00e676', display: 'block' }}>
              Slow MA: ${data.slowMA.toFixed(data.price > 1 ? 2 : 6)}
            </Typography>
          )}
        </Paper>
      );
    }
    return null;
  };

  // Format Y-axis values
  const formatYAxis = (value) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}k`;
    }
    return `$${value.toFixed(value > 1 ? 0 : 3)}`;
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          Live Price Chart
        </Typography>
        
        <Box display="flex" gap={2} alignItems="center">
          {/* Asset Selector */}
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Asset</InputLabel>
            <Select
              value={selectedAsset}
              label="Asset"
              onChange={(e) => setSelectedAsset(e.target.value)}
            >
              {assets.map(asset => (
                <MenuItem key={asset} value={asset}>
                  {asset.replace('USDT', '')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Time Range Selector */}
          <ToggleButtonGroup
            value={timeRange}
            exclusive
            onChange={(e, newRange) => newRange && setTimeRange(newRange)}
            size="small"
          >
            {Object.entries(timeRangeConfig).map(([key, config]) => (
              <ToggleButton key={key} value={key}>
                {config.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Price Statistics */}
      {priceStats && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={3}>
            <Box textAlign="center">
              <Typography variant="caption" color="textSecondary">
                Current
              </Typography>
              <Typography variant="h6" fontWeight="bold">
                ${priceStats.current.toFixed(priceStats.current > 1 ? 2 : 6)}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={3}>
            <Box textAlign="center">
              <Typography variant="caption" color="textSecondary">
                Change
              </Typography>
              <Typography 
                variant="body1" 
                fontWeight="bold"
                color={priceStats.change >= 0 ? 'success.main' : 'error.main'}
              >
                {priceStats.change >= 0 ? '+' : ''}
                {priceStats.changePercent.toFixed(2)}%
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={3}>
            <Box textAlign="center">
              <Typography variant="caption" color="textSecondary">
                High
              </Typography>
              <Typography variant="body2">
                ${priceStats.max.toFixed(priceStats.max > 1 ? 2 : 6)}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={3}>
            <Box textAlign="center">
              <Typography variant="caption" color="textSecondary">
                Low
              </Typography>
              <Typography variant="body2">
                ${priceStats.min.toFixed(priceStats.min > 1 ? 2 : 6)}
              </Typography>
            </Box>
          </Grid>
        </Grid>
      )}

      {/* Chart */}
      <Box sx={{ height: 350 }}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis 
                domain={['auto', 'auto']}
                tick={{ fontSize: 12 }}
                tickFormatter={formatYAxis}
                allowDataOverflow={true}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#888', strokeWidth: 1 }} />
              <Legend verticalAlign="top" height={36}/>
              
              {/* Reference line for starting price */}
              {chartData.length > 1 && (
                <ReferenceLine 
                  y={chartData[0].price} 
                  stroke="#666" 
                  strokeDasharray="2 2"
                  label={{ value: "Start", position: "right" }}
                />
              )}
              
              <Line
                type="monotone"
                dataKey="price"
                name="Price"
                stroke={assetColors[selectedAsset]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: assetColors[selectedAsset], strokeWidth: 2 }}
                connectNulls={false}
              />

              {/* Fast Moving Average Line */}
              <Line
                type="monotone"
                dataKey="fastMA"
                name="Fast MA"
                stroke="#ff9900"
                strokeWidth={1.5}
                dot={false}
                connectNulls={true}
              />
              {/* Slow Moving Average Line */}
              <Line
                type="monotone"
                dataKey="slowMA"
                name="Slow MA"
                stroke="#00e676"
                strokeWidth={1.5}
                dot={false}
                connectNulls={true}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Box 
            display="flex" 
            justifyContent="center" 
            alignItems="center" 
            height="100%"
            color="text.secondary"
          >
            <Typography variant="body1">
              Collecting price data for {selectedAsset.replace('USDT', '')}...
            </Typography>
          </Box>
        )}
      </Box>

      <Box mt={1}>
        <Typography variant="caption" color="textSecondary">
          Live updates every 5 seconds • {chartData.length} data points • {timeRangeConfig[timeRange].label} range
        </Typography>
      </Box>
    </Paper>
  );
};

export default LivePriceChart;
