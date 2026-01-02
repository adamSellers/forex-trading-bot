// frontend/src/components/config/NotificationSettings.jsx
import React from 'react';
import { Box, Typography, TextField, Switch, Grid, Stack } from '@mui/material';
import { Email } from '@mui/icons-material';
import { GlassCard, SectionHeader } from './ConfigShared';

const NotificationSettings = ({ config, updateConfig }) => {
  return (
    <Stack spacing={3}>
      <GlassCard>
        <SectionHeader 
          icon={<Email />} 
          title="Email Notifications" 
          subtitle="Trade alerts and daily reports" 
        />
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Box 
              display="flex" 
              justifyContent="space-between" 
              alignItems="center" 
              mb={2} 
              border={1} 
              borderColor="divider" 
              borderRadius={1} 
              p={2}
            >
              <Box>
                <Typography fontWeight="bold">Email Alerts</Typography>
                <Typography variant="caption" color="text.secondary">
                  Receive instant trade notifications
                </Typography>
              </Box>
              <Switch 
                checked={config.enableEmailAlerts} 
                onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)} 
              />
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
};

export default NotificationSettings;