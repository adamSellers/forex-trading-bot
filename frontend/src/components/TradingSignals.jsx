// frontend/src/components/TradingSignals.jsx - FILTERED BY PORTFOLIO
import React, { useMemo } from 'react';
import { 
    Typography, Box, LinearProgress, Stack, Avatar, 
    useTheme, alpha, Chip, styled, Table, TableBody, 
    TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import { 
    TrendingUp, TrendingDown, Timeline, Radar 
} from '@mui/icons-material';

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
  const filteredSignals = useMemo(() => {
      // If signals are empty or config isn't loaded, return as is (or empty)
      if (!signals) return [];
      if (!systemStatus?.config?.assets) return signals;

      // Create a Set for O(1) lookup of active assets
      const activeAssets = new Set(systemStatus.config.assets);

      // Only show signals that are in the user's whitelist
      return signals.filter(s => activeAssets.has(s.symbol));
  }, [signals, systemStatus]);

  // --- LOGIC: Signal Meta ---
  const getSignalMeta = (signalType) => {
    const s = (signalType || '').toUpperCase();
    if (s.includes('BUY')) return { color: 'success', icon: <TrendingUp fontSize="small" /> };
    if (s.includes('SELL')) return { color: 'error', icon: <TrendingDown fontSize="small" /> };
    return { color: 'info', icon: <Timeline fontSize="small" /> }; 
  };

  // --- LOGIC: System Health ---
  const dataStatus = useMemo(() => {
      if (!systemStatus?.services?.binanceData) return null;
      const { candleCount: totalCandles = 0 } = systemStatus.services.binanceData;
      const target = 3000; 
      const percent = Math.min((totalCandles / target) * 100, 100);
      
      let phase = 'building';
      if (percent > 90) phase = 'optimal';
      else if (percent > 50) phase = 'good';
      else if (percent > 20) phase = 'minimal';

      return { totalCandles, percent, phase };
  }, [systemStatus]);

  // --- RENDERERS ---

  // 1. EMPTY STATE (Using filtered list)
  if (filteredSignals.length === 0) {
      return (
        <Box 
            height="100%" 
            display="flex" 
            flexDirection="column" 
            alignItems="center" 
            justifyContent="center" 
            color="text.secondary"
            p={4}
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

  // 2. COMPACT VIEW (Sidebar / List)
  if (compact) {
      return (
        <Stack spacing={0} sx={{ height: '100%', overflowY: 'auto' }}>
            {filteredSignals.map((signal, index) => {
                const { color, icon } = getSignalMeta(signal.signal);
                const paletteColor = theme.palette[color];
                
                return (
                    <Box 
                        key={`${signal.symbol}-${index}`}
                        sx={{
                            p: 1.5,
                            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.05) }
                        }}
                    >
                         <Box display="flex" alignItems="center" gap={1.5}>
                             <Avatar 
                                variant="rounded" 
                                sx={{ 
                                    width: 28, height: 28, 
                                    bgcolor: alpha(paletteColor.main, 0.1), 
                                    color: paletteColor.main,
                                    border: `1px solid ${alpha(paletteColor.main, 0.2)}`
                                }}
                            >
                                {icon}
                            </Avatar>
                            <Box>
                                <Typography variant="body2" fontWeight="bold">
                                    {signal.symbol.replace('USDT', '')}
                                </Typography>
                                <MonoText sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                                     {new Date(signal.timestamp).toLocaleTimeString([], { hour12: false })}
                                </MonoText>
                            </Box>
                         </Box>
                         
                         <Box textAlign="right">
                             <Chip 
                                label={signal.signal?.split('_')[0]} 
                                size="small" 
                                sx={{ 
                                    height: 18, fontSize: '0.65rem', fontWeight: 'bold', 
                                    bgcolor: alpha(paletteColor.main, 0.1), color: paletteColor.main 
                                }}
                            />
                            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5, fontSize: '0.7rem' }}>
                                ADX: {signal.strength?.toFixed(0)}
                            </Typography>
                         </Box>
                    </Box>
                );
            })}
        </Stack>
      );
  }

  // 3. FULL TABLE VIEW (Dashboard Bottom Panel)
  return (
    <TableContainer component={Box} sx={{ height: '100%', overflow: 'auto' }}>
        <Table stickyHeader size="small">
            <TableHead>
                <TableRow>
                    <HeaderCell>Symbol</HeaderCell>
                    <HeaderCell>Time</HeaderCell>
                    <HeaderCell>Signal Type</HeaderCell>
                    <HeaderCell align="right">Strength (ADX)</HeaderCell>
                    <HeaderCell align="right">Price</HeaderCell>
                    <HeaderCell align="center">Status</HeaderCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {filteredSignals.map((signal, index) => {
                     const { color, icon } = getSignalMeta(signal.signal);
                     const paletteColor = theme.palette[color];

                     return (
                         <StyledTableRow key={`${signal.symbol}-${index}`}>
                             {/* Symbol */}
                             <StyledTableCell>
                                 <Box display="flex" alignItems="center" gap={1}>
                                    <Avatar 
                                        variant="rounded" 
                                        sx={{ 
                                            width: 24, height: 24, 
                                            bgcolor: alpha(paletteColor.main, 0.1), 
                                            color: paletteColor.main
                                        }}
                                    >
                                        {icon}
                                    </Avatar>
                                    <Typography variant="body2" fontWeight="bold">
                                        {signal.symbol.replace('USDT', '')}
                                    </Typography>
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
                                    sx={{ 
                                        height: 20, 
                                        fontSize: '0.7rem', 
                                        fontWeight: 'bold',
                                        bgcolor: alpha(paletteColor.main, 0.1),
                                        color: paletteColor.main,
                                        border: `1px solid ${alpha(paletteColor.main, 0.2)}`
                                    }} 
                                />
                             </StyledTableCell>

                             {/* Strength */}
                             <StyledTableCell align="right">
                                 <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
                                     <LinearProgress 
                                        variant="determinate" 
                                        value={Math.min((signal.strength || 0) * 2, 100)} 
                                        sx={{ width: 50, height: 4, borderRadius: 2 }}
                                        color={signal.strength > 25 ? "primary" : "secondary"}
                                      />
                                      <MonoText>{signal.strength?.toFixed(1)}</MonoText>
                                  </Box>
                              </StyledTableCell>

                             {/* Price */}
                              <StyledTableCell align="right">
                                  <MonoText>${signal.currentPrice?.toFixed(2) || '---'}</MonoText>
                              </StyledTableCell>

                             {/* Status */}
                              <StyledTableCell align="center">
                                  {signal.isNew ? (
                                      <Chip label="NEW" color="error" size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
                                  ) : (
                                      <Typography variant="caption" color="text.secondary">LOGGED</Typography>
                                  )}
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