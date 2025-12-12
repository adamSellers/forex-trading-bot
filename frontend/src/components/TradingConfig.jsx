// frontend/src/components/TradingConfig.jsx - LINTER FIX
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Grid, Typography, TextField, Button, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, Alert, Chip, Card, InputAdornment,
  Accordion, AccordionSummary, AccordionDetails, Divider, IconButton, Stack
} from '@mui/material';
import {
  Save, Refresh, ExpandMore, TrendingUp, Security, AccountBalance,
  Settings, MoneyOff, MonetizationOn, FilterList, Mail, Delete
} from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// Curated List of Top 20 High-Liquidity Assets on Binance
const SUPPORTED_ASSETS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'SHIBUSDT',
  'TONUSDT', 'LINKUSDT', 'DOTUSDT', 'BCHUSDT', 'LTCUSDT',
  'UNIUSDT', 'NEARUSDT', 'MATICUSDT', 'ICPUSDT', 'PEPEUSDT'
];

// FIX: Define defaults OUTSIDE component to stabilize useEffect dependencies
const DEFAULT_CONFIG = {
    // Account Settings
    maxCapitalAtRisk: 5000,
    tradingMode: 'paper',
    enableTrading: false,
    
    // Risk Management
    riskPerTrade: 1.0,
    maxDailyLoss: 2.0,
    maxWeeklyLoss: 5.0,
    stopLossATR: 1.5,
    takeProfitATRMultiplier: 3.0,
    minOrderSize: 10,
    
    // Strategy Settings
    strategy: 'balanced',
    timeframe: '1h',
    signalCooldown: 60,
    
    // Advanced Filters
    enableAdxFilter: true,
    minAdx: 25,
    enableRsiFilter: true,
    rsiOverbought: 70,
    rsiOversold: 30,
    
    // Dynamic Assets & Allocation
    assets: [], 
    allocation: {}, 
    
    // Notifications
    enableEmailAlerts: false,
    alertEmail: '',

    // System
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

  // FIX: Uses DEFAULT_CONFIG instead of state 'config' to avoid circular dependencies
  const fetchCurrentConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await tradingAPI.getStatus();
      
      if (data.config) {
        // Map backend config to frontend state & Normalize Percentages
        const fetchedConfig = {
          ...DEFAULT_CONFIG, // Use static default, not dynamic state
          ...data.config,
          riskPerTrade: (data.config.riskPerTrade * 100) || 1.0,
          maxDailyLoss: (data.config.maxDailyLoss * 100) || 2.0,
          maxWeeklyLoss: (data.config.maxWeeklyLoss * 100) || 5.0,
          signalCooldown: (data.config.signalCooldown / 1000) || 60,
          allocation: { ...data.config.allocation }
        };
        
        // Fix allocation percentages if they came in as decimals (0.3)
        Object.keys(fetchedConfig.allocation).forEach(key => {
            if (fetchedConfig.allocation[key] <= 1) {
                fetchedConfig.allocation[key] = fetchedConfig.allocation[key] * 100;
            }
        });

        // Ensure assets array exists
        if (!fetchedConfig.assets) fetchedConfig.assets = [];

        setConfig(fetchedConfig);
        setOriginalConfig(fetchedConfig);
      }
    } catch (err) {
      setError(`Failed to load configuration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []); // Dependency array is now truly empty and safe

  useEffect(() => { 
      fetchCurrentConfig(); 
  }, [fetchCurrentConfig]);

  useEffect(() => {
    setHasChanges(JSON.stringify(config) !== JSON.stringify(originalConfig));
  }, [config, originalConfig]);

  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      // Prepare payload for API (Convert to decimals/milliseconds)
      const configToSave = {
        ...config,
        riskPerTrade: config.riskPerTrade / 100,
        maxDailyLoss: config.maxDailyLoss / 100,
        maxWeeklyLoss: config.maxWeeklyLoss / 100,
        signalCooldown: config.signalCooldown * 1000,
        allocation: {}
      };

      // Clean allocation (remove 0% or deleted assets) and convert to decimal
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

  const updateConfig = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // --- Dynamic Asset Logic ---
  const handleAddAsset = () => {
      if (!newAsset || config.assets.includes(newAsset)) return;
      setConfig(prev => ({
          ...prev,
          assets: [...prev.assets, newAsset],
          allocation: { ...prev.allocation, [newAsset]: 0 } // Start at 0%
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
      setConfig(prev => ({
          ...prev,
          allocation: { ...prev.allocation, [asset]: val }
      }));
  };

  const totalAllocation = config.assets.reduce((sum, asset) => sum + (config.allocation[asset] || 0), 0);
  
  const riskAmounts = {
    riskPerTrade: (config.maxCapitalAtRisk * config.riskPerTrade / 100).toFixed(2),
    maxDailyLoss: (config.maxCapitalAtRisk * config.maxDailyLoss / 100).toFixed(2),
    maxWeeklyLoss: (config.maxCapitalAtRisk * config.maxWeeklyLoss / 100).toFixed(2)
  };

  if (loading) return <Box><Typography>Loading...</Typography></Box>;

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Trading Configuration</Typography>
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
        
        {/* 1. Account Settings */}
        <Grid item xs={12} md={6}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <AccountBalance sx={{ mr: 1 }} />
              <Typography variant="h6">Account</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Card variant="outlined" sx={{ p: 2, borderColor: config.tradingMode === 'live' ? 'error.main' : 'warning.main' }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between">
                        <Box display="flex" alignItems="center" gap={1}>
                            {config.tradingMode === 'live' ? <MonetizationOn color="error" /> : <MoneyOff color="warning" />}
                            <Typography variant="subtitle1" fontWeight="bold">
                                {config.tradingMode === 'live' ? "LIVE TRADING (REAL MONEY)" : "PAPER TRADING (SIMULATION)"}
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
                <Grid item xs={6}>
                  <TextField
                    fullWidth label="Max Capital" type="number"
                    value={config.maxCapitalAtRisk}
                    onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  />
                </Grid>
                <Grid item xs={6} display="flex" alignItems="center">
                  <FormControl fullWidth>
                     <Box display="flex" alignItems="center" justifyContent="space-between" border={1} borderColor="divider" borderRadius={1} p={1.5}>
                        <Typography>Master Switch</Typography>
                        <Switch checked={config.enableTrading} onChange={(e) => updateConfig('enableTrading', e.target.checked)} color="success" />
                     </Box>
                  </FormControl>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

        {/* 2. Risk Management */}
        <Grid item xs={12} md={6}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Security sx={{ mr: 1 }} />
              <Typography variant="h6">Risk Management</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="body2" gutterBottom>Risk Per Trade: {config.riskPerTrade}% (${riskAmounts.riskPerTrade})</Typography>
                  <Slider value={config.riskPerTrade} onChange={(_, v) => updateConfig('riskPerTrade', v)} min={0.1} max={5.0} step={0.1} valueLabelDisplay="auto" />
                </Grid>
                <Grid item xs={6}>
                  <TextField fullWidth label="Stop Loss (ATR)" type="number" 
                    value={config.stopLossATR} onChange={(e) => updateConfig('stopLossATR', parseFloat(e.target.value))}
                    inputProps={{ step: 0.1 }} />
                </Grid>
                <Grid item xs={6}>
                  <TextField fullWidth label="Take Profit (ATR)" type="number" 
                    value={config.takeProfitATRMultiplier} onChange={(e) => updateConfig('takeProfitATRMultiplier', parseFloat(e.target.value))}
                    inputProps={{ step: 0.1 }} />
                </Grid>
                <Grid item xs={6}>
                  <TextField fullWidth label="Min Order Size ($)" type="number" 
                    value={config.minOrderSize} onChange={(e) => updateConfig('minOrderSize', parseFloat(e.target.value))} />
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

        {/* 3. Strategy Settings */}
        <Grid item xs={12} md={6}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <TrendingUp sx={{ mr: 1 }} />
              <Typography variant="h6">Strategy & Filters</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>Strategy</InputLabel>
                    <Select value={config.strategy} label="Strategy" onChange={(e) => updateConfig('strategy', e.target.value)}>
                      <MenuItem value="conservative">Conservative (SMA)</MenuItem>
                      <MenuItem value="balanced">Balanced (20/50 EMA)</MenuItem>
                      <MenuItem value="responsive">Responsive (12/26 EMA)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>Timeframe</InputLabel>
                    <Select value={config.timeframe} label="Timeframe" onChange={(e) => updateConfig('timeframe', e.target.value)}>
                      <MenuItem value="15m">15 Min</MenuItem>
                      <MenuItem value="1h">1 Hour</MenuItem>
                      <MenuItem value="4h">4 Hour</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12}>
                  <Divider textAlign="left"><Chip icon={<FilterList />} label="Advanced Filters" /></Divider>
                </Grid>

                <Grid item xs={12}>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography>ADX Filter (Anti-Chop)</Typography>
                    <Switch checked={config.enableAdxFilter} onChange={(e) => updateConfig('enableAdxFilter', e.target.checked)} />
                  </Box>
                  <Box px={2}>
                    <Typography variant="caption" color="textSecondary">
                        Min Trend Strength (ADX): {config.minAdx}
                    </Typography>
                    <Slider 
                        value={config.minAdx} 
                        onChange={(_, v) => updateConfig('minAdx', v)} 
                        disabled={!config.enableAdxFilter}
                        min={10} max={50} step={1} 
                        marks={[{value: 20, label: 'Weak'}, {value: 25, label: 'Strong'}, {value: 40, label: 'Very Strong'}]}
                    />
                  </Box>
                </Grid>

                <Grid item xs={12}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography>RSI Filter (Overbought/Sold)</Typography>
                        <Switch checked={config.enableRsiFilter} onChange={(e) => updateConfig('enableRsiFilter', e.target.checked)} />
                    </Box>
                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <TextField fullWidth size="small" label="Overbought >" type="number" 
                                value={config.rsiOverbought} 
                                onChange={(e) => updateConfig('rsiOverbought', parseFloat(e.target.value))}
                                disabled={!config.enableRsiFilter}
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField fullWidth size="small" label="Oversold <" type="number" 
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

        {/* 4. Portfolio Composition (DYNAMIC) */}
        <Grid item xs={12} md={6}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Settings sx={{ mr: 1 }} />
              <Typography variant="h6">Portfolio Composition</Typography>
            </AccordionSummary>
            <AccordionDetails>
              
              {/* Asset Selector */}
              <Box display="flex" gap={1} mb={2}>
                <FormControl fullWidth size="small">
                    <InputLabel>Add Asset to Portfolio</InputLabel>
                    <Select 
                        value={newAsset} 
                        label="Add Asset to Portfolio"
                        onChange={(e) => setNewAsset(e.target.value)}
                    >
                        {SUPPORTED_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (
                            <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Button variant="contained" onClick={handleAddAsset} disabled={!newAsset}>Add</Button>
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Dynamic Sliders */}
              <Stack spacing={2}>
                {config.assets.map(asset => (
                    <Box key={asset}>
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" fontWeight="bold">{asset}</Typography>
                            <Box display="flex" alignItems="center">
                                <Typography variant="caption" sx={{ mr: 1 }}>{config.allocation[asset] || 0}%</Typography>
                                <IconButton size="small" color="error" onClick={() => handleRemoveAsset(asset)}>
                                    <Delete fontSize="small" />
                                </IconButton>
                            </Box>
                        </Box>
                        <Slider 
                            value={config.allocation[asset] || 0} 
                            onChange={(_, v) => updateAllocation(asset, v)}
                            min={0} max={50} step={5}
                            size="small"
                        />
                    </Box>
                ))}
              </Stack>

              <Box mt={2} p={1} bgcolor={totalAllocation > 100 ? 'error.light' : 'action.hover'} borderRadius={1}>
                  <Typography variant="body2" align="center" fontWeight="bold" color={totalAllocation > 100 ? 'error.contrastText' : 'text.primary'}>
                      Total Allocation: {totalAllocation}%
                  </Typography>
              </Box>

            </AccordionDetails>
          </Accordion>
        </Grid>
        
        {/* 5. Notifications (RESTORED) */}
        <Grid item xs={12} md={6}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Mail sx={{ mr: 1 }} />
              <Typography variant="h6">Notifications</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography>Enable Email Alerts</Typography>
                    <Switch 
                      checked={config.enableEmailAlerts} 
                      onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)} 
                      color="primary"
                    />
                  </Box>
                  <Typography variant="caption" color="textSecondary" display="block" mb={2}>
                    Receive instant alerts when the bot executes a trade.
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <TextField 
                    fullWidth 
                    label="Alert Email Address" 
                    placeholder="you@example.com"
                    value={config.alertEmail} 
                    onChange={(e) => updateConfig('alertEmail', e.target.value)}
                    disabled={!config.enableEmailAlerts}
                    helperText="Leave blank to use the securely stored default email"
                  />
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

      </Grid>
    </Box>
  );
};

export default TradingConfig;