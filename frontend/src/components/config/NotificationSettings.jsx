// frontend/src/components/config/NotificationSettings.jsx
import React, { useState } from 'react';
import {
  Box, Typography, TextField, Switch, Grid, Stack,
  Button, CircularProgress, Alert, Link
} from '@mui/material';
import { Notifications, Email, Send } from '@mui/icons-material';
import { GlassCard, SectionHeader } from './ConfigShared';
import { emailAPI } from '../../config/api';

const NotificationSettings = ({ config, updateConfig }) => {
  const [testStatus, setTestStatus] = useState(null); // 'sending' | 'success' | 'error'
  const [testError, setTestError] = useState('');

  const handleSendTest = async () => {
    setTestStatus('sending');
    setTestError('');

    try {
      await emailAPI.sendTest(config.alertEmail);
      setTestStatus('success');
      setTimeout(() => setTestStatus(null), 5000);
    } catch (err) {
      setTestStatus('error');
      setTestError(err.message || 'Failed to send test email');
    }
  };

  const canSendTest = config.enableEmailAlerts && config.alertEmail?.includes('@');

  return (
    <Stack spacing={3}>
      {/* Slack Notifications */}
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

      {/* Email Notifications */}
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
                  Receive instant trade notifications via email
                </Typography>
              </Box>
              <Switch
                checked={config.enableEmailAlerts}
                onChange={(e) => updateConfig('enableEmailAlerts', e.target.checked)}
              />
            </Box>
          </Grid>
          <Grid item xs={12} md={8}>
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
          <Grid item xs={12} md={4}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={testStatus === 'sending' ? <CircularProgress size={18} /> : <Send />}
              onClick={handleSendTest}
              disabled={!canSendTest || testStatus === 'sending'}
              sx={{ height: 56 }}
            >
              {testStatus === 'sending' ? 'Sending...' : 'Send Test'}
            </Button>
          </Grid>
          {testStatus === 'success' && (
            <Grid item xs={12}>
              <Alert severity="success" onClose={() => setTestStatus(null)}>
                Test email sent! Check your inbox.
              </Alert>
            </Grid>
          )}
          {testStatus === 'error' && (
            <Grid item xs={12}>
              <Alert severity="error" onClose={() => setTestStatus(null)}>
                {testError}
              </Alert>
            </Grid>
          )}
        </Grid>
      </GlassCard>
    </Stack>
  );
};

export default NotificationSettings;
