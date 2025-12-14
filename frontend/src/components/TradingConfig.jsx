// frontend/src/components/TradingConfig.jsx - COMPLETE WITH FACTORY RESET
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, Alert, InputAdornment,
  IconButton, Container, Stack, Divider, Chip, Tabs, Tab,
  List, ListItem, Avatar, Grid, styled, alpha, useTheme, Paper
} from '@mui/material';
import {
  Save, Refresh, Security, AccountBalance,
  PieChart, Notifications, Delete, AddCircle, 
  Science, Tune, SettingsRemote, Warning, RestartAlt, DeleteForever
} from '@mui/icons-material';
import { tradingAPI, managementAPI } from '../config/api'; // Added managementAPI import

// --- STYLED COMPONENTS ---
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
                <Typography variant="h6" fontWeight="bold" lineHeight={1.2}>
                    {title}
                </Typography>
                {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
            </Box>
        </Box>
    );
};

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
  const theme = useTheme();

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

  const handleResetEngine = async () => {
      if (!window.confirm("⚠️ RESET MEMORY?\n\nThis wipes the engine's RAM (Panic Loops/Locks) and clears 'Active' trade flags.\nIt DOES NOT delete history.\n\nProceed?")) return;
      try {
          await tradingAPI.resetTrading();
          alert("✅ Engine Memory Reset Successfully");
          fetchCurrentConfig();
      } catch (e) {
          alert(`Error: ${e.message}`);
      }
  };

  const handleFactoryReset = async () => {
      if (!window.confirm("☢️ NUCLEAR OPTION ☢️\n\nThis will DELETE ALL TRADE HISTORY and SIGNALS from the database.\nThis action cannot be undone.\n\nAre you sure you want to wipe everything?")) return;
      
      try {
          await managementAPI.factoryReset();
          alert("✅ System Wiped Successfully. Analytics reset to zero.");
          // Force reload to clear any cached frontend state
          window.location.reload(); 
      } catch (e) {
          alert(`Error: ${e.message}`);
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

  // --- RENDERERS ---

  const renderGeneralSettings = () => (
    <Stack spacing={3}>
        {/* Trading Mode Banner */}
        <Box 
            sx={{ 
                p: 3, 
                borderRadius: 2,
                border: 1,
                borderColor: config.tradingMode === 'live' ? 'error.main' : 'warning.main',
                bgcolor: alpha(config.tradingMode === 'live' ? theme.palette.error.main : theme.palette.warning.main, 0.05),
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}
        >
            <Box>
                <Typography variant="h6" fontWeight="bold" color={config.tradingMode === 'live' ? 'error.main' : 'warning.main'}>
                    {config.tradingMode === 'live' ? "⚠️ LIVE TRADING ENVIRONMENT" : "🧪 PAPER TRADING ENVIRONMENT"}
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={0.5}>
                    {config.tradingMode === 'live' 
                        ? "Real funds are at risk. Trades execute directly on Binance." 
                        : "Simulation mode. No real assets will be moved."}
                </Typography>
            </Box>
            <FormControl>
                <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="button" color={config.tradingMode === 'paper' ? 'warning.main' : 'text.disabled'}>PAPER</Typography>
                    <Switch
                        checked={config.tradingMode === 'live'}
                        onChange={(e) => {
                            if (e.target.checked && !window.confirm("DANGER: Are you sure you want to enable Real Money Trading?")) return;
                            updateConfig('tradingMode', e.target.checked ? 'live' : 'paper');
                        }}
                        color="error"
                    />
                    <Typography variant="button" color={config.tradingMode === 'live' ? 'error.main' : 'text.disabled'}>LIVE</Typography>
                </Stack>
            </FormControl>
        </Box>

        <GlassCard>
            <SectionHeader icon={<SettingsRemote />} title="System Controls" subtitle="Global switches and limits" />
            <Grid container spacing={3} alignItems="center">
                 <Grid item xs={12} md={6}>
                    <TextField
                        fullWidth label="Max Capital Allocation" type="number"
                        helperText="Hard limit on USDT usage."
                        value={config.maxCapitalAtRisk}
                        onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
                        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    />
                 </Grid>
                 <Grid item xs={12} md={6}>
                     <Box 
                        display="flex" alignItems="center" justifyContent="space-between" 
                        border={1} borderColor={config.enableTrading ? "success.main" : "divider"} 
                        borderRadius={1} p={2}
                        bgcolor={config.enableTrading ? alpha(theme.palette.success.main, 0.05) : "transparent"}
                     >
                        <Box>
                            <Typography fontWeight="bold">Master Kill Switch</Typography>
                            <Typography variant="caption" color="text.secondary">
                                {config.enableTrading ? "SYSTEM ACTIVE" : "SYSTEM PAUSED"}
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
        </GlassCard>

        <GlassCard>
            <SectionHeader icon={<Notifications />} title="Alerts & Notifications" />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                 <Box display="flex" alignItems="center" minWidth={200}>
                    <Switch checked={config.enableEmailAlerts} onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)} />
                    <Typography sx={{ ml: 1 }}>Email Notifications</Typography>
                 </Box>
                 <TextField 
                    fullWidth label="Recipient Email" 
                    value={config.alertEmail} 
                    onChange={(e) => updateConfig('alertEmail', e.target.value)}
                    disabled={!config.enableEmailAlerts}
                    size="small"
                />
            </Stack>
        </GlassCard>

        {/* DANGER ZONE */}
        <Paper 
            variant="outlined" 
            sx={{ 
                p: 3, 
                borderColor: 'error.main', 
                bgcolor: alpha(theme.palette.error.main, 0.05),
                borderStyle: 'dashed'
            }}
        >
            <SectionHeader icon={<Warning />} title="Danger Zone" subtitle="Irreversible actions" />
            <Stack direction="row" spacing={2}>
                <Button 
                    variant="outlined" 
                    color="warning" 
                    startIcon={<RestartAlt />}
                    onClick={handleResetEngine}
                >
                    Reset Memory (Fix Loops)
                </Button>
                
                <Button 
                    variant="contained" 
                    color="error" 
                    startIcon={<DeleteForever />}
                    onClick={handleFactoryReset}
                >
                    Factory Reset (Wipe Data)
                </Button>
            </Stack>
        </Paper>
    </Stack>
  );

  const renderStrategySettings = () => (
    <Stack spacing={3}>
        <GlassCard>
             <SectionHeader icon={<Science />} title="Core Logic" subtitle="Algorithm parameters" />
            <Grid container spacing={3}>
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
        </GlassCard>

        <GlassCard>
            <SectionHeader icon={<Tune />} title="Signal Filters" subtitle="Refine entry conditions" />
            
            <Box mb={4}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography fontWeight="bold">ADX Trend Filter (Min Strength)</Typography>
                    <Switch size="small" checked={config.enableAdxFilter} onChange={(e) => updateConfig('enableAdxFilter', e.target.checked)} />
                </Box>
                <Box px={2} display="flex" alignItems="center" gap={2}>
                    <Slider 
                        value={config.minAdx} min={10} max={50} step={1}
                        onChange={(_, v) => updateConfig('minAdx', v)} disabled={!config.enableAdxFilter}
                        valueLabelDisplay="auto" marks={[{value: 25, label: 'Strong'}]}
                        sx={{ flexGrow: 1 }}
                    />
                    <Typography fontFamily="monospace" fontWeight="bold">{config.minAdx}</Typography>
                </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            <Box>
                <Box display="flex" justifyContent="space-between" mb={2}>
                    <Typography fontWeight="bold">RSI Momentum Filter</Typography>
                    <Switch size="small" checked={config.enableRsiFilter} onChange={(e) => updateConfig('enableRsiFilter', e.target.checked)} />
                </Box>
                <Stack direction="row" spacing={3}>
                     <TextField 
                        fullWidth label="Overbought (>)" type="number"
                        value={config.rsiOverbought} onChange={(e) => updateConfig('rsiOverbought', parseFloat(e.target.value))} 
                        disabled={!config.enableRsiFilter}
                        size="small"
                    />
                     <TextField 
                        fullWidth label="Oversold (<)" type="number"
                        value={config.rsiOversold} onChange={(e) => updateConfig('rsiOversold', parseFloat(e.target.value))} 
                        disabled={!config.enableRsiFilter}
                        size="small"
                    />
                </Stack>
            </Box>
        </GlassCard>
    </Stack>
  );

  const renderRiskSettings = () => (
     <Stack spacing={3}>
        <GlassCard>
            <SectionHeader icon={<Security />} title="Risk Management" subtitle="Capital protection rules" />

            <Grid container spacing={4}>
                <Grid item xs={12}>
                     <Typography gutterBottom variant="subtitle2" color="text.secondary">RISK PER TRADE (% OF CAPITAL)</Typography>
                     <Stack direction="row" spacing={2} alignItems="center">
                        <Slider 
                            value={config.riskPerTrade} min={0.1} max={5.0} step={0.1}
                            onChange={(_, v) => updateConfig('riskPerTrade', v)} 
                            valueLabelDisplay="auto"
                            marks={[{value: 1, label: 'Conservative'}, {value: 3, label: 'Aggressive'}]}
                            sx={{ flexGrow: 1 }}
                        />
                        <Typography fontWeight="bold" fontFamily="monospace" sx={{ border: 1, borderColor: 'divider', p: 1, borderRadius: 1 }}>
                            {config.riskPerTrade}%
                        </Typography>
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
                        helperText="Engine auto-stop threshold"
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
        </GlassCard>
     </Stack>
  );

  const renderPortfolioSettings = () => (
    <Stack spacing={3}>
         <GlassCard>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems="center" spacing={2} mb={3}>
                 <Box display="flex" alignItems="center" gap={2}>
                     <PieChart color="primary" />
                     <Box>
                        <Typography variant="h6" fontWeight="bold">Asset Allocation</Typography>
                        <Typography variant="caption" color="text.secondary">Portfolio weighting logic</Typography>
                     </Box>
                 </Box>
                 <Box display="flex" alignItems="center" gap={2}>
                     <Chip 
                        label={`Total Allocated: ${totalAllocation}%`} 
                        color={totalAllocation > 100 ? "error" : totalAllocation === 100 ? "success" : "default"}
                        variant={totalAllocation === 100 ? "filled" : "outlined"}
                     />
                 </Box>
            </Stack>

            <Box display="flex" gap={2} mb={3} p={2} bgcolor={alpha(theme.palette.background.paper, 0.3)} borderRadius={2}>
                <FormControl size="small" fullWidth>
                    <InputLabel>Add Asset to Portfolio</InputLabel>
                    <Select value={newAsset} label="Add Asset to Portfolio" onChange={(e) => setNewAsset(e.target.value)}>
                        {SUPPORTED_ASSETS.filter(a => !config.assets.includes(a)).map(asset => (
                            <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Button variant="contained" onClick={handleAddAsset} disabled={!newAsset} startIcon={<AddCircle />} sx={{ minWidth: 120 }}>
                    ADD
                </Button>
            </Box>

            <List disablePadding>
                {config.assets.length === 0 && (
                    <Alert severity="info" sx={{ width: '100%' }}>Portfolio is empty. Add assets to begin trading.</Alert>
                )}
                
                {config.assets.map((asset) => (
                    <React.Fragment key={asset}>
                        <ListItem sx={{ 
                            borderBottom: 1, 
                            borderColor: 'divider',
                            py: 2,
                            px: 1,
                            flexWrap: 'wrap',
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.05) }
                        }}>
                             <Box display="flex" alignItems="center" width={{ xs: '100%', sm: '20%' }}>
                                <Avatar sx={{ width: 32, height: 32, mr: 2, bgcolor: alpha(theme.palette.primary.main, 0.2), color: 'primary.main', fontSize: '0.75rem', fontWeight: 'bold' }}>
                                    {asset.substring(0,3)}
                                </Avatar>
                                <Typography fontWeight="bold">{asset.replace('USDT', '')}</Typography>
                             </Box>

                             <Box sx={{ flexGrow: 1, mx: { xs: 0, sm: 4 }, my: { xs: 2, sm: 0 }, width: { xs: '100%', sm: 'auto' } }}>
                                 <Stack direction="row" spacing={2} alignItems="center">
                                    <Slider 
                                        value={config.allocation[asset] || 0} 
                                        onChange={(_, v) => updateAllocation(asset, v)}
                                        min={0} max={50} step={1}
                                        sx={{ flexGrow: 1 }}
                                    />
                                 </Stack>
                             </Box>

                             <Box display="flex" alignItems="center" gap={2} width={{ xs: '100%', sm: 'auto' }} justifyContent="flex-end">
                                 <TextField 
                                    size="small" type="number" 
                                    value={config.allocation[asset] || 0} 
                                    onChange={(e) => updateAllocation(asset, parseFloat(e.target.value))}
                                    InputProps={{ 
                                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                    }}
                                    sx={{ width: 100 }}
                                 />
                                 <IconButton color="error" onClick={() => handleRemoveAsset(asset)} size="small">
                                     <Delete fontSize="small" />
                                 </IconButton>
                             </Box>
                        </ListItem>
                    </React.Fragment>
                ))}
            </List>
         </GlassCard>
    </Stack>
  );

  if (loading) return <Box minHeight="80vh" display="flex" alignItems="center" justifyContent="center"><Typography>Loading Configuration...</Typography></Box>;

  return (
    // FIXED: Changed maxWidth="lg" to maxWidth={false} to span full width like Dashboard
    <Container maxWidth={false} sx={{ py: 2 }}>
        
        {/* HEADER */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={4} px={1}>
            <Box>
                <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>
                    SYSTEM <span style={{ color: theme.palette.primary.main }}>CONFIG</span>
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
                    BOT PARAMETERS & RISK CONTROLS
                </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
                <Button startIcon={<Refresh />} onClick={fetchCurrentConfig} disabled={saving} color="inherit">
                    Revert
                </Button>
                <Button 
                    variant="contained" 
                    startIcon={<Save />} 
                    onClick={handleSaveConfig} 
                    disabled={!hasChanges || saving}
                    size="large"
                    sx={{ px: 4, fontWeight: 'bold' }}
                >
                    {saving ? 'Saving...' : 'Save Changes'}
                </Button>
            </Stack>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 3 }}>Configuration saved successfully!</Alert>}

        {/* TABS NAVIGATION */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs 
                value={activeTab} 
                onChange={(_, v) => setActiveTab(v)} 
                variant="scrollable" 
                scrollButtons="auto"
                textColor="primary"
                indicatorColor="primary"
            >
                <Tab icon={<AccountBalance />} iconPosition="start" label="General" sx={{ minHeight: 64 }} />
                <Tab icon={<Science />} iconPosition="start" label="Strategy" sx={{ minHeight: 64 }} />
                <Tab icon={<Security />} iconPosition="start" label="Risk" sx={{ minHeight: 64 }} />
                <Tab icon={<PieChart />} iconPosition="start" label="Portfolio" sx={{ minHeight: 64 }} />
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