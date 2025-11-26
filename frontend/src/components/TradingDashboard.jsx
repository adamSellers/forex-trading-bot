// frontend/src/components/TradingDashboard.jsx - Refactored for Stability and Performance
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Container,
  Alert,
  Grid,
  Paper,
  Typography,
  Button,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Box,
  CircularProgress
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Refresh,
  Settings,
  Timeline,
  Assessment,
  Psychology,
  MonetizationOn,
  DataUsage,
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

// Constants for data fetching limits
const FETCH_LIMITS = {
  TRADES: 25,
  SIGNALS: 50
};

const TradingDashboard = () => {
  // --- State Management ---
  const [systemStatus, setSystemStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  // Using Map for efficient signal updates by symbol
  const [latestSignals, setLatestSignals] = useState(new Map());
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('balanced');
  
  // UI State
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  // Refs for cleanup and socket management
  const socketRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  // --- Helpers ---

  // Helper: Unified Signal State Updater
  const updateSignalState = useCallback((newSignals) => {
    if (!newSignals) return;
    const signalArray = Array.isArray(newSignals) ? newSignals : [newSignals];

    setLatestSignals(prevMap => {
        const newMap = new Map(prevMap);
        let hasUpdates = false;

        signalArray.forEach(signal => {
            if (signal && signal.symbol) {
                const existing = newMap.get(signal.symbol);
                // Update if it's a new symbol OR the timestamp is newer
                if (!existing || new Date(signal.timestamp) > new Date(existing.timestamp)) {
                    newMap.set(signal.symbol, signal);
                    hasUpdates = true;
                }
            }
        });
        return hasUpdates ? newMap : prevMap;
    });
  }, []);

  // --- Data Fetching ---

  const fetchInitialData = useCallback(async () => {
    if (!isMountedRef.current) return;
    
    try {
      console.log('🔄 Fetching initial trading data...');
      setLoading(true);
      setError(null); // Clear previous errors on retry
      
      const [statusData, portfolioData, tradesData, signalsData, pricesData, accountData] = await Promise.allSettled([
          tradingAPI.getStatus(),
          tradingAPI.getPortfolio(),
          tradingAPI.getTrades({ limit: FETCH_LIMITS.TRADES }),
          tradingAPI.getSignals({ limit: FETCH_LIMITS.SIGNALS }),
          tradingAPI.getPrices(),
          tradingAPI.getAccount()
      ]);

      if (!isMountedRef.current) return;

      // Process Status
      if (statusData.status === 'fulfilled') {
          setSystemStatus(statusData.value);
          setTradingEnabled(statusData.value.config?.enableTrading || false);
          setSelectedStrategy(statusData.value.config?.strategy || 'balanced');
      } else {
          console.warn('Failed to fetch status:', statusData.reason);
      }

      // Process Signals
      if (signalsData.status === 'fulfilled' && signalsData.value?.signals) {
          updateSignalState(signalsData.value.signals);
      }

      // Process Portfolio
      if (portfolioData.status === 'fulfilled') setPortfolio(portfolioData.value);

      // Process Trades
      if (tradesData.status === 'fulfilled') {
          const t = tradesData.value.trades || tradesData.value;
          if (Array.isArray(t)) setTrades(t);
      }

      // Process Prices
      if (pricesData.status === 'fulfilled' && pricesData.value?.prices) {
          setPrices(pricesData.value.prices);
      }

      // Process Account
      if (accountData.status === 'fulfilled') setAccount(accountData.value);

      setLoading(false);
      setLastUpdate(Date.now());

    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('❌ Critical error in fetchInitialData:', err);
      setError(`Failed to load trading data: ${err.message}`);
      setLoading(false);
    }
  }, [updateSignalState]);

  // --- WebSocket Management ---

  useEffect(() => {
    const socketUrl = SOCKET_URL || window.location.origin;
    
    // Initialize Socket
    socketRef.current = io(socketUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('🔌 Connected to Trading Server');
      if (isMountedRef.current) {
        setConnectionStatus('connected');
        setError(null);
        // Fetch fresh data on connect/reconnect to ensure sync
        fetchInitialData();
      }
    });

    socket.on('disconnect', (reason) => {
      console.warn('🔌 Disconnected:', reason);
      if (isMountedRef.current) setConnectionStatus('disconnected');
    });

    socket.on('connect_error', (err) => {
        if (isMountedRef.current) {
            setConnectionStatus('error');
            // Only log if it's a persistent issue to avoid console spam
            console.warn('Socket connection error:', err.message);
        }
    });
    
    // -- Real-time Event Listeners --

    socket.on('systemStatus', (status) => {
      if (isMountedRef.current) {
        setSystemStatus(status);
        setLastUpdate(Date.now());
      }
    });

    socket.on('portfolioUpdated', (data) => {
        if (isMountedRef.current) {
            setPortfolio(data);
            setLastUpdate(Date.now());
        }
    });

    socket.on('priceUpdate', (data) => {
        if (isMountedRef.current) {
            setPrices(prev => ({ ...prev, [data.symbol]: data }));
        }
    });

    socket.on('signalGenerated', (data) => {
        if (isMountedRef.current) {
            updateSignalState(data);
            setLastUpdate(Date.now());
        }
    });

    socket.on('allSignalsGenerated', (data) => {
        if (isMountedRef.current) {
            updateSignalState(data);
            setLastUpdate(Date.now());
        }
    });

    socket.on('tradeExecuted', (trade) => {
        if (isMountedRef.current) {
            setTrades(prev => {
                // Prevent duplicate trades
                if (prev.some(t => t.id === trade.id)) return prev;
                return [trade, ...prev].slice(0, FETCH_LIMITS.TRADES);
            });
            setLastUpdate(Date.now());
        }
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, [fetchInitialData, updateSignalState]);

  // --- Handlers ---

  const handleToggleTrading = async () => {
    try {
      if (tradingEnabled) await tradingAPI.stopTrading();
      else await tradingAPI.startTrading();
      setError(null);
      // Optimistic update or wait for socket? 
      // Socket 'systemStatus' will update the UI, but we can optimistically toggle for responsiveness
      setTradingEnabled(!tradingEnabled); 
    } catch (err) {
      setError(`Failed to toggle trading: ${err.message}`);
      // Revert state if failed (if we implemented optimistic update)
      fetchInitialData(); 
    }
  };

  const handleResetTrading = async () => {
    if (!window.confirm("Are you sure you want to reset the engine? PnL will be cleared.")) return;
    try {
      await tradingAPI.resetTrading();
      setLatestSignals(new Map());
      setTrades([]);
      fetchInitialData();
    } catch (err) {
      setError(`Failed to reset: ${err.message}`);
    }
  };

  const handleStrategyChange = async (event) => {
      const newStrategy = event.target.value;
      setSelectedStrategy(newStrategy);
      try {
          await tradingAPI.updateConfig({ strategy: newStrategy });
          // No need to manually refetch, config update should trigger systemStatus update via socket
      } catch (err) {
          setError(`Failed to update strategy: ${err.message}`);
          // Revert UI if failed
          setSelectedStrategy(systemStatus?.config?.strategy || 'balanced');
      }
  };

  // --- Derived State & Rendering Helpers ---

  const signalsToRender = useMemo(() => {
      return Array.from(latestSignals.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [latestSignals]);

  const systemHealth = useMemo(() => {
      if (!systemStatus?.isInitialized) return { status: 'Offline', color: 'error', icon: <Timeline /> };
      if (connectionStatus === 'connecting') return { status: 'Connecting', color: 'warning', icon: <DataUsage /> };
      if (connectionStatus === 'disconnected') return { status: 'Disconnected', color: 'error', icon: <Warning /> };
      if (connectionStatus === 'error') return { status: 'Connection Error', color: 'error', icon: <Warning /> };
      return { status: 'Optimal', color: 'success', icon: <CheckCircle /> };
  }, [systemStatus, connectionStatus]);

  const isLiveMode = systemStatus?.config?.tradingMode === 'live';

  // --- Render ---

  if (loading && !systemStatus) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <Box textAlign="center">
            <DataUsage sx={{ fontSize: 64, color: 'primary.main', mb: 2, animation: 'spin 2s linear infinite' }} />
            <Typography variant="h5">Initializing Dashboard...</Typography>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <Box>
      {/* Header & Controls */}
      <Box mb={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>Crypto Trend Bot</Typography>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                <Chip 
                    label={isLiveMode ? "LIVE MODE" : "PAPER MODE"} 
                    color={isLiveMode ? "error" : "warning"} 
                    icon={isLiveMode ? <MonetizationOn /> : <Psychology />} 
                />
                <Chip 
                    label={`System: ${systemHealth.status}`} 
                    color={systemHealth.color} 
                    icon={systemHealth.icon} 
                />
                {lastUpdate && (
                    <Chip 
                        label={`Updated: ${new Date(lastUpdate).toLocaleTimeString()}`} 
                        variant="outlined" 
                        size="small" 
                    />
                )}
                <Chip 
                    label={`Socket: ${connectionStatus}`} 
                    variant="outlined" 
                    size="small" 
                    color={connectionStatus === 'connected' ? 'default' : 'error'} 
                />
            </Box>
          </Box>
          <Box>
            <IconButton color="primary" title="Analytics"><Assessment /></IconButton>
            <IconButton color="primary" title="Settings"><Settings /></IconButton>
          </Box>
        </Box>

        {/* Live Trading Warning */}
        {isLiveMode && (
            <Alert severity="error" sx={{ mb: 2 }} icon={<Warning fontSize="inherit" />}>
                ⚠️ <strong>LIVE TRADING ACTIVE</strong> - Real funds are at risk. Ensure your strategy is tested.
            </Alert>
        )}

        {/* System Status Banner */}
        <SystemStatusBanner systemStatus={systemStatus} signals={signalsToRender} />

        {/* Error Display */}
        {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
            </Alert>
        )}

        {/* Control Panel */}
        <Paper sx={{ p: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item>
              <Button
                variant={tradingEnabled ? "contained" : "outlined"}
                color={tradingEnabled ? "error" : "success"}
                startIcon={tradingEnabled ? <Stop /> : <PlayArrow />}
                onClick={handleToggleTrading}
                disabled={connectionStatus !== 'connected'}
              >
                {tradingEnabled ? "Stop Trading" : "Start Trading"}
              </Button>
            </Grid>
            
            <Grid item>
              <Button 
                variant="outlined" 
                startIcon={<Refresh />} 
                onClick={fetchInitialData}
                disabled={loading}
              >
                Refresh
              </Button>
            </Grid>

            <Grid item>
                <Button variant="outlined" color="warning" onClick={handleResetTrading}>
                    Reset Engine
                </Button>
            </Grid>

            <Grid item>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Strategy</InputLabel>
                    <Select 
                        value={selectedStrategy} 
                        label="Strategy" 
                        onChange={handleStrategyChange}
                        disabled={tradingEnabled} // Prevent strategy change while running? Optional.
                    >
                        <MenuItem value="conservative">Conservative (SMA)</MenuItem>
                        <MenuItem value="balanced">Balanced (EMA)</MenuItem>
                        <MenuItem value="responsive">Responsive (EMA)</MenuItem>
                    </Select>
                </FormControl>
            </Grid>

            <Grid item sx={{ ml: 'auto', display: { xs: 'none', md: 'block' } }}>
                <Typography variant="caption" color="textSecondary">
                    Active Signals: {signalsToRender.length} • Trades: {trades.length}
                </Typography>
            </Grid>
          </Grid>
        </Paper>
      </Box>

      {/* Main Dashboard Grid */}
      <Box display="grid" gap={3} gridTemplateColumns="repeat(12, 1fr)">
        {/* Row 1: Portfolio & Holdings */}
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 6' } }}>
          <PortfolioOverview account={account} prices={prices} portfolio={portfolio} systemStatus={systemStatus} />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 6' } }}>
          <CurrentHoldings account={account} prices={prices} portfolio={portfolio} systemStatus={systemStatus} />
        </Box>
        
        {/* Row 2: Charts & Live Prices */}
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 8' } }}>
          <LivePriceChart prices={prices} />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 4' } }}>
          <LivePrices prices={prices} />
        </Box>
        
        {/* Row 3: Signals & Recent Trades */}
        <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6' } }}>
            <TradingSignals signals={signalsToRender} systemStatus={systemStatus} />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6' } }}>
            <RecentTrades trades={trades} />
        </Box>
      </Box>
    </Box>
  );
};

export default TradingDashboard;