// frontend/src/components/TradingDashboard.jsx - ENHANCED with Clear Status Indicators
import React, { useState, useEffect, useMemo } from 'react';
import {
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
  Tooltip,
  Divider,
  Stack
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Refresh,
  Settings,
  Timeline,
  TrendingUp,
  Assessment,
  Psychology,
  AccountBalance,
  DataUsage,
  Security,
  CheckCircle,
  Warning
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import { SOCKET_URL, tradingAPI } from '../config/api';

// Import components
import PortfolioOverview from './PortfolioOverview';
import CurrentHoldings from './CurrentHoldings';
import LivePrices from './LivePrices';
import TradingSignals from './TradingSignals';
import RecentTrades from './RecentTrades';
import LivePriceChart from './LivePriceChart';
import SystemStatusBanner from './SystemStatusBanner';
import { Box } from '@mui/material';

const TradingDashboard = () => {
  // State management
  const [systemStatus, setSystemStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  // FIX: Use a Map to store only the latest signal for each symbol
  const [latestSignals, setLatestSignals] = useState(new Map());
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('balanced');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  // Socket connection with fixed URL
  useEffect(() => {
    // Helper function to correctly update the signals map state
    const updateSignalState = (signals) => {
        if (!Array.isArray(signals)) return;

        setLatestSignals(prevMap => {
            const newMap = new Map(prevMap);
            signals.forEach(signal => {
                if (signal && signal.symbol) {
                    // Only update if the new signal is more recent
                    const existing = newMap.get(signal.symbol);
                    if (!existing || new Date(signal.timestamp) >= new Date(existing.timestamp)) {
                        newMap.set(signal.symbol, signal);
                    }
                }
            });
            return newMap;
        });
    };

    const socketUrl = SOCKET_URL || window.location.origin;
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
      setConnectionStatus('connected');
      setError(null);
      fetchInitialData();
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Disconnected from trading server:', reason);
      setConnectionStatus('disconnected');
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('connect_error', (error) => {
      console.error('🔌 Connection error:', error);
      setConnectionStatus('error');
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

    socket.on('signalGenerated', (data) => {
      console.log('🚨 Single signal received:', data?.symbol, data?.signal);
      updateSignalState([data]); // Process as an array of one
      setLastUpdate(Date.now());
    });

    socket.on('allSignalsGenerated', (signalsArray) => {
      console.log('🚨 Batch signals received:', signalsArray?.length);
      updateSignalState(signalsArray);
      setLastUpdate(Date.now());
    });

    socket.on('tradeExecuted', (trade) => {
      console.log('💰 Trade executed:', trade.symbol, trade.side);
      // FIX: Prevent duplicate trades from being added to the list.
      // This handles race conditions between the initial API fetch and WebSocket updates.
      setTrades(prevTrades => {
        const tradeExists = prevTrades.some(t => t.id === trade.id);
        if (tradeExists) {
          return prevTrades; // Do not add the duplicate
        }
        return [trade, ...prevTrades].slice(0, 50);
      });
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
      setLatestSignals(new Map());
      setTrades([]);
      fetchInitialData();
    });

    return () => {
      console.log('🔌 Closing socket connection');
      socket.disconnect();
    };
  }, []);

  // API data fetching using the new API helpers
  const fetchInitialData = async () => {
    // Helper function to correctly update the signals map state from fetched data
    const updateSignalState = (signals) => {
        if (!Array.isArray(signals)) return;

        setLatestSignals(prevMap => {
            const newMap = new Map(prevMap);
            signals.forEach(signal => {
                if (signal && signal.symbol) {
                    // Only update if the new signal is more recent
                    const existing = newMap.get(signal.symbol);
                    if (!existing || new Date(signal.timestamp) >= new Date(existing.timestamp)) {
                        newMap.set(signal.symbol, signal);
                    }
                }
            });
            return newMap;
        });
    };

    try {
      console.log('🔄 Fetching initial trading data...');
      setLoading(true);
      
      const results = {};
      const errors = [];

      // Fetch all endpoints using the new API helpers
      try {
        results.status = await tradingAPI.getStatus();
        console.log('✅ Status loaded');
      } catch (err) {
        console.error('❌ Failed to fetch status:', err.message);
        errors.push(`Status: ${err.message}`);
      }

      try {
        results.portfolio = await tradingAPI.getPortfolio();
        console.log('✅ Portfolio loaded');
      } catch (err) {
        console.error('❌ Failed to fetch portfolio:', err.message);
        errors.push(`Portfolio: ${err.message}`);
      }

      try {
        results.trades = await tradingAPI.getTrades({ limit: 25 });
        console.log('✅ Trades loaded');
      } catch (err) {
        console.error('❌ Failed to fetch trades:', err.message);
        errors.push(`Trades: ${err.message}`);
      }

      try {
        results.signals = await tradingAPI.getSignals({ limit: 100 }); // Fetch more to find latest for each
        console.log('✅ Signals loaded');
      } catch (err) {
        console.error('❌ Failed to fetch signals:', err.message);
        errors.push(`Signals: ${err.message}`);
      }

      try {
        results.prices = await tradingAPI.getPrices();
        console.log('✅ Prices loaded');
      } catch (err) {
        console.error('❌ Failed to fetch prices:', err.message);
        errors.push(`Prices: ${err.message}`);
      }

      try {
        results.account = await tradingAPI.getAccount();
        console.log('✅ Account loaded');
      } catch (err) {
        console.error('❌ Failed to fetch account:', err.message);
        errors.push(`Account: ${err.message}`);
      }

      // Update state with results
      if (results.status) {
        setSystemStatus(results.status);
        setTradingEnabled(results.status.config?.enableTrading || false);
        setSelectedStrategy(results.status.config?.strategy || 'balanced');
      }
      
      if (results.portfolio) setPortfolio(results.portfolio);
      // The API returns { prices: { BTCUSDT: ... }, timestamp: ... }
      // We only need the nested prices object for the state.
      if (results.prices && results.prices.prices) {
        setPrices(results.prices.prices);
      }
      if (results.account) setAccount(results.account);
      
      // Handle trades data structure
      if (results.trades) {
        if (results.trades.trades && Array.isArray(results.trades.trades)) {
          setTrades(results.trades.trades);
        } else if (Array.isArray(results.trades)) {
          setTrades(results.trades);
        } else {
          setTrades([]);
        }
      }

      // Handle signals data structure  
      if (results.signals) {
        if (results.signals.signals && Array.isArray(results.signals.signals)) {
          updateSignalState(results.signals.signals);
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

  // Trading controls using new API helpers
  const handleToggleTrading = async () => {
    try {
      const action = tradingEnabled ? 'Stopping' : 'Starting';
      console.log(`🔄 ${action} paper trading...`);
      
      if (tradingEnabled) {
        await tradingAPI.stopTrading();
      } else {
        await tradingAPI.startTrading();
      }
      
      console.log(`✅ Paper trading ${tradingEnabled ? 'stopped' : 'started'}`);
      setError(null);
    } catch (err) {
      console.error('❌ Toggle trading error:', err);
      setError(`Failed to ${tradingEnabled ? 'stop' : 'start'} paper trading: ${err.message}`);
    }
  };

  const handleResetTrading = async () => {
    try {
      console.log('🔄 Resetting paper trading engine...');
      await tradingAPI.resetTrading();
      console.log('✅ Paper trading reset successfully');
      setError(null);
    } catch (err) {
      console.error('❌ Reset trading error:', err);
      setError(`Failed to reset paper trading: ${err.message}`);
    }
  };

  const handleStrategyChange = async (event) => {
    const newStrategy = event.target.value;
    setSelectedStrategy(newStrategy);
    
    try {
      console.log('🔄 Updating strategy to:', newStrategy);
      await tradingAPI.updateConfig({ strategy: newStrategy });
      console.log('✅ Strategy updated');
      setError(null);
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

  // Enhanced system health calculation
  const getSystemHealth = () => {
    if (!systemStatus) return { status: 'unknown', color: 'default', icon: <Timeline /> };
    
    const isOnline = systemStatus.isInitialized;
    const hasRecentUpdate = lastUpdate && (Date.now() - lastUpdate) < 120000; // 2 minutes
    const hasData = latestSignals.size > 0 || trades.length > 0;
    const accountConnected = account && !account.error;
    
    if (isOnline && hasRecentUpdate && hasData && accountConnected) {
      return { status: 'optimal', color: 'success', icon: <CheckCircle /> };
    } else if (isOnline && hasData) {
      return { status: 'operational', color: 'info', icon: <DataUsage /> };
    } else if (isOnline) {
      return { status: 'initializing', color: 'warning', icon: <Warning /> };
    } else {
      return { status: 'offline', color: 'error', icon: <Timeline /> };
    }
  };

  // Memoize the sorted array of signals to prevent re-sorting on every render
  const signalsToRender = useMemo(() => {
      return Array.from(latestSignals.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [latestSignals]);

  const systemHealth = getSystemHealth();

  // Enhanced data building status
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

  // Enhanced system mode determination
  const getSystemMode = () => {
    const hasAccountData = account && !account.error;
    const paperTradingActive = portfolio && !portfolio.riskStatus?.isHalted;
    
    return {
      marketData: hasAccountData ? 'Live Binance API' : 'Fallback Data',
      paperTrading: paperTradingActive ? 'Active' : 'Inactive',
      realTrading: 'Safety Disabled',
      accountAccess: hasAccountData ? 'Connected' : 'Limited'
    };
  };

  const systemMode = getSystemMode();

  // Loading state
  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <Box textAlign="center">
            <DataUsage sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h5" gutterBottom>
              Initializing Trading Dashboard
            </Typography>
            <Typography variant="body1" color="textSecondary" paragraph>
              Connecting to trading services and loading market data...
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Chip label={`Connection: ${connectionStatus}`} color="primary" />
            </Box>
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <Box>
      {/* Enhanced Header Section */}
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>
              Crypto Trend Trading Bot
            </Typography>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
              <Chip
                icon={systemHealth.icon}
                label={`System ${systemHealth.status.charAt(0).toUpperCase() + systemHealth.status.slice(1)}`}
                color={systemHealth.color}
                size="small"
              />
              <Chip
                icon={<DataUsage />}
                label={systemMode.marketData}
                color={systemMode.marketData.includes('Live') ? 'success' : 'warning'}
                size="small"
                variant="outlined"
              />
              <Chip
                icon={<Psychology />}
                label={`Paper Trading: ${systemMode.paperTrading}`}
                color={systemMode.paperTrading === 'Active' ? 'warning' : 'default'}
                size="small"
                variant="outlined"
              />
              <Chip
                icon={<Security />}
                label={`Real Trading: ${systemMode.realTrading}`}
                color="error"
                size="small"
                variant="outlined"
              />
              {lastUpdate && (
                <Chip
                  label={`Updated ${new Date(lastUpdate).toLocaleTimeString()}`}
                  size="small"
                  variant="outlined"
                />
              )}
              {portfolio?.totalPnLPercent !== undefined && (
                <Chip
                  label={`${portfolio.totalPnLPercent >= 0 ? '+' : ''}${portfolio.totalPnLPercent.toFixed(1)}% Paper Return`}
                  color={portfolio.totalPnLPercent >= 0 ? 'success' : 'error'}
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
        <SystemStatusBanner systemStatus={systemStatus} signals={signalsToRender} />
        
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

        {/* Enhanced Control Panel */}
        <Paper sx={{ p: 2 }}>
          <Grid container spacing={2} alignItems="center">
            {/* Primary Controls */}
            <Grid item>
              <Button
                variant={tradingEnabled ? "contained" : "outlined"}
                color={tradingEnabled ? "error" : "warning"}
                startIcon={tradingEnabled ? <Stop /> : <PlayArrow />}
                onClick={handleToggleTrading}
                disabled={dataStatus?.isBuilding && !tradingEnabled}
                size="large"
              >
                {tradingEnabled ? 'Stop Paper Trading' : 'Start Paper Trading'}
              </Button>
            </Grid>
            
            <Grid item>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={handleRefreshData}
                disabled={loading}
              >
                Refresh Data
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
                Reset Engine
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
                  <MenuItem value="conservative">Conservative (50/200 SMA)</MenuItem>
                  <MenuItem value="balanced">Balanced (20/50 EMA)</MenuItem>
                  <MenuItem value="responsive">Responsive (12/26 EMA)</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item>
              <Divider orientation="vertical" flexItem />
            </Grid>

            {/* Enhanced Status Indicators */}
            <Grid item sx={{ ml: 'auto' }}>
              <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                <Chip
                  size="small"
                  icon={<TrendingUp />}
                  label={`${signalsToRender.length} signals`}
                  color="info"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  icon={<Psychology />}
                  label={`${trades.length} paper trades`}
                  color="warning"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  icon={<AccountBalance />}
                  label={systemMode.accountAccess}
                  color={systemMode.accountAccess === 'Connected' ? 'success' : 'warning'}
                  variant="outlined"
                />
                {dataStatus && (
                  <Chip
                    size="small"
                    icon={<DataUsage />}
                    label={dataStatus.isBuilding ? `Building Data (${dataStatus.progress.toFixed(0)}%)` : 'Data Ready'}
                    color={dataStatus.isBuilding ? 'warning' : 'success'}
                    variant="outlined"
                  />
                )}
              </Box>
            </Grid>
          </Grid>

          {/* System Mode Summary */}
          <Box mt={1} p={1} sx={{ backgroundColor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" color="textSecondary">
              🔧 <strong>System Mode:</strong> Paper Trading with {systemMode.marketData} • 
              <strong>Account:</strong> {systemMode.accountAccess} • 
              <strong>Real Trading:</strong> {systemMode.realTrading} for safety • 
              <strong>Connection:</strong> {connectionStatus} • 
              <strong>Strategy:</strong> {selectedStrategy}
            </Typography>
          </Box>
        </Paper>
      </Box>

      {/* Dashboard Grid */}
      <Grid
        container
        spacing={3}
        sx={{
          width: '100%',
          m: 0,
          '& .MuiGrid-item': {
            paddingLeft: '24px',
            paddingTop: '24px'
          }
        }}
      >
        {/* Row 1: Portfolio Overview & Holdings - 2 columns */}
        <Grid item xs={12} lg={6}>
          <PortfolioOverview
            account={account}
            prices={prices}
            portfolio={portfolio}
          />
        </Grid>

        <Grid item xs={12} lg={6}>
          <CurrentHoldings
            account={account}
            prices={prices}
            portfolio={portfolio}
          />
        </Grid>

        {/* Row 2: Live Prices & Chart - 2 columns */}
        <Grid item xs={12} lg={4}>
          <Box>
            <Typography variant="h6" gutterBottom>
              Live Market Prices
            </Typography>
            <LivePrices prices={prices} />
          </Box>
        </Grid>

        <Grid item xs={12} lg={8}>
          <LivePriceChart prices={prices} />
        </Grid>

        {/* Row 3: Trading Signals & Recent Trades - 2 columns with matching heights */}
        <Grid item xs={12} lg={6}>
          <Box sx={{ height: '600px', display: 'flex' }}>
            <TradingSignals
              signals={signalsToRender}
              systemStatus={systemStatus}
            />
          </Box>
        </Grid>

        <Grid item xs={12} lg={6}>
          <Box sx={{ height: '600px', display: 'flex' }}>
            <RecentTrades trades={trades} />
          </Box>
        </Grid>
      </Grid>
      
      {/* Development Debug Panel */}
      {import.meta.env.DEV && (
        <Paper sx={{ p: 2, mt: 3, backgroundColor: 'action.hover' }}>
          <Typography variant="subtitle2" gutterBottom>
            🔧 Development Debug Panel
          </Typography>
          <Grid container spacing={2}>
            <Grid xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>System:</strong>
              </Typography>
              <Typography variant="body2">
                {systemStatus?.isInitialized ? '🟢 Online' : '🔴 Offline'}
              </Typography>
            </Grid>
            <Grid xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Connection:</strong>
              </Typography>
              <Typography variant="body2">
                {connectionStatus}
              </Typography>
            </Grid>
            <Grid xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Data:</strong>
              </Typography>
              <Typography variant="body2">
                {systemStatus?.services?.binanceData?.totalCandles || 0} candles
              </Typography>
            </Grid>
            <Grid xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Signals:</strong>
              </Typography>
              <Typography variant="body2">
                {signalsToRender.length} total
              </Typography>
            </Grid>
            <Grid xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Paper Trading:</strong>
              </Typography>
              <Typography variant="body2">
                {tradingEnabled ? '🟢 Active' : '🔴 Inactive'}
              </Typography>
            </Grid>
            <Grid xs={6} md={2}>
              <Typography variant="caption" display="block">
                <strong>Account API:</strong>
              </Typography>
              <Typography variant="body2">
                {account?.error ? '🟡 Fallback' : '🟢 Connected'}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      )}
    </Box>
  );
};

export default TradingDashboard;