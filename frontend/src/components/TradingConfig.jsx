// frontend/src/components/TradingConfig.jsx - FIXED IMPORTS
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, Alert, Card, InputAdornment,
  IconButton, Paper, Container, Stack, Divider, Chip, Tabs, Tab,
  List, ListItem, ListItemText, ListItemSecondaryAction, Avatar, Tooltip,
  Grid // <--- ADDED MISSING IMPORT
} from '@mui/material';
import {
  Save, Refresh, TrendingUp, Security, AccountBalance,
  PieChart, Notifications, Delete, AddCircle, Warning,
  CheckCircle, ShowChart, Tune, Science
} from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// --- ASSET LIST ---
const SUPPORTED_ASSETS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'SHIBUSDT',
  'TONUSDT', 'LINKUSDT', 'DOTUSDT', 'BCHUSDT', 'LTCUSDT',
  'UNIUSDT', 'NEARUSDT', 'MATICUSDT', 'ICPUSDT', 'PEPEUSDT'
];

// --- DEFAULTS ---
const DEFAULT_CONFIG = {
    maxCapitalAtRisk: 5000,
    tradingMode: 'paper',
    enableTrading: false,
    riskPerTrade: 1.0,
    maxDailyLoss: 2.0,
    maxWeeklyLoss: 5.0,
    stopLossATR: 1.5,
    takeProfitATRMultiplier: 3.0,
    minOrderSize: 10,
    strategy: 'balanced',
    timeframe: '1h',
    signalCooldown: 60,
    enableAdxFilter: true,
    minAdx: 25,
    enableRsiFilter: true,
    rsiOverbought: 70,
    rsiOversold: 30,
    assets: [], 
    allocation: {}, 
    enableEmailAlerts: false,
    alertEmail: '',
    logLevel: 'info'
};

