// frontend/src/components/lab/LabControls.jsx - V3.2.6 LIVE PARITY UPDATE
import React, { useState } from 'react';
import { 
    Box, Typography, Button, Slider, TextField, Stack, Chip, 
    MenuItem, Select, FormControl, InputLabel,
    IconButton, Avatar, InputAdornment, List, ListItem, 
    Grid, Switch, Tooltip, CircularProgress, alpha, useTheme,
    Collapse, Divider
} from '@mui/material';
import { 
    PieChart, Tune, Science, AddCircle, Delete, 
    PlayArrow, AutoMode, Restore, FlashOn, ExpandMore, ExpandLess,
    AttachMoney, Speed, TrendingUp, Security, Cancel
} from '@mui/icons-material';
import { GlassCard } from '../dashboard/Shared';

const SectionHeader = ({ icon, title, subtitle, action }) => {
    const theme = useTheme();
    return (
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center" gap={1.5}>
                <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main }}>
                    {React.cloneElement(icon, { fontSize: "small" })}
                </Avatar>
                <Box>
                    <Typography variant="subtitle1" fontWeight="bold" lineHeight={1.1}>{title}</Typography>
                    {subtitle && <Typography variant="caption" color="text.secondary" display="block" lineHeight={1}>{subtitle}</Typography>}
                </Box>
            </Box>
            {action}
        </Box>
    );
};

const AVAILABLE_ASSETS = [
    'AUD_USD', 'EUR_USD', 'GBP_USD', 'NZD_USD', 'USD_CAD', 'USD_CHF',
    'USD_JPY', 'EUR_GBP', 'EUR_JPY', 'GBP_JPY'
];

const FEE_TIERS = [
    { value: 'vip0', label: 'VIP 0 (0.10%)' },
    { value: 'vip1', label: 'VIP 1 (0.09%)' },
    { value: 'vip2', label: 'VIP 2 (0.08%)' },
    { value: 'bnb_discount', label: 'BNB Discount (0.075%)' },
    { value: 'standard', label: 'Standard (0.10%)' },
];

