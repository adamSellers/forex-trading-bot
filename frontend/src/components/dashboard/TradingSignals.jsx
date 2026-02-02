// frontend/src/components/dashboard/TradingSignals.jsx - Forex Version
import React, { useMemo } from 'react';
import { 
    Typography, Box, LinearProgress, Stack, Avatar, 
    useTheme, alpha, Chip, styled, Table, TableBody, 
    TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import { 
    TrendingUp, TrendingDown, Timeline, Radar, ShowChart 
} from '@mui/icons-material';
import { formatInstrument, INSTRUMENT_INFO } from './Shared';

// --- STYLED COMPONENTS ---
const StyledTableRow = styled(TableRow)(({ theme }) => ({
    '&:nth-of-type(odd)': {
        backgroundColor: alpha(theme.palette.action.hover, 0.05),
    },
    '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.05),
        cursor: 'default'
    },
    '&:last-child td, &:last-child th': {
        border: 0,
    },
}));

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    padding: '6px 16px',
    height: 40,
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    fontSize: '0.8rem',
    fontFamily: '"Roboto Mono", monospace',
}));

const HeaderCell = styled(TableCell)(({ theme }) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.5),
    backdropFilter: 'blur(5px)',
    color: theme.palette.text.secondary,
    fontWeight: 700,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 1,
    padding: '8px 16px',
    borderBottom: `1px solid ${theme.palette.divider}`,
}));

const MonoText = styled(Typography)(({ theme, color }) => ({
    fontFamily: '"Roboto Mono", monospace',
    fontWeight: 500,
    color: color || theme.palette.text.primary,
    fontSize: '0.8rem'
}));

