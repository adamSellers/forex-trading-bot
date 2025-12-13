// frontend/src/components/TradingDashboard.jsx - FINAL LINT FIX
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Container, Grid, Paper, Typography, Button, Chip,
  FormControl, Select, MenuItem, IconButton, Box,
  Card, CardContent, Stack, Avatar, LinearProgress,
  useTheme, alpha, Tooltip, Alert // <--- ADDED ALERT
} from '@mui/material';
import {
  PlayArrow, Stop, Refresh,
  Psychology, MonetizationOn,
  CheckCircle, Warning,
  AccountBalanceWallet, History, Bolt,
  ShowChart, Timeline
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import { SOCKET_URL, tradingAPI } from '../config/api';

// Sub-components
import CurrentHoldings from './CurrentHoldings';
import LivePrices from './LivePrices';
import TradingSignals from './TradingSignals';
import RecentTrades from './RecentTrades';
import LivePriceChart from './LivePriceChart';

// --- CONSTANTS ---
const FETCH_LIMITS = { TRADES: 25, SIGNALS: 50 };

const TradingDashboard = () => {
  const theme = useTheme();
  
  // --- STATE ---
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

  const socketRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; if (socketRef.current) socketRef.current.disconnect(); };
  }, []);

  // --- LOGIC: Signal Merging ---
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

  // --- LOGIC: Data Fetching ---
  const fetchInitialData = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      setLoading(true);
      setError(null);
      
      const [statusData, portfolioData, tradesData, signalsData, pricesData, accountData] = await Promise.allSettled([
          tradingAPI.getStatus(),
          tradingAPI.getPortfolio(),
          tradingAPI.getTrades({ limit: FETCH_LIMITS.TRADES }),
          tradingAPI.getSignals({ limit: FETCH_LIMITS.SIGNALS }),
          tradingAPI.getPrices(),
          tradingAPI.getAccount()
      ]);

      if (!isMountedRef.current) return;

      if (statusData.status === 'fulfilled') {
          setSystemStatus(statusData.value);
          setTradingEnabled(statusData.value.config?.enableTrading || false);
          setSelectedStrategy(statusData.value.config?.strategy || 'balanced');
      }
      if (signalsData.status === 'fulfilled' && signalsData.value?.signals) updateSignalState(signalsData.value.signals);
      if (portfolioData.status === 'fulfilled') setPortfolio(portfolioData.value);
      if (tradesData.status === 'fulfilled' && Array.isArray(tradesData.value.trades || tradesData.value)) setTrades(tradesData.value.trades || tradesData.value);
      if (pricesData.status === 'fulfilled' && pricesData.value?.prices) setPrices(pricesData.value.prices);
      if (accountData.status === 'fulfilled') setAccount(accountData.value);

      setLoading(false);
      setLastUpdate(Date.now());
    } catch (err) {
      if (isMountedRef.current) {
          console.error(err);
          setError(`Data Sync Error: ${err.message}`);
          setLoading(false);
      }
    }
  }, [updateSignalState]);

  // --- LOGIC: Websockets ---
  useEffect(() => {
    const socketUrl = SOCKET_URL || window.location.origin;
    socketRef.current = io(socketUrl, { transports: ['websocket', 'polling'], upgrade: true, reconnection: true });
    const socket = socketRef.current;

    socket.on('connect', () => { if (isMountedRef.current) { setConnectionStatus('connected'); setError(null); fetchInitialData(); } });
    socket.on('disconnect', () => { if (isMountedRef.current) setConnectionStatus('disconnected'); });
    socket.on('connect_error', () => { if (isMountedRef.current) setConnectionStatus('error'); });
    
    socket.on('systemStatus', (s) => isMountedRef.current && setSystemStatus(s));
    socket.on('portfolioUpdated', (d) => { if(isMountedRef.current) { setPortfolio(d); setLastUpdate(Date.now()); }});
    socket.on('priceUpdate', (d) => { if(isMountedRef.current) { setPrices(p => ({ ...p, [d.symbol]: d })); }});
    socket.on('signalGenerated', (d) => { if(isMountedRef.current) { updateSignalState(d); setLastUpdate(Date.now()); }});
    socket.on('tradeExecuted', (t) => { if(isMountedRef.current) { setTrades(prev => [t, ...prev].slice(0, FETCH_LIMITS.TRADES)); setLastUpdate(Date.now()); }});

    return () => socket.disconnect();
  }, [fetchInitialData, updateSignalState]);

  // --- HANDLERS ---
  const handleToggleTrading = async () => {
    try {
      tradingEnabled ? await tradingAPI.stopTrading() : await tradingAPI.startTrading();
      setTradingEnabled(!tradingEnabled);
    } catch (err) { setError(err.message); fetchInitialData(); }
  };

  const handleStrategyChange = async (e) => {
      const s = e.target.value;
      setSelectedStrategy(s);
      try { await tradingAPI.updateConfig({ strategy: s }); }
      catch (err) { setError(err.message); }
  };

  // --- DERIVED DATA ---
  const signalsToRender = useMemo(() => Array.from(latestSignals.values()).sort((a, b) => b.timestamp - a.timestamp), [latestSignals]);
  const isLiveMode = systemStatus?.config?.tradingMode === 'live';
  const activeChartAssets = useMemo(() => {
    if (!systemStatus?.config) return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    const { assets = [], allocation = {} } = systemStatus.config;
    return Object.keys(allocation).length === 0 ? assets : assets.filter(s => (allocation[s] || 0) > 0);
  }, [systemStatus]);

  // --- RENDER HELPERS ---
  
  const StatCard = ({ title, value, subValue, icon, color }) => (
    <Card elevation={0} sx={{ 
        bgcolor: alpha(theme.palette.background.paper, 0.6), 
        backdropFilter: 'blur(10px)',
        border: 1, borderColor: 'divider', height: '100%'
    }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Box>
                    <Typography variant="body2" color="text.secondary" fontWeight="bold" sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {title}
                    </Typography>
                    <Typography variant="h5" fontWeight="bold">
                        {value}
                    </Typography>
                    {subValue && (
                        <Typography variant="caption" sx={{ color: subValue.includes('+') ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                            {subValue}
                        </Typography>
                    )}
                </Box>
                <Avatar variant="rounded" sx={{ bgcolor: alpha(color, 0.1), color: color }}>
                    {icon}
                </Avatar>
            </Box>
        </CardContent>
    </Card>
  );

  if (loading && !systemStatus) return <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center"><LinearProgress sx={{ width: 300 }} /></Box>;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
        
        {/* --- SECTION 1: HUD HEADER --- */}
        <Box display="flex" flexWrap="wrap" justifyContent="space-between" alignItems="center" mb={3} gap={2}>
            <Box display="flex" alignItems="center" gap={2}>
                <Avatar sx={{ bgcolor: isLiveMode ? 'error.main' : 'warning.main', width: 48, height: 48 }}>
                    {isLiveMode ? <MonetizationOn /> : <Psychology />}
                </Avatar>
                <Box>
                    <Typography variant="h5" fontWeight="900" sx={{ letterSpacing: -0.5 }}>
                        CRYPTO<span style={{ color: theme.palette.primary.main }}>TREND</span>
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Chip 
                            label={isLiveMode ? "LIVE NET" : "PAPER NET"} 
                            size="small" 
                            color={isLiveMode ? "error" : "warning"} 
                            variant="filled"
                            sx={{ fontWeight: 'bold', height: 20, fontSize: '0.65rem' }}
                        />
                        <Chip 
                            label={connectionStatus.toUpperCase()} 
                            size="small" 
                            color={connectionStatus === 'connected' ? 'success' : 'error'} 
                            variant="outlined"
                            icon={connectionStatus === 'connected' ? <CheckCircle sx={{ fontSize: '12px !important' }} /> : <Warning />}
                            sx={{ height: 20, fontSize: '0.65rem' }}
                        />
                    </Stack>
                </Box>
            </Box>

            <Stack direction="row" spacing={2} alignItems="center">
                 {/* Last Update Indicator */}
                 <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
                     Synced: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '---'}
                 </Typography>

                 {/* Refresh */}
                 <Tooltip title="Reset Engine State">
                    <IconButton size="small" color="warning" onClick={fetchInitialData}>
                        <Refresh />
                    </IconButton>
                 </Tooltip>
                 
                 {/* Strategy Select */}
                 <FormControl size="small" sx={{ minWidth: 160 }}>
                    <Select 
                        value={selectedStrategy} 
                        onChange={handleStrategyChange} 
                        displayEmpty
                        disabled={tradingEnabled}
                        sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
                    >
                        <MenuItem value="conservative">🛡️ Conservative</MenuItem>
                        <MenuItem value="balanced">⚖️ Balanced</MenuItem>
                        <MenuItem value="responsive">⚡ Responsive</MenuItem>
                    </Select>
                 </FormControl>

                 {/* MASTER SWITCH */}
                 <Button
                    variant={tradingEnabled ? "contained" : "contained"}
                    color={tradingEnabled ? "error" : "success"}
                    onClick={handleToggleTrading}
                    startIcon={tradingEnabled ? <Stop /> : <PlayArrow />}
                    sx={{ 
                        borderRadius: 2, 
                        px: 4, py: 1, 
                        fontWeight: 'bold',
                        boxShadow: tradingEnabled ? '0 0 15px rgba(244, 67, 54, 0.4)' : '0 0 15px rgba(102, 187, 106, 0.4)'
                    }}
                 >
                    {tradingEnabled ? "STOP ENGINE" : "START ENGINE"}
                 </Button>
            </Stack>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        {/* --- SECTION 2: KEY METRICS --- */}
        <Grid container spacing={2} mb={3}>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="Total Balance" 
                    value={`$${(portfolio?.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    subValue={`${(portfolio?.usdtBalance || 0).toFixed(2)} USDT Free`}
                    icon={<AccountBalanceWallet />}
                    color={theme.palette.primary.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="24h Profit/Loss" 
                    value={`$${(portfolio?.dailyPnL || 0).toFixed(2)}`}
                    subValue={portfolio?.dailyPnL > 0 ? "+2.4%" : "0.0%"} 
                    icon={<ShowChart />}
                    color={portfolio?.dailyPnL >= 0 ? theme.palette.success.main : theme.palette.error.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="Active Trades" 
                    value={portfolio?.positions?.length || 0}
                    subValue="Open Positions"
                    icon={<Bolt />}
                    color={theme.palette.warning.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="Total Trades" 
                    value={portfolio?.performance?.totalTrades || 0}
                    subValue={`Win Rate: ${(portfolio?.performance?.winRate || 0).toFixed(1)}%`}
                    icon={<History />}
                    color={theme.palette.info.main}
                />
            </Grid>
        </Grid>

        {/* --- SECTION 3: MAIN STAGE (Chart + Live Prices) --- */}
        <Grid container spacing={3} mb={3}>
            {/* Main Chart */}
            <Grid item xs={12} lg={8}>
                <Paper variant="outlined" sx={{ p: 2, height: '500px', display: 'flex', flexDirection: 'column' }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Box display="flex" alignItems="center" gap={1}>
                            <Timeline color="primary" />
                            <Typography variant="h6" fontWeight="bold">Market Analysis</Typography>
                        </Box>
                    </Box>
                    <Box flexGrow={1} sx={{ bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 1, overflow: 'hidden' }}>
                        <LivePriceChart prices={prices} assets={activeChartAssets} height="100%" />
                    </Box>
                </Paper>
            </Grid>

            {/* Watchlist / Live Ticker */}
            <Grid item xs={12} lg={4}>
                <Paper variant="outlined" sx={{ p: 0, height: '500px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <LivePrices prices={prices} assets={activeChartAssets} />
                </Paper>
            </Grid>
        </Grid>

        {/* --- SECTION 4: OPERATIONS (Holdings + Activity) --- */}
        <Grid container spacing={3}>
            
            {/* Left Col: Holdings */}
            <Grid item xs={12} md={6}>
                 <CurrentHoldings 
                    account={account} 
                    prices={prices} 
                    portfolio={portfolio} 
                    systemStatus={systemStatus} 
                 />
            </Grid>

            {/* Right Col: Activity Log */}
            <Grid item xs={12} md={6}>
                <Stack spacing={3}>
                    {/* Signals Feed */}
                    <Paper variant="outlined" sx={{ p: 0, maxHeight: 300, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                         <Box p={2} borderBottom={1} borderColor="divider" bgcolor={alpha(theme.palette.primary.main, 0.05)}>
                            <Typography variant="subtitle2" fontWeight="bold" color="primary">AI SIGNAL DETECTION</Typography>
                         </Box>
                         <Box flexGrow={1} sx={{ overflowY: 'auto' }}>
                            <TradingSignals signals={signalsToRender} systemStatus={systemStatus} compact />
                         </Box>
                    </Paper>

                    {/* Execution Feed */}
                    <Paper variant="outlined" sx={{ p: 0, maxHeight: 300, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                         <Box p={2} borderBottom={1} borderColor="divider" bgcolor={alpha(theme.palette.secondary.main, 0.05)}>
                            <Typography variant="subtitle2" fontWeight="bold" color="secondary">EXECUTION HISTORY</Typography>
                         </Box>
                         <Box flexGrow={1} sx={{ overflowY: 'auto' }}>
                            <RecentTrades trades={trades} />
                         </Box>
                    </Paper>
                </Stack>
            </Grid>

        </Grid>
    </Container>
  );
};

export default TradingDashboard;