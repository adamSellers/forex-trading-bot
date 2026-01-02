// frontend/src/components/dashboard/LivePriceChart.jsx - Forex Version
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Typography, Box, ToggleButtonGroup, ToggleButton, FormControl, 
  Select, MenuItem, Grid, CircularProgress, Alert, useTheme, alpha
} from '@mui/material';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend
} from 'recharts';
import { tradingAPI } from '../../config/api';
import { calculateEMA } from '../../utils/indicators';
import { formatPrice, formatInstrument, FOREX_INSTRUMENTS, INSTRUMENT_INFO } from './Shared';

// --- SUPERTREND CALCULATION (Client-Side) ---
const calculateSuperTrend = (candles, period = 10, factor = 3) => {
    if (!candles || candles.length < period) return [];

    let tr = [candles[0].high - candles[0].low];
    let atr = [tr[0]];
    let st = [];
    let ub = [];
    let lb = [];
    let dir = []; // 1 = Up, -1 = Down

    // 1. Calculate ATR & Basic Bands
    for(let i = 1; i < candles.length; i++) {
        const c = candles[i];
        const p = candles[i-1];
        const hl = c.high - c.low;
        const hc = Math.abs(c.high - p.close);
        const lc = Math.abs(c.low - p.close);
        tr.push(Math.max(hl, hc, lc));
        atr.push((atr[i-1] * (period - 1) + tr[i]) / period);
    }

    // 2. Calculate Final Bands & Trend
    let basicUpper = (candles[0].high + candles[0].low) / 2 + factor * atr[0];
    let basicLower = (candles[0].high + candles[0].low) / 2 - factor * atr[0];
    
    ub.push(basicUpper);
    lb.push(basicLower);
    st.push(basicUpper);
    dir.push(1);

    for(let i = 1; i < candles.length; i++) {
        let c = candles[i];
        let p = candles[i-1];
        
        let bu = (c.high + c.low) / 2 + factor * atr[i];
        let bl = (c.high + c.low) / 2 - factor * atr[i];

        let fu = (bu < ub[i-1] || p.close > ub[i-1]) ? bu : ub[i-1];
        let fl = (bl > lb[i-1] || p.close < lb[i-1]) ? bl : lb[i-1];

        ub.push(fu);
        lb.push(fl);

        let d = dir[i-1];
        if (d === 1 && c.close < lb[i-1]) d = -1;
        else if (d === -1 && c.close > ub[i-1]) d = 1;
        
        dir.push(d);
        st.push(d === 1 ? fl : fu);
    }

    return st.map((val, i) => ({ value: val, direction: dir[i] }));
};

// --- Oanda timeframe mapping ---
const TIMEFRAME_MAP = {
    'M15': { label: '15M', minutes: 15 },
    'H1': { label: '1H', minutes: 60 },
    'H4': { label: '4H', minutes: 240 },
};

const useChartData = (instrument, timeframe) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = useCallback(async (isBackground = false) => {
        try {
            if (!isBackground) setLoading(true);
            const response = await tradingAPI.getCandles(instrument, timeframe, 100);
            
            if (response?.candles?.length > 0) {
                const candles = response.candles;
                const closes = candles.map(c => c.close);
                
                // Indicators
                const fastMA = calculateEMA(closes, 20); // EMA 20 (Purple)
                const slowMA = calculateEMA(closes, 50); // EMA 50 (Green)
                const stData = calculateSuperTrend(candles, 10, 3); // SuperTrend(10,3)

                const processed = candles.map((c, i) => ({
                    ...c,
                    time: new Date(c.time).getTime(), // Oanda uses ISO timestamp
                    fastMA: fastMA[i],
                    slowMA: slowMA[i],
                    stValue: stData[i]?.value,
                    stDir: stData[i]?.direction // 1 (Green) or -1 (Red)
                }));
                
                setData(processed);
                setError(null);
            }
        } catch (err) { setError(err.message); } 
        finally { setLoading(false); }
    }, [instrument, timeframe]);

    useEffect(() => { setData([]); fetchData(false); }, [fetchData]);
    useEffect(() => { 
        const interval = setInterval(() => fetchData(true), 60000); 
        return () => clearInterval(interval);
    }, [fetchData]);

    return { data, setData, loading, error };
};

