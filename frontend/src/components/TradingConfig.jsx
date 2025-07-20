// frontend/src/components/TradingConfig.jsx - FIXED WITH NEW API HELPERS
import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Grid,
  Paper,
  Typography,
  TextField,
  Button,
  Slider,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Alert,
  Chip,
  Card,
  CardContent,
  CardHeader,
  InputAdornment,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Save,
  Refresh,
  ExpandMore,
  Warning,
  Info,
  MoneyOff,
  TrendingUp,
  MonetizationOn,
  Security,
  AccountBalance,
  Settings
} from '@mui/icons-material';
import { tradingAPI } from '../config/api'; // FIXED: Import new API helpers

const TradingConfig = () => {
  const [config, setConfig] = useState({
    // Account Settings
    maxCapitalAtRisk: 5000,
    tradingMode: 'paper', // 'paper' or 'live'
    enableTrading: false,
    
    // Risk Management
    riskPerTrade: 1.0, // Percentage
    maxDailyLoss: 2.0, // Percentage
    maxWeeklyLoss: 5.0, // Percentage
    stopLossATR: 1.5,
    maxPositionsPerAsset: 1,
    minOrderSize: 10,
    
    // Strategy Settings
    strategy: 'balanced',
    timeframe: '1h',
    signalCooldown: 60, // seconds
    minSignalStrength: 0.5,
    
    // Portfolio Allocation
    allocation: {
      BTCUSDT: 35,
      ETHUSDT: 35,
      BNBUSDT: 20,
      DOGEUSDT: 10
    },
    
    // Assets & Timeframes
    assets: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'DOGEUSDT'],
    timeframes: ['1h', '4h', '1d'],
    
    // System & Logging
    logLevel: 'info'
  });

  const [originalConfig, setOriginalConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isUnsavedWarningDismissed, setIsUnsavedWarningDismissed] = useState(false);

  // Load current configuration
  useEffect(() => {
    fetchCurrentConfig();
  }, []);

  // Check for changes
  useEffect(() => {
    const changed = JSON.stringify(config) !== JSON.stringify(originalConfig);
    setHasChanges(changed);
    // If changes are detected, reset the dismissed state so the warning reappears.
    if (changed) {
      setIsUnsavedWarningDismissed(false);
    }
  }, [config, originalConfig]);

  // FIXED: Use new API helper instead of direct fetch
  const fetchCurrentConfig = async () => {
    try {
      console.log('🔄 Fetching current trading configuration...');
      setLoading(true);
      
      // Use the new API helper
      const data = await tradingAPI.getStatus();
      console.log('✅ Configuration loaded');
      
      if (data.config) {
        const fetchedConfig = {
          maxCapitalAtRisk: data.config.maxCapitalAtRisk || 5000,
          tradingMode: data.config.tradingMode || 'paper',
          enableTrading: data.config.enableTrading || false,
          riskPerTrade: (data.config.riskPerTrade * 100) || 1.0,
          maxDailyLoss: (data.config.maxDailyLoss * 100) || 2.0,
          maxWeeklyLoss: (data.config.maxWeeklyLoss * 100) || 5.0,
          stopLossATR: data.config.stopLossATR || 1.5,
          maxPositionsPerAsset: data.config.maxPositionsPerAsset || 1,
          minOrderSize: data.config.minOrderSize || 10,
          strategy: data.config.strategy || 'balanced',
          timeframe: data.config.timeframe || '1h',
          signalCooldown: (data.config.signalCooldown / 1000) || 60,
          minSignalStrength: data.config.minStrength || 0.5,
          allocation: {
            BTCUSDT: (data.config.allocation?.BTCUSDT * 100) || 35,
            ETHUSDT: (data.config.allocation?.ETHUSDT * 100) || 35,
            BNBUSDT: (data.config.allocation?.BNBUSDT * 100) || 20,
            DOGEUSDT: (data.config.allocation?.DOGEUSDT * 100) || 10
          },
          assets: data.config.assets || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'DOGEUSDT'],
          timeframes: data.config.timeframes || ['1h', '4h', '1d'],
          logLevel: data.config.logLevel || 'info'
        };
        setConfig(fetchedConfig);
        setOriginalConfig(fetchedConfig);
      }
    } catch (err) {
      console.error('❌ Failed to load configuration:', err.message);
      setError(`Failed to load configuration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // FIXED: Use new API helper for saving configuration
  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    
    try {
      console.log('🔄 Saving trading configuration...');
      
      // Convert percentages back to decimals
      const configToSave = {
        ...config,
        riskPerTrade: config.riskPerTrade / 100,
        maxDailyLoss: config.maxDailyLoss / 100,
        maxWeeklyLoss: config.maxWeeklyLoss / 100,
        signalCooldown: config.signalCooldown * 1000,
        logLevel: config.logLevel,
        minStrength: config.minSignalStrength,
        allocation: {
          BTCUSDT: config.allocation.BTCUSDT / 100,
          ETHUSDT: config.allocation.ETHUSDT / 100,
          BNBUSDT: config.allocation.BNBUSDT / 100,
          DOGEUSDT: config.allocation.DOGEUSDT / 100
        }
      };

      // Use the new API helper
      await tradingAPI.updateConfig(configToSave);
      
      setOriginalConfig(config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      console.log('✅ Configuration saved successfully');
      
    } catch (err) {
      console.error('❌ Failed to save configuration:', err.message);
      setError(`Failed to save configuration: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetConfig = () => {
    setConfig(originalConfig);
    setError(null);
  };

  const updateConfig = (path, value) => {
    setConfig(prev => {
      const newConfig = { ...prev };
      const keys = path.split('.');
      let current = newConfig;
      
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return newConfig;
    });
  };

  const calculateRiskAmounts = () => {
    return {
      riskPerTrade: (config.maxCapitalAtRisk * config.riskPerTrade / 100).toFixed(2),
      maxDailyLoss: (config.maxCapitalAtRisk * config.maxDailyLoss / 100).toFixed(2),
      maxWeeklyLoss: (config.maxCapitalAtRisk * config.maxWeeklyLoss / 100).toFixed(2)
    };
  };

  const riskAmounts = calculateRiskAmounts();

  if (loading) {
    return ( // No container needed, App.jsx handles it
      <Box>
        <Typography variant="h6">Loading configuration...</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4" component="h1">
          Trading Configuration
        </Typography>
        
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={fetchCurrentConfig}
            disabled={saving}
          >
            Reload
          </Button>
          
          <Button
            variant="outlined"
            onClick={handleResetConfig}
            disabled={!hasChanges || saving}
          >
            Reset Changes
          </Button>
          
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSaveConfig}
            disabled={!hasChanges || saving}
            color={hasChanges ? "primary" : "inherit"}
          >
            {saving ? 'Saving...' : 'Save Config'}
          </Button>
        </Box>
      </Box>

      {/* Status Messages */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(false)}>
          Configuration saved successfully!
        </Alert>
      )}

      {hasChanges && !isUnsavedWarningDismissed && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setIsUnsavedWarningDismissed(true)}>
          You have unsaved changes. Click &quot;Save Config&quot; to apply them.
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Trading Mode & Account Settings */}
        <Grid item xs={12} md={6}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <AccountBalance sx={{ mr: 1 }} />
              <Typography variant="h6">Account Settings</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Card variant="outlined" sx={{ p: 2, borderColor: config.tradingMode === 'live' ? 'error.main' : 'warning.main' }}>
                    <Typography gutterBottom>Trading Mode</Typography>
                    <Box display="flex" alignItems="center" gap={2}>
                      <MoneyOff color="warning" />
                      <Switch
                        checked={config.tradingMode === 'live'}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const confirmed = window.confirm(
                              'DANGER: You are about to enable LIVE TRADING with REAL MONEY.\n\n' +
                              'Are you absolutely sure you want to proceed?'
                            );
                            if (confirmed) {
                              updateConfig('tradingMode', 'live');
                            }
                          } else {
                            updateConfig('tradingMode', 'paper');
                          }
                        }}
                        color={config.tradingMode === 'live' ? 'error' : 'warning'}
                      />
                      <MonetizationOn color="error" />
                    </Box>
                    <Typography variant="caption" color="text.secondary">Toggle between Paper (simulation) and Live (real money) trading.</Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Max Capital at Risk"
                    type="number"
                    value={config.maxCapitalAtRisk}
                    onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>
                    }}
                    helperText="The total capital base used for all risk calculations."
                  />
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <Typography gutterBottom>Enable Trading</Typography>
                    <Switch
                      checked={config.enableTrading}
                      onChange={(e) => updateConfig('enableTrading', e.target.checked)}
                      color={config.enableTrading ? "success" : "default"}
                    />
                  </FormControl>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

        {/* Risk Management */}
        <Grid item xs={12} md={6}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Security sx={{ mr: 1 }} />
              <Typography variant="h6">Risk Management</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography gutterBottom>
                    Risk Per Trade: {config.riskPerTrade}% (${riskAmounts.riskPerTrade})
                  </Typography>
                  <Slider
                    value={config.riskPerTrade}
                    onChange={(e, value) => updateConfig('riskPerTrade', value)}
                    min={0.1}
                    max={5.0}
                    step={0.1}
                    marks={[
                      { value: 0.5, label: '0.5%' },
                      { value: 1.0, label: '1%' },
                      { value: 2.0, label: '2%' },
                      { value: 5.0, label: '5%' }
                    ]}
                  />
                </Grid>
                
                <Grid item xs={12}>
                  <Typography gutterBottom>
                    Max Daily Loss: {config.maxDailyLoss}% (${riskAmounts.maxDailyLoss})
                  </Typography>
                  <Slider
                    value={config.maxDailyLoss}
                    onChange={(e, value) => updateConfig('maxDailyLoss', value)}
                    min={1.0}
                    max={10.0}
                    step={0.5}
                    marks={[
                      { value: 2, label: '2%' },
                      { value: 5, label: '5%' },
                      { value: 10, label: '10%' }
                    ]}
                  />
                </Grid>
                
                <Grid item xs={12}>
                  <Typography gutterBottom>
                    Max Weekly Loss: {config.maxWeeklyLoss}% (${riskAmounts.maxWeeklyLoss})
                  </Typography>
                  <Slider
                    value={config.maxWeeklyLoss}
                    onChange={(e, value) => updateConfig('maxWeeklyLoss', value)}
                    min={2.0}
                    max={20.0}
                    step={1.0}
                    marks={[
                      { value: 5, label: '5%' },
                      { value: 10, label: '10%' },
                      { value: 20, label: '20%' }
                    ]}
                  />
                </Grid>

                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Stop Loss ATR Multiplier"
                    type="number"
                    value={config.stopLossATR}
                    onChange={(e) => updateConfig('stopLossATR', parseFloat(e.target.value))}
                    inputProps={{ min: 1.0, max: 3.0, step: 0.1 }}
                    helperText="ATR-based stop loss"
                  />
                </Grid>
                
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Min Order Size"
                    type="number"
                    value={config.minOrderSize}
                    onChange={(e) => updateConfig('minOrderSize', parseFloat(e.target.value))}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>
                    }}
                    helperText="Minimum USDT order"
                  />
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

        {/* Strategy Settings */}
        <Grid item xs={12} md={6}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <TrendingUp sx={{ mr: 1 }} />
              <Typography variant="h6">Strategy Settings</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Trading Strategy</InputLabel>
                    <Select
                      value={config.strategy}
                      label="Trading Strategy"
                      onChange={(e) => updateConfig('strategy', e.target.value)}
                    >
                      <MenuItem value="conservative">
                        Conservative (50/200 SMA)
                      </MenuItem>
                      <MenuItem value="balanced">
                        Balanced (20/50 EMA)
                      </MenuItem>
                      <MenuItem value="responsive">
                        Responsive (12/26 EMA)
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>Primary Timeframe</InputLabel>
                    <Select
                      value={config.timeframe}
                      label="Primary Timeframe"
                      onChange={(e) => updateConfig('timeframe', e.target.value)}
                    >
                      <MenuItem value="1h">1 Hour</MenuItem>
                      <MenuItem value="4h">4 Hours</MenuItem>
                      <MenuItem value="1d">1 Day</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Signal Cooldown"
                    type="number"
                    value={config.signalCooldown}
                    onChange={(e) => updateConfig('signalCooldown', parseFloat(e.target.value))}
                    InputProps={{
                      endAdornment: <InputAdornment position="end">sec</InputAdornment>
                    }}
                    helperText="Time between signals"
                  />
                </Grid>
                
                <Grid item xs={12}>
                  <Typography gutterBottom>
                    Min Signal Strength: {config.minSignalStrength}
                  </Typography>
                  <Slider
                    value={config.minSignalStrength}
                    onChange={(e, value) => updateConfig('minSignalStrength', value)}
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    marks={[
                      { value: 0.5, label: '0.5' },
                      { value: 1.0, label: '1.0' },
                      { value: 1.5, label: '1.5' },
                      { value: 2.0, label: '2.0' }
                    ]}
                  />
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

        {/* Portfolio Allocation */}
        <Grid item xs={12} md={6}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Settings sx={{ mr: 1 }} />
              <Typography variant="h6">Portfolio Allocation</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                {Object.entries(config.allocation).map(([asset, percentage]) => (
                  <Grid item xs={12} key={asset}>
                    <Typography gutterBottom>
                      {asset.replace('USDT', '')}: {percentage}%
                      (${(config.maxCapitalAtRisk * percentage / 100).toFixed(0)})
                    </Typography>
                    <Slider
                      value={percentage}
                      onChange={(e, value) => updateConfig(`allocation.${asset}`, value)}
                      min={0}
                      max={50}
                      step={5}
                      marks={[
                        { value: 10, label: '10%' },
                        { value: 25, label: '25%' },
                        { value: 35, label: '35%' },
                        { value: 50, label: '50%' }
                      ]}
                    />
                  </Grid>
                ))}
                
                <Grid item xs={12}>
                  <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                    <Typography variant="body2">
                      Total Allocation: {Object.values(config.allocation).reduce((a, b) => a + b, 0)}%
                    </Typography>
                    {Object.values(config.allocation).reduce((a, b) => a + b, 0) !== 100 && (
                      <Typography variant="body2" color="warning.main">
                        ⚠️ Allocation should total 100%
                      </Typography>
                    )}
                  </Paper>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>

        {/* System & Logging */}
        <Grid item xs={12}>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Settings sx={{ mr: 1 }} />
              <Typography variant="h6">System & Logging</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Log Level</InputLabel>
                    <Select
                      value={config.logLevel}
                      label="Log Level"
                      onChange={(e) => updateConfig('logLevel', e.target.value)}
                    >
                      <MenuItem value="debug">Debug</MenuItem>
                      <MenuItem value="info">Info</MenuItem>
                      <MenuItem value="warn">Warn</MenuItem>
                      <MenuItem value="error">Error</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>
        {/* Current Status Summary */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Configuration Summary
            </Typography>
            
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" gutterBottom>
                      Strategy
                    </Typography>
                    <Chip 
                      label={config.strategy.charAt(0).toUpperCase() + config.strategy.slice(1)}
                      color="primary"
                    />
                  </CardContent>
                </Card>
              </Grid>
              
              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" gutterBottom>
                      Risk Per Trade
                    </Typography>
                    <Typography variant="h6">
                      ${riskAmounts.riskPerTrade}
                    </Typography>
                    <Typography variant="caption">
                      {config.riskPerTrade}% of capital
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              
              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" gutterBottom>
                      Trading Status
                    </Typography>
                    <Chip 
                      label={config.enableTrading ? "ENABLED" : "DISABLED"}
                      color={config.enableTrading ? "success" : "default"}
                    />
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TradingConfig;