const TradingSignals = ({ signals, systemStatus, compact = false }) => {
  const theme = useTheme();

  // --- LOGIC: Filter Signals by Portfolio Config ---
  // FIXED: Added defensive checks and ensured dependency tracking works
  const filteredSignals = useMemo(() => {
      if (!signals || !Array.isArray(signals)) return [];
      
      // If config hasn't loaded yet, show all to be safe, or empty if prefer strictness
      if (!systemStatus?.config?.assets) return signals;
      
      const activeAssets = new Set(systemStatus.config.assets);
      // Sort by timestamp descending to ensure newest are always first
      return signals
          .filter(s => activeAssets.has(s.symbol))
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [signals, systemStatus]); // signals is now a new array ref from parent every update

  // --- LOGIC: Signal Meta ---
  const getSignalMeta = (signalType) => {
    const s = (signalType || '').toUpperCase();
    if (s.includes('BUY')) return { color: 'success', icon: <TrendingUp fontSize="small" /> };
    if (s.includes('SELL')) return { color: 'error', icon: <TrendingDown fontSize="small" /> };
    return { color: 'info', icon: <Timeline fontSize="small" /> }; 
  };

  // --- LOGIC: Parse Trend Data (RSI/Direction) ---
  const getTrendContext = (signal) => {
      let rsiVal = null;
      let trendDir = null;
      
      try {
          // Handle both stringified JSON and pre-parsed objects
          const data = typeof signal.trend_data === 'string' 
              ? JSON.parse(signal.trend_data) 
              : (signal.trend_data || signal.trend || {}); // Fallback to 'trend' prop if exists

          // 1. Extract RSI (Prioritize 'rsi' key)
          if (data.rsi !== undefined) rsiVal = parseFloat(data.rsi).toFixed(1);
          
          // 2. Extract Trend Direction
          if (data.supertrend_direction !== undefined) trendDir = data.supertrend_direction;
          else if (data.direction !== undefined) trendDir = data.direction;
          else if (signal.stDirection !== undefined) trendDir = signal.stDirection; // Fallback to root prop
      } catch (e) { 
          console.warn(`Trend Parse Error (${signal.symbol}):`, e);
      }

      // 3. Determine Bias
      const isBullish = trendDir == 1 || (signal.signal || '').includes('BUY');
      const isBearish = trendDir == -1 || (signal.signal || '').includes('SELL');

      return { rsiVal, isBullish, isBearish };
  };

  // --- LOGIC: Determine Signal Status and Block Reasons ---
  // Returns badges indicating why a signal is blocked or if it's actionable
  const getSignalStatus = (signal, config) => {
      const minAdx = config?.minAdx || 22;
      const adxVal = signal.strength || signal.trend?.adx || 0;
      const adxRising = signal.trend?.adxRising;
      const waitingFor = signal.pendingEntry?.waitingFor;
      const signalType = signal.signal;
      const timestamp = new Date(signal.timestamp).getTime();
      const isNew = Date.now() - timestamp < 60000;

      // BUY/SELL signals are actionable
      if (signalType === 'BUY' || signalType === 'SELL') {
          return {
              isActionable: true,
              badges: [{ label: 'NEW', color: 'success' }]
          };
      }

      // Determine block reasons from pendingEntry.waitingFor
      const badges = [];

      if (waitingFor) {
          // Add direction indicator for pending shorts
          const isShort = signal.pendingEntry?.direction === 'SHORT';
          if (isShort) {
              badges.push({ label: 'SHORT', color: 'warning' });
          }

          switch (waitingFor) {
              case 'ADX_SLOPE_RISING':
                  badges.push({ label: 'SLOPE', color: 'error' });
                  break;
              case 'ADX_STRENGTHEN':
                  badges.push({ label: 'ADX', color: 'error' });
                  break;
              case 'RSI_COOLDOWN':
                  badges.push({ label: 'RSI', color: 'error' });
                  break;
              case 'RSI_RECOVERY':
                  badges.push({ label: 'RSI', color: 'error' });
                  break;
              case 'BOTH':
                  badges.push({ label: 'ADX', color: 'error' });
                  badges.push({ label: 'RSI', color: 'error' });
                  break;
              default:
                  badges.push({ label: 'WAIT', color: 'warning' });
          }
      } else {
          // Infer from current values for HOLD signals without pending entry
          if (adxVal < minAdx) {
              badges.push({ label: 'ADX', color: 'warning' });
          }
          if (adxRising === false) {
              badges.push({ label: 'SLOPE', color: 'warning' });
          }
      }

      // Default to HOLD if no specific block reason
      if (badges.length === 0) {
          badges.push({ label: 'HOLD', color: 'default' });
      }

      return { isActionable: false, badges };
  };

  // --- LOGIC: System Health (Oanda data service) ---
  const dataStatus = useMemo(() => {
      if (!systemStatus?.services?.dataService) return null;
      const { candleCount: totalCandles = 0 } = systemStatus.services.dataService;
      const target = 800; // 200 candles × 4 pairs
      const percent = Math.min((totalCandles / target) * 100, 100);
      return { totalCandles, percent };
  }, [systemStatus]);

  // --- RENDERERS ---

  if (filteredSignals.length === 0) {
      return (
        <Box 
            height="100%" display="flex" flexDirection="column" 
            alignItems="center" justifyContent="center" color="text.secondary" p={4}
        >
            <Radar sx={{ fontSize: 48, opacity: 0.2, mb: 2, animation: 'pulse 2s infinite' }} />
            <Typography variant="body2" fontWeight="bold">NO ACTIVE SIGNALS</Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {signals && signals.length > 0 
                    ? "Signals exist but match no active assets." 
                    : "Scanning portfolio assets..."}
            </Typography>
            
            {dataStatus && dataStatus.percent < 100 && (
                <Box width="100%" maxWidth={200} mt={3}>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                        <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>DATA TRAINING</Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>{Math.round(dataStatus.percent)}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={dataStatus.percent} sx={{ height: 2, borderRadius: 2 }} />
                </Box>
            )}
        </Box>
      );
  }

  // COMPACT VIEW
  if (compact) {
      return (
        <Stack spacing={0} sx={{ height: '100%', overflowY: 'auto' }}>
            {filteredSignals.map((signal) => {
                const { color, icon } = getSignalMeta(signal.signal);
                const paletteColor = theme.palette[color];
                const info = INSTRUMENT_INFO[signal.symbol] || {};
                // Unique key includes timestamp to force re-render on update
                return (
                    <Box 
                        key={`${signal.symbol}-${signal.timestamp}`}
                        sx={{
                            p: 1.5,
                            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.05) }
                        }}
                    >
                         <Box display="flex" alignItems="center" gap={1.5}>
                             <Avatar variant="rounded" sx={{ width: 28, height: 28, bgcolor: alpha(paletteColor.main, 0.1), color: paletteColor.main, border: `1px solid ${alpha(paletteColor.main, 0.2)}` }}>{icon}</Avatar>
                            <Box>
                                <Typography variant="body2" fontWeight="bold">
                                    {info.flag || '💱'} {formatInstrument(signal.symbol)}
                                </Typography>
                                <MonoText sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{new Date(signal.timestamp).toLocaleTimeString([], { hour12: false })}</MonoText>
                            </Box>
                         </Box>
                         <Box textAlign="right">
                             <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                                 <Chip label={signal.signal?.split('_')[0]} size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold', bgcolor: alpha(paletteColor.main, 0.1), color: paletteColor.main }} />
                                 {/* Block reason badge for compact view */}
                                 {signal.signal === 'HOLD' && signal.pendingEntry?.waitingFor && (
                                     <>
                                         {signal.pendingEntry.direction === 'SHORT' && (
                                             <Chip
                                                 label="S"
                                                 size="small"
                                                 color="warning"
                                                 sx={{ height: 14, fontSize: '0.55rem', '& .MuiChip-label': { px: 0.3 } }}
                                             />
                                         )}
                                         <Chip
                                             label={
                                                 signal.pendingEntry.waitingFor === 'ADX_SLOPE_RISING' ? 'SLOPE' :
                                                 signal.pendingEntry.waitingFor === 'ADX_STRENGTHEN' ? 'ADX' :
                                                 signal.pendingEntry.waitingFor === 'RSI_COOLDOWN' ? 'RSI' :
                                                 signal.pendingEntry.waitingFor === 'RSI_RECOVERY' ? 'RSI' :
                                                 signal.pendingEntry.waitingFor === 'BOTH' ? 'ADX' : 'WAIT'
                                             }
                                             size="small"
                                             color="error"
                                             sx={{ height: 14, fontSize: '0.55rem', '& .MuiChip-label': { px: 0.5 } }}
                                         />
                                     </>
                                 )}
                             </Box>
                             <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.3} mt={0.5}>
                                 <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                     ADX: {signal.strength?.toFixed(0)}
                                 </Typography>
                                 {signal.trend?.adxRising !== undefined && (
                                     <Typography
                                         component="span"
                                         sx={{
                                             fontSize: '0.75rem',
                                             color: signal.trend.adxRising ? 'success.main' : 'error.main',
                                             fontWeight: 'bold'
                                         }}
                                     >
                                         {signal.trend.adxRising ? '↑' : '↓'}
                                     </Typography>
                                 )}
                             </Box>
                         </Box>
                    </Box>
                );
            })}
        </Stack>
      );
  }

  // FULL TABLE VIEW
  return (
    <TableContainer component={Box} sx={{ height: '100%', overflow: 'auto' }}>
        <Table stickyHeader size="small">
            <TableHead>
                <TableRow>
                    <HeaderCell>Pair</HeaderCell>
                    <HeaderCell>Time</HeaderCell>
                    <HeaderCell>Signal Type</HeaderCell>
                    <HeaderCell align="right">Strength (ADX)</HeaderCell>
                    <HeaderCell align="center">Trend / RSI</HeaderCell>
                    <HeaderCell align="center">Status</HeaderCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {filteredSignals.map((signal) => {
                     const { color, icon } = getSignalMeta(signal.signal);
                     const paletteColor = theme.palette[color];
                     const { rsiVal, isBullish, isBearish } = getTrendContext(signal);
                     const info = INSTRUMENT_INFO[signal.symbol] || {};

                     // FIXED: Key includes timestamp to force update when same symbol gets new signal
                     return (
                         <StyledTableRow key={`${signal.symbol}-${signal.timestamp}`}>
                             {/* Pair */}
                             <StyledTableCell>
                                 <Box display="flex" alignItems="center" gap={1}>
                                    <Avatar variant="rounded" sx={{ width: 24, height: 24, bgcolor: alpha(paletteColor.main, 0.1), color: paletteColor.main }}>{icon}</Avatar>
                                    <Typography variant="body2" sx={{ fontSize: '0.9rem' }}>{info.flag || '💱'}</Typography>
                                    <Typography variant="body2" fontWeight="bold">{formatInstrument(signal.symbol)}</Typography>
                                 </Box>
                             </StyledTableCell>

                             {/* Time */}
                             <StyledTableCell>
                                 {new Date(signal.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                             </StyledTableCell>

                             {/* Signal */}
                             <StyledTableCell>
                                 <Chip 
                                    label={signal.signal?.replace(/_/g, ' ') || 'UNKNOWN'} 
                                    size="small" 
                                    sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold', bgcolor: alpha(paletteColor.main, 0.1), color: paletteColor.main, border: `1px solid ${alpha(paletteColor.main, 0.2)}` }} 
                                />
                             </StyledTableCell>

                             {/* Strength */}
                             <StyledTableCell align="right">
                                 <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
                                     <LinearProgress
                                         variant="determinate"
                                         value={Math.min((signal.strength || 0) * 2, 100)}
                                         sx={{ width: 50, height: 4, borderRadius: 2 }}
                                         color={signal.strength > (systemStatus?.config?.minAdx || 22) ? "primary" : "secondary"}
                                     />
                                     <Box display="flex" alignItems="center" gap={0.3}>
                                         <MonoText>{signal.strength?.toFixed(1)}</MonoText>
                                         {signal.trend?.adxRising !== undefined && (
                                             <Typography
                                                 component="span"
                                                 sx={{
                                                     fontSize: '0.9rem',
                                                     color: signal.trend.adxRising ? 'success.main' : 'error.main',
                                                     fontWeight: 'bold',
                                                     lineHeight: 1
                                                 }}
                                             >
                                                 {signal.trend.adxRising ? '↑' : '↓'}
                                             </Typography>
                                         )}
                                     </Box>
                                  </Box>
                              </StyledTableCell>

                             {/* Trend / RSI */}
                              <StyledTableCell align="center">
                                  <Box display="flex" flexDirection="column" alignItems="center">
                                      <Typography 
                                          variant="caption" 
                                          sx={{ 
                                              color: isBullish ? 'success.main' : isBearish ? 'error.main' : 'text.disabled',
                                              fontWeight: 'bold', fontSize: '0.7rem', letterSpacing: 0.5
                                          }}
                                      >
                                          {isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : '-'}
                                      </Typography>
                                      {rsiVal && (
                                          <Box display="flex" alignItems="center" gap={0.5} mt={0.2}>
                                              <ShowChart sx={{ fontSize: 10, color: 'text.secondary' }} />
                                              <Typography 
                                                variant="caption" 
                                                sx={{ 
                                                    fontSize: '0.65rem', fontFamily: 'monospace',
                                                    color: rsiVal > 70 ? 'error.main' : rsiVal < 30 ? 'success.main' : 'text.secondary'
                                                }}
                                              >
                                                RSI: {rsiVal}
                                              </Typography>
                                          </Box>
                                      )}
                                  </Box>
                              </StyledTableCell>

                             {/* Status - Block Reason Badges */}
                              <StyledTableCell align="center">
                                  {(() => {
                                      const status = getSignalStatus(signal, systemStatus?.config);
                                      return (
                                          <Box display="flex" gap={0.5} justifyContent="center" flexWrap="wrap">
                                              {status.badges.map((badge, idx) => (
                                                  <Chip
                                                      key={idx}
                                                      label={badge.label}
                                                      size="small"
                                                      color={badge.color}
                                                      sx={{
                                                          height: 18,
                                                          fontSize: '0.6rem',
                                                          fontWeight: 'bold',
                                                          '& .MuiChip-label': { px: 0.75 }
                                                      }}
                                                  />
                                              ))}
                                          </Box>
                                      );
                                  })()}
                              </StyledTableCell>
                          </StyledTableRow>
                      );
                })}
            </TableBody>
        </Table>
    </TableContainer>
  );
};

export default TradingSignals;