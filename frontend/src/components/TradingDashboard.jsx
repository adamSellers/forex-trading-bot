// frontend/src/components/TradingDashboard.jsx - Main Trading Dashboard with Engine Integration
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Container,
  Typography,
  Button,
  Chip,
  FormControl,
  Select,
  MenuItem,
  Box,
  Stack,
  LinearProgress,
  useTheme,
  alpha,
  Alert,
  Tabs,
  Tab,
  Badge,
  Tooltip,
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  PieChart,
  Radar,
  ReceiptLong,
  Timeline,
  Sync,
  FiberManualRecord,
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import { SOCKET_URL, tradingAPI, engineAPI, runtimeAPI, strategiesAPI } from '../config/api';

// --- IMPORTED WIDGETS ---
import { GlassCard, FOREX_INSTRUMENTS } from './dashboard/Shared';
import { DashboardStats } from './dashboard/StatCards';
import CurrentHoldings from './dashboard/CurrentHoldings';
import LivePrices from './dashboard/LivePrices';
import TradingSignals from './dashboard/TradingSignals';
import RecentTrades from './dashboard/RecentTrades';
import LivePriceChart from './dashboard/LivePriceChart';
import MarketStatusBanner from './dashboard/MarketStatusBanner';

const FETCH_LIMITS = { TRADES: 50, SIGNALS: 100 };
const SIDEBAR_WIDTH = 340;
const DEFAULT_STRATEGY_KEY = 'supertrend_momentum';
const FALLBACK_STRATEGY_OPTIONS = [
  { key: 'supertrend_momentum', label: 'SuperTrend Momentum', runtimeStatus: 'baseline' },
];

const getStrategyOptions = (catalog = []) => {
  return catalog.length > 0 ? catalog : FALLBACK_STRATEGY_OPTIONS;
};

const isStrategySelectable = (strategy = {}) =>
  strategy.runtimeStatus === 'baseline' || strategy.runtimeStatus === 'live_ready';

const getStrategyAvailabilitySuffix = (strategy = {}) => {
  if (strategy.runtimeStatus === 'candidate') {
    return ' (Paper Only)';
  }

  if (strategy.runtimeStatus === 'planned') {
    return ' (Planned)';
  }

  return '';
};

const normalizeStrategySelection = (strategyKey, catalog = []) => {
  const options = getStrategyOptions(catalog);
  if (options.some((option) => option.key === strategyKey)) {
    return strategyKey;
  }

  return DEFAULT_STRATEGY_KEY;
};

const getStrategyLabel = (strategyKey, catalog = []) => {
  const strategy = getStrategyOptions(catalog).find((option) => option.key === strategyKey);
  return strategy?.label || 'SuperTrend Momentum';
};

const shortenRuntimeId = (value) => (value ? String(value).slice(0, 12) : 'unassigned');