const LivePriceChart = ({ prices = {}, assets = FOREX_INSTRUMENTS }) => {
  const theme = useTheme();
  const [selectedAsset, setSelectedAsset] = useState(assets[0] || 'AUD_USD');
  const [timeframe, setTimeframe] = useState('M15'); // Oanda format
  
  // Get instrument info
  const instrumentInfo = INSTRUMENT_INFO[selectedAsset] || {};
  
  // Ensure selected asset is valid if list changes
  useEffect(() => {
      if (assets.length > 0 && !assets.includes(selectedAsset)) setSelectedAsset(assets[0]);
  }, [assets, selectedAsset]);
  
  const { data: chartData, setData: setChartData, loading, error } = useChartData(selectedAsset, timeframe);

  // Live Candle Update (Ticker)
  useEffect(() => {
    const livePrice = prices[selectedAsset]?.mid || prices[selectedAsset]?.price;
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
        change: change,
        pct: (change / first.close) * 100,
        trend: last.stDir === 1 ? 'BULLISH' : 'BEARISH'
    };
  }, [chartData]);

  // --- TOOLTIP RENDERER ---
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload?.[0]) {
      const d = payload[0].payload;
      const isBullish = d.stDir === 1;
      return (
        <Box sx={{ 
            p: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.95), 
            border: 1, borderColor: 'divider', borderRadius: 1,
            boxShadow: theme.shadows[4], minWidth: 160
        }}>
          <Typography variant="caption" color="text.secondary">
            {new Date(d.time).toLocaleString()}
          </Typography>
          <Typography variant="h6" color="primary.main" fontWeight="bold" fontFamily="monospace">
            {formatPrice(d.close, selectedAsset)}
          </Typography>
          
          <Box mt={1} pt={1} borderTop={1} borderColor="divider">
             <Grid container spacing={1} sx={{ fontSize: 11 }}>
                 <Grid item xs={6} color="#8884d8">EMA(20): {formatPrice(d.fastMA, selectedAsset)}</Grid>
                 <Grid item xs={6} color="#82ca9d">EMA(50): {formatPrice(d.slowMA, selectedAsset)}</Grid>
                 <Grid item xs={12} sx={{ 
                     color: isBullish ? theme.palette.success.main : theme.palette.error.main,
                     fontWeight: 'bold', mt: 0.5
                 }}>
                     SuperTrend: {formatPrice(d.stValue, selectedAsset)} ({isBullish ? 'BUY' : 'SELL'})
                 </Grid>
             </Grid>
          </Box>
        </Box>
      );
    }
    return null;
  };

  // Determine Y-axis decimal places based on instrument
  const yAxisDecimals = selectedAsset.includes('JPY') ? 3 : 5;

  return (
    <Box height="100%" display="flex" flexDirection="column" sx={{ overflow: 'hidden' }}>
      
      {/* HEADER */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1} p={1}>
        {stats ? (
            <Box display="flex" gap={2} alignItems="center">
                <Box>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body1" sx={{ fontSize: '1.2rem' }}>
                            {instrumentInfo.flag || '💱'}
                        </Typography>
                        <Typography variant="h5" fontWeight="bold" fontFamily="monospace">
                            {formatPrice(stats.current, selectedAsset)}
                        </Typography>
                    </Box>
                    <Typography variant="caption" fontWeight="bold" sx={{ color: stats.change >= 0 ? 'success.main' : 'error.main' }}>
                         {stats.change >= 0 ? '+' : ''}{stats.pct.toFixed(3)}%
                    </Typography>
                </Box>
                
                {/* Trend Badge */}
                <Box 
                    sx={{ 
                        px: 1, py: 0.5, borderRadius: 1, 
                        bgcolor: alpha(stats.trend === 'BULLISH' ? theme.palette.success.main : theme.palette.error.main, 0.1),
                        border: 1, borderColor: alpha(stats.trend === 'BULLISH' ? theme.palette.success.main : theme.palette.error.main, 0.3)
                    }}
                >
                    <Typography variant="caption" fontWeight="bold" color={stats.trend === 'BULLISH' ? 'success.main' : 'error.main'}>
                        {stats.trend}
                    </Typography>
                </Box>
            </Box>
        ) : <Box />}
        
        <Box display="flex" gap={1}>
          <FormControl size="small" variant="standard" sx={{ minWidth: 110 }}>
            <Select 
                value={selectedAsset} 
                onChange={(e) => setSelectedAsset(e.target.value)}
                disableUnderline
                sx={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'primary.main' }}
            >
              {assets.map(a => (
                  <MenuItem key={a} value={a}>
                      {INSTRUMENT_INFO[a]?.flag || '💱'} {formatInstrument(a)}
                  </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Timeframe Toggle - Oanda format */}
          <ToggleButtonGroup
            value={timeframe}
            exclusive
            onChange={(e, v) => v && setTimeframe(v)}
            size="small"
            sx={{ height: 32 }}
          >
            {Object.entries(TIMEFRAME_MAP).map(([key, { label }]) => (
                <ToggleButton key={key} value={key} sx={{ px: 1, fontSize: '0.75rem' }}>
                    {label}
                </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* CHART */}
      <Box flexGrow={1} position="relative" sx={{ minHeight: 0 }}>
        {loading && !chartData.length ? (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <CircularProgress size={40} thickness={4} />
            </Box>
        ) : error ? (
            <Alert severity="error">{error}</Alert>
        ) : (
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.1}/>
                            <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.1)} vertical={false} />
                    <XAxis 
                        dataKey="time" 
                        tickFormatter={(t) => {
                            const d = new Date(t);
                            return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                        }}
                        stroke={alpha(theme.palette.text.secondary, 0.5)}
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={40}
                    />
                    <YAxis 
                        domain={['auto', 'auto']}
                        tickFormatter={(v) => v.toFixed(yAxisDecimals)}
                        stroke={alpha(theme.palette.text.secondary, 0.5)}
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        width={65}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="top" iconType="circle" height={25} wrapperStyle={{ fontSize: '11px' }} />
                    
                    {/* Price Line */}
                    <Line 
                        type="monotone" 
                        dataKey="close" 
                        stroke={theme.palette.primary.main} 
                        strokeWidth={2} 
                        dot={false} 
                        name="Price"
                        activeDot={{ r: 4 }}
                        animationDuration={500}
                    />

                    {/* EMA Lines */}
                    <Line type="monotone" dataKey="fastMA" stroke="#8884d8" strokeWidth={1} dot={false} name="EMA 20" strokeOpacity={0.6} />
                    <Line type="monotone" dataKey="slowMA" stroke="#82ca9d" strokeWidth={1} dot={false} name="EMA 50" strokeOpacity={0.6} />

                    {/* SuperTrend Lines */}
                    <Line 
                        type="stepAfter" 
                        dataKey={(d) => d.stDir === 1 ? d.stValue : null} 
                        stroke={theme.palette.success.main} 
                        strokeWidth={2} 
                        dot={false} 
                        connectNulls={false}
                        name="ST (Bull)" 
                    />
                    <Line 
                        type="stepAfter" 
                        dataKey={(d) => d.stDir === -1 ? d.stValue : null} 
                        stroke={theme.palette.error.main} 
                        strokeWidth={2} 
                        dot={false} 
                        connectNulls={false}
                        name="ST (Bear)" 
                    />

                </LineChart>
            </ResponsiveContainer>
        )}
      </Box>
    </Box>
  );
};

export default LivePriceChart;