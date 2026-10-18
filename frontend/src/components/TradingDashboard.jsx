// frontend/src/components/TradingDashboard.jsx - Main Trading Dashboard with Engine Integration
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Container,
  Typography,
  Button,
  Chip,
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
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
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
import { socket, tradingAPI, engineAPI, runtimeAPI, strategiesAPI } from '../config/api';

// --- IMPORTED WIDGETS ---
import { GlassCard, FOREX_INSTRUMENTS } from './dashboard/Shared';
import { DashboardStats } from './dashboard/StatCards';
import CurrentHoldings from './dashboard/CurrentHoldings';
import LivePrices from './dashboard/LivePrices';
import TradingSignals from './dashboard/TradingSignals';
import RecentTrades from './dashboard/RecentTrades';
import LivePriceChart from './dashboard/LivePriceChart';
import MarketStatusBanner from './dashboard/MarketStatusBanner';
import { CURRENT_STRATEGY_KEY, strategyLabel } from '../utils/strategyDisplay';

const FETCH_LIMITS = { TRADES: 50, SIGNALS: 100 };
const SIDEBAR_WIDTH = 340;
const DEFAULT_STRATEGY_KEY = CURRENT_STRATEGY_KEY;
const FALLBACK_STRATEGY_OPTIONS = [
  {
    key: CURRENT_STRATEGY_KEY,
    label: 'H4 Trend',
    version: 'unknown',
    runtimeStatus: 'unavailable',
  },
];

const getStrategyOptions = (catalog = []) => {
  return catalog.length > 0 ? catalog : FALLBACK_STRATEGY_OPTIONS;
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
  return strategyLabel(strategyKey, strategy?.label);
};

const withReadDeadline = (request) => {
  let timer;
  return Promise.race([request, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Data request timed out')), 20000);
  })]).finally(() => clearTimeout(timer));
};

const shortenRuntimeId = (value) => (value ? String(value).slice(0, 12) : 'unassigned');

const getReadinessReasons = (readiness) => (
  Array.isArray(readiness?.reasons) ? readiness.reasons : []
);

const formatApiErrorMessage = (error, fallback) => {
  const message = error?.payload?.error || error?.message || fallback;
  const code = error?.payload?.code;
  return code ? `${message} (${code})` : message;
};

const formatReadinessValue = (key, value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'unavailable';
  const numericValue = Number(value);
  if (key === 'maxCapitalAtRisk') return `A$${numericValue.toFixed(2)}`;
  if (key === 'maxOpenPositions' || key === 'maxConsecutiveLosses') return String(numericValue);
  if (String(key || '').toLowerCase().includes('pct') || key === 'riskPerTrade' || key === 'maxPortfolioExposure') {
    return `${(numericValue * 100).toFixed(2)}%`;
  }
  return String(numericValue);
};

