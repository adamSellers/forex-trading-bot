// frontend/src/components/TradingConfig.jsx - PROFESSIONAL SIDEBAR LAYOUT
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, Alert, Card, InputAdornment,
  IconButton, Paper, Container, Stack, Divider, Chip,
  List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Avatar, Tooltip, Grid, useTheme, alpha
} from '@mui/material';
import {
  Save, Refresh, TrendingUp, Security, AccountBalance,
  PieChart, Notifications, Delete, AddCircle, Warning,
  ChevronRight, Science, Tune, BarChart
} from '@mui/icons-material';
import { tradingAPI } from '../config/api';

// --- ASSETS & DEFAULTS ---
const SUPPORTED_ASSETS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'SHIBUSDT',
  'TONUSDT', 'LINKUSDT', 'DOTUSDT', 'BCHUSDT', 'LTCUSDT',
  'UNIUSDT', 'NEARUSDT', 'MATICUSDT', 'ICPUSDT', 'PEPEUSDT'
];

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
  const theme = useTheme();
  
  // --- STATE ---
  const [activeSection, setActiveSection] = useState('general'); // general, strategy, risk, portfolio
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState({});
  const [newAsset, setNewAsset] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // --- FETCH DATA ---
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

  // --- SAVE HANDLER ---
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
  
  // Asset Handlers
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

  // --- RENDER HELPERS ---
  
  const SectionHeader = ({ title, description }) => (
      <Box mb={4}>
          <Typography variant="h5" fontWeight="bold" gutterBottom>{title}</Typography>
          <Typography variant="body2" color="text.secondary">{description}</Typography>
          <Divider sx={{ mt: 2 }} />
      </Box>
  );

  const renderGeneral = () => (
      <Box maxWidth="md">
          <SectionHeader 
            title="General Settings" 
            description="Manage your trading environment, capital limits, and master controls." 
          />
          
          <Stack spacing={4}>
            {/* Environment Card */}
            <Paper variant="outlined" sx={{ p: 3, bgcolor: alpha(theme.palette.background.paper, 0.5) }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold">Trading Environment</Typography>
                        <Typography variant="caption" color="text.secondary">
                            Switch between Paper Trading (Simulation) and Live Trading (Real Funds).
                        </Typography>
                    </Box>
                    <FormControl component="fieldset">
                        <Stack direction="row" spacing={1} alignItems="center" bgcolor={theme.palette.background.default} p={0.5} borderRadius={2} border={1} borderColor="divider">
                            <Box 
                                px={2} py={0.5} borderRadius={1.5} 
                                bgcolor={!config.tradingMode === 'live' ? 'transparent' : alpha(theme.palette.warning.main, 0.1)}
                                color={!config.tradingMode === 'live' ? 'text.secondary' : 'warning.main'}
                            >
                                <Typography variant="caption" fontWeight="bold">PAPER</Typography>
                            </Box>
                            <Switch
                                checked={config.tradingMode === 'live'}
                                onChange={(e) => {
                                    if (e.target.checked && !window.confirm("DANGER: Are you sure you want to enable Real Money Trading?")) return;
                                    updateConfig('tradingMode', e.target.checked ? 'live' : 'paper');
                                }}
                                color="error"
                            />
                            <Box 
                                px={2} py={0.5} borderRadius={1.5} 
                                bgcolor={config.tradingMode === 'live' ? alpha(theme.palette.error.main, 0.1) : 'transparent'}
                                color={config.tradingMode === 'live' ? 'error.main' : 'text.secondary'}
                            >
                                <Typography variant="caption" fontWeight="bold">LIVE</Typography>
                            </Box>
                        </Stack>
                    </FormControl>
                </Box>
            </Paper>

            {/* Capital & Master Switch */}
            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    <TextField
                        fullWidth label="Max Capital Allocation" type="number"
                        helperText="Maximum USDT the bot is allowed to use from your wallet."
                        value={config.maxCapitalAtRisk}
                        onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
                        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    />
                </Grid>
                <Grid item xs={12} md={6}>
                     <Box 
                        display="flex" alignItems="center" justifyContent="space-between" 
                        border={1} borderColor={config.enableTrading ? "success.main" : "divider"} 
                        borderRadius={1} p={2} height="100%"
                        bgcolor={config.enableTrading ? alpha(theme.palette.success.main, 0.05) : "transparent"}
                     >
                        <Box>
                            <Typography fontWeight="bold">Master Bot Switch</Typography>
                            <Typography variant="caption" color="text.secondary" display="block">
                                {config.enableTrading ? "System Active" : "System Paused"}
                            </Typography>
                        </Box>
                        <Switch 
                            checked={config.enableTrading} 
                            onChange={(e) => updateConfig('enableTrading', e.target.checked)} 
                            color="success"
                        />
                     </Box>
                </Grid>
            </Grid>

            {/* Notifications */}
            <Box>
                <Typography variant="subtitle2" gutterBottom>Notifications</Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                    <Box display="flex" alignItems="center" minWidth={200}>
                        <Switch checked={config.enableEmailAlerts} onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)} />
                        <Typography variant="body2">Enable Email Alerts</Typography>
                    </Box>
                    <TextField 
                        fullWidth size="small" label="Alert Email Address" 
                        value={config.alertEmail} 
                        onChange={(e) => updateConfig('alertEmail', e.target.value)}
                        disabled={!config.enableEmailAlerts}
                    />
                </Stack>
            </Box>
          </Stack>
      </Box>
  );

  const renderStrategy = () => (
      <Box maxWidth="md">
          <SectionHeader 
            title="Strategy Logic" 
            description="Configure the technical indicators and rules the bot uses to enter and exit trades." 
          />
          
          <Grid container spacing={4}>
              <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                      <InputLabel>Strategy Type</InputLabel>
                      <Select value={config.strategy} label="Strategy Type" onChange={(e) => updateConfig('strategy', e.target.value)}>
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

          <Box mt={4}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Entry Conditions</Typography>
              <Paper variant="outlined" sx={{ p: 3 }}>
                  <Stack spacing={3}>
                      <Box>
                          <Box display="flex" justifyContent="space-between" mb={1}>
                              <Box display="flex" alignItems="center" gap={1}>
                                  <Typography fontWeight="bold">ADX Trend Filter</Typography>
                                  <Tooltip title="Average Directional Index: Measures trend strength. Higher values mean stronger trends.">
                                      <Science fontSize="small" color="action" />
                                  </Tooltip>
                              </Box>
                              <Switch size="small" checked={config.enableAdxFilter} onChange={(e) => updateConfig('enableAdxFilter', e.target.checked)} />
                          </Box>
                          <Slider 
                              value={config.minAdx} min={10} max={50} step={1}
                              onChange={(_, v) => updateConfig('minAdx', v)} disabled={!config.enableAdxFilter}
                              valueLabelDisplay="auto" marks={[{value: 25, label: 'Standard'}, {value: 40, label: 'Strong'}]}
                          />
                      </Box>
                      <Divider />
                      <Box>
                          <Box display="flex" justifyContent="space-between" mb={1}>
                              <Box display="flex" alignItems="center" gap={1}>
                                  <Typography fontWeight="bold">RSI Momentum Filter</Typography>
                                  <Tooltip title="Relative Strength Index: Prevents buying at tops or selling at bottoms.">
                                      <Tune fontSize="small" color="action" />
                                  </Tooltip>
                              </Box>
                              <Switch size="small" checked={config.enableRsiFilter} onChange={(e) => updateConfig('enableRsiFilter', e.target.checked)} />
                          </Box>
                          <Grid container spacing={3}>
                              <Grid item xs={6}>
                                   <TextField 
                                      fullWidth size="small" label="Overbought Threshold (>)" type="number"
                                      value={config.rsiOverbought} onChange={(e) => updateConfig('rsiOverbought', parseFloat(e.target.value))} 
                                      disabled={!config.enableRsiFilter}
                                  />
                              </Grid>
                              <Grid item xs={6}>
                                   <TextField 
                                      fullWidth size="small" label="Oversold Threshold (<)" type="number"
                                      value={config.rsiOversold} onChange={(e) => updateConfig('rsiOversold', parseFloat(e.target.value))} 
                                      disabled={!config.enableRsiFilter}
                                  />
                              </Grid>
                          </Grid>
                      </Box>
                  </Stack>
              </Paper>
          </Box>
      </Box>
  );

  const renderRisk = () => (
      <Box maxWidth="md">
          <SectionHeader 
            title="Risk Management" 
            description="Define safety parameters to protect your capital and manage trade exits." 
          />

          <Stack spacing={4}>
              <Box>
                   <Typography gutterBottom>Risk Per Trade (% of Capital)</Typography>
                   <Stack direction="row" spacing={3} alignItems="center">
                      <Slider 
                          value={config.riskPerTrade} min={0.1} max={5.0} step={0.1}
                          onChange={(_, v) => updateConfig('riskPerTrade', v)} 
                          valueLabelDisplay="auto"
                          sx={{ flexGrow: 1 }}
                      />
                      <Paper variant="outlined" sx={{ px: 2, py: 1, minWidth: 80, textAlign: 'center' }}>
                          <Typography fontWeight="bold">{config.riskPerTrade}%</Typography>
                      </Paper>
                   </Stack>
              </Box>

              <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                      <TextField 
                          fullWidth label="Stop Loss (ATR Multiplier)" type="number"
                          helperText="Dynamic stop loss based on volatility."
                          value={config.stopLossATR} 
                          onChange={(e) => updateConfig('stopLossATR', parseFloat(e.target.value))} 
                          inputProps={{ step: 0.1 }} 
                      />
                  </Grid>
                   <Grid item xs={12} md={6}>
                      <TextField 
                          fullWidth label="Take Profit (ATR Multiplier)" type="number"
                          helperText="Dynamic take profit target."
                          value={config.takeProfitATRMultiplier} 
                          onChange={(e) => updateConfig('takeProfitATRMultiplier', parseFloat(e.target.value))} 
                          inputProps={{ step: 0.1 }} 
                      />
                  </Grid>
                   <Grid item xs={12} md={6}>
                      <TextField 
                          fullWidth label="Max Daily Loss Limit (%)" type="number"
                          helperText="Bot stops trading if daily loss exceeds this."
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
          </Stack>
      </Box>
  );

  const renderPortfolio = () => (
      <Box maxWidth="md">
          <SectionHeader 
            title="Portfolio Composition" 
            description="Select which assets the bot should trade and their capital allocation." 
          />

           <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} p={2} bgcolor={alpha(theme.palette.background.paper, 0.5)} borderRadius={2}>
                 <Box>
                     <Typography variant="subtitle2" color="text.secondary">Total Allocated</Typography>
                     <Typography variant="h5" fontWeight="bold" color={totalAllocation > 100 ? 'error.main' : 'success.main'}>
                         {totalAllocation}%
                     </Typography>
                 </Box>
                 
                 <Box display="flex" gap={2}>
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>Add Asset</InputLabel>
                        <Select value={newAsset} label="Add Asset" onChange={(e) => setNewAsset(e.target.value)}>
                            {SUPPORTED_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (
                                <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button variant="contained" onClick={handleAddAsset} disabled={!newAsset} startIcon={<AddCircle />}>
                        Add
                    </Button>
                 </Box>
            </Box>

            <List disablePadding>
                {config.assets.length === 0 && (
                    <Alert severity="info" sx={{ width: '100%' }}>Your portfolio is empty. Add an asset to begin.</Alert>
                )}
                
                {config.assets.map((asset) => (
                    <Paper key={asset} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                        <ListItem sx={{ flexWrap: 'wrap', gap: 2 }}>
                             <Box display="flex" alignItems="center" minWidth={100}>
                                <Avatar sx={{ width: 32, height: 32, mr: 2, bgcolor: 'primary.main', fontSize: '0.8rem' }}>
                                    {asset.substring(0,3)}
                                </Avatar>
                                <ListItemText primary={asset.replace('USDT', '')} secondary="USDT Pair" />
                             </Box>

                             <Box sx={{ flexGrow: 1, minWidth: 200 }}>
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
                    </Paper>
                ))}
            </List>
      </Box>
  );

  // --- MAIN RENDER ---
  if (loading) return <Box p={4} display="flex" justifyContent="center"><Typography>Loading Configuration...</Typography></Box>;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
        
        {/* Header Actions */}
        <Box display="flex" justifyContent="flex-end" mb={2} gap={2}>
            <Button startIcon={<Refresh />} onClick={fetchCurrentConfig} disabled={saving}>
                Revert Changes
            </Button>
            <Button 
                variant="contained" 
                startIcon={<Save />} 
                onClick={handleSaveConfig} 
                disabled={!hasChanges || saving}
            >
                {saving ? 'Saving...' : 'Save Configuration'}
            </Button>
        </Box>
        
        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 3 }}>Configuration saved successfully!</Alert>}

        <Grid container spacing={4}>
            {/* SIDEBAR NAVIGATION */}
            <Grid item xs={12} md={3} lg={2.5}>
                <Paper variant="outlined" sx={{ position: 'sticky', top: 24 }}>
                    <List component="nav">
                        <ListItemButton selected={activeSection === 'general'} onClick={() => setActiveSection('general')}>
                            <ListItemIcon><AccountBalance color={activeSection === 'general' ? 'primary' : 'inherit'} /></ListItemIcon>
                            <ListItemText primary="General" />
                            <ChevronRight color="action" fontSize="small" />
                        </ListItemButton>
                        <Divider />
                        <ListItemButton selected={activeSection === 'strategy'} onClick={() => setActiveSection('strategy')}>
                            <ListItemIcon><TrendingUp color={activeSection === 'strategy' ? 'primary' : 'inherit'} /></ListItemIcon>
                            <ListItemText primary="Strategy" />
                            <ChevronRight color="action" fontSize="small" />
                        </ListItemButton>
                        <Divider />
                        <ListItemButton selected={activeSection === 'risk'} onClick={() => setActiveSection('risk')}>
                            <ListItemIcon><Security color={activeSection === 'risk' ? 'primary' : 'inherit'} /></ListItemIcon>
                            <ListItemText primary="Risk Management" />
                            <ChevronRight color="action" fontSize="small" />
                        </ListItemButton>
                        <Divider />
                        <ListItemButton selected={activeSection === 'portfolio'} onClick={() => setActiveSection('portfolio')}>
                            <ListItemIcon><PieChart color={activeSection === 'portfolio' ? 'primary' : 'inherit'} /></ListItemIcon>
                            <ListItemText primary="Portfolio" />
                            <ChevronRight color="action" fontSize="small" />
                        </ListItemButton>
                    </List>
                </Paper>
            </Grid>

            {/* MAIN CONTENT AREA */}
            <Grid item xs={12} md={9} lg={9.5}>
                <Box minHeight="60vh">
                    {activeSection === 'general' && renderGeneral()}
                    {activeSection === 'strategy' && renderStrategy()}
                    {activeSection === 'risk' && renderRisk()}
                    {activeSection === 'portfolio' && renderPortfolio()}
                </Box>
            </Grid>
        </Grid>

    </Container>
  );
};

export default TradingConfig;