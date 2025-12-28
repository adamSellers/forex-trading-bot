// frontend/src/components/BacktestLab.jsx
import React, { useState, useEffect } from 'react';
import { 
    Box, Typography, Grid, Paper, TextField, Button, 
    LinearProgress, Alert, useTheme, InputAdornment,
    Divider, Stack, Chip, alpha
} from '@mui/material';
import { 
    Science, PlayArrow, TrendingUp, History,
    AttachMoney, BarChart
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts';
import { socket } from '../config/api'; // Import the shared socket instance

const BacktestLab = () => {
    const theme = useTheme();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ percent: 0, message: '' });
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    const [config, setConfig] = useState({
        minAdx: 25,
        maxRsi: 70,
        stopLoss: 2.0,
        riskPerTrade: 0.95,
        balance: 1000,
        assets: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'NEARUSDT'] 
    });

    useEffect(() => {
        // --- SOCKET LISTENERS ---
        socket.on('simulation_progress', (data) => {
            setProgress(data);
        });

        socket.on('simulation_complete', (data) => {
            setResults(data);
            setRunning(false);
            setProgress({ percent: 100, message: 'Complete' });
        });

        socket.on('simulation_error', (err) => {
            setError(err.message);
            setRunning(false);
        });

        return () => {
            socket.off('simulation_progress');
            socket.off('simulation_complete');
            socket.off('simulation_error');
        };
    }, []);

    const handleRun = () => {
        setRunning(true);
        setResults(null);
        setError(null);
        setProgress({ percent: 0, message: 'Initializing...' });
        
        // Emit trigger to backend via Socket instead of HTTP
        socket.emit('start_simulation', config);
    };

    const handleChange = (field, val) => {
        setConfig(prev => ({ ...prev, [field]: val }));
    };

    return (
        <Box p={3} height="100%" display="flex" flexDirection="column" gap={3} sx={{ overflowY: 'auto' }}>
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
                
                {/* LEFT: Controls */}
                <Grid item xs={12} md={3}>
                    <Paper sx={{ p: 3, height: '100%', borderRadius: 4 }}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="text.secondary">
                            STRATEGY PARAMETERS
                        </Typography>
                        
                        <Stack spacing={3} mt={3}>
                            <TextField 
                                label="Min ADX Strength" type="number" value={config.minAdx}
                                onChange={(e) => handleChange('minAdx', e.target.value)} size="small"
                            />
                             <TextField 
                                label="Max RSI Ceiling" type="number" value={config.maxRsi}
                                onChange={(e) => handleChange('maxRsi', e.target.value)} size="small"
                            />
                             <TextField 
                                label="Stop Loss" type="number" value={config.stopLoss}
                                onChange={(e) => handleChange('stopLoss', e.target.value)} size="small"
                                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                            />
                             <TextField 
                                label="Initial Capital" type="number" value={config.balance}
                                onChange={(e) => handleChange('balance', e.target.value)} size="small"
                                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                            />

                            <Divider />

                            <Button 
                                variant="contained" size="large" onClick={handleRun} disabled={running}
                                startIcon={!running && <PlayArrow />}
                                sx={{ py: 1.5, fontWeight: 'bold' }}
                                color={running ? "secondary" : "primary"}
                            >
                                {running ? "RUNNING..." : "RUN TEST"}
                            </Button>
                        </Stack>
                    </Paper>
                </Grid>

                {/* RIGHT: Results & Progress */}
                <Grid item xs={12} md={9}>
                    <Paper sx={{ p: 3, height: '100%', minHeight: 500, borderRadius: 4, display: 'flex', flexDirection: 'column' }}>
                        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                        
                        {/* PROGRESS BAR */}
                        {running && (
                            <Box sx={{ width: '100%', mb: 4, mt: 2 }}>
                                <Box display="flex" justifyContent="space-between" mb={1}>
                                    <Typography variant="caption" fontWeight="bold" color="primary">
                                        {progress.message.toUpperCase()}
                                    </Typography>
                                    <Typography variant="caption" fontWeight="bold">
                                        {progress.percent}%
                                    </Typography>
                                </Box>
                                <LinearProgress variant="determinate" value={progress.percent} sx={{ height: 10, borderRadius: 5 }} />
                            </Box>
                        )}
                        
                        {!results && !running ? (
                            <Box flexGrow={1} display="flex" alignItems="center" justifyContent="center" flexDirection="column" opacity={0.3}>
                                <Science sx={{ fontSize: 80, mb: 2 }} />
                                <Typography variant="h6" fontWeight="bold">READY TO SIMULATE</Typography>
                            </Box>
                        ) : results ? (
                            <>
                                {/* Stats Grid */}
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
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">TRADES</Typography>
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
                                <Box flexGrow={1} minHeight={300}>
                                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                                        <BarChart fontSize="small" color="primary" /> EQUITY GROWTH CURVE
                                    </Typography>
                                    {results.equityCurve.length > 0 && (
                                        <LineChart
                                            xAxis={[{ data: results.equityCurve.map((_, i) => i), label: 'Time', tickLabelStyle: { fill: theme.palette.text.secondary, fontSize: 10 } }]}
                                            series={[{
                                                data: results.equityCurve.map(d => d.value),
                                                area: true, showMark: false, color: theme.palette.primary.main
                                            }]}
                                            height={350}
                                        />
                                    )}
                                </Box>
                            </>
                        ) : null}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default BacktestLab;