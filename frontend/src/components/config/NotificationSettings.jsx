// frontend/src/components/config/NotificationSettings.jsx
import React, { useState, useEffect } from 'react';
import {
  Box, Typography, TextField, Switch, Grid, Stack,
<<<<<<< HEAD
<<<<<<< HEAD
  Button, CircularProgress, Alert, Link
} from '@mui/material';
import { Notifications, Email, Send } from '@mui/icons-material';
=======
  Button, CircularProgress, Alert, Chip, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import { Email, Send, CloudUpload, Cloud, CheckCircle } from '@mui/icons-material';
>>>>>>> acf795d (fixing report scheduler deps)
=======
  Button, CircularProgress, Alert, Chip, Select, MenuItem, FormControl, InputLabel, Link
} from '@mui/material';
import { Email, Send, CloudUpload, Cloud, CheckCircle, Notifications } from '@mui/icons-material';
>>>>>>> 786fc69 (merge)
import { GlassCard, SectionHeader } from './ConfigShared';
import { emailAPI, reportsAPI } from '../../config/api';

const NotificationSettings = ({ config, updateConfig }) => {
  const [testStatus, setTestStatus] = useState(null); // 'sending' | 'success' | 'error'
  const [testError, setTestError] = useState('');

  // S3 Reports state
  const [s3Status, setS3Status] = useState(null);
  const [s3Loading, setS3Loading] = useState(true);
  const [uploadStatus, setUploadStatus] = useState(null); // 'uploading' | 'success' | 'error'
  const [uploadError, setUploadError] = useState('');
  const [uploadPeriod, setUploadPeriod] = useState('24h');

  // Fetch S3 status on mount
  useEffect(() => {
    const fetchS3Status = async () => {
      try {
        const status = await reportsAPI.getStatus();
        setS3Status(status);
      } catch (err) {
        setS3Status(null);
      } finally {
        setS3Loading(false);
      }
    };
    fetchS3Status();
  }, []);

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

  const handleS3Upload = async () => {
    setUploadStatus('uploading');
    setUploadError('');
    try {
      await reportsAPI.upload(uploadPeriod);
      setUploadStatus('success');
      // Refresh status to update last upload time
      const status = await reportsAPI.getStatus();
      setS3Status(status);
      setTimeout(() => setUploadStatus(null), 5000);
    } catch (err) {
      setUploadStatus('error');
      setUploadError(err.message || 'Upload failed');
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const canSendTest = config.enableEmailAlerts && config.alertEmail?.includes('@');

  // Only show S3 section if configured (has bucket name)
  const showS3Section = !s3Loading && s3Status && s3Status.performanceBucket !== 'not configured';

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

      {/* S3 Analytics Reports - Only shown when configured */}
      {showS3Section && (
        <GlassCard>
          <SectionHeader
            icon={<Cloud />}
            title="S3 Analytics Reports"
            subtitle="Automated upload to AWS S3"
          />
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                border={1}
                borderColor="divider"
                borderRadius={1}
                p={2}
              >
                <Box>
                  <Typography fontWeight="bold">
                    Status
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Bucket: {s3Status.performanceBucket}
                  </Typography>
                </Box>
                <Chip
                  icon={s3Status.isRunning ? <CheckCircle /> : null}
                  label={s3Status.isRunning ? 'Running' : 'Stopped'}
                  color={s3Status.isRunning ? 'success' : 'default'}
                  size="small"
                />
              </Box>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Box border={1} borderColor="divider" borderRadius={1} p={2}>
                <Typography variant="caption" color="text.secondary">
                  Last Daily Upload
                </Typography>
                <Typography fontWeight="medium">
                  {formatDate(s3Status.lastDailyUpload)}
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Box border={1} borderColor="divider" borderRadius={1} p={2}>
                <Typography variant="caption" color="text.secondary">
                  Last Weekly Upload
                </Typography>
                <Typography fontWeight="medium">
                  {formatDate(s3Status.lastWeeklyUpload)}
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Period</InputLabel>
                <Select
                  value={uploadPeriod}
                  label="Period"
                  onChange={(e) => setUploadPeriod(e.target.value)}
                >
                  <MenuItem value="24h">Last 24 Hours</MenuItem>
                  <MenuItem value="7d">Last 7 Days</MenuItem>
                  <MenuItem value="30d">Last 30 Days</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={uploadStatus === 'uploading' ? <CircularProgress size={18} /> : <CloudUpload />}
                onClick={handleS3Upload}
                disabled={uploadStatus === 'uploading'}
                sx={{ height: 40 }}
              >
                {uploadStatus === 'uploading' ? 'Uploading...' : 'Upload Now'}
              </Button>
            </Grid>

            {uploadStatus === 'success' && (
              <Grid item xs={12}>
                <Alert severity="success" onClose={() => setUploadStatus(null)}>
                  Report uploaded to S3 successfully!
                </Alert>
              </Grid>
            )}
            {uploadStatus === 'error' && (
              <Grid item xs={12}>
                <Alert severity="error" onClose={() => setUploadStatus(null)}>
                  {uploadError}
                </Alert>
              </Grid>
            )}
          </Grid>
        </GlassCard>
      )}
    </Stack>
  );
};

export default NotificationSettings;
