// frontend/src/components/Navigation.jsx - Forex Trading Bot Navigation
import React, { useState, useEffect } from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  Typography,
  Tabs,
  Tab,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  useTheme,
  alpha,
} from '@mui/material';
import {
  CompareArrows,
  Dashboard,
  Insights,
  Settings,
  Refresh,
  Circle,
  MonitorHeart,
} from '@mui/icons-material';
import { socket, tradingAPI } from '../config/api';

const Navigation = ({ currentView, onViewChange, views }) => {
  const theme = useTheme();
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);

  // Map view to tab index
  const viewToIndex = {
    [views.DASHBOARD]: 0,
    [views.ANALYTICS]: 1,
    [views.PAPER]: 2,
    [views.SYSTEM]: 3,
    [views.SETTINGS]: 4,
  };

  const indexToView = {
    0: views.DASHBOARD,
    1: views.ANALYTICS,
    2: views.PAPER,
    3: views.SYSTEM,
    4: views.SETTINGS,
  };

  useEffect(() => {
    const handleConnect = () => {
      setConnectionStatus('connected');
      setLastUpdate(Date.now());
    };

    const handleDisconnect = () => {
      setConnectionStatus('disconnected');
    };

    const handleConnectError = () => {
      setConnectionStatus('error');
    };

    const handleConfigUpdate = (config) => {
      setTradingEnabled(config?.enableTrading || false);
      setLastUpdate(Date.now());
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('configUpdate', handleConfigUpdate);

    if (!socket.connected) {
      socket.connect();
    } else {
      handleConnect();
    }

    // Initial fetch
    tradingAPI.getStatus()
      .then((data) => {
        setTradingEnabled(data?.config?.enableTrading || false);
      })
      .catch(console.error);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('configUpdate', handleConfigUpdate);
      socket.disconnect();
    };
  }, []);

  const handleRefresh = () => {
    window.location.reload();
  };

  const getConnectionColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return theme.palette.success.main;
      case 'disconnected':
        return theme.palette.warning.main;
      case 'error':
        return theme.palette.error.main;
      default:
        return theme.palette.grey[500];
    }
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: alpha(theme.palette.background.paper, 0.8),
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 1, sm: 2 } }}>
        {/* Left: Logo */}
        <Box display="flex" alignItems="center" gap={2}>
          <Box display="flex" flexDirection="column">
            <Typography
              variant="h6"
              fontWeight="900"
              sx={{ letterSpacing: -0.5, lineHeight: 1 }}
            >
              FOREX<span style={{ color: theme.palette.primary.main }}>TREND</span>
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ letterSpacing: 2, fontSize: '0.6rem' }}
            >
              TRADING TERMINAL
            </Typography>
          </Box>

          <Divider orientation="vertical" flexItem sx={{ height: 30, alignSelf: 'center', mx: 1 }} />

          {/* Status Indicators */}
          <Box display="flex" alignItems="center" gap={1}>
            <Tooltip title={`Connection: ${connectionStatus}`}>
              <Circle sx={{ fontSize: 10, color: getConnectionColor() }} />
            </Tooltip>
            <Chip
              label={connectionStatus === 'connected' ? 'ONLINE' : 'OFFLINE'}
              size="small"
              variant="outlined"
              sx={{
                height: 22,
                fontSize: '0.65rem',
                fontWeight: 'bold',
                borderColor: getConnectionColor(),
                color: getConnectionColor(),
              }}
            />
            {tradingEnabled && (
              <Chip
                label="LIVE"
                size="small"
                color="success"
                sx={{
                  height: 22,
                  fontSize: '0.65rem',
                  fontWeight: 'bold',
                }}
              />
            )}
          </Box>
        </Box>

        {/* Center: Navigation Tabs */}
        <Box sx={{ display: 'flex', justifyContent: 'center', flex: 1 }}>
          <Tabs
            value={viewToIndex[currentView]}
            onChange={(_, index) => onViewChange(indexToView[index])}
            textColor="primary"
            indicatorColor="primary"
            sx={{
              '& .MuiTab-root': {
                minHeight: 48,
                fontWeight: 'bold',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                minWidth: { xs: 'auto', sm: 120 },
                px: { xs: 1, sm: 2 },
              },
            }}
          >
            <Tab
              icon={<Dashboard fontSize="small" />}
              iconPosition="start"
              label={<Box sx={{ display: { xs: 'none', sm: 'block' } }}>Dashboard</Box>}
            />
            <Tab
              icon={<Insights fontSize="small" />}
              iconPosition="start"
              label={<Box sx={{ display: { xs: 'none', sm: 'block' } }}>Analytics</Box>}
            />
            <Tab
              icon={<CompareArrows fontSize="small" />}
              iconPosition="start"
              label={<Box sx={{ display: { xs: 'none', sm: 'block' } }}>Paper</Box>}
            />
            <Tab
              icon={<MonitorHeart fontSize="small" />}
              iconPosition="start"
              label={<Box sx={{ display: { xs: 'none', sm: 'block' } }}>System</Box>}
            />
            <Tab
              icon={<Settings fontSize="small" />}
              iconPosition="start"
              label={<Box sx={{ display: { xs: 'none', sm: 'block' } }}>Settings</Box>}
            />
          </Tabs>
        </Box>

        {/* Right: Status & Actions */}
        <Box display="flex" alignItems="center" gap={1}>
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color: 'text.secondary',
              display: { xs: 'none', md: 'block' },
            }}
          >
            {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--:--'}
          </Typography>
          <Tooltip title="Refresh">
            <IconButton
              size="small"
              onClick={handleRefresh}
              sx={{ border: 1, borderColor: 'divider' }}
            >
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Navigation;
