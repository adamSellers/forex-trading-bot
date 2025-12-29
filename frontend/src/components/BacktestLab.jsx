// frontend/src/components/BacktestLab.jsx
import React, { useState, useEffect } from 'react';
import { 
    Box, Typography, Grid, Button, Slider, TextField,
    LinearProgress, Alert, useTheme, Stack, Chip, 
    MenuItem, Select, FormControl, InputLabel,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Divider, alpha, Tooltip, IconButton, Avatar, styled, InputAdornment,
    List, ListItem, AlertTitle
} from '@mui/material';
import { 
    Science, PlayArrow, BarChart, Restore, PieChart, 
    Tune, Delete, AddCircle, Memory, Timer, Storage, Warning // <--- FIXED: Added Warning import
} from '@mui/icons-material';
import { LineChart } from '@mui/x-charts';
import { socket } from '../config/api';

// --- STYLED COMPONENTS ---
const GlassCard = styled(Box)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  padding: theme.spacing(3),
  transition: 'border-color 0.3s ease',
  height: '100%',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  }
}));

const SectionHeader = ({ icon, title, subtitle }) => {
    const theme = useTheme();
    return (
        <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Avatar variant="rounded" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main }}>
                {icon}
            </Avatar>
            <Box>
                <Typography variant="h6" fontWeight="bold" lineHeight={1.2}>{title}</Typography>
                {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
            </Box>
        </Box>
    );
};

