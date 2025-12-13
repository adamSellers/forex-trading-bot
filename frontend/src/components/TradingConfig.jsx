// frontend/src/components/TradingConfig.jsx - 3-ROW GRID LAYOUT
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Grid, Typography, TextField, Button, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, Alert, Card, InputAdornment,
  Accordion, AccordionSummary, AccordionDetails, IconButton, Paper, Container
} from '@mui/material';
import {
  Save, Refresh, ExpandMore, TrendingUp, Security, AccountBalance,
  Settings, MoneyOff, MonetizationOn, Mail, Delete, AddCircle
} from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// Curated List of Top 20 High-Liquidity Assets on Binance
const SUPPORTED_ASSETS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'SHIBUSDT',
  'TONUSDT', 'LINKUSDT', 'DOTUSDT', 'BCHUSDT', 'LTCUSDT',
  'UNIUSDT', 'NEARUSDT', 'MATICUSDT', 'ICPUSDT', 'PEPEUSDT'
];

// Default configuration structure
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
    logLevel: 'info',
    enableS3Analytics: false,
    enableS3SignalLogging: false,
};

const TradingConfig = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState({});
  const [newAsset, setNewAsset] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

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
        
        // Normalize allocation to 0-100 scale for UI
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
  const riskAmounts = {
    riskPerTrade: (config.maxCapitalAtRisk * config.riskPerTrade / 100).toFixed(2),
  };

  if (loading) return <Box><Typography>Loading...</Typography></Box>;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header Area */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">Configuration</Typography>
        <Box display="flex" gap={2}>
          <Button variant="outlined" startIcon={<Refresh />} onClick={fetchCurrentConfig}>Reload</Button>
          <Button variant="contained" startIcon={<Save />} onClick={handleSaveConfig} disabled={!hasChanges || saving}>
            {saving ? 'Saving...' : 'Save Config'}
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>Saved successfully!</Alert>}

      <Grid container spacing={3}>
        
        {/* === ROW 1: ACCOUNT (70%) & NOTIFICATIONS (30%) === */}
        <Grid item xs={12} md={8}>
            <Accordion defaultExpanded sx={{ height: '100%' }}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                    <AccountBalance sx={{ mr: 1, color: 'primary.main' }} />
                    <Typography variant="h6">Account & Master Control</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <Grid container spacing={3} alignItems="center">
                        {/* Trading Mode Switch */}
                        <Grid item xs={12} md={5}>
                            <Card variant="outlined" sx={{ p: 2, borderColor: config.tradingMode === 'live' ? 'error.main' : 'warning.main', borderWidth: 2 }}>
                                <Box display="flex" alignItems="center" justifyContent="space-between">
                                    <Box display="flex" alignItems="center" gap={1}>
                                        {config.tradingMode === 'live' ? <MonetizationOn color="error" /> : <MoneyOff color="warning" />}
                                        <Typography variant="subtitle1" fontWeight="bold" color={config.tradingMode === 'live' ? 'error.main' : 'warning.main'}>
                                            {config.tradingMode === 'live' ? "LIVE" : "PAPER"}
                                        </Typography>
                                    </Box>
                                    <Switch
                                        checked={config.tradingMode === 'live'}
                                        onChange={(e) => {
                                            if (e.target.checked && !window.confirm("DANGER: Enable Real Money Trading?")) return;
                                            updateConfig('tradingMode', e.target.checked ? 'live' : 'paper');
                                        }}
                                        color="error"
                                    />
                                </Box>
                            </Card>
                        </Grid>

                        {/* Capital Input */}
                        <Grid item xs={12} sm={6} md={3}>
                            <TextField
                                fullWidth label="Max Capital" type="number"
                                value={config.maxCapitalAtRisk}
                                onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
                                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                            />
                        </Grid>

                        {/* Master On/Off */}
                        <Grid item xs={12} sm={6} md={4}>
                             <FormControl fullWidth>
                                <Box 
                                    display="flex" alignItems="center" justifyContent="space-between" 
                                    border={1} borderColor={config.enableTrading ? "success.main" : "divider"} 
                                    borderRadius={1} p={1.5}
                                    bgcolor={config.enableTrading ? "rgba(46, 125, 50, 0.05)" : "transparent"}
                                >
                                    <Typography fontWeight="bold">Master Switch</Typography>
                                    <Switch checked={config.enableTrading} onChange={(e) => updateConfig('enableTrading', e.target.checked)} color="success" />
                                </Box>
                            </FormControl>
                        </Grid>
                    </Grid>
                </AccordionDetails>
            </Accordion>
        </Grid>

        <Grid item xs={12} md={4}>
            <Accordion defaultExpanded sx={{ height: '100%' }}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                <Mail sx={{ mr: 1, color: 'info.main' }} />
                <Typography variant="h6">Notifications</Typography>
                </AccordionSummary>
                <AccordionDetails>
                <Grid container spacing={2}>
                    <Grid item xs={12}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography>Enable Alerts</Typography>
                        <Switch 
                        checked={config.enableEmailAlerts} 
                        onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)} 
                        color="primary"
                        />
                    </Box>
                    </Grid>
                    <Grid item xs={12}>
                    <TextField 
                        fullWidth size="small"
                        label="Email Address" 
                        placeholder="you@example.com"
                        value={config.alertEmail} 
                        onChange={(e) => updateConfig('alertEmail', e.target.value)}
                        disabled={!config.enableEmailAlerts}
                    />
                    </Grid>
                </Grid>
                </AccordionDetails>
            </Accordion>
        </Grid>

        {/* === ROW 2: STRATEGY (50%) & RISK (50%) === */}
        <Grid item xs={12} md={6}>
            <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMore />}>
                <TrendingUp sx={{ mr: 1, color: 'secondary.main' }} />
                <Typography variant="h6">Strategy & Filters</Typography>
                </AccordionSummary>
                <AccordionDetails>
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Strategy</InputLabel>
                        <Select value={config.strategy} label="Strategy" onChange={(e) => updateConfig('strategy', e.target.value)}>
                        <MenuItem value="conservative">Conservative (SMA)</MenuItem>
                        <MenuItem value="balanced">Balanced (20/50 EMA)</MenuItem>
                        <MenuItem value="responsive">Responsive (12/26 EMA)</MenuItem>
                        </Select>
                    </FormControl>
                    </Grid>
                    <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Timeframe</InputLabel>
                        <Select value={config.timeframe} label="Timeframe" onChange={(e) => updateConfig('timeframe', e.target.value)}>
                        <MenuItem value="15m">15 Min</MenuItem>
                        <MenuItem value="1h">1 Hour</MenuItem>
                        <MenuItem value="4h">4 Hour</MenuItem>
                        </Select>
                    </FormControl>
                    </Grid>

                    {/* Advanced Filters Chip REMOVED here */}

                    <Grid item xs={12}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2">ADX Filter (Trend Strength)</Typography>
                        <Switch size="small" checked={config.enableAdxFilter} onChange={(e) => updateConfig('enableAdxFilter', e.target.checked)} />
                    </Box>
                    <Box px={1}>
                        <Slider 
                            value={config.minAdx} 
                            onChange={(_, v) => updateConfig('minAdx', v)} 
                            disabled={!config.enableAdxFilter}
                            min={10} max={50} step={1} 
                            valueLabelDisplay="auto"
                            marks={[{value: 20, label: 'Weak'}, {value: 30, label: 'Strong'}]}
                        />
                    </Box>
                    </Grid>

                    <Grid item xs={12}>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                            <Typography variant="body2">RSI Filter (Overbought/Sold)</Typography>
                            <Switch size="small" checked={config.enableRsiFilter} onChange={(e) => updateConfig('enableRsiFilter', e.target.checked)} />
                        </Box>
                        <Grid container spacing={2}>
                            <Grid item xs={6}>
                                <TextField fullWidth size="small" label="Sell > (Overbought)" type="number" 
                                    value={config.rsiOverbought} 
                                    onChange={(e) => updateConfig('rsiOverbought', parseFloat(e.target.value))}
                                    disabled={!config.enableRsiFilter}
                                />
                            </Grid>
                            <Grid item xs={6}>
                                <TextField fullWidth size="small" label="Buy < (Oversold)" type="number" 
                                    value={config.rsiOversold} 
                                    onChange={(e) => updateConfig('rsiOversold', parseFloat(e.target.value))}
                                    disabled={!config.enableRsiFilter}
                                />
                            </Grid>
                        </Grid>
                    </Grid>
                </Grid>
                </AccordionDetails>
            </Accordion>
        </Grid>

        <Grid item xs={12} md={6}>
            <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMore />}>
                <Security sx={{ mr: 1, color: 'warning.main' }} />
                <Typography variant="h6">Risk Management</Typography>
                </AccordionSummary>
                <AccordionDetails>
                <Grid container spacing={2}>
                    <Grid item xs={12}>
                    <Box display="flex" justifyContent="space-between">
                        <Typography variant="body2" gutterBottom>Risk Per Trade: {config.riskPerTrade}%</Typography>
                        <Typography variant="body2" color="text.secondary">(${riskAmounts.riskPerTrade})</Typography>
                    </Box>
                    <Slider value={config.riskPerTrade} onChange={(_, v) => updateConfig('riskPerTrade', v)} min={0.1} max={5.0} step={0.1} />
                    </Grid>
                    <Grid item xs={6}>
                    <TextField fullWidth size="small" label="Stop Loss (ATR)" type="number" 
                        value={config.stopLossATR} onChange={(e) => updateConfig('stopLossATR', parseFloat(e.target.value))}
                        inputProps={{ step: 0.1 }} />
                    </Grid>
                    <Grid item xs={6}>
                    <TextField fullWidth size="small" label="Take Profit (ATR)" type="number" 
                        value={config.takeProfitATRMultiplier} onChange={(e) => updateConfig('takeProfitATRMultiplier', parseFloat(e.target.value))}
                        inputProps={{ step: 0.1 }} />
                    </Grid>
                    <Grid item xs={12}>
                    <TextField fullWidth size="small" label="Min Order Size ($)" type="number" 
                        value={config.minOrderSize} onChange={(e) => updateConfig('minOrderSize', parseFloat(e.target.value))} />
                    </Grid>
                </Grid>
                </AccordionDetails>
            </Accordion>
        </Grid>

        {/* === ROW 3: PORTFOLIO COMPOSITION (100% - Horizontal Redesign) === */}
        <Grid item xs={12}>
            <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMore />}>
                <Settings sx={{ mr: 1, color: 'success.main' }} />
                <Typography variant="h6">Portfolio Composition</Typography>
                </AccordionSummary>
                <AccordionDetails>
                
                {/* Control Bar */}
                <Box display="flex" gap={2} mb={3} alignItems="center">
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>Select Asset to Add</InputLabel>
                        <Select 
                            value={newAsset} 
                            label="Select Asset to Add"
                            onChange={(e) => setNewAsset(e.target.value)}
                        >
                            {SUPPORTED_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (
                                <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button variant="contained" onClick={handleAddAsset} disabled={!newAsset} startIcon={<AddCircle />}>
                        Add Asset
                    </Button>

                    <Box ml="auto" px={2} py={1} bgcolor={totalAllocation > 100 ? 'error.light' : 'background.default'} borderRadius={1} border={1} borderColor="divider">
                         <Typography variant="body2" fontWeight="bold" color={totalAllocation > 100 ? 'error.contrastText' : 'text.primary'}>
                            Allocated: {totalAllocation}% {totalAllocation !== 100 && (
                                <span style={{ fontWeight: 'normal', opacity: 0.8 }}>
                                    ({totalAllocation < 100 ? `${100 - totalAllocation}% Cash` : `-${totalAllocation - 100}% Over`})
                                </span>
                            )}
                        </Typography>
                    </Box>
                </Box>

                {/* Horizontal Grid of Assets */}
                <Grid container spacing={2}>
                    {config.assets.length === 0 && (
                        <Grid item xs={12}>
                            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.default' }}>
                                <Typography color="text.secondary">
                                    No assets in portfolio. Add an asset to start trading.
                                </Typography>
                            </Paper>
                        </Grid>
                    )}
                    
                    {config.assets.map(asset => (
                        <Grid item xs={12} sm={6} md={4} lg={3} key={asset}>
                            <Paper variant="outlined" sx={{ p: 2, position: 'relative' }}>
                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                    <Typography variant="subtitle1" fontWeight="bold">{asset.replace('USDT','')}</Typography>
                                    <IconButton size="small" color="error" onClick={() => handleRemoveAsset(asset)}>
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </Box>
                                
                                <Slider 
                                    value={config.allocation[asset] || 0} 
                                    onChange={(_, v) => updateAllocation(asset, v)}
                                    min={0} max={50} step={1} 
                                    size="small"
                                    sx={{ mb: 1 }}
                                />
                                
                                <Box display="flex" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption" color="text.secondary">Target Allocation</Typography>
                                    <Typography variant="body2" fontWeight="bold" color="primary">{config.allocation[asset] || 0}%</Typography>
                                </Box>
                            </Paper>
                        </Grid>
                    ))}
                </Grid>

                </AccordionDetails>
            </Accordion>
        </Grid>

      </Grid>
    </Container>
  );
};

export default TradingConfig;