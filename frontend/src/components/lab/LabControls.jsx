// frontend/src/components/lab/LabControls.jsx
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
import { GlassCard } from '../dashboard/Shared';

const SectionHeader = ({ icon, title, subtitle }) => {
    const theme = useTheme();
    return (
        <Box display="flex" alignItems="center" gap={1.5} mb={2}>
            <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main }}>
                {React.cloneElement(icon, { fontSize: "small" })}
            </Avatar>
            <Box>
                <Typography variant="subtitle1" fontWeight="bold" lineHeight={1.1}>{title}</Typography>
                {subtitle && <Typography variant="caption" color="text.secondary" display="block" lineHeight={1}>{subtitle}</Typography>}
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
        <Stack spacing={2} pb={4}> {/* Removed fixed height to prevent clipping */}
            
            {/* 1. ACTIONS (Moved to top for better UX, or keep at bottom? Keeping order but making distinct) */}
            <Stack spacing={1}>
                <Box display="flex" gap={1}>
                    <Button 
                        fullWidth
                        variant="contained" 
                        size="large" 
                        onClick={() => onRun(false)} 
                        disabled={running || optimizing}
                        startIcon={!running && <PlayArrow />} 
                        color={running ? "secondary" : "primary"}
                        sx={{ fontWeight: 'bold', py: 1.5 }}
                    >
                        {running ? "RUNNING..." : "RUN TEST"}
                    </Button>
                    <Tooltip title="Force Rebuild DB">
                        <Button variant="outlined" color="warning" onClick={() => onRun(true)} disabled={running || optimizing} sx={{ minWidth: 50 }}>
                            <Restore />
                        </Button>
                    </Tooltip>
                </Box>
                
                <Tooltip title="🤖 AI Optimizer: Tests all assets to find the best portfolio">
                    <Button 
                        fullWidth
                        variant="contained" 
                        onClick={onOptimize} 
                        disabled={running || optimizing}
                        startIcon={optimizing ? <CircularProgress size={20} color="inherit" /> : <AutoMode />}
                        sx={{ 
                            bgcolor: alpha(theme.palette.secondary.main, 0.15), 
                            color: theme.palette.secondary.light,
                            border: `1px solid ${alpha(theme.palette.secondary.main, 0.3)}`,
                            '&:hover': { bgcolor: alpha(theme.palette.secondary.main, 0.25) }
                        }}
                    >
                        {optimizing ? "OPTIMIZING..." : "AI AUTO-OPTIMIZE"}
                    </Button>
                </Tooltip>
            </Stack>

            {/* 2. PORTFOLIO MIX */}
            <GlassCard sx={{ p: 2 }}> {/* Reduced padding */}
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                    <SectionHeader icon={<PieChart />} title="Portfolio" subtitle="Asset Mix" />
                    <Chip 
                        label={`${totalAllocation.toFixed(0)}%`} 
                        color={Math.abs(totalAllocation - 100) < 1 ? "success" : "warning"} 
                        variant="outlined" size="small"
                        sx={{ height: 24, fontSize: '0.75rem', fontWeight: 'bold' }}
                    />
                </Stack>
                
                <Box display="flex" gap={1} mb={2}>
                    <FormControl size="small" fullWidth>
                        <InputLabel sx={{ fontSize: '0.8rem' }}>Add Asset</InputLabel>
                        <Select value={newAsset} label="Add Asset" onChange={(e) => setNewAsset(e.target.value)} sx={{ fontSize: '0.8rem' }}>
                            {AVAILABLE_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (
                                <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button variant="contained" onClick={handleAddClick} disabled={!newAsset} size="small" sx={{ minWidth: 40 }}><AddCircle /></Button>
                </Box>

                <List disablePadding sx={{ maxHeight: 220, overflowY: 'auto', pr: 0.5 }}>
                    {config.assets.map((asset) => (
                        <ListItem key={asset} sx={{ borderBottom: 1, borderColor: 'divider', px: 0, py: 1 }}>
                            <Box display="flex" alignItems="center" width="100%" gap={1}>
                                <Avatar sx={{ width: 24, height: 24, fontSize: '0.6rem', bgcolor: 'primary.main' }}>{asset.substring(0,1)}</Avatar>
                                <Typography variant="caption" fontWeight="bold" sx={{ minWidth: 45 }}>{asset.replace('USDT','')}</Typography>
                                
                                <Slider 
                                    value={config.weights[asset] || 0} 
                                    onChange={(_, v) => updateWeight(asset, v)} 
                                    min={0} max={100} step={5} size="small" 
                                    sx={{ flexGrow: 1, mx: 1 }} 
                                />
                                
                                <TextField 
                                    size="small" type="number" 
                                    value={config.weights[asset]} 
                                    onChange={(e) => updateWeight(asset, e.target.value)} 
                                    InputProps={{ 
                                        endAdornment: <InputAdornment position="end" sx={{mr:-1}}><Typography variant="caption">%</Typography></InputAdornment>,
                                        style: { fontSize: '0.75rem', padding: 0 }
                                    }} 
                                    sx={{ width: 60 }} 
                                />
                                <IconButton size="small" color="error" onClick={() => removeAsset(asset)} sx={{ p: 0.5 }}><Delete fontSize="small" /></IconButton>
                            </Box>
                        </ListItem>
                    ))}
                </List>
            </GlassCard>

            {/* 3. STRATEGY PARAMS */}
            <GlassCard sx={{ p: 2 }}>
                <SectionHeader icon={<Tune />} title="Parameters" subtitle="Entry Logic" />
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <TextField label="Min ADX" type="number" fullWidth size="small" value={config.minAdx} onChange={(e) => updateConfig('minAdx', e.target.value)} InputProps={{ style: { fontSize: '0.8rem' } }} />
                    </Grid>
                    <Grid item xs={6}>
                        <TextField label="Max RSI" type="number" fullWidth size="small" value={config.maxRsi} onChange={(e) => updateConfig('maxRsi', e.target.value)} InputProps={{ style: { fontSize: '0.8rem' } }} />
                    </Grid>
                    <Grid item xs={12}>
                        <Box display="flex" alignItems="center" justifyContent="space-between" p={1} border={1} borderColor="divider" borderRadius={1} bgcolor={config.burstMode ? alpha(theme.palette.warning.main, 0.1) : 'transparent'}>
                            <Box display="flex" alignItems="center" gap={1}>
                                <FlashOn fontSize="small" color={config.burstMode ? "warning" : "disabled"} />
                                <Box>
                                    <Typography variant="body2" fontWeight="bold" fontSize="0.8rem">Burst Mode</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block" fontSize="0.65rem">RSI &gt; 50 Entry</Typography>
                                </Box>
                            </Box>
                            <Switch size="small" checked={config.burstMode} onChange={(e) => updateConfig('burstMode', e.target.checked)} color="warning" />
                        </Box>
                    </Grid>
                    <Grid item xs={12}>
                        <Typography variant="caption" gutterBottom>Hard Stop Loss ({config.stopLoss}%)</Typography>
                        <Slider value={parseFloat(config.stopLoss)} min={0.5} max={10} step={0.1} onChange={(_, v) => updateConfig('stopLoss', v)} size="small" />
                    </Grid>
                </Grid>
            </GlassCard>

            {/* 4. SIMULATION SETTINGS */}
            <GlassCard sx={{ p: 2 }}>
                <SectionHeader icon={<Science />} title="Environment" subtitle="Sim Settings" />
                <Box mb={2}>
                    <Typography variant="caption" gutterBottom>Duration: {config.days} Days</Typography>
                    <Slider value={config.days} min={7} max={120} onChange={(_, v) => updateConfig('days', v)} size="small" />
                </Box>
                <TextField label="Start Balance ($)" type="number" fullWidth size="small" value={config.balance} onChange={(e) => updateConfig('balance', e.target.value)} InputProps={{ style: { fontSize: '0.8rem' } }} />
            </GlassCard>

        </Stack>
    );
};

export default LabControls;