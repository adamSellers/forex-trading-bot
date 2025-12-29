import React, { useState } from 'react';
import { 
    Box, Typography, Button, Slider, TextField, Stack, Chip, 
    MenuItem, Select, FormControl, InputLabel,
    IconButton, Avatar, InputAdornment, List, ListItem, 
    Grid, Switch, Tooltip, CircularProgress, alpha, useTheme
} from '@mui/material';
import { 
    PieChart, Tune, Science, AddCircle, Delete, 
    PlayArrow, AutoMode, Restore, FlashOn 
} from '@mui/icons-material';
import { GlassCard } from '../dashboard/Shared'; // Reuse our shared styles

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

const AVAILABLE_ASSETS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'NEARUSDT', 'SOLUSDT', 
    'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 
    'LTCUSDT', 'SHIBUSDT'
];

const LabControls = ({ 
    config, updateConfig, updateWeight, 
    addAsset, removeAsset, 
    onRun, onOptimize, 
    running, optimizing 
}) => {
    const theme = useTheme();
    const [newAsset, setNewAsset] = useState('');
    const totalAllocation = config.assets.reduce((sum, asset) => sum + (config.weights[asset] || 0), 0);

    const handleAddClick = () => {
        addAsset(newAsset);
        setNewAsset('');
    };

    return (
        <Stack spacing={3} height="100%">
            {/* 1. PORTFOLIO MIX */}
            <GlassCard>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                    <SectionHeader icon={<PieChart />} title="Portfolio Mix" subtitle="Asset selection & weighting" />
                    <Chip 
                        label={`Total: ${totalAllocation.toFixed(0)}%`} 
                        color={Math.abs(totalAllocation - 100) < 1 ? "success" : "warning"} 
                        variant="outlined" size="small"
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
                    <Button variant="contained" onClick={handleAddClick} disabled={!newAsset} size="small"><AddCircle /></Button>
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
                                    min={0} max={100} step={5} size="small" sx={{ mx: 2, flexGrow: 1 }} 
                                />
                                <TextField 
                                    size="small" type="number" 
                                    value={config.weights[asset]} 
                                    onChange={(e) => updateWeight(asset, e.target.value)} 
                                    InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} sx={{ width: 90 }} 
                                />
                                <IconButton size="small" color="error" onClick={() => removeAsset(asset)}><Delete fontSize="small" /></IconButton>
                            </Box>
                        </ListItem>
                    ))}
                </List>
            </GlassCard>

            {/* 2. STRATEGY PARAMS */}
            <GlassCard>
                <SectionHeader icon={<Tune />} title="Strategy Params" subtitle="SuperTrend + ADX Logic" />
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <TextField label="Min ADX" type="number" fullWidth size="small" value={config.minAdx} onChange={(e) => updateConfig('minAdx', e.target.value)} />
                    </Grid>
                    <Grid item xs={6}>
                        <TextField label="Max RSI" type="number" fullWidth size="small" value={config.maxRsi} onChange={(e) => updateConfig('maxRsi', e.target.value)} />
                    </Grid>
                    <Grid item xs={12}>
                        <Box display="flex" alignItems="center" justifyContent="space-between" p={1} border={1} borderColor="divider" borderRadius={1} bgcolor={config.burstMode ? alpha(theme.palette.warning.main, 0.1) : 'transparent'}>
                            <Box display="flex" alignItems="center" gap={1}>
                                <FlashOn fontSize="small" color={config.burstMode ? "warning" : "disabled"} />
                                <Box>
                                    <Typography variant="body2" fontWeight="bold">Burst Mode</Typography>
                                    <Typography variant="caption" color="text.secondary">Enter early if RSI &gt; 50</Typography>
                                </Box>
                            </Box>
                            <Switch checked={config.burstMode} onChange={(e) => updateConfig('burstMode', e.target.checked)} color="warning" />
                        </Box>
                    </Grid>
                    <Grid item xs={12}>
                        <Typography variant="caption" gutterBottom>Hard Stop Loss ({config.stopLoss}%)</Typography>
                        <Slider value={parseFloat(config.stopLoss)} min={0.5} max={10} step={0.1} onChange={(_, v) => updateConfig('stopLoss', v)} />
                    </Grid>
                </Grid>
            </GlassCard>

            {/* 3. SIMULATION SETTINGS */}
            <GlassCard>
                <SectionHeader icon={<Science />} title="Simulation" subtitle="Environment settings" />
                <Box mb={2}>
                    <Typography variant="caption" gutterBottom>Duration: {config.days} Days</Typography>
                    <Slider value={config.days} min={7} max={120} onChange={(_, v) => updateConfig('days', v)} />
                </Box>
                <TextField label="Start Balance ($)" type="number" fullWidth size="small" value={config.balance} onChange={(e) => updateConfig('balance', e.target.value)} />
            </GlassCard>

            {/* 4. ACTIONS */}
            <Stack direction="row" spacing={1}>
                <Button 
                    variant="contained" size="large" onClick={() => onRun(false)} disabled={running || optimizing}
                    startIcon={!running && <PlayArrow />} sx={{ py: 1.5, fontWeight: 'bold', flexGrow: 2 }} color={running ? "secondary" : "primary"}
                >
                    {running ? "RUNNING..." : "RUN TEST"}
                </Button>
                <Tooltip title="🤖 AI Optimizer">
                    <Button 
                        variant="contained" color="secondary" onClick={onOptimize} disabled={running || optimizing}
                        sx={{ minWidth: 60 }}
                    >
                        {optimizing ? <CircularProgress size={24} color="inherit" /> : <AutoMode />}
                    </Button>
                </Tooltip>
                <Tooltip title="Force Rebuild DB">
                    <Button variant="outlined" color="warning" onClick={() => onRun(true)} disabled={running || optimizing} sx={{ minWidth: 50 }}>
                        <Restore />
                    </Button>
                </Tooltip>
            </Stack>
        </Stack>
    );
};

export default LabControls;