const TradingConfig = () => {
  // --- STATE ---
  const [activeTab, setActiveTab] = useState(0);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState({});
  const [newAsset, setNewAsset] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // --- DATA FETCHING ---
  const fetchCurrentConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await tradingAPI.getStatus();
      
      if (data.config) {
        const fetchedConfig = {
          ...DEFAULT_CONFIG,
          ...data.config,
          riskPerTrade: (data.config.riskPerTrade * 100) || 1.0,
          maxDailyLoss: (data.config.maxDailyLoss * 100) || 2.0,
          maxWeeklyLoss: (data.config.maxWeeklyLoss * 100) || 5.0,
          signalCooldown: (data.config.signalCooldown / 1000) || 60,
          allocation: { ...data.config.allocation }
        };
        
        // Normalize allocation
        Object.keys(fetchedConfig.allocation).forEach(key => {
            if (fetchedConfig.allocation[key] <= 1) {
                fetchedConfig.allocation[key] = Math.round(fetchedConfig.allocation[key] * 100);
            }
        });

        if (!fetchedConfig.assets) fetchedConfig.assets = [];

        setConfig(fetchedConfig);
        setOriginalConfig(fetchedConfig);
      }
    } catch (err) {
      setError(`Failed to load configuration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCurrentConfig(); }, [fetchCurrentConfig]);
  useEffect(() => { setHasChanges(JSON.stringify(config) !== JSON.stringify(originalConfig)); }, [config, originalConfig]);

  // --- HANDLERS ---
  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      const configToSave = {
        ...config,
        riskPerTrade: config.riskPerTrade / 100,
        maxDailyLoss: config.maxDailyLoss / 100,
        maxWeeklyLoss: config.maxWeeklyLoss / 100,
        signalCooldown: config.signalCooldown * 1000,
        allocation: {}
      };

      config.assets.forEach(asset => {
          const alloc = config.allocation[asset] || 0;
          if (alloc > 0) configToSave.allocation[asset] = alloc / 100;
          else configToSave.allocation[asset] = 0;
      });

      await tradingAPI.updateConfig(configToSave);
      setOriginalConfig(config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (key, value) => { setConfig((prev) => ({ ...prev, [key]: value })); };

  const handleAddAsset = () => {
      if (!newAsset || config.assets.includes(newAsset)) return;
      setConfig(prev => ({
          ...prev,
          assets: [...prev.assets, newAsset],
          allocation: { ...prev.allocation, [newAsset]: 0 }
      }));
      setNewAsset('');
  };

  const handleRemoveAsset = (assetToRemove) => {
      setConfig(prev => {
          const newAssets = prev.assets.filter(a => a !== assetToRemove);
          const newAllocation = { ...prev.allocation };
          delete newAllocation[assetToRemove];
          return { ...prev, assets: newAssets, allocation: newAllocation };
      });
  };

  const updateAllocation = (asset, val) => {
      setConfig(prev => ({ ...prev, allocation: { ...prev.allocation, [asset]: val } }));
  };

  const totalAllocation = config.assets.reduce((sum, asset) => sum + (config.allocation[asset] || 0), 0);

  // --- SUB-COMPONENTS (RENDER HELPERS) ---

  const renderGeneralSettings = () => (
    <Stack spacing={3}>
        <Card variant="outlined" sx={{ p: 3, borderLeft: 6, borderColor: config.tradingMode === 'live' ? 'error.main' : 'warning.main' }}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                    <Typography variant="h6" fontWeight="bold">
                        {config.tradingMode === 'live' ? "⚠️ LIVE TRADING ACTIVE" : "🧪 PAPER TRADING MODE"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mt={0.5}>
                        {config.tradingMode === 'live' 
                            ? "Real funds are at risk. Trades will be executed on Binance." 
                            : "Simulation only. No real funds will be used."}
                    </Typography>
                </Box>
                <FormControl component="fieldset">
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="caption" fontWeight="bold">PAPER</Typography>
                        <Switch
                            checked={config.tradingMode === 'live'}
                            onChange={(e) => {
                                if (e.target.checked && !window.confirm("DANGER: Are you sure you want to enable Real Money Trading?")) return;
                                updateConfig('tradingMode', e.target.checked ? 'live' : 'paper');
                            }}
                            color="error"
                        />
                        <Typography variant="caption" fontWeight="bold" color={config.tradingMode === 'live' ? 'error.main' : 'text.primary'}>LIVE</Typography>
                    </Stack>
                </FormControl>
            </Box>
        </Card>

        <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Global Controls</Typography>
            <Box display="flex" gap={4} alignItems="center" flexWrap="wrap">
                 <Box flexGrow={1} minWidth={200}>
                    <TextField
                        fullWidth label="Max Capital Allocation" type="number"
                        helperText="The maximum USDT amount the bot can use."
                        value={config.maxCapitalAtRisk}
                        onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
                        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    />
                 </Box>
                 
                 <Box flexGrow={1} minWidth={200} display="flex" alignItems="center" justifyContent="space-between" 
                      border={1} borderColor={config.enableTrading ? "success.main" : "divider"} 
                      borderRadius={1} p={2}
                      bgcolor={config.enableTrading ? "rgba(46, 125, 50, 0.04)" : "transparent"}
                 >
                    <Box>
                        <Typography fontWeight="bold">Master Bot Switch</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {config.enableTrading ? "System is ON and processing signals." : "System is OFF. No trades will be taken."}
                        </Typography>
                    </Box>
                    <Switch 
                        checked={config.enableTrading} 
                        onChange={(e) => updateConfig('enableTrading', e.target.checked)} 
                        color="success" size="large"
                    />
                 </Box>
            </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Notifications color="action" />
                <Typography variant="h6">Notifications</Typography>
            </Box>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                 <Box display="flex" alignItems="center" width="100%">
                    <Switch checked={config.enableEmailAlerts} onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)} />
                    <Typography sx={{ ml: 1 }}>Enable Email Alerts</Typography>
                 </Box>
                 <TextField 
                    fullWidth label="Alert Email Address" 
                    value={config.alertEmail} 
                    onChange={(e) => updateConfig('alertEmail', e.target.value)}
                    disabled={!config.enableEmailAlerts}
                />
            </Stack>
        </Paper>
    </Stack>
  );

  const renderStrategySettings = () => (
    <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 3 }}>
             <Box display="flex" alignItems="center" gap={1} mb={3}>
                <Science color="primary" />
                <Typography variant="h6">Core Strategy</Typography>
            </Box>
            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    <FormControl fullWidth>
                        <InputLabel>Strategy Logic</InputLabel>
                        <Select value={config.strategy} label="Strategy Logic" onChange={(e) => updateConfig('strategy', e.target.value)}>
                            <MenuItem value="balanced">Balanced (EMA Crossover)</MenuItem>
                            <MenuItem value="responsive">Responsive (Fast EMA)</MenuItem>
                            <MenuItem value="conservative">Conservative (SMA Trend)</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                     <FormControl fullWidth>
                        <InputLabel>Candle Timeframe</InputLabel>
                        <Select value={config.timeframe} label="Candle Timeframe" onChange={(e) => updateConfig('timeframe', e.target.value)}>
                            <MenuItem value="15m">15 Minutes</MenuItem>
                            <MenuItem value="1h">1 Hour</MenuItem>
                            <MenuItem value="4h">4 Hours</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
            </Grid>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Filters & Conditions</Typography>
            
            <Box mb={4}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography fontWeight="bold">ADX Trend Filter</Typography>
                    <Switch size="small" checked={config.enableAdxFilter} onChange={(e) => updateConfig('enableAdxFilter', e.target.checked)} />
                </Box>
                <Typography variant="body2" color="text.secondary" mb={2}>
                    Only take trades when the trend strength is above this threshold.
                </Typography>
                <Box px={2}>
                    <Slider 
                        value={config.minAdx} min={10} max={50} step={1}
                        onChange={(_, v) => updateConfig('minAdx', v)} disabled={!config.enableAdxFilter}
                        valueLabelDisplay="auto" marks={[{value: 25, label: 'Strong Trend'}]}
                    />
                </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography fontWeight="bold">RSI Momentum Filter</Typography>
                    <Switch size="small" checked={config.enableRsiFilter} onChange={(e) => updateConfig('enableRsiFilter', e.target.checked)} />
                </Box>
                 <Typography variant="body2" color="text.secondary" mb={2}>
                    Prevent buying at peaks (Overbought) or selling at bottoms (Oversold).
                </Typography>
                <Stack direction="row" spacing={4}>
                     <TextField 
                        fullWidth label="Overbought Threshold (>)" type="number"
                        value={config.rsiOverbought} onChange={(e) => updateConfig('rsiOverbought', parseFloat(e.target.value))} 
                        disabled={!config.enableRsiFilter}
                    />
                     <TextField 
                        fullWidth label="Oversold Threshold (<)" type="number"
                        value={config.rsiOversold} onChange={(e) => updateConfig('rsiOversold', parseFloat(e.target.value))} 
                        disabled={!config.enableRsiFilter}
                    />
                </Stack>
            </Box>
        </Paper>
    </Stack>
  );

  const renderRiskSettings = () => (
     <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <Security color="warning" />
                <Typography variant="h6">Risk Parameters</Typography>
            </Box>

            <Grid container spacing={4}>
                <Grid item xs={12}>
                     <Typography gutterBottom>Risk Per Trade (% of Capital)</Typography>
                     <Stack direction="row" spacing={2} alignItems="center">
                        <Slider 
                            value={config.riskPerTrade} min={0.1} max={5.0} step={0.1}
                            onChange={(_, v) => updateConfig('riskPerTrade', v)} 
                            valueLabelDisplay="auto"
                            sx={{ flexGrow: 1 }}
                        />
                        <Typography fontWeight="bold" minWidth={50}>{config.riskPerTrade}%</Typography>
                     </Stack>
                </Grid>

                <Grid item xs={12} md={6}>
                    <TextField 
                        fullWidth label="Stop Loss (ATR Multiplier)" type="number"
                        helperText="Distance to place Stop Loss (e.g. 1.5x ATR)"
                        value={config.stopLossATR} 
                        onChange={(e) => updateConfig('stopLossATR', parseFloat(e.target.value))} 
                        inputProps={{ step: 0.1 }} 
                    />
                </Grid>
                 <Grid item xs={12} md={6}>
                    <TextField 
                        fullWidth label="Take Profit (ATR Multiplier)" type="number"
                        helperText="Target price distance (e.g. 3.0x ATR)"
                        value={config.takeProfitATRMultiplier} 
                        onChange={(e) => updateConfig('takeProfitATRMultiplier', parseFloat(e.target.value))} 
                        inputProps={{ step: 0.1 }} 
                    />
                </Grid>

                 <Grid item xs={12} md={6}>
                    <TextField 
                        fullWidth label="Max Daily Loss Limit (%)" type="number"
                        helperText="Stop trading if daily loss exceeds this."
                        value={config.maxDailyLoss} 
                        onChange={(e) => updateConfig('maxDailyLoss', parseFloat(e.target.value))} 
                    />
                </Grid>
                 <Grid item xs={12} md={6}>
                    <TextField 
                        fullWidth label="Minimum Order Size ($)" type="number"
                        value={config.minOrderSize} 
                        onChange={(e) => updateConfig('minOrderSize', parseFloat(e.target.value))} 
                    />
                </Grid>
            </Grid>
        </Paper>
     </Stack>
  );

  const renderPortfolioSettings = () => (
    <Stack spacing={3}>
         <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems="center" spacing={2}>
                 <Box>
                     <Typography variant="h6">Asset Allocation</Typography>
                     <Typography variant="body2" color="text.secondary">
                         Define which assets the bot should trade and their weight.
                     </Typography>
                 </Box>
                 <Box display="flex" alignItems="center" gap={2}>
                     <Chip 
                        label={`Total Allocated: ${totalAllocation}%`} 
                        color={totalAllocation > 100 ? "error" : totalAllocation === 100 ? "success" : "default"}
                        variant={totalAllocation === 100 ? "filled" : "outlined"}
                     />
                 </Box>
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Box display="flex" gap={2} mb={3}>
                <FormControl size="small" fullWidth sx={{ maxWidth: 300 }}>
                    <InputLabel>Select Asset</InputLabel>
                    <Select value={newAsset} label="Select Asset" onChange={(e) => setNewAsset(e.target.value)}>
                        {SUPPORTED_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (
                            <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Button variant="contained" onClick={handleAddAsset} disabled={!newAsset} startIcon={<AddCircle />}>
                    Add to Portfolio
                </Button>
            </Box>

            <List disablePadding>
                {config.assets.length === 0 && (
                    <Alert severity="info" sx={{ width: '100%' }}>Your portfolio is empty. Add an asset to begin.</Alert>
                )}
                
                {config.assets.map((asset) => (
                    <React.Fragment key={asset}>
                        <ListItem sx={{ 
                            border: 1, 
                            borderColor: 'divider', 
                            borderRadius: 1, 
                            mb: 1, 
                            flexWrap: 'wrap',
                            bgcolor: 'background.paper',
                            '&:hover': { bgcolor: 'action.hover' }
                        }}>
                             <Box display="flex" alignItems="center" minWidth={120}>
                                <Avatar sx={{ width: 32, height: 32, mr: 2, bgcolor: 'primary.main', fontSize: '0.8rem' }}>
                                    {asset.substring(0,3)}
                                </Avatar>
                                <ListItemText primary={asset.replace('USDT', '')} secondary="USDT Pair" />
                             </Box>

                             <Box sx={{ flexGrow: 1, mx: 4, minWidth: 200 }}>
                                 <Stack direction="row" spacing={2} alignItems="center">
                                    <Typography variant="caption" color="text.secondary">Weight</Typography>
                                    <Slider 
                                        value={config.allocation[asset] || 0} 
                                        onChange={(_, v) => updateAllocation(asset, v)}
                                        min={0} max={50} step={1}
                                    />
                                 </Stack>
                             </Box>

                             <Box display="flex" alignItems="center" gap={2}>
                                 <TextField 
                                    size="small" type="number" 
                                    value={config.allocation[asset] || 0} 
                                    onChange={(e) => updateAllocation(asset, parseFloat(e.target.value))}
                                    InputProps={{ 
                                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                    }}
                                    sx={{ width: 100 }}
                                 />
                                 <IconButton color="error" onClick={() => handleRemoveAsset(asset)}>
                                     <Delete />
                                 </IconButton>
                             </Box>
                        </ListItem>
                    </React.Fragment>
                ))}
            </List>
         </Paper>
    </Stack>
  );

  if (loading) return <Box p={4} display="flex" justifyContent="center"><Typography>Loading Configuration...</Typography></Box>;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
        
        {/* HEADER */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
            <Box>
                <Typography variant="h4" fontWeight="bold">Settings</Typography>
                <Typography color="text.secondary">Manage your trading bot configuration</Typography>
            </Box>
            <Stack direction="row" spacing={2}>
                <Button startIcon={<Refresh />} onClick={fetchCurrentConfig} disabled={saving}>
                    Revert
                </Button>
                <Button 
                    variant="contained" 
                    startIcon={<Save />} 
                    onClick={handleSaveConfig} 
                    disabled={!hasChanges || saving}
                    size="large"
                >
                    {saving ? 'Saving...' : 'Save Changes'}
                </Button>
            </Stack>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 3 }}>Configuration saved successfully!</Alert>}

        {/* TABS NAVIGATION */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
                <Tab icon={<AccountBalance />} iconPosition="start" label="General" />
                <Tab icon={<Science />} iconPosition="start" label="Strategy" />
                <Tab icon={<Security />} iconPosition="start" label="Risk" />
                <Tab icon={<PieChart />} iconPosition="start" label="Portfolio" />
            </Tabs>
        </Box>

        {/* TAB PANELS */}
        <Box sx={{ minHeight: 400 }}>
            {activeTab === 0 && renderGeneralSettings()}
            {activeTab === 1 && renderStrategySettings()}
            {activeTab === 2 && renderRiskSettings()}
            {activeTab === 3 && renderPortfolioSettings()}
        </Box>

    </Container>
  );
};

export default TradingConfig;