// frontend/src/components/LivePriceChart.jsx - SEAMLESS INTEGRATION
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Typography, Box, ToggleButtonGroup, ToggleButton, FormControl, 
  Select, MenuItem, Grid, CircularProgress, Alert, useTheme, alpha
} from '@mui/material';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend, Area
} from 'recharts';
import { tradingAPI } from '../config/api';
import { calculateEMA } from '../utils/indicators';

const useChartData = (asset, timeframe) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = useCallback(async (isBackground = false) => {
        try {
            if (!isBackground) setLoading(true);
            const response = await tradingAPI.getCandles(asset, timeframe);
            if (response?.candles?.length > 0) {
                const closes = response.candles.map(c => c.close);
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
        } catch (err) { setError(err.message); } 
        finally { setLoading(false); }
    }, [asset, timeframe]);

    useEffect(() => { setData([]); fetchData(false); }, [fetchData]);
    useEffect(() => { 
        const interval = setInterval(() => fetchData(true), 60000); 
        return () => clearInterval(interval);
    }, [fetchData]);

    return { data, setData, loading, error };
};

const LivePriceChart = ({ prices = {}, assets = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'] }) => {
  const theme = useTheme();
  const [selectedAsset, setSelectedAsset] = useState(assets[0] || 'BTCUSDT');
  const [timeframe, setTimeframe] = useState('1h');
  
  useEffect(() => {
      if (assets.length > 0 && !assets.includes(selectedAsset)) setSelectedAsset(assets[0]);
  }, [assets, selectedAsset]);
  
  const { data: chartData, setData: setChartData, loading, error } = useChartData(selectedAsset, timeframe);

  // Live Update Logic
  useEffect(() => {
    const livePrice = prices[selectedAsset]?.price;
    if (livePrice && chartData.length > 0) {
      setChartData(prev => {
        const newData = [...prev];
        const last = { ...newData[newData.length - 1] };
        last.close = livePrice;
        last.high = Math.max(last.high, livePrice);
        last.low = Math.min(last.low, livePrice);
        newData[newData.length - 1] = last;
        return newData;
      });
    }
  }, [prices, selectedAsset, chartData.length, setChartData]);

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
        pct: (change / first.close) * 100
    };
  }, [chartData]);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload?.[0]) {
      const d = payload[0].payload;
      return (
        <Box sx={{ 
            p: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.9), 
            border: 1, borderColor: 'divider', borderRadius: 1,
            boxShadow: theme.shadows[4]
        }}>
          <Typography variant="caption" color="text.secondary">
            {new Date(d.time).toLocaleString()}
          </Typography>
          <Typography variant="h6" color="primary.main" fontWeight="bold">
            ${d.close.toFixed(2)}
          </Typography>
          <Grid container spacing={1} sx={{ mt: 0.5, fontSize: 11 }}>
             <Grid item xs={6} color="#8884d8">EMA(20): ${d.fastMA?.toFixed(2)}</Grid>
             <Grid item xs={6} color="#82ca9d">EMA(50): ${d.slowMA?.toFixed(2)}</Grid>
          </Grid>
        </Box>
      );
    }
    return null;
  };

  return (
    <Box height="100%" display="flex" flexDirection="column" sx={{ overflow: 'hidden' }}>
      
      {/* HEADER CONTROLS */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
        {stats ? (
            <Box>
                <Typography variant="h5" fontWeight="bold" fontFamily="monospace">
                    ${stats.current.toFixed(2)}
                </Typography>
                <Typography variant="caption" fontWeight="bold" sx={{ color: stats.change >= 0 ? 'success.main' : 'error.main' }}>
                     {stats.change >= 0 ? '+' : ''}{stats.pct.toFixed(2)}% (24h)
                </Typography>
            </Box>
        ) : <Box />}
        
        <Box display="flex" gap={1}>
          <FormControl size="small" variant="standard" sx={{ minWidth: 100 }}>
            <Select 
                value={selectedAsset} 
                onChange={(e) => setSelectedAsset(e.target.value)}
                disableUnderline
                sx={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'primary.main' }}
            >
              {assets.map(a => <MenuItem key={a} value={a}>{a.replace('USDT','')}</MenuItem>)}
            </Select>
          </FormControl>

          <ToggleButtonGroup
            value={timeframe}
            exclusive
            onChange={(e, v) => v && setTimeframe(v)}
            size="small"
            sx={{ height: 32 }}
          >
            <ToggleButton value="1h" sx={{ px: 1 }}>1H</ToggleButton>
            <ToggleButton value="4h" sx={{ px: 1 }}>4H</ToggleButton>
            <ToggleButton value="1d" sx={{ px: 1 }}>1D</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* CHART AREA */}
      <Box flexGrow={1} position="relative" sx={{ minHeight: 0 }}>
        {loading && !chartData.length ? (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <CircularProgress size={40} thickness={4} />
            </Box>
        ) : error ? (
            <Alert severity="error">{error}</Alert>
        ) : (
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.1}/>
                            <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.1)} vertical={false} />
                    <XAxis 
                        dataKey="time" 
                        tickFormatter={(t) => new Date(t).getHours() + ':00'}
                        stroke={alpha(theme.palette.text.secondary, 0.5)}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis 
                        domain={['auto', 'auto']}
                        tickFormatter={(v) => `$${v}`}
                        stroke={alpha(theme.palette.text.secondary, 0.5)}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: theme.palette.text.secondary, strokeDasharray: '4 4' }} />
                    <Legend verticalAlign="top" iconType="circle" height={30} />
                    
                    <Line 
                        type="monotone" 
                        dataKey="close" 
                        stroke={theme.palette.primary.main} 
                        strokeWidth={3} 
                        dot={false} 
                        name="Price"
                        activeDot={{ r: 6, strokeWidth: 0 }}
                        animationDuration={1000}
                    />
                    <Line 
                        type="monotone" 
                        dataKey="fastMA" 
                        stroke="#8884d8" 
                        strokeWidth={1} 
                        dot={false} 
                        name="EMA 20" 
                        strokeOpacity={0.7}
                    />
                    <Line 
                        type="monotone" 
                        dataKey="slowMA" 
                        stroke="#82ca9d" 
                        strokeWidth={1} 
                        dot={false} 
                        name="EMA 50"
                        strokeOpacity={0.7}
                    />
                </LineChart>
            </ResponsiveContainer>
        )}
      </Box>
    </Box>
  );
};

export default LivePriceChart;