// --- CONSTANTS ---
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
    const [newAsset, setNewAsset] = useState('');

    // Configuration State
    const [config, setConfig] = useState({
        minAdx: 25,
        maxRsi: 70,
        stopLoss: 2.0,
        riskPerTrade: 0.95,
        balance: 1000,
        days: 30, 
        assets: ['BTCUSDT', 'ETHUSDT'],
        weights: { 'BTCUSDT': 50, 'ETHUSDT': 50 } 
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

    // --- SMART ERROR PARSER ---
    const getHelpfulError = (errMsg) => {
        if (!errMsg) return null;
        
        if (errMsg.includes("Memory") || errMsg.includes("SIGKILL") || errMsg.includes("heap")) {
            return {
                title: "Out of Memory (OOM)",
                msg: "The simulation used too much RAM for the Raspberry Pi.",
                advice: "Try reducing the 'History Duration' (e.g. 30 days) or testing fewer assets at once.",
                icon: <Memory fontSize="inherit" />
            };
        }
        if (errMsg.includes("timed out") || errMsg.includes("limit")) {
            return {
                title: "Operation Timed Out",
                msg: "Downloading or processing data took too long.",
                advice: "If this is your first run with new assets, try running it again (data may be partially cached). Otherwise, reduce the duration slider.",
                icon: <Timer fontSize="inherit" />
            };
        }
        if (errMsg.includes("Schema") || errMsg.includes("column") || errMsg.includes("no such table")) {
            return {
                title: "Database Mismatch",
                msg: "The internal database structure is outdated.",
                advice: "Click the orange 'Restore' button below to force a rebuild.",
                icon: <Storage fontSize="inherit" />
            };
        }
        return {
            title: "Simulation Failed",
            msg: errMsg,
            advice: "Check the system logs for details.",
            icon: <Warning fontSize="inherit" />
        };
    };

    // --- HANDLERS ---

    const handleRun = (forceRebuild = false) => {
        setRunning(true);
        setResults(null);
        setError(null);
        setProgress({ percent: 0, message: forceRebuild ? 'Reinitializing Data...' : 'Initializing Worker...' });
        socket.emit('start_simulation', { ...config, forceRebuild });
    };

    const updateConfig = (field, val) => {
        setConfig(prev => ({ ...prev, [field]: val }));
    };

    const handleAddAsset = () => {
        if (!newAsset || config.assets.includes(newAsset)) return;
        
        const updatedAssets = [...config.assets, newAsset];
        const newWeight = parseFloat((100 / updatedAssets.length).toFixed(1));
        const updatedWeights = {};
        
        updatedAssets.forEach(a => {
            updatedWeights[a] = newWeight; 
        });

        setConfig(prev => ({
            ...prev,
            assets: updatedAssets,
            weights: updatedWeights
        }));
        setNewAsset('');
    };

    const handleRemoveAsset = (assetToRemove) => {
        const updatedAssets = config.assets.filter(a => a !== assetToRemove);
        const updatedWeights = { ...config.weights };
        delete updatedWeights[assetToRemove];
        
        setConfig(prev => ({ ...prev, assets: updatedAssets, weights: updatedWeights }));
    };

    const updateWeight = (asset, val) => {
        setConfig(prev => ({
            ...prev,
            weights: { ...prev.weights, [asset]: parseFloat(val) || 0 }
        }));
    };

    const totalAllocation = config.assets.reduce((sum, asset) => sum + (config.weights[asset] || 0), 0);


    // --- RENDER HELPERS ---

    const renderControls = () => (
        <Stack spacing={3} height="100%">
            {/* 1. PORTFOLIO CONFIG */}
            <GlassCard>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                    <SectionHeader icon={<PieChart />} title="Portfolio Mix" subtitle="Asset selection & weighting" />
                    <Chip 
                        label={`Total: ${totalAllocation.toFixed(0)}%`} 
                        color={Math.abs(totalAllocation - 100) < 1 ? "success" : "warning"} 
                        variant="outlined" 
                        size="small"
                    />
                </Stack>
                
                <Box display="flex" gap={1} mb={2} p={1.5} bgcolor={alpha(theme.palette.background.paper, 0.3)} borderRadius={2}>
                    <FormControl size="small" fullWidth>
                        <InputLabel>Add Asset</InputLabel>
                        <Select value={newAsset} label="Add Asset" onChange={(e) => setNewAsset(e.target.value)}>
                            {AVAILABLE_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (
                                <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button variant="contained" onClick={handleAddAsset} disabled={!newAsset} size="small"><AddCircle /></Button>
                </Box>

                <List disablePadding sx={{ maxHeight: 250, overflowY: 'auto' }}>
                    {config.assets.map((asset) => (
                        <ListItem key={asset} sx={{ borderBottom: 1, borderColor: 'divider', px: 0, py: 1 }}>
                            <Box display="flex" alignItems="center" width="100%">
                                <Avatar sx={{ width: 24, height: 24, mr: 1, fontSize: '0.6rem', bgcolor: 'primary.main' }}>{asset.substring(0,1)}</Avatar>
                                <Typography variant="body2" fontWeight="bold" sx={{ minWidth: 60 }}>{asset.replace('USDT','')}</Typography>
                                <Slider 
                                    value={config.weights[asset] || 0} 
                                    onChange={(_, v) => updateWeight(asset, v)} 
                                    min={0} max={100} step={5} 
                                    size="small"
                                    sx={{ mx: 2, flexGrow: 1 }} 
                                />
                                <TextField 
                                    size="small" type="number" 
                                    value={config.weights[asset] || 0} 
                                    onChange={(e) => updateWeight(asset, e.target.value)} 
                                    InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment>, style: { fontSize: '0.8rem' } }} 
                                    sx={{ width: 75 }} 
                                />
                                <IconButton size="small" color="error" onClick={() => handleRemoveAsset(asset)}><Delete fontSize="small" /></IconButton>
                            </Box>
                        </ListItem>
                    ))}
                    {config.assets.length === 0 && <Typography variant="caption" color="text.secondary" align="center" display="block" py={2}>No assets selected</Typography>}
                </List>
            </GlassCard>

            {/* 2. STRATEGY PARAMS */}
            <GlassCard>
                <SectionHeader icon={<Tune />} title="Strategy Params" subtitle="SuperTrend + ADX Logic" />
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <TextField 
                            label="Min ADX" type="number" fullWidth size="small"
                            value={config.minAdx} onChange={(e) => updateConfig('minAdx', e.target.value)} 
                        />
                    </Grid>
                    <Grid item xs={6}>
                        <TextField 
                            label="Max RSI" type="number" fullWidth size="small"
                            value={config.maxRsi} onChange={(e) => updateConfig('maxRsi', e.target.value)} 
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <Typography variant="caption" gutterBottom>Stop Loss ({config.stopLoss}%)</Typography>
                        <Slider 
                            value={parseFloat(config.stopLoss)} 
                            min={0.5} max={10} step={0.1}
                            onChange={(_, v) => updateConfig('stopLoss', v)} 
                            valueLabelDisplay="auto"
                        />
                    </Grid>
                </Grid>
            </GlassCard>

             {/* 3. SIMULATION SETTINGS */}
             <GlassCard>
                <SectionHeader icon={<Science />} title="Simulation" subtitle="Environment settings" />
                <Box mb={2}>
                    <Typography variant="caption" gutterBottom>Duration: {config.days} Days</Typography>
                    <Slider 
                        value={config.days} min={7} max={120} 
                        onChange={(_, v) => updateConfig('days', v)} 
                        valueLabelDisplay="auto"
                    />
                </Box>
                <TextField 
                    label="Start Balance ($)" type="number" fullWidth size="small"
                    value={config.balance} onChange={(e) => updateConfig('balance', e.target.value)} 
                />
            </GlassCard>

            {/* ACTION BUTTONS */}
            <Stack direction="row" spacing={1}>
                <Button 
                    variant="contained" size="large" onClick={() => handleRun(false)} disabled={running}
                    startIcon={!running && <PlayArrow />}
                    sx={{ py: 1.5, fontWeight: 'bold', flexGrow: 1 }}
                    color={running ? "secondary" : "primary"}
                >
                    {running ? "RUNNING..." : "RUN TEST"}
                </Button>
                <Tooltip title="Force Rebuild DB (Fixes Schema/Missing Data)">
                    <Button variant="outlined" color="warning" onClick={() => handleRun(true)} disabled={running}>
                        <Restore />
                    </Button>
                </Tooltip>
            </Stack>
        </Stack>
    );

    return (
        <Box p={3} height="100%" display="flex" flexDirection="column" sx={{ overflowY: 'auto' }}>
            {/* PAGE HEADER */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Box>
                    <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>
                        STRATEGY <span style={{ color: theme.palette.primary.main }}>LAB</span>
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
                        ISOLATED SIMULATION ENVIRONMENT • 15M TIMEFRAME
                    </Typography>
                </Box>
            </Box>

            {/* MAIN GRID */}
            <Grid container spacing={3}>
                
                {/* LEFT: CONFIGURATION */}
                <Grid item xs={12} md={4} lg={3}>
                    {renderControls()}
                </Grid>

                {/* RIGHT: RESULTS */}
                <Grid item xs={12} md={8} lg={9}>
                     <GlassCard>
                        {/* SMART ERROR DISPLAY */}
                        {error && (() => {
                            const errInfo = getHelpfulError(error);
                            return (
                                <Alert 
                                    severity="error" 
                                    icon={errInfo.icon}
                                    sx={{ mb: 2, alignItems: 'center' }}
                                >
                                    <AlertTitle sx={{ fontWeight: 'bold' }}>{errInfo.title}</AlertTitle>
                                    <Typography variant="body2" sx={{ mb: 1 }}>{errInfo.msg}</Typography>
                                    <Chip 
                                        label={errInfo.advice} 
                                        color="error" 
                                        variant="outlined" 
                                        size="small" 
                                        sx={{ fontWeight: 'bold' }} 
                                    />
                                </Alert>
                            );
                        })()}
                        
                        {running && (
                            <Box sx={{ width: '100%', mb: 4, mt: 2 }}>
                                <Box display="flex" justifyContent="space-between" mb={1}>
                                    <Typography variant="caption" fontWeight="bold" color="primary">{progress.message}</Typography>
                                    <Typography variant="caption" fontWeight="bold">{progress.percent}%</Typography>
                                </Box>
                                <LinearProgress variant="determinate" value={progress.percent} sx={{ height: 8, borderRadius: 4 }} />
                            </Box>
                        )}
                        
                        {!results ? (
                            !running && (
                                <Box height="100%" display="flex" alignItems="center" justifyContent="center" flexDirection="column" opacity={0.3} minHeight={400}>
                                    <Science sx={{ fontSize: 100, mb: 2 }} />
                                    <Typography variant="h5" fontWeight="bold">READY TO SIMULATE</Typography>
                                    <Typography variant="body1">Configure your portfolio and press Run</Typography>
                                </Box>
                            )
                        ) : (
                            <Box sx={{ animation: 'fadeIn 0.5s ease-in' }}>
                                {/* KPI CARDS */}
                                <Grid container spacing={2} mb={4}>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} bgcolor={alpha(results.stats.netProfit > 0 ? theme.palette.success.main : theme.palette.error.main, 0.1)} borderRadius={2} border={1} borderColor="divider">
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">NET PnL</Typography>
                                            <Typography variant="h4" fontWeight="bold" color={results.stats.netProfit > 0 ? "success.main" : "error.main"}>
                                                {results.stats.netProfit > 0 ? "+" : ""}${results.stats.netProfit.toFixed(2)}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">WIN RATE</Typography>
                                            <Typography variant="h4" fontWeight="bold">{results.stats.winRate.toFixed(1)}%</Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">TRADES</Typography>
                                            <Typography variant="h4" fontWeight="bold">{results.stats.totalTrades}</Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6} md={3}>
                                        <Box p={2} border={1} borderColor="divider" borderRadius={2}>
                                            <Typography variant="caption" fontWeight="bold" color="text.secondary">FINAL EQUITY</Typography>
                                            <Typography variant="h4" fontWeight="bold">${results.stats.finalBalance.toFixed(0)}</Typography>
                                        </Box>
                                    </Grid>
                                </Grid>

                                {/* CHART */}
                                <Box flexGrow={1} minHeight={300} mb={3}>
                                    <SectionHeader icon={<BarChart />} title="Equity Curve" subtitle="Portfolio growth over time" />
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
                                                color: theme.palette.primary.main,
                                                curve: 'linear'
                                            }]}
                                            height={300}
                                            margin={{ left: 60, right: 20, top: 10, bottom: 30 }}
                                        />
                                    ) : (
                                        <Alert severity="warning">No trades executed with current parameters.</Alert>
                                    )}
                                </Box>

                                {/* TABLE */}
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
                                                        <TableCell fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <Avatar sx={{ width: 20, height: 20, fontSize: '0.6rem' }}>{stat.symbol[0]}</Avatar>
                                                            {stat.symbol}
                                                        </TableCell>
                                                        <TableCell align="right">{stat.trades}</TableCell>
                                                        <TableCell align="right">
                                                            {stat.trades > 0 ? ((stat.wins/stat.trades)*100).toFixed(0) : 0}%
                                                        </TableCell>
                                                        <TableCell align="right" sx={{ color: stat.pnl > 0 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                                                            {stat.pnl > 0 ? '+' : ''}{stat.pnl.toFixed(2)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </Box>
                            </Box>
                        )}
                    </GlassCard>
                </Grid>
            </Grid>
        </Box>
    );
};

export default BacktestLab;