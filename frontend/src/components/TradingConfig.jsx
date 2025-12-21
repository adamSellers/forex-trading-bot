// frontend/src/components/TradingConfig.jsx - ADDED TRAILING STOP DEFAULTS
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, Alert, InputAdornment,
  IconButton, Container, Stack, Divider, Chip, Tabs, Tab,
  List, ListItem, Avatar, Grid, styled, alpha, useTheme, Paper
} from '@mui/material';
import {
  Save, Refresh, Security, AccountBalance,
  PieChart, SettingsRemote, Warning, RestartAlt, DeleteForever,
  AddCircle, Delete, Science, Tune, Email
} from '@mui/icons-material';
import { tradingAPI, managementAPI } from '../config/api';

const GlassCard = styled(Box)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  padding: theme.spacing(3),
  transition: 'border-color 0.3s ease',
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

const SUPPORTED_ASSETS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", 
  "DOGEUSDT", "ADAUSDT", "TRXUSDT", "AVAXUSDT", "SHIBUSDT", 
  "TONUSDT", "LINKUSDT", "DOTUSDT", "BCHUSDT", "LTCUSDT", 
  "UNIUSDT", "NEARUSDT", "MATICUSDT", "ICPUSDT", "PEPEUSDT",
  "FETUSDT", "WIFUSDT"
].sort();

const DEFAULT_CONFIG = {
    maxCapitalAtRisk: 1000,
    enableTrading: false, // Kill Switch
    riskPerTrade: 0.98,
    minOrderSize: 10,
    strategy: 'supertrend_momentum',
    timeframe: '1h',
    signalCooldown: 60,
    enableAdxFilter: true,
    minAdx: 20, 
    enableRsiFilter: true,
    rsiOverbought: 75,
    rsiOversold: 30,
    stopLossType: 'FIXED',
    stopLossPercent: 0.05, 
    
    // --- FIX: Explicit Trailing Stop Defaults ---
    enableTrailingStops: false,
    trailingStopPercent: 0.03, // 3% default

    assets: [], 
    allocation: {}, 
    enableEmailAlerts: false,
    alertEmail: '',
    logLevel: 'info'
};

