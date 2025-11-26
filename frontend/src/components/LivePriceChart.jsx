// frontend/src/components/LivePriceChart.jsx - ALIGNED WITH BACKEND CONFIG
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Paper, Typography, Box, ToggleButtonGroup, ToggleButton, FormControl, 
  InputLabel, Select, MenuItem, Grid, CircularProgress, Alert, useTheme
} from '@mui/material';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend
} from 'recharts';
import { tradingAPI } from '../config/api';
import { calculateEMA } from '../utils/indicators';

// --- Custom Hook for Data Management ---
const useChartData = (asset, timeframe) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = useCallback(async (isBackground = false) => {
        try {
            if (!isBackground) setLoading(true);
            
            const response = await tradingAPI.getCandles(asset, timeframe);
            
            if (response && response.candles && response.candles.length > 0) {
                const closes = response.candles.map(c => c.close);
                
                // Calculate Indicators locally
                const fastMA = calculateEMA(closes, 20);
                const slowMA = calculateEMA(closes, 50);

                const processed = response.candles.map((c, i) => ({
                    ...c,
                    time: c.openTime, 
                    fastMA: fastMA[i],
                    slowMA: slowMA[i]
                }));
                
                setData(processed);
                setError(null);
            }
        } catch (err) {
            console.error("Chart Data Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [asset, timeframe]);

    useEffect(() => {
        setData([]); 
        fetchData(false);
    }, [fetchData]);

    useEffect(() => {
        const interval = setInterval(() => fetchData(true), 60 * 1000); 
        return () => clearInterval(interval);
    }, [fetchData]);

    return { data, setData, loading, error };
};

const LivePriceChart = ({ prices = {}, assets = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'] }) => {
  const theme = useTheme();
  const [selectedAsset, setSelectedAsset] = useState(assets[0] || 'BTCUSDT');
  const [timeframe, setTimeframe] = useState('1h'); // Default matches strategy
  
  const { data: chartData, setData: setChartData, loading, error } = useChartData(selectedAsset, timeframe);

  // --- Real-time Updates ---
  useEffect(() => {
    const livePrice = prices[selectedAsset]?.price;
    
    if (livePrice && chartData.length > 0) {
      setChartData(prev => {
        const newData = [...prev];
        const lastIdx = newData.length - 1;
        const lastCandle = { ...newData[lastIdx] };
        
        lastCandle.close = livePrice;
        lastCandle.high = Math.max(lastCandle.high, livePrice);
        lastCandle.low = Math.min(lastCandle.low, livePrice);
        
        newData[lastIdx] = lastCandle;
        return newData;
      });
    }
  }, [prices, selectedAsset, chartData.length, setChartData]);

  // --- Derived Statistics ---
  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const last = chartData[chartData.length - 1];
    const first = chartData[0];
    const change = last.close - first.close;
    
    return {
        current: last.close,
        high: Math.max(...chartData.map(c => c.high)),
        low: Math.min(...chartData.map(c => c.low)),
        change: change,
        changePercent: (change / first.close) * 100
    };
  }, [chartData]);

  // --- Renderers ---
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <Paper sx={{ p: 1.5, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">
            {new Date(d.time).toLocaleString()}
          </Typography>
          <Typography variant="subtitle2" color="primary.main">
            ${d.close.toFixed(2)}
          </Typography>
          <Box mt={1} fontSize={11}>
            <div style={{ color: '#8884d8' }}>Fast EMA (20): ${d.fastMA?.toFixed(2)}</div>
            <div style={{ color: '#82ca9d' }}>Slow EMA (50): ${d.slowMA?.toFixed(2)}</div>
          </Box>
        </Paper>
      );
    }
    return null;
  };

  return (
    <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header Control Bar */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Typography variant="h6">Live Market Analysis</Typography>
        
        <Box display="flex" gap={2}>
          <FormControl size="small">
            <InputLabel>Asset</InputLabel>
            <Select 
                value={selectedAsset} 
                label="Asset" 
                onChange={(e) => setSelectedAsset(e.target.value)}
                sx={{ minWidth: 120 }}
            >
              {assets.map(a => <MenuItem key={a} value={a}>{a.replace('USDT','')}</MenuItem>)}
            </Select>
          </FormControl>

          {/* UPDATED: Matches Backend Config (No 15m) */}
          <ToggleButtonGroup
            value={timeframe}
            exclusive
            onChange={(e, v) => v && setTimeframe(v)}
            size="small"
          >
            <ToggleButton value="1h">1H</ToggleButton>
            <ToggleButton value="4h">4H</ToggleButton>
            <ToggleButton value="1d">1D</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Stats Bar */}
      {stats && (
        <Grid container spacing={2} mb={2} sx={{ bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
            <Grid item xs={3} textAlign="center">
                <Typography variant="caption" display="block" color="text.secondary">Current</Typography>
                <Typography fontWeight="bold">${stats.current.toFixed(2)}</Typography>
            </Grid>
            <Grid item xs={3} textAlign="center">
                <Typography variant="caption" display="block" color="text.secondary">Period High</Typography>
                <Typography>${stats.high.toFixed(2)}</Typography>
            </Grid>
            <Grid item xs={3} textAlign="center">
                <Typography variant="caption" display="block" color="text.secondary">Period Low</Typography>
                <Typography>${stats.low.toFixed(2)}</Typography>
            </Grid>
            <Grid item xs={3} textAlign="center">
                <Typography variant="caption" display="block" color="text.secondary">Change</Typography>
                <Typography color={stats.change >= 0 ? 'success.main' : 'error.main'} fontWeight="bold">
                    {stats.change >= 0 ? '+' : ''}{stats.changePercent.toFixed(2)}%
                </Typography>
            </Grid>
        </Grid>
      )}

      {/* Main Chart Area */}
      <Box flexGrow={1} minHeight={300} position="relative">
        {loading && chartData.length === 0 ? (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <CircularProgress />
            </Box>
        ) : error ? (
            <Alert severity="error">{error}</Alert>
        ) : (
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                    <XAxis 
                        dataKey="time" 
                        tickFormatter={(t) => new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        minTickGap={30}
                        stroke={theme.palette.text.secondary}
                        fontSize={12}
                    />
                    <YAxis 
                        domain={['auto', 'auto']}
                        tickFormatter={(v) => `$${v}`}
                        stroke={theme.palette.text.secondary}
                        fontSize={12}
                        width={60}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="top" height={36} />
                    
                    <Line 
                        type="monotone" 
                        dataKey="close" 
                        stroke={theme.palette.primary.main} 
                        strokeWidth={2} 
                        dot={false} 
                        name="Price"
                        animationDuration={500}
                    />
                    <Line 
                        type="monotone" 
                        dataKey="fastMA" 
                        stroke="#8884d8" 
                        strokeWidth={1.5} 
                        dot={false} 
                        name="EMA 20" 
                        strokeDasharray="5 5"
                    />
                    <Line 
                        type="monotone" 
                        dataKey="slowMA" 
                        stroke="#82ca9d" 
                        strokeWidth={1.5} 
                        dot={false} 
                        name="EMA 50"
                    />
                </LineChart>
            </ResponsiveContainer>
        )}
      </Box>
    </Paper>
  );
};

export default LivePriceChart;