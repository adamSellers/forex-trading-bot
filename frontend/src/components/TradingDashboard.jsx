// frontend/src/components/TradingDashboard.jsx - FIXED & RESTORED
import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Tooltip,
  Divider,
  Box
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

const TradingDashboard = () => {
  // State management
  const [systemStatus, setSystemStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  const [latestSignals, setLatestSignals] = useState(new Map());
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('balanced');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

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
                if (!existing || new Date(signal.timestamp) > new Date(existing.timestamp)) {
                    newMap.set(signal.symbol, signal);
                    hasUpdates = true;
                }
            }
        });
        return hasUpdates ? newMap : prevMap;
    });
  }, []);

  // API data fetching
  const fetchInitialData = useCallback(async () => {
    try {
      console.log('🔄 Fetching initial trading data...');
      setLoading(true);
      
      const [statusData, portfolioData, tradesData, signalsData, pricesData, accountData] = await Promise.allSettled([
          tradingAPI.getStatus(),
          tradingAPI.getPortfolio(),
          tradingAPI.getTrades({ limit: 25 }),
          tradingAPI.getSignals({ limit: 50 }),
          tradingAPI.getPrices(),
          tradingAPI.getAccount()
      ]);

      if (statusData.status === 'fulfilled') {
          setSystemStatus(statusData.value);
          setTradingEnabled(statusData.value.config?.enableTrading || false);
          setSelectedStrategy(statusData.value.config?.strategy || 'balanced');
      }

      if (signalsData.status === 'fulfilled' && signalsData.value?.signals) {
          updateSignalState(signalsData.value.signals);
      }

      if (portfolioData.status === 'fulfilled') setPortfolio(portfolioData.value);

      if (tradesData.status === 'fulfilled') {
          const t = tradesData.value.trades || tradesData.value;
          if (Array.isArray(t)) setTrades(t);
      }

      if (pricesData.status === 'fulfilled' && pricesData.value?.prices) {
          setPrices(pricesData.value.prices);
      }

      if (accountData.status === 'fulfilled') setAccount(accountData.value);

      setError(null);
      setLoading(false);
      setLastUpdate(Date.now());

    } catch (err) {
      console.error('❌ Critical error in fetchInitialData:', err);
      setError(`Failed to load trading data: ${err.message}`);
      setLoading(false);
    }
  }, [updateSignalState]);

  // Socket connection
  useEffect(() => {
    const socketUrl = SOCKET_URL || window.location.origin;
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
    });

    socket.on('connect', () => {
      console.log('🔌 Connected');
      setConnectionStatus('connected');
      setError(null);
      fetchInitialData();
    });

    socket.on('disconnect', () => setConnectionStatus('disconnected'));
    socket.on('connect_error', (err) => {
        setConnectionStatus('error');
        // Don't flood UI with connection errors, log them
        console.warn('Socket connection error:', err);
    });
    
    socket.on('systemStatus', (status) => {
      setSystemStatus(status);
      setLastUpdate(Date.now());
    });

    socket.on('portfolioUpdated', (data) => {
        setPortfolio(data);
        setLastUpdate(Date.now());
    });

    socket.on('priceUpdate', (data) => {
        setPrices(prev => ({ ...prev, [data.symbol]: data }));
    });

    socket.on('signalGenerated', (data) => {
        updateSignalState(data);
        setLastUpdate(Date.now());
    });

    socket.on('allSignalsGenerated', (data) => {
        updateSignalState(data);
        setLastUpdate(Date.now());
    });

    socket.on('tradeExecuted', (trade) => {
        setTrades(prev => {
            if (prev.some(t => t.id === trade.id)) return prev;
            return [trade, ...prev].slice(0, 50);
        });
        setLastUpdate(Date.now());
    });

    return () => socket.disconnect();
  }, [fetchInitialData, updateSignalState]);

  // Controls
  const handleToggleTrading = async () => {
    try {
      if (tradingEnabled) await tradingAPI.stopTrading();
      else await tradingAPI.startTrading();
      setError(null);
    } catch (err) {
      setError(`Failed to toggle trading: ${err.message}`);
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
      } catch (err) {
          setError(`Failed to update strategy: ${err.message}`);
      }
  };

  // Derived State
  const signalsToRender = useMemo(() => {
      return Array.from(latestSignals.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [latestSignals]);

  const systemHealth = useMemo(() => {
      if (!systemStatus?.isInitialized) return { status: 'Offline', color: 'error', icon: <Timeline /> };
      if (connectionStatus !== 'connected') return { status: 'Reconnecting', color: 'warning', icon: <DataUsage /> };
      return { status: 'Optimal', color: 'success', icon: <CheckCircle /> };
  }, [systemStatus, connectionStatus]);

  const isLiveMode = systemStatus?.config?.tradingMode === 'live';

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <Box textAlign="center">
            <DataUsage sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h5">Initializing Dashboard...</Typography>
          </Box>
        </Box>
      </Container>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box mb={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>Crypto Trend Bot</Typography>
            <Box display="flex" gap={1} alignItems="center">
                <Chip label={isLiveMode ? "LIVE MODE" : "PAPER MODE"} color={isLiveMode ? "error" : "warning"} icon={isLiveMode ? <MonetizationOn /> : <Psychology />} />
                <Chip label={`System: ${systemHealth.status}`} color={systemHealth.color} icon={systemHealth.icon} />
                {lastUpdate && <Chip label={`Updated: ${new Date(lastUpdate).toLocaleTimeString()}`} variant="outlined" size="small" />}
                <Chip label={`Conn: ${connectionStatus}`} variant="outlined" size="small" color={connectionStatus === 'connected' ? 'default' : 'error'} />
            </Box>
          </Box>
          <Box>
            <IconButton color="primary"><Assessment /></IconButton>
            <IconButton color="primary"><Settings /></IconButton>
          </Box>
        </Box>

        {/* Live Trading Warning */}
        {isLiveMode && (
            <Alert severity="error" sx={{ mb: 2 }}>
                ⚠️ LIVE TRADING ACTIVE - Real funds are at risk.
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
              >
                {tradingEnabled ? "Stop Trading" : "Start Trading"}
              </Button>
            </Grid>
            
            <Grid item>
              <Button variant="outlined" startIcon={<Refresh />} onClick={fetchInitialData}>
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
                    <Select value={selectedStrategy} label="Strategy" onChange={handleStrategyChange}>
                        <MenuItem value="conservative">Conservative (SMA)</MenuItem>
                        <MenuItem value="balanced">Balanced (EMA)</MenuItem>
                        <MenuItem value="responsive">Responsive (EMA)</MenuItem>
                    </Select>
                </FormControl>
            </Grid>

            <Grid item sx={{ ml: 'auto' }}>
                <Typography variant="caption" color="textSecondary">
                    Signals: {signalsToRender.length} • Trades: {trades.length}
                </Typography>
            </Grid>
          </Grid>
        </Paper>
      </Box>

      {/* Main Grid */}
      <Box display="grid" gap={3} gridTemplateColumns="repeat(12, 1fr)">
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 6' } }}>
          <PortfolioOverview account={account} prices={prices} portfolio={portfolio} systemStatus={systemStatus} />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 6' } }}>
          <CurrentHoldings account={account} prices={prices} portfolio={portfolio} systemStatus={systemStatus} />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 8' } }}>
          <LivePriceChart prices={prices} />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 4' } }}>
          <LivePrices prices={prices} />
        </Box>
        
        {/* Signals & Trades */}
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