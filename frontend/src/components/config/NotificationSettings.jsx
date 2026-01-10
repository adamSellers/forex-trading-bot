// frontend/src/components/config/NotificationSettings.jsx
import React, { useState } from 'react';
import {
  Box, Typography, TextField, Switch, Grid, Stack,
  Button, CircularProgress, Alert
} from '@mui/material';
import { Email, Send } from '@mui/icons-material';
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
