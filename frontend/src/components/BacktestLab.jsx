// frontend/src/components/BacktestLab.jsx
import React, { useState } from 'react';
import { 
    Box, Typography, Grid, Paper, TextField, Button, 
    CircularProgress, Chip, useTheme, InputAdornment,
    Divider, Stack, Alert
} from '@mui/material';
import { 
    Science, PlayArrow, TrendingUp, History,
    AttachMoney, BarChart
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts';
import { apiCall } from '../config/api';

const BacktestLab = () => {
    const theme = useTheme();
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    // Default configuration (Intraday Momentum Defaults)
    const [config, setConfig] = useState({
        minAdx: 25,
        maxRsi: 70,
        stopLoss: 2.0,
        riskPerTrade: 0.95, // 95% of balance per trade (compounding)
        balance: 1000,
        assets: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'NEARUSDT'] 
    });

    const handleRun = async () => {
        setLoading(true);
        setResults(null);
        setError(null);
        try {
            const data = await apiCall('/api/backtest/run', {
                method: 'POST',
                body: JSON.stringify(config)
            });
            
            if (data.error) throw new Error(data.error);
            setResults(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field, val) => {
        setConfig(prev => ({ ...prev, [field]: val }));
    };

    return (
        <Box p={3} height="100%" display="flex" flexDirection="column" gap={3} sx={{ overflowY: 'auto' }}>
            {/* Header */}
            <Box display="flex" alignItems="center" gap={2}>
                <Science fontSize="large" color="primary" />
                <Box>
                    <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>
                        STRATEGY <span style={{ color: theme.palette.primary.main }}>LAB</span>
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
                        ISOLATED SIMULATION ENVIRONMENT • 15M TIMEFRAME
                    </Typography>
                </Box>
            </Box>

            <Grid container spacing={3} sx={{ flexGrow: 1 }}>
                
                {/* LEFT COLUMN: Controls */}
                <Grid item xs={12} md={3}>
                    <Paper sx={{ p: 3, height: '100%', borderRadius: 4 }}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="text.secondary">
                            STRATEGY PARAMETERS
                        </Typography>
                        
                        <Stack spacing={3} mt={3}>
                            <TextField 
                                label="Min ADX Strength" 
                                type="number" 
                                value={config.minAdx}
                                onChange={(e) => handleChange('minAdx', e.target.value)}
                                size="small"
                                helperText="Trend Floor (e.g. 25)"
                            />
                             <TextField 
                                label="Max RSI Ceiling" 
                                type="number" 
                                value={config.maxRsi}
                                onChange={(e) => handleChange('maxRsi', e.target.value)}
                                size="small"
                                helperText="Overbought Filter (e.g. 70)"
                            />
                             <TextField 
                                label="Stop Loss" 
                                type="number" 
                                value={config.stopLoss}
                                onChange={(e) => handleChange('stopLoss', e.target.value)}
                                size="small"
                                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                            />
                             <TextField 
                                label="Initial Capital" 
                                type="number" 
                                value={config.balance}
                                onChange={(e) => handleChange('balance', e.target.value)}
                                size="small"
                                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                            />

                            <Divider />

                            <Button 
                                variant="contained" 
                                size="large" 
                                startIcon={loading ? <CircularProgress size={20} color="inherit"/> : <PlayArrow />}
                                onClick={handleRun}
                                disabled={loading}
                                sx={{ py: 1.5, fontWeight: 'bold', fontSize: '1rem' }}
                            >
                                {loading ? "SIMULATING..." : "RUN TEST"}
                            </Button>
                        </Stack>
                    </Paper>
                </Grid>

                {/* RIGHT COLUMN: Results */}
                <Grid item xs={12} md={9}>
                    <Paper sx={{ p: 3, height: '100%', minHeight: 500, borderRadius: 4, display: 'flex', flexDirection: 'column' }}>
                        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                        
                        {!results ? (
                            <Box flexGrow={1} display="flex" alignItems="center" justifyContent="center" flexDirection="column" opacity={0.3}>
                                <Science sx={{ fontSize: 80, mb: 2 }} />
                                <Typography variant="h6" fontWeight="bold">READY TO SIMULATE</Typography>
                                <Typography variant="body2">Adjust parameters and click Run Test</Typography>
                            </Box>
                        ) : (
                            <>
                                {/* Result Stats */}
                                <Grid container spacing={2} mb={4}>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} bgcolor={alpha(results.stats.netProfit > 0 ? theme.palette.success.main : theme.palette.error.main, 0.1)} borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">NET PROFIT</Typography>
                                            <Typography variant="h5" fontWeight="bold" color={results.stats.netProfit > 0 ? "success.main" : "error.main"}>
                                                {results.stats.netProfit > 0 ? "+" : ""}${results.stats.netProfit.toFixed(2)}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">WIN RATE</Typography>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <Typography variant="h5" fontWeight="bold">{results.stats.winRate.toFixed(1)}%</Typography>
                                                <TrendingUp fontSize="small" color={results.stats.winRate > 50 ? "success" : "warning"} />
                                            </Box>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">TOTAL TRADES</Typography>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <Typography variant="h5" fontWeight="bold">{results.stats.totalTrades}</Typography>
                                                <History fontSize="small" color="primary" />
                                            </Box>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">FINAL EQUITY</Typography>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <Typography variant="h5" fontWeight="bold">${results.stats.finalBalance.toFixed(0)}</Typography>
                                                <AttachMoney fontSize="small" color="action" />
                                            </Box>
                                        </Box>
                                    </Grid>
                                </Grid>

                                {/* Chart */}
                                <Box flexGrow={1} minHeight={300} position="relative">
                                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                                        <BarChart fontSize="small" color="primary" /> EQUITY GROWTH CURVE
                                    </Typography>
                                    {results.equityCurve && results.equityCurve.length > 0 ? (
                                        <LineChart
                                            xAxis={[{ 
                                                data: results.equityCurve.map((_, i) => i), 
                                                label: 'Time (Sampled)',
                                                tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 } 
                                            }]}
                                            series={[{
                                                data: results.equityCurve.map(d => d.value),
                                                area: true,
                                                showMark: false,
                                                color: theme.palette.primary.main,
                                                label: 'Portfolio Value ($)'
                                            }]}
                                            height={350}
                                            margin={{ left: 50, right: 20, top: 20, bottom: 30 }}
                                            sx={{
                                                '.MuiChartsAxis-line': { stroke: alpha(theme.palette.text.secondary, 0.2) },
                                                '.MuiChartsAxis-tick': { stroke: alpha(theme.palette.text.secondary, 0.2) },
                                            }}
                                        />
                                    ) : (
                                        <Box height="100%" display="flex" alignItems="center" justifyContent="center">
                                            <Typography variant="caption">Insufficient data for chart</Typography>
                                        </Box>
                                    )}
                                </Box>
                            </>
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default BacktestLab;