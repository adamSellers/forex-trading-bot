// frontend/src/components/config/InstrumentSettings.jsx
import React, { useState } from 'react';
import {
  Box, Typography, Button, Switch, FormControl, InputLabel, Select,
  MenuItem, Grid, Stack, List, ListItem, Paper, Alert, IconButton,
  alpha, useTheme
} from '@mui/material';
import { CurrencyExchange, Schedule, AddCircle, Delete } from '@mui/icons-material';
import { GlassCard, SectionHeader, SUPPORTED_INSTRUMENTS, TRADING_SESSIONS } from './ConfigShared';
import { INSTRUMENT_INFO } from '../dashboard/Shared';

const InstrumentSettings = ({ config, updateConfig }) => {
  const theme = useTheme();
  const [newAsset, setNewAsset] = useState('');

  const handleAddAsset = () => {
    if (!newAsset || config.assets.includes(newAsset)) return;
    updateConfig('assets', [...config.assets, newAsset]);
    setNewAsset('');
  };

  const handleRemoveAsset = (assetToRemove) => {
    updateConfig('assets', config.assets.filter(a => a !== assetToRemove));
  };

  const toggleSession = (session) => {
    const sessions = config.activeSessions || [];
    if (sessions.includes(session)) {
      updateConfig('activeSessions', sessions.filter(s => s !== session));
    } else {
      updateConfig('activeSessions', [...sessions, session]);
    }
  };

  return (
    <Stack spacing={3}>
      {/* Active Instruments */}
      <GlassCard>
        <SectionHeader 
          icon={<CurrencyExchange />} 
          title="Active Instruments" 
          subtitle="Select which Forex pairs to trade" 
        />
        
        <Box display="flex" gap={2} mb={3} p={2} bgcolor={alpha(theme.palette.background.paper, 0.3)} borderRadius={2}>
          <FormControl size="small" fullWidth>
            <InputLabel>Add Pair</InputLabel>
            <Select value={newAsset} label="Add Pair" onChange={(e) => setNewAsset(e.target.value)}>
              {SUPPORTED_INSTRUMENTS.filter(a => !config.assets.includes(a)).map(instrument => (
                <MenuItem key={instrument} value={instrument}>
                  {INSTRUMENT_INFO[instrument]?.flag} {instrument.replace('_', '/')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button 
            variant="contained" 
            onClick={handleAddAsset} 
            disabled={!newAsset} 
            startIcon={<AddCircle />}
          >
            ADD
          </Button>
        </Box>
        
        <List disablePadding>
          {config.assets.map((instrument) => {
            const info = INSTRUMENT_INFO[instrument] || {};
            return (
              <ListItem 
                key={instrument} 
                sx={{ 
                  borderBottom: 1, 
                  borderColor: 'divider', 
                  py: 2,
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.05) } 
                }}
              >
                <Box display="flex" alignItems="center" flexGrow={1}>
                  <Typography variant="h6" sx={{ mr: 2 }}>{info.flag || '💱'}</Typography>
                  <Box>
                    <Typography fontWeight="bold">{instrument.replace('_', '/')}</Typography>
                    <Typography variant="caption" color="text.secondary">{info.name || instrument}</Typography>
                  </Box>
                </Box>
                <IconButton color="error" onClick={() => handleRemoveAsset(instrument)}>
                  <Delete />
                </IconButton>
              </ListItem>
            );
          })}
          {config.assets.length === 0 && (
            <Alert severity="info">No instruments configured. Add pairs to begin trading.</Alert>
          )}
        </List>
        
        {config.assets.length > 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="caption">
              <strong>Tip:</strong> Start with 1-2 pairs. AUD/USD and EUR/USD have the tightest spreads and most reliable trends.
            </Typography>
          </Alert>
        )}
      </GlassCard>

      {/* Trading Sessions */}
      <GlassCard>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <SectionHeader 
            icon={<Schedule />} 
            title="Trading Sessions" 
            subtitle="Limit trading to active market hours" 
          />
          <Switch 
            checked={config.enableSessionFilter || false} 
            onChange={(e) => updateConfig('enableSessionFilter', e.target.checked)} 
          />
        </Box>
        
        <Box sx={{ opacity: config.enableSessionFilter ? 1 : 0.5 }}>
          <Grid container spacing={2}>
            {Object.entries(TRADING_SESSIONS).map(([key, session]) => (
              <Grid item xs={6} md={3} key={key}>
                <Paper
                  variant="outlined"
                  onClick={() => config.enableSessionFilter && toggleSession(key)}
                  sx={{
                    p: 2,
                    textAlign: 'center',
                    cursor: config.enableSessionFilter ? 'pointer' : 'default',
                    borderColor: config.activeSessions?.includes(key) ? session.color : 'divider',
                    bgcolor: config.activeSessions?.includes(key) ? alpha(session.color, 0.1) : 'transparent',
                    transition: 'all 0.2s',
                    '&:hover': config.enableSessionFilter ? {
                      borderColor: session.color,
                    } : {}
                  }}
                >
                  <Typography 
                    fontWeight="bold" 
                    sx={{ color: config.activeSessions?.includes(key) ? session.color : 'text.primary' }}
                  >
                    {session.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {session.start}:00 - {session.end}:00 UTC
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Best volatility occurs during London/NY overlap (12:00-16:00 UTC)
          </Typography>
        </Box>
      </GlassCard>
    </Stack>
  );
};

export default InstrumentSettings;