// frontend/src/components/SignalCard.jsx
import React from 'react';
import { Card, CardContent, Grid, Typography, Chip, Box, Tooltip } from '@mui/material';
import {
    ArrowUpward,
    ArrowDownward,
    TrendingFlat,
    HourglassEmpty,
    Block,
    InfoOutlined,
    ReportProblemOutlined,
    DataUsage,
    ShowChart
} from '@mui/icons-material';

const getSignalChipProps = (signal) => {
    if (!signal) return { label: 'N/A', color: 'default', icon: <HourglassEmpty /> };

    const s = signal.signal || 'HOLD';
    // Logic to determine color/icon based on signal string
    if (s.includes('BUY')) return { label: s.replace('_', ' '), color: 'success', icon: <ArrowUpward /> };
    if (s.includes('SELL')) return { label: s.replace('_', ' '), color: 'error', icon: <ArrowDownward /> };
    if (s.includes('HOLD')) return { label: s.replace('_', ' '), color: 'info', icon: <TrendingFlat /> };
    if (s === 'LOW_VOLATILITY') return { label: 'LOW VOL', color: 'warning', icon: <Block /> };
    if (s === 'COOLDOWN') return { label: 'COOLDOWN', color: 'secondary', icon: <HourglassEmpty /> };
    if (s === 'WEAK_SIGNAL') return { label: 'WEAK', color: 'secondary', icon: <InfoOutlined /> };
    if (s === 'INSUFFICIENT_DATA') return { label: 'BUILDING', color: 'secondary', icon: <DataUsage /> };
    if (s === 'ERROR') return { label: 'ERROR', color: 'error', icon: <ReportProblemOutlined /> };

    return { label: s, color: 'default', icon: <HourglassEmpty /> };
};

const SignalCard = ({ signal }) => {
    if (!signal) return null;

    const chipProps = getSignalChipProps(signal);
    const assetName = signal.symbol.replace('USDT', '');
    
    // Parse trend data if available (Assuming it's stored in trend_data JSON)
    let rsiVal = null;
    let trendDir = null;
    
    try {
        if (signal.trend_data) {
            const data = typeof signal.trend_data === 'string' 
                ? JSON.parse(signal.trend_data) 
                : signal.trend_data;
            
            if (data.rsi) rsiVal = parseFloat(data.rsi).toFixed(1);
            if (data.supertrend_direction) trendDir = data.supertrend_direction;
        }
    } catch (e) {
        // Fallback or ignore parse errors
    }

    // Determine Trend Label
    // If explicit trend data is missing, infer from Signal (Buy=Bull, Sell=Bear)
    const isBullish = trendDir === 1 || (signal.signal || '').includes('BUY');
    const isBearish = trendDir === -1 || (signal.signal || '').includes('SELL');

    return (
        <Card variant="outlined" sx={{ mb: 1, '&:hover': { bgcolor: 'action.hover' } }}>
            <CardContent sx={{ p: '12px !important' }}>
                <Grid container alignItems="center" spacing={2}>
                    
                    {/* COL 1: Asset & Timeframe */}
                    <Grid item xs={3} sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Typography variant="body2" fontWeight="bold">{assetName}</Typography>
                        <Chip 
                            label={signal.timeframe || '15m'} 
                            size="small" 
                            variant="outlined" 
                            sx={{ 
                                height: 18, 
                                fontSize: '0.65rem', 
                                mt: 0.5, 
                                width: 'fit-content',
                                borderColor: 'text.disabled'
                            }} 
                        />
                    </Grid>

                    {/* COL 2: Signal Type */}
                    <Grid item xs={3}>
                        <Tooltip title={signal.message || signal.signal} placement="top">
                            <Chip
                                icon={chipProps.icon}
                                label={chipProps.label}
                                color={chipProps.color}
                                size="small"
                                sx={{ width: '100%', justifyContent: 'flex-start', fontWeight: 'bold' }}
                            />
                        </Tooltip>
                    </Grid>

                    {/* COL 3: NEW - Trend Context (Replaces Price) */}
                    <Grid item xs={3} textAlign="center">
                        <Box display="flex" flexDirection="column" alignItems="center">
                            {/* RSI Badge */}
                            {rsiVal && (
                                <Typography 
                                    variant="caption" 
                                    sx={{ 
                                        color: rsiVal > 70 ? 'error.main' : rsiVal < 30 ? 'success.main' : 'text.secondary',
                                        fontWeight: 'bold',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.5
                                    }}
                                >
                                    <ShowChart sx={{ fontSize: 12 }} /> RSI: {rsiVal}
                                </Typography>
                            )}
                            
                            {/* Trend Direction Text */}
                            <Typography 
                                variant="caption" 
                                sx={{ 
                                    color: isBullish ? 'success.main' : isBearish ? 'error.main' : 'text.disabled',
                                    fontWeight: 'bold',
                                    fontSize: '0.7rem',
                                    mt: 0.2
                                }}
                            >
                                {isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : 'NEUTRAL'}
                            </Typography>
                        </Box>
                    </Grid>

                    {/* COL 4: Strength (ADX/ATR) */}
                    <Grid item xs={3} textAlign="right">
                        <Box>
                            <Typography variant="body2" fontWeight="500">
                                {signal.strength?.toFixed(1) || '0.0'} 
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem' }}>
                                ADX
                            </Typography>
                        </Box>
                    </Grid>
                </Grid>
                
                {/* Optional Message Footer */}
                {signal.message && (
                    <Box mt={1} pt={0.5} borderTop={1} borderColor="divider">
                      <Typography 
                        variant="caption" 
                        color="text.secondary"
                        sx={{ fontStyle: 'italic', fontSize: '0.7rem' }}
                      >
                        {signal.message}
                      </Typography>
                    </Box>
                  )}
            </CardContent>
        </Card>
    );
};

export default SignalCard;