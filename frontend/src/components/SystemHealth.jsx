// frontend/src/components/SystemHealth.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Button,
  Tooltip,
  LinearProgress
} from '@mui/material';
import {
  CheckCircle,
  Error,
  Dns,
  Memory,
  Speed,
  Update,
  CloudDone,
  CloudOff,
  Psychology,
  Timeline,
  SettingsEthernet,
  Refresh
} from '@mui/icons-material';
import { managementAPI } from '../config/api';

const MetricCard = ({ title, value, subtitle, icon }) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
    <CardContent>
      <Box display="flex" alignItems="center" mb={1}>
        {icon}
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {title}
        </Typography>
      </Box>
      <Typography variant="h6" fontWeight="bold">
        {value}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary">
          {subtitle}
        </Typography>
      )}
    </CardContent>
  </Card>
);

const ServiceStatusCard = ({ name, status }) => {
  const isOnline = status === true || status?.isConnected === true || status?.isActive === true;
  const color = isOnline ? 'success' : 'error';
  const icon = isOnline ? <CloudDone /> : <CloudOff />;

  return (
    <Card variant="outlined" sx={{ borderLeft: 4, borderColor: `${color}.main` }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={500}>{name}</Typography>
          <Chip
            icon={icon}
            label={isOnline ? 'Online' : 'Offline'}
            color={color}
            size="small"
          />
        </Box>
      </CardContent>
    </Card>
  );
};

const SystemHealth = () => {
  const [health, setHealth] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [healthData, systemInfoData] = await Promise.all([
        managementAPI.getSystemHealth(),
        managementAPI.getSystemInfo()
      ]);
      setHealth(healthData);
      setSystemInfo(systemInfoData);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch system health: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading && !health) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '80vh' }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading System Health...</Typography>
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>;
  }

  if (!health || !systemInfo) {
    return <Alert severity="info" sx={{ m: 3 }}>No system data available.</Alert>;
  }

  const overallStatus = health.status === 'OK' && Object.values(health.services).every(s => s);
  const memoryUsage = systemInfo.memory?.formatted;
  const memPercent = (systemInfo.memory.heapUsed / systemInfo.memory.heapTotal) * 100;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">System Health</Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={fetchData}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Box>

      <Paper sx={{ p: 3, mb: 2, borderTop: 4, borderColor: overallStatus ? 'success.main' : 'error.main' }}>
        <Box display="flex" alignItems="center" gap={2}>
          {overallStatus ? <CheckCircle color="success" sx={{ fontSize: 40 }} /> : <Error color="error" sx={{ fontSize: 40 }} />}
          <Box>
            <Typography variant="h5" fontWeight="bold">
              {overallStatus ? 'All Systems Operational' : 'System Alert'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Last updated: {new Date(health.timestamp).toLocaleString()}
            </Typography>
          </Box>
        </Box>
      </Paper>

      <Grid container spacing={3}>
        {/* Service Status */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Service Status</Typography>
            <Grid container spacing={1.5}>
              {Object.entries(health.services).map(([name, status]) => (
                <Grid item xs={12} key={name}>
                  <ServiceStatusCard name={name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} status={status} />
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>

        {/* System & Memory Info */}
        <Grid item xs={12} md={7}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>System Information</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Uptime" value={health.uptimeFormatted} icon={<Speed color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Node.js" value={systemInfo.server.nodeVersion} icon={<Dns color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Environment" value={health.environment} icon={<SettingsEthernet color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Platform" value={systemInfo.server.platform} icon={<Dns color="primary" />} />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>Memory Usage</Typography>
                <Box sx={{ mb: 2 }}>
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2">Heap Usage</Typography>
                    <Typography variant="body2">{memoryUsage.heapUsed} / {memoryUsage.heapTotal}</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={memPercent} sx={{ height: 8, borderRadius: 4 }} />
                </Box>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Heap Used" value={memoryUsage.heapUsed} icon={<Memory color="secondary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Heap Total" value={memoryUsage.heapTotal} icon={<Memory color="secondary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="RSS" value={memoryUsage.rss} subtitle="Total process memory" icon={<Memory color="secondary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="External" value={memoryUsage.external} subtitle="C++ objects" icon={<Memory color="secondary" />} />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </Grid>

        {/* Trading System Details */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Trading System Details</Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="Binance Data" 
                  value={systemInfo.binanceData?.mode || 'N/A'}
                  subtitle={`${systemInfo.binanceData?.activeStreams || 0} streams`}
                  icon={<Timeline color="info" />} 
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="Paper Trading" 
                  value={systemInfo.tradingSystem?.status?.services?.paperTrading?.isActive ? 'Active' : 'Inactive'}
                  subtitle={`$${systemInfo.tradingSystem?.status?.services?.paperTrading?.totalValue?.toFixed(0) || '0'} value`}
                  icon={<Psychology color="warning" />} 
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="Signal Generator" 
                  value={systemInfo.tradingSystem?.status?.services?.signalGenerator?.isActive ? 'Active' : 'Inactive'}
                  subtitle={`${systemInfo.tradingSystem?.status?.services?.signalGenerator?.signalCount || 0} signals`}
                  icon={<Timeline color="info" />} 
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="API Keys" 
                  value={systemInfo.environment?.hasApiKeys ? 'Loaded' : 'Missing'}
                  subtitle="From environment"
                  icon={systemInfo.environment?.hasApiKeys ? <CheckCircle color="success" /> : <Error color="error" />} 
                />
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SystemHealth;