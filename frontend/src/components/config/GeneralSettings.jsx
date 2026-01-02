// frontend/src/components/config/GeneralSettings.jsx
import React from 'react';
import {
  Box, Typography, TextField, Button, Switch, FormControl,
  InputLabel, Select, MenuItem, InputAdornment, Grid, Stack,
  Paper, alpha, useTheme
} from '@mui/material';
import { SettingsRemote, Warning, RestartAlt } from '@mui/icons-material';
import { tradingAPI } from '../../config/api';
import { GlassCard, SectionHeader } from './ConfigShared';

const GeneralSettings = ({ config, updateConfig, onResetEngine }) => {
  const theme = useTheme();

  const handleResetEngine = async () => {
    if (!window.confirm("⚠️ RESET ENGINE STATE?\nThis clears pending entries and signal history.")) return;
    try {
      await tradingAPI.resetTrading();
      alert("✅ Engine Reset");
      if (onResetEngine) onResetEngine();
    } catch (e) {
      alert(`Reset failed: ${e.message}`);
    }
  };

  return (
    <Stack spacing={3}>
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
            startIcon={<RestartAlt />} 
            onClick={handleResetEngine}
          >
            Reset Engine State
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Clears pending continuation entries and resets signal cooldowns.
        </Typography>
      </Paper>
    </Stack>
  );
};

export default GeneralSettings;