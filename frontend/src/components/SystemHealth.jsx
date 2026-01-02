// frontend/src/components/SystemHealth.jsx - Forex Trading Bot System Health
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Button,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Stack,
  Chip,
  Avatar,
  Divider,
  Grid,
  useTheme,
  alpha,
  styled,
  Paper,
} from '@mui/material';
import {
  CheckCircle,
  Error,
  Dns,
  Speed,
  CloudDone,
  CloudOff,
  Timeline,
  Refresh,
  Key,
  ExpandMore,
  BugReport,
  Memory,
  SettingsInputComponent,
  PowerSettingsNew,
  CurrencyExchange,
  Sensors,
  Router,
  Storage,
} from '@mui/icons-material';
import { systemAPI, tradingAPI } from '../config/api';

// --- STYLED COMPONENTS ---
const GlassCard = styled(Paper)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  },
}));

const MetricValue = styled(Typography)(() => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 700,
  letterSpacing: '-0.5px',
}));

const StatusDot = styled(Box)(({ theme, status }) => ({
  width: 10,
  height: 10,
  borderRadius: '50%',
  backgroundColor:
    status === 'online' ? theme.palette.success.main : theme.palette.error.main,
  boxShadow: `0 0 10px ${
    status === 'online' ? theme.palette.success.main : theme.palette.error.main
  }`,
}));

// --- HELPER COMPONENTS ---

const ServiceRow = ({ name, status, latency, details }) => {
  const theme = useTheme();

  const isOnline =
    status === true ||
    status?.connected === true ||
    status?.isRunning === true ||
    status?.isActive === true ||
    status?.loaded === true;

  return (
    <Box
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      p={2}
      borderBottom={`1px solid ${alpha(theme.palette.divider, 0.1)}`}
      sx={{ '&:last-child': { borderBottom: 'none' } }}
    >
      <Box display="flex" alignItems="center" gap={2}>
        <StatusDot status={isOnline ? 'online' : 'offline'} />
        <Box>
          <Typography variant="body2" fontWeight="bold">
            {name}
          </Typography>
          {details && (
            <Typography variant="caption" color="text.secondary">
              {details}
            </Typography>
          )}
        </Box>
      </Box>
      <Box display="flex" alignItems="center" gap={1}>
        {latency && (
          <Chip
            label={`${latency}ms`}
            size="small"
            sx={{ height: 20, fontSize: '0.65rem' }}
          />
        )}
        <Chip
          icon={isOnline ? <CloudDone fontSize="small" /> : <CloudOff fontSize="small" />}
          label={isOnline ? 'ONLINE' : 'OFFLINE'}
          color={isOnline ? 'success' : 'error'}
          size="small"
          variant="outlined"
          sx={{ fontWeight: 'bold', fontSize: '0.7rem', height: 24 }}
        />
      </Box>
    </Box>
  );
};

