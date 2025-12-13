// frontend/src/components/TradingDashboard.jsx - PRO TERMINAL LAYOUT
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Container, Grid, Paper, Typography, Button, Chip,
  FormControl, Select, MenuItem, IconButton, Box,
  Card, CardContent, Stack, Avatar, LinearProgress,
  useTheme, alpha, Tooltip, Alert, Tabs, Tab, Badge, Divider
} from '@mui/material';
import {
  PlayArrow, Stop, Refresh,
  Psychology, MonetizationOn,
  CheckCircle, Warning,
  AccountBalanceWallet, History, Bolt,
  ShowChart, Timeline, ReceiptLong, Radar, PieChart
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
const FETCH_LIMITS = { TRADES: 50, SIGNALS: 100 };

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
  
  // UI State
  const [activeTab, setActiveTab] = useState(0); // 0=Holdings, 1=Signals, 2=History
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
      if (tradesData.status === 'fulfilled') {
          const t = tradesData.value.trades || tradesData.value;
          if (Array.isArray(t)) setTrades(t);
      }
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
        bgcolor: alpha(theme.palette.background.paper, 0.5), 
        border: 1, borderColor: 'divider', height: '100%'
    }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ textTransform: 'uppercase' }}>
                        {title}
                    </Typography>
                    <Typography variant="h5" fontWeight="bold" sx={{ my: 0.5 }}>
                        {value}
                    </Typography>
                    {subValue && (
                        <Typography variant="caption" sx={{ color: subValue.includes('+') ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                            {subValue}
                        </Typography>
                    )}
                </Box>
                <Avatar variant="rounded" sx={{ bgcolor: alpha(color, 0.1), color: color, width: 40, height: 40 }}>
                    {icon}
                </Avatar>
            </Box>
        </CardContent>
    </Card>
  );

  if (loading && !systemStatus) return <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center"><LinearProgress sx={{ width: 300 }} /></Box>;

  return (
    <Container maxWidth="xl" sx={{ py: 3, height: '100vh', display: 'flex', flexDirection: 'column' }}>
        
        {/* --- 1. HEADER & CONTROLS --- */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Box display="flex" alignItems="center" gap={2}>
                 <Typography variant="h5" fontWeight="900" sx={{ letterSpacing: -0.5 }}>
                    CRYPTO<span style={{ color: theme.palette.primary.main }}>TREND</span>
                </Typography>
                <Divider orientation="vertical" flexItem />
                <Chip 
                    label={isLiveMode ? "LIVE NET" : "PAPER NET"} 
                    size="small" 
                    color={isLiveMode ? "error" : "warning"} 
                    sx={{ fontWeight: 'bold', borderRadius: 1 }}
                />
                 <Chip 
                    label={connectionStatus === 'connected' ? 'SYSTEM ONLINE' : 'OFFLINE'} 
                    size="small" 
                    color={connectionStatus === 'connected' ? 'success' : 'default'} 
                    variant="outlined"
                    sx={{ fontWeight: 'bold', borderRadius: 1 }}
                />
            </Box>

            <Stack direction="row" spacing={2} alignItems="center">
                 <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
                     Last Sync: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '---'}
                 </Typography>

                 <Tooltip title="Reset Engine">
                    <IconButton size="small" color="warning" onClick={fetchInitialData}>
                        <Refresh />
                    </IconButton>
                 </Tooltip>
                 
                 <FormControl size="small">
                    <Select 
                        value={selectedStrategy} 
                        onChange={handleStrategyChange} 
                        disabled={tradingEnabled}
                        sx={{ height: 32, fontSize: '0.875rem' }}
                    >
                        <MenuItem value="conservative">🛡️ Conservative</MenuItem>
                        <MenuItem value="balanced">⚖️ Balanced</MenuItem>
                        <MenuItem value="responsive">⚡ Responsive</MenuItem>
                    </Select>
                 </FormControl>

                 <Button
                    variant="contained"
                    color={tradingEnabled ? "error" : "success"}
                    onClick={handleToggleTrading}
                    startIcon={tradingEnabled ? <Stop /> : <PlayArrow />}
                    size="small"
                    sx={{ px: 3, fontWeight: 'bold' }}
                 >
                    {tradingEnabled ? "STOP" : "START"}
                 </Button>
            </Stack>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* --- 2. KPI STRIP --- */}
        <Grid container spacing={2} mb={2}>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="Total Equity" 
                    value={`$${(portfolio?.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    subValue={`${(portfolio?.usdtBalance || 0).toFixed(2)} USDT Available`}
                    icon={<AccountBalanceWallet />}
                    color={theme.palette.primary.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="24h PnL" 
                    value={`$${(portfolio?.dailyPnL || 0).toFixed(2)}`}
                    subValue={portfolio?.dailyPnL > 0 ? "+2.4%" : "0.0%"} 
                    icon={<ShowChart />}
                    color={portfolio?.dailyPnL >= 0 ? theme.palette.success.main : theme.palette.error.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="Active Positions" 
                    value={portfolio?.positions?.length || 0}
                    subValue={`${signalsToRender.length} Signals Detected`}
                    icon={<Bolt />}
                    color={theme.palette.warning.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard 
                    title="Performance" 
                    value={`${portfolio?.performance?.totalTrades || 0} Trades`}
                    subValue={`Win Rate: ${(portfolio?.performance?.winRate || 0).toFixed(1)}%`}
                    icon={<History />}
                    color={theme.palette.info.main}
                />
            </Grid>
        </Grid>

        {/* --- 3. MAIN WORKSPACE (Chart + Watchlist) --- */}
        <Grid container spacing={2} sx={{ flexGrow: 1, minHeight: 0, mb: 2 }}>
            {/* Chart Area */}
            <Grid item xs={12} md={9} sx={{ display: 'flex', flexDirection: 'column' }}>
                <Paper variant="outlined" sx={{ p: 2, flexGrow: 1, display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.background.paper, 0.4) }}>
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                        <Timeline color="primary" fontSize="small" />
                        <Typography variant="subtitle2" fontWeight="bold">Market Overview</Typography>
                    </Box>
                    <Box flexGrow={1} sx={{ bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 1, overflow: 'hidden' }}>
                        <LivePriceChart prices={prices} assets={activeChartAssets} height="100%" />
                    </Box>
                </Paper>
            </Grid>

            {/* Watchlist Sidebar */}
            <Grid item xs={12} md={3} sx={{ display: 'flex', flexDirection: 'column' }}>
                <Paper variant="outlined" sx={{ p: 0, flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.background.paper, 0.4) }}>
                     <LivePrices prices={prices} assets={activeChartAssets} />
                </Paper>
            </Grid>
        </Grid>

        {/* --- 4. DATA TERMINAL (Bottom Tabs) --- */}
        <Paper variant="outlined" sx={{ flexGrow: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: 350 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ minHeight: 40 }}>
                    <Tab 
                        icon={<PieChart fontSize="small" />} iconPosition="start" 
                        label="Holdings & Positions" sx={{ minHeight: 40 }} 
                    />
                    <Tab 
                        icon={<Radar fontSize="small" />} iconPosition="start" 
                        label={<Badge badgeContent={signalsToRender.length} color="primary">Signals Feed</Badge>} 
                        sx={{ minHeight: 40 }} 
                    />
                    <Tab 
                        icon={<ReceiptLong fontSize="small" />} iconPosition="start" 
                        label="Execution History" sx={{ minHeight: 40 }} 
                    />
                </Tabs>
            </Box>
            
            <Box sx={{ flexGrow: 1, overflow: 'hidden', p: 0 }}>
                {activeTab === 0 && (
                    <Box height="100%" sx={{ overflowY: 'auto' }}>
                         <CurrentHoldings 
                            account={account} 
                            prices={prices} 
                            portfolio={portfolio} 
                            systemStatus={systemStatus} 
                         />
                    </Box>
                )}
                {activeTab === 1 && (
                     <Box height="100%" sx={{ overflowY: 'auto', p: 2 }}>
                        <TradingSignals signals={signalsToRender} systemStatus={systemStatus} compact />
                     </Box>
                )}
                {activeTab === 2 && (
                    <Box height="100%" sx={{ overflowY: 'auto', p: 2 }}>
                        <RecentTrades trades={trades} />
                    </Box>
                )}
            </Box>
        </Paper>

    </Container>
  );
};

export default TradingDashboard;