const TradingDashboard = () => {
  const theme = useTheme();

  // --- STATE ---
  const [systemStatus, setSystemStatus] = useState(null);
  const [engineStatus, setEngineStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  const [latestSignals, setLatestSignals] = useState(new Map());
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [strategyCatalog, setStrategyCatalog] = useState([]);
  const [liveSelection, setLiveSelection] = useState(null);
  const [selectedStrategy, setSelectedStrategy] = useState(DEFAULT_STRATEGY_KEY);
  const [isApplyingStrategy, setIsApplyingStrategy] = useState(false);

  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const socketRef = useRef(null);
  const isMountedRef = useRef(true);

  // --- WEBSOCKET & DATA ---
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const updateSignalState = useCallback((newSignals) => {
    if (!newSignals) return;
    const signalArray = Array.isArray(newSignals) ? newSignals : [newSignals];
    setLatestSignals((prevMap) => {
      const newMap = new Map(prevMap);
      let hasUpdates = false;
      signalArray.forEach((signal) => {
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
      const [statusData, portfolioData, tradesData, signalsData, pricesData, accountData, engineData, liveSelectionData, catalogData] =
        await Promise.allSettled([
          tradingAPI.getStatus(),
          tradingAPI.getPortfolio(),
          tradingAPI.getTrades({ limit: FETCH_LIMITS.TRADES }),
          tradingAPI.getSignals({ limit: FETCH_LIMITS.SIGNALS }),
          tradingAPI.getPrices(),
          tradingAPI.getAccount(),
          engineAPI.getStatus(),
          runtimeAPI.getLiveSelection(),
          strategiesAPI.getCatalog(),
        ]);

      if (!isMountedRef.current) return;

      const catalog = catalogData.status === 'fulfilled' && Array.isArray(catalogData.value)
        ? catalogData.value
        : [];
      setStrategyCatalog(catalog);

      if (statusData.status === 'fulfilled') {
        setSystemStatus(statusData.value);
        setTradingEnabled(statusData.value.config?.enableTrading || false);
      }
      if (engineData.status === 'fulfilled') {
        setEngineStatus(engineData.value);
      }
      if (liveSelectionData.status === 'fulfilled') {
        const selection = liveSelectionData.value?.liveSelection || null;
        setLiveSelection(selection);
        setSelectedStrategy(
          normalizeStrategySelection(
            selection?.strategy || (statusData.status === 'fulfilled' ? statusData.value?.config?.strategy : null),
            catalog
          )
        );
      } else if (statusData.status === 'fulfilled') {
        setSelectedStrategy(
          normalizeStrategySelection(statusData.value.config?.strategy, catalog)
        );
      }
      if (signalsData.status === 'fulfilled' && signalsData.value) {
        const sigs = Array.isArray(signalsData.value)
          ? signalsData.value
          : signalsData.value.signals;
        updateSignalState(sigs);
      }
      if (portfolioData.status === 'fulfilled') setPortfolio(portfolioData.value);
      if (tradesData.status === 'fulfilled') {
        const t = tradesData.value.trades || tradesData.value;
        if (Array.isArray(t)) setTrades(t);
      }
      if (pricesData.status === 'fulfilled' && pricesData.value?.prices) {
        const pricesObj = {};
        pricesData.value.prices.forEach((p) => {
          pricesObj[p.instrument] = { ...p, price: p.mid, symbol: p.instrument };
        });
        setPrices(pricesObj);
      }
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
    socketRef.current = io(socketUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
    });
    const socket = socketRef.current;

    socket.on('connect', () => {
      if (isMountedRef.current) {
        setError(null);
        fetchInitialData();
      }
    });

    socket.on('systemStatus', (s) => isMountedRef.current && setSystemStatus(s));
    socket.on('engineStatus', (s) => isMountedRef.current && setEngineStatus(s));
    socket.on('liveSelectionUpdated', (selection) => {
      if (isMountedRef.current) {
        setLiveSelection(selection || null);
        setSelectedStrategy((current) =>
          normalizeStrategySelection(selection?.strategy || current, strategyCatalog)
        );
        setLastUpdate(Date.now());
      }
    });
    socket.on('portfolioUpdated', (d) => {
      if (isMountedRef.current) {
        setPortfolio(d);
        setLastUpdate(Date.now());
      }
    });
    socket.on('priceUpdate', (data) => {
      if (isMountedRef.current && data) {
        if (typeof data === 'object' && !data.instrument && !data.symbol) {
          setPrices((prev) => {
            const updated = { ...prev };
            Object.entries(data).forEach(([instrument, priceData]) => {
              updated[instrument] = {
                ...priceData,
                price: priceData.mid || priceData.price,
                symbol: instrument,
              };
            });
            return updated;
          });
        } else {
          const key = data.instrument || data.symbol;
          if (key) {
            setPrices((p) => ({
              ...p,
              [key]: { ...data, price: data.mid || data.price, symbol: key },
            }));
          }
        }
        setLastUpdate(Date.now());
      }
    });
    socket.on('signalUpdate', (d) => {
      if (isMountedRef.current) {
        updateSignalState(d);
        setLastUpdate(Date.now());
      }
    });
    socket.on('signalGenerated', (d) => {
      if (isMountedRef.current) {
        updateSignalState(d);
        setLastUpdate(Date.now());
      }
    });
    socket.on('tradeExecuted', (t) => {
      if (isMountedRef.current) {
        setTrades((prev) => [t, ...prev].slice(0, FETCH_LIMITS.TRADES));
        setLastUpdate(Date.now());
      }
    });
    // New: Listen for trade events from engine
    socket.on('tradeOpened', (t) => {
      if (isMountedRef.current) {
        fetchInitialData(); // Refresh all data when trade opens
      }
    });
    socket.on('tradeClosed', (t) => {
      if (isMountedRef.current) {
        fetchInitialData(); // Refresh all data when trade closes
      }
    });
    socket.on('configUpdate', (newConfig) => {
      if (isMountedRef.current && newConfig) {
        setSystemStatus((prev) => ({ ...prev, config: newConfig }));
        setTradingEnabled(newConfig.enableTrading || false);
        setSelectedStrategy((current) =>
          normalizeStrategySelection(liveSelection?.strategy || newConfig.strategy || current, strategyCatalog)
        );
        setLastUpdate(Date.now());
      }
    });

    return () => socket.disconnect();
  }, [fetchInitialData, liveSelection?.strategy, strategyCatalog, updateSignalState]);

  // --- HANDLERS ---
  const handleToggleTrading = async () => {
    try {
      tradingEnabled
        ? await tradingAPI.stopTrading()
        : await tradingAPI.startTrading();
      setTradingEnabled(!tradingEnabled);
    } catch (err) {
      setError(err.message);
      fetchInitialData();
    }
  };

  const handleStrategyChange = (e) => {
    setSelectedStrategy(e.target.value);
  };

  const handleApplyStrategy = async () => {
    try {
      setIsApplyingStrategy(true);
      setError(null);
      await runtimeAPI.setLiveSelection({ strategyKey: selectedStrategy });
      await fetchInitialData();
    } catch (err) {
      setError(err.message);
    } finally {
      if (isMountedRef.current) {
        setIsApplyingStrategy(false);
      }
    }
  };

  const handleSyncEngine = async () => {
    try {
      await engineAPI.sync();
      fetchInitialData();
    } catch (err) {
      setError(`Sync failed: ${err.message}`);
    }
  };

  // --- MEMOIZED HELPERS ---
  const signalsToRender = useMemo(
    () =>
      Array.from(latestSignals.values()).sort((a, b) => b.timestamp - a.timestamp),
    [latestSignals]
  );
  const strategyOptions = useMemo(
    () => getStrategyOptions(strategyCatalog),
    [strategyCatalog]
  );
  const activeChartAssets = useMemo(
    () => systemStatus?.config?.assets || FOREX_INSTRUMENTS,
    [systemStatus]
  );
  const activeStrategyLabel = useMemo(
    () => getStrategyLabel(liveSelection?.strategy || selectedStrategy, strategyOptions),
    [liveSelection?.strategy, selectedStrategy, strategyOptions]
  );
  const selectedStrategyOption = useMemo(
    () => strategyOptions.find((option) => option.key === selectedStrategy) || null,
    [selectedStrategy, strategyOptions]
  );
  const canApplyStrategy =
    Boolean(selectedStrategyOption) &&
    isStrategySelectable(selectedStrategyOption) &&
    !isApplyingStrategy;
  const strategyActionLabel =
    liveSelection?.strategy === selectedStrategy ? 'Restart Live Run' : 'Apply Live Strategy';

  const calculatedDailyPnL = useMemo(() => {
    if (!trades || trades.length === 0) return 0;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return trades
      .filter(
        (t) =>
          t.pnlAud !== null &&
          !isNaN(Number(t.pnlAud)) &&
          !t.isOpen &&
          new Date(t.exitTime || t.timestamp).getTime() > oneDayAgo
      )
      .reduce((sum, t) => sum + Number(t.pnlAud), 0);
  }, [trades]);

  const actionableSignalCount = useMemo(() => {
    return signalsToRender.filter(
      (s) => s.signal === 'BUY' || s.signal === 'SELL'
    ).length;
  }, [signalsToRender]);

  // Engine stats
  const engineOpenPositions = engineStatus?.openPositions || 0;
  const engineIsRunning = engineStatus?.isRunning || false;

  if (loading && !systemStatus)
    return (
      <Box
        minHeight="80vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <LinearProgress sx={{ width: 300 }} />
      </Box>
    );

  return (
    <Container
      maxWidth={false}
      sx={{
        py: 2,
        height: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Control Bar */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
        px={1}
        flexShrink={0}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small">
            <Select
              value={selectedStrategy}
              onChange={handleStrategyChange}
              disabled={isApplyingStrategy}
              sx={{
                height: 32,
                fontSize: '0.8rem',
                minWidth: 220,
                bgcolor: alpha(theme.palette.background.paper, 0.1),
              }}
            >
              {strategyOptions.map((option) => (
                <MenuItem
                  key={option.key}
                  value={option.key}
                  disabled={!isStrategySelectable(option)}
                >
                  {option.label}
                  {getStrategyAvailabilitySuffix(option)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            size="small"
            onClick={handleApplyStrategy}
            disabled={!canApplyStrategy}
            sx={{ px: 2, fontWeight: 'bold' }}
          >
            {isApplyingStrategy ? 'Applying...' : strategyActionLabel}
          </Button>
          <Button
            variant="contained"
            color={tradingEnabled ? 'error' : 'success'}
            onClick={handleToggleTrading}
            startIcon={tradingEnabled ? <Stop /> : <PlayArrow />}
            size="small"
            sx={{ px: 3, fontWeight: 'bold' }}
          >
            {tradingEnabled ? 'STOP ENGINE' : 'START ENGINE'}
          </Button>
          <Tooltip title="Sync engine with Oanda">
            <Button
              variant="outlined"
              size="small"
              onClick={handleSyncEngine}
              sx={{ minWidth: 40, p: 0.5 }}
            >
              <Sync fontSize="small" />
            </Button>
          </Tooltip>
        </Stack>

        {/* Engine Status Indicator */}
        <Stack direction="row" spacing={2} alignItems="center">
          <Chip
            label={`Live: ${activeStrategyLabel}`}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ height: 22, fontSize: '0.72rem' }}
          />
          <Chip
            label={
              liveSelection?.shadowRun
                ? `Shadow: ${liveSelection.shadowRun.status}`
                : 'Shadow: Starting'
            }
            size="small"
            color={liveSelection?.shadowRun ? 'success' : 'default'}
            variant="outlined"
            sx={{ height: 22, fontSize: '0.72rem' }}
          />
          <Box display="flex" alignItems="center" gap={1}>
            <FiberManualRecord
              sx={{
                fontSize: 12,
                color: engineIsRunning ? 'success.main' : 'text.disabled',
                animation: engineIsRunning ? 'pulse 2s infinite' : 'none',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.5 },
                },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Engine: {engineIsRunning ? 'Running' : 'Stopped'}
            </Typography>
          </Box>
          {engineOpenPositions > 0 && (
            <Chip
              label={`${engineOpenPositions} Open`}
              size="small"
              color="warning"
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
          )}
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color: 'text.secondary',
              display: { xs: 'none', md: 'block' },
            }}
          >
            Selection: {shortenRuntimeId(liveSelection?.selectionId)}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color: 'text.secondary',
              display: { xs: 'none', md: 'block' },
            }}
          >
            Last sync: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--:--'}
          </Typography>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Market Status Banner - Shows open/closed status with countdown */}
      <Box sx={{ flexShrink: 0 }}>
        <MarketStatusBanner />
      </Box>

      {/* KPI Stats */}
      <DashboardStats
        portfolio={portfolio}
        calculatedDailyPnL={calculatedDailyPnL}
        activeSignalsCount={signalsToRender.length}
        engineStatus={engineStatus}
      />

      {/* Data Terminal (Tabs) */}
      <GlassCard sx={{ flexGrow: 0, height: 520, flexShrink: 0, mb: 2 }}>
        <Box
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: alpha(theme.palette.background.paper, 0.02),
          }}
        >
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            textColor="primary"
            indicatorColor="primary"
            sx={{ minHeight: 40 }}
          >
            <Tab
              icon={<PieChart fontSize="small" />}
              iconPosition="start"
              label="HOLDINGS"
              sx={{ minHeight: 40, fontWeight: 'bold' }}
            />
            <Tab
              icon={<Radar fontSize="small" />}
              iconPosition="start"
              label={
                <Badge
                  badgeContent={actionableSignalCount}
                  color="warning"
                  variant="dot"
                  sx={{
                    '& .MuiBadge-badge': {
                      right: -3,
                      top: 3,
                      animation:
                        actionableSignalCount > 0 ? 'pulse 1.5s infinite' : 'none',
                      '@keyframes pulse': {
                        '0%': { transform: 'scale(1)', opacity: 1 },
                        '50%': { transform: 'scale(1.5)', opacity: 0.7 },
                        '100%': { transform: 'scale(1)', opacity: 1 },
                      },
                    },
                  }}
                >
                  SIGNALS
                </Badge>
              }
              sx={{ minHeight: 40, fontWeight: 'bold', pl: 1 }}
            />
            <Tab
              icon={<ReceiptLong fontSize="small" />}
              iconPosition="start"
              label="HISTORY"
              sx={{ minHeight: 40, fontWeight: 'bold' }}
            />
          </Tabs>
        </Box>
        <Box sx={{ flexGrow: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 0 && (
            <Box height="100%" sx={{ overflowY: 'auto' }}>
              <CurrentHoldings
                account={account}
                prices={prices}
                portfolio={portfolio}
                systemStatus={systemStatus}
                engineStatus={engineStatus}
              />
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

      {/* Charts & Sidebar */}
      <Box sx={{ display: 'flex', gap: 2, flexGrow: 1, minHeight: 0 }}>
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <GlassCard>
            <Box
              p={1.5}
              borderBottom={1}
              borderColor="divider"
              display="flex"
              alignItems="center"
              gap={1}
            >
              <Timeline color="primary" fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                MARKET OVERVIEW
              </Typography>
            </Box>
            <Box flexGrow={1} sx={{ position: 'relative' }}>
              <LivePriceChart prices={prices} assets={activeChartAssets} height="100%" />
            </Box>
          </GlassCard>
        </Box>
        <Box
          sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <GlassCard>
            <Box
              p={1.5}
              borderBottom={1}
              borderColor="divider"
              display="flex"
              alignItems="center"
              gap={1}
            >
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                LIVE MARKETS
              </Typography>
              <Chip
                label={activeChartAssets.length}
                size="small"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
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