const MetricItem = ({ title, value, subValue, icon, color = 'primary' }) => {
  const theme = useTheme();
  return (
    <Box
      display="flex"
      alignItems="center"
      gap={2}
      p={2}
      borderRadius={2}
      bgcolor={alpha(theme.palette.background.paper, 0.2)}
      width="100%"
    >
      <Avatar
        variant="rounded"
        sx={{
          bgcolor: alpha(theme.palette[color].main, 0.1),
          color: theme.palette[color].main,
        }}
      >
        {icon}
      </Avatar>
      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          fontWeight="bold"
          sx={{ textTransform: 'uppercase' }}
        >
          {title}
        </Typography>
        <MetricValue variant="h6">{value}</MetricValue>
        {subValue && (
          <Typography variant="caption" color="text.secondary">
            {subValue}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

const SystemHealth = () => {
  const theme = useTheme();
  const [health, setHealth] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [healthData, systemInfoData, accountData] = await Promise.all([
        systemAPI.getSystemHealth(),
        systemAPI.getSystemInfo(),
        tradingAPI.getAccount().catch(() => null), // Don't fail if account fetch fails
      ]);
      setHealth(healthData);
      setSystemInfo(systemInfoData);
      setAccount(accountData);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch system health: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading && !health) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        sx={{ height: '80vh' }}
      >
        <CircularProgress />
        <Typography sx={{ ml: 2, fontFamily: 'monospace' }}>
          INITIALIZING SYSTEM DIAGNOSTICS...
        </Typography>
      </Box>
    );
  }

  if (error)
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
      </Alert>
    );
  if (!health || !systemInfo)
    return (
      <Alert severity="info" sx={{ m: 3 }}>
        No system data available.
      </Alert>
    );

  const services = health.services || {};
  const isOandaReady = services.oanda?.connected === true;
  const isDataServiceReady = services.dataService?.isRunning === true;
  const isSignalGenReady = services.signalGenerator?.isActive === true;
  const overallStatus = isOandaReady && isDataServiceReady && isSignalGenReady;

  const memoryUsage = systemInfo.memory?.formatted || {};
  const memPercent = systemInfo.memory
    ? (systemInfo.memory.heapUsed / systemInfo.memory.heapTotal) * 100
    : 0;
  const keysLoaded = systemInfo.environment?.hasApiKeys === true;

  return (
    <Container maxWidth={false} sx={{ py: 2 }}>
      {/* HEADER */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4} px={1}>
        <Box>
          <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>
            SYSTEM <span style={{ color: theme.palette.primary.main }}>HEALTH</span>
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
            FOREX INFRASTRUCTURE MONITORING & DIAGNOSTICS
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={fetchData}
          disabled={loading}
          color="inherit"
        >
          {loading ? 'Scanning...' : 'Run Diagnostics'}
        </Button>
      </Box>

      {/* MAIN STATUS BANNER */}
      <GlassCard
        sx={{
          p: 3,
          mb: 3,
          borderLeft: `6px solid ${
            overallStatus ? theme.palette.success.main : theme.palette.error.main
          }`,
          background: `linear-gradient(90deg, ${alpha(
            overallStatus ? theme.palette.success.main : theme.palette.error.main,
            0.1
          )} 0%, transparent 100%)`,
        }}
      >
        <Box display="flex" alignItems="center" gap={3}>
          {overallStatus ? (
            <CheckCircle
              color="success"
              sx={{ fontSize: 48, filter: 'drop-shadow(0 0 10px rgba(0,255,0,0.3))' }}
            />
          ) : (
            <Error
              color="error"
              sx={{ fontSize: 48, filter: 'drop-shadow(0 0 10px rgba(255,0,0,0.3))' }}
            />
          )}
          <Box>
            <Typography variant="h5" fontWeight="bold" letterSpacing={1}>
              {overallStatus ? 'ALL SYSTEMS OPERATIONAL' : 'SYSTEM DEGRADED'}
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" mt={0.5}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <SettingsInputComponent fontSize="small" />
                {!isOandaReady
                  ? 'Oanda API Disconnected'
                  : !isDataServiceReady
                  ? 'Data Service Offline'
                  : !isSignalGenReady
                  ? 'Signal Generator Inactive'
                  : 'Services Nominal'}
              </Typography>
              <Divider orientation="vertical" flexItem />
              <Typography variant="body2" color="text.secondary" fontFamily="monospace">
                LAST SYNC: {new Date(health.timestamp || Date.now()).toLocaleTimeString()}
              </Typography>
            </Stack>
          </Box>
        </Box>
      </GlassCard>

      <Grid container spacing={3} alignItems="stretch">
        {/* LEFT COLUMN: SERVICES & SPECS */}
        <Grid item xs={12} md={5} display="flex" flexDirection="column">
          <Stack spacing={3} sx={{ flexGrow: 1, width: '100%' }}>
            {/* Service Status Module */}
            <GlassCard sx={{ p: 0 }}>
              <Box
                p={2}
                borderBottom={`1px solid ${alpha(theme.palette.divider, 0.1)}`}
                display="flex"
                alignItems="center"
                gap={1}
              >
                <Dns color="primary" />
                <Typography variant="h6" fontWeight="bold">
                  Service Status
                </Typography>
              </Box>
              <Box>
                <ServiceRow
                  name="Oanda API"
                  status={services.oanda}
                  latency={services.oanda?.latencyMs}
                  details={`Environment: ${services.oanda?.environment || 'N/A'}`}
                />
                <ServiceRow
                  name="Price Data Stream"
                  status={services.dataService}
                  details={`${services.dataService?.priceCount || 0} instruments active`}
                />
                <ServiceRow
                  name="Signal Generator"
                  status={services.signalGenerator}
                  details={`${services.signalGenerator?.activeSignals || 0} active signals`}
                />
                <ServiceRow
                  name="Config Service"
                  status={services.configService}
                  details={
                    services.configService?.tradingEnabled
                      ? 'Trading Enabled'
                      : 'Trading Disabled'
                  }
                />
              </Box>
            </GlassCard>

            {/* Environment Info */}
            <GlassCard sx={{ p: 3, flexGrow: 1 }}>
              <Box display="flex" alignItems="center" gap={1} mb={3}>
                <PowerSettingsNew color="warning" />
                <Typography variant="h6" fontWeight="bold">
                  Environment
                </Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <MetricItem
                    title="Uptime"
                    value={health.uptimeFormatted || '0m'}
                    icon={<Speed fontSize="small" />}
                    color="info"
                  />
                </Grid>
                <Grid item xs={6}>
                  <MetricItem
                    title="Node Version"
                    value={systemInfo.server?.nodeVersion || 'N/A'}
                    icon={<Dns fontSize="small" />}
                    color="secondary"
                  />
                </Grid>
                <Grid item xs={12}>
                  <MetricItem
                    title="Host Platform"
                    value={systemInfo.server?.platform || 'Linux'}
                    subValue={`${systemInfo.server?.arch || 'x64'} Architecture`}
                    icon={<SettingsInputComponent fontSize="small" />}
                    color="warning"
                  />
                </Grid>
              </Grid>
            </GlassCard>
          </Stack>
        </Grid>

        {/* RIGHT COLUMN: METRICS & RESOURCES */}
        <Grid item xs={12} md={7} display="flex" flexDirection="column">
          <Stack spacing={3} sx={{ flexGrow: 1, width: '100%' }}>
            {/* Memory Usage Visualization */}
            <GlassCard sx={{ p: 3 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Memory color="secondary" />
                  <Typography variant="h6" fontWeight="bold">
                    System Resources
                  </Typography>
                </Box>
                <Chip
                  label={`${Math.round(memPercent)}% Load`}
                  color={memPercent > 80 ? 'error' : memPercent > 60 ? 'warning' : 'success'}
                  size="small"
                />
              </Box>

              <Box sx={{ mb: 1 }}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="caption" fontWeight="bold" color="text.secondary">
                    HEAP MEMORY USAGE
                  </Typography>
                  <Typography variant="caption" fontFamily="monospace">
                    {memoryUsage.heapUsed} / {memoryUsage.heapTotal}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={memPercent}
                  color={memPercent > 70 ? 'warning' : 'primary'}
                  sx={{ height: 10, borderRadius: 5 }}
                />
              </Box>
            </GlassCard>

            {/* Trading Telemetry Grid */}
            <GlassCard sx={{ p: 3, flexGrow: 1 }}>
              <Box display="flex" alignItems="center" gap={1} mb={3}>
                <Timeline color="success" />
                <Typography variant="h6" fontWeight="bold">
                  Trading Telemetry
                </Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <MetricItem
                    title="API Credentials"
                    value={keysLoaded ? 'LOADED' : 'MISSING'}
                    subValue={
                      keysLoaded
                        ? `Account: ...${systemInfo.environment?.accountId?.slice(-4) || ''}`
                        : 'Check .env file'
                    }
                    icon={<Key fontSize="small" />}
                    color={keysLoaded ? 'success' : 'error'}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <MetricItem
                    title="Active Instruments"
                    value={`${health.config?.assets?.length || 0} PAIRS`}
                    subValue={health.config?.assets?.join(', ') || 'None configured'}
                    icon={<CurrencyExchange fontSize="small" />}
                    color="info"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <MetricItem
                    title="Trading Mode"
                    value={health.config?.tradingMode === 'live' ? 'LIVE' : 'PAPER'}
                    subValue={
                      health.config?.enableTrading ? 'Engine Active' : 'Engine Paused'
                    }
                    icon={<Sensors fontSize="small" />}
                    color={health.config?.tradingMode === 'live' ? 'error' : 'warning'}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <MetricItem
                    title="Signal Queue"
                    value={health.activeSignals?.length || 0}
                    subValue={`Strategy: ${health.config?.strategy || 'N/A'}`}
                    icon={<Timeline fontSize="small" />}
                    color="primary"
                  />
                </Grid>
                {account && (
                  <>
                    <Grid item xs={12} sm={6}>
                      <MetricItem
                        title="Account Balance"
                        value={`A$${account.balance?.toFixed(2) || '0.00'}`}
                        subValue={`Currency: ${account.currency || 'AUD'}`}
                        icon={<Storage fontSize="small" />}
                        color="success"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <MetricItem
                        title="Open Positions"
                        value={account.openTrades || 0}
                        subValue={`Margin Used: A$${account.marginUsed?.toFixed(2) || '0.00'}`}
                        icon={<Router fontSize="small" />}
                        color="info"
                      />
                    </Grid>
                  </>
                )}
              </Grid>
            </GlassCard>
          </Stack>
        </Grid>
      </Grid>

      {/* DEBUG TERMINAL (Collapsed) */}
      <Box mt={4}>
        <Accordion
          sx={{
            bgcolor: 'transparent',
            boxShadow: 'none',
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box display="flex" alignItems="center" gap={1}>
              <BugReport fontSize="small" color="action" />
              <Typography variant="caption" fontWeight="bold" color="text.secondary">
                RAW DIAGNOSTIC LOGS
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box
              component="pre"
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: alpha('#000', 0.3),
                fontSize: '0.75rem',
                overflow: 'auto',
                maxHeight: '300px',
                border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                color: theme.palette.text.secondary,
              }}
            >
              {JSON.stringify({ health, systemInfo, account }, null, 2)}
            </Box>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Container>
  );
};

export default SystemHealth;