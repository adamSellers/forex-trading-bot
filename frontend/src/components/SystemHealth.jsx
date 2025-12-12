// frontend/src/components/SystemHealth.jsx - FIXED PROPERTY MAPPING
import React, { useState, useEffect, useCallback } from 'react';
import {
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  Button,
  LinearProgress
} from '@mui/material';
import {
  CheckCircle,
  Error,
  Dns,
  Memory,
  Speed,
  CloudDone,
  CloudOff,
  Psychology,
  Timeline,
  SettingsEthernet,
  Refresh,
  MonetizationOn
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
  // FIX: Added 'ready' check for BinanceDataService
  const isOnline = status === true || status?.isConnected === true || status?.isActive === true || status?.ready === true;
  const color = isOnline ? 'success' : 'error';
  const icon = isOnline ? <CloudDone /> : <CloudOff />;

  // Clean up camelCase names for display
  const displayName = name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

  return (
    <Card variant="outlined" sx={{ borderLeft: 4, borderColor: `${color}.main` }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={500}>{displayName}</Typography>
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

  // FIX: Check nested services correctly
  const services = health.services || {};
  const overallStatus = health.status === 'OK' && Object.values(services).every(s => 
    s === true || s?.isConnected || s?.isActive || s?.ready
  );
  
  const memoryUsage = systemInfo.memory?.formatted || {};
  const memPercent = systemInfo.memory ? (systemInfo.memory.heapUsed / systemInfo.memory.heapTotal) * 100 : 0;

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
              Last updated: {new Date(health.timestamp || Date.now()).toLocaleString()}
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
              {Object.entries(services).map(([name, status]) => (
                <Grid item xs={12} key={name}>
                  <ServiceStatusCard name={name} status={status} />
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
                    <MetricCard title="Uptime" value={health.uptimeFormatted || '0m'} icon={<Speed color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Node.js" value={systemInfo.server?.nodeVersion || 'N/A'} icon={<Dns color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Environment" value={health.environment || 'N/A'} icon={<SettingsEthernet color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Platform" value={systemInfo.server?.platform || 'Linux'} icon={<Dns color="primary" />} />
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
                    <Typography variant="body2">{memoryUsage.heapUsed || 0} / {memoryUsage.heapTotal || 0}</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={memPercent} sx={{ height: 8, borderRadius: 4 }} />
                </Box>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Heap Used" value={memoryUsage.heapUsed || 0} icon={<Memory color="secondary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="Heap Total" value={memoryUsage.heapTotal || 0} icon={<Memory color="secondary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="RSS" value={memoryUsage.rss || 0} subtitle="Total process memory" icon={<Memory color="secondary" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard title="External" value={memoryUsage.external || 0} subtitle="C++ objects" icon={<Memory color="secondary" />} />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </Grid>

        {/* Trading System Details (FIXED MAPPING) */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Trading System Details</Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="Binance Data" 
                  // Fix: Read 'ready' from health.services.binanceData
                  value={services.binanceData?.ready ? 'Live (WSS)' : 'Disconnected'}
                  // Fix: Read 'prices' count (number of streams)
                  subtitle={`${services.binanceData?.prices || 0} active streams`}
                  icon={<Timeline color="info" />} 
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="Trading Engine" 
                  // Fix: Read from health.services.engine
                  value={services.engine?.isActive ? 'Active' : 'Inactive'}
                  subtitle={health.config?.tradingMode === 'live' ? 'Real Money Mode' : 'Paper Mode'}
                  icon={health.config?.tradingMode === 'live' ? <MonetizationOn color="error" /> : <Psychology color="warning" />} 
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="Signal Generator" 
                  // Fix: Read from health.services.signalGenerator
                  value={services.signalGenerator?.isActive ? 'Active' : 'Inactive'}
                  subtitle={`${health.activeSignals?.length || 0} active signals`}
                  icon={<Timeline color="info" />} 
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard 
                  title="API Keys" 
                  value={services.binanceData?.ready ? 'Loaded' : 'Check Logs'}
                  subtitle="Encrypted in memory"
                  icon={services.binanceData?.ready ? <CheckCircle color="success" /> : <Error color="error" />} 
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