const TradingConfig = () => {
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState(0);
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
          riskPerTrade: (data.config.riskPerTrade) || 0.98,
          stopLossPercent: (data.config.stopLossPercent * 100) || 5.0,
          
          // --- FIX: Ensure incoming value is safe ---
          trailingStopPercent: data.config.trailingStopPercent || 0.03,
          
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

  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      const configToSave = {
        ...config,
        stopLossPercent: config.stopLossPercent / 100,
        signalCooldown: config.signalCooldown * 1000,
        allocation: {}
      };
      config.assets.forEach(asset => {
          const alloc = config.allocation[asset] || 0;
          configToSave.allocation[asset] = alloc > 0 ? alloc / 100 : 0;
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

  const handleResetEngine = async () => {
      if (!window.confirm("⚠️ RESET MEMORY?\nThis clears internal state loops.")) return;
      try { await tradingAPI.resetTrading(); alert("✅ Engine Reset"); fetchCurrentConfig(); } catch (e) { alert(e.message); }
  };

  const handleFactoryReset = async () => {
      if (!window.confirm("☢️ NUCLEAR OPTION: WIPE DATABASE?\nThis deletes ALL history.")) return;
      try { await managementAPI.factoryReset(); alert("✅ System Wiped"); window.location.reload(); } catch (e) { alert(e.message); }
  };

  const updateConfig = (key, value) => { setConfig((prev) => ({ ...prev, [key]: value })); };

  const handleAddAsset = () => {
      if (!newAsset || config.assets.includes(newAsset)) return;
      setConfig(prev => ({
          ...prev,
          assets: [...prev.assets, newAsset],
          allocation: { ...prev.allocation, [newAsset]: 10 } 
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

  const renderGeneralSettings = () => (
    <Stack spacing={3}>
        <GlassCard>
            <SectionHeader icon={<SettingsRemote />} title="System Controls" subtitle="Global limits and switches" />
            <Grid container spacing={3} alignItems="center">
                 <Grid item xs={12} md={6}>
                    <TextField
                        fullWidth label="Max Capital Allocation" type="number"
                        helperText="Total USDT allowed for this bot"
                        value={config.maxCapitalAtRisk}
                        onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
                        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    />
                 </Grid>
                 <Grid item xs={12} md={6}>
                     <Box display="flex" alignItems="center" justifyContent="space-between" border={1} borderColor="divider" borderRadius={1} p={2}>
                        <Box>
                            <Typography fontWeight="bold">Master Kill Switch</Typography>
                            <Typography variant="caption" color="text.secondary">{config.enableTrading ? "SYSTEM ACTIVE" : "SYSTEM PAUSED"}</Typography>
                        </Box>
                        <Switch checked={config.enableTrading} onChange={(e) => updateConfig('enableTrading', e.target.checked)} color="success" />
                     </Box>
                 </Grid>
            </Grid>
        </GlassCard>

        <Paper variant="outlined" sx={{ p: 3, borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.05), borderStyle: 'dashed' }}>
            <SectionHeader icon={<Warning />} title="Danger Zone" subtitle="Irreversible actions" />
            <Stack direction="row" spacing={2}>
                <Button variant="outlined" color="warning" startIcon={<RestartAlt />} onClick={handleResetEngine}>Reset RAM</Button>
                <Button variant="contained" color="error" startIcon={<DeleteForever />} onClick={handleFactoryReset}>Factory Wipe</Button>
            </Stack>
        </Paper>
    </Stack>
  );

  const renderStrategySettings = () => (
    <Stack spacing={3}>
        <GlassCard>
             <SectionHeader icon={<Science />} title="Momentum Strategy" subtitle="SuperTrend + ADX configuration" />
            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    <FormControl fullWidth>
                        <InputLabel>Strategy Core</InputLabel>
                        <Select value={config.strategy} label="Strategy Core" onChange={(e) => updateConfig('strategy', e.target.value)}>
                            <MenuItem value="supertrend_momentum">⚡ SuperTrend Momentum</MenuItem>
                            <MenuItem value="balanced">⚖️ Balanced</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                     <FormControl fullWidth>
                        <InputLabel>Timeframe</InputLabel>
                        <Select value={config.timeframe} label="Timeframe" onChange={(e) => updateConfig('timeframe', e.target.value)}>
                            <MenuItem value="1h">1 Hour</MenuItem>
                            <MenuItem value="4h">4 Hours</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
            </Grid>
        </GlassCard>

        <GlassCard>
            <SectionHeader icon={<Tune />} title="Entry Filters" subtitle="Strict trend requirements" />
            <Box mb={4}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography fontWeight="bold">Min ADX Strength (Trend Floor)</Typography>
                    <Switch size="small" checked={config.enableAdxFilter} onChange={(e) => updateConfig('enableAdxFilter', e.target.checked)} />
                </Box>
                <Box px={2} display="flex" alignItems="center" gap={2}>
                    <Slider value={config.minAdx} min={10} max={50} onChange={(_, v) => updateConfig('minAdx', v)} disabled={!config.enableAdxFilter} sx={{ flexGrow: 1 }} />
                    <Typography fontFamily="monospace" fontWeight="bold" sx={{ minWidth: 30 }}>{config.minAdx}</Typography>
                </Box>
            </Box>
            <Divider sx={{ my: 3 }} />
            <Box>
                <Box display="flex" justifyContent="space-between" mb={2}>
                    <Typography fontWeight="bold">RSI Ceiling (Overbought)</Typography>
                    <Switch size="small" checked={config.enableRsiFilter} onChange={(e) => updateConfig('enableRsiFilter', e.target.checked)} />
                </Box>
                <TextField fullWidth label="Max RSI" type="number" value={config.rsiOverbought} onChange={(e) => updateConfig('rsiOverbought', parseFloat(e.target.value))} size="small" />
            </Box>
        </GlassCard>
    </Stack>
  );

const renderRiskSettings = () => (
     <Stack spacing={3}>
        <GlassCard>
            <SectionHeader icon={<Security />} title="Risk Management" subtitle="Position sizing and stop losses" />
            <Grid container spacing={4}>
                {/* Position Sizing */}
                <Grid item xs={12}>
                     <Typography gutterBottom variant="subtitle2" color="text.secondary">RISK FACTOR</Typography>
                     <Stack direction="row" spacing={2} alignItems="center">
                        <Slider value={config.riskPerTrade} min={0.1} max={1.0} step={0.01} onChange={(_, v) => updateConfig('riskPerTrade', v)} valueLabelDisplay="auto" sx={{ flexGrow: 1 }} />
                        <Chip label={`${(config.riskPerTrade * 100).toFixed(0)}%`} color={config.riskPerTrade > 0.9 ? "error" : "primary"} variant="outlined" />
                     </Stack>
                     <Typography variant="caption" color="text.secondary">Percentage of allocated funds to use per trade.</Typography>
                </Grid>

                {/* Hard Stop Loss */}
                <Grid item xs={12} md={6}>
                    <FormControl fullWidth>
                        <InputLabel>Stop Loss Type</InputLabel>
                        <Select value={config.stopLossType || 'FIXED'} label="Stop Loss Type" onChange={(e) => updateConfig('stopLossType', e.target.value)}>
                            <MenuItem value="FIXED">Fixed Percentage (Hard Stop)</MenuItem>
                            <MenuItem value="ATR">ATR Dynamic (Volatility)</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                 <Grid item xs={12} md={6}>
                    <TextField fullWidth label="Stop Loss Distance" type="number" value={config.stopLossPercent} onChange={(e) => updateConfig('stopLossPercent', parseFloat(e.target.value))} InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
                </Grid>

                {/* --- TRAILING STOP SECTION --- */}
                <Grid item xs={12}>
                    <Divider sx={{ my: 1 }} />
                </Grid>
                <Grid item xs={12}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Box>
                            <Typography fontWeight="bold">Trailing Stop-Loss</Typography>
                            <Typography variant="caption" color="text.secondary">
                                Dynamically follows price up. Locks in profits.
                            </Typography>
                        </Box>
                        <Switch 
                            checked={config.enableTrailingStops || false} 
                            onChange={(e) => updateConfig('enableTrailingStops', e.target.checked)} 
                        />
                    </Box>
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ opacity: config.enableTrailingStops ? 1 : 0.5, pointerEvents: config.enableTrailingStops ? 'auto' : 'none' }}>
                        <Typography variant="caption" sx={{ minWidth: 60 }}>Distance:</Typography>
                        <Slider
                            value={config.trailingStopPercent ? config.trailingStopPercent * 100 : 3.0} // Convert decimal to % for display
                            min={0.5} max={10.0} step={0.1}
                            onChange={(_, v) => updateConfig('trailingStopPercent', v / 100)} // Store as decimal (0.03)
                            valueLabelDisplay="auto"
                            sx={{ flexGrow: 1 }}
                        />
                        <Chip label={`${(config.trailingStopPercent ? config.trailingStopPercent * 100 : 3.0).toFixed(1)}%`} size="small" />
                    </Stack>
                </Grid>
            </Grid>
        </GlassCard>
     </Stack>
  );

  const renderPortfolioSettings = () => (
    <Stack spacing={3}>
         <GlassCard>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems="center" spacing={2} mb={3}>
                 <SectionHeader icon={<PieChart />} title="Asset Allocation" subtitle="Manage active pairs and capital limits" />
                 <Chip label={`Total Allocation: ${totalAllocation}%`} color={totalAllocation > 100 ? "error" : totalAllocation === 100 ? "success" : "default"} variant={totalAllocation === 100 ? "filled" : "outlined"} />
            </Stack>
            <Box display="flex" gap={2} mb={3} p={2} bgcolor={alpha(theme.palette.background.paper, 0.3)} borderRadius={2}>
                <FormControl size="small" fullWidth>
                    <InputLabel>Add Asset</InputLabel>
                    <Select value={newAsset} label="Add Asset" onChange={(e) => setNewAsset(e.target.value)}>
                        {SUPPORTED_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (<MenuItem key={asset} value={asset}>{asset}</MenuItem>))}
                    </Select>
                </FormControl>
                <Button variant="contained" onClick={handleAddAsset} disabled={!newAsset} startIcon={<AddCircle />}>ADD</Button>
            </Box>
            <List disablePadding>
                {config.assets.map((asset) => (
                    <ListItem key={asset} sx={{ borderBottom: 1, borderColor: 'divider', py: 2, flexWrap: 'wrap', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.05) } }}>
                         <Box display="flex" alignItems="center" width={{ xs: '100%', sm: '20%' }}>
                            <Avatar sx={{ width: 32, height: 32, mr: 2, bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main', fontSize: '0.75rem', fontWeight: 'bold' }}>{asset.substring(0,3)}</Avatar>
                            <Typography fontWeight="bold">{asset}</Typography>
                         </Box>
                         <Box sx={{ flexGrow: 1, mx: { xs: 0, sm: 4 }, my: { xs: 2, sm: 0 }, width: { xs: '100%', sm: 'auto' } }}>
                             <Stack direction="row" spacing={2} alignItems="center">
                                <Slider value={config.allocation[asset] || 0} onChange={(_, v) => updateAllocation(asset, v)} min={0} max={100} step={5} sx={{ flexGrow: 1 }} />
                             </Stack>
                         </Box>
                         <Box display="flex" alignItems="center" gap={2} width={{ xs: '100%', sm: 'auto' }} justifyContent="flex-end">
                             <TextField size="small" type="number" value={config.allocation[asset] || 0} onChange={(e) => updateAllocation(asset, parseFloat(e.target.value))} InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} sx={{ width: 100 }} />
                             <IconButton color="error" onClick={() => handleRemoveAsset(asset)}><Delete /></IconButton>
                         </Box>
                    </ListItem>
                ))}
                {config.assets.length === 0 && <Alert severity="info">No assets configured. Add assets to begin.</Alert>}
            </List>
         </GlassCard>
    </Stack>
  );

  const renderNotificationSettings = () => (
      <Stack spacing={3}>
          <GlassCard>
              <SectionHeader icon={<Email />} title="Notifications" subtitle="Alerts and Reporting" />
              <Grid container spacing={3}>
                  <Grid item xs={12}>
                       <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} border={1} borderColor="divider" borderRadius={1} p={2}>
                          <Box>
                              <Typography fontWeight="bold">Email Alerts</Typography>
                              <Typography variant="caption" color="text.secondary">Receive instant trade notifications</Typography>
                          </Box>
                          <Switch checked={config.enableEmailAlerts} onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)} />
                       </Box>
                  </Grid>
                  <Grid item xs={12}>
                      <TextField
                          fullWidth
                          label="Alert Email Address"
                          value={config.alertEmail}
                          onChange={(e) => updateConfig('alertEmail', e.target.value)}
                          disabled={!config.enableEmailAlerts}
                          helperText="Recipient for buy/sell notifications"
                          placeholder="you@example.com"
                      />
                  </Grid>
              </Grid>
          </GlassCard>
      </Stack>
  );

  if (loading) return <Box minHeight="60vh" display="flex" alignItems="center" justifyContent="center"><Typography>Loading Config...</Typography></Box>;

  return (
    <Container maxWidth={false} sx={{ py: 2 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
            <Box>
                <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>SYSTEM <span style={{ color: theme.palette.primary.main }}>CONFIG</span></Typography>
                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>LIVE TRADING PARAMETERS</Typography>
            </Box>
            <Stack direction="row" spacing={2}>
                <Button startIcon={<Refresh />} onClick={fetchCurrentConfig} color="inherit">Revert</Button>
                <Button variant="contained" startIcon={<Save />} onClick={handleSaveConfig} disabled={!hasChanges || saving} size="large" sx={{ px: 4 }}>{saving ? 'Saving...' : 'Save Changes'}</Button>
            </Stack>
        </Box>
        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 3 }}>Configuration Saved!</Alert>}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} textColor="primary" indicatorColor="primary">
                <Tab icon={<AccountBalance fontSize="small" />} iconPosition="start" label="General" sx={{ minHeight: 60 }} />
                <Tab icon={<Science fontSize="small" />} iconPosition="start" label="Strategy" sx={{ minHeight: 60 }} />
                <Tab icon={<Security fontSize="small" />} iconPosition="start" label="Risk" sx={{ minHeight: 60 }} />
                <Tab icon={<PieChart fontSize="small" />} iconPosition="start" label="Portfolio" sx={{ minHeight: 60 }} />
                <Tab icon={<Email fontSize="small" />} iconPosition="start" label="Notifications" sx={{ minHeight: 60 }} />
            </Tabs>
        </Box>
        <Box sx={{ minHeight: 400 }}>
            {activeTab === 0 && renderGeneralSettings()}
            {activeTab === 1 && renderStrategySettings()}
            {activeTab === 2 && renderRiskSettings()}
            {activeTab === 3 && renderPortfolioSettings()}
            {activeTab === 4 && renderNotificationSettings()}
        </Box>
    </Container>
  );
};

export default TradingConfig;