const formatCooldownRemaining = (remainingMs) => {
  const totalMinutes = Math.max(0, Math.ceil(Number(remainingMs || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const getReadinessReasonDetail = (reason) => {
  if (reason?.cooldownUntil) {
    return `Cooldown ends at ${new Date(reason.cooldownUntil).toLocaleString()} (${formatCooldownRemaining(reason.remainingMs)} remaining).`;
  }
  if (reason?.key) {
    return `Current ${formatReadinessValue(reason.key, reason.actual)}; live maximum ${formatReadinessValue(reason.key, reason.max)}.`;
  }
  if (reason?.actualConfigHash || reason?.requiredConfigHash) {
    return `Current ${reason.actualConfigHash || 'unavailable'}; required ${reason.requiredConfigHash || 'unavailable'}.`;
  }
  return null;
};

const TradingDashboard = () => {
  const theme = useTheme();

  // --- STATE ---
  const [systemStatus, setSystemStatus] = useState(null);
  const [engineStatus, setEngineStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  const [latestSignals, setLatestSignals] = useState(new Map());
  const [hasSignalData, setHasSignalData] = useState(false);
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [strategyCatalog, setStrategyCatalog] = useState([]);
  const [liveSelection, setLiveSelection] = useState(null);
  const [selectedStrategy, setSelectedStrategy] = useState(DEFAULT_STRATEGY_KEY);
  const [liveReadiness, setLiveReadiness] = useState(null);
  const [readinessDialogOpen, setReadinessDialogOpen] = useState(false);
  const [activationFailure, setActivationFailure] = useState(null);
  const [tradingAction, setTradingAction] = useState(null);

  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const isMountedRef = useRef(true);
  const strategyCatalogRef = useRef(strategyCatalog);
  const liveSelectionRef = useRef(liveSelection);
  const refreshSequenceRef = useRef(0);
  const readinessSequenceRef = useRef(0);

  // --- WEBSOCKET & DATA ---
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      refreshSequenceRef.current += 1;
      readinessSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    strategyCatalogRef.current = strategyCatalog;
  }, [strategyCatalog]);

  useEffect(() => {
    liveSelectionRef.current = liveSelection;
  }, [liveSelection]);

  const updateSignalState = useCallback((newSignals) => {
    if (!newSignals) return;
    setHasSignalData(true);
    const signalArray = Array.isArray(newSignals) ? newSignals : [newSignals];
    if (signalArray.length === 0) {
      setLatestSignals(new Map());
      return;
    }

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
    const refreshSequence = ++refreshSequenceRef.current;
    const readinessSequence = ++readinessSequenceRef.current;
    try {
      setLoading(true);
      const [statusData, portfolioData, tradesData, signalsData, pricesData, accountData, engineData, liveSelectionData, catalogData, readinessData] =
        await Promise.allSettled([
          tradingAPI.getStatus(),
          tradingAPI.getPortfolio(),
          tradingAPI.getTrades({ limit: FETCH_LIMITS.TRADES }),
          tradingAPI.getSignals({ limit: FETCH_LIMITS.SIGNALS }),
          tradingAPI.getPrices(),
          tradingAPI.getAccount(),
          engineAPI.getStatus(),
          runtimeAPI.getLiveSelection({ includeRuns: false }),
          strategiesAPI.getCatalog({ force: true }),
          tradingAPI.getLiveReadiness(),
        ].map(withReadDeadline));

      if (!isMountedRef.current || refreshSequence !== refreshSequenceRef.current) return;

      const catalog = catalogData.status === 'fulfilled' && Array.isArray(catalogData.value)
        ? catalogData.value
        : strategyCatalogRef.current;
      if (catalogData.status === 'fulfilled') setStrategyCatalog(catalog);

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
      if (readinessData.status === 'fulfilled' && readinessSequence === readinessSequenceRef.current) {
        setLiveReadiness(readinessData.value);
      } else if (readinessData.status === 'rejected' && readinessSequence === readinessSequenceRef.current) {
        setLiveReadiness(null);
      }

      setLoading(false);
      const reads = { status: statusData, portfolio: portfolioData, trades: tradesData, signals: signalsData,
        prices: pricesData, account: accountData, engine: engineData, runtime: liveSelectionData, catalog: catalogData, readiness: readinessData };
      const failed = Object.entries(reads).filter(([, result]) => result.status === 'rejected').map(([name]) => name);
      if (failed.length) setDataError(`Data refresh failed: ${failed.join(', ')}. Displayed values may be stale.`);
      else if (readinessSequence === readinessSequenceRef.current) { setDataError(null); setLastUpdate(Date.now()); }
    } catch (err) {
      if (isMountedRef.current && refreshSequence === refreshSequenceRef.current) {
        console.error(err);
        setDataError(`Data Sync Error: ${err.message}`);
        setLoading(false);
      }
    }
  }, [updateSignalState]);

  useEffect(() => {
    const handleConnect = () => {
      if (isMountedRef.current) {
        setError(null);
        fetchInitialData();
      }
    };

    const handleSystemStatus = (s) => isMountedRef.current && setSystemStatus(s);
    const handleEngineStatus = (s) => isMountedRef.current && setEngineStatus(s);
    const handleLiveSelectionUpdated = (selection) => {
      if (isMountedRef.current) {
        const previousSelection = liveSelectionRef.current;
        const selectionChanged =
          selection?.liveRunId &&
          previousSelection?.liveRunId &&
          selection.liveRunId !== previousSelection.liveRunId;

        if (selectionChanged) {
          setLatestSignals(new Map());
          setHasSignalData(false);
        }
        setLiveSelection(selection || null);
        setSelectedStrategy((current) =>
          normalizeStrategySelection(selection?.strategy || current, strategyCatalogRef.current)
        );
        fetchInitialData();
      }
    };
    const handlePortfolioUpdated = (d) => {
      if (isMountedRef.current) {
        setPortfolio(d);
      }
    };
    const handlePriceUpdate = (data) => {
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
      }
    };
    const handleSignalUpdate = (d) => {
      if (isMountedRef.current) {
        updateSignalState(d);
      }
    };
    const handleSignalGenerated = (d) => {
      if (isMountedRef.current) {
        updateSignalState(d);
      }
    };
    const handleTradeExecuted = (t) => {
      if (isMountedRef.current) {
        setTrades((prev) => [t, ...prev].slice(0, FETCH_LIMITS.TRADES));
      }
    };
    // New: Listen for trade events from engine
    const handleTradeOpened = () => {
      if (isMountedRef.current) {
        fetchInitialData(); // Refresh all data when trade opens
      }
    };
    const handleTradeClosed = () => {
      if (isMountedRef.current) {
        fetchInitialData(); // Refresh all data when trade closes
      }
    };
    const handleConfigUpdate = (newConfig) => {
      if (isMountedRef.current && newConfig) {
        setSystemStatus((prev) => ({ ...prev, config: newConfig }));
        setTradingEnabled(newConfig.enableTrading || false);
        setSelectedStrategy((current) =>
          normalizeStrategySelection(
            liveSelectionRef.current?.strategy || newConfig.strategy || current,
            strategyCatalogRef.current
          )
        );
        const readinessSequence = ++readinessSequenceRef.current;
        withReadDeadline(tradingAPI.getLiveReadiness())
          .then((readiness) => {
            if (isMountedRef.current && readinessSequence === readinessSequenceRef.current) {
              setLiveReadiness(readiness);
              setDataError((previous) => previous?.startsWith('Live readiness refresh failed') ? null : previous);
            }
          })
          .catch((readinessError) => {
            if (isMountedRef.current && readinessSequence === readinessSequenceRef.current) {
              setLiveReadiness(null);
              setDataError('Live readiness refresh failed. Current activation readiness is unavailable.');
            }
            console.error('Failed to refresh live readiness:', readinessError);
          });
      }
    };

    socket.on('connect', handleConnect);
    socket.on('systemStatus', handleSystemStatus);
    socket.on('engineStatus', handleEngineStatus);
    socket.on('liveSelectionUpdated', handleLiveSelectionUpdated);
    socket.on('portfolioUpdated', handlePortfolioUpdated);
    socket.on('priceUpdate', handlePriceUpdate);
    socket.on('signalUpdate', handleSignalUpdate);
    socket.on('signalGenerated', handleSignalGenerated);
    socket.on('tradeExecuted', handleTradeExecuted);
    socket.on('tradeOpened', handleTradeOpened);
    socket.on('tradeClosed', handleTradeClosed);
    socket.on('configUpdate', handleConfigUpdate);

    if (!socket.connected) {
      socket.connect();
    } else {
      handleConnect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('systemStatus', handleSystemStatus);
      socket.off('engineStatus', handleEngineStatus);
      socket.off('liveSelectionUpdated', handleLiveSelectionUpdated);
      socket.off('portfolioUpdated', handlePortfolioUpdated);
      socket.off('priceUpdate', handlePriceUpdate);
      socket.off('signalUpdate', handleSignalUpdate);
      socket.off('signalGenerated', handleSignalGenerated);
      socket.off('tradeExecuted', handleTradeExecuted);
      socket.off('tradeOpened', handleTradeOpened);
      socket.off('tradeClosed', handleTradeClosed);
      socket.off('configUpdate', handleConfigUpdate);
    };
  }, [fetchInitialData, updateSignalState]);

  useEffect(() => {
    const interval = setInterval(() => {
      const readinessSequence = ++readinessSequenceRef.current;
      withReadDeadline(tradingAPI.getLiveReadiness())
        .then((readiness) => {
          if (isMountedRef.current && readinessSequence === readinessSequenceRef.current) {
            setLiveReadiness(readiness);
            setDataError((previous) => previous?.startsWith('Live readiness refresh failed') ? null : previous);
          }
        })
        .catch(() => {
          if (isMountedRef.current && readinessSequence === readinessSequenceRef.current) {
            setLiveReadiness(null);
            setDataError('Live readiness refresh failed. Current activation readiness is unavailable.');
          }
        });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // --- HANDLERS ---
  const handleToggleTrading = async () => {
    if (tradingAction) return;
    const action = tradingEnabled ? 'pause' : 'enable';
    setTradingAction(action);
    setError(null);
    setNotice(null);
    setActivationFailure(null);

    try {
      let response;
      if (tradingEnabled) {
        response = await tradingAPI.stopTrading();
      } else {
        const readiness = await tradingAPI.getLiveReadiness();
        setLiveReadiness(readiness);
        if (!readiness?.activationAllowed) {
          setReadinessDialogOpen(true);
          return;
        }

        response = await tradingAPI.startTrading();
        if (response?.liveReadiness) setLiveReadiness(response.liveReadiness);
      }

      await fetchInitialData();
      setNotice(response?.message || (tradingEnabled ? 'Live entries paused' : 'Live entries enabled'));
    } catch (err) {
      const readiness = err?.payload?.liveReadiness || null;
      if (readiness) {
        setLiveReadiness(readiness);
        setReadinessDialogOpen(true);
      }
      await fetchInitialData();
      setActivationFailure(err?.payload || null);
      setError(formatApiErrorMessage(err, `Unable to ${action} live trading`));
    } finally {
      setTradingAction(null);
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
  const activeStrategyDefinition = useMemo(
    () => strategyOptions.find(
      (option) => option.key === (liveSelection?.strategy || selectedStrategy)
    ) || null,
    [liveSelection?.strategy, selectedStrategy, strategyOptions]
  );
  const activeStrategyVersion = systemStatus?.config?.strategyVersion ||
    activeStrategyDefinition?.version || 'unknown';
  const actionableSignalCount = useMemo(() => {
    return signalsToRender.filter(
      (s) =>
        (s.signal === 'BUY' || s.signal === 'SELL') &&
        s.signalClass !== 'EXIT_ONLY' &&
        s.entryType !== 'EXIT_ONLY' &&
        !String(s.intent || '').startsWith('EXIT_')
    ).length;
  }, [signalsToRender]);

  // Engine stats
  const engineOpenPositions = engineStatus?.openPositions || 0;
  const engineIsRunning = engineStatus?.isRunning || false;
  const readinessReasons = getReadinessReasons(liveReadiness);
  const entryRisk = liveReadiness?.entryRisk || engineStatus?.entryRisk || null;
  const lossCooldownActive = entryRisk?.cooldownActive === true;
  const liveActivationBlocked = !tradingEnabled && liveReadiness?.activationAllowed === false;
  const tradingActionPending = Boolean(tradingAction);
  const activationFailureReasons = Array.isArray(activationFailure?.baselineResume?.reasons)
    ? activationFailure.baselineResume.reasons
    : [];

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
          <Tooltip title="The active strategy is defined by the deployed release">
            <Chip
              label={`LIVE STRATEGY: ${activeStrategyLabel} v${activeStrategyVersion}`}
              size="small"
              variant="outlined"
              sx={{ height: 32, fontWeight: 'bold' }}
            />
          </Tooltip>
          <Button
            variant="contained"
            color={tradingEnabled ? 'error' : liveActivationBlocked ? 'warning' : 'success'}
            onClick={handleToggleTrading}
            startIcon={
              tradingActionPending
                ? <CircularProgress size={16} color="inherit" />
                : tradingEnabled
                  ? <Stop />
                  : <PlayArrow />
            }
            disabled={tradingActionPending}
            size="small"
            sx={{ px: 3, fontWeight: 'bold' }}
          >
            {tradingAction === 'pause'
              ? 'PAUSING LIVE'
              : tradingAction === 'enable'
                ? 'CHECKING LIVE'
                : tradingEnabled
                  ? 'PAUSE LIVE'
                  : liveActivationBlocked
                    ? 'LIVE BLOCKED'
                    : 'ENABLE LIVE'}
          </Button>
          {liveReadiness && (lossCooldownActive || !tradingEnabled) && (
            <Tooltip title={lossCooldownActive ? 'View consecutive-loss cooldown' : liveReadiness.passed ? 'Live readiness passed' : 'View live activation blockers'}>
              <Chip
                label={lossCooldownActive ? `LOSS COOLDOWN · ${formatCooldownRemaining(entryRisk.remainingMs)}` : liveReadiness.passed ? 'READY' : `${readinessReasons.length} BLOCKER${readinessReasons.length === 1 ? '' : 'S'}`}
                size="small"
                color={lossCooldownActive ? 'warning' : liveReadiness.passed ? 'success' : 'warning'}
                variant="outlined"
                onClick={() => setReadinessDialogOpen(true)}
                sx={{ height: 26, fontSize: '0.65rem', fontWeight: 'bold' }}
              />
            </Tooltip>
          )}
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
            label="LIVE ONLY"
            size="small"
            color="success"
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
            Last full refresh: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--:--'}
          </Typography>
        </Stack>
      </Box>

      {lossCooldownActive && (
        <Alert severity="warning" sx={{ mb: 2, flexShrink: 0 }}>
          Three consecutive losses triggered the 24-hour safety cooldown, ending at{' '}
          <strong>{new Date(entryRisk.cooldownUntil).toLocaleString()}</strong>.{' '}
          {tradingEnabled
            ? 'Live trading is enabled; entries can resume then, subject to the normal entry checks.'
            : 'Live trading is paused and will remain paused until you choose Enable Live.'}
        </Alert>
      )}

      {dataError && <Alert severity="warning" sx={{ mb: 2, flexShrink: 0 }}>{dataError}</Alert>}
      {error && (
        <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Dialog
        open={readinessDialogOpen}
        onClose={() => setReadinessDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {liveReadiness?.passed ? 'Live strategy is ready'
            : liveReadiness?.activationAllowed ? 'New entries are cooling down'
              : 'Live activation is blocked'}
        </DialogTitle>
        <DialogContent dividers>
          {activationFailure && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              <Typography variant="body2" fontWeight="bold">
                {activationFailure.error || 'Live activation failed'}
              </Typography>
              {activationFailure.code && (
                <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                  {activationFailure.code}
                </Typography>
              )}
              {Array.isArray(activationFailure.openPositions) && (
                <Typography variant="caption" display="block">
                  {activationFailure.openPositions.length} open position{activationFailure.openPositions.length === 1 ? '' : 's'} must be resolved before resuming.
                </Typography>
              )}
              {!Array.isArray(activationFailure.openPositions) &&
                Number.isFinite(Number(activationFailure.openPositions)) && (
                <Typography variant="caption" display="block">
                  {Number(activationFailure.openPositions)} open position{Number(activationFailure.openPositions) === 1 ? '' : 's'} must be resolved before resuming.
                </Typography>
              )}
              {activationFailureReasons.map((reason, index) => (
                <Typography key={`${reason.code || 'baseline'}-${index}`} variant="caption" display="block">
                  {reason.message || reason.code || String(reason)}
                </Typography>
              ))}
            </Alert>
          )}
          {liveReadiness?.passed ? (
            <Alert severity="success">
              Every live readiness check currently passes. Close this dialog and choose Enable Live to activate entries.
            </Alert>
          ) : (
            <Stack spacing={1.25}>
              <Alert severity="warning">
                {lossCooldownActive && liveReadiness?.activationAllowed
                  ? tradingEnabled
                    ? `Live trading is enabled. New entries can resume after the cooldown ends in ${formatCooldownRemaining(entryRisk.remainingMs)}, subject to the normal entry checks.`
                    : `Live trading is paused. Choose Enable Live to allow entries after the cooldown ends in ${formatCooldownRemaining(entryRisk.remainingMs)}; enabling does not shorten the cooldown.`
                  : 'Live entries remain paused. Resolve every item below; this safety gate cannot be bypassed from the dashboard.'}
              </Alert>
              <Alert severity="info">
                This installation runs one deployed strategy directly against the live OANDA account.
              </Alert>
              {readinessReasons.length > 0 ? readinessReasons.map((reason, index) => {
                const detail = getReadinessReasonDetail(reason);
                return (
                  <Box
                    key={`${reason.code || 'readiness'}-${reason.key || index}`}
                    sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                      <Chip
                        label={reason.code || 'READINESS_CHECK'}
                        size="small"
                        color="warning"
                        variant="outlined"
                        sx={{ fontFamily: 'monospace', fontSize: '0.62rem' }}
                      />
                      {reason.key && (
                        <Typography variant="caption" fontWeight="bold">
                          {reason.key}
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="body2">{reason.message || 'Readiness check failed'}</Typography>
                    {detail && (
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        {detail}
                      </Typography>
                    )}
                  </Box>
                );
              }) : (
                <Typography variant="body2" color="text.secondary">
                  The backend did not return individual readiness reasons. Refresh and try again.
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReadinessDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Market Status Banner - Shows open/closed status with countdown */}
      <Box sx={{ flexShrink: 0 }}>
        <MarketStatusBanner strategy={systemStatus?.config?.strategy || liveSelection?.strategy || selectedStrategy} />
      </Box>

      {/* KPI Stats */}
      <DashboardStats
        portfolio={portfolio}
        activeSignalsCount={hasSignalData ? actionableSignalCount : null}
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
              <TradingSignals
                signals={signalsToRender}
                systemStatus={systemStatus}
                activeStrategy={liveSelection?.strategy || systemStatus?.config?.strategy || null}
              />
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
              <LivePriceChart prices={prices} assets={activeChartAssets}
                initialTimeframe={systemStatus?.config?.timeframe === '15m' ? 'M15' : 'H4'} height="100%" />
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
