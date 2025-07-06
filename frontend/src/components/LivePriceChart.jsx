// frontend/src/components/LivePriceChart.jsx - REBUILT FOR HISTORICAL ANALYSIS
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
  CircularProgress,
  Alert,
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
import { tradingAPI } from '../config/api';
import { calculateEMA } from '../utils/indicators';

const LivePriceChart = ({ prices = {} }) => {
  const [selectedAsset, setSelectedAsset] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const assets = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'DOGEUSDT'];
  const timeframes = {
    '1h': '1 Hour',
    '4h': '4 Hours',
    '1d': '1 Day'
  };

  // Fetch historical candle data
  useEffect(() => {
    const fetchCandleData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await tradingAPI.getCandles(selectedAsset, timeframe);
        
        if (data && data.candles && data.candles.length > 0) {
          const closePrices = data.candles.map(c => c.close);
          const fastMAValues = calculateEMA(closePrices, 20);
          const slowMAValues = calculateEMA(closePrices, 50);

          const processedData = data.candles.map((candle, index) => ({
            ...candle,
            time: new Date(candle.openTime).toLocaleDateString(),
            fastMA: fastMAValues[index],
            slowMA: slowMAValues[index],
          }));
          setChartData(processedData);
        } else {
          setChartData([]);
        }
      } catch (err) {
        setError(`Failed to load chart data: ${err.message}`);
        setChartData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCandleData();
  }, [selectedAsset, timeframe]);

  // Handle live price updates to animate the last candle
  useEffect(() => {
    const livePrice = prices[selectedAsset]?.price;
    if (livePrice && chartData.length > 0) {
      setChartData(prevData => {
        const newData = [...prevData];
        const lastCandle = { ...newData[newData.length - 1] };
        
        lastCandle.close = livePrice;
        lastCandle.high = Math.max(lastCandle.high, livePrice);
        lastCandle.low = Math.min(lastCandle.low, livePrice);
        
        newData[newData.length - 1] = lastCandle;
        return newData;
      });
    }
  }, [prices, selectedAsset]);

  // Calculate price statistics
  const priceStats = useMemo(() => {
    if (chartData.length === 0) return null;
    
    const closePrices = chartData.map(d => d.close);
    const currentPrice = closePrices[closePrices.length - 1];
    const firstPrice = closePrices[0];
    const minPrice = Math.min(...chartData.map(c => c.low));
    const maxPrice = Math.max(...chartData.map(c => c.high));
    const priceChange = currentPrice - firstPrice;
    const priceChangePercent = ((priceChange / firstPrice) * 100);
    
    return {
      current: currentPrice,
      change: priceChange,
      changePercent: priceChangePercent,
      min: minPrice,
      max: maxPrice,
    };
  }, [chartData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <Paper sx={{ p: 1.5, border: 1, borderColor: 'divider', backgroundColor: 'rgba(30, 30, 30, 0.9)' }}>
          <Typography variant="caption" color="textSecondary" gutterBottom>
            {label}
          </Typography>
          <Typography variant="body2" fontWeight="bold" sx={{ color: assetColors[selectedAsset], display: 'block' }}>
            Close: ${data.close?.toFixed(data.close > 1 ? 2 : 6)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            O: {data.open?.toFixed(2)} H: {data.high?.toFixed(2)} L: {data.low?.toFixed(2)}
          </Typography>
          <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '4px 0' }} />
          {data.fastMA && (
            <Typography variant="caption" sx={{ color: '#8884d8' }}>
              Fast EMA (20): ${data.fastMA.toFixed(data.close > 1 ? 2 : 6)}
            </Typography>
          )}
          {data.slowMA && (
            <Typography variant="caption" sx={{ color: '#82ca9d', display: 'block' }}>
              Slow EMA (50): ${data.slowMA.toFixed(data.close > 1 ? 2 : 6)}
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
          Historical Analysis Chart
        </Typography>
        
        <Box display="flex" gap={2} alignItems="center">
          {/* Asset Selector */}
          <FormControl size="small" sx={{ minWidth: 120 }} disabled={loading}>
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
            value={timeframe}
            exclusive
            onChange={(e, newTimeframe) => newTimeframe && setTimeframe(newTimeframe)}
            size="small"
            disabled={loading}
          >
            {Object.entries(timeframes).map(([key, label]) => (
              <ToggleButton key={key} value={key}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Price Statistics */}
      {priceStats && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid xs={3}>
            <Box textAlign="center">
              <Typography variant="caption" color="textSecondary">
                Current
              </Typography>
              <Typography variant="h6" fontWeight="bold">
                ${priceStats.current.toFixed(priceStats.current > 1 ? 2 : 6)}
              </Typography>
            </Box>
          </Grid>
          <Grid xs={3}>
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
          <Grid xs={3}>
            <Box textAlign="center">
              <Typography variant="caption" color="textSecondary">
                High
              </Typography>
              <Typography variant="body2">
                ${priceStats.max.toFixed(priceStats.max > 1 ? 2 : 6)}
              </Typography>
            </Box>
          </Grid>
          <Grid xs={3}>
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
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <CircularProgress />
            <Typography sx={{ ml: 2 }}>Loading Chart Data...</Typography>
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 12 }}
                tickFormatter={(timeStr) => new Date(timeStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                interval="preserveStartEnd"
              />
              <YAxis 
                domain={['dataMin - (dataMax - dataMin) * 0.1', 'dataMax + (dataMax - dataMin) * 0.1']}
                tick={{ fontSize: 12 }}
                tickFormatter={formatYAxis}
                allowDataOverflow={false}
                width={80}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#888', strokeWidth: 1 }} />
              <Legend verticalAlign="top" height={36}/>
              
              {/* Reference line for starting price */}
              {chartData.length > 1 && (
                <ReferenceLine y={chartData[0].close} stroke="#666" strokeDasharray="2 2" />
              )}
              
              <Line
                type="monotone"
                dataKey="close"
                name="Close Price"
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
                name="Fast EMA (20)"
                stroke="#8884d8"
                strokeWidth={1.5}
                dot={false}
                connectNulls={true}
              />
              {/* Slow Moving Average Line */}
              <Line
                type="monotone"
                dataKey="slowMA"
                name="Slow EMA (50)"
                stroke="#82ca9d"
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
              No historical data available for {selectedAsset.replace('USDT', '')} on this timeframe.
            </Typography>
          </Box>
        )}
      </Box>

    </Paper>
  );
};

export default LivePriceChart;
