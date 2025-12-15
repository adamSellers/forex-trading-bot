// frontend/src/components/TradingDashboard.jsx - FIXED ASSET VISIBILITY
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Container, Typography, Button, Chip,
  FormControl, Select, MenuItem, IconButton, Box,
  Stack, Avatar, LinearProgress, useTheme, alpha,
  Tooltip, Alert, Tabs, Tab, Badge, Divider, styled, Paper
} from '@mui/material';
import {
  PlayArrow, Stop, Refresh,
  AccountBalanceWallet, History, Bolt,
  ShowChart, Timeline, ReceiptLong, Radar, PieChart,
  SignalCellularAlt
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import { SOCKET_URL, tradingAPI } from '../config/api';

import CurrentHoldings from './CurrentHoldings';
import LivePrices from './LivePrices';
import TradingSignals from './TradingSignals'; 
import RecentTrades from './RecentTrades';
import LivePriceChart from './LivePriceChart';

const FETCH_LIMITS = { TRADES: 50, SIGNALS: 100 };
const SIDEBAR_WIDTH = 340; 

const GlassCard = styled(Paper)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  }
}));

const MetricValue = styled(Typography)(() => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 700,
  letterSpacing: '-0.5px'
}));

const TradingDashboard = () => {
  const theme = useTheme();
  
  const [systemStatus, setSystemStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  const [latestSignals, setLatestSignals] = useState(new Map());
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('balanced');
  
  const [activeTab, setActiveTab] = useState(0); 
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
      if (signalsData.status === 'fulfilled' && signalsData.value) {
          const sigs = Array.isArray(signalsData.value) ? signalsData.value : signalsData.value.signals;
          updateSignalState(sigs);
      }
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

  const signalsToRender = useMemo(() => Array.from(latestSignals.values()).sort((a, b) => b.timestamp - a.timestamp), [latestSignals]);
  
  // FIX: Show ALL assets in the config, even if allocation is 0% (Watched Assets)
  const activeChartAssets = useMemo(() => {
    if (!systemStatus?.config?.assets) return ['BTCUSDT', 'ETHUSDT'];
    return systemStatus.config.assets; 
  }, [systemStatus]);

  const StatCard = ({ title, value, subValue, icon, color }) => (
    <GlassCard elevation={0}>
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Box>
                    <Typography variant="overline" color="text.secondary" fontWeight="700" letterSpacing={1}>
                        {title}
                    </Typography>
                    <MetricValue variant="h5" sx={{ mt: 0.5 }}>
                        {value}
                    </MetricValue>
                </Box>
                <Avatar variant="rounded" sx={{ 
                    bgcolor: alpha(color, 0.1), 
                    color: color, 
                    width: 36, height: 36,
                    border: `1px solid ${alpha(color, 0.2)}`
                }}>
                    {icon}
                </Avatar>
            </Box>
            
            {subValue && (
                <Box mt={1} display="flex" alignItems="center" gap={0.5}>
                    <Typography variant="caption" sx={{ 
                        color: subValue.includes('+') ? 'success.main' : 'text.secondary', 
                        fontWeight: 'bold',
                        fontFamily: 'monospace'
                    }}>
                        {subValue}
                    </Typography>
                </Box>
            )}
        </Box>
    </GlassCard>
  );

  if (loading && !systemStatus) return <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center"><LinearProgress sx={{ width: 300 }} /></Box>;

  return (
    <Container maxWidth={false} sx={{ py: 2, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* HEADER */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} px={1} flexShrink={0}>
            <Box display="flex" alignItems="center" gap={2}>
                 <Box display="flex" flexDirection="column">
                    <Typography variant="h5" fontWeight="900" sx={{ letterSpacing: -0.5, lineHeight: 1 }}>
                        CRYPTO<span style={{ color: theme.palette.primary.main }}>TREND</span>
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 2 }}>
                        LIVE TERMINAL
                    </Typography>
                 </Box>
                 
                <Divider orientation="vertical" flexItem sx={{ height: 30, alignSelf: 'center', mx: 1 }} />
                
                <Chip 
                    label={connectionStatus === 'connected' ? 'SYSTEM ONLINE' : 'OFFLINE'} 
                    size="small" 
                    color={connectionStatus === 'connected' ? 'success' : 'default'} 
                    variant="outlined"
                    sx={{ fontWeight: 'bold', borderRadius: 1 }}
                />
            </Box>

            <Stack direction="row" spacing={2} alignItems="center">
                 <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', display: { xs: 'none', md: 'block' } }}>
                     SYNC: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--:--'}
                 </Typography>

                 <Tooltip title="Force Refresh">
                    <IconButton size="small" onClick={fetchInitialData} sx={{ border: 1, borderColor: 'divider' }}>
                        <Refresh fontSize="small" />
                    </IconButton>
                 </Tooltip>
                 
                 <FormControl size="small">
                    <Select 
                        value={selectedStrategy} 
                        onChange={handleStrategyChange} 
                        disabled={tradingEnabled}
                        sx={{ height: 32, fontSize: '0.8rem', minWidth: 140, bgcolor: alpha(theme.palette.background.paper, 0.1) }}
                    >
                        <MenuItem value="supertrend_momentum">⚡ SuperTrend</MenuItem>
                        <MenuItem value="balanced">⚖️ Balanced</MenuItem>
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
                    {tradingEnabled ? "STOP ENGINE" : "START ENGINE"}
                 </Button>
            </Stack>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* KPI STRIP */}
        <Box display="flex" gap={2} mb={2} flexShrink={0} sx={{ overflowX: 'auto', pb: 0.5 }}>
            <Box flex={1} minWidth={200}><StatCard title="Total Equity" value={`$${(portfolio?.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} subValue={`${(portfolio?.usdtBalance || 0).toFixed(2)} USDT Available`} icon={<AccountBalanceWallet fontSize="small" />} color={theme.palette.primary.main} /></Box>
            <Box flex={1} minWidth={200}><StatCard title="24h PnL" value={`$${(portfolio?.dailyPnL || 0).toFixed(2)}`} subValue={portfolio?.dailyPnL > 0 ? "+ Profit" : "Flat"} icon={<ShowChart fontSize="small" />} color={portfolio?.dailyPnL >= 0 ? theme.palette.success.main : theme.palette.error.main} /></Box>
            <Box flex={1} minWidth={200}><StatCard title="Active Positions" value={portfolio?.positions?.length || 0} subValue={`${signalsToRender.length} Signals Active`} icon={<Bolt fontSize="small" />} color={theme.palette.warning.main} /></Box>
            <Box flex={1} minWidth={200}><StatCard title="Win Rate" value={`${(portfolio?.performance?.winRate || 0).toFixed(1)}%`} subValue={`${portfolio?.performance?.totalTrades || 0} Trades`} icon={<History fontSize="small" />} color={theme.palette.info.main} /></Box>
        </Box>

        {/* DATA TERMINAL */}
        <GlassCard sx={{ flexGrow: 0, height: 520, flexShrink: 0, mb: 2 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.02) }}>
                <Tabs 
                    value={activeTab} 
                    onChange={(_, v) => setActiveTab(v)} 
                    textColor="primary"
                    indicatorColor="primary"
                    sx={{ minHeight: 40 }}
                >
                    <Tab icon={<PieChart fontSize="small" />} iconPosition="start" label="HOLDINGS" sx={{ minHeight: 40, fontWeight: 'bold' }} />
                    <Tab icon={<Radar fontSize="small" />} iconPosition="start" label={<Badge badgeContent={signalsToRender.length} color="error" variant="dot" sx={{ pl: 1 }}>SIGNALS</Badge>} sx={{ minHeight: 40, fontWeight: 'bold' }} />
                    <Tab icon={<ReceiptLong fontSize="small" />} iconPosition="start" label="HISTORY" sx={{ minHeight: 40, fontWeight: 'bold' }} />
                </Tabs>
            </Box>
            
            <Box sx={{ flexGrow: 1, overflow: 'hidden', position: 'relative' }}>
                {activeTab === 0 && (
                    <Box height="100%" sx={{ overflowY: 'auto' }}>
                         <CurrentHoldings account={account} prices={prices} portfolio={portfolio} systemStatus={systemStatus} />
                    </Box>
                )}
                {activeTab === 1 && (
                     <Box height="100%" sx={{ overflow: 'hidden' }}>
                        <TradingSignals signals={signalsToRender} systemStatus={systemStatus} />
                     </Box>
                )}
                {activeTab === 2 && (
                    <Box height="100%" sx={{ overflowY: 'auto', p: 2 }}>
                        <RecentTrades trades={trades} />
                    </Box>
                )}
            </Box>
        </GlassCard>

        {/* CHART & SIDEBAR */}
        <Box sx={{ display: 'flex', gap: 2, flexGrow: 1, minHeight: 0 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <GlassCard>
                    <Box p={1.5} borderBottom={1} borderColor="divider" display="flex" alignItems="center" gap={1}>
                        <Timeline color="primary" fontSize="small" />
                        <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">MARKET OVERVIEW</Typography>
                    </Box>
                    <Box flexGrow={1} sx={{ position: 'relative' }}>
                        <LivePriceChart prices={prices} assets={activeChartAssets} height="100%" />
                    </Box>
                </GlassCard>
            </Box>

            <Box sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                <GlassCard>
                    <Box p={1.5} borderBottom={1} borderColor="divider" display="flex" alignItems="center" gap={1}>
                        <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">LIVE MARKETS</Typography>
                        <Chip label={activeChartAssets.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                    </Box>
                    <Box flexGrow={1} sx={{ overflowY: 'auto', p: 0 }}>
                         <LivePrices prices={prices} assets={activeChartAssets} />
                    </Box>
                </GlassCard>
            </Box>
        </Box>

    </Container>
  );
};

export default TradingDashboard;