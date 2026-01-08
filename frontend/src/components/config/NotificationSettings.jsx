// frontend/src/components/config/NotificationSettings.jsx
import React from 'react';
import { Box, Typography, TextField, Switch, Grid, Stack, Alert, Link } from '@mui/material';
import { Notifications } from '@mui/icons-material';
import { GlassCard, SectionHeader } from './ConfigShared';

const NotificationSettings = ({ config, updateConfig }) => {
  return (
    <Stack spacing={3}>
      <GlassCard>
        <SectionHeader 
          icon={<Notifications />} 
          title="Slack Notifications" 
          subtitle="Trade alerts via Slack webhook" 
        />
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Configure Slack notifications using the setup script. The webhook URL is encrypted and stored securely.
              <br />
              <Link href="https://api.slack.com/apps" target="_blank" rel="noopener">
                Create a Slack webhook →
              </Link>
            </Alert>
          </Grid>
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
                <Typography fontWeight="bold">Slack Alerts</Typography>
                <Typography variant="caption" color="text.secondary">
                  Receive instant trade notifications in Slack
                </Typography>
              </Box>
              <Switch 
                checked={config.enableSlackAlerts !== false} 
                onChange={(e) => updateConfig('enableSlackAlerts', e.target.checked)} 
              />
            </Box>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              To configure Slack notifications, run:
            </Typography>
            <Box 
              component="code" 
              sx={{ 
                display: 'block', 
                p: 1, 
                bgcolor: 'background.paper', 
                border: 1, 
                borderColor: 'divider', 
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.875rem'
              }}
            >
              bash scripts/setup-secrets.sh
            </Box>
          </Grid>
        </Grid>
      </GlassCard>
    </Stack>
  );
};

export default NotificationSettings;