const LabControls = ({ 
    config, updateConfig, updateWeight, 
    addAsset, removeAsset, 
    onRun, onOptimize, onCancel,
    running, optimizing 
}) => {
    const theme = useTheme();
    const [newAsset, setNewAsset] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showRealism, setShowRealism] = useState(false);
    
    const totalAllocation = config.assets.reduce((sum, asset) => sum + (config.weights[asset] || 0), 0);

    const handleAddClick = () => {
        addAsset(newAsset);
        setNewAsset('');
    };

    const handleInputChange = (asset, value) => {
        updateWeight(asset, value);
    };

    // Helper to convert ms to hours
    const msToHours = (ms) => ms / (60 * 60 * 1000);
    const hoursToMs = (hours) => hours * 60 * 60 * 1000;

    return (
        <Stack spacing={2} pb={4}> 
            
            {/* 1. ACTIONS */}
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
                
                {/* Cancel Button - Only show when running */}
                {(running || optimizing) && (
                    <Button 
                        fullWidth
                        variant="outlined" 
                        color="error"
                        onClick={onCancel}
                        startIcon={<Cancel />}
                        size="small"
                    >
                        CANCEL
                    </Button>
                )}
            </Stack>

            {/* 2. PORTFOLIO MIX */}
            <GlassCard sx={{ p: 2 }}> 
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                    <SectionHeader icon={<PieChart />} title="Portfolio" subtitle="Asset Mix" />
                    <Chip 
                        label={`${totalAllocation.toFixed(0)}% TOTAL`} 
                        color={Math.abs(totalAllocation - 100) < 1 ? "success" : "warning"} 
                        variant={Math.abs(totalAllocation - 100) < 1 ? "filled" : "outlined"}
                        size="small"
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

                <List disablePadding sx={{ maxHeight: 180, overflowY: 'auto', pr: 0.5 }}>
                    {config.assets.map((asset) => (
                        <ListItem key={asset} sx={{ borderBottom: 1, borderColor: 'divider', px: 0, py: 1 }}>
                            <Box display="flex" alignItems="center" width="100%" gap={1}>
                                <Box display="flex" alignItems="center" gap={1} minWidth={60}>
                                    <Avatar sx={{ width: 24, height: 24, fontSize: '0.65rem', bgcolor: 'primary.main', fontWeight: 'bold' }}>{asset.substring(0,1)}</Avatar>
                                    <Typography variant="body2" fontWeight="bold" fontSize="0.75rem">{asset.replace('USDT','')}</Typography>
                                </Box>
                                <Slider 
                                    value={config.weights[asset] || 0} 
                                    onChange={(_, v) => updateWeight(asset, v)} 
                                    min={0} max={100} step={1} size="small" 
                                    sx={{ flexGrow: 1, mx: 1 }} 
                                />
                                <TextField 
                                    size="small" 
                                    type="number" 
                                    value={config.weights[asset]} 
                                    onChange={(e) => handleInputChange(asset, e.target.value)} 
                                    InputProps={{ 
                                        endAdornment: <InputAdornment position="end"><Typography variant="caption">%</Typography></InputAdornment>,
                                    }} 
                                    sx={{ width: 75, '& input': { textAlign: 'center', py: 0.5, fontSize: '0.8rem' } }} 
                                />
                                <IconButton size="small" color="error" onClick={() => removeAsset(asset)}>
                                    <Delete fontSize="small" />
                                </IconButton>
                            </Box>
                        </ListItem>
                    ))}
                </List>
            </GlassCard>

            {/* 3. STRATEGY PARAMS */}
            <GlassCard sx={{ p: 2 }}>
                <SectionHeader icon={<Tune />} title="Entry Filters" subtitle="Signal Logic" />
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <TextField 
                            label="Min ADX" 
                            type="number" 
                            fullWidth 
                            size="small" 
                            value={config.minAdx} 
                            onChange={(e) => updateConfig('minAdx', e.target.value)} 
                        />
                    </Grid>
                    <Grid item xs={6}>
                        <TextField 
                            label="RSI Overbought" 
                            type="number" 
                            fullWidth 
                            size="small" 
                            value={config.rsiOverbought} 
                            onChange={(e) => updateConfig('rsiOverbought', e.target.value)}
                            helperText="Block entry above"
                        />
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
                </Grid>
                
                {/* Continuation Entry Toggle */}
                <Divider sx={{ my: 2 }} />
                <Box 
                    display="flex" 
                    alignItems="center" 
                    justifyContent="space-between" 
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    sx={{ cursor: 'pointer' }}
                >
                    <Box display="flex" alignItems="center" gap={1}>
                        <TrendingUp fontSize="small" color="primary" />
                        <Box>
                            <Typography variant="body2" fontWeight="bold" fontSize="0.8rem">Continuation Entry</Typography>
                            <Typography variant="caption" color="text.secondary" fontSize="0.65rem">
                                {config.enableContinuationEntry ? 'Enabled' : 'Disabled'}
                            </Typography>
                        </Box>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Switch 
                            size="small" 
                            checked={config.enableContinuationEntry} 
                            onChange={(e) => {
                                e.stopPropagation();
                                updateConfig('enableContinuationEntry', e.target.checked);
                            }} 
                        />
                        {showAdvanced ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                    </Box>
                </Box>
                
                <Collapse in={showAdvanced && config.enableContinuationEntry}>
                    <Box mt={2} pl={2} borderLeft={2} borderColor="primary.main">
                        <Grid container spacing={2}>
                            <Grid item xs={6}>
                                <TextField 
                                    label="Cont. RSI" 
                                    type="number" 
                                    fullWidth 
                                    size="small" 
                                    value={config.continuationRsiThreshold} 
                                    onChange={(e) => updateConfig('continuationRsiThreshold', parseFloat(e.target.value))}
                                    helperText="Must drop below"
                                />
                            </Grid>
                            <Grid item xs={6}>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">Window</Typography>
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                        <Slider
                                            value={msToHours(config.continuationWindowMs || 14400000)}
                                            min={1}
                                            max={12}
                                            step={0.5}
                                            onChange={(_, v) => updateConfig('continuationWindowMs', hoursToMs(v))}
                                            size="small"
                                        />
                                        <Chip label={`${msToHours(config.continuationWindowMs || 14400000)}h`} size="small" />
                                    </Stack>
                                </Box>
                            </Grid>
                            <Grid item xs={12}>
                                <Typography variant="caption" color="text.secondary">Max Price Deviation</Typography>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <Slider
                                        value={(config.continuationMaxPriceDeviation || 0.03) * 100}
                                        min={1}
                                        max={10}
                                        step={0.5}
                                        onChange={(_, v) => updateConfig('continuationMaxPriceDeviation', v / 100)}
                                        size="small"
                                    />
                                    <Chip label={`${((config.continuationMaxPriceDeviation || 0.03) * 100).toFixed(1)}%`} size="small" />
                                </Stack>
                            </Grid>
                        </Grid>
                    </Box>
                </Collapse>
            </GlassCard>

            {/* 4. RISK MANAGEMENT */}
            <GlassCard sx={{ p: 2 }}>
                <SectionHeader icon={<Security />} title="Risk" subtitle="Stops & Exposure" />
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Stop Type</InputLabel>
                            <Select 
                                value={config.stopLossType || 'FIXED'} 
                                label="Stop Type"
                                onChange={(e) => updateConfig('stopLossType', e.target.value)}
                            >
                                <MenuItem value="FIXED">Fixed %</MenuItem>
                                <MenuItem value="ATR">ATR-Based</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={6}>
                        {config.stopLossType === 'ATR' ? (
                            <TextField 
                                label="ATR Multiplier" 
                                type="number" 
                                fullWidth 
                                size="small" 
                                value={config.stopLossATR} 
                                onChange={(e) => updateConfig('stopLossATR', parseFloat(e.target.value))}
                                inputProps={{ step: 0.1 }}
                            />
                        ) : (
                            <TextField 
                                label="Stop Loss %" 
                                type="number" 
                                fullWidth 
                                size="small" 
                                value={config.stopLoss} 
                                onChange={(e) => updateConfig('stopLoss', parseFloat(e.target.value))}
                                InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                            />
                        )}
                    </Grid>
                    <Grid item xs={12}>
                        <Box display="flex" alignItems="center" justifyContent="space-between" p={1} border={1} borderColor="divider" borderRadius={1}>
                            <Box>
                                <Typography variant="body2" fontWeight="bold" fontSize="0.8rem">Trailing Stop</Typography>
                                <Typography variant="caption" color="text.secondary" fontSize="0.65rem">
                                    {config.enableTrailingStops ? `${(config.trailingStopPercent * 100).toFixed(1)}% distance` : 'Disabled'}
                                </Typography>
                            </Box>
                            <Switch 
                                size="small" 
                                checked={config.enableTrailingStops} 
                                onChange={(e) => updateConfig('enableTrailingStops', e.target.checked)} 
                            />
                        </Box>
                        {config.enableTrailingStops && (
                            <Slider
                                value={config.trailingStopPercent * 100}
                                min={0.5}
                                max={10}
                                step={0.1}
                                onChange={(_, v) => updateConfig('trailingStopPercent', v / 100)}
                                size="small"
                                sx={{ mt: 1 }}
                            />
                        )}
                    </Grid>
                    <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary">Max Exposure: {((config.maxPortfolioExposure || 0.95) * 100).toFixed(0)}%</Typography>
                        <Slider
                            value={(config.maxPortfolioExposure || 0.95) * 100}
                            min={50}
                            max={100}
                            step={5}
                            onChange={(_, v) => updateConfig('maxPortfolioExposure', v / 100)}
                            size="small"
                        />
                    </Grid>
                </Grid>
            </GlassCard>

            {/* 5. SIMULATION REALISM */}
            <GlassCard sx={{ p: 2 }}>
                <Box 
                    display="flex" 
                    alignItems="center" 
                    justifyContent="space-between"
                    onClick={() => setShowRealism(!showRealism)}
                    sx={{ cursor: 'pointer' }}
                >
                    <SectionHeader icon={<AttachMoney />} title="Realism" subtitle="Fees & Slippage" />
                    {showRealism ? <ExpandLess /> : <ExpandMore />}
                </Box>
                
                <Collapse in={showRealism}>
                    <Grid container spacing={2} mt={1}>
                        <Grid item xs={12}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Fee Tier</InputLabel>
                                <Select 
                                    value={config.feeTier || 'bnb_discount'} 
                                    label="Fee Tier"
                                    onChange={(e) => updateConfig('feeTier', e.target.value)}
                                >
                                    {FEE_TIERS.map(tier => (
                                        <MenuItem key={tier.value} value={tier.value}>{tier.label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12}>
                            <Box display="flex" alignItems="center" justifyContent="space-between" p={1} border={1} borderColor="divider" borderRadius={1}>
                                <Box display="flex" alignItems="center" gap={1}>
                                    <Speed fontSize="small" color={config.enableSlippage ? "primary" : "disabled"} />
                                    <Box>
                                        <Typography variant="body2" fontWeight="bold" fontSize="0.8rem">Slippage</Typography>
                                        <Typography variant="caption" color="text.secondary" fontSize="0.65rem">
                                            {config.enableSlippage ? `Up to ${(config.slippagePct * 100).toFixed(2)}%` : 'Disabled'}
                                        </Typography>
                                    </Box>
                                </Box>
                                <Switch 
                                    size="small" 
                                    checked={config.enableSlippage} 
                                    onChange={(e) => updateConfig('enableSlippage', e.target.checked)} 
                                />
                            </Box>
                        </Grid>
                        {config.enableSlippage && (
                            <Grid item xs={12}>
                                <Typography variant="caption" color="text.secondary">Max Slippage</Typography>
                                <Slider
                                    value={config.slippagePct * 100}
                                    min={0.01}
                                    max={0.2}
                                    step={0.01}
                                    onChange={(_, v) => updateConfig('slippagePct', v / 100)}
                                    size="small"
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={(v) => `${v.toFixed(2)}%`}
                                />
                            </Grid>
                        )}
                    </Grid>
                </Collapse>
            </GlassCard>

            {/* 6. SIMULATION SETTINGS */}
            <GlassCard sx={{ p: 2 }}>
                <SectionHeader icon={<Science />} title="Environment" subtitle="Sim Settings" />
                <Box mb={2}>
                    <Typography variant="caption" gutterBottom>Duration: {config.days} Days</Typography>
                    <Slider value={config.days} min={7} max={120} onChange={(_, v) => updateConfig('days', v)} size="small" />
                </Box>
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <TextField 
                            label="Balance" 
                            type="number" 
                            fullWidth 
                            size="small" 
                            value={config.balance} 
                            onChange={(e) => updateConfig('balance', e.target.value)}
                            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                        />
                    </Grid>
                    <Grid item xs={6}>
                        <TextField 
                            label="Risk/Trade" 
                            type="number" 
                            fullWidth 
                            size="small" 
                            value={(config.riskPerTrade * 100).toFixed(0)} 
                            onChange={(e) => updateConfig('riskPerTrade', parseFloat(e.target.value) / 100)}
                            InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                        />
                    </Grid>
                </Grid>
            </GlassCard>

        </Stack>
    );
};

export default LabControls;
