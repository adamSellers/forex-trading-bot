// frontend/src/components/config/GeneralSettings.jsx - General Settings with Engine Controls
import React, { useState, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Switch, FormControl,
  InputLabel, Select, MenuItem, InputAdornment, Grid, Stack,
  Paper, alpha, useTheme, Chip, Divider, CircularProgress
} from '@mui/material';
import { 
  SettingsRemote, Warning, RestartAlt, Sync, PlayArrow, 
  Stop, Engineering, BarChart, FiberManualRecord 
} from '@mui/icons-material';
import { tradingAPI, engineAPI } from '../../config/api';
import { GlassCard, SectionHeader } from './ConfigShared';

const GeneralSettings = ({ config, updateConfig, onResetEngine }) => {
  const theme = useTheme();
  const [engineStatus, setEngineStatus] = useState(null);
  const [loadingAction, setLoadingAction] = useState(null);

  // Fetch engine status
  const fetchEngineStatus = async () => {
    try {
      const status = await engineAPI.getStatus();
      setEngineStatus(status);
    } catch (e) {
      console.error('Failed to fetch engine status:', e);
    }
  };

  useEffect(() => {
    fetchEngineStatus();
    const interval = setInterval(fetchEngineStatus, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const handleResetEngine = async () => {
    if (!window.confirm("⚠️ RESET ENGINE STATE?\nThis clears pending entries and signal history.")) return;
    setLoadingAction('reset');
    try {
      await tradingAPI.resetSignals();
      alert("✅ Engine Reset");
      if (onResetEngine) onResetEngine();
      fetchEngineStatus();
    } catch (e) {
      alert(`Reset failed: ${e.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSyncEngine = async () => {
    setLoadingAction('sync');
    try {
      await engineAPI.sync();
      alert("✅ Engine synced with Oanda");
      fetchEngineStatus();
    } catch (e) {
      alert(`Sync failed: ${e.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResetStats = async () => {
    if (!window.confirm("Reset all trading engine statistics?")) return;
    setLoadingAction('resetStats');
    try {
      await engineAPI.resetStats();
      alert("✅ Statistics reset");
      fetchEngineStatus();
    } catch (e) {
      alert(`Reset stats failed: ${e.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const engineStats = engineStatus?.stats || {};
  const isEngineRunning = engineStatus?.isRunning || false;

  return (
    <Stack spacing={3}>
      {/* System Controls */}
      <GlassCard>
        <SectionHeader 
          icon={<SettingsRemote />} 
          title="System Controls" 
          subtitle="Global limits and master switch" 
        />
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth 
              label="Max Capital Allocation" 
              type="number"
              helperText="Maximum AUD to deploy for trading"
              value={config.maxCapitalAtRisk}
              onChange={(e) => updateConfig('maxCapitalAtRisk', parseFloat(e.target.value))}
              InputProps={{ startAdornment: <InputAdornment position="start">A$</InputAdornment> }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Box 
              display="flex" 
              alignItems="center" 
              justifyContent="space-between" 
              border={1} 
              borderColor={config.enableTrading ? 'success.main' : 'divider'} 
              borderRadius={1} 
              p={2} 
              bgcolor={config.enableTrading ? alpha(theme.palette.success.main, 0.05) : 'transparent'}
            >
              <Box>
                <Typography fontWeight="bold">Master Kill Switch</Typography>
                <Typography variant="caption" color={config.enableTrading ? 'success.main' : 'text.secondary'}>
                  {config.enableTrading ? "⚡ TRADING ACTIVE" : "⏸️ TRADING PAUSED"}
                </Typography>
              </Box>
              <Switch 
                checked={config.enableTrading} 
                onChange={(e) => updateConfig('enableTrading', e.target.checked)} 
                color="success" 
              />
            </Box>
          </Grid>
           
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth 
              label="Max Open Positions" 
              type="number"
              helperText="Maximum concurrent trades allowed"
              value={config.maxOpenPositions}
              onChange={(e) => updateConfig('maxOpenPositions', parseInt(e.target.value))}
              inputProps={{ min: 1, max: 4 }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Box 
              display="flex" 
              alignItems="center" 
              justifyContent="space-between" 
              border={1} 
              borderColor='error.main'
              borderRadius={1} 
              p={2} 
              bgcolor={alpha(theme.palette.error.main, 0.05)}
            >
              <Box>
                <Typography fontWeight="bold">Trading Mode</Typography>
                <Typography variant="caption" color='error.main'>
                  🔴 LIVE - Real Money
                </Typography>
              </Box>
              <Chip label="Fixed: Live" color="error" size="small" />
            </Box>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Log Level</InputLabel>
              <Select 
                value={config.logLevel} 
                label="Log Level" 
                onChange={(e) => updateConfig('logLevel', e.target.value)}
              >
                <MenuItem value="error">Error Only</MenuItem>
                <MenuItem value="warn">Warnings</MenuItem>
                <MenuItem value="info">Info (Recommended)</MenuItem>
                <MenuItem value="debug">Debug (Verbose)</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </GlassCard>

      {/* Trading Engine Status */}
      <GlassCard>
        <SectionHeader 
          icon={<Engineering />} 
          title="Trading Engine" 
          subtitle="Live engine status and controls" 
        />
        
        {/* Engine Status Banner */}
        <Box 
          display="flex" 
          alignItems="center" 
          justifyContent="space-between"
          p={2}
          mb={2}
          borderRadius={1}
          bgcolor={isEngineRunning ? alpha(theme.palette.success.main, 0.1) : alpha(theme.palette.grey[500], 0.1)}
          border={1}
          borderColor={isEngineRunning ? 'success.main' : 'divider'}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <FiberManualRecord 
              sx={{ 
                color: isEngineRunning ? 'success.main' : 'text.disabled',
                animation: isEngineRunning ? 'pulse 2s infinite' : 'none',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.4 },
                },
              }} 
            />
            <Box>
              <Typography fontWeight="bold">
                Engine Status: {isEngineRunning ? 'Running' : 'Stopped'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {engineStatus?.openPositions || 0} open positions | 
                {engineStats.tradesExecuted || 0} trades executed
              </Typography>
            </Box>
          </Box>
          <Chip 
            label={config.enableTrading ? 'Trading Enabled' : 'Trading Disabled'}
            color={config.enableTrading ? 'success' : 'default'}
            size="small"
          />
        </Box>

        {/* Engine Stats Grid */}
        <Grid container spacing={2} mb={2}>
          <Grid item xs={6} sm={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Signals Received</Typography>
              <Typography variant="h5" fontWeight="bold">{engineStats.signalsReceived || 0}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Trades Executed</Typography>
              <Typography variant="h5" fontWeight="bold" color="success.main">
                {engineStats.tradesExecuted || 0}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Signals Rejected</Typography>
              <Typography variant="h5" fontWeight="bold" color="warning.main">
                {engineStats.signalsRejected || 0}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Errors</Typography>
              <Typography variant="h5" fontWeight="bold" color="error.main">
                {engineStats.errors || 0}
              </Typography>
            </Paper>
          </Grid>
        </Grid>

        {/* Engine Actions */}
        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Button 
            variant="outlined" 
            startIcon={loadingAction === 'sync' ? <CircularProgress size={16} /> : <Sync />}
            onClick={handleSyncEngine}
            disabled={!!loadingAction}
          >
            Sync with Oanda
          </Button>
          <Button 
            variant="outlined" 
            color="info"
            startIcon={loadingAction === 'resetStats' ? <CircularProgress size={16} /> : <BarChart />}
            onClick={handleResetStats}
            disabled={!!loadingAction}
          >
            Reset Statistics
          </Button>
        </Stack>
      </GlassCard>

      {/* Danger Zone */}
      <Paper 
        variant="outlined" 
        sx={{ 
          p: 3, 
          borderColor: 'error.main', 
          bgcolor: alpha(theme.palette.error.main, 0.05), 
          borderStyle: 'dashed' 
        }}
      >
        <SectionHeader 
          icon={<Warning />} 
          title="Danger Zone" 
          subtitle="Use with caution" 
        />
        <Stack direction="row" spacing={2}>
          <Button 
            variant="outlined" 
            color="warning" 
            startIcon={loadingAction === 'reset' ? <CircularProgress size={16} /> : <RestartAlt />}
            onClick={handleResetEngine}
            disabled={!!loadingAction}
          >
            Reset Signal State
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Clears pending continuation entries and resets signal cooldowns. Does not affect open trades.
        </Typography>
      </Paper>
    </Stack>
  );
};

export default GeneralSettings;
