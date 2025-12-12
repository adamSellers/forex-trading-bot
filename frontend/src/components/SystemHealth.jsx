// frontend/src/components/SystemHealth.jsx - FIXED & DIAGNOSTIC MODE
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
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails
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
  MonetizationOn,
  Key,
  ExpandMore,
  BugReport
} from '@mui/icons-material';
import { managementAPI } from '../config/api';

const MetricCard = ({ title, value, subtitle, icon, color }) => (
  <Card variant="outlined" sx={{ height: '100%', borderLeft: color ? 4 : 0, borderColor: color ? `${color}.main` : 'divider' }}>
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
  // FIXED: Broader check for "Online" status to catch all variations
  const isOnline = 
    status === true || 
    status?.ready === true || 
    status?.isActive === true || 
    status?.isConnected === true ||
    status?.status === 'OK';

  const color = isOnline ? 'success' : 'error';
  const icon = isOnline ? <CloudDone /> : <CloudOff />;
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
      console.log("🔍 Health Data:", healthData); // Console Debug
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
    const interval = setInterval(fetchData, 15000); 
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

  if (error) return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>;
  if (!health || !systemInfo) return <Alert severity="info" sx={{ m: 3 }}>No system data available.</Alert>;

  const services = health.services || {};
  
  // FIXED: Check 'isInitialized' (Backend standard) instead of 'status' (Frontend assumption)
  const isBackendReady = health.isInitialized === true;
  const isBinanceReady = services.binanceData?.ready === true;
  
  const overallStatus = isBackendReady && isBinanceReady;

  const memoryUsage = systemInfo.memory?.formatted || {};
  const memPercent = systemInfo.memory ? (systemInfo.memory.heapUsed / systemInfo.memory.heapTotal) * 100 : 0;
  
  const keysLoaded = systemInfo.environment?.hasApiKeys === true;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">System Health</Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={fetchData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Box>

      {/* Main Status Banner */}
      <Paper sx={{ p: 3, mb: 2, borderTop: 4, borderColor: overallStatus ? 'success.main' : 'error.main' }}>
        <Box display="flex" alignItems="center" gap={2}>
          {overallStatus ? <CheckCircle color="success" sx={{ fontSize: 40 }} /> : <Error color="error" sx={{ fontSize: 40 }} />}
          <Box>
            <Typography variant="h5" fontWeight="bold">
              {overallStatus ? 'All Systems Operational' : 'System Alert'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {!isBackendReady ? 'Backend Initializing...' : 
               !isBinanceReady ? 'Binance Data Disconnected' : 
               'Systems Nominal'} 
              • Updated: {new Date(health.timestamp || Date.now()).toLocaleTimeString()}
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
              <Grid item xs={12}><ServiceStatusCard name="Trading Controller" status={true} /></Grid>
              <Grid item xs={12}><ServiceStatusCard name="Binance Data" status={services.binanceData} /></Grid>
              <Grid item xs={12}><ServiceStatusCard name="Trading Engine" status={services.engine} /></Grid>
              <Grid item xs={12}><ServiceStatusCard name="Signal Generator" status={services.signalGenerator} /></Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* System Info */}
        <Grid item xs={12} md={7}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>Environment & Memory</Typography>
                <Box sx={{ mb: 2 }}>
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2">Heap Usage</Typography>
                    <Typography variant="body2">{memoryUsage.heapUsed || 0} / {memoryUsage.heapTotal || 0}</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={memPercent} sx={{ height: 8, borderRadius: 4 }} />
                </Box>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={4}>
                    <MetricCard title="Uptime" value={health.uptimeFormatted || '0m'} icon={<Speed color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <MetricCard title="Node.js" value={systemInfo.server?.nodeVersion || 'N/A'} icon={<Dns color="primary" />} />
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <MetricCard title="Platform" value={systemInfo.server?.platform || 'Linux'} icon={<SettingsEthernet color="primary" />} />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* Detailed Metrics */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>Trading Metrics</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={3}>
                    <MetricCard 
                      title="API Credentials" 
                      value={keysLoaded ? 'Loaded' : 'Missing'}
                      subtitle={keysLoaded ? 'Decrypted' : 'Check Logs'}
                      icon={<Key color={keysLoaded ? "success" : "error"} />}
                      color={keysLoaded ? 'success' : 'error'}
                    />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard 
                      title="Data Streams" 
                      // Fix: Map 'prices' count to display
                      value={services.binanceData?.prices || 0}
                      subtitle={services.binanceData?.ready ? 'Active (WSS)' : 'Waiting...'}
                      icon={<Timeline color="info" />} 
                    />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard 
                      title="Engine Mode" 
                      value={health.config?.tradingMode === 'live' ? 'LIVE' : 'PAPER'}
                      subtitle={health.config?.enableTrading ? 'Trading Enabled' : 'Trading Paused'}
                      icon={health.config?.tradingMode === 'live' ? <MonetizationOn color="error" /> : <Psychology color="warning" />} 
                    />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard 
                      title="Signals" 
                      value={health.activeSignals?.length || 0}
                      subtitle="Active Candidates"
                      icon={<Timeline color="success" />} 
                    />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </Grid>
      </Grid>

      {/* DEBUG DATA DUMP - Hidden by default */}
      <Box mt={4}>
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box display="flex" alignItems="center" gap={1}>
                <BugReport fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">Raw Diagnostic Data</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <pre style={{ fontSize: '0.7rem', overflow: 'auto', maxHeight: '200px' }}>
                {JSON.stringify(health, null, 2)}
            </pre>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Box>
  );
};

export default SystemHealth;