// frontend/src/components/TradingDashboard.jsx - Complete Rewrite with Enhanced Status
import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Grid,
  Paper,
  Typography,
  Button,
  Alert,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Refresh,
  Settings,
  Timeline,
  TrendingUp,
  Assessment
} from '@mui/icons-material';
import { io } from 'socket.io-client';

// Import our components
import PortfolioOverview from './PortfolioOverview';
import CurrentHoldings from './CurrentHoldings';
import LivePrices from './LivePrices';
import TradingSignals from './TradingSignals';
import RecentTrades from './RecentTrades';
import LivePriceChart from './LivePriceChart';
import SystemStatusBanner from './SystemStatusBanner';

const TradingDashboard = () => {
  // State management
  const [systemStatus, setSystemStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  const [signals, setSignals] = useState([]);
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('balanced');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Socket connection
  useEffect(() => {
    const socketUrl = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    // Connection events
    socket.on('connect', () => {
      console.log('🔌 Connected to trading server');
      setError(null);
      fetchInitialData();
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Disconnected from trading server:', reason);
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, try to reconnect
        socket.connect();
      }
    });

    socket.on('connect_error', (error) => {
      console.error('🔌 Connection error:', error);
      setError('Connection to trading server failed. Retrying...');
    });

    // Data events
    socket.on('systemStatus', (status) => {
      console.log('📊 System status received');
      setSystemStatus(status);
      setTradingEnabled(status.config?.enableTrading || false);
      setSelectedStrategy(status.config?.strategy || 'balanced');
      setLoading(false);
      setLastUpdate(Date.now());
    });

    socket.on('portfolioUpdated', (portfolioData) => {
      console.log('💼 Portfolio updated');
      setPortfolio(portfolioData);
      setLastUpdate(Date.now());
    });

    socket.on('priceUpdate', (priceData) => {
      setPrices(prev => ({
        ...prev,
        [priceData.symbol]: priceData
      }));
      setLastUpdate(Date.now());
    });

    // Signal events - Enhanced handling
    socket.on('signalGenerated', (data) => {
      console.log('🚨 Signal received:', data?.symbol, data?.signal || data?.signal?.signal);
      
      const signal = data?.signal || data;
      if (signal?.symbol) {
        setSignals(prev => {
          const newSignals = [signal, ...prev].slice(0, 100);
          return newSignals;
        });
        setLastUpdate(Date.now());
      }
    });

    socket.on('allSignalsGenerated', (signalsArray) => {
      console.log('🚨 Batch signals received:', signalsArray?.length);
      
      if (Array.isArray(signalsArray) && signalsArray.length > 0) {
        setSignals(prev => {
          const combined = [...signalsArray, ...prev];
          const unique = combined.filter((signal, index, self) => 
            index === self.findIndex(s => 
              s.symbol === signal.symbol && 
              s.timestamp === signal.timestamp &&
              s.signal === signal.signal
            )
          );
          return unique.slice(0, 100);
        });
        setLastUpdate(Date.now());
      }
    });

    socket.on('tradeExecuted', (trade) => {
      console.log('💰 Trade executed:', trade.symbol, trade.side);
      setTrades(prev => [trade, ...prev].slice(0, 50));
      setLastUpdate(Date.now());
    });

    socket.on('tradingHalted', (data) => {
      console.warn('🚨 Trading halted:', data.reason);
      setError(`Trading Halted: ${data.reason}`);
      setTradingEnabled(false);
    });

    socket.on('tradingStarted', () => {
      console.log('▶️ Trading started');
      setTradingEnabled(true);
      setError(null);
    });

    socket.on('tradingStopped', () => {
      console.log('⏹️ Trading stopped');
      setTradingEnabled(false);
    });

    socket.on('tradingReset', () => {
      console.log('🔄 Trading reset');
      setSignals([]);
      setTrades([]);
      fetchInitialData();
    });

    return () => {
      console.log('🔌 Closing socket connection');
      socket.disconnect();
    };
  }, []);

  // API data fetching
  const fetchInitialData = async () => {
    try {
      console.log('🔄 Fetching initial data...');
      
      const endpoints = [
        { name: 'status', url: '/api/trading/status' },
        { name: 'portfolio', url: '/api/trading/portfolio' },
        { name: 'trades', url: '/api/trading/trades?limit=25' },
        { name: 'signals', url: '/api/trading/signals?limit=50' },
        { name: 'prices', url: '/api/trading/prices' },
        { name: 'account', url: '/api/trading/account' }
      ];

      const results = {};
      const errors = [];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint.url);
          
          if (!response.ok) {
            throw new Error(`${endpoint.name}: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          results[endpoint.name] = data;
          console.log(`✅ ${endpoint.name} loaded`);
          
        } catch (err) {
          console.error(`❌ Failed to fetch ${endpoint.name}:`, err.message);
          errors.push(`${endpoint.name}: ${err.message}`);
        }
      }

      // Update state with successful results
      if (results.status) {
        setSystemStatus(results.status);
        setTradingEnabled(results.status.config?.enableTrading || false);
        setSelectedStrategy(results.status.config?.strategy || 'balanced');
      }
      
      if (results.portfolio) setPortfolio(results.portfolio);
      if (results.trades) setTrades(results.trades);
      if (results.prices) setPrices(results.prices);
      if (results.account) setAccount(results.account);
      
      if (results.signals) {
        if (Array.isArray(results.signals)) {
          setSignals(results.signals);
          console.log('✅ Signals loaded:', results.signals.length);
        } else {
          console.warn('⚠️ Invalid signals format');
          setSignals([]);
        }
      }

      // Handle errors
      if (errors.length > 0) {
        console.warn('⚠️ Some endpoints failed:', errors);
        setError(`Some data failed to load: ${errors.slice(0, 2).join(', ')}`);
      } else {
        setError(null);
        console.log('✅ All data loaded successfully');
      }
      
      setLoading(false);
      setLastUpdate(Date.now());

    } catch (err) {
      console.error('❌ Critical error in fetchInitialData:', err);
      setError(`Failed to load trading data: ${err.message}`);
      setLoading(false);
    }
  };

  // Trading controls
  const handleToggleTrading = async () => {
    try {
      const endpoint = tradingEnabled ? '/api/trading/stop' : '/api/trading/start';
      const action = tradingEnabled ? 'Stopping' : 'Starting';
      
      console.log(`🔄 ${action} trading...`);
      
      const response = await fetch(endpoint, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`✅ ${result.message}`);
        setError(null);
        // State will be updated via socket events
      } else {
        const errorData = await response.json();
        setError(errorData.error || `Failed to ${tradingEnabled ? 'stop' : 'start'} trading`);
      }
    } catch (err) {
      console.error('❌ Toggle trading error:', err);
      setError(`Failed to ${tradingEnabled ? 'stop' : 'start'} trading: ${err.message}`);
    }
  };

  const handleResetTrading = async () => {
    try {
      console.log('🔄 Resetting trading engine...');
      
      const response = await fetch('/api/trading/reset', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Trading reset:', result.message);
        setError(null);
        // State will be updated via socket events and fetchInitialData
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to reset trading');
      }
    } catch (err) {
      console.error('❌ Reset trading error:', err);
      setError(`Failed to reset trading: ${err.message}`);
    }
  };

  const handleStrategyChange = async (event) => {
    const newStrategy = event.target.value;
    setSelectedStrategy(newStrategy);
    
    try {
      console.log('🔄 Updating strategy to:', newStrategy);
      
      const response = await fetch('/api/trading/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: newStrategy })
      });
      
      if (response.ok) {
        console.log('✅ Strategy updated');
        setError(null);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to update strategy');
      }
    } catch (err) {
      console.error('❌ Strategy update error:', err);
      setError(`Failed to update strategy: ${err.message}`);
    }
  };

  const handleRefreshData = () => {
    console.log('🔄 Manual refresh triggered');
    setError(null);
    setLoading(true);
    fetchInitialData();
  };

  // Calculate system health
  const getSystemHealth = () => {
    if (!systemStatus) return { status: 'unknown', color: 'default' };
    
    const isOnline = systemStatus.isInitialized;
    const hasRecentUpdate = lastUpdate && (Date.now() - lastUpdate) < 60000; // 1 minute
    const hasData = signals.length > 0 || trades.length > 0;
    
    if (isOnline && hasRecentUpdate && hasData) {
      return { status: 'healthy', color: 'success' };
    } else if (isOnline && hasData) {
      return { status: 'online', color: 'info' };
    } else if (isOnline) {
      return { status: 'initializing', color: 'warning' };
    } else {
      return { status: 'offline', color: 'error' };
    }
  };

  const systemHealth = getSystemHealth();

  // Data building status
  const getDataBuildingStatus = () => {
    if (!systemStatus?.services?.binanceData) return null;
    
    const binanceStatus = systemStatus.services.binanceData;
    const totalCandles = binanceStatus.totalCandles || 0;
    const assetsCount = systemStatus.config?.assets?.length || 4;
    const timeframesCount = systemStatus.config?.timeframes?.length || 3;
    const minRequired = assetsCount * timeframesCount * 25;
    
    return {
      current: totalCandles,
      required: minRequired,
      progress: Math.min((totalCandles / minRequired) * 100, 100),
      isBuilding: totalCandles < minRequired
    };
  };

  const dataStatus = getDataBuildingStatus();

  // Loading state
  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <Box textAlign="center">
            <Timeline sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h5" gutterBottom>
              Initializing Trading Dashboard
            </Typography>
            <Typography variant="body1" color="textSecondary" paragraph>
              Connecting to trading services and loading market data...
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Chip label="Please wait" color="primary" />
            </Box>
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Header Section */}
      <Box mb={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>
              Crypto Trend Trading Bot
            </Typography>
            <Box display="flex" gap={1} alignItems="center">
              <Chip
                icon={systemHealth.status === 'healthy' ? <TrendingUp /> : <Timeline />}
                label={`System ${systemHealth.status.charAt(0).toUpperCase() + systemHealth.status.slice(1)}`}
                color={systemHealth.color}
                size="small"
              />
              {lastUpdate && (
                <Chip
                  label={`Updated ${new Date(lastUpdate).toLocaleTimeString()}`}
                  size="small"
                  variant="outlined"
                />
              )}
            </Box>
          </Box>
          
          <Box display="flex" gap={1}>
            <Tooltip title="System Analytics">
              <IconButton color="primary">
                <Assessment />
              </IconButton>
            </Tooltip>
            <Tooltip title="Trading Configuration">
              <IconButton color="primary">
                <Settings />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        
        {/* System Status Banner */}
        <SystemStatusBanner systemStatus={systemStatus} signals={signals} />
        
        {/* Error Alert */}
        {error && (
          <Alert 
            severity="error" 
            sx={{ mb: 2 }} 
            onClose={() => setError(null)}
            action={
              <Button color="inherit" size="small" onClick={handleRefreshData}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {/* Control Panel */}
        <Paper sx={{ p: 2 }}>
          <Grid container spacing={2} alignItems="center">
            {/* Primary Controls */}
            <Grid item>
              <Button
                variant={tradingEnabled ? "contained" : "outlined"}
                color={tradingEnabled ? "error" : "success"}
                startIcon={tradingEnabled ? <Stop /> : <PlayArrow />}
                onClick={handleToggleTrading}
                disabled={dataStatus?.isBuilding && !tradingEnabled}
                size="large"
              >
                {tradingEnabled ? 'Stop Trading' : 'Start Trading'}
              </Button>
            </Grid>
            
            <Grid item>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={handleRefreshData}
                disabled={loading}
              >
                Refresh
              </Button>
            </Grid>

            <Grid item>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={handleResetTrading}
                color="warning"
                size="small"
              >
                Reset
              </Button>
            </Grid>

            {/* Strategy Selector */}
            <Grid item>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Strategy</InputLabel>
                <Select
                  value={selectedStrategy}
                  label="Strategy"
                  onChange={handleStrategyChange}
                >
                  <MenuItem value="conservative">Conservative</MenuItem>
                  <MenuItem value="balanced">Balanced</MenuItem>
                  <MenuItem value="responsive">Responsive</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Status Indicators */}
            <Grid item sx={{ ml: 'auto' }}>
              <Box display="flex" gap={1} alignItems="center">
                <Chip
                  size="small"
                  label={`${signals.length} signals`}
                  color="info"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`${trades.length} trades`}
                  color="secondary"
                  variant="outlined"
                />
                {dataStatus && (
                  <Chip
                    size="small"
                    label={dataStatus.isBuilding ? 'Building Data' : 'Data Ready'}
                    color={dataStatus.isBuilding ? 'warning' : 'success'}
                    variant="outlined"
                  />
                )}
              </Box>
            </Grid>
          </Grid>
        </Paper>
      </Box>

      {/* Main Dashboard Grid */}
      <Grid container spacing={3}>
        {/* Row 1: Portfolio Overview - Full Width */}
        <Grid item xs={12}>
          <PortfolioOverview 
            account={account} 
            prices={prices} 
            portfolio={portfolio} 
          />
        </Grid>

        {/* Row 2: Holdings & Signals/Trades */}
        <Grid item xs={12} lg={6}>
          <CurrentHoldings 
            account={account} 
            prices={prices} 
          />
        </Grid>

        <Grid item xs={12} lg={6}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TradingSignals 
                signals={signals} 
                systemStatus={systemStatus}
              />
            </Grid>
            <Grid item xs={12}>
              <RecentTrades trades={trades} />
            </Grid>
          </Grid>
        </Grid>

        {/* Row 3: Live Prices & Chart */}
        <Grid item xs={12} md={4}>
          <LivePrices prices={prices} />
        </Grid>

        <Grid item xs={12} md={8}>
          <LivePriceChart prices={prices} />
        </Grid>
      </Grid>
      
      {/* Development Debug Panel */}
      {import.meta.env.DEV && (
        <Paper sx={{ p: 2, mt: 3, backgroundColor: 'action.hover' }}>
          <Typography variant="subtitle2" gutterBottom>
            🔧 Development Debug Panel
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>System:</strong>
              </Typography>
              <Typography variant="body2">
                {systemStatus?.isInitialized ? '🟢 Online' : '🔴 Offline'}
              </Typography>
            </Grid>
            <Grid item xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Data:</strong>
              </Typography>
              <Typography variant="body2">
                {systemStatus?.services?.binanceData?.totalCandles || 0} candles
              </Typography>
            </Grid>
            <Grid item xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Signals:</strong>
              </Typography>
              <Typography variant="body2">
                {signals.length} total
              </Typography>
            </Grid>
            <Grid item xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Trades:</strong>
              </Typography>
              <Typography variant="body2">
                {trades.length} total
              </Typography>
            </Grid>
            <Grid item xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Prices:</strong>
              </Typography>
              <Typography variant="body2">
                {Object.keys(prices).length} assets
              </Typography>
            </Grid>
            <Grid item xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Progress:</strong>
              </Typography>
              <Typography variant="body2">
                {dataStatus ? `${dataStatus.progress.toFixed(1)}%` : 'N/A'}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      )}
    </Container>
  );
};

export default TradingDashboard;