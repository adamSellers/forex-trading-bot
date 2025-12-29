// frontend/src/components/BacktestLab.jsx
import React, { useState, useEffect } from 'react';
import { 
    Box, Typography, Grid, Paper, TextField, Button, 
    LinearProgress, Alert, useTheme, Stack, Chip, 
    MenuItem, Select, FormControl, InputLabel, Slider, 
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Divider, alpha, Tooltip, InputAdornment
} from '@mui/material';
import { 
    Science, PlayArrow, BarChart, Restore, PieChart
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts';
import { socket } from '../config/api';

const AVAILABLE_ASSETS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 
    'NEARUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT', 'MATICUSDT'
];

const BacktestLab = () => {
    const theme = useTheme();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ percent: 0, message: '' });
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    // Configuration State
    const [config, setConfig] = useState({
        minAdx: 25,
        maxRsi: 70,
        stopLoss: 2.0,
        riskPerTrade: 0.95,
        balance: 1000,
        days: 30, 
        assets: ['BTCUSDT', 'ETHUSDT'],
        weights: { 'BTCUSDT': 50, 'ETHUSDT': 50 } // Default weights
    });

    useEffect(() => {
        const onProgress = (data) => setProgress(data);
        const onComplete = (data) => {
            setResults(data);
            setRunning(false);
            setProgress({ percent: 100, message: 'Simulation Complete' });
        };
        const onError = (err) => {
            setError(err.message || "An unknown error occurred");
            setRunning(false);
        };

        socket.on('simulation_progress', onProgress);
        socket.on('simulation_complete', onComplete);
        socket.on('simulation_error', onError);

        return () => {
            socket.off('simulation_progress', onProgress);
            socket.off('simulation_complete', onComplete);
            socket.off('simulation_error', onError);
        };
    }, []);

    const handleRun = (forceRebuild = false) => {
        setRunning(true);
        setResults(null);
        setError(null);
        setProgress({ percent: 0, message: forceRebuild ? 'Reinitializing Data...' : 'Initializing Worker...' });
        socket.emit('start_simulation', { ...config, forceRebuild });
    };

    const handleChange = (field, val) => {
        setConfig(prev => ({ ...prev, [field]: val }));
    };

    // Special handler for assets to auto-balance weights
    const handleAssetChange = (newAssets) => {
        const newWeights = {};
        const count = newAssets.length;
        const equalShare = count > 0 ? parseFloat((100 / count).toFixed(1)) : 0;
        
        newAssets.forEach(asset => {
            // Preserve existing weight if possible, else use equal share
            newWeights[asset] = config.weights[asset] || equalShare;
        });

        setConfig(prev => ({ 
            ...prev, 
            assets: newAssets,
            weights: newWeights
        }));
    };

    const handleWeightChange = (asset, val) => {
        setConfig(prev => ({
            ...prev,
            weights: { ...prev.weights, [asset]: parseFloat(val) || 0 }
        }));
    };

    return (
        <Box p={3} height="100%" display="flex" flexDirection="column" gap={3} sx={{ overflowY: 'auto' }}>
            <Box display="flex" alignItems="center" justifyContent="space-between">
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
            </Box>

            <Grid container spacing={3} sx={{ flexGrow: 1 }}>
                
                {/* LEFT COLUMN: Controls */}
                <Grid item xs={12} md={4} lg={3}>
                    <Paper sx={{ p: 3, height: '100%', borderRadius: 4 }}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="text.secondary">
                            CONFIGURATION
                        </Typography>
                        
                        <Stack spacing={3} mt={3}>
                            {/* 1. ASSET SELECTOR */}
                            <FormControl size="small" fullWidth>
                                <InputLabel id="asset-select-label">Assets to Test</InputLabel>
                                <Select
                                    labelId="asset-select-label"
                                    multiple
                                    value={config.assets}
                                    onChange={(e) => handleAssetChange(e.target.value)}
                                    label="Assets to Test"
                                    renderValue={(selected) => (
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                            {selected.map((value) => (
                                                <Chip key={value} label={value.replace('USDT','')} size="small" />
                                            ))}
                                        </Box>
                                    )}
                                >
                                    {AVAILABLE_ASSETS.map((asset) => (
                                        <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            {/* 2. DYNAMIC WEIGHTS */}
                            {config.assets.length > 0 && (
                                <Box sx={{ bgcolor: alpha(theme.palette.background.default, 0.5), p: 2, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                                    <Typography variant="caption" fontWeight="bold" display="flex" alignItems="center" gap={1} mb={1}>
                                        <PieChart fontSize="inherit" /> ALLOCATION WEIGHTS (%)
                                    </Typography>
                                    <Grid container spacing={1}>
                                        {config.assets.map(asset => (
                                            <Grid item xs={6} key={asset}>
                                                <TextField 
                                                    label={asset.replace("USDT", "")}
                                                    type="number"
                                                    value={config.weights[asset]}
                                                    onChange={(e) => handleWeightChange(asset, e.target.value)}
                                                    size="small"
                                                    InputProps={{
                                                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                                        style: { fontSize: '0.8rem' }
                                                    }}
                                                />
                                            </Grid>
                                        ))}
                                    </Grid>
                                </Box>
                            )}

                            {/* 3. DAYS SLIDER */}
                            <Box>
                                <Typography variant="caption" gutterBottom>
                                    History Duration: <strong>{config.days} Days</strong>
                                </Typography>
                                <Slider 
                                    value={typeof config.days === 'number' ? config.days : 30}
                                    min={7} 
                                    max={120} 
                                    onChange={(e, v) => handleChange('days', v)} 
                                    valueLabelDisplay="auto"
                                    size="small"
                                />
                            </Box>

                            <Divider />

                            {/* 4. STRATEGY PARAMS */}
                            <TextField 
                                label="Min ADX Threshold" type="number" 
                                value={config.minAdx}
                                onChange={(e) => handleChange('minAdx', e.target.value)} 
                                size="small"
                                InputProps={{ inputProps: { min: 0, max: 100 } }}
                            />
                             <TextField 
                                label="Max RSI Ceiling" type="number" 
                                value={config.maxRsi}
                                onChange={(e) => handleChange('maxRsi', e.target.value)} 
                                size="small"
                                InputProps={{ inputProps: { min: 0, max: 100 } }}
                            />
                             <TextField 
                                label="Stop Loss (%)" type="number" 
                                value={config.stopLoss}
                                onChange={(e) => handleChange('stopLoss', e.target.value)} 
                                size="small"
                            />
                             <TextField 
                                label="Start Balance ($)" type="number" 
                                value={config.balance}
                                onChange={(e) => handleChange('balance', e.target.value)} 
                                size="small"
                            />

                            <Stack direction="row" spacing={1} mt={2}>
                                <Button 
                                    variant="contained" 
                                    size="large" 
                                    onClick={() => handleRun(false)} 
                                    disabled={running}
                                    startIcon={!running && <PlayArrow />}
                                    sx={{ py: 1.5, fontWeight: 'bold', flexGrow: 1 }}
                                    color={running ? "secondary" : "primary"}
                                >
                                    {running ? "RUNNING..." : "RUN TEST"}
                                </Button>
                                
                                <Tooltip title="Force Re-download & Rebuild Data">
                                    <Button
                                        variant="outlined"
                                        color="warning"
                                        onClick={() => handleRun(true)}
                                        disabled={running}
                                        sx={{ minWidth: 50, px: 1 }}
                                    >
                                        <Restore />
                                    </Button>
                                </Tooltip>
                            </Stack>
                        </Stack>
                    </Paper>
                </Grid>

                {/* RIGHT COLUMN: Results */}
                <Grid item xs={12} md={8} lg={9}>
                    <Paper sx={{ p: 3, height: '100%', minHeight: 600, borderRadius: 4, display: 'flex', flexDirection: 'column' }}>
                        
                        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                        
                        {running && (
                            <Box sx={{ width: '100%', mb: 4, mt: 2 }}>
                                <Box display="flex" justifyContent="space-between" mb={1}>
                                    <Typography variant="caption" fontWeight="bold" color="primary">
                                        {progress.message}
                                    </Typography>
                                    <Typography variant="caption" fontWeight="bold">
                                        {progress.percent}%
                                    </Typography>
                                </Box>
                                <LinearProgress variant="determinate" value={progress.percent} sx={{ height: 8, borderRadius: 4 }} />
                            </Box>
                        )}
                        
                        {!results ? (
                            !running && (
                                <Box flexGrow={1} display="flex" alignItems="center" justifyContent="center" flexDirection="column" opacity={0.3}>
                                    <Science sx={{ fontSize: 80, mb: 2 }} />
                                    <Typography variant="h6" fontWeight="bold">READY TO SIMULATE</Typography>
                                    <Typography variant="body2">Select assets, set weights, and Run Test</Typography>
                                </Box>
                            )
                        ) : (
                            <Box sx={{ animation: 'fadeIn 0.5s ease-in' }}>
                                <Grid container spacing={2} mb={4}>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} bgcolor={alpha(results.stats.netProfit > 0 ? theme.palette.success.main : theme.palette.error.main, 0.1)} borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">NET PnL</Typography>
                                            <Typography variant="h5" fontWeight="bold" color={results.stats.netProfit > 0 ? "success.main" : "error.main"}>
                                                {results.stats.netProfit > 0 ? "+" : ""}${results.stats.netProfit.toFixed(2)}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">WIN RATE</Typography>
                                            <Typography variant="h5" fontWeight="bold">{results.stats.winRate.toFixed(1)}%</Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">TRADES</Typography>
                                            <Typography variant="h5" fontWeight="bold">{results.stats.totalTrades}</Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">FINAL EQUITY</Typography>
                                            <Typography variant="h5" fontWeight="bold">${results.stats.finalBalance.toFixed(0)}</Typography>
                                        </Box>
                                    </Grid>
                                </Grid>

                                <Box flexGrow={1} minHeight={250} mb={3}>
                                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                                        <BarChart fontSize="small" color="primary" /> EQUITY GROWTH
                                    </Typography>
                                    {results.equityCurve.length > 0 ? (
                                        <LineChart
                                            xAxis={[{ 
                                                data: results.equityCurve.map((_, i) => i), 
                                                label: 'Time (Candles)', 
                                                tickLabelStyle: { fontSize: 0 } 
                                            }]}
                                            series={[{ 
                                                data: results.equityCurve.map(d => d.value), 
                                                area: true, 
                                                showMark: false, 
                                                color: theme.palette.primary.main 
                                            }]}
                                            height={250}
                                            margin={{ left: 50, right: 20, top: 10, bottom: 20 }}
                                        />
                                    ) : (
                                        <Typography variant="body2" color="text.secondary">No trades were executed.</Typography>
                                    )}
                                </Box>

                                <Box>
                                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>PERFORMANCE BY ASSET</Typography>
                                    <TableContainer component={Box} sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow sx={{ bgcolor: alpha(theme.palette.action.active, 0.05) }}>
                                                    <TableCell>Asset</TableCell>
                                                    <TableCell align="right">Trades</TableCell>
                                                    <TableCell align="right">Win Rate</TableCell>
                                                    <TableCell align="right">Net PnL</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {results.stats.assetStats.map((stat) => (
                                                    <TableRow key={stat.symbol}>
                                                        <TableCell fontWeight="bold">{stat.symbol}</TableCell>
                                                        <TableCell align="right">{stat.trades}</TableCell>
                                                        <TableCell align="right">
                                                            {stat.trades > 0 ? ((stat.wins/stat.trades)*100).toFixed(0) : 0}%
                                                        </TableCell>
                                                        <TableCell align="right" sx={{ color: stat.pnl > 0 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                                                            {stat.pnl > 0 ? '+' : ''}{stat.pnl.toFixed(2)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                                {results.stats.assetStats.length === 0 && (
                                                    <TableRow>
                                                        <TableCell colSpan={4} align="center">No trades found</TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </Box>
                            </Box>
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default